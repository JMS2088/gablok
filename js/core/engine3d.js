/**
 * @file engine3d.js
 * @description Core 3D rendering engine with orbit camera, projection, and scene management.
 * 
 * **Responsibilities:**
 * - Canvas initialization and render loop coordination
 * - Orbit camera with mouse/touch pan, zoom, rotation
 * - 3D→2D projection (simple orthographic-like projection)
 * - Grid rendering (10m × 10m with 0.5m minor lines)
 * - Base scene state (camera, rooms, wall strips, components)
 * - Startup orchestration (apply 2D drafts, create default room, begin render loop)
 * - Wall strip rendering (including window/door opening overlays)
 * - Global helper functions (quantizeMeters, formatMeters, updateStatus, etc.)
 * 
 * **Global Exports:**
 * - `camera` - {yaw, pitch, distance, targetX/Y/Z, fov, aspect}
 * - `allRooms` - Array of room objects
 * - `wallStrips` - Array of interior wall strip objects
 * - `stairsComponent`, `pergolaComponents`, `garageComponents`, etc.
 * - `selectedRoomId`, `selectedWallStripIndex`, `currentFloor`
 * - `renderLoop()` - Main render loop (requestAnimationFrame)
 * - `startApp()` - Bootstrap entry point called after DOM ready
 * - `project3D(x, y, z)` - Convert 3D world coords to 2D canvas coords
 * - `quantizeMeters(value, precision)` - Round to 0.5m increments
 * - `formatMeters(value)` - Format as "X.Xm"
 * - `updateStatus(message)` - Update status bar text
 * 
 * **Dependencies:**
 * - None (standalone, loaded first by bootstrap)
 * - Expects `applyPlan2DTo3D()` to be defined by plan-apply.js for startup auto-apply
 * 
 * **Design Patterns:**
 * - IIFE to avoid polluting global scope while selectively exporting key symbols
 * - Idempotent initialization (checks `window.camera` before defining)
 * - Defensive coding with try-catch on all major paths
 * 
 * @version 2.0 (Post-Phase-1-Refactoring)
 * @since 2024
 */

