var noise = (function() {
  var module = {};
  function Grad(x, y, z) { this.x = x; this.y = y; this.z = z; }
  Grad.prototype.dot2 = function(x, y) { return this.x*x + this.y*y; };
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
    if(seed > 0 && seed < 1) seed *= 65536;
    seed = Math.floor(seed);
    if(seed < 256) seed |= seed << 8;
    for(var i=0; i<256; i++){
      var v = (i & 1) ? p[i] ^ (seed & 255) : p[i] ^ ((seed>>8) & 255);
      perm[i] = perm[i+256] = v;
      gradP[i] = gradP[i+256] = grad3[v % 12];
    }
  };
  var F2 = 0.5*(Math.sqrt(3)-1), G2 = (3-Math.sqrt(3))/6;
  module.simplex2 = function(x,y){
    var n0,n1,n2;
    var s = (x+y)*F2, i = Math.floor(x+s), j = Math.floor(y+s);
    var t = (i+j)*G2, X0 = i-t, Y0 = j-t;
    var x0 = x-X0, y0 = y-Y0;
    var i1 = x0>y0?1:0, j1 = x0>y0?0:1;
    var x1 = x0-i1+G2, y1 = y0-j1+G2;
    var x2 = x0-1+2*G2, y2 = y0-1+2*G2;
    var ii = i & 255, jj = j & 255;
    var gi0 = gradP[ii+perm[jj]], gi1 = gradP[ii+i1+perm[jj+j1]],
        gi2 = gradP[ii+1  +perm[jj+1]];
    var t0 = 0.5 - x0*x0 - y0*y0;
    n0 = t0<0?0:(t0*=t0,t0*t0*gi0.dot2(x0,y0));
    var t1 = 0.5 - x1*x1 - y1*y1;
    n1 = t1<0?0:(t1*=t1,t1*t1*gi1.dot2(x1,y1));
    var t2 = 0.5 - x2*x2 - y2*y2;
    n2 = t2<0?0:(t2*=t2,t2*t2*gi2.dot2(x2,y2));
    return 70*(n0+n1+n2);
  };
  return module;
})();


// --- Constants ----------------------------------------------------------
const TERR_WIDTH  = 800;
const TERR_HEIGHT = 512; // doubled so mountains don’t get clipped
const TANK_W = 12, TANK_H = 6;
const BULLET_SPEED = 15, GRAVITY = 0.5;
const MAX_SLOPE = 1.5

// --- PIXI Setup ---------------------------------------------------------
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;
const app = new PIXI.Application({
  resizeTo: window,
  backgroundColor: 0x222222,
  antialias: false
});
document.body.appendChild(app.view);

const world = new PIXI.Container();
app.stage.addChild(world);

// Offscreen terrain canvas
const tc = document.createElement('canvas');
tc.width = TERR_WIDTH; tc.height = TERR_HEIGHT;
const tctx = tc.getContext('2d');
const ttex = PIXI.Texture.from(tc);
ttex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
const tspr = new PIXI.Sprite(ttex);
world.addChild(tspr);
const bulletTrail = new PIXI.Graphics();
world.addChild(bulletTrail);

// State
let heights = [], terrain = [], collapseRegs = [];
let leftTank, rightTank, bullets = [];
let terrainType = 'plain';
let keys = {}, mouse = {x:0,y:0};
let allBulletGraphics = [];

// UI hookup
document.getElementById('generateBtn').onclick = ()=>{
  terrainType = document.getElementById('terrainSelect').value;
  generate(terrainType);
  fitWorld();
};

