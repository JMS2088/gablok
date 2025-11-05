# Performance and Refactor Plan

This document outlines concrete, low-risk steps to reduce initial load time and make the codebase easier to navigate and maintain without changing behavior.

## Quick wins (done)

- Removed `js/plan2d/editor.js` from the boot path (it was ~165 KB / ~3k LOC parsed at startup). The editor now loads on demand via `js/boot/loader.js` stubs (`openPlan2DModal`), with a prefetch after first paint to keep first-use latency low.
- Hardened 2D Delete keyboard handling with a global capture-phase safety net; works across multiple editor opens and prevents double-handling.

## Next refactors (recommended)

1) Split `js/plan2d/editor.js` (~3k LOC)
- Proposed modules under `js/plan2d/`:
  - `state.js` – `__plan2d` structure, drafts storage, signatures, floor management
  - `input.js` – all mouse/keyboard bindings and helpers (chain tools, drag, hover, selection, delete)
  - `draw.js` – grid, walls, labels, overlays, window/door drawing, measurements
  - `sync.js` – 2D↔3D live sync, apply scheduling, signatures, populate
  - `modal.js` – `openPlan2DModal/closePlan2DModal`, toolbar wiring, minor UI utilities
- Keep a thin `editor.js` that re-exports public APIs to preserve backwards compatibility. Migrate in small steps.

2) Split `js/input/events.js` (~50 KB / ~950 LOC)
- Proposed modules under `js/input/`:
  - `events-core.js` – canvas setup, selection, camera, drag routing
  - `events-rooms.js` – room drag/resize + 2D sync helper
  - `events-components.js` – stairs, pergola, balcony, garage, pool, roof, furniture
  - `events-keys.js` – 3D-only keyboard shortcuts (guarded when 2D is active)
- This will make individual behaviors easier to reason about and test.

3) Loader tightening
- Keep heavy optional modules out of the boot list. Rely on `boot/loader.js` stubs and `prefetch()` after first paint.
- Consider grouping optional renderers into a tiny registry to avoid multiple small network requests (leave for later; current stubs are fine in dev).

4) Testing & diagnostics
- Keep the in-browser smoke tests (`js/smoke/smoke2d.js`) for fast functional checks.
- Add a very small `js/smoke/bootstrap.js` to verify module ordering and basic app start in CI (optional).

## Acceptance criteria
- Start page loads and renders 3D canvas without 2D editor parse cost.
- Opening the 2D editor still works immediately (prefetch helps). Delete works reliably after any number of open/close cycles.
- No behavior changes in drawing or applying to 3D.

## Rollout plan
- Land lazy-load (done) and validate. Then split `editor.js` into `state.js` + `draw.js` first (low risk), wire them through `editor.js` barrel exports. Next, move input handlers into `input.js`, then `sync.js`, then `modal.js`.
- After each step, run smoke tests and manual Delete/Apply checks.
