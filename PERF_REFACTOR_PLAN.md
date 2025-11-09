# 2D Plan Performance Refactor – Phase: Dirty Rect + Instrumentation

## Overview
The 2D floor plan renderer previously performed full-canvas redraws on nearly every interaction (dragging walls, guides, openings). We introduced:

- Dirty rectangle incremental clears (editor-core sets `__plan2d.dirtyRect` + `__incremental`).
- Per-frame instrumentation counters in `draw.js` to reveal hotspots and quantify savings.
- Dynamic label/measurement throttling based on element count and recent frame time.
- Rolling exponential moving averages (EMA) for frame time and dirty pixel percentage.
- Extended perf HUD toggle (future key binding) to show deeper metrics.

## Instrumentation Metrics
Captured each frame in `__plan2d.__frameProfile`:
- wallsConsidered / wallsSkipped
- openingsConsidered / openingsSkipped
- wallSegments (post span merge)
- measureNew / measureHit (text width cache effectiveness)
- labelTexts (drawn measurement/length labels)
- dirtyPixelPct, dirtyPixelArea, dirtyWorldArea

HUD also displays (extended mode):
- avg ms (EMA of total frame) and avg dirty %
- measurement budget (adaptive) and skipped element counts

Periodic console log every 60 frames: `[2D PROF] { frame, ms, dirtyPct, wallSegs, measNew, measHit, labels, grid, walls, overlay, total }`.

## Dirty Rectangle Behavior
Dirty region merges bounding boxes for:
- Wall endpoint drags (previous + new endpoint + opposite endpoint, padded by thickness).
- Window/door endpoint drags (previous span endpoints + new span endpoints, padded).
- Guide drags (thin column/row at guide position).
Panning resets dirty (forces full redraw next frame).

Renderer uses dirty rect to limit clear and grid draw slice, and skips walls/openings whose padded AABB lie completely outside `dirtyRect`.

## Early Observations (Example Targets)
| Scenario | Full Redraw ms | Incremental ms | Dirty % | Notes |
|----------|----------------|----------------|---------|-------|
| Wall endpoint drag (single wall move) | ~12.0 | ~5.5 | 8–12% | Savings mainly from skipping unaffected walls & labels. |
| Guide drag on dense plan (~500 walls) | ~14.5 | ~7.2 | 6–9% | Majority of cost avoided for walls/outside slice. |
| Opening resize (window drag) | ~13.0 | ~8.0 | 10–15% | Text label measurement minimal. |

(*Numbers illustrative—replace with real console snapshot values after profiling session*)

## Measurement Budget Strategy
`__measureLimit` adjusts per frame:
- Base 200 labels.
- If elements > 400: reduce to 140; > 800: reduce to 100.
- If previous frame time > 18ms: clamp to <=120.
This keeps text layout cost bounded under heavy scenes or transient slow frames.

## Next Optimization Opportunities
1. Segment Label Culling: Hide length labels below a zoom threshold or if segment pixel length < threshold to reduce measureNew churn.
2. Pre-baked Font Metrics: Cache `measureText` widths for common lengths at load (e.g., rounding to 0.05m) to boost hit ratio.
3. (DONE) Opening Span Preprocessing: Per-wall host opening spans cached per version + free opening pass; removes O(W*E) scan.
4. Grid Slice Refinement: During dirty frames, draw grid only columns/rows crossing dirty rect rather than sub-image draw (micro-optimization).
5. Dirty Region Compaction: Track multiple disjoint dirty boxes and only union when overlap—reduces over-clearing after many small edits.
6. Adaptive Wall Segment Drawing: When wallSegments > N (e.g. 600), temporarily drop inline segment length labels.

## Validation Plan
1. Capture baseline (pre-dirty) average frame ms over 300 frames idle drag scenario.
2. Enable dirty rect, repeat drag scenarios, record improvements.
3. Adjust measurement budget thresholds; confirm no visible label popping and improved average ms.
4. Implement one next optimization (likely opening span preprocessing) and re-measure.

## How to capture real metrics
- Enable HUD (press P) and, for extended stats, press Shift+P.
- While interacting (dragging a wall, guide, or opening), the console will emit a `[2D PROF]` log every ~60 frames with breakdowns.
- For programmatic summaries, inspect `window.__plan2d.__perfSamples` in DevTools. It's a rolling buffer of recent samples (ms, dirty %, segments, skips).
- You can also compute quick aggregates:
  - Average ms: `avg = __plan2d.__perfSamples.reduce((a,s)=>a+s.ms,0)/__plan2d.__perfSamples.length`
  - Average dirty %: similar using `s.dirtyPct`.

## Rollout & Fallback
Instrumentation is non-invasive; if any regression observed, toggle `perfHUD` or temporarily disable incremental drawing by clearing `__plan2d.__incremental` flags in editor-core (one-line change). No structural dependency on dirty rect for correctness—only performance.

## Action Items
- [ ] Gather real metrics & replace illustrative table.
- [ ] Add extended HUD toggle key (e.g. Shift+P) to switch `perfHUDExt`.
- [x] Implement opening span preprocessing.
- [ ] Implement label zoom threshold culling.
- [ ] Update this file with before/after data.

---
Last updated: {{DATE}}
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
