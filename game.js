/* ==========================================================================
   ANON — game logic
   ========================================================================== */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MODELS, toBuffer } from './assets.js';

/* --------------------------------------------------------------------------
   Tuning
   -------------------------------------------------------------------------- */

const RUN_SPEED  = 6.4;
const TURN_SPEED = 12;
const ACCEL      = 13;

/* The run clip was authored for a slower ground speed than the game now uses,
   so its playback rate scales with how fast the character is actually moving.
   Without this the feet cycle too slowly for the distance covered and the
   character looks like it's skating. */
const RUN_ANIM_RATE = 1.28;
const RUN_ANIM_MIN  = 0.65;
const RUN_ANIM_MAX  = 1.5;

/* Jump timing is matched to the animation rather than picked arbitrarily.
   CROUCH_END and LAND_AT are positions inside the raw 1.9s clip; JUMP_RATE
   plays the whole thing faster, and every derived time divides by it, so the
   physics stays locked to the animation no matter how fast it runs. */
const CROUCH_END  = 0.42;
const LAND_AT     = 1.15;
const JUMP_RATE   = 1.45;
const JUMP_HEIGHT = 0.45;

const LAUNCH_TIME    = CROUCH_END / JUMP_RATE;
const TOUCHDOWN_TIME = LAND_AT / JUMP_RATE;
const AIR_TIME       = TOUCHDOWN_TIME - LAUNCH_TIME;
const GRAVITY        = -8 * JUMP_HEIGHT / (AIR_TIME * AIR_TIME);
const JUMP_SPEED     = -GRAVITY * AIR_TIME / 2;

const JUMP_FADE_IN  = 20;
const JUMP_FADE_OUT = 7;

/* Look. PIXEL_SIZE 2 rather than 3: the reference keeps a visible grid but
   the blocks are small enough that curved edges still read as curves. Set to
   1 for a clean render with no pixelation at all. */
const PIXEL_SIZE = 2;

/* Silver. Three values do the work together and can't be tuned in isolation.
   Metalness high enough that the surface is mostly reflection, which is what
   produces the bright rim and the dark shading between limbs, but not so
   high that nothing diffuse remains to keep it off black. Roughness low, so
   highlights stay tight and read as polished rather than chalky. Base colour
   a mid grey, because a near-white base pushes even a metal surface toward
   flat matte plastic. */
const SILVER       = 0x9fa8b2;
const SILVER_METAL = 0.82;
const SILVER_ROUGH = 0.22;
const SILVER_ENV   = 2.0;

const CAM_DISTANCE = 6.1;
const CAM_HEIGHT   = 1.35;
const CAM_SMOOTH   = 11;    // how quickly the camera follows the character
/* Look smoothing is off: the view maps 1:1 to the mouse, with no easing
   between where you point and where the camera ends up. Set LOOK_SMOOTHING
   to true to bring the damping back. */
const LOOK_SMOOTHING = false;
const LOOK_SMOOTH    = 13;  // only used when LOOK_SMOOTHING is true

const MOUSE_SENS = 0.0014;
const TOUCH_SENS = 0.0030;

const PITCH_MIN = -0.42;
const PITCH_MAX = 1.00;

const NET_HZ       = 15;      // state broadcasts per second
const NET_TIMEOUT  = 6000;    // drop a silent peer after this long

const TAG_HEIGHT    = 2.15;   // starting height before the first measurement
const TAG_CLEARANCE = 0.28;   // gap between the top of the head and the label
const TAG_FADE_NEAR = 3.0;    // full opacity closer than this
const TAG_FADE_FAR  = 34;     // fully faded beyond this

const tagBox = new THREE.Box3();   // reused; allocating per frame would churn

/* --------------------------------------------------------------------------
   Module state
   -------------------------------------------------------------------------- */

let renderer, labelRenderer, scene, camera, sun;
let assets = null;

const clock = new THREE.Clock();
const keys = new Set();

let local = null;                 // Avatar for this player
const remotes = new Map();        // peerId -> Avatar

/* Input writes to the *target* angles; the camera eases onto them each frame.
   Smoothing the angle itself keeps rotation rigid relative to the character,
   which is what stops the view swimming. */
let yawTarget = 0, pitchTarget = 0.26;
let yaw = 0, pitch = 0.26;
let pointerLocked = false;
let spaceWasDown = false;

/* Touch input. The stick reports an analog vector rather than a boolean, so
   a half-pushed thumb gives a slower run and the idle/run blend follows it
   instead of snapping between two speeds. */
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const STICK_RADIUS = 50;

const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const look  = { id: null, lx: 0, ly: 0 };

// Camera follows a ground anchor, never the character's live height.
const followPos = new THREE.Vector3();
let camAnchorY = 0, camReady = false;

// Networking
let peer = null, isHost = false, roomCode = null, myId = null, myName = 'anon';
const connections = new Map();    // peerId -> DataConnection
let netAccumulator = 0;

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */

