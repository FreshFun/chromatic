/* ==========================================================================
   ANON — game logic
   ========================================================================== */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MODELS, toBuffer } from './assets.js';

/* Printed on load and shown on the title screen, so it's obvious at a glance
   whether the browser is running current code or a cached copy. */
const BUILD = 'v27 nospin';
console.log('ANON build:', BUILD);

/* Two ways to stop the character slewing left and right as it runs, and only
   one of them can be on at a time.

   STRIP_HIP_YAW edits the clip, zeroing the hip bone's rotation about its own
   local Y. That only works if the rig's hips are bound Y-up. When they are
   not, it removes a lean and leaves the swivel behind — which is what was
   happening here, and why the swing survived it being switched on.

   CANCEL_HIP_YAW measures the hips' actual yaw relative to the character every
   frame and counter-rotates a pivot under the group. It costs one quaternion
   read per avatar per frame and does not care how the rig was authored.

   If the run ever looks stiff, these are the two switches to try. */
const STRIP_HIP_YAW  = false;
const CANCEL_HIP_YAW = true;

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

/* Skins. Colour alone isn't enough to make a tinted metal read correctly:
   a fully metallic surface shows almost nothing but its reflections, so a red
   one just looks like grey with a blush. Each skin therefore carries its own
   metalness, letting the coloured ones keep enough diffuse to actually look
   red or green while Metal and Gold stay properly reflective. */
const SKINS = [
  { id: 'metal',   name: 'Metal',   color: 0xa9b1bb, metal: 0.62, rough: 0.34 },
  { id: 'crimson', name: 'Crimson', color: 0xb42f2f, metal: 0.48, rough: 0.32 },
  { id: 'cobalt',  name: 'Cobalt',  color: 0x2a55c0, metal: 0.48, rough: 0.32 },
  { id: 'emerald', name: 'Emerald', color: 0x1d9160, metal: 0.48, rough: 0.32 },
  { id: 'gold',    name: 'Gold',    color: 0xd8a52c, metal: 0.78, rough: 0.28 },
  { id: 'dorfic',  name: 'Dorfic',  color: 0xdc6a24, metal: 0.50, rough: 0.32 }
];

/* How strongly the environment reflects off every skin. This is the global
   shine dial — raise for glossier, lower for flatter. */
const ENV_INTENSITY = 1.45;

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
const CHAT_COOLDOWN = 700;    // minimum gap between messages, in ms
const CHAT_BURST    = 3;      // messages that may be sent back-to-back
const CHAT_IDLE     = 10000;  // compose bar closes itself after this silence

/* --------------------------------------------------------------------------
   Chat rate limiting

   A token bucket rather than a flat "one message per 700ms" rule, because a
   flat rule punishes normal conversation: people genuinely do fire off three
   short lines in a row, and blocking the second one feels broken. The bucket
   allows that burst, then throttles to one message per cooldown until it
   refills.

   It runs on incoming messages too, keyed per peer, not only on your own
   sends. A cooldown enforced solely in the sender's client is not a limit at
   all — anyone running modified code could ignore it — so the host applies the
   same bucket before relaying, and every client applies it again on receipt.
   -------------------------------------------------------------------------- */

const chatBuckets = new Map();   // peer id -> { tokens, last }

function allowChat(id) {
  const now = performance.now();
  let b = chatBuckets.get(id);

  if (!b) {
    b = { tokens: CHAT_BURST, last: now };
    chatBuckets.set(id, b);
  }

  b.tokens = Math.min(CHAT_BURST, b.tokens + (now - b.last) / CHAT_COOLDOWN);
  b.last = now;

  if (b.tokens < 1) return false;

  b.tokens -= 1;
  return true;
}

