// All sprites are drawn procedurally on canvas — no image assets needed.
// Each sprite type has a draw(ctx, x, y, scale) function.
// x,y is the bottom-center of the sprite on screen. scale controls size.

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
};

const spriteWidth = {
  palm_tree: 80,
  pine_tree: 70,
  bush: 60,
  rock: 50,
  sign_right: 40,
  sign_left: 40,
  column: 20,
  cactus: 40,
  dead_tree: 60,
  billboard: 100,
};

export function getSpriteWidth(type) {
  return spriteWidth[type] || 40;
}

export function drawSprite(ctx, type, x, y, scale, resolvedScale) {
  const s = resolvedScale || scale * 300;
  ctx.save();
  ctx.translate(x, y);

  switch (type) {
    case 'palm_tree':
      drawPalmTree(ctx, s);
      break;
    case 'pine_tree':
      drawPineTree(ctx, s);
      break;
    case 'bush':
      drawBush(ctx, s);
      break;
    case 'rock':
      drawRock(ctx, s);
      break;
    case 'sign_right':
    case 'sign_left':
      drawSign(ctx, s);
      break;
    case 'column':
      drawColumn(ctx, s);
      break;
    case 'cactus':
      drawCactus(ctx, s);
      break;
    case 'dead_tree':
      drawDeadTree(ctx, s);
      break;
    case 'billboard':
      drawBillboard(ctx, s);
      break;
    default:
      drawBush(ctx, s);
  }

  ctx.restore();
}

