const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playHoverSfx() {
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

document.querySelectorAll('.btn').forEach(b => b.addEventListener('mouseenter', playHoverSfx));

const app = document.getElementById('app');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const menuScreen = document.getElementById('menuScreen');
const modeScreen = document.getElementById('modeScreen');
const gameScreen = document.getElementById('gameScreen');
const modeLabel = document.getElementById('modeLabel');

let animId = null, bounces = 0, ball = {}, trail = [];
let circleRadius = 0, ballRadius = 0, hue = 0, currentSpeed = 0;
let currentMode = '';

const GRAVITY = 0.06;
const START_SPEED = 4.2;
const SPEED_INCREMENT = 0.12;

document.getElementById('playBtn').addEventListener('click', () => { playClickSfx(); menuScreen.classList.add('hidden'); modeScreen.classList.remove('hidden'); });
document.getElementById('settingsBtn').addEventListener('click', playClickSfx);
document.getElementById('backBtn').addEventListener('click', () => { playClickSfx(); modeScreen.classList.add('hidden'); menuScreen.classList.remove('hidden'); });
document.getElementById('gameBackBtn').addEventListener('click', () => { playClickSfx(); stopGame(); gameScreen.classList.add('hidden'); menuScreen.classList.remove('hidden'); });

document.getElementById('chromaticModeBtn').addEventListener('click', () => {
  playClickSfx(); modeScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  currentMode = 'chromatic';
  modeLabel.textContent = 'Chromatic Mode';
  setTimeout(startGame, 50);
});

document.getElementById('originalModeBtn').addEventListener('click', () => {
  playClickSfx(); modeScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  currentMode = 'original';
  modeLabel.textContent = 'Original Mode';
  setTimeout(startGame, 50);
});

function startGame() {
  const w = app.offsetWidth, h = app.offsetHeight;
  canvas.width = w; canvas.height = h;
  circleRadius = Math.min(w, h) * 0.38;
  ballRadius = 10; bounces = 0; trail = []; hue = 0;
  currentSpeed = START_SPEED;
  document.getElementById('bounceCount').textContent = 'Bounces: 0';
  const angle = (Math.random() - 0.5) * 1.0 - Math.PI / 2;
  ball = { x: w/2, y: h/2, vx: Math.cos(angle) * currentSpeed, vy: Math.sin(angle) * currentSpeed };
  if (animId) cancelAnimationFrame(animId);
  loop();
}

function stopGame() {
  if (animId) cancelAnimationFrame(animId);
  animId = null;
}

function loop() {
  const w = canvas.width, h = canvas.height, cx = w/2, cy = h/2;

  if (currentMode === 'chromatic') {
    loopChromatic(w, h, cx, cy);
  } else if (currentMode === 'original') {
    loopOriginal(w, h, cx, cy);
  }

  animId = requestAnimationFrame(loop);
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
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = `hsl(${hue},100%,70%)`;
  ctx.fill();

  ball.vy += GRAVITY;
  ball.x += ball.vx;
  ball.y += ball.vy;

  const dx = ball.x - cx, dy = ball.y - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = circleRadius - ballRadius;

  if (dist >= maxDist) {
    const nx = dx/dist, ny = dy/dist;
    const dot = ball.vx*nx + ball.vy*ny;
    ball.vx -= 2*dot*nx;
    ball.vy -= 2*dot*ny;

    currentSpeed += SPEED_INCREMENT;
    const s = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
    ball.vx = ball.vx/s * currentSpeed;
    ball.vy = ball.vy/s * currentSpeed;

    ball.x = cx + nx*(maxDist - 1);
    ball.y = cy + ny*(maxDist - 1);

    bounces++;
    ballRadius = 10 + bounces * 1.4;
    document.getElementById('bounceCount').textContent = `Bounces: ${bounces}`;
    playBounceSfx(currentSpeed);
    app.classList.remove('shake');
    void app.offsetWidth;
    app.classList.add('shake');
    setTimeout(() => app.classList.remove('shake'), 120);
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
    ctx.globalAlpha = 0.4;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(cx, cy, circleRadius, 0, Math.PI*2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ballRadius, 0, Math.PI*2);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ball.vy += GRAVITY;
  ball.x += ball.vx;
  ball.y += ball.vy;

  const dx = ball.x - cx, dy = ball.y - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = circleRadius - ballRadius;

  if (dist >= maxDist) {
    const nx = dx/dist, ny = dy/dist;
    const dot = ball.vx*nx + ball.vy*ny;
    ball.vx -= 2*dot*nx;
    ball.vy -= 2*dot*ny;

    currentSpeed += SPEED_INCREMENT;
    const s = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
    ball.vx = ball.vx/s * currentSpeed;
    ball.vy = ball.vy/s * currentSpeed;

    ball.x = cx + nx*(maxDist - 1);
    ball.y = cy + ny*(maxDist - 1);

    bounces++;
    ballRadius = 10 + bounces * 1.4;
    document.getElementById('bounceCount').textContent = `Bounces: ${bounces}`;
    playBounceOriginalSfx(currentSpeed);
    app.classList.remove('shake');
    void app.offsetWidth;
    app.classList.add('shake');
    setTimeout(() => app.classList.remove('shake'), 120);
  }
}