/** Milliseconds until this sender may speak again; 0 when they may now. */
function chatWait(id) {
  const b = chatBuckets.get(id);
  if (!b) return 0;

  const tokens = Math.min(CHAT_BURST, b.tokens + (performance.now() - b.last) / CHAT_COOLDOWN);
  return tokens >= 1 ? 0 : Math.ceil((1 - tokens) * CHAT_COOLDOWN);
}
const BUBBLE_GAP    = 0.42;   // how far the lowest bubble floats above the head
const BUBBLE_STACK_MAX = 3;   // messages kept on screen before the oldest drops
const BUBBLE_STACK_GAP = 0.06;// vertical space between stacked messages
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

/* Scratch for the per-frame hip measurement in Avatar.cancelHipYaw. */
const _qHip = new THREE.Quaternion();
const _qGrp = new THREE.Quaternion();
const _qRel = new THREE.Quaternion();
const _eRel = new THREE.Euler(0, 0, 0, 'YXZ');

/* Where each bone is parked horizontally, captured from the first clip
   processed (idle, the rest pose) and reused by every clip after it, so no two
   clips can disagree about where any part of the body sits.

   Keyed by bone name rather than kept for the hips alone: which node carries
   the baked travel depends entirely on how the FBX was exported, and on this
   rig it is neither "root" nor "hips" but the Armature itself — which fell
   through every name test and kept its own clip's offset. */
const restPos = new Map();

const isRootBone = b => {
  const n = b.toLowerCase();
  return n === 'root' || n === 'armature';
};

const isHipBone = b => {
  const n = b.toLowerCase();
  return n === 'pelvis' || n === 'hips' || n.endsWith(':hips') || n === 'hip';
};

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

  const isRoot = isRootBone;
  const isHip  = isHipBone;

  for (const track of clip.tracks) {
    const bone = boneOf(track.name);
    const v = track.values;

    if (track.name.endsWith('.position')) {
      /* Every position track is flattened, not just the ones on bones named
         "root" or "hips". Which node carries the baked travel varies with how
         the FBX was exported, and filtering by name let it back in on this rig
         — the character then slid away from where the script thought it was.
         Flattening everything horizontally is the safe move: no bone in a
         humanoid rig should be translating sideways on its own anyway.

         Pinned to one shared point per bone, captured from the first clip
         loaded — idle, which is a rest pose. NOT to the clip's own average.

         The average is only the centre of the stride on a clip that stays put.
         On a clip with travel baked in it is halfway down the runway: this
         rig's run clip walks its root 580 units forward, so its mean lands
         about 250 units — roughly a metre at final scale — ahead of where idle
         parks the same bone. Pinning to that put the rendered body a metre in
         front of the position the camera, the shadow and the network all
         follow. Because the offset lives in the character's own frame it
         swung around that point on every turn, and appeared and disappeared as
         the mixer blended run in and out — a character that lurches away from
         where it should be and snaps back. One shared point instead means the
         body sits over its origin in every clip and at every blend weight.

         Y is left alone: the vertical bob is small, it is the same in idle and
         run, and the jump clip's own rise is wanted on top of the physics. */
      if (!restPos.has(bone)) restPos.set(bone, [v[0], v[2]]);
      const [px, pz] = restPos.get(bone);

      for (let i = 0; i < v.length; i += 3) {
        v[i] = px;
        v[i + 2] = pz;
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

  scene.add(new THREE.HemisphereLight(0xe4eefb, 0x7a7466, 1.2));

  sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
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
  const rim = new THREE.DirectionalLight(0xbcd4f0, 0.7);
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
   Speech bubbles

   Drawn to a small offscreen canvas and shown as a sprite in the world, not
   as an HTML overlay. That is the whole point: the scene renders at a
   fraction of screen resolution and is scaled back up with nearest-neighbour
   filtering, so anything living inside it inherits the chunky pixel grid.
   A DOM bubble would float above that, crisp and smooth, and look pasted on.

   The canvas is deliberately small — roughly one texel per rendered pixel —
   and filtered with NearestFilter so nothing is ever smoothed.
   -------------------------------------------------------------------------- */

const BUBBLE_BLUE   = '#0a84ff';
const BUBBLE_GREY   = '#3a3f47';
const BUBBLE_TEXT   = '#ffffff';
const BUBBLE_PAD_X  = 9;
const BUBBLE_PAD_Y  = 7;
const BUBBLE_RADIUS = 9;
const BUBBLE_TAIL   = 7;
const BUBBLE_FONT   = 'bold 12px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const BUBBLE_LINE   = 15;
const BUBBLE_WRAP   = 220;     // max text width in canvas pixels
const BUBBLE_LINES  = 8;       // enough rows to hold a full 150-character message
const BUBBLE_SCALE  = 0.0095;  // canvas pixels to world units

/* Slack on every side of the canvas. Without it the tail tip lands on exactly
   the last row of pixels and gets shaved off, and anything that hangs left of
   the body has nowhere to go at all. The sprite anchor is corrected for this
   below, so adding margin moves nothing on screen — it only stops clipping. */
const BUBBLE_MARGIN = 4;

/* The scene renders at half resolution, so a bubble sized in world units gets
   *minified* on its way to the screen: a texture around 200px wide lands on
   perhaps 60 buffer pixels. Sampling that 1:1 with a nearest filter throws
   away two of every three columns, and since the bubble resizes with each
   character typed, a different set of columns survives every keystroke. That
   is what made the text appear to stretch and crawl as it was typed.

   The canvas is drawn at this multiple instead and filtered down properly, so
   the glyphs stay put. Drawing coordinates below are unchanged — the context
   is scaled once, and the sprite still sizes itself from the logical
   dimensions, so this is purely a sampling fix. */
const BUBBLE_SS = 3;

/** Rounded rectangle path, since older canvas builds lack roundRect. */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  ctx.font = BUBBLE_FONT;
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const test = line ? line + ' ' + word : word;

    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }

    if (line) lines.push(line);

    // A single word too long to fit is broken by character rather than
    // allowed to overflow the bubble.
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
    } else {
      let chunk = '';
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
  }

  if (line) lines.push(line);

  // A message longer than the bubble can hold is marked as cut rather than
  // quietly losing its tail, so the reader knows to ask.
  if (lines.length > BUBBLE_LINES) {
    const kept = lines.slice(0, BUBBLE_LINES);
    kept[BUBBLE_LINES - 1] = kept[BUBBLE_LINES - 1].replace(/.$/, '…');
    return kept;
  }

  return lines;
}

