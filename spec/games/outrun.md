# OutRun Clone — Complete Sprite Atlas & Technical Specification

## Project Structure

```
src/app_sneeddao_frontend/
  public/
    outrun-player.png    <- Player/character sheet (993×773)
    outrun-scenery.png   <- Scenery/traffic sheet (1483×1478)
  src/
    game/outrun/
      constants.js   - Game constants, theme colors
      engine.js      - Game loop, state machine, physics
      input.js       - Keyboard/touch input
      render.js      - Road projection and drawing
      road.js        - Segment building, track geometry
      sprites.js     - Sprite atlas system
      tracks.js      - Track definitions and sprite generators
      utils.js       - Math utilities
    pages/
      OutRun.jsx     - React wrapper
      OutRun.css     - Styling
```

Assets served from `public/` via bare filename: `src="/outrun-player.png"`.

---

# PART 1 — COMPLETE SPRITE INVENTORY

All coordinates are `(x, y, w, h)` in pixels from top-left origin.
Coordinates marked **[coded]** are verified in `sprites.js`. Others are approximate from visual analysis and marked **[approx]**.

---

## Sheet 1: Player & Characters (`outrun-player.png` — 993×773)

This sheet contains the player's red Ferrari Testarossa, crash animation frames, overhead car views, and both passenger characters (male driver, female passenger) with extensive pose libraries.

---

### 1.1 Player Car — Rear-View Driving Sprites

These are the car-from-behind sprites used during normal gameplay, organized as a 3×3 grid encoding **turn direction** × **road slope**.

#### Row 1: Standard Driving View (currently used) **[coded]**

| Index | x | y | w | h | Turn | Slope | Notes |
|-------|-----|---|-----|-----|------|-------|-------|
| 0 | 153 | 0 | 79 | 44 | Straight | Uphill | |
| 1 | 233 | 0 | 77 | 44 | Straight | Flat | Default frame |
| 2 | 311 | 0 | 78 | 44 | Straight | Downhill | |
| 3 | 390 | 0 | 79 | 44 | Moderate R | Uphill | Flip for left |
| 4 | 471 | 0 | 79 | 44 | Moderate R | Flat | Flip for left |
| 5 | 551 | 0 | 79 | 44 | Moderate R | Downhill | Flip for left |
| 6 | 631 | 0 | 81 | 44 | Hard R | Uphill | Flip for left |
| 7 | 713 | 0 | 81 | 44 | Hard R | Flat | Flip for left |
| 8 | 795 | 0 | 81 | 44 | Hard R | Downhill | Flip for left |

Frame selection logic (steer = −1..1, slope from segment delta-Y):
- `|steer| < 0.15` → straight (frames 0–2)
- `0.15 ≤ |steer| < 0.5` → moderate turn (frames 3–5)
- `|steer| ≥ 0.5` → hard turn (frames 6–8)
- `slope > 300` → uphill (+0), `slope < −300` → downhill (+2), else flat (+1)
- `steer < 0` → horizontally flip the sprite

#### Row 2: Medium Rear View **[approx, not coded]**

| Index | x | y | w | h | Description |
|-------|-----|-----|-----|-----|-------------|
| 0 | 148 | 48 | 83 | 48 | Straight / slight variants |
| 1 | 232 | 48 | 82 | 48 | |
| 2 | 315 | 48 | 82 | 48 | |
| 3 | 398 | 48 | 83 | 48 | Moderate turn variants |
| 4 | 482 | 48 | 83 | 48 | |
| 5 | 566 | 48 | 83 | 48 | |
| 6 | 650 | 48 | 85 | 48 | Hard turn variants |
| 7 | 736 | 48 | 85 | 48 | |
| 8 | 822 | 48 | 85 | 48 | |

Potential use: higher-detail driving view, or mid-distance rendering.

#### Row 3: Large Rear / 3/4 View **[approx, not coded]**

