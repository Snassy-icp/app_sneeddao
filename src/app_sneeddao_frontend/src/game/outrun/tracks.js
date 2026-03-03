import { SPRITE_TYPES } from './sprites.js';

// --- TRACK 1: Coconut Beach ---
export const COCONUT_BEACH = {
  name: 'Coconut Beach',
  theme: 'beach',
  definition: [
    { type: 'straight', length: 50 },
    { type: 'curve', direction: 'right', length: 120, intensity: 3 },
    { type: 'straight', length: 40 },
    { type: 'hill', direction: 'up', length: 60, intensity: 30 },
    { type: 'curve', direction: 'left', length: 100, intensity: 2.5 },
    { type: 'straight', length: 30 },
    { type: 'hill', direction: 'down', length: 50, intensity: 25 },
    { type: 'straight', length: 20 },
    { type: 'scurve', length: 200, intensity: 3 },
    { type: 'straight', length: 40 },
    { type: 'hillcurve', length: 80, hillIntensity: 35, hillDir: 'up', curveIntensity: 2, curveDir: 'right' },
    { type: 'straight', length: 30 },
    { type: 'curve', direction: 'left', length: 140, intensity: 3.5 },
    { type: 'hill', direction: 'up', length: 50, intensity: 20 },
    { type: 'straight', length: 35 },
    { type: 'curve', direction: 'right', length: 100, intensity: 2 },
    { type: 'hill', direction: 'down', length: 60, intensity: 30 },
    { type: 'straight', length: 50 },
    { type: 'scurve', length: 160, intensity: 2.5 },
    { type: 'straight', length: 40 },
    { type: 'fork', length: 40 },
  ],
  sprites: generateBeachSprites(1480),
};

// --- TRACK 2: Desert Dusk ---
export const DESERT_DUSK = {
  name: 'Desert Dusk',
  theme: 'desert',
  definition: [
    { type: 'straight', length: 60 },
    { type: 'curve', direction: 'left', length: 140, intensity: 2.5 },
    { type: 'hill', direction: 'up', length: 70, intensity: 40 },
    { type: 'straight', length: 30 },
    { type: 'curve', direction: 'right', length: 160, intensity: 3.5 },
    { type: 'hill', direction: 'down', length: 80, intensity: 35 },
    { type: 'straight', length: 50 },
    { type: 'scurve', length: 200, intensity: 3 },
    { type: 'hillcurve', length: 100, hillIntensity: 30, hillDir: 'up', curveIntensity: 2.5, curveDir: 'left' },
    { type: 'straight', length: 40 },
    { type: 'curve', direction: 'right', length: 120, intensity: 3 },
    { type: 'straight', length: 35 },
    { type: 'hill', direction: 'up', length: 50, intensity: 25 },
    { type: 'straight', length: 30 },
    { type: 'fork', length: 40 },
  ],
  sprites: generateDesertSprites(1205),
};

function generateBeachSprites(totalSegs) {
  const sprites = [];
  // Heavily palm-tree weighted, very few signs
  const rightTypes = [SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.BUSH, SPRITE_TYPES.ROCK];
  const leftTypes  = [SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.BUSH, SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.BUSH];

  for (let i = 8; i < totalSegs - 45; i += 7) {
    sprites.push({
      segment: i,
      type: rightTypes[(i * 7) % rightTypes.length],
      offset: 1.3 + (((i * 13) % 100) / 100) * 0.6,
    });
  }
  for (let i = 12; i < totalSegs - 45; i += 11) {
    sprites.push({
      segment: i,
      type: leftTypes[(i * 11) % leftTypes.length],
      offset: -1.3 - (((i * 17) % 100) / 100) * 0.6,
    });
  }
  // Billboards every ~200 segments
  for (let i = 100; i < totalSegs - 100; i += 200) {
    sprites.push({
      segment: i,
      type: SPRITE_TYPES.BILLBOARD,
      offset: (i % 400 < 200 ? 1 : -1) * 2.0,
    });
  }
  // Signs — just a few
  for (let i = 50; i < totalSegs - 100; i += 150) {
    sprites.push({
      segment: i,
      type: SPRITE_TYPES.SIGN_RIGHT,
      offset: 1.6,
    });
  }
  // Starting columns
  for (let i = 2; i < 30; i += 8) {
    sprites.push({ segment: i, type: SPRITE_TYPES.COLUMN, offset: 1.12 });
    sprites.push({ segment: i, type: SPRITE_TYPES.COLUMN, offset: -1.12 });
  }

  return sprites;
}

function generateDesertSprites(totalSegs) {
  const sprites = [];
  const rightTypes = [SPRITE_TYPES.CACTUS, SPRITE_TYPES.ROCK, SPRITE_TYPES.DEAD_TREE, SPRITE_TYPES.CACTUS, SPRITE_TYPES.ROCK];
  const leftTypes  = [SPRITE_TYPES.ROCK, SPRITE_TYPES.CACTUS, SPRITE_TYPES.DEAD_TREE, SPRITE_TYPES.ROCK, SPRITE_TYPES.CACTUS];

  for (let i = 8; i < totalSegs - 45; i += 8) {
    sprites.push({
      segment: i,
      type: rightTypes[(i * 7) % rightTypes.length],
      offset: 1.3 + (((i * 13) % 100) / 100) * 0.8,
    });
  }
  for (let i = 14; i < totalSegs - 45; i += 12) {
    sprites.push({
      segment: i,
      type: leftTypes[(i * 11) % leftTypes.length],
      offset: -1.3 - (((i * 17) % 100) / 100) * 0.8,
    });
  }
  for (let i = 100; i < totalSegs - 100; i += 250) {
    sprites.push({
      segment: i,
      type: SPRITE_TYPES.BILLBOARD,
      offset: (i % 500 < 250 ? 1 : -1) * 2.0,
    });
  }

  return sprites;
}

export const ALL_TRACKS = [COCONUT_BEACH, DESERT_DUSK];
export const DEFAULT_TRACK = COCONUT_BEACH;
