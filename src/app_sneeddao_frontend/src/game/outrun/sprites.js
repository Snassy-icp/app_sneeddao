// Atlas-based sprite system using PNG sprite sheets.
// Falls back to colored rectangles if images fail to load.

const playerSheet = new Image();
const scenerySheet = new Image();
let sheetsLoaded = false;

export function loadSpriteSheets() {
  return new Promise((resolve) => {
    let loaded = 0;
    const check = () => { if (++loaded >= 2) { sheetsLoaded = true; resolve(); } };
    playerSheet.onload = check;
    scenerySheet.onload = check;
    playerSheet.onerror = check;
    scenerySheet.onerror = check;
    playerSheet.src = '/outrun-player.png';
    scenerySheet.src = '/outrun-scenery.png';
  });
}

export function areSheetsLoaded() { return sheetsLoaded; }

// --- Sprite type enum ---
export const SPRITE_TYPES = {
  PALM_TREE: 'palm_tree',
  PINE_TREE: 'pine_tree',
  BUSH: 'bush',
  ROCK: 'rock',
  SIGN_RIGHT: 'sign_right',
  SIGN_LEFT: 'sign_left',
  COLUMN: 'column',
  CACTUS: 'cactus',
  DEAD_TREE: 'dead_tree',
  BILLBOARD: 'billboard',
  GREEN_TREE: 'green_tree',
  TOWER: 'tower',
  AUTUMN_TREE: 'autumn_tree',
  PALM_TREE2: 'palm_tree2',
  BUSH_FLOWER: 'bush_flower',
  ROCK_LARGE: 'rock_large',
  CLIFF: 'cliff',
  DEAD_TREE_BARE: 'dead_tree_bare',
};

// --- Atlas coordinates ---
// Player car rear views (from 104648.png, row 1)
const PLAYER_FRAMES = [
  { x: 153, y: 0,  w: 80, h: 60 }, // 0: hard left
  { x: 233, y: 3,  w: 78, h: 57 }, // 1: left
  { x: 311, y: 8,  w: 79, h: 52 }, // 2: slight left
  { x: 390, y: 0,  w: 80, h: 60 }, // 3: slight left variant
  { x: 471, y: 3,  w: 80, h: 57 }, // 4: straight center
  { x: 551, y: 8,  w: 80, h: 52 }, // 5: slight right
  { x: 631, y: 0,  w: 82, h: 60 }, // 6: slight right variant
  { x: 713, y: 3,  w: 82, h: 57 }, // 7: right
  { x: 795, y: 8,  w: 82, h: 52 }, // 8: hard right
];

// Crash/tumble frames (row 4 of player sheet)
const CRASH_FRAMES = [
  { x: 0,   y: 198, w: 143, h: 72 }, // side view left
  { x: 144, y: 180, w: 144, h: 90 }, // flipping left
  { x: 289, y: 186, w: 140, h: 84 }, // flipping mid
  { x: 430, y: 232, w: 140, h: 48 }, // underside
  { x: 571, y: 200, w: 140, h: 80 }, // flipping right
  { x: 712, y: 192, w: 140, h: 78 }, // top-down
  { x: 853, y: 180, w: 140, h: 90 }, // side view right
];

