// Canvas / viewport
export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 480;

// Camera
export const FOV = 100; // degrees — wide like the arcade
export const CAMERA_DEPTH = 1 / Math.tan(((FOV / 2) * Math.PI) / 180);
export const CAMERA_HEIGHT = 1000;
export const DRAW_DISTANCE = 200; // segments rendered ahead

// Road geometry
export const SEGMENT_LENGTH = 200; // world-units per segment
export const ROAD_WIDTH = 2000; // half-width of the road in world units
export const LANE_COUNT = 4;
export const RUMBLE_LENGTH = 3; // segments per rumble strip band

// Player
export const MAX_SPEED = SEGMENT_LENGTH * 70;
export const ACCEL = MAX_SPEED / 3;
export const BRAKE_DECEL = -MAX_SPEED;
export const NATURAL_DECEL = -MAX_SPEED / 50;
export const OFF_ROAD_DECEL = -MAX_SPEED / 8;
export const OFF_ROAD_MAX = MAX_SPEED / 2.5;
export const CENTRIFUGAL_FORCE = 0.10;
export const OFF_ROAD_THRESHOLD = 1.2;
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH;

// AI traffic
export const TOTAL_CARS = 12;
export const CAR_SPACING = 50; // minimum segment gap between AI cars

// Timing
export const STAGE_TIME = 80; // seconds per stage
export const TRANSITION_SEGS = 220;

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
    ground: { light: '#1E90FF', dark: '#1878D8' },     // Blue water (far ground)
    shoulder: { light: '#C2B280', dark: '#A99B6A' },    // Sandy shoulder
    road: { light: '#6B6B6B', dark: '#696969' },
    rumble: { light: '#E8473C', dark: '#BBBBBB' },
    lane: '#CCCCCC',
  },
  desert: {
    sky: ['#FDB813', '#FFE4B5'],
    horizon: '#DEB887',
    mountains: '#8B7355',
    ground: { light: '#C2B280', dark: '#A99B6A' },      // Sand
    shoulder: { light: '#D4C494', dark: '#BBA87A' },     // Lighter sand shoulder
    road: { light: '#6B6B6B', dark: '#696969' },
    rumble: { light: '#E8473C', dark: '#BBBBBB' },
    lane: '#CCCCCC',
  },
  forest: {
    sky: ['#4A90D9', '#87CEEB'],
    horizon: '#6B8E23',
    mountains: '#2E5B2E',
    ground: { light: '#4CAF50', dark: '#388E3C' },       // Meadow/field green
    shoulder: { light: '#1A8A1A', dark: '#0A7A0A' },     // Darker grass shoulder
    road: { light: '#555555', dark: '#505050' },
    rumble: { light: '#E8473C', dark: '#BBBBBB' },
    lane: '#CCCCCC',
  },
  night: {
    sky: ['#0B0B3B', '#1a1a4e'],
    horizon: '#1a1a2e',
    mountains: '#111133',
    ground: { light: '#0A3A0A', dark: '#052A05' },       // Dark
    shoulder: { light: '#0D4D0D', dark: '#073707' },      // Slightly lighter dark shoulder
    road: { light: '#444444', dark: '#3a3a3a' },
    rumble: { light: '#D03030', dark: '#888888' },
    lane: '#999999',
  },
};

// Road projection
export const CURVE_SCALE = 80;
export const FOG_DENSITY = 5;
