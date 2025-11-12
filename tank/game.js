const bullets = [];
const GRAVITY = 0.5;
const BULLET_SPEED = 15;

// --- Perlin/Simplex Noise (noisejs by Joseph Gentle) ---
var noise = (function() {
  var module = {};
  function Grad(x, y, z) { this.x = x; this.y = y; this.z = z; }
  Grad.prototype.dot2 = function(x, y) { return this.x * x + this.y * y; };
  var grad3 = [
    new Grad(1,1,0), new Grad(-1,1,0), new Grad(1,-1,0), new Grad(-1,-1,0),
    new Grad(1,0,1), new Grad(-1,0,1), new Grad(1,0,-1), new Grad(-1,0,-1),
    new Grad(0,1,1), new Grad(0,-1,1), new Grad(0,1,-1), new Grad(0,-1,-1)
  ];
  var p = [
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,
    140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,
    234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,
    237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,
    48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,
    92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,
    76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,
    109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,
    126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,
    183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
    172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,
    104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,
    81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,
    84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,
    67,29,24,72,243,141,128,195,78,66,215,61,156,180
  ];
  var perm = new Array(512), gradP = new Array(512);
  module.seed = function(seed) {
    if (seed > 0 && seed < 1) seed *= 65536;
    seed = Math.floor(seed);
    if (seed < 256) seed |= seed << 8;
    for (var i = 0; i < 256; i++) {
      var v = (i & 1) ? p[i] ^ (seed & 255) : p[i] ^ ((seed >> 8) & 255);
      perm[i] = perm[i + 256] = v;
      gradP[i] = gradP[i + 256] = grad3[v % 12];
    }
  };
  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;
  module.simplex2 = function(x, y) {
    var n0, n1, n2;
    var s = (x + y) * F2;
    var i = Math.floor(x + s);
    var j = Math.floor(y + s);
    var t = (i + j) * G2;
    var X0 = i - t, Y0 = j - t;
    var x0 = x - X0, y0 = y - Y0;
    var i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    var x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    var ii = i & 255, jj = j & 255;
    var gi0 = gradP[ii + perm[jj]];
    var gi1 = gradP[ii + i1 + perm[jj + j1]];
    var gi2 = gradP[ii + 1 + perm[jj + 1]];
    var t0 = 0.5 - x0*x0 - y0*y0;
    n0 = t0 < 0 ? 0 : (t0 *= t0, t0*t0*gi0.dot2(x0, y0));
    var t1 = 0.5 - x1*x1 - y1*y1;
    n1 = t1 < 0 ? 0 : (t1 *= t1, t1*t1*gi1.dot2(x1, y1));
    var t2 = 0.5 - x2*x2 - y2*y2;
    n2 = t2 < 0 ? 0 : (t2 *= t2, t2*t2*gi2.dot2(x2, y2));
    return 70 * (n0 + n1 + n2);
  };
  return module;
})();

// --- PIXI Setup ----------------------------------------------------------
const app = new PIXI.Application({ resizeTo: window, backgroundColor: 0x222222 });
document.body.appendChild(app.view);
const world = new PIXI.Container();
app.stage.addChild(world);

function fitWorldToTerrain() {
  const vw = app.renderer.width;
  const vh = app.renderer.height;

  const scaleX = vw / W;
  const scaleY = vh / app.renderer.height;

  scale = Math.min(scaleX, scaleY, 1);

  world.scale.set(scale);

  world.x = (vw - W * scale) / 2;
  world.y = 0;
}

let lastMouseWorldX = 0;
let lastMouseWorldY = 0;

app.view.addEventListener('mousemove', e => {
  lastMouseWorldX = (e.clientX - world.x) / scale;
  lastMouseWorldY = (e.clientY - world.y) / scale;
});