// Scenery atlas (from NicePng_bien-png_7723679.png)
const SCENERY_ATLAS = {
  palm_tree:   { sheet: 'scenery', x: 1,    y: 1,    w: 215, h: 535 },
  billboard1:  { sheet: 'scenery', x: 231,  y: 4,    w: 375, h: 262 },
  green_tree:  { sheet: 'scenery', x: 621,  y: 1,    w: 360, h: 360 },
  tower:       { sheet: 'scenery', x: 994,  y: 1,    w: 190, h: 308 },
  autumn_tree: { sheet: 'scenery', x: 1221, y: 54,   w: 230, h: 242 },
  cliff:       { sheet: 'scenery', x: 231,  y: 276,  w: 308, h: 210 },
  billboard2:  { sheet: 'scenery', x: 621,  y: 371,  w: 295, h: 168 },
  sega_sign:   { sheet: 'scenery', x: 1001, y: 326,  w: 160, h: 135 },
  billboard3:  { sheet: 'scenery', x: 1201, y: 306,  w: 268, h: 168 },
  dead_tree:   { sheet: 'scenery', x: 1201, y: 486,  w: 143, h: 250 },
  bush:        { sheet: 'scenery', x: 1365, y: 486,  w: 118, h: 144 },
  small_tree:  { sheet: 'scenery', x: 21,   y: 551,  w: 88,  h: 330 },
  billboard5:  { sheet: 'scenery', x: 148,  y: 553,  w: 322, h: 280 },
  billboard6:  { sheet: 'scenery', x: 484,  y: 551,  w: 283, h: 190 },
  rocks:       { sheet: 'scenery', x: 1201, y: 756,  w: 168, h: 241 },
  billboard7:  { sheet: 'scenery', x: 1,    y: 893,  w: 286, h: 190 },
  billboard8:  { sheet: 'scenery', x: 309,  y: 893,  w: 283, h: 190 },
  rock_large:  { sheet: 'scenery', x: 617,  y: 893,  w: 296, h: 140 },
  cactus:      { sheet: 'scenery', x: 928,  y: 893,  w: 227, h: 113 },
  palm_tree2:  { sheet: 'scenery', x: 6,    y: 1093, w: 235, h: 155 },
  bush_flower: { sheet: 'scenery', x: 251,  y: 1093, w: 232, h: 148 },
  sign_easel:  { sheet: 'scenery', x: 1,    y: 1258, w: 230, h: 220 },
  sign_round:  { sheet: 'scenery', x: 241,  y: 1258, w: 215, h: 220 },
};

// Traffic car sprites (from scenery sheet)
const TRAFFIC_CARS = [
  { x: 994,  y: 476,  w: 77, h: 41, color: '#821f1b' },
  { x: 1082, y: 476,  w: 78, h: 41, color: '#84201a' },
  { x: 991,  y: 527,  w: 77, h: 41, color: '#822019' },
  { x: 1381, y: 756,  w: 86, h: 55, color: '#a56470' },
  { x: 1379, y: 821,  w: 80, h: 59, color: '#3e569e' },
  { x: 1381, y: 890,  w: 78, h: 57, color: '#5b433a' },
  { x: 1379, y: 957,  w: 80, h: 45, color: '#821c17' },
  { x: 1201, y: 1014, w: 80, h: 56, color: '#354269' },
  { x: 1291, y: 1014, w: 80, h: 45, color: '#7f1a15' },
  { x: 1381, y: 1014, w: 80, h: 45, color: '#821c18' },
];

export const TRAFFIC_CAR_COUNT = TRAFFIC_CARS.length;

// Map sprite types to atlas entries (with billboard rotation)
const TYPE_TO_ATLAS = {
  palm_tree:      'palm_tree',
  pine_tree:      'green_tree',    // reuse green tree for pine
  bush:           'bush_flower',
  rock:           'rock_large',
  sign_right:     'sign_easel',
  sign_left:      'sign_round',
  column:         'small_tree',
  cactus:         'cactus',
  dead_tree:      'dead_tree',
  billboard:      null,            // cycles through billboard variants
  green_tree:     'green_tree',
  tower:          'tower',
  autumn_tree:    'autumn_tree',
  palm_tree2:     'palm_tree2',
  bush_flower:    'bush_flower',
  rock_large:     'rock_large',
  cliff:          'cliff',
  dead_tree_bare: 'dead_tree',
};

const BILLBOARD_KEYS = [
  'billboard1', 'billboard2', 'billboard3',
  'billboard5', 'billboard6', 'billboard7', 'billboard8',
];