const el = id => document.getElementById(id);

const titleScreen = el('title');
const loadScreen  = el('loading');
const barFill     = el('bar-fill');
const loadText    = el('loading-text');
const loadError   = el('loading-error');
const titleStatus = el('title-status');
const clickLayer  = el('click');
const roomTag     = el('roomtag');
const rosterEl    = el('roster');
const netStatus   = el('netstatus');

/* --------------------------------------------------------------------------
   Asset loading
   -------------------------------------------------------------------------- */

async function loadAssets() {
  const loader = new FBXLoader();
  const keys = ['character', 'idle', 'run', 'jump'];
  const out = {};

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    loadText.textContent = `Unpacking ${key}\u2026`;

    // Yield to the browser between models so the progress bar can actually
    // paint — parsing is synchronous and would otherwise freeze the screen.
    await new Promise(r => setTimeout(r, 0));

    let obj;
    try {
      obj = loader.parse(toBuffer(MODELS[key]), '');
    } catch (e) {
      throw new Error(`Could not parse the embedded ${key} model.\n\n${e.message}`);
    }

    if (key === 'character') {
      out.character = obj;
    } else {
      if (!obj.animations.length) throw new Error(`Embedded ${key} model has no animation.`);
      out[key] = lockRootMotion(obj.animations[0]);
    }

    barFill.style.width = Math.round(((i + 1) / keys.length) * 100) + '%';
  }

  return out;
}

/**
 * Mixamo bakes forward travel into the root bone's position track, so a run
 * clip physically walks the model away from the origin. The script drives
 * movement instead, so freeze horizontal motion and keep vertical, which is
 * what gives a jump its arc.
 */
function lockRootMotion(clip) {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const v = track.values;
    for (let i = 0; i < v.length; i += 3) {
      v[i] = v[0];
      v[i + 2] = v[2];
    }
  }
  return clip;
}

/* --------------------------------------------------------------------------
   Scene
   -------------------------------------------------------------------------- */

function buildScene() {
  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  document.body.appendChild(renderer.domElement);

  // Name tags render as real DOM on a transparent layer above the canvas, so
  // they stay sharp instead of dissolving into the low-resolution buffer.
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'fixed';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.zIndex = '3';
  document.body.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb6cf);
  scene.fog = new THREE.Fog(0x9fb6cf, 45, 140);

  // Metal is mostly reflection, so it needs something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
  camera.rotation.order = 'YXZ';

  scene.add(new THREE.HemisphereLight(0xe4eefb, 0x7a7466, 1.2));

  sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  const s = 25;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 70 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  /* A dim cool light from behind and to the side. On a metal surface this is
     what draws the bright edge down the shoulders and arms — the detail that
     separates polished metal from a flat grey shape. */
  const rim = new THREE.DirectionalLight(0xbcd4f0, 1.1);
  rim.position.set(-9, 7, -11);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0xa39687, roughness: 0.96, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(400, 200, 0xffffff, 0xffffff);
  grid.material.opacity = 0.1;
  grid.material.transparent = true;
  grid.position.y = 0.01;
  scene.add(grid);

  applyResolution();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    applyResolution();
  });
}

/**
 * Sizes the drawing buffer to a fraction of the window. The third argument
 * being false is what makes this work — three leaves the CSS size alone, so
 * the stylesheet stretches the small buffer back to full screen.
 */
function applyResolution() {
  renderer.setSize(
    Math.max(1, Math.floor(innerWidth / PIXEL_SIZE)),
    Math.max(1, Math.floor(innerHeight / PIXEL_SIZE)),
    false
  );
  labelRenderer.setSize(innerWidth, innerHeight);
}

/* --------------------------------------------------------------------------
   Avatar
   Wraps one character instance: model, mixer, animation weights, name tag.
   The same class drives the local player and every remote one; only who sets
   its position differs.
   -------------------------------------------------------------------------- */

