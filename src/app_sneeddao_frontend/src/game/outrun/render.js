import {
  CANVAS_WIDTH, CANVAS_HEIGHT, CAMERA_DEPTH, CAMERA_HEIGHT,
  DRAW_DISTANCE, SEGMENT_LENGTH, ROAD_WIDTH, RUMBLE_LENGTH,
  MAX_SPEED, THEMES,
} from './constants.js';
import { project, lerp, exponentialFog } from './utils.js';
import { findSegment, trackLength } from './road.js';
import { drawSprite, drawCar, drawPlayerCar, getSpriteWidth } from './sprites.js';

export function render(ctx, state) {
  const { segments, playerX, position, speed, theme: themeName, steer, time, stage } = state;
  const theme = THEMES[themeName] || THEMES.beach;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const totalLength = trackLength(segments);

  const baseSegmentIndex = Math.floor(position / SEGMENT_LENGTH) % segments.length;
  const basePercent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH;
  const playerSegment = findSegment(segments, position);

  const playerY = playerSegment ? (playerSegment.world.y || 0) : 0;

  ctx.clearRect(0, 0, width, height);

  // --- Sky ---
  drawSky(ctx, width, height, theme, state.skyOffset || 0);

  // --- Mountains / background ---
  drawBackground(ctx, width, height, theme, state.bgOffset || 0, state.hillOffset || 0);

  // --- Road segments (back to front) ---
  let maxY = height;
  let x = 0;
  let dx = 0;

  const spriteQueue = [];

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
    seg.screen.x += x;

    seg.clip = maxY;

    if (seg.screen.y >= maxY || seg.screen.scale <= 0 || seg.camera.z <= CAMERA_DEPTH) {
      continue;
    }

    // Get the previous segment for the polygon strip
    const prevIdx = n === 0 ? idx : ((baseSegmentIndex + n - 1) % segments.length);
    const prev = n === 0 ? seg : segments[prevIdx];

    if (n > 0) {
      const fogAlpha = exponentialFog(n / DRAW_DISTANCE, 5);

      drawSegmentStrip(ctx, width, height, theme, seg.color,
        prev.screen.x, prev.screen.y, prev.screen.w,
        seg.screen.x, seg.screen.y, seg.screen.w,
        fogAlpha, seg.fork);
    }

    // Queue sprites for later drawing (need to draw back-to-front after road)
    if (seg.sprite) {
      spriteQueue.push({
        sprite: seg.sprite,
        screen: { ...seg.screen },
        clip: maxY,
        distance: n,
      });
    }

    // Queue cars
    for (const car of seg.cars) {
      const spriteScale = seg.screen.scale;
      const carScreenX = seg.screen.x + (spriteScale * car.offset * ROAD_WIDTH * width / 2);
      spriteQueue.push({
        car,
        screenX: carScreenX,
        screenY: seg.screen.y,
        scale: spriteScale,
        clip: maxY,
        distance: n,
      });
    }

    maxY = seg.screen.y;
  }

  // --- Draw sprites back to front ---
  spriteQueue.sort((a, b) => b.distance - a.distance);
  for (const item of spriteQueue) {
    if (item.car) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, item.clip);
      ctx.clip();
      drawCar(ctx, item.screenX, item.screenY, item.scale, item.car.color);
      ctx.restore();
    } else if (item.sprite) {
      const sp = item.sprite;
      const spriteX = item.screen.x + (item.screen.scale * sp.offset * ROAD_WIDTH * width / 2);
      const spriteY = item.screen.y;
      const spriteScale = item.screen.scale * 300;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, item.clip);
      ctx.clip();
      drawSprite(ctx, sp.type, spriteX, spriteY, item.screen.scale, spriteScale);
      ctx.restore();
    }
  }

  // --- Player car ---
  drawPlayerCar(ctx, width, height, steer, speed, MAX_SPEED);

  // --- HUD ---
  drawHUD(ctx, width, height, speed, time, stage, state.gameState);

  // --- Fork overlay ---
  if (state.gameState === 'fork') {
    drawForkOverlay(ctx, width, height, state.forkTimer);
  }

  // --- Title/Game Over overlays ---
  if (state.gameState === 'title') {
    drawTitleScreen(ctx, width, height);
  } else if (state.gameState === 'countdown') {
    drawCountdown(ctx, width, height, state.countdown);
  } else if (state.gameState === 'gameover') {
    drawGameOver(ctx, width, height);
  }
}

function drawSky(ctx, w, h, theme, offset) {
  const skyH = h * 0.48;
  const grad = ctx.createLinearGradient(0, 0, 0, skyH);
  grad.addColorStop(0, theme.sky[0]);
  grad.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, skyH);

  // Subtle clouds
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
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

  // Distant mountains
  ctx.fillStyle = theme.mountains;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  const mountainOffset = (bgOffset * 0.3) % w;
  for (let x = -50; x <= w + 50; x += 40) {
    const peakH = 20 + Math.sin((x + mountainOffset) * 0.015) * 35
                     + Math.sin((x + mountainOffset) * 0.03) * 15;
    ctx.lineTo(x, horizonY - peakH);
  }
  ctx.lineTo(w + 50, horizonY);
  ctx.closePath();
  ctx.fill();

  // Nearer hills
  ctx.fillStyle = theme.horizon;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  const hillOff = (hillOffset * 0.5) % w;
  for (let x = -50; x <= w + 50; x += 30) {
    const peakH = 8 + Math.sin((x + hillOff) * 0.02) * 18
                    + Math.sin((x + hillOff) * 0.05) * 8;
    ctx.lineTo(x, horizonY - peakH);
  }
  ctx.lineTo(w + 50, horizonY);
  ctx.closePath();
  ctx.fill();
}