// Fallback colors for when sheets haven't loaded
const FALLBACK_COLORS = {
  palm_tree:   '#228B22', pine_tree:   '#0D5B0D', bush:        '#2D8B2D',
  rock:        '#808080', sign_right:  '#E8473C', sign_left:   '#E8473C',
  column:      '#5C3317', cactus:      '#2D6B2D', dead_tree:   '#5C3317',
  billboard:   '#1a1a2e', green_tree:  '#228B22', tower:       '#8B8B6B',
  autumn_tree: '#CC8833', palm_tree2:  '#228B22', bush_flower: '#CC66AA',
  rock_large:  '#808080', cliff:       '#8B7355', dead_tree_bare: '#5C3317',
};

// Sprite collision widths (world units, used for overlap checks)
const spriteWidth = {
  palm_tree: 80, pine_tree: 70, bush: 60, rock: 50,
  sign_right: 40, sign_left: 40, column: 20, cactus: 40,
  dead_tree: 60, billboard: 100, green_tree: 90, tower: 60,
  autumn_tree: 70, palm_tree2: 70, bush_flower: 60,
  rock_large: 80, cliff: 90, dead_tree_bare: 50,
};

export function getSpriteWidth(type) {
  return spriteWidth[type] || 40;
}

let billboardCounter = 0;

// Draw a scenery sprite from atlas. x,y = bottom-center on screen, scale = pixel multiplier.
export function drawSprite(ctx, type, x, y, _unused, resolvedScale) {
  const scale = resolvedScale || 1;

  // Determine atlas key
  let atlasKey = TYPE_TO_ATLAS[type];
  if (type === 'billboard' || type === SPRITE_TYPES.BILLBOARD) {
    atlasKey = BILLBOARD_KEYS[(billboardCounter++) % BILLBOARD_KEYS.length];
  }

  const atlas = atlasKey ? SCENERY_ATLAS[atlasKey] : null;

  if (!atlas || !sheetsLoaded || !scenerySheet.complete || !scenerySheet.naturalWidth) {
    // Fallback: colored rectangle
    const color = FALLBACK_COLORS[type] || '#808080';
    const fw = scale * 0.3;
    const fh = scale * 0.5;
    ctx.fillStyle = color;
    ctx.fillRect(x - fw / 2, y - fh, fw, fh);
    return;
  }

  const pixelScale = scale / atlas.h;
  const dw = atlas.w * pixelScale;
  const dh = atlas.h * pixelScale;
  const dx = x - dw / 2;
  const dy = y - dh;

  ctx.drawImage(scenerySheet, atlas.x, atlas.y, atlas.w, atlas.h, dx, dy, dw, dh);
}

// Draw a traffic car sprite
export function drawCar(ctx, x, y, scale, color, colorIndex) {
  const idx = (colorIndex != null) ? (colorIndex % TRAFFIC_CARS.length) : 0;
  const car = TRAFFIC_CARS[idx];

  if (!sheetsLoaded || !scenerySheet.complete || !scenerySheet.naturalWidth) {
    // Fallback: colored rectangle
    const s = scale * 300;
    const w = s * 0.25;
    const h = s * 0.15;
    ctx.fillStyle = color || car.color;
    ctx.fillRect(x - w, y - h * 2, w * 2, h);
    return;
  }

  const s = scale * 300;
  const pixelScale = s * 0.006;
  const dw = car.w * pixelScale;
  const dh = car.h * pixelScale;
  const dx = x - dw / 2;
  const dy = y - dh;

  ctx.drawImage(scenerySheet, car.x, car.y, car.w, car.h, dx, dy, dw, dh);
}

// Get player car steer frame index from steer value (-1..1)
function getPlayerFrame(steer) {
  if (steer < -0.6) return 0;
  if (steer < -0.3) return 1;
  if (steer < -0.1) return 2;
  if (steer > 0.6) return 8;
  if (steer > 0.3) return 7;
  if (steer > 0.1) return 5;
  return 4;
}