class Bubble {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);

    /* Nearest filtering is right for the world, which is authored at the
       buffer's own resolution. It is wrong for the bubble, which is drawn
       larger than it lands and therefore needs minification rather than
       magnification. Mipmaps give the downscale something stable to sample. */
    this.texture.magFilter = THREE.LinearFilter;

    /* Mipmaps on a non-power-of-two texture are only legal under WebGL2. On a
       WebGL1 fallback asking for them yields a black sprite, so drop to a
       plain linear minify there — still stable, just slightly softer. */
    const gl2 = renderer && renderer.capabilities.isWebGL2;
    this.texture.minFilter = gl2
      ? THREE.LinearMipmapLinearFilter
      : THREE.LinearFilter;
    this.texture.generateMipmaps = !!gl2;
    this.texture.anisotropy = renderer
      ? renderer.capabilities.getMaxAnisotropy()
      : 1;

    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,      // never buried inside the character's own head
      depthWrite: false
    });

    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    this.sprite.center.set(0.5, 0);   // anchor at the tail, so it grows upward

    parent.add(this.sprite);

    this.mode = null;      // 'text' | 'typing'
    this.text = '';
    this.phase = 0;
    this.clock = 0;
  }

  showText(text) {
    this.mode = 'text';
    this.text = text;
    this.draw();
    this.sprite.visible = true;
  }

  showTyping() {
    if (this.mode === 'text') return;   // a real message outranks the dots
    this.mode = 'typing';
    this.phase = 0;
    this.clock = 0;
    this.draw();
    this.sprite.visible = true;
  }

  hide() {
    this.mode = null;
    this.sprite.visible = false;
  }

  /** Advances the typing animation. Only redraws when the dots change. */
  update(dt) {
    if (this.mode !== 'typing') return;

    this.clock += dt;
    if (this.clock < 0.22) return;

    this.clock = 0;
    this.phase = (this.phase + 1) % 4;
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    ctx.font = BUBBLE_FONT;

    let w, h, lines = null;

    if (this.mode === 'typing') {
      w = 46;
      h = 26;
    } else {
      lines = wrapText(ctx, this.text, BUBBLE_WRAP);
      let widest = 0;
      for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
      w = Math.ceil(widest) + BUBBLE_PAD_X * 2;
      h = lines.length * BUBBLE_LINE + BUBBLE_PAD_Y * 2;
    }

    const M = BUBBLE_MARGIN;

    // Logical size: what the bubble measures in world terms. The backing store
    // is BUBBLE_SS times larger in each axis, but nothing below needs to know.
    const cw = w + M * 2;
    const ch = h + BUBBLE_TAIL + M * 2;

    this.canvas.width = cw * BUBBLE_SS;
    this.canvas.height = ch * BUBBLE_SS;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Resizing a canvas resets its context, so the transform has to come after
    // the assignments above. setTransform applies the supersample scale and
    // the margin offset in one step; everything below then draws in
    // bubble-local coordinates and lands inside the padding.
    ctx.setTransform(BUBBLE_SS, 0, 0, BUBBLE_SS, M * BUBBLE_SS, M * BUBBLE_SS);
    ctx.font = BUBBLE_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const fill = this.mode === 'typing' ? BUBBLE_GREY : BUBBLE_BLUE;

    // Body.
    ctx.fillStyle = fill;
    roundRect(ctx, 0, 0, w, h, BUBBLE_RADIUS);
    ctx.fill();

    // Tail, pointing down at the character.
    ctx.beginPath();
    ctx.moveTo(w / 2 - BUBBLE_TAIL, h - 1);
    ctx.lineTo(w / 2, h + BUBBLE_TAIL);
    ctx.lineTo(w / 2 + BUBBLE_TAIL, h - 1);
    ctx.closePath();
    ctx.fill();

    if (this.mode === 'typing') {
      // Three dots, one lifting at a time.
      const cx = w / 2;
      const cy = h / 2;
      for (let i = 0; i < 3; i++) {
        const lift = this.phase === i ? -2 : 0;
        ctx.globalAlpha = this.phase === i ? 1 : 0.55;
        ctx.fillStyle = BUBBLE_TEXT;
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * 11, cy + lift, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = BUBBLE_TEXT;
      lines.forEach((line, i) => {
        ctx.fillText(line, w / 2, BUBBLE_PAD_Y + BUBBLE_LINE * i + BUBBLE_LINE / 2);
      });
    }

    this.texture.needsUpdate = true;
    this.sprite.scale.set(cw * BUBBLE_SCALE, ch * BUBBLE_SCALE, 1);

    // The anchor tracks the tail tip, which now sits BUBBLE_MARGIN above the
    // bottom edge rather than on it. Without this the whole bubble would rise
    // by the margin every time the canvas grew.
    this.sprite.center.set(0.5, M / ch);
  }

  dispose() {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }
}