class Avatar {
  constructor(name, isLocal) {
    this.isLocal = isLocal;
    this.name = name;

    // cloneSkinned rebinds the skeleton properly; a plain .clone() would leave
    // every copy sharing one skeleton and animating in lockstep.
    const model = cloneSkinned(assets.character);

    const silver = new THREE.MeshStandardMaterial({
      color: SILVER,
      metalness: SILVER_METAL,
      roughness: SILVER_ROUGH,
      envMapIntensity: SILVER_ENV
    });

    model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;   // skinned bounds go stale during animation
        o.material = silver;
      }
    });

    // Normalize height, then sit the feet on the ground.
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    model.scale.setScalar(h > 0.001 ? 1.8 / h : 1);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;

    this.group = new THREE.Group();
    this.group.add(model);
    scene.add(this.group);
    this.model = model;
    this.tagY = TAG_HEIGHT;
    this.tagClock = 0;

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {
      idle: this.mixer.clipAction(assets.idle),
      run:  this.mixer.clipAction(assets.run),
      jump: this.mixer.clipAction(assets.jump)
    };

    this.actions.jump.setLoop(THREE.LoopOnce, 1);
    this.actions.jump.clampWhenFinished = true;
    this.actions.jump.timeScale = JUMP_RATE;
    this.jumpDuration = assets.jump.duration / JUMP_RATE;

    this.actions.idle.play();
    this.actions.run.play();
    this.actions.jump.play();
    this.actions.run.setEffectiveWeight(0);
    this.actions.jump.setEffectiveWeight(0);
    this.actions.idle.setEffectiveWeight(1);

    // Motion state
    this.speed = 0;
    this.velY = 0;
    this.grounded = true;
    this.jumpPhase = 'none';
    this.jumpClock = 0;
    this.jumpBlend = 0;

    // Remote interpolation targets
    this.targetPos = new THREE.Vector3();
    this.targetRotY = 0;
    this.lastPacket = performance.now();

    // No tag for yourself — you know who you are, and a label pinned to the
    // back of your own head just blocks the view.
    if (!isLocal) this.buildTag();
  }

  buildTag() {
    const div = document.createElement('div');
    div.className = 'nametag';
    div.textContent = this.name;
    this.tagEl = div;

    this.tag = new CSS2DObject(div);

    /* Parented to the group, not the model. The model is what the jump clip
       moves, so a tag attached there rides the crouch down into the shoulders
       and the launch up past the head. The group only ever moves with the
       character's own position, so the tag holds a constant height. */
    this.tag.position.set(0, TAG_HEIGHT, 0);
    this.group.add(this.tag);
  }

  setName(name) {
    this.name = name;
    if (this.tagEl) this.tagEl.textContent = name;
  }

  startJump() {
    if (this.jumpPhase !== 'none' || !this.grounded) return;
    this.jumpPhase = 'active';
    this.jumpClock = 0;
    this.actions.jump.reset().play();
  }

  /** Advances the jump state machine and vertical motion. */
  stepJump(dt) {
    if (this.jumpPhase === 'active') {
      const prev = this.jumpClock;
      this.jumpClock += dt;

      // The launch fires partway in, after the crouch has visibly read.
      if (prev < LAUNCH_TIME && this.jumpClock >= LAUNCH_TIME) {
        this.velY = JUMP_SPEED;
        this.grounded = false;
      }

      if (this.jumpClock >= this.jumpDuration ||
         (this.grounded && this.jumpClock > TOUCHDOWN_TIME + 0.25)) {
        this.jumpPhase = 'none';
      }
    }

    // Gravity only while airborne — applying it on the ground makes the
    // character sink and get clamped every frame, which feeds jitter upward.
    if (!this.grounded) {
      this.velY += GRAVITY * dt;
      this.group.position.y += this.velY * dt;

      if (this.group.position.y <= 0) {
        this.group.position.y = 0;
        this.velY = 0;
        this.grounded = true;
      }
    }
  }

  /** Blends idle/run by speed, with the jump clip layered over the top. */
  stepAnimation(dt) {
    const target = this.jumpPhase === 'active' ? 1 : 0;
    const rate = target > this.jumpBlend ? JUMP_FADE_IN : JUMP_FADE_OUT;
    this.jumpBlend += (target - this.jumpBlend) * (1 - Math.exp(-rate * dt));

    const blend = Math.min(1, this.speed / RUN_SPEED);
    const loco = 1 - this.jumpBlend;

    // Cadence follows real speed, so a half-pushed stick jogs and a full one
    // sprints, rather than both playing the same stride at different rates
    // of travel.
    this.actions.run.timeScale = Math.max(RUN_ANIM_MIN,
      Math.min(RUN_ANIM_MAX, blend * RUN_ANIM_RATE));

    this.actions.idle.setEffectiveWeight((1 - blend) * loco);
    this.actions.run.setEffectiveWeight(blend * loco);
    this.actions.jump.setEffectiveWeight(this.jumpBlend);

    this.mixer.update(dt);
  }

  /** Remote avatars ease toward the last received transform. */
  stepRemote(dt) {
    const k = 1 - Math.exp(-12 * dt);
    this.group.position.x += (this.targetPos.x - this.group.position.x) * k;
    this.group.position.z += (this.targetPos.z - this.group.position.z) * k;

    let diff = this.targetRotY - this.group.rotation.y;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * k;

    this.stepJump(dt);
    this.stepAnimation(dt);
    this.stepTag(dt);
  }

  /**
   * Keeps the tag above the character's actual head. The jump clip retains
   * its vertical root motion, so the body rises inside the group during the
   * launch — a fixed tag height would end up buried in the shoulders. This
   * measures where the model really tops out and floats above that, easing
   * so the label glides rather than snapping between frames.
   */
  stepTag(dt) {
    if (!this.tag) return;

    this.tagClock += dt;
    if (this.tagClock > 0.08) {
      this.tagClock = 0;
      tagBox.setFromObject(this.model);
      const top = tagBox.max.y - this.group.position.y;
      if (Number.isFinite(top)) this.tagY = top + TAG_CLEARANCE;
    }

    const k = 1 - Math.exp(-9 * dt);
    this.tag.position.y += (this.tagY - this.tag.position.y) * k;

    // Fade with distance. CSS2D labels don't shrink with perspective, so
    // without this a distant player's name stays full size and ends up
    // larger on screen than the character wearing it.
    const d = camera.position.distanceTo(this.group.position);
    const t = Math.min(1, Math.max(0,
      (d - TAG_FADE_NEAR) / (TAG_FADE_FAR - TAG_FADE_NEAR)));

    const opacity = 1 - t * 0.82;
    const scale = 1 - t * 0.34;

    this.tagEl.style.opacity = opacity.toFixed(2);
    this.tagEl.style.transform = `translateY(-4px) scale(${scale.toFixed(2)})`;
  }

  dispose() {
    if (this.tag) this.tag.element.remove();
    scene.remove(this.group);
  }
}