| Index | x | y | w | h | Description |
|-------|-----|------|------|-----|-------------|
| 0 | 0 | 98 | 100 | 52 | 3/4 rear left |
| 1 | 102 | 98 | 100 | 52 | Rear left |
| 2 | 204 | 98 | 95 | 52 | Slight left |
| 3 | 300 | 98 | 95 | 52 | Center |
| 4 | 397 | 98 | 95 | 52 | Slight right |
| 5 | 494 | 98 | 100 | 52 | Rear right |
| 6 | 596 | 98 | 100 | 52 | 3/4 rear right |
| 7 | 698 | 98 | 105 | 52 | Full side (wide) |
| 8 | 805 | 98 | 105 | 52 | Full side mirror |

Potential use: close-up car view, replay camera, or title screen.

#### Row 4: Convertible / Open-Top Detail **[approx, not coded]**

| Index | x | y | w | h | Description |
|-------|-----|------|------|-----|-------------|
| 0 | 0 | 153 | 115 | 40 | Open top, angle 1 |
| 1 | 118 | 153 | 110 | 40 | Open top, angle 2 |
| 2 | 230 | 153 | 108 | 40 | Open top, angle 3 |
| 3 | 340 | 153 | 105 | 40 | Open top, angle 4 |
| 4 | 448 | 153 | 105 | 40 | Open top, angle 5 |
| 5 | 555 | 153 | 108 | 40 | Open top, angle 6 |
| 6 | 665 | 153 | 110 | 40 | Open top, angle 7 |
| 7 | 778 | 153 | 115 | 40 | Open top, angle 8 |

These show the cockpit/interior visible — driver and passenger heads peek above the windshield. Potential use: stopped/idle animation, finish line scene.

---

### 1.2 Player Car — Crash / Tumble Sprites **[coded]**

7 frames showing the car rotating through a crash tumble. Selected by normalized rotation angle.

| Index | x | y | w | h | Description |
|-------|-----|------|------|-----|-------------|
| 0 | 0 | 198 | 143 | 72 | Side view, left |
| 1 | 144 | 180 | 144 | 90 | Flipping left |
| 2 | 289 | 186 | 140 | 84 | Mid-flip |
| 3 | 430 | 232 | 140 | 48 | Underside (upside-down) |
| 4 | 571 | 200 | 140 | 80 | Flipping right |
| 5 | 712 | 192 | 140 | 78 | Top-down / late tumble |
| 6 | 853 | 180 | 140 | 90 | Side view, right |

---

### 1.3 Player Car — Overhead / Top-Down Views **[approx, not coded]**

Below the crash frames, approximately 6–7 frames showing the car from directly above at different rotation angles. Useful for minimap, enhanced crash, or special effects.

| Index | x | y | w | h | Description |
|-------|-----|------|------|------|-------------|
| 0 | 0 | 285 | 150 | 85 | Overhead, facing up-left |
| 1 | 155 | 285 | 145 | 85 | Overhead, slight rotation |
| 2 | 305 | 285 | 140 | 85 | Overhead, ~45° |
| 3 | 450 | 285 | 135 | 85 | Overhead, ~90° (side) |
| 4 | 590 | 285 | 140 | 85 | Overhead, ~135° |
| 5 | 735 | 285 | 145 | 85 | Overhead, ~180° (facing down) |
| 6 | 880 | 285 | 110 | 85 | Overhead, opposite side |

These show the car from above with the red body and visible interior (seats, steering wheel). Some frames show the body color as gray/bare metal.

---

### 1.4 Male Character (Driver) — Sprite Inventory

Brown-haired male in blue polo shirt and gray pants.

#### 1.4.A Tumble / Crash Eject Frames **[coded]**

Used when the driver is ejected during a crash. Selected by `time * 6 % length`.

| Index | x | y | w | h | Description |
|-------|-----|------|-----|-----|-------------|
| 0 | 235 | 378 | 17 | 57 | Upright, arms up |
| 1 | 270 | 377 | 49 | 63 | Tumbling left |
| 2 | 356 | 376 | 74 | 64 | Spread eagle |
| 3 | 431 | 376 | 43 | 64 | Curled mid-air |
| 4 | 475 | 376 | 75 | 64 | Tumbling right |
| 5 | 530 | 472 | 60 | 29 | Lying on ground |