function drawPalmTree(ctx, s) {
  const trunkW = s * 0.06;
  const trunkH = s * 0.7;
  // Trunk — slight curve
  ctx.fillStyle = '#8B6914';
  ctx.beginPath();
  ctx.moveTo(-trunkW, 0);
  ctx.quadraticCurveTo(-trunkW * 1.5, -trunkH * 0.5, -trunkW * 0.3, -trunkH);
  ctx.lineTo(trunkW * 0.3, -trunkH);
  ctx.quadraticCurveTo(trunkW * 1.5, -trunkH * 0.5, trunkW, 0);
  ctx.fill();

  // Leaves
  ctx.fillStyle = '#228B22';
  const leafY = -trunkH;
  for (let angle = -2.5; angle <= 2.5; angle += 0.5) {
    ctx.beginPath();
    const lx = Math.sin(angle) * s * 0.4;
    const ly = leafY + Math.cos(angle) * s * 0.1 - s * 0.05;
    ctx.ellipse(lx, ly, s * 0.22, s * 0.06, angle * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Coconuts
  ctx.fillStyle = '#654321';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(i * s * 0.04, leafY + s * 0.02, s * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPineTree(ctx, s) {
  const trunkW = s * 0.04;
  const trunkH = s * 0.25;

  ctx.fillStyle = '#5C3317';
  ctx.fillRect(-trunkW, -trunkH, trunkW * 2, trunkH);

  ctx.fillStyle = '#0D5B0D';
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const layerY = -trunkH - i * s * 0.15;
    const layerW = s * (0.2 - i * 0.03);
    const layerH = s * 0.2;
    ctx.beginPath();
    ctx.moveTo(-layerW, layerY);
    ctx.lineTo(0, layerY - layerH);
    ctx.lineTo(layerW, layerY);
    ctx.fill();
  }
}

function drawBush(ctx, s) {
  ctx.fillStyle = '#2D8B2D';
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.12, s * 0.2, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1E6B1E';
  ctx.beginPath();
  ctx.ellipse(-s * 0.08, -s * 0.08, s * 0.12, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(s * 0.1, -s * 0.1, s * 0.13, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(ctx, s) {
  ctx.fillStyle = '#808080';
  ctx.beginPath();
  ctx.moveTo(-s * 0.15, 0);
  ctx.lineTo(-s * 0.18, -s * 0.08);
  ctx.lineTo(-s * 0.1, -s * 0.18);
  ctx.lineTo(s * 0.05, -s * 0.2);
  ctx.lineTo(s * 0.16, -s * 0.12);
  ctx.lineTo(s * 0.15, 0);
  ctx.fill();

  ctx.fillStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(-s * 0.05, -s * 0.05);
  ctx.lineTo(-s * 0.02, -s * 0.16);
  ctx.lineTo(s * 0.06, -s * 0.14);
  ctx.lineTo(s * 0.04, -s * 0.04);
  ctx.fill();
}

function drawSign(ctx, s) {
  const postW = s * 0.02;
  const postH = s * 0.35;
  ctx.fillStyle = '#AAA';
  ctx.fillRect(-postW, -postH, postW * 2, postH);

  ctx.fillStyle = '#E8473C';
  ctx.fillRect(-s * 0.12, -postH - s * 0.12, s * 0.24, s * 0.16);

  ctx.fillStyle = '#FFF';
  ctx.font = `bold ${Math.max(8, s * 0.08)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('SNEED', 0, -postH - s * 0.02);
}

function drawColumn(ctx, s) {
  ctx.fillStyle = '#DDD';
  ctx.fillRect(-s * 0.025, -s * 0.55, s * 0.05, s * 0.55);
  ctx.fillStyle = '#E8473C';
  ctx.fillRect(-s * 0.035, -s * 0.55, s * 0.07, s * 0.04);
  ctx.fillRect(-s * 0.035, -s * 0.1, s * 0.07, s * 0.04);
}

function drawCactus(ctx, s) {
  ctx.fillStyle = '#2D6B2D';
  ctx.fillRect(-s * 0.03, -s * 0.35, s * 0.06, s * 0.35);

  ctx.beginPath();
  ctx.moveTo(s * 0.03, -s * 0.2);
  ctx.quadraticCurveTo(s * 0.15, -s * 0.2, s * 0.12, -s * 0.35);
  ctx.lineTo(s * 0.08, -s * 0.35);
  ctx.quadraticCurveTo(s * 0.11, -s * 0.22, s * 0.03, -s * 0.17);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-s * 0.03, -s * 0.15);
  ctx.quadraticCurveTo(-s * 0.13, -s * 0.15, -s * 0.1, -s * 0.28);
  ctx.lineTo(-s * 0.07, -s * 0.28);
  ctx.quadraticCurveTo(-s * 0.09, -s * 0.17, -s * 0.03, -s * 0.12);
  ctx.fill();
}

function drawDeadTree(ctx, s) {
  ctx.strokeStyle = '#5C3317';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -s * 0.5);
  ctx.stroke();

  ctx.lineWidth = Math.max(1, s * 0.02);
  const branches = [
    [0, -s * 0.35, -s * 0.15, -s * 0.5],
    [0, -s * 0.35, s * 0.12, -s * 0.52],
    [0, -s * 0.45, -s * 0.1, -s * 0.55],
    [0, -s * 0.45, s * 0.08, -s * 0.58],
  ];
  for (const [x1, y1, x2, y2] of branches) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

function drawBillboard(ctx, s) {
  const postW = s * 0.02;
  const postH = s * 0.3;
  ctx.fillStyle = '#777';
  ctx.fillRect(-s * 0.15, -postH, postW, postH);
  ctx.fillRect(s * 0.15 - postW, -postH, postW, postH);

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(-s * 0.22, -postH - s * 0.2, s * 0.44, s * 0.22);

  ctx.fillStyle = '#4DE84D';
  ctx.font = `bold ${Math.max(8, s * 0.09)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('SNEED DAO', 0, -postH - s * 0.06);
}

// Draw an AI car — colored rectangle with windshield
export function drawCar(ctx, x, y, scale, color) {
  const s = scale * 300;
  const w = s * 0.25;
  const h = s * 0.15;

  ctx.save();
  ctx.translate(x, y);

  // Body
  ctx.fillStyle = color;
  ctx.fillRect(-w, -h * 2, w * 2, h);

  // Roof
  ctx.fillStyle = shadeColor(color, -30);
  ctx.fillRect(-w * 0.7, -h * 2.6, w * 1.4, h * 0.7);

  // Windshield
  ctx.fillStyle = '#8ED6FF';
  ctx.fillRect(-w * 0.55, -h * 2.5, w * 1.1, h * 0.45);

  // Wheels
  ctx.fillStyle = '#222';
  ctx.fillRect(-w * 1.05, -h * 1.3, w * 0.2, h * 0.4);
  ctx.fillRect(w * 0.85, -h * 1.3, w * 0.2, h * 0.4);

  ctx.restore();
}

// Draw the player's car (seen from behind)
export function drawPlayerCar(ctx, canvasW, canvasH, steer, speed, maxSpeed) {
  const x = canvasW / 2;
  const y = canvasH - 10;
  const w = 52;
  const h = 32;
  const tilt = steer * 3;
  const bounce = speed > 0 ? Math.sin(Date.now() * 0.02) * (speed / maxSpeed) * 2 : 0;

  ctx.save();
  ctx.translate(x + tilt * 4, y + bounce);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 4, w * 1.1, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = '#E8473C';
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(-w + 4, -h);
  ctx.lineTo(w - 4, -h);
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fill();

  // Roof
  ctx.fillStyle = '#C63030';
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, -h);
  ctx.lineTo(-w * 0.4, -h * 1.55);
  ctx.lineTo(w * 0.4, -h * 1.55);
  ctx.lineTo(w * 0.55, -h);
  ctx.closePath();
  ctx.fill();

  // Rear window
  ctx.fillStyle = '#1a1a3e';
  ctx.beginPath();
  ctx.moveTo(-w * 0.42, -h * 1.02);
  ctx.lineTo(-w * 0.33, -h * 1.45);
  ctx.lineTo(w * 0.33, -h * 1.45);
  ctx.lineTo(w * 0.42, -h * 1.02);
  ctx.closePath();
  ctx.fill();

  // Tail lights
  ctx.fillStyle = '#FF2020';
  ctx.fillRect(-w + 2, -h * 0.6, 8, 6);
  ctx.fillRect(w - 10, -h * 0.6, 8, 6);

  // Brake lights (bright when braking)
  if (speed < maxSpeed * 0.5 && speed > 0) {
    ctx.fillStyle = '#FF6060';
    ctx.fillRect(-w + 2, -h * 0.6, 8, 6);
    ctx.fillRect(w - 10, -h * 0.6, 8, 6);
  }

  // Exhaust
  if (speed > maxSpeed * 0.3) {
    ctx.fillStyle = 'rgba(200,200,200,0.3)';
    ctx.beginPath();
    ctx.ellipse(-w * 0.3, 4, 4 + Math.random() * 3, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(-w - 4, -6, 8, 10);
  ctx.fillRect(w - 4, -6, 8, 10);

  // Tilt indicator — steering wheel implied by body lean
  if (Math.abs(steer) > 0.1) {
    const lean = steer > 0 ? 1 : -1;
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(lean > 0 ? w * 0.3 : -w, -h, w * 0.7, h);
  }

  ctx.restore();
}

function shadeColor(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + percent));
  return `rgb(${r},${g},${b})`;
}

export const CAR_COLORS = ['#2266DD', '#DDDD22', '#22DD44', '#DD22DD', '#FF8800', '#22DDDD', '#FFF', '#FF4466'];
