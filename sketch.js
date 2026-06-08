function setup() {

  let canvas = createCanvas(800, 800);

  canvas.parent("game-container");

  colorMode(HSB, 360, 100, 100, 100);

  noStroke();
}

function draw() {

  background(220, 70, 10);

  // Demo background
  for (let i = 0; i < height; i += 4) {

    let h = map(i, 0, height, 210, 240);

    stroke(h, 80, 30);

    line(0, i, width, i);
  }

  noStroke();

  fill((frameCount * 2) % 360, 90, 100);

  circle(
    width / 2,
    height / 2,
    120 + sin(frameCount * 0.05) * 20
  );

  fill(255);

  textAlign(CENTER, CENTER);

  textSize(28);

  text(
    "Your Game Here",
    width / 2,
    height / 2 + 150
  );
}