#### 1.4.B Running / Action Poses **[approx, not coded]**

Region: x ≈ 130–230, y ≈ 370–440

| Index | x | y | w | h | Description |
|-------|-----|------|-----|-----|-------------|
| 0 | 130 | 372 | 25 | 60 | Running stride 1 |
| 1 | 156 | 372 | 30 | 60 | Running stride 2 |
| 2 | 188 | 372 | 22 | 60 | Running stride 3 |
| 3 | 212 | 372 | 22 | 62 | Running stride 4 |

Potential use: walking cycle for title screen or celebration.

#### 1.4.C Standing Poses — Front-Facing Row **[approx, not coded]**

Region: x ≈ 250–700, y ≈ 445–510. A long row of ~25 standing male figures facing the viewer in various poses.

| Sub-region | x | y | w | h | Count | Description |
|------------|-----|------|------|------|-------|-------------|
| Idle variants | 250 | 445 | ~500 | 55 | ~20 | Standing, arms at sides / hands on hips / arms crossed |
| Gesture left | 250 | 445 | 22 | 55 | 1 | Pointing left |
| Arms up | ~450 | 445 | 22 | 55 | 1 | Both arms raised |
| Finger wag | ~500 | 445 | 25 | 55 | 2-3 | Wagging finger (scolding) |

Individual frame widths: 18–28px each, packed tightly.
Potential use: expanded finger-wag, victory celebration, idle animation.

#### 1.4.D Ground / Collapse Poses **[approx, not coded]**

Region: x ≈ 500–700, y ≈ 470–520

| Index | x | y | w | h | Description |
|-------|-----|------|-----|-----|-------------|
| 0 | 500 | 475 | 50 | 30 | Lying face-down |
| 1 | 555 | 475 | 55 | 30 | Lying face-up |
| 2 | 615 | 475 | 45 | 35 | Propped on elbow |
| 3 | 665 | 475 | 40 | 30 | Sitting dazed |

Potential use: post-crash settled scene, game-over animation.

#### 1.4.E Additional Standing Row **[approx, not coded]**

Region: x ≈ 120–750, y ≈ 510–570. A second row of standing figures, possibly different angles (back view, 3/4 view).

| Sub-region | x | y | w | h | Count | Description |
|------------|-----|------|------|------|-------|-------------|
| Back views | 120 | 510 | ~250 | 55 | ~12 | Rear-facing standing poses |
| Side views | 375 | 510 | ~200 | 55 | ~10 | Profile standing poses |
| 3/4 views | 580 | 510 | ~170 | 55 | ~8 | Angled standing poses |

---

### 1.5 Female Character (Passenger) — Sprite Inventory

Blonde woman in purple/pink top and pink/magenta skirt.

#### 1.5.A Tumble / Crash Eject Frames **[coded]**

| Index | x | y | w | h | Description |
|-------|-----|------|-----|-----|-------------|
| 0 | 300 | 585 | 23 | 30 | Upright / thrown |
| 1 | 382 | 589 | 23 | 26 | Tumbling |
| 2 | 406 | 578 | 18 | 37 | Spinning |
| 3 | 425 | 578 | 30 | 37 | Spread out |

#### 1.5.B Finger-Wag Scene Frames **[coded]**

Shows both characters together — used when player bumps obstacles at low speed.

| Index | x | y | w | h | Description |
|-------|-----|------|-----|-----|-------------|
| 0 | 300 | 615 | 19 | 55 | Both standing, start |
| 1 | 320 | 615 | 23 | 55 | Girl turns |
| 2 | 344 | 615 | 55 | 55 | Both face player, arms down |
| 3 | 400 | 615 | 52 | 55 | Girl points/wags finger |
| 4 | 453 | 615 | 49 | 55 | Continued wag |
| 5 | 503 | 615 | 43 | 55 | Return to standing |

