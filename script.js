const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let particles = [];
let novaPulse = 0;
let attrZen = false;
let attrMirror = false;
let attrShrink = false;
let shrinkAmount = 0;
const SHRINK_RATE = 0.10;
const SHRINK_MIN = 80;
let effectiveCircleRadius = 0;
let mirrorBall = {};
let attrMenuOpen = false;
let sfxEnabled = true;
let musicEnabled = true;
let musicNodes = null;
let musicPlaying = false;
let musicStarted = false;
let currentMusicType = '';
const GRAVITY_DEFAULT = 0.06;
let GRAVITY = 0.06;
const START_SPEED = 4.2;
const SPEED_INCREMENT = 0.12;

// ── STORAGE ───────────────────────────────────────────────
function loadTotalBounces() {
  try { return parseInt(localStorage.getItem('chromatic_total_bounces') || '0', 10); } catch(e) { return 0; }
}
function saveTotalBounces(n) {
  try { localStorage.setItem('chromatic_total_bounces', String(n)); } catch(e) {}
}
function loadEquipped() {
  try { return localStorage.getItem('chromatic_equipped') || 'sandbox'; } catch(e) { return 'sandbox'; }
}
function saveEquipped(id) {
  try { localStorage.setItem('chromatic_equipped', id); } catch(e) {}
}

let totalBounces = loadTotalBounces();
let equippedTrail = loadEquipped();

function addBounces(n) {
  totalBounces += n;
  saveTotalBounces(totalBounces);
}

// ── TRAIL CATALOGUE ───────────────────────────────────────
const TRAILS = [
  {
    id: 'sandbox',
    name: 'Sandbox',
    desc: 'Default — minimal & clean',
    previewBg: '#000',
    previewBorder: 'rgba(255,255,255,0.4)',
    previewDot: '#fff'
  },
  {
    id: 'original',
    name: 'Original',
    desc: 'Colourful ink that never fades',
    previewBg: 'linear-gradient(135deg,#ff006680,#ffaa0080)',
    previewBorder: 'rgba(255,180,0,0.6)',
    previewDot: '#ffcc00'
  },
  {
    id: 'sparky',
    name: 'Sparky',
    desc: 'Electric blue streak',
    previewBg: 'linear-gradient(135deg,#0044cc80,#00ccff80)',
    previewBorder: 'rgba(0,200,255,0.6)',
    previewDot: '#00ccff'
  },
  {
    id: 'chromatic',
    name: 'Chromatic',
    desc: 'Full spectrum rainbow trail',
    previewBg: 'linear-gradient(135deg,#ff000080,#00ff0080,#0000ff80)',
    previewBorder: 'rgba(180,100,255,0.6)',
    previewDot: '#cc44ff'
  },
  {
    id: 'hyper',
    name: 'Hyper',
    desc: 'Rapid colour-flashing chaos',
    previewBg: 'linear-gradient(135deg,#ff440080,#ff00ff80)',
    previewBorder: 'rgba(255,80,255,0.6)',
    previewDot: '#ff44ff'
  },
  {
    id: 'nova',
    name: 'Nova',
    desc: 'Glowing burst on every bounce',
    previewBg: 'linear-gradient(135deg,#ffaa0080,#ff440080)',
    previewBorder: 'rgba(255,160,0,0.6)',
    previewDot: '#ffaa00'
  },
  {
    id: 'radiant',
    name: 'Radiant',
    desc: 'Solar orb with fire trail & embers',
    previewBg: 'radial-gradient(circle,#ffee0080,#ff660080)',
    previewBorder: 'rgba(255,160,0,0.8)',
    previewDot: '#ffe000'
  },
  {
    id: 'prismatic',
    name: 'Prismatic',
    desc: 'Ethereal rainbow with mystical aura',
    previewBg: 'linear-gradient(135deg,#ff00ff80,#00ffff80,#ffff0080)',
    previewBorder: 'rgba(220,180,255,0.8)',
    previewDot: '#e0aaff'
  },
  {
    id: 'illumination',
    name: 'Illumination',
    desc: 'Angelic white glow, divine light',
    previewBg: 'radial-gradient(circle,#ffffff80,#aaddff80)',
    previewBorder: 'rgba(255,255,255,0.8)',
    previewDot: '#ffffff'
  },
  {
    id: 'quantum',
    name: 'Quantum',
    desc: 'Cobalt blue voltage, Electric',
    previewBg: 'radial-gradient(circle,#00eeff60,#0033aa80,#000d2280)',
    previewBorder: 'rgba(0,220,255,0.9)',
    previewDot: '#00eeff'
  }
];


