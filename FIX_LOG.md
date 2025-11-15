# Fix Log: 2D Floor Plan

Date: 2025-11-08

## Issues Addressed
- Wall tool in 2D floor plan could not create walls interactively without pressing Enter to finalize a chain.
- Zooming in 2D did not keep the world point under the cursor stationary, which made labels and controls appear to drift.

## Changes
- js/plan2d/editor-core.js
  - Wall tool now creates a wall segment on each click (from previous point to current point), with axis alignment and snapping.
  - Chain remains active for continued drawing; press Enter, double-click, or right-click to finish the chain. Esc cancels as before.
  - Auto-snap-and-join is invoked after each added segment for instant corner flush.
  - Added double-click and right-click handlers to end the ongoing chain.
- js/plan2d/editor.js
  - Mouse-centered zoom: when using the mouse wheel, the world position under the cursor remains anchored, preventing drift of labels/controls while zooming.
  - Updated the scale readout accordingly.

## Notes
- Existing keyboard shortcuts remain: Enter to finalize chain; Escape to cancel.
- Window/Door tools continue to support drag-create via mouse-down/move/up.
- No changes were required to drawing routines; they already respect the new behaviors.

## Follow-ups (optional)
- Consider a small on-screen hint for wall tool: “Click to place segments, double-click/right-click to finish, Esc to cancel.”
- Add e2e tests (Playwright/Puppeteer) for wall-drawing interactions.