/* --------------------------------------------------------------------------
   Avatar
   Wraps one character instance: model, mixer, animation weights, name tag.
   The same class drives the local player and every remote one; only who sets
   its position differs.
   -------------------------------------------------------------------------- */

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

    this.setSkin(skin);

    // Normalize height, then sit the feet on the ground.
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    model.scale.setScalar(h > 0.001 ? 1.8 / h : 1);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;

    /* The model hangs off a pivot rather than the group directly. The pivot is
       what counter-rotates each frame to cancel the clip's whole-body swivel;
       the group keeps the character's real facing, and the name tag and chat
       bubbles hang off the group so they never counter-rotate with it. */
    this.pivot = new THREE.Group();
    this.pivot.add(model);

    this.group = new THREE.Group();
    this.group.add(this.pivot);
    scene.add(this.group);
    this.model = model;
    this.tagY = TAG_HEIGHT;
    this.tagClock = 0;

    // The bone whose yaw gets cancelled, and the reference yaw to hold it at.
    this.hips = null;
    this.hipYaw0 = null;
    model.traverse(o => {
      if (!this.hips && o.isBone && isHipBone(o.name)) this.hips = o;
    });

    // Chat state: a stack of recent messages, plus the typing dots.
    this.bubbles = [];
    this.typingBubble = null;
    this.typing = false;

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

  /* Chat bubbles are kept as a stack rather than a single reusable one, so a
     second message pushes the first upward instead of replacing it — the
     short back-and-forth of a real conversation stays readable. Newest sits
     last in the array and nearest the head. Older entries drop off the top
     once STACK_MAX is reached, and each expires on its own clock. */
  say(text) {
    const msg = String(text).slice(0, CHAT_MAX).trim();
    if (!msg) return;

    this.typing = false;
    if (this.typingBubble) this.typingBubble.hide();

    const b = new Bubble(this.group);
    b.showText(msg);
    b.expiresAt = performance.now() + CHAT_LIFETIME;
    this.bubbles.push(b);

    while (this.bubbles.length > BUBBLE_STACK_MAX) {
      this.bubbles.shift().dispose();
    }
  }

  /** The three animated dots, shown while someone is composing. */
  setTyping(on) {
    this.typing = !!on;

    if (on) {
      if (!this.typingBubble) this.typingBubble = new Bubble(this.group);
      this.typingBubble.showTyping();
    } else if (this.typingBubble) {
      this.typingBubble.hide();
    }
  }

  /**
   * Retires expired bubbles and stacks whatever is left. Positions are
   * recomputed every frame rather than set once, because a bubble above can
   * disappear at any moment and the ones below it have to close the gap.
   */
  stepBubbles(dt) {
    const now = performance.now();

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      if (this.bubbles[i].expiresAt <= now) this.bubbles.splice(i, 1)[0].dispose();
    }

    if (!this.bubbles.length && !this.typingBubble) return;

    // A remote player carries a name tag under the stack and needs the extra
    // clearance; your own head does not.
    let y = HEAD_TOP + (this.tag ? TAG_CLEARANCE + BUBBLE_GAP : BUBBLE_GAP * 0.4);

    /* The dots belong at the bottom, right above the head, because that is
       where the next message will appear. */
    if (this.typingBubble) {
      this.typingBubble.update(dt);
      if (this.typingBubble.sprite.visible) {
        this.typingBubble.sprite.position.y = y;
        y += this.typingBubble.sprite.scale.y + BUBBLE_STACK_GAP;
      }
    }

    /* Walking backwards through the array puts the newest message lowest and
       carries the older ones up above it. */
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.sprite.position.y = y;
      y += b.sprite.scale.y + BUBBLE_STACK_GAP;

      // Older messages recede slightly, so the newest one reads first.
      const age = this.bubbles.length - 1 - i;
      b.material.opacity = age === 0 ? 1 : Math.max(0.45, 1 - age * 0.28);
    }
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
    this.cancelHipYaw();
  }

  /**
   * Removes the clip's whole-body swivel by measurement rather than by editing
   * the keyframes.
   *
   * Editing the clip meant assuming the hip bone's local Y axis is "up". On a
   * rig whose hips have a rotated bind pose that assumption is wrong: zeroing
   * local Y strips a lean and leaves the actual swivel untouched, which is why
   * the character kept swinging with STRIP_HIP_YAW on.
   *
   * This reads the hips' orientation relative to the group — real world-space
   * yaw, whatever the rig's conventions — and turns the pivot the other way.
   * The reference is whatever the hips read on the very first frame, so the
   * bind orientation is preserved and only the per-stride *variation* is
   * cancelled. Legs keep swinging; the torso stops slewing left and right.
   */
  cancelHipYaw() {
    if (!CANCEL_HIP_YAW || !this.hips) return;

    this.hips.getWorldQuaternion(_qHip);
    this.group.getWorldQuaternion(_qGrp);
    _qRel.copy(_qGrp).invert().multiply(_qHip);

    // YXZ so the first component read out is the rotation about up.
    _eRel.setFromQuaternion(_qRel, 'YXZ');

    if (this.hipYaw0 === null) {
      this.hipYaw0 = _eRel.y;      // the rest orientation; keep it
      return;
    }

    /* _eRel.y already includes whatever the pivot is currently applying, so
       subtracting the error drives it to zero rather than compounding. */
    let err = _eRel.y - this.hipYaw0;
    while (err >  Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    this.pivot.rotation.y -= err;
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
    this.stepBubbles(dt);

    // A local player has no tag, and the bubbles no longer depend on the
    // measurement, so there is nothing left to do for them here.
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
    for (const b of this.bubbles) b.dispose();
    this.bubbles.length = 0;
    if (this.typingBubble) this.typingBubble.dispose();
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

    /* From a standstill the heading is taken outright rather than eased into.
       It is only meaningful while moving, so after a stop it still holds
       whichever way the last run ended — and easing out of that means the first
       fraction of a second of every fresh start is spent travelling the old
       way at a speed that is already ramping up. Turn the camera around, push
       off, and the character sets out backwards for a quarter second and
       curves round. Smoothing is for steering mid-run, not for the first
       frame, where there is nothing yet to smooth against. */
    if (local.speed < 0.05) {
      headingTarget = want;
    } else {
      let d = want - headingTarget;
      while (d >  Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;

      headingTarget += d * (1 - Math.exp(-HEADING_SMOOTH * dt));
    }
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

  local.stepJump(dt);
  local.stepAnimation(dt);
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

  /* YXZ, not the default XYZ. Three's XYZ order builds the rotation as
     Rx·Ry·Rz, which applies pitch *before* yaw — so once the camera is tilted
     at all, turning swings it around a tilted axis and the horizon rolls. The
     view slides sideways as you turn and the character appears to shift across
     the frame. YXZ applies yaw first and pitch on top of it, which is the
     orbit-camera convention and keeps the horizon level at any pitch.

     Default pitch here is 0.26rad, so this was never not happening. */
  camera.rotation.set(-pitch, yaw + Math.PI, 0, 'YXZ');
}

/* --------------------------------------------------------------------------
   Frame loop
   -------------------------------------------------------------------------- */

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  stepLocal(dt);
  for (const avatar of remotes.values()) avatar.stepRemote(dt);
  stepCamera(dt);

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
    if (chatOpen) return;
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

      /* Chat no longer releases the lock, so reaching here while chatOpen
         means something else took it — an Escape press, or the tab losing
         focus. Close the bar rather than leaving it stranded over the menu. */
      if (chatOpen) closeChat();

      clickLayer.classList.toggle('hidden', pointerLocked);

      // Escape releases the cursor, which is the browser's own shortcut and
      // can't be intercepted — so treat losing the lock as opening a pause
      // menu rather than as an accident.
      el('pause-title').textContent = 'Paused';

      if (pointerLocked) ignoreNextMove = true;
      else keys.clear();
    });
  }

  addEventListener('mousemove', e => {
    if (!pointerLocked) return;

    // The lock is deliberately kept during chat, so the camera has to be held
    // still here instead. This is what replaces the old exitPointerLock call.
    if (chatOpen) return;

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
  } else if (msg.t === 'state') {
    const avatar = ensureRemote(conn.peer, msg.n, msg.k);
    applyState(avatar, msg);
  } else if (msg.t === 'chat') {
    // Enforced here, not just in the sender's client — a modified peer can
    // ignore its own cooldown, but it cannot make the host relay the flood.
    if (!allowChat(conn.peer)) return;

    const avatar = ensureRemote(conn.peer, msg.n);
    avatar.say(msg.text);

    // Relay to every other client. The sender already showed it locally, so
    // echoing it back would double the bubble.
    const packet = { t: 'chat', id: conn.peer, text: msg.text };
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
  } else if (msg.t === 'bye') {
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
    // Applied again on receipt: the host does the room-wide limiting, but a
    // client should not be at its mercy.
    if (!allowChat(msg.id || 'host')) return;

    const avatar = msg.id === 'host'
      ? remotes.get('host') || ensureRemote('host', 'anon')
      : remotes.get(msg.id);
    if (avatar) avatar.say(msg.text);
  } else if (msg.t === 'typing') {
    const avatar = msg.id === 'host' ? remotes.get('host') : remotes.get(msg.id);
    if (avatar) avatar.setTyping(msg.on);
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
  chatBuckets.delete(id);          // else the map grows for the whole session
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
const CHAT_HINT = 'Enter to send · Esc to cancel';
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
let chatText = '';      // the single source of truth for what is being typed

/* The bar closes itself after a stretch of silence, so an abandoned compose
   box doesn't sit over the game forever. Every keystroke pushes it back. */
function touchChatIdle() {
  clearTimeout(chatIdle);
  chatIdle = setTimeout(closeChat, CHAT_IDLE);
}

/* Paints chatText into the bar. The line is a div rather than an <input>, so
   long messages wrap onto a second and third row instead of scrolling
   sideways inside a fixed-width field. */
function renderChatLine() {
  el('chattext').textContent = chatText;
  el('chatline').classList.toggle('empty', chatText.length === 0);
  el('chatcount').textContent = chatText.length + '/' + CHAT_MAX;
  el('chatsend').disabled = chatText.trim().length === 0;
}

function setChatText(next) {
  chatText = next.slice(0, CHAT_MAX);
  renderChatLine();
  setTypingState(chatText.trim().length > 0);
  touchChatIdle();
}

/* --------------------------------------------------------------------------
   Key capture

   The compose bar does not use a focused <input> on desktop, and that is the
   whole point. Focus was never reliable here: exitPointerLock() completes on a
   later task and hands focus back to the document body afterwards, so the
   caret kept getting pulled out of the field a frame after it was put there,
   and keystrokes fell through to the movement handler. Reading keydown off the
   window sidesteps focus entirely — the events arrive whether or not anything
   is focused, and even while the pointer is still locked.

   Touch is the exception. A phone has no physical keyboard, so there a real
   (visually hidden) input is focused purely to summon the on-screen one, and
   its value is mirrored into chatText.
   -------------------------------------------------------------------------- */

function onChatKey(e) {
  if (!chatOpen) return;
  if (IS_TOUCH) return;              // the hidden input drives the touch path

  // Leave browser and OS shortcuts alone.
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Enter')     { e.preventDefault(); sendChat();  return; }
  if (e.key === 'Escape')    { e.preventDefault(); closeChat(); return; }
  if (e.key === 'Backspace') { e.preventDefault(); setChatText(chatText.slice(0, -1)); return; }

  /* Every printable character reports a single-character key, including the
     space bar and anything an international layout produces. Arrows, function
     keys, Shift and the rest report longer names and are ignored. */
  if (e.key.length === 1) {
    e.preventDefault();
    setChatText(chatText + e.key);
  }
}

function openChat() {
  if (chatOpen || !local) return;
  chatOpen = true;

  keys.clear();                        // don't keep running while typing

  /* Note what is NOT here: the pointer lock is left engaged on desktop. That
     one call was the source of both the pause menu appearing over the bar and
     the focus being stolen mid-sentence. Mouse-look is suppressed while
     chatOpen instead, so the camera still holds still. */

  // A fresh box every time. Whatever was half-typed when the bar timed out is
  // stale by now, and reopening onto an abandoned sentence is worse than
  // starting clean.
  chatText = '';
  renderChatLine();

  clearTimeout(hintTimer);
  el('chathint').textContent = CHAT_HINT;
  el('chathint').classList.remove('warn');

  el('chatbar').classList.remove('hidden');

  if (IS_TOUCH) {
    const input = el('chatinput');
    input.value = '';
    input.focus({ preventScroll: true });
  }

  touchChatIdle();
}

function closeChat() {
  if (!chatOpen) return;
  chatOpen = false;
  clearTimeout(chatIdle);
  setTypingState(false);

  chatText = '';
  renderChatLine();
  el('chatbar').classList.add('hidden');

  if (IS_TOUCH) {
    el('chatinput').value = '';
    el('chatinput').blur();            // let the on-screen keyboard drop
  } else if (!pointerLocked && relockPointer) {
    relockPointer();                   // only if something else took the lock
  }
}

function sendChat() {
  const text = chatText.trim().slice(0, CHAT_MAX);

  if (!text) { closeChat(); return; }

  /* Previously a too-fast message was silently discarded and the bar closed,
     which read as the game eating your sentence. Now the text stays put, the
     bar stays open, and the hint says how long is left — so the limit is
     something you can see rather than something that just fails. */
  const wait = chatWait('me');
  if (wait > 0) {
    showChatHint(`Slow down — ${(wait / 1000).toFixed(1)}s`, true);
    return;
  }

  allowChat('me');

  if (local) local.say(text);
  broadcastChat(text);
  closeChat();
}

let hintTimer = null;

/** Swaps the hint line under the bar, then restores the default. */
function showChatHint(text, warn) {
  const hint = el('chathint');
  hint.textContent = text;
  hint.classList.toggle('warn', !!warn);

  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hint.textContent = CHAT_HINT;
    hint.classList.remove('warn');
  }, 1400);
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
  /* Capture phase, so the compose bar sees the key before anything else can
     act on it or stop it propagating. */
  addEventListener('keydown', onChatKey, true);

  // mousedown default is prevented so the press cannot move focus or, on a
  // phone, dismiss the keyboard a frame before the send lands.
  el('chatsend').addEventListener('mousedown', e => e.preventDefault());
  el('chatsend').addEventListener('click', e => { e.preventDefault(); sendChat(); });
  el('chatsend').addEventListener('touchstart', e => {
    e.preventDefault();
    sendChat();
  }, { passive: false });

  /* Touch only: the hidden field exists to raise the on-screen keyboard, and
     its value is mirrored across. Reading .value rather than individual keys
     is what makes autocorrect, prediction and swipe input work. */
  const input = el('chatinput');

  input.addEventListener('input', () => setChatText(input.value));

  input.addEventListener('keydown', e => {
    e.stopPropagation();
    touchChatIdle();
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
    else if (e.key === 'Escape') closeChat();
  });

  // Tapping the bar puts the keyboard back if it was dismissed.
  el('chatbar').addEventListener('touchstart', e => {
    if (!IS_TOUCH) return;
    if (el('chatsend').contains(e.target)) return;
    input.focus({ preventScroll: true });
  }, { passive: true });

  el('btn-chat').addEventListener('touchstart', e => {
    e.preventDefault();
    e.stopPropagation();
    openChat();
  }, { passive: false });

  el('btn-chat').addEventListener('click', e => { e.preventDefault(); openChat(); });

  /* T or Enter opens chat while playing. The activeElement check keeps either
     from firing while the player is typing their name on the title screen. */
  addEventListener('keydown', e => {
    if (chatOpen || !local) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.code === 'KeyT' || e.key === 'Enter') { e.preventDefault(); openChat(); }
  });

  /* On a phone the keyboard covers the bottom of the screen, including the bar
     being typed into. visualViewport reports the space actually left visible,
     so the bar can be lifted to sit just above it. */
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
el('btn-leave').addEventListener('click', leaveGame);
el('btn-leave').addEventListener('touchstart', e => {
  e.preventDefault();
  e.stopPropagation();
  leaveGame();
}, { passive: false });
