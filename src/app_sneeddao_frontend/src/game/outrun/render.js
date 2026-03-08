import {
  CAMERA_DEPTH, CAMERA_HEIGHT,
  DRAW_DISTANCE, SEGMENT_LENGTH, ROAD_WIDTH,
  MAX_SPEED, THEMES, LANE_COUNT, CURVE_SCALE,
} from './constants.js';
import { exponentialFog } from './utils.js';
import { interpolateY, trackLength } from './road.js';
import { drawSprite, drawCar, drawPlayerCar } from './sprites.js';

let cachedGradient = null;
let cachedGradientKey = '';

export function resetRenderCache() {
  cachedGradient = null;
  cachedGradientKey = '';
  fogBandCache = null;
  fogBandThemeKey = '';
}

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
  const key = theme.ground.light + theme.ground.dark + fogBase;
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
    let h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
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

function blendThemes(from, to, t) {
  return {
    sky: [blendRGB(from.sky[0], to.sky[0], t), blendRGB(from.sky[1], to.sky[1], t)],
    horizon: blendRGB(from.horizon, to.horizon, t),
    mountains: blendRGB(from.mountains, to.mountains, t),
    ground: {
      light: blendRGB(from.ground.light, to.ground.light, t),
      dark: blendRGB(from.ground.dark, to.ground.dark, t),
    },
    road: {
      light: blendRGB(from.road.light, to.road.light, t),
      dark: blendRGB(from.road.dark, to.road.dark, t),
    },
    rumble: {
      light: blendRGB(from.rumble.light, to.rumble.light, t),
      dark: blendRGB(from.rumble.dark, to.rumble.dark, t),
    },
    lane: blendRGB(from.lane, to.lane, t),
  };
}

export function render(ctx, state) {
  const { segments, playerX, position, speed, steer, time, stage } = state;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const totalLength = trackLength(segments);

  // Theme blending during transition
  let theme;
  if (state.themeFrom && state.themeTo && state.themeBlendSegs > 0) {
    const fromTheme = THEMES[state.themeFrom] || THEMES.beach;
    const toTheme = THEMES[state.themeTo] || THEMES.beach;
    const baseIdx = Math.floor(position / SEGMENT_LENGTH);
    const t = Math.min(1, baseIdx / state.themeBlendSegs);
    theme = blendThemes(fromTheme, toTheme, t);
    cachedGradientKey = '';
    fogBandThemeKey = '';
  } else {
    theme = THEMES[state.theme] || THEMES.beach;
  }

  const baseSegmentIndex = Math.floor(position / SEGMENT_LENGTH) % segments.length;
  const playerY = interpolateY(segments, position);
  const fogBase = theme.sky[1];
  const fogBands = getFogBands(theme, fogBase);

  ctx.clearRect(0, 0, W, H);

  drawSky(ctx, W, H, theme, state.skyOffset || 0);
  drawBackground(ctx, W, H, theme, state.bgOffset || 0, state.hillOffset || 0);

  // Fill bottom half with grass to prevent any gap at screen bottom
  ctx.fillStyle = theme.ground.light || '#10AA10';
  ctx.fillRect(0, H * 0.48, W, H * 0.52);

  // --- Correct pseudo-3D road projection ---
  const cameraX = playerX * ROAD_WIDTH;
  const cameraY = CAMERA_HEIGHT + playerY;
  const cameraZ = position;

  let maxY = H;
  let curveOffset = 0;
  let spriteCount = 0;

  // Previous segment screen coords for strip drawing
  let prevScreenX = 0, prevScreenY = H, prevScreenW = 0;
  let prevRoadScale = 1;
  let prevFork = null;

  // Don't wrap past track end if it ends with a fork (except during title demo)
  const trackEndsFork = segments.length > 0 && segments[segments.length - 1].fork != null;
  const preventWrap = trackEndsFork && state.gameState !== 'title';

  for (let n = 0; n < DRAW_DISTANCE; n++) {
    // Stop drawing if we'd wrap past a fork ending
    if (preventWrap && (baseSegmentIndex + n) >= segments.length) break;

    const idx = (baseSegmentIndex + n) % segments.length;
    const seg = segments[idx];
    const looped = (baseSegmentIndex + n) >= segments.length;

    // World Z with loop handling
    const worldZ = seg.world.z + (looped ? totalLength : 0);
    const relZ = worldZ - cameraZ;

    if (relZ <= 0) continue;

    // Perspective scale
    const scale = CAMERA_DEPTH / relZ;

    // Accumulate curve offset
    curveOffset += seg.curve;

    // Project to screen
    const screenX = W / 2 + scale * (-cameraX + curveOffset * CURVE_SCALE) * W / 2;
    const screenY = H / 2 - scale * (seg.world.y - cameraY) * H / 2;
    const screenW = scale * ROAD_WIDTH * W / 2;

    // Store projected coords on segment for sprite positioning
    seg.screen.x = screenX;
    seg.screen.y = screenY;
    seg.screen.w = screenW;
    seg.screen.scale = scale;
    seg.clip = maxY;

    // Hill clipping: skip drawing but still update prev coords
    // so the next visible strip connects properly
    if (screenY >= maxY || scale <= 0) {
      prevScreenX = screenX;
      prevScreenY = screenY;
      prevScreenW = screenW;
      prevRoadScale = seg.roadScale || 1;
      prevFork = seg.fork;
      continue;
    }

    // Draw road strip between previous and current segment
    if (n > 0) {
      const fogAmount = 1 - exponentialFog(n / DRAW_DISTANCE, 5);
      const bandIdx = Math.min(FOG_BANDS - 1, (fogAmount * (FOG_BANDS - 1)) | 0);

      let effW1 = prevScreenW * prevRoadScale;
      let effW2 = screenW * (seg.roadScale || 1);
      if (prevFork) effW1 *= (1 + prevFork.widen * 0.5);
      if (seg.fork) effW2 *= (1 + seg.fork.widen * 0.5);

      drawSegmentStrip(ctx, W, seg.color, fogBands[bandIdx],
        prevScreenX, prevScreenY, effW1,
        screenX, screenY, effW2,
        fogAmount, seg.fork, prevFork, seg.lanes || LANE_COUNT);
    }

    // Collect sprites for back-to-front pass
    if (seg.sprite && screenW > 1) {
      const sp = seg.sprite;
      const spriteX = screenX + (scale * sp.offset * ROAD_WIDTH * W / 2);
      if (spriteX > -200 && spriteX < W + 200) {
        spritePool[spriteCount++] = makeSpriteItem(
          sp.type, null, null, spriteX, screenY, screenW * (seg.roadScale || 1), maxY);
      }
    }

    for (let ci = 0; ci < seg.cars.length; ci++) {
      if (screenW > 1) {
        const car = seg.cars[ci];
        const carScreenX = screenX + (scale * car.offset * ROAD_WIDTH * W / 2);
        if (carScreenX > -100 && carScreenX < W + 100) {
          spritePool[spriteCount++] = makeSpriteItem(
            null, car.color, car.colorIndex, carScreenX, screenY, screenW, maxY);
        }
      }
    }

    // Update for next iteration
    prevScreenX = screenX;
    prevScreenY = screenY;
    prevScreenW = screenW;
    prevRoadScale = seg.roadScale || 1;
    prevFork = seg.fork;
    maxY = screenY;
  }

  // Draw sprites back-to-front (far to near)
  for (let i = spriteCount - 1; i >= 0; i--) {
    const item = spritePool[i];
    if (item.carColor !== null) {
      const carScale = item.roadW * 0.002;
      if (carScale > 0.02) drawCar(ctx, item.screenX, item.screenY, carScale, item.carColor, item.colorIndex);
    } else {
      const spriteScale = item.roadW * 0.8;
      if (spriteScale < 4) continue;

      const needsClip = item.screenY > item.clip - spriteScale * 0.6;
      if (needsClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, item.clip);
        ctx.clip();
      }
      drawSprite(ctx, item.type, item.screenX, item.screenY, 0, spriteScale);
      if (needsClip) ctx.restore();
    }
  }

  const crashData = state.gameState === 'crash' ? state.crash : null;
  drawPlayerCar(ctx, W, H, steer, speed, MAX_SPEED, crashData);
  drawHUD(ctx, W, H, speed, time, stage, state.gameState);

  if (state.gameState === 'title') drawTitleScreen(ctx, W, H);
  else if (state.gameState === 'countdown') drawCountdown(ctx, W, H, state.countdown);
  else if (state.gameState === 'gameover') drawGameOver(ctx, W, H);
}

