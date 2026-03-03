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
  const rightSideTypes = [SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.BUSH, SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.ROCK];
  const leftSideTypes = [SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.SIGN_LEFT, SPRITE_TYPES.BUSH, SPRITE_TYPES.PALM_TREE];

  for (let i = 5; i < totalSegs - 45; i++) {
    if (i % 3 === 0) {
      sprites.push({
        segment: i,
        type: rightSideTypes[(i * 7) % rightSideTypes.length],
        offset: 1.3 + (((i * 13) % 100) / 100) * 0.8,
      });
    }
    if (i % 5 === 0) {
      sprites.push({
        segment: i,
        type: leftSideTypes[(i * 11) % leftSideTypes.length],
        offset: -1.3 - (((i * 17) % 100) / 100) * 0.8,
      });
    }
    if (i % 60 === 0) {
      sprites.push({
        segment: i,
        type: SPRITE_TYPES.BILLBOARD,
        offset: (i % 120 === 0 ? 1 : -1) * (1.8 + ((i * 7) % 50) / 100),
      });
    }
    if (i % 8 === 0 && i < 50) {
      sprites.push({ segment: i, type: SPRITE_TYPES.COLUMN, offset: 1.15 });
      sprites.push({ segment: i, type: SPRITE_TYPES.COLUMN, offset: -1.15 });
    }
  }

  return sprites;
}

function generateDesertSprites(totalSegs) {
  const sprites = [];
  const rightTypes = [SPRITE_TYPES.CACTUS, SPRITE_TYPES.ROCK, SPRITE_TYPES.DEAD_TREE, SPRITE_TYPES.CACTUS];
  const leftTypes = [SPRITE_TYPES.ROCK, SPRITE_TYPES.CACTUS, SPRITE_TYPES.SIGN_LEFT, SPRITE_TYPES.DEAD_TREE];

  for (let i = 5; i < totalSegs - 45; i++) {
    if (i % 4 === 0) {
      sprites.push({
        segment: i,
        type: rightTypes[(i * 7) % rightTypes.length],
        offset: 1.3 + (((i * 13) % 100) / 100) * 1.0,
      });
    }
    if (i % 6 === 0) {
      sprites.push({
        segment: i,
        type: leftTypes[(i * 11) % leftTypes.length],
        offset: -1.3 - (((i * 17) % 100) / 100) * 1.0,
      });
    }
    if (i % 80 === 0) {
      sprites.push({
        segment: i,
        type: SPRITE_TYPES.BILLBOARD,
        offset: (i % 160 === 0 ? 1 : -1) * (1.8 + ((i * 7) % 50) / 100),
      });
    }
  }

  return sprites;
}

export const ALL_TRACKS = [COCONUT_BEACH, DESERT_DUSK];
export const DEFAULT_TRACK = COCONUT_BEACH;