/* --------------------------------------------------------------------------
   Local movement
   -------------------------------------------------------------------------- */

const forward = new THREE.Vector3();
const right   = new THREE.Vector3();
const move    = new THREE.Vector3();

function stepLocal(dt) {
  // Camera-relative movement, flattened onto the ground plane.
  forward.set(Math.sin(yaw), 0, Math.cos(yaw));
  right.set(-forward.z, 0, forward.x);

  move.set(0, 0, 0);
  if (keys.has('KeyW')) move.add(forward);
  if (keys.has('KeyS')) move.sub(forward);
  if (keys.has('KeyD')) move.add(right);
  if (keys.has('KeyA')) move.sub(right);

  // Keyboard input is all-or-nothing; the stick is analog. Whichever is
  // pushed harder wins, so both can be live without fighting.
  let throttle = move.lengthSq() > 0.0001 ? 1 : 0;

  if (stick.id !== null) {
    const mag = Math.min(1, Math.hypot(stick.x, stick.y));
    if (mag > 0.08) {
      move.set(0, 0, 0);
      move.addScaledVector(right, stick.x);
      move.addScaledVector(forward, -stick.y);   // screen-up is forward
      throttle = mag;
    }
  }

  const moving = throttle > 0 && move.lengthSq() > 0.0001;
  if (moving) move.normalize();

  const target = moving ? RUN_SPEED * throttle : 0;
  local.speed += (target - local.speed) * Math.min(1, dt * ACCEL);
  local.group.position.addScaledVector(move, local.speed * dt);

  // Face the direction of travel, easing rather than snapping.
  if (moving) {
    const want = Math.atan2(move.x, move.z);
    let diff = want - local.group.rotation.y;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    local.group.rotation.y += diff * Math.min(1, dt * TURN_SPEED);
  }

  // Edge-triggered jump: holding or hammering space cannot restart the clip.
  const down = keys.has('Space');
  if (down && !spaceWasDown) local.startJump();
  spaceWasDown = down;

  local.stepJump(dt);
  local.stepAnimation(dt);
}

/* --------------------------------------------------------------------------
   Camera
   No shake by construction: orientation comes straight from the mouse angles
   rather than from looking at a smoothed point, and height tracks a ground
   anchor rather than the character, so jumping cannot move the view.
   -------------------------------------------------------------------------- */

function stepCamera(dt) {
  const p = local.group.position;

  // The view follows the input exactly. Easing here is what reads as the
  // camera carrying momentum after the mouse has stopped.
  if (LOOK_SMOOTHING) {
    const kA = 1 - Math.exp(-LOOK_SMOOTH * dt);
    yaw   += (yawTarget - yaw) * kA;
    pitch += (pitchTarget - pitch) * kA;
  } else {
    yaw = yawTarget;
    pitch = pitchTarget;
  }

  // Follow the character's ground position, lagging slightly. Height tracks a
  // separate anchor that freezes mid-air, so jumping never moves the view.
  const kP = 1 - Math.exp(-CAM_SMOOTH * dt);
  const anchorRate = local.grounded ? 12 : 0;
  camAnchorY += (p.y - camAnchorY) * (1 - Math.exp(-anchorRate * dt));

  if (!camReady) {
    followPos.set(p.x, 0, p.z);
    camAnchorY = p.y;
    camReady = true;
  }

  followPos.x += (p.x - followPos.x) * kP;
  followPos.z += (p.z - followPos.z) * kP;

  // The orbit offset is applied rigidly on top of the followed point. Damping
  // the final camera position instead is what used to make the character
  // slide across the screen whenever the view turned.
  const flat = Math.cos(pitch) * CAM_DISTANCE;

  camera.position.set(
    followPos.x - Math.sin(yaw) * flat,
    camAnchorY + CAM_HEIGHT + Math.sin(pitch) * CAM_DISTANCE,
    followPos.z - Math.cos(yaw) * flat
  );

  if (camera.position.y < 0.4) camera.position.y = 0.4;

  camera.rotation.set(-pitch, yaw + Math.PI, 0);
}