// Generate terrain
function generate(type) {
  noise.seed(Math.random());
  const W = TERR_WIDTH;
  const H = TERR_HEIGHT;
  const base = H * 0.75;

  const amps = {
    plain: 0.3,
    mountain: 1.4,
    single_mountain: 0.4,
    valley: 1.2,
    cliff: 0.25
  };

  const amp = amps[type] * (0.8 + Math.random() * 0.4);
  const peakH = 60 + Math.random() * 80;
  const dipD  = 60 + Math.random() * 80;
  const cliffO = 40 + Math.random() * 60;

  const octs = [
    { f: 0.002, a: 120 },
    { f: 0.007, a: 50 },
    { f: 0.03, a: 15 }
  ];

  heights = [];

  let s0 = 0.2 + Math.random() * 0.3;
  let w0 = 0.2 + Math.random() * 0.4;
  let s1 = s0 + w0;

  for (let x = 0; x <= W; x++) {
    let t = x / W;
    let e = octs.reduce((sum, o) => sum + noise.simplex2(x * o.f, 0) * o.a, 0);

    let y = base - e * amp;

    switch (type) {
      case 'single_mountain':
        if (t > s0 && t < s1) {
          y -= Math.sin((t - s0) / (s1 - s0) * Math.PI) * peakH * 1.5;
        }
        break;
      case 'valley':
        if (t > 0.3 && t < 0.7) {
          y += Math.sin((t - 0.3) / 0.4 * Math.PI) * dipD;
        }
        break;
      case 'cliff':
        if (t < 0.5) y -= cliffO;
        y += noise.simplex2(x * octs[2].f, 0) * 6;
        break;
    }

    y = Math.max(4, Math.min(H - 2, y));

    heights.push(y);
  }

  terrain = Array.from({ length: H }, () => new Uint8Array(W));

  for (let i = 0; i < heights.length; i++) {
    const px = i;
    const hy = Math.floor(heights[i]);
    for (let yy = hy; yy < H - 1; yy++) {
      terrain[yy][px] = 1;
    }
    terrain[H - 1][px] = 1; // hard floor
  }

  collapseRegs = [];
  drawTerrain();
  placeTanks();
}

function drawTerrain(){
  const img = tctx.createImageData(TERR_WIDTH, TERR_HEIGHT);
  for (let y = 0; y < TERR_HEIGHT; y++) {
    for (let x = 0; x < TERR_WIDTH; x++) {
      if (terrain[y][x]) {
        const i = (y * TERR_WIDTH + x) * 4;
        img.data[i] = 34;
        img.data[i+1] = 139;
        img.data[i+2] = 34;
        img.data[i+3] = 255;
      }
    }
  }
  tctx.putImageData(img, 0, 0);
  ttex.update();
}

function blast(cx, cy, r) {
  const r2 = r * r;
  for (let y = Math.max(0, cy - r); y < Math.min(TERR_HEIGHT, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x < Math.min(TERR_WIDTH, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) {
        terrain[y][x] = 0;
      }
    }
  }
  collapseRegs.push({
    x0: Math.max(0, cx - r),
    x1: Math.min(TERR_WIDTH - 1, cx + r),
    y0: Math.max(0, cy - r),
    y1: Math.min(TERR_HEIGHT - 1, cy + r)
  });
  for (let x = 0; x < TERR_WIDTH; x++) {
    terrain[TERR_HEIGHT - 1][x] = 1;
  }
    drawTerrain()
}

function stepCollapse(stepsPerFrame = 3) {
  let stepsDone = 0;
  let changed = false;
  while (stepsDone < stepsPerFrame) {
    let any = false;
    for (let y = TERR_HEIGHT - 2; y >= 0; y--) {
      for (let x = 0; x < TERR_WIDTH; x++) {
        if (terrain[y][x] === 1 && terrain[y+1][x] === 0) {
          terrain[y+1][x] = 1;
          terrain[y][x] = 0;
          any = true;
        }
      }
    }
    if (!any) break;
    stepsDone++;
    changed = true;
  }
  if (changed) {
    drawTerrain();
  }
}

function getY(x) {
  x = Math.max(0, Math.min(TERR_WIDTH - 1, x));
  for (let y = 0; y < TERR_HEIGHT; y++) {
    if (terrain[y][x]) return y;
  }
  return TERR_HEIGHT - 1;
}

function bulletHitsTank(bullet, tank) {
  const tx = tank.x - TANK_W / 2;
  const ty = tank.y;
  return (
    bullet.x >= tx &&
    bullet.x <= tx + TANK_W &&
    bullet.y >= ty &&
    bullet.y <= ty + TANK_H
  );
}

