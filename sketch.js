function setup() {
  // Bind canvas to the HTML wrapper layout ID
  let canvas = createCanvas(800, 800);
  canvas.parent("game-container"); 
  
  colorMode(HSB, 360, 100, 100, 100);
}

// Keep the rest of your original physics loop code exactly as you wrote it...