// Draw the player's car (seen from behind)
export function drawPlayerCar(ctx, canvasW, canvasH, steer, speed, maxSpeed, crash) {
  const x = canvasW / 2;
  const baseY = canvasH - 10;

  if (crash && crash.timer > 0) {
    drawCrashingCar(ctx, x, baseY, crash);
    return;
  }

  const bounce = speed > 0 ? Math.sin(Date.now() * 0.02) * (speed / maxSpeed) * 2 : 0;
  const tilt = steer * 3;

  if (!sheetsLoaded || !playerSheet.complete || !playerSheet.naturalWidth) {
    // Fallback: simple colored rect
    ctx.fillStyle = '#E8473C';
    ctx.fillRect(x - 52 + tilt * 4, baseY - 32 + bounce, 104, 32);
    return;
  }

  const frame = PLAYER_FRAMES[getPlayerFrame(steer)];
  const PLAYER_SCALE = 2.0;
  const dw = frame.w * PLAYER_SCALE;
  const dh = frame.h * PLAYER_SCALE;
  const dx = x - dw / 2 + tilt * 4;
  const dy = baseY - dh + bounce;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + tilt * 4, baseY + 4, dw * 0.55, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.drawImage(playerSheet, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
}

function drawCrashingCar(ctx, cx, baseY, crash) {
  const liftPixels = crash.airY * 0.6;
  const carY = baseY - liftPixels;

  // Shadow on the ground
  const shadowScale = Math.max(0.3, 1 - crash.airY / 600);
  ctx.fillStyle = `rgba(0,0,0,${0.3 * shadowScale})`;
  ctx.beginPath();
  ctx.ellipse(cx, baseY + 4, 60 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sparks on bounce
  if (crash.airY < 10 && crash.bounces > 0 && crash.bounces <= 3) {
    drawSparks(ctx, cx, baseY, crash.timer);
  }

  // Pick crash frame based on rotation
  const normalizedRot = ((crash.rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const frameIdx = Math.floor((normalizedRot / (Math.PI * 2)) * CRASH_FRAMES.length) % CRASH_FRAMES.length;

  if (!sheetsLoaded || !playerSheet.complete || !playerSheet.naturalWidth) {
    // Fallback
    ctx.save();
    ctx.translate(cx, carY - 30);
    ctx.rotate(crash.rotation);
    ctx.fillStyle = '#E8473C';
    ctx.fillRect(-52, -16, 104, 32);
    ctx.restore();
    return;
  }

  const frame = CRASH_FRAMES[frameIdx];
  const CRASH_SCALE = 1.5;
  const dw = frame.w * CRASH_SCALE;
  const dh = frame.h * CRASH_SCALE;

  ctx.drawImage(playerSheet, frame.x, frame.y, frame.w, frame.h,
    cx - dw / 2, carY - dh, dw, dh);

  // Dust cloud at base
  if (crash.timer < 1.5) {
    const dustAlpha = Math.max(0, 0.4 - crash.timer * 0.3);
    ctx.fillStyle = `rgba(180,160,130,${dustAlpha})`;
    for (let i = 0; i < 5; i++) {
      const dx = Math.sin(crash.timer * 3 + i * 1.3) * (30 + crash.timer * 40);
      const dy = -crash.timer * 15 - i * 5;
      const r = 8 + crash.timer * 12;
      ctx.beginPath();
      ctx.ellipse(cx + dx, baseY + dy, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSparks(ctx, cx, baseY, timer) {
  ctx.fillStyle = '#FFD700';
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + timer * 5;
    const dist = 10 + Math.sin(timer * 10 + i) * 20;
    const sx = cx + Math.cos(angle) * dist;
    const sy = baseY - 5 + Math.sin(angle) * dist * 0.3;
    const size = 1 + Math.random() * 2;
    ctx.fillRect(sx, sy, size, size);
  }
}

export const CAR_COLORS = ['#2266DD', '#DDDD22', '#22DD44', '#DD22DD', '#FF8800', '#22DDDD', '#FFFFFF', '#FF4466'];