// --- Pan & Zoom ---------------------------------------------------------
let dragging = false, lastPos = { x: 0, y: 0 }, scale = 1;
const minS = 0.5, maxS = 3;
app.view.addEventListener('mousedown', e => {
  if (e.button === 0) { dragging = true; lastPos = { x: e.clientX, y: e.clientY }; }
});
app.view.addEventListener('mouseup', e => { if (e.button === 0) dragging = false; });
app.view.addEventListener('mousemove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastPos.x, dy = e.clientY - lastPos.y;
  world.x += dx; world.y += dy;
  lastPos = { x: e.clientX, y: e.clientY };
});
app.view.addEventListener('wheel', e => {
  e.preventDefault();
  const f = 1.1, mx = e.clientX, my = e.clientY;
  const bx = (mx - world.x) / scale, by = (my - world.y) / scale;
  scale *= e.deltaY < 0 ? f : 1/f;
  scale = Math.max(minS, Math.min(maxS, scale));
  world.scale.set(scale);
  const ax = (mx - world.x) / scale, ay = (my - world.y) / scale;
  world.x += (ax - bx) * scale;
  world.y += (ay - by) * scale;
});
window.addEventListener('contextmenu', e => e.preventDefault());

// --- Terrain Graphic -----------------------------------------------------
const terrainG = new PIXI.Graphics();
world.addChild(terrainG);
const playAreaG = new PIXI.Graphics();
world.addChildAt(playAreaG, 0); // put behind terrain


// --- Tank variables -------------------------------------------------------
let leftTank, rightTank;
let leftTankX = 200;
const TANK_WIDTH = 40;
const TANK_HEIGHT = 20;

// --- Terrain Generation --------------------------------------------------
let heights = [];
const W = 2000;
const step = 10;

function redrawTerrain() {
  const H = app.renderer.height;
  const base = H * 0.75;

  // draw play area background
  playAreaG.clear();
  playAreaG.beginFill(0x333333);
  playAreaG.drawRect(0, 0, W, base);
  playAreaG.endFill();

  terrainG.clear().beginFill(0x228B22);
  terrainG.moveTo(0, H);
  for (let i = 0; i < heights.length; i++) {
    terrainG.lineTo(i * step, heights[i]);
  }
  terrainG.lineTo(W, H);
  terrainG.lineTo(0, H);
  terrainG.endFill();
}


function generate(type) {
  noise.seed(Math.random());

  const H = app.renderer.height;
  const base = H * 0.75;

  const ampl = {
    plain:           0.3,
    mountain:        1.2,
    single_mountain: 0.3,
    valley:          0.3,
    cliff:           0.3,
  }[type] * (0.8 + Math.random() * 0.4);

  const peakHeight  = 200 + Math.random() * 200;
  const dipDepth    = 200 + Math.random() * 200;
  const cliffOffset = 100 + Math.random() * 200;

  const octs = [
    { f: 0.002, a: 150 },
    { f: 0.007, a: 60  },
    { f: 0.03,  a: 20  }
  ];

  heights = [];

  let singleMountainStart = 0.2 + Math.random() * 0.3;
  let singleMountainWidth = 0.2 + Math.random() * 0.4;
  let singleMountainEnd = singleMountainStart + singleMountainWidth;

  for (let x = 0; x <= W; x += step) {
    const t = x / W;

    let e = 0;
    for (const o of octs) {
      e += noise.simplex2(x * o.f, 0) * o.a;
    }

    let y = base - e * ampl;

    switch (type) {
      case 'single_mountain':
        if (t > singleMountainStart && t < singleMountainEnd) {
          const tt = (t - singleMountainStart) / (singleMountainEnd - singleMountainStart);
          y -= Math.sin(tt * Math.PI) * peakHeight * 1.5;
        }
        break;
      case 'valley':
        if (t > 0.3 && t < 0.7) {
          const tt = (t - 0.3) / 0.4;
          y += Math.sin(tt * Math.PI) * dipDepth;
        }
        break;
      case 'cliff':
        if (t < 0.5) {
          y -= cliffOffset;
        }
        y += noise.simplex2(x * octs[2].f, 0) * 10;
        break;
    }

    heights.push(y);
  }
    
redrawTerrain();
    
  // Remove previous tanks if they exist
  if (leftTank) world.removeChild(leftTank);
  if (rightTank) world.removeChild(rightTank);

  // Create left tank
  leftTank = new PIXI.Graphics()
    .beginFill(0x00ff00)
    .drawRect(-TANK_WIDTH/2, -TANK_HEIGHT, TANK_WIDTH, TANK_HEIGHT)
    .endFill();
leftTank.targetRotation = 0;
leftTank.rotation = 0;
  leftTank.x = leftTankX;
  leftTank.y = getTerrainY(leftTankX);
  world.addChild(leftTank);

  // Create right tank
  const rightTankX = W - 200;
  const rightTankY = getTerrainY(rightTankX);

  rightTank = new PIXI.Graphics()
    .beginFill(0xff0000)
    .drawRect(-TANK_WIDTH/2, -TANK_HEIGHT, TANK_WIDTH, TANK_HEIGHT)
    .endFill();

  rightTank.x = rightTankX;
  rightTank.y = rightTankY;
  world.addChild(rightTank);
}

