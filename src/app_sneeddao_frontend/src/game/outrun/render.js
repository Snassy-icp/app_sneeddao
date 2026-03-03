import {
  CAMERA_DEPTH, CAMERA_HEIGHT,
  DRAW_DISTANCE, SEGMENT_LENGTH, ROAD_WIDTH,
  MAX_SPEED, THEMES, LANE_COUNT,
} from './constants.js';
import { project, exponentialFog } from './utils.js';
import { interpolateY, trackLength } from './road.js';
import { drawSprite, drawCar, drawPlayerCar } from './sprites.js';

let cachedGradient = null;
let cachedGradientKey = '';

function getCachedSkyGradient(ctx, h, theme) {
  const key = theme.sky[0] + theme.sky[1];
  if (cachedGradientKey === key && cachedGradient) return cachedGradient;
  const skyH = h * 0.48;
  const grad = ctx.createLinearGradient(0, 0, 0, skyH);
  grad.addColorStop(0, theme.sky[0]);
  grad.addColorStop(1, theme.sky[1]);
  cachedGradient = grad;
  cachedGradientKey = key;
  return grad;
}

const FOG_BANDS = 16;
let fogBandCache = null;
let fogBandThemeKey = '';

function getFogBands(theme, fogBase) {
  const key = theme.ground.light + fogBase;
  if (fogBandThemeKey === key && fogBandCache) return fogBandCache;
  const bands = [];
  for (let b = 0; b < FOG_BANDS; b++) {
    const fogAmt = b / (FOG_BANDS - 1);
    bands.push({
      grassLight: blendRGB(theme.ground.light, fogBase, fogAmt),
      grassDark: blendRGB(theme.ground.dark, fogBase, fogAmt),
      roadLight: blendRGB(theme.road.light, fogBase, fogAmt),
      roadDark: blendRGB(theme.road.dark, fogBase, fogAmt),
      rumbleLight: blendRGB(theme.rumble.light, fogBase, fogAmt),
      rumbleDark: blendRGB(theme.rumble.dark, fogBase, fogAmt),
      lane: blendRGB(theme.lane, fogBase, fogAmt),
    });
  }
  fogBandCache = bands;
  fogBandThemeKey = key;
  return bands;
}

const hexCache = {};
function parseHex(hex) {
  if (hexCache[hex]) return hexCache[hex];
  let r, g, b;
  if (hex[0] === '#') {
    const n = parseInt(hex.slice(1), 16);
    r = (n >> 16) & 0xFF;
    g = (n >> 8) & 0xFF;
    b = n & 0xFF;
  } else {
    const m = hex.match(/(\d+)/g);
    if (m) { r = +m[0]; g = +m[1]; b = +m[2]; }
    else { r = g = b = 128; }
  }
  hexCache[hex] = { r, g, b };
  return hexCache[hex];
}

function blendRGB(hex, fogHex, amt) {
  if (amt <= 0) return hex;
  if (amt >= 1) return fogHex;
  const c = parseHex(hex);
  const f = parseHex(fogHex);
  const r = (c.r + (f.r - c.r) * amt) | 0;
  const g = (c.g + (f.g - c.g) * amt) | 0;
  const b = (c.b + (f.b - c.b) * amt) | 0;
  return `rgb(${r},${g},${b})`;
}

