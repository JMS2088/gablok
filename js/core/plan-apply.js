/**
 * @file plan-apply.js
 * @description 2D→3D mapping engine: converts 2D floor plan elements to 3D rooms and wall strips.
 * 
 * **Responsibilities:**
 * - Parse 2D walls/windows/doors into 3D room shells (rectangles and polygons)
 * - Detect closed rectangular loops with perimeter coverage validation
 * - Detect non-rectangular polygon rooms via graph traversal
 * - Build interior wall strips for walls not part of room perimeters
 * - Map openings (windows/doors) to room faces and wall strips
 * - Handle per-floor application (ground/first)
 * - Emit apply summaries for observability (counts of rooms/strips/openings)
 * - Non-destructive mode (preserve 3D when 2D is empty, for modal toggles)
 * 
 * **Core Function:**
 * `applyPlan2DTo3D(elemsSnapshot, opts)` - Main entry point
 * 
 * **Parameters:**
 * @param {Array} elemsSnapshot - Optional snapshot of 2D elements; defaults to __plan2d.elements
 * @param {Object} opts - Options object:
 *   - level: Floor level (0=ground, 1=first)
 *   - stripsOnly: Skip room detection, extrude all as strips
 *   - allowRooms: Enable room detection (default true)
 *   - nonDestructive: Don't clear 3D rooms if 2D is empty
 *   - quiet: Suppress status messages
 * 
 * **Global Dependencies:**
 * - `__plan2d` (from plan2d/editor.js): centerX, centerZ, yFromWorldZSign
 * - `allRooms`, `wallStrips` (from engine3d.js): Scene state arrays
 * - `plan2dBuildWallSubsegments()` (from plan2d/editor.js or app.js): Wall segment splitting
 * - `createRoom()` (from app.js or roomPalette.js): Room factory
 * - `quantizeMeters()`, `saveProjectSilently()`, `renderLoop()` (from engine3d.js)
 * 
 * **Algorithm Overview:**
 * 1. Respect room groups (walls with groupId='room:xxx') to preserve user-defined rooms
 * 2. Detect rectangular rooms via node graph and span coverage
 * 3. Detect polygon rooms via connected component analysis and orientation
 * 4. Extrude remaining walls as interior strips
 * 5. Attach openings to room faces (via edge matching) and strips (via host index)
 * 6. Deduplicate wall strips by geometry (order-insensitive) while preserving openings
 * 
 * **Tolerances:**
 * - Wall endpoint matching: 3cm (TOL = 0.03m)
 * - Orthogonality check: 3cm deviation allowed
 * - Opening span expansion: Auto-expand zero-width openings to default widths
 * 
 * @exports applyPlan2DTo3D
 * @version 2.0 (Post-Phase-1-Refactoring)
 * @since 2024
 */