/* --------------------------------------------------------------------------
   Frame loop
   -------------------------------------------------------------------------- */

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  stepLocal(dt);
  for (const avatar of remotes.values()) avatar.stepRemote(dt);
  stepCamera(dt);

  // Keep the sun near the player so shadows don't fall outside its frustum.
  const p = local.group.position;
  sun.position.set(p.x + 12, 20, p.z + 8);
  sun.target.position.copy(p);
  sun.target.updateMatrixWorld();

  stepNetwork(dt);

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

/* --------------------------------------------------------------------------
   Input
   -------------------------------------------------------------------------- */

function bindInput() {
  addEventListener('keydown', e => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });

  addEventListener('keyup', e => keys.delete(e.code));

  // Releasing the cursor should also release the keys, or a held direction
  // sticks on and the character walks off by itself.
  addEventListener('blur', () => keys.clear());

  /* Pointer lock has two long-standing quirks that both read as the view
     lurching. First, movementX/Y normally arrive with the operating system's
     mouse acceleration already applied, so a quick flick travels much further
     than a slow one covering the same distance. unadjustedMovement asks for
     raw device deltas instead. Second, browsers occasionally emit one
     enormous bogus delta — right after the lock engages, and sometimes when
     the pointer wraps the screen edge — so anything implausible is dropped
     rather than smoothed, because smoothing a spike just spreads it out. */
  const MAX_STEP = 110;
  let ignoreNextMove = false;

  const requestLock = async () => {
    try {
      await renderer.domElement.requestPointerLock({ unadjustedMovement: true });
    } catch {
      renderer.domElement.requestPointerLock();   // older browsers
    }
  };

  // Pointer lock is a desktop idea; on a phone the game just starts.
  if (!IS_TOUCH) {
    clickLayer.addEventListener('click', requestLock);
    renderer.domElement.addEventListener('click', requestLock);

    document.addEventListener('pointerlockchange', () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
      clickLayer.classList.toggle('hidden', pointerLocked);
      if (pointerLocked) ignoreNextMove = true;
      else keys.clear();
    });
  }

  addEventListener('mousemove', e => {
    if (!pointerLocked) return;

    // The first event after locking carries the jump from wherever the
    // cursor happened to be sitting.
    if (ignoreNextMove) { ignoreNextMove = false; return; }

    const mx = e.movementX, my = e.movementY;
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
    if (Math.abs(mx) > MAX_STEP || Math.abs(my) > MAX_STEP) return;

    yawTarget -= mx * MOUSE_SENS;

    // Plus, not minus. Pushing the mouse forward should raise your view, and
    // the sign was backwards, which is why it felt inverted.
    pitchTarget += my * MOUSE_SENS;
    pitchTarget = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitchTarget));
  });

  if (IS_TOUCH) bindTouch();
}

/* --------------------------------------------------------------------------
   Touch
   Left half of the screen drives a thumb stick that appears where you press;
   the right half is a look-drag. Both are tracked by touch identifier, so
   they work simultaneously and neither steals the other's finger.
   -------------------------------------------------------------------------- */

function bindTouch() {
  document.body.classList.add('touch');

  const layer = el('touch');
  const stickEl = el('stick');
  const knobEl = el('knob');
  const jumpBtn = el('btn-jump');

  const showStick = (x, y) => {
    stickEl.style.left = x + 'px';
    stickEl.style.top = y + 'px';
    stickEl.classList.remove('hidden');
  };

  const moveKnob = (dx, dy) => {
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      if (t.target === jumpBtn) continue;         // handled separately

      if (t.clientX < innerWidth * 0.5 && stick.id === null) {
        stick.id = t.identifier;
        stick.ox = t.clientX;
        stick.oy = t.clientY;
        stick.x = stick.y = 0;
        showStick(t.clientX, t.clientY);
        moveKnob(0, 0);
      } else if (look.id === null) {
        look.id = t.identifier;
        look.lx = t.clientX;
        look.ly = t.clientY;
      }
    }
  }, { passive: false });

  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        let dx = t.clientX - stick.ox;
        let dy = t.clientY - stick.oy;

        // Clamp the knob to the ring, but keep the direction.
        const dist = Math.hypot(dx, dy);
        if (dist > STICK_RADIUS) {
          dx *= STICK_RADIUS / dist;
          dy *= STICK_RADIUS / dist;
        }

        moveKnob(dx, dy);
        stick.x = dx / STICK_RADIUS;
        stick.y = dy / STICK_RADIUS;

      } else if (t.identifier === look.id) {
        yawTarget   -= (t.clientX - look.lx) * TOUCH_SENS;
        pitchTarget += (t.clientY - look.ly) * TOUCH_SENS;
        pitchTarget = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitchTarget));
        look.lx = t.clientX;
        look.ly = t.clientY;
      }
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  const endTouch = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        stick.id = null;
        stick.x = stick.y = 0;
        stickEl.classList.add('hidden');
      } else if (t.identifier === look.id) {
        look.id = null;
      }
    }
  };

  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);

  // touchstart rather than click, so the jump fires on contact instead of
  // waiting for the finger to lift.
  jumpBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    if (local) local.startJump();
  }, { passive: false });

  // Belt and braces against double-tap zoom on iOS.
  layer.addEventListener('dblclick', e => e.preventDefault());
}