export function render(ctx, state) {
  const { segments, playerX, position, speed, theme: themeName, steer, time, stage } = state;
  const theme = THEMES[themeName] || THEMES.beach;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const totalLength = trackLength(segments);

  const baseSegmentIndex = Math.floor(position / SEGMENT_LENGTH) % segments.length;
  const playerY = interpolateY(segments, position);
  const fogBase = theme.sky[1];
  const fogBands = getFogBands(theme, fogBase);

  ctx.clearRect(0, 0, width, height);

  drawSky(ctx, width, height, theme, state.skyOffset || 0);
  drawBackground(ctx, width, height, theme, state.bgOffset || 0, state.hillOffset || 0);

  let maxY = height;
  let x = 0;
  let dx = 0;
  let spriteCount = 0;

  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const idx = (baseSegmentIndex + n) % segments.length;
    const seg = segments[idx];
    const looped = (baseSegmentIndex + n) >= segments.length;

    const camX = playerX * ROAD_WIDTH * 2;
    const camY = CAMERA_HEIGHT + playerY;
    const camZ = position - (looped ? totalLength : 0);

    project(seg, camX, camY, camZ, CAMERA_DEPTH, width, height, ROAD_WIDTH);

    x += dx;
    dx += seg.curve;
    dx *= 0.985;
    seg.screen.x += x * seg.screen.w * 0.004;

    seg.clip = maxY;

    if (seg.screen.y >= maxY || seg.screen.scale <= 0 || seg.camera.z <= CAMERA_DEPTH) {
      continue;
    }

    const prevIdx = n === 0 ? idx : ((baseSegmentIndex + n - 1) % segments.length);
    const prev = n === 0 ? seg : segments[prevIdx];

    if (n > 0) {
      const fogAmount = 1 - exponentialFog(n / DRAW_DISTANCE, 5);
      const bandIdx = Math.min(FOG_BANDS - 1, (fogAmount * (FOG_BANDS - 1)) | 0);
      drawSegmentStrip(ctx, width, seg.color, fogBands[bandIdx],
        prev.screen.x, prev.screen.y, prev.screen.w,
        seg.screen.x, seg.screen.y, seg.screen.w,
        fogAmount, seg.fork, prev.fork);
    }

    if (seg.sprite && seg.screen.w > 1) {
      const sp = seg.sprite;
      const spriteX = seg.screen.x + (seg.screen.scale * sp.offset * ROAD_WIDTH * width / 2);
      if (spriteX > -200 && spriteX < width + 200) {
        spritePool[spriteCount++] = makeSpriteItem(
          sp.type, null, spriteX, seg.screen.y, seg.screen.w, maxY);
      }
    }

    for (let ci = 0; ci < seg.cars.length; ci++) {
      if (seg.screen.w > 1) {
        const car = seg.cars[ci];
        const carScreenX = seg.screen.x + (seg.screen.scale * car.offset * ROAD_WIDTH * width / 2);
        if (carScreenX > -100 && carScreenX < width + 100) {
          spritePool[spriteCount++] = makeSpriteItem(
            null, car.color, carScreenX, seg.screen.y, seg.screen.w, maxY);
        }
      }
    }

    maxY = seg.screen.y;
  }

  for (let i = spriteCount - 1; i >= 0; i--) {
    const item = spritePool[i];
    if (item.carColor) {
      const carScale = item.roadW * 0.002;
      if (carScale > 0.02) drawCar(ctx, item.screenX, item.screenY, carScale, item.carColor);
    } else {
      const spriteScale = item.roadW * 0.8;
      if (spriteScale < 4) continue;

      const needsClip = item.screenY > item.clip - spriteScale * 0.6;
      if (needsClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, item.clip);
        ctx.clip();
      }
      drawSprite(ctx, item.type, item.screenX, item.screenY, 0, spriteScale);
      if (needsClip) ctx.restore();
    }
  }

  drawPlayerCar(ctx, width, height, steer, speed, MAX_SPEED);
  drawHUD(ctx, width, height, speed, time, stage, state.gameState);

  if (state.gameState === 'fork') drawForkOverlay(ctx, width, height, state.forkTimer, state.forkChoice);
  if (state.gameState === 'title') drawTitleScreen(ctx, width, height);
  else if (state.gameState === 'countdown') drawCountdown(ctx, width, height, state.countdown);
  else if (state.gameState === 'gameover') drawGameOver(ctx, width, height);
}

// Sprite item pool to reduce allocations
const POOL_SIZE = 300;
const spritePool = [];
for (let i = 0; i < POOL_SIZE; i++) {
  spritePool[i] = { type: null, carColor: null, screenX: 0, screenY: 0, roadW: 0, clip: 0 };
}

function makeSpriteItem(type, carColor, sx, sy, rw, clip) {
  return { type, carColor, screenX: sx, screenY: sy, roadW: rw, clip };
}

