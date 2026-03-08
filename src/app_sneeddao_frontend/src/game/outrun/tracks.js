import { SPRITE_TYPES } from './sprites.js';

export const THEME_ORDER = ['beach', 'forest', 'desert', 'night'];

// --- TRACK 1: Coconut Beach ---
export const COCONUT_BEACH = {
  name: 'Coconut Beach',
  theme: 'beach',
  definition: [
    { type: 'straight', length: 50, lanes: 6 },
    { type: 'curve', direction: 'right', length: 120, intensity: 3, lanes: 4 },
    { type: 'straight', length: 40, lanes: 5 },
    { type: 'hill', direction: 'up', length: 60, intensity: 30, lanes: 6 },
    { type: 'curve', direction: 'left', length: 100, intensity: 2.5, lanes: 4 },
    { type: 'straight', length: 30, lanes: 6 },
    { type: 'hill', direction: 'down', length: 50, intensity: 25, lanes: 6 },
    { type: 'straight', length: 20, lanes: 6 },
    { type: 'scurve', length: 200, intensity: 3, lanes: 4 },
    { type: 'straight', length: 40, lanes: 6 },
    { type: 'hillcurve', length: 80, hillIntensity: 35, hillDir: 'up', curveIntensity: 2, curveDir: 'right', lanes: 4 },
    { type: 'straight', length: 30, lanes: 5 },
    { type: 'curve', direction: 'left', length: 140, intensity: 3.5, lanes: 3 },
    { type: 'hill', direction: 'up', length: 50, intensity: 20, lanes: 4 },
    { type: 'straight', length: 35, lanes: 6 },
    { type: 'curve', direction: 'right', length: 100, intensity: 2, lanes: 4 },
    { type: 'hill', direction: 'down', length: 60, intensity: 30, lanes: 5 },
    { type: 'straight', length: 50, lanes: 6 },
    { type: 'scurve', length: 160, intensity: 2.5, lanes: 4 },
    { type: 'straight', length: 40, lanes: 6 },
    { type: 'fork', length: 40 },
  ],
  sprites: generateBeachSprites(1480),
  spriteGenerator: generateBeachSprites,
};

// --- TRACK 2: Desert Dusk ---
export const DESERT_DUSK = {
  name: 'Desert Dusk',
  theme: 'desert',
  definition: [
    { type: 'straight', length: 60, lanes: 6 },
    { type: 'curve', direction: 'left', length: 140, intensity: 2.5, lanes: 4 },
    { type: 'hill', direction: 'up', length: 70, intensity: 40, lanes: 5 },
    { type: 'straight', length: 30, lanes: 6 },
    { type: 'curve', direction: 'right', length: 160, intensity: 3.5, lanes: 3 },
    { type: 'hill', direction: 'down', length: 80, intensity: 35, lanes: 5 },
    { type: 'straight', length: 50, lanes: 6 },
    { type: 'scurve', length: 200, intensity: 3, lanes: 4 },
    { type: 'hillcurve', length: 100, hillIntensity: 30, hillDir: 'up', curveIntensity: 2.5, curveDir: 'left', lanes: 4 },
    { type: 'straight', length: 40, lanes: 6 },
    { type: 'curve', direction: 'right', length: 120, intensity: 3, lanes: 4 },
    { type: 'straight', length: 35, lanes: 6 },
    { type: 'hill', direction: 'up', length: 50, intensity: 25, lanes: 5 },
    { type: 'straight', length: 30, lanes: 6 },
    { type: 'fork', length: 40 },
  ],
  sprites: generateDesertSprites(1205),
  spriteGenerator: generateDesertSprites,
};

// --- TRACK 3: Pine Forest ---
const FOREST_DEF = [
  { type: 'straight', length: 40, lanes: 4 },
  { type: 'curve', direction: 'left', length: 100, intensity: 2, lanes: 3 },
  { type: 'hill', direction: 'up', length: 80, intensity: 40, lanes: 4 },
  { type: 'straight', length: 30, lanes: 4 },
  { type: 'scurve', length: 160, intensity: 3, lanes: 3 },
  { type: 'hill', direction: 'down', length: 60, intensity: 30, lanes: 4 },
  { type: 'straight', length: 35, lanes: 5 },
  { type: 'curve', direction: 'right', length: 120, intensity: 3.5, lanes: 3 },
  { type: 'hillcurve', length: 80, hillIntensity: 35, hillDir: 'up', curveIntensity: 2, curveDir: 'left', lanes: 3 },
  { type: 'straight', length: 40, lanes: 5 },
  { type: 'curve', direction: 'left', length: 100, intensity: 2.5, lanes: 4 },
  { type: 'hill', direction: 'up', length: 50, intensity: 25, lanes: 4 },
  { type: 'straight', length: 30, lanes: 5 },
];