#### 1.5.C Standing Poses — Front-Facing Row **[approx, not coded]**

Region: x ≈ 150–750, y ≈ 630–700. Long row of ~25–30 standing female figures in various poses.

| Sub-region | x | y | w | h | Count | Description |
|------------|-----|------|------|------|-------|-------------|
| Idle variants | 150 | 635 | ~500 | 60 | ~20 | Standing, hands on hips / waving / arms crossed |
| Dance/cheer | 500 | 635 | ~200 | 60 | ~8 | Arms up, jumping, celebration |

Individual frame widths: 18–30px each.
Potential use: stage-clear celebration, title screen idle.

#### 1.5.D Action / Tumble Extended **[approx, not coded]**

Region: x ≈ 130–400, y ≈ 578–635. Additional tumble and transition frames beyond the 4 currently coded.

Approximately 10–15 additional frames showing intermediate tumble poses, getting up, and dusting off.

#### 1.5.E Ground / Sitting Poses **[approx, not coded]**

Region: x ≈ 500–700, y ≈ 700–740

| Index | x | y | w | h | Description |
|-------|-----|------|-----|-----|-------------|
| 0 | 500 | 705 | 30 | 30 | Sitting on ground |
| 1 | 535 | 705 | 35 | 30 | Collapsed |

---

### 1.6 Head Overlay Sprites **[coded]**

Tiny heads drawn on top of the car body during normal driving.

| Name | x | y | w | h | Description |
|------|-----|------|-----|-----|-------------|
| DRIVER_HEAD | 425 | 739 | 11 | 12 | Male driver, brown hair |
| BLONDE_HEAD | 478 | 738 | 13 | 13 | Female passenger, blonde |

#### Additional Tiny Sprites **[approx, not coded]**

Region: x ≈ 400–550, y ≈ 735–770. Several more tiny sprites exist near the heads:

| Index | x | y | w | h | Description |
|-------|-----|------|-----|-----|-------------|
| 0 | 400 | 739 | 12 | 12 | Head variant (different angle) |
| 1 | 445 | 739 | 11 | 12 | Head looking left |
| 2 | 460 | 739 | 14 | 13 | Head looking right |
| 3 | 500 | 738 | 13 | 13 | Blonde variant 2 |
| 4 | 520 | 738 | 12 | 14 | Hair blown back |

Potential use: passenger heads that react to steering direction.

---

## Sheet 2: Scenery & Traffic (`outrun-scenery.png` — 1483×1478)

This sheet contains all roadside scenery objects, billboards, and traffic car sprites.

---

### 2.1 Trees

| Name | x | y | w | h | Status | Description |
|------|-----|------|------|------|--------|-------------|
| palm_tree | 1 | 1 | 215 | 535 | **[coded]** | Tall palm tree, curved trunk, coconuts at top |
| green_tree | 621 | 1 | 360 | 360 | **[coded]** | Large deciduous green tree, full canopy |
| autumn_tree | 1221 | 54 | 230 | 242 | **[coded]** | Autumn tree with sparse brown/pink blossoms |
| dead_tree | 1201 | 486 | 143 | 250 | **[coded]** | Bare dead tree, no leaves, twisted branches |
| small_tree | 21 | 551 | 88 | 330 | **[coded]** | Thin bare trunk with sparse branches, tall |
| palm_tree2 | 6 | 1093 | 235 | 155 | **[coded]** | Short palm/fern variant, low and bushy |

#### Tree Reuse Aliases (in code)
- `pine_tree` → maps to `green_tree`
- `dead_tree_bare` → maps to `dead_tree`

---

### 2.2 Billboards & Signs

