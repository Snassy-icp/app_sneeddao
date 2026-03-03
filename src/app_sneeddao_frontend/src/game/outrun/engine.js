import {
  SEGMENT_LENGTH, ROAD_WIDTH, MAX_SPEED, ACCEL, BRAKE_DECEL,
  NATURAL_DECEL, OFF_ROAD_DECEL, OFF_ROAD_MAX, CENTRIFUGAL_FORCE,
  TOTAL_CARS, STAGE_TIME, CAMERA_HEIGHT, CAMERA_DEPTH,
} from './constants.js';
import { clamp, randomInt, randomChoice, overlap } from './utils.js';
import { buildRoad, findSegment, trackLength, addSpritesToSegments, addCarsToRoad } from './road.js';
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
    gameState: 'title', // title | countdown | playing | fork | gameover
    countdown: 3,
    theme: trackDef.theme || 'beach',
    skyOffset: 0,
    bgOffset: 0,
    hillOffset: 0,
    cars: [],
    forkTimer: 0,
    forkChoice: null,
    trackDef,
  };

  function init() {
    state.segments = buildRoad(trackDef.definition);
    if (trackDef.sprites) {
      addSpritesToSegments(state.segments, trackDef.sprites);
    }
    initCars();
  }

  function initCars() {
    state.cars = [];
    const total = trackLength(state.segments);
    for (let i = 0; i < TOTAL_CARS; i++) {
      state.cars.push({
        offset: -0.8 + Math.random() * 1.6,
        z: Math.random() * total,
        speed: MAX_SPEED * (0.2 + Math.random() * 0.5),
        color: randomChoice(CAR_COLORS),
      });
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
    // Keep the road scrolling slowly for ambiance
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

    // Steering
    const steerDir = input.steerDirection();
    state.steer = steerDir;

    if (steerDir !== 0) {
      state.playerX += steerDir * dt * 2 * (state.speed / MAX_SPEED);
    }

    // Centrifugal force from curves
    if (seg) {
      state.playerX -= (seg.curve * CENTRIFUGAL_FORCE * dt * state.speed / MAX_SPEED);
    }

    state.playerX = clamp(state.playerX, -2.5, 2.5);

    // Acceleration / braking
    if (input.isAccelerating()) {
      state.speed += ACCEL * dt;
    } else if (input.isBraking()) {
      state.speed += BRAKE_DECEL * dt;
    } else {
      state.speed += NATURAL_DECEL * dt;
    }

    // Off-road slowdown
    if (Math.abs(state.playerX) > 1.0) {
      state.speed += OFF_ROAD_DECEL * dt;
      if (state.speed > OFF_ROAD_MAX) {
        state.speed = Math.max(OFF_ROAD_MAX, state.speed + OFF_ROAD_DECEL * dt * 2);
      }
    }

    state.speed = clamp(state.speed, 0, MAX_SPEED);

    // Position advance
    state.position += state.speed * dt;

    // Parallax scrolling
    state.skyOffset += (steerDir * state.speed / MAX_SPEED) * dt * 80;
    state.bgOffset += (steerDir * state.speed / MAX_SPEED) * dt * 160;
    state.hillOffset += (steerDir * state.speed / MAX_SPEED) * dt * 240;

    // Collision with roadside sprites
    if (seg && seg.sprite && Math.abs(state.playerX) > 0.65) {
      const spriteW = getSpriteWidth(seg.sprite.type) / ROAD_WIDTH;
      const spritePos = seg.sprite.offset;
      if (overlap(state.playerX, 0.4, spritePos, spriteW * 2, 1.0)) {
        state.speed = Math.max(0, state.speed * 0.2);
      }
    }

    // Collision with AI cars
    for (const car of state.cars) {
      const carSeg = findSegment(state.segments, car.z);
      if (carSeg && seg && Math.abs(car.z - state.position) < SEGMENT_LENGTH * 3) {
        if (overlap(state.playerX, 0.4, car.offset, 0.4, 0.8)) {
          if (state.speed > car.speed) {
            state.speed = car.speed * 0.7;
          }
        }
      }
    }

    // Update AI cars
    updateCars(dt, total);

    // Time countdown
    state.time -= dt;
    if (state.time <= 0) {
      state.time = 0;
      state.gameState = 'gameover';
    }

    // Check for fork / end of track
    if (state.position >= total * 0.92) {
      const forkSeg = findSegment(state.segments, state.position);
      if (forkSeg && forkSeg.fork) {
        state.gameState = 'fork';
        state.forkTimer = 0;
      }
    }

    // Wrap around for continuous play (won't happen if fork triggers)
    if (state.position >= total) {
      state.position -= total;
    }

    addCarsToRoad(state.segments, state.cars);
  }

  function updateCars(dt, total) {
    for (const car of state.cars) {
      car.z += car.speed * dt;
      if (car.z >= total) car.z -= total;
      if (car.z < 0) car.z += total;

      // Simple lane drifting
      car.offset += (Math.sin(car.z * 0.001) * 0.002);
      car.offset = clamp(car.offset, -0.9, 0.9);
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

      // Advance to next stage
      state.stage += 1;
      state.time += STAGE_TIME;
      state.position = 0;
      state.speed = MAX_SPEED * 0.3;
      state.forkTimer = 0;
      state.forkChoice = null;
      state.gameState = 'playing';

      // In the future, this would load a different track.
      // For now, just re-init the same track with shuffled cars.
      initCars();
      addCarsToRoad(state.segments, state.cars);
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
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap at 50ms
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

  function getState() {
    return state;
  }

  return { start, stop, reset, getState };
}