/* --------------------------------------------------------------------------
   Networking
   Star topology over WebRTC. The host is the hub: everyone sends their own
   state to it, and it rebroadcasts a combined snapshot. No server to run,
   but the room only lives as long as the host does.
   -------------------------------------------------------------------------- */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to read aloud

/* Public lobbies are ordinary rooms on fixed, well-known codes. There is no
   server keeping them alive, so "always up" means: whoever arrives first
   silently becomes the host, and if that person leaves, the remaining players
   race to take over. From a player's side a lobby is simply always there. */
const PUBLIC_LOBBIES = [
  { code: 'PLAZA', name: 'Plaza' },
  { code: 'DUNES', name: 'Dunes' },
  { code: 'VOIDX', name: 'Void'  }
];

const isPublic = code => PUBLIC_LOBBIES.some(l => l.code === code);

function makeCode() {
  let out = '';
  for (let i = 0; i < 5; i++)
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

const peerIdFor = code => `anon-room-${code}`;

/**
 * Joins a room, hosting it if nobody is there yet. Tries to connect as a
 * client first, because the failure mode that way round is cheap: if no host
 * answers, we simply become one. Claiming the host ID first would instead
 * mean two people who arrive simultaneously both think they own the room.
 */
async function enterRoom(code, { allowHost }) {
  try {
    await startClient(code);
    return;
  } catch (e) {
    if (!allowHost || e.code !== 'no-host') throw e;
  }

  try {
    await startHost(code);
  } catch (e) {
    // Someone claimed it in the gap between our attempts. Join them instead.
    if (e.code === 'taken') {
      await new Promise(r => setTimeout(r, 400));
      await startClient(code);
      return;
    }
    throw e;
  }
}

function startHost(code) {
  return new Promise((resolve, reject) => {
    isHost = true;
    roomCode = code;
    peer = new Peer(peerIdFor(code));
    myId = 'host';

    peer.on('open', () => resolve());

    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        const e = new Error('That room code is already taken.');
        e.code = 'taken';
        reject(e);
      } else {
        reject(new Error(`Network error: ${err.type}`));
      }
    });

    peer.on('connection', conn => {
      conn.on('open', () => {
        connections.set(conn.peer, conn);
        conn.send({ t: 'welcome', id: conn.peer });
      });

      conn.on('data', msg => onHostMessage(conn, msg));
      conn.on('close', () => dropPeer(conn.peer));
      conn.on('error', () => dropPeer(conn.peer));
    });
  });
}

function startClient(code) {
  return new Promise((resolve, reject) => {
    isHost = false;
    roomCode = code;
    peer = new Peer();

    const fail = (message, kind) => {
      const e = new Error(message);
      e.code = kind;
      reject(e);
    };

    // Short, because for a public lobby this timeout is the normal path to
    // discovering the room is empty and we should host it ourselves.
    const timer = setTimeout(() => fail('No room found with that code.', 'no-host'), 5000);

    peer.on('error', err => {
      clearTimeout(timer);
      if (err.type === 'peer-unavailable') fail('No room found with that code.', 'no-host');
      else fail(`Network error: ${err.type}`, err.type);
    });

    peer.on('open', id => {
      myId = id;
      const conn = peer.connect(peerIdFor(code), { reliable: false });

      conn.on('open', () => {
        clearTimeout(timer);
        connections.set('host', conn);
        conn.send({ t: 'hello', name: myName });
        resolve();
      });

      conn.on('data', onClientMessage);
      conn.on('close', () => onHostLost());
    });
  });
}

/**
 * The host has gone. Everyone still here waits a random moment and then tries
 * to claim the room's host ID; exactly one wins, and the rest reconnect to
 * whoever that turns out to be. The random delay is what keeps the attempts
 * from colliding, and it is short enough that the gap reads as a hiccup.
 */
async function onHostLost() {
  if (isHost) return;

  netStatus.textContent = 'RECONNECTING';

  for (const a of remotes.values()) a.dispose();
  remotes.clear();
  connections.clear();
  renderRoster();

  try { peer.destroy(); } catch {}
  peer = null;

  await new Promise(r => setTimeout(r, 300 + Math.random() * 1200));

  try {
    await enterRoom(roomCode, { allowHost: true });
    netStatus.textContent = '1 ONLINE';
  } catch {
    netStatus.textContent = 'DISCONNECTED';
  }
}