function drawSegmentStrip(ctx, w, h, theme, color, x1, y1, w1, x2, y2, w2, fog, fork) {
  const isLight = color === 'light';
  const grass = isLight ? theme.ground.light : theme.ground.dark;
  const road = isLight ? theme.road.light : theme.road.dark;
  const rumble = isLight ? theme.rumble.light : theme.rumble.dark;
  const lane = theme.lane;

  // Grass
  ctx.fillStyle = grass;
  ctx.fillRect(0, y2, w, y1 - y2);

  // Road
  drawPolygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, road);

  // Rumble strips
  const rumbleW1 = w1 * 1.15;
  const rumbleW2 = w2 * 1.15;
  drawPolygon(ctx, x1 - rumbleW1, y1, x1 - w1, y1, x2 - w2, y2, x2 - rumbleW2, y2, rumble);
  drawPolygon(ctx, x1 + w1, y1, x1 + rumbleW1, y1, x2 + rumbleW2, y2, x2 + w2, y2, rumble);

  // Lane markings
  if (isLight) {
    const laneW1 = w1 * 0.01;
    const laneW2 = w2 * 0.01;
    for (let i = 1; i < 3; i++) {
      const lx1 = x1 + (w1 * 2 * i / 3) - w1;
      const lx2 = x2 + (w2 * 2 * i / 3) - w2;
      drawPolygon(ctx, lx1 - laneW1, y1, lx1 + laneW1, y1,
                       lx2 + laneW2, y2, lx2 - laneW2, y2, lane);
    }
  }

  // Fork visual — widen the road at fork segments
  if (fork && fork.progress > 0.1) {
    const split = fork.split * w1 * 0.8;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    // Left arrow hint
    drawPolygon(ctx, x1 - w1 * 0.1, y1, x1 - w1 * 0.05, y1,
                     x2 - split - w2 * 0.05, y2, x2 - split - w2 * 0.1, y2, 'rgba(255,255,100,0.3)');
    // Right arrow hint
    drawPolygon(ctx, x1 + w1 * 0.05, y1, x1 + w1 * 0.1, y1,
                     x2 + split + w2 * 0.1, y2, x2 + split + w2 * 0.05, y2, 'rgba(255,255,100,0.3)');
  }

  // Fog overlay
  if (fog < 1) {
    const fogColor = theme.fog + (1 - fog) * 0.8 + ')';
    ctx.fillStyle = fogColor;
    ctx.fillRect(0, y2, w, y1 - y2);
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
  const displaySpeed = Math.round(speedPercent * 280); // km/h display

  // Speed gauge — bottom right
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

  // Speed bar
  ctx.fillStyle = '#333';
  ctx.fillRect(gaugeX, gaugeY + 10, 110, 6);
  const barColor = speedPercent > 0.8 ? '#E8473C' : speedPercent > 0.5 ? '#FFA500' : '#4DE84D';
  ctx.fillStyle = barColor;
  ctx.fillRect(gaugeX, gaugeY + 10, 110 * speedPercent, 6);

  // Time — top center
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, w / 2 - 55, 8, 110, 36, 6);
  ctx.fill();

  ctx.fillStyle = time < 10 ? '#E8473C' : '#FFF';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(formatTimeHUD(time), w / 2, 34);

  // Stage — top left
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
  const secs = Math.floor(t);
  const tenths = Math.floor((t * 10) % 10);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return `${mins}:${s.toString().padStart(2, '0')}.${tenths}`;
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

function drawForkOverlay(ctx, w, h, timer) {
  const alpha = Math.min(0.7, timer * 0.15);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CHOOSE YOUR PATH', w / 2, h * 0.35);

  ctx.font = '18px monospace';
  ctx.fillStyle = '#FFD700';
  ctx.fillText('← LEFT', w * 0.25, h * 0.5);
  ctx.fillText('RIGHT →', w * 0.75, h * 0.5);
}

function drawTitleScreen(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, w, h);

  // Title
  ctx.fillStyle = '#E8473C';
  ctx.font = 'bold 52px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SNEED RUN', w / 2, h * 0.32);

  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('A SNEED DAO PRODUCTION', w / 2, h * 0.40);

  // Blink prompt
  if (Math.floor(Date.now() / 600) % 2 === 0) {
    ctx.fillStyle = '#FFF';
    ctx.font = '20px monospace';
    ctx.fillText('PRESS ENTER TO START', w / 2, h * 0.62);
  }

  // Controls info
  ctx.fillStyle = '#AAA';
  ctx.font = '13px monospace';
  ctx.fillText('↑ / W  ACCELERATE      ↓ / S  BRAKE', w / 2, h * 0.78);
  ctx.fillText('← / A  STEER LEFT      → / D  STEER RIGHT', w / 2, h * 0.83);
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
  ctx.fillText('TIME\'S UP!', w / 2, h * 0.48);

  if (Math.floor(Date.now() / 600) % 2 === 0) {
    ctx.fillStyle = '#FFD700';
    ctx.font = '20px monospace';
    ctx.fillText('PRESS ENTER TO RETRY', w / 2, h * 0.65);
  }
}
