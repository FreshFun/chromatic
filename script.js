const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let particles = [];
let novaPulse = 0;
let attrZen = false;
let attrMirror = false;
let mirrorBall = {};
let attrMenuOpen = false;
let sfxEnabled = true;
let musicEnabled = true;
let musicNodes = null;
let musicPlaying = false;
let musicStarted = false;
const GRAVITY_DEFAULT = 0.06;
let GRAVITY = 0.06;
const START_SPEED = 4.2;
const SPEED_INCREMENT = 0.12;
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
function playBounceSfx(speed) {
  if (!sfxEnabled) return;
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
  if (!sfxEnabled) return;
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
  if (!sfxEnabled) return;
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
  if (!sfxEnabled) return;
  const t = audioCtx.currentTime;
  const pitch = Math.min(1600, 350 + speed * 40);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.3, t + 0.2);
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(t + 0.25);
  const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
  o2.type = 'sawtooth';
  o2.frequency.setValueAtTime(pitch * 2, t);
  o2.frequency.exponentialRampToValueAtTime(pitch * 0.1, t + 0.15);
  g2.gain.setValueAtTime(0.18, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o2.connect(g2); g2.connect(audioCtx.destination);
  o2.start(); o2.stop(t + 0.18);
}
function playBounceSparkySfx(speed) {
  if (!sfxEnabled) return;
  const t = audioCtx.currentTime;
  const pitch = Math.min(1800, 500 + speed * 35);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(pitch, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.2, t + 0.08);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(t + 0.1);
  const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
  o2.type = 'sawtooth';
  o2.frequency.setValueAtTime(pitch * 2.5, t);
  o2.frequency.exponentialRampToValueAtTime(pitch * 0.3, t + 0.06);
  g2.gain.setValueAtTime(0.15, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  o2.connect(g2); g2.connect(audioCtx.destination);
  o2.start(); o2.stop(t + 0.08);
}
function loopSparky(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.2)';
  ctx.fillRect(0, 0, w, h);
  
  trail.push({ x: ball.x, y: ball.y, r: ballRadius });
  if (trail.length > 60) trail.shift();
  
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const alpha = i / trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(200,100%,60%,${alpha * 0.7})`;
    ctx.fill();
    ctx.strokeStyle = `hsla(200,100%,80%,${alpha * 0.9})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  
  ctx.beginPath();
  ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
  ctx.strokeStyle = '#0066ff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#0052cc';
  ctx.fill();
  ctx.strokeStyle = '#00ccff';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  drawMirrorBall(200);
  handleMirror(cx, cy);
  
  ball.vy += GRAVITY;
  ball.x += ball.vx;
  ball.y += ball.vy;
  
  const dx = ball.x - cx, dy = ball.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = circleRadius - ballRadius;
  
  if (dist >= maxDist) {
    const nx = dx / dist, ny = dy / dist;
    const dot = ball.vx * nx + ball.vy * ny;
    ball.vx -= 2 * dot * nx;
    ball.vy -= 2 * dot * ny;
    currentSpeed += SPEED_INCREMENT;
    const s = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    ball.vx = ball.vx / s * currentSpeed;
    ball.vy = ball.vy / s * currentSpeed;
    ball.x = cx + nx * (maxDist - 1);
    ball.y = cy + ny * (maxDist - 1);
    bounces++;
    ballRadius = 10 + bounces * 1.4;
    document.getElementById('bounceCount').textContent = `Bounces: ${bounces}`;
    playBounceSparkySfx(currentSpeed);
  }
}
function startMusic() {
  if (musicPlaying || !musicEnabled) return;
  musicPlaying = true;
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0, audioCtx.currentTime);
  master.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + 2);
  master.connect(audioCtx.destination);
  const delay = audioCtx.createDelay(1.0);
  delay.delayTime.value = 0.45;
  const delayGain = audioCtx.createGain();
  delayGain.gain.value = 0.35;
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
      arpActive = false;
      clearTimeout(arpTimer);
      master.gain.setValueAtTime(master.gain.value, audioCtx.currentTime);
      master.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.2);
      setTimeout(() => {
        try { bass.stop(); bass2.stop(); pad.stop(); pad2.stop(); } catch(e) {}
        musicPlaying = false;
        musicNodes = null;
      }, 1400);
    }
  };
}
function stopMusic() {
  if (musicNodes && musicPlaying) musicNodes.stop();
}
document.querySelectorAll('.btn').forEach(b => b.addEventListener('mouseenter', playHoverSfx));
const app = document.getElementById('app');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const menuScreen = document.getElementById('menuScreen');
const modeScreen = document.getElementById('modeScreen');
const gameScreen = document.getElementById('gameScreen');
const settingsScreen = document.getElementById('settingsScreen');
const modeLabel = document.getElementById('modeLabel');
let animId = null, bounces = 0, ball = {}, trail = [];
let circleRadius = 0, ballRadius = 0, hue = 0, currentSpeed = 0;
let currentMode = '';
window.addEventListener('resize', () => {
  if (!gameScreen.classList.contains('hidden')) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    circleRadius = Math.min(canvas.width, canvas.height) * 0.38;
  }
});
document.getElementById('app').addEventListener('click', () => {
  if (!musicStarted) { musicStarted = true; startMusic(); }
}, { once: true });
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
document.getElementById('gameBackBtn').addEventListener('click', () => {
  playClickSfx();
  stopGame();
  gameScreen.classList.add('hidden');
  menuScreen.classList.remove('hidden');
  startMusic();
  attrMenuOpen = false;
  attrZen = false;
  attrMirror = false;
  GRAVITY = GRAVITY_DEFAULT;
  document.getElementById('attrMenu').style.display = 'none';
  updateAttrBtn('attrZen', false);
  updateAttrBtn('attrMirror', false);
});
document.getElementById('attrBtn').addEventListener('click', () => {
  playClickSfx();
  const menu = document.getElementById('attrMenu');
  attrMenuOpen = !attrMenuOpen;
  menu.style.display = attrMenuOpen ? 'flex' : 'none';
});
document.getElementById('attrClose').addEventListener('click', () => {
  playClickSfx();
  attrMenuOpen = false;
  document.getElementById('attrMenu').style.display = 'none';
});
document.getElementById('attrZen').addEventListener('click', () => {
  playClickSfx();
  attrZen = !attrZen;
  GRAVITY = attrZen ? 0 : GRAVITY_DEFAULT;
  updateAttrBtn('attrZen', attrZen);
});
document.getElementById('attrMirror').addEventListener('click', () => {
  playClickSfx();
  attrMirror = !attrMirror;
  updateAttrBtn('attrMirror', attrMirror);
  if (attrMirror) spawnMirrorBall(canvas.width, canvas.height);
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
  if (musicEnabled) { startMusic(); } else { stopMusic(); }
  playClickSfx();
});
document.getElementById('chromaticModeBtn').addEventListener('click', () => {
  playClickSfx(); stopMusic();
  modeScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  currentMode = 'chromatic'; modeLabel.textContent = 'Chromatic Mode';
  setTimeout(startGame, 50);
});
document.getElementById('originalModeBtn').addEventListener('click', () => {
  playClickSfx(); stopMusic();
  modeScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  currentMode = 'original'; modeLabel.textContent = 'Original Mode';
  setTimeout(startGame, 50);
});
document.getElementById('hyperModeBtn').addEventListener('click', () => {
  playClickSfx(); stopMusic();
  modeScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  currentMode = 'hyper'; modeLabel.textContent = 'Hyper Mode';
  setTimeout(startGame, 50);
});
document.getElementById('novaModeBtn').addEventListener('click', () => {
  playClickSfx(); stopMusic();
  modeScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  currentMode = 'nova'; modeLabel.textContent = 'Nova Mode';
  setTimeout(startGame, 50);
});
document.getElementById('sparkyModeBtn').addEventListener('click', () => {
  playClickSfx(); stopMusic();
  modeScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  currentMode = 'sparky'; modeLabel.textContent = 'Sparky Mode';
  setTimeout(startGame, 50);
});
function startGame() {
  particles = []; novaPulse = 0;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const w = canvas.width, h = canvas.height;
  circleRadius = Math.min(w, h) * 0.38;
  ballRadius = 10; bounces = 0; trail = []; hue = 0;
  currentSpeed = START_SPEED;
  document.getElementById('bounceCount').textContent = 'Bounces: 0';
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
  if (currentMode === 'chromatic') loopChromatic(w, h, cx, cy);
  else if (currentMode === 'original') loopOriginal(w, h, cx, cy);
  else if (currentMode === 'hyper') loopHyper(w, h, cx, cy);
  else if (currentMode === 'nova') loopNova(w, h, cx, cy);
else if (currentMode === 'sparky') loopSparky(w, h, cx, cy);
  animId = requestAnimationFrame(loop);
}
function handleMirror(cx, cy) {
  if (!attrMirror) return;
  mirrorBall.vy += GRAVITY;
  mirrorBall.x += mirrorBall.vx;
  mirrorBall.y += mirrorBall.vy;
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
  const mmaxDist = circleRadius - ballRadius;
  if (mdist >= mmaxDist) {
    const mnx = mdx/mdist, mny = mdy/mdist;
    const mdot = mirrorBall.vx*mnx + mirrorBall.vy*mny;
    mirrorBall.vx -= 2*mdot*mnx; mirrorBall.vy -= 2*mdot*mny;
    const ms = Math.sqrt(mirrorBall.vx*mirrorBall.vx + mirrorBall.vy*mirrorBall.vy);
    mirrorBall.vx = mirrorBall.vx/ms * currentSpeed;
    mirrorBall.vy = mirrorBall.vy/ms * currentSpeed;
    mirrorBall.x = cx + mnx*(mmaxDist - 1);
    mirrorBall.y = cy + mny*(mmaxDist - 1);
  }
}
function drawMirrorBall(hue) {
  if (!attrMirror) return;
  const mFlashHue = (hue + 180) % 360;
  ctx.beginPath();
  ctx.arc(mirrorBall.x, mirrorBall.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = `hsl(${mFlashHue},100%,70%)`; ctx.fill();
  ctx.strokeStyle = `hsl(${(mFlashHue+60)%360},100%,80%)`;
  ctx.lineWidth = 2; ctx.stroke();
}
function loopChromatic(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.28)';
  ctx.fillRect(0, 0, w, h);
  hue = (hue + 1.0) % 360;
  trail.push({ x: ball.x, y: ball.y, hue, r: ballRadius });
  if (trail.length > 100) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = i / trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, Math.max(1, t.r * alpha), 0, Math.PI*2);
    ctx.fillStyle = `hsla(${t.hue},100%,60%,${alpha * 0.6})`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, circleRadius, 0, Math.PI*2);
  ctx.strokeStyle = `hsl(${hue},80%,55%)`;
  ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = `hsl(${hue},100%,70%)`; ctx.fill();
  drawMirrorBall(hue);
  handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  const dx = ball.x - cx, dy = ball.y - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = circleRadius - ballRadius;
  if (dist >= maxDist) {
    const nx = dx/dist, ny = dy/dist;
    const dot = ball.vx*nx + ball.vy*ny;
    ball.vx -= 2*dot*nx; ball.vy -= 2*dot*ny;
    currentSpeed += SPEED_INCREMENT;
    const s = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
    ball.vx = ball.vx/s * currentSpeed; ball.vy = ball.vy/s * currentSpeed;
    ball.x = cx + nx*(maxDist - 1); ball.y = cy + ny*(maxDist - 1);
    bounces++; ballRadius = 10 + bounces * 1.4;
    document.getElementById('bounceCount').textContent = `Bounces: ${bounces}`;
    playBounceSfx(currentSpeed);
  }
}
function loopOriginal(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.05)';
  ctx.fillRect(0, 0, w, h);
  hue = (hue + 0.8) % 360;
  trail.push({ x: ball.x, y: ball.y, hue, r: ballRadius });
  if (trail.length > 5000) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI*2);
    ctx.fillStyle = `hsl(${t.hue},100%,60%)`;
    ctx.globalAlpha = 0.4; ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, circleRadius, 0, Math.PI*2);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = '#000000'; ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
  drawMirrorBall(hue);
  handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  const dx = ball.x - cx, dy = ball.y - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = circleRadius - ballRadius;
  if (dist >= maxDist) {
    const nx = dx/dist, ny = dy/dist;
    const dot = ball.vx*nx + ball.vy*ny;
    ball.vx -= 2*dot*nx; ball.vy -= 2*dot*ny;
    currentSpeed += SPEED_INCREMENT;
    const s = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
    ball.vx = ball.vx/s * currentSpeed; ball.vy = ball.vy/s * currentSpeed;
    ball.x = cx + nx*(maxDist - 1); ball.y = cy + ny*(maxDist - 1);
    bounces++; ballRadius = 10 + bounces * 1.4;
    document.getElementById('bounceCount').textContent = `Bounces: ${bounces}`;
    playBounceOriginalSfx(currentSpeed);
  }
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
    ctx.beginPath();
    ctx.arc(t.x, t.y, Math.max(1, t.r * alpha), 0, Math.PI*2);
    ctx.fillStyle = `hsla(${flashHue},100%,65%,${alpha * 0.8})`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, circleRadius, 0, Math.PI*2);
  ctx.strokeStyle = `hsl(${hue},100%,60%)`;
  ctx.lineWidth = 3; ctx.stroke();
  const ballFlashHue = (hue * 3) % 360;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = `hsl(${ballFlashHue},100%,70%)`; ctx.fill();
  ctx.strokeStyle = `hsl(${(ballFlashHue + 120) % 360},100%,80%)`;
  ctx.lineWidth = 2; ctx.stroke();
  drawMirrorBall(hue);
  handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  const dx = ball.x - cx, dy = ball.y - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = circleRadius - ballRadius;
  if (dist >= maxDist) {
    const nx = dx/dist, ny = dy/dist;
    const dot = ball.vx*nx + ball.vy*ny;
    ball.vx -= 2*dot*nx; ball.vy -= 2*dot*ny;
    currentSpeed += SPEED_INCREMENT * 1.5;
    const s = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
    ball.vx = ball.vx/s * currentSpeed; ball.vy = ball.vy/s * currentSpeed;
    ball.x = cx + nx*(maxDist - 1); ball.y = cy + ny*(maxDist - 1);
    bounces++; ballRadius = 10 + bounces * 1.4;
    document.getElementById('bounceCount').textContent = `Bounces: ${bounces}`;
    playBounceHyperSfx(currentSpeed);
  }
}
function spawnParticles(x, y, h, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
    const speed = 2 + Math.random() * 5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hue: (h + Math.random() * 60 - 30 + 360) % 360,
      life: 1.0,
      r: 2 + Math.random() * 3
    });
  }
}
function loopNova(w, h, cx, cy) {
  ctx.fillStyle = 'rgba(2,11,24,0.22)';
  ctx.fillRect(0, 0, w, h);
  hue = (hue + 2.5) % 360;
  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.94; p.vy *= 0.94;
    p.life -= 0.025;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${p.hue},100%,65%,${p.life * 0.9})`;
    ctx.fill();
  }
  // trail
  trail.push({ x: ball.x, y: ball.y, hue, r: ballRadius });
  if (trail.length > 80) trail.shift();
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i], alpha = i / trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, Math.max(1, t.r * alpha * 0.6), 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${t.hue},100%,65%,${alpha * 0.7})`;
    ctx.fill();
  }
  // ring with pulse glow
  novaPulse = Math.max(0, novaPulse - 0.04);
  ctx.save();
  ctx.shadowColor = `hsl(${hue},100%,60%)`;
  ctx.shadowBlur = 3 + novaPulse * 20;
  ctx.beginPath();
  ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `hsl(${hue},90%,60%)`;
  ctx.lineWidth = 2 + novaPulse * 3; ctx.stroke();
  ctx.restore();
  // ball
  ctx.save();
  ctx.shadowColor = `hsl(${hue},100%,70%)`;
  ctx.shadowBlur = 15 + novaPulse * 10;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI * 2);
  ctx.fillStyle = `hsl(${hue},100%,72%)`; ctx.fill();
  ctx.restore();
  drawMirrorBall(hue);
  handleMirror(cx, cy);
  ball.vy += GRAVITY; ball.x += ball.vx; ball.y += ball.vy;
  const dx = ball.x - cx, dy = ball.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = circleRadius - ballRadius;
  if (dist >= maxDist) {
    const nx = dx / dist, ny = dy / dist;
    const dot = ball.vx * nx + ball.vy * ny;
    ball.vx -= 2 * dot * nx; ball.vy -= 2 * dot * ny;
    currentSpeed += SPEED_INCREMENT;
    const s = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    ball.vx = ball.vx / s * currentSpeed; ball.vy = ball.vy / s * currentSpeed;
    ball.x = cx + nx * (maxDist - 1); ball.y = cy + ny * (maxDist - 1);
    bounces++; ballRadius = 10 + bounces * 1.4;
    document.getElementById('bounceCount').textContent = `Bounces: ${bounces}`;
    spawnParticles(ball.x, ball.y, hue, 18);
    novaPulse = 1.0;
    playBounceNovaSfx(currentSpeed);
    app.classList.add('shake');
    setTimeout(() => app.classList.remove('shake'), 120);
  }
}
