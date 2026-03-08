# OutRun Clone - Technical Specification

## Project Structure

```
src/app_sneeddao_frontend/
  public/
    outrun-player.png    <- copy of resources/games/outrun/104648.png (993x773)
    outrun-scenery.png   <- copy of resources/games/outrun/NicePng_bien-png_7723679.png (1483x1478)
  src/
    game/outrun/
      constants.js   - Game constants, theme colors
      engine.js      - Game loop, state machine, physics
      input.js       - Keyboard/touch input (unchanged)
      render.js      - Road projection and drawing
      road.js        - Segment building, track geometry
      sprites.js     - Sprite atlas system
      tracks.js      - Track definitions and sprite generators
      utils.js       - Math utilities (unchanged)
    pages/
      OutRun.jsx     - React wrapper (unchanged)
      OutRun.css     - Styling (unchanged)
```

Assets are served from `public/` via bare filename: `src="/outrun-player.png"`.

---

## 1. Sprite Atlas System (sprites.js)

### Image Loading

```js
const playerSheet = new Image();
const scenerySheet = new Image();
let sheetsLoaded = false;

export function loadSpriteSheets() {
  return new Promise((resolve) => {
    let loaded = 0;
    const check = () => { if (++loaded >= 2) { sheetsLoaded = true; resolve(); } };
    playerSheet.onload = check;
    scenerySheet.onload = check;
    playerSheet.onerror = check;  // graceful fallback
    scenerySheet.onerror = check;
    playerSheet.src = '/outrun-player.png';
    scenerySheet.src = '/outrun-scenery.png';
  });
}
```

### Player Car Sprite Coordinates (104648.png, 993x773)

Row 1 - Rear view at 9 steering angles (measured via pixel analysis):

| Frame | x | y | w | h | Description |
|-------|-----|-----|-----|-----|-------------|
| 0 | 153 | 0 | 80 | 60 | Hard left |
| 1 | 233 | 3 | 78 | 57 | Left |
| 2 | 311 | 8 | 79 | 52 | Slight left |
| 3 | 390 | 0 | 80 | 60 | Straight (or slight left variant) |
| 4 | 471 | 3 | 80 | 57 | Straight center |
| 5 | 551 | 8 | 80 | 52 | Slight right |
| 6 | 631 | 0 | 82 | 60 | Right (or slight right variant) |
| 7 | 713 | 3 | 82 | 57 | Right |
| 8 | 795 | 8 | 82 | 52 | Hard right |

Frame selection by steer value:
- steer < -0.6 -> frame 0 (hard left)
- steer < -0.3 -> frame 1 (left)
- steer < -0.1 -> frame 2 (slight left)
- steer > 0.6 -> frame 8 (hard right)
- steer > 0.3 -> frame 7 (right)
- steer > 0.1 -> frame 5 (slight right)
- else -> frame 4 (straight)

Large car views (row 4, y~180-280) for crash/tumble animation:

| Frame | x | y | w | h | Description |
|-------|-----|-----|-----|-----|-------------|
| crash0 | 0 | 198 | 143 | 72 | Side view left tumble |
| crash1 | 144 | 180 | 144 | 90 | Flipping left |
| crash2 | 289 | 186 | 140 | 84 | Flipping mid |
| crash3 | 430 | 232 | 140 | 48 | Underside |
| crash4 | 571 | 200 | 140 | 80 | Flipping right |
| crash5 | 712 | 192 | 140 | 78 | Top-down / tumble |
| crash6 | 853 | 180 | 140 | 90 | Side view right |

### Scenery Sprite Coordinates (NicePng_bien-png_7723679.png, 1483x1478)

Measured bounding boxes from pixel analysis:

| Name | x | y | w | h | Description |
|------|-----|------|-----|-----|-------------|
| palm_tree | 1 | 1 | 215 | 535 | Tall palm tree |
| billboard1 | 231 | 4 | 375 | 262 | Sign with map/SNAKES |
| green_tree | 621 | 1 | 360 | 360 | Large green tree (includes trunk area) |
| tower | 994 | 1 | 190 | 308 | Stone tower/castle |
| autumn_tree | 1221 | 54 | 230 | 242 | Autumn/dead tree with leaves |
| cliff | 231 | 276 | 308 | 210 | Rock cliff face |
| billboard2 | 621 | 371 | 295 | 168 | Diving School billboard |
| sega_sign | 1001 | 326 | 160 | 135 | SEGA sign (will be replaced) |
| billboard3 | 1201 | 306 | 268 | 168 | BIFIN sign area |
| billboard4 | 634 | 439 | 270 | 85 | Additional billboard strip |
| dead_tree | 1201 | 486 | 143 | 250 | Bare dead tree |
| bush | 1365 | 486 | 118 | 144 | Bush/vegetation |
| small_tree | 21 | 551 | 88 | 330 | Small dead/bare tree |
| billboard5 | 148 | 553 | 322 | 280 | NeoAuto billboard |
| billboard6 | 484 | 551 | 283 | 190 | NeoAuto.pe billboard |
| rocks | 1201 | 756 | 168 | 241 | Large rocks |
| billboard7 | 1 | 893 | 286 | 190 | LimAutos billboard |
| billboard8 | 309 | 893 | 283 | 190 | FireWheels billboard |
| rock_large | 617 | 893 | 296 | 140 | Large rock formation |
| cactus | 928 | 893 | 227 | 113 | Cactus/prickly pear |
| palm_tree2 | 6 | 1093 | 235 | 155 | Short palm tree variant |
| tree_rock | 251 | 1093 | 232 | 148 | Tree with rock |
| sign_easel | 1 | 1258 | 230 | 220 | Sign on easel |
| sign_round | 241 | 1258 | 215 | 220 | Round sign |

