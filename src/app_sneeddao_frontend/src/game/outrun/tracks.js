import { SPRITE_TYPES } from './sprites.js';

// --- TRACK 1: Coconut Beach ---
export const COCONUT_BEACH = {
  name: 'Coconut Beach',
  theme: 'beach',
  definition: [
    { type: 'straight', length: 40 },
    { type: 'curve', direction: 'right', length: 60, intensity: 2 },
    { type: 'straight', length: 25 },
    { type: 'hill', direction: 'up', length: 40, intensity: 25 },
    { type: 'curve', direction: 'left', length: 50, intensity: 3 },
    { type: 'straight', length: 20 },
    { type: 'hill', direction: 'down', length: 35, intensity: 20 },
    { type: 'scurve', length: 80, intensity: 4 },
    { type: 'straight', length: 30 },
    { type: 'hillcurve', length: 50, hillIntensity: 30, hillDir: 'up', curveIntensity: 2, curveDir: 'right' },
    { type: 'straight', length: 25 },
    { type: 'curve', direction: 'left', length: 70, intensity: 3.5 },
    { type: 'hill', direction: 'up', length: 30, intensity: 15 },
    { type: 'straight', length: 20 },
    { type: 'curve', direction: 'right', length: 55, intensity: 2.5 },
    { type: 'hill', direction: 'down', length: 40, intensity: 25 },
    { type: 'straight', length: 35 },
    { type: 'scurve', length: 60, intensity: 3 },
    { type: 'straight', length: 30 },
    { type: 'fork', length: 40 },
  ],
  sprites: generateBeachSprites(),
};

// --- TRACK 2: Desert Dusk ---
export const DESERT_DUSK = {
  name: 'Desert Dusk',
  theme: 'desert',
  definition: [
    { type: 'straight', length: 50 },
    { type: 'curve', direction: 'left', length: 80, intensity: 2.5 },
    { type: 'hill', direction: 'up', length: 50, intensity: 35 },
    { type: 'straight', length: 20 },
    { type: 'curve', direction: 'right', length: 90, intensity: 4 },
    { type: 'hill', direction: 'down', length: 60, intensity: 30 },
    { type: 'straight', length: 40 },
    { type: 'scurve', length: 100, intensity: 5 },
    { type: 'hillcurve', length: 60, hillIntensity: 25, hillDir: 'up', curveIntensity: 3, curveDir: 'left' },
    { type: 'straight', length: 30 },
    { type: 'curve', direction: 'right', length: 70, intensity: 3 },
    { type: 'straight', length: 25 },
    { type: 'fork', length: 40 },
  ],
  sprites: generateDesertSprites(),
};

function generateBeachSprites() {
  const sprites = [];
  let segment = 0;

  // Place palm trees on both sides, with variety
  const rightSideTypes = [SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.BUSH, SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.ROCK];
  const leftSideTypes = [SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.SIGN_LEFT, SPRITE_TYPES.BUSH, SPRITE_TYPES.PALM_TREE];

  // Total segments roughly = sum of all definition lengths
  const totalSegs = 785; // approximate

  for (let i = 5; i < totalSegs - 45; i += 4) {
    // Right side sprites (every ~4 segments)
    if (i % 4 === 0) {
      sprites.push({
        segment: i,
        type: rightSideTypes[Math.floor(Math.random() * rightSideTypes.length)],
        offset: 1.4 + Math.random() * 0.8,
      });
    }
    // Left side sprites (every ~6 segments)
    if (i % 6 === 0) {
      sprites.push({
        segment: i,
        type: leftSideTypes[Math.floor(Math.random() * leftSideTypes.length)],
        offset: -1.4 - Math.random() * 0.8,
      });
    }
    // Occasional billboards
    if (i % 80 === 0) {
      sprites.push({
        segment: i,
        type: SPRITE_TYPES.BILLBOARD,
        offset: (Math.random() > 0.5 ? 1 : -1) * (1.8 + Math.random() * 0.5),
      });
    }
    // Columns on straight sections
    if (i % 10 === 0 && i < 40) {
      sprites.push({
        segment: i,
        type: SPRITE_TYPES.COLUMN,
        offset: 1.2,
      });
      sprites.push({
        segment: i,
        type: SPRITE_TYPES.COLUMN,
        offset: -1.2,
      });
    }
  }

  return sprites;
}

function generateDesertSprites() {
  const sprites = [];
  const totalSegs = 675; // approximate

  const rightTypes = [SPRITE_TYPES.CACTUS, SPRITE_TYPES.ROCK, SPRITE_TYPES.DEAD_TREE, SPRITE_TYPES.CACTUS];
  const leftTypes = [SPRITE_TYPES.ROCK, SPRITE_TYPES.CACTUS, SPRITE_TYPES.SIGN_LEFT, SPRITE_TYPES.DEAD_TREE];

  for (let i = 5; i < totalSegs - 45; i += 5) {
    if (i % 5 === 0) {
      sprites.push({
        segment: i,
        type: rightTypes[Math.floor(Math.random() * rightTypes.length)],
        offset: 1.3 + Math.random() * 1.0,
      });
    }
    if (i % 7 === 0) {
      sprites.push({
        segment: i,
        type: leftTypes[Math.floor(Math.random() * leftTypes.length)],
        offset: -1.3 - Math.random() * 1.0,
      });
    }
    if (i % 100 === 0) {
      sprites.push({
        segment: i,
        type: SPRITE_TYPES.BILLBOARD,
        offset: (Math.random() > 0.5 ? 1 : -1) * (1.8 + Math.random() * 0.5),
      });
    }
  }

  return sprites;
}

export const ALL_TRACKS = [COCONUT_BEACH, DESERT_DUSK];
export const DEFAULT_TRACK = COCONUT_BEACH;
