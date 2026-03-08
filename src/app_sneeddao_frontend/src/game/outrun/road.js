import { SEGMENT_LENGTH, ROAD_WIDTH, RUMBLE_LENGTH, DRAW_DISTANCE, LANE_COUNT } from './constants.js';
import { percentRemaining } from './utils.js';

export function createSegment(n, lanes) {
  const l = lanes || LANE_COUNT;
  return {
    index: n,
    world: { x: 0, y: 0, z: n * SEGMENT_LENGTH },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
    curve: 0,
    lanes: l,
    roadScale: l / LANE_COUNT,
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
  let prevLanes = null;

  for (const section of definition) {
    const secLanes = section.lanes || LANE_COUNT;
    const startN = n;

    switch (section.type) {
      case 'straight':
        addStraight(segments, section.length || 50, n, secLanes);
        n += section.length || 50;
        break;
      case 'curve':
        addCurve(segments, section.length || 50, section.intensity || 2, section.direction === 'left' ? -1 : 1, n, secLanes);
        n += section.length || 50;
        break;
      case 'hill':
        addHill(segments, section.length || 50, section.intensity || 30, section.direction === 'down' ? -1 : 1, n, secLanes);
        n += section.length || 50;
        break;
      case 'scurve': {
        const len = Math.floor((section.length || 100) / 4);
        const inten = section.intensity || 4;
        addCurve(segments, len, inten, 1, n, secLanes);
        n += len;
        addCurve(segments, len, 0, 0, n, secLanes);
        n += len;
        addCurve(segments, len, inten, -1, n, secLanes);
        n += len;
        addCurve(segments, len, 0, 0, n, secLanes);
        n += len;
        break;
      }
      case 'hillcurve': {
        const hLen = section.length || 60;
        const hDir = section.hillDir === 'down' ? -1 : 1;
        const cDir = section.curveDir === 'left' ? -1 : 1;
        addHillCurve(segments, hLen, section.hillIntensity || 40, hDir, section.curveIntensity || 3, cDir, n, secLanes);
        n += hLen;
        break;
      }
      case 'fork':
        addFork(segments, section.length || 40, n);
        n += section.length || 40;
        break;
      default:
        addStraight(segments, section.length || 25, n, secLanes);
        n += section.length || 25;
    }

    // Smooth lane transition at section boundaries
    if (prevLanes !== null && prevLanes !== secLanes && section.type !== 'fork') {
      const transLen = Math.min(10, n - startN);
      for (let i = 0; i < transLen; i++) {
        const segIdx = startN + i;
        if (segIdx < segments.length) {
          const t = easeInOutSine(i / transLen);
          const blendedLanes = prevLanes + (secLanes - prevLanes) * t;
          segments[segIdx].roadScale = blendedLanes / LANE_COUNT;
          segments[segIdx].lanes = Math.round(blendedLanes);
        }
      }
    }
    prevLanes = secLanes;
  }

  return segments;
}

function addStraight(segments, length, startIndex, lanes) {
  for (let i = 0; i < length; i++) {
    segments.push(createSegment(startIndex + i, lanes));
  }
}

function addCurve(segments, length, intensity, direction, startIndex, lanes) {
  for (let i = 0; i < length; i++) {
    const seg = createSegment(startIndex + i, lanes);
    const t = i / length;
    seg.curve = Math.sin(t * Math.PI) * intensity * direction;
    segments.push(seg);
  }
}

function addHill(segments, length, height, direction, startIndex, lanes) {
  for (let i = 0; i < length; i++) {
    const seg = createSegment(startIndex + i, lanes);
    const t = i / length;
    seg.world.y = Math.sin(t * Math.PI) * height * direction * 60;
    segments.push(seg);
  }
}

function addHillCurve(segments, length, hillHeight, hillDir, curveIntensity, curveDir, startIndex, lanes) {
  for (let i = 0; i < length; i++) {
    const seg = createSegment(startIndex + i, lanes);
    const t = i / length;
    seg.world.y = Math.sin(t * Math.PI) * hillHeight * hillDir * 60;
    seg.curve = Math.sin(t * Math.PI) * curveIntensity * curveDir;
    segments.push(seg);
  }
}

function addFork(segments, length, startIndex) {
  for (let i = 0; i < length; i++) {
    const seg = createSegment(startIndex + i, LANE_COUNT);
    const t = i / length;
    seg.fork = {
      progress: t,
      widen: Math.min(1, t * 5),
      split: Math.min(1, Math.max(0, (t - 0.05) * 3)),
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

export function interpolateY(segments, z) {
  const idx = Math.floor(z / SEGMENT_LENGTH) % segments.length;
  const nextIdx = (idx + 1) % segments.length;
  const t = ((z % SEGMENT_LENGTH) + SEGMENT_LENGTH) % SEGMENT_LENGTH / SEGMENT_LENGTH;
  const y0 = segments[idx].world.y || 0;
  const y1 = segments[nextIdx].world.y || 0;
  return y0 + (y1 - y0) * t;
}

export function getSegmentIndex(z, totalSegments) {
  return Math.floor(z / SEGMENT_LENGTH) % totalSegments;
}

export function trackLength(segments) {
  return segments.length * SEGMENT_LENGTH;
}

export function getSegmentY(segments, z) {
  if (segments.length === 0) return 0;
  const idx = ((Math.floor(z / SEGMENT_LENGTH) % segments.length) + segments.length) % segments.length;
  return segments[idx].world.y || 0;
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
    seg.cars.length = 0;
  }
  for (const car of cars) {
    const idx = getSegmentIndex(car.z, segments.length);
    segments[idx].cars.push(car);
  }
}