function drawSky(ctx, w, h, theme, offset) {
  const skyH = h * 0.48;
  ctx.fillStyle = getCachedSkyGradient(ctx, h, theme);
  ctx.fillRect(0, 0, w, skyH);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  const cloudOffset = (offset * 0.2) % w;
  for (let i = 0; i < 5; i++) {
    const cx = ((i * w / 3.5) + cloudOffset) % (w + 200) - 100;
    const cy = skyH * 0.2 + (i % 3) * skyH * 0.15;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 80 + i * 15, 20 + i * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBackground(ctx, w, h, theme, bgOffset, hillOffset) {
  const horizonY = h * 0.48;

  ctx.fillStyle = theme.mountains;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  const mountainOffset = (bgOffset * 0.3) % w;
  for (let px = -50; px <= w + 50; px += 50) {
    const peakH = 20 + Math.sin((px + mountainOffset) * 0.015) * 35
                     + Math.sin((px + mountainOffset) * 0.03) * 15;
    ctx.lineTo(px, horizonY - peakH);
  }
  ctx.lineTo(w + 50, horizonY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = theme.horizon;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  const hillOff = (hillOffset * 0.5) % w;
  for (let px = -50; px <= w + 50; px += 40) {
    const peakH = 8 + Math.sin((px + hillOff) * 0.02) * 18
                    + Math.sin((px + hillOff) * 0.05) * 8;
    ctx.lineTo(px, horizonY - peakH);
  }
  ctx.lineTo(w + 50, horizonY);
  ctx.closePath();
  ctx.fill();
}

function drawSegmentStrip(ctx, w, color, band, x1, y1, w1, x2, y2, w2, fogAmount, fork, prevFork) {
  const isLight = color === 'light';
  const stripH = y1 - y2;
  if (stripH <= 0) return;

  const grassColor = isLight ? band.grassLight : band.grassDark;

  // Fork road widening
  const fw1 = prevFork ? w1 * (1 + prevFork.widen * 0.5) : w1;
  const fw2 = fork ? w2 * (1 + fork.widen * 0.5) : w2;

  // Grass background
  ctx.fillStyle = grassColor;
  ctx.fillRect(0, y2, w, stripH);

  // Road
  drawPolygon(ctx, x1 - fw1, y1, x1 + fw1, y1, x2 + fw2, y2, x2 - fw2, y2,
    isLight ? band.roadLight : band.roadDark);

  // Outer rumble strips
  const rum1 = fw1 * 1.15;
  const rum2 = fw2 * 1.15;
  const rumbleColor = isLight ? band.rumbleLight : band.rumbleDark;
  drawPolygon(ctx, x1 - rum1, y1, x1 - fw1, y1, x2 - fw2, y2, x2 - rum2, y2, rumbleColor);
  drawPolygon(ctx, x1 + fw1, y1, x1 + rum1, y1, x2 + rum2, y2, x2 + fw2, y2, rumbleColor);

  // Lane markings — variable count
  if (isLight && fogAmount < 0.6) {
    const lanes = fork ? Math.round(LANE_COUNT + fork.widen * 2) : LANE_COUNT;
    const laneW1 = Math.max(1, fw1 * 0.012);
    const laneW2 = Math.max(1, fw2 * 0.012);
    for (let i = 1; i < lanes; i++) {
      const lx1 = x1 + (fw1 * 2 * i / lanes) - fw1;
      const lx2 = x2 + (fw2 * 2 * i / lanes) - fw2;
      drawPolygon(ctx, lx1 - laneW1, y1, lx1 + laneW1, y1,
                       lx2 + laneW2, y2, lx2 - laneW2, y2, band.lane);
    }
  }

  // Fork road split — grass divider growing in center
  const splitCur = fork ? fork.split : 0;
  const splitPrev = prevFork ? prevFork.split : 0;
  if (splitCur > 0.02 || splitPrev > 0.02) {
    const dw1 = fw1 * splitPrev * 0.35;
    const dw2 = fw2 * splitCur * 0.35;

    // Center grass divider
    drawPolygon(ctx, x1 - dw1, y1, x1 + dw1, y1,
                     x2 + dw2, y2, x2 - dw2, y2, grassColor);

    // Inner rumble strips on divider edges
    if (dw2 > 1) {
      const irw1 = Math.max(0.5, dw1 * 0.2);
      const irw2 = Math.max(0.5, dw2 * 0.2);
      drawPolygon(ctx, x1 - dw1 - irw1, y1, x1 - dw1, y1,
                       x2 - dw2, y2, x2 - dw2 - irw2, y2, rumbleColor);
      drawPolygon(ctx, x1 + dw1, y1, x1 + dw1 + irw1, y1,
                       x2 + dw2 + irw2, y2, x2 + dw2, y2, rumbleColor);
    }
  }
}

function drawPolygon(ctx, x1, y1, x2, y1b, x3, y2, x4, y2b, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y1b);
  ctx.lineTo(x3, y2);
  ctx.lineTo(x4, y2b);
  ctx.closePath();
  ctx.fill();
}

function drawHUD(ctx, w, h, speed, time, stage, gameState) {
  if (gameState === 'title') return;
  ctx.save();

  const speedPercent = speed / MAX_SPEED;
  const displaySpeed = (speedPercent * 280) | 0;
  const gaugeX = w - 130;
  const gaugeY = h - 30;

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, gaugeX - 10, gaugeY - 20, 130, 40, 6);
  ctx.fill();

  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${displaySpeed}`, w - 48, gaugeY + 4);
  ctx.font = '12px monospace';
  ctx.fillText('km/h', w - 14, gaugeY + 4);

  ctx.fillStyle = '#333';
  ctx.fillRect(gaugeX, gaugeY + 10, 110, 6);
  ctx.fillStyle = speedPercent > 0.8 ? '#E8473C' : speedPercent > 0.5 ? '#FFA500' : '#4DE84D';
  ctx.fillRect(gaugeX, gaugeY + 10, 110 * speedPercent, 6);

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, w / 2 - 55, 8, 110, 36, 6);
  ctx.fill();

  ctx.fillStyle = time < 10 ? '#E8473C' : '#FFF';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(formatTimeHUD(time), w / 2, 34);

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, 10, 8, 100, 36, 6);
  ctx.fill();

  ctx.fillStyle = '#4DE84D';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`STAGE ${stage}`, 22, 32);

  ctx.restore();
}

function formatTimeHUD(t) {
  if (t <= 0) return "0:00.0";
  const secs = t | 0;
  const tenths = ((t * 10) | 0) % 10;
  const mins = (secs / 60) | 0;
  const s = secs % 60;
  return `${mins}:${s < 10 ? '0' : ''}${s}.${tenths}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawForkOverlay(ctx, w, h, timer, choice) {
  // Semi-transparent so the road split is visible beneath
  const alpha = Math.min(0.3, timer * 0.1);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;

  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CHOOSE YOUR PATH', w / 2, h * 0.28);

  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = choice === 'left' ? '#FFD700' : '#CCC';
  ctx.fillText('\u2190 LEFT', w * 0.25, h * 0.40);
  ctx.fillStyle = choice === 'right' ? '#FFD700' : '#CCC';
  ctx.fillText('RIGHT \u2192', w * 0.75, h * 0.40);

  if (!choice && ((Date.now() / 500) | 0) % 2 === 0) {
    ctx.fillStyle = '#FFD700';
    ctx.font = '16px monospace';
    ctx.fillText('STEER LEFT OR RIGHT', w / 2, h * 0.50);
  }

  ctx.restore();
}

function drawTitleScreen(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#E8473C';
  ctx.font = 'bold 52px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SNEED RUN', w / 2, h * 0.32);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('A SNEED DAO PRODUCTION', w / 2, h * 0.40);
  if (((Date.now() / 600) | 0) % 2 === 0) {
    ctx.fillStyle = '#FFF';
    ctx.font = '20px monospace';
    ctx.fillText('PRESS ENTER TO START', w / 2, h * 0.62);
  }
  ctx.fillStyle = '#AAA';
  ctx.font = '13px monospace';
  ctx.fillText('\u2191 / W  ACCELERATE      \u2193 / S  BRAKE', w / 2, h * 0.78);
  ctx.fillText('\u2190 / A  STEER LEFT      \u2192 / D  STEER RIGHT', w / 2, h * 0.83);
}

function drawCountdown(ctx, w, h, count) {
  if (count <= 0) return;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 80px monospace';
  ctx.textAlign = 'center';
  const display = Math.ceil(count);
  ctx.fillText(display > 0 ? display.toString() : 'GO!', w / 2, h / 2 + 20);
}

function drawGameOver(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#E8473C';
  ctx.font = 'bold 48px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', w / 2, h * 0.38);
  ctx.fillStyle = '#FFF';
  ctx.font = '18px monospace';
  ctx.fillText("TIME'S UP!", w / 2, h * 0.48);
  if (((Date.now() / 600) | 0) % 2 === 0) {
    ctx.fillStyle = '#FFD700';
    ctx.font = '20px monospace';
    ctx.fillText('PRESS ENTER TO RETRY', w / 2, h * 0.65);
  }
}
