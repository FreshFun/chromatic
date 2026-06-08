let gameState = "menu";

// BALL
let ballX, ballY;
let ballRadius = 12;
let vx, vy;

// WORLD
let gravity = 0.06;
let arenaRadius = 180;

// TRAIL
let trail = [];

// GAP
let gapSize = 0.12;
let gapStart = -gapSize;
let gapEnd = gapSize;

function setup() {

  let canvas = createCanvas(800, 800);
  canvas.parent("game-container");

  colorMode(HSB, 360, 100, 100, 100);

  resetGame();
}

function resetGame() {

  ballX = width / 2;
  ballY = height / 2;

  let speed = random(2, 5);
  let dir = random(TWO_PI);

  vx = cos(dir) * speed;
  vy = sin(dir) * speed;

  ballRadius = 12;
  trail = [];
}

function draw() {

  background(220, 80, 10);

  if (gameState === "menu") {
    drawMenu();
  }
  else if (gameState === "modeSelect") {
    drawModeSelect();
  }
  else if (gameState === "default") {
    runGame(false);
    drawArena();
  }
  else if (gameState === "escape") {
    runGame(true);
    drawEscapeArena();
    checkEscape();
  }
}

/* ================= MENU ================= */

function drawMenu() {

  textAlign(CENTER, CENTER);

  fill(210, 100, 100);
  textSize(70);
  text("CHROMATIC", width/2, 160);

  let hover =
    mouseX > width/2-120 &&
    mouseX < width/2+120 &&
    mouseY > 300 &&
    mouseY < 370;

  fill(hover ? 210 : 220, 90, 90);

  rectMode(CENTER);
  noStroke();

  rect(width/2, 335, 240, 70, 16);

  fill(0);
  textSize(30);
  text("PLAY", width/2, 335);
}

/* ================= MODE SELECT ================= */

function drawModeSelect() {

  textAlign(CENTER, CENTER);

  fill(210, 100, 100);
  textSize(50);
  text("SELECT MODE", width/2, 120);

  drawButton(width/2, 280, "DEFAULT");
  drawButton(width/2, 390, "ESCAPE");
}

function drawButton(x, y, label) {

  let hover =
    mouseX > x-140 &&
    mouseX < x+140 &&
    mouseY > y-35 &&
    mouseY < y+35;

  fill(hover ? 210 : 220, 80, 85);

  rectMode(CENTER);
  noStroke();

  rect(x, y, 280, 70, 16);

  fill(0);
  textSize(28);
  text(label, x, y);
}

/* ================= INPUT ================= */

function mousePressed() {

  if (gameState === "menu") {

    if (
      mouseX > width/2-120 &&
      mouseX < width/2+120 &&
      mouseY > 300 &&
      mouseY < 370
    ) {
      gameState = "modeSelect";
    }
  }

  else if (gameState === "modeSelect") {

    if (
      mouseX > width/2-140 &&
      mouseX < width/2+140 &&
      mouseY > 245 &&
      mouseY < 315
    ) {
      resetGame();
      gameState = "default";
    }

    if (
      mouseX > width/2-140 &&
      mouseX < width/2+140 &&
      mouseY > 355 &&
      mouseY < 425
    ) {
      resetGame();
      gameState = "escape";
    }
  }
}

/* ================= GAME ================= */

function runGame(escapeMode) {

  vy += gravity;

  ballX += vx;
  ballY += vy;

  let dx = ballX - width/2;
  let dy = ballY - height/2;

  let dist = sqrt(dx*dx + dy*dy);
  let angle = atan2(dy, dx);

  let hit = dist + ballRadius >= arenaRadius;

  if (escapeMode) {

    let inGap = angle > gapStart && angle < gapEnd;

    if (hit && !inGap) bounce(dx, dy, dist);

  } else {

    if (hit) bounce(dx, dy, dist);
  }

  trail.push({x: ballX, y: ballY});

  if (trail.length > 120) trail.shift();

  // trail
  noFill();
  stroke(210, 80, 100, 60);

  for (let i = 0; i < trail.length; i++) {
    circle(trail[i].x, trail[i].y, ballRadius*2);
  }

  // ball
  fill(0);
  stroke(0, 0, 100);
  circle(ballX, ballY, ballRadius*2);
}

/* ================= PHYSICS ================= */

function bounce(dx, dy, dist) {

  let nx = dx / dist;
  let ny = dy / dist;

  ballX = width/2 + nx*(arenaRadius-ballRadius);
  ballY = height/2 + ny*(arenaRadius-ballRadius);

  let dot = vx*nx + vy*ny;

  vx -= 2 * dot * nx;
  vy -= 2 * dot * ny;

  vx *= 1.03;
  vy *= 1.03;

  ballRadius *= 1.02;
}

/* ================= ARENAS ================= */

function drawArena() {

  noFill();
  stroke(0,0,100);
  strokeWeight(3);

  circle(width/2, height/2, arenaRadius*2);
}

function drawEscapeArena() {

  noFill();
  stroke(0,0,100);
  strokeWeight(3);

  arc(
    width/2,
    height/2,
    arenaRadius*2,
    arenaRadius*2,
    gapEnd,
    gapStart + TWO_PI
  );
}

/* ================= ESCAPE ================= */

function checkEscape() {

  let dx = ballX - width/2;
  let dy = ballY - height/2;

  if (sqrt(dx*dx + dy*dy) > arenaRadius + 50) {
    gameState = "menu";
  }
}