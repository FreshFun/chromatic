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
  textFont("monospace");
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
  drawBackground();

  if (gameState === "menu") drawMenu();
  else if (gameState === "default") runDefaultGame();

  drawScanlines();
}

/* ---------------- BACKGROUND ---------------- */

function drawBackground() {
  background(230, 40, 6);

  stroke(180, 40, 20, 25);
  strokeWeight(1);

  let gridSize = 40;
  for (let x = 0; x < width; x += gridSize) {
    line(x, 0, x, height);
  }
  for (let y = 0; y < height; y += gridSize) {
    line(0, y, width, y);
  }

  noStroke();
  fill(190, 80, 100, bounceFlash * 0.4);
  circle(width / 2, height / 2, arenaRadius * 2.2);
}

/* ---------------- SCANLINES ---------------- */

function drawScanlines() {
  noStroke();
  fill(0, 0, 0, 6);
  for (let y = 0; y < height; y += 4) {
    rect(0, y, width, 2);
  }
}

/* ---------------- MENU ---------------- */

function drawMenu() {
  textAlign(CENTER, CENTER);

  fill(200, 100, 100);
  textSize(48);
  text("CHROMATIC", width / 2, 120);

  let hover =
    mouseX > width / 2 - 80 &&
    mouseX < width / 2 + 80 &&
    mouseY > 215 &&
    mouseY < 265;

  noStroke();
  fill(180, 100, 100, hover ? 40 : 20);
  rect(width / 2, 240, 180, 60, 12);

  stroke(180, 100, 100);
  noFill();
  rect(width / 2, 240, 180, 60, 12);

  // ✅ FIXED ALIGNMENT ONLY
  fill(180, 100, 100);
  noStroke();
  textSize(22);
  textAlign(CENTER, CENTER);
  text("PLAY", width / 2, 240);
}

/* ---------------- INPUT ---------------- */

function mousePressed() {
  if (gameState === "menu") {
    if (
      mouseX > width / 2 - 80 &&
      mouseX < width / 2 + 80 &&
      mouseY > 215 &&
      mouseY < 265
    ) {
      resetGame();
      gameState = "default";
    }
  }
}

/* ---------------- GAME ---------------- */

function runDefaultGame() {
  simulateGame();
  drawArena();
  drawHUD();
}

/* ---------------- HUD ---------------- */

function drawHUD() {
  push();
  resetMatrix();

  noStroke();
  fill(190, 100, 100, 15);
  rect(10, 10, 220, 60, 10);

  stroke(190, 100, 100, 80);
  noFill();
  rect(10, 10, 220, 60, 10);

  fill(190, 100, 100);
  noStroke();
  textSize(20);
  textAlign(LEFT, TOP);
  text("B O U N C E S : " + bounceCount, 20, 25);

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

  for (let i = 6; i > 0; i--) {
    noStroke();
    fill(190, 100, 100, 6);
    circle(0, 0, ballRadius * 2 + i * 3);
  }

  stroke(190, 100, 100);
  strokeWeight(2);
  fill(0, 0, 0);
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

  stroke(190, 100, 100, 20);
  strokeWeight(10);
  circle(width / 2, height / 2, arenaRadius * 2);

  stroke(190, 100, 100);
  strokeWeight(2);
  circle(width / 2, height / 2, arenaRadius * 2);
}