function makeTank(x, color) {
  const g = new PIXI.Container();
g.hp = 50;
const body = new PIXI.Graphics()
  .beginFill(color)
  .drawRect(-TANK_W/2, 0, TANK_W, TANK_H)
  .endFill();
g.addChild(body);
g.hpBar = new PIXI.Graphics();
g.addChild(g.hpBar);
g.updateHpBar = function () {
  g.hpBar.clear();
  const pct = Math.max(0, g.hp / 50);
  g.hpBar.beginFill(0xff0000).drawRect(-TANK_W/2, -10, TANK_W * pct, 3).endFill();
};
g.updateHpBar();
// BARREL
const barrelLength = 12;
const barrelWidth = 2;
const barrel = new PIXI.Graphics()
  .beginFill(0xffffff)
  .drawRect(0, -barrelWidth / 2, barrelLength, barrelWidth)
  .endFill();
barrel.x = 0;
barrel.y = 0; // move barrel down slightly
barrel.rotation = 0; // default angle facing right
g.barrel = barrel;
g.addChild(barrel);
g.angle = -Math.PI / 4;
g.power = 30;
g.barrelAngleDeg = 0;

  g.x = x;
  g.y = getY(x);
  g.pivot.set(0, 0);

  // ADD THIS:
  g.lastShotTrail = [];

  world.addChild(g);
  return g;
}

function placeTanks(){
  if (leftTank) world.removeChild(leftTank);
  if (rightTank) world.removeChild(rightTank);
  leftTank = makeTank(50, 0x00ff00);
  rightTank = makeTank(TERR_WIDTH - 50, 0xff0000);
}

function tryMoveTank(tank, dx) {
  const currentX = Math.floor(tank.x);
  const proposedX = Math.max(0, Math.min(TERR_WIDTH - 1, currentX + dx));

  const oldY = getY(currentX);
  const newY = getY(proposedX);

  const slope = newY - oldY;

  if (Math.abs(slope) <= MAX_SLOPE) {
    // movement allowed
    tank.x = proposedX;
    tank.y = newY - TANK_H + 1;
  } else {
    // movement denied
    // Optionally you could slide tank down instead:
    // tank.x = proposedX;
    // tank.y = newY - TANK_H + 1;
  }
}
function wrapAngleDeg(deg) {
  let wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (wrapped === -180) wrapped = 180;
  return wrapped;
}

function updateTanks(){
  [leftTank, rightTank].forEach(tank => {
    tank.y = getY(Math.floor(tank.x)) - TANK_H;

    const yL = getY(Math.max(0, tank.x - 1));
    const yR = getY(Math.min(TERR_WIDTH - 1, tank.x + 1));
    const tgt = Math.atan2(yR - yL, 2);
    tank.rotation += (tgt - tank.rotation) * 0.5;

    // Apply nudge visually
    tank.position.x = tank.x + (tank.nudgeX || 0);
  });
}

// input + bullets
app.view.addEventListener("mousemove", e => {
  const r = app.view.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (TERR_WIDTH / r.width);
  mouse.y = (e.clientY - r.top) * (TERR_HEIGHT / r.height);
});

window.addEventListener("keydown", e => {
  keys[e.code] = true;

  if (e.code === "Space") {
    e.preventDefault();
    // Clear old bullet graphics
    for (const g of allBulletGraphics) world.removeChild(g);
    allBulletGraphics = [];

    const angle = PIXI.DEG_TO_RAD * leftTank.barrelAngleDeg;
    const speed = leftTank.power * 0.25 // tune as needed

    const bulletX = leftTank.x + Math.cos(angle) * 12;
    const bulletY = leftTank.y + Math.sin(angle) * 12;

    bullets.push({
      x: bulletX,
      y: bulletY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      shooter: leftTank,
      trail: [],
      graphics: null
    });
  };
  if (e.code === "ArrowUp") {
     leftTank.power = Math.min(100, leftTank.power + 1);
  };
  if (e.code === "ArrowDown") {
     leftTank.power = Math.max(0, leftTank.power - 1);
  }
});

window.addEventListener("keydown", e => keys[e.code] = true);
window.addEventListener("keyup", e => keys[e.code] = false);

let dragging = false, last = { x: 0, y: 0 }, scale = 1;
app.view.addEventListener("mousedown", e => {
  dragging = true;
  last.x = e.clientX;
  last.y = e.clientY;
});
app.view.addEventListener("mouseup", () => dragging = false);
app.view.addEventListener("mousemove", e => {
  if (dragging) {
    world.x += e.clientX - last.x;
    world.y += e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;
  }
});
app.view.addEventListener("wheel", e => {
  e.preventDefault();
  let f = e.deltaY < 0 ? 1.1 : 0.9;
  scale = Math.max(0.2, Math.min(4, scale * f));
  world.scale.set(scale);
});

