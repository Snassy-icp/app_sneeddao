import { SEGMENT_LENGTH, ROAD_WIDTH, RUMBLE_LENGTH, DRAW_DISTANCE } from './constants.js';
import { percentRemaining } from './utils.js';

export function createSegment(n) {
  return {
    index: n,
    world: { x: 0, y: 0, z: n * SEGMENT_LENGTH },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
    curve: 0,
    sprite: null,
    cars: [],
    color: Math.floor(n / RUMBLE_LENGTH) % 2 ? 'dark' : 'light',
    looped: false,
    fork: null,
    clip: 0,
  };
}

export function buildRoad(definition) {
  const segments = [];
  let n = 0;

  for (const section of definition) {
    switch (section.type) {
      case 'straight':
        addStraight(segments, section.length || 50, n);
        n += section.length || 50;
        break;
      case 'curve':
        addCurve(segments, section.length || 50, section.intensity || 2, section.direction === 'left' ? -1 : 1, n);
        n += section.length || 50;
        break;
      case 'hill':
        addHill(segments, section.length || 50, section.intensity || 30, section.direction === 'down' ? -1 : 1, n);
        n += section.length || 50;
        break;
      case 'scurve': {
        const len = Math.floor((section.length || 100) / 4);
        const inten = section.intensity || 4;
        addCurve(segments, len, inten, 1, n);
        n += len;
        addCurve(segments, len, 0, 0, n);
        n += len;
        addCurve(segments, len, inten, -1, n);
        n += len;
        addCurve(segments, len, 0, 0, n);
        n += len;
        break;
      }
      case 'hillcurve': {
        const hLen = section.length || 60;
        const hDir = section.hillDir === 'down' ? -1 : 1;
        const cDir = section.curveDir === 'left' ? -1 : 1;
        addHillCurve(segments, hLen, section.hillIntensity || 40, hDir, section.curveIntensity || 3, cDir, n);
        n += hLen;
        break;
      }
      case 'fork':
        addFork(segments, section.length || 40, n);
        n += section.length || 40;
        break;
      default:
        addStraight(segments, section.length || 25, n);
        n += section.length || 25;
    }
  }

  return segments;
}

function addStraight(segments, length, startIndex) {
  for (let i = 0; i < length; i++) {
    segments.push(createSegment(startIndex + i));
  }
}

function addCurve(segments, length, intensity, direction, startIndex) {
  for (let i = 0; i < length; i++) {
    const seg = createSegment(startIndex + i);
    const t = i / length;
    const eased = easeInOutSine(t);
    seg.curve = eased * intensity * direction;
    segments.push(seg);
  }
}

function addHill(segments, length, height, direction, startIndex) {
  for (let i = 0; i < length; i++) {
    const seg = createSegment(startIndex + i);
    const t = i / length;
    seg.world.y = Math.sin(t * Math.PI) * height * SEGMENT_LENGTH * direction * 0.05;
    segments.push(seg);
  }
}

function addHillCurve(segments, length, hillHeight, hillDir, curveIntensity, curveDir, startIndex) {
  for (let i = 0; i < length; i++) {
    const seg = createSegment(startIndex + i);
    const t = i / length;
    seg.world.y = Math.sin(t * Math.PI) * hillHeight * SEGMENT_LENGTH * hillDir * 0.05;
    seg.curve = easeInOutSine(t) * curveIntensity * curveDir;
    segments.push(seg);
  }
}

function addFork(segments, length, startIndex) {
  for (let i = 0; i < length; i++) {
    const seg = createSegment(startIndex + i);
    const t = i / length;
    seg.fork = {
      progress: t,
      split: easeInOutSine(t),
    };
    segments.push(seg);
  }
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function findSegment(segments, z) {
  const index = Math.floor(z / SEGMENT_LENGTH) % segments.length;
  return segments[index];
}

export function getSegmentIndex(z, totalSegments) {
  return Math.floor(z / SEGMENT_LENGTH) % totalSegments;
}

export function trackLength(segments) {
  return segments.length * SEGMENT_LENGTH;
}

export function addSpritesToSegments(segments, spriteList) {
  for (const sp of spriteList) {
    const idx = sp.segment % segments.length;
    if (idx >= 0 && idx < segments.length) {
      segments[idx].sprite = { type: sp.type, offset: sp.offset };
    }
  }
}

export function addCarsToRoad(segments, cars) {
  for (const seg of segments) {
    seg.cars = [];
  }
  for (const car of cars) {
    const idx = getSegmentIndex(car.z, segments.length);
    segments[idx].cars.push(car);
  }
}
