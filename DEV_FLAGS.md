# Developer Flags and Runtime Toggles

These global flags let you tweak behavior at runtime without changing code. Use them from the browser devtools console.

- window.__autoFocusOnAdd (default: false)
  - When true, the camera will automatically focus on the newly added object in 3D after creation.
  - When false (default), adds do not move or zoom the camera.

- window.__disableAutoFitOnAdd (default: false)
  - When true, prevents the 2D editor from auto-fitting the view to content during add flows, unless explicitly forced.
  - plan2dFitViewToContent respects this flag unless called with opts.force = true.

- window.GRID_SPACING (default: 1)
  - Grid snapping/search spacing used by various placement routines.
  - Affects spiral search steps when looking for free, non-overlapping spots.

- window.findNonTouchingSpot(baseRect, existingRects, gridSize)
  - Shared placement helper defined in js/core/placement.js.
  - Returns a new {x, z} that does not overlap or touch existing rectangles (inclusive AABB check) using a spiral search.
  - baseRect: { x, z, w, d }, existingRects: Array<{ x, z, w, d }>, gridSize: Number.

Notes
- Inclusive AABB means that touching edges count as a collision; objects are placed with at least a tiny gap after the search.
- To quickly re-enable legacy camera focusing behavior during debugging: set window.__autoFocusOnAdd = true and repeat the add.