// ── INVENTORY UI ──────────────────────────────────────────
function renderShop() {
  document.getElementById('shopBounceDisplay').textContent = totalBounces.toLocaleString();
  const list = document.getElementById('shopItemsList');
  list.innerHTML = '';

  TRAILS.forEach(trail => {
    const isEquipped = equippedTrail === trail.id;

    const item = document.createElement('div');
    item.className = 'shop-item' + (isEquipped ? ' equipped' : '');

    // Special quantum glow border
    if (trail.id === 'quantum') {
      item.style.borderColor = isEquipped ? 'rgba(0,220,255,0.8)' : 'rgba(0,180,255,0.45)';
      item.style.background = isEquipped
        ? 'rgba(0,30,80,0.55)'
        : 'rgba(0,15,50,0.40)';
      item.style.boxShadow = isEquipped
        ? '0 0 18px rgba(0,200,255,0.25), inset 0 0 12px rgba(0,100,200,0.1)'
        : '0 0 8px rgba(0,180,255,0.12)';
    }

    const preview = document.createElement('div');
    preview.className = 'shop-item-preview';
    preview.style.background = trail.previewBg;
    preview.style.border = `2px solid ${trail.previewBorder}`;
    const dot = document.createElement('div');
    dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${trail.previewDot};box-shadow:0 0 8px ${trail.previewDot};`;
    preview.appendChild(dot);

    const info = document.createElement('div');
    info.className = 'shop-item-info';
    info.innerHTML = `
      <div class="shop-item-name" style="${trail.id === 'quantum' ? 'color:#00eeff;text-shadow:0 0 10px rgba(0,220,255,0.6);' : ''}">${trail.name}</div>
      <div class="shop-item-desc">${trail.desc}</div>
    `;

    const btn = document.createElement('button');
    if (isEquipped) {
      btn.textContent = 'Equipped';
      btn.className = 'shop-item-btn equipped-btn';
      if (trail.id === 'quantum') {
        btn.style.borderColor = 'rgba(0,220,255,0.5)';
        btn.style.color = 'rgba(0,220,255,0.6)';
      }
    } else {
      btn.textContent = 'Equip';
      btn.className = 'shop-item-btn equip-btn';
      if (trail.id === 'quantum') {
        btn.style.borderColor = 'rgba(0,220,255,0.7)';
        btn.style.background = 'rgba(0,80,180,0.3)';
        btn.style.color = '#00eeff';
      }
      btn.addEventListener('click', () => {
        playClickSfx();
        equippedTrail = trail.id;
        saveEquipped(trail.id);
        renderShop();
        showToast(`${trail.name} equipped`);
      });
    }

    item.appendChild(preview);
    item.appendChild(info);
    item.appendChild(btn);
    list.appendChild(item);
  });
}

function showToast(msg) {
  const existing = document.querySelector('.shop-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'shop-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// ── ATTR HELPERS ──────────────────────────────────────────
function updateAttrBtn(id, active) {
  const btn = document.getElementById(id);
  btn.style.color = active ? '#1e78ff' : '#a0c4ff';
  btn.style.borderColor = active ? 'rgba(30,120,255,0.6)' : 'rgba(30,120,255,0.4)';
  btn.style.background = active ? 'rgba(30,120,255,0.15)' : 'rgba(10,40,100,0.3)';
  btn.textContent = active ? 'ON' : 'OFF';
}
function spawnMirrorBall(w, h) {
  mirrorBall = { x: w/2, y: h/2, vx: -ball.vx, vy: ball.vy };
}

// ── SFX ───────────────────────────────────────────────────
function playHoverSfx() {
  if (!sfxEnabled) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'sine';
  o.frequency.setValueAtTime(440, audioCtx.currentTime);
  o.frequency.linearRampToValueAtTime(660, audioCtx.currentTime + 0.08);
  g.gain.setValueAtTime(0.08, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.12);
  o.start(); o.stop(audioCtx.currentTime + 0.12);
}
function playClickSfx() {
  if (!sfxEnabled) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'triangle';
  o.frequency.setValueAtTime(880, audioCtx.currentTime);
  o.frequency.linearRampToValueAtTime(440, audioCtx.currentTime + 0.15);
  g.gain.setValueAtTime(0.15, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
  o.start(); o.stop(audioCtx.currentTime + 0.2);
}
function playBounceSfx(speed, trailId) {
  if (!sfxEnabled) return;
  switch(trailId) {
    case 'original':     playBounceOriginalSfx(speed);     break;
    case 'sparky':       playBounceSparkySfx(speed);       break;
    case 'chromatic':    playBounceChromaticSfx(speed);    break;
    case 'hyper':        playBounceHyperSfx(speed);        break;
    case 'nova':         playBounceNovaSfx(speed);         break;
    case 'radiant':      playBounceRadiantSfx(speed);      break;
    case 'prismatic':    playBouncePrismaticSfx(speed);    break;
    case 'illumination': playBounceIlluminationSfx(speed); break;
    case 'quantum':      playBounceQuantumSfx(speed);      break;
    default:             playBounceSandboxSfx(speed);      break;
  }
}
function playBounceSandboxSfx(speed) {
  const pitch = Math.min(900, 250 + speed * 22);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.45, audioCtx.currentTime + 0.14);
  g.gain.setValueAtTime(0.12, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.16);
  o.start(); o.stop(audioCtx.currentTime + 0.16);
}
function playBounceChromaticSfx(speed) {
  const pitch = Math.min(1200, 300 + speed * 30);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'square';
  o.frequency.setValueAtTime(pitch, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.5, audioCtx.currentTime + 0.1);
  g.gain.setValueAtTime(0.13, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.12);
  o.start(); o.stop(audioCtx.currentTime + 0.12);
}
function playBounceOriginalSfx(speed) {
  const pitch = Math.min(800, 200 + speed * 20);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.4, audioCtx.currentTime + 0.15);
  g.gain.setValueAtTime(0.15, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
  o.start(); o.stop(audioCtx.currentTime + 0.15);
}
function playBounceHyperSfx(speed) {
  const t = audioCtx.currentTime;
  const pitch = Math.min(2000, 400 + speed * 50);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(pitch, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 2, t + 0.05);
  g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(t + 0.12);
  o2.type = 'square'; o2.frequency.setValueAtTime(pitch * 1.5, t);
  o2.frequency.exponentialRampToValueAtTime(pitch * 0.5, t + 0.08);
  g2.gain.setValueAtTime(0.15, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o2.connect(g2); g2.connect(audioCtx.destination); o2.start(); o2.stop(t + 0.1);
}
function playBounceNovaSfx(speed) {
  const t = audioCtx.currentTime;
  const pitch = Math.min(1600, 350 + speed * 40);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.3, t + 0.2);
  g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(t + 0.25);
  const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
  o2.type = 'sawtooth'; o2.frequency.setValueAtTime(pitch * 2, t);
  o2.frequency.exponentialRampToValueAtTime(pitch * 0.1, t + 0.15);
  g2.gain.setValueAtTime(0.18, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o2.connect(g2); g2.connect(audioCtx.destination); o2.start(); o2.stop(t + 0.18);
}
function playBounceSparkySfx(speed) {
  const t = audioCtx.currentTime;
  const pitch = Math.min(1800, 500 + speed * 35);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'square'; o.frequency.setValueAtTime(pitch, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.2, t + 0.08);
  g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(t + 0.1);
  const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
  o2.type = 'sawtooth'; o2.frequency.setValueAtTime(pitch * 2.5, t);
  o2.frequency.exponentialRampToValueAtTime(pitch * 0.3, t + 0.06);
  g2.gain.setValueAtTime(0.15, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  o2.connect(g2); g2.connect(audioCtx.destination); o2.start(); o2.stop(t + 0.08);
}
function playBounceRadiantSfx(speed) {
  const t = audioCtx.currentTime;
  const pitch = Math.min(800, 180 + speed * 18);
  const crackle = audioCtx.createOscillator(), cg = audioCtx.createGain();
  crackle.type = 'sawtooth';
  crackle.frequency.setValueAtTime(pitch * 3, t);
  crackle.frequency.exponentialRampToValueAtTime(pitch * 0.1, t + 0.22);
  cg.gain.setValueAtTime(0.28, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  crackle.connect(cg); cg.connect(audioCtx.destination);
  crackle.start(); crackle.stop(t + 0.22);
  const thud = audioCtx.createOscillator(), tg = audioCtx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(120, t);
  thud.frequency.exponentialRampToValueAtTime(40, t + 0.18);
  tg.gain.setValueAtTime(0.35, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  thud.connect(tg); tg.connect(audioCtx.destination);
  thud.start(); thud.stop(t + 0.2);
  const hiss = audioCtx.createOscillator(), hg = audioCtx.createGain();
  hiss.type = 'sawtooth';
  hiss.frequency.setValueAtTime(2200 + speed * 40, t);
  hiss.frequency.linearRampToValueAtTime(800, t + 0.12);
  hg.gain.setValueAtTime(0.10, t);
  hg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  hiss.connect(hg); hg.connect(audioCtx.destination);
  hiss.start(); hiss.stop(t + 0.14);
}
function playBouncePrismaticSfx(speed) {
  const t = audioCtx.currentTime;
  const baseFreq = Math.min(900, 300 + speed * 20);
  const harmonics = [1, 1.5, 2.0, 2.67, 3.36];
  const vols      = [0.22, 0.14, 0.10, 0.07, 0.05];
  harmonics.forEach((mult, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(baseFreq * mult, t);
    o.frequency.linearRampToValueAtTime(baseFreq * mult * 1.004, t + 0.04);
    g.gain.setValueAtTime(vols[i], t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6 - i * 0.06);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(t + 0.65);
  });
  const breath = audioCtx.createOscillator(), bg = audioCtx.createGain();
  breath.type = 'triangle';
  breath.frequency.setValueAtTime(baseFreq * 0.5, t);
  breath.frequency.linearRampToValueAtTime(baseFreq * 0.25, t + 0.4);
  bg.gain.setValueAtTime(0.08, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  breath.connect(bg); bg.connect(audioCtx.destination);
  breath.start(); breath.stop(t + 0.5);
}
function playBounceIlluminationSfx(speed) {
  const t = audioCtx.currentTime;
  const baseFreq = Math.min(1000, 400 + speed * 18);
  const harmonics = [1, 1.26, 1.5, 2.0, 2.52];
  const vols      = [0.18, 0.13, 0.10, 0.08, 0.05];
  harmonics.forEach((mult, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(baseFreq * mult, t);
    o.frequency.linearRampToValueAtTime(baseFreq * mult * 1.008, t + 0.05);
    g.gain.setValueAtTime(vols[i], t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1 - i * 0.1);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(t + 1.2);
  });
  const shimmer = audioCtx.createOscillator(), sg = audioCtx.createGain();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(baseFreq * 4, t);
  shimmer.frequency.linearRampToValueAtTime(baseFreq * 5, t + 0.3);
  sg.gain.setValueAtTime(0.06, t);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  shimmer.connect(sg); sg.connect(audioCtx.destination);
  shimmer.start(); shimmer.stop(t + 0.5);
  const breath = audioCtx.createOscillator(), bg = audioCtx.createGain();
  breath.type = 'triangle';
  breath.frequency.setValueAtTime(baseFreq * 0.4, t);
  breath.frequency.linearRampToValueAtTime(baseFreq * 0.2, t + 0.6);
  bg.gain.setValueAtTime(0.07, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  breath.connect(bg); bg.connect(audioCtx.destination);
  breath.start(); breath.stop(t + 0.7);
}

// ── QUANTUM SFX ── raw voltage discharge ─────────────────
function playBounceQuantumSfx(speed) {
  const t = audioCtx.currentTime;
  const baseFreq = Math.min(2400, 600 + speed * 55);

  // 1. Massive electric CRACK — white-noise burst via sawtooth + distortion simulation
  const crack = audioCtx.createOscillator(), cg = audioCtx.createGain();
  crack.type = 'sawtooth';
  crack.frequency.setValueAtTime(baseFreq * 3.2, t);
  crack.frequency.exponentialRampToValueAtTime(80, t + 0.04);
  cg.gain.setValueAtTime(0.45, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  crack.connect(cg); cg.connect(audioCtx.destination);
  crack.start(t); crack.stop(t + 0.06);

  // 2. High-voltage arc — rapidly oscillating square that tears through freq range
  const arc = audioCtx.createOscillator(), ag = audioCtx.createGain();
  arc.type = 'square';
  arc.frequency.setValueAtTime(baseFreq * 2, t + 0.01);
  arc.frequency.exponentialRampToValueAtTime(baseFreq * 0.08, t + 0.22);
  ag.gain.setValueAtTime(0.30, t + 0.01);
  ag.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
  arc.connect(ag); ag.connect(audioCtx.destination);
  arc.start(t + 0.01); arc.stop(t + 0.25);

  // 3. Deep cobalt THUMP — sub rumble for weight
  const sub = audioCtx.createOscillator(), sg = audioCtx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(90, t);
  sub.frequency.exponentialRampToValueAtTime(28, t + 0.18);
  sg.gain.setValueAtTime(0.40, t);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  sub.connect(sg); sg.connect(audioCtx.destination);
  sub.start(t); sub.stop(t + 0.22);

  // 4. Cyan resonance ring — pure sine shimmer that lingers
  const ring = audioCtx.createOscillator(), rg = audioCtx.createGain();
  ring.type = 'sine';
  ring.frequency.setValueAtTime(baseFreq * 0.75, t + 0.03);
  ring.frequency.linearRampToValueAtTime(baseFreq * 1.1, t + 0.09);
  ring.frequency.linearRampToValueAtTime(baseFreq * 0.3, t + 0.35);
  rg.gain.setValueAtTime(0.18, t + 0.03);
  rg.gain.exponentialRampToValueAtTime(0.001, t + 0.40);
  ring.connect(rg); rg.connect(audioCtx.destination);
  ring.start(t + 0.03); ring.stop(t + 0.42);

  // 5. Stutter crackle — 3 rapid micro-bursts simulating arc flicker
  for (let i = 0; i < 3; i++) {
    const delay = 0.06 + i * 0.04;
    const st = audioCtx.createOscillator(), stg = audioCtx.createGain();
    st.type = 'sawtooth';
    st.frequency.setValueAtTime(baseFreq * (1.8 - i * 0.4), t + delay);
    st.frequency.exponentialRampToValueAtTime(200, t + delay + 0.025);
    stg.gain.setValueAtTime(0.18 - i * 0.04, t + delay);
    stg.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.03);
    st.connect(stg); stg.connect(audioCtx.destination);
    st.start(t + delay); st.stop(t + delay + 0.035);
  }

  // 6. Tail hiss — high-freq white-ish noise dying away
  const hiss = audioCtx.createOscillator(), hg = audioCtx.createGain();
  hiss.type = 'sawtooth';
  hiss.frequency.setValueAtTime(3800 + speed * 60, t + 0.04);
  hiss.frequency.linearRampToValueAtTime(1200, t + 0.28);
  hg.gain.setValueAtTime(0.12, t + 0.04);
  hg.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
  hiss.connect(hg); hg.connect(audioCtx.destination);
  hiss.start(t + 0.04); hiss.stop(t + 0.32);
}

// ── MUSIC ─────────────────────────────────────────────────
function startMusic() {
  if (musicPlaying || !musicEnabled) return;
  musicPlaying = true; currentMusicType = 'menu';
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0, audioCtx.currentTime);
  master.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + 2);
  master.connect(audioCtx.destination);
  const delay = audioCtx.createDelay(1.0); delay.delayTime.value = 0.45;
  const delayGain = audioCtx.createGain(); delayGain.gain.value = 0.35;
  delay.connect(delayGain); delayGain.connect(delay); delayGain.connect(master);
  const bass = audioCtx.createOscillator(), bassGain = audioCtx.createGain();
  bass.type = 'sine'; bass.frequency.value = 55; bassGain.gain.value = 0.5;
  bass.connect(bassGain); bassGain.connect(master); bass.start();
  const bass2 = audioCtx.createOscillator(), bass2Gain = audioCtx.createGain();
  bass2.type = 'triangle'; bass2.frequency.value = 110; bass2Gain.gain.value = 0.18;
  bass2.connect(bass2Gain); bass2Gain.connect(master); bass2.start();
  const pad = audioCtx.createOscillator(), padGain = audioCtx.createGain();
  pad.type = 'sine'; pad.frequency.value = 164.8; padGain.gain.value = 0.12;
  pad.connect(padGain); padGain.connect(master); pad.start();
  const pad2 = audioCtx.createOscillator(), pad2Gain = audioCtx.createGain();
  pad2.type = 'sine'; pad2.frequency.value = 196; pad2Gain.gain.value = 0.08;
  pad2.connect(pad2Gain); pad2Gain.connect(master); pad2.start();
  const arpNotes = [220, 261.6, 329.6, 392, 440, 329.6, 261.6, 220];
  const arpInterval = 0.28;
  let arpStep = 0, arpActive = true, arpTimer = null;
  function playArpNote() {
    if (!arpActive) return;
    const freq = arpNotes[arpStep % arpNotes.length];
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.22, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + arpInterval * 0.9);
    o.connect(g); g.connect(delay); g.connect(master);
    o.start(); o.stop(audioCtx.currentTime + arpInterval);
    arpStep++;
    arpTimer = setTimeout(playArpNote, arpInterval * 1000);
  }
  arpTimer = setTimeout(playArpNote, 800);
  musicNodes = {
    stop: () => {
      arpActive = false; clearTimeout(arpTimer);
      master.gain.setValueAtTime(master.gain.value, audioCtx.currentTime);
      master.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.2);
      setTimeout(() => {
        try { bass.stop(); bass2.stop(); pad.stop(); pad2.stop(); } catch(e) {}
        musicPlaying = false; musicNodes = null; currentMusicType = '';
      }, 1400);
    }
  };
}
function stopMusic() {
  if (musicNodes && musicPlaying) musicNodes.stop();
}

// ── DOM REFS ──────────────────────────────────────────────
document.querySelectorAll('.btn').forEach(b => b.addEventListener('mouseenter', playHoverSfx));
const app = document.getElementById('app');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const menuScreen = document.getElementById('menuScreen');
const modeScreen = document.getElementById('modeScreen');
const gameScreen = document.getElementById('gameScreen');
const settingsScreen = document.getElementById('settingsScreen');
const inventoryScreen = document.getElementById('inventoryScreen');
const modeLabel = document.getElementById('modeLabel');
let animId = null, bounces = 0, ball = {}, trail = [];
let circleRadius = 0, ballRadius = 0, hue = 0, currentSpeed = 0;

function updateSessionTotalDisplay() {
  document.getElementById('sessionTotal').textContent = `Total: ${totalBounces.toLocaleString()}`;
}

window.addEventListener('resize', () => {
  if (!gameScreen.classList.contains('hidden')) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    circleRadius = Math.min(canvas.width, canvas.height) * 0.38;
    effectiveCircleRadius = circleRadius - shrinkAmount;
  }
});
document.getElementById('app').addEventListener('click', () => {
  if (!musicStarted) { musicStarted = true; startMusic(); }
}, { once: true });

// ── NAV ───────────────────────────────────────────────────
document.getElementById('playBtn').addEventListener('click', () => {
  playClickSfx(); menuScreen.classList.add('hidden'); modeScreen.classList.remove('hidden');
});
document.getElementById('settingsBtn').addEventListener('click', () => {
  playClickSfx(); menuScreen.classList.add('hidden'); settingsScreen.classList.remove('hidden');
});
document.getElementById('settingsBackBtn').addEventListener('click', () => {
  playClickSfx(); settingsScreen.classList.add('hidden'); menuScreen.classList.remove('hidden');
});
document.getElementById('backBtn').addEventListener('click', () => {
  playClickSfx(); modeScreen.classList.add('hidden'); menuScreen.classList.remove('hidden');
});
document.getElementById('inventoryBtn').addEventListener('click', () => {
  playClickSfx();
  menuScreen.classList.add('hidden');
  inventoryScreen.classList.remove('hidden');
  renderShop();
});
document.getElementById('inventoryBackBtn').addEventListener('click', () => {
  playClickSfx();
  inventoryScreen.classList.add('hidden');
  menuScreen.classList.remove('hidden');
});
document.getElementById('gameBackBtn').addEventListener('click', () => {
  playClickSfx(); stopGame();
  gameScreen.classList.add('hidden'); menuScreen.classList.remove('hidden');
  attrMenuOpen = false; attrZen = false; attrMirror = false; GRAVITY = GRAVITY_DEFAULT;
  attrShrink = false; shrinkAmount = 0;
  document.getElementById('attrMenu').style.display = 'none';
  updateAttrBtn('attrZen', false);
  updateAttrBtn('attrMirror', false);
  updateAttrBtn('attrShrink', false);
  if (musicEnabled && musicStarted) startMusic();
});
document.getElementById('attrBtn').addEventListener('click', () => {
  playClickSfx();
  const menu = document.getElementById('attrMenu');
  attrMenuOpen = !attrMenuOpen;
  menu.style.display = attrMenuOpen ? 'flex' : 'none';
});
document.getElementById('attrClose').addEventListener('click', () => {
  playClickSfx(); attrMenuOpen = false;
  document.getElementById('attrMenu').style.display = 'none';
});
document.getElementById('attrZen').addEventListener('click', () => {
  playClickSfx(); attrZen = !attrZen;
  GRAVITY = attrZen ? 0 : GRAVITY_DEFAULT;
  updateAttrBtn('attrZen', attrZen);
});
document.getElementById('attrMirror').addEventListener('click', () => {
  playClickSfx(); attrMirror = !attrMirror;
  updateAttrBtn('attrMirror', attrMirror);
  if (attrMirror) spawnMirrorBall(canvas.width, canvas.height);
});

document.getElementById('attrShrink').addEventListener('click', () => {
  playClickSfx();
  attrShrink = !attrShrink;
  shrinkAmount = 0;
  effectiveCircleRadius = circleRadius;
  updateAttrBtn('attrShrink', attrShrink);
});

document.getElementById('sfxToggle').addEventListener('click', () => {
  sfxEnabled = !sfxEnabled;
  const btn = document.getElementById('sfxToggle');
  btn.textContent = sfxEnabled ? 'ON' : 'OFF';
  btn.style.color = sfxEnabled ? '#1e78ff' : '#a0c4ff';
  btn.style.borderColor = sfxEnabled ? 'rgba(30,120,255,0.6)' : 'rgba(30,120,255,0.2)';
  btn.style.background = sfxEnabled ? 'rgba(30,120,255,0.15)' : 'rgba(10,40,100,0.2)';
  playClickSfx();
});
document.getElementById('musicToggle').addEventListener('click', () => {
  musicEnabled = !musicEnabled;
  const btn = document.getElementById('musicToggle');
  btn.textContent = musicEnabled ? 'ON' : 'OFF';
  btn.style.color = musicEnabled ? '#1e78ff' : '#a0c4ff';
  btn.style.borderColor = musicEnabled ? 'rgba(30,120,255,0.6)' : 'rgba(30,120,255,0.2)';
  btn.style.background = musicEnabled ? 'rgba(30,120,255,0.15)' : 'rgba(10,40,100,0.2)';
  if (!musicEnabled) { stopMusic(); }
  playClickSfx();
});

document.getElementById('sandboxModeBtn').addEventListener('click', () => {
  playClickSfx(); stopMusic();
  modeScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  modeLabel.textContent = equippedTrail.charAt(0).toUpperCase() + equippedTrail.slice(1) + ' Trail';
  let badge = document.getElementById('trailBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'trailBadge'; badge.className = 'trail-badge';
    gameScreen.appendChild(badge);
  }
  badge.textContent = equippedTrail.toUpperCase();
  setTimeout(startGame, 50);
});

// ── GAME ──────────────────────────────────────────────────
function startGame() {
  particles = []; novaPulse = 0;
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const w = canvas.width, h = canvas.height;
  circleRadius = Math.min(w, h) * 0.38;
  shrinkAmount = 0;
  effectiveCircleRadius = circleRadius;
  ballRadius = 10; bounces = 0; trail = []; hue = 0;
  currentSpeed = START_SPEED;
  document.getElementById('bounceCount').textContent = 'Bounces: 0';
  updateSessionTotalDisplay();
  const angle = (Math.random() - 0.5) * 1.0 - Math.PI / 2;
  ball = { x: w/2, y: h/2, vx: Math.cos(angle) * currentSpeed, vy: Math.sin(angle) * currentSpeed };
  if (attrMirror) spawnMirrorBall(w, h);
  if (animId) cancelAnimationFrame(animId);
  loop();
}
function stopGame() {
  if (animId) cancelAnimationFrame(animId);
  animId = null;
}
function loop() {
  const w = canvas.width, h = canvas.height, cx = w/2, cy = h/2;
  const t = equippedTrail;
  if (t === 'original')          loopOriginal(w, h, cx, cy);
  else if (t === 'sparky')       loopSparky(w, h, cx, cy);
  else if (t === 'chromatic')    loopChromatic(w, h, cx, cy);
  else if (t === 'hyper')        loopHyper(w, h, cx, cy);
  else if (t === 'nova')         loopNova(w, h, cx, cy);
  else if (t === 'radiant')      loopRadiant(w, h, cx, cy);
  else if (t === 'prismatic')    loopPrismatic(w, h, cx, cy);
  else if (t === 'illumination') loopIllumination(w, h, cx, cy);
  else if (t === 'quantum')      loopQuantum(w, h, cx, cy);
  else                           loopSandbox(w, h, cx, cy);
  animId = requestAnimationFrame(loop);
}

// ── MIRROR / ATTR ─────────────────────────────────────────
function handleMirror(cx, cy) {
  if (!attrMirror) return;
  mirrorBall.vy += GRAVITY; mirrorBall.x += mirrorBall.vx; mirrorBall.y += mirrorBall.vy;
  const bbdx = mirrorBall.x - ball.x, bbdy = mirrorBall.y - ball.y;
  const bbdist = Math.sqrt(bbdx*bbdx + bbdy*bbdy);
  if (bbdist < ballRadius * 2 && bbdist > 0) {
    const bbnx = bbdx/bbdist, bbny = bbdy/bbdist;
    const rel = (ball.vx - mirrorBall.vx)*bbnx + (ball.vy - mirrorBall.vy)*bbny;
    ball.vx -= rel*bbnx; ball.vy -= rel*bbny;
    mirrorBall.vx += rel*bbnx; mirrorBall.vy += rel*bbny;
  }
  const mdx = mirrorBall.x - cx, mdy = mirrorBall.y - cy;
  const mdist = Math.sqrt(mdx*mdx + mdy*mdy);
  const mmaxDist = effectiveCircleRadius - ballRadius;
  if (mdist >= mmaxDist) {
    const mnx = mdx/mdist, mny = mdy/mdist;
    const mdot = mirrorBall.vx*mnx + mirrorBall.vy*mny;
    mirrorBall.vx -= 2*mdot*mnx; mirrorBall.vy -= 2*mdot*mny;
    const ms = Math.sqrt(mirrorBall.vx*mirrorBall.vx + mirrorBall.vy*mirrorBall.vy);
    mirrorBall.vx = mirrorBall.vx/ms * currentSpeed; mirrorBall.vy = mirrorBall.vy/ms * currentSpeed;
    mirrorBall.x = cx + mnx*(mmaxDist - 1); mirrorBall.y = cy + mny*(mmaxDist - 1);
  }
}
function drawMirrorBall(mhue) {
  if (!attrMirror) return;
  const mFlashHue = (mhue + 180) % 360;
  ctx.beginPath(); ctx.arc(mirrorBall.x, mirrorBall.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = `hsl(${mFlashHue},100%,70%)`; ctx.fill();
  ctx.strokeStyle = `hsl(${(mFlashHue+60)%360},100%,80%)`; ctx.lineWidth = 2; ctx.stroke();
}

// ── HANDLE BOUNCE (with Shrink built in) ──────────────────
function handleBounce(cx, cy) {
  if (attrShrink) {
    const minAllowed = SHRINK_MIN + ballRadius;
    shrinkAmount = shrinkAmount + SHRINK_RATE;
  }
  effectiveCircleRadius = circleRadius - shrinkAmount;

  const dx = ball.x - cx, dy = ball.y - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = effectiveCircleRadius - ballRadius;
  if (dist >= maxDist) {
    const nx = dx/dist, ny = dy/dist;
    const dot = ball.vx*nx + ball.vy*ny;
    ball.vx -= 2*dot*nx; ball.vy -= 2*dot*ny;
    const inc = equippedTrail === 'hyper' ? SPEED_INCREMENT * 1.5 : SPEED_INCREMENT;
    currentSpeed += inc;
    const s = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
    ball.vx = ball.vx/s * currentSpeed; ball.vy = ball.vy/s * currentSpeed;
    ball.x = cx + nx*(maxDist - 1); ball.y = cy + ny*(maxDist - 1);
    bounces++; addBounces(1); updateSessionTotalDisplay();
    ballRadius = 10 + bounces * 1.4;
    document.getElementById('bounceCount').textContent = `Bounces: ${bounces}`;
    playBounceSfx(currentSpeed, equippedTrail);
    return true;
  }
  return false;
}

// ── TRAIL LOOPS ───────────────────────────────────────────
function loopSandbox(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.35)';
  ctx.fillRect(0, 0, w, h);
  trail.push({ x: ball.x, y: ball.y, r: ballRadius });
  if (trail.length > 80) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = (i / trail.length) * 0.45;
    ctx.beginPath(); ctx.arc(t.x, t.y, Math.max(1, t.r * (i/trail.length)), 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
  drawMirrorBall(0);
  handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  handleBounce(cx, cy);
}

function loopOriginal(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.05)';
  ctx.fillRect(0, 0, w, h);
  hue = (hue + 0.8) % 360;
  trail.push({ x: ball.x, y: ball.y, hue, r: ballRadius });
  if (trail.length > 5000) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI*2);
    ctx.fillStyle = `hsl(${t.hue},100%,60%)`; ctx.globalAlpha = 0.4; ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI*2);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = '#000'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  drawMirrorBall(hue); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  handleBounce(cx, cy);
}

function loopSparky(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.2)';
  ctx.fillRect(0, 0, w, h);
  trail.push({ x: ball.x, y: ball.y, r: ballRadius });
  if (trail.length > 60) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = i / trail.length;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI*2);
    ctx.fillStyle = `hsla(200,100%,60%,${alpha * 0.7})`; ctx.fill();
    ctx.strokeStyle = `hsla(200,100%,80%,${alpha * 0.9})`; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI*2);
  ctx.strokeStyle = '#0066ff'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = '#0052cc'; ctx.fill(); ctx.strokeStyle = '#00ccff'; ctx.lineWidth = 2; ctx.stroke();
  drawMirrorBall(200); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  handleBounce(cx, cy);
}

function loopChromatic(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.28)';
  ctx.fillRect(0, 0, w, h);
  hue = (hue + 1.0) % 360;
  trail.push({ x: ball.x, y: ball.y, hue, r: ballRadius });
  if (trail.length > 100) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = i / trail.length;
    ctx.beginPath(); ctx.arc(t.x, t.y, Math.max(1, t.r * alpha), 0, Math.PI*2);
    ctx.fillStyle = `hsla(${t.hue},100%,60%,${alpha * 0.6})`; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI*2);
  ctx.strokeStyle = `hsl(${hue},80%,55%)`; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = `hsl(${hue},100%,70%)`; ctx.fill();
  drawMirrorBall(hue); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  handleBounce(cx, cy);
}

function loopHyper(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.15)';
  ctx.fillRect(0, 0, w, h);
  hue = (hue + 8) % 360;
  trail.push({ x: ball.x, y: ball.y, hue, r: ballRadius });
  if (trail.length > 120) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = i / trail.length;
    const flashHue = (t.hue + i * 25) % 360;
    ctx.beginPath(); ctx.arc(t.x, t.y, Math.max(1, t.r * alpha), 0, Math.PI*2);
    ctx.fillStyle = `hsla(${flashHue},100%,65%,${alpha * 0.8})`; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI*2);
  ctx.strokeStyle = `hsl(${hue},100%,60%)`; ctx.lineWidth = 3; ctx.stroke();
  const ballFlashHue = (hue * 3) % 360;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = `hsl(${ballFlashHue},100%,70%)`; ctx.fill();
  ctx.strokeStyle = `hsl(${(ballFlashHue+120)%360},100%,80%)`; ctx.lineWidth = 2; ctx.stroke();
  drawMirrorBall(hue); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  handleBounce(cx, cy);
}

function spawnParticles(x, y, h, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
    const speed = 2 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      hue: (h + Math.random()*60 - 30 + 360) % 360, life: 1.0, r: 2 + Math.random()*3 });
  }
}
function loopNova(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.22)';
  ctx.fillRect(0, 0, w, h);
  hue = (hue + 2.5) % 360;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life -= 0.025;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI*2);
    ctx.fillStyle = `hsla(${p.hue},100%,65%,${p.life * 0.9})`; ctx.fill();
  }
  trail.push({ x: ball.x, y: ball.y, hue, r: ballRadius });
  if (trail.length > 80) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = i / trail.length;
    ctx.beginPath(); ctx.arc(t.x, t.y, Math.max(1, t.r * alpha * 0.6), 0, Math.PI*2);
    ctx.fillStyle = `hsla(${t.hue},100%,65%,${alpha * 0.7})`; ctx.fill();
  }
  novaPulse = Math.max(0, novaPulse - 0.04);
  ctx.save(); ctx.shadowColor = `hsl(${hue},100%,60%)`; ctx.shadowBlur = 3 + novaPulse * 20;
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI*2);
  ctx.strokeStyle = `hsl(${hue},90%,60%)`; ctx.lineWidth = 2 + novaPulse * 3; ctx.stroke(); ctx.restore();
  ctx.save(); ctx.shadowColor = `hsl(${hue},100%,70%)`; ctx.shadowBlur = 15 + novaPulse * 10;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = `hsl(${hue},100%,72%)`; ctx.fill(); ctx.restore();
  drawMirrorBall(hue); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  const bounced = handleBounce(cx, cy);
  if (bounced) {
    spawnParticles(ball.x, ball.y, hue, 18); novaPulse = 1.0;
    app.classList.add('shake'); setTimeout(() => app.classList.remove('shake'), 120);
  }
}

function spawnFireParticles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
    const speed = 1.5 + Math.random() * 4.5;
    const fireHue = 20 + Math.random() * 40;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.2,
      hue: fireHue,
      life: 1.0,
      r: 2 + Math.random() * 3.5,
      type: 'fire'
    });
  }
}
function loopRadiant(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,6,14,0.30)';
  ctx.fillRect(0, 0, w, h);
  if (Math.random() < 0.6) {
    const angle = Math.random() * Math.PI * 2;
    const r = ballRadius * (0.4 + Math.random() * 0.5);
    particles.push({
      x: ball.x + Math.cos(angle) * r,
      y: ball.y + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -(0.6 + Math.random() * 1.5),
      hue: 15 + Math.random() * 50,
      life: 0.7 + Math.random() * 0.3,
      r: 1 + Math.random() * 2.2,
      type: 'fire'
    });
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.97; p.life -= 0.022;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const pHue = p.hue + (1 - p.life) * 20;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${pHue},100%,${55 + p.life * 15}%,${p.life * 0.85})`;
    ctx.fill();
  }
  trail.push({ x: ball.x, y: ball.y, r: ballRadius });
  if (trail.length > 55) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = i / trail.length;
    const tHue = 30 - (1 - alpha) * 20;
    const grad = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.r * alpha);
    grad.addColorStop(0, `hsla(${tHue + 30},100%,80%,${alpha * 0.7})`);
    grad.addColorStop(1, `hsla(${tHue},100%,45%,0)`);
    ctx.beginPath(); ctx.arc(t.x, t.y, Math.max(1, t.r * alpha), 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();
  }
  ctx.save();
  ctx.shadowColor = '#ff8800'; ctx.shadowBlur = 8 + novaPulse * 18;
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `hsl(${28 + novaPulse * 10},100%,55%)`; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
  novaPulse = Math.max(0, novaPulse - 0.04);
  ctx.save();
  ctx.shadowColor = '#ffdd00'; ctx.shadowBlur = 20 + Math.sin(Date.now() * 0.004) * 8;
  const sunGrad = ctx.createRadialGradient(ball.x - ballRadius * 0.3, ball.y - ballRadius * 0.3, 0, ball.x, ball.y, ballRadius);
  sunGrad.addColorStop(0, '#ffffff');
  sunGrad.addColorStop(0.3, '#ffee44');
  sunGrad.addColorStop(0.7, '#ffaa00');
  sunGrad.addColorStop(1, '#ff5500');
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI * 2);
  ctx.fillStyle = sunGrad; ctx.fill();
  ctx.restore();
  drawMirrorBall(30); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  const bounced = handleBounce(cx, cy);
  if (bounced) {
    spawnFireParticles(ball.x, ball.y, 22);
    novaPulse = 1.0;
    app.classList.add('shake'); setTimeout(() => app.classList.remove('shake'), 100);
  }
}

