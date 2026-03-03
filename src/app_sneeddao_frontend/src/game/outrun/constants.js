// Canvas / viewport
export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 480;

// Camera
export const FOV = 100; // degrees — wide like the arcade
export const CAMERA_DEPTH = 1 / Math.tan(((FOV / 2) * Math.PI) / 180);
export const CAMERA_HEIGHT = 1500;
export const DRAW_DISTANCE = 150; // segments rendered ahead (fog hides beyond ~100)

// Road geometry
export const SEGMENT_LENGTH = 200; // world-units per segment
export const ROAD_WIDTH = 2000; // half-width of the road in world units
export const LANE_COUNT = 3;
export const RUMBLE_LENGTH = 3; // segments per rumble strip band

// Player
export const MAX_SPEED = SEGMENT_LENGTH * 60;
export const ACCEL = MAX_SPEED / 2;
export const BRAKE_DECEL = -MAX_SPEED;
export const NATURAL_DECEL = -MAX_SPEED / 50;
export const OFF_ROAD_DECEL = -MAX_SPEED / 8;
export const OFF_ROAD_MAX = MAX_SPEED / 2.5;
export const CENTRIFUGAL_FORCE = 0.08;
export const OFF_ROAD_THRESHOLD = 1.2;
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH;

// AI traffic
export const TOTAL_CARS = 12;
export const CAR_SPACING = 50; // minimum segment gap between AI cars

// Timing
export const STAGE_TIME = 75; // seconds per stage

// Colors — alternating road band palettes
export const COLORS = {
  SKY: '#72D7EE',
  TREE: '#005108',
  FOG: '#005108',

  LIGHT: {
    road: '#6B6B6B',
    grass: '#10AA10',
    rumble: '#BBB',
    lane: '#CCC',
    ground: '#10AA10',
  },
  DARK: {
    road: '#696969',
    grass: '#009A00',
    rumble: '#666',
    lane: '#696969', // same as road = invisible
    ground: '#009A00',
  },
  OFFROAD: '#10AA10',
  FINISH: '#FFF',
  START: '#FFF',
};

// Themes — color palettes per environment
export const THEMES = {
  beach: {
    sky: ['#72D7EE', '#B0E0FF'],
    horizon: '#87CEEB',
    mountains: '#5B8C5A',
    ground: { light: '#10AA10', dark: '#009A00' },
    road: { light: '#6B6B6B', dark: '#696969' },
    rumble: { light: '#E8473C', dark: '#BBB' },
    lane: '#CCC',
    fog: 'rgba(114,215,238,',
  },
  desert: {
    sky: ['#FDB813', '#FFE4B5'],
    horizon: '#DEB887',
    mountains: '#8B7355',
    ground: { light: '#C2B280', dark: '#A99B6A' },
    road: { light: '#6B6B6B', dark: '#696969' },
    rumble: { light: '#E8473C', dark: '#BBB' },
    lane: '#CCC',
    fog: 'rgba(253,184,19,',
  },
  forest: {
    sky: ['#4A90D9', '#87CEEB'],
    horizon: '#6B8E23',
    mountains: '#2E5B2E',
    ground: { light: '#1A8A1A', dark: '#0A7A0A' },
    road: { light: '#555', dark: '#505050' },
    rumble: { light: '#E8473C', dark: '#BBB' },
    lane: '#CCC',
    fog: 'rgba(74,144,217,',
  },
  night: {
    sky: ['#0B0B3B', '#1a1a4e'],
    horizon: '#1a1a2e',
    mountains: '#111133',
    ground: { light: '#0A3A0A', dark: '#052A05' },
    road: { light: '#444', dark: '#3a3a3a' },
    rumble: { light: '#D03030', dark: '#888' },
    lane: '#999',
    fog: 'rgba(11,11,59,',
  },
};