// --- TRACK 4: Night Highway ---
const NIGHT_DEF = [
  { type: 'straight', length: 80, lanes: 6 },
  { type: 'curve', direction: 'right', length: 140, intensity: 2, lanes: 5 },
  { type: 'straight', length: 50, lanes: 6 },
  { type: 'hill', direction: 'up', length: 60, intensity: 20, lanes: 6 },
  { type: 'curve', direction: 'left', length: 120, intensity: 2.5, lanes: 5 },
  { type: 'hill', direction: 'down', length: 70, intensity: 30, lanes: 6 },
  { type: 'scurve', length: 200, intensity: 2, lanes: 5 },
  { type: 'straight', length: 60, lanes: 6 },
  { type: 'hillcurve', length: 80, hillIntensity: 25, hillDir: 'up', curveIntensity: 2, curveDir: 'right', lanes: 5 },
  { type: 'straight', length: 40, lanes: 6 },
  { type: 'curve', direction: 'left', length: 100, intensity: 3, lanes: 4 },
  { type: 'straight', length: 30, lanes: 6 },
];

const BEACH_DEF_NO_FORK = COCONUT_BEACH.definition.filter(s => s.type !== 'fork');
const DESERT_DEF_NO_FORK = DESERT_DUSK.definition.filter(s => s.type !== 'fork');

const TRACK_POOL = {
  beach:  [BEACH_DEF_NO_FORK],
  forest: [FOREST_DEF],
  desert: [DESERT_DEF_NO_FORK],
  night:  [NIGHT_DEF],
};

export function getStageTrack(stageNum) {
  const themeIdx = (stageNum - 1) % THEME_ORDER.length;
  const theme = THEME_ORDER[themeIdx];
  const defs = TRACK_POOL[theme];
  const def = defs[(stageNum - 1) % defs.length];

  const generators = {
    beach: generateBeachSprites,
    forest: generateForestSprites,
    desert: generateDesertSprites,
    night: generateNightSprites,
  };

  return {
    theme,
    definition: def,
    spriteGenerator: generators[theme] || generateBeachSprites,
  };
}

// --- Sprite generators ---

function generateBeachSprites(totalSegs, startOffset) {
  const sprites = [];
  const start = startOffset || 8;
  const rightTypes = [SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.PALM_TREE2, SPRITE_TYPES.BUSH, SPRITE_TYPES.BUSH_FLOWER];
  const leftTypes  = [SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.PALM_TREE2, SPRITE_TYPES.BUSH, SPRITE_TYPES.PALM_TREE, SPRITE_TYPES.BUSH_FLOWER];

  for (let i = start; i < totalSegs - 45; i += 7) {
    sprites.push({
      segment: i,
      type: rightTypes[(i * 7) % rightTypes.length],
      offset: 1.3 + (((i * 13) % 100) / 100) * 0.6,
    });
  }
  for (let i = start + 4; i < totalSegs - 45; i += 11) {
    sprites.push({
      segment: i,
      type: leftTypes[(i * 11) % leftTypes.length],
      offset: -1.3 - (((i * 17) % 100) / 100) * 0.6,
    });
  }
  for (let i = 100; i < totalSegs - 100; i += 200) {
    sprites.push({ segment: i, type: SPRITE_TYPES.BILLBOARD, offset: (i % 400 < 200 ? 1 : -1) * 2.0 });
  }
  for (let i = 50; i < totalSegs - 100; i += 150) {
    sprites.push({ segment: i, type: SPRITE_TYPES.SIGN_RIGHT, offset: 1.6 });
  }
  for (let i = 2; i < 30; i += 8) {
    sprites.push({ segment: i, type: SPRITE_TYPES.COLUMN, offset: 1.12 });
    sprites.push({ segment: i, type: SPRITE_TYPES.COLUMN, offset: -1.12 });
  }
  return sprites;
}