### Traffic Car Sprites (from scenery sheet, right edge)

Small rear-view cars. Colors identified by average RGB:

| Name | x | y | w | h | Avg Color | Type |
|------|------|-----|-----|-----|-----------|------|
| car_red1 | 994 | 476 | 77 | 41 | (130,33,27) | Red car |
| car_red2 | 1082 | 476 | 78 | 41 | (132,32,26) | Red car variant |
| car_red3 | 991 | 527 | 77 | 41 | (130,32,25) | Red car variant |
| car_pink | 1381 | 756 | 86 | 55 | (165,100,112) | Pink/white car |
| car_blue1 | 1379 | 821 | 80 | 59 | (62,86,158) | Blue car |
| car_brown | 1381 | 890 | 78 | 57 | (91,67,58) | Brown/dark car |
| car_red4 | 1379 | 957 | 80 | 45 | (130,28,23) | Red car |
| car_blue2 | 1201 | 1014 | 80 | 56 | (53,66,105) | Blue car |
| car_red5 | 1291 | 1014 | 80 | 45 | (127,26,21) | Red car |
| car_red6 | 1381 | 1014 | 80 | 45 | (130,28,24) | Red car |

### Drawing Function

All sprites render via `ctx.drawImage()` 9-arg form:
```js
ctx.drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh);
```

Where `(dx, dy)` is computed from bottom-center positioning:
- `dx = screenX - (sw * scale) / 2`
- `dy = screenY - (sh * scale)`
- `dw = sw * scale`
- `dh = sh * scale`

Fallback when images not loaded: colored rectangle matching the sprite's dominant color.

---

## 2. Road Projection Algorithm (render.js)

### The Core Pseudo-3D Technique

This is the same technique used by the original OutRun arcade hardware.

```
Camera position: (cameraX, cameraY, cameraZ)
  cameraZ = player position along track
  cameraY = CAMERA_HEIGHT + road_Y_at_player_position
  cameraX = playerX * ROAD_WIDTH

For each segment n from 0 to DRAW_DISTANCE:
  segIndex = (baseSegment + n) % totalSegments
  seg = segments[segIndex]

  worldZ = seg.world.z + (looped ? totalLength : 0)
  relZ = worldZ - cameraZ
  if relZ <= 0: skip

  scale = CAMERA_DEPTH / relZ

  // Curve: accumulate horizontal offset
  curveOffset += seg.curve

  // Project to screen
  screenX = W/2 + scale * (-cameraX + curveOffset * CURVE_SCALE) * W/2
  screenY = H/2 - scale * (seg.world.y - cameraY) * H/2
  screenW = scale * ROAD_WIDTH * W/2

  // Hill clipping: only draw if below previous segment
  if screenY >= maxY: skip

  // Draw road strip between this segment and previous
  drawSegmentStrip(prev, seg, fogBands[fogIdx])

  // Collect sprites/cars for back-to-front pass
  maxY = screenY
```

### Key Constants for Projection

- `CURVE_SCALE`: Controls how strongly curves displace the road. Start at ~1500, tune visually.
- `CAMERA_DEPTH = 1/tan(FOV/2 * PI/180)` with FOV=100 gives ~0.839
- No damping factor (the old `dx *= 0.985` is removed)

### Curve Offset Explained

Each segment has a `curve` value (set by road.js). The accumulation works like:
```
curveOffset = sum of seg.curve for all segments from camera to this segment
```

This creates a parabolic horizontal displacement that increases with distance. Combined with perspective scale making distant things smaller, the visual result is a smooth curved road.

The player's X position (`cameraX`) acts as a counter-offset, keeping the camera centered on the player.

### Parallax Background

Keep existing procedural backgrounds (sky gradient + sin-wave mountains + hills).
Drive parallax from both steering AND road curvature:

```js
// In engine.js updatePlaying:
if (seg) {
  const curveFactor = seg.curve * state.speed / MAX_SPEED;
  state.skyOffset  -= curveFactor * dt * 40;
  state.bgOffset   -= curveFactor * dt * 80;
  state.hillOffset -= curveFactor * dt * 120;
}
```

### Segment Strip Drawing

