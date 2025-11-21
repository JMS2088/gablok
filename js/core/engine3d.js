/**
 * @file engine3d.js
 * @description Core 3D rendering engine with orbit camera, projection, and scene management.
 */
(function(){
  // ---------------------------------------------------------------------------
  // Camera defaults & orbit helpers (FIX: stabilize 3D orbit interaction)
  // ---------------------------------------------------------------------------
  // Some interaction code (events.js) expects minPitch/maxPitch/minDistance/maxDistance
  // on the camera object for clamping & wheel zoom. In certain boot sequences these
  // were never defined, causing pitch to drift or zoom to ignore limits.
  // We establish a single authoritative camera object here with sane defaults.
  if (typeof window.camera === 'undefined' || !window.camera) {
    window.camera = {
      yaw: 0.65,              // radians around Y (0 faces +Z)
      pitch: -0.45,           // negative looks downward slightly
      distance: 26,           // radial distance from target
      targetX: 0,
      targetZ: 0,
      targetY: 0,            // vertical anchor (keep 0 for ground reference)
      minPitch: -1.15,       // avoid flipping under the ground
      maxPitch: 0.35,        // slight upward tilt allowed
      minDistance: 6,        // prevent extreme zoom-in clipping
      maxDistance: 140       // cap far zoom for precision & perf
    };
  } else {
    // Patch missing properties without overwriting user-changed values
    var c = window.camera;
    if (typeof c.minPitch !== 'number') c.minPitch = -1.15;
    if (typeof c.maxPitch !== 'number') c.maxPitch = 0.35;
    if (typeof c.minDistance !== 'number') c.minDistance = 6;
    if (typeof c.maxDistance !== 'number') c.maxDistance = 140;
    if (typeof c.targetX !== 'number') c.targetX = 0;
    if (typeof c.targetZ !== 'number') c.targetZ = 0;
    if (typeof c.targetY !== 'number') c.targetY = 0;
  }
  // Normalize yaw to [-PI, PI] so large drags never accumulate floating error.
  function __normalizeYaw(y) {
    var TWO_PI = Math.PI * 2;
    if (!isFinite(y)) return 0;
    // Bring into [0, 2PI)
    y = y % TWO_PI; if (y < 0) y += TWO_PI;
    // Shift to [-PI, PI]
    if (y > Math.PI) y -= TWO_PI;
    return y;
  }
  // Clamp and normalize camera orientation & distance.
  if (typeof window.clampCamera === 'undefined') {
    window.clampCamera = function clampCamera(){
      try {
        if (!window.camera) return;
        camera.yaw = __normalizeYaw(camera.yaw);
        // Smooth pitch clamp: hard clamp but preserve tiny epsilon to avoid getting stuck
        var minP = camera.minPitch, maxP = camera.maxPitch;
        if (camera.pitch < minP) camera.pitch = minP;
        if (camera.pitch > maxP) camera.pitch = maxP;
        // Distance clamp
        if (camera.distance < camera.minDistance) camera.distance = camera.minDistance;
        if (camera.distance > camera.maxDistance) camera.distance = camera.maxDistance;
      } catch(_e) { /* non-fatal */ }
    };
  }
  // Simple orbit apply used by events.js (right mouse or left empty-drag)
  if (typeof window.orbitCamera === 'undefined') {
    window.orbitCamera = function orbitCamera(dx, dy){
      try {
        // Scale rotation speed by current distance (farther = slower for stability)
        var base = 0.008;
        var distFactor = Math.max(0.35, Math.min(1.0, 18 / Math.max(1, camera.distance)));
        camera.yaw += dx * base * distFactor;
        camera.pitch -= dy * base * distFactor;
        clampCamera();
        // Touch camera activity timestamp so UI does not fade during orbit
        window._camLastMoveTime = (performance && performance.now) ? performance.now() : Date.now();
      } catch(_e) {}
    };
  }
  // Public helper to pan using world axes (shift-drag path in events.js)
  if (typeof window.panCameraWorld === 'undefined') {
    window.panCameraWorld = function panCameraWorld(dx, dy){
      try {
        // Convert screen delta to world movement scaled by distance => intuitive near & far
        var factor = Math.max(0.002, camera.distance / 400);
        var right = (window.__proj && __proj.right) ? __proj.right : [1,0,0];
        var fwd = (window.__proj && __proj.fwd) ? __proj.fwd : [0,0,1];
        camera.targetX += factor * (dx * right[0] - dy * fwd[0]);
        camera.targetZ += factor * (dx * right[2] - dy * fwd[2]);
        window._camLastMoveTime = (performance && performance.now) ? performance.now() : Date.now();
      } catch(_e) {}
    };
  }
  // Ensure global canvas/ctx identifiers exist (some legacy modules reference bare `canvas` / `ctx`).
  // Declare as globals if not already defined to avoid ReferenceError in other scripts.
  if (typeof window.canvas === 'undefined') window.canvas = null;
  if (typeof window.ctx === 'undefined') window.ctx = null;
  // Bind local references (still point to globals) for internal convenience.
  // IMPORTANT: DO NOT use `var canvas` / `var ctx` here or we shadow and prevent global var creation.
  // Instead rely on the existing global bindings created above.
  /* eslint-disable no-undef */
  canvas = window.canvas;
  ctx = window.ctx;
  /* eslint-enable no-undef */
  // Component creation helpers moved to js/core/engine/components.js
  // addStairs, addPergola, addGarage, addPool, addRoof, addBalcony are defined there with guards
  if (typeof window.__showCornerCodes === 'undefined') window.__showCornerCodes = false;
  if (typeof window.__cornerCodeMap === 'undefined') window.__cornerCodeMap = {};
  // Shared exterior-corner snap map: ensures adjacent strips use the exact same
  // world coordinate at convex exterior corners, eliminating tiny gaps.
  if (typeof window.__extCornerSnap === 'undefined') window.__extCornerSnap = {};
  // Shared interior-corner snap map: ensures adjacent strips use the exact same
  // world coordinate at concave interior corners, eliminating gaps.
  if (typeof window.__intCornerSnap === 'undefined') window.__intCornerSnap = {};
  // Track the set of perimeter edge keys used by the last rebuild so we can
  // remove any previously generated perimeter strips even if they don't match
  // the current footprint (prevents "ghost" solids at old positions during drags).
  if (typeof window.__lastPerimeterEdges === 'undefined') window.__lastPerimeterEdges = null;
  if (typeof window.__activelyDraggedRoomId === 'undefined') window.__activelyDraggedRoomId = null;

  // Wall strip dedupe moved to wallStrips.js

  // Remove previously generated perimeter strips (created from rooms)
  // Enhanced: also remove ANY strips that coincide with current room/garage perimeter edges,
  // even if they are not tagged. This ensures the Render button (Lines) reliably clears solids
  // for rectangles and polygons across both floors, preventing stale untagged duplicates.
    // removeRoomPerimeterStrips moved to wallStrips.js

  // rebuildRoomPerimeterStrips moved to wallStrips.js
  if (typeof window.setWallRenderMode === 'undefined') window.setWallRenderMode = function(mode){
    try {
      var m = (mode==='solid') ? 'solid' : 'line';
      window.__wallRenderMode = m;
      console.log('[setWallRenderMode] Mode changed to:', m);
      // When user presses Render (solid), enable corner codes so endpoints are labeled on screen
      if (m === 'solid') { window.__showCornerCodes = true; }
      else { window.__showCornerCodes = false; }
      // Force window glass color to blue in all modes (user requirement)
      window.__windowGlassColor = 'rgba(59,130,246,0.75)';
      console.log('[setWallRenderMode] Window glass color forced blue:', window.__windowGlassColor);
      // Simplified: do not run 2D→3D applies here. Just rebuild from existing 3D state for ALL rooms/garages across floors.
      // This guarantees that pressing Render applies to ground and first floor together, without duplication or missed floors.
      if (m === 'solid') {
        // Rebuild perimeter strips with fresh opening data (don't preserve old incorrect data)
        window.__roomWallThickness = 0.3;
        if (typeof window.rebuildRoomPerimeterStrips === 'function') window.rebuildRoomPerimeterStrips(window.__roomWallThickness);
      } else {
        window.__roomWallThickness = 0.0;
        if (typeof window.removeRoomPerimeterStrips === 'function') window.removeRoomPerimeterStrips();
      }
      if (typeof window.updateStatus === 'function') window.updateStatus('Walls: ' + (m==='solid' ? 'Solid 300mm' : 'Lines'));
      // Force an immediate full render so mode change is visible even if nothing else changed this frame
      try { window._needsFullRender = true; } catch(_eFlag) {}
      if (typeof window.renderLoop === 'function') window.renderLoop();
    } catch(_e) {}
  };
  if (typeof window.stairsComponent === 'undefined') window.stairsComponent = null;
  if (typeof window.pergolaComponents === 'undefined') window.pergolaComponents = [];
  if (typeof window.garageComponents === 'undefined') window.garageComponents = [];
  if (typeof window.poolComponents === 'undefined') window.poolComponents = [];
  if (typeof window.roofComponents === 'undefined') window.roofComponents = [];
  if (typeof window.balconyComponents === 'undefined') window.balconyComponents = [];
  if (typeof window.furnitureItems === 'undefined') window.furnitureItems = [];
  if (typeof window.currentFloor === 'undefined') window.currentFloor = 0;
  if (typeof window.selectedRoomId === 'undefined') window.selectedRoomId = null;
  if (typeof window.selectedWallStripIndex === 'undefined') window.selectedWallStripIndex = -1;

  // ---- UI helpers & constants ----
  if (typeof window.resizeHandles === 'undefined') window.resizeHandles = [];
  if (typeof window.currentSnapGuides === 'undefined') window.currentSnapGuides = [];
  if (typeof window.GRID_SPACING === 'undefined') window.GRID_SPACING = 1;
  if (typeof window.HANDLE_RADIUS === 'undefined') window.HANDLE_RADIUS = 14;
  // Snap tolerance (meters): distance from a snapped size at which we "magnet" to grid.
  // Previous fixed value (0.15) felt too forgiving / imprecise for fine work. We now allow
  // dynamic override via window.__snapToleranceOverride and scale a sane default from grid size.
  // If GRID_SPACING is large (>=1m) we keep a small fraction (≈0.12m). For finer grids we shrink.
  if (typeof window.HANDLE_SNAP_TOLERANCE === 'undefined') {
    try {
      var g = (typeof window.GRID_SPACING==='number' && window.GRID_SPACING>0)? window.GRID_SPACING : 1;
      // Base tolerance proportional to grid but clamped to a practical range.
      var baseTol = Math.max(0.03, Math.min(0.18, g * 0.12)); // 12% of grid size
      window.HANDLE_SNAP_TOLERANCE = baseTol;
    } catch(_eTol){ window.HANDLE_SNAP_TOLERANCE = 0.12; }
  }
  // Runtime override hook (set window.__snapToleranceOverride before interactions)
  if (typeof window.__applySnapToleranceOverride === 'undefined') {
    window.__applySnapToleranceOverride = function(){
      try {
        if (typeof window.__snapToleranceOverride === 'number' && window.__snapToleranceOverride >= 0) {
          window.HANDLE_SNAP_TOLERANCE = window.__snapToleranceOverride;
        }
      } catch(_e){/* non-fatal */}
    };
  }
  // Frame pacing defaults used by renderLoop
  if (typeof window.MIN_DYNAMIC_FPS === 'undefined') window.MIN_DYNAMIC_FPS = 12; // fps when idle
  if (typeof window._minFrameInterval === 'undefined') window._minFrameInterval = 16; // ms when active (≈60fps)
  // UI fade policy: fully fade out within 3s of no interaction, no grace period
  if (typeof window.UI_FADE_INACTIVITY_MS === 'undefined') window.UI_FADE_INACTIVITY_MS = 3000;
  if (typeof window.UI_FADE_GRACE_MS === 'undefined') window.UI_FADE_GRACE_MS = 0;
  if (typeof window.MEASURE_UPDATE_INTERVAL_MS === 'undefined') window.MEASURE_UPDATE_INTERVAL_MS = 180;
  if (typeof window.LABEL_UPDATE_INTERVAL_MS === 'undefined') window.LABEL_UPDATE_INTERVAL_MS = 200;
  if (typeof window._lastLabelsUpdate === 'undefined') window._lastLabelsUpdate = 0;
  if (typeof window._lastMeasurementsUpdate === 'undefined') window._lastMeasurementsUpdate = 0;
  if (typeof window.__labelsFrozen === 'undefined') window.__labelsFrozen = false;
  if (typeof window._needsFullRender === 'undefined') window._needsFullRender = true;
  if (typeof window._camLastMoveTime === 'undefined') window._camLastMoveTime = 0;
  if (typeof window._uiLastInteractionTime === 'undefined') window._uiLastInteractionTime = 0;
  if (typeof window.__perf === 'undefined') window.__perf = { lastCamera:{ yaw:0,pitch:0,targetX:0,targetZ:0,distance:0,floor:0,sel:null }, lastFrameTime:0, frameMs:0, frames:0, lastFpsSample:0, fps:0 };
  if (typeof window.dbg === 'undefined') window.dbg = function(){};

  // ---- Units & formatting helpers (globals used across modules) ----
  // Quantize a meter value to a fixed number of decimals (e.g., 2 => centimeters)
  if (typeof window.quantizeMeters === 'undefined') {
    window.quantizeMeters = function quantizeMeters(n, decimals){
      try {
        var x = (+n) || 0;
        var d = (decimals|0); if (d < 0) d = 0; if (d > 6) d = 6;
        var f = Math.pow(10, d);
        // Add a tiny epsilon to stabilize rounding around .005 boundaries
        return Math.round((x + 1e-9) * f) / f;
      } catch(e) { return n; }
    };
  }
  // Format a meter value smartly (>=10m: 1 decimal, else 2); override via opts.decimals
  if (typeof window.formatMeters === 'undefined') {
    window.formatMeters = function formatMeters(n, opts){
      if (!isFinite(n)) return '—';
      var v = (+n) || 0;
      var decimals = (opts && typeof opts.decimals === 'number') ? (opts.decimals|0) : (Math.abs(v) >= 10 ? 1 : 2);
      if (decimals < 0) decimals = 0; if (decimals > 6) decimals = 6;
      var q = (typeof window.quantizeMeters === 'function') ? window.quantizeMeters(v, decimals) : v;
      // Ensure fixed decimals for consistent label sizing
      try { return q.toFixed(decimals); } catch(e) { return String(q); }
    };
  }

  // ---- Canvas setup ----
  if (typeof window.setupCanvas === 'undefined') {
    window.setupCanvas = function setupCanvas(){
      if (!canvas) canvas = document.getElementById('canvas');
      if (!canvas) return;
      var dpr = window.devicePixelRatio || 1;
      var cssW = window.innerWidth || 1024;
      var cssH = window.innerHeight || 768;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      var w = Math.floor(cssW * dpr), h = Math.floor(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (!ctx) ctx = canvas.getContext('2d');
      // Expose back to window for modules that reference window.canvas/window.ctx
      try { window.canvas = canvas; window.ctx = ctx; } catch(_e) {}
    };
  }

  // ---- Projection math ----
  var __proj = { right:[1,0,0], up:[0,1,0], fwd:[0,0,1], cam:[0,0,10], scale: 600 };
  try { window.__proj = __proj; } catch(e) {}
  // Blend between perspective (1.0) and near-orthographic (0.0). Lowering this reduces perspective foreshortening.
  if (typeof window.PERSPECTIVE_STRENGTH === 'undefined') window.PERSPECTIVE_STRENGTH = 0.88;
  if (typeof window.updateProjectionCache === 'undefined') {
    window.updateProjectionCache = function updateProjectionCache(){
      // Ensure camera constraints before computing projection basis
      try { clampCamera(); } catch(_eClamp) {}
      var cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
      var cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
      // Forward points from camera toward target
      var fwd = [ sy*cp, sp, cy*cp ];
      // Right vector around world Y axis (yaw-only)
      var right = [ cy, 0, -sy ];
      // Use right-handed basis: up = cross(fwd, right)
      var up = [
        fwd[1]*right[2] - fwd[2]*right[1],
        fwd[2]*right[0] - fwd[0]*right[2],
        fwd[0]*right[1] - fwd[1]*right[0]
      ];
    var norm = function(v){ var L=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/L,v[1]/L,v[2]/L]; };
      right = norm(right); up = norm(up); fwd = norm(fwd);
    // Bias vertical offset so when pitching downward the camera hugs the floor a bit closer
    var verticalScale = (fwd[1] < 0 ? 0.6 : 1.0); // reduce upward lift when looking down
    var camY = (camera.targetY||0) - fwd[1]*camera.distance*verticalScale;
    if (typeof camera.minCamY === 'number') camY = Math.max(camera.minCamY, camY);
  var cam = [ camera.targetX - fwd[0]*camera.distance, camY, camera.targetZ - fwd[2]*camera.distance ];
      __proj.right = right; __proj.up = up; __proj.fwd = fwd; __proj.cam = cam;
      var dpr = window.devicePixelRatio || 1;
      __proj.scale = Math.max(300, (Math.min(canvas ? canvas.height : 800, canvas ? canvas.width : 1200) * 0.6)) / dpr;
      try { window.__proj = __proj; } catch(e) {}
    };
  }
  // Focus camera on an object's center with a distance scaled to its size
  if (typeof window.focusCameraOnObject === 'undefined') {
    window.focusCameraOnObject = function focusCameraOnObject(obj){
      try {
        if (!obj) return;
        var w = Math.max(0.5, obj.width || 2);
        var d = Math.max(0.5, obj.depth || 2);
        camera.targetX = obj.x || 0;
        camera.targetZ = obj.z || 0;
        // Pad distance so object fills a good portion of the view
        camera.distance = Math.max(8, Math.max(w, d) * 2 + 5);
        // Reset pan to center screen
        pan.x = 0; pan.y = 0;
        _camLastMoveTime = (performance && performance.now) ? performance.now() : Date.now();
      } catch(e) { /* non-fatal */ }
    };
  }
  if (typeof window.project3D === 'undefined') {
    window.project3D = function project3D(x,y,z){
      if (!canvas) return null;
      var rx = x - __proj.cam[0], ry = y - __proj.cam[1], rz = z - __proj.cam[2];
      var cx = rx*__proj.right[0] + ry*__proj.right[1] + rz*__proj.right[2];
      var cy = rx*__proj.up[0]    + ry*__proj.up[1]    + rz*__proj.up[2];
      var cz = rx*__proj.fwd[0]   + ry*__proj.fwd[1]   + rz*__proj.fwd[2];
      // Near/behind handling:
      // - Hard cull points that are sufficiently behind the camera to avoid rendering a mirrored scene (e.g., second grid floor)
      // - Clamp points very close to the near plane to a small positive depth so nearby/inside geometry stays visible
      if (cz < -0.25) {
        // When inside a room with solid walls, don't drop geometry behind; clamp to near plane
        if (window.__cameraInsideSolid) { cz = 0.02; }
        else { return null; }
      }
      if (cz < 0.02) cz = 0.02;              // near plane clamp
      // Reduce perspective a little by blending cz with a reference depth (camera distance)
      var k = Math.max(0, Math.min(1, window.PERSPECTIVE_STRENGTH));
      var refZ = Math.max(0.5, camera.distance || 12);
      var czEff = cz * k + refZ * (1 - k);
      var s = __proj.scale / czEff;
      var sx = (canvas.width/2) + (cx * s) + pan.x;
      var sy = (canvas.height/2) - (cy * s) + pan.y;
      return { x:sx, y:sy, _cz:czEff };
    };
  }

  // ---- Drawing helpers ----
  if (typeof window.clearCanvas === 'undefined') {
    window.clearCanvas = function clearCanvas(){
      if (!ctx || !canvas) return;
      try { window.__dbgGfx.clearCalls++; } catch(_e) {}
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
    };
  }
  if (typeof window.drawGrid === 'undefined') {
    window.drawGrid = function drawGrid(){
      /*
       * ========================================================================
       * MAIN 3D GRID — VERY IMPORTANT: DO NOT DELETE
       * ------------------------------------------------------------------------
       * The ground grid provides essential spatial context for navigation,
       * placement, and visual scale. It also serves as a sanity check that the
       * 3D engine and projection are running (smoke tests sample non-white
       * pixels in the frame and rely on the grid/geometry being drawn).
       *
       * If you need to adjust styling, tweak colors or line widths below, but do
       * NOT remove this function or its invocation in the render loop.
       * ========================================================================
       */
      if (!ctx || !canvas) return;
      try { window.__dbgGfx.gridCalls++; } catch(_e) {}
      var range = 40;
      var minX = Math.floor(camera.targetX - range), maxX = Math.ceil(camera.targetX + range);
      var minZ = Math.floor(camera.targetZ - range), maxZ = Math.ceil(camera.targetZ + range);
      ctx.save();

      // Improve contrast so grid is visible on light backgrounds
      ctx.lineWidth = 1.25;
      for (var x=minX; x<=maxX; x+=GRID_SPACING){
        var a=project3D(x,0,minZ), b=project3D(x,0,maxZ);
        if(a&&b){
          ctx.strokeStyle=(x===0?'rgba(0,0,0,0.35)':'rgba(0,0,0,0.12)');
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        }
      }
      for (var z=minZ; z<=maxZ; z+=GRID_SPACING){
        var a2=project3D(minX,0,z), b2=project3D(maxX,0,z);
        if(a2&&b2){
          ctx.strokeStyle=(z===0?'rgba(0,0,0,0.35)':'rgba(0,0,0,0.12)');
          ctx.beginPath(); ctx.moveTo(a2.x,a2.y); ctx.lineTo(b2.x,b2.y); ctx.stroke();
        }
      }
      ctx.restore();
    };
  }
  if (typeof window.drawSnapGuides === 'undefined') window.drawSnapGuides = function(){};
  if (typeof window.drawHandle === 'undefined') {
    // Compute a radius that tracks zoom/depth to keep handles legible across scales
    if (typeof window.computeHandleRadius === 'undefined') {
      window.computeHandleRadius = function computeHandleRadius(screenPt, baseRadius){
        try {
          var baseR = Math.max(10, (typeof baseRadius === 'number' ? baseRadius : (window.HANDLE_RADIUS || 14)));
          var d = (screenPt && typeof screenPt._cz === 'number') ? screenPt._cz : (camera ? camera.distance : 12);
          // Invert scaling: nearer objects get larger handles; farther objects get smaller ones
          var scale = Math.pow(12 / Math.max(0.1, d), 0.45);
          var r = baseR * scale;
          return Math.max(10, Math.min(28, r));
        } catch(e){ return Math.max(10, (typeof baseRadius === 'number' ? baseRadius : (window.HANDLE_RADIUS || 14))); }
      };
    }
    window.drawHandle = function drawHandle(screenPt, type, label, isActive, radius){
      if(!ctx||!canvas||!screenPt) return;
      var r = window.computeHandleRadius ? window.computeHandleRadius(screenPt, radius||HANDLE_RADIUS||10) : Math.max(6, radius||HANDLE_RADIUS||10);
      ctx.save();
      var color = '#3b82f6'; // default blue
      if (type && /width/.test(type)) color = '#ef4444'; // red for X
      else if (type && /depth/.test(type)) color = '#10b981'; // green for Z
      else if (type === 'height') color = '#f59e0b'; // amber
      else if (type === 'rotate') color = '#8b5cf6'; // violet
      // Caller controls alpha (per-object × global fade). Respect current globalAlpha without overriding.
      ctx.globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha));
      ctx.beginPath(); ctx.arc(screenPt.x, screenPt.y, r, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
      // glyph/label
      var txt = (label || '').toString();
      if (txt) {
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold '+Math.max(9, Math.floor(r*0.9))+'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, screenPt.x, screenPt.y);
      }
      ctx.restore();
    };
  }
  if (typeof window.drawCompass === 'undefined') {
    window.drawCompass = function drawCompass(){
      if (!ctx || !canvas) return;
      var r = 28;
      // Place in bottom-right corner with a small margin
      var margin = 18;
      var cx = (canvas.width  - (margin + r));
      var cy = (canvas.height - (margin + r));
      var sgn = (window.__plan2d && (window.__plan2d.yFromWorldZSign===-1 || window.__plan2d.yFromWorldZSign===1)) ? window.__plan2d.yFromWorldZSign : 1;
      var alpha = (typeof window.__uiFadeAlpha==='number') ? (0.85 * window.__uiFadeAlpha) : 0.85;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      // Base circle (white background)
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle='#ffffff'; ctx.fill(); ctx.strokeStyle='#000000'; ctx.lineWidth=1; ctx.stroke();
  // Cross hairs (black) — inset so lines do not touch letters at rim
  ctx.strokeStyle='#000000';
  var inset = 14; // must be > letter offset (10)
  ctx.beginPath(); ctx.moveTo(cx - r + 4 + inset, cy); ctx.lineTo(cx + r - 4 - inset, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - r + 4 + inset); ctx.lineTo(cx, cy + r - 4 - inset); ctx.stroke();
      // Cardinal labels: flip N/S based on 2D orientation sign to match 2D compass (black letters)
      ctx.fillStyle = '#000000';
      var fontPx3D = 8; // fixed 8px
      ctx.font = 'bold ' + fontPx3D + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var nY = (sgn===1) ? (cy - r + 10) : (cy + r - 10);
      var sY = (sgn===1) ? (cy + r - 10) : (cy - r + 10);
      ctx.fillText('N', cx, nY);
      ctx.fillText('S', cx, sY);
      ctx.fillText('E', cx + r - 10, cy);
      ctx.fillText('W', cx - r + 10, cy);
      // North arrow: match 2D compass (black fill)
      ctx.beginPath();
      if (sgn === 1) { ctx.moveTo(cx, cy - r + 6); ctx.lineTo(cx - 5, cy - r + 14); ctx.lineTo(cx + 5, cy - r + 14); }
      else { ctx.moveTo(cx, cy + r - 6); ctx.lineTo(cx - 5, cy + r - 14); ctx.lineTo(cx + 5, cy + r - 14); }
      ctx.closePath(); ctx.fillStyle='#000000'; ctx.fill();
      ctx.restore();
    };
  }
  // Navigation compass: draw into #nav-compass-canvas in top-right UI
  if (typeof window.drawNavCompass === 'undefined') {
    window.drawNavCompass = function drawNavCompass(){
      try {
        var c = document.getElementById('nav-compass-canvas');
        if (!c) return;
        var dpr = (window.devicePixelRatio||1);
        // Adapt to the canvas' CSS size in the toolbar (fallback to attributes)
        var cssW = Math.max(32, Math.floor((c.clientWidth||c.width||44)));
        var cssH = Math.max(32, Math.floor((c.clientHeight||c.height||44)));
        if (c.width !== Math.floor(cssW*dpr) || c.height !== Math.floor(cssH*dpr)){
          c.width = Math.floor(cssW*dpr); c.height = Math.floor(cssH*dpr);
          // Preserve existing CSS width/height if set in HTML; otherwise set from computed
          if (!c.style.width) c.style.width = cssW+'px';
          if (!c.style.height) c.style.height = cssH+'px';
        }
        var cx = c.getContext('2d'); if(!cx) return; cx.setTransform(1,0,0,1,0,0); cx.clearRect(0,0,c.width,c.height);
        cx.save(); cx.scale(dpr, dpr);
        var r = Math.max(14, Math.min(28, Math.floor(Math.min(cssW, cssH)/2 - 4)));
        var x = (cssW/2), y = (cssH/2);
        var sgn = (window.__plan2d && (window.__plan2d.yFromWorldZSign===-1 || window.__plan2d.yFromWorldZSign===1)) ? window.__plan2d.yFromWorldZSign : 1;
    // Base circle (white background)
    cx.beginPath(); cx.arc(x,y,r,0,Math.PI*2); cx.fillStyle='#ffffff'; cx.fill(); cx.strokeStyle='#000000'; cx.lineWidth=1; cx.stroke();
  // Cross hairs (black) — inset so lines do not touch letters at rim
  cx.strokeStyle='#000000';
  var inset = 14; // must be > letter offset (10)
  cx.beginPath(); cx.moveTo(x - r + 4 + inset, y); cx.lineTo(x + r - 4 - inset, y); cx.stroke();
  cx.beginPath(); cx.moveTo(x, y - r + 4 + inset); cx.lineTo(x, y + r - 4 - inset); cx.stroke();
    // Labels (flip N/S with sign) - fixed 8px (black letters)
    cx.fillStyle='#000000'; var fontPxNav = 8; cx.font='bold ' + fontPxNav + 'px system-ui, sans-serif'; cx.textAlign='center'; cx.textBaseline='middle';
        var nY = (sgn===1) ? (y - r + 10) : (y + r - 10);
        var sY = (sgn===1) ? (y + r - 10) : (y - r + 10);
        cx.fillText('N', x, nY);
        cx.fillText('S', x, sY);
        cx.fillText('E', x + r - 10, y);
        cx.fillText('W', x - r + 10, y);
    // North arrow (static) to show absolute North regardless of camera (black fill)
        cx.beginPath();
        var tip = Math.max(4, Math.floor(r*0.22));
        var base = Math.max(3, Math.floor(r*0.18));
    if (sgn === 1) { cx.moveTo(x, y - r + tip); cx.lineTo(x - base, y - r + tip + (base*1.6)); cx.lineTo(x + base, y - r + tip + (base*1.6)); }
    else { cx.moveTo(x, y + r - tip); cx.lineTo(x - base, y + r - tip - (base*1.6)); cx.lineTo(x + base, y + r - tip - (base*1.6)); }
    cx.closePath(); cx.fillStyle='#000000'; cx.fill();

        // Camera heading needle: rotate with camera.yaw so users see direction of view
        try {
          var yaw = (window.camera && typeof camera.yaw==='number') ? camera.yaw : 0;
          // Map yaw to screen angle: yaw=0 (looking +Z) -> up if sgn=1, down if sgn=-1
          var baseAngle = (sgn===1 ? -Math.PI/2 : Math.PI/2);
          var ang = baseAngle + yaw * sgn;
          var len = Math.max(6, r - 6);
          var x2 = x + Math.cos(ang) * len;
          var y2 = y + Math.sin(ang) * len;
          cx.strokeStyle = '#000000';
          cx.lineWidth = 2;
          cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x2, y2); cx.stroke();
          // small cap circle at center (black)
          cx.beginPath(); cx.arc(x, y, 2.2, 0, Math.PI*2); cx.fillStyle = '#000000'; cx.fill();
        } catch(_hd) {}
        cx.restore();
      } catch(_e) { /* non-fatal */ }
    };
  }
  if (typeof window.isOffscreenByCenter === 'undefined') {
    window.isOffscreenByCenter = function(p){ if(!canvas||!p) return true; var pad=40; return (p.x<-pad||p.y<-pad||p.x>canvas.width+pad||p.y>canvas.height+pad); };
  }

  // ---- Scene creation helpers ----
  if (typeof window.createRoom === 'undefined') {
    window.createRoom = function(x,z,level){
      var id='room_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      var rm = { id:id, name:'Room', x:x||0, z:z||0, width:4, depth:3, height:3, level:(level||0), type:'room', rotation:0 };
      // Immediately add grouped wall tags so populatePlan2DFromDesign can build walls without waiting for a full apply round-trip.
      try { if (!Array.isArray(rm.openings)) rm.openings = []; } catch(_eO){}
      return rm;
    };
  }
  // Generic free-spot finder that considers all object footprints on a level and snaps to grid
  function __collectFootprints(level){
    var fps = [];
    try {
      // Rooms
      for (var i=0;i<(allRooms||[]).length;i++){ var r=allRooms[i]; if(!r) continue; if((r.level||0)!==level) continue; fps.push({x:r.x||0, z:r.z||0, w:r.width||0, d:r.depth||0}); }
      // Stairs (all)
      try {
        var scArr = window.stairsComponents || [];
        for (var si=0; si<scArr.length; si++){
          var sc = scArr[si]; if(!sc) continue; if ((sc.level||0)!==level) continue;
          fps.push({x:sc.x||0, z:sc.z||0, w:sc.width||0, d:sc.depth||0});
        }
        // Back-compat singleton
        if ((!Array.isArray(scArr) || scArr.length===0) && stairsComponent && (stairsComponent.level||0)===level) fps.push({x:stairsComponent.x||0, z:stairsComponent.z||0, w:stairsComponent.width||0, d:stairsComponent.depth||0});
      } catch(_sfp){}
      // Arrays
      function addArray(arr){ for (var j=0;j<(arr||[]).length;j++){ var o=arr[j]; if(!o) continue; var lv=(o.level!=null? o.level : 0); if(lv!==level) continue; fps.push({x:o.x||0, z:o.z||0, w:o.width||0, d:o.depth||0}); } }
      addArray(pergolaComponents); addArray(garageComponents); addArray(poolComponents); addArray(roofComponents); addArray(balconyComponents);
      // furniture not included by default (small), but harmless to include
      // addArray(furnitureItems);
    } catch(e) {}
    return fps;
  }
  // Treat touching edges as collision to enforce a visible gap between new placements
  function __aabbOverlap(ax0,ax1,az0,az1, bx0,bx1,bz0,bz1){ return (ax0 <= bx1 && ax1 >= bx0 && az0 <= bz1 && az1 >= bz0); }
  function findFreeSpotForFootprint(width, depth, level){
    try {
      var grid = (typeof GRID_SPACING==='number' && GRID_SPACING>0)? GRID_SPACING : 1;
      var halfW = Math.max(0.25, (width||1)/2);
      var halfD = Math.max(0.25, (depth||1)/2);
      var startX = (typeof camera==='object' ? camera.targetX : 0);
      var startZ = (typeof camera==='object' ? camera.targetZ : 0);
      var footprints = __collectFootprints(level);
      function collides(nx,nz){
        var ax0 = nx - halfW, ax1 = nx + halfW, az0 = nz - halfD, az1 = nz + halfD;
        // Existing rooms on this level
        for (var i=0;i<footprints.length;i++){
          var f=footprints[i]; var bx0=f.x - (f.w||0)/2, bx1=f.x + (f.w||0)/2, bz0=f.z - (f.d||0)/2, bz1=f.z + (f.d||0)/2;
          if (__aabbOverlap(ax0,ax1,az0,az1, bx0,bx1,bz0,bz1)) return true;
        }
        // Keep a small clearance from existing wall strips so we don't "complete" 3-wall clusters
        try {
          var margin = 0.25; // meters
          var strips = Array.isArray(window.wallStrips) ? window.wallStrips : [];
          for (var si=0; si<strips.length; si++){
            var ws = strips[si]; if(!ws) continue; if ((ws.level||0)!==level) continue;
            var sx0 = Math.min(ws.x0, ws.x1) - margin;
            var sx1 = Math.max(ws.x0, ws.x1) + margin;
            var sz0 = Math.min(ws.z0, ws.z1) - margin;
            var sz1 = Math.max(ws.z0, ws.z1) + margin;
            if (__aabbOverlap(ax0,ax1,az0,az1, sx0,sx1,sz0,sz1)) return true;
          }
        } catch(_e) {}
        return false;
      }
      function snapCenter(x,z){ try { var s=applySnap({x:x,z:z,width:width||1,depth:depth||1,level:level}); return {x:s.x,z:s.z}; } catch(e){ return {x:x,z:z}; } }
      var seen = new Set(); var maxRings = 30; // spiral search
      function keyFor(x,z){ return (Math.round(x/grid)*grid)+'|'+(Math.round(z/grid)*grid); }
      for (var ring=0; ring<=maxRings; ring++){
        for (var dx=-ring; dx<=ring; dx++){
          for (var dz=-ring; dz<=ring; dz++){
            if (Math.max(Math.abs(dx),Math.abs(dz)) !== ring) continue;
            var cx = startX + dx*grid, cz = startZ + dz*grid;
            var s = snapCenter(cx, cz); var k = keyFor(s.x, s.z); if (seen.has(k)) continue; seen.add(k);
            if (!collides(s.x, s.z)) return { x: s.x, z: s.z };
          }
        }
      }
      var fb = snapCenter(startX, startZ); return { x: fb.x, z: fb.z };
    } catch(e){ var a=Math.random()*Math.PI*2; var r=0.5+Math.random()*2; return { x:(camera.targetX||0)+Math.cos(a)*r, z:(camera.targetZ||0)+Math.sin(a)*r }; }
  }
  if (typeof window.findFreeSpot === 'undefined') {
    window.findFreeSpot = function(room){
      var lvl = (room && typeof room.level==='number') ? room.level : (typeof currentFloor==='number'? currentFloor:0);
      var w = (room && room.width) || 1, d = (room && room.depth) || 1;
      return findFreeSpotForFootprint(w, d, lvl);
    };
  }
  if (typeof window.createInitialRoom === 'undefined') {
    window.createInitialRoom = function(){
      // Intentionally left as a no-op. Previous behavior auto-created an initial room
      // on startup when no drafts existed. Requirement update: opening the app or
      // switching to the first floor with no data must show an entirely blank 3D and 2D state.
      // Keeping the function defined avoids reference errors where startup code
      // still guards and invokes createInitialRoom().
      return; // no auto seeding
    };
  }
  if (typeof window.addNewRoom === 'undefined') {
    window.addNewRoom = function(){
      var r=createRoom(camera.targetX,camera.targetZ,currentFloor||0);
      var spot=findFreeSpot(r); r.x=spot.x; r.z=spot.z;
      try { var s=applySnap({x:r.x,z:r.z,width:r.width,depth:r.depth,level:r.level,id:r.id,type:'room'}); r.x=s.x; r.z=s.z; } catch(_e) {}
      allRooms.push(r);
      // Preserve current 2D center/scale so existing walls/rooms do not visually shift when we sync.
      try {
        if (window.__plan2d) {
          __plan2d.__preserveCenterScaleOnAdd = true;
          if (typeof __plan2d.centerX === 'number') __plan2d.__savedCenterX = __plan2d.centerX;
          if (typeof __plan2d.centerZ === 'number') __plan2d.__savedCenterZ = __plan2d.centerZ;
          if (typeof __plan2d.scale === 'number') __plan2d.__savedScale = __plan2d.scale;
          // Mark recent addition for 2D label highlight pulse
          __plan2d.__recentAddedRoomId = r.id;
          __plan2d.__recentAddedAt = Date.now();
        }
      } catch(_ePreserve) {}
      // Sync 2D immediately so walls appear without needing manual refresh
      // Force populate to bypass userEdited/manual-wall guard for this additive action
      try { if (typeof populatePlan2DFromDesign==='function') { populatePlan2DFromDesign(true); if (window.__plan2d && __plan2d.active && typeof plan2dDraw==='function') plan2dDraw(); } } catch(_e2d2) {}
      // Ensure new room is visible without re-centering: gently pan if offscreen.
      try {
        if (window.__plan2d && __plan2d.active) {
          var cEl = document.getElementById('plan2d-canvas');
          if (cEl) {
            var scale = __plan2d.scale || 50;
            var dpr = window.devicePixelRatio || 1;
            var w = cEl.width; var h = cEl.height;
            // Compute screen position using current center & pan (mirror logic of worldToScreen2D).
            var sx = (w/2) + ((__plan2d.panX||0) * scale) + ((r.x - (__plan2d.centerX||0)) * scale);
            var sy = (h/2) - ((__plan2d.panY||0) * scale) - ((r.z - (__plan2d.centerZ||0)) * scale * (__plan2d.yFromWorldZSign||1));
            var margin = 60 * dpr; // keep inside padded viewport
            var needPan = false;
            var targetPanX = __plan2d.panX || 0;
            var targetPanY = __plan2d.panY || 0;
            if (sx < margin) { targetPanX += (margin - sx)/scale; needPan = true; }
            if (sx > w - margin) { targetPanX -= (sx - (w - margin))/scale; needPan = true; }
            if (sy < margin) { targetPanY -= (margin - sy)/scale; needPan = true; }
            if (sy > h - margin) { targetPanY += (sy - (h - margin))/scale; needPan = true; }
            if (needPan) {
              __plan2d.panX = targetPanX;
              __plan2d.panY = targetPanY;
            }
          }
        }
      } catch(_ePan) {}
      // Clear preservation flag after first sync so later explicit fit operations can proceed normally.
      try { if (window.__plan2d && __plan2d.__preserveCenterScaleOnAdd) delete __plan2d.__preserveCenterScaleOnAdd; } catch(_clrFlag) {}
      if (typeof window.selectObject==='function') { window.selectObject(r.id, { noRender: true }); }
      else { selectedRoomId=r.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMU) {} }
      updateStatus('Added room'); _needsFullRender=true; startRender();
      try { if (typeof window.historyPushChange==='function') window.historyPushChange('3d-add-room', { coalesce: false }); } catch(_hpa){}
    };
  }

  // ---- Misc guards ----
  if (typeof window.worldMovement === 'undefined') window.worldMovement = function(dx,dy){ var right=__proj.right, fwd=__proj.fwd; var factor=Math.max(0.002, camera.distance/300); return { x: factor*(dx*right[0]-dy*fwd[0]), z: factor*(dx*right[2]-dy*fwd[2]) }; };
  if (typeof window.applySnap === 'undefined') window.applySnap = function(pos){
    try {
      var grid = (typeof GRID_SPACING==='number' && GRID_SPACING>0)? GRID_SPACING : 1;
      var w = Math.max(0, pos.width||0);
      var d = Math.max(0, pos.depth||0);
      var halfW = w/2, halfD = d/2;
      var left = (pos.x||0) - halfW;
      var top = (pos.z||0) - halfD;
      var snappedLeft = Math.round(left / grid) * grid;
      var snappedTop = Math.round(top / grid) * grid;
      var nx = snappedLeft + halfW;
      var nz = snappedTop + halfD;
      var guides = [
        { x0: snappedLeft, z0: snappedTop, x1: snappedLeft + w, z1: snappedTop },
        { x0: snappedLeft, z0: snappedTop + d, x1: snappedLeft + w, z1: snappedTop + d }
      ];
      return { x: nx, z: nz, guides: guides };
    } catch(e){ return { x: pos.x, z: pos.z, guides: [] }; }
  };
  if (typeof window.findObjectById === 'undefined') window.findObjectById = function(id){ if(!id) return null; var arrs=[allRooms, (window.stairsComponents||[]), pergolaComponents, garageComponents, poolComponents, roofComponents, balconyComponents, furnitureItems]; for(var ai=0; ai<arrs.length; ai++){ var A=arrs[ai]||[]; for(var i=0;i<A.length;i++){ if(A[i]&&A[i].id===id) return A[i]; } } if(stairsComponent&&stairsComponent.id===id) return stairsComponent; return null; };
  if (typeof window.findHandle === 'undefined') window.findHandle = function(mx, my){
    try {
        var dpr = window.devicePixelRatio || 1; mx *= dpr; my *= dpr;
      for (var i=resizeHandles.length-1; i>=0; i--){
        var h = resizeHandles[i]; if(!h) continue;
        if (mx >= h.screenX && my >= h.screenY && mx <= h.screenX + h.width && my <= h.screenY + h.height) return h;
      }
    } catch(e) {}
    return null;
  };
  if (typeof window.hitTestWallStrips === 'undefined') window.hitTestWallStrips = function(mxCss, myCss){
    try {
      var dpr = window.devicePixelRatio || 1;
      var mx = (mxCss||0) * dpr, my = (myCss||0) * dpr;
      var lvl = (typeof currentFloor==='number') ? currentFloor : 0;
      var bestIdx = -1, bestD2 = Infinity;
      for (var i=0; i<(wallStrips||[]).length; i++){
        var ws = wallStrips[i]; if(!ws) continue; if ((ws.level||0)!==lvl) continue;
        var yMid = (typeof ws.baseY==='number' ? ws.baseY : (ws.level||0)*3.5) + Math.min(Math.max(0.1, ws.height||3.0)*0.5, 1.2);
        var p0 = project3D(ws.x0||0, yMid, ws.z0||0);
        var p1 = project3D(ws.x1||0, yMid, ws.z1||0);
        if (!p0 || !p1) continue;
        // distance point->segment in screen space
        var vx = p1.x - p0.x, vy = p1.y - p0.y; var L2 = vx*vx + vy*vy; if (L2 < 1e-3) continue;
        var ux = mx - p0.x, uy = my - p0.y; var u = (ux*vx + uy*vy) / L2; if (u < 0) u = 0; if (u > 1) u = 1;
        var qx = p0.x + u*vx, qy = p0.y + u*vy; var dx = mx - qx, dy = my - qy; var d2 = dx*dx + dy*dy;
        if (d2 < bestD2){ bestD2 = d2; bestIdx = i; }
      }
      var thresh = 14 * dpr; // px
      return (bestIdx>-1 && bestD2 <= (thresh*thresh)) ? bestIdx : -1;
    } catch(e){ return -1; }
  };
  if (typeof window.drawWallStrip === 'undefined') window.drawWallStrip = function(ws){
    try {
      if (!ws) return;
      // Build (or reuse) a perimeter edge hash and corner caches once per frame.
      try {
        if (!window.__perimeterEdgeKeyHash) window.__perimeterEdgeKeyHash = null;
        // Recompute once per frame when rendering first strip (detected by sentinel flag reset in render loop)
        if (window.__rebuildPerimeterEdgeHashOnce) {
          window.__rebuildPerimeterEdgeHashOnce = false;
          var hash = Object.create(null);
          function addEdge(lvl,a,b){ var k=lvl+'|'+a.x.toFixed(3)+','+a.z.toFixed(3)+'|'+b.x.toFixed(3)+','+b.z.toFixed(3); var k2=lvl+'|'+b.x.toFixed(3)+','+b.z.toFixed(3)+'|'+a.x.toFixed(3)+','+a.z.toFixed(3); hash[k]=true; hash[k2]=true; }
          var roomsH = Array.isArray(window.allRooms)? window.allRooms : [];
          for (var rhi=0;rhi<roomsH.length;rhi++){
            var rr=roomsH[rhi]; if(!rr) continue; var lvl=(rr.level||0);
            if (Array.isArray(rr.footprint) && rr.footprint.length>=2){
              for (var fpI=0; fpI<rr.footprint.length; fpI++){ var A=rr.footprint[fpI], B=rr.footprint[(fpI+1)%rr.footprint.length]; if(!A||!B) continue; addEdge(lvl,A,B); }
            } else {
              var hw=(rr.width||0)/2, hd=(rr.depth||0)/2; if(hw>0&&hd>0){
                var xL=(rr.x||0)-hw, xR=(rr.x||0)+hw, zT=(rr.z||0)-hd, zB=(rr.z||0)+hd;
                var pts=[{x:xL,z:zT},{x:xR,z:zT},{x:xR,z:zB},{x:xL,z:zB}];
                for (var ei=0; ei<pts.length; ei++){ var P=pts[ei], Q=pts[(ei+1)%pts.length]; addEdge(lvl,P,Q); }
              }
            }
          }
          var garagesH = Array.isArray(window.garageComponents)? window.garageComponents: [];
          for (var ghi=0; ghi<garagesH.length; ghi++){
            var gg=garagesH[ghi]; if(!gg) continue; var lvlG=(gg.level||0); var hwg=(gg.width||0)/2, hdg=(gg.depth||0)/2; if(hwg<=0||hdg<=0) continue;
            var rot=((gg.rotation||0)*Math.PI)/180, c=Math.cos(rot), s=Math.sin(rot);
            function Gp(lx,lz){ return { x:(gg.x||0)+lx*c - lz*s, z:(gg.z||0)+lx*s + lz*c }; }
            var g1=Gp(-hwg,-hdg), g2=Gp(hwg,-hdg), g3=Gp(hwg,hdg), g4=Gp(-hwg,hdg);
            var gEdges=[g1,g2,g3,g4];
            for (var ge=0; ge<gEdges.length; ge++){ var GA=gEdges[ge], GB=gEdges[(ge+1)%gEdges.length]; addEdge(lvlG,GA,GB); }
          }
          window.__perimeterEdgeKeyHash = hash;
        }
        // Corner caches: endpoint neighbor map and T-junction spatial grid
        if (window.__rebuildCornerCachesOnce) {
          window.__rebuildCornerCachesOnce = false;
          // Endpoint neighbor map
          var epMap = Object.create(null);
          function ek(lvl,x,z){ return (lvl||0)+'|'+Math.round((+x||0)*100)+'|'+Math.round((+z||0)*100); }
          var arrAll = window.wallStrips || [];
          for (var ci=0; ci<arrAll.length; ci++){
            var s = arrAll[ci]; if (!s) continue; var lvl=(s.level||0);
            var k0 = ek(lvl,s.x0||0,s.z0||0), k1 = ek(lvl,s.x1||0,s.z1||0);
            // direction outward from the corner along the strip
            var L = Math.hypot((s.x1||0)-(s.x0||0),(s.z1||0)-(s.z0||0)); if (L<1e-6) continue;
            var dir01 = { x: ((s.x1||0)-(s.x0||0))/L, z: ((s.z1||0)-(s.z0||0))/L };
            var dir10 = { x: -dir01.x, z: -dir01.z };
            if (!epMap[k0]) epMap[k0] = [];
            if (!epMap[k1]) epMap[k1] = [];
            epMap[k0].push({ s:s, dir: dir01 });
            epMap[k1].push({ s:s, dir: dir10 });
          }
          window.__endpointNeighborMap = epMap;

          // Spatial grid for T-junction candidate selection
          var cellSize = 1.0; // meters
          var grid = Object.create(null);
          function ckey(ix,iz,lvl){ return lvl+'|'+ix+'|'+iz; }
          function addToGrid(s){
            var lvl=(s.level||0);
            var minX=Math.min(s.x0||0,s.x1||0), maxX=Math.max(s.x0||0,s.x1||0);
            var minZ=Math.min(s.z0||0,s.z1||0), maxZ=Math.max(s.z0||0,s.z1||0);
            // small padding to catch near edges
            minX-=0.05; minZ-=0.05; maxX+=0.05; maxZ+=0.05;
            var ix0=Math.floor(minX/cellSize), ix1=Math.floor(maxX/cellSize);
            var iz0=Math.floor(minZ/cellSize), iz1=Math.floor(maxZ/cellSize);
            for (var ix=ix0; ix<=ix1; ix++){
              for (var iz=iz0; iz<=iz1; iz++){
                var k=ckey(ix,iz,lvl); if(!grid[k]) grid[k]=[]; grid[k].push(s);
              }
            }
          }
          for (var gi=0; gi<arrAll.length; gi++){ var sg = arrAll[gi]; if(!sg) continue; addToGrid(sg); }
          window.__segmentGrid = { grid:grid, cellSize:cellSize };
        }
      } catch(_eEdgeHash) {}
      // While a room is actively dragged, skip drawing its pre-existing perimeter strips to avoid
      // a detached ghost at the old pose. Outlines remain visible via drawRoom(), which now always
      // renders the base perimeter even in solid mode.
      try {
        if (window.__activelyDraggedRoomId && ws.roomId && ws.roomId === window.__activelyDraggedRoomId) {
          return; // skip drawing this strip during active drag
        }
      } catch(_eDragSkip) {}
      var x0=ws.x0, z0=ws.z0, x1=ws.x1, z1=ws.z1;
      var renderMode = window.__wallRenderMode || 'line';
      var thinThick = Math.max(0.02, ws.thickness||0.3);
      var thick = (renderMode==='solid') ? Math.max(0.3, ws.thickness||0.3) : thinThick;
      var h = Math.max(0.1, ws.height||3.0);
      var baseY = (typeof ws.baseY==='number') ? ws.baseY : ((ws.level||0)*3.5);
      var dx = x1-x0, dz = z1-z0; var len = Math.hypot(dx,dz)||1; var nx = -dz/len, nz = dx/len; // left normal
      // Keep normals as-is; mitering will be symmetric at corners (no global flips)
      var hw = thick/2;
      var onLevel = (ws.level||0) === (currentFloor||0);
      // Small helper to draw a unique corner code near a world point (x,z) at a given height
      function drawCornerCodeAt(xw, yw, zw){
        try {
          // Respect global UI hide flags (labelsHidden / cleanView) in addition to showCornerCodes toggle
          if (!window.__showCornerCodes || window.__labelsHidden || window.__cleanViewActive) return;
          var key = null;
          // Quantize to centimeters for stable keys across frames
          function kf(v){ return Math.round((+v||0)*100)/100; }
          key = (ws.level||0) + '|' + kf(xw) + '|' + kf(zw);
          var code = window.__cornerCodeMap && window.__cornerCodeMap[key];
          if (!code) return;
          var p = project3D(xw, yw, zw); if (!p) return;
          // Skip offscreen to reduce clutter
          if (isOffscreenByCenter && isOffscreenByCenter(p)) return;
          ctx.save();
          // Draw small pill background for readability
          var txt = code;
          ctx.font = 'bold 11px system-ui, sans-serif';
          var padX = 4, padY = 2;
          var w = Math.ceil(ctx.measureText(txt).width) + padX*2;
          var h = 14;
          var x = Math.round(p.x + 6), y = Math.round(p.y - h/2 - 2);
          ctx.fillStyle = onLevel ? 'rgba(17,24,39,0.75)' : 'rgba(55,65,81,0.6)';
          ctx.strokeStyle = 'rgba(226,232,240,0.35)';
          ctx.lineWidth = 1;
          // Rounded rect
          var r = 6;
          ctx.beginPath();
          ctx.moveTo(x+r, y);
          ctx.lineTo(x+w-r, y);
          ctx.quadraticCurveTo(x+w, y, x+w, y+r);
          ctx.lineTo(x+w, y+h-r);
          ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
          ctx.lineTo(x+r, y+h);
          ctx.quadraticCurveTo(x, y+h, x, y+h-r);
          ctx.lineTo(x, y+r);
          ctx.quadraticCurveTo(x, y, x+r, y);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
          // Text
          ctx.fillStyle = 'rgba(248,250,252,0.95)';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(txt, x + padX, y + h/2);
          ctx.restore();
        } catch(_eCC) { /* ignore */ }
      }

      // Line mode: draw a clean wireframe prism for freestanding walls so height is visible.
      if (renderMode === 'line'){
        var isFromRoom = !!(ws && (ws.roomId || ws.garageId || ws[(window.__roomStripTag||'__fromRooms')]));
        if (!isFromRoom) {
          var strokeCol = onLevel ? '#64748b' : 'rgba(148,163,184,0.6)';
          var strokeW = onLevel ? 2.2 : 1.4;
          // Compute base/top rectangle corners using a thin thickness to avoid visual clutter
          var A = {x:x0+nx*hw, y:baseY,   z:z0+nz*hw};
          var B = {x:x1+nx*hw, y:baseY,   z:z1+nz*hw};
          var C = {x:x1-nx*hw, y:baseY,   z:z1-nz*hw};
          var D = {x:x0-nx*hw, y:baseY,   z:z0-nz*hw};
          var At= {x:A.x,       y:baseY+h, z:A.z};
          var Bt= {x:B.x,       y:baseY+h, z:B.z};
          var Ct= {x:C.x,       y:baseY+h, z:C.z};
          var Dt= {x:D.x,       y:baseY+h, z:D.z};
          function P(p){ return project3D(p.x,p.y,p.z); }
          var pA=P(A), pB=P(B), pC=P(C), pD=P(D), pAt=P(At), pBt=P(Bt), pCt=P(Ct), pDt=P(Dt);
          function seg(p,q){ if(!p||!q) return; ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); }
          ctx.save();
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = strokeW;
          ctx.beginPath();
          // Top rectangle
          seg(pAt, pBt); seg(pBt, pCt); seg(pCt, pDt); seg(pDt, pAt);
          // Bottom rectangle (floor edges) — draw all 4 edges so corners visually join
          seg(pA, pB); seg(pB, pC); seg(pC, pD); seg(pD, pA);
          // Vertical edges at endpoints (show height)
          seg(pA, pAt); seg(pB, pBt); seg(pC, pCt); seg(pD, pDt);
          ctx.stroke();
          ctx.restore();
          // Corner codes at a readable mid-height
          var yMid = baseY + Math.min(h*0.5, 1.1);
          drawCornerCodeAt(x0, yMid, z0);
          drawCornerCodeAt(x1, yMid, z1);
        }
        return;
      }
      // Base corners (counter-clockwise)
      var A = {x:x0+nx*hw, y:baseY, z:z0+nz*hw};
      var B = {x:x1+nx*hw, y:baseY, z:z1+nz*hw};
      var C = {x:x1-nx*hw, y:baseY, z:z1-nz*hw};
      var D = {x:x0-nx*hw, y:baseY, z:z0-nz*hw};

  // --- Corner and junction correction helpers ---
  /**
   * Corner Config 007 — DO NOT CHANGE
   * ---------------------------------------------------------------
   * This section documents the corner behavior that yields perfectly flush
   * corners for the first room placed in the 3D area. Keep this algorithm
   * intact to preserve visual correctness.
   *
   * Overview
   * - For endpoints that form a T-junction (one strip butting into the middle
   *   of another), we trim this strip to the neighbor's face so there is no
   *   overlap. (See findTJunction/applyTTrimAtStart/End below.)
   * - For L-corners (two strips meeting at a shared endpoint), we apply a
   *   fixed 45° miter per strip by intersecting each offset face with a local
   *   diagonal:
   *     • start endpoint uses the direction (t + n)
   *     • end   endpoint uses the direction (t - n)
   *   where t is the unit tangent from (x0,z0)→(x1,z1) and n is the left unit
   *   normal. This produces symmetric 45° cuts so both faces meet edge-to-edge.
   *
   * Why this works (first room case)
   * - The first placed room’s walls are axis-aligned rectangles. For right
   *   angles, the (t ± n) diagonal yields an exact 45° miter on both faces
   *   when thickness is constant across all strips, so the outer edges align
   *   perfectly with no gaps or overdraw.
   *
   * Invariants and assumptions
   * - Same-level strips only contribute to junction logic.
   * - Wall thickness is uniform per strip; all room walls typically share the
   *   same thickness.
   * - T-junction detection ignores points within 6 cm of a neighbor’s ends to
   *   avoid misclassifying L-corners as T’s.
   *
   * Do not modify
   * - The 45° construction using (t+n) at start and (t−n) at end.
   * - The T-junction trim logic or its endpoint distance thresholds.
   * - The order of intersection calls that computes A/D at start and B/C at end.
   * Any alteration can reintroduce gaps, overlaps, or non-flush corners.
   */
      function angleBetween(u,v){ var dot=u.x*v.x + u.z*v.z; var ll=Math.max(1e-6, Math.hypot(u.x,u.z)*Math.hypot(v.x,v.z)); return Math.acos(Math.max(-1,Math.min(1,dot/ll))); }
      // Compute tangent for this strip (from start->end)
      var tx = dx/len, tz = dz/len; var tvec = {x:tx, z:tz};
      // Neighbor strips + directions that share this endpoint (for L-corners)
      function getNeighborAt(wx, wz){
        try {
          // Use precomputed endpoint neighbor map if available
          var epMap = window.__endpointNeighborMap || null;
          var key = (ws.level||0)+'|'+Math.round((+wx||0)*100)+'|'+Math.round((+wz||0)*100);
          var infos = (epMap && epMap[key]) ? epMap[key].filter(function(e){ return e && e.s !== ws; }) : null;
          if (!infos || !infos.length) {
            return null;
          }
          // Prefer true L-corners: pick neighbor whose direction is closest to 90° from this strip,
          // and explicitly ignore near-colinear cases (0° or 180°) to avoid wrong selections.
          var best = null, bestAng = null, bestDelta = Infinity;
          for (var i=0; i<infos.length; i++){
            var ang = angleBetween(tvec, infos[i].dir); // [0, pi]
            if (ang < 0.15 || ang > (Math.PI - 0.15)) continue; // ignore near-colinear
            var delta = Math.abs(ang - (Math.PI/2));
            if (delta < bestDelta){ bestDelta = delta; bestAng = ang; best = infos[i]; }
          }
          if (!best) return null;
          // Snap to perfect orthogonal if near 90° to improve 45° geometry
          if (Math.abs(bestAng - (Math.PI/2)) < 0.10) {
            var ortho1 = { x: -tvec.z, z: tvec.x };
            var ortho2 = { x:  tvec.z, z: -tvec.x };
            function _dot(a,b){ return a.x*b.x + a.z*b.z; }
            best.dir = (_dot(best.dir, ortho1) > _dot(best.dir, ortho2)) ? _normalize2(ortho1.x, ortho1.z) : _normalize2(ortho2.x, ortho2.z);
          }
          return best;
        } catch(_eNd2) { return null; }
      }
      // Small vector helpers
      function _norm2(x,z){ return Math.hypot(x,z)||0; }
      function _normalize2(x,z){ var L=_norm2(x,z); if(L<1e-6) return {x:0,z:0}; return {x:x/L, z:z/L}; }
      function _bevelPoint(cornerX,cornerZ, n1x,n1z, n2x,n2z, hw){ var sx=n1x+n2x, sz=n1z+n2z; var n=_normalize2(sx,sz); if(n.x===0 && n.z===0){ // fallback to n1
          n = _normalize2(n1x+n2x*0.0001, n1z+n2z*0.0001);
        }
        return { x: cornerX + n.x*hw, z: cornerZ + n.z*hw };
      }
      function _clampMiter(corner, interPt, n1x,n1z, n2x,n2z, hw, fallback){
        try{
          if (!interPt) return _bevelPoint(corner.x, corner.z, n1x,n1z, n2x,n2z, hw);
          var dist = Math.hypot(interPt.x - corner.x, interPt.z - corner.z);
          var maxLen = hw * 3.0; // clamp very sharp miters
          if (!isFinite(dist) || dist > maxLen) return _bevelPoint(corner.x, corner.z, n1x,n1z, n2x,n2z, hw);
          return interPt;
        } catch(_cm){ return fallback || interPt; }
      }
      // Basic 2D line intersection: p + a*d = q + b*e
      function intersectLines(p, d, q, e){
        var den = d.x * (-e.z) - d.z * (-e.x);
        if (Math.abs(den) < 1e-6) return null;
        var rx = q.x - p.x, rz = q.z - p.z;
        var a = (rx * (-e.z) - rz * (-e.x)) / den;
        return { x: p.x + a*d.x, z: p.z + a*d.z };
      }
      // Distance from point to segment with projection info
      function pointSegInfo(px,pz, x0s,z0s, x1s,z1s){
        var vx = x1s-x0s, vz = z1s-z0s; var L2 = vx*vx + vz*vz; if (L2 < 1e-9) return null;
        var ux = px - x0s, uz = pz - z0s; var u = (ux*vx + uz*vz)/L2;
        var clamped = Math.max(0, Math.min(1, u));
        var qx = x0s + clamped*vx, qz = z0s + clamped*vz;
        return { d: Math.hypot(px-qx, pz-qz), u: clamped, qx: qx, qz: qz, vx: vx, vz: vz };
      }
      // Find a T-junction target strip for endpoint (px,pz): close to mid-segment of another strip
      function findTJunction(px,pz){
        try {
          var gridRef = window.__segmentGrid || null; if (!gridRef) return null;
          var cellSize = gridRef.cellSize || 1.0;
          var ix = Math.floor((+px||0)/cellSize), iz = Math.floor((+pz||0)/cellSize);
          var lvl = (ws.level||0);
          function gkey(ix,iz){ return lvl+'|'+ix+'|'+iz; }
          var candidates = [];
          for (var dxg=-1; dxg<=1; dxg++){
            for (var dzg=-1; dzg<=1; dzg++){
              var k = gkey(ix+dxg, iz+dzg);
              var bucket = gridRef.grid[k]; if (!bucket || !bucket.length) continue;
              for (var bi=0; bi<bucket.length; bi++){
                var s = bucket[bi]; if (!s || s===ws) continue; if ((s.level||0)!==lvl) continue;
                candidates.push(s);
              }
            }
          }
          if (!candidates.length) return null;
          var best=null, bestD=1e9;
          for (var i=0; i<candidates.length; i++){
            var s=candidates[i]; var sx0=s.x0||0, sz0=s.z0||0, sx1=s.x1||0, sz1=s.z1||0;
            var info = pointSegInfo(px,pz, sx0,sz0, sx1,sz1); if (!info) continue;
            var endDistA = Math.hypot(info.qx - sx0, info.qz - sz0);
            var endDistB = Math.hypot(info.qx - sx1, info.qz - sz1);
            if (Math.min(endDistA, endDistB) < 0.06) continue;
            if (info.u > 0.02 && info.u < 0.98){
              if (info.d < bestD && info.d < 0.03){ best={ s:s, info:info }; bestD=info.d; }
            }
          }
          return best;
        } catch(_eTJ){ return null; }
      }

  // --- T-junction handling (butt join) ---  [Corner Config 007]
      var startT = findTJunction(x0, z0);
      var endT = findTJunction(x1, z1);
      // Precompute this strip's offset lines at endpoints
      var pL0 = {x:x0 + nx*hw, z:z0 + nz*hw}, pR0 = {x:x0 - nx*hw, z:z0 - nz*hw};
      var pL1 = {x:x1 + nx*hw, z:z1 + nz*hw}, pR1 = {x:x1 - nx*hw, z:z1 - nz*hw};

      function applyTTrimAtStart(t){
        var s = t.s; var inf = t.info; var svx = s.x1 - s.x0, svz = s.z1 - s.z0; var sl = Math.hypot(svx,svz)||1;
        var ts = {x: svx/sl, z: svz/sl}; var nsx = -ts.z, nsz = ts.x; // neighbor left normal
        var hwS = Math.max(0.02, (s.thickness||0.3)/2);
        // side sign: which face we touch
        var dxp = x0 - inf.qx, dzp = z0 - inf.qz; var side = ((dxp*nsx + dzp*nsz) >= 0) ? 1 : -1;
        var qFace = { x: inf.qx + nsx*side*hwS, z: inf.qz + nsz*side*hwS };
        var iL = intersectLines(pL0, tvec, qFace, ts);
        var iR = intersectLines(pR0, tvec, qFace, ts);
        if (iL){ A.x = iL.x; A.z = iL.z; }
        if (iR){ D.x = iR.x; D.z = iR.z; }
        // Extend this endpoint backward by half neighbor thickness so the cap is flush with neighbor's exterior face
        try {
          var ext = Math.max(0.01, (s.thickness||0.3) * 0.5);
          A.x -= tvec.x * ext; A.z -= tvec.z * ext;
          D.x -= tvec.x * ext; D.z -= tvec.z * ext;
        } catch(_eExt0) {}
      }
      function applyTTrimAtEnd(t){
        var s = t.s; var inf = t.info; var svx = s.x1 - s.x0, svz = s.z1 - s.z0; var sl = Math.hypot(svx,svz)||1;
        var ts = {x: svx/sl, z: svz/sl}; var nsx = -ts.z, nsz = ts.x;
        var hwS = Math.max(0.02, (s.thickness||0.3)/2);
        var dxp = x1 - inf.qx, dzp = z1 - inf.qz; var side = ((dxp*nsx + dzp*nsz) >= 0) ? 1 : -1;
        var qFace = { x: inf.qx + nsx*side*hwS, z: inf.qz + nsz*side*hwS };
        var iL = intersectLines(pL1, {x:-tvec.x, z:-tvec.z}, qFace, ts);
        var iR = intersectLines(pR1, {x:-tvec.x, z:-tvec.z}, qFace, ts);
        if (iL){ B.x = iL.x; B.z = iL.z; }
        if (iR){ C.x = iR.x; C.z = iR.z; }
        // Extend this endpoint forward by half neighbor thickness for a flush cap
        try {
          var ext = Math.max(0.01, (s.thickness||0.3) * 0.5);
          B.x += tvec.x * ext; B.z += tvec.z * ext;
          C.x += tvec.x * ext; C.z += tvec.z * ext;
        } catch(_eExt1) {}
      }
      var startIsT = false, endIsT = false;
      if (startT){ applyTTrimAtStart(startT); startIsT = true; }
      if (endT){ applyTTrimAtEnd(endT); endIsT = true; }
      
      // Apply manual corner overrides if they exist (all 8 corners)
      if (ws.__manualCorners) {
        if (ws.__manualCorners.A) { A.x = ws.__manualCorners.A.x; A.z = ws.__manualCorners.A.z; }
        if (ws.__manualCorners.B) { B.x = ws.__manualCorners.B.x; B.z = ws.__manualCorners.B.z; }
        if (ws.__manualCorners.C) { C.x = ws.__manualCorners.C.x; C.z = ws.__manualCorners.C.z; }
        if (ws.__manualCorners.D) { D.x = ws.__manualCorners.D.x; D.z = ws.__manualCorners.D.z; }
      }

      // Corner mitering (L-corners)
      // 007: default symmetric 45° miter; 007-Inner: for room perimeters, keep interior face uncut on concave corners only
      var isRoomPerimeter = !!ws[(window.__roomStripTag||'__fromRooms')];
      // Prefer consistent interior-left flag from generation; fallback to inverse of outerFaceLeft if needed
      var interiorLeftGlobal = (typeof ws.__interiorLeft === 'boolean')
        ? ws.__interiorLeft
        : ((typeof ws.__outerFaceLeft === 'boolean') ? (!ws.__outerFaceLeft) : null);
      // Determine concavity at endpoints using neighbor directions
      var __EPS_TURN = 1e-3;
      function classifyCornerAtStart(){
        try {
          var nb = getNeighborAt(x0, z0); if (!nb || interiorLeftGlobal==null) return { has:false, concave:false, convex:false };
          // Turn from neighbor segment toward this strip
          var cross = (nb.dir.x * tvec.z) - (nb.dir.z * tvec.x);
          var conc = interiorLeftGlobal ? (cross < -__EPS_TURN) : (cross > __EPS_TURN);
          var conv = interiorLeftGlobal ? (cross > __EPS_TURN)  : (cross < -__EPS_TURN);
          return { has:true, concave: conc, convex: conv };
        } catch(_e) { return { has:false, concave:false, convex:false }; }
      }
      function classifyCornerAtEnd(){
        try {
          var nb = getNeighborAt(x1, z1); if (!nb || interiorLeftGlobal==null) return { has:false, concave:false, convex:false };
          var back = { x: -tvec.x, z: -tvec.z };
          var cross = (nb.dir.x * back.z) - (nb.dir.z * back.x);
          var conc = interiorLeftGlobal ? (cross < -__EPS_TURN) : (cross > __EPS_TURN);
          var conv = interiorLeftGlobal ? (cross > __EPS_TURN)  : (cross < -__EPS_TURN);
          return { has:true, concave: conc, convex: conv };
        } catch(_e) { return { has:false, concave:false, convex:false }; }
      }
      var __startClass = classifyCornerAtStart();
      var __endClass = classifyCornerAtEnd();
      var startConcave = __startClass.concave;
      var endConcave = __endClass.concave;
      var startConvex = __startClass.convex;
      var endConvex = __endClass.convex;
      
      // ALWAYS check interior corner cache at start, even before classification
      var cachedIntStart = null;
      try {
        var __intKeyStart = (ws.level||0) + '|' + Math.round(x0*100) + '|' + Math.round(z0*100) + '|int';
        if (window.__intCornerSnap && window.__intCornerSnap[__intKeyStart]) {
          cachedIntStart = window.__intCornerSnap[__intKeyStart];
          if (window.__debugCornerCache) console.log('START CACHE HIT:', __intKeyStart, cachedIntStart);
        }
      } catch(_e) {}
      
      // ALWAYS check interior corner cache at end
      var cachedIntEnd = null;
      try {
        var __intKeyEnd = (ws.level||0) + '|' + Math.round(x1*100) + '|' + Math.round(z1*100) + '|int';
        if (window.__intCornerSnap && window.__intCornerSnap[__intKeyEnd]) {
          cachedIntEnd = window.__intCornerSnap[__intKeyEnd];
          if (window.__debugCornerCache) console.log('END CACHE HIT:', __intKeyEnd, cachedIntEnd);
        }
      } catch(_e) {}
      
      // 007-start: local diagonal (t + n) — compute both interior and exterior intersections when neighbor exists
      if (!startIsT){
        var corner0 = { x:x0, z:z0 };
        var dxs = tvec.x + nx, dzs = tvec.z + nz; var dl = Math.hypot(dxs, dzs);
        if (dl > 1e-6){
          var cutDir = { x: dxs/dl, z: dzs/dl };
          var pL0s = { x: corner0.x + nx*hw, z: corner0.z + nz*hw };
          var pR0s = { x: corner0.x - nx*hw, z: corner0.z - nz*hw };
          var iL0 = intersectLines(pL0s, tvec, corner0, cutDir);
          var iR0 = intersectLines(pR0s, tvec, corner0, cutDir);
          
          // ALWAYS compute interior corner intersection when neighbor exists
          var nb0 = getNeighborAt(x0, z0);
          var iInt0 = cachedIntStart; // Use cached value if available
          if (!iInt0 && nb0 && nb0.s){
            // For concave interior corners: compute where interior faces meet
            var hwN = Math.max(0.02, (nb0.s.thickness||0.3)/2);
            var intLeftN = (typeof nb0.s.__interiorLeft==='boolean') ? nb0.s.__interiorLeft : ((typeof nb0.s.__outerFaceLeft==='boolean') ? (!nb0.s.__outerFaceLeft) : null);
            var nbTangent = { x: nb0.dir.x, z: nb0.dir.z };
            var nbNormal = { x: -nbTangent.z, z: nbTangent.x };
            
            // Determine which face is interior on neighbor
            var nbIntSign = (intLeftN===true) ? 1 : -1;
            var nbIntOffset = { x: corner0.x + nbNormal.x * nbIntSign * hwN, z: corner0.z + nbNormal.z * nbIntSign * hwN };
            
            // Determine which face is interior on THIS wall
            var thisIntLeft = (typeof ws.__interiorLeft==='boolean') ? ws.__interiorLeft : ((typeof ws.__outerFaceLeft==='boolean') ? (!ws.__outerFaceLeft) : null);
            
            if (thisIntLeft === true){
              iInt0 = intersectLines(pL0s, tvec, nbIntOffset, nbTangent);
            } else if (thisIntLeft === false){
              iInt0 = intersectLines(pR0s, tvec, nbIntOffset, nbTangent);
            }
            
            try {
              if (iInt0) {
                var __intKey0w = (ws.level||0) + '|' + Math.round(corner0.x*100) + '|' + Math.round(corner0.z*100) + '|int';
                window.__intCornerSnap[__intKey0w] = { x: iInt0.x, z: iInt0.z };
                if (window.__debugCornerCache) console.log('START CACHE WRITE:', __intKey0w, iInt0, 'thisIntLeft=', thisIntLeft);
              }
            } catch(_eIntSnap0Wr) {}
          }

          // Compute exterior corner intersection when neighbor exists (always), independent of convex classification
          var iExt0 = null;
          try {
            if (nb0 && nb0.s){
              var tsx = nb0.dir.x, tsz = nb0.dir.z; var nsx = -tsz, nsz = tsx;
              var hwN2 = Math.max(0.02, (nb0.s.thickness||0.3)/2);
              var intLeftN2 = (typeof nb0.s.__interiorLeft==='boolean') ? nb0.s.__interiorLeft : ((typeof nb0.s.__outerFaceLeft==='boolean') ? (!nb0.s.__outerFaceLeft) : null);
              var exSignN = (intLeftN2===true) ? -1 : 1; // exterior is right if neighbor interiorLeft
              var qOut0 = { x: corner0.x + nsx*exSignN*hwN2, z: corner0.z + nsz*exSignN*hwN2 };
              var pOut0 = interiorLeftGlobal ? pR0s : pL0s; // our exterior at start
              var dOut0 = tvec; var eOut0 = { x: tsx, z: tsz };
              iExt0 = intersectLines(pOut0, dOut0, qOut0, eOut0);
            }
          } catch(_eX0All) { iExt0 = null; }
          
          // If the neighbor forms a true 90° L-corner, force a square (butt) corner instead of a 45° miter
          var forceSquare0 = false;
          try { if (nb0 && nb0.dir){ var ang0 = angleBetween(tvec, nb0.dir); if (Math.abs(ang0 - (Math.PI/2)) < 0.12) forceSquare0 = true; } } catch(_eAng0) {}
          if (forceSquare0) {
            // Square join: keep endpoints exactly at their offset corner without diagonal trimming
            A.x = pL0s.x; A.z = pL0s.z;
            D.x = pR0s.x; D.z = pR0s.z;
            // Extend backward by half of neighbor thickness so cap is flush with neighbor's exterior face
            try {
              var extSq0 = (nb0 && nb0.s && nb0.s.thickness ? nb0.s.thickness : (ws.thickness||0.3)) * 0.5;
              A.x -= tvec.x * extSq0; A.z -= tvec.z * extSq0;
              D.x -= tvec.x * extSq0; D.z -= tvec.z * extSq0;
            } catch(_eSq0) {}
          } else {
            // Apply snapped intersections prioritizing seamless joins on both faces
            var thisIntLeft2 = (typeof ws.__interiorLeft==='boolean') ? ws.__interiorLeft : ((typeof ws.__outerFaceLeft==='boolean') ? (!ws.__outerFaceLeft) : null);
            if (thisIntLeft2 === true){
              // A is interior, D is exterior
              if (iInt0) { A.x = iInt0.x; A.z = iInt0.z; } else if (iL0) { A.x = iL0.x; A.z = iL0.z; } else { A.x = pL0s.x; A.z = pL0s.z; }
              if (iExt0) { D.x = iExt0.x; D.z = iExt0.z; } else if (iR0) { D.x = iR0.x; D.z = iR0.z; } else { D.x = pR0s.x; D.z = pR0s.z; }
            } else if (thisIntLeft2 === false){
              // D is interior, A is exterior
              if (iInt0) { D.x = iInt0.x; D.z = iInt0.z; } else if (iR0) { D.x = iR0.x; D.z = iR0.z; } else { D.x = pR0s.x; D.z = pR0s.z; }
              if (iExt0) { A.x = iExt0.x; A.z = iExt0.z; } else if (iL0) { A.x = iL0.x; A.z = iL0.z; } else { A.x = pL0s.x; A.z = pL0s.z; }
            } else {
              // Unknown interior side: keep symmetric miter
              if (iL0){ A.x = iL0.x; A.z = iL0.z; }
              if (iR0){ D.x = iR0.x; D.z = iR0.z; }
            }
          }
        }
      }
      // 007-end: local diagonal (t − n) — compute both interior and exterior intersections when neighbor exists
      if (!endIsT){
        var corner1 = { x:x1, z:z1 };
        var dxse = tvec.x - nx, dzse = tvec.z - nz; var dle = Math.hypot(dxse, dzse);
        if (dle > 1e-6){
          var cutDirE = { x: dxse/dle, z: dzse/dle };
          var pL1s = { x: corner1.x + nx*hw, z: corner1.z + nz*hw };
          var pR1s = { x: corner1.x - nx*hw, z: corner1.z - nz*hw };
          var back = { x: -tvec.x, z: -tvec.z };
          var iL1 = intersectLines(pL1s, back, corner1, cutDirE);
          var iR1 = intersectLines(pR1s, back, corner1, cutDirE);
          
          // ALWAYS compute interior corner intersection when neighbor exists
          var nb1 = getNeighborAt(x1, z1);
          var iInt1 = cachedIntEnd; // Use cached value if available
          if (!iInt1 && nb1 && nb1.s){
            // For concave interior corners: compute where interior faces meet
            var hwN = Math.max(0.02, (nb1.s.thickness||0.3)/2);
            var intLeftN = (typeof nb1.s.__interiorLeft==='boolean') ? nb1.s.__interiorLeft : ((typeof nb1.s.__outerFaceLeft==='boolean') ? (!nb1.s.__outerFaceLeft) : null);
            var nbTangent = { x: nb1.dir.x, z: nb1.dir.z };
            var nbNormal = { x: -nbTangent.z, z: nbTangent.x };
            
            // Determine which face is interior on neighbor
            var nbIntSign = (intLeftN===true) ? 1 : -1;
            var nbIntOffset = { x: corner1.x + nbNormal.x * nbIntSign * hwN, z: corner1.z + nbNormal.z * nbIntSign * hwN };
            
            // Determine which face is interior on THIS wall
            var thisIntLeft = (typeof ws.__interiorLeft==='boolean') ? ws.__interiorLeft : ((typeof ws.__outerFaceLeft==='boolean') ? (!ws.__outerFaceLeft) : null);
            
            if (thisIntLeft === true){
              iInt1 = intersectLines(pL1s, back, nbIntOffset, nbTangent);
            } else if (thisIntLeft === false){
              iInt1 = intersectLines(pR1s, back, nbIntOffset, nbTangent);
            }
            
            try {
              if (iInt1) {
                var __intKey1w = (ws.level||0) + '|' + Math.round(corner1.x*100) + '|' + Math.round(corner1.z*100) + '|int';
                window.__intCornerSnap[__intKey1w] = { x: iInt1.x, z: iInt1.z };
                if (window.__debugCornerCache) console.log('END CACHE WRITE:', __intKey1w, iInt1, 'thisIntLeft=', thisIntLeft);
              }
            } catch(_eIntSnap1Wr) {}
          }

          // Compute exterior intersection at end when neighbor exists
          var iExt1 = null;
          try {
            if (nb1 && nb1.s){
              var tsx = nb1.dir.x, tsz = nb1.dir.z; var nsx = -tsz, nsz = tsx;
              var hwN2 = Math.max(0.02, (nb1.s.thickness||0.3)/2);
              var intLeftN2 = (typeof nb1.s.__interiorLeft==='boolean') ? nb1.s.__interiorLeft : ((typeof nb1.s.__outerFaceLeft==='boolean') ? (!nb1.s.__outerFaceLeft) : null);
              var exSignN = (intLeftN2===true) ? -1 : 1;
              var qOut1 = { x: corner1.x + nsx*exSignN*hwN2, z: corner1.z + nsz*exSignN*hwN2 };
              var pOut1 = interiorLeftGlobal ? pR1s : pL1s; // our exterior at end
              var dOut1 = { x: -tvec.x, z: -tvec.z }; var eOut1 = { x: tsx, z: tsz };
              iExt1 = intersectLines(pOut1, dOut1, qOut1, eOut1);
            }
          } catch(_eX1All) { iExt1 = null; }
          
          // Force square (butt) corner at true 90°
          var forceSquare1 = false;
          try { if (nb1 && nb1.dir){ var ang1 = angleBetween(tvec, nb1.dir); if (Math.abs(ang1 - (Math.PI/2)) < 0.12) forceSquare1 = true; } } catch(_eAng1) {}
          if (forceSquare1) {
            B.x = pL1s.x; B.z = pL1s.z;
            C.x = pR1s.x; C.z = pR1s.z;
            // Extend forward by half of neighbor thickness for flush cap
            try {
              var extSq1 = (nb1 && nb1.s && nb1.s.thickness ? nb1.s.thickness : (ws.thickness||0.3)) * 0.5;
              B.x += tvec.x * extSq1; B.z += tvec.z * extSq1;
              C.x += tvec.x * extSq1; C.z += tvec.z * extSq1;
            } catch(_eSq1) {}
          } else {
            // Apply snapped intersections on both faces
            var thisIntLeftE = (typeof ws.__interiorLeft==='boolean') ? ws.__interiorLeft : ((typeof ws.__outerFaceLeft==='boolean') ? (!ws.__outerFaceLeft) : null);
            if (thisIntLeftE === true){
              // B is interior, C is exterior
              if (iInt1) { B.x = iInt1.x; B.z = iInt1.z; } else if (iL1) { B.x = iL1.x; B.z = iL1.z; } else { B.x = pL1s.x; B.z = pL1s.z; }
              if (iExt1) { C.x = iExt1.x; C.z = iExt1.z; } else if (iR1) { C.x = iR1.x; C.z = iR1.z; } else { C.x = pR1s.x; C.z = pR1s.z; }
            } else if (thisIntLeftE === false){
              // C is interior, B is exterior
              if (iInt1) { C.x = iInt1.x; C.z = iInt1.z; } else if (iR1) { C.x = iR1.x; C.z = iR1.z; } else { C.x = pR1s.x; C.z = pR1s.z; }
              if (iExt1) { B.x = iExt1.x; B.z = iExt1.z; } else if (iL1) { B.x = iL1.x; B.z = iL1.z; } else { B.x = pL1s.x; B.z = pL1s.z; }
            } else {
              if (iL1){ B.x = iL1.x; B.z = iL1.z; }
              if (iR1){ C.x = iR1.x; C.z = iR1.z; }
            }
          }
        }
      }

      var At = {x:A.x, y:baseY+h, z:A.z};
      var Bt = {x:B.x, y:baseY+h, z:B.z};
      var Ct = {x:C.x, y:baseY+h, z:C.z};
      var Dt = {x:D.x, y:baseY+h, z:D.z};
      
      // Apply manual top corner overrides if they exist (all 4 top corners)
      if (ws.__manualCorners) {
        if (ws.__manualCorners.At) { At.x = ws.__manualCorners.At.x; At.z = ws.__manualCorners.At.z; }
        if (ws.__manualCorners.Bt) { Bt.x = ws.__manualCorners.Bt.x; Bt.z = ws.__manualCorners.Bt.z; }
        if (ws.__manualCorners.Ct) { Ct.x = ws.__manualCorners.Ct.x; Ct.z = ws.__manualCorners.Ct.z; }
        if (ws.__manualCorners.Dt) { Dt.x = ws.__manualCorners.Dt.x; Dt.z = ws.__manualCorners.Dt.z; }
      }
      
      // Project (after potential miter adjustments)
  var pA=project3D(A.x,A.y,A.z), pB=project3D(B.x,B.y,B.z), pC=project3D(C.x,C.y,C.z), pD=project3D(D.x,D.y,D.z);
    var pAt=project3D(At.x,At.y,At.z), pBt=project3D(Bt.x,Bt.y,Bt.z), pCt=project3D(Ct.x,Ct.y,Ct.z), pDt=project3D(Dt.x,Dt.y,Dt.z);
    // Do not early-return if some points are behind or near-plane clamped; draw whatever faces are valid
      ctx.save();
  // Solid mode: translucent faces per requirement; keep lines subtle and seal micro-gaps
  var edgeCol = onLevel ? 'rgba(71,85,105,0.35)' : 'rgba(148,163,184,0.35)';
  var fillTop = onLevel ? 'rgba(100,116,139,0.20)' : 'rgba(148,163,184,0.15)';
  // Base side tone for solid faces; we modulate per-face by camera perspective so render walls "follow" camera like keyline walls
  var __baseSide = onLevel ? {r:71,g:85,b:105,a:0.26} : {r:148,g:163,b:184,a:0.18};
      ctx.lineWidth = onLevel ? 2.2 : 1.4;
      ctx.strokeStyle = edgeCol;
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 8;
      // Build opening holes for left and right faces; also collect window glass quads (centered)
      var openings = Array.isArray(ws.openings) ? ws.openings : [];
      var stripTopY = baseY + (typeof ws.height === 'number' ? ws.height : 3.0);
      var eps = 0.001;
      // Holes for side faces (windows + doors) so only the opening rectangle is removed, leaving wall above & below.
      var leftHoles = [];
      var rightHoles = [];
      // Center-plane glass quads for windows (drawn after holes so glass sits inside cutout).
      var glassRects = [];
      var windowFrameRects = []; // store projected glass rects for framing (windows only)
      var doorRects = []; // door face quads (left + right merged center representation)
      for (var oi=0; oi<openings.length; oi++){
        var op = openings[oi]; if(!op) continue;
        var isDoor = (op.type==='door');
        var isWindow = (op.type==='window');
        // Derive sill & height from opening data; fallback to defaults.
        var defaultWinSill = 0.9; // meters
        var defaultWinHeight = 1.5; // meters (updated requirement)
        var sill = isDoor ? 0 : (typeof op.sillM==='number' ? op.sillM : defaultWinSill);
        var oH = isDoor ? ((typeof op.heightM==='number') ? op.heightM : 2.04) : (typeof op.heightM==='number' ? op.heightM : defaultWinHeight);
        // Debug: log opening processing
        if (isWindow && window.__debugOpenings) {
          console.log('[engine3d] Window opening:', {
            type: op.type,
            sillM: op.sillM,
            heightM: op.heightM,
            computedSill: sill,
            computedHeight: oH,
            baseY: baseY,
            y0: baseY + sill,
            y1: Math.min(baseY + sill + oH, stripTopY)
          });
        }
        // Full-height window detection: sill==0 and height approx full strip height.
        var fullHeightWindow = false;
        if (isWindow) {
          var wallH = stripTopY - baseY;
          if (sill <= 0.02 && (oH >= wallH - 0.02 || Math.abs((sill+oH) - wallH) < 0.02)) fullHeightWindow = true;
        }
        var y0 = fullHeightWindow ? baseY : (baseY + sill);
        var y1 = Math.min(y0 + oH, stripTopY);
        // endpoints along the strip (fallback to full segment if not provided)
        var x0o = (op.x0!=null? op.x0 : x0), z0o = (op.z0!=null? op.z0 : z0);
        var x1o = (op.x1!=null? op.x1 : x1), z1o = (op.z1!=null? op.z1 : z1);
        if (isDoor) {
          // Doors punch holes through side faces and get a visible overlay rectangle
          var lx0 = x0o + nx*eps, lz0 = z0o + nz*eps;
          var lx1 = x1o + nx*eps, lz1 = z1o + nz*eps;
          var lA = project3D(lx0, y0, lz0); var lB = project3D(lx1, y0, lz1);
          var lC = project3D(lx1, y1, lz1); var lD = project3D(lx0, y1, lz0);
          if (lA && lB && lC && lD) leftHoles.push([lA,lB,lC,lD]);
          var rx0 = x0o - nx*eps, rz0 = z0o - nz*eps;
          var rx1 = x1o - nx*eps, rz1 = z1o - nz*eps;
          var rA = project3D(rx0, y0, rz0); var rB = project3D(rx1, y0, rz1);
          var rC = project3D(rx1, y1, rz1); var rD = project3D(rx0, y1, rz0);
          if (rA && rB && rC && rD) rightHoles.push([rA,rB,rC,rD]);
          // Store a representative rectangle (use left face if available, else center plane)
          if (lA && lB && lC && lD) doorRects.push([lA,lB,lC,lD]);
          else if (rA && rB && rC && rD) doorRects.push([rA,rB,rC,rD]);
          else {
            var dA = project3D(x0o, y0, z0o), dB = project3D(x1o, y0, z1o), dC = project3D(x1o, y1, z1o), dD = project3D(x0o, y1, z0o);
            if (dA && dB && dC && dD) doorRects.push([dA,dB,dC,dD]);
          }
        } else {
          // Window: punch hole only from sill to sill+height (leave wall below and above) and add center glass.
          // Use computed y0 and y1 from opening data (sill and height already set above).
          var gA = project3D(x0o, y0, z0o); var gB = project3D(x1o, y0, z1o);
          var gC = project3D(x1o, y1, z1o); var gD = project3D(x0o, y1, z0o);
          if (gA && gB && gC && gD) { glassRects.push([gA,gB,gC,gD]); windowFrameRects.push([gA,gB,gC,gD]); }
          // Side face hole quads
          var wlA = project3D(x0o + nx*eps, y0, z0o + nz*eps); var wlB = project3D(x1o + nx*eps, y0, z1o + nz*eps);
          var wlC = project3D(x1o + nx*eps, y1, z1o + nz*eps); var wlD = project3D(x0o + nx*eps, y1, z0o + nz*eps);
          if (wlA && wlB && wlC && wlD) leftHoles.push([wlA,wlB,wlC,wlD]);
          var wrA = project3D(x0o - nx*eps, y0, z0o - nz*eps); var wrB = project3D(x1o - nx*eps, y0, z1o - nz*eps);
          var wrC = project3D(x1o - nx*eps, y1, z1o - nz*eps); var wrD = project3D(x0o - nx*eps, y1, z0o - nz*eps);
          if (wrA && wrB && wrC && wrD) rightHoles.push([wrA,wrB,wrC,wrD]);
          // Fallback: if center glass failed due to projection clipping, synthesize from a side hole quad.
          if (!(gA && gB && gC && gD)) {
            var fb = (leftHoles.length && leftHoles[leftHoles.length-1]) || (rightHoles.length && rightHoles[rightHoles.length-1]) || null;
            if (fb) { glassRects.push(fb); windowFrameRects.push(fb); }
          }
        }
      }
      function fillQuadWithHoles(p0,p1,p2,p3, holes, fill){
        ctx.beginPath();
        // outer face polygon
        ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.closePath();
        // holes (subpaths)
        for (var hi=0; hi<holes.length; hi++){
          var H = holes[hi]; if(!H||H.length!==4) continue;
          ctx.moveTo(H[0].x, H[0].y); ctx.lineTo(H[1].x, H[1].y); ctx.lineTo(H[2].x, H[2].y); ctx.lineTo(H[3].x, H[3].y); ctx.closePath();
        }
        ctx.fillStyle = fill; ctx.fill('evenodd');
      }
      var canLeft = (pA&&pB&&pBt&&pAt);
      var canRight = (pD&&pC&&pCt&&pDt);
      var canTop = (pAt&&pBt&&pCt&&pDt);
      var canBottom = (pA&&pB&&pC&&pD);
      var drewFace = false;
      // Compute simple Lambert-like shading from camera forward to face normal to follow perspective
      function __shade(dot){
        var t = Math.max(0, Math.min(1, 0.5*dot + 0.5)); // [-1,1] -> [0,1]
        var k = 0.55 + 0.45*t; // brightness factor
        var a = Math.max(0.12, Math.min(0.9, __baseSide.a * (0.8 + 0.5*t)));
        return 'rgba(' + Math.round(__baseSide.r*k) + ',' + Math.round(__baseSide.g*k) + ',' + Math.round(__baseSide.b*k) + ',' + a.toFixed(3) + ')';
      }
      var __fwd = (__proj && __proj.fwd) ? __proj.fwd : [0,0,1];
      var __dotLeft = nx*(__fwd[0]||0) + nz*(__fwd[2]||0);
  var __dotRight = (-nx)*(__fwd[0]||0) + (-nz)*(__fwd[2]||0);
      var __fillLeft = __shade(__dotLeft);
      var __fillRight = __shade(__dotRight);
      // Fill sides with holes to cut out windows/doors (only when all four projected points exist)
      if (canLeft)  { fillQuadWithHoles(pA,pB,pBt,pAt, leftHoles, __fillLeft); drewFace = true; }
      if (canRight) { fillQuadWithHoles(pD,pC,pCt,pDt, rightHoles, __fillRight); drewFace = true; }
  // Top face fill only (when valid)
  if (canTop) {
    ctx.beginPath(); ctx.moveTo(pAt.x,pAt.y); ctx.lineTo(pBt.x,pBt.y); ctx.lineTo(pCt.x,pCt.y); ctx.lineTo(pDt.x,pDt.y); ctx.closePath(); ctx.fillStyle = fillTop; ctx.fill();
    // Seal top perimeter with a low-contrast stroke to hide 1px gaps due to rounding
    ctx.save();
    ctx.strokeStyle = onLevel ? 'rgba(71,85,105,0.22)' : 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.moveTo(pAt.x,pAt.y); ctx.lineTo(pBt.x,pBt.y); ctx.lineTo(pCt.x,pCt.y); ctx.lineTo(pDt.x,pDt.y); ctx.closePath(); ctx.stroke();
    ctx.restore();
    drewFace = true;
  }
  // Bottom face fill (when valid) to ensure closed prism (cube)
  if (canBottom) {
    ctx.beginPath(); ctx.moveTo(pA.x,pA.y); ctx.lineTo(pB.x,pB.y); ctx.lineTo(pC.x,pC.y); ctx.lineTo(pD.x,pD.y); ctx.closePath();
    ctx.fillStyle = onLevel ? 'rgba(71,85,105,0.12)' : 'rgba(148,163,184,0.1)';
    ctx.fill();
    // Light stroke to seal rounding seams on floor
    ctx.save();
    ctx.strokeStyle = onLevel ? 'rgba(71,85,105,0.18)' : 'rgba(148,163,184,0.14)';
    ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.moveTo(pA.x,pA.y); ctx.lineTo(pB.x,pB.y); ctx.lineTo(pC.x,pC.y); ctx.lineTo(pD.x,pD.y); ctx.closePath(); ctx.stroke();
    ctx.restore();
    drewFace = true;
  }
      // End caps: draw flat end faces for walls that do not connect to another wall at the endpoint,
      // or when they butt into another wall mid-segment (T-junction). This makes isolated or terminating
      // walls appear with a clean flat end in solid render mode.
      var __dotStart = (-tvec.x) * (__fwd[0]||0) + (-tvec.z) * (__fwd[2]||0);
      var __dotEnd   = ( tvec.x) * (__fwd[0]||0) + ( tvec.z) * (__fwd[2]||0);
      var __fillCapStart = __shade(__dotStart);
      var __fillCapEnd   = __shade(__dotEnd);
      var canStartCap = (pD && pA && pAt && pDt);
      var canEndCap   = (pB && pC && pCt && pBt);
      // Determine if neighboring strip connects at endpoints to skip caps for true corners
      function hasNeighborAt(wx, wz){
        try {
          var EPS = 1e-3;
          var arr = window.wallStrips || [];
          for (var ii=0; ii<arr.length; ii++){
            var s = arr[ii]; if(!s || s===ws) continue;
            if ((s.level||0) !== (ws.level||0)) continue; // same level only
            var d0 = Math.hypot((s.x0||0) - wx, (s.z0||0) - wz);
            var d1 = Math.hypot((s.x1||0) - wx, (s.z1||0) - wz);
            if (d0 < EPS || d1 < EPS) return true;
          }
        } catch(_eN) {}
        return false;
      }
      var __startHasNeighbor = hasNeighborAt(x0, z0) || startIsT;
      var __endHasNeighbor   = hasNeighborAt(x1, z1) || endIsT;
      // Start cap (D->A->At->Dt)
      if (canStartCap && (!__startHasNeighbor || startIsT)){
        ctx.beginPath();
        ctx.moveTo(pD.x, pD.y); ctx.lineTo(pA.x, pA.y); ctx.lineTo(pAt.x, pAt.y); ctx.lineTo(pDt.x, pDt.y); ctx.closePath();
        ctx.fillStyle = __fillCapStart; ctx.fill();
        drewFace = true;
      }
      // End cap (B->C->Ct->Bt)
      if (canEndCap && (!__endHasNeighbor || endIsT)){
        ctx.beginPath();
        ctx.moveTo(pB.x, pB.y); ctx.lineTo(pC.x, pC.y); ctx.lineTo(pCt.x, pCt.y); ctx.lineTo(pBt.x, pBt.y); ctx.closePath();
        ctx.fillStyle = __fillCapEnd; ctx.fill();
        drewFace = true;
      }
      // Fallback: if no face could be drawn (all four-point faces invalid), draw a centerline at mid-height
      if (!drewFace) {
        var yMid = baseY + Math.min(h*0.5, 1.2);
        var cp0 = project3D(x0, yMid, z0), cp1 = project3D(x1, yMid, z1);
        if (cp0 && cp1) {
          ctx.save();
          ctx.strokeStyle = onLevel ? 'rgba(100,116,139,0.9)' : 'rgba(148,163,184,0.8)';
          ctx.lineWidth = onLevel ? 2.0 : 1.2;
          ctx.beginPath(); ctx.moveTo(cp0.x, cp0.y); ctx.lineTo(cp1.x, cp1.y); ctx.stroke();
          ctx.restore();
        } else {
          // Last-ditch: draw any available projected corner as a small dot so the wall is never fully invisible
          var pts = [pA,pB,pC,pD,pAt,pBt,pCt,pDt];
          for (var pi=0; pi<pts.length; pi++){
            var P = pts[pi]; if (!P) continue;
            ctx.save(); ctx.fillStyle = onLevel ? 'rgba(100,116,139,0.95)' : 'rgba(148,163,184,0.85)';
            ctx.beginPath(); ctx.arc(P.x, P.y, 2, 0, Math.PI*2); ctx.fill(); ctx.restore();
          }
        }
      }
      // Draw corner codes near endpoints at a readable height
      var labelY = baseY + Math.min(h*0.5, 1.1);
      drawCornerCodeAt(x0, labelY, z0);
      drawCornerCodeAt(x1, labelY, z1);
      // Determine if neighboring strip connects at endpoints to skip cap strokes for flush corners
      function hasNeighborAt(wx, wz){
        try {
          var EPS = 1e-3;
          var arr = window.wallStrips || [];
          for (var ii=0; ii<arr.length; ii++){
            var s = arr[ii]; if(!s || s===ws) continue;
            // Same-level only
            if ((s.level||0) !== (ws.level||0)) continue;
            var d0 = Math.hypot((s.x0||0) - wx, (s.z0||0) - wz);
            var d1 = Math.hypot((s.x1||0) - wx, (s.z1||0) - wz);
            if (d0 < EPS || d1 < EPS) return true;
          }
        } catch(_eN) {}
        return false;
      }
  var startHasNeighbor = hasNeighborAt(x0, z0) || startIsT;
  var endHasNeighbor = hasNeighborAt(x1, z1) || endIsT;
  // Stroke all 12 edges of the wall rectangular prism to form a complete wireframe cube
  ctx.beginPath();
  // Top face - 4 edges
  if (pAt && pBt) { ctx.moveTo(pAt.x,pAt.y); ctx.lineTo(pBt.x,pBt.y); }
  if (pBt && pCt) { ctx.moveTo(pBt.x,pBt.y); ctx.lineTo(pCt.x,pCt.y); }
  if (pCt && pDt) { ctx.moveTo(pCt.x,pCt.y); ctx.lineTo(pDt.x,pDt.y); }
  if (pDt && pAt) { ctx.moveTo(pDt.x,pDt.y); ctx.lineTo(pAt.x,pAt.y); }
  // Bottom face - 4 edges
  if (pA && pB) { ctx.moveTo(pA.x,pA.y); ctx.lineTo(pB.x,pB.y); }
  if (pB && pC) { ctx.moveTo(pB.x,pB.y); ctx.lineTo(pC.x,pC.y); }
  if (pC && pD) { ctx.moveTo(pC.x,pC.y); ctx.lineTo(pD.x,pD.y); }
  if (pD && pA) { ctx.moveTo(pD.x,pD.y); ctx.lineTo(pA.x,pA.y); }
  // Vertical edges - 4 edges connecting bottom to top
  if (pA && pAt) { ctx.moveTo(pA.x,pA.y); ctx.lineTo(pAt.x,pAt.y); }
  if (pB && pBt) { ctx.moveTo(pB.x,pB.y); ctx.lineTo(pBt.x,pBt.y); }
  if (pC && pCt) { ctx.moveTo(pC.x,pC.y); ctx.lineTo(pCt.x,pCt.y); }
  if (pD && pDt) { ctx.moveTo(pD.x,pD.y); ctx.lineTo(pDt.x,pDt.y); }
  ctx.stroke();
      
      // Store corner positions for draggable handles (only if enabled)
      if (!window.__cornerHandles) window.__cornerHandles = [];
      
      // Function to draw draggable handle (all corners draggable)
      function drawDraggableHandle(p, num, label, worldPos, ws, vertexKey){
        if (!p) return;
        var handleRadius = 8;
        
        // Draw handle circle
        ctx.save();
        ctx.fillStyle = 'rgba(100,200,255,0.8)';
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, handleRadius, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        
        // Draw label
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(label, p.x, p.y);
        ctx.fillText(label, p.x, p.y);
        ctx.restore();
        
        // Store for interaction
        window.__cornerHandles.push({
          x: p.x,
          y: p.y,
          radius: handleRadius,
          worldPos: worldPos,
          wallStrip: ws,
          vertexKey: vertexKey,
          label: label
        });
      }
      
      // Gate drawing of handles behind a flag to avoid per-frame overhead unless needed
      var __drawHandles = (window.__enableCornerHandles === true);
      if (__drawHandles) {
        // Bottom corners: 1=A, 2=B, 3=C, 4=D
        drawDraggableHandle(pA, 1, '1', A, ws, 'A');
        drawDraggableHandle(pB, 2, '2', B, ws, 'B');
        drawDraggableHandle(pC, 3, '3', C, ws, 'C');
        drawDraggableHandle(pD, 4, '4', D, ws, 'D');
        // Top corners: 5=At, 6=Bt, 7=Ct, 8=Dt
        drawDraggableHandle(pAt, 5, '5', At, ws, 'At');
        drawDraggableHandle(pBt, 6, '6', Bt, ws, 'Bt');
        drawDraggableHandle(pCt, 7, '7', Ct, ws, 'Ct');
        drawDraggableHandle(pDt, 8, '8', Dt, ws, 'Dt');
      }
      drawCornerLabel(pDt, 8, '8');
      // Draw translucent blue glass for windows (center plane only)
      // Higher saturation blue for glass; configurable via window.__windowGlassColor
      var glassFill = (window.__windowGlassColor) ? window.__windowGlassColor : 'rgba(59,130,246,0.75)';
      var glassStroke = onLevel ? 'rgba(30,64,175,0.95)' : 'rgba(30,64,175,0.85)';
      function drawGlassQuad(Q){
        ctx.beginPath();
        ctx.moveTo(Q[0].x,Q[0].y); ctx.lineTo(Q[1].x,Q[1].y); ctx.lineTo(Q[2].x,Q[2].y); ctx.lineTo(Q[3].x,Q[3].y); ctx.closePath();
        ctx.fillStyle = glassFill; ctx.fill();
        ctx.strokeStyle = glassStroke; ctx.lineWidth = onLevel ? 1.6 : 1.1; ctx.stroke();
      }
      if (glassRects.length){
        for (var gi=0; gi<glassRects.length; gi++){
          var GQ = glassRects[gi]; if(!GQ||GQ.length!==4) continue; drawGlassQuad(GQ);
        }
        if (window.__debugWindowGlass){ console.log('[WindowGlass] drew', glassRects.length, 'explicit glass rects; color=', glassFill); }
      } else if (windowFrameRects.length){
        // Fallback: synthesize a glass quad inset from first frame rect to guarantee blue fill.
        var FR = windowFrameRects[0];
        if (FR && FR.length===4){
          var synthInset = 0.12;
          var cx = (FR[0].x+FR[1].x+FR[2].x+FR[3].x)/4;
          var cy = (FR[0].y+FR[1].y+FR[2].y+FR[3].y)/4;
          var G = [];
          for (var si=0; si<4; si++){ var P=FR[si]; G.push({ x: P.x + (cx-P.x)*synthInset, y: P.y + (cy-P.y)*synthInset }); }
          drawGlassQuad(G);
          if (window.__debugWindowGlass){ console.warn('[WindowGlass] fallback synthetic glass drawn; color=', glassFill); }
        }
      }
      // Draw window frames (90° corners) as crisp border strokes around glass opening
      if (windowFrameRects.length){
        ctx.save();
        ctx.lineJoin = 'miter'; ctx.miterLimit = 6;
        for (var wf=0; wf<windowFrameRects.length; wf++){
          var FR = windowFrameRects[wf]; if(!FR||FR.length!==4) continue;
          // Outer jamb/frame outline to sharpen junction between wall and recess
          ctx.beginPath(); ctx.moveTo(FR[0].x,FR[0].y); ctx.lineTo(FR[1].x,FR[1].y); ctx.lineTo(FR[2].x,FR[2].y); ctx.lineTo(FR[3].x,FR[3].y); ctx.closePath();
          ctx.strokeStyle = onLevel ? 'rgba(71,85,105,0.55)' : 'rgba(148,163,184,0.50)';
          ctx.lineWidth = onLevel ? 2.4 : 1.8; ctx.stroke();
          // Inner colored frame (blue accent)
          ctx.beginPath(); ctx.moveTo(FR[0].x,FR[0].y); ctx.lineTo(FR[1].x,FR[1].y); ctx.lineTo(FR[2].x,FR[2].y); ctx.lineTo(FR[3].x,FR[3].y); ctx.closePath();
          ctx.strokeStyle = onLevel ? 'rgba(30,64,175,0.95)' : 'rgba(30,64,175,0.80)';
          ctx.lineWidth = onLevel ? 1.2 : 0.9; ctx.stroke();
          // Recess illusion: inset quad darkened so glass appears set into wall thickness
          try {
            var insetFrac = 0.08; // purely visual; fraction toward center
            var cxMid = (FR[0].x + FR[1].x + FR[2].x + FR[3].x) / 4;
            var cyMid = (FR[0].y + FR[1].y + FR[2].y + FR[3].y) / 4;
            var insetPts = [];
            for (var ip=0; ip<4; ip++){
              var P = FR[ip];
              insetPts.push({ x: P.x + (cxMid - P.x)*insetFrac, y: P.y + (cyMid - P.y)*insetFrac });
            }
            ctx.beginPath();
            ctx.moveTo(insetPts[0].x,insetPts[0].y); ctx.lineTo(insetPts[1].x,insetPts[1].y); ctx.lineTo(insetPts[2].x,insetPts[2].y); ctx.lineTo(insetPts[3].x,insetPts[3].y); ctx.closePath();
            ctx.fillStyle = onLevel ? 'rgba(51,65,85,0.35)' : 'rgba(100,116,139,0.30)';
            ctx.fill();
            ctx.strokeStyle = onLevel ? 'rgba(51,65,85,0.55)' : 'rgba(100,116,139,0.50)';
            ctx.lineWidth = onLevel ? 0.9 : 0.7; ctx.stroke();
          } catch(_eInset) { /* non-fatal visual enhancement */ }
        }
        ctx.restore();
      }
      // Door visibility: draw semi-opaque rectangle in hole
      if (doorRects.length){
        ctx.save();
        for (var dr=0; dr<doorRects.length; dr++){
          var DQ = doorRects[dr]; if(!DQ||DQ.length!==4) continue;
          ctx.beginPath(); ctx.moveTo(DQ[0].x,DQ[0].y); ctx.lineTo(DQ[1].x,DQ[1].y); ctx.lineTo(DQ[2].x,DQ[2].y); ctx.lineTo(DQ[3].x,DQ[3].y); ctx.closePath();
          ctx.fillStyle = onLevel ? 'rgba(234,179,8,0.40)' : 'rgba(234,179,8,0.30)';
          ctx.fill();
          ctx.strokeStyle = onLevel ? 'rgba(234,179,8,0.80)' : 'rgba(234,179,8,0.65)';
          ctx.lineWidth = onLevel ? 2.0 : 1.6; ctx.stroke();
        }
        ctx.restore();
      }
      // Draw any door/window overlays attached to this wall strip (centerline-based)
      // In solid mode, we already cut holes and drew glass; skip legacy opening outlines for clarity.
      try {
        /* no-op: opening outlines suppressed in solid mode */
      } catch(_eOpen) {}
      // SAFETY WIREFRAME OVERLAY — ensure edges draw even when near-plane culls projections
      try {
        var P = (typeof window.__proj==='object' && window.__proj) || null;
        var nearEps = 0.01;
        var kBlend = Math.max(0, Math.min(1, (typeof window.PERSPECTIVE_STRENGTH==='number'? window.PERSPECTIVE_STRENGTH:0.88)));
        var refZ = Math.max(0.5, (window.camera && camera.distance) || 12);
        var scalePx = (P && P.scale) || 600;
        function toCam3(p){ if(!P) return null; var rx=p.x-P.cam[0], ry=p.y-P.cam[1], rz=p.z-P.cam[2]; return { cx: rx*P.right[0] + ry*P.right[1] + rz*P.right[2], cy: rx*P.up[0] + ry*P.up[1] + rz*P.up[2], cz: rx*P.fwd[0] + ry*P.fwd[1] + rz*P.fwd[2] }; }
        function camToScreen3(v){ if(!v) return null; var czEff = v.cz * kBlend + refZ * (1 - kBlend); var s = scalePx / czEff; return { x: (canvas.width/2) + (v.cx * s) + pan.x, y: (canvas.height/2) - (v.cy * s) + pan.y }; }
        function clipSegNear(a, b){ if(!a||!b) return null; var ina=a.cz>=nearEps, inb=b.cz>=nearEps; if(ina&&inb) return [a,b]; if(!ina&&!inb) return null; var t=(nearEps-a.cz)/((b.cz-a.cz)||1e-9); var I={ cx:a.cx+(b.cx-a.cx)*t, cy:a.cy+(b.cy-a.cy)*t, cz:nearEps }; return ina?[a,I]:[I,b]; }
        function strokeClippedEdge(W0, W1){ var a=toCam3(W0), b=toCam3(W1); var seg=clipSegNear(a,b); if(!seg) return false; var s0=camToScreen3(seg[0]), s1=camToScreen3(seg[1]); if(!s0||!s1) return false; ctx.save(); ctx.strokeStyle = edgeCol; ctx.lineWidth = onLevel ? 2.0 : 1.2; ctx.beginPath(); ctx.moveTo(s0.x,s0.y); ctx.lineTo(s1.x,s1.y); ctx.stroke(); ctx.restore(); return true; }
        // Only add overlay if the standard projected edge was missing (prevent double-drawing)
        // Top face
        if (!(pAt && pBt)) { strokeClippedEdge(At, Bt); }
        if (!(pBt && pCt)) { strokeClippedEdge(Bt, Ct); }
        if (!(pCt && pDt)) { strokeClippedEdge(Ct, Dt); }
        if (!(pDt && pAt)) { strokeClippedEdge(Dt, At); }
        // Bottom face
        if (!(pA && pB)) { strokeClippedEdge({x:A.x,y:A.y,z:A.z}, {x:B.x,y:B.y,z:B.z}); }
        if (!(pB && pC)) { strokeClippedEdge({x:B.x,y:B.y,z:B.z}, {x:C.x,y:C.y,z:C.z}); }
        if (!(pC && pD)) { strokeClippedEdge({x:C.x,y:C.y,z:C.z}, {x:D.x,y:D.y,z:D.z}); }
        if (!(pD && pA)) { strokeClippedEdge({x:D.x,y:D.y,z:D.z}, {x:A.x,y:A.y,z:A.z}); }
        // Vertical edges
        if (!(pA && pAt)) { strokeClippedEdge({x:A.x,y:A.y,z:A.z}, {x:At.x,y:At.y,z:At.z}); }
        if (!(pB && pBt)) { strokeClippedEdge({x:B.x,y:B.y,z:B.z}, {x:Bt.x,y:Bt.y,z:Bt.z}); }
        if (!(pC && pCt)) { strokeClippedEdge({x:C.x,y:C.y,z:C.z}, {x:Ct.x,y:Ct.y,z:Ct.z}); }
        if (!(pD && pDt)) { strokeClippedEdge({x:D.x,y:D.y,z:D.z}, {x:Dt.x,y:Dt.y,z:Dt.z}); }
      } catch(_wf) {}
      // Restore context before exiting solid rendering branch
      ctx.restore();
      return;
    } catch(eSolid) { /* non-fatal */ }
  };
  // Build unique, readable codes for each unique corner (endpoint) on the current floor
  if (typeof window.computeCornerCodes === 'undefined') {
    window.computeCornerCodes = function(){
      try {
        var map = {};
        var pts = [];
        var lvl = (typeof currentFloor==='number') ? currentFloor : 0;
        function kf(v){ return Math.round((+v||0)*100)/100; }
        var ws = Array.isArray(window.wallStrips) ? window.wallStrips : [];
        for (var i=0; i<ws.length; i++){
          var s = ws[i]; if (!s) continue; if ((s.level||0)!==lvl) continue;
          var k0 = lvl + '|' + kf(s.x0||0) + '|' + kf(s.z0||0);
          var k1 = lvl + '|' + kf(s.x1||0) + '|' + kf(s.z1||0);
          if (!map[k0]) { map[k0] = true; pts.push(k0); }
          if (!map[k1]) { map[k1] = true; pts.push(k1); }
        }
        // Sort keys for stable numbering
        pts.sort();
        var out = {};
        for (var j=0; j<pts.length; j++){
          var code = 'C' + (j+1).toString().padStart(3,'0');
          out[pts[j]] = code;
        }
        window.__cornerCodeMap = out;
      } catch(_eCCB) { window.__cornerCodeMap = {}; }
    };
  }
  // Precompute exterior miter snap points for corners so walls meet perfectly on the first render pass (no second pass needed)
  if (typeof window.computeExteriorCornerSnaps === 'undefined') {
    window.computeExteriorCornerSnaps = function(){
      try {
        var ws = Array.isArray(window.wallStrips) ? window.wallStrips : [];
        var lvl = (typeof window.currentFloor==='number') ? window.currentFloor : 0;
        // Build corner map: key -> list of endpoint infos
        function kf(v){ return Math.round((+v||0)*100)/100; } // cm
        function keyFor(level,x,z){ return level + '|' + kf(x) + '|' + kf(z); }
        var map = Object.create(null);
        for (var i=0; i<ws.length; i++){
          var s = ws[i]; if (!s) continue; if ((s.level||0)!==lvl) continue;
          var x0=s.x0||0, z0=s.z0||0, x1=s.x1||0, z1=s.z1||0;
          var dx = x1-x0, dz = z1-z0; var L = Math.hypot(dx,dz)||1; var tx=dx/L, tz=dz/L;
          var t0 = { x: tx, z: tz }, t1 = { x: -tx, z: -tz };
          var n = { x: -tz, z: tx };
          var hw = Math.max(0.02, (s.thickness||0.3)/2);
          var intLeft = (typeof s.__interiorLeft==='boolean') ? s.__interiorLeft : ((typeof s.__outerFaceLeft==='boolean') ? (!s.__outerFaceLeft) : null);
          var e0 = { key: keyFor((s.level||0), x0, z0), corner:{x:x0,z:z0}, dir: t0, norm:n, hw:hw, intLeft:intLeft };
          var e1 = { key: keyFor((s.level||0), x1, z1), corner:{x:x1,z:z1}, dir: t1, norm:n, hw:hw, intLeft:intLeft };
          if (!map[e0.key]) map[e0.key]=[]; map[e0.key].push(e0);
          if (!map[e1.key]) map[e1.key]=[]; map[e1.key].push(e1);
        }
        // 2D line intersection utility
        function intersect(p,d,q,e){ var den = d.x * (-e.z) - d.z * (-e.x); if (Math.abs(den) < 1e-6) return null; var rx=q.x-p.x, rz=q.z-p.z; var a=(rx*(-e.z)-rz*(-e.x))/den; return { x: p.x + a*d.x, z: p.z + a*d.z }; }
        // Reset snap maps for this frame
        try { window.__extCornerSnap = {}; } catch(_eR) { window.__extCornerSnap = {}; }
        try { window.__intCornerSnap = {}; } catch(_eI) { window.__intCornerSnap = {}; }
        // For each corner with two or more strips, compute exterior intersection using each strip's exterior offset line
        var keys = Object.keys(map);
        for (var ki=0; ki<keys.length; ki++){
          var key = keys[ki]; var arr = map[key]||[]; if (arr.length < 2) continue;
          // Choose two with the largest angle (most orthogonal) to avoid colinear cases
          var bestI=-1,bestJ=-1,bestAng=-1;
          function ang(u,v){ var dot = u.dir.x*v.dir.x + u.dir.z*v.dir.z; var ll = Math.max(1e-6, Math.hypot(u.dir.x,u.dir.z)*Math.hypot(v.dir.x,v.dir.z)); var c = Math.max(-1, Math.min(1, dot/ll)); return Math.acos(c); }
          for (var i1=0; i1<arr.length; i1++){
            for (var j1=i1+1; j1<arr.length; j1++){
              var a = ang(arr[i1], arr[j1]); if (a > bestAng){ bestAng=a; bestI=i1; bestJ=j1; }
            }
          }
          if (bestI<0 || bestJ<0) continue;
          var A = arr[bestI], B = arr[bestJ];
          // Both must have interior/exterior info; else skip to avoid wrong snap for free walls
          if (A.intLeft==null || B.intLeft==null) continue;
          var exSignA = A.intLeft ? -1 : 1; // exterior is right when interior is left
          var exSignB = B.intLeft ? -1 : 1;
          var pA = { x: A.corner.x + A.norm.x * exSignA * A.hw, z: A.corner.z + A.norm.z * exSignA * A.hw };
          var pB = { x: B.corner.x + B.norm.x * exSignB * B.hw, z: B.corner.z + B.norm.z * exSignB * B.hw };
          var iP = intersect(pA, A.dir, pB, B.dir);
          if (iP) {
            // Store in snap map using drawWallStrip's keying convention (×100 rounding)
            var snapKey = (lvl) + '|' + Math.round(A.corner.x*100) + '|' + Math.round(A.corner.z*100) + '|ext';
            window.__extCornerSnap[snapKey] = { x: iP.x, z: iP.z };
          }
        }
      } catch(e){ /* non-fatal */ }
    };
  }
  if (typeof window.updatePerfStatsOverlay === 'undefined') window.updatePerfStatsOverlay = function(){};
  // Minimal measurements panel updater (live-edit friendly)
  if (typeof window.__measPinnedId === 'undefined') window.__measPinnedId = null; // remembers last valid selection while editing
  window.updateMeasurements = function(){
    try {
      var panel = document.getElementById('measurements'); if(!panel) return;
      // Hide measurements panel entirely when 2D floor plan is active
      try {
        if (window.__plan2d && __plan2d.active) {
          panel.classList.remove('visible');
          // Switch to class-based hide (avoid direct style.display churn)
          panel.classList.add('is-hidden');
          return;
        } else {
          panel.classList.remove('is-hidden');
        }
      } catch(_p2d) {}
      var sel = window.selectedRoomId ? findObjectById(window.selectedRoomId) : null;
      // Always keep panel visible
      panel.classList.add('visible');
      function setIfNotActive(id, v){ var el=document.getElementById(id); if(!el) return; if (document.activeElement === el) return; el.value = (v==null?'':v); }
      function txt(id, v){ var el=document.getElementById(id); if(el){ el.textContent = (v==null?'--':v); } }

      // If user is currently editing within the panel, don't clear values even if selection flickers
      var focusInside = false;
      try { var ae = document.activeElement; focusInside = !!(ae && panel.contains(ae)); } catch(_f){}
      if (!sel && focusInside && window.__measPinnedId) {
        try { var pinned = findObjectById(window.__measPinnedId); if (pinned) sel = pinned; } catch(_p){}
      }

      // If no object is selected, but a wall strip is selected, show its info
      if (!sel) {
        // While actively editing, keep current values and avoid clearing the panel
        if (focusInside) return;
        var wsIdx = (typeof window.selectedWallStripIndex==='number') ? window.selectedWallStripIndex : -1;
        if (wsIdx != null && wsIdx > -1 && Array.isArray(window.wallStrips) && wallStrips[wsIdx]) {
          var w = wallStrips[wsIdx];
          var dx = (w.x1||0) - (w.x0||0), dz = (w.z1||0) - (w.z0||0);
          var L = Math.hypot(dx, dz) || 0;
          var cx = ((w.x0||0) + (w.x1||0)) / 2;
          var cz = ((w.z0||0) + (w.z1||0)) / 2;
          setIfNotActive('input-name', 'Wall');
          setIfNotActive('input-width', L.toFixed(2));
          setIfNotActive('input-depth', (w.thickness || 0.3).toFixed(2));
          setIfNotActive('input-height', (w.height || 3.0).toFixed(2));
          setIfNotActive('input-pos-x', cx.toFixed(2));
          setIfNotActive('input-pos-z', cz.toFixed(2));
          txt('measure-floor', String(w.level!=null? w.level : 0));
          return;
        } else {
          // Clear fields when nothing is selected
          setIfNotActive('input-name', '');
          setIfNotActive('input-width', '');
          setIfNotActive('input-depth', '');
          setIfNotActive('input-height', '');
          setIfNotActive('input-pos-x', '');
          setIfNotActive('input-pos-z', '');
          txt('measure-floor', '--');
          return;
        }
      }
      // Populate fields for selection
      var t = (sel && sel.type) || 'room';
      var heightProp = 'height';
      if (t === 'pergola') heightProp = 'totalHeight';
      // Remember the last valid selection while editing
      try { if (sel && sel.id) window.__measPinnedId = sel.id; } catch(_pin){}
      // Values
      var wv = (sel.width!=null? sel.width : 0);
      var dv = (sel.depth!=null? sel.depth : 0);
      var hv = (sel[heightProp]!=null? sel[heightProp] : (sel.height!=null? sel.height:0));
      setIfNotActive('input-name', sel.name||'');
      setIfNotActive('input-width', Number(wv).toFixed(2));
      setIfNotActive('input-depth', Number(dv).toFixed(2));
      setIfNotActive('input-height', Number(hv).toFixed(2));
      setIfNotActive('input-pos-x', Number(sel.x||0).toFixed(2));
      setIfNotActive('input-pos-z', Number(sel.z||0).toFixed(2));
      txt('measure-floor', String(sel.level!=null? sel.level : (sel.type==='balcony'? 1 : 0)));
      // Wire save once
      var save = document.getElementById('save-measurements');
      if (save && !save.__wired){
        save.__wired = true;
        save.addEventListener('click', function(){
          try {
            var sid = window.selectedRoomId || window.__measPinnedId;
            var s = sid ? findObjectById(sid) : null; if(!s) return;
            var gv = function(id, def){ var el=document.getElementById(id); var v=parseFloat(el && el.value); return isFinite(v)? v : def; };
            s.name = (document.getElementById('input-name')||{}).value || s.name;
            s.width = Math.max(0.5, gv('input-width', s.width||1));
            s.depth = Math.max(0.5, gv('input-depth', s.depth||1));
            var htProp = (s.type==='pergola') ? 'totalHeight' : 'height';
            s[htProp] = Math.max(0.1, gv('input-height', s[htProp]||s.height||1));
            s.x = gv('input-pos-x', s.x||0); s.z = gv('input-pos-z', s.z||0);
            updateStatus('Saved measurements');
            if (typeof saveProjectSilently==='function') saveProjectSilently();
            if (typeof renderLoop==='function') renderLoop();
          } catch(e) { console.warn('Save measurements failed', e); }
        });
      }
      // Live wiring for inputs (type and arrow keys supported by native <input type=number>)
      if (!panel.__measWired) {
        panel.__measWired = true;
        function onLiveChange(){
          try {
            var sid = window.selectedRoomId || window.__measPinnedId;
            var s = sid ? findObjectById(sid) : null; if(!s) return;
            var nameEl = document.getElementById('input-name'); if (nameEl && document.activeElement === nameEl) { s.name = nameEl.value || s.name; }
            function clampNum(id, def, minV, maxV){ var el=document.getElementById(id); if(!el) return def; var v=parseFloat(el.value); if(!isFinite(v)) return def; if(minV!=null) v=Math.max(minV,v); if(maxV!=null) v=Math.min(maxV,v); return v; }
            // Apply changes from active or recently changed inputs
            var w = clampNum('input-width', s.width||1, 0.5, 1e6);
            var d = clampNum('input-depth', s.depth||1, 0.5, 1e6);
            var htProp = (s.type==='pergola') ? 'totalHeight' : 'height';
            var h = clampNum('input-height', s[htProp]||s.height||1, 0.1, 100);
            var px = clampNum('input-pos-x', s.x||0, -1000, 1000);
            var pz = clampNum('input-pos-z', s.z||0, -1000, 1000);
            s.width = w; s.depth = d; s[htProp] = h; s.x = px; s.z = pz;
            _needsFullRender = true; if (typeof renderLoop==='function') renderLoop();
          } catch(e){ /* non-fatal */ }
        }
        var ids = ['input-name','input-width','input-depth','input-height','input-pos-x','input-pos-z'];
        ids.forEach(function(id){ var el=document.getElementById(id); if(!el) return; if (!el.__wired){ el.__wired=true; el.addEventListener('input', onLiveChange); el.addEventListener('change', onLiveChange); } });
      }
    } catch(e) { /* non-fatal */ }
  };
  // Unified selection helper: immediately refresh measurements & labels without waiting for next frame
  if (typeof window.selectObject === 'undefined') {
    window.selectObject = function selectObject(id, opts){
      try {
        var prevId = window.selectedRoomId || null;
        // If user is actively editing a measurements input and selection changes, blur the field.
        try {
          if (id !== prevId) {
            var panel = document.getElementById('measurements');
            var active = document.activeElement;
            if (panel && active && panel.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
              // Commit any pending value by triggering change before blur (native behavior may handle, but we ensure consistency)
              try { active.dispatchEvent(new Event('change', { bubbles: true })); } catch(_chg) {}
              active.blur();
            }
          }
        } catch(_blur) { /* non-fatal */ }
        if (id == null) { window.selectedRoomId = null; }
        else { window.selectedRoomId = id; }
        // Keep measurements panel visible and update instantly
        try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_eV) {}
        try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eM) {}
        // Update labels right away so Edit/Rotate buttons react instantly
        try { if (typeof updateLabels==='function') updateLabels(); } catch(_eL) {}
        // Optionally skip render (caller may already schedule) via opts.noRender
        if (!(opts && opts.noRender)) { try { if (typeof renderLoop==='function') renderLoop(); } catch(_eR) {} }
      } catch(_eSel) { /* non-fatal */ }
    };
  }
  // Ensure measurements panel is shown (overrides any inline style from other UIs)
  if (typeof window.ensureMeasurementsVisible === 'undefined') {
    window.ensureMeasurementsVisible = function ensureMeasurementsVisible(){
      try {
        var panel = document.getElementById('measurements');
        if (!panel) return;
        // Do not show the panel when 2D floor plan is active
        if (window.__plan2d && __plan2d.active) { 
          panel.classList.remove('visible'); 
          panel.classList.add('is-hidden'); 
          return; 
        }
        panel.classList.remove('is-hidden');
        panel.classList.add('visible');
      } catch(e) { /* non-fatal */ }
    };
  }
  if (typeof window.updateStatus === 'undefined') window.updateStatus = function(msg){ try{ var s=document.getElementById('status'); if(s) s.textContent = msg; }catch(e){} };

  // World height scale ruler drawn near the building footprint
  if (typeof window.drawWorldHeightScale === 'undefined') window.drawWorldHeightScale = function(){
    try {
      if (!ctx || !canvas || !Array.isArray(allRooms) || allRooms.length === 0) return;
      // Pick a target room: prefer selected on current floor, else first room on current floor, else first room
      var target = null;
      if (selectedRoomId) {
        for (var i=0;i<allRooms.length;i++){ var r=allRooms[i]; if(r && r.id===selectedRoomId) { target=r; break; } }
      }
      if (!target) {
        for (var j=0;j<allRooms.length;j++){ var r2=allRooms[j]; if (r2 && (r2.level||0) === (currentFloor||0)) { target=r2; break; } }
      }
      if (!target) target = allRooms[0];
      if (!target) return;

      // Compute global footprint and total building top height so the ruler grows to full height (across floors/roof)
      var fp = null;
      try { if (typeof computeRoofFootprint==='function') fp = computeRoofFootprint(); } catch(_e) { fp = null; }
      if (!fp) {
        // Fallback footprint from rooms
        var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
        for (var ri=0; ri<allRooms.length; ri++){
          var rr=allRooms[ri]; if(!rr) continue;
          var hw2=(rr.width||1)/2, hd2=(rr.depth||1)/2;
          minX=Math.min(minX,(rr.x||0)-hw2); maxX=Math.max(maxX,(rr.x||0)+hw2);
          minZ=Math.min(minZ,(rr.z||0)-hd2); maxZ=Math.max(maxZ,(rr.z||0)+hd2);
        }
        if (isFinite(minX)&&isFinite(maxX)&&isFinite(minZ)&&isFinite(maxZ)) {
          fp = { x:(minX+maxX)/2, z:(minZ+maxZ)/2, width:Math.max(1,maxX-minX), depth:Math.max(1,maxZ-minZ) };
        } else {
          fp = { x:(target.x||0), z:(target.z||0), width:(target.width||3), depth:(target.depth||3) };
        }
      }

      var baseY = 0.0; // ground reference
      var topY = 0.0;
      for (var ti=0; ti<allRooms.length; ti++){
        var rTop = (allRooms[ti].level||0)*3.5 + Math.max(0.1, allRooms[ti].height||3.0);
        if (rTop>topY) topY=rTop;
      }
      for (var ri2=0; ri2<(roofComponents||[]).length; ri2++){
        var rf=roofComponents[ri2]; if(!rf) continue; var bH=(typeof rf.baseHeight==='number'&&isFinite(rf.baseHeight))?rf.baseHeight:3.0; var hH=(typeof rf.height==='number'&&isFinite(rf.height))?rf.height:0.6; var rTop2=bH+hH; if(rTop2>topY) topY=rTop2;
      }
      if (topY <= baseY + 0.05) topY = baseY + Math.max(3.0, (target.height||3.0));

      // Smooth the displayed height so it grows elegantly as the building grows
      var targetH = Math.max(0.1, topY - baseY);
      var curH = (typeof window.__heightRuleH==='number' ? window.__heightRuleH : targetH);
      var k = 0.2; // smoothing factor per frame
      var newH = curH + (targetH - curH) * k;
      if (Math.abs(newH - targetH) < 0.02) newH = targetH;
      window.__heightRuleH = newH;

      var h = newH;

      // Build footprint corners and choose a visible corner just outside the footprint
      var hw = Math.max(0.05, (fp.width||1)/2);
      var hd = Math.max(0.05, (fp.depth||1)/2);
      var corners = [
        { x:(fp.x||0)+hw, z:(fp.z||0)+hd },
        { x:(fp.x||0)+hw, z:(fp.z||0)-hd },
        { x:(fp.x||0)-hw, z:(fp.z||0)+hd },
        { x:(fp.x||0)-hw, z:(fp.z||0)-hd }
      ];
      var pick=null, p0=null, p1=null; var outset=0.18; // place the scale just outside the room
      for (var ci=0; ci<corners.length; ci++){
        var cx=corners[ci].x, cz=corners[ci].z;
        // offset outward away from room center to position the scale outside of the cube
        var dirX = cx - (fp.x||0); var dirZ = cz - (fp.z||0); var len=Math.hypot(dirX,dirZ)||1; dirX/=len; dirZ/=len;
        var ox = cx + dirX*outset, oz = cz + dirZ*outset;
        var q0 = project3D(ox, baseY, oz);
        var q1 = project3D(ox, baseY + h, oz);
        if (q0 && q1) { pick={x:ox,z:oz}; p0=q0; p1=q1; break; }
      }
      if (!pick || !p0 || !p1) return;

      // Fade with UI inactivity just like handles/labels
      var uiA = (typeof window.__uiFadeAlpha === 'number') ? window.__uiFadeAlpha : 1.0;
      if (uiA <= 0.0) return;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, uiA));

      // Draw main vertical line at the chosen corner
      ctx.strokeStyle = '#111827'; // near-black for visibility
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      // Draw ticks and labels every 0.5m
      var step = 0.5; // meters
      var ticks = Math.round(h / step);
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#4b5563';
      ctx.font = 'bold 13px system-ui, sans-serif';
      for (var t=0; t<=ticks; t++){
        var yy = baseY + Math.min(h, t*step);
        var pt = project3D(pick.x, yy, pick.z); if (!pt) continue;
        // Tick mark (constant screen-space length for clarity)
        var lenPx = (t % 2 === 0) ? 12 : 8; // longer tick each 1.0m
        ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt.x + lenPx, pt.y); ctx.stroke();
        // Label text on the right of tick
        var val = (t*step).toFixed(1).replace(/\.0$/, '.0');
        var label = val + ' m';
        ctx.fillStyle = '#111827';
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(label, pt.x + lenPx + 4, pt.y);
      }

      ctx.restore();
    } catch(e) { /* non-fatal */ }
  };

  // Main render loop (idempotent definition)
  if (typeof window.renderLoop === 'undefined') {
    window.renderLoop = function renderLoop(){
      try {
        // Gate rendering until essentials are loaded (prevents premature 3D draw during splash)
        if (!window.__renderingEnabled) { 
          requestAnimationFrame(renderLoop); 
          return; 
        }
        
        // Throttle inactive frames to reduce CPU
        var now = (performance && performance.now) ? performance.now() : Date.now();
        var last = (typeof window.__perf==='object' && window.__perf && typeof window.__perf.lastFrameTime==='number') ? window.__perf.lastFrameTime : 0;
        var minDt = (typeof window._minFrameInterval==='number' ? window._minFrameInterval : 16);
        if (last && (now - last) < minDt) { requestAnimationFrame(renderLoop); return; }
        if (window.__perf) window.__perf.lastFrameTime = now;

        // Ensure canvas/context ready and projection up-to-date
        setupCanvas();
        if (!window.canvas || !window.ctx) { requestAnimationFrame(renderLoop); return; }
        if (typeof updateProjectionCache==='function') updateProjectionCache();

        // Detect if camera is inside any room on the current floor; if so, allow close/inside wall rendering
        try {
          var inside = false;
          var cam = (__proj && __proj.cam) ? __proj.cam : [0,0,0];
          var cx = cam[0], cy = cam[1], czW = cam[2];
          var lvlNow = (typeof window.currentFloor==='number') ? window.currentFloor : 0;
          function pointInPolyXZ(pts, x, z){
            var c = false; var n = (pts||[]).length; if(n<3) return false;
            for (var i=0,j=n-1; i<n; j=i++){
              var pi=pts[i], pj=pts[j]; if(!pi||!pj) continue;
              var xi=pi.x||0, zi=pi.z||0, xj=pj.x||0, zj=pj.z||0;
              var inter = ((zi>z)!==(zj>z)) && (x < (xj - xi) * (z - zi) / Math.max(1e-9, (zj - zi)) + xi);
              if (inter) c = !c;
            }
            return c;
          }
          var rooms = Array.isArray(window.allRooms) ? window.allRooms : [];
          for (var ri=0; ri<rooms.length && !inside; ri++){
            var r = rooms[ri]; if(!r) continue; if ((r.level||0)!==lvlNow) continue;
            var baseY = (r.level||0)*3.5; var h = (typeof r.height==='number')? r.height : 3.0;
            if (cy < baseY - 0.05 || cy > baseY + h + 0.05) continue;
            if (Array.isArray(r.footprint) && r.footprint.length>=3){
              inside = pointInPolyXZ(r.footprint, cx, czW);
            } else {
              // Rectangle possibly rotated
              var hw=(r.width||0)/2, hd=(r.depth||0)/2; if(hw<=0||hd<=0) continue;
              var rot=((r.rotation||0)*Math.PI)/180; var cA=Math.cos(rot), sA=Math.sin(rot);
              var dx=cx-(r.x||0), dz=czW-(r.z||0);
              var lx =  dx*cA + dz*sA; // local x
              var lz = -dx*sA + dz*cA; // local z
              inside = (lx>=-hw && lx<=hw && lz>=-hd && lz<=hd);
            }
          }
          window.__cameraInsideSolid = !!inside && (window.__wallRenderMode === 'solid');
        } catch(_insideErr) { window.__cameraInsideSolid = false; }

        // Compute UI fade alpha based on recent camera/interaction activity
        try {
          var uiNow = now;
          var lastUi = (typeof window._uiLastInteractionTime==='number') ? window._uiLastInteractionTime : 0;
          var idleMs = Math.max(0, uiNow - lastUi);
          var fadeStart = (typeof window.UI_FADE_GRACE_MS==='number') ? window.UI_FADE_GRACE_MS : 0;
          var fadeDur = (typeof window.UI_FADE_INACTIVITY_MS==='number') ? window.UI_FADE_INACTIVITY_MS : 3000;
          var a = 1.0;
          if (idleMs > fadeStart) {
            var t = Math.min(1, (idleMs - fadeStart) / Math.max(1, fadeDur));
            a = 1.0 - t;
          }
          // Keep UI fully visible while mouse is down or a drag is active
          if (window.mouse && (window.mouse.down || window.mouse.dragType)) a = 1.0;
          window.__uiFadeAlpha = Math.max(0, Math.min(1, a));
        } catch(_e) { window.__uiFadeAlpha = 1.0; }

        // Clear and draw grid
        clearCanvas();
        drawGrid();

        // Draw world content
        if (Array.isArray(window.allRooms)) {
          for (var i=0; i<window.allRooms.length; i++) {
            try { drawRoom(window.allRooms[i]); } catch(_er) {}
          }
        }
        // Draw interior wall strips (extruded 2D walls)
        try {
          // Mark that perimeter edge map and corner caches should be rebuilt once before drawing strips in this frame
          window.__rebuildPerimeterEdgeHashOnce = true;
          window.__rebuildCornerCachesOnce = true;
          if (window.__showCornerCodes && typeof window.computeCornerCodes==='function') { window.computeCornerCodes(); }
          // Ensure exterior miter snaps are ready before the very first draw in this frame
          try { if (typeof window.computeExteriorCornerSnaps==='function') window.computeExteriorCornerSnaps(); } catch(_eSnapPre) {}
          var __ws = window.wallStrips || [];
          for (var __wsi=0; __wsi<__ws.length; __wsi++){
            try { if (typeof drawWallStrip==='function') drawWallStrip(__ws[__wsi]); } catch(__eWs) {}
          }
        } catch(__eWSAll) {}
        // Draw other components when their renderers are (lazily) available
        try {
          if (typeof drawStairs === 'function') {
            var scArr2 = window.stairsComponents || [];
            if (Array.isArray(scArr2) && scArr2.length>0){ for (var sdi=0; sdi<scArr2.length; sdi++){ var sObj=scArr2[sdi]; if(!sObj) continue; drawStairs(sObj); } }
            else if (window.stairsComponent) { drawStairs(window.stairsComponent); }
          }
        } catch(_eS) {}
        try {
          var a;
          a = window.pergolaComponents || []; for (var pi=0; pi<a.length; pi++){ try { if (typeof drawPergola === 'function') drawPergola(a[pi]); } catch(_eP) {} }
          a = window.garageComponents || []; for (var gi=0; gi<a.length; gi++){ try { if (typeof drawGarage === 'function') drawGarage(a[gi]); } catch(_eG) {} }
          a = window.poolComponents || []; for (var li=0; li<a.length; li++){ try { if (typeof drawPool === 'function') drawPool(a[li]); } catch(_eL) {} }
          a = window.roofComponents || []; for (var ri=0; ri<a.length; ri++){ try { if (typeof drawRoof === 'function') drawRoof(a[ri]); } catch(_eR) {} }
          a = window.balconyComponents || []; for (var bi=0; bi<a.length; bi++){ try { if (typeof drawBalcony === 'function') drawBalcony(a[bi]); } catch(_eB) {} }
          a = window.furnitureItems || []; for (var fi=0; fi<a.length; fi++){ try { if (typeof drawFurniture === 'function') drawFurniture(a[fi]); } catch(_eF) {} }
        } catch(_eArr) {}

        // Overlays: snap guides, labels, measurements, height scale
        try { if (typeof drawSnapGuides==='function') drawSnapGuides(); } catch(_e1) {}
        try { if (typeof updateLabels==='function') updateLabels(); } catch(_e2) {}
        // Throttle measurement panel updates to reduce load (esp. on startup)
        try {
          var __now = (performance && performance.now) ? performance.now() : Date.now();
          if (typeof window.__lastMeasurementsUpdateAt !== 'number') window.__lastMeasurementsUpdateAt = 0;
          var __minDelta = (typeof window.__measureUpdateIntervalMs === 'number') ? window.__measureUpdateIntervalMs : 90; // ~11 fps
          if ((__now - window.__lastMeasurementsUpdateAt) >= __minDelta) {
            if (typeof updateMeasurements==='function') updateMeasurements();
            window.__lastMeasurementsUpdateAt = __now;
          }
        } catch(_e3) {}
        try { if (typeof drawWorldHeightScale==='function') drawWorldHeightScale(); } catch(_e4) {}
  // 3D HUD compass moved to navigation compass; draw there instead of overlay
  try { if (typeof drawNavCompass==='function') drawNavCompass(); } catch(_eC) {}

        // Emit a one-time event after the very first successful frame so the splash can hide immediately
        try {
          if (!window.__firstFrameEmitted) {
            window.__firstFrameEmitted = true;
            window.dispatchEvent(new CustomEvent('gablok:first-render'));
          }
        } catch(_eEvt) {}

        // Stats
        try { if (window.__dbgGfx) { window.__dbgGfx.frames++; } } catch(_e5) {}

        // Schedule next frame
        if (typeof window.requestAnimationFrame==='function') {
          window.animationId = requestAnimationFrame(renderLoop);
        }
      } catch(err) {
        try { console.error('renderLoop failed', err); } catch(_e) {}
        if (typeof window.requestAnimationFrame==='function') window.animationId = requestAnimationFrame(renderLoop);
      }
    };
  }

  // Provide a simple focus/hover dimming alpha for objects if not already defined
  if (typeof window.getObjectUiAlpha === 'undefined') {
    window.getObjectUiAlpha = function getObjectUiAlpha(id){
      try {
        var sel = window.selectedRoomId || null;
        var hover = window.__hoverRoomId || null;
        var focus = window.__focusRoomId || null;
        if (!sel && !hover && !focus) return 1.0;
        var target = sel || hover || focus;
        return (target === id) ? 1.0 : 0.6;
      } catch(_e) { return 1.0; }
    };
  }
  // Shared helper: center Y used for labels/handles/hit-tests across object types
  if (typeof window.getObjectCenterY === 'undefined') {
    window.getObjectCenterY = function getObjectCenterY(o){
      try {
        if (!o) return 1.5;
        if (o.type==='roof') { var b=(typeof o.baseHeight==='number'?o.baseHeight:3.0), h=(typeof o.height==='number'?o.height:1.0); return b + h*0.5; }
        if (o.type==='pergola') { var th=(o.totalHeight!=null? o.totalHeight : (o.height||2.2)); return th*0.5; }
        if (o.type==='balcony') { var lv=(o.level||0)*3.5; return lv + (o.height||3.0)*0.5; }
        if (o.type==='garage') { return (o.height||2.6)*0.5; }
        if (o.type==='pool') { return 0.3; }
        if (o.type==='stairs') { return (o.height||3.0)*0.5; }
        if (o.type==='furniture') { var e=Math.max(0, o.elevation||0); var lv2=(o.level||0)*3.5; return lv2 + e + (o.height||0.7)*0.5; }
        var lvlY=(o.level||0)*3.5; return lvlY + (o.height!=null? o.height*0.5 : 1.5);
      } catch(_e) { return (o && (o.level||0)*3.5 + 1.5) || 1.5; }
    };
  }

  // ---- Entrypoints ----
  // Startup helper: if 2D floorplan drafts exist in localStorage, apply them to 3D
  if (typeof window.__apply2dDraftsAtStartup === 'undefined') {
    window.__apply2dDraftsAtStartup = function __apply2dDraftsAtStartup(){
      try {
        if (typeof applyPlan2DTo3D !== 'function') return false; // 2D→3D mapper not available yet
        var raw = null; try { raw = localStorage.getItem('gablok_plan2dDrafts_v1'); } catch(_e) {}
        if (!raw) return false;
        var data = null; try { data = JSON.parse(raw); } catch(_e2) { data = null; }
        if (!data || (typeof data !== 'object')) return false;

        if (typeof window.__plan2d !== 'object' || !window.__plan2d) {
          window.__plan2d = { centerX:0, centerZ:0, yFromWorldZSign:1, elements:[], scale:50 };
        }
        var applied = false;
        var levels = ['0','1'];
        for (var li=0; li<levels.length; li++){
          var k = levels[li]; var lvl = (k==='1'? 1 : 0);
          var d = data[k]; if (!d || !Array.isArray(d.elements) || d.elements.length === 0) continue;
          try {
            // Provide minimal __plan2d context required by applyPlan2DTo3D for world mapping
            __plan2d.centerX = (typeof d.centerX === 'number' && isFinite(d.centerX)) ? d.centerX : 0;
            __plan2d.centerZ = (typeof d.centerZ === 'number' && isFinite(d.centerZ)) ? d.centerZ : 0;
            __plan2d.yFromWorldZSign = (d && (d.yFromWorldZSign === -1 || d.yFromWorldZSign === 1)) ? d.yFromWorldZSign : 1;
            if (typeof d.scale === 'number' && isFinite(d.scale)) __plan2d.scale = d.scale;
          } catch(_ctx) {}
          try {
            applyPlan2DTo3D(d.elements, { allowRooms:true, quiet:true, level: lvl, nonDestructive:true });
            applied = true;
          } catch(_ap) { /* ignore this level */ }
        }
        if (applied) {
          try { selectedRoomId = null; } catch(_eS) {}
          try { updateStatus('Applied saved 2D drafts to 3D'); } catch(_eU) {}
          try { if (typeof renderLoop === 'function') renderLoop(); } catch(_eR) {}
        }
        return applied;
      } catch(e) { return false; }
    };
  }
  if (typeof window.startApp === 'undefined') {
    window.startApp = function(){
      try { updateStatus('startApp: init…'); } catch(_e) {}
      setupCanvas();
      try {
        var dims = (canvas ? (canvas.width + 'x' + canvas.height) : 'no-canvas');
        updateStatus('startApp: canvas ' + dims + ', ctx ' + (!!ctx));
      } catch(_e) {}
      // If drafts exist, apply them first so we don't create a placeholder room unnecessarily
      var hadDrafts = false; try { hadDrafts = __apply2dDraftsAtStartup(); } catch(_eAD) { hadDrafts = false; }
      try{ if (!hadDrafts && (!Array.isArray(allRooms) || allRooms.length === 0)) createInitialRoom(); }catch(e){}
      try{ if(typeof setupEvents==='function') setupEvents(); }catch(e){}
      try{ if(typeof fitView==='function') fitView(); }catch(e){}
      // Smoothly animate the camera into position on first load
      var targetYaw = camera.yaw, targetPitch = camera.pitch, targetDist = camera.distance;
      var startYaw = targetYaw - 0.35;
      var startPitch = Math.min(0.0, targetPitch + 0.25);
      var startDist = Math.min(targetDist + 10, targetDist * 1.6);
      camera.yaw = startYaw; camera.pitch = startPitch; camera.distance = startDist;
      var t0 = (performance && performance.now)? performance.now(): Date.now();
      var dur = 650; // ms
      function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
      function animateIn(){
        var now = (performance && performance.now)? performance.now(): Date.now();
        var t = Math.min(1, (now - t0) / dur);
        var e = easeOutCubic(t);
        camera.yaw = startYaw + (targetYaw - startYaw) * e;
        camera.pitch = startPitch + (targetPitch - startPitch) * e;
        camera.distance = startDist + (targetDist - startDist) * e;
        _camLastMoveTime = now;
        if (t < 1) { requestAnimationFrame(animateIn); }
      }
      startRender();
      requestAnimationFrame(animateIn);
      // One-time report after first ticks
      setTimeout(function(){
        try {
          var msg = 'dbg: frames=' + (window.__dbgGfx.frames||0) + ', clear=' + (window.__dbgGfx.clearCalls||0) + ', grid=' + (window.__dbgGfx.gridCalls||0) + ', rooms=' + (Array.isArray(window.allRooms)? allRooms.length : 'n/a') + ', cam[yaw='+camera.yaw.toFixed(2)+', pitch='+camera.pitch.toFixed(2)+', dist='+camera.distance.toFixed(1)+']';
          updateStatus(msg);
          console.log('[DBG]', msg);
        } catch(__e) {}
      }, 800);
    };
  }
  if (typeof window.startRender === 'undefined') window.startRender = function(){ if (typeof renderLoop==='function') renderLoop(); };

  // Component creation helpers (only if missing)
  if (typeof window.addStairs === 'undefined') window.addStairs = function(){
    // Multi-stairs: create a new stairs component each time
    try { if (typeof window.stairsComponents === 'undefined') window.stairsComponents = []; } catch(_init){}
    var id='stairs_'+Date.now(); var lvl=(typeof currentFloor==='number'? currentFloor:0);
    // Design spec: 19 steps over 4 meters total run; keep default height 3.0m
    var w=1.2,d=4.0; var spot=findFreeSpotForFootprint(w,d,lvl); var s=applySnap({x:spot.x,z:spot.z,width:w,depth:d,level:lvl,type:'stairs'});
    var stair={ id:id, name:'Stairs', x:s.x, z:s.z, width:w, depth:d, height:3.0, steps:19, type:'stairs', rotation:0, level:lvl };
    try { window.stairsComponents.push(stair); } catch(_push){}
    // Back-compat: point singleton reference to the most recent
  window.stairsComponent = stair;
  if (typeof window.selectObject==='function') { window.selectObject(id, { noRender: true }); }
  else { window.selectedRoomId = id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMs) {} }
  if(typeof updateStatus==='function') updateStatus('Added Stairs');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
  // Do not auto-focus camera on add to avoid unexpected view jumps
  try { if (window.__autoFocusOnAdd === true) focusCameraOnObject(stair); } catch(_e) {}
    // Refresh menus (now a no-op for stairs)
    try { if (typeof window.updateLevelMenuStates === 'function') window.updateLevelMenuStates(); } catch(_u2){}
    _needsFullRender=true; startRender();
  };
  function newId(prefix){ return prefix+'_'+Date.now()+Math.random().toString(36).slice(2); }
  if (typeof window.addPergola === 'undefined') window.addPergola = function(){
    var lvl=0, w=3, d=3; var spot=findFreeSpotForFootprint(w,d,lvl); var s=applySnap({x:spot.x,z:spot.z,width:w,depth:d,level:lvl,type:'pergola'});
    var p={ id:newId('pergola'), name:'Pergola', x:s.x, z:s.z, width:w, depth:d, height:2.2, totalHeight:2.2, legWidth:0.25, slatCount:8, slatWidth:0.12, level:lvl, type:'pergola', rotation:0 };
  (window.pergolaComponents||[]).push(p);
  if (typeof window.selectObject==='function') { window.selectObject(p.id, { noRender: true }); }
  else { window.selectedRoomId=p.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMp) {} }
  updateStatus('Added Pergola');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
  try { if (window.__autoFocusOnAdd === true) focusCameraOnObject(p); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addGarage === 'undefined') window.addGarage = function(){
    var lvl=0, w=3.2, d=5.5; var spot=findFreeSpotForFootprint(w,d,lvl); var s=applySnap({x:spot.x,z:spot.z,width:w,depth:d,level:lvl,type:'garage'});
    var g={ id:newId('garage'), name:'Garage', x:s.x, z:s.z, width:w, depth:d, height:2.6, level:lvl, type:'garage', rotation:0 };
  (window.garageComponents||[]).push(g);
  if (typeof window.selectObject==='function') { window.selectObject(g.id, { noRender: true }); }
  else { window.selectedRoomId=g.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMg) {} }
  updateStatus('Added Garage');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
  try { if (window.__autoFocusOnAdd === true) focusCameraOnObject(g); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addPool === 'undefined') window.addPool = function(){
    var lvl=0, w=4, d=2; var spot=findFreeSpotForFootprint(w,d,lvl); var s=applySnap({x:spot.x,z:spot.z,width:w,depth:d,level:lvl,type:'pool'});
    var p={ id:newId('pool'), name:'Pool', x:s.x, z:s.z, width:w, depth:d, height:1.5, level:lvl, type:'pool', rotation:0 };
  (window.poolComponents||[]).push(p);
  if (typeof window.selectObject==='function') { window.selectObject(p.id, { noRender: true }); }
  else { window.selectedRoomId=p.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMpl) {} }
  updateStatus('Added Pool');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
  try { if (window.__autoFocusOnAdd === true) focusCameraOnObject(p); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  // Compute the Y base where roofs should sit: on top of first floor if any rooms exist there, otherwise on top of ground floor
  if (typeof window.computeRoofBaseHeight === 'undefined') window.computeRoofBaseHeight = function(){
    try {
      var lvl0 = [], lvl1 = [];
      for (var i=0;i<(allRooms||[]).length;i++){
        var r = allRooms[i]; if(!r) continue; var lv = (r.level||0); if (lv===1) lvl1.push(r); else if (lv===0) lvl0.push(r);
      }
      if (lvl1.length>0){
        var maxH1 = 0; for (var j=0;j<lvl1.length;j++){ var h = Math.max(0.5, lvl1[j].height||3.0); if (h>maxH1) maxH1 = h; }
        return 3.5 + maxH1;
      }
      if (lvl0.length>0){
        var maxH0 = 0; for (var k=0;k<lvl0.length;k++){ var h0 = Math.max(0.5, lvl0[k].height||3.0); if (h0>maxH0) maxH0 = h0; }
        return maxH0;
      }
      // Fallback if no rooms present
      return 3.0;
    } catch(e){ return 3.0; }
  };
  // Compute a world-aligned bounding rectangle that covers all rooms across both floors
  if (typeof window.computeRoofFootprint === 'undefined') window.computeRoofFootprint = function(){
    try {
      if (!Array.isArray(allRooms) || allRooms.length === 0) return { x: camera.targetX || 0, z: camera.targetZ || 0, width: 6, depth: 6 };
      var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (var i=0;i<allRooms.length;i++){
        var r = allRooms[i]; if(!r) continue;
        var hw = Math.max(0, (r.width||0)/2), hd = Math.max(0, (r.depth||0)/2);
        minX = Math.min(minX, (r.x||0) - hw);
        maxX = Math.max(maxX, (r.x||0) + hw);
        minZ = Math.min(minZ, (r.z||0) - hd);
        maxZ = Math.max(maxZ, (r.z||0) + hd);
      }
      if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minZ) || !isFinite(maxZ)) return { x: 0, z: 0, width: 6, depth: 6 };
      var margin = 0.2; // small eave overhang
      minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;
      return { x: (minX+maxX)/2, z: (minZ+maxZ)/2, width: Math.max(1, maxX-minX), depth: Math.max(1, maxZ-minZ) };
    } catch(e){ return { x: 0, z: 0, width: 6, depth: 6 }; }
  };
  if (typeof window.addRoof === 'undefined') window.addRoof = function(){
    var lvl=0; var fp = (typeof computeRoofFootprint==='function') ? computeRoofFootprint() : { x:camera.targetX, z:camera.targetZ, width:6, depth:6 };
    var s=applySnap({x:fp.x,z:fp.z,width:fp.width,depth:fp.depth,level:lvl,type:'roof'});
    // Place roof atop first floor if present, else above ground floor rooms
    var baseY = (typeof computeRoofBaseHeight==='function') ? computeRoofBaseHeight() : 3.0;
    var r={ id:newId('roof'), name:'Roof', x:s.x, z:s.z, width:Math.max(0.5,fp.width), depth:Math.max(0.5,fp.depth), baseHeight:baseY, height:1.2, level:lvl, type:'roof', roofType:'flat', rotation:0, autoBase:true, autoFit:true };
  (window.roofComponents||[]).push(r);
  if (typeof window.selectObject==='function') { window.selectObject(r.id, { noRender: true }); }
  else { window.selectedRoomId=r.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMr) {} }
  updateStatus('Added Roof');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
    // Lazy-load the roof UI dropdown when a roof is first added
    try { if (typeof window.loadScript==='function') { window.loadScript('js/ui/roofDropdown.js?v=20251026-1'); } } catch(_e) {}
  try { if (window.__autoFocusOnAdd === true) focusCameraOnObject(r); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addBalcony === 'undefined') window.addBalcony = function(){
    var lvl=1, w=2.5, d=1.5; var spot=findFreeSpotForFootprint(w,d,lvl); var s=applySnap({x:spot.x,z:spot.z,width:w,depth:d,level:lvl,type:'balcony'});
    var b={ id:newId('balcony'), name:'Balcony', x:s.x, z:s.z, width:w, depth:d, height:3.0, totalHeight:3.0, wallThickness:0.12, wallHeight:1.0, legWidth:0.18, floorThickness:0.1, slatCount:8, slatWidth:0.12, roofHeight:0.25, level:lvl, type:'balcony', rotation:0 };
  (window.balconyComponents||[]).push(b);
  if (typeof window.selectObject==='function') { window.selectObject(b.id, { noRender: true }); }
  else { window.selectedRoomId=b.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMb) {} }
  updateStatus('Added Balcony');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
  try { if (window.__autoFocusOnAdd === true) focusCameraOnObject(b); } catch(_e) {}
    _needsFullRender=true; startRender(); };

  // Failsafe: ensure app starts once DOM is ready, but allow a boot orchestrator to gate startup
  try {
    if (!window.__appStarted) {
      document.addEventListener('DOMContentLoaded', function(){
        try {
          var bootStart = function(){
            if (!window.__appStarted) { window.__appStarted = true; if (typeof startApp==='function') startApp(); }
          };
          // If a bootstrap loader is coordinating script loads, wait for it
          var wired = false;
          if (window.__bootPromise && typeof window.__bootPromise.then === 'function') {
            wired = true; window.__bootPromise.then(function(){ bootStart(); });
          }
          // Always listen for the boot-ready event as a secondary trigger
          window.addEventListener('gablok:boot-ready', function(){ bootStart(); }, { once:true });
          if (!wired && window.__requireBoot) {
            // Boot required but no promise: rely on event
            // add a safety timer to avoid indefinite waiting if event never fires
            setTimeout(function(){ bootStart(); }, 4000);
          }
          if (!window.__requireBoot && !wired) {
            // No gating configured -> start immediately
            bootStart();
          }
        } catch(e) { console.error('startApp failed:', e); }
      });
    }
  } catch(e) {}
})();