function onHostMessage(conn, msg) {
  if (msg.t === 'hello') {
    ensureRemote(conn.peer, msg.name);
    renderRoster();
  } else if (msg.t === 'state') {
    const avatar = ensureRemote(conn.peer, msg.n);
    applyState(avatar, msg);
  } else if (msg.t === 'probe') {
    // Someone on the title screen asking who's here. Answer and forget them —
    // no avatar is created, so browsing a lobby doesn't put you in it.
    conn.send({
      t: 'roster',
      names: [myName, ...[...remotes.values()].map(a => a.name)]
    });
  }
}

function onClientMessage(msg) {
  if (msg.t === 'welcome') {
    myId = msg.id;
  } else if (msg.t === 'snapshot') {
    const seen = new Set();

    for (const s of msg.players) {
      if (s.id === myId) continue;
      seen.add(s.id);
      applyState(ensureRemote(s.id, s.n), s);
    }

    // Anyone missing from the snapshot has left.
    for (const id of [...remotes.keys()]) {
      if (!seen.has(id)) { remotes.get(id).dispose(); remotes.delete(id); }
    }
    renderRoster();
  }
}

/* --------------------------------------------------------------------------
   Lobby browser
   Asks each public room who is inside, without joining. One throwaway peer
   handles every probe; each connection is opened, answered and closed.
   -------------------------------------------------------------------------- */

const lobbyState = new Map();   // code -> { names, checked }
let probePeer = null;
let probeTimer = null;