function getTerrainY(x) {
  const index = Math.floor(x / step);
  return heights[Math.min(index, heights.length - 1)];
}

const keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
});


app.ticker.add(() => {
  const speed = 2;

  if (keys['ArrowLeft']) {
    leftTankX -= speed;
    leftTankX = Math.max(0, leftTankX);
  }
  if (keys['ArrowRight']) {
    leftTankX += speed;
    leftTankX = Math.min(W, leftTankX);
  }
  updateLeftTankPosition();

  if (keys['Space']) {
    // fire a bullet only once per press
    keys['Space'] = false;

    const tankX = leftTank.x;
    const tankY = leftTank.y;

    const dx = lastMouseWorldX - tankX;
    const dy = lastMouseWorldY - tankY;
    const angle = Math.atan2(dy, dx);

    const vx = Math.cos(angle) * BULLET_SPEED;
    const vy = Math.sin(angle) * BULLET_SPEED;

    const bullet = new PIXI.Graphics();
    bullet.beginFill(0xffffff).drawCircle(0, 0, 2).endFill();
    bullet.x = tankX;
    bullet.y = tankY;
    bullet.vx = vx;
    bullet.vy = vy;

    world.addChild(bullet);
    bullets.push(bullet);
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    b.vy += GRAVITY;

    const nextX = b.x + b.vx;
    const nextY = b.y + b.vy;

    const terrainY = getTerrainY(nextX);
    const groundY = Math.min(terrainY, app.renderer.height);

    if (nextY >= groundY) {
      // interpolate horizontal distance to impact
      const t = (groundY - b.y) / (nextY - b.y);
      b.x += b.vx * t;
      b.y = groundY;

      if (groundY < app.renderer.height) {
        makeCrater(b.x, 40, 30);
      }

      world.removeChild(b);
      bullets.splice(i, 1);
      continue;
    }

    b.x = nextX;
    b.y = nextY;

    const outOfBounds = b.x < 0 || b.x > W || b.y > app.renderer.height + 100;
    if (outOfBounds) {
      world.removeChild(b);
      bullets.splice(i, 1);
    }
  }
});

function getTerrainSlopeAngle(x) {
  const delta = step;
  let x1 = Math.max(0, x - delta);
  let x2 = Math.min(W, x + delta);
  let y1 = getTerrainY(x1);
  let y2 = getTerrainY(x2);
  return Math.atan2(y2 - y1, x2 - x1);
}

function updateLeftTankPosition() {
  if (!leftTank) return;

  leftTank.x = leftTankX;
  leftTank.y = getTerrainY(leftTankX);

  const target = getTerrainSlopeAngle(leftTankX);

  // interpolate toward target
  const diff = target - leftTank.rotation;

  // Wrap around [-PI, PI] to avoid long spins
  const wrappedDiff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;

  leftTank.rotation += wrappedDiff * 0.2;
}

function makeCrater(xc, radius, depth) {
  const start = Math.max(0, Math.floor((xc - radius) / step));
  const end = Math.min(heights.length, Math.ceil((xc + radius) / step));

  for (let i = start; i < end; i++) {
    const x = i * step;
    const dx = x - xc;
    if (Math.abs(dx) <= radius) {
      // Parabolic crater profile
      const factor = 1 - (dx * dx) / (radius * radius);
      const craterDepth = depth * factor;
      heights[i] += craterDepth;

      // Keep terrain above bottom of screen
      heights[i] = Math.min(heights[i], app.renderer.height - 1);
    }
  }
  redrawTerrain()
}

// --- UI Hookup -----------------------------------------------------------
const btn = document.getElementById('generateBtn');
btn.addEventListener('click', () => generate(document.getElementById('terrainSelect').value));

// Initial draw
generate('plain');
fitWorldToTerrain();