function generateDesertSprites(totalSegs, startOffset) {
  const sprites = [];
  const start = startOffset || 8;
  const rightTypes = [SPRITE_TYPES.CACTUS, SPRITE_TYPES.ROCK_LARGE, SPRITE_TYPES.DEAD_TREE, SPRITE_TYPES.CACTUS, SPRITE_TYPES.CLIFF];
  const leftTypes  = [SPRITE_TYPES.ROCK_LARGE, SPRITE_TYPES.CACTUS, SPRITE_TYPES.DEAD_TREE_BARE, SPRITE_TYPES.CLIFF, SPRITE_TYPES.CACTUS];

  for (let i = start; i < totalSegs - 45; i += 8) {
    sprites.push({
      segment: i,
      type: rightTypes[(i * 7) % rightTypes.length],
      offset: 1.3 + (((i * 13) % 100) / 100) * 0.8,
    });
  }
  for (let i = start + 6; i < totalSegs - 45; i += 12) {
    sprites.push({
      segment: i,
      type: leftTypes[(i * 11) % leftTypes.length],
      offset: -1.3 - (((i * 17) % 100) / 100) * 0.8,
    });
  }
  for (let i = 100; i < totalSegs - 100; i += 250) {
    sprites.push({ segment: i, type: SPRITE_TYPES.BILLBOARD, offset: (i % 500 < 250 ? 1 : -1) * 2.0 });
  }
  return sprites;
}

function generateForestSprites(totalSegs, startOffset) {
  const sprites = [];
  const start = startOffset || 8;
  const rightTypes = [SPRITE_TYPES.GREEN_TREE, SPRITE_TYPES.PINE_TREE, SPRITE_TYPES.BUSH, SPRITE_TYPES.GREEN_TREE, SPRITE_TYPES.TOWER];
  const leftTypes  = [SPRITE_TYPES.GREEN_TREE, SPRITE_TYPES.BUSH, SPRITE_TYPES.PINE_TREE, SPRITE_TYPES.GREEN_TREE, SPRITE_TYPES.BUSH_FLOWER];

  for (let i = start; i < totalSegs - 45; i += 6) {
    sprites.push({
      segment: i,
      type: rightTypes[(i * 7) % rightTypes.length],
      offset: 1.2 + (((i * 13) % 100) / 100) * 0.5,
    });
  }
  for (let i = start + 3; i < totalSegs - 45; i += 9) {
    sprites.push({
      segment: i,
      type: leftTypes[(i * 11) % leftTypes.length],
      offset: -1.2 - (((i * 17) % 100) / 100) * 0.5,
    });
  }
  for (let i = 80; i < totalSegs - 100; i += 180) {
    sprites.push({ segment: i, type: SPRITE_TYPES.BILLBOARD, offset: (i % 360 < 180 ? 1 : -1) * 1.9 });
  }
  return sprites;
}

function generateNightSprites(totalSegs, startOffset) {
  const sprites = [];
  const start = startOffset || 8;
  const rightTypes = [SPRITE_TYPES.TOWER, SPRITE_TYPES.COLUMN, SPRITE_TYPES.DEAD_TREE, SPRITE_TYPES.AUTUMN_TREE, SPRITE_TYPES.COLUMN];
  const leftTypes  = [SPRITE_TYPES.COLUMN, SPRITE_TYPES.DEAD_TREE_BARE, SPRITE_TYPES.TOWER, SPRITE_TYPES.COLUMN, SPRITE_TYPES.AUTUMN_TREE];

  for (let i = start; i < totalSegs - 45; i += 10) {
    sprites.push({
      segment: i,
      type: rightTypes[(i * 7) % rightTypes.length],
      offset: 1.15 + (((i * 13) % 100) / 100) * 0.4,
    });
  }
  for (let i = start + 5; i < totalSegs - 45; i += 12) {
    sprites.push({
      segment: i,
      type: leftTypes[(i * 11) % leftTypes.length],
      offset: -1.15 - (((i * 17) % 100) / 100) * 0.4,
    });
  }
  for (let i = 2; i < totalSegs - 45; i += 6) {
    sprites.push({ segment: i, type: SPRITE_TYPES.COLUMN, offset: 1.08 });
    sprites.push({ segment: i, type: SPRITE_TYPES.COLUMN, offset: -1.08 });
  }
  for (let i = 100; i < totalSegs - 100; i += 200) {
    sprites.push({ segment: i, type: SPRITE_TYPES.BILLBOARD, offset: (i % 400 < 200 ? 1 : -1) * 1.8 });
  }
  return sprites;
}

export const ALL_TRACKS = [COCONUT_BEACH, DESERT_DUSK];
export const DEFAULT_TRACK = COCONUT_BEACH;