const POOL_SIZE = 300;
const spritePool = [];
for (let i = 0; i < POOL_SIZE; i++) {
  spritePool[i] = { type: null, carColor: null, colorIndex: null, screenX: 0, screenY: 0, roadW: 0, clip: 0 };
}

function makeSpriteItem(type, carColor, colorIndex, sx, sy, rw, clip) {
  return { type, carColor, colorIndex, screenX: sx, screenY: sy, roadW: rw, clip };
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

function drawSegmentStrip(ctx, w, color, band, x1, y1, w1, x2, y2, w2, fogAmount, fork, prevFork, lanes) {
  const isLight = color === 'light';
  const stripH = y1 - y2;
  if (stripH <= 0) return;

  const grassColor = isLight ? band.grassLight : band.grassDark;

  ctx.fillStyle = grassColor;
  ctx.fillRect(0, y2, w, stripH);

  drawPolygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2,
    isLight ? band.roadLight : band.roadDark);

  const rum1 = w1 * 1.15;
  const rum2 = w2 * 1.15;
  const rumbleColor = isLight ? band.rumbleLight : band.rumbleDark;
  drawPolygon(ctx, x1 - rum1, y1, x1 - w1, y1, x2 - w2, y2, x2 - rum2, y2, rumbleColor);
  drawPolygon(ctx, x1 + w1, y1, x1 + rum1, y1, x2 + rum2, y2, x2 + w2, y2, rumbleColor);

  // Lane markings
  if (isLight && fogAmount < 0.6) {
    const laneW1 = Math.max(1, w1 * 0.012);
    const laneW2 = Math.max(1, w2 * 0.012);
    for (let i = 1; i < lanes; i++) {
      const lx1 = x1 + (w1 * 2 * i / lanes) - w1;
      const lx2 = x2 + (w2 * 2 * i / lanes) - w2;
      drawPolygon(ctx, lx1 - laneW1, y1, lx1 + laneW1, y1,
                       lx2 + laneW2, y2, lx2 - laneW2, y2, band.lane);
    }
  }

  // Fork road split
  const splitCur = fork ? fork.split : 0;
  const splitPrev = prevFork ? prevFork.split : 0;
  if (splitCur > 0.02 || splitPrev > 0.02) {
    const dw1 = w1 * splitPrev * 0.6;
    const dw2 = w2 * splitCur * 0.6;

    drawPolygon(ctx, x1 - dw1, y1, x1 + dw1, y1,
                     x2 + dw2, y2, x2 - dw2, y2, grassColor);

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