"use strict";
// Apply 2D plan edits back to 3D: rebuild rooms/strips from 2D walls and openings
// Extracted from app.js for modularity; loaded by bootstrap before app core.
function applyPlan2DTo3D(elemsSnapshot, opts){
  // Don't apply 2D to 3D if we're in the middle of a 3D drag
  if (window.__dragging3DRoom) {
    console.log('🚫 applyPlan2DTo3D BLOCKED during 3D drag (flag is true)');
    return;
  }
  console.log('🔄 applyPlan2DTo3D RUNNING (flag is false or undefined)');
  
  try {
    opts = opts || {};
    var stripsOnly = !!opts.stripsOnly;
    var allowRooms = !!opts.allowRooms;
    var quiet = !!opts.quiet;
    var nonDestructive = !!opts.nonDestructive; // when true, don't clear 3D rooms if there are no room walls in 2D (e.g., during view toggles)
  // When true (default), only create rooms from explicit closed loops (rectangles or single closed polygons).
  // This avoids inferring rooms from planar subdivision faces which can create unwanted triangular/duplicate rooms
  // when free-standing walls or T-junctions are present.
  var strictClosedLoopsOnly = (typeof opts.strictClosedLoopsOnly === 'boolean') ? !!opts.strictClosedLoopsOnly : true;
    // Which floor to apply to (0=ground, 1=first). Default to ground for backward compatibility.
    var targetLevel = (typeof opts.level === 'number') ? opts.level : 0;
    // Debug/telemetry helper: emit a summary event so UI or tests can observe what was applied
    function __emitApplySummary(summary){
      try {
        var det = Object.assign({ level: targetLevel, nonDestructive: !!nonDestructive, timestamp: Date.now() }, summary||{});
        window.__lastApplySummary = det;
        try { window.dispatchEvent(new CustomEvent('gablok:apply-summary', { detail: det })); } catch(_d) {}
        try { if (console && console.debug) console.debug('[applyPlan2DTo3D]', det); } catch(_c) {}
      } catch(_e) {}
    }
  // Build a stable plan context; default to live __plan2d but allow a snapshot object
  var __ctx = {
    centerX: (typeof __plan2d!== 'undefined' && __plan2d && isFinite(__plan2d.centerX)) ? __plan2d.centerX : 0,
    centerZ: (typeof __plan2d!== 'undefined' && __plan2d && isFinite(__plan2d.centerZ)) ? __plan2d.centerZ : 0,
    ySign: (typeof __plan2d!== 'undefined' && __plan2d && (__plan2d.yFromWorldZSign===-1 || __plan2d.yFromWorldZSign===1)) ? __plan2d.yFromWorldZSign : 1,
    scale: (typeof __plan2d!== 'undefined' && __plan2d && isFinite(__plan2d.scale)) ? __plan2d.scale : undefined
  };
  var __hasSnapshotObj = (elemsSnapshot && typeof elemsSnapshot === 'object' && Array.isArray(elemsSnapshot.elements));
  if (__hasSnapshotObj) {
    if (isFinite(elemsSnapshot.centerX)) __ctx.centerX = elemsSnapshot.centerX;
    if (isFinite(elemsSnapshot.centerZ)) __ctx.centerZ = elemsSnapshot.centerZ;
    if (elemsSnapshot.yFromWorldZSign === -1 || elemsSnapshot.yFromWorldZSign === 1) __ctx.ySign = elemsSnapshot.yFromWorldZSign;
    if (isFinite(elemsSnapshot.scale)) __ctx.scale = elemsSnapshot.scale;
  }
  // Always operate on a deep clone so temporary role/group markings do not mutate the 2D editor state.
  var elemsSrc = (function(){
    var base = __hasSnapshotObj ? elemsSnapshot.elements : (Array.isArray(elemsSnapshot) ? elemsSnapshot : (__plan2d.elements||[]));
    try { return JSON.parse(JSON.stringify(base)); }
    catch(_e){ var cloned=[]; for (var i=0;i<base.length;i++){ var el=base[i]; cloned.push(el? Object.assign({}, el): el); } return cloned; }
  })();
  var __groupedRooms = [];
    // Phase -1: Respect room groups to avoid splitting user-added rooms when walls touch.
    // If walls carry a groupId like 'room:<id>' (created when 2D is populated from existing 3D rooms),
    // reconstruct those rooms first and temporarily mark their walls as nonroom so they won't be
    // reconsidered in polygon/rectangle detection below.
    (function handleGroupedRooms(){
      try {
        var groupMap = Object.create(null);
        for (var gi=0; gi<elemsSrc.length; gi++){
          var elg = elemsSrc[gi]; if(!elg || elg.type!=='wall') continue;
          if (typeof elg.groupId === 'string' && elg.groupId.indexOf('room:')===0){
            if (!groupMap[elg.groupId]) groupMap[elg.groupId] = [];
            groupMap[elg.groupId].push(gi);
          }
        }
  var sgnG = (__ctx.ySign||1);
        Object.keys(groupMap).forEach(function(gid){
          var idxs = groupMap[gid]; if(!idxs || idxs.length<4) return;
          var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
          for (var k=0;k<idxs.length;k++){
            var w = elemsSrc[idxs[k]]; if(!w) continue;
            minX = Math.min(minX, w.x0, w.x1); maxX = Math.max(maxX, w.x0, w.x1);
            minY = Math.min(minY, w.y0, w.y1); maxY = Math.max(maxY, w.y0, w.y1);
          }
          if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return;
          // Map plan bbox to world rect
          var wx=(__ctx.centerX||0) + (minX+maxX)/2;
          var wz=(__ctx.centerZ||0) + sgnG*((minY+maxY)/2);
          var wW = Math.max(0.5, quantizeMeters(maxX-minX, 2));
          var wD = Math.max(0.5, quantizeMeters(maxY-minY, 2));
          var roomG = createRoom(wx, wz, targetLevel);
          roomG.width = wW; roomG.depth = wD; roomG.height = 3; roomG.name = 'Room';
          roomG.groupId = gid;
          // Openings: any window/door hosted on grouped walls -> map to world endpoints
          var openingsGW = [];
          try {
            var idxSet = Object.create(null); for (var ii=0; ii<idxs.length; ii++){ idxSet[idxs[ii]] = true; }
            for (var ei=0; ei<elemsSrc.length; ei++){
              var el = elemsSrc[ei]; if(!el || (el.type!=='window' && el.type!=='door')) continue;
              if (typeof el.host !== 'number' || !idxSet[el.host]) continue;
              var host = elemsSrc[el.host]; if(!host || host.type!=='wall') continue;
              var t0=Math.max(0,Math.min(1,el.t0||0)), t1=Math.max(0,Math.min(1,el.t1||0));
              // Normalize zero-width openings: expand to a minimal default span so they render
              try {
                if (Math.abs(t1 - t0) < 1e-6) {
                  var wdxN = host.x1 - host.x0, wdyN = host.y1 - host.y0; var wLenN = Math.hypot(wdxN, wdyN) || 1;
                  var defWn = (el.type==='door') ? ((__plan2d&&__plan2d.doorWidthM)||0.9) : ((__plan2d&&__plan2d.windowDefaultWidthM)||1.2);
                  var dtn = Math.max(0.01, defWn / wLenN);
                  var midn = t0;
                  t0 = Math.max(0, Math.min(1, midn - dtn/2));
                  t1 = Math.max(0, Math.min(1, midn + dtn/2));
                  if (t1 <= t0 + 1e-6) t1 = Math.min(1, t0 + 0.02);
                }
              } catch(_eZeroOpenG) {}
              var ax = host.x0 + (host.x1-host.x0)*t0; var ay = host.y0 + (host.y1-host.y0)*t0;
              var bx = host.x0 + (host.x1-host.x0)*t1; var by = host.y0 + (host.y1-host.y0)*t1;
              var wx0 = (__ctx.centerX||0) + ax; var wz0 = (__ctx.centerZ||0) + sgnG*ay;
              var wx1 = (__ctx.centerX||0) + bx; var wz1 = (__ctx.centerZ||0) + sgnG*by;
              if (typeof console !== 'undefined' && console.log) { console.log('🔍 Converting plan->world: center=(' + ((__ctx.centerX||0).toFixed(2)) + ',' + ((__ctx.centerZ||0).toFixed(2)) + ') plan=(' + ax.toFixed(2) + ',' + ay.toFixed(2) + ') world=(' + wx0.toFixed(2) + ',' + wz0.toFixed(2) + ')'); }
              var sill = (el.type==='window') ? ((typeof el.sillM==='number') ? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0)) : 0;
              var hM = (typeof el.heightM==='number') ? el.heightM : ((el.type==='door') ? ((__plan2d&&__plan2d.doorHeightM)||2.04) : ((__plan2d&&__plan2d.windowHeightM)||1.5));
              // Determine edge from host wall orientation using average coordinates
              var hostAvgX = (host.x0 + host.x1) / 2;
              var hostAvgY = (host.y0 + host.y1) / 2;
              var hostDx = Math.abs(host.x1 - host.x0);
              var hostDy = Math.abs(host.y1 - host.y0);
              var edgeTag = null;
              if (hostDx > hostDy) {
                edgeTag = (hostAvgY < 0) ? 'top' : 'bottom';
              } else {
                edgeTag = (hostAvgX < 0) ? 'left' : 'right';
              }
              openingsGW.push({ type: el.type, x0: wx0, z0: wz0, x1: wx1, z1: wz1, sillM: sill, heightM: hM, meta: (el.meta||null), edge: edgeTag });
              if (typeof console !== 'undefined' && console.log) {
                console.log('🔨 Building opening from 2D plan:', el.type, 'x0:', wx0.toFixed(2), 'z0:', wz0.toFixed(2), 'x1:', wx1.toFixed(2), 'z1:', wz1.toFixed(2), 'host wall:', 'x0:', host.x0.toFixed(2), 'y0:', host.y0.toFixed(2), 'x1:', host.x1.toFixed(2), 'y1:', host.y1.toFixed(2));
              }
            }
          } catch(_gOpen) {}
          roomG.openings = openingsGW;
          __groupedRooms.push(roomG);
          // Exclude these walls from further detection by marking as nonroom temporarily
          for (var m=0; m<idxs.length; m++){
            var ww = elemsSrc[idxs[m]]; if(ww && ww.type==='wall') ww.wallRole = 'nonroom';
          }
        });
      } catch(_ge) { /* ignore grouping errors */ }
    })();
  // Room reconstruction should consider any wall that isn't explicitly marked as a non-room outline.
  // This way, newly drawn user walls (no role) can form rooms. Non-room component outlines (garage/pergola/balcony) are excluded.
  var walls = elemsSrc.filter(function(e){ return e && e.type==='wall' && e.wallRole !== 'nonroom'; });
  
  if(walls.length===0){
      // If we have grouped rooms, we need to update them with new openings (even in nonDestructive mode)
      if (Array.isArray(__groupedRooms) && __groupedRooms.length > 0) {
        if (typeof console !== 'undefined' && console.log) {
          console.log('[DEBUG applyPlan2DTo3D] No detectable walls but updating', __groupedRooms.length, 'grouped rooms');
        }
        // Collect previous openings before removing rooms so we can reuse them
        var prevOpeningsNoWalls = [];
        allRooms.forEach(function(r){
          if ((r.level||0) === targetLevel && Array.isArray(r.openings)){
            r.openings.forEach(function(op){ if(op) prevOpeningsNoWalls.push(op); });
          }
        });
        if (typeof console !== 'undefined' && console.log && prevOpeningsNoWalls.length > 0) {
          console.log('💾 [No-walls path] Collected', prevOpeningsNoWalls.length, 'previous openings from target level before rebuild');
        }
        // Remove old rooms on target level and replace with updated grouped rooms
        allRooms = allRooms.filter(function(r){ return (r.level||0)!==targetLevel; });
        for (var gr=0; gr<__groupedRooms.length; gr++){
          var grpNoWalls = __groupedRooms[gr];
          if (typeof console !== 'undefined' && console.log) {
            console.log('[DEBUG applyPlan2DTo3D] Adding grouped room', grpNoWalls.id, 'with', (grpNoWalls.openings||[]).length, 'openings');
          }
          // Try to reuse existing opening objects, especially those marked as manually positioned
          var newOpeningsArrNoWalls = [];
          try {
            var gOpenNoWalls = Array.isArray(grpNoWalls.openings) ? grpNoWalls.openings.slice() : [];
            for (var oi=0; oi<gOpenNoWalls.length; oi++){
              var gwNoWalls = gOpenNoWalls[oi]; if(!gwNoWalls) continue;
              var reusedNoWalls = null;
              var gxNoWalls = (typeof gwNoWalls.x0==='number' && typeof gwNoWalls.x1==='number') ? ((gwNoWalls.x0+gwNoWalls.x1)/2) : (gwNoWalls.x0||0);
              var gzNoWalls = (typeof gwNoWalls.z0==='number' && typeof gwNoWalls.z1==='number') ? ((gwNoWalls.z0+gwNoWalls.z1)/2) : (gwNoWalls.z0||0);
              
              // First try to find manually positioned openings (exact match preferred)
              for (var pi=0; pi<prevOpeningsNoWalls.length; pi++){
                var popNoWalls = prevOpeningsNoWalls[pi]; if(!popNoWalls) continue;
                if (popNoWalls.type !== gwNoWalls.type) continue;
                
                // DEBUG: Check if manual flag exists
                if (typeof console !== 'undefined' && console.log && popNoWalls.__manuallyPositioned) {
                  console.log('🔍 Found manually positioned opening:', popNoWalls.type, 'flag:', popNoWalls.__manuallyPositioned);
                }
                
                // If this opening was manually positioned, prefer it strongly (use larger tolerance)
                var tolerance = popNoWalls.__manuallyPositioned ? 2.0 : 0.25; // 2m vs 25cm
                
                var pxNoWalls = (typeof popNoWalls.x0==='number' && typeof popNoWalls.x1==='number') ? ((popNoWalls.x0+popNoWalls.x1)/2) : (popNoWalls.x0||0);
                var pzNoWalls = (typeof popNoWalls.z0==='number' && typeof popNoWalls.z1==='number') ? ((popNoWalls.z0+popNoWalls.z1)/2) : (popNoWalls.z0||0);
                var dxNoWalls = pxNoWalls - gxNoWalls, dzNoWalls = pzNoWalls - gzNoWalls;
                if ((dxNoWalls*dxNoWalls + dzNoWalls*dzNoWalls) <= tolerance*tolerance) {
                  reusedNoWalls = prevOpeningsNoWalls.splice(pi,1)[0]; break;
                }
              }
              
              if (reusedNoWalls){
                // DEBUG: Show flag state
                if (typeof console !== 'undefined' && console.log) {
                  console.log('🔍 Reused opening flag check:', reusedNoWalls.type, '__manuallyPositioned:', reusedNoWalls.__manuallyPositioned);
                }
                // If manually positioned, keep existing coords; otherwise update to new plan coords
                if (!reusedNoWalls.__manuallyPositioned) {
                  try { reusedNoWalls.x0 = gwNoWalls.x0; reusedNoWalls.z0 = gwNoWalls.z0; reusedNoWalls.x1 = gwNoWalls.x1; reusedNoWalls.z1 = gwNoWalls.z1; reusedNoWalls.edge = gwNoWalls.edge || reusedNoWalls.edge; reusedNoWalls.sillM = ('sillM' in gwNoWalls) ? gwNoWalls.sillM : reusedNoWalls.sillM; reusedNoWalls.heightM = ('heightM' in gwNoWalls) ? gwNoWalls.heightM : reusedNoWalls.heightM; reusedNoWalls.meta = ('meta' in gwNoWalls) ? gwNoWalls.meta : reusedNoWalls.meta; } catch(_u){}
                  if (typeof console !== 'undefined' && console.log) {
                    console.log('♻️ REUSED opening:', reusedNoWalls.type, 'updated coords x0:', reusedNoWalls.x0.toFixed(2), 'z0:', reusedNoWalls.z0.toFixed(2), 'x1:', reusedNoWalls.x1.toFixed(2), 'z1:', reusedNoWalls.z1.toFixed(2));
                  }
                } else {
                  if (typeof console !== 'undefined' && console.log) {
                    console.log('🔒 PRESERVED manual opening:', reusedNoWalls.type, 'keeping coords x0:', reusedNoWalls.x0.toFixed(2), 'z0:', reusedNoWalls.z0.toFixed(2), 'x1:', reusedNoWalls.x1.toFixed(2), 'z1:', reusedNoWalls.z1.toFixed(2));
                  }
                }
                newOpeningsArrNoWalls.push(reusedNoWalls);
              } else {
                if (typeof console !== 'undefined' && console.log) {
                  console.log('🆕 NEW opening:', gwNoWalls.type, 'coords x0:', gwNoWalls.x0.toFixed(2), 'z0:', gwNoWalls.z0.toFixed(2), 'x1:', gwNoWalls.x1.toFixed(2), 'z1:', gwNoWalls.z1.toFixed(2));
                }
                newOpeningsArrNoWalls.push(gwNoWalls);
              }
            }
          } catch(_rgNoWalls) { /* ignore reuse errors */ }
          grpNoWalls.openings = newOpeningsArrNoWalls;
          allRooms.push(grpNoWalls);
        }
        saveProjectSilently(); renderLoop();
        if(!quiet) updateStatus('Updated grouped rooms with openings');
        __emitApplySummary({ action: 'updated-grouped-rooms', roomsRect: 0, roomsPoly: 0, strips: 0 });
        return;
      }
      // No grouped rooms: handle as before
      // In non-destructive mode (e.g., on modal close/floor toggle), do not clear 3D state.
      if (nonDestructive) {
        if(!quiet) try { updateStatus('Skipped apply: no room walls on current floor'); } catch(e) {}
        __emitApplySummary({ action: 'skip-no-walls', roomsRect: 0, roomsPoly: 0, strips: 0 });
        return;
      } else {
        // Destructive mode: reflect 2D state by clearing rooms on the target level
        allRooms = allRooms.filter(function(r){ return (r.level||0)!==targetLevel; });
        // Also clear any standalone strips for this level and rebuild below if needed
        wallStrips = wallStrips.filter(function(ws){ return (ws.level||0)!==targetLevel ? true : false; });
        saveProjectSilently(); selectedRoomId=null; renderLoop();
        if(!quiet) updateStatus('Cleared ' + (targetLevel===0?'ground':'first') + ' floor 3D rooms (no walls in 2D)');
        __emitApplySummary({ action: 'cleared-no-walls', roomsRect: 0, roomsPoly: 0, strips: 0 });
        return;
      }
    }
  function approxEq(a,b,eps){ return Math.abs(a-b) < (eps||TOL); }
  var TOL=0.03; // 3 cm forgiving tolerance for detection (used across passes)
  var OPENING_TOL=0.05; // 5 cm tolerance for matching openings to room edges (slightly more forgiving)
    function keyCoord(v){ return Math.round(v / TOL) * TOL; }

    // Deduplicate wall strips by geometry (order-insensitive) and merge openings arrays
    function _dedupeStripsByGeom(arr){
      try {
        if (!Array.isArray(arr) || arr.length===0) return [];
        var map = Object.create(null);
        function kf(x){ return Math.round((+x||0) * 1000) / 1000; } // 1mm granularity
        for (var i=0;i<arr.length;i++){
          var s = arr[i]; if(!s) continue;
          var a0 = { x:kf(s.x0), z:kf(s.z0) }, a1 = { x:kf(s.x1), z:kf(s.z1) };
          // Build key independent of direction
          var kA = a0.x+','+a0.z, kB = a1.x+','+a1.z; var k = (kA < kB) ? (kA+'|'+kB) : (kB+'|'+kA);
          var bucket = map[k];
          if (!bucket) {
            // Shallow clone to avoid mutating original; preserve openings if present
            var base = {
              x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1,
              thickness: s.thickness, height: s.height,
              baseY: s.baseY, level: s.level,
              openings: Array.isArray(s.openings) ? s.openings.slice() : undefined
            };
            map[k] = base;
          } else {
            // Merge openings
            var dst = bucket;
            var srcOps = Array.isArray(s.openings) ? s.openings : [];
            if (srcOps.length){
              if (!Array.isArray(dst.openings)) dst.openings = [];
              // Deduplicate by type + endpoints + sill/height rounded
              var seen = Object.create(null);
              for (var j=0;j<dst.openings.length;j++){
                var o=dst.openings[j]; var kk = [o.type, kf(o.x0), kf(o.z0), kf(o.x1), kf(o.z1), kf(o.sillM||0), kf(o.heightM||0)].join('|');
                seen[kk] = true;
              }
              for (var m=0;m<srcOps.length;m++){
                var p=srcOps[m]; var kk2 = [p.type, kf(p.x0), kf(p.z0), kf(p.x1), kf(p.z1), kf(p.sillM||0), kf(p.heightM||0)].join('|');
                if (!seen[kk2]) { dst.openings.push(p); seen[kk2] = true; }
              }
            }
            // Prefer the larger thickness/height if different (best-effort)
            try { if (isFinite(s.thickness) && (!isFinite(dst.thickness) || s.thickness > dst.thickness)) dst.thickness = s.thickness; } catch(_eT) {}
            try { if (isFinite(s.height) && (!isFinite(dst.height) || s.height > dst.height)) dst.height = s.height; } catch(_eH) {}
          }
        }
        // Return stable order
        return Object.keys(map).map(function(key){ return map[key]; });
      } catch(e){ return Array.isArray(arr) ? arr.slice() : []; }
    }

    // Pass 0: Stitch connected orthogonal walls into rectangular loops (handles 5-6 segment rectangles)
    // This is more permissive than span pairing and bridges tiny endpoint gaps; marks perimeter walls as room walls.
    var roomsFromLoops = [];
    try {
      var nodes = {}; // key "x,y" -> {x,y, edges:[edgeIndex,...]}
      var edges = []; // wall indices in elemsSrc for this pass
      var edgeToEndpoints = []; // [{aKey,bKey}]
      for (var wi0=0; wi0<elemsSrc.length; wi0++){
        var w0 = elemsSrc[wi0]; if(!w0 || w0.type!=='wall' || w0.wallRole==='nonroom') continue;
  // Accept near-orthogonal walls only (use unified tolerance)
  if(!approxEq(w0.y0, w0.y1, TOL) && !approxEq(w0.x0, w0.x1, TOL)) continue;
        var ax0 = keyCoord(w0.x0), ay0 = keyCoord(w0.y0);
        var bx0 = keyCoord(w0.x1), by0 = keyCoord(w0.y1);
        var aKey = ax0.toFixed(2)+","+ay0.toFixed(2);
        var bKey = bx0.toFixed(2)+","+by0.toFixed(2);
        if(!nodes[aKey]) nodes[aKey] = {x:ax0, y:ay0, edges:[]};
        if(!nodes[bKey]) nodes[bKey] = {x:bx0, y:by0, edges:[]};
        var eIdx = edges.length; edges.push(wi0); edgeToEndpoints.push({a:aKey, b:bKey});
        nodes[aKey].edges.push(eIdx); nodes[bKey].edges.push(eIdx);
      }
      // Build connected components over edges via node adjacency
      var visitedEdge = new Array(edges.length).fill(false);
      function collectComponent(startEdge){
        var stack=[startEdge]; var compEdges=[]; var seenNodes=new Set();
        while(stack.length){
          var ei = stack.pop(); if(visitedEdge[ei]) continue; visitedEdge[ei]=true; compEdges.push(ei);
          var ep = edgeToEndpoints[ei]; if(!ep) continue; var a=ep.a,b=ep.b; if(a) seenNodes.add(a); if(b) seenNodes.add(b);
          var na = nodes[a]; var nb = nodes[b];
          if(na && Array.isArray(na.edges)) for(var k=0;k<na.edges.length;k++){ var e2=na.edges[k]; if(!visitedEdge[e2]) stack.push(e2); }
          if(nb && Array.isArray(nb.edges)) for(var k2=0;k2<nb.edges.length;k2++){ var e3=nb.edges[k2]; if(!visitedEdge[e3]) stack.push(e3); }
        }
        return {edges:compEdges, nodes:Array.from(seenNodes)};
      }
      var comps=[]; for (var se=0; se<edges.length; se++){ if(!visitedEdge[se]) comps.push(collectComponent(se)); }
      // Helper to merge spans with tolerance
      function mergeSpansLoose(spans){ if(!spans||!spans.length) return []; spans.sort(function(A,B){return A[0]-B[0];}); var out=[]; for(var i=0;i<spans.length;i++){ var s=spans[i]; if(!out.length) out.push([s[0],s[1]]); else { var last=out[out.length-1]; if(s[0] <= last[1] + Math.max(TOL,0.03)){ last[1] = Math.max(last[1], s[1]); } else out.push([s[0],s[1]]); } } return out; }
      function spansCover(spans, a,b){ var m=mergeSpansLoose(spans); if(!m.length) return false; var coveredStart=a; for(var i=0;i<m.length;i++){ var s=m[i]; if(s[0] > coveredStart + Math.max(TOL,0.03)) return false; coveredStart = Math.max(coveredStart, s[1]); if(coveredStart >= b - Math.max(TOL,0.03)) return true; } return coveredStart >= b - Math.max(TOL,0.03); }
      // Analyze components for rectangular loops; if not strictly rectangular, fallback to closed-loop bounding box
      for (var ci=0; ci<comps.length; ci++){
        var comp = comps[ci]; if(comp.edges.length < 4) continue; // need at least 4 segments
        // Collect unique snapped X and Y from endpoints
        var xs=new Set(), ys=new Set();
        for (var ni=0; ni<comp.nodes.length; ni++){ var nk = comp.nodes[ni]; var nn = nodes[nk]; if(!nn) continue; xs.add(+nn.x.toFixed(2)); ys.add(+nn.y.toFixed(2)); }
        if(xs.size!==2 || ys.size!==2) continue; // rectangle candidates only
        var xVals=Array.from(xs).sort(function(a,b){return a-b;}); var yVals=Array.from(ys).sort(function(a,b){return a-b;});
        var xLeft=xVals[0], xRight=xVals[1], yTop=yVals[0], yBot=yVals[1];
        // Build spans for this component only
        var HcTop=[], HcBot=[], VcLeft=[], VcRight=[];
        for (var ei2=0; ei2<comp.edges.length; ei2++){
          var eIdx = comp.edges[ei2]; var wallIndex = edges[eIdx]; var w=elemsSrc[wallIndex]; if(!w) continue;
          var x0=w.x0,y0=w.y0,x1=w.x1,y1=w.y1; var xa=keyCoord(x0), xb=keyCoord(x1), ya=keyCoord(y0), yb=keyCoord(y1);
          if(approxEq(ya,yb,1e-2)){
            // horizontal
            if(Math.abs(ya - yTop) <= Math.max(TOL,0.03)) HcTop.push([ Math.min(xa,xb), Math.max(xa,xb) ]);
            else if(Math.abs(ya - yBot) <= Math.max(TOL,0.03)) HcBot.push([ Math.min(xa,xb), Math.max(xa,xb) ]);
          } else if(approxEq(xa,xb,1e-2)){
            // vertical
            if(Math.abs(xa - xLeft) <= Math.max(TOL,0.03)) VcLeft.push([ Math.min(ya,yb), Math.max(ya,yb) ]);
            else if(Math.abs(xa - xRight) <= Math.max(TOL,0.03)) VcRight.push([ Math.min(ya,yb), Math.max(ya,yb) ]);
          }
        }
        // Verify coverage of all four sides (bridge tiny gaps)
        var okRect = spansCover(HcTop, xLeft, xRight) && spansCover(HcBot, xLeft, xRight) && spansCover(VcLeft, yTop, yBot) && spansCover(VcRight, yTop, yBot);
        if(okRect){
          roomsFromLoops.push({ minX:xLeft, maxX:xRight, minY:yTop, maxY:yBot });
          // Mark walls in this component as perimeter room walls to avoid extruding as interior strips
          for (var ei3=0; ei3<comp.edges.length; ei3++){ var eId = edges[comp.edges[ei3]]; var ww = elemsSrc[eId]; if(ww && ww.type==='wall') ww.wallRole = 'room'; }
        }
      }
    } catch(_e) { /* tolerate loop pass failure */ }
    // Build horizontal and vertical tracks by clustering coordinates; merge spans
    var H = {}; // yKey -> array of [x0,x1]
    var V = {}; // xKey -> array of [y0,y1]
    function addSpan(map, key, a0, a1){ if(a1<a0){ var t=a0;a0=a1;a1=t; } if(!map[key]) map[key]=[]; map[key].push([a0,a1]); }
    for(var wi=0; wi<elemsSrc.length; wi++){
      var w = elemsSrc[wi]; if(!w || w.type!=='wall' || w.wallRole==='nonroom') continue;
      var x0=w.x0,y0=w.y0,x1=w.x1,y1=w.y1;
      if(approxEq(y0,y1,TOL)){ var yk=keyCoord((y0+y1)/2); addSpan(H, yk, Math.min(x0,x1), Math.max(x0,x1)); }
      else if(approxEq(x0,x1,TOL)){ var xk=keyCoord((x0+x1)/2); addSpan(V, xk, Math.min(y0,y1), Math.max(y0,y1)); }
    }
    function mergeSpans(spans){ if(!spans||!spans.length) return []; spans.sort(function(A,B){return A[0]-B[0];}); var out=[]; for(var i=0;i<spans.length;i++){ var s=spans[i]; if(!out.length) out.push([s[0],s[1]]); else { var last=out[out.length-1]; if(s[0] <= last[1] + TOL){ last[1] = Math.max(last[1], s[1]); } else out.push([s[0],s[1]]); } } return out; }
    // Merge all tracks
    Object.keys(H).forEach(function(k){ H[k]=mergeSpans(H[k]); });
    Object.keys(V).forEach(function(k){ V[k]=mergeSpans(V[k]); });

    // Helper: does a set of spans cover [a,b] fully?
    function covers(spans, a,b){ if(!spans||!spans.length) return false; for(var i=0;i<spans.length;i++){ var s=spans[i]; if(s[0] <= a + TOL && s[1] >= b - TOL) return true; } return false; }
    // Find rectangles by pairing horizontal tracks (yTop,yBot) and vertical tracks (xLeft,xRight)
  var yKeys = Object.keys(H).map(parseFloat).sort(function(a,b){return a-b;});
  var xKeys = Object.keys(V).map(parseFloat).sort(function(a,b){return a-b;});
  // Seed rectangles with any detected stitched loops first (handles 5–8 segment rectangles)
  var roomsFound = Array.isArray(roomsFromLoops) ? roomsFromLoops.slice() : [];
    for(var yi=0; yi<yKeys.length; yi++){
      for(var yj=yi+1; yj<yKeys.length; yj++){
        var yTop=yKeys[yi], yBot=yKeys[yj];
        for(var xi=0; xi<xKeys.length; xi++){
          for(var xj=xi+1; xj<xKeys.length; xj++){
            var xLeft=xKeys[xi], xRight=xKeys[xj];
            if( covers(H[yTop], xLeft, xRight) && covers(H[yBot], xLeft, xRight) && covers(V[xLeft], yTop, yBot) && covers(V[xRight], yTop, yBot) ){
              roomsFound.push({minX:Math.min(xLeft,xRight), maxX:Math.max(xLeft,xRight), minY:Math.min(yTop,yBot), maxY:Math.max(yTop,yBot)});
            }
          }
        }
      }
    }
    // Deduplicate roomsFound (rectangles may be discovered multiple times)
    var dedup=[]; roomsFound.forEach(function(R){
      for(var n=0;n<dedup.length;n++){
        var D=dedup[n]; if(approxEq(D.minX,R.minX)&&approxEq(D.maxX,R.maxX)&&approxEq(D.minY,R.minY)&&approxEq(D.maxY,R.maxY)) return; }
      dedup.push(R);
    });
    roomsFound=dedup;

    // Detect closed orthogonal loops into polygon rooms (L/U and shared-wall/T-junction shapes).
    // Runs regardless of rectangle detection so mixed floorplans are supported simultaneously.
    var polyRooms = [];
    if (!stripsOnly) {
      try {
        // 0) Fast path: detect simple single loops (all nodes degree=2) and emit ONE polygon per loop.
        // Build snapped graph over original walls to keep adjacency un-split for degree check
        var nodesSimple = Object.create(null); var edgesSimple = []; var endsSimple = [];
        for (var wps=0; wps<elemsSrc.length; wps++){
          var ws = elemsSrc[wps]; if(!ws || ws.type!=='wall' || ws.wallRole==='nonroom') continue;
          if(!approxEq(ws.y0, ws.y1, 1e-2) && !approxEq(ws.x0, ws.x1, 1e-2)) continue;
          var axS = keyCoord(ws.x0), ayS = keyCoord(ws.y0); var bxS = keyCoord(ws.x1), byS = keyCoord(ws.y1);
          var kAS = axS.toFixed(2)+","+ayS.toFixed(2); var kBS = bxS.toFixed(2)+","+byS.toFixed(2);
          if(!nodesSimple[kAS]) nodesSimple[kAS] = { x:axS, y:ayS, edges:[] };
          if(!nodesSimple[kBS]) nodesSimple[kBS] = { x:bxS, y:byS, edges:[] };
          var eIdS = edgesSimple.length; edgesSimple.push(wps); endsSimple.push({ a:kAS, b:kBS });
          nodesSimple[kAS].edges.push(eIdS); nodesSimple[kBS].edges.push(eIdS);
        }
        var visitedES = new Array(edgesSimple.length).fill(false);
        function compWalkSimple(start){ var st=[start], E=[], N=new Set(); while(st.length){ var ei=st.pop(); if(visitedES[ei]) continue; visitedES[ei]=true; E.push(ei); var ep=endsSimple[ei]; if(!ep) continue; N.add(ep.a); N.add(ep.b); var na=nodesSimple[ep.a], nb=nodesSimple[ep.b]; if(na) for(var u=0; u<na.edges.length; u++){ var e2=na.edges[u]; if(!visitedES[e2]) st.push(e2);} if(nb) for(var v=0; v<nb.edges.length; v++){ var e3=nb.edges[v]; if(!visitedES[e3]) st.push(e3);} } return {edges:E, nodes:Array.from(N)}; }
        var compsSimple=[]; for (var sI=0; sI<sEdgesLength(); sI++){ if(!visitedES[sI]) compsSimple.push(compWalkSimple(sI)); }
        function sEdgesLength(){ return edgesSimple.length; }
        var usedWallIdx = Object.create(null);
        for (var cs=0; cs<compsSimple.length; cs++){
          var compS = compsSimple[cs]; if (compS.edges.length < 4) continue;
          var degOK = true; for (var nn=0; nn<compS.nodes.length; nn++){ var kN=compS.nodes[nn]; var nS=nodesSimple[kN]; if(!nS || nS.edges.length!==2){ degOK=false; break; } }
          if (!degOK) continue;
          // Build neighbor map and trace a single polygon around the loop
          var adjS = Object.create(null);
          for (var eiS=0; eiS<compS.edges.length; eiS++){ var ed = compS.edges[eiS]; var ep = endsSimple[ed]; if(!adjS[ep.a]) adjS[ep.a]=[]; if(!adjS[ep.b]) adjS[ep.b]=[]; adjS[ep.a].push(ep.b); adjS[ep.b].push(ep.a); }
          // Start from bottom-left
          var startKeyS=null, minYS=Infinity, minXS=Infinity; for (var kk=0; kk<compS.nodes.length; kk++){ var key=compS.nodes[kk]; var n=nodesSimple[key]; if(n.y < minYS - 1e-6 || (approxEq(n.y,minYS,1e-6) && n.x < minXS - 1e-6)){ minYS=n.y; minXS=n.x; startKeyS=key; } }
          if(!startKeyS) continue; var startN=nodesSimple[startKeyS]; var neighS=adjS[startKeyS]||[]; if(!neighS.length) continue;
          var nextKeyS=null, bestAngS=Infinity; for (var ni=0; ni<neighS.length; ni++){ var nk=neighS[ni]; var v=nodesSimple[nk]; var ang=Math.atan2(v.y-startN.y, v.x-startN.x); if(ang < bestAngS){ bestAngS=ang; nextKeyS=nk; } }
          var polyS=[{x:startN.x,y:startN.y}], prevKeyS=startKeyS, curKeyS=nextKeyS, guardS=0;
          while(curKeyS && guardS++<10000){ var cur=nodesSimple[curKeyS]; polyS.push({x:cur.x,y:cur.y}); var ns=adjS[curKeyS]||[]; var nA=ns[0], nB=ns[1]; var nxt=(nA===prevKeyS? nB:nA); if(!nxt || nxt===startKeyS) break; prevKeyS=curKeyS; curKeyS=nxt; }
          if (polyS.length >= 4) {
            // Collect wall indices from this component
            var wallIdxSetS = Object.create(null);
            for (var eMark=0; eMark<compS.edges.length; eMark++){ var weIdx = edgesSimple[compS.edges[eMark]]; wallIdxSetS[weIdx] = true; usedWallIdx[weIdx] = true; }
            var gidS = 'poly_loop_'+cs+'_'+Math.floor((performance && performance.now)? performance.now(): Date.now());
            polyRooms.push({ poly: polyS, groupId: gidS, wallIdxSet: wallIdxSetS });
            // Mark perimeter walls as room
            try { Object.keys(wallIdxSetS).forEach(function(wix){ var wref=elemsSrc[+wix]; if(wref && wref.type==='wall') wref.wallRole='room'; }); } catch(_){ }
          }
        }

  // If strictClosedLoopsOnly is enabled, skip advanced face decomposition that can cut areas into small rooms.
  if (!strictClosedLoopsOnly) {
  // 1) Build snapped node set from remaining walls, split at T-junctions and create half-edges
        var nodesP = Object.create(null); // key -> { x, y, out: [] }
        var endpointWalls = []; // keep original wall refs for indexing
        for (var wiP = 0; wiP < elemsSrc.length; wiP++) {
          var wP = elemsSrc[wiP];
          if (!wP || wP.type !== 'wall' || wP.wallRole === 'nonroom') continue;
          if (usedWallIdx[wiP]) continue; // already emitted as a single polygon loop
          // only axis-aligned
          if (!approxEq(wP.y0, wP.y1, 1e-2) && !approxEq(wP.x0, wP.x1, 1e-2)) continue;
          var ax = keyCoord(wP.x0), ay = keyCoord(wP.y0);
          var bx = keyCoord(wP.x1), by = keyCoord(wP.y1);
          var kA = ax.toFixed(2) + "," + ay.toFixed(2);
          var kB = bx.toFixed(2) + "," + by.toFixed(2);
          if (!nodesP[kA]) nodesP[kA] = { x: ax, y: ay, out: [] };
          if (!nodesP[kB]) nodesP[kB] = { x: bx, y: by, out: [] };
          endpointWalls.push({ idx: wiP, aKey: kA, bKey: kB, x0: ax, y0: ay, x1: bx, y1: by });
        }
        // Build fast lookup of nodes by constant coordinate to split long walls at T-junctions
        var nodesByY = Object.create(null), nodesByX = Object.create(null);
        Object.keys(nodesP).forEach(function (k) {
          var n = nodesP[k];
          var yk = n.y.toFixed(2), xk = n.x.toFixed(2);
          if (!nodesByY[yk]) nodesByY[yk] = [];
          if (!nodesByX[xk]) nodesByX[xk] = [];
          nodesByY[yk].push(k);
          nodesByX[xk].push(k);
        });
        function keyOf(x, y) { return x.toFixed(2) + "," + y.toFixed(2); }
        function sortNumeric(a, b) { return a - b; }

        // 2) Split each wall into sub-edges at any intermediate junction nodes and create half-edges
        var halfEdges = []; // each: { aKey, bKey, angle, wallIndex }
        function addHalfEdge(aKey, bKey, wallIndex) {
          var a = nodesP[aKey], b = nodesP[bKey]; if (!a || !b) return;
          var ang = Math.atan2(b.y - a.y, b.x - a.x);
          var heIdx = halfEdges.length;
          halfEdges.push({ aKey: aKey, bKey: bKey, angle: ang, wallIndex: wallIndex });
          // register outgoing at tail
          nodesP[aKey].out.push(heIdx);
        }
        for (var ewi = 0; ewi < endpointWalls.length; ewi++) {
          var ew = endpointWalls[ewi]; var wallIdx = ew.idx;
          var horizontal = approxEq(ew.y0, ew.y1, 1e-2);
          if (horizontal) {
            var yKey = ew.y0.toFixed(2);
            var xs = [];
            // collect all node x along this y between endpoints
            var listY = nodesByY[yKey] || [];
            var xMin = Math.min(ew.x0, ew.x1) - Math.max(1e-6, TOL/2);
            var xMax = Math.max(ew.x0, ew.x1) + Math.max(1e-6, TOL/2);
            for (var li = 0; li < listY.length; li++) {
              var k = listY[li]; var n = nodesP[k]; if (!n) continue;
              if (n.x >= xMin && n.x <= xMax) xs.push(n.x);
            }
            // ensure endpoints present
            xs.push(ew.x0, ew.x1);
            xs = xs.map(function (v) { return +v.toFixed(2); }).sort(sortNumeric);
            // dedupe
            var uniq = []; for (var xi = 0; xi < xs.length; xi++) { if (!uniq.length || Math.abs(xs[xi] - uniq[uniq.length - 1]) > 1e-6) uniq.push(xs[xi]); }
            for (var xi2 = 0; xi2 < uniq.length - 1; xi2++) {
              var xa = uniq[xi2], xb = uniq[xi2 + 1]; if (xb - xa < 1e-6) continue;
              var aK = keyOf(xa, ew.y0), bK = keyOf(xb, ew.y0);
              // ensure nodes exist (they should)
              if (!nodesP[aK]) nodesP[aK] = { x: xa, y: ew.y0, out: [] };
              if (!nodesP[bK]) nodesP[bK] = { x: xb, y: ew.y0, out: [] };
              addHalfEdge(aK, bK, wallIndex);
              addHalfEdge(bK, aK, wallIndex);
            }
          } else {
            // vertical
            var xKey = ew.x0.toFixed(2);
            var ys = [];
            var listX = nodesByX[xKey] || [];
            var yMin = Math.min(ew.y0, ew.y1) - Math.max(1e-6, TOL/2);
            var yMax = Math.max(ew.y0, ew.y1) + Math.max(1e-6, TOL/2);
            for (var lj = 0; lj < listX.length; lj++) {
              var k2 = listX[lj]; var n2 = nodesP[k2]; if (!n2) continue;
              if (n2.y >= yMin && n2.y <= yMax) ys.push(n2.y);
            }
            ys.push(ew.y0, ew.y1);
            ys = ys.map(function (v) { return +v.toFixed(2); }).sort(sortNumeric);
            var uniqY = []; for (var yi = 0; yi < ys.length; yi++) { if (!uniqY.length || Math.abs(ys[yi] - uniqY[uniqY.length - 1]) > 1e-6) uniqY.push(ys[yi]); }
            for (var yi2 = 0; yi2 < uniqY.length - 1; yi2++) {
              var ya = uniqY[yi2], yb = uniqY[yi2 + 1]; if (yb - ya < 1e-6) continue;
              var aK2 = keyOf(ew.x0, ya), bK2 = keyOf(ew.x0, yb);
              if (!nodesP[aK2]) nodesP[aK2] = { x: ew.x0, y: ya, out: [] };
              if (!nodesP[bK2]) nodesP[bK2] = { x: ew.x0, y: yb, out: [] };
              addHalfEdge(aK2, bK2, wallIndex);
              addHalfEdge(bK2, aK2, wallIndex);
            }
          }
        }
        // Sort outgoing half-edges at each node by angle CCW
        Object.keys(nodesP).forEach(function (k) {
          var out = nodesP[k].out; out.sort(function (ia, ib) { return halfEdges[ia].angle - halfEdges[ib].angle; });
        });
        function nextCCWHalfEdge(curIdx) {
          var he = halfEdges[curIdx]; var node = nodesP[he.bKey]; if (!node) return -1;
          var out = node.out; if (!out || out.length === 0) return -1;
          // find first edge with angle greater than current angle; wrap if none
          var ang = he.angle;
          var best = out[0];
          for (var i = 0; i < out.length; i++) { if (halfEdges[out[i]].angle - ang > 1e-9) { best = out[i]; break; } }
          return best;
        }
        function polyArea(pts) { var a = 0; for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) { a += (pts[j].x * pts[i].y - pts[i].x * pts[j].y); } return a / 2; }
        function simplifyOrthogonal(poly) { // drop colinear middle points
          if (!poly || poly.length < 4) return poly;
          var out = [];
          for (var i = 0; i < poly.length; i++) {
            var p0 = poly[(i + poly.length - 1) % poly.length];
            var p1 = poly[i];
            var p2 = poly[(i + 1) % poly.length];
            var v1x = p1.x - p0.x, v1y = p1.y - p0.y;
            var v2x = p2.x - p1.x, v2y = p2.y - p1.y;
            var col = (Math.abs(v1x) < 1e-6 && Math.abs(v2x) < 1e-6) || (Math.abs(v1y) < 1e-6 && Math.abs(v2y) < 1e-6);
            if (!col) out.push(p1);
          }
          return out;
        }
        // 3) Traverse left faces from each half-edge to collect bounded cycles
        var visitedLeft = new Array(halfEdges.length).fill(false);
        var faces = [];
        for (var heIdx = 0; heIdx < halfEdges.length; heIdx++) {
          if (visitedLeft[heIdx]) continue;
          var start = heIdx; var cur = start; var guard = 0, MAX_STEPS = 10000;
          var polyKeys = []; var usedHe = [];
          while (cur >= 0 && guard++ < MAX_STEPS) {
            var he = halfEdges[cur];
            // push tail for first, then heads for subsequent
            if (polyKeys.length === 0) polyKeys.push(he.aKey);
            polyKeys.push(he.bKey);
            usedHe.push(cur);
            var nxt = nextCCWHalfEdge(cur);
            if (nxt < 0) break;
            if (nxt === start) { // closed cycle
              break;
            }
            // stop if we loop back to first vertex with at least 3 edges
            cur = nxt;
            if (usedHe.length > 2 && halfEdges[cur].aKey === halfEdges[start].aKey && halfEdges[cur].bKey === halfEdges[start].bKey) {
              break;
            }
          }
          // Validate and record the face
          if (usedHe.length >= 3 && polyKeys.length >= 4) {
            // Build polygon points from keys (excluding duplicate last if present)
            var pts = [];
            for (var pk = 0; pk < polyKeys.length; pk++) {
              var nk = nodesP[polyKeys[pk]]; if (!nk) continue; pts.push({ x: nk.x, y: nk.y });
            }
            // close and simplify
            // remove trailing duplicate of first if exists
            if (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-9 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-9) {
              pts.pop();
            }
            pts = simplifyOrthogonal(pts);
            if (pts.length >= 4) {
              var A = polyArea(pts);
              var areaAbs = Math.abs(A);
              if (areaAbs > (TOL * TOL)) {
                // record wall indices used along this face
                var wallSet = Object.create(null);
                for (var uh = 0; uh < usedHe.length; uh++) { var wId = halfEdges[usedHe[uh]].wallIndex; if (typeof wId === 'number') wallSet[wId] = true; }
                faces.push({ poly: pts, wallIdxSet: wallSet, area: areaAbs });
                // mark all half-edges on this face as visited-left to avoid duplicates
                for (var vh = 0; vh < usedHe.length; vh++) visitedLeft[usedHe[vh]] = true;
              }
            }
          }
        }
        // Keep ALL bounded faces above a minimum area as rooms, to support multi-room floor plans.
        // This avoids collapsing to a single large rectangle and preserves complex layouts.
        var MIN_FACE_AREA = 0.25; // m^2 threshold to ignore tiny slivers
        for (var fci = 0; fci < faces.length; fci++){
          var F = faces[fci]; if(!F) continue;
          if (!F.poly || F.poly.length < 3) continue;
          if ((F.area||0) < MIN_FACE_AREA) continue;
          var gid = 'polyf_' + fci + '_' + Math.floor((performance && performance.now) ? performance.now() : Date.now());
          polyRooms.push({ poly: F.poly, groupId: gid, wallIdxSet: F.wallIdxSet });
          // Do NOT mark walls as non-interior; we'll still extrude all walls as strips below.
        }
        } else {
          if (typeof console !== 'undefined' && console.log) {
            console.log('[applyPlan2DTo3D] strictClosedLoopsOnly=true: Skipping advanced polygon face decomposition');
          }
        }
      } catch(_polyAdvE) { /* best-effort; ignore on failure */ }
    }

  if((roomsFound.length===0 && polyRooms.length===0) || stripsOnly){
      // Walls present but no closed rectangles: extrude standalone wall strips from 2D
      // Respect nonDestructive: if true and we're not in explicit stripsOnly mode, do NOT clear existing rooms
      if (!nonDestructive || stripsOnly) {
        // Clear rooms on this level for rebuild (legacy behavior)
        allRooms = allRooms.filter(function(r){ return (r.level||0)!==targetLevel; });
      }
      // Build strip representation for this level
  var sgn = (__ctx.ySign||1);
      var strips = [];
      var __attachedOpenings = Object.create(null);
      function openingsForWall(hostIdx){
        var outs = [];
        for (var ei=0; ei<elemsSrc.length; ei++){
          var el = elemsSrc[ei]; if(!el || (el.type!=='window' && el.type!=='door')) continue;
          if (typeof el.host !== 'number' || el.host !== hostIdx) continue;
          var host = elemsSrc[hostIdx]; if(!host || host.type!=='wall') continue;
          var t0=Math.max(0,Math.min(1,el.t0||0)), t1=Math.max(0,Math.min(1,el.t1||0)); if(t1<t0){ var tt=t0; t0=t1; t1=tt; }
          // Normalize zero-width openings to a minimal default span
          try {
            if (Math.abs(t1 - t0) < 1e-6) {
              var wdxS = host.x1 - host.x0, wdyS = host.y1 - host.y0; var wLenS = Math.hypot(wdxS, wdyS) || 1;
              var defWs = (el.type==='door') ? ((__plan2d&&__plan2d.doorWidthM)||0.9) : ((__plan2d&&__plan2d.windowDefaultWidthM)||1.2);
              var dts = Math.max(0.01, defWs / wLenS);
              var mids = t0;
              t0 = Math.max(0, Math.min(1, mids - dts/2));
              t1 = Math.max(0, Math.min(1, mids + dts/2));
              if (t1 <= t0 + 1e-6) t1 = Math.min(1, t0 + 0.02);
            }
          } catch(_eZeroOpenS) {}
          var ax = host.x0 + (host.x1-host.x0)*t0; var ay = host.y0 + (host.y1-host.y0)*t0;
          var bx = host.x0 + (host.x1-host.x0)*t1; var by = host.y0 + (host.y1-host.y0)*t1;
          var wx0 = (__ctx.centerX||0) + ax; var wz0 = (__ctx.centerZ||0) + sgn*ay;
          var wx1 = (__ctx.centerX||0) + bx; var wz1 = (__ctx.centerZ||0) + sgn*by;
          var sill = (el.type==='window') ? ((typeof el.sillM==='number') ? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0)) : 0;
          var hM = (typeof el.heightM==='number') ? el.heightM : ((el.type==='door') ? ((__plan2d&&__plan2d.doorHeightM)||2.04) : ((__plan2d&&__plan2d.windowHeightM)||1.5));
          outs.push({ type: el.type, x0: wx0, z0: wz0, x1: wx1, z1: wz1, sillM: sill, heightM: hM, meta: (el.meta||null) });
        }
        return outs;
      }
      for(var wi=0; wi<elemsSrc.length; wi++){
        var e = elemsSrc[wi]; if(!e || e.type!=='wall') continue;
        var subs = plan2dBuildWallSubsegments(elemsSrc, wi) || [];
        for(var si=0; si<subs.length; si++){
          var sg = subs[si];
          var rec = {
            x0: (__ctx.centerX||0) + sg.ax,
            z0: (__ctx.centerZ||0) + sgn*sg.ay,
            x1: (__ctx.centerX||0) + sg.bx,
            z1: (__ctx.centerZ||0) + sgn*sg.by,
            thickness: (e.thickness||__plan2d.wallThicknessM||0.3),
            height: (__plan2d.wallHeightM||3.0),
            baseY: (targetLevel||0) * 3.5,
            level: (targetLevel||0)
          };
          // Attach this wall's openings to the first subsegment only to avoid duplicates
          if (!__attachedOpenings[wi]) {
            rec.openings = openingsForWall(wi);
            __attachedOpenings[wi] = true;
          }
          strips.push(rec);
        }
      }
  // Merge new strips with existing strips on this level and dedupe
  var keepOther = wallStrips.filter(function(ws){ return (ws.level||0)!==targetLevel; });
  var existingLvl = wallStrips.filter(function(ws){ return (ws.level||0)===targetLevel; });
  var merged = _dedupeStripsByGeom(existingLvl.concat(strips));
  wallStrips = keepOther.concat(merged);
  // Persist strips. In nonDestructive mode (and not stripsOnly), do NOT clear current object selection.
  saveProjectSilently();
  if (!nonDestructive || stripsOnly) {
    selectedRoomId = null;
  }
  selectedWallStripIndex = -1;
  renderLoop();
      // Fallback: in nonDestructive mode with no rooms detected, refresh openings on existing rectangular rooms
      if (nonDestructive && !stripsOnly) {
        try {
          var sgnW = (__ctx.ySign||1);
          // Collect 2D openings (windows/doors)
          var openings2D = [];
          for (var oi=0; oi<elemsSrc.length; oi++){
            var oe = elemsSrc[oi]; if(!oe || (oe.type!=='window' && oe.type!=='door')) continue;
            openings2D.push({ idx: oi, el: oe });
          }
          function mergeIntervalsFallback(arr){ if(!arr||!arr.length) return []; arr.sort(function(A,B){ return A[0]-B[0]; }); var out=[]; for(var i=0;i<arr.length;i++){ var a=arr[i]; if(!out.length) out.push([a[0],a[1]]); else { var last=out[out.length-1]; if(a[0] <= last[1] + 1e-6){ last[1] = Math.max(last[1], a[1]); } else { out.push([a[0],a[1]]); } } } return out; }
          for (var ri=0; ri<allRooms.length; ri++){
            var room = allRooms[ri]; if(!room || (room.level||0)!==targetLevel) continue;
            // Skip polygon rooms in this minimal fallback (keep their openings unchanged)
            if (Array.isArray(room.footprint) && room.footprint.length>=3) continue;
            var minX = (room.x||0) - (room.width||0)/2;
            var maxX = (room.x||0) + (room.width||0)/2;
            var minZ = (room.z||0) - (room.depth||0)/2;
            var maxZ = (room.z||0) + (room.depth||0)/2;
            // Map world rectangle back to plan space for classification
            var R = { minX: minX - (__ctx.centerX||0), maxX: maxX - (__ctx.centerX||0) };
            var minYp = (minZ - (__ctx.centerZ||0)) * sgnW; var maxYp = (maxZ - (__ctx.centerZ||0)) * sgnW;
            R.minY = Math.min(minYp, maxYp); R.maxY = Math.max(minYp, maxYp);
            var openingsOut = [];
            var winByEdge = { minZ:Object.create(null), maxZ:Object.create(null), minX:Object.create(null), maxX:Object.create(null) }; // edge -> profileKey -> [[s,e],...]
            for (var ok=0; ok<openings2D.length; ok++){
              var rec = openings2D[ok].el; var ax,ay,bx,by; var isDoor = (rec.type==='door');
              if(typeof rec.host==='number'){
                var host = elemsSrc[rec.host]; if(!host || host.type!=='wall') continue;
                var t0=Math.max(0,Math.min(1,rec.t0||0)), t1=Math.max(0,Math.min(1,rec.t1||0));
                // Normalize zero-width openings in fallback path
                try {
                  if (Math.abs(t1 - t0) < 1e-6) {
                    var wdxF = host.x1 - host.x0, wdyF = host.y1 - host.y0; var wLenF = Math.hypot(wdxF, wdyF) || 1;
                    var defWf = (rec.type==='door') ? ((__plan2d&&__plan2d.doorWidthM)||0.9) : ((__plan2d&&__plan2d.windowDefaultWidthM)||1.2);
                    var dtf = Math.max(0.01, defWf / wLenF);
                    var midf = t0;
                    t0 = Math.max(0, Math.min(1, midf - dtf/2));
                    t1 = Math.max(0, Math.min(1, midf + dtf/2));
                    if (t1 <= t0 + 1e-6) t1 = Math.min(1, t0 + 0.02);
                  }
                } catch(_eZeroOpenF) {}
                ax = host.x0 + (host.x1-host.x0)*t0; ay = host.y0 + (host.y1-host.y0)*t0;
                bx = host.x0 + (host.x1-host.x0)*t1; by = host.y0 + (host.y1-host.y0)*t1;
              } else {
                // Skip free openings in fallback
                continue;
              }
              var added=false; var T=0.03;
              var sgn = sgnW;
              var topY = (sgn===1 ? R.minY : R.maxY);
              var botY = (sgn===1 ? R.maxY : R.minY);
              if(Math.abs(ay - topY) <= T && Math.abs(by - topY) <= T){
                var sx = Math.max(R.minX, Math.min(R.maxX, Math.min(ax,bx)));
                var ex = Math.max(R.minX, Math.min(R.maxX, Math.max(ax,bx)));
                var q0 = quantizeMeters(sx - R.minX, 2); var q1 = quantizeMeters(ex - R.minX, 2);
                if(q1 > q0 + 1e-4){
                  if(isDoor){ var hD=(typeof rec.heightM==='number')?rec.heightM:((__plan2d&&__plan2d.doorHeightM)||2.04); openingsOut.push({type:'door', edge:'minZ', startM:q0, endM:q1, widthM:(q1-q0), heightM:hD, sillM:0, meta:(rec.meta||null)});
                  } else { var sill=(typeof rec.sillM==='number')?rec.sillM:((__plan2d&&__plan2d.windowSillM)||1.0); var hW=(typeof rec.heightM==='number')?rec.heightM:((__plan2d&&__plan2d.windowHeightM)||1.5); var pk='s'+(+sill.toFixed(3))+'_h'+(+hW.toFixed(3)); (winByEdge.minZ[pk]||(winByEdge.minZ[pk]=[])).push([q0,q1]); }
                  added=true;
                }
              }
              if(!added && Math.abs(ay - botY) <= T && Math.abs(by - botY) <= T){
                var s2 = Math.max(R.minX, Math.min(R.maxX, Math.min(ax,bx)));
                var e2 = Math.max(R.minX, Math.min(R.maxX, Math.max(ax,bx)));
                var q02 = quantizeMeters(s2 - R.minX, 2); var q12 = quantizeMeters(e2 - R.minX, 2);
                if(q12 > q02 + 1e-4){ if(isDoor){ var hD2=(typeof rec.heightM==='number')?rec.heightM:((__plan2d&&__plan2d.doorHeightM)||2.04); openingsOut.push({type:'door', edge:'maxZ', startM:q02, endM:q12, widthM:(q12-q02), heightM:hD2, sillM:0, meta:(rec.meta||null)}); } else { var sill2=(typeof rec.sillM==='number')?rec.sillM:((__plan2d&&__plan2d.windowSillM)||1.0); var hW2=(typeof rec.heightM==='number')?rec.heightM:((__plan2d&&__plan2d.windowHeightM)||1.5); var pk2='s'+(+sill2.toFixed(3))+'_h'+(+hW2.toFixed(3)); (winByEdge.maxZ[pk2]||(winByEdge.maxZ[pk2]=[])).push([q02,q12]); } added=true; }
              }
              if(!added && Math.abs(ax - R.minX) <= T && Math.abs(bx - R.minX) <= T){
                var sv = Math.max(R.minY, Math.min(R.maxY, Math.min(ay,by)));
                var ev = Math.max(R.minY, Math.min(R.maxY, Math.max(ay,by)));
                var q03 = quantizeMeters(sv - R.minY, 2); var q13 = quantizeMeters(ev - R.minY, 2);
                if(q13 > q03 + 1e-4){ if(isDoor){ var hD3=(typeof rec.heightM==='number')?rec.heightM:((__plan2d&&__plan2d.doorHeightM)||2.04); openingsOut.push({type:'door', edge:'minX', startM:q03, endM:q13, widthM:(q13-q03), heightM:hD3, sillM:0, meta:(rec.meta||null)}); } else { var sill3=(typeof rec.sillM==='number')?rec.sillM:((__plan2d&&__plan2d.windowSillM)||1.0); var hW3=(typeof rec.heightM==='number')?rec.heightM:((__plan2d&&__plan2d.windowHeightM)||1.5); var pk3='s'+(+sill3.toFixed(3))+'_h'+(+hW3.toFixed(3)); (winByEdge.minX[pk3]||(winByEdge.minX[pk3]=[])).push([q03,q13]); } added=true; }
              }
              if(!added && Math.abs(ax - R.maxX) <= T && Math.abs(bx - R.maxX) <= T){
                var sv2 = Math.max(R.minY, Math.min(R.maxY, Math.min(ay,by)));
                var ev2 = Math.max(R.minY, Math.min(R.maxY, Math.max(ay,by)));
                var q04 = quantizeMeters(sv2 - R.minY, 2); var q14 = quantizeMeters(ev2 - R.minY, 2);
                if(q14 > q04 + 1e-4){ if(isDoor){ var hD4=(typeof rec.heightM==='number')?rec.heightM:((__plan2d&&__plan2d.doorHeightM)||2.04); openingsOut.push({type:'door', edge:'maxX', startM:q04, endM:q14, widthM:(q14-q04), heightM:hD4, sillM:0, meta:(rec.meta||null)}); } else { var sill4=(typeof rec.sillM==='number')?rec.sillM:((__plan2d&&__plan2d.windowSillM)||1.0); var hW4=(typeof rec.heightM==='number')?rec.heightM:((__plan2d&&__plan2d.windowHeightM)||1.5); var pk4='s'+(+sill4.toFixed(3))+'_h'+(+hW4.toFixed(3)); (winByEdge.maxX[pk4]||(winByEdge.maxX[pk4]=[])).push([q04,q14]); } added=true; }
              }
            }
            ['minZ','maxZ','minX','maxX'].forEach(function(edge){ var prof = winByEdge[edge]; if(!prof) return; Object.keys(prof).forEach(function(pk){ var spans=mergeIntervalsFallback(prof[pk]); var m=pk.match(/^s([\d\.\-]+)_h([\d\.\-]+)$/); var wsill=(__plan2d&&__plan2d.windowSillM)||1.0; var wh=(__plan2d&&__plan2d.windowHeightM)||1.5; if(m){ wsill=parseFloat(m[1]); wh=parseFloat(m[2]); } for (var si=0; si<spans.length; si++){ var sM=spans[si][0], eM=spans[si][1]; openingsOut.push({ type:'window', edge:edge, startM:sM, endM:eM, widthM:(eM-sM), heightM:wh, sillM:wsill, meta:null }); } }); });
            room.openings = openingsOut;
          }
        } catch(_fallbackE) { /* ignore fallback opening refresh errors */ }
        saveProjectSilently(); renderLoop();
      }
      if(!quiet) updateStatus(nonDestructive && !stripsOnly ? 'Kept existing rooms; updated wall strips' : 'Applied 2D plan to 3D (standalone walls)');
      try { __emitApplySummary({ action: 'strips-only', roomsRect: 0, roomsPoly: 0, strips: (Array.isArray(merged)? merged.length : (Array.isArray(strips)? strips.length: 0)) }); } catch(_s) {}
      return;
    }

  // If rooms are not allowed (live strips-only mode), stop here
  if(!allowRooms){ return; }

  // Replace rooms on the target level for any rebuild when walls exist to avoid duplicates in live applies
  // But first collect previous openings on this level so we can try to reuse objects moved by 3D interactions
  var prevOpenings = [];
  allRooms.forEach(function(r){
    if ((r.level||0) === targetLevel && Array.isArray(r.openings)){
      r.openings.forEach(function(op){ if(op) prevOpenings.push(op); });
    }
  });
  if (typeof console !== 'undefined' && console.log && prevOpenings.length > 0) {
    console.log('💾 Collected', prevOpenings.length, 'previous openings from target level before rebuild');
  }
  // Remove existing rooms on this level (we will re-add grouped rooms below)
  allRooms = allRooms.filter(function(r){ return (r.level||0)!==targetLevel; });
  // Re-add grouped rooms (from 3D) first so they persist and aren't split by touching walls
  if (Array.isArray(__groupedRooms) && __groupedRooms.length){
    if (typeof console !== 'undefined' && console.log) {
      console.log('[DEBUG applyPlan2DTo3D] Re-adding', __groupedRooms.length, 'grouped rooms to allRooms (attempting to reuse openings)');
    }
    for (var gr=0; gr<__groupedRooms.length; gr++){
      var grp = __groupedRooms[gr];
      if (typeof console !== 'undefined' && console.log) {
        console.log('[DEBUG applyPlan2DTo3D] Adding grouped room', grp.id, 'with', (grp.openings||[]).length, 'openings');
      }
      // For each opening produced by the grouped room, try to find a nearby existing opening of same type
      var newOpeningsArr = [];
      try {
        var gOpen = Array.isArray(grp.openings) ? grp.openings.slice() : [];
        for (var oi=0; oi<gOpen.length; oi++){
          var gw = gOpen[oi]; if(!gw) continue;
          var reused = null;
          // Match by type and proximity of center point
          var gx = (typeof gw.x0==='number' && typeof gw.x1==='number') ? ((gw.x0+gw.x1)/2) : (gw.x0||0);
          var gz = (typeof gw.z0==='number' && typeof gw.z1==='number') ? ((gw.z0+gw.z1)/2) : (gw.z0||0);
          for (var pi=0; pi<prevOpenings.length; pi++){
            var pop = prevOpenings[pi]; if(!pop) continue;
            if (pop.type !== gw.type) continue;
            var px = (typeof pop.x0==='number' && typeof pop.x1==='number') ? ((pop.x0+pop.x1)/2) : (pop.x0||0);
            var pz = (typeof pop.z0==='number' && typeof pop.z1==='number') ? ((pop.z0+pop.z1)/2) : (pop.z0||0);
            var dx = px - gx, dz = pz - gz;
            if ((dx*dx + dz*dz) <= 0.25*0.25) { // within 25cm
              reused = prevOpenings.splice(pi,1)[0]; break;
            }
          }
          if (reused){
            // update coordinates on the reused object so renderer uses new position
            try { reused.x0 = gw.x0; reused.z0 = gw.z0; reused.x1 = gw.x1; reused.z1 = gw.z1; reused.edge = gw.edge || reused.edge; reused.sillM = ('sillM' in gw) ? gw.sillM : reused.sillM; reused.heightM = ('heightM' in gw) ? gw.heightM : reused.heightM; reused.meta = ('meta' in gw) ? gw.meta : reused.meta; } catch(_u){}
            if (typeof console !== 'undefined' && console.log) {
              console.log('♻️ REUSED opening:', reused.type, 'updated coords x0:', reused.x0.toFixed(2), 'z0:', reused.z0.toFixed(2), 'x1:', reused.x1.toFixed(2), 'z1:', reused.z1.toFixed(2));
            }
            newOpeningsArr.push(reused);
          } else {
            // No reusable opening found - use the newly generated opening object
            if (typeof console !== 'undefined' && console.log) {
              console.log('🆕 NEW opening:', gw.type, 'coords x0:', gw.x0.toFixed(2), 'z0:', gw.z0.toFixed(2), 'x1:', gw.x1.toFixed(2), 'z1:', gw.z1.toFixed(2));
            }
            newOpeningsArr.push(gw);
          }
        }
      } catch(_rg) { /* ignore reuse errors */ }
      grp.openings = newOpeningsArr;
      allRooms.push(grp);
    }
  }
  // We'll build interior strips and merge with existing ones for this level below
    // 2D y corresponds to world z; 2D x corresponds to world x; plan is centered at (0,0)
    // First, create polygonal rooms (single composite) from polyRooms
    for (var pr=0; pr<polyRooms.length; pr++){
      var PR = polyRooms[pr]; if(!PR || !Array.isArray(PR.poly) || PR.poly.length<3) continue;
  var sgnp = (__ctx.ySign||1);
      // Map plan polygon to world footprint
      var worldPts = [];
      var minWX=Infinity, maxWX=-Infinity, minWZ=Infinity, maxWZ=-Infinity;
      for (var pi=0; pi<PR.poly.length; pi++){
  var pp = PR.poly[pi]; var wx = (__ctx.centerX||0) + pp.x; var wz = (__ctx.centerZ||0) + sgnp*pp.y;
        worldPts.push({ x: wx, z: wz });
        if (wx<minWX) minWX=wx; if (wx>maxWX) maxWX=wx; if (wz<minWZ) minWZ=wz; if (wz>maxWZ) maxWZ=wz;
      }
      var cxW = (minWX+maxWX)/2, czW = (minWZ+maxWZ)/2;
      var roomPoly = createRoom(cxW, czW, targetLevel);
      roomPoly.width = Math.max(0.5, quantizeMeters(maxWX - minWX, 2));
      roomPoly.depth = Math.max(0.5, quantizeMeters(maxWZ - minWZ, 2));
      roomPoly.height = 3;
      roomPoly.name = 'Room';
      roomPoly.groupId = PR.groupId;
      roomPoly.footprint = worldPts; // world-space polygon footprint
  // Map openings from host walls in this component to world endpoints
  var openingsW = [];
  // Merge overlapping windows per host wall AND per window profile (sill/height) to avoid mixing types
  function mergeIntervals(arr){ if(!arr||!arr.length) return []; arr.sort(function(A,B){ return A[0]-B[0]; }); var out=[]; for(var i=0;i<arr.length;i++){ var a=arr[i]; if(!out.length) out.push([a[0],a[1]]); else { var last=out[out.length-1]; if(a[0] <= last[1] + 1e-6){ last[1] = Math.max(last[1], a[1]); } else { out.push([a[0],a[1]]); } } } return out; }
      try {
        // Collect per-host windows and doors; also collect free openings along polygon edges
        var winByHost = Object.create(null); // host -> profileKey -> [[t0,t1],...]
        var doorsList = [];
        var freeWinByEdge = []; // edgeIdx -> profileKey -> [[s0,s1],...]
        var freeDoors = [];     // {edgeIdx,s0,s1,heightM,meta}
        var polyPts = Array.isArray(PR.poly) ? PR.poly : [];
        function projSeg(px,py,ax,ay,bx,by){ var dx=bx-ax, dy=by-ay; var den=dx*dx+dy*dy||1; var t=((px-ax)*dx+(py-ay)*dy)/den; var s=Math.max(0,Math.min(1,t)); var cx=ax+dx*s, cy=ay+dy*s; return { s:s, d: Math.hypot(px-cx, py-cy) }; }
        for (var ei=0; ei<elemsSrc.length; ei++){
          var el = elemsSrc[ei]; if(!el || (el.type!=='window' && el.type!=='door')) continue;
          if (typeof el.host === 'number'){
            if (!PR.wallIdxSet[el.host]) continue; // only perimeter walls of this polygon
            if (el.type==='window'){
              var ht = el.host; var t0w=Math.max(0,Math.min(1,el.t0||0)), t1w=Math.max(0,Math.min(1,el.t1||0)); if(t1w<t0w){ var tt=t0w; t0w=t1w; t1w=tt; }
              var sillW = (typeof el.sillM==='number') ? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0);
              var hW = (typeof el.heightM==='number') ? el.heightM : ((__plan2d&&__plan2d.windowHeightM)||1.5);
              var profKey = 's'+(+sillW.toFixed(3))+'_h'+(+hW.toFixed(3));
              if(!winByHost[ht]) winByHost[ht] = Object.create(null);
              (winByHost[ht][profKey]||(winByHost[ht][profKey]=[])).push([t0w,t1w]);
            } else {
              doorsList.push(el);
            }
          } else if (Array.isArray(polyPts) && polyPts.length>=2) {
            var axf = (typeof el.x0==='number'? el.x0 : NaN), ayf = (typeof el.y0==='number'? el.y0 : NaN);
            var bxf = (typeof el.x1==='number'? el.x1 : NaN), byf = (typeof el.y1==='number'? el.y1 : NaN);
            if(!isFinite(axf)||!isFinite(ayf)||!isFinite(bxf)||!isFinite(byf)) continue;
            var edgeFound=-1, s0=0, s1=0; var tol = OPENING_TOL;
            for (var ei2=0; ei2<polyPts.length; ei2++){
              var pa=polyPts[ei2], pb=polyPts[(ei2+1)%polyPts.length]; if(!pa||!pb) continue;
              var h0=projSeg(axf,ayf,pa.x,pa.y,pb.x,pb.y); var h1=projSeg(bxf,byf,pa.x,pa.y,pb.x,pb.y);
              if(h0.d<=tol && h1.d<=tol){ edgeFound=ei2; s0=h0.s; s1=h1.s; break; }
            }
            if(edgeFound>=0){ if(s1<s0){ var tmp=s0; s0=s1; s1=tmp; }
              if(el.type==='window'){
                var sillF=(typeof el.sillM==='number')? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0);
                var hF=(typeof el.heightM==='number')? el.heightM : ((__plan2d&&__plan2d.windowHeightM)||1.5);
                var pkF='s'+(+sillF.toFixed(3))+'_h'+(+hF.toFixed(3));
                if(!freeWinByEdge[edgeFound]) freeWinByEdge[edgeFound]=Object.create(null);
                (freeWinByEdge[edgeFound][pkF]||(freeWinByEdge[edgeFound][pkF]=[])).push([s0,s1]);
              } else {
                var dh=(typeof el.heightM==='number')? el.heightM : ((__plan2d&&__plan2d.doorHeightM)||2.04);
                freeDoors.push({ edgeIdx: edgeFound, s0:s0, s1:s1, heightM:dh, meta:(el.meta||null) });
              }
            }
          }
        }
        // Emit merged windows per profile
        Object.keys(winByHost).forEach(function(hk){
          var hostIdx = +hk; var host = elemsSrc[hostIdx]; if(!host || host.type!=='wall') return;
          var profMap = winByHost[hk];
          Object.keys(profMap).forEach(function(pk){
            var spans = mergeIntervals(profMap[pk]);
            // parse profile
            var m = pk.match(/^s([\d\.\-]+)_h([\d\.\-]+)$/); var sill = (__plan2d&&__plan2d.windowSillM)||1.0; var hM = (__plan2d&&__plan2d.windowHeightM)||1.5;
            if(m){ sill = parseFloat(m[1]); hM = parseFloat(m[2]); }
            for (var si=0; si<spans.length; si++){
              var s0=spans[si][0], s1=spans[si][1];
              var ax = host.x0 + (host.x1-host.x0)*s0; var ay = host.y0 + (host.y1-host.y0)*s0;
              var bx = host.x0 + (host.x1-host.x0)*s1; var by = host.y0 + (host.y1-host.y0)*s1;
              var wx0 = (__ctx.centerX||0) + ax; var wz0 = (__ctx.centerZ||0) + sgnp*ay;
              var wx1 = (__ctx.centerX||0) + bx; var wz1 = (__ctx.centerZ||0) + sgnp*by;
              openingsW.push({ type:'window', x0: wx0, z0: wz0, x1: wx1, z1: wz1, sillM: sill, heightM: hM, meta: null });
            }
          });
        });
        // Emit doors unchanged (host anchored)
        for (var di=0; di<doorsList.length; di++){
          var de = doorsList[di]; var hostD = elemsSrc[de.host]; if(!hostD||hostD.type!=='wall') continue;
          var t0d=Math.max(0,Math.min(1,de.t0||0)), t1d=Math.max(0,Math.min(1,de.t1||0));
          var axd = hostD.x0 + (hostD.x1-hostD.x0)*t0d; var ayd = hostD.y0 + (hostD.y1-hostD.y0)*t0d;
          var bxd = hostD.x0 + (hostD.x1-hostD.x0)*t1d; var byd = hostD.y0 + (hostD.y1-hostD.y0)*t1d;
          var dwx0 = (__plan2d.centerX||0) + axd; var dwz0 = (__plan2d.centerZ||0) + sgnp*ayd;
          var dwx1 = (__plan2d.centerX||0) + bxd; var dwz1 = (__plan2d.centerZ||0) + sgnp*byd;
          var dhM = (typeof de.heightM==='number') ? de.heightM : ((__plan2d&&__plan2d.doorHeightM)||2.04);
          openingsW.push({ type:'door', x0: dwx0, z0: dwz0, x1: dwx1, z1: dwz1, sillM: 0, heightM: dhM, meta: (de.meta||null) });
        }
        // Emit merged free windows per polygon edge and any free doors
        if (Array.isArray(polyPts) && polyPts.length>=2){
          for (var egi=0; egi<polyPts.length; egi++){
            var profMapF = freeWinByEdge[egi]; if(!profMapF) continue;
            var pa2=polyPts[egi], pb2=polyPts[(egi+1)%polyPts.length];
            Object.keys(profMapF).forEach(function(pk){
              var spans = mergeIntervals(profMapF[pk]);
              var m = pk.match(/^s([\d\.\-]+)_h([\d\.\-]+)$/); var sill = (__plan2d&&__plan2d.windowSillM)||1.0; var hM = (__plan2d&&__plan2d.windowHeightM)||1.5;
              if(m){ sill = parseFloat(m[1]); hM = parseFloat(m[2]); }
              for (var si=0; si<spans.length; si++){
                var u0=spans[si][0], u1=spans[si][1];
                var ax = pa2.x + (pb2.x - pa2.x)*u0; var ay = pa2.y + (pb2.y - pa2.y)*u0;
                var bx = pa2.x + (pb2.x - pa2.x)*u1; var by = pa2.y + (pb2.y - pa2.y)*u1;
                var wx0 = (__plan2d.centerX||0) + ax; var wz0 = (__plan2d.centerZ||0) + sgnp*ay;
                var wx1 = (__plan2d.centerX||0) + bx; var wz1 = (__plan2d.centerZ||0) + sgnp*by;
                openingsW.push({ type:'window', x0: wx0, z0: wz0, x1: wx1, z1: wz1, sillM: sill, heightM: hM, meta: null });
              }
            });
          }
          for (var fd=0; fd<freeDoors.length; fd++){
            var fdRec = freeDoors[fd]; var pa3=polyPts[fdRec.edgeIdx], pb3=polyPts[(fdRec.edgeIdx+1)%polyPts.length];
            var axd2 = pa3.x + (pb3.x - pa3.x)*fdRec.s0; var ayd2 = pa3.y + (pb3.y - pa3.y)*fdRec.s0;
            var bxd2 = pa3.x + (pb3.x - pa3.x)*fdRec.s1; var byd2 = pa3.y + (pb3.y - pa3.y)*fdRec.s1;
            var dwx0b = (__plan2d.centerX||0) + axd2; var dwz0b = (__plan2d.centerZ||0) + sgnp*ayd2;
            var dwx1b = (__plan2d.centerX||0) + bxd2; var dwz1b = (__plan2d.centerZ||0) + sgnp*byd2;
            openingsW.push({ type:'door', x0: dwx0b, z0: dwz0b, x1: dwx1b, z1: dwz1b, sillM: 0, heightM: fdRec.heightM, meta: fdRec.meta||null });
          }
        }
      } catch(_eOpen) {}
      roomPoly.openings = openingsW;
      
      // DEBUG: Log polygon room openings
      if (typeof console !== 'undefined' && console.log) {
        console.log('[DEBUG applyPlan2DTo3D] Poly room created with ' + openingsW.length + ' openings:', roomPoly);
      }
      
      allRooms.push(roomPoly);
    }

    // Then, create standard rectangular rooms
    // If a polygon room already represents an axis-aligned rectangle with the same bbox,
    // skip creating a duplicate rectangular room here.
    var rectLikePolyBoxes = [];
    try {
      for (var prb = 0; prb < polyRooms.length; prb++){
        var PRb = polyRooms[prb]; if(!PRb || !Array.isArray(PRb.poly) || PRb.poly.length < 4) continue;
        // check if orthogonal rectangle (4 unique corners and axis-aligned)
        var ptsB = PRb.poly;
        var minXB=Infinity,maxXB=-Infinity,minYB=Infinity,maxYB=-Infinity; var ortho=true;
        for (var piB=0; piB<ptsB.length; piB++){ var pB=ptsB[piB]; if (pB.x<minXB) minXB=pB.x; if (pB.x>maxXB) maxXB=pB.x; if (pB.y<minYB) minYB=pB.y; if (pB.y>maxYB) maxYB=pB.y; }
        // verify all points lie on one of the four rectangle lines
        for (var piB2=0; piB2<ptsB.length; piB2++){ var q=ptsB[piB2]; var onEdge = (Math.abs(q.x-minXB)<=1e-6 || Math.abs(q.x-maxXB)<=1e-6 || Math.abs(q.y-minYB)<=1e-6 || Math.abs(q.y-maxYB)<=1e-6); if(!onEdge){ ortho=false; break; } }
        if (!ortho) continue;
        rectLikePolyBoxes.push({ minX:minXB, maxX:maxXB, minY:minYB, maxY:maxYB });
      }
    } catch(_eBox){ rectLikePolyBoxes = []; }
    for(var r=0;r<roomsFound.length;r++){
      var R=roomsFound[r];
      // Skip rectangles that match an existing rect-like polygon box (avoid duplicates)
      var dupRect = false;
      for (var rb=0; rb<rectLikePolyBoxes.length; rb++){
        var B = rectLikePolyBoxes[rb];
        if (approxEq(B.minX, R.minX) && approxEq(B.maxX, R.maxX) && approxEq(B.minY, R.minY) && approxEq(B.maxY, R.maxY)) { dupRect = true; break; }
      }
      if (dupRect) continue;
      var s = (__plan2d.yFromWorldZSign||1);
  var wx=(__plan2d.centerX||0) + (R.minX+R.maxX)/2, wz=(__plan2d.centerZ||0) + s*((R.minY+R.maxY)/2); // map plan coords back to world using stored center
  var w=R.maxX-R.minX, d=R.maxY-R.minY;
    var room=createRoom(wx, wz, targetLevel);
  room.width=Math.max(0.5, quantizeMeters(w, 2));
  room.depth=Math.max(0.5, quantizeMeters(d, 2));
      room.height=3;
      room.name='Room';
      // Preserve grouping metadata (logical footprint union) if available
      if (R.groupId) room.groupId = R.groupId;
      // Collect openings (windows/doors) along rectangle sides using geometry (no strict host mapping)
      try {
        var openings = [];
        function mergeIntervals2(arr){ if(!arr||!arr.length) return []; arr.sort(function(A,B){ return A[0]-B[0]; }); var out=[]; for(var i=0;i<arr.length;i++){ var a=arr[i]; if(!out.length) out.push([a[0],a[1]]); else { var last=out[out.length-1]; if(a[0] <= last[1] + 1e-6){ last[1] = Math.max(last[1], a[1]); } else { out.push([a[0],a[1]]); } } } return out; }
        var winByEdge = { minZ:Object.create(null), maxZ:Object.create(null), minX:Object.create(null), maxX:Object.create(null) }; // edge -> profileKey -> [[s,e],...]
        var widthM = (R.maxX - R.minX), depthM = (R.maxY - R.minY);
        for(var ei=0; ei<elemsSrc.length; ei++){
          var el = elemsSrc[ei]; if(!el || (el.type!=='window' && el.type!=='door')) continue;
          var ax,ay,bx,by;
          if(typeof el.host==='number'){
            var host = elemsSrc[el.host]; if(!host || host.type!=='wall') continue;
            var t0=Math.max(0,Math.min(1,el.t0||0)), t1=Math.max(0,Math.min(1,el.t1||0));
            ax = host.x0 + (host.x1-host.x0)*t0;
            ay = host.y0 + (host.y1-host.y0)*t0;
            bx = host.x0 + (host.x1-host.x0)*t1;
            by = host.y0 + (host.y1-host.y0)*t1;
          } else {
            ax = el.x0; ay = el.y0; bx = el.x1; by = el.y1;
          }
          // Classify against each side with tolerance
          var added=false;
          // Top side (world minZ). In plan, it's y=R.minY when s=1, else y=R.maxY when s=-1.
          var topY = (s===1 ? R.minY : R.maxY);
          var botY = (s===1 ? R.maxY : R.minY);
          
          // DEBUG: Log opening classification attempt
          if (typeof console !== 'undefined' && console.log && el.type === 'window') {
            console.log('[DEBUG] Classifying window at (' + ax + ',' + ay + ') to (' + bx + ',' + by + ')');
            console.log('[DEBUG] Room bounds: minX=' + R.minX + ', maxX=' + R.maxX + ', minY=' + R.minY + ', maxY=' + R.maxY);
            console.log('[DEBUG] topY=' + topY + ', botY=' + botY + ', OPENING_TOL=' + OPENING_TOL);
            console.log('[DEBUG] Distance from topY: ' + Math.abs(ay - topY) + ', from botY: ' + Math.abs(ay - botY));
          }
          
          // Horizontal spans along X
          if(Math.abs(ay - topY) <= OPENING_TOL && Math.abs(by - topY) <= OPENING_TOL){
            var sx = Math.max(R.minX, Math.min(R.maxX, Math.min(ax,bx)));
            var ex = Math.max(R.minX, Math.min(R.maxX, Math.max(ax,bx)));
            var q0 = quantizeMeters(sx - R.minX, 2);
            var q1 = quantizeMeters(ex - R.minX, 2);
            if(q1 > q0 + 1e-4){
              var span = q1 - q0;
              if (el.type==='door') {
                var hM=(typeof el.heightM==='number'?el.heightM: (__plan2d&&__plan2d.doorHeightM||2.04));
                openings.push({type:'door', edge:'minZ', startM:q0, endM:q1, widthM: span, heightM:hM, sillM:0, meta:(el.meta||null)});
              } else { // window
                var sillW = (typeof el.sillM==='number') ? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0);
                var hW = (typeof el.heightM==='number') ? el.heightM : ((__plan2d&&__plan2d.windowHeightM)||1.5);
                var pk = 's'+(+sillW.toFixed(3))+'_h'+(+hW.toFixed(3));
                (winByEdge.minZ[pk]||(winByEdge.minZ[pk]=[])).push([q0,q1]);
              }
              added=true;
            }
          }
          // Bottom side (world maxZ) => plan y=botY
          if(!added && Math.abs(ay - botY) <= OPENING_TOL && Math.abs(by - botY) <= OPENING_TOL){
            var s2 = Math.max(R.minX, Math.min(R.maxX, Math.min(ax,bx)));
            var e2 = Math.max(R.minX, Math.min(R.maxX, Math.max(ax,bx)));
            var q02 = quantizeMeters(s2 - R.minX, 2);
            var q12 = quantizeMeters(e2 - R.minX, 2);
            if(q12 > q02 + 1e-4){
              var span2 = q12 - q02;
              if (el.type==='door'){
                var hM2=(typeof el.heightM==='number'?el.heightM: (__plan2d&&__plan2d.doorHeightM||2.04));
                openings.push({type:'door', edge:'maxZ', startM:q02, endM:q12, widthM: span2, heightM:hM2, sillM:0, meta:(el.meta||null)});
              } else {
                var sillW2 = (typeof el.sillM==='number') ? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0);
                var hW2 = (typeof el.heightM==='number') ? el.heightM : ((__plan2d&&__plan2d.windowHeightM)||1.5);
                var pk2 = 's'+(+sillW2.toFixed(3))+'_h'+(+hW2.toFixed(3));
                (winByEdge.maxZ[pk2]||(winByEdge.maxZ[pk2]=[])).push([q02,q12]);
              }
              added=true;
            }
          }
          // Left side (minX at x=R.minX), vertical span along Y
          if(!added && Math.abs(ax - R.minX) <= OPENING_TOL && Math.abs(bx - R.minX) <= OPENING_TOL){
            var sv = Math.max(R.minY, Math.min(R.maxY, Math.min(ay,by)));
            var ev = Math.max(R.minY, Math.min(R.maxY, Math.max(ay,by)));
            var q03 = quantizeMeters(sv - R.minY, 2);
            var q13 = quantizeMeters(ev - R.minY, 2);
            if(q13 > q03 + 1e-4){
              var span3 = q13 - q03;
              if (el.type==='door'){
                var hM3=(typeof el.heightM==='number'?el.heightM: (__plan2d&&__plan2d.doorHeightM||2.04));
                openings.push({type:'door', edge:'minX', startM:q03, endM:q13, widthM: span3, heightM:hM3, sillM:0, meta:(el.meta||null)});
              } else {
                var sillW3 = (typeof el.sillM==='number') ? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0);
                var hW3 = (typeof el.heightM==='number') ? el.heightM : ((__plan2d&&__plan2d.windowHeightM)||1.5);
                var pk3 = 's'+(+sillW3.toFixed(3))+'_h'+(+hW3.toFixed(3));
                (winByEdge.minX[pk3]||(winByEdge.minX[pk3]=[])).push([q03,q13]);
              }
              added=true;
            }
          }
          // Right side (maxX at x=R.maxX)
          if(!added && Math.abs(ax - R.maxX) <= OPENING_TOL && Math.abs(bx - R.maxX) <= OPENING_TOL){
            var sv2 = Math.max(R.minY, Math.min(R.maxY, Math.min(ay,by)));
            var ev2 = Math.max(R.minY, Math.min(R.maxY, Math.max(ay,by)));
            var q04 = quantizeMeters(sv2 - R.minY, 2);
            var q14 = quantizeMeters(ev2 - R.minY, 2);
            if(q14 > q04 + 1e-4){
              var span4 = q14 - q04;
              if (el.type==='door'){
                var hM4=(typeof el.heightM==='number'?el.heightM: (__plan2d&&__plan2d.doorHeightM||2.04));
                openings.push({type:'door', edge:'maxX', startM:q04, endM:q14, widthM: span4, heightM:hM4, sillM:0, meta:(el.meta||null)});
              } else {
                var sillW4 = (typeof el.sillM==='number') ? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0);
                var hW4 = (typeof el.heightM==='number') ? el.heightM : ((__plan2d&&__plan2d.windowHeightM)||1.5);
                var pk4 = 's'+(+sillW4.toFixed(3))+'_h'+(+hW4.toFixed(3));
                (winByEdge.maxX[pk4]||(winByEdge.maxX[pk4]=[])).push([q04,q14]);
              }
              added=true;
            }
          }
        }
        // After collecting, merge window spans per edge and per profile, then emit final window openings
        ['minZ','maxZ','minX','maxX'].forEach(function(edge){
          var profMap = winByEdge[edge]; if(!profMap) return;
          Object.keys(profMap).forEach(function(pk){
            var merged = mergeIntervals2(profMap[pk]);
            var m = pk.match(/^s([\d\.\-]+)_h([\d\.\-]+)$/); var wsill = (__plan2d&&__plan2d.windowSillM)||1.0; var wh = (__plan2d&&__plan2d.windowHeightM)||1.5;
            if(m){ wsill = parseFloat(m[1]); wh = parseFloat(m[2]); }
            for (var iM=0; iM<merged.length; iM++){
              var sM=merged[iM][0], eM=merged[iM][1];
              openings.push({ type:'window', edge: edge, startM: sM, endM: eM, widthM: (eM-sM), heightM: wh, sillM: wsill, meta: null });
            }
          });
        });
        room.openings = openings;
      } catch(e){ 
        console.error('[ERROR] Failed to add openings to room:', e);
        room.openings = []; 
      }
      allRooms.push(room);
    }

  // Deduplicate rooms by id (first), then by geometry on each level as safety
  try {
    var seenIds = new Set();
    allRooms = allRooms.filter(function(r){ if(!r||!r.id) return false; if(seenIds.has(r.id)) return false; seenIds.add(r.id); return true; });
    // Geometry-based dedupe: same level, center, width, and depth within small epsilon
    var EPS = 1e-4; var kept = []; var used = [];
    for (var i=0;i<allRooms.length;i++){
      var a = allRooms[i]; if(!a) continue; var dup=false;
      for (var j=0;j<kept.length;j++){
        var b = kept[j];
        if ((a.level||0)===(b.level||0)
            && Math.abs((a.x||0)-(b.x||0))<EPS
            && Math.abs((a.z||0)-(b.z||0))<EPS
            && Math.abs((a.width||0)-(b.width||0))<EPS
            && Math.abs((a.depth||0)-(b.depth||0))<EPS) { dup=true; break; }
      }
      if(!dup){ kept.push(a); }
    }
    allRooms = kept;
    // Also run global dedupe for components
    dedupeAllEntities();
  } catch(e) { /* non-fatal dedupe */ }

  // Additionally, extrude interior 2D walls (non-perimeter) into 3D wall strips for this level
  try {
    var sgn2 = (__plan2d.yFromWorldZSign||1);
    var strips2 = [];
    var __attachedOpenings2 = Object.create(null);
    for (var wi2=0; wi2<elemsSrc.length; wi2++){
      var ew = elemsSrc[wi2]; if(!ew || ew.type!=='wall') continue;
      // Skip only explicit non-room component outlines; extrude all user walls (both perimeter and interior)
      if (ew.wallRole === 'nonroom') continue;
      var subs2 = plan2dBuildWallSubsegments(elemsSrc, wi2) || [];
      for (var sj2=0; sj2<subs2.length; sj2++){
        var sg2 = subs2[sj2];
        var rec2 = {
          x0: (__plan2d.centerX||0) + sg2.ax,
          z0: (__plan2d.centerZ||0) + sgn2*sg2.ay,
          x1: (__plan2d.centerX||0) + sg2.bx,
          z1: (__plan2d.centerZ||0) + sgn2*sg2.by,
          thickness: (ew.thickness||__plan2d.wallThicknessM||0.3),
          height: (__plan2d.wallHeightM||3.0),
          baseY: (targetLevel||0) * 3.5,
          level: (targetLevel||0)
        };
        if (!__attachedOpenings2[wi2]) {
          // Reuse openingsForWall from above scope
          try { rec2.openings = (function(){
            var outs=[];
            for (var ei=0; ei<elemsSrc.length; ei++){
              var el = elemsSrc[ei]; if(!el || (el.type!=='window' && el.type!=='door')) continue;
              if (typeof el.host !== 'number' || el.host !== wi2) continue;
              var host = elemsSrc[wi2]; if(!host || host.type!=='wall') continue;
              var t0=Math.max(0,Math.min(1,el.t0||0)), t1=Math.max(0,Math.min(1,el.t1||0)); if(t1<t0){ var tt=t0; t0=t1; t1=tt; }
              var ax = host.x0 + (host.x1-host.x0)*t0; var ay = host.y0 + (host.y1-host.y0)*t0;
              var bx = host.x0 + (host.x1-host.x0)*t1; var by = host.y0 + (host.y1-host.y0)*t1;
              var wx0 = (__plan2d.centerX||0) + ax; var wz0 = (__plan2d.centerZ||0) + sgn2*ay;
              var wx1 = (__plan2d.centerX||0) + bx; var wz1 = (__plan2d.centerZ||0) + sgn2*by;
              var sill = (el.type==='window') ? ((typeof el.sillM==='number') ? el.sillM : ((__plan2d&&__plan2d.windowSillM)||1.0)) : 0;
              var hM = (typeof el.heightM==='number') ? el.heightM : ((el.type==='door') ? ((__plan2d&&__plan2d.doorHeightM)||2.04) : ((__plan2d&&__plan2d.windowHeightM)||1.5));
              outs.push({ type: el.type, x0: wx0, z0: wz0, x1: wx1, z1: wz1, sillM: sill, heightM: hM, meta: (el.meta||null) });
            }
            return outs;
          })(); } catch(_eOpenStrip) {}
          __attachedOpenings2[wi2] = true;
        }
        strips2.push(rec2);
      }
    }
  // Append interior strips for this level, merged with existing same-level strips, and dedupe
  var keepOther2 = wallStrips.filter(function(ws){ return (ws.level||0)!==targetLevel; });
  var existingLvl2 = wallStrips.filter(function(ws){ return (ws.level||0)===targetLevel; });
  var merged2 = _dedupeStripsByGeom(existingLvl2.concat(strips2));
  wallStrips = keepOther2.concat(merged2);
  selectedWallStripIndex = -1;
  } catch(e){ /* interior strips non-fatal */ }

  // Compute a quick openings count for this level for diagnostics/UX
  var openingsCountLevel = 0;
  try {
    for (var oiA=0; oiA<allRooms.length; oiA++){
      var rrA = allRooms[oiA]; if(!rrA || (rrA.level||0)!==targetLevel) continue;
      if (Array.isArray(rrA.openings)) openingsCountLevel += rrA.openings.length;
    }
  } catch(_eCount) { openingsCountLevel = 0; }
  saveProjectSilently(); if(!Array.isArray(elemsSnapshot)) { selectedRoomId=null; } renderLoop(); if(!quiet && !Array.isArray(elemsSnapshot)) updateStatus((roomsFound.length||polyRooms.length)? ('Applied 2D plan to 3D (rooms + openings: '+ openingsCountLevel +')') : 'No closed rooms found (auto-snap enabled)');
  try { __emitApplySummary({ action: 'rooms-applied', roomsRect: roomsFound.length||0, roomsPoly: polyRooms.length||0, strips: (Array.isArray(merged2)? merged2.length : 0), openings: openingsCountLevel }); } catch(_f) {}
  } catch(e){ console.error('applyPlan2DTo3D failed', e); updateStatus('Apply to 3D failed'); }
}
