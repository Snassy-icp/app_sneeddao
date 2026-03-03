import {
  SEGMENT_LENGTH, ROAD_WIDTH, MAX_SPEED, ACCEL, BRAKE_DECEL,
  NATURAL_DECEL, OFF_ROAD_DECEL, OFF_ROAD_MAX, CENTRIFUGAL_FORCE,
  OFF_ROAD_THRESHOLD, TOTAL_CARS, STAGE_TIME, CAMERA_HEIGHT, CAMERA_DEPTH,
} from './constants.js';
import { clamp, randomChoice, overlap } from './utils.js';
import { buildRoad, findSegment, trackLength, addSpritesToSegments, getSegmentIndex } from './road.js';
import { getSpriteWidth, CAR_COLORS } from './sprites.js';
import { render } from './render.js';

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
    gameState: 'title',
    countdown: 3,
    theme: trackDef.theme || 'beach',
    skyOffset: 0,
    bgOffset: 0,
    hillOffset: 0,
    cars: [],
    forkTimer: 0,
    forkChoice: null,
    collisionCooldown: 0,
    trackDef,
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
      let z = safeZone + Math.random() * (total - safeZone * 2);
      state.cars.push({
        offset: -0.7 + Math.random() * 1.4,
        z,
        speed: MAX_SPEED * (0.3 + Math.random() * 0.4),
        color: randomChoice(CAR_COLORS),
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
    state.gameState = 'title';
    state.countdown = 3;
    state.forkTimer = 0;
    state.forkChoice = null;
    state.collisionCooldown = 0;
    state.skyOffset = 0;
    state.bgOffset = 0;
    state.hillOffset = 0;
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
      case 'fork':
        updateFork(dt, input);
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
      state.playerX += steerDir * dt * 2.0 * (state.speed / MAX_SPEED);
    }

    if (seg) {
      state.playerX -= (seg.curve * CENTRIFUGAL_FORCE * dt * state.speed / MAX_SPEED);
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

    if (state.collisionCooldown > 0) {
      state.collisionCooldown -= dt;
    }

    if (state.collisionCooldown <= 0) {
      // Sprite collision
      if (seg && seg.sprite && Math.abs(state.playerX) > 0.8) {
        const spriteW = getSpriteWidth(seg.sprite.type) / ROAD_WIDTH;
        const spritePos = seg.sprite.offset;
        if (overlap(state.playerX, 0.3, spritePos, spriteW * 2, 1.0)) {
          state.speed = Math.max(0, state.speed * 0.3);
          state.collisionCooldown = 0.8;
        }
      }

      // Car collision — only check cars on nearby segments
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

    state.time -= dt;
    if (state.time <= 0) {
      state.time = 0;
      state.gameState = 'gameover';
    }

    if (state.position >= total * 0.92) {
      const forkSeg = findSegment(state.segments, state.position);
      if (forkSeg && forkSeg.fork) {
        state.gameState = 'fork';
        state.forkTimer = 0;
      }
    }

    if (state.position >= total) {
      state.position -= total;
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

  function updateFork(dt, input) {
    state.forkTimer += dt;
    state.speed = Math.max(0, state.speed - MAX_SPEED * dt * 0.5);

    const steerDir = input.steerDirection();
    if (steerDir < -0.3) {
      state.forkChoice = 'left';
    } else if (steerDir > 0.3) {
      state.forkChoice = 'right';
    }

    if ((state.forkChoice && state.forkTimer > 1.5) || state.forkTimer > 4) {
      if (!state.forkChoice) state.forkChoice = 'right';
      state.stage += 1;
      state.time += STAGE_TIME;
      state.position = 0;
      state.speed = MAX_SPEED * 0.5;
      state.forkTimer = 0;
      state.forkChoice = null;
      state.collisionCooldown = 2.0;
      state.gameState = 'playing';
      initCars();
      placeCarsOnSegments();
    }
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
    update(dt, state._input);
    render(ctx, state);
    animFrameId = requestAnimationFrame(frame);
  }

  function start(input) {
    state._input = input;
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
