# Window Rendering Debug Guide

## Changes Made

### 1. Fixed `openingsForEdge` in wallStrips.js
- Changed from `sillM:(op.sillM||0)` to proper type checking
- Now uses defaults: 0.9m sill for windows, 0 for doors
- Now uses defaults: 1.5m height for windows, 2.04m for doors

### 2. Fixed window rendering in engine3d.js  
- Removed hardcoded `oHWin = 1.5` override
- Now uses actual `y0` and `y1` computed from opening data
- Increased glass opacity to 75%
- Enhanced door visibility (40% fill, 80% stroke)

### 3. Updated cache-busting versions
- wallStrips.js: v=20251121-3
- engine3d.js: v=20251121-3

## How to Test

1. **Hard refresh browser**: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)

2. **Enable debug logging** in browser console:
   ```javascript
   window.__debugOpenings = true;
   ```

3. **Add a room with a window** (use Floor Plan editor)

4. **Press "Render: Solid" button**

5. **Check console logs** - you should see:
   - `[wallStrips] Copying window opening:` with sillM and heightM values
   - `[engine3d] Window opening:` with computed y0 and y1 values

6. **Verify visually**:
   - Window should show BLUE glass (75% opacity)
   - Wall should appear BELOW window (from floor to 0.9m)
   - Wall should appear ABOVE window (from 2.4m to ceiling at 3.0m)
   - Window frame should be crisp 90° edges
   - Doors should be visible (amber/yellow overlay)

## Expected Values

For a standard window:
- `sillM`: 0.9 (meters from floor)
- `heightM`: 1.5 (window height)
- `y0`: baseY + 0.9 (bottom of window)
- `y1`: baseY + 2.4 (top of window = 0.9 + 1.5)
- Wall below: floor (baseY) to y0
- Window glass: y0 to y1
- Wall above: y1 to ceiling (baseY + 3.0)

For a door:
- `sillM`: 0 (no sill, starts at floor)
- `heightM`: 2.04 (door height)
- Should show amber overlay

## Troubleshooting

If windows still render incorrectly:

1. **Clear browser cache completely**:
   - Chrome: Settings > Privacy > Clear browsing data > Cached images and files
   - Firefox: Settings > Privacy > Clear Data > Cached Web Content

2. **Check if solid mode is active**:
   ```javascript
   console.log(window.__wallRenderMode); // should be 'solid'
   ```

3. **Inspect wall strip openings**:
   ```javascript
   console.log(window.wallStrips.filter(w => w.openings && w.openings.length > 0));
   ```

4. **Check opening data on rooms**:
   ```javascript
   console.log(window.allRooms.map(r => ({ id: r.id, openings: r.openings })));
   ```

5. **Force rebuild**:
   ```javascript
   if (typeof window.rebuildRoomPerimeterStrips === 'function') {
     window.rebuildRoomPerimeterStrips(0.3);
     window.renderLoop();
   }
   ```
