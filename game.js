import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MODELS, PROP_MODELS, toBuffer } from './assets.js';


/* ==========================================================================
   ANON — game logic
   ========================================================================== */


/* Printed on load and shown on the title screen, so it's obvious at a glance
   whether the browser is running current code or a cached copy. */
const BUILD = 'v42 climb';
console.log('ANON build:', BUILD);

/* The hip bone genuinely should rotate through a run — that motion is a lot
   of what makes the stride read as weight. Removing its yaw stops the body
   swinging left and right, but if the run ends up looking stiff, this is the
   switch to turn back off. */
const STRIP_HIP_YAW = true;

/* --------------------------------------------------------------------------
   Tuning
   -------------------------------------------------------------------------- */

const RUN_SPEED  = 6.4;
const TURN_SPEED = 7;
const ACCEL      = 13;

/* A thumb resting on a stick is never perfectly still, and the direction it
   reports changes a little every frame. Both the character's facing and its
   path are driven from a single smoothed heading so that jitter never reaches
   either. The deadzone is generous because the noise near the centre of the
   stick is proportionally largest there. */
const HEADING_SMOOTH = 12;
const STICK_DEADZONE = 0.18;

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
/* 0.62 rather than 0.45. The old figure plus the step height topped out at
   0.87m, which cleared a crate and nothing else — the 1.0m block and the
   1.1m barrel were unreachable, so half the catalog could not be climbed.
   Air time is fixed by the animation, so raising this raises gravity to
   match and the jump reads as snappier rather than floatier. */
const JUMP_HEIGHT = 0.62;

const LAUNCH_TIME    = CROUCH_END / JUMP_RATE;
const TOUCHDOWN_TIME = LAND_AT / JUMP_RATE;
const AIR_TIME       = TOUCHDOWN_TIME - LAUNCH_TIME;
const GRAVITY        = -8 * JUMP_HEIGHT / (AIR_TIME * AIR_TIME);
const JUMP_SPEED     = -GRAVITY * AIR_TIME / 2;

const JUMP_FADE_IN  = 20;
const JUMP_FADE_OUT = 7;

/* Look. 2 rather than 3: at 3 the blocks were large enough that the rounded
   limbs turned into visible staircases and the figure lost its shape, which
   is the opposite of the reference — that one is smooth enough to read as a
   solid form with only a hint of grid. Set to 1 for a clean render with no
   pixelation at all. */
const PIXEL_SIZE = 2;

/* Skins. Colour alone isn't enough to make a tinted metal read correctly:
   a fully metallic surface shows almost nothing but its reflections, so a red
   one just looks like grey with a blush. Each skin therefore carries its own
   metalness, letting the coloured ones keep enough diffuse to actually look
   red or green while Metal and Gold stay properly reflective.

   Roughness controls the size of the highlight. These sit around 0.2 — low
   enough that the sun still lands as a defined highlight rather than a smear,
   but not so low that it collapses to a hard dot. The reference has a broad
   soft sheen running down the arm and across the shoulder, which is a
   slightly rougher surface than a mirror. Raise to soften, lower to sharpen. */
const SKINS = [
  { id: 'metal',   name: 'Metal',   color: 0xa9b1bb, metal: 0.62, rough: 0.21 },
  { id: 'crimson', name: 'Crimson', color: 0xb42f2f, metal: 0.48, rough: 0.20 },
  { id: 'cobalt',  name: 'Cobalt',  color: 0x2a55c0, metal: 0.48, rough: 0.20 },
  { id: 'emerald', name: 'Emerald', color: 0x1d9160, metal: 0.48, rough: 0.20 },
  { id: 'gold',    name: 'Gold',    color: 0xd8a52c, metal: 0.78, rough: 0.19 },
  { id: 'dorfic',  name: 'Dorfic',  color: 0xdc6a24, metal: 0.50, rough: 0.20 }
];

/* How strongly the environment reflects off every skin.

   Deliberately low. RoomEnvironment is a big soft box of light, and leaning
   on it is what produced the smooth head-to-toe gradient with no highlight
   anywhere in particular — a broad source spreads its reflection over the
   whole surface. Most of the shine now comes from the sun instead, which is
   effectively a point and therefore leaves a small round highlight where it
   catches the curve of the head.

   Back up from 0.5, though. Cutting it that far crushed the shadow side of
   the body to near black, and the reference does not do that — its dark side
   still reads as a lit surface with the form visible in it. Some fill has to
   come from somewhere, and the environment is the natural place. */
const ENV_INTENSITY = 0.9;

/* Silhouette. Drawn as an inverted hull: a second copy of the model with its
   faces flipped and its vertices pushed out along their normals, so it is
   hidden behind the real model everywhere except around the edge. Cheap, and
   unlike a post-process edge filter it survives being rendered into a
   third-resolution buffer without breaking up.

   Width is in *buffer pixels*, not metres, and that is what stops the
   characters looking heavy. A hull expanded by a fixed distance in the world
   adds that distance to every part equally, so it lands as a fixed
   proportion of nothing: 2cm on a 25cm head is barely noticeable, but the
   same 2cm on a 12cm arm makes the arm a third thicker. Thin limbs fatten,
   the figure reads as padded, and moving closer to the camera makes it
   worse, since the same 2cm covers more of the screen.

   A pixel-width offset instead gives every part of the body the same one
   pixel of edge no matter its thickness or its distance, which reads as a
   drawn line rather than as mass. It also matches how the rest of the render
   behaves — one buffer pixel is one visible block. */
const OUTLINE_PIXELS = 0.85;

/* NDC covered by one buffer pixel, shared by every outline material and
   refreshed whenever the drawing buffer is resized. One object handing its
   value to all of them, so a resize is a single assignment. */
const outlinePixel = { value: new THREE.Vector2(0.002, 0.002) };

/* The outline takes its colour from the skin rather than being one flat near
   black. A single dark colour reads as a sticker cut out and laid behind the
   figure; a darkened version of the surface it borders reads as the surface
   turning away from the light, which is what an edge actually is.

   Derived rather than hand-picked per skin, so adding a skin needs nothing
   here. Hue is kept, lightness cut hard, and saturation pushed up slightly to
   compensate — dark colours read as washed out otherwise, and the gold in
   particular goes muddy brown without it. */
const OUTLINE_LIGHTNESS = 0.55;   // fraction of the skin's own lightness
const OUTLINE_SAT       = 1.25;

const outlineHSL = {};

/**
 * Darkens a skin colour into its outline.
 *
 * The HSL conversions are pinned to sRGB. Three stores colour linearly, and
 * scaling lightness in linear space is much weaker than it looks — a 0.35
 * multiplier there lands around 0.6 perceptually, which is nowhere near dark
 * enough to read as an edge.
 */
function outlineColorFor(hex) {
  const c = new THREE.Color(hex);
  c.getHSL(outlineHSL, THREE.SRGBColorSpace);

  c.setHSL(
    outlineHSL.h,
    Math.min(1, outlineHSL.s * OUTLINE_SAT),
    outlineHSL.l * OUTLINE_LIGHTNESS,
    THREE.SRGBColorSpace
  );

  return c;
}

let mySkin = 0;

const CAM_DISTANCE = 6.1;
const CAM_HEIGHT   = 1.35;
/* No follow smoothing constant: the camera is rigidly locked to the
   character, which is the only way to guarantee zero induced motion. */
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
const NET_TIMEOUT  = 3500;    // drop a silent peer after this long

const TAG_HEIGHT    = 2.15;   // starting height before the first measurement
const TAG_CLEARANCE = 0.28;   // gap between the top of the head and the label

/* The bubble does NOT hang off the measured tag height. Box3.setFromObject on
   a SkinnedMesh reports the *bind pose* geometry bounds — skinning is applied
   on the GPU and never reaches the CPU-side box — and on an FBX rig imported
   at centimetre scale that number comes back several times the visible height
   of the character. That is what was parking the bubble up in the sky. The
   head sits at a known height, so use it directly and stop measuring. */
const HEAD_TOP = 1.72;

const CHAT_MAX      = 150;    // characters per message
const CHAT_LIFETIME = 6500;   // how long a bubble stays up, in ms
const CHAT_COOLDOWN = 1200;   // minimum gap between messages, in ms
const CHAT_IDLE     = 10000;  // compose bar closes itself after this silence
const BUBBLE_GAP    = 0.42;   // how far the bubble floats above the name tag
const BUBBLE_STACK  = 4;      // messages kept on screen before the top one drops
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
let relockPointer = null;   // set once the renderer exists; see setupInput
let spaceWasDown = false;
let headingTarget = 0;   // smoothed steering direction, in radians

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
let reclaiming = false;
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

  await loadPropModels();
  measureProps();

  return out;
}

/**
 * Neutralises the clip's root motion.
 *
 * Mixamo bakes a character's travel into the root bone, so a run clip both
 * walks the model away from the origin and swings it side to side as the hips
 * rotate through each stride. The script drives position and facing itself, so
 * both have to be flattened here or they fight: the visible symptom is a
 * character that yaws back and forth while running, as the clip's rotation
 * adds to the direction the player is steering.
 *
 * Only the root is touched. Every other bone keeps its full animation, so the
 * lean and weight-shift that make the run look alive are preserved — this
 * removes the whole-body swivel, not the performance.
 */
/* Scratch objects for the quaternion surgery below. Allocating inside the
   per-keyframe loop would create thousands of throwaway objects per clip. */
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function lockRootMotion(clip) {
  /* Two different problems, two different treatments.

     The root bone carries the character's travel across the ground, and that
     is replaced wholesale by the movement code, so it gets frozen outright.

     The hip bone is subtler. It genuinely should rotate — a run cycle turns
     the hips through every stride, and that rotation is a lot of what makes
     the motion read as weight rather than a puppet sliding along. But its
     yaw stacks on top of the direction the player is steering, and the sum is
     a character that swings left and right as it runs. So only the yaw is
     removed; the lean and roll are left alone. Freezing the hip completely
     would fix the swing and flatten the run at the same time. */
  const boneOf = name => name.split('.')[0].replace(/^\.?bones\[|\]$/g, '');

  const LIMB = /(arm|leg|hand|foot|toe|head|neck|shoulder|clavicle|finger|thumb)/i;

  const isRoot = b => {
    const n = b.toLowerCase();
    return n === 'root' || n === 'armature';
  };

  const isHip = b => {
    const n = b.toLowerCase();
    return n === 'pelvis' || n === 'hips' || n.endsWith(':hips') || n === 'hip';
  };

  for (const track of clip.tracks) {
    const bone = boneOf(track.name);
    const v = track.values;

    if (track.name.endsWith('.position')) {
      // Hold horizontal travel at frame one. Vertical stays, since that is
      // what gives the jump its arc.
      for (let i = 0; i < v.length; i += 3) {
        v[i] = v[0];
        v[i + 2] = v[2];
      }
      continue;
    }

    if (!track.name.endsWith('.quaternion') || LIMB.test(bone)) continue;

    if (isRoot(bone)) {
      for (let i = 0; i < v.length; i += 4) {
        v[i]     = v[0];
        v[i + 1] = v[1];
        v[i + 2] = v[2];
        v[i + 3] = v[3];
      }
    } else if (isHip(bone) && STRIP_HIP_YAW) {
      for (let i = 0; i < v.length; i += 4) {
        _q.set(v[i], v[i + 1], v[i + 2], v[i + 3]);

        // YXZ puts yaw first, so zeroing y removes the turn and leaves the
        // forward lean and side roll intact.
        _e.setFromQuaternion(_q, 'YXZ');
        _e.y = 0;
        _q.setFromEuler(_e);

        v[i]     = _q.x;
        v[i + 1] = _q.y;
        v[i + 2] = _q.z;
        v[i + 3] = _q.w;
      }
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

  /* Ambient fill, kept low. A bright hemisphere lights every surface from
     every direction at once, which is exactly what washes a highlight out —
     it raises the floor until the bright spot has nothing to be bright
     against. */
  scene.add(new THREE.HemisphereLight(0xe4eefb, 0x7a7466, 0.85));

  /* The sun does most of the work now, and it is the thing making the round
     highlight on the head. A directional light is a single direction, so on
     a low-roughness curved surface its reflection is a small disc rather
     than a spread. */
  sun = new THREE.DirectionalLight(0xfff4e2, 3.0);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  const s = 30;
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
  const w = Math.max(1, Math.floor(innerWidth / PIXEL_SIZE));
  const h = Math.max(1, Math.floor(innerHeight / PIXEL_SIZE));

  renderer.setSize(w, h, false);
  labelRenderer.setSize(innerWidth, innerHeight);

  /* NDC spans -1 to 1, so one buffer pixel is 2/size. Outlines read this to
     hold a constant pixel width; without the update they would change
     thickness whenever the window resized. */
  outlinePixel.value.set(2 / w, 2 / h);
}

/* --------------------------------------------------------------------------
   Speech bubbles

   Drawn to a small offscreen canvas and shown as a sprite in the world, not
   as an HTML overlay. That is the whole point: the scene renders at a
   fraction of screen resolution and is scaled back up with nearest-neighbour
   filtering, so anything living inside it inherits the chunky pixel grid.
   A DOM bubble would float above that, crisp and smooth, and look pasted on.

   The canvas is deliberately small — roughly one texel per rendered pixel —
   and filtered with NearestFilter so nothing is ever smoothed.
   -------------------------------------------------------------------------- */


/* --------------------------------------------------------------------------
   Speech bubbles

   Real DOM on the CSS2D layer, not a canvas sprite in the world.

   The earlier version drew to a texture and showed it as a sprite, on the
   argument that a bubble living outside the low-resolution buffer would look
   pasted on. That argument loses to legibility. A sprite is composited into
   the same buffer as everything else and then scaled up with nearest
   filtering, so its text can never be sharper than the buffer — at
   PIXEL_SIZE 3 a 12px glyph gets four pixels of height to work with and
   stops being readable. No amount of texture resolution helps, because the
   ceiling is the buffer, not the texture.

   Moving to DOM lifts that ceiling entirely and decouples the two knobs: the
   world can get as chunky as you like without touching the chat. The name
   tags already work this way for exactly the same reason.

   Layout note. The CSS2DObject's centre is set to (0.5, 1), which pins the
   bottom edge of the column to the anchor point rather than its middle. New
   messages are appended last, so they land at the bottom against the head
   and everything already there is pushed up — the stacking falls out of
   normal document flow, with no per-bubble positioning maths at all.
   -------------------------------------------------------------------------- */

/**
 * The column of bubbles over one character.
 *
 * Each message is its own element with its own expiry, so the column drains
 * from the top in the order it filled.
 */
class BubbleStack {
  constructor(group) {
    /* Two elements, because CSS2DRenderer overwrites the transform of the
       element it owns every frame. The outer one is the renderer's; the inner
       one is ours to scale for the distance falloff. */
    this.root = document.createElement('div');
    this.root.className = 'bubble-anchor';

    this.col = document.createElement('div');
    this.col.className = 'bubble-col';
    this.root.appendChild(this.col);

    this.object = new CSS2DObject(this.root);
    this.object.center.set(0.5, 1);   // anchor the bottom edge, not the middle
    group.add(this.object);

    this.list = [];          // [{ el, expires }] oldest first
    this.typingEl = null;
    this.baseY = 0;
  }

  push(text) {
    // A real message outranks the dots.
    this.clearTyping();

    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;

    // Appended last, so it renders at the bottom of the column.
    this.col.appendChild(el);
    this.list.push({ el, expires: performance.now() + CHAT_LIFETIME });

    // Past the cap the top one goes immediately, so the column never runs off
    // the top of the screen no matter how fast someone talks.
    while (this.list.length > BUBBLE_STACK) this.list.shift().el.remove();
  }

  setTyping(on) {
    if (!on) { this.clearTyping(); return; }
    if (this.typingEl || this.list.length) return;

    const el = document.createElement('div');
    el.className = 'bubble typing';
    el.innerHTML = '<i></i><i></i><i></i>';

    this.col.appendChild(el);
    this.typingEl = el;
  }

  clearTyping() {
    if (!this.typingEl) return;
    this.typingEl.remove();
    this.typingEl = null;
  }

  /** Retires expired bubbles. The dots animate in CSS and need nothing here. */
  update() {
    const now = performance.now();

    // Oldest first, so the column drains from the top downward.
    while (this.list.length && this.list[0].expires <= now) {
      this.list.shift().el.remove();
    }
  }

  setBaseY(y) {
    if (y === this.baseY) return;
    this.baseY = y;
    this.object.position.y = y;
  }

  /**
   * Fade and shrink with distance. CSS2D elements do not shrink with
   * perspective, so without this a bubble across the map stays full size and
   * ends up bigger on screen than the player who said it.
   */
  setFalloff(t) {
    const opacity = 1 - t * 0.75;
    const scale = 1 - t * 0.3;

    this.col.style.opacity = opacity.toFixed(2);
    this.col.style.transform = `scale(${scale.toFixed(2)})`;
  }

  dispose() {
    this.root.remove();
    this.object.removeFromParent();
    this.list.length = 0;
    this.typingEl = null;
  }
}

/* --------------------------------------------------------------------------
   Sound

   Synthesised rather than sampled. Three reasons, in order of weight:

   1. A footstep library is a few hundred KB of audio for what amounts to a
      noise burst and a thump. assets.js is already 1.1 MB and there is no
      good argument for making the download heavier for this.
   2. Synthesis is varied for free. The single worst failure of game
      footsteps is the machine-gun effect — the same file retriggering at a
      fixed interval until it reads as a loop rather than as a person. Every
      step here is built fresh with its own filter colour, pitch and noise
      offset, and left and right feet are deliberately different.
   3. It matches the look. The world is deliberately low-fidelity; a
      photoreal boot on gravel would sit oddly against it.

   Timing comes from the run clip's own playhead — see stepFootsteps. That
   keeps the sound locked to the visible legs at every speed, and works for
   remote avatars unchanged, since their mixer runs the same clip at a rate
   derived from the speed in their packets.
   -------------------------------------------------------------------------- */

/* Where in the run cycle the feet actually touch down. The clip's start frame
   is whatever the animator happened to export, so if the sound lands slightly
   off the visible footfall, nudge this — 0 to 1 walks the timing right
   through one full cycle. */
const FOOT_PHASE     = 0;

const STEP_MIN_SPEED = 0.9;    // below this the character is shuffling, not walking
const SFX_VOLUME     = 0.55;   // master trim
const SFX_REF        = 6;      // metres at which a sound is at half gain
const SFX_RANGE      = 42;     // past this, skip the sound entirely

const sfxDir = new THREE.Vector3();
const sfxRight = new THREE.Vector3();

const sfx = {
  ctx: null,
  master: null,
  noise: null,
  muted: false,

  /**
   * Browsers refuse to start an AudioContext outside a user gesture, so this
   * is called from the first click or keypress rather than at load.
   */
  init() {
    if (this.ctx) return;

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;                   // no Web Audio: the game just stays silent

    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : SFX_VOLUME;
    this.master.connect(this.ctx.destination);

    /* One second of white noise, generated once and replayed from a random
       offset each time. Rebuilding a buffer per footstep would allocate
       thousands of times a minute for a sound nobody could tell apart. */
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  },

  /** A tab switch suspends the context; this brings it back. */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setMuted(on) {
    this.muted = !!on;
    if (this.master) this.master.gain.value = this.muted ? 0 : SFX_VOLUME;
  },

  /**
   * Opens a per-sound chain placed relative to the camera, or returns null if
   * the source is muted, too far away, or the context never started.
   *
   * Distance and panning are done by hand rather than with a PannerNode. A
   * panner needs the AudioListener kept in sync with the camera every frame,
   * and for sounds this short the difference is inaudible next to a plain
   * gain and a stereo pan.
   */
  begin(pos) {
    if (!this.ctx || this.muted) return null;

    const dist = camera.position.distanceTo(pos);
    if (dist > SFX_RANGE) return null;

    const ctx = this.ctx;
    const gain = ctx.createGain();

    // Inverse-square-ish falloff, which drops off convincingly without ever
    // hitting zero abruptly the way linear distance does.
    const k = dist / SFX_REF;
    gain.gain.value = 1 / (1 + k * k);

    let head = gain;

    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();

      sfxDir.subVectors(pos, camera.position).normalize();
      sfxRight.setFromMatrixColumn(camera.matrixWorld, 0);

      /* Eased out at close range. Your own feet are roughly under the camera,
         where the direction vector is unstable and a small sidestep would
         otherwise slam the sound hard into one ear. */
      const spread = Math.min(1, dist / 3);
      pan.pan.value = THREE.MathUtils.clamp(sfxDir.dot(sfxRight), -1, 1) * spread;

      gain.connect(pan);
      head = pan;
    }

    head.connect(this.master);
    return { ctx, out: gain, t: ctx.currentTime };
  },

  /**
   * One footfall. Two layers: a filtered noise burst for the scuff of the
   * surface, and a fast pitch-dropping sine underneath for the weight.
   * Neither alone is convincing — noise on its own sounds like static, and
   * the sine on its own sounds like a drum.
   *
   * `right` alternates the feet and `intensity` is 0..1 by speed.
   */
  footstep(pos, right, intensity) {
    const c = this.begin(pos);
    if (!c) return;

    const { ctx, out, t } = c;
    const level = 0.45 + intensity * 0.55;

    // Scuff.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';

    // Left and right sit in slightly different places, then jitter on top.
    // Identical consecutive steps are what produce the machine-gun effect.
    bp.frequency.value = (right ? 1400 : 1150) * (0.9 + Math.random() * 0.2);
    bp.Q.value = 0.9;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);

    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);   // random offset, so no repeated grain
    src.stop(t + 0.13);

    // Weight.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 * (0.95 + Math.random() * 0.1), t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);

    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.3 * level, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.11);
  },

  /** Touchdown. The same shape as a footstep, heavier and slower to decay. */
  land(pos) {
    const c = this.begin(pos);
    if (!c) return;

    const { ctx, out, t } = c;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);

    src.connect(lp).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.24);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.14);

    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
  },

  /** Launch. Brief and quiet — the landing is the one that should land. */
  jump(pos) {
    const c = this.begin(pos);
    if (!c) return;

    const { ctx, out, t } = c;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1.2;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.09);
    bp.Q.value = 1.1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);

    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.12);
  }
};