function getProbePeer() {
  if (probePeer && !probePeer.destroyed) return Promise.resolve(probePeer);

  return new Promise((resolve, reject) => {
    const p = new Peer();
    const timer = setTimeout(() => reject(new Error('probe peer timeout')), 8000);

    p.on('open', () => { clearTimeout(timer); probePeer = p; resolve(p); });
    p.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

function probeLobby(p, code) {
  return new Promise(resolve => {
    let settled = false;
    const conn = p.connect(peerIdFor(code), { reliable: true });

    const finish = names => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { conn.close(); } catch {}
      resolve(names);
    };

    // No answer means nobody is hosting, which is a valid result rather than
    // an error: the lobby is simply empty until someone walks in.
    const timer = setTimeout(() => finish([]), 3500);

    conn.on('open', () => conn.send({ t: 'probe' }));
    conn.on('data', msg => { if (msg.t === 'roster') finish(msg.names || []); });
    conn.on('error', () => finish([]));
  });
}

async function refreshLobbies() {
  let p;
  try {
    p = await getProbePeer();
  } catch {
    renderLobbies();
    return;
  }

  // Sequential, not parallel: several simultaneous connections from one peer
  // to different rooms is exactly the pattern that trips broker rate limits.
  for (const lobby of PUBLIC_LOBBIES) {
    if (peer) return;                       // already in a game; stop polling
    const names = await probeLobby(p, lobby.code);
    lobbyState.set(lobby.code, { names, checked: true });
    renderLobbies();
  }
}

function renderLobbies() {
  const host = el('lobbies');
  host.innerHTML = '';

  for (const lobby of PUBLIC_LOBBIES) {
    const state = lobbyState.get(lobby.code);
    const names = state ? state.names : null;
    const count = names ? names.length : 0;

    const row = document.createElement('button');
    row.className = 'lobby' + (count > 0 ? ' live' : '');

    let who;
    if (!state) who = 'checking…';
    else if (count === 0) who = 'empty — be the first';
    else who = names.join(', ');

    row.innerHTML =
      `<span class="name">${escapeHtml(lobby.name)}</span>` +
      `<span class="who">${escapeHtml(who)}</span>` +
      `<span class="count">${state ? count : '·'}</span>`;

    row.addEventListener('click', () => enterGame('public', lobby.code));
    host.appendChild(row);
  }
}

function startLobbyPolling() {
  renderLobbies();
  refreshLobbies();
  clearInterval(probeTimer);
  probeTimer = setInterval(() => { if (!peer) refreshLobbies(); }, 9000);
}

function stopLobbyPolling() {
  clearInterval(probeTimer);
  probeTimer = null;
  if (probePeer) { try { probePeer.destroy(); } catch {} probePeer = null; }
}

function ensureRemote(id, name) {
  let avatar = remotes.get(id);
  if (!avatar) {
    avatar = new Avatar(name || 'anon', false);
    remotes.set(id, avatar);
    renderRoster();
  } else if (name && name !== avatar.name) {
    avatar.setName(name);
  }
  return avatar;
}

function applyState(avatar, s) {
  avatar.targetPos.set(s.x, 0, s.z);
  avatar.targetRotY = s.r;
  avatar.speed = s.s;
  avatar.lastPacket = performance.now();
  if (s.j && avatar.jumpPhase === 'none') avatar.startJump();
}

function dropPeer(id) {
  connections.delete(id);
  const avatar = remotes.get(id);
  if (avatar) { avatar.dispose(); remotes.delete(id); }
  renderRoster();
}

function localState() {
  return {
    t: 'state',
    n: myName,
    x: +local.group.position.x.toFixed(2),
    z: +local.group.position.z.toFixed(2),
    r: +local.group.rotation.y.toFixed(3),
    s: +local.speed.toFixed(2),
    j: local.jumpPhase === 'active'
  };
}

function stepNetwork(dt) {
  if (!peer) return;

  netAccumulator += dt;
  if (netAccumulator < 1 / NET_HZ) return;
  netAccumulator = 0;

  if (isHost) {
    // Prune anyone who has gone quiet, then publish the world.
    const now = performance.now();
    for (const [id, avatar] of [...remotes]) {
      if (now - avatar.lastPacket > NET_TIMEOUT) dropPeer(id);
    }

    const players = [{ id: 'host', n: myName, ...stripType(localState()) }];
    for (const [id, a] of remotes) {
      players.push({
        id, n: a.name,
        x: +a.targetPos.x.toFixed(2),
        z: +a.targetPos.z.toFixed(2),
        r: +a.targetRotY.toFixed(3),
        s: +a.speed.toFixed(2),
        j: a.jumpPhase === 'active'
      });
    }

    const snapshot = { t: 'snapshot', players };
    for (const conn of connections.values()) {
      if (conn.open) conn.send(snapshot);
    }
  } else {
    const conn = connections.get('host');
    if (conn && conn.open) conn.send(localState());
  }

  netStatus.textContent = `${remotes.size + 1} ONLINE`;
}

function stripType(s) {
  const { t, ...rest } = s;
  return rest;
}

function renderRoster() {
  if (!peer) return;
  const names = [`<div class="me">${escapeHtml(myName)} (you)</div>`];
  for (const a of remotes.values()) names.push(`<div>${escapeHtml(a.name)}</div>`);
  rosterEl.innerHTML = `<div class="head">PLAYERS</div>${names.join('')}`;
  rosterEl.classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

function cleanName(raw) {
  const n = (raw || '').trim().slice(0, 14);
  return n || 'anon';
}

async function enterGame(mode, code) {
  myName = cleanName(el('username').value);

  titleScreen.classList.add('hidden');
  loadScreen.classList.remove('hidden');
  loadError.textContent = '';

  try {
    if (!assets) {
      assets = await loadAssets();
      buildScene();
      bindInput();
    }

    if (mode === 'public') {
      loadText.textContent = 'Entering lobby…';
      stopLobbyPolling();
      await enterRoom(code, { allowHost: true });
    } else if (mode === 'host') {
      loadText.textContent = 'Opening room…';
      stopLobbyPolling();
      await startHost(code);
    } else if (mode === 'join') {
      loadText.textContent = 'Joining room…';
      stopLobbyPolling();
      await startClient(code);
    } else {
      stopLobbyPolling();
    }
  } catch (e) {
    console.error(e);
    loadError.textContent = e.message;
    loadText.textContent = 'Failed.';
    setTimeout(() => {
      loadScreen.classList.add('hidden');
      titleScreen.classList.remove('hidden');
      titleStatus.textContent = e.message.split('\n')[0];
      startLobbyPolling();
    }, 2600);
    return;
  }

  local = new Avatar(myName, true);

  loadScreen.classList.add('hidden');
  document.body.classList.add('playing');

  if (IS_TOUCH) {
    el('touch').classList.remove('hidden');
  } else {
    clickLayer.classList.remove('hidden');
    el('hud').classList.remove('hidden');
  }

  if (mode !== 'solo') {
    const lobby = PUBLIC_LOBBIES.find(l => l.code === roomCode);
    el('roomcode').textContent = lobby ? lobby.name.toUpperCase() : roomCode;
    roomTag.querySelector('.label').textContent = lobby ? 'LOBBY' : 'ROOM';
    el('btn-copy').classList.toggle('hidden', !!lobby);
    roomTag.classList.remove('hidden');
    netStatus.classList.remove('hidden');
    renderRoster();
  }

  renderer.setAnimationLoop(tick);
}

el('btn-solo').addEventListener('click', () => enterGame('solo'));
el('btn-host').addEventListener('click', () => enterGame('host', makeCode()));

// Start browsing as soon as the title screen is up, so the lobby list is
// already populated by the time someone has finished typing a name.
startLobbyPolling();

el('btn-join').addEventListener('click', () => {
  const code = el('joincode').value.trim().toUpperCase();
  if (code.length !== 5) {
    titleStatus.textContent = 'Room codes are five characters.';
    return;
  }
  enterGame('join', code);
});

el('joincode').addEventListener('keydown', e => {
  if (e.key === 'Enter') el('btn-join').click();
});

el('username').addEventListener('keydown', e => {
  if (e.key === 'Enter') el('btn-host').click();
});

el('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    el('btn-copy').textContent = 'copied';
    setTimeout(() => el('btn-copy').textContent = 'copy', 1400);
  } catch {
    el('btn-copy').textContent = roomCode;
  }
});
