# Photorealistic Visualization System - Complete Overhaul

## What Changed

The visualization system has been completely rebuilt to generate **high-quality, varied photorealistic renders** for every view.

## Key Improvements

### 1. **Randomized Sky Atmospheres** (8 Different Presets)
Each render now uses a different photorealistic sky condition:

- **Midday Clear** - Crisp blue sky, bright sunlight
- **Morning Golden** - Warm golden-hour sunrise atmosphere
- **Afternoon Warm** - Soft warm afternoon light
- **Crisp Morning** - Sharp blue sky with high contrast
- **Late Afternoon** - Golden sunset tones
- **Bright Overcast** - Soft diffused light, cloudy day
- **Perfect Blue** - Magazine-quality clear blue sky
- **Soft Daylight** - Gentle balanced daylight

Every time you generate renders, a different sky is randomly selected.

### 2. **Dynamic Lighting System**
- Sun position varies based on sky preset (morning sun vs afternoon sun)
- Light intensity matched to atmosphere (bright sun vs overcast)
- Proper color temperature (warm golden vs cool blue)
- Randomized sun angles for variety

### 3. **Enhanced Photorealistic Materials**
All materials upgraded with physically-based rendering (PBR):

- **Walls**: Smooth with subtle clearcoat (roughness 0.35)
- **Rooms**: Premium finish with clearcoat (roughness 0.22)
- **Pool Water**: Ultra-realistic transmission (95%), proper IOR 1.33
- **Roof**: Metallic sheen (18% metalness) with texture
- **Glass**: High transmission (95%), minimal roughness (0.02)
- **Balconies**: Clearcoat finish for modern look

### 4. **12 Varied Camera Angles**
Every render shows different perspectives:

- Classic 3/4 architectural views (multiple angles)
- Dramatic low-angle shots
- Elevated overview perspectives
- Bird's-eye aerial views  
- Ultra-wide establishing shots
- Detail-focused compositions
- Ground-level dramatic angles

FOV varies from 35mm (bird's eye) to 65mm (ultra-wide drama).

### 5. **Exposure Matching**
- Each sky preset has optimized exposure (1.45 - 1.9)
- Bright conditions use higher exposure
- Overcast conditions use lower exposure
- Ensures perfect brightness in every render

## How It Works

1. **Generate Button** - Click generates FRESH renders
2. **Random Sky** - System picks 1 of 8 sky presets
3. **Matched Lighting** - Lights configured for that atmosphere
4. **Varied Cameras** - 12 different angles captured
5. **Gallery** - Shows 4-5 best views automatically

## Architecture Plan

- **Live Scene Reuse**
	- Lock the active Three.js scene, renderer state, orbit camera cache, and Fabric overlays behind `visualize.captureLiveViewport()` so we never rebuild geometry.
	- Clone materials/meshes for the offscreen renderer while keeping references back to their originals for later restoration.

- **Renderer Bootstrap**
	- Spin up a dedicated `THREE.WebGLRenderer` in the modal mirroring tone mapping, output encoding, and pixel ratio from the live viewport.
	- Share PMREM/environment maps via a lightweight cache to avoid reloading HDRIs for every capture run.

- **Camera + Projection Sync**
	- Build a `THREE.PerspectiveCamera` from `window.__proj` (position, quaternion, hybrid projection matrix, FOV, near/far) for the “Current View” render.
	- Apply screen-space pan via CSS transforms on the capture overlay so the WebGL frame and screenshot remain perfectly registered.

- **Material + Lighting Pipeline**
	- Walk the cloned scene graph and swap in the PBR presets (walls, roof, pool, glass, balconies, etc.) while persisting original materials in a lookup table.
	- Drive sun/ambient intensities, color temperature, fog, and exposure directly from the selected sky preset data.

- **Capture Flow**
	- Always capture the live orbit view first; resolve it immediately in the UI for instant feedback.
	- Reuse the same renderer/camera for queued preset shots to minimize GPU thrash, only adjusting camera transforms between captures.

- **Multi-Angle + Gallery Strategy**
	- Define 8–12 preset orbits (birds-eye, ground, drama, detail) as offsets from the live target/scene bounds.
	- Push each completed frame (data URL + metadata) through a gallery controller that decides which 4–5 angles to surface based on diversity heuristics.

- **Export & Photoreal Endpoint**
	- Package the scene hash, camera payloads, and sky/lighting metadata for `/api/photoreal/render` so the same captures can be reproduced server-side later.
	- Allow direct image download/share from the gallery once a capture completes.

## Result

**Every visualization session produces completely different, photorealistic renders** with:

✅ Varied sky atmospheres (sunny, overcast, morning, afternoon)  
✅ Dynamic sun positions and shadows  
✅ Professional architectural photography angles  
✅ High-quality PBR materials  
✅ Proper exposure for each lighting condition

## Testing

1. **Clear cache**: `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)
2. **Open**: http://localhost:8000
3. **Navigate** to Visualize tab
4. **Click "Generate"** - You'll see different sky/lighting each time!
5. **Gallery** shows 4-5 varied camera angles

## Quality Settings

- **1x (Standard)**: 2560×1440 renders
- **1.5x (High)**: 3840×2160 (4K) renders  
- **2x (Ultra)**: 4096×2304 maximum resolution

## What You Get

Each visualization generates:
- 4-5 professional architectural renders
- Different camera angles showing your design
- Photorealistic lighting and materials
- Varies with every "Generate" click

The system ensures **no two render sessions look the same** - perfect for presentations and client reviews!