| Name | x | y | w | h | Status | Description |
|------|-----|------|------|------|--------|-------------|
| billboard1 | 231 | 4 | 375 | 262 | **[coded]** | "SNAKES" — billboard with map graphic and text |
| billboard2 | 621 | 371 | 295 | 168 | **[coded]** | "Diving School Captains" — blue whale logo |
| billboard3 | 1201 | 306 | 268 | 168 | **[coded]** | "BIFIN" — brown/orange sign |
| billboard5 | 148 | 553 | 322 | 280 | **[coded]** | "NeoAuto" — orange, social media icons, large |
| billboard6 | 484 | 551 | 283 | 190 | **[coded]** | "NeoAuto.pe" — simpler white/orange variant |
| billboard7 | 1 | 893 | 286 | 190 | **[coded]** | "LimAutos" — blue text on white billboard |
| billboard8 | 309 | 893 | 283 | 190 | **[coded]** | "Fire Wheels" — red logo on white billboard |
| sega_sign | 1001 | 326 | 160 | 135 | **[coded]** | SEGA arcade logo (blue scaffold structure) |
| sign_easel | 1 | 1258 | 230 | 220 | **[coded]** | Wooden easel sign, "RIM" branding, cyclist art |
| sign_round | 241 | 1258 | 215 | 220 | **[coded]** | Round decorative sign, "Ocean Party" fish art |

Billboard rotation cycle in code: `billboard1 → billboard2 → billboard3 → billboard5 → billboard6 → billboard7 → billboard8` (skips sega_sign).

---

### 2.3 Rocks, Cliffs & Terrain

| Name | x | y | w | h | Status | Description |
|------|-----|------|------|------|--------|-------------|
| cliff | 231 | 276 | 308 | 210 | **[coded]** | Tall rock cliff face, brown/tan layered |
| rocks | 1201 | 756 | 168 | 241 | **[coded]** | Medium rock cluster, mossy |
| rock_large | 617 | 893 | 296 | 140 | **[coded]** | Wide low rock formation with vegetation |
| cactus | 928 | 893 | 227 | 113 | **[coded]** | Desert plants / prickly pear with small bushes |

#### Uncatalogued Terrain **[approx, not coded]**

| Name | x | y | w | h | Description |
|------|------|------|------|------|-------------|
| tree_stump | 830 | 295 | 75 | 55 | Small tree stump / broken trunk piece |
| rock_boulder | 1200 | 900 | 160 | 140 | Large standalone boulder, gray |

---

### 2.4 Bushes & Vegetation

| Name | x | y | w | h | Status | Description |
|------|------|------|------|------|--------|-------------|
| bush | 1365 | 486 | 118 | 144 | **[coded]** | Small green bush/shrub |
| bush_flower | 251 | 1093 | 232 | 148 | **[coded]** | Flowering bush, pink/magenta blooms |

---

### 2.5 Structures

| Name | x | y | w | h | Status | Description |
|------|-----|------|------|------|--------|-------------|
| tower | 994 | 1 | 190 | 308 | **[coded]** | Stone castle tower, crenellated top |

---

### 2.6 Traffic Vehicles (from scenery sheet, right side)

Rear-view vehicle sprites for AI traffic. Includes passenger cars, a truck, and a flatbed.

#### Passenger Cars **[coded]**

| Index | Name | x | y | w | h | Hex Color | Status | Description |
|-------|------|------|------|-----|-----|-----------|--------|-------------|
| 0 | car_red1 | 994 | 476 | 77 | 41 | #821f1b | **[coded]** | Red sports car, rear view |
| 1 | car_red2 | 1082 | 476 | 78 | 41 | #84201a | **[coded]** | Red car variant (slightly different) |
| 2 | car_red3 | 991 | 527 | 77 | 41 | #822019 | **[coded]** | Red car variant |
| 3 | car_pink | 1381 | 756 | 86 | 55 | #a56470 | **[coded]** | Pink/white sedan |
| 4 | car_blue1 | 1379 | 821 | 80 | 59 | #3e569e | **[coded]** | Blue car, taller profile |
| 5 | car_brown | 1381 | 890 | 78 | 57 | #5b433a | **[coded]** | Brown/dark SUV-type |
| 6 | car_red4 | 1379 | 957 | 80 | 45 | #821c17 | **[coded]** | Red car, low profile |
| 7 | car_blue2 | 1201 | 1014 | 80 | 56 | #354269 | **[coded]** | Dark blue car |
| 8 | car_red5 | 1291 | 1014 | 80 | 45 | #7f1a15 | **[coded]** | Red car variant |
| 9 | car_red6 | 1381 | 1014 | 80 | 45 | #821c18 | **[coded]** | Red car variant |