function spawnPrismaticParticles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.4;
    const speed = 1.2 + Math.random() * 4.0;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hue: Math.random() * 360,
      life: 1.0,
      r: 1.5 + Math.random() * 3,
      type: 'prismatic'
    });
  }
}
let prismaticHue = 0;
function loopPrismatic(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,5,18,0.20)';
  ctx.fillRect(0, 0, w, h);
  prismaticHue = (prismaticHue + 0.5) % 360;
  if (Math.random() < 0.55) {
    const angle = Math.random() * Math.PI * 2;
    const r = ballRadius * (0.6 + Math.random() * 1.2);
    particles.push({
      x: ball.x + Math.cos(angle) * r,
      y: ball.y + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -(0.3 + Math.random() * 0.9),
      hue: Math.random() * 360,
      life: 0.6 + Math.random() * 0.4,
      r: 1 + Math.random() * 2,
      type: 'prismatic'
    });
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.98; p.vy *= 0.98;
    p.hue = (p.hue + 1.5) % 360;
    p.life -= 0.018;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.save();
    ctx.shadowColor = `hsl(${p.hue},100%,70%)`;
    ctx.shadowBlur = 6 * p.life;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${p.hue},100%,75%,${p.life * 0.9})`;
    ctx.fill(); ctx.restore();
  }
  trail.push({ x: ball.x, y: ball.y, hue: prismaticHue, r: ballRadius });
  if (trail.length > 110) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = i / trail.length;
    const tHue = (t.hue + i * 3.3) % 360;
    const size = Math.max(1, t.r * alpha);
    ctx.save();
    ctx.shadowColor = `hsl(${tHue},100%,65%)`;
    ctx.shadowBlur = 8 * alpha;
    const grad = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, size);
    grad.addColorStop(0, `hsla(${tHue},100%,85%,${alpha * 0.75})`);
    grad.addColorStop(0.5, `hsla(${(tHue + 30) % 360},100%,65%,${alpha * 0.5})`);
    grad.addColorStop(1, `hsla(${(tHue + 60) % 360},100%,50%,0)`);
    ctx.beginPath(); ctx.arc(t.x, t.y, size, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill(); ctx.restore();
  }
  ctx.save();
  ctx.shadowColor = `hsl(${prismaticHue},100%,65%)`; ctx.shadowBlur = 10 + novaPulse * 20;
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI*2);
  ctx.strokeStyle = `hsl(${prismaticHue},90%,65%)`; ctx.lineWidth = 2.5 + novaPulse * 2; ctx.stroke();
  ctx.restore();
  novaPulse = Math.max(0, novaPulse - 0.035);
  const bHue1 = prismaticHue;
  const bHue2 = (prismaticHue + 120) % 360;
  const bHue3 = (prismaticHue + 240) % 360;
  ctx.save();
  ctx.shadowColor = `hsl(${bHue1},100%,75%)`; ctx.shadowBlur = 22 + Math.sin(Date.now() * 0.003) * 8;
  const ballGrad = ctx.createRadialGradient(ball.x - ballRadius * 0.3, ball.y - ballRadius * 0.3, 0, ball.x, ball.y, ballRadius);
  ballGrad.addColorStop(0, `hsl(${bHue1},100%,92%)`);
  ballGrad.addColorStop(0.4, `hsl(${bHue2},100%,70%)`);
  ballGrad.addColorStop(1, `hsl(${bHue3},100%,55%)`);
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = ballGrad; ctx.fill();
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius + 3, 0, Math.PI*2);
  ctx.strokeStyle = `hsla(${bHue2},100%,80%,0.5)`; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  drawMirrorBall(prismaticHue); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  const bounced = handleBounce(cx, cy);
  if (bounced) {
    spawnPrismaticParticles(ball.x, ball.y, 24);
    novaPulse = 1.0;
    app.classList.add('shake'); setTimeout(() => app.classList.remove('shake'), 120);
  }
}

let illuminationHue = 0;
function loopIllumination(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,5,18,0.18)';
  ctx.fillRect(0, 0, w, h);
  illuminationHue = (illuminationHue + 0.2) % 360;
  if (Math.random() < 0.6) {
    const angle = Math.random() * Math.PI * 2;
    const r = ballRadius * (0.8 + Math.random() * 1.5);
    particles.push({
      x: ball.x + Math.cos(angle) * r,
      y: ball.y + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -(0.2 + Math.random() * 0.7),
      hue: 200 + Math.random() * 40,
      life: 0.6 + Math.random() * 0.4,
      r: 1 + Math.random() * 2.5,
      type: 'illumination'
    });
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.99; p.vy *= 0.99;
    p.life -= 0.016;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.save();
    ctx.shadowColor = `rgba(255,255,255,${p.life})`;
    ctx.shadowBlur = 12 * p.life;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${p.life * 0.85})`;
    ctx.fill(); ctx.restore();
  }
  trail.push({ x: ball.x, y: ball.y, r: ballRadius });
  if (trail.length > 100) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t2 = trail[i], alpha = i / trail.length;
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 14 * alpha;
    const grad = ctx.createRadialGradient(t2.x, t2.y, 0, t2.x, t2.y, Math.max(1, t2.r * alpha));
    grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.8})`);
    grad.addColorStop(0.5, `rgba(200,230,255,${alpha * 0.5})`);
    grad.addColorStop(1, `rgba(180,210,255,0)`);
    ctx.beginPath(); ctx.arc(t2.x, t2.y, Math.max(1, t2.r * alpha), 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill(); ctx.restore();
  }
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 14 + novaPulse * 28;
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI*2);
  ctx.strokeStyle = `rgba(220,240,255,${0.4 + novaPulse * 0.4})`;
  ctx.lineWidth = 2 + novaPulse * 3; ctx.stroke(); ctx.restore();
  novaPulse = Math.max(0, novaPulse - 0.035);
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,1)';
  ctx.shadowBlur = 30 + Math.sin(Date.now() * 0.003) * 10;
  const ballGrad = ctx.createRadialGradient(
    ball.x - ballRadius * 0.35, ball.y - ballRadius * 0.35, 0,
    ball.x, ball.y, ballRadius
  );
  ballGrad.addColorStop(0, 'rgba(255,255,255,1)');
  ballGrad.addColorStop(0.4, 'rgba(210,235,255,0.95)');
  ballGrad.addColorStop(1, 'rgba(180,215,255,0.7)');
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = ballGrad; ctx.fill();
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius + 4, 0, Math.PI*2);
  ctx.strokeStyle = `rgba(255,255,255,${0.3 + Math.sin(Date.now() * 0.004) * 0.15})`;
  ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  drawMirrorBall(200); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  const bounced = handleBounce(cx, cy);
  if (bounced) {
    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 / 20) * i + Math.random() * 0.3;
      const speed2 = 1.5 + Math.random() * 4;
      particles.push({
        x: ball.x, y: ball.y,
        vx: Math.cos(angle) * speed2,
        vy: Math.sin(angle) * speed2,
        hue: 210, life: 1.0,
        r: 1.5 + Math.random() * 3,
        type: 'illumination'
      });
    }
    novaPulse = 1.0;
    app.classList.add('shake'); setTimeout(() => app.classList.remove('shake'), 120);
  }
}


// ══════════════════════════════════════════════════════════
// ── QUANTUM TRAIL ─────────────────────────────────────────
// Dark cobalt core · cyan-white electric arcs · volt discharge
// ══════════════════════════════════════════════════════════

// Lightning bolt helper — draws a jagged arc between two points
function drawLightningBolt(x1, y1, x2, y2, segments, spread, alpha, lineW, colorStr) {
  const pts = [[x1, y1]];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const mx = x1 + (x2 - x1) * t + (Math.random() - 0.5) * spread;
    const my = y1 + (y2 - y1) * t + (Math.random() - 0.5) * spread;
    pts.push([mx, my]);
  }
  pts.push([x2, y2]);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colorStr;
  ctx.lineWidth = lineW;
  ctx.shadowColor = colorStr;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

// Spawn quantum arc particles — sparks that shoot out from ball
function spawnQuantumParticles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.6;
    const spd = 2.5 + Math.random() * 6.5;
    const isCyan = Math.random() > 0.35;
    particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      hue: isCyan ? 185 + Math.random() * 20 : 210 + Math.random() * 30,
      life: 1.0,
      r: 1 + Math.random() * 2.8,
      type: 'quantum',
      isArc: Math.random() > 0.6,    // some particles become secondary arcs
      arcLen: 15 + Math.random() * 30
    });
  }
}

// Ambient electric motes orbiting the ball
function spawnQuantumMote() {
  const angle = Math.random() * Math.PI * 2;
  const r = ballRadius * (1.1 + Math.random() * 2.2);
  particles.push({
    x: ball.x + Math.cos(angle) * r,
    y: ball.y + Math.sin(angle) * r,
    vx: (Math.random() - 0.5) * 0.9,
    vy: -(0.1 + Math.random() * 0.6),
    hue: Math.random() > 0.5 ? 190 : 220,
    life: 0.5 + Math.random() * 0.5,
    r: 0.8 + Math.random() * 1.8,
    type: 'quantum_mote'
  });
}

let quantumFlash = 0; // post-bounce flash intensity

function loopQuantum(w, h, cx, cy) {
  // Near-opaque background keeps the canvas dark cobalt
  ctx.fillStyle = 'rgba(0,4,18,0.32)';
  ctx.fillRect(0, 0, w, h);

  const now = Date.now();

  // ── 1. Ambient electric motes ──
  if (Math.random() < 0.70) spawnQuantumMote();

  // ── 2. Update & draw all particles ──
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.95; p.vy *= 0.95;
    p.life -= p.type === 'quantum_mote' ? 0.020 : 0.022;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    if (p.type === 'quantum_mote') {
      // Tiny floating spark
      ctx.save();
      ctx.shadowColor = `hsla(${p.hue},100%,75%,${p.life})`;
      ctx.shadowBlur = 8 * p.life;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue},100%,85%,${p.life * 0.85})`;
      ctx.fill(); ctx.restore();
    } else if (p.isArc && p.life > 0.3) {
      // Secondary micro-bolt from this particle
      const ex = p.x + (Math.random() - 0.5) * p.arcLen;
      const ey = p.y + (Math.random() - 0.5) * p.arcLen;
      drawLightningBolt(p.x, p.y, ex, ey, 4, 6, p.life * 0.6, 0.8,
        `hsla(${p.hue},100%,88%,1)`);
    } else {
      // Regular arc spark
      ctx.save();
      ctx.shadowColor = `hsla(${p.hue},100%,80%,1)`;
      ctx.shadowBlur = 12 * p.life;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue},100%,88%,${p.life})`;
      ctx.fill(); ctx.restore();
    }
  }

  // ── 3. Electric trail ──
  trail.push({ x: ball.x, y: ball.y, r: ballRadius, t: now });
  if (trail.length > 90) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const pt = trail[i], alpha = i / trail.length;
    const size = Math.max(1, pt.r * alpha * 0.55);
    // Core trail dot — cobalt blue fading to cyan at the head
    const trailHue = 200 + alpha * 15; // 200 cobalt → 215 cyan
    ctx.save();
    ctx.shadowColor = `hsla(${trailHue},100%,65%,${alpha})`;
    ctx.shadowBlur = 10 * alpha;
    const tg = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, size);
    tg.addColorStop(0, `hsla(180,100%,92%,${alpha * 0.9})`);
    tg.addColorStop(0.5, `hsla(${trailHue},100%,65%,${alpha * 0.65})`);
    tg.addColorStop(1, `hsla(220,100%,45%,0)`);
    ctx.beginPath(); ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
    ctx.fillStyle = tg; ctx.fill();
    ctx.restore();

    // Occasional micro-jag between trail dots
    if (i > 0 && Math.random() < 0.14 * alpha) {
      const prev = trail[i - 1];
      drawLightningBolt(prev.x, prev.y, pt.x, pt.y, 3, 8, alpha * 0.5, 0.7,
        `hsla(190,100%,80%,1)`);
    }
  }

  // ── 4. Containment circle — pulsing electric ring ──
  quantumFlash = Math.max(0, quantumFlash - 0.04);
  const ringPulse = 0.5 + Math.sin(now * 0.003) * 0.5;
  const ringBlur = 8 + quantumFlash * 28 + ringPulse * 4;
  ctx.save();
  ctx.shadowColor = `rgba(0,220,255,${0.5 + quantumFlash * 0.5})`;
  ctx.shadowBlur = ringBlur;
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(0,${180 + quantumFlash * 75},255,${0.45 + quantumFlash * 0.5})`;
  ctx.lineWidth = 2 + quantumFlash * 3.5; ctx.stroke();
  ctx.restore();

  // Secondary faint outer ring
  ctx.save();
  ctx.globalAlpha = 0.12 + quantumFlash * 0.18;
  ctx.shadowColor = '#00eeff';
  ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.arc(cx, cy, effectiveCircleRadius + 4, 0, Math.PI * 2);
  ctx.strokeStyle = '#00eeff'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();

  // Random arc flickers along the ring boundary
  if (Math.random() < 0.22 + quantumFlash * 0.4) {
    const a1 = Math.random() * Math.PI * 2;
    const a2 = a1 + (Math.random() - 0.5) * 0.7;
    const x1 = cx + Math.cos(a1) * effectiveCircleRadius;
    const y1 = cy + Math.sin(a1) * effectiveCircleRadius;
    const x2 = cx + Math.cos(a2) * effectiveCircleRadius;
    const y2 = cy + Math.sin(a2) * effectiveCircleRadius;
    drawLightningBolt(x1, y1, x2, y2, 5, 12, 0.35 + quantumFlash * 0.4, 1.0,
      'rgba(0,240,255,1)');
  }

  // ── 5. Ball — dark cobalt orb with cyan-white corona ──
  const ballPulse = Math.sin(now * 0.005) * 0.5 + 0.5;
  ctx.save();
  ctx.shadowColor = `rgba(0,220,255,${0.8 + quantumFlash * 0.2})`;
  ctx.shadowBlur = 22 + quantumFlash * 20 + ballPulse * 6;

  // Outer corona
  const coronaGrad = ctx.createRadialGradient(ball.x, ball.y, ballRadius * 0.7, ball.x, ball.y, ballRadius * 2.0);
  coronaGrad.addColorStop(0, `rgba(0,200,255,${0.18 + quantumFlash * 0.15})`);
  coronaGrad.addColorStop(1, 'rgba(0,40,120,0)');
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius * 2.0, 0, Math.PI * 2);
  ctx.fillStyle = coronaGrad; ctx.fill();

  // Core ball gradient — deep cobalt with bright cyan-white cap
  const ballGrad = ctx.createRadialGradient(
    ball.x - ballRadius * 0.3, ball.y - ballRadius * 0.35, 0,
    ball.x, ball.y, ballRadius
  );
  ballGrad.addColorStop(0, 'rgba(220,248,255,1)');       // white-cyan specular
  ballGrad.addColorStop(0.25, 'rgba(0,210,255,0.95)');   // pure cyan
  ballGrad.addColorStop(0.6, 'rgba(0,80,200,0.9)');      // cobalt mid
  ballGrad.addColorStop(1, 'rgba(0,10,60,1)');           // near-black edge
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI * 2);
  ctx.fillStyle = ballGrad; ctx.fill();

  // Electric rim
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(0,${200 + quantumFlash * 55},255,${0.75 + quantumFlash * 0.25})`;
  ctx.lineWidth = 1.8 + quantumFlash; ctx.stroke();
  ctx.restore();

  // Arc bolts radiating from ball surface on ambient tick
  if (Math.random() < 0.30 + quantumFlash * 0.5) {
    const arcAngle = Math.random() * Math.PI * 2;
    const bx = ball.x + Math.cos(arcAngle) * ballRadius;
    const by = ball.y + Math.sin(arcAngle) * ballRadius;
    const ex = bx + Math.cos(arcAngle + (Math.random() - 0.5) * 1.5) * (10 + Math.random() * 28);
    const ey = by + Math.sin(arcAngle + (Math.random() - 0.5) * 1.5) * (10 + Math.random() * 28);
    drawLightningBolt(bx, by, ex, ey, 5, 7, 0.55 + quantumFlash * 0.3, 1.2,
      'rgba(180,240,255,1)');
  }

  drawMirrorBall(190); handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;

  const bounced = handleBounce(cx, cy);
  if (bounced) {
    spawnQuantumParticles(ball.x, ball.y, 28);
    quantumFlash = 1.0;
    // Full-canvas electric flash
    ctx.save();
    ctx.globalAlpha = 0.08 + Math.random() * 0.06;
    ctx.fillStyle = 'rgba(0,180,255,1)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    // Radial shock burst from impact point
    const shockGrad = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, effectiveCircleRadius * 0.4);
    shockGrad.addColorStop(0, 'rgba(0,220,255,0.22)');
    shockGrad.addColorStop(1, 'rgba(0,40,120,0)');
    ctx.save(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, effectiveCircleRadius * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = shockGrad; ctx.fill(); ctx.restore();
    // 3 main bolt arcs from impact point toward ring
    for (let b = 0; b < 3; b++) {
      const ba = Math.random() * Math.PI * 2;
      const bex = cx + Math.cos(ba) * effectiveCircleRadius;
      const bey = cy + Math.sin(ba) * effectiveCircleRadius;
      drawLightningBolt(ball.x, ball.y, bex, bey, 8, 18, 0.7, 1.5,
        'rgba(160,236,255,1)');
    }
    app.classList.add('shake'); setTimeout(() => app.classList.remove('shake'), 120);
  }
}