function fitWorld(){
  let sw = app.renderer.width / TERR_WIDTH;
  let sh = app.renderer.height / TERR_HEIGHT;
  scale = Math.min(sw, sh);
  world.scale.set(scale);
  world.x = (app.renderer.width - TERR_WIDTH * scale) / 2;
  world.y = (app.renderer.height - TERR_HEIGHT * scale) / 2;
}
window.addEventListener("resize", fitWorld);

app.ticker.add(() => {
  bulletTrail.clear();

  // --- Movement & Input ---
  if (keys["KeyA"]) tryMoveTank(leftTank, -1);
  if (keys["KeyD"]) tryMoveTank(leftTank, 1);
  if (keys["ArrowLeft"])  leftTank.barrelAngleDeg--;
  if (keys["ArrowRight"]) leftTank.barrelAngleDeg++;
  leftTank.barrel.rotation = PIXI.DEG_TO_RAD * (leftTank.barrelAngleDeg - leftTank.angle);
  updateTanks();

  // --- UI ---
  let angle = wrapAngleDeg(leftTank.barrelAngleDeg + 90);
  document.getElementById("angleVal").textContent = angle;
  document.getElementById("powerVal").textContent = leftTank.power;

  // *** BULLET LOOP ***
  bulletLoop:
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];

    // apply gravity
    b.vy += GRAVITY;

    // break into discrete steps
    let steps = Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)));
    for (let s = 0; s < steps; s++) {
      b.x += b.vx / steps;
      b.y += b.vy / steps;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 1500) b.trail.shift();

      // out of bounds?
      if (b.x < 0 || b.x >= TERR_WIDTH || b.y >= TERR_HEIGHT) {
        bullets.splice(i, 1);
        continue bulletLoop;
      }

      let ix = Math.floor(b.x);
      let iy = Math.floor(b.y);

      // 1) TANK HIT?
      for (let tank of [leftTank, rightTank]) {
        if (bulletHitsTank(b, tank)) {
          blast(tank.x, tank.y, 16);
          tank.hp = Math.max(0, tank.hp - 10);
          tank.updateHpBar();
          if (tank.hp === 0) world.removeChild(tank);

          const ex = new PIXI.Graphics()
            .beginFill(0xffff00, 0.5)
            .drawCircle(tank.x, tank.y, 16)
            .endFill();
          world.addChild(ex);
          gsap.to(ex, { alpha: 0, duration: 0.5, onComplete: () => world.removeChild(ex) });

          bullets.splice(i, 1);
          continue bulletLoop;
        }
      }

      // 2) TERRAIN HIT?
      if (terrain[iy] && terrain[iy][ix]) {
        blast(ix, iy, 16);
        [leftTank, rightTank].forEach(tank => {
          let dx = tank.x - ix, dy = tank.y - iy;
          if (Math.hypot(dx, dy) <= 16) {
            tank.hp = Math.max(0, tank.hp - 10);
            tank.updateHpBar();
            if (tank.hp === 0) world.removeChild(tank);
          }
        });

        const ex2 = new PIXI.Graphics()
          .beginFill(0xffff00, 0.5)
          .drawCircle(ix, iy, 16)
          .endFill();
        world.addChild(ex2);
        gsap.to(ex2, { alpha: 0, duration: 0.5, onComplete: () => world.removeChild(ex2) });

        bullets.splice(i, 1);
        continue bulletLoop;
      }
    }

    // draw surviving bullet’s trail
    bulletTrail.beginFill(0xffff00);
    bulletTrail.drawCircle(b.x, b.y, 2);
    bulletTrail.endFill();

    if (!b.graphics) {
      b.graphics = new PIXI.Graphics();
      world.addChild(b.graphics);
      allBulletGraphics.push(b.graphics);
    }
    b.graphics.clear();
    b.graphics.lineStyle(1, 0xffff00, 0.2);
    if (b.trail.length > 1) {
      b.graphics.moveTo(b.trail[0].x, b.trail[0].y);
      for (let j = 1; j < b.trail.length; j++) {
        b.graphics.lineTo(b.trail[j].x, b.trail[j].y);
      }
    }
  } // end bulletLoop

  // terrain collapse
  stepCollapse();
});

generate('plain');
fitWorld();