#### Truck & Flatbed **[approx, not coded]**

Located on the right edge between the bush (y~630) and the pink car (y:756). These are larger/taller than the passenger cars and would make great slow-moving traffic obstacles.

| Name | x | y | w | h | Hex Color | Description |
|------|------|------|-----|-----|-----------|-------------|
| truck | 1375 | 640 | 88 | 58 | #7B6B4A | Brown/tan delivery truck, boxy rear, taller than cars. Visible tailgate and cargo body. |
| flatbed | 1375 | 702 | 88 | 52 | #4A7A3A | Green flatbed / utility vehicle (Jeep-style). Boxy cab with open cargo bed. Olive/army green. |

Potential use: slow-moving traffic that's harder to pass (wider hitbox, visually distinct). The truck could move at 0.2–0.3× MAX_SPEED and the flatbed at 0.25–0.35× MAX_SPEED for variety.

#### Small Detail Cars (near SEGA sign) **[approx, not coded]**

| Index | x | y | w | h | Description |
|-------|------|------|-----|-----|-------------|
| 0 | 1120 | 356 | 35 | 25 | Tiny red car (thumbnail) |
| 1 | 1160 | 356 | 35 | 25 | Tiny yellow car |
| 2 | 1120 | 384 | 35 | 25 | Tiny red car (different angle) |

These tiny cars appear near the SEGA sign and could be used for minimap or distant traffic.

---

## Summary: Coded vs Available

### Currently Coded (66 sprite regions total)

| Category | Count | Source Sheet |
|----------|-------|-------------|
| Player rear-view frames | 9 | player |
| Crash tumble frames | 7 | player |
| Male tumble frames | 6 | player |
| Female tumble frames | 4 | player |
| Finger-wag frames | 6 | player |
| Head overlays | 2 | player |
| Scenery objects | 22 | scenery |
| Traffic cars | 10 | scenery |

### Available But Not Coded (~150+ additional sprites)

| Category | Est. Count | Sheet | Potential Use |
|----------|-----------|-------|---------------|
| Car rear-view Row 2 (medium) | 9 | player | Higher-detail driving, close camera |
| Car rear-view Row 3 (large) | 9 | player | Close-up, replay, title screen |
| Convertible detail views | 8 | player | Idle, finish line, cutscenes |
| Overhead car views | 7 | player | Minimap, crash top-view, effects |
| Male running cycle | 4 | player | Title screen, walk animation |
| Male standing poses | ~30 | player | Celebration, idle, expanded finger-wag |
| Male ground poses | 4 | player | Post-crash scene |
| Female standing poses | ~25 | player | Celebration, idle, expanded scenes |
| Female extended tumble | ~12 | player | More crash variety |
| Female ground poses | 2 | player | Post-crash scene |
| Head variants | ~5 | player | Reactive passenger heads |
| Truck (brown) | 1 | scenery | Slow-moving traffic, wider hitbox |
| Flatbed (green) | 1 | scenery | Slow-moving traffic, visually distinct |
| Tree stump | 1 | scenery | Additional road-side variety |
| Rock boulder | 1 | scenery | Additional obstacle |
| Tiny detail cars | 3 | scenery | Minimap or far-distance traffic |

---

# PART 2 — TECHNICAL SPECIFICATION

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
    playerSheet.onerror = check;
    scenerySheet.onerror = check;
    playerSheet.src = '/outrun-player.png';
    scenerySheet.src = '/outrun-scenery.png';
  });
}
```

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

Same technique as the original OutRun arcade hardware.

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

  drawSegmentStrip(prev, seg, fogBands[fogIdx])
  maxY = screenY
```

### Key Constants

