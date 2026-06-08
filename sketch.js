let gameState = "menu";

// BALL
let ballX, ballY;
let ballRadius = 10;
let vx, vy;

// WORLD
let gravity = 0.06;
let arenaRadius = 180;

// TRAIL + EFFECTS
let trail = [];
let bounceFlash = 0;

// BOUNCE COUNTER
let bounceCount = 0;

function setup() {
  createCanvas(800, 800);
  colorMode(HSB, 360, 100, 100, 100);
}

/* ---------------- RESET ---------------- */

function resetGame() {
  ballX = width / 2;
  ballY = height / 2;

  let speed = random(2, 5);
  let dir = random(TWO_PI);

  vx = cos(dir) * speed;
  vy = sin(dir) * speed;

  ballRadius = 10;
  trail = [];
  bounceFlash = 0;

  bounceCount = 0;
}

/* ---------------- MAIN LOOP ---------------- */

function draw() {
  background(0);

  if (gameState === "menu") drawMenu();
  else if (gameState === "default") runDefaultGame();
}

/* ---------------- MENU ---------------- */

function drawMenu() {
  fill(255);
  textAlign(CENTER, CENTER);

  textSize(42);
  text("CHROMATIC", width / 2, 120);

  rectMode(CENTER);

  fill(255);
  rect(width / 2, 240, 160, 50, 10);

  fill(0);
  textSize(24);
  text("PLAY", width / 2, 240);
}

/* ---------------- INPUT ---------------- */

function mousePressed() {

  if (gameState === "menu") {
    if (mouseX > width/2-80 && mouseX < width/2+80 &&
        mouseY > 215 && mouseY < 265) {
      resetGame();
      gameState = "default";
    }
  }
}

/* ---------------- GAME ---------------- */

function runDefaultGame() {
  simulateGame();
  drawArena();

  // ✅ FIXED HUD (always visible)
  push();
  resetMatrix();

  // background box
  noStroke();
  fill(0, 0, 0, 160);
  rect(10, 10, 200, 45, 8);

  // text
  fill(255);
  textSize(26);
  textAlign(LEFT, TOP);
  text("Bounces: " + bounceCount, 20, 18);

  pop();
}

/* ---------------- CORE SIMULATION ---------------- */

function simulateGame() {

  vy += gravity;

  ballX += vx;
  ballY += vy;

  let ballHue = (frameCount * 3) % 360;

  let dx = ballX - width / 2;
  let dy = ballY - height / 2;

  let distFromCenter = sqrt(dx * dx + dy * dy);

  let hitWall = distFromCenter + ballRadius >= arenaRadius;

  if (hitWall) {
    bounce(dx, dy, distFromCenter);
  }

  trail.push({
    x: ballX,
    y: ballY,
    r: ballRadius,
    hue: ballHue
  });

  if (trail.length > 350) trail.shift();

  noFill();

  for (let i = 1; i < trail.length; i++) {
    let t = trail[i];
    let a = pow(i / trail.length, 1.5) * 100;

    let ringR = t.r * 0.9;
    let lw = max(1, ringR * 0.55);

    stroke(t.hue, 100, 100, a);
    strokeWeight(lw);
    circle(t.x, t.y, ringR * 2);
  }

  bounceFlash *= 0.85;

  push();
  translate(ballX, ballY);
  fill(0, 0, 0);
  stroke(0, 0, 100);
  strokeWeight(2.5);
  circle(0, 0, ballRadius * 2);
  pop();
}

/* ---------------- BOUNCE ---------------- */

function bounce(dx, dy, distFromCenter) {

  let nx = dx / distFromCenter;
  let ny = dy / distFromCenter;

  ballX = width / 2 + nx * (arenaRadius - ballRadius);
  ballY = height / 2 + ny * (arenaRadius - ballRadius);

  let dot = vx * nx + vy * ny;

  let vnX = nx * dot;
  let vnY = ny * dot;

  let vtX = vx - vnX;
  let vtY = vy - vnY;

  vnX *= -0.98;
  vnY *= -0.98;

  vx = vnX + vtX;
  vy = vnY + vtY;

  vx *= 1.03;
  vy *= 1.03;

  vx += random(-0.5, 0.5);
  vy += random(-0.5, 0.5);

  ballRadius = ballRadius * 1.04 + 0.4;

  bounceFlash = 60;

  bounceCount++;
}

/* ---------------- ARENA ---------------- */

function drawArena() {
  noFill();
  stroke(255);
  strokeWeight(3);
  circle(width / 2, height / 2, arenaRadius * 2);
}