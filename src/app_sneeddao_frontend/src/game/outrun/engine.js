import {
  SEGMENT_LENGTH, ROAD_WIDTH, MAX_SPEED, ACCEL, BRAKE_DECEL,
  NATURAL_DECEL, OFF_ROAD_DECEL, OFF_ROAD_MAX, CENTRIFUGAL_FORCE,
  OFF_ROAD_THRESHOLD, TOTAL_CARS, STAGE_TIME, CAMERA_HEIGHT, CAMERA_DEPTH,
  LANE_COUNT, TRANSITION_SEGS,
} from './constants.js';
import { clamp, randomChoice, overlap } from './utils.js';
import { buildRoad, findSegment, trackLength, addSpritesToSegments, getSegmentIndex } from './road.js';
import { getSpriteWidth, CAR_COLORS, loadSpriteSheets, TRAFFIC_CAR_COUNT } from './sprites.js';
import { render, resetRenderCache } from './render.js';
import { getStageTrack, THEME_ORDER } from './tracks.js';

export function createGame(canvas, trackDef) {
  const ctx = canvas.getContext('2d');
  let animFrameId = null;
  let lastTime = 0;

  const state = {
    segments: [],
    position: 0,
    playerX: 0,
    speed: 0,
    steer: 0,
    time: STAGE_TIME,
    stage: 1,
    gameState: 'title', // title | countdown | playing | crash | gameover
    countdown: 3,
    theme: trackDef.theme || 'beach',
    skyOffset: 0,
    bgOffset: 0,
    hillOffset: 0,
    cars: [],
    collisionCooldown: 0,
    trackDef,
    // Theme transition
    themeFrom: null,
    themeTo: null,
    themeBlendSegs: 0,
    // Crash
    crash: { timer: 0, airY: 0, velY: 0, rotation: 0, rotSpeed: 0, bounces: 0 },
    fingerWag: 0,
  };

  function init() {
    state.segments = buildRoad(trackDef.definition);
    if (trackDef.sprites) {
      addSpritesToSegments(state.segments, trackDef.sprites);
    }
    initCars();
    placeCarsOnSegments();
  }

  function initCars() {
    state.cars = [];
    const total = trackLength(state.segments);
    const safeZone = SEGMENT_LENGTH * 20;
    for (let i = 0; i < TOTAL_CARS; i++) {
      const z = safeZone + Math.random() * (total - safeZone * 2);
      state.cars.push({
        offset: -0.7 + Math.random() * 1.4,
        z,
        speed: MAX_SPEED * (0.3 + Math.random() * 0.4),
        color: randomChoice(CAR_COLORS),
        colorIndex: i % TRAFFIC_CAR_COUNT,
      });
    }
  }

  function placeCarsOnSegments() {
    for (const seg of state.segments) {
      seg.cars.length = 0;
    }
    for (const car of state.cars) {
      const idx = getSegmentIndex(car.z, state.segments.length);
      state.segments[idx].cars.push(car);
    }
  }

  function reset() {
    state.position = 0;
    state.playerX = 0;
    state.speed = 0;
    state.steer = 0;
    state.time = STAGE_TIME;
    state.stage = 1;
    state.gameState = 'title';
    state.countdown = 3;
    state.collisionCooldown = 0;
    state.skyOffset = 0;
    state.bgOffset = 0;
    state.hillOffset = 0;
    state.themeFrom = null;
    state.themeTo = null;
    state.themeBlendSegs = 0;
    state.fingerWag = 0;
    state.theme = trackDef.theme || 'beach';
    state.trackDef = trackDef;
    init();
  }

  function update(dt, input) {
    switch (state.gameState) {
      case 'title':
        updateTitle(dt, input);
        break;
      case 'countdown':
        updateCountdown(dt);
        break;
      case 'playing':
        updatePlaying(dt, input);
        break;
      case 'crash':
        updateCrash(dt);
        break;
      case 'gameover':
        updateGameOver(dt, input);
        break;
    }
  }

  function updateTitle(dt, input) {
    state.position += dt * MAX_SPEED * 0.15;
    const total = trackLength(state.segments);
    if (state.position > total) state.position -= total;
    state.skyOffset += dt * 20;

    if (input.isStart()) {
      state.gameState = 'countdown';
      state.countdown = 3;
      state.position = 0;
      state.speed = 0;
      state.playerX = 0;
    }
  }

  function updateCountdown(dt) {
    state.countdown -= dt;
    if (state.countdown <= 0) {
      state.gameState = 'playing';
    }
  }

  function updatePlaying(dt, input) {
    const total = trackLength(state.segments);
    const seg = findSegment(state.segments, state.position);

    const steerDir = input.steerDirection();
    state.steer = steerDir;

    if (steerDir !== 0) {
      state.playerX += steerDir * dt * 2.5 * (state.speed / MAX_SPEED);
    }

    if (seg) {
      const speedRatio = state.speed / MAX_SPEED;
      state.playerX -= seg.curve * CENTRIFUGAL_FORCE * dt * speedRatio * speedRatio;
    }

    state.playerX = clamp(state.playerX, -2.5, 2.5);

    if (input.isAccelerating()) {
      state.speed += ACCEL * dt;
    } else if (input.isBraking()) {
      state.speed += BRAKE_DECEL * dt;
    } else {
      state.speed += NATURAL_DECEL * dt;
    }

    if (Math.abs(state.playerX) > OFF_ROAD_THRESHOLD) {
      const offAmount = (Math.abs(state.playerX) - OFF_ROAD_THRESHOLD) / 1.5;
      state.speed += OFF_ROAD_DECEL * offAmount * dt;
      if (state.speed > OFF_ROAD_MAX) {
        state.speed = Math.max(OFF_ROAD_MAX, state.speed + OFF_ROAD_DECEL * offAmount * dt);
      }
    }

    state.speed = clamp(state.speed, 0, MAX_SPEED);
    state.position += state.speed * dt;

    state.skyOffset += (steerDir * state.speed / MAX_SPEED) * dt * 80;
    state.bgOffset += (steerDir * state.speed / MAX_SPEED) * dt * 160;
    state.hillOffset += (steerDir * state.speed / MAX_SPEED) * dt * 240;

    // Curve-based parallax
    if (seg) {
      const curveFactor = seg.curve * state.speed / MAX_SPEED;
      state.skyOffset  -= curveFactor * dt * 40;
      state.bgOffset   -= curveFactor * dt * 80;
      state.hillOffset -= curveFactor * dt * 120;
    }

    if (state.collisionCooldown > 0) {
      state.collisionCooldown -= dt;
    }

    if (state.fingerWag > 0) {
      state.fingerWag -= dt;
      if (state.speed > MAX_SPEED * 0.15) state.fingerWag = 0;
    }

    if (state.collisionCooldown <= 0) {
      // Sprite collision
      if (seg && seg.sprite && Math.abs(state.playerX) > 0.8) {
        const spriteW = getSpriteWidth(seg.sprite.type) / ROAD_WIDTH;
        const spritePos = seg.sprite.offset;
        if (overlap(state.playerX, 0.3, spritePos, spriteW * 2, 1.0)) {
          if (state.speed > MAX_SPEED * 0.4) {
            // High-speed crash
            triggerCrash();
          } else {
            if (state.speed > MAX_SPEED * 0.15) state.fingerWag = 2.0;
            state.speed = Math.max(0, state.speed * 0.3);
            state.collisionCooldown = 0.8;
          }
        }
      }

      // Car collision
      const playerSegIdx = getSegmentIndex(state.position, state.segments.length);
      for (let di = -2; di <= 2; di++) {
        const checkIdx = ((playerSegIdx + di) % state.segments.length + state.segments.length) % state.segments.length;
        const checkSeg = state.segments[checkIdx];
        for (const car of checkSeg.cars) {
          if (overlap(state.playerX, 0.3, car.offset, 0.3, 0.8)) {
            if (state.speed > car.speed) {
              state.speed = Math.max(car.speed, state.speed * 0.5);
              state.collisionCooldown = 1.0;
            }
          }
        }
      }
    }

    updateCars(dt, total);
    placeCarsOnSegments();

    // Clear theme transition once past blend zone
    if (state.themeBlendSegs > 0) {
      const baseIdx = Math.floor(state.position / SEGMENT_LENGTH);
      if (baseIdx >= state.themeBlendSegs) {
        state.theme = state.themeTo;
        state.themeFrom = null;
        state.themeTo = null;
        state.themeBlendSegs = 0;
      }
    }

    state.time -= dt;
    if (state.time <= 0) {
      state.time = 0;
      state.gameState = 'gameover';
    }

    // When reaching track end, auto-advance based on player position
    if (state.position >= total) {
      const choice = state.playerX >= 0 ? 'right' : 'left';
      advanceToNextStage(choice);
      return;
    }
  }

  function triggerCrash() {
    const speedRatio = state.speed / MAX_SPEED;
    state.crash = {
      timer: 0,
      airY: 0,
      velY: 400 + speedRatio * 300,
      rotation: 0,
      rotSpeed: (5 + Math.random() * 3) * (state.playerX > 0 ? 1 : -1),
      bounces: 0,
    };
    state.gameState = 'crash';
  }

  function updateCrash(dt) {
    const c = state.crash;
    c.timer += dt;

    // Gravity
    c.velY -= 1200 * dt;
    c.airY += c.velY * dt;
    c.rotation += c.rotSpeed * dt;

    // Bounce on ground
    if (c.airY <= 0 && c.velY < 0) {
      c.airY = 0;
      c.velY = Math.abs(c.velY) * 0.35;
      c.rotSpeed *= 0.5;
      c.bounces++;
    }

    // Decelerate
    state.speed *= (1 - 2.5 * dt);
    if (state.speed < 10) state.speed = 0;
    state.position += state.speed * dt;

    const total = trackLength(state.segments);
    if (state.position >= total) state.position -= total;

    // Settle after enough bounces or timeout
    if (c.bounces >= 3 || c.timer > 3.5) {
      state.speed = 0;
      state.collisionCooldown = 2.0;
      state.crash = { timer: 0, airY: 0, velY: 0, rotation: 0, rotSpeed: 0, bounces: 0 };
      state.fingerWag = 2.5;
      state.gameState = 'playing';
    }
  }

  function updateCars(dt, total) {
    for (const car of state.cars) {
      car.z += car.speed * dt;
      if (car.z >= total) car.z -= total;
      if (car.z < 0) car.z += total;
      car.offset += (Math.sin(car.z * 0.001) * 0.001);
      car.offset = clamp(car.offset, -0.8, 0.8);
    }
  }

  function advanceToNextStage(choice) {
    const prevTheme = state.theme;
    const nextThemeIdx = (THEME_ORDER.indexOf(prevTheme) + 1) % THEME_ORDER.length;
    const nextTheme = THEME_ORDER[nextThemeIdx];

    // Build transition curves + next stage track
    const transitionDef = buildTransitionDef(choice);
    const nextTrackData = getStageTrack(state.stage + 1);
    const fullDef = [...transitionDef, ...nextTrackData.definition, { type: 'fork', length: 120 }];

    state.segments = buildRoad(fullDef);

    // Generate sprites for the new track (skip transition zone for sprites)
    const transSegCount = transitionDef.reduce((sum, s) => sum + (s.length || 50), 0);
    const mainSegCount = state.segments.length;
    if (nextTrackData.spriteGenerator) {
      const sprites = nextTrackData.spriteGenerator(mainSegCount, transSegCount);
      addSpritesToSegments(state.segments, sprites);
    }

    state.stage += 1;
    state.time += STAGE_TIME;
    state.position = 0;
    state.speed = MAX_SPEED * 0.5;
    state.collisionCooldown = 2.0;
    state.gameState = 'playing';

    // Theme transition
    state.themeFrom = prevTheme;
    state.themeTo = nextTheme;
    state.themeBlendSegs = TRANSITION_SEGS;
    // theme stays as prevTheme until blend completes

    initCars();
    placeCarsOnSegments();
  }

  function buildTransitionDef(choice) {
    if (choice === 'left') {
      return [
        { type: 'straight', length: 20, lanes: 6 },
        { type: 'curve', direction: 'right', length: 80, intensity: 3, lanes: 5 },
        { type: 'straight', length: 15, lanes: 5 },
        { type: 'curve', direction: 'left', length: 80, intensity: 3, lanes: 6 },
        { type: 'straight', length: 25, lanes: 6 },
      ];
    }
    return [
      { type: 'straight', length: 20, lanes: 6 },
      { type: 'curve', direction: 'left', length: 80, intensity: 3, lanes: 5 },
      { type: 'straight', length: 15, lanes: 5 },
      { type: 'curve', direction: 'right', length: 80, intensity: 3, lanes: 6 },
      { type: 'straight', length: 25, lanes: 6 },
    ];
  }

  function updateGameOver(dt, input) {
    state.speed = Math.max(0, state.speed - MAX_SPEED * dt);
    if (input.isStart()) {
      reset();
      state.gameState = 'countdown';
      state.countdown = 3;
    }
  }

  function frame(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    try {
      update(dt, state._input);
      render(ctx, state);
    } catch (e) {
      console.error('OutRun frame error:', e);
    }
    animFrameId = requestAnimationFrame(frame);
  }

  async function start(input) {
    state._input = input;
    resetRenderCache();
    await loadSpriteSheets();
    init();
    lastTime = performance.now();
    animFrameId = requestAnimationFrame(frame);
  }

  function stop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  return { start, stop, reset, getState: () => state };
}
