export function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeIn(a, b, t) {
  return a + (b - a) * (t * t);
}

export function easeOut(a, b, t) {
  return a + (b - a) * (1 - (1 - t) * (1 - t));
}

export function easeInOut(a, b, t) {
  return a + (b - a) * (-(Math.cos(Math.PI * t) - 1) / 2);
}

export function exponentialFog(distance, density) {
  return 1 / Math.pow(Math.E, distance * distance * density);
}

export function percentRemaining(n, total) {
  return (n % total) / total;
}

export function increase(start, increment, max) {
  let result = start + increment;
  while (result >= max) result -= max;
  while (result < 0) result += max;
  return result;
}

export function toInt(obj, def) {
  if (obj !== null && obj !== undefined) {
    const x = parseInt(obj, 10);
    if (!isNaN(x)) return x;
  }
  return def !== undefined ? def : 0;
}

export function randomInt(min, max) {
  return Math.round(lerp(min, max, Math.random()));
}

export function randomChoice(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

export function timestamp() {
  return new Date().getTime();
}

export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds * 10) % 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

export function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
  const cam = p.camera;
  cam.x = (p.world.x || 0) - cameraX;
  cam.y = (p.world.y || 0) - cameraY;
  cam.z = (p.world.z || 0) - cameraZ;
  if (cam.z <= 0) {
    p.screen.x = 0;
    p.screen.y = 0;
    p.screen.w = 0;
    p.screen.scale = 0;
    return;
  }
  const s = cameraDepth / cam.z;
  p.screen.scale = s;
  p.screen.x = width / 2 + (s * cam.x * width) / 2;
  p.screen.y = height / 2 - (s * cam.y * height) / 2;
  p.screen.w = s * roadWidth * width / 2;
}

export function overlap(x1, w1, x2, w2, percent) {
  const half = percent / 2;
  const min1 = x1 - w1 * half;
  const max1 = x1 + w1 * half;
  const min2 = x2 - w2 * half;
  const max2 = x2 + w2 * half;
  return !(min1 > max2 || max1 < min2);
}