// Core 3D engine bootstrap: orbit camera, projection, grid, base room/state.
// Idempotent: defines globals only if missing, so app.js can extend safely.
(function(){
  if (typeof window === 'undefined') return;

  // Lightweight diagnostics to understand why nothing is visible
  if (typeof window.__dbgGfx === 'undefined') window.__dbgGfx = { clearCalls: 0, gridCalls: 0, frames: 0, lastReport: 0 };

  // Debug overlay toggle via ?debug=1 or localStorage('gablok_debug'='1')
  function __isDebug() {
    try {
      if (window.__debug && window.__debug.enabled) return true;
      var p = new URLSearchParams(window.location.search);
      if (p.get('debug') === '1' || p.get('debug') === 'true') return true;
      if (localStorage.getItem('gablok_debug') === '1' || localStorage.getItem('gablok_debug') === 'true') return true;
    } catch(e) {}
    return false;
  }
  function __ensureDebugOverlay(){
    if (!__isDebug()) return null;
    if (!window.__debug) window.__debug = { enabled: true };
    var el = document.getElementById('debug-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'debug-overlay';
      el.style.position = 'fixed';
      el.style.top = '8px';
      el.style.left = '8px';
      el.style.zIndex = '99999';
      el.style.background = 'rgba(0,0,0,0.75)';
      el.style.color = '#fff';
      el.style.font = '12px/1.35 monospace';
      el.style.padding = '8px 10px';
      el.style.borderRadius = '8px';
      el.style.pointerEvents = 'none';
      document.body.appendChild(el);
      window.__debugStickyStatus = true;
    }
    return el;
  }
  function __updateDebugOverlay(){
    try {
      var el = __ensureDebugOverlay();
      if (!el) return;
      var g = window.__dbgGfx || { frames:0, clearCalls:0, gridCalls:0 };
      var cam = window.camera || { yaw:0, pitch:0, distance:0 };
      var msg = 'frames='+g.frames+' clear='+g.clearCalls+' grid='+g.gridCalls+' | cam[yaw='+cam.yaw.toFixed(2)+',pitch='+cam.pitch.toFixed(2)+',dist='+cam.distance.toFixed(1)+']';
      el.textContent = msg;
    } catch(e) { /* ignore */ }
  }
  try { setInterval(__updateDebugOverlay, 500); } catch(e) {}

  // ---- Canvas refs ----
  if (typeof window.canvas === 'undefined') window.canvas = null;
  if (typeof window.ctx === 'undefined') window.ctx = null;

  // ---- Camera & interaction state ----
  if (typeof window.camera === 'undefined') {
    window.camera = {
      yaw: 0.0,
      pitch: -0.5,
      distance: 12,
      minDistance: 4,
      maxDistance: 120,
      minPitch: -1.2,
      maxPitch: 0.2,
      targetX: 0,
      targetZ: 0,
      // Raise camera pivot above ground so the orbit path doesn't dip underground
      targetY: 2.5,
      // Ensure the camera's eye doesn't go below a small height above ground
      minCamY: 0.0
    };
  }
  if (typeof window.pan === 'undefined') window.pan = { x:0, y:0 };
  if (typeof window.mouse === 'undefined') window.mouse = { down:false, dragType:null, dragInfo:null, lastX:0, lastY:0 };

  // ---- Scene data ----
  if (typeof window.allRooms === 'undefined') window.allRooms = [];
  if (typeof window.wallStrips === 'undefined') window.wallStrips = [];
  // Wall render mode: default to 'line' so initial view shows lightweight outlines.
  // Users can toggle to 'solid' via the toolbar if they want filled wall solids.
  if (typeof window.__wallRenderMode === 'undefined') window.__wallRenderMode = 'line';
  if (typeof window.__roomWallThickness === 'undefined') window.__roomWallThickness = 0.0;
  if (typeof window.__roomStripTag === 'undefined') window.__roomStripTag = '__fromRooms';
  // Corner code overlay (for diagnosing problem corners)
  if (typeof window.__showCornerCodes === 'undefined') window.__showCornerCodes = false;
  if (typeof window.__cornerCodeMap === 'undefined') window.__cornerCodeMap = {};
  // Shared exterior-corner snap map: ensures adjacent strips use the exact same
  // world coordinate at convex exterior corners, eliminating tiny gaps.
  if (typeof window.__extCornerSnap === 'undefined') window.__extCornerSnap = {};
  // Track the set of perimeter edge keys used by the last rebuild so we can
  // remove any previously generated perimeter strips even if they don't match
  // the current footprint (prevents "ghost" solids at old positions during drags).
  if (typeof window.__lastPerimeterEdges === 'undefined') window.__lastPerimeterEdges = null;
  if (typeof window.__activelyDraggedRoomId === 'undefined') window.__activelyDraggedRoomId = null;

  // Utility: deduplicate wallStrips by unordered endpoints and level. Prefer
  // the most recently added perimeter-derived strip (tagged) over older ones.
  if (typeof window.dedupeWallStrips === 'undefined') window.dedupeWallStrips = function(){
    try {
      var arr = window.wallStrips; if (!Array.isArray(arr) || arr.length < 2) return;
      function kf(v){ return Math.round((+v||0)*1000)/1000; }
      function key(s){ var a=kf(s.x0)+","+kf(s.z0), b=kf(s.x1)+","+kf(s.z1); var u=(a<b)?(a+"|"+b):(b+"|"+a); return (s.level||0)+"#"+u; }
      var tag = window.__roomStripTag || '__fromRooms';
      // Choose best per key scanning from right (newest first); prefer tagged
      var best = Object.create(null);
      for (var i=arr.length-1; i>=0; i--){
        var s = arr[i]; if(!s) continue; var k = key(s);
        if (!best[k]) { best[k] = s; }
        else {
          var curBest = best[k];
          if (!!s[tag] && !curBest[tag]) { best[k] = s; }
        }
      }
      // Rebuild array keeping only selected winners in original order
      var out = [];
      var kept = Object.create(null);
      for (var j=0; j<arr.length; j++){
        var sj = arr[j]; if(!sj) continue; var kj = key(sj);
        if (best[kj] === sj && !kept[kj]) { out.push(sj); kept[kj] = true; }
      }
      window.wallStrips = out;
    } catch(_eDed) { /* non-fatal */ }
  };

  // Remove previously generated perimeter strips (created from rooms)
  // Enhanced: also remove ANY strips that coincide with current room/garage perimeter edges,
  // even if they are not tagged. This ensures the Render button (Lines) reliably clears solids
  // for rectangles and polygons across both floors, preventing stale untagged duplicates.
  if (typeof window.removeRoomPerimeterStrips === 'undefined') window.removeRoomPerimeterStrips = function(){
    try {
      var tag = window.__roomStripTag || '__fromRooms';
      if (!Array.isArray(window.wallStrips)) return;
      // Build edge-key set for all current room perimeters and garage (sans door edge), per level
      function kf(v){ return Math.round((+v||0)*1000)/1000; }
      function edgeKeyWithLevel(level,x0,z0,x1,z1){
        var a = kf(x0)+","+kf(z0), b = kf(x1)+","+kf(z1);
        var u = (a<b)? (a+"|"+b) : (b+"|"+a);
        return (level||0)+"#"+u;
      }
      var perimeterKeys = Object.create(null);
      try {
        // Rooms (rect and polygon)
        var rooms = Array.isArray(window.allRooms) ? window.allRooms : [];
        for (var i=0;i<rooms.length;i++){
          var r = rooms[i]; if(!r) continue; var lev=(r.level||0);
          if (Array.isArray(r.footprint) && r.footprint.length>=2){
            var pts=r.footprint;
            for (var k=0;k<pts.length;k++){
              var A=pts[k], B=pts[(k+1)%pts.length]; if(!A||!B) continue;
              perimeterKeys[ edgeKeyWithLevel(lev, A.x,A.z, B.x,B.z) ] = true;
            }
          } else {
            var hw=(r.width||0)/2, hd=(r.depth||0)/2; if(hw>0 && hd>0){
              var xL=(r.x||0)-hw, xR=(r.x||0)+hw, zT=(r.z||0)-hd, zB=(r.z||0)+hd;
              var edges = [ [xL,zT,xR,zT], [xR,zT,xR,zB], [xR,zB,xL,zB], [xL,zB,xL,zT] ];
              for (var e=0;e<edges.length;e++){
                var E=edges[e]; perimeterKeys[ edgeKeyWithLevel(lev, E[0],E[1],E[2],E[3]) ] = true;
              }
            }
          }
        }
        // Garages (exclude front/door edge)
        var garages = Array.isArray(window.garageComponents)? window.garageComponents: [];
        for (var g=0; g<garages.length; g++){
          var gar = garages[g]; if(!gar) continue; var levG=(gar.level||0);
          var hwg=(gar.width||0)/2, hdg=(gar.depth||0)/2, rot=((gar.rotation||0)*Math.PI)/180;
          function RG(px,pz){ var dx=px-(gar.x||0), dz=pz-(gar.z||0); return { x:(gar.x||0)+dx*Math.cos(rot)-dz*Math.sin(rot), z:(gar.z||0)+dx*Math.sin(rot)+dz*Math.cos(rot) }; }
          var p1=RG((gar.x||0)-hwg,(gar.z||0)-hdg), p2=RG((gar.x||0)+hwg,(gar.z||0)-hdg), p3=RG((gar.x||0)+hwg,(gar.z||0)+hdg), p4=RG((gar.x||0)-hwg,(gar.z||0)+hdg);
          var edgesG=[ [p1,p2], [p2,p3], [p3,p4], [p4,p1] ];
          // Exclude longest edge as door/front; keep others
          var maxLen=-1, longestIdx=-1;
          for (var gi=0; gi<edgesG.length; gi++){ var A0=edgesG[gi][0], B0=edgesG[gi][1]; var L=Math.hypot(B0.x-A0.x, B0.z-A0.z); if(L>maxLen){maxLen=L; longestIdx=gi;} }
          for (var gi2=0; gi2<edgesG.length; gi2++){ if (gi2===longestIdx) continue; var A1=edgesG[gi2][0], B1=edgesG[gi2][1]; perimeterKeys[ edgeKeyWithLevel(levG, A1.x,A1.z, B1.x,B1.z) ] = true; }
        }
      } catch(_eKeys) {}
      // Optionally include previously saved perimeter edges to catch ghosts from old positions
      try {
        var prev = window.__lastPerimeterEdges || null; if (prev){ Object.keys(prev).forEach(function(k){ perimeterKeys[k]=true; }); }
      } catch(_ePrev) {}
      // Filter out: any tagged strip OR any strip whose edge matches a perimeter key
      window.wallStrips = window.wallStrips.filter(function(ws){
        try {
          if (!ws) return false;
          if (ws[tag]) return false;
          var lev=(ws.level||0);
          var k = edgeKeyWithLevel(lev, ws.x0, ws.z0, ws.x1, ws.z1);
          if (perimeterKeys[k]) return false;
          return true;
        } catch(_eF) { return true; }
      });
      // Persist and re-render
      if (typeof window.dedupeWallStrips==='function') window.dedupeWallStrips();
      if (typeof window.saveProjectSilently==='function') window.saveProjectSilently();
      if (typeof window.renderLoop==='function') window.renderLoop();
    } catch(_e) {}
  };

  // Rebuild perimeter wall strips for all rooms with given thickness (m)
  if (typeof window.rebuildRoomPerimeterStrips === 'undefined') window.rebuildRoomPerimeterStrips = function(thickness){
    try {
      var tag = window.__roomStripTag || '__fromRooms';
      var t = Math.max(0.01, +thickness || 0.3);
      if (!Array.isArray(window.allRooms)) return;
      if (!Array.isArray(window.wallStrips)) window.wallStrips = [];
      // Build a set of perimeter edge keys (unordered endpoints, per-level) across all rooms/garages,
      // so we can remove any existing strips (tagged or not) that overlap those edges to prevent duplicates.
      function kf(v){ return Math.round((+v||0)*1000)/1000; } // 1mm
      function edgeKeyWithLevel(level,x0,z0,x1,z1){
        var a = kf(x0)+","+kf(z0), b = kf(x1)+","+kf(z1); var k = (a<b)? (a+"|"+b):(b+"|"+a); return (level||0)+"#"+k;
      }
      var perimeterKeys = Object.create(null);
      try {
        // Rooms (rect and polygon)
        for (var ri=0; ri<window.allRooms.length; ri++){
          var r0 = window.allRooms[ri]; if(!r0) continue; var lev=(r0.level||0);
          if (Array.isArray(r0.footprint) && r0.footprint.length>=2){
            var pts0 = r0.footprint; for (var kk=0; kk<pts0.length; kk++){
              var a0=pts0[kk], b0=pts0[(kk+1)%pts0.length]; if(!a0||!b0) continue;
              var ek = edgeKeyWithLevel(lev, a0.x,a0.z, b0.x,b0.z); perimeterKeys[ek] = true;
            }
          } else {
            var hw0=(r0.width||0)/2, hd0=(r0.depth||0)/2; if(hw0>0 && hd0>0){
              var xL=(r0.x||0)-hw0, xR=(r0.x||0)+hw0, zT=(r0.z||0)-hd0, zB=(r0.z||0)+hd0;
              var edges0 = [ [xL,zT,xR,zT], [xR,zT,xR,zB], [xR,zB,xL,zB], [xL,zB,xL,zT] ];
              for (var ee=0; ee<edges0.length; ee++){
                var E=edges0[ee]; var ek2 = edgeKeyWithLevel(lev, E[0],E[1],E[2],E[3]); perimeterKeys[ek2] = true;
              }
            }
          }
        }
        // Garages (exclude door/front edge) — compute world corners from center/rotation
        var garages0 = Array.isArray(window.garageComponents) ? window.garageComponents : [];
        for (var gi0=0; gi0<garages0.length; gi0++){
          var g0 = garages0[gi0]; if(!g0) continue; var levG=(g0.level||0);
          var hwg=(g0.width||0)/2, hdg=(g0.depth||0)/2; if(hwg<=0||hdg<=0) continue;
          var rot0 = ((g0.rotation||0) * Math.PI)/180; var cos0=Math.cos(rot0), sin0=Math.sin(rot0);
          function rL(lx,lz){ var rx=lx*cos0 - lz*sin0, rz=lx*sin0 + lz*cos0; return { x:(g0.x||0)+rx, z:(g0.z||0)+rz }; }
          var c0=rL(-hwg,-hdg), c1=rL(hwg,-hdg), c2=rL(hwg,hdg), c3=rL(-hwg,hdg);
          var egs=[[c0,c1],[c1,c2],[c2,c3],[c3,c0]]; for (var eg=0; eg<egs.length; eg++){ if (eg===0) continue; var A=egs[eg][0], B=egs[eg][1]; var ek3=edgeKeyWithLevel(levG, A.x,A.z,B.x,B.z); perimeterKeys[ek3]=true; }
        }
      } catch(_ePK) {}
      // First, remove strips that belonged to the previous perimeter rebuild (old pose)
      try {
        var prevKeys = (window.__lastPerimeterEdges && typeof window.__lastPerimeterEdges === 'object') ? window.__lastPerimeterEdges : null;
        if (prevKeys) {
          window.wallStrips = (window.wallStrips||[]).filter(function(ws){
            if (!ws) return false;
            var keyPrev = edgeKeyWithLevel((ws.level||0), ws.x0,ws.z0, ws.x1,ws.z1);
            return !prevKeys[keyPrev]; // drop any strip that was part of the last perimeter set
          });
        }
      } catch(_ePrev) {}
      // Next, remove existing strips that match perimeter edges of the current set regardless of tag to avoid double walls
      try {
        window.wallStrips = (window.wallStrips||[]).filter(function(ws){
          if (!ws) return false; // discard bogus
          var key = edgeKeyWithLevel((ws.level||0), ws.x0,ws.z0, ws.x1,ws.z1);
          // Keep if not a perimeter edge; remove if it is (we'll add fresh tagged ones below)
          return !perimeterKeys[key];
        });
      } catch(_eFilt) {}
      // If a room is actively dragged, also purge any strips within its expanded bbox on that level (safety against key mismatches)
      try {
        var dragId = window.__activelyDraggedRoomId || null;
        if (dragId) {
          var theRoom = null; for (var ri2=0; ri2<window.allRooms.length; ri2++){ var rr=window.allRooms[ri2]; if(rr && rr.id===dragId){ theRoom=rr; break; } }
          if (theRoom) {
            var levD = (theRoom.level||0);
            var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
            if (Array.isArray(theRoom.footprint) && theRoom.footprint.length>0){
              for (var pi=0; pi<theRoom.footprint.length; pi++){ var p=theRoom.footprint[pi]; if(!p) continue; if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.z<minZ)minZ=p.z; if(p.z>maxZ)maxZ=p.z; }
            } else {
              var hw=(theRoom.width||0)/2, hd=(theRoom.depth||0)/2; minX=(theRoom.x||0)-hw; maxX=(theRoom.x||0)+hw; minZ=(theRoom.z||0)-hd; maxZ=(theRoom.z||0)+hd;
            }
            var pad = 0.8; // 80cm padding
            minX-=pad; maxX+=pad; minZ-=pad; maxZ+=pad;
            function inside(x,z){ return x>=minX && x<=maxX && z>=minZ && z<=maxZ; }
            window.wallStrips = (window.wallStrips||[]).filter(function(ws){
              if (!ws) return false;
              if ((ws.level||0)!==levD) return true; // keep different level
              var inA = inside(ws.x0||0, ws.z0||0), inB = inside(ws.x1||0, ws.z1||0);
              // Drop strips fully within bbox; keep others
              return !(inA && inB);
            });
          }
        }
      } catch(_eDragPurge) {}
      // Also remove previously tagged strips to be safe
      window.removeRoomPerimeterStrips();
      // Helper: check if a strip for this edge (unordered endpoints) already exists
  function kf(x){ return Math.round((+x||0)*1000)/1000; } // 1mm
  function keyFor(x0,z0,x1,z1){ var a=kf(x0)+","+kf(z0), b=kf(x1)+","+kf(z1); return (a<b)? (a+"|"+b):(b+"|"+a); }
      var existing = Object.create(null);
      for (var ei=0; ei<window.wallStrips.length; ei++){
        var s=window.wallStrips[ei]; if(!s) continue; existing[keyFor(s.x0,s.z0,s.x1,s.z1)] = true;
      }
      var added = Object.create(null);
      // Small geometry helpers for openings mapping
      function pointSegInfo(px,pz, x0s,z0s, x1s,z1s){ var vx = x1s-x0s, vz = z1s-z0s; var L2 = vx*vx + vz*vz; if (L2 < 1e-9) return null; var ux = px - x0s, uz = pz - z0s; var u = (ux*vx + uz*vz)/L2; var clamped = Math.max(0, Math.min(1, u)); var qx = x0s + clamped*vx, qz = z0s + clamped*vz; return { d: Math.hypot(px-qx, pz-qz), u: clamped, qx: qx, qz: qz, vx: vx, vz: vz }; }
      function openingsForEdge(room, x0e,z0e,x1e,z1e, isRect, rectMeta){
        var outs = []; if(!room || !Array.isArray(room.openings)) return outs;
        var EPS = 0.06; // 6 cm tolerance to bind world-endpoint openings to this edge
        for (var oi=0; oi<room.openings.length; oi++){
          var op = room.openings[oi]; if(!op) continue;
          if (typeof op.x0 === 'number' && typeof op.z0 === 'number' && typeof op.x1 === 'number' && typeof op.z1 === 'number'){
            // Opening defined by world endpoints: project to this edge and accept if both endpoints lie on/near it
            var i0 = pointSegInfo(op.x0, op.z0, x0e,z0e, x1e,z1e);
            var i1 = pointSegInfo(op.x1, op.z1, x0e,z0e, x1e,z1e);
            if (i0 && i1 && i0.d <= EPS && i1.d <= EPS && i0.u >= -1e-3 && i1.u <= 1+1e-3){ outs.push({ type: op.type, x0: op.x0, z0: op.z0, x1: op.x1, z1: op.z1, sillM: (op.sillM||0), heightM: op.heightM, meta: (op.meta||null) }); }
          } else if (isRect && op && typeof op.edge === 'string' && typeof op.startM === 'number' && typeof op.endM === 'number' && rectMeta){
            // Rectangular room edge-based opening: map to world endpoints along this edge if edges match
            var edge = op.edge; var sM = op.startM; var eM = op.endM; if (eM < sM){ var tmp=sM; sM=eM; eM=tmp; }
            var xL=rectMeta.xL, xR=rectMeta.xR, zT=rectMeta.zT, zB=rectMeta.zB;
            var wx0, wz0, wx1, wz1; var match=false;
            if (edge==='minZ'){ // top
              if (Math.abs(zT - z0e) <= 1e-6 && Math.abs(zT - z1e) <= 1e-6){ wx0 = xL + sM; wx1 = xL + eM; wz0 = zT; wz1 = zT; match=true; }
            } else if (edge==='maxZ'){ // bottom
              if (Math.abs(zB - z0e) <= 1e-6 && Math.abs(zB - z1e) <= 1e-6){ wx0 = xL + sM; wx1 = xL + eM; wz0 = zB; wz1 = zB; match=true; }
            } else if (edge==='minX'){ // left
              if (Math.abs(xL - x0e) <= 1e-6 && Math.abs(xL - x1e) <= 1e-6){ wz0 = zT + sM; wz1 = zT + eM; wx0 = xL; wx1 = xL; match=true; }
            } else if (edge==='maxX'){ // right
              if (Math.abs(xR - x0e) <= 1e-6 && Math.abs(xR - x1e) <= 1e-6){ wz0 = zT + sM; wz1 = zT + eM; wx0 = xR; wx1 = xR; match=true; }
            }
            if (match){ outs.push({ type: op.type, x0: wx0, z0: wz0, x1: wx1, z1: wz1, sillM: (op.sillM||0), heightM: op.heightM, meta: (op.meta||null) }); }
          }
        }
        return outs;
      }
      // Helper: signed polygon area in XZ plane (shoelace); >0 => CCW, <0 => CW
      function polySignedAreaXZ(pts){
        try {
          var s = 0; var n = (pts||[]).length; if (n < 3) return 0;
          for (var ii=0; ii<n; ii++){
            var a = pts[ii], b = pts[(ii+1)%n]; if(!a||!b) continue;
            s += (a.x||0) * (b.z||0) - (b.x||0) * (a.z||0);
          }
          return s * 0.5;
        } catch(_eA){ return 0; }
      }
      for (var i=0; i<window.allRooms.length; i++){
        var r = window.allRooms[i]; if(!r) continue;
        var level = (r.level||0);
        var baseY = level * 3.5;
        var height = (typeof r.height==='number') ? r.height : 3.0;
        if (Array.isArray(r.footprint) && r.footprint.length>=2){
          var pts = r.footprint;
          var area = polySignedAreaXZ(pts);
          var isCCW = (area > 0);
          var interiorIsLeft = isCCW;
          // Compute axis dominance for the room footprint
          var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
          for (var pi=0; pi<pts.length; pi++){ var pp=pts[pi]; if(!pp) continue; minX=Math.min(minX,pp.x||0); maxX=Math.max(maxX,pp.x||0); minZ=Math.min(minZ,pp.z||0); maxZ=Math.max(maxZ,pp.z||0); }
          var spanX = (isFinite(minX)&&isFinite(maxX)) ? (maxX-minX) : 0;
          var spanZ = (isFinite(minZ)&&isFinite(maxZ)) ? (maxZ-minZ) : 0;
          var longerAxis = (spanX >= spanZ) ? 'x' : 'z';
          for (var k=0; k<pts.length; k++){
            var a = pts[k], b = pts[(k+1)%pts.length]; if(!a||!b) continue;
            var key = keyFor(a.x,a.z,b.x,b.z);
            if (existing[key] || added[key]) continue; // already have a user or room strip for this edge
            var sdx = (b.x - a.x), sdz = (b.z - a.z);
            var xDominant = Math.abs(sdx) >= Math.abs(sdz);
            var isOuterBias = (xDominant && longerAxis==='x') || (!xDominant && longerAxis==='z');
            // Determine which side should be used as the 'outer miter' side at corners
            // If the room is CCW (interior is left), real outward is right. We want longer walls to form the exterior miter (use real outward),
            // and shorter walls to form the interior miter (use inward).
            var outerFaceLeft = isOuterBias ? (!interiorIsLeft) : (interiorIsLeft);
            // Attach any openings that lie on this edge (polygon rooms use world endpoints)
            var openEdge = openingsForEdge(r, a.x,a.z,b.x,b.z, false, null);
            window.wallStrips.push({ x0:a.x, z0:a.z, x1:b.x, z1:b.z, thickness:t, height:height, baseY:baseY, level:level, openings:openEdge, [tag]:true, __outerFaceLeft: outerFaceLeft, __interiorLeft: interiorIsLeft });
            added[key] = true;
          }
        } else {
          // Rectangle from center/width/depth
          var hw = (r.width||0)/2, hd=(r.depth||0)/2; if(hw<=0||hd<=0) continue;
          var xL = (r.x||0) - hw, xR=(r.x||0) + hw, zT=(r.z||0) - hd, zB=(r.z||0) + hd;
          var rectPts = [ {x:xL,z:zT}, {x:xR,z:zT}, {x:xR,z:zB}, {x:xL,z:zB} ];
          var areaR = polySignedAreaXZ(rectPts);
          var isCCWR = (areaR > 0);
          var interiorIsLeftR = isCCWR;
          var longerAxisR = ((r.width||0) >= (r.depth||0)) ? 'x' : 'z';
          var edges = [ [xL,zT,xR,zT], [xR,zT,xR,zB], [xR,zB,xL,zB], [xL,zB,xL,zT] ];
          for (var e=0; e<edges.length; e++){
            var E = edges[e];
            var key2 = keyFor(E[0],E[1],E[2],E[3]);
            if (existing[key2] || added[key2]) continue;
            var edx = E[2]-E[0], edz = E[3]-E[1];
            var xDom = Math.abs(edx) >= Math.abs(edz);
            var isOuterBiasR = (xDom && longerAxisR==='x') || (!xDom && longerAxisR==='z');
            var outerFaceLeftR = isOuterBiasR ? (!interiorIsLeftR) : (interiorIsLeftR);
            // Map rectangle edge-based openings to world endpoints for this edge
            var openEdgeR = openingsForEdge(r, E[0],E[1],E[2],E[3], true, { xL:xL, xR:xR, zT:zT, zB:zB });
            window.wallStrips.push({ x0:E[0], z0:E[1], x1:E[2], z1:E[3], thickness:t, height:height, baseY:baseY, level:level, openings:openEdgeR, [tag]:true, __outerFaceLeft: outerFaceLeftR, __interiorLeft: interiorIsLeftR });
            added[key2] = true;
          }
        }
        // (Garages are handled in a separate block below)
      }
      // After processing all rooms, add garage perimeter strips (excluding the door/front edge)
      try {
        var garages = Array.isArray(window.garageComponents) ? window.garageComponents : [];
        for (var gi=0; gi<garages.length; gi++){
          var g = garages[gi]; if(!g) continue;
          var levelG = (g.level||0);
          var baseYG = levelG * 3.5;
          var heightG = (typeof g.height==='number') ? g.height : 2.6;
          var hwg = (g.width||0)/2, hdg=(g.depth||0)/2; if(hwg<=0||hdg<=0) continue;
          var cxG = (g.x||0), czG = (g.z||0);
          var rot = ((g.rotation||0) * Math.PI) / 180;
          var cos = Math.cos(rot), sin = Math.sin(rot);
          function rotPtLocal(lx,lz){ var rx = lx*cos - lz*sin; var rz = lx*sin + lz*cos; return { x: cxG + rx, z: czG + rz }; }
          // Local CCW corners relative to center
          var c0 = rotPtLocal(-hwg, -hdg); // front-left (local minZ)
          var c1 = rotPtLocal( hwg, -hdg); // front-right
          var c2 = rotPtLocal( hwg,  hdg); // back-right
          var c3 = rotPtLocal(-hwg,  hdg); // back-left
          var polyG = [c0,c1,c2,c3];
          var areaG = polySignedAreaXZ(polyG);
          var interiorIsLeftG = (areaG > 0);
          var longerAxisG = ((g.width||0) >= (g.depth||0)) ? 'x' : 'z';
          // Edges in local CCW order; index 0 is the front/door edge before rotation (between c0->c1)
          var edgesG = [ [c0,c1], [c1,c2], [c2,c3], [c3,c0] ];
          for (var egi=0; egi<edgesG.length; egi++){
            if (egi === 0) continue; // skip door/front edge
            var E0 = edgesG[egi][0];
            var E1 = edgesG[egi][1];
            var keyG = keyFor(E0.x,E0.z,E1.x,E1.z);
            if (existing[keyG] || added[keyG]) continue;
            var edx = E1.x - E0.x, edz = E1.z - E0.z;
            var xDomG = Math.abs(edx) >= Math.abs(edz);
            var isOuterBiasG = (xDomG && longerAxisG==='x') || (!xDomG && longerAxisG==='z');
            var outerFaceLeftG = isOuterBiasG ? (!interiorIsLeftG) : (interiorIsLeftG);
            window.wallStrips.push({ x0:E0.x, z0:E0.z, x1:E1.x, z1:E1.z, thickness:t, height:heightG, baseY:baseYG, level:levelG, openings:[], [tag]:true, __outerFaceLeft: outerFaceLeftG, __interiorLeft: interiorIsLeftG });
            added[keyG] = true;
          }
        }
      } catch(_eGar) { /* best-effort for garages */ }
      // Save current perimeter edge keys so a future rebuild can purge them (prevents ghosts)
      try { window.__lastPerimeterEdges = perimeterKeys; } catch(_eSavePk) {}
      // Final safety: dedupe resulting strips by edge+level to eliminate any residual duplicates
      try { if (typeof window.dedupeWallStrips === 'function') window.dedupeWallStrips(); } catch(_eDd) {}
      if (typeof window.saveProjectSilently==='function') window.saveProjectSilently();
      if (typeof window.renderLoop==='function') window.renderLoop();
    } catch(_e) {}
  };
  if (typeof window.setWallRenderMode === 'undefined') window.setWallRenderMode = function(mode){
    try {
      var m = (mode==='solid') ? 'solid' : 'line';
      window.__wallRenderMode = m;
      // When user presses Render (solid), enable corner codes so endpoints are labeled on screen
      if (m === 'solid') { window.__showCornerCodes = true; }
      else { window.__showCornerCodes = false; }
      // Simplified: do not run 2D→3D applies here. Just rebuild from existing 3D state for ALL rooms/garages across floors.
      // This guarantees that pressing Render applies to ground and first floor together, without duplication or missed floors.
      if (m === 'solid') {
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
  if (typeof window.HANDLE_SNAP_TOLERANCE === 'undefined') window.HANDLE_SNAP_TOLERANCE = 0.15;
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
    };
  }

  // ---- Projection math ----
  var __proj = { right:[1,0,0], up:[0,1,0], fwd:[0,0,1], cam:[0,0,10], scale: 600 };
  try { window.__proj = __proj; } catch(e) {}
  // Blend between perspective (1.0) and near-orthographic (0.0). Lowering this reduces perspective foreshortening.
  if (typeof window.PERSPECTIVE_STRENGTH === 'undefined') window.PERSPECTIVE_STRENGTH = 0.88;
  if (typeof window.updateProjectionCache === 'undefined') {
    window.updateProjectionCache = function updateProjectionCache(){
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
      if (cz < -0.25) return null;           // behind camera -> discard
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
  function __aabbOverlap(ax0,ax1,az0,az1, bx0,bx1,bz0,bz1){ return (ax0 < bx1 && ax1 > bx0 && az0 < bz1 && az1 > bz0); }
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
        for (var i=0;i<footprints.length;i++){
          var f=footprints[i]; var bx0=f.x - (f.w||0)/2, bx1=f.x + (f.w||0)/2, bz0=f.z - (f.d||0)/2, bz1=f.z + (f.d||0)/2;
          if (__aabbOverlap(ax0,ax1,az0,az1, bx0,bx1,bz0,bz1)) return true;
        }
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
      // Sync 2D immediately so walls appear without needing manual refresh
      try { if (typeof populatePlan2DFromDesign==='function') { populatePlan2DFromDesign(); if (window.__plan2d && __plan2d.active && typeof plan2dDraw==='function') plan2dDraw(); } } catch(_e2d2) {}
      if (typeof window.selectObject==='function') { window.selectObject(r.id, { noRender: true }); }
      else { selectedRoomId=r.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMU) {} }
      updateStatus('Added room'); _needsFullRender=true; startRender();
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
  if (typeof window.hitTestWallStrips === 'undefined') window.hitTestWallStrips = function(){ return -1; };
  if (typeof window.drawWallStrip === 'undefined') window.drawWallStrip = function(ws){
    try {
      if (!ws) return;
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
          if (!window.__showCornerCodes) return;
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

      // Line mode: draw a single centerline at mid-height; skip thickness/face outlines
      if (renderMode === 'line'){
        var yMid = baseY + Math.min(h*0.5, 1.2);
        var p0 = project3D(x0, yMid, z0), p1 = project3D(x1, yMid, z1);
        if (!p0 || !p1) return;
        ctx.save();
        ctx.strokeStyle = onLevel ? '#64748b' : 'rgba(148,163,184,0.6)';
        ctx.lineWidth = onLevel ? 3 : 1.6;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        ctx.restore();
        // Corner codes in line mode too (using same mid-height for label position)
        drawCornerCodeAt(x0, yMid, z0);
        drawCornerCodeAt(x1, yMid, z1);
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
        var infos = [];
        try {
          var arr = window.wallStrips || [];
          for (var ii=0; ii<arr.length; ii++){
            var s = arr[ii]; if(!s || s===ws) continue;
            // Only consider neighbors on the same level to avoid cross-floor interference
            if ((s.level||0) !== (ws.level||0)) continue;
            var isStart = (Math.hypot((s.x0||0)-wx, (s.z0||0)-wz) < 1e-3);
            var isEnd   = (Math.hypot((s.x1||0)-wx, (s.z1||0)-wz) < 1e-3);
            if (!isStart && !isEnd) continue;
            var ox = isStart ? (s.x1||0) : (s.x0||0);
            var oz = isStart ? (s.z1||0) : (s.z0||0);
            var vx = ox - wx, vz = oz - wz; var L = Math.hypot(vx,vz);
            if (L > 1e-6){ infos.push({ s:s, dir:{x:vx/L, z:vz/L} }); }
          }
        } catch(_eNd) {}
        if (!infos.length) return null;
        // choose neighbor with largest angle to this segment to avoid colinear
        var best = null, bestAng = -1;
        for (var i=0; i<infos.length; i++){
          var ang = angleBetween(tvec, infos[i].dir);
          if (ang > bestAng){ bestAng = ang; best = infos[i]; }
        }
        if (!best) return null;
        // Snap to perfect orthogonal if near 90° to improve 45° geometry
        if (Math.abs(bestAng - (Math.PI/2)) < 0.10) {
          var ortho1 = { x: -tvec.z, z: tvec.x };
          var ortho2 = { x: tvec.z,  z: -tvec.x };
          function _dot(a,b){ return a.x*b.x + a.z*b.z; }
          best.dir = (_dot(best.dir, ortho1) > _dot(best.dir, ortho2)) ? _normalize2(ortho1.x, ortho1.z) : _normalize2(ortho2.x, ortho2.z);
        }
        return best;
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
        var arr = window.wallStrips || []; var best=null; var bestD=1e9;
        for (var ii=0; ii<arr.length; ii++){
          var s = arr[ii]; if(!s || s===ws) continue;
          // Same-level only to prevent other floors from affecting T-trim
          if ((s.level||0) !== (ws.level||0)) continue;
          var sx0=s.x0||0, sz0=s.z0||0, sx1=s.x1||0, sz1=s.z1||0;
          var info = pointSegInfo(px,pz, sx0,sz0, sx1,sz1);
          if (!info) continue;
          // Skip if our projected contact point is too close to neighbor endpoints -> this is an L-corner, not a T
          var endDistA = Math.hypot(info.qx - sx0, info.qz - sz0);
          var endDistB = Math.hypot(info.qx - sx1, info.qz - sz1);
          if (Math.min(endDistA, endDistB) < 0.06) continue; // 6cm from endpoints => treat as corner
          // Only accept points well inside the segment and within a tight distance tolerance
          if (info.u > 0.02 && info.u < 0.98){ // strictly inside segment
            if (info.d < bestD && info.d < 0.03){ best={ s:s, info:info }; bestD=info.d; }
          }
        }
        return best;
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
      }
      var startIsT = false, endIsT = false;
      if (startT){ applyTTrimAtStart(startT); startIsT = true; }
      if (endT){ applyTTrimAtEnd(endT); endIsT = true; }

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
      // 007-start: local diagonal (t + n) — with asymmetric option for inner corners
      if (!startIsT){
        var corner0 = { x:x0, z:z0 };
        var dxs = tvec.x + nx, dzs = tvec.z + nz; var dl = Math.hypot(dxs, dzs);
        if (dl > 1e-6){
          var cutDir = { x: dxs/dl, z: dzs/dl };
          var pL0s = { x: corner0.x + nx*hw, z: corner0.z + nz*hw };
          var pR0s = { x: corner0.x - nx*hw, z: corner0.z - nz*hw };
          var iL0 = intersectLines(pL0s, tvec, corner0, cutDir);
          var iR0 = intersectLines(pR0s, tvec, corner0, cutDir);
          if (isRoomPerimeter && interiorLeftGlobal != null && startConcave){
            // Inner corner handling: preserve interior face endpoint, miter the exterior only
            if (interiorLeftGlobal){
              // interior is left: keep A at original offset; only miter D
              if (iR0){ D.x = iR0.x; D.z = iR0.z; }
              else { D.x = pR0s.x; D.z = pR0s.z; }
              A.x = pL0s.x; A.z = pL0s.z;
            } else {
              // interior is right: keep D; only miter A
              if (iL0){ A.x = iL0.x; A.z = iL0.z; }
              else { A.x = pL0s.x; A.z = pL0s.z; }
              D.x = pR0s.x; D.z = pR0s.z;
            }
          } else if (isRoomPerimeter && interiorLeftGlobal != null && startConvex){
            // Exterior (convex) corner: make outer faces meet exactly by intersecting outer offset lines of this and neighbor
            var nb0 = getNeighborAt(x0, z0);
            var iExt0 = null;
            // Use or populate a shared snap for this corner to guarantee both walls use the same point
            try {
              var __key0 = (ws.level||0) + '|' + Math.round(corner0.x*100) + '|' + Math.round(corner0.z*100) + '|ext';
              if (window.__extCornerSnap && window.__extCornerSnap[__key0]) {
                iExt0 = window.__extCornerSnap[__key0];
              }
            } catch(_eSnap0Rd) {}
            try {
              if (!iExt0 && nb0 && nb0.s){
                var tsx = nb0.dir.x, tsz = nb0.dir.z; var nsx = -tsz, nsz = tsx;
                var hwN = Math.max(0.02, (nb0.s.thickness||0.3)/2);
                var intLeftN = (typeof nb0.s.__interiorLeft==='boolean') ? nb0.s.__interiorLeft : ((typeof nb0.s.__outerFaceLeft==='boolean') ? (!nb0.s.__outerFaceLeft) : null);
                var exSignN = (intLeftN===true) ? -1 : 1; // exterior is right if interiorLeft
                var qOut0 = { x: corner0.x + nsx*exSignN*hwN, z: corner0.z + nsz*exSignN*hwN };
                var pOut0 = interiorLeftGlobal ? pR0s : pL0s; // our exterior at start
                var dOut0 = tvec; var eOut0 = { x: tsx, z: tsz };
                iExt0 = intersectLines(pOut0, dOut0, qOut0, eOut0);
              }
            } catch(_eX0) { iExt0 = null; }
            // Persist the snapped point for neighbors (quantize to cm to stabilize)
            try {
              if (iExt0) {
                var __key0w = (ws.level||0) + '|' + Math.round(corner0.x*100) + '|' + Math.round(corner0.z*100) + '|ext';
                window.__extCornerSnap[__key0w] = { x: iExt0.x, z: iExt0.z };
              }
            } catch(_eSnap0Wr) {}
            if (interiorLeftGlobal){
              // exterior is right: set D to exterior intersection or fallback; miter A (interior)
              if (iExt0){ D.x = iExt0.x; D.z = iExt0.z; } else { D.x = pR0s.x; D.z = pR0s.z; }
              if (iL0){ A.x = iL0.x; A.z = iL0.z; } else { A.x = pL0s.x; A.z = pL0s.z; }
            } else {
              // exterior is left: set A to exterior intersection or fallback; miter D (interior)
              if (iExt0){ A.x = iExt0.x; A.z = iExt0.z; } else { A.x = pL0s.x; A.z = pL0s.z; }
              if (iR0){ D.x = iR0.x; D.z = iR0.z; } else { D.x = pR0s.x; D.z = pR0s.z; }
            }
          } else {
            // Default symmetric 45° miter
            if (iL0){ A.x = iL0.x; A.z = iL0.z; }
            if (iR0){ D.x = iR0.x; D.z = iR0.z; }
          }
        }
      }
      // 007-end: local diagonal (t − n) — with asymmetric option for inner corners
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
          if (isRoomPerimeter && interiorLeftGlobal != null && endConcave){
            if (interiorLeftGlobal){
              // interior is left: keep B; only miter C
              if (iR1){ C.x = iR1.x; C.z = iR1.z; }
              else { C.x = pR1s.x; C.z = pR1s.z; }
              B.x = pL1s.x; B.z = pL1s.z;
            } else {
              // interior is right: keep C; only miter B
              if (iL1){ B.x = iL1.x; B.z = iL1.z; }
              else { B.x = pL1s.x; B.z = pL1s.z; }
              C.x = pR1s.x; C.z = pR1s.z;
            }
          } else if (isRoomPerimeter && interiorLeftGlobal != null && endConvex){
            // Exterior (convex) corner: intersect outer offset lines to make outer faces meet
            var nb1 = getNeighborAt(x1, z1);
            var iExt1 = null;
            // Shared snap read
            try {
              var __key1 = (ws.level||0) + '|' + Math.round(corner1.x*100) + '|' + Math.round(corner1.z*100) + '|ext';
              if (window.__extCornerSnap && window.__extCornerSnap[__key1]) {
                iExt1 = window.__extCornerSnap[__key1];
              }
            } catch(_eSnap1Rd) {}
            try {
              if (!iExt1 && nb1 && nb1.s){
                var tsx = nb1.dir.x, tsz = nb1.dir.z; var nsx = -tsz, nsz = tsx;
                var hwN = Math.max(0.02, (nb1.s.thickness||0.3)/2);
                var intLeftN = (typeof nb1.s.__interiorLeft==='boolean') ? nb1.s.__interiorLeft : ((typeof nb1.s.__outerFaceLeft==='boolean') ? (!nb1.s.__outerFaceLeft) : null);
                var exSignN = (intLeftN===true) ? -1 : 1;
                var qOut1 = { x: corner1.x + nsx*exSignN*hwN, z: corner1.z + nsz*exSignN*hwN };
                var pOut1 = interiorLeftGlobal ? pR1s : pL1s; // our exterior at end
                var dOut1 = { x: -tvec.x, z: -tvec.z }; var eOut1 = { x: tsx, z: tsz };
                iExt1 = intersectLines(pOut1, dOut1, qOut1, eOut1);
              }
            } catch(_eX1) { iExt1 = null; }
            // Persist snap
            try {
              if (iExt1) {
                var __key1w = (ws.level||0) + '|' + Math.round(corner1.x*100) + '|' + Math.round(corner1.z*100) + '|ext';
                window.__extCornerSnap[__key1w] = { x: iExt1.x, z: iExt1.z };
              }
            } catch(_eSnap1Wr) {}
            if (interiorLeftGlobal){
              // exterior is right: set C to exterior intersection; miter B
              if (iExt1){ C.x = iExt1.x; C.z = iExt1.z; } else { C.x = pR1s.x; C.z = pR1s.z; }
              if (iL1){ B.x = iL1.x; B.z = iL1.z; } else { B.x = pL1s.x; B.z = pL1s.z; }
            } else {
              // exterior is left: set B to exterior intersection; miter C
              if (iExt1){ B.x = iExt1.x; B.z = iExt1.z; } else { B.x = pL1s.x; B.z = pL1s.z; }
              if (iR1){ C.x = iR1.x; C.z = iR1.z; } else { C.x = pR1s.x; C.z = pR1s.z; }
            }
          } else {
            // Default symmetric 45° miter
            if (iL1){ B.x = iL1.x; B.z = iL1.z; }
            if (iR1){ C.x = iR1.x; C.z = iR1.z; }
          }
        }
      }

      var At = {x:A.x, y:baseY+h, z:A.z};
      var Bt = {x:B.x, y:baseY+h, z:B.z};
      var Ct = {x:C.x, y:baseY+h, z:C.z};
      var Dt = {x:D.x, y:baseY+h, z:D.z};
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
      var leftHoles = [];  // each: [{x,y},{x,y},{x,y},{x,y}] projected on left face
      var rightHoles = []; // projected on right face
      var glassRects = []; // for windows only, centered in thickness
      for (var oi=0; oi<openings.length; oi++){
        var op = openings[oi]; if(!op) continue;
        var isDoor = (op.type==='door');
        var sill = isDoor ? 0 : ((typeof op.sillM==='number') ? op.sillM : 1.0);
        var oH = (typeof op.heightM==='number') ? op.heightM : (isDoor ? 2.04 : 1.5);
        var y0 = baseY + sill;
        var y1 = Math.min(y0 + oH, stripTopY);
        // endpoints along the strip
        var x0o = (op.x0!=null? op.x0 : x0), z0o = (op.z0!=null? op.z0 : z0);
        var x1o = (op.x1!=null? op.x1 : x1), z1o = (op.z1!=null? op.z1 : z1);
        // Left face hole (offset +eps)
        var lx0 = x0o + nx*eps, lz0 = z0o + nz*eps;
        var lx1 = x1o + nx*eps, lz1 = z1o + nz*eps;
        var lA = project3D(lx0, y0, lz0); var lB = project3D(lx1, y0, lz1);
        var lC = project3D(lx1, y1, lz1); var lD = project3D(lx0, y1, lz0);
        if (lA && lB && lC && lD) leftHoles.push([lA,lB,lC,lD]);
        // Right face hole (offset -eps)
        var rx0 = x0o - nx*eps, rz0 = z0o - nz*eps;
        var rx1 = x1o - nx*eps, rz1 = z1o - nz*eps;
        var rA = project3D(rx0, y0, rz0); var rB = project3D(rx1, y0, rz1);
        var rC = project3D(rx1, y1, rz1); var rD = project3D(rx0, y1, rz0);
        if (rA && rB && rC && rD) rightHoles.push([rA,rB,rC,rD]);
        // Glass rectangle centered (for windows only)
        if (!isDoor){
          var gA = project3D(x0o, y0, z0o); var gB = project3D(x1o, y0, z1o);
          var gC = project3D(x1o, y1, z1o); var gD = project3D(x0o, y1, z0o);
          if (gA && gB && gC && gD) glassRects.push([gA,gB,gC,gD]);
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
  // Stroke only the long edges and any exposed caps; keep lines very subtle
  ctx.beginPath();
  // Long edge At->Bt
  if (pAt && pBt) { ctx.moveTo(pAt.x,pAt.y); ctx.lineTo(pBt.x,pBt.y); }
  // Cap Bt->Ct only if no neighbor at end
  if (!endHasNeighbor && pBt && pCt){ ctx.moveTo(pBt.x,pBt.y); ctx.lineTo(pCt.x,pCt.y); }
  // Long edge Ct->Dt
  if (pCt && pDt) { ctx.moveTo(pCt.x,pCt.y); ctx.lineTo(pDt.x,pDt.y); }
  // Cap Dt->At only if no neighbor at start
  if (!startHasNeighbor && pDt && pAt){ ctx.moveTo(pDt.x,pDt.y); ctx.lineTo(pAt.x,pAt.y); }
  ctx.stroke();
      // Draw translucent blue glass for windows on all three planes: center, left face, right face
      var glassFill = 'rgba(56,189,248,0.25)';
      var glassStroke = onLevel ? 'rgba(56,189,248,0.55)' : 'rgba(148,163,184,0.7)';
      function drawGlassQuad(Q){
        ctx.beginPath();
        ctx.moveTo(Q[0].x,Q[0].y); ctx.lineTo(Q[1].x,Q[1].y); ctx.lineTo(Q[2].x,Q[2].y); ctx.lineTo(Q[3].x,Q[3].y); ctx.closePath();
        ctx.fillStyle = glassFill; ctx.fill();
        ctx.strokeStyle = glassStroke; ctx.lineWidth = onLevel ? 1.8 : 1.2; ctx.stroke();
      }
      // Center plane
      if (glassRects.length){
        for (var gi=0; gi<glassRects.length; gi++){ var G = glassRects[gi]; if(!G||G.length!==4) continue; drawGlassQuad(G); }
      }
      // Left and right wall faces
      if (leftHoles.length){ for (var lh=0; lh<leftHoles.length; lh++){ var LQ = leftHoles[lh]; if(!LQ||LQ.length!==4) continue; drawGlassQuad(LQ); } }
      if (rightHoles.length){ for (var rh=0; rh<rightHoles.length; rh++){ var RQ = rightHoles[rh]; if(!RQ||RQ.length!==4) continue; drawGlassQuad(RQ); } }
      // Draw any door/window overlays attached to this wall strip (centerline-based)
      // In solid mode, we already cut holes and drew glass; skip legacy opening outlines for clarity.
      try {
        /* no-op: opening outlines suppressed in solid mode */
      } catch(_eOpen) {}
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
          panel.style.display = 'none';
          return;
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
        if (window.__plan2d && __plan2d.active) { panel.classList.remove('visible'); panel.style.display = 'none'; return; }
        panel.style.display = '';
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
          if (window.__showCornerCodes && typeof window.computeCornerCodes==='function') { window.computeCornerCodes(); }
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
        try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_e3) {}
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
    try { focusCameraOnObject(stair); } catch(_e) {}
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
    try { focusCameraOnObject(p); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addGarage === 'undefined') window.addGarage = function(){
    var lvl=0, w=3.2, d=5.5; var spot=findFreeSpotForFootprint(w,d,lvl); var s=applySnap({x:spot.x,z:spot.z,width:w,depth:d,level:lvl,type:'garage'});
    var g={ id:newId('garage'), name:'Garage', x:s.x, z:s.z, width:w, depth:d, height:2.6, level:lvl, type:'garage', rotation:0 };
  (window.garageComponents||[]).push(g);
  if (typeof window.selectObject==='function') { window.selectObject(g.id, { noRender: true }); }
  else { window.selectedRoomId=g.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMg) {} }
  updateStatus('Added Garage');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
    try { focusCameraOnObject(g); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addPool === 'undefined') window.addPool = function(){
    var lvl=0, w=4, d=2; var spot=findFreeSpotForFootprint(w,d,lvl); var s=applySnap({x:spot.x,z:spot.z,width:w,depth:d,level:lvl,type:'pool'});
    var p={ id:newId('pool'), name:'Pool', x:s.x, z:s.z, width:w, depth:d, height:1.5, level:lvl, type:'pool', rotation:0 };
  (window.poolComponents||[]).push(p);
  if (typeof window.selectObject==='function') { window.selectObject(p.id, { noRender: true }); }
  else { window.selectedRoomId=p.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMpl) {} }
  updateStatus('Added Pool');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
    try { focusCameraOnObject(p); } catch(_e) {}
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
    try { focusCameraOnObject(r); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addBalcony === 'undefined') window.addBalcony = function(){
    var lvl=1, w=2.5, d=1.5; var spot=findFreeSpotForFootprint(w,d,lvl); var s=applySnap({x:spot.x,z:spot.z,width:w,depth:d,level:lvl,type:'balcony'});
    var b={ id:newId('balcony'), name:'Balcony', x:s.x, z:s.z, width:w, depth:d, height:3.0, totalHeight:3.0, wallThickness:0.12, wallHeight:1.0, legWidth:0.18, floorThickness:0.1, slatCount:8, slatWidth:0.12, roofHeight:0.25, level:lvl, type:'balcony', rotation:0 };
  (window.balconyComponents||[]).push(b);
  if (typeof window.selectObject==='function') { window.selectObject(b.id, { noRender: true }); }
  else { window.selectedRoomId=b.id; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMb) {} }
  updateStatus('Added Balcony');
  try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
    try { focusCameraOnObject(b); } catch(_e) {}
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