/* --------------------------------------------------------------------------
   Avatar
   Wraps one character instance: model, mixer, animation weights, name tag.
   The same class drives the local player and every remote one; only who sets
   its position differs.
   -------------------------------------------------------------------------- */

/**
 * Builds the inverted-hull outline material.
 *
 * The offset is applied in clip space, after projection, which is what makes
 * the width a screen measurement rather than a world one. Doing it earlier —
 * in object space or view space — ties the thickness to the model's own size
 * and to its distance from the camera, and that is what made the characters
 * look padded.
 *
 * Object space is worse still, and worth naming because it was the first
 * attempt: it is not a fixed unit at all. The FBX carries its own authoring
 * scale, the loader applies another, the model is normalised to 1.8m tall,
 * and a skinned mesh multiplies in the bind matrix on top — so an offset
 * written there arrives multiplied by the product of all of them.
 */
function makeOutlineMaterial(pixels) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,            // placeholder — setSkin drives this
    side: THREE.BackSide,       // only the far faces survive, hence a shell
    fog: true                   // so distant outlines recede with everything else
  });

  const px = pixels.toFixed(3);

  mat.onBeforeCompile = shader => {
    // The same uniform object every outline shares, so one resize updates all.
    shader.uniforms.uOutlinePixel = outlinePixel;

    shader.vertexShader = 'uniform vec2 uOutlinePixel;\n' + shader.vertexShader;

    /* Replacing project_vertex outright rather than appending to it, since
       the offset has to land after the projection. mvPosition is redeclared
       here because the fog varying downstream still reads it. */
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec3 outlineNormal;

      #if defined( USE_ENVMAP ) || defined( USE_SKINNING )
        /* transformedNormal is the skinned normal already in view space,
           which is what a deforming character needs. BackSide sets
           FLIP_SIDED, and three has flipped it to match — undo that, or the
           shell would be pulled inward and vanish. */
        outlineNormal = normalize( transformedNormal );
        #ifdef FLIP_SIDED
          outlineNormal = - outlineNormal;
        #endif
      #else
        outlineNormal = normalize( normalMatrix * normal );
      #endif

      vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
      vec4 clipPos = projectionMatrix * mvPosition;

      /* The normal carried through the projection, which gives the direction
         the edge runs on screen. Only xy matters; pushing along z would move
         the shell toward or away from the camera and break the depth test
         that hides it behind the body. */
      vec3 clipNormal = normalize( ( projectionMatrix * vec4( outlineNormal, 0.0 ) ).xyz );

      /* Scaled by w, which is what converts a screen-space offset back into
         clip space. Without it the outline would shrink with distance like a
         world-space one and the whole point would be lost. */
      clipPos.xy += clipNormal.xy * clipPos.w * uOutlinePixel * ${px};

      gl_Position = clipPos;
      `
    );
  };

  // Without this three would reuse the plain MeshBasicMaterial program and
  // the injection above would silently do nothing.
  mat.customProgramCacheKey = () => 'outline' + px;

  return mat;
}

/** Adds a shell sibling for every mesh under `root`. */
function buildOutline(root, material) {
  const sources = [];
  root.traverse(o => { if (o.isMesh || o.isSkinnedMesh) sources.push(o); });

  for (const src of sources) {
    let shell;

    if (src.isSkinnedMesh) {
      shell = new THREE.SkinnedMesh(src.geometry, material);
      shell.bindMode = src.bindMode;

      /* Share the skeleton rather than cloning it. The shell has to be bound
         with the same matrix as the source, or it animates from a different
         rest pose and swims around inside the character. */
      shell.bind(src.skeleton, src.bindMatrix);
    } else {
      shell = new THREE.Mesh(src.geometry, material);
    }

    shell.position.copy(src.position);
    shell.quaternion.copy(src.quaternion);
    shell.scale.copy(src.scale);

    /* Invisible to picking. The shell sits a pixel outside the real mesh, so
       without this it would be the first thing the grab ray hit. */
    shell.raycast = () => {};

    // The real mesh already casts the shadow; a second one at the same place
    // would only thicken and darken it.
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.frustumCulled = false;

    src.parent.add(shell);
  }
}

class Avatar {
  constructor(name, isLocal, skin = 0) {
    this.isLocal = isLocal;
    this.name = name;
    this.skin = -1;

    // cloneSkinned rebinds the skeleton properly; a plain .clone() would leave
    // every copy sharing one skeleton and animating in lockstep.
    const model = cloneSkinned(assets.character);

    // One material per avatar rather than one shared between them, or every
    // player in the room would change colour together.
    this.material = new THREE.MeshStandardMaterial({ envMapIntensity: ENV_INTENSITY });

    model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;   // skinned bounds go stale during animation
        o.material = this.material;
      }
    });

    /* After the traverse above, or that traverse would find the shells and
       overwrite their outline material with the body's. Before setSkin, so
       there is something for the skin to colour. Set OUTLINE_PIXELS to 0 to
       skip outlines entirely. */
    if (OUTLINE_PIXELS > 0) {
      this.outlineMaterial = makeOutlineMaterial(OUTLINE_PIXELS);
      buildOutline(model, this.outlineMaterial);
    }

    this.setSkin(skin);

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
    this.animRate = RUN_ANIM_MIN;
    this.velY = 0;
    this.grounded = true;
    this.jumpPhase = 'none';
    this.jumpClock = 0;
    this.jumpBlend = 0;
    this.floorY = 0;          // surface under the feet; props raise it

    // Footstep state. footHalf is which half of the run cycle the playhead
    // was in last frame; a change is a footfall.
    this.footHalf = -1;
    this.footRight = false;

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

  /** Lazily creates the column; most players never say anything. */
  ensureBubble() {
    if (!this.bubbleObj) this.bubbleObj = new BubbleStack(this.group);
    return this.bubbleObj;
  }

  /**
   * Adds a line of chat. Each message is its own bubble: the new one appears
   * at the bottom, against the head, and whatever was already said rises to
   * sit above it. Every bubble ages out on its own clock, so the column
   * drains from the top in the order it filled.
   */
  say(text) {
    const msg = String(text).slice(0, CHAT_MAX).trim();
    if (!msg) return;

    this.typing = false;
    this.ensureBubble().push(msg);
  }

  /** The three animated dots, shown while someone is composing. */
  setTyping(on) {
    this.typing = !!on;
    this.ensureBubble().setTyping(this.typing);
  }

  setSkin(index) {
    const i = (index | 0) % SKINS.length;
    if (i === this.skin) return;

    this.skin = i;
    const s = SKINS[i];
    this.material.color.setHex(s.color);
    this.material.metalness = s.metal;
    this.material.roughness = s.rough;
    this.material.needsUpdate = true;

    // Guarded, because a skin can be set before the outline exists and can
    // also be changed at any point afterwards from the title screen.
    if (this.outlineMaterial) {
      this.outlineMaterial.color.copy(outlineColorFor(s.color));
    }
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
        sfx.jump(this.group.position);
      }

      if (this.jumpClock >= this.jumpDuration ||
         (this.grounded && this.jumpClock > TOUCHDOWN_TIME + 0.25)) {
        this.jumpPhase = 'none';
      }
    }

    /* The ground is no longer always y=0. floorY is whatever surface is
       currently under the feet — the world, or the top of a prop — and is
       recomputed each frame before this runs. */
    const floorY = this.floorY || 0;

    // Gravity only while airborne — applying it on the ground makes the
    // character sink and get clamped every frame, which feeds jitter upward.
    if (!this.grounded) {
      this.velY += GRAVITY * dt;
      this.group.position.y += this.velY * dt;

      if (this.group.position.y <= floorY) {
        this.group.position.y = floorY;
        this.velY = 0;
        this.grounded = true;
        sfx.land(this.group.position);
      }
    } else if (this.group.position.y > floorY + 0.02) {
      // The prop you were standing on moved or was deleted. Start falling
      // rather than hanging in the air where it used to be.
      this.grounded = false;
    } else {
      // Riding a surface that rose under you — a carried prop lifted from
      // below. Follow it rather than clipping through.
      this.group.position.y = floorY;
    }
  }

  /** Blends idle/run by speed, with the jump clip layered over the top. */
  stepAnimation(dt) {
    const target = this.jumpPhase === 'active' ? 1 : 0;
    const rate = target > this.jumpBlend ? JUMP_FADE_IN : JUMP_FADE_OUT;
    this.jumpBlend += (target - this.jumpBlend) * (1 - Math.exp(-rate * dt));

    const blend = Math.min(1, this.speed / RUN_SPEED);
    const loco = 1 - this.jumpBlend;

    /* Cadence follows speed, but through its own smoothing. Driving playback
       rate straight from instantaneous speed makes the clip speed up and slow
       down every frame as the thumb moves, which shows up as the legs
       stuttering even when the character is travelling smoothly. */
    const rateTarget = Math.max(RUN_ANIM_MIN,
      Math.min(RUN_ANIM_MAX, blend * RUN_ANIM_RATE));

    this.animRate += (rateTarget - this.animRate) * (1 - Math.exp(-4 * dt));
    this.actions.run.timeScale = this.animRate;

    this.actions.idle.setEffectiveWeight((1 - blend) * loco);
    this.actions.run.setEffectiveWeight(blend * loco);
    this.actions.jump.setEffectiveWeight(this.jumpBlend);

    this.mixer.update(dt);
  }

  /**
   * Fires a footstep twice per run cycle, read off the clip's own playhead.
   *
   * Distance travelled was the obvious alternative and is worse: the run
   * clip's playback rate already scales with speed, so a fixed stride length
   * drifts against the legs and the sound slowly desynchronises from the
   * visible footfalls. Reading the clip phase means the cadence is correct at
   * every speed by construction, with nothing to tune. It works for remote
   * avatars too, since their mixer runs the same clip at a rate derived from
   * the speed in their packets.
   *
   * The clip keeps playing at weight zero when the character stops, so the
   * speed and ground checks are what stop a stationary figure tapping its
   * feet.
   */
  stepFootsteps() {
    if (!this.grounded || this.jumpPhase === 'active') return;
    if (this.speed < STEP_MIN_SPEED) return;

    const run = this.actions.run;
    const dur = run.getClip().duration;
    if (!dur) return;

    // Two contacts per cycle. Which half of the cycle the playhead is in is
    // all this needs — no wrap handling, since a change in either direction
    // is a new step.
    const phase = (run.time / dur + FOOT_PHASE) % 1;
    const half = phase < 0.5 ? 0 : 1;

    if (half === this.footHalf) return;
    this.footHalf = half;

    this.footRight = !this.footRight;
    sfx.footstep(this.group.position, this.footRight,
                 Math.min(1, this.speed / RUN_SPEED));
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
    this.stepFootsteps();
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
    // Distance falloff is shared by the tag and the bubble, and the bubble
    // needs it even for the local player, who has no tag at all.
    const dist = camera.position.distanceTo(this.group.position);
    const t = Math.min(1, Math.max(0,
      (dist - TAG_FADE_NEAR) / (TAG_FADE_FAR - TAG_FADE_NEAR)));

    // The bubble rides above the tag, and needs tracking either way.
    if (this.bubbleObj) {
      // Fixed height, not this.tagY — see HEAD_TOP. A remote player carries a
      // name tag under the bubble, so theirs needs the extra clearance.
      this.bubbleObj.setBaseY(
        HEAD_TOP + (this.tag ? TAG_CLEARANCE + BUBBLE_GAP : BUBBLE_GAP * 0.4));
      this.bubbleObj.update();
      this.bubbleObj.setFalloff(t);

      // Once the last bubble has aged out, fall back to the dots if they have
      // already started composing the next message.
      if (this.typing) this.bubbleObj.setTyping(true);
    }

    if (!this.tag) {
      // Still measure, so a local player's bubble clears their own head.
      this.tagClock += dt;
      if (this.tagClock > 0.08) {
        this.tagClock = 0;
        tagBox.setFromObject(this.model);
        const top = tagBox.max.y - this.group.position.y;
        if (Number.isFinite(top)) this.tagY = top + TAG_CLEARANCE;
      }
      return;
    }

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
    const opacity = 1 - t * 0.82;
    const scale = 1 - t * 0.34;

    this.tagEl.style.opacity = opacity.toFixed(2);
    this.tagEl.style.transform = `translateY(-4px) scale(${scale.toFixed(2)})`;
  }

  dispose() {
    if (this.bubbleObj) this.bubbleObj.dispose();
    if (this.tag) this.tag.element.remove();
    if (this.outlineMaterial) this.outlineMaterial.dispose();
    this.material.dispose();
    scene.remove(this.group);
  }
}

/* --------------------------------------------------------------------------
   Local movement
   -------------------------------------------------------------------------- */

const forward = new THREE.Vector3();
const right   = new THREE.Vector3();
const move    = new THREE.Vector3();
const travel  = new THREE.Vector3();

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
    if (mag > STICK_DEADZONE) {
      move.set(0, 0, 0);
      move.addScaledVector(right, stick.x);
      move.addScaledVector(forward, -stick.y);   // screen-up is forward
      throttle = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    } else {
      throttle = 0;
    }
  }

  const moving = throttle > 0 && move.lengthSq() > 0.0001;
  if (moving) move.normalize();

  /* One heading drives both facing and travel.
   *
   * A thumb on a stick is never still, so the raw input direction jitters a
   * few degrees every frame. Steering the character's *path* with that makes
   * it weave from side to side — the wobble that reads as the character
   * shaking while it runs. Smoothing only the facing, as an earlier version
   * did, fixes how it looks while leaving the path just as noisy.
   *
   * So the input sets a heading, the heading is smoothed once, and everything
   * downstream uses it. The character travels exactly where it points. */
  if (moving) {
    const want = Math.atan2(move.x, move.z);

    let d = want - headingTarget;
    while (d >  Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;

    headingTarget += d * (1 - Math.exp(-HEADING_SMOOTH * dt));
  }

  const target = moving ? RUN_SPEED * throttle : 0;
  local.speed += (target - local.speed) * Math.min(1, dt * ACCEL);

  travel.set(Math.sin(headingTarget), 0, Math.cos(headingTarget));
  local.group.position.addScaledVector(travel, local.speed * dt);

  // Facing eases onto the same heading, a touch slower, which reads as the
  // body leaning into a turn rather than pivoting on the spot.
  let diff = headingTarget - local.group.rotation.y;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  local.group.rotation.y += diff * (1 - Math.exp(-TURN_SPEED * dt));

  // Edge-triggered jump: holding or hammering space cannot restart the clip.
  const down = keys.has('Space');
  if (down && !spaceWasDown) local.startJump();
  spaceWasDown = down;

  // Before gravity, so stepJump has this frame's floor height to clamp to.
  resolveCollisions(local);

  local.stepJump(dt);
  local.stepAnimation(dt);
  local.stepFootsteps();
  local.stepTag(dt);
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

  // Rigid follow. Any easing here means the character drifts around the frame
  // as it accelerates and stops, which at low render resolution reads as the
  // whole view juddering.
  followPos.set(p.x, 0, p.z);

  // Height is a separate anchor that freezes mid-air, so jumping moves the
  // character up through frame without moving the camera at all.
  const anchorRate = local.grounded ? 12 : 0;
  camAnchorY += (p.y - camAnchorY) * (1 - Math.exp(-anchorRate * dt));

  if (!camReady) {
    camAnchorY = p.y;
    camReady = true;
  }

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
   The Internet

   A spawn menu and the props it spawns.

   Two kinds of entry live in the same catalog. A `geo` entry builds its shape
   from a three primitive, and a `model` entry names a key in PROP_MODELS —
   base64 FBX sitting next to the character data. Everything downstream is
   identical, so adding a real model later is a base64 blob plus one line
   here, with no changes to spawning, networking or grabbing.

   Props need nothing special to match the world's look. The pixelation is a
   property of the render buffer, not of any material, so anything added to
   the scene is downsampled with everything else. The outline is per-object
   and is applied here.

   No physics engine. Props sit where they are put and can be carried, turned
   and deleted; nothing falls, collides or stacks. That is a deliberate
   stopping point rather than an oversight — a solver is a large dependency
   and a much larger networking problem, since every client then has to agree
   on a simulation rather than on a list of positions. The spawn, ownership
   and sync layers below are the part that a solver would need underneath it,
   so adding one later does not mean redoing this.
   -------------------------------------------------------------------------- */

/* Live world state. Insertion order matters: the cap below evicts the oldest. */
const props = new Map();     // id -> { id, kind, def, group, material, outlineMaterial }
let propSeq = 0;             // only the authority mints ids
let heldProp = null;
let heldDist = 3;
let internetOpen = false;

/** Sends to every client except one, for a host relaying someone's action. */
function broadcastToClients(packet, except) {
  for (const [id, c] of connections) {
    if (id !== except && c.open) c.send(packet);
  }
}

function sendToHost(packet) {
  const conn = connections.get('host');
  if (conn && conn.open) conn.send(packet);
}

/* Parsed prop models, filled during loading. */
const propModels = {};

/**
 * The catalog.
 *
 * A `geo` entry builds its shape from a three primitive and takes a flat
 * colour. A `model` entry names a key in PROP_MODELS — base64 glTF alongside
 * the character data — and keeps the materials the artist exported, since a
 * textured model has no single base colour to tint.
 *
 * `collider` picks what the player and other props bump into: 'sphere' for
 * balls, 'cylinder' for anything round in plan — barrels, columns, cones —
 * 'box' for actual boxes, 'none' to pass through. Getting this wrong is very
 * noticeable: a box around a barrel puts its corners 41% past the visible
 * edge, so the player shoves it from a gap where nothing is drawn. Everything else —
 * resting height, mass, bounding radius — is measured from the built object,
 * so nothing here needs hand-tuning to sit on the ground correctly.
 */
const PROPS = [
  { id: 'crate',  name: 'Crate',  color: 0x9a7040, metal: 0.15, rough: 0.72,
    collider: 'box',    geo: () => new THREE.BoxGeometry(0.8, 0.8, 0.8) },

  { id: 'ball',   name: 'Ball',   color: 0xc23b3b, metal: 0.3,  rough: 0.35,
    collider: 'sphere', geo: () => new THREE.SphereGeometry(0.45, 20, 14) },

  { id: 'barrel', name: 'Barrel', color: 0x3f7a52, metal: 0.45, rough: 0.4,
    collider: 'cylinder', geo: () => new THREE.CylinderGeometry(0.4, 0.4, 1.1, 18) },

  { id: 'plank',  name: 'Plank',  color: 0xa8874f, metal: 0.1,  rough: 0.8,
    collider: 'box',    geo: () => new THREE.BoxGeometry(2.4, 0.14, 0.55) },

  { id: 'column', name: 'Column', color: 0xb9bcc2, metal: 0.5,  rough: 0.45,
    collider: 'cylinder', geo: () => new THREE.CylinderGeometry(0.3, 0.3, 2.4, 16) },

  { id: 'cone',   name: 'Cone',   color: 0xe07a24, metal: 0.25, rough: 0.5,
    collider: 'cylinder', geo: () => new THREE.ConeGeometry(0.45, 1.0, 16) },

  { id: 'marble', name: 'Marble', color: 0x7a5ab8, metal: 0.55, rough: 0.2,
    collider: 'sphere', geo: () => new THREE.SphereGeometry(0.22, 16, 12) },

  { id: 'boulder', name: 'Boulder', color: 0x6d7078, metal: 0.2, rough: 0.85,
    collider: 'sphere', geo: () => new THREE.SphereGeometry(1.1, 18, 14) },

  { id: 'block',  name: 'Block',  color: 0x5b6470, metal: 0.55, rough: 0.35,
    collider: 'box',    geo: () => new THREE.BoxGeometry(2.0, 1.0, 2.0) },

  { id: 'ring',   name: 'Ring',   color: 0xd8a52c, metal: 0.78, rough: 0.25,
    collider: 'cylinder', geo: () => new THREE.TorusGeometry(0.5, 0.16, 12, 28) },

  { id: 'wedge',  name: 'Wedge',  color: 0x2a7fb8, metal: 0.4,  rough: 0.4,
    collider: 'box',    geo: () => wedgeGeometry(1.6, 0.7, 1.2) }
];

/** A right-angled ramp. Built by hand, since three has no wedge primitive. */
function wedgeGeometry(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;

  const v = [
    // sloped face
    -x, -y,  z,   x, -y,  z,   x,  y, -z,
    -x, -y,  z,   x,  y, -z,  -x,  y, -z,
    // base
    -x, -y,  z,  -x, -y, -z,   x, -y, -z,
    -x, -y,  z,   x, -y, -z,   x, -y,  z,
    // back
    -x, -y, -z,  -x,  y, -z,   x,  y, -z,
    -x, -y, -z,   x,  y, -z,   x, -y, -z,
    // left side
    -x, -y,  z,  -x,  y, -z,  -x, -y, -z,
    // right side
     x, -y,  z,   x, -y, -z,   x,  y, -z
  ];

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const PROP_BY_ID = new Map(PROPS.map(p => [p.id, p]));

const PROP_LIMIT   = 60;    // total props in the world before the oldest goes
/* All three are measured from the character, not from the camera.

   That distinction is the whole bug this replaced. The aim ray starts at the
   camera, which sits CAM_DISTANCE behind the player, so a prop three metres
   in front of them is over nine metres along the ray. Comparing that against
   a six-metre reach meant nothing was ever grabbable and the mouse button
   looked dead. */
const PROP_REACH    = 7;    // how far away a prop can be picked up, in metres
const PROP_HOLD_MIN = 1.8;  // nearest a carried prop can be pulled
const PROP_HOLD_MAX = 6.5;
const PROP_NET_HZ  = 15;    // authority transform broadcasts per second

/* Spawning. The cooldown is the anti-spam measure; the cap is the backstop
   for someone who waits it out sixty times. */
const SPAWN_COOLDOWN = 900;   // ms between spawns from one player
const SPAWN_NEAR     = 2.2;   // closest a prop lands to you
const SPAWN_FAR      = 4.6;
const SPAWN_ARC      = 1.7;   // radians of scatter across your facing
const SPAWN_TRIES    = 14;    // attempts to find a spot clear of other props

/* Physics. Not a general solver — a small integrator with a few contact
   cases, which is enough for props that roll, settle and get shoved around,
   and far less than a real engine would cost to add and to network.

   Mass comes from volume, so size is what decides whether something budges.
   PLAYER_MASS is what everything is shoved relative to: a prop of the same
   mass as the player splits a push evenly, one twice as heavy takes a third
   of it. */
const PROP_DENSITY   = 1.0;
const PLAYER_MASS    = 1.6;
const PUSH_GAIN      = 1.15;  // target prop speed as a multiple of yours
const PROP_GRAVITY   = -20;
const PROP_BOUNCE    = 0.32;  // how much of an impact is returned on landing
const PROP_ROLL_DRAG = 0.55;  // ground friction, per second
const PROP_AIR_DRAG  = 0.12;
const PROP_SLEEP     = 0.06;  // speed below which a prop stops simulating
const PROP_SPIN_DRAG = 0.9;   // tumble damping in the air, per second
const PROP_LAND_DRAG = 6.0;   // and on the ground, where it should settle fast
const TUMBLE_GAIN    = 1.0;   // how much spin a throw imparts
const TUMBLE_MAX     = 14;    // rad/s, or a flicked marble becomes a blur
/* Flinging. A release only throws if the prop was actually moving when it
   was let go — below FLING_MIN it drops on the spot. Without that floor every
   release would launch things slightly, and putting a prop down carefully
   would be impossible.

   Mass reaches the throw twice over, and both are wanted. Once here, and once
   before that in stepHeldProp, where a heavy prop follows the aim more slowly
   and so is already moving less when released. The result is that size
   decides how far something flies without either term being tuned for it. */
const FLING_MIN      = 2.4;   // m/s of prop movement below which it just drops
const FLING_GAIN     = 1.6;
const FLING_MASS_REF = 2.2;   // mass at which a fling keeps about half its power

/**
 * Parses the glTF props during the loading screen.
 *
 * Draco is why this needs a decoder rather than just a loader. The exports
 * are compressed with KHR_draco_mesh_compression, which glTF marks as
 * *required* — a viewer without the decoder is expected to refuse the file
 * rather than fall back, so without this the model would fail outright.
 * The decoder is fetched from the same CDN as three itself, on first use
 * only, so an export with no Draco in it costs nothing.
 *
 * parse() takes an ArrayBuffer and is callback-based rather than promise-
 * based, hence the wrapper.
 */
async function loadPropModels() {
  const keys = Object.keys(PROP_MODELS);
  if (!keys.length) return;

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  for (const key of keys) {
    loadText.textContent = `Unpacking ${key}\u2026`;
    await new Promise(r => setTimeout(r, 0));

    const buffer = toBuffer(PROP_MODELS[key]);

    try {
      propModels[key] = await new Promise((resolve, reject) => {
        loader.parse(buffer, '', resolve, reject);
      });
    } catch (e) {
      throw new Error(`Could not parse the embedded ${key} prop.\n\n${e.message || e}`);
    }
  }

  // The decoder spins up a worker; nothing below needs it again.
  draco.dispose();
}

/**
 * Builds the visual for one prop, and measures what the player will bump into.
 *
 * The collider is derived from the model's own bounds rather than authored by
 * hand, so a new model needs no numbers typed in — only a choice of shape.
 */
function buildPropObject(def) {
  const group = new THREE.Group();
  let material = null;

  if (def.model && propModels[def.model]) {
    const gltf = propModels[def.model];

    /* Cloned, so several copies can exist at once. Materials are cloned along
       with it by three, but the underlying textures are shared, which is what
       we want — one upload of the earth texture however many globes exist. */
    const model = cloneSkinned(gltf.scene);

    model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    // Normalise height. An export can arrive at any scale at all.
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    model.scale.setScalar(h > 0.001 ? (def.height || 1) / h : 1);

    // Centre it on its own origin, so rotation spins in place rather than
    // orbiting, and the collider below sits concentric with the mesh.
    const box2 = new THREE.Box3().setFromObject(model);
    const mid = box2.getCenter(new THREE.Vector3());
    model.position.sub(mid);

    group.add(model);
  } else {
    material = new THREE.MeshStandardMaterial({
      color: def.color,
      metalness: def.metal,
      roughness: def.rough,
      envMapIntensity: ENV_INTENSITY
    });

    const mesh = new THREE.Mesh(def.geo(), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  /* Measured after everything is scaled and centred. Local, not world: the
     group has not been positioned yet, and a prop only ever rotates about Y,
     so these extents stay valid wherever it ends up. */
  const bounds = new THREE.Box3().setFromObject(group);
  const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const centre = bounds.getCenter(new THREE.Vector3());

  const collider = def.collider || 'box';
  const radius = Math.max(half.x, half.z);

  // Same treatment as the characters, so props sit in the same drawing style.
  let outlineMaterial = null;
  if (OUTLINE_PIXELS > 0) {
    outlineMaterial = makeOutlineMaterial(OUTLINE_PIXELS);
    outlineMaterial.color.copy(outlineColorFor(
      def.outline !== undefined ? def.outline : def.color));
    buildOutline(group, outlineMaterial);
  }

  /* Its own animation, if the export carries one. Mixed per prop rather than
     shared, so two copies are not locked to the same frame. */
  let mixer = null;
  if (def.model && propModels[def.model]) {
    const clips = propModels[def.model].animations;
    if (clips && clips.length) {
      mixer = new THREE.AnimationMixer(group);
      for (const clip of clips) mixer.clipAction(clip).play();
    }
  }

  return { group, material, outlineMaterial, mixer, collider, half, centre, radius };
}

/** Frees everything a build allocated. */
function disposeBuilt(built) {
  if (built.mixer) built.mixer.stopAllAction();
  if (built.material) built.material.dispose();
  if (built.outlineMaterial) built.outlineMaterial.dispose();
}

/**
 * Works out how high each kind sits so it rests on the ground.
 *
 * Done by building one of each and measuring, rather than by hand-tuning a
 * number per entry. An export's proportions are not knowable in advance —
 * whether it is taller than it is wide, where its origin sits — and getting
 * this wrong shows up as props buried in the floor or hovering above it. A
 * `lift` in the catalog still wins if one is given, for anything meant to
 * float.
 */
function measureProps() {
  for (const def of PROPS) {
    if (def.lift !== undefined) continue;

    const built = buildPropObject(def);

    def.lift = built.collider === 'sphere'
      ? built.radius - built.centre.y
      : built.half.y - built.centre.y;

    // Kept for spawn spacing, which has to know how wide a prop is before
    // there is one to measure.
    def.radius = built.radius;

    disposeBuilt(built);
  }
}

/**
 * Adds a prop to the world.
 *
 * Called on every client for every prop, whoever spawned it — the id comes
 * from the host so that all clients agree on it.
 */
function addProp(id, kind, x, y, z, ry) {
  if (props.has(id)) return props.get(id);

  const def = PROP_BY_ID.get(kind);
  if (!def) return null;                 // unknown kind: ignore rather than throw

  const built = buildPropObject(def);
  built.group.position.set(x, y, z);
  built.group.rotation.y = ry;
  scene.add(built.group);

  built.group.userData.propId = id;

  const rec = {
    id, kind, def, ...built,

    vel: new THREE.Vector3(),

    /* Angular velocity as a vector, not a yaw rate. A single axis was why a
       ring could never land flat: whatever it was thrown at, it could only
       ever turn about the world's vertical, so it stayed on edge for ever. */
    angVel: new THREE.Vector3(),
    asleep: false,
    holdUntil: 0,              // authority: a remote player is carrying it

    // Where its underside meets the ground, so contact is one comparison.
    rest: built.collider === 'sphere'
      ? built.radius - built.centre.y
      : built.half.y - built.centre.y,

    mass: propMass(built.collider, built.half, built.radius),

    // Clients interpolate toward these rather than snapping to each packet.
    netPos: null,
    netQuat: null
  };

  props.set(id, rec);

  /* A hard ceiling on prop count, oldest first. Without one a room fills up
     until the frame rate collapses, and there is no way back short of
     everyone reloading. Map preserves insertion order, so the first key is
     the oldest. */
  if (props.size > PROP_LIMIT) {
    const oldest = props.keys().next().value;
    if (oldest !== id) removeProp(oldest);
  }

  return rec;
}

function removeProp(id) {
  const rec = props.get(id);
  if (!rec) return;

  if (heldProp && heldProp.id === id) heldProp = null;

  if (rec.mixer) rec.mixer.stopAllAction();

  scene.remove(rec.group);
  if (rec.material) rec.material.dispose();
  if (rec.outlineMaterial) rec.outlineMaterial.dispose();

  rec.group.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  props.delete(id);
}

function clearProps() {
  hideBeam();
  for (const id of [...props.keys()]) removeProp(id);
  propSeq = 0;
  lastSpawnAt = -Infinity;
  clientSpawnAt.clear();
}

/** Where a newly spawned prop lands: a little ahead of where you're looking. */
const spawnDir = new THREE.Vector3();

/**
 * Picks somewhere to drop a new prop.
 *
 * Scattered across an arc in front of you rather than always the same point
 * two metres ahead, and checked against what is already there. Spawning
 * everything at one fixed spot meant a second prop appeared inside the
 * first, and with solid props that is worse than untidy — they start
 * overlapping and shove each other apart the moment physics runs.
 *
 * Rejection sampling rather than anything cleverer: a dozen tries finds a
 * gap in any room that isn't packed solid, and when the area genuinely is
 * full the last attempt is used anyway. Refusing to spawn would be a worse
 * answer than a slight overlap the solver will sort out.
 */
function spawnPoint(def) {
  const p = local.group.position;
  const clearance = (def.radius || 0.5) + 0.25;

  let best = null;

  for (let i = 0; i < SPAWN_TRIES; i++) {
    const angle = yaw + (Math.random() - 0.5) * SPAWN_ARC;
    const dist = SPAWN_NEAR + Math.random() * (SPAWN_FAR - SPAWN_NEAR);

    const x = p.x + Math.sin(angle) * dist;
    const z = p.z + Math.cos(angle) * dist;

    best = { x, y: def.lift || 0.5, z, ry: Math.random() * Math.PI * 2 };

    let clear = true;
    for (const rec of props.values()) {
      const gap = clearance + rec.radius;
      const dx = x - rec.group.position.x;
      const dz = z - rec.group.position.z;
      if (dx * dx + dz * dz < gap * gap) { clear = false; break; }
    }

    if (clear) break;
  }

  return best;
}

/* --------------------------------------------------------------------------
   Collision

   Analytic shapes against a vertical cylinder for the player, resolved by
   pushing out of overlap. This is not a physics solver and does not pretend
   to be one: props never move in response to being hit, and nothing falls or
   stacks. What it does give is the part that actually matters for a sandbox —
   spawned objects are solid, you can stand on them, and you cannot walk
   through them.

   Only the local player is resolved. Every client runs this for itself, and
   remote avatars are drawn where the network says they are; resolving them
   here as well would mean two clients disagreeing about the same push and
   fighting over it.
   -------------------------------------------------------------------------- */

const PLAYER_RADIUS = 0.34;
const PLAYER_HEIGHT = 1.7;
const STEP_UP       = 0.62;   // ledge height that can be walked onto directly
const COLLIDE_SKIN  = 0.001;  // leaves contact rather than exact touching

const collideVec = new THREE.Vector3();

/**
 * Pushes the player out of any prop they are inside, and reports the highest
 * surface under their feet.
 *
 * Horizontal resolution happens first and vertical support second, which is
 * the order that makes a ledge walkable: a prop whose top is within STEP_UP
 * of the feet is treated as floor and skipped for pushing, so you step up
 * onto it instead of being stopped by its side.
 */
function resolveCollisions(avatar) {
  const pos = avatar.group.position;
  let floor = 0;

  /* A client resolves itself against props so it never walks through one,
     but does not get to move them — the authority owns that, and two
     machines pushing the same prop would fight. pushProp is a no-op here. */
  const canPush = propsAuthoritative();

  /* On the way up, walls the player could plausibly land on stop blocking.

     Without this, mounting a block was luck. Jumping from right beside one,
     the first half of the arc is spent below its top, so the side counts as a
     wall and shoves the player away — by the time they are high enough to
     stand on it they have been pushed out of reach of it. Letting the ascent
     pass through anything shorter than the player converts that into landing
     on top, which is what was being attempted. Coming down, the normal rules
     apply again, so nothing can be dropped through. */
  const mounting = !avatar.grounded && avatar.velY > 0;

  for (const rec of props.values()) {
    if (rec.collider === 'none') continue;

    // Whatever you are carrying cannot block you, or walking forward with a
    // prop held out in front would shove you backwards for ever.
    if (heldProp && heldProp.id === rec.id) continue;

    const sh = propShape(rec);

    const c = rec.group.position;
    const cx = c.x + rec.centre.x;
    const cy = c.y + rec.centre.y;
    const cz = c.z + rec.centre.z;

    const dx = pos.x - cx;
    const dz = pos.z - cz;

    if (rec.collider === 'sphere') {
      const r = sh.r;
      const dist = Math.hypot(dx, dz);

      /* Support first, and unconditionally. An earlier version derived the
         floor inside the overlap test, which meant a player standing on top
         had already been rejected by it — their feet are a full radius above
         the centre, so the sphere read as "not overlapping" and they fell
         straight through. Standing on something is a question about the
         surface below you, not about whether you are inside it. */
      if (dist < r) {
        const top = cy + Math.sqrt(r * r - dist * dist);
        if (top <= pos.y + STEP_UP) floor = Math.max(floor, top);
      }

      if (pos.y >= cy + r - 0.02) continue;                 // on top of it
      if (pos.y + PLAYER_HEIGHT <= cy - r) continue;        // entirely beneath

      /* Nearest point on the player's spine to the centre. Comparing against
         that rather than the feet is what lets one test cover both walking
         under a sphere overhead and into one at chest height. */
      const spineY = Math.min(Math.max(cy, pos.y), pos.y + PLAYER_HEIGHT);
      const dy = cy - spineY;
      if (Math.abs(dy) >= r) continue;

      // Radius of the sphere's cross-section at that height.
      const slice = Math.sqrt(r * r - dy * dy);
      if (dist >= slice + PLAYER_RADIUS) continue;

      // Low enough to step onto rather than be stopped by.
      if (dist < r && cy + Math.sqrt(r * r - dist * dist) <= pos.y + STEP_UP) continue;
      if (mounting && cy + r <= pos.y + PLAYER_HEIGHT) continue;

      const want = slice + PLAYER_RADIUS + COLLIDE_SKIN;

      if (dist < 0.0001) {
        pos.x = cx + want;          // dead centre: no direction, so pick one
      } else {
        const nx = dx / dist, nz = dz / dist;

        /* Split by mass. The player takes the remainder of the correction,
           so a light prop skitters away and a heavy one barely gives — which
           is the whole point of deriving mass from size. */
        const share = pushProp(rec, -nx, -nz, avatar.speed, canPush);
        const mine = 1 - share;

        pos.x = cx + nx * (dist + (want - dist) * mine);
        pos.z = cz + nz * (dist + (want - dist) * mine);
      }
    } else if (sh.round) {
      /* An upright cylinder: a circle in plan with flat ends, so the sides
         and the top are two separate cases rather than one curve. */
      const r = sh.r;
      const top = cy + sh.ey;
      const bottom = cy - sh.ey;
      const dist = Math.hypot(dx, dz);

      if (dist < r && top <= pos.y + STEP_UP) floor = Math.max(floor, top);

      if (dist >= r + PLAYER_RADIUS) continue;              // clear in plan view
      if (pos.y >= top - 0.02) continue;                    // standing on it
      if (pos.y + PLAYER_HEIGHT <= bottom) continue;        // walking under it
      if (top <= pos.y + STEP_UP) continue;                 // a kerb, not a wall
      if (mounting && top <= pos.y + PLAYER_HEIGHT) continue;

      const want = r + PLAYER_RADIUS + COLLIDE_SKIN;

      if (dist < 0.0001) {
        pos.x = cx + want;
      } else {
        const nx = dx / dist, nz = dz / dist;
        const share = pushProp(rec, -nx, -nz, avatar.speed, canPush);
        const mine = 1 - share;

        pos.x = cx + nx * (dist + (want - dist) * mine);
        pos.z = cz + nz * (dist + (want - dist) * mine);
      }
    } else {
      const hx = sh.ex, hy = sh.ey, hz = sh.ez;
      const top = cy + hy;
      const bottom = cy - hy;

      const overX = hx + PLAYER_RADIUS - Math.abs(dx);
      const overZ = hz + PLAYER_RADIUS - Math.abs(dz);

      if (overX <= 0 || overZ <= 0) continue;               // clear in plan view

      /* Measured against the true footprint, not the padded one, so you get
         support only where there is actually surface underfoot — otherwise
         you could stand on thin air a player-radius past the edge. */
      if (Math.abs(dx) <= hx && Math.abs(dz) <= hz && top <= pos.y + STEP_UP) {
        floor = Math.max(floor, top);
      }

      if (pos.y >= top - 0.02) continue;                    // standing on it
      if (pos.y + PLAYER_HEIGHT <= bottom) continue;        // walking under it
      if (top <= pos.y + STEP_UP) continue;                 // a kerb, not a wall
      if (mounting && top <= pos.y + PLAYER_HEIGHT) continue;

      const sx = Math.sign(dx || 1), sz = Math.sign(dz || 1);
      const share = overX < overZ
        ? pushProp(rec, -sx, 0, avatar.speed, canPush)
        : pushProp(rec, 0, -sz, avatar.speed, canPush);

      const mine = 1 - share;

      /* Out along the shallower axis, so a corner touch doesn't shove things
         sideways across the whole width of the box. */
      if (overX < overZ) pos.x += sx * (overX + COLLIDE_SKIN) * mine;
      else               pos.z += sz * (overZ + COLLIDE_SKIN) * mine;
    }
  }

  avatar.floorY = floor;
}

/* --------------------------------------------------------------------------
   Prop networking

   Host-authoritative on identity, not on movement. The host is the only one
   that mints ids, which is what keeps clients from colliding on a name for
   the same object; but whoever is carrying a prop sends its position
   directly. Routing movement through the host as well would add a round trip
   to every frame of a drag and make carrying feel like dragging elastic.
   -------------------------------------------------------------------------- */

/** True when this client decides things for itself: solo, or hosting. */
function propsAuthoritative() {
  return !peer || isHost;
}

/**
 * Rate limits spawning.
 *
 * Checked here for the local player and again on the host for each client,
 * because a client's own cooldown is only a suggestion — the copy that
 * matters is the one the sender cannot edit.
 */
let lastSpawnAt = -Infinity;
const clientSpawnAt = new Map();     // peer id -> last accepted spawn

function spawnCooldownLeft() {
  return SPAWN_COOLDOWN - (performance.now() - lastSpawnAt);
}

function requestSpawn(kind) {
  const def = PROP_BY_ID.get(kind);
  if (!def || !local) return false;

  if (spawnCooldownLeft() > 0) return false;
  lastSpawnAt = performance.now();

  const at = spawnPoint(def);

  if (propsAuthoritative()) {
    const id = 'p' + (++propSeq);
    addProp(id, kind, at.x, at.y, at.z, at.ry);
    broadcastToClients({ t: 'prop-add', id, kind, ...at });
  } else {
    // Clients ask and wait. Spawning locally first would mean inventing an id
    // the host has never heard of, and reconciling that is more trouble than
    // the round trip is worth.
    sendToHost({ t: 'prop-spawn', kind, ...at });
  }

  return true;
}

function requestDespawn(id) {
  if (!props.has(id)) return;

  if (propsAuthoritative()) {
    removeProp(id);
    broadcastToClients({ t: 'prop-remove', id });
  } else {
    sendToHost({ t: 'prop-del', id });
  }
}

/**
 * One prop's transform, packed flat.
 *
 * A quaternion rather than a Y angle, because props tumble now and a single
 * axis cannot describe a rolling sphere. An array rather than an object
 * keeps the packet small when fifty of these go out fifteen times a second.
 */
function packProp(rec) {
  const p = rec.group.position;
  const q = rec.group.quaternion;

  return [
    rec.id,
    +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2),
    +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3)
  ];
}

/** Tells the room where a carried prop is. Sent by whoever is holding it. */
function sendPropMove(rec) {
  const packet = { t: 'prop-hold', p: packProp(rec) };

  if (propsAuthoritative()) broadcastToClients(packet);
  else sendToHost(packet);
}

/**
 * The authority's periodic transform broadcast.
 *
 * Only awake props are sent. A settled room costs nothing, which is what
 * makes a 60-prop ceiling affordable at 15Hz — the alternative is sending
 * sixty transforms a frame for objects that visibly are not moving.
 */
function broadcastProps() {
  if (!propsAuthoritative() || !connections.size) return;

  const moving = [];
  for (const rec of props.values()) {
    if (!rec.asleep) moving.push(packProp(rec));
  }

  if (moving.length) broadcastToClients({ t: 'prop-sync', a: moving });
}

const netQuatTmp = new THREE.Quaternion();

/** Applies one packed transform, from a sync or from a holder. */
function applyPackedProp(a) {
  const rec = props.get(a[0]);
  if (!rec) return;

  // Ignored while you are the one carrying it, or a packet from a moment ago
  // would yank it out of your hands.
  if (heldProp && heldProp.id === rec.id) return;

  if (propsAuthoritative()) {
    /* A client is carrying it. Snap rather than ease — the holder is the
       authority on where it is — and suspend simulation briefly, so gravity
       doesn't fight them between packets. */
    rec.group.position.set(a[1], a[2], a[3]);
    rec.group.quaternion.set(a[4], a[5], a[6], a[7]);
    rec.holdUntil = performance.now() + 400;
    rec.vel.set(0, 0, 0);
    rec.angVel.set(0, 0, 0);
    rec.asleep = false;
    return;
  }

  if (!rec.netPos) {
    rec.netPos = new THREE.Vector3();
    rec.netQuat = new THREE.Quaternion();
  }

  rec.netPos.set(a[1], a[2], a[3]);
  rec.netQuat.set(a[4], a[5], a[6], a[7]);

  /* Teleport rather than glide if it has moved a long way — a fresh join, or
     a prop that was deleted and respawned elsewhere. */
  if (rec.group.position.distanceToSquared(rec.netPos) > 100) {
    rec.group.position.copy(rec.netPos);
    rec.group.quaternion.copy(rec.netQuat);
  }
}

/** Everything currently in the world, for a client that has just joined. */
function propSnapshot() {
  const list = [];

  for (const rec of props.values()) {
    list.push({ id: rec.id, kind: rec.kind, p: packProp(rec) });
  }

  return list;
}

function applyPropList(list) {
  clearProps();

  for (const s of list || []) {
    const rec = addProp(s.id, s.kind, s.p[1], s.p[2], s.p[3], 0);
    if (rec) rec.group.quaternion.set(s.p[4], s.p[5], s.p[6], s.p[7]);
  }
}

/** A prop let go of, with the momentum it was carrying. */
function applyPropDrop(msg) {
  const rec = props.get(msg.id);
  if (!rec) return;

  rec.holdUntil = 0;
  rec.asleep = false;

  if (propsAuthoritative()) {
    rec.vel.set(msg.vx || 0, msg.vy || 0, msg.vz || 0);
    rec.angVel.set(msg.wx || 0, msg.wy || 0, msg.wz || 0);
  }
}

/* --------------------------------------------------------------------------
   Prop physics

   A small integrator, not an engine. Gravity, ground contact, friction,
   rolling and pairwise separation — enough that props settle, roll downhill
   of a shove and knock each other aside, and not so much that it needs a
   constraint solver or a broadphase.

   Only the authority simulates. Every client running its own copy would
   drift apart within seconds, because floating-point results differ between
   machines and the inputs (who is pushing what, and when) arrive at
   different times. Clients are told where things ended up and ease toward
   it, which is the same arrangement the avatars already use.

   Prop-against-prop uses each prop's bounding sphere regardless of its
   declared collider. Box-box separation needs contact manifolds and rotation
   handling to be worth having, and against a catalog of round things it
   would buy nothing. Angular props will collide a little too generously
   until that changes.
   -------------------------------------------------------------------------- */

const rollAxis = new THREE.Vector3();
const rollQuat = new THREE.Quaternion();
const spinAxis = new THREE.Vector3();
const pairVec = new THREE.Vector3();

/**
 * Turns a prop by its angular velocity for one step.
 *
 * premultiply, not multiply: the spin is happening in world space, and
 * multiplying would apply it in the prop's own frame instead, so a tumbling
 * object would drag its axis of rotation around with it and wander.
 */
function applySpin(rec, dt) {
  const rate = rec.angVel.length();
  if (rate < 1e-4) return;

  spinAxis.copy(rec.angVel).divideScalar(rate);
  rollQuat.setFromAxisAngle(spinAxis, rate * dt);
  rec.group.quaternion.premultiply(rollQuat);
}

/** Volume-derived, so bigger genuinely means harder to move. */
function propMass(collider, half, radius) {
  const volume = collider === 'sphere'
    ? (4 / 3) * Math.PI * radius * radius * radius
    : 8 * half.x * half.y * half.z;

  return Math.max(0.05, volume * PROP_DENSITY);
}

/**
 * Shoves a prop, sharing the push by mass, and wakes it.
 *
 * Sets a target speed along the push direction rather than adding an
 * impulse. Contact lasts many frames — you stay pressed against whatever you
 * are walking into — and adding on each one compounds, so an earlier version
 * launched a light prop at seventeen metres a second from a walking pace.
 * A target is also closer to what is actually happening: you push something
 * along at roughly your own speed, not harder the longer you touch it.
 */
function pushProp(rec, dx, dz, speed, canPush = true) {
  const share = PLAYER_MASS / (PLAYER_MASS + rec.mass);
  if (!canPush) return share;

  const want = speed * share * PUSH_GAIN;
  const along = rec.vel.x * dx + rec.vel.z * dz;

  if (along < want) {
    rec.vel.x += dx * (want - along);
    rec.vel.z += dz * (want - along);
  }

  rec.asleep = false;
  return share;
}

function stepProps(dt) {
  for (const rec of props.values()) {
    if (rec.mixer) rec.mixer.update(dt);
  }

  if (!propsAuthoritative()) {
    // Clients ease toward the last transform the authority sent. Snapping
    // would show every packet as a jump at 15Hz.
    for (const rec of props.values()) {
      if (heldProp && heldProp.id === rec.id) continue;
      if (!rec.netPos) continue;

      rec.group.position.lerp(rec.netPos, Math.min(1, dt * 12));
      rec.group.quaternion.slerp(rec.netQuat, Math.min(1, dt * 12));
    }
    return;
  }

  simulateProps(dt);
}

function simulateProps(dt) {
  const now = performance.now();
  const list = [...props.values()];

  for (const rec of list) {
    // Carried props are driven by whoever holds them, here or over the wire.
    if (heldProp && heldProp.id === rec.id) { rec.asleep = false; continue; }
    if (rec.holdUntil > now) { rec.asleep = false; continue; }

    if (rec.asleep) continue;

    const pos = rec.group.position;

    rec.vel.y += PROP_GRAVITY * dt;

    pos.x += rec.vel.x * dt;
    pos.y += rec.vel.y * dt;
    pos.z += rec.vel.z * dt;

    /* Ground height from the prop's *current* pose, not from its bind-pose
       half-height. A crate tipped onto its corner reaches lower than a crate
       sitting flat, and using the flat figure buried it in the floor up to a
       fifth of its size while it toppled. */
    const rest = rec.collider === 'sphere'
      ? rec.rest
      : propShape(rec).ey - rec.centre.y;

    let onGround = false;

    if (pos.y <= rest) {
      pos.y = rest;

      /* Only bounce off a real impact. Without the threshold a prop at rest
         jitters forever, bouncing off the microscopic velocity gravity gives
         it each frame. */
      rec.vel.y = rec.vel.y < -1.2 ? -rec.vel.y * PROP_BOUNCE : 0;
      onGround = true;
    }

    // Friction on the ground, light drag in the air.
    const drag = onGround ? PROP_ROLL_DRAG : PROP_AIR_DRAG;
    const damp = Math.max(0, 1 - drag * dt);
    rec.vel.x *= damp;
    rec.vel.z *= damp;

    const speed = Math.hypot(rec.vel.x, rec.vel.z);

    if (rec.collider === 'sphere' && onGround && speed > 0.001) {
      /* Rolling without slipping: the contact point is stationary, so the
         turn rate is speed over radius, about the horizontal axis at right
         angles to travel. This is what makes a ball look like it is rolling
         rather than sliding along with a spin bolted on. Set rather than
         accumulated — a rolling ball's spin is a consequence of how fast it
         is going, not something it carries independently. */
      rollAxis.set(-rec.vel.z, 0, rec.vel.x).normalize();
      rec.angVel.copy(rollAxis).multiplyScalar(speed / rec.radius);
    } else {
      /* Everything else keeps whatever tumble it was given and sheds it — fast
         once it is down, slowly while it is still in the air. */
      const spinDrag = onGround ? PROP_LAND_DRAG : PROP_SPIN_DRAG;
      rec.angVel.multiplyScalar(Math.max(0, 1 - spinDrag * dt));
    }

    // Fall over rather than balancing on an edge. Only once it is down —
    // in the air there is nothing to push against.
    if (onGround) rightProp(rec, dt);

    applySpin(rec, dt);

    /* Asleep once it has effectively stopped. Without this every prop in the
       room keeps integrating and broadcasting forever, which costs frame
       time and bandwidth for objects that are visibly not moving.

       The spin has to be still as well, or a prop that has stopped moving but
       is mid-tumble freezes at whatever angle it happened to be at. */
    if (onGround && speed < PROP_SLEEP && Math.abs(rec.vel.y) < PROP_SLEEP
        && rec.angVel.lengthSq() < PROP_SLEEP * PROP_SLEEP
        && restingFlat(rec)) {
      rec.vel.set(0, 0, 0);
      rec.angVel.set(0, 0, 0);
      rec.asleep = true;
    }
  }

  separateProps(list, dt);

  /* Kept for catalog entries that ask for it — a model that should turn on
     the spot once it has settled. None of the primitives do. */
  for (const rec of list) {
    if (!rec.def.spin || rec.asleep === false) continue;
    if (heldProp && heldProp.id === rec.id) continue;

    rec.group.rotateY(rec.def.spin * dt);
  }
}

/**
 * The footprint a prop presents right now, given how it is currently turned.
 *
 * Everything below works against a vertical circle or an axis-aligned box,
 * because those are the two shapes a cheap test can resolve. A prop that has
 * tumbled is neither, so its current orientation has to be folded in before
 * the test rather than assumed away — which is what the old version did, and
 * why a crate that had rolled onto its corner still collided as though it
 * were square-on.
 *
 * A cylinder stays a circle only while it is roughly upright. Once it is on
 * its side it is a box as far as the player is concerned, so it becomes one.
 */
const shapeAxis = new THREE.Vector3();
const shapeUp = new THREE.Vector3(0, 1, 0);
const shape = { round: false, ex: 0, ey: 0, ez: 0, r: 0 };

function propShape(rec) {
  if (rec.collider === 'sphere') {
    shape.round = true;
    shape.r = rec.radius;
    shape.ex = shape.ez = rec.radius;
    shape.ey = rec.radius;
    return shape;
  }

  if (rec.collider === 'cylinder') {
    // How far the prop's own up-axis has tipped away from vertical.
    shapeAxis.copy(shapeUp).applyQuaternion(rec.group.quaternion);

    if (Math.abs(shapeAxis.y) > 0.75) {
      shape.round = true;
      shape.r = Math.max(rec.half.x, rec.half.z);
      shape.ex = shape.ez = shape.r;
      shape.ey = rec.half.y;
      return shape;
    }
  }

  /* Axis-aligned bounds of the rotated box. Conservative — a crate at 45
     degrees reads slightly larger than it looks — but it is three dot
     products against the alternative of separating axes and contact
     manifolds, and at these speeds nobody sees the difference. */
  const e = rec.group.matrixWorld.elements;
  const hx = rec.half.x, hy = rec.half.y, hz = rec.half.z;

  shape.round = false;
  shape.ex = Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz;
  shape.ey = Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
  shape.ez = Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz;
  shape.r = Math.max(shape.ex, shape.ez);

  return shape;
}

/* --------------------------------------------------------------------------
   Settling

   Which way up a prop ends when it stops moving.

   Nothing here computes torque from a contact point, so a landing prop has no
   reason to fall over — its spin simply damps out and it freezes at whatever
   angle it happened to be at, including balanced on one corner. That is the
   single most obviously wrong thing a physics object can do, so instead of a
   real solver the prop is steered toward the nearest orientation it could
   actually rest in and allowed to topple into it.

   The set of stable orientations depends on the shape. A box has twenty-four:
   any of its faces down, in any of four turns. A cylinder has two kinds,
   standing or on its side. A sphere has none — every orientation is a resting
   one, which is why they are skipped.
   -------------------------------------------------------------------------- */

/* How hard a prop rights itself once it is down, and the size that figure is
   written for.

   Scaled by size, because that is what governs toppling. Mass cancels out of
   a gravity-driven fall entirely; what is left is that the time to go over
   grows with the square root of the object's size, which is why a matchbox
   flips instantly and a wardrobe goes slowly enough to step back from. One
   flat rate for everything is what made the boulder snap round like a marble.

   Square root rather than a straight division, which was the first attempt.
   Dividing by size is right for the angular acceleration but it is not what
   ends up on screen, because the ground drag is a fixed rate and swamps a
   weak torque — the block took five and a half seconds to fall off its own
   corner and read as stuck rather than as heavy. */
const RIGHT_TORQUE  = 22.0;
const RIGHT_SIZE    = 0.4;   // the size the figure above is tuned for
const RIGHT_SNAP    = 0.04;  // radians from stable at which it is called done

const restQuat = new THREE.Quaternion();
const restMat = new THREE.Matrix4();
const axX = new THREE.Vector3();
const axY = new THREE.Vector3();
const axZ = new THREE.Vector3();
const snapA = new THREE.Vector3();
const snapB = new THREE.Vector3();
const rightAxis = new THREE.Vector3();
const rightDelta = new THREE.Quaternion();

/** The world axis a direction is closest to, sign included. */
function snapToAxis(v, out, avoid) {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);

  // `avoid` is the axis already claimed; a box's second vector has to take
  // its next-best choice or the two would collapse onto the same line.
  const blocked = avoid ? Math.abs(avoid.x) > 0.5 ? 0 : Math.abs(avoid.y) > 0.5 ? 1 : 2 : -1;

  let best = -1, bestVal = -1;
  const vals = [ax, ay, az];

  for (let i = 0; i < 3; i++) {
    if (i === blocked) continue;
    if (vals[i] > bestVal) { bestVal = vals[i]; best = i; }
  }

  out.set(0, 0, 0);
  if (best === 0) out.x = Math.sign(v.x) || 1;
  else if (best === 1) out.y = Math.sign(v.y) || 1;
  else out.z = Math.sign(v.z) || 1;

  return out;
}

/** Writes the nearest orientation this prop could rest in into `out`. */
function nearestRest(rec, out) {
  const m = rec.group.matrixWorld.elements;

  axX.set(m[0], m[1], m[2]).normalize();
  axY.set(m[4], m[5], m[6]).normalize();

  if (rec.collider === 'cylinder') {
    /* Only the axis of symmetry matters — how far it is turned about that
       axis makes no difference to how it sits. So this is the shortest
       rotation that puts the local Y onto a world axis, and nothing more. */
    snapToAxis(axY, snapA);
    out.setFromUnitVectors(axY, snapA).multiply(rec.group.quaternion);
    return out;
  }

  // A box: snap two axes and derive the third, which guarantees the result
  // is a rotation rather than a reflection.
  snapToAxis(axY, snapA);
  snapToAxis(axX, snapB, snapA);
  axZ.crossVectors(snapB, snapA);

  restMat.makeBasis(snapB, snapA, axZ);
  return out.setFromRotationMatrix(restMat);
}

/** True when a prop is close enough to a stable pose to stop simulating. */
function restingFlat(rec) {
  if (rec.collider === 'sphere') return true;

  nearestRest(rec, restQuat);
  return rec.group.quaternion.angleTo(restQuat) < RIGHT_SNAP * 1.5;
}

/**
 * Topples a grounded prop toward a pose it could actually hold.
 *
 * A torque rather than a slerp, so it accelerates away from the unstable
 * angle the way a real object does — a crate on its corner hesitates, tips,
 * then drops onto its face. A slerp would glide there at constant speed and
 * read as the object being dragged upright by hand.
 */
function rightProp(rec, dt) {
  if (rec.collider === 'sphere') return;

  nearestRest(rec, restQuat);

  rightDelta.copy(rec.group.quaternion).invert().premultiply(restQuat);

  // Shortest way round: q and -q are the same orientation, and without this
  // a prop more than 180 degrees out would take the long path.
  if (rightDelta.w < 0) {
    rightDelta.set(-rightDelta.x, -rightDelta.y, -rightDelta.z, -rightDelta.w);
  }

  const sin = Math.hypot(rightDelta.x, rightDelta.y, rightDelta.z);
  if (sin < 1e-5) return;

  const angle = 2 * Math.atan2(sin, rightDelta.w);

  if (angle < RIGHT_SNAP) {
    // Close enough. Snapping avoids an endless crawl over the last degree.
    rec.group.quaternion.copy(restQuat);
    rec.angVel.multiplyScalar(0.2);
    return;
  }

  rightAxis.set(rightDelta.x, rightDelta.y, rightDelta.z).divideScalar(sin);

  const torque = RIGHT_TORQUE * Math.sqrt(RIGHT_SIZE / Math.max(0.15, rec.radius));

  rec.angVel.addScaledVector(rightAxis, angle * torque * dt);
  rec.asleep = false;
}

/**
 * Keeps props from sharing space.
 *
 * Three cases, driven by what each prop currently presents rather than by
 * what it was declared as — an upright barrel separates as a circle, the same
 * barrel on its side as a box.
 *
 * Positional separation split by mass, plus a little velocity so a shove
 * carries through a line of props instead of stopping at the first. O(n²),
 * which at a 60-prop ceiling is under two thousand checks a frame — not worth
 * a spatial index.
 */
const shapeA = { round: false, ex: 0, ey: 0, ez: 0, r: 0 };

function separateProps(list, dt) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.collider === 'none') continue;

    Object.assign(shapeA, propShape(a));

    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.collider === 'none') continue;

      // Cheap reject on bounding radii before any real work.
      const rough = shapeA.r + b.radius + 0.5;
      pairVec.subVectors(a.group.position, b.group.position);
      if (pairVec.lengthSq() >= rough * rough) continue;

      const shB = propShape(b);

      let nx = 0, nz = 0, overlap = 0;

      if (shapeA.round && shB.round) {
        const dist = Math.hypot(pairVec.x, pairVec.z);
        const gap = shapeA.r + shB.r;
        if (dist >= gap) continue;

        overlap = gap - dist;
        if (dist < 1e-5) { nx = 1; nz = 0; }
        else { nx = pairVec.x / dist; nz = pairVec.z / dist; }

      } else if (!shapeA.round && !shB.round) {
        const overX = shapeA.ex + shB.ex - Math.abs(pairVec.x);
        const overZ = shapeA.ez + shB.ez - Math.abs(pairVec.z);
        if (overX <= 0 || overZ <= 0) continue;

        // Out along the shallower axis, so a corner touch doesn't fling
        // things sideways across the whole width of the box.
        if (overX < overZ) { nx = Math.sign(pairVec.x || 1); overlap = overX; }
        else               { nz = Math.sign(pairVec.z || 1); overlap = overZ; }

      } else {
        // Round against box: nearest point on the box to the circle's centre.
        const roundIsA = shapeA.round;
        const box = roundIsA ? shB : shapeA;
        const rad = roundIsA ? shapeA.r : shB.r;

        // pairVec runs a -> b, so flip it when the box is a.
        const dx = roundIsA ? pairVec.x : -pairVec.x;
        const dz = roundIsA ? pairVec.z : -pairVec.z;

        const qx = Math.max(-box.ex, Math.min(box.ex, dx));
        const qz = Math.max(-box.ez, Math.min(box.ez, dz));

        const ox = dx - qx, oz = dz - qz;
        const dist = Math.hypot(ox, oz);

        if (dist >= rad) continue;

        overlap = rad - dist;

        if (dist < 1e-5) {
          // Centre is inside the box: push out through the nearest face.
          const outX = box.ex - Math.abs(dx), outZ = box.ez - Math.abs(dz);
          if (outX < outZ) nx = Math.sign(dx || 1); else nz = Math.sign(dz || 1);
          overlap += Math.min(outX, outZ);
        } else {
          nx = ox / dist;
          nz = oz / dist;
        }

        // The normal was built round-relative; flip it back if b is the round one.
        if (!roundIsA) { nx = -nx; nz = -nz; }
      }

      const total = a.mass + b.mass;
      const aShare = b.mass / total;      // the lighter one moves further
      const bShare = a.mass / total;

      const aHeld = heldProp && heldProp.id === a.id;
      const bHeld = heldProp && heldProp.id === b.id;

      if (!aHeld) {
        a.group.position.x += nx * overlap * aShare;
        a.group.position.z += nz * overlap * aShare;
        a.vel.x += nx * overlap * aShare * 6;
        a.vel.z += nz * overlap * aShare * 6;
        a.asleep = false;
      }

      if (!bHeld) {
        b.group.position.x -= nx * overlap * bShare;
        b.group.position.z -= nz * overlap * bShare;
        b.vel.x -= nx * overlap * bShare * 6;
        b.vel.z -= nz * overlap * bShare * 6;
        b.asleep = false;
      }
    }
  }
}

/* --------------------------------------------------------------------------
   Grab beam

   The line that runs from the player to whatever they are carrying, and the
   only thing that says a prop is held — there is no crosshair and no text
   hint. That is deliberate: the beam already points at exactly one object,
   so anything else would be repeating what the player can see.

   Built as a stretched cylinder rather than a THREE.Line. Line width is a
   dead parameter in WebGL — every implementation renders one pixel and
   ignores what you ask for — so a real line would come out hairline thin at
   any distance, and thinner still once the third-resolution buffer scales it
   up. A cylinder is geometry and behaves.
   -------------------------------------------------------------------------- */

const BEAM_COLOR  = 0x5cc8ff;
const BEAM_RADIUS = 0.028;

const beamUp = new THREE.Vector3(0, 1, 0);
const beamDir = new THREE.Vector3();
const beamFrom = new THREE.Vector3();

let beam = null;
let beamClock = 0;

function ensureBeam() {
  if (beam) return beam;

  /* A unit cylinder shifted so its base sits on the origin: scaling y then
     stretches it forward from the anchor instead of growing both ways from
     the middle. Open-ended, since the caps are never visible. */
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  geo.translate(0, 0.5, 0);

  const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: BEAM_COLOR,
    transparent: true,
    opacity: 0.55,

    /* Additive, so it reads as light rather than as a painted rod, and
       brightens where it crosses itself at the ends. depthWrite off for the
       usual reason — a transparent surface that writes depth hides whatever
       is drawn after it. */
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false
  }));

  // A soft bloom at the far end, where the beam meets the prop.
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({
      color: BEAM_COLOR,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    })
  );

  core.renderOrder = 8;
  tip.renderOrder = 8;
  core.frustumCulled = false;
  tip.frustumCulled = false;

  beam = { core, tip };
  scene.add(core, tip);
  hideBeam();

  return beam;
}

function hideBeam() {
  if (!beam) return;
  beam.core.visible = false;
  beam.tip.visible = false;
}

/**
 * Points the beam from the player's hand to the prop.
 *
 * The origin is derived from the character's facing rather than read off a
 * hand bone. Bone names vary between exports and a missing one would throw;
 * an offset is approximate but it is never wrong, and at this distance the
 * difference is a few pixels.
 */
function updateBeam(dt, target) {
  const b = ensureBeam();
  const p = local.group.position;

  // group.rotation.y is the facing that was actually rendered this frame, which
  // is what the beam has to agree with — headingTarget leads it slightly.
  const face = local.group.rotation.y;

  beamFrom.set(
    p.x + Math.sin(face) * 0.22 + Math.cos(face) * 0.24,
    p.y + 1.16,
    p.z + Math.cos(face) * 0.22 - Math.sin(face) * 0.24
  );

  beamDir.subVectors(target, beamFrom);
  const len = beamDir.length();
  if (len < 0.01) { hideBeam(); return; }

  beamDir.divideScalar(len);

  b.core.position.copy(beamFrom);
  b.core.quaternion.setFromUnitVectors(beamUp, beamDir);

  // Gentle pulse, so a held beam doesn't look like a frozen prop.
  beamClock += dt;
  const pulse = 1 + Math.sin(beamClock * 7) * 0.12;

  b.core.scale.set(BEAM_RADIUS * pulse, len, BEAM_RADIUS * pulse);
  b.core.visible = true;

  b.tip.position.copy(target);
  b.tip.scale.setScalar(0.075 * pulse);
  b.tip.visible = true;
}

/* --------------------------------------------------------------------------
   Carrying

   A raycast from the centre of the screen, which is where the camera is
   looking and therefore where the player expects the reach to be.
   -------------------------------------------------------------------------- */

const holdTarget = new THREE.Vector3();

let propMoveClock = 0;

/**
 * The prop the player is aiming at, or null.
 *
 * Proximity to the aim ray, not an intersection with it. Two reasons, and the
 * first is the one that mattered:
 *
 * Removing the crosshair removed any way to know where an exact ray points.
 * In a third-person view the centre of the screen is the character's own
 * back, and the ray carries on past them at whatever angle the camera is
 * pitched — so "point at the thing" is a guess. Picking whatever sits closest
 * to that line means a rough gesture toward a prop is enough.
 *
 * Second, an exact hit is unreliable on small props. At a typical camera
 * pitch the ray passes about half a metre above the ground three metres out,
 * which clears a marble entirely. It would have been grabbable only from
 * angles the player would have to find by accident.
 *
 * Range is still measured from the character, and the prop still has to be
 * ahead of the ray rather than behind the camera.
 */
const aimOrigin = new THREE.Vector3();
const aimDir = new THREE.Vector3();
const aimToProp = new THREE.Vector3();

const AIM_CONE = 0.34;   // radians of slack around the aim line

function propUnderAim() {
  if (!props.size || !local) return null;

  camera.getWorldPosition(aimOrigin);
  camera.getWorldDirection(aimDir);

  let best = null;
  let bestAngle = AIM_CONE;

  for (const rec of props.values()) {
    // Reach is from the character; the ray is only used for direction.
    if (rec.group.position.distanceTo(local.group.position) > PROP_REACH) continue;

    aimToProp.subVectors(rec.group.position, aimOrigin);
    const dist = aimToProp.length();
    if (dist < 0.001) continue;

    aimToProp.divideScalar(dist);

    const along = aimToProp.dot(aimDir);
    if (along <= 0) continue;              // behind the camera

    /* Angle off the aim line, widened for bigger props so a boulder is as
       easy to catch as its size suggests rather than needing the same
       pinpoint gesture as a marble. */
    const angle = Math.acos(Math.min(1, along)) - Math.atan2(rec.radius, dist);

    if (angle < bestAngle) {
      bestAngle = angle;
      best = rec;
    }
  }

  return best;
}

const heldPrev = new THREE.Vector3();
const heldVel = new THREE.Vector3();
const heldSpin = new THREE.Quaternion();
const worldUp = new THREE.Vector3(0, 1, 0);

function spinHeld(angle) {
  heldSpin.setFromAxisAngle(worldUp, angle);
  heldProp.group.quaternion.premultiply(heldSpin);
}

function grabProp() {
  const rec = propUnderAim();
  if (!rec) return;

  heldProp = rec;

  // Picking something up stops it dead; it is in your hands now.
  rec.vel.set(0, 0, 0);
  rec.angVel.set(0, 0, 0);
  rec.asleep = false;

  heldPrev.copy(rec.group.position);
  heldVel.set(0, 0, 0);

  /* Kept at the distance it was found at, so grabbing doesn't jerk it toward
     or away from you the instant you press the button. Stored camera-relative
     because that is the ray it rides on, but clamped in character terms —
     hence the boom length on both bounds. Without it, the near clamp would
     put a carried prop somewhere behind the player's head. */
  heldDist = Math.min(CAM_DISTANCE + PROP_HOLD_MAX,
             Math.max(CAM_DISTANCE + PROP_HOLD_MIN,
                      camera.position.distanceTo(rec.group.position)));

}

function releaseProp() {
  if (!heldProp) return;

  const rec = heldProp;

  /* Velocity is measured from how the prop actually moved over the last few
     frames, not from the camera. Those differ: the prop eases toward the aim
     point rather than tracking it exactly, so a fast flick with a heavy prop
     moves the aim a long way and the prop only a little. Reading the prop is
     what makes a heavy thing hard to throw. */
  const speed = heldVel.length();

  let vx = 0, vy = 0, vz = 0;

  let spin = null;

  if (speed >= FLING_MIN) {
    const power = FLING_GAIN * (FLING_MASS_REF / (FLING_MASS_REF + rec.mass));
    vx = heldVel.x * power;
    vy = heldVel.y * power;
    vz = heldVel.z * power;

    /* Tumble, about an axis across the throw. Thrown objects rotate because
       the force is never applied through their centre, and a prop that flies
       dead flat looks like a projectile rather than a thing that was
       chucked. Divided by size, so a marble spins hard and a boulder barely
       turns, which is how the two actually behave. */
    const rate = Math.min(TUMBLE_MAX,
      (speed / Math.max(0.25, rec.radius)) * TUMBLE_GAIN);

    spin = new THREE.Vector3(-vz, 0, vx).normalize().multiplyScalar(rate);

    // A little wobble off that axis, so no two throws are identical.
    spin.y += (Math.random() - 0.5) * spin.length() * 0.5;
  }

  heldProp = null;
  hideBeam();

  rec.holdUntil = 0;
  rec.asleep = false;

  const packet = { t: 'prop-drop', id: rec.id, vx, vy, vz };

  if (spin) {
    packet.wx = +spin.x.toFixed(2);
    packet.wy = +spin.y.toFixed(2);
    packet.wz = +spin.z.toFixed(2);
  }

  if (propsAuthoritative()) {
    rec.vel.set(vx, vy, vz);
    if (spin) rec.angVel.copy(spin);
    broadcastToClients(packet);
  } else {
    sendToHost(packet);
  }
}

/** Moves whatever is being carried, and tells the room about it. */
function stepHeldProp(dt) {
  if (!heldProp) return;

  // Dropped out from under us — deleted by the host, or the room reset.
  if (!props.has(heldProp.id)) { heldProp = null; hideBeam(); return; }

  camera.getWorldDirection(spawnDir);
  holdTarget.copy(camera.position).addScaledVector(spawnDir, heldDist);

  // Never below the floor, and never inside it.
  holdTarget.y = Math.max(heldProp.def.lift || 0.3, holdTarget.y);

  /* Eased, and more slowly for heavier props, so a big object lags behind
     the aim point and a small one tracks it closely. Mass earns its keep in
     the feel of carrying as much as in the pushing, and it is also what makes
     a boulder hard to fling. */
  const follow = 16 / (1 + heldProp.mass * 0.5);
  heldProp.group.position.lerp(holdTarget, Math.min(1, dt * follow));

  /* Measured, not predicted. Exponential smoothing so a single stuttered
     frame doesn't decide how hard the throw comes out. */
  heldVel.lerp(
    spawnDir.subVectors(heldProp.group.position, heldPrev).divideScalar(Math.max(dt, 0.001)),
    0.35
  );
  heldPrev.copy(heldProp.group.position);

  updateBeam(dt, heldProp.group.position);

  /* Turning while carrying happens on the world's vertical, not the prop's
     own — rotateY would spin it about whatever axis it had tumbled onto,
     which is unpredictable once it is no longer upright. */
  if (keys.has('KeyQ')) spinHeld(-dt * 2.4);
  if (keys.has('KeyE')) spinHeld(dt * 2.4);

  propMoveClock += dt;
  if (propMoveClock >= 1 / PROP_NET_HZ) {
    propMoveClock = 0;
    sendPropMove(heldProp);
  }
}

/* --------------------------------------------------------------------------
   The menu
   -------------------------------------------------------------------------- */

function buildInternet() {
  const grid = el('net-grid');

  for (const def of PROPS) {
    const btn = document.createElement('button');
    btn.className = 'net-item';
    btn.type = 'button';

    const swatch = document.createElement('span');
    swatch.className = 'net-swatch';

    // Textured models have no single base colour, so the outline tint stands
    // in for one.
    const tint = def.color !== undefined ? def.color : def.outline;
    swatch.style.background = '#' + (tint || 0x666666).toString(16).padStart(6, '0');

    const label = document.createElement('span');
    label.textContent = def.name;

    btn.append(swatch, label);
    btn.addEventListener('click', () => {
      if (requestSpawn(def.id)) closeInternet();
      else showSpawnCooldown();
    });

    grid.appendChild(btn);
  }
}

function openInternet() {
  if (internetOpen || !local || chatOpen) return;

  internetOpen = true;
  keys.clear();                    // or a held direction sticks while browsing
  el('internet').classList.remove('hidden');

  // Opened inside a cooldown: show that before anything is clicked.
  if (spawnCooldownLeft() > 0) showSpawnCooldown();

  // The cursor is needed to click a tile. Releasing the lock normally raises
  // the pause menu; the pointerlockchange handler checks internetOpen and
  // stands down.
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeInternet(relock = true) {
  if (!internetOpen) return;

  internetOpen = false;
  el('internet').classList.add('hidden');

  if (relock && !IS_TOUCH && relockPointer) relockPointer();
}

/**
 * Marks the menu as rate-limited and counts it down in place.
 *
 * Shown rather than silently ignored. A click that does nothing reads as a
 * broken button, and the player's next move is to click harder.
 */
let spawnCoolTimer = null;

function showSpawnCooldown() {
  const grid = el('net-grid');

  grid.classList.remove('cooling');
  void grid.offsetWidth;                  // restart the flash if already running
  grid.classList.add('cooling');

  clearTimeout(spawnCoolTimer);
  spawnCoolTimer = setTimeout(
    () => grid.classList.remove('cooling'),
    Math.max(120, Math.ceil(spawnCooldownLeft()))
  );
}

/* --------------------------------------------------------------------------
   Frame loop
   -------------------------------------------------------------------------- */

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  stepLocal(dt);
  for (const avatar of remotes.values()) avatar.stepRemote(dt);
  stepCamera(dt);
  stepHeldProp(dt);
  stepProps(dt);

  /* The shadow camera moves with the player, and moving it by fractions of a
     unit each frame makes every shadow edge crawl and fizz — easily mistaken
     for the camera itself shaking. Snapping it to a coarse grid means it only
     jumps occasionally, and always by a whole number of shadow texels, so the
     shadow stays perfectly still in between. */
  const pp = local.group.position;
  const snap = 4;
  const sx = Math.round(pp.x / snap) * snap;
  const sz = Math.round(pp.z / snap) * snap;

  sun.position.set(sx + 12, 20, sz + 8);
  sun.target.position.set(sx, 0, sz);
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
    // chatOpen is checked before activeElement deliberately. If focus ever
    // slips out of the field, the letters are lost either way — but without
    // this the character also starts walking while you type.
    if (chatOpen || internetOpen) return;
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

  // closeChat() needs to hand the cursor back when the player is done typing.
  relockPointer = requestLock;

  // Pointer lock is a desktop idea; on a phone the game just starts.
  if (!IS_TOUCH) {
    // Clicking the backdrop resumes; the buttons handle themselves.
    clickLayer.addEventListener('click', e => {
      if (e.target === clickLayer) requestLock();
    });
    renderer.domElement.addEventListener('click', requestLock);

    document.addEventListener('pointerlockchange', () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;

      /* Opening chat releases the cursor on purpose. Without this guard the
         handler cannot tell that apart from Escape, so pressing T unlocked the
         pointer and the pause menu came up over the chat bar. This is also the
         moment the browser hands focus back to the body, so take it back. */
      if (chatOpen) { keys.clear(); focusChatInput(); return; }

      /* Same reasoning for The Internet: it releases the cursor on purpose so
         a tile can be clicked, and without this the pause menu would open
         behind it. */
      if (internetOpen) { keys.clear(); return; }

      clickLayer.classList.toggle('hidden', pointerLocked);

      // Escape releases the cursor, which is the browser's own shortcut and
      // can't be intercepted — so treat losing the lock as opening a pause
      // menu rather than as an accident.
      el('pause-title').textContent = 'Paused';

      if (pointerLocked) ignoreNextMove = true;
      else keys.clear();
    });
  }

  /* Carrying is on the mouse button rather than a key, and held rather than
     toggled — the same grammar as every physics gun this is borrowed from.

     Gated on being in-game rather than on pointer lock. Lock is unavailable
     in a sandboxed iframe and can be dropped by the browser for reasons the
     page never hears about, and in either case requiring it means the button
     silently does nothing with no way to tell why. Chat and the spawn menu
     still block it, since both want the cursor for themselves. */
  addEventListener('mousedown', e => {
    if (e.button !== 0 || !local || chatOpen || internetOpen) return;
    if (clickLayer && !clickLayer.classList.contains('hidden')) return;   // paused
    grabProp();
  });

  addEventListener('mouseup', e => {
    if (e.button === 0) releaseProp();
  });

  /* Push and pull whatever is carried. Passive is off because the page would
     otherwise scroll behind the canvas on trackpads. */
  addEventListener('wheel', e => {
    if (!heldProp) return;
    e.preventDefault();

    heldDist = Math.min(CAM_DISTANCE + PROP_HOLD_MAX,
               Math.max(CAM_DISTANCE + PROP_HOLD_MIN,
                        heldDist + Math.sign(e.deltaY) * 0.4));
  }, { passive: false });

  addEventListener('keydown', e => {
    if (chatOpen || !local) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

    if (e.code === 'Escape' && internetOpen) {
      // Escape has already released the pointer lock by the time this runs,
      // so closing needs to ask for it back rather than assume it is held.
      e.preventDefault();
      closeInternet();
      return;
    }

    if (e.code === 'Enter') {
      /* preventDefault matters more than usual here. A browser fires a click
         on whatever button currently holds focus when Enter is pressed, so
         without it, opening the menu after having clicked Resume would also
         re-trigger Resume. */
      e.preventDefault();
      if (internetOpen) closeInternet();
      else openInternet();
      return;
    }

    if (internetOpen) return;

    // Delete what you are holding, or what you are looking at.
    if (e.code === 'KeyR') {
      const rec = heldProp || propUnderAim();
      if (rec) {
        e.preventDefault();
        if (heldProp && heldProp.id === rec.id) { heldProp = null; hideBeam(); }
        requestDespawn(rec.id);
      }
    }
  });

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

/* WebRTC needs help getting through NAT. STUN alone works when at least one
   side has a permissive router, which is typical on home wifi — but mobile
   carriers hand out symmetric NAT, and two phones on cellular usually cannot
   see each other at all without a relay to bounce traffic through. Without
   TURN in this list, joining "fails" on mobile data in a way that looks
   exactly like the room not existing.
   
   These are public relays. They're fine for a small game, but they're shared
   and can be slow or busy; a real deployment would run its own. */
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  }
};

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
  // Each attempt gets a clean peer. Leaving a failed one alive keeps a socket
  // to the broker open, and the stale error handlers fire later against a
  // session that has already moved on.
  const scrap = () => {
    if (peer) { try { peer.destroy(); } catch {} }
    peer = null;
  };

  try {
    await startClient(code, { timeout: 7000 });
    return;
  } catch (e) {
    scrap();
    if (!allowHost || e.code !== 'no-host') throw e;
  }

  try {
    await startHost(code);
    return;
  } catch (e) {
    scrap();
    if (e.code !== 'taken') throw e;
  }

  /* Someone claimed the room in the gap between our two attempts, which for a
     busy public lobby is the normal case rather than an edge case. Join them,
     with a longer window: we now know for certain a host is there, so giving
     up early would report an empty room that plainly isn't. */
  await new Promise(r => setTimeout(r, 500));
  await startClient(code, { timeout: 12000 });
}

function startHost(code) {
  return new Promise((resolve, reject) => {
    isHost = true;
    roomCode = code;
    peer = new Peer(peerIdFor(code), PEER_CONFIG);
    myId = 'host';

    peer.on('open', () => resolve());

    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        const e = new Error('That room code is already taken.');
        e.code = 'taken';
        reject(e);
      } else if (err.type === 'network' || err.type === 'server-error') {
        const e = new Error('Cannot reach the matchmaking server. Check your connection.');
        e.code = 'broker';
        reject(e);
      } else {
        const e = new Error(`Connection problem (${err.type}).`);
        e.code = err.type;
        reject(e);
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

function startClient(code, { timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    isHost = false;
    roomCode = code;
    peer = new Peer(PEER_CONFIG);

    let settled = false;
    let registered = false;      // did the broker give us an ID?
    let attempts = 0;
    let conn = null;

    const fail = (message, kind) => {
      if (settled) return;
      settled = true;
      clearTimeout(brokerTimer);
      clearTimeout(connTimer);
      clearTimeout(retryTimer);
      const e = new Error(message);
      e.code = kind;
      reject(e);
    };

    /* Two separate deadlines, because the two failures need different
       answers. Never getting an ID means the matchmaking server is down or
       blocked, and no amount of retrying this room will help. Getting an ID
       but never reaching the host means the room is empty, or the two devices
       cannot find a path to each other. */
    const brokerTimer = setTimeout(() => {
      if (!registered) {
        fail('Could not reach the matchmaking server. It may be busy — try again in a moment.', 'broker');
      }
    }, 9000);

    let connTimer = null;
    let retryTimer = null;

    peer.on('error', err => {
      if (err.type === 'peer-unavailable') {
        fail('No room found with that code.', 'no-host');
      } else if (err.type === 'network' || err.type === 'server-error'
                 || err.type === 'socket-error' || err.type === 'socket-closed') {
        fail('Lost contact with the matchmaking server.', 'broker');
      } else if (err.type === 'browser-incompatible') {
        fail('This browser cannot make the connection this game needs.', 'browser');
      } else if (err.type === 'unavailable-id') {
        fail('Connection id clash — try again.', 'taken');
      } else {
        fail(`Connection problem (${err.type}).`, err.type);
      }
    });

    const attempt = () => {
      attempts++;
      conn = peer.connect(peerIdFor(code), { reliable: true });

      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(brokerTimer);
        clearTimeout(connTimer);
        clearTimeout(retryTimer);
        connections.set('host', conn);
        conn.send({ t: 'hello', name: myName, skin: mySkin });
        resolve();
      });

      conn.on('data', onClientMessage);
      conn.on('close', () => { if (settled) onHostLost(); });
    };

    peer.on('open', () => {
      registered = true;
      clearTimeout(brokerTimer);
      attempt();

      /* PeerJS occasionally drops the very first connection attempt, when the
         signalling handshake and the peer registration cross paths. One quiet
         retry costs nothing and turns an intermittent "room not found" into a
         connection that simply takes a moment longer. */
      retryTimer = setTimeout(() => {
        if (!settled && attempts < 2) attempt();
      }, 3000);

      connTimer = setTimeout(() => {
        fail('Reached the server, but not the room. It may be empty, or the connection is being blocked.', 'no-host');
      }, timeout);
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
  if (isHost || reclaiming || !local) return;
  reclaiming = true;

  netStatus.textContent = 'RECONNECTING';

  for (const a of remotes.values()) a.dispose();
  remotes.clear();
  connections.clear();
  renderRoster();

  if (peer) { try { peer.destroy(); } catch {} }
  peer = null;

  await new Promise(r => setTimeout(r, 300 + Math.random() * 1200));

  // The player may have hit Leave while we were waiting.
  if (!local) { reclaiming = false; return; }

  try {
    await enterRoom(roomCode, { allowHost: true });
    netStatus.textContent = '1 ONLINE';
  } catch {
    netStatus.textContent = 'DISCONNECTED';
  }

  reclaiming = false;
}

function onHostMessage(conn, msg) {
  if (msg.t === 'hello') {
    ensureRemote(conn.peer, msg.name, msg.skin);
    renderRoster();

    // Everything already in the world, so a late joiner sees the same room as
    // everyone else rather than an empty one that fills in as things move.
    conn.send({ t: 'prop-list', props: propSnapshot() });
  } else if (msg.t === 'state') {
    const avatar = ensureRemote(conn.peer, msg.n, msg.k);
    applyState(avatar, msg);
  } else if (msg.t === 'chat') {
    // Trimmed here as well as on display: the host is the one relaying, and a
    // patched client shouldn't get to push a longer line into the room.
    const text = String(msg.text || '').slice(0, CHAT_MAX);
    const avatar = ensureRemote(conn.peer, msg.n);
    avatar.say(text);

    // Relay to every other client. The sender already showed it locally, so
    // echoing it back would double the bubble.
    const packet = { t: 'chat', id: conn.peer, text };
    for (const [id, c] of connections) {
      if (id !== conn.peer && c.open) c.send(packet);
    }
  } else if (msg.t === 'typing') {
    const avatar = remotes.get(conn.peer);
    if (avatar) avatar.setTyping(msg.on);

    const packet = { t: 'typing', id: conn.peer, on: msg.on };
    for (const [id, c] of connections) {
      if (id !== conn.peer && c.open) c.send(packet);
    }
  } else if (msg.t === 'prop-spawn') {
    /* Only the host mints ids. Two clients spawning in the same frame would
       otherwise pick the same one and end up sharing a prop.

       The cooldown is re-checked here as well. A client enforces its own,
       but that copy is the one a modified build would delete first, so the
       host keeps its own clock per peer and simply ignores anything early. */
    const now = performance.now();
    const last = clientSpawnAt.get(conn.peer) || -Infinity;

    const def = PROP_BY_ID.get(msg.kind);
    if (def && now - last >= SPAWN_COOLDOWN) {
      clientSpawnAt.set(conn.peer, now);
      const id = 'p' + (++propSeq);
      addProp(id, msg.kind, msg.x, msg.y, msg.z, msg.ry);

      const packet = { t: 'prop-add', id, kind: msg.kind,
                       x: msg.x, y: msg.y, z: msg.z, ry: msg.ry };
      for (const c of connections.values()) if (c.open) c.send(packet);
    }
  } else if (msg.t === 'prop-hold') {
    /* A client is carrying this one. The holder wins over the simulation
       while they have it — anything else means fighting them at 15Hz — so
       the host takes their position and pauses physics for that prop. */
    applyPackedProp(msg.p);
    broadcastToClients(msg, conn.peer);
  } else if (msg.t === 'prop-drop') {
    applyPropDrop(msg);
    broadcastToClients(msg, conn.peer);
  } else if (msg.t === 'prop-del') {
    if (props.has(msg.id)) {
      removeProp(msg.id);
      const packet = { t: 'prop-remove', id: msg.id };
      for (const c of connections.values()) if (c.open) c.send(packet);
    }
  } else if (msg.t === 'bye') {
    clientSpawnAt.delete(conn.peer);
    dropPeer(conn.peer);
  } else if (msg.t === 'probe') {
    // Someone on the title screen asking how busy this room is. Answer with a
    // count only — the lobby list has no business publishing who is inside —
    // and create no avatar, so browsing a lobby never puts you in it.
    conn.send({ t: 'roster', count: remotes.size + 1 });
  }
}

function onClientMessage(msg) {
  if (msg.t === 'welcome') {
    myId = msg.id;
  } else if (msg.t === 'hostleaving') {
    // A courtesy warning, so takeover starts now rather than after the
    // connection eventually times out.
    onHostLost();
  } else if (msg.t === 'chat') {
    const avatar = msg.id === 'host'
      ? remotes.get('host') || ensureRemote('host', 'anon')
      : remotes.get(msg.id);
    if (avatar) avatar.say(msg.text);
  } else if (msg.t === 'typing') {
    const avatar = msg.id === 'host' ? remotes.get('host') : remotes.get(msg.id);
    if (avatar) avatar.setTyping(msg.on);
  } else if (msg.t === 'prop-list') {
    applyPropList(msg.props);
  } else if (msg.t === 'prop-add') {
    addProp(msg.id, msg.kind, msg.x, msg.y, msg.z, msg.ry);
  } else if (msg.t === 'prop-remove') {
    removeProp(msg.id);
  } else if (msg.t === 'prop-sync') {
    for (const a of msg.a) applyPackedProp(a);
  } else if (msg.t === 'prop-hold') {
    applyPackedProp(msg.p);
  } else if (msg.t === 'prop-drop') {
    applyPropDrop(msg);
  } else if (msg.t === 'snapshot') {
    const seen = new Set();

    for (const s of msg.players) {
      if (s.id === myId) continue;
      seen.add(s.id);
      applyState(ensureRemote(s.id, s.n, s.k), s);
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
    const p = new Peer(PEER_CONFIG);
    const timer = setTimeout(() => reject(new Error('probe peer timeout')), 8000);

    p.on('open', () => { clearTimeout(timer); probePeer = p; resolve(p); });
    p.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

function probeLobby(p, code) {
  return new Promise(resolve => {
    let settled = false;
    const conn = p.connect(peerIdFor(code), { reliable: true });

    const finish = count => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { conn.close(); } catch {}
      resolve(count);
    };

    // No answer means nobody is hosting, which is a valid result rather than
    // an error: the lobby is simply empty until someone walks in.
    const timer = setTimeout(() => finish(0), 3500);

    conn.on('open', () => conn.send({ t: 'probe' }));
    conn.on('data', msg => { if (msg.t === 'roster') finish(msg.count || 0); });
    conn.on('error', () => finish(0));
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
    const count = await probeLobby(p, lobby.code);
    lobbyState.set(lobby.code, { count, checked: true });
    renderLobbies();
  }
}

function renderLobbies() {
  const host = el('lobbies');
  host.innerHTML = '';

  for (const lobby of PUBLIC_LOBBIES) {
    const state = lobbyState.get(lobby.code);
    const count = state ? state.count : 0;

    const row = document.createElement('button');
    row.className = 'lobby' + (count > 0 ? ' live' : '');

    let status;
    if (!state) status = 'checking…';
    else if (count === 0) status = 'empty — be the first';
    else status = count === 1 ? '1 player' : `${count} players`;

    row.innerHTML =
      `<span class="name">${escapeHtml(lobby.name)}</span>` +
      `<span class="who">${escapeHtml(status)}</span>` +
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

function ensureRemote(id, name, skin) {
  let avatar = remotes.get(id);

  if (!avatar) {
    avatar = new Avatar(name || 'anon', false, skin || 0);
    remotes.set(id, avatar);
    renderRoster();
    return avatar;
  }

  if (name && name !== avatar.name) avatar.setName(name);
  if (Number.isInteger(skin)) avatar.setSkin(skin);
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
    k: mySkin,
    x: +local.group.position.x.toFixed(2),
    z: +local.group.position.z.toFixed(2),
    r: +local.group.rotation.y.toFixed(3),
    s: +local.speed.toFixed(2),
    j: local.jumpPhase === 'active'
  };
}

/**
 * Removes players who have stopped sending state.
 *
 * This is the safety net behind every other disconnect path. A phone that
 * closes a tab, loses signal, or is simply swiped away often never sends a
 * clean goodbye, and the connection can stay nominally open for a long time
 * afterwards — so silence, not a close event, is what actually defines
 * someone having left.
 */
function pruneStale() {
  if (!isHost) return;
  const now = performance.now();
  for (const [id, avatar] of [...remotes]) {
    if (now - avatar.lastPacket > NET_TIMEOUT) dropPeer(id);
  }
}

/* Run on a timer as well as in the render loop. Browsers throttle animation
   frames in a backgrounded tab, and on mobile they stop entirely — without
   this, a host whose phone is in their pocket would freeze its roster and
   keep reporting players who left minutes ago. */
setInterval(pruneStale, 1500);

function stepNetwork(dt) {
  if (!peer) return;

  netAccumulator += dt;
  if (netAccumulator < 1 / NET_HZ) return;
  netAccumulator = 0;

  if (isHost) {
    pruneStale();

    const players = [{ id: 'host', n: myName, ...stripType(localState()) }];
    for (const [id, a] of remotes) {
      players.push({
        id, n: a.name, k: a.skin,
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

    broadcastProps();
  } else {
    const conn = connections.get('host');
    if (conn && conn.open) conn.send(localState());
  }

  netStatus.textContent = `${remotes.size + 1} ONLINE`;
}

/**
 * Tells the room we're going, then tears the session down.
 *
 * The goodbye is best-effort — a closing tab may not get the packet out, which
 * is exactly why the host also prunes on silence. Sending it anyway makes the
 * common case (pressing Leave) instant instead of a three-second fade.
 */
function sayGoodbye() {
  if (!peer) return;

  try {
    if (isHost) {
      for (const conn of connections.values()) {
        if (conn.open) conn.send({ t: 'hostleaving' });
      }
    } else {
      const conn = connections.get('host');
      if (conn && conn.open) conn.send({ t: 'bye' });
    }
  } catch {}
}

function teardownNetwork() {
  sayGoodbye();

  for (const conn of connections.values()) {
    try { conn.close(); } catch {}
  }
  connections.clear();

  if (peer) { try { peer.destroy(); } catch {} }
  peer = null;
  isHost = false;
  roomCode = null;
  myId = null;
}

function leaveGame() {
  reclaiming = false;
  closeChat();
  closeInternet(false);          // no relock; we're going back to the title
  clearProps();
  teardownNetwork();

  for (const a of remotes.values()) a.dispose();
  remotes.clear();

  if (local) { local.dispose(); local = null; }

  if (renderer) renderer.setAnimationLoop(null);

  // Reset per-session state so a second visit doesn't inherit the first.
  camReady = false;
  keys.clear();
  stick.id = null;
  stick.x = stick.y = 0;
  look.id = null;
  yaw = yawTarget = 0;
  pitch = pitchTarget = 0.26;
  headingTarget = 0;

  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.remove('playing');

  clickLayer.classList.add('hidden');
  roomTag.classList.add('hidden');
  rosterEl.classList.add('hidden');
  netStatus.classList.add('hidden');
  el('hud').classList.add('hidden');
  el('touch').classList.add('hidden');
  el('stick').classList.add('hidden');

  titleScreen.classList.remove('hidden');
  titleStatus.textContent = '';
  lobbyState.clear();
  startLobbyPolling();
}

/* A closed tab, a swiped-away browser, or a phone going to sleep. pagehide is
   the one that fires reliably on iOS; beforeunload does not. */
addEventListener('pagehide', () => teardownNetwork());
addEventListener('beforeunload', () => teardownNetwork());

/* --------------------------------------------------------------------------
   Chat
   Messages are their own event rather than a field on the state packet: state
   goes out fifteen times a second and is fine to lose, whereas a line of chat
   is sent once and has to arrive.
   -------------------------------------------------------------------------- */

let chatOpen = false;
let lastChatAt = 0;
let typingSent = false;
let typingIdle = null;

/* Broadcast only on change, and stop automatically after a pause. Sending a
   packet per keystroke would put more traffic on the wire than the game state
   itself, and a player who opens chat then wanders off would otherwise leave
   the dots hanging over their head indefinitely. */
function setTypingState(on) {
  clearTimeout(typingIdle);

  if (on) {
    typingIdle = setTimeout(() => setTypingState(false), 4000);
  }

  if (on === typingSent) return;
  typingSent = on;

  if (!peer) return;

  if (isHost) {
    const packet = { t: 'typing', id: 'host', on };
    for (const conn of connections.values()) if (conn.open) conn.send(packet);
  } else {
    const conn = connections.get('host');
    if (conn && conn.open) conn.send({ t: 'typing', on });
  }
}

let chatIdle = null;

/* The bar closes itself after a stretch of silence, so an abandoned compose
   box doesn't sit over the game forever. Every keystroke pushes it back. */
function touchChatIdle() {
  clearTimeout(chatIdle);
  chatIdle = setTimeout(closeChat, CHAT_IDLE);
}

/* Enables the send arrow only when there is something to send, the way the
   real thing does — an always-live button invites a tap that does nothing. */
function syncSend() {
  const cooling = performance.now() - lastChatAt < CHAT_COOLDOWN;
  el('chatsend').disabled = cooling || el('chatinput').value.trim().length === 0;
}

/* exitPointerLock() is asynchronous. The browser tears the lock down on a
   later task and hands focus back to the document body when it finishes —
   which is *after* the synchronous focus() call in openChat, so the field
   quietly loses the caret a frame later. Typing then falls through to the
   movement handler: the letters never appear and WASD walks the character
   away instead. Re-assert focus across the next couple of frames. */
function focusChatInput() {
  const input = el('chatinput');
  const grab = () => { if (chatOpen) input.focus({ preventScroll: true }); };

  grab();
  requestAnimationFrame(grab);
  setTimeout(grab, 60);
}

function openChat() {
  if (chatOpen || !local) return;
  chatOpen = true;

  keys.clear();                        // don't keep running while typing
  if (document.pointerLockElement) document.exitPointerLock();

  // A fresh box every time. Whatever was half-typed when the bar timed out is
  // stale by now, and reopening onto someone else's abandoned sentence is
  // worse than starting clean.
  const input = el('chatinput');
  input.value = '';
  syncSend();

  // Reopening inside the cooldown still needs the arrow to come back on its
  // own, without waiting for a keystroke to trigger the next syncSend.
  const left = CHAT_COOLDOWN - (performance.now() - lastChatAt);
  if (left > 0) armCooldownRelease(left);

  el('chatbar').classList.remove('hidden');
  focusChatInput();
  touchChatIdle();
}

function closeChat() {
  if (!chatOpen) return;
  chatOpen = false;
  clearTimeout(chatIdle);
  setTypingState(false);

  el('chatinput').blur();
  el('chatinput').value = '';
  el('chatbar').classList.add('hidden');
  el('chatbar').classList.remove('cooling');
  syncSend();

  // Take the mouse back, but only on desktop — a phone never had the lock.
  if (!IS_TOUCH && relockPointer) relockPointer();
}

function sendChat() {
  const input = el('chatinput');
  const text = input.value.trim().slice(0, CHAT_MAX);

  if (!text) { input.value = ''; closeChat(); return; }

  /* The cooldown holds the message rather than dropping it. Silently eating a
     line someone actually typed is the worse failure — they don't find out
     until nobody answers. Refusing out loud and leaving the text in the box
     means the only cost of talking too fast is waiting a beat. */
  const now = performance.now();
  const wait = CHAT_COOLDOWN - (now - lastChatAt);

  if (wait > 0) {
    flashCooldown(wait);
    touchChatIdle();
    return;
  }

  input.value = '';
  lastChatAt = now;

  if (local) local.say(text);
  broadcastChat(text);

  // Every send closes the bar. T brings it back.
  closeChat();
}

/* Marks the compose bar as rate-limited and counts the block down in place,
   so a held Enter reads as "not yet" instead of as a dead key. */
let cooldownTimer = null;

/** Re-enables the send arrow the moment the block lapses. */
function armCooldownRelease(wait) {
  clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    el('chatbar').classList.remove('cooling');
    if (chatOpen) syncSend();
  }, Math.ceil(wait));
}

function flashCooldown(wait) {
  const bar = el('chatbar');

  bar.classList.remove('cooling');
  void bar.offsetWidth;                 // restart the nudge if it's already running
  bar.classList.add('cooling');
  el('chatsend').disabled = true;

  armCooldownRelease(wait);
}

function broadcastChat(text) {
  if (!peer) return;

  if (isHost) {
    const packet = { t: 'chat', id: 'host', text };
    for (const conn of connections.values()) {
      if (conn.open) conn.send(packet);
    }
  } else {
    const conn = connections.get('host');
    if (conn && conn.open) conn.send({ t: 'chat', text });
  }
}

function bindChat() {
  // Clicking the bar anywhere puts the caret back, so a stray click on the
  // padding around the field never leaves you typing into nothing.
  el('chatbar').addEventListener('mousedown', e => {
    if (e.target === el('chatsend') || el('chatsend').contains(e.target)) return;
    e.preventDefault();
    focusChatInput();
  });

  // mousedown, not click: the default would blur the input first, and on some
  // browsers that closes the phone keyboard a frame before the send lands.
  el('chatsend').addEventListener('mousedown', e => e.preventDefault());
  el('chatsend').addEventListener('click', sendChat);
  el('chatsend').addEventListener('touchstart', e => {
    e.preventDefault();
    sendChat();
  }, { passive: false });

  el('chatinput').addEventListener('input', () => {
    setTypingState(el('chatinput').value.trim().length > 0);
    syncSend();
    touchChatIdle();
  });

  el('chatinput').addEventListener('keydown', e => {
    e.stopPropagation();
    touchChatIdle();
    if (e.key === 'Enter') sendChat();
    else if (e.key === 'Escape') closeChat();
  });

  /* T, and only T, opens chat on desktop. The bar closes on every send, so
     this is also the key you come back through after each message.

     Enter used to open it too, and carried a trap worth naming: a browser
     fires a click on whatever button currently holds focus when Enter is
     pressed, so after leaving the pause menu with the mouse, Enter would
     silently re-open it. T has no such conflict, which is why it is now the
     single opener. The activeElement check keeps it from firing while the
     player is typing their name on the title screen. */
  addEventListener('keydown', e => {
    if (chatOpen || !local) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.code === 'KeyT') { e.preventDefault(); openChat(); }
    if (e.code === 'KeyM') { e.preventDefault(); toggleMute(); }
  });

  el('btn-chat').addEventListener('touchstart', e => {
    e.preventDefault();
    e.stopPropagation();
    openChat();
  }, { passive: false });

  el('btn-chat').addEventListener('click', e => { e.preventDefault(); openChat(); });

  el('btn-net').addEventListener('touchstart', e => {
    e.preventDefault();
    e.stopPropagation();
    openInternet();
  }, { passive: false });

  el('btn-net').addEventListener('click', e => { e.preventDefault(); openInternet(); });

  /* Held, like the mouse button. The ray comes from the centre of the screen
     either way, so on touch you aim by turning rather than by pointing. */
  const grabBtn = el('btn-grab');

  grabBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    e.stopPropagation();
    grabProp();
  }, { passive: false });

  grabBtn.addEventListener('touchend', e => {
    e.preventDefault();
    e.stopPropagation();
    releaseProp();
  }, { passive: false });

  /* On a phone the keyboard covers the bottom of the screen, including the
     field being typed into. visualViewport reports the space actually left
     visible, so the bar can be lifted to sit just above it. */
  if (window.visualViewport) {
    const lift = () => {
      if (!chatOpen) return;
      const vv = window.visualViewport;
      const hidden = Math.max(0, innerHeight - vv.height - vv.offsetTop);
      el('chatbar').style.transform = `translateY(${-hidden}px)`;
    };

    visualViewport.addEventListener('resize', lift);
    visualViewport.addEventListener('scroll', lift);
  }
}

function stripType(s) {
  const { t, ...rest } = s;
  return rest;
}

function renderRoster() {
  if (!peer) return;
  const n = remotes.size + 1;
  rosterEl.innerHTML =
    `<div class="head">PLAYERS</div><div class="tally">${n}</div>`;
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
      bindChat();
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
      await startClient(code, { timeout: 12000 });
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

  local = new Avatar(myName, true, mySkin);

  loadScreen.classList.add('hidden');
  document.body.classList.add('playing');

  if (IS_TOUCH) {
    el('touch').classList.remove('hidden');
  } else {
    clickLayer.classList.remove('hidden');
    el('hud').classList.remove('hidden');
  }

  const lobby = PUBLIC_LOBBIES.find(l => l.code === roomCode);

  if (mode !== 'solo') {
    el('roomcode').textContent = lobby ? lobby.name.toUpperCase() : roomCode;
    roomTag.querySelector('.label').textContent = lobby ? 'LOBBY' : 'ROOM';
    el('btn-copy').classList.toggle('hidden', !!lobby);
    roomTag.classList.remove('hidden');
    netStatus.classList.remove('hidden');
    renderRoster();
  } else {
    // Solo still needs a way out, so the tag stays — just without a code.
    el('roomcode').textContent = 'SOLO';
    roomTag.querySelector('.label').textContent = '';
    el('btn-copy').classList.add('hidden');
    roomTag.classList.remove('hidden');
  }

  renderer.setAnimationLoop(tick);
}

el('btn-solo').addEventListener('click', () => enterGame('solo'));
el('btn-host').addEventListener('click', () => enterGame('host', makeCode()));

/* --------------------------------------------------------------------------
   Skin picker
   -------------------------------------------------------------------------- */

function renderSkins() {
  const host = el('skins');
  host.innerHTML = '';

  SKINS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'skin';
    b.type = 'button';
    b.title = s.name;
    b.setAttribute('aria-label', s.name);
    b.setAttribute('aria-pressed', String(i === mySkin));
    b.innerHTML = `<i style="--swatch:#${s.color.toString(16).padStart(6, '0')}"></i>`;

    b.addEventListener('click', () => {
      mySkin = i;
      try { localStorage.setItem('anon.skin', String(i)); } catch {}
      renderSkins();
      // Applies immediately if a session is somehow already running.
      if (local) local.setSkin(i);
    });

    host.appendChild(b);
  });

  el('skin-name').textContent = SKINS[mySkin].name;
}

try {
  const saved = parseInt(localStorage.getItem('anon.skin'), 10);
  if (Number.isInteger(saved) && saved >= 0 && saved < SKINS.length) mySkin = saved;
} catch {}

renderSkins();
buildInternet();

el('buildtag').textContent = 'build ' + BUILD;

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

el('btn-resume').addEventListener('click', e => {
  e.stopPropagation();
  e.currentTarget.blur();   // else Enter would re-click it and re-open the menu
  if (renderer) renderer.domElement.requestPointerLock();
});

el('btn-quit').addEventListener('click', e => {
  e.stopPropagation();
  e.currentTarget.blur();
  leaveGame();
});

// The in-game leave button, for touch where there is no pause menu.
el('btn-net-close').addEventListener('click', () => closeInternet());

el('btn-leave').addEventListener('click', leaveGame);
el('btn-leave').addEventListener('touchstart', e => {
  e.preventDefault();
  e.stopPropagation();
  leaveGame();
}, { passive: false });


/* --------------------------------------------------------------------------
   Audio unlock

   An AudioContext created outside a user gesture starts suspended, and on
   iOS one created at load never starts at all — so it is built on the first
   real interaction instead. These stay bound rather than firing once,
   because a context also suspends when the tab is backgrounded and has to be
   resumed on the way back in. Both calls are cheap no-ops after the first.
   -------------------------------------------------------------------------- */

function unlockAudio() {
  sfx.init();
  sfx.resume();
}

addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
addEventListener('touchstart', unlockAudio, { passive: true });
addEventListener('visibilitychange', () => { if (!document.hidden) sfx.resume(); });

/** M toggles sound. The HUD carries the only indicator it needs. */
function toggleMute() {
  sfx.setMuted(!sfx.muted);
  el('mutehint').textContent = sfx.muted ? ' · SOUND OFF' : '';
}
