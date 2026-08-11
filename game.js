/* ==========================================================================
   ANON — game logic
   ========================================================================== */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/* --------------------------------------------------------------------------
   Tuning
   -------------------------------------------------------------------------- */

const ASSETS = {
  character: 'assets/Snaptic_Model.fbx',
  idle:      'assets/Idle.fbx',
  run:       'assets/Running.fbx',
  jump:      'assets/Jumping.fbx'
};

const RUN_SPEED  = 4.6;
const TURN_SPEED = 10;
const ACCEL      = 9;

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

/* Look. PIXEL_SIZE 3 rather than 4: the low-resolution grid is fixed to the
   screen while the world slides beneath it, and coarser blocks make that
   crawl along edges read as a shimmer. */
const PIXEL_SIZE = 3;

/* Metalness sits well below half. At full metal the surface shows only
   reflections, which against a modest environment reads as near-black — that
   was why the character came out a silhouette. Keeping most of the surface
   non-metallic lets the scene lights actually land on it. */
const SILVER       = 0xeef2f7;
const SILVER_METAL = 0.38;
const SILVER_ROUGH = 0.36;
const SILVER_ENV   = 1.6;

const CAM_DISTANCE = 5.6;
const CAM_HEIGHT   = 1.35;
const CAM_SMOOTH   = 14;

const NET_HZ       = 15;      // state broadcasts per second
const NET_TIMEOUT  = 6000;    // drop a silent peer after this long

/* --------------------------------------------------------------------------
   Module state
   -------------------------------------------------------------------------- */

let renderer, labelRenderer, scene, camera, sun;
let assets = null;

const clock = new THREE.Clock();
const keys = new Set();

let local = null;                 // Avatar for this player
const remotes = new Map();        // peerId -> Avatar

let yaw = 0, pitch = 0.26, pointerLocked = false;
let spaceWasDown = false;

// Camera follows a ground anchor, never the character's live height.
const camPos = new THREE.Vector3();
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
  const entries = Object.entries(ASSETS);
  const out = {};
  let done = 0;

  for (const [key, path] of entries) {
    loadText.textContent = `Loading ${key}…`;
    let obj;
    try {
      obj = await loader.loadAsync(path);
    } catch (e) {
      throw new Error(
        `Could not load ${path}\n\n` +
        `Open this through a local server, not by double-clicking the file. ` +
        `In the ANON folder run:\n\n    python3 -m http.server 8000\n\n` +
        `then visit http://localhost:8000`
      );
    }

    if (key === 'character') {
      out.character = obj;
    } else {
      if (!obj.animations.length) throw new Error(`${path} contains no animation.`);
      out[key] = lockRootMotion(obj.animations[0]);
    }

    done++;
    barFill.style.width = Math.round((done / entries.length) * 100) + '%';
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
  renderer.toneMappingExposure = 1.1;
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

  scene.add(new THREE.HemisphereLight(0xe4eefb, 0x7a7466, 1.5));

  sun = new THREE.DirectionalLight(0xfff4e2, 1.9);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 25;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 70 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

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

    this.buildTag();
  }

  buildTag() {
    const div = document.createElement('div');
    div.className = 'nametag' + (this.isLocal ? ' self' : '');
    div.textContent = this.name;
    this.tagEl = div;

    this.tag = new CSS2DObject(div);
    this.tag.position.set(0, 2.15, 0);
    this.group.add(this.tag);
  }

  setName(name) {
    this.name = name;
    this.tagEl.textContent = name;
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
  }

  dispose() {
    this.tag.element.remove();
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

  const moving = move.lengthSq() > 0.0001;
  if (moving) move.normalize();

  const target = moving ? RUN_SPEED : 0;
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

  const anchorRate = local.grounded ? 12 : 0;
  camAnchorY += (p.y - camAnchorY) * (1 - Math.exp(-anchorRate * dt));

  const focusY = camAnchorY + CAM_HEIGHT;
  const flat = Math.cos(pitch) * CAM_DISTANCE;

  const dx = p.x - Math.sin(yaw) * flat;
  const dy = focusY + Math.sin(pitch) * CAM_DISTANCE;
  const dz = p.z - Math.cos(yaw) * flat;

  if (!camReady) {
    camAnchorY = p.y;
    camPos.set(dx, dy, dz);
    camReady = true;
  }

  const k = 1 - Math.exp(-CAM_SMOOTH * dt);
  camPos.x += (dx - camPos.x) * k;
  camPos.y += (dy - camPos.y) * k;
  camPos.z += (dz - camPos.z) * k;

  camera.position.copy(camPos);
  if (camera.position.y < 0.4) camera.position.y = 0.4;

  // Fixed orientation from the input angles. Deriving it from a damped
  // look-at target is what made the view wobble.
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

  const requestLock = () => renderer.domElement.requestPointerLock();
  clickLayer.addEventListener('click', requestLock);
  renderer.domElement.addEventListener('click', requestLock);

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    clickLayer.classList.toggle('hidden', pointerLocked);
    if (!pointerLocked) keys.clear();
  });

  addEventListener('mousemove', e => {
    if (!pointerLocked) return;
    yaw   -= e.movementX * 0.0024;
    pitch -= e.movementY * 0.0024;
    pitch = Math.max(-0.45, Math.min(1.05, pitch));
  });
}

