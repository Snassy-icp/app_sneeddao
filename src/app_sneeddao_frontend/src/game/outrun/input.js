export function createInput() {
  const state = {
    left: false,
    right: false,
    up: false,
    down: false,
    start: false,
    // Touch zones (set by React component)
    touchSteer: 0, // -1 to 1
    touchAccel: false,
    touchBrake: false,
  };

  const keyMap = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    KeyA: 'left',
    KeyD: 'right',
    KeyW: 'up',
    KeyS: 'down',
    Enter: 'start',
    Space: 'start',
  };

  function onKeyDown(e) {
    const action = keyMap[e.code];
    if (action) {
      state[action] = true;
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    const action = keyMap[e.code];
    if (action) {
      state[action] = false;
      e.preventDefault();
    }
  }

  function attach() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  function detach() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    state.left = false;
    state.right = false;
    state.up = false;
    state.down = false;
    state.start = false;
  }

  function isAccelerating() {
    return state.up || state.touchAccel;
  }

  function isBraking() {
    return state.down || state.touchBrake;
  }

  function steerDirection() {
    if (state.left) return -1;
    if (state.right) return 1;
    if (Math.abs(state.touchSteer) > 0.1) return state.touchSteer;
    return 0;
  }

  function isStart() {
    return state.start;
  }

  function setTouch(steer, accel, brake) {
    state.touchSteer = steer;
    state.touchAccel = accel;
    state.touchBrake = brake;
  }

  return { state, attach, detach, isAccelerating, isBraking, steerDirection, isStart, setTouch };
}