Keep existing `drawSegmentStrip` with fog bands, rumble strips, lane markings, fork rendering. These are correct and performant.

### Sprite Rendering Order

1. Forward pass (n=0 to DRAW_DISTANCE): project segments, draw road strips, collect sprites into pool
2. Reverse pass (spriteCount-1 down to 0): draw sprites far-to-near
3. Clip sprites that extend above their segment's maxY using ctx.clip()

---

## 3. Constants Tuning (constants.js)

Changes from current values:

| Constant | Current | New | Reason |
|----------|---------|-----|--------|
| CAMERA_HEIGHT | 1500 | 1000 | Lower camera = more road visible, closer to arcade |
| DRAW_DISTANCE | 150 | 200 | More visible road ahead |
| LANE_COUNT | 6 | 4 | Original OutRun has 2 lanes each direction |
| CENTRIFUGAL_FORCE | 0.08 | 0.15 | Stronger push on curves |
| MAX_SPEED | SEG*60 | SEG*70 | Slightly faster top speed |
| STAGE_TIME | 75 | 80 | Slightly more forgiving |

Add new constants:
```js
export const CURVE_SCALE = 1500;       // curve displacement multiplier
export const PLAYER_SPRITE_SCALE = 2.0; // scale for player car sprite on screen
export const FOG_DENSITY = 5;          // exponential fog density
```

All THEMES colors remain unchanged.

---

## 4. Engine Integration (engine.js)

### Sprite Sheet Preloading

```js
import { loadSpriteSheets } from './sprites.js';

// In start():
async function start(input) {
  state._input = input;
  resetRenderCache();
  await loadSpriteSheets();
  init();
  lastTime = performance.now();
  animFrameId = requestAnimationFrame(frame);
}
```

### Traffic Car Color Index

In `initCars()`, assign `colorIndex` for sprite selection:
```js
state.cars.push({
  offset, z, speed,
  color: CAR_COLORS[i % CAR_COLORS.length],
  colorIndex: i % TRAFFIC_CAR_COUNT,
});
```

### Centrifugal Force Fix

Square the speed ratio for more arcade-like feel:
```js
const speedRatio = state.speed / MAX_SPEED;
state.playerX -= seg.curve * CENTRIFUGAL_FORCE * dt * speedRatio * speedRatio;
```

### Curve-Based Parallax

In `updatePlaying()`, after existing parallax updates:
```js
if (seg) {
  const curveFactor = seg.curve * state.speed / MAX_SPEED;
  state.skyOffset  -= curveFactor * dt * 40;
  state.bgOffset   -= curveFactor * dt * 80;
  state.hillOffset -= curveFactor * dt * 120;
}
```

---

## 5. Track Updates (tracks.js)

### New Sprite Types

Add to SPRITE_TYPES:
```
GREEN_TREE, TOWER, AUTUMN_TREE, PALM_TREE2,
BUSH_FLOWER, ROCK_LARGE, CLIFF, DEAD_TREE_BARE
```

### Billboard Rotation

The scenery sheet has 8+ billboard variants. Billboards can cycle through them:
```
billboard1 through billboard8 -> mapped in TYPE_TO_ATLAS
```

### Theme-Specific Generators

- Beach: palm_tree, palm_tree2, bush, billboard variants
- Desert: cactus, rock_large, dead_tree, cliff
- Forest: green_tree, pine_tree (=green_tree), bush, tower
- Night: tower, dead_tree, column (=small_tree), billboard variants

---

## 6. Road.js Minor Update

Add helper for robust Y lookup:
```js
export function getSegmentY(segments, z) {
  if (segments.length === 0) return 0;
  const idx = ((Math.floor(z / SEGMENT_LENGTH) % segments.length) + segments.length) % segments.length;
  return segments[idx].world.y || 0;
}
```

Everything else in road.js stays unchanged - the segment building, hill/curve generation, fork system all work correctly.

---

## 7. Performance Notes

- `ctx.drawImage()` 9-arg atlas rendering is GPU-accelerated and faster than the procedural canvas path drawing it replaces
- Sprite pool pre-allocation (already exists) prevents GC pressure
- Fog band caching (already exists) avoids per-frame color blending
- Sky gradient caching (already exists) avoids per-frame gradient creation
- At 640x480 with ~200 segments and ~30 sprites per frame, 60fps is trivially achievable

---

## 8. What's NOT Changing

- `input.js` - Works perfectly, keyboard + touch
- `utils.js` - All utility functions reused as-is (clamp, lerp, exponentialFog, overlap, project)
- `OutRun.jsx` - React wrapper is correct
- `OutRun.css` - Styling including scanlines, fullscreen, responsive is correct
- Game state machine - title/countdown/playing/fork/crash/gameover stays
- Fork system - road widening + split rendering stays
- Theme blending - transition between themes stays
- HUD - speed gauge, timer, stage display stays (keep procedural)
- Title/countdown/gameover overlays - stay procedural