- `CURVE_SCALE`: Controls curve displacement. Currently `80`.
- `CAMERA_DEPTH = 1/tan(FOV/2 * PI/180)` with FOV=100 gives ~0.839
- No damping factor

### Parallax Background

Procedural backgrounds (sky gradient + sin-wave mountains + hills).
Driven by both steering AND road curvature:

```js
if (seg) {
  const curveFactor = seg.curve * state.speed / MAX_SPEED;
  state.skyOffset  -= curveFactor * dt * 40;
  state.bgOffset   -= curveFactor * dt * 80;
  state.hillOffset -= curveFactor * dt * 120;
}
```

### Sprite Rendering Order

1. Forward pass (n=0 to DRAW_DISTANCE): project segments, draw road strips, collect sprites
2. Reverse pass (spriteCount-1 down to 0): draw sprites far-to-near
3. Clip sprites extending above segment maxY using `ctx.clip()`

---

## 3. Constants (constants.js)

| Constant | Value | Notes |
|----------|-------|-------|
| CANVAS_WIDTH | 640 | |
| CANVAS_HEIGHT | 480 | |
| FOV | 100 | Wide, arcade-like |
| CAMERA_HEIGHT | 1000 | Lower = more road visible |
| DRAW_DISTANCE | 200 | Segments rendered ahead |
| SEGMENT_LENGTH | 200 | World-units per segment |
| ROAD_WIDTH | 2000 | Half-width in world units |
| LANE_COUNT | 4 | 2 lanes each direction |
| MAX_SPEED | SEG×70 | |
| CENTRIFUGAL_FORCE | 0.10 | Push on curves |
| STAGE_TIME | 80 | Seconds per stage |
| CURVE_SCALE | 80 | Curve displacement multiplier |
| FOG_DENSITY | 5 | Exponential fog |

---

## 4. Engine Integration (engine.js)

### Traffic Car Color Index

```js
state.cars.push({
  offset, z, speed,
  color: CAR_COLORS[i % CAR_COLORS.length],
  colorIndex: i % TRAFFIC_CAR_COUNT,
});
```

### Centrifugal Force

Squared speed ratio for arcade feel:
```js
const speedRatio = state.speed / MAX_SPEED;
state.playerX -= seg.curve * CENTRIFUGAL_FORCE * dt * speedRatio * speedRatio;
```

---

## 5. Track Sprite Types (tracks.js)

### Available Types

```
PALM_TREE, PINE_TREE, BUSH, ROCK, SIGN_RIGHT, SIGN_LEFT,
COLUMN, CACTUS, DEAD_TREE, BILLBOARD, GREEN_TREE, TOWER,
AUTUMN_TREE, PALM_TREE2, BUSH_FLOWER, ROCK_LARGE, CLIFF, DEAD_TREE_BARE
```

### Theme-Specific Sprite Suggestions

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| Beach | palm_tree, palm_tree2 | bush, bush_flower | billboard variants |
| Desert | cactus, rock_large | dead_tree, cliff | sign_easel |
| Forest | green_tree, autumn_tree | bush_flower, tower | billboard variants |
| Night | tower, dead_tree | column (small_tree) | sign_round |

---

## 6. What's NOT Changing

- `input.js` — Keyboard + touch, works perfectly
- `utils.js` — All utility functions (clamp, lerp, exponentialFog, overlap, project)
- `OutRun.jsx` — React wrapper
- `OutRun.css` — Styling including scanlines, fullscreen, responsive
- Game state machine — title/countdown/playing/fork/crash/gameover
- Fork system — road widening + split rendering
- Theme blending — transition between themes
- HUD — speed gauge, timer, stage display (procedural)
- Title/countdown/gameover overlays (procedural)

---

## 7. Performance Notes

- `ctx.drawImage()` 9-arg atlas rendering is GPU-accelerated
- Sprite pool pre-allocation prevents GC pressure
- Fog band caching avoids per-frame color blending
- Sky gradient caching avoids per-frame gradient creation
- At 640×480 with ~200 segments and ~30 sprites per frame, 60fps is trivially achievable