/* --------------------------------------------------------------------------
   Networking
   Star topology over WebRTC. The host is the hub: everyone sends their own
   state to it, and it rebroadcasts a combined snapshot. No server to run,
   but the room only lives as long as the host does.
   -------------------------------------------------------------------------- */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to read aloud

function makeCode() {
  let out = '';
  for (let i = 0; i < 5; i++)
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

const peerIdFor = code => `anon-room-${code}`;

function startHost(code) {
  return new Promise((resolve, reject) => {
    isHost = true;
    roomCode = code;
    peer = new Peer(peerIdFor(code));
    myId = 'host';

    peer.on('open', () => resolve());
    peer.on('error', err => reject(new Error(
      err.type === 'unavailable-id'
        ? 'That room code is already taken. Try creating another.'
        : `Network error: ${err.type}`
    )));

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

    const timer = setTimeout(
      () => reject(new Error('No room found with that code.')), 12000);

    peer.on('error', err => {
      clearTimeout(timer);
      reject(new Error(
        err.type === 'peer-unavailable'
          ? 'No room found with that code.'
          : `Network error: ${err.type}`
      ));
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
      conn.on('close', () => {
        netStatus.textContent = 'HOST LEFT';
        for (const a of remotes.values()) a.dispose();
        remotes.clear();
        renderRoster();
      });
    });
  });
}

function onHostMessage(conn, msg) {
  if (msg.t === 'hello') {
    ensureRemote(conn.peer, msg.name);
    renderRoster();
  } else if (msg.t === 'state') {
    const avatar = ensureRemote(conn.peer, msg.n);
    applyState(avatar, msg);
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

    if (mode === 'host') {
      loadText.textContent = 'Opening room…';
      await startHost(code);
    } else if (mode === 'join') {
      loadText.textContent = 'Joining room…';
      await startClient(code);
    }
  } catch (e) {
    console.error(e);
    loadError.textContent = e.message;
    loadText.textContent = 'Failed.';
    setTimeout(() => {
      loadScreen.classList.add('hidden');
      titleScreen.classList.remove('hidden');
      titleStatus.textContent = e.message.split('\n')[0];
    }, 2600);
    return;
  }

  local = new Avatar(myName, true);

  loadScreen.classList.add('hidden');
  clickLayer.classList.remove('hidden');
  el('hud').classList.remove('hidden');

  if (mode !== 'solo') {
    el('roomcode').textContent = roomCode;
    roomTag.classList.remove('hidden');
    netStatus.classList.remove('hidden');
    renderRoster();
  }

  renderer.setAnimationLoop(tick);
}

el('btn-solo').addEventListener('click', () => enterGame('solo'));
el('btn-host').addEventListener('click', () => enterGame('host', makeCode()));

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
