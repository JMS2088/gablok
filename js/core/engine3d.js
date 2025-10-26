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
      // Mark that status should not be used for sticky debug text
      window.__debugStickyStatus = true;
    }
    return el;
  }
  function __updateDebugOverlay(){
    var el = __ensureDebugOverlay(); if (!el) return;
    try {
      var dims = canvas ? (canvas.width + 'x' + canvas.height) : 'no-canvas';
      var cssW = (canvas && canvas.style && canvas.style.width) ? canvas.style.width : '-';
      var cssH = (canvas && canvas.style && canvas.style.height) ? canvas.style.height : '-';
      var origin = (typeof project3D === 'function') ? project3D(0,0,0) : null;
      var originTxt = origin ? ('(' + Math.round(origin.x) + ',' + Math.round(origin.y) + ') z=' + (origin._cz||'') ) : 'offscreen/null';
      el.textContent = [
        'frames=' + (window.__dbgGfx.frames||0),
        'clear=' + (window.__dbgGfx.clearCalls||0),
        'grid=' + (window.__dbgGfx.gridCalls||0),
        'rooms=' + (Array.isArray(window.allRooms)? allRooms.length : 'n/a'),
        'cam yaw=' + (camera? camera.yaw.toFixed(2):'n/a') + ' pitch=' + (camera? camera.pitch.toFixed(2):'n/a') + ' dist=' + (camera? camera.distance.toFixed(1):'n/a'),
        'target x=' + (camera? camera.targetX.toFixed(2):'n/a') + ' z=' + (camera? camera.targetZ.toFixed(2):'n/a'),
        'canvas=' + dims + ' css=' + cssW + 'x' + cssH,
        'proj(0,0,0) ' + originTxt
      ].join('\n');
    } catch(e) {
      el.textContent = 'debug overlay error';
    }
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
      targetY: 3.0,
      // Ensure the camera's eye doesn't go below a small height above ground
      minCamY: 0.25
    };
  }
  if (typeof window.pan === 'undefined') window.pan = { x:0, y:0 };
  if (typeof window.mouse === 'undefined') window.mouse = { down:false, dragType:null, dragInfo:null, lastX:0, lastY:0 };

  // ---- Scene data ----
  if (typeof window.allRooms === 'undefined') window.allRooms = [];
  if (typeof window.wallStrips === 'undefined') window.wallStrips = [];
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
  if (typeof window.UI_FADE_INACTIVITY_MS === 'undefined') window.UI_FADE_INACTIVITY_MS = 2200;
  if (typeof window.UI_FADE_GRACE_MS === 'undefined') window.UI_FADE_GRACE_MS = 5000; // no fade until 5s idle
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
  var camY = (camera.targetY||0) - fwd[1]*camera.distance;
  if (typeof camera.minCamY === 'number') camY = Math.max(camera.minCamY, camY);
  var cam = [ camera.targetX - fwd[0]*camera.distance, camY, camera.targetZ - fwd[2]*camera.distance ];
      __proj.right = right; __proj.up = up; __proj.fwd = fwd; __proj.cam = cam;
      var dpr = window.devicePixelRatio || 1;
      __proj.scale = Math.max(300, (Math.min(canvas ? canvas.height : 800, canvas ? canvas.width : 1200) * 0.6)) / dpr;
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
      // Make near-plane very permissive; clamp extremely close points instead of dropping them
      if (cz <= 1e-5) return null; // behind or at camera plane
      if (cz < 0.01) cz = 0.01;    // clamp very close points so they remain projectable
      var s = __proj.scale / cz;
      var sx = (canvas.width/2) + (cx * s) + pan.x;
      var sy = (canvas.height/2) - (cy * s) + pan.y;
      return { x:sx, y:sy, _cz:cz };
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
      // No base dimming; rely solely on UI fade alpha so handles are fully opaque while active
      var alpha = 1.0;
      var uiA = (typeof window.__uiFadeAlpha === 'number' ? window.__uiFadeAlpha : 1.0);
      ctx.globalAlpha = Math.max(0.15, alpha * uiA);
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
      ctx.save();
      // Base circle
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fill(); ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.stroke();
      // Cross hairs
      ctx.strokeStyle='#e2e8f0';
      ctx.beginPath(); ctx.moveTo(cx-r+4,cy); ctx.lineTo(cx+r-4,cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx,cy-r+4); ctx.lineTo(cx,cy+r-4); ctx.stroke();
      // Cardinal labels (fixed in compass space)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', cx, cy - r + 10);
      ctx.fillText('E', cx + r - 10, cy);
      ctx.fillText('S', cx, cy + r - 10);
      ctx.fillText('W', cx - r + 10, cy);
      // North arrow: rotate relative to camera yaw so it points toward world north
      var ang = -camera.yaw; ctx.translate(cx,cy); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0,-r+6); ctx.lineTo(-5,-r+14); ctx.lineTo(5,-r+14); ctx.closePath(); ctx.fillStyle='#3b82f6'; ctx.fill();
      ctx.restore();
    };
  }
  if (typeof window.isOffscreenByCenter === 'undefined') {
    window.isOffscreenByCenter = function(p){ if(!canvas||!p) return true; var pad=40; return (p.x<-pad||p.y<-pad||p.x>canvas.width+pad||p.y>canvas.height+pad); };
  }

  // ---- Scene creation helpers ----
  if (typeof window.createRoom === 'undefined') {
    window.createRoom = function(x,z,level){ var id='room_'+Date.now()+'_'+Math.random().toString(36).slice(2); return { id:id, name:'Room', x:x||0, z:z||0, width:4, depth:3, height:3, level:(level||0), type:'room', rotation:0 }; };
  }
  if (typeof window.findFreeSpot === 'undefined') {
    window.findFreeSpot = function(room){
      try {
        var grid = (typeof GRID_SPACING==='number' && GRID_SPACING>0)? GRID_SPACING : 1;
        var level = (room && typeof room.level==='number') ? room.level : (typeof currentFloor==='number'? currentFloor:0);
        var halfW = Math.max(0.25, (room && room.width ? room.width : 1)/2);
        var halfD = Math.max(0.25, (room && room.depth ? room.depth : 1)/2);

        function snapCenter(x,z){
          try { var s = applySnap({x:x, z:z, width: (room.width||1), depth:(room.depth||1), level: level, type:'room'}); return {x:s.x, z:s.z}; } catch(e){ return {x:x, z:z}; }
        }
        function aabbOverlap(ax0,ax1,az0,az1, bx0,bx1,bz0,bz1){
          // Overlap if strictly intersecting; touching edges is allowed (no overlap)
          return (ax0 < bx1 && ax1 > bx0 && az0 < bz1 && az1 > bz0);
        }
        function collides(nx,nz){
          var ax0 = nx - halfW, ax1 = nx + halfW, az0 = nz - halfD, az1 = nz + halfD;
          for (var i=0;i<allRooms.length;i++){
            var r = allRooms[i]; if(!r) continue; if ((r.level||0)!==level) continue;
            var bx0 = (r.x||0) - (r.width||0)/2, bx1 = (r.x||0) + (r.width||0)/2;
            var bz0 = (r.z||0) - (r.depth||0)/2, bz1 = (r.z||0) + (r.depth||0)/2;
            if (aabbOverlap(ax0,ax1,az0,az1, bx0,bx1,bz0,bz1)) return true;
          }
          return false;
        }

        var startX = (typeof camera==='object' ? camera.targetX : 0);
        var startZ = (typeof camera==='object' ? camera.targetZ : 0);

        var seen = new Set();
        function keyFor(x,z){ return (Math.round(x/grid)*grid)+'|'+(Math.round(z/grid)*grid); }

        // Spiral search outwards on the grid up to a reasonable radius
        var maxRings = 30; // ~1800 candidates worst case
        for (var ring=0; ring<=maxRings; ring++){
          for (var dx=-ring; dx<=ring; dx++){
            for (var dz=-ring; dz<=ring; dz++){
              if (Math.max(Math.abs(dx),Math.abs(dz)) !== ring) continue; // only border of the square ring
              var cx = startX + dx*grid, cz = startZ + dz*grid;
              var snapped = snapCenter(cx, cz);
              var k = keyFor(snapped.x, snapped.z); if (seen.has(k)) continue; seen.add(k);
              if (!collides(snapped.x, snapped.z)) return { x: snapped.x, z: snapped.z };
            }
          }
        }
        // Fallback to a nearby snapped spot if none found
        var fallback = snapCenter(startX, startZ);
        return { x: fallback.x, z: fallback.z };
      } catch(e) {
        // Simple random fallback if anything goes wrong
        var a=Math.random()*Math.PI*2; var r=0.5+Math.random()*2; return { x:camera.targetX+Math.cos(a)*r, z:camera.targetZ+Math.sin(a)*r };
      }
    };
  }
  if (typeof window.createInitialRoom === 'undefined') {
    window.createInitialRoom = function(){ if(Array.isArray(allRooms)&&allRooms.length>0) return; var r=createRoom(0,0,0); allRooms.push(r); selectedRoomId=r.id; };
  }
  if (typeof window.addNewRoom === 'undefined') {
    window.addNewRoom = function(){
      var r=createRoom(camera.targetX,camera.targetZ,currentFloor||0);
      var spot=findFreeSpot(r); r.x=spot.x; r.z=spot.z;
      try { var s=applySnap({x:r.x,z:r.z,width:r.width,depth:r.depth,level:r.level,id:r.id,type:'room'}); r.x=s.x; r.z=s.z; } catch(_e) {}
      allRooms.push(r); selectedRoomId=r.id; updateStatus('Added room'); _needsFullRender=true; startRender();
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
  if (typeof window.findObjectById === 'undefined') window.findObjectById = function(id){ if(!id) return null; var arrs=[allRooms, pergolaComponents, garageComponents, poolComponents, roofComponents, balconyComponents, furnitureItems]; for(var ai=0; ai<arrs.length; ai++){ var A=arrs[ai]||[]; for(var i=0;i<A.length;i++){ if(A[i]&&A[i].id===id) return A[i]; } } if(stairsComponent&&stairsComponent.id===id) return stairsComponent; return null; };
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
  if (typeof window.drawWallStrip === 'undefined') window.drawWallStrip = function(){};
  if (typeof window.dedupeAllEntities === 'undefined') window.dedupeAllEntities = function(){};
  // Minimal DOM labeler for rooms (provided by ui/labels.js). Guard to avoid duplication.
  if (typeof window.updateLabels === 'undefined') {
    window.updateLabels = function(){};
  }
  if (typeof window.updateMeasurements === 'undefined') window.updateMeasurements = function(){};
  if (typeof window.drawWorldHeightScale === 'undefined') window.drawWorldHeightScale = function(){};
  if (typeof window.updatePerfStatsOverlay === 'undefined') window.updatePerfStatsOverlay = function(){};
  // Minimal measurements panel updater
  window.updateMeasurements = function(){
    try {
      var panel = document.getElementById('measurements'); if(!panel) return;
      var sel = window.selectedRoomId ? findObjectById(window.selectedRoomId) : null;
      if (!sel) { panel.classList.remove('visible'); return; }
      panel.classList.add('visible');
      // Populate fields
      function val(id, v){ var el=document.getElementById(id); if(el){ el.value = (v==null?'':v); } }
      function txt(id, v){ var el=document.getElementById(id); if(el){ el.textContent = (v==null?'--':v); } }
      val('input-name', sel.name||'');
      val('input-width', (sel.width||0).toFixed(2));
      val('input-depth', (sel.depth||0).toFixed(2));
      val('input-height', (sel.height||0).toFixed(2));
      val('input-pos-x', (sel.x||0).toFixed(2));
      val('input-pos-z', (sel.z||0).toFixed(2));
      txt('measure-floor', String(sel.level!=null? sel.level : (sel.type==='balcony'? 1 : 0)));
      // Wire save once
      var save = document.getElementById('save-measurements');
      if (save && !save.__wired){
        save.__wired = true;
        save.addEventListener('click', function(){
          try {
            var s = findObjectById(window.selectedRoomId); if(!s) return;
            var gv = function(id, def){ var el=document.getElementById(id); var v=parseFloat(el && el.value); return isFinite(v)? v : def; };
            s.name = (document.getElementById('input-name')||{}).value || s.name;
            s.width = Math.max(0.5, gv('input-width', s.width||1));
            s.depth = Math.max(0.5, gv('input-depth', s.depth||1));
            s.height = Math.max(0.5, gv('input-height', s.height||1));
            s.x = gv('input-pos-x', s.x||0); s.z = gv('input-pos-z', s.z||0);
            updateStatus('Saved measurements');
            if (typeof saveProjectSilently==='function') saveProjectSilently();
            if (typeof renderLoop==='function') renderLoop();
          } catch(e) { console.warn('Save measurements failed', e); }
        });
      }
    } catch(e) { /* non-fatal */ }
  };
  if (typeof window.updateStatus === 'undefined') window.updateStatus = function(msg){ try{ var s=document.getElementById('status'); if(s) s.textContent = msg; }catch(e){} };

  // ---- Entrypoints ----
  if (typeof window.startApp === 'undefined') {
    window.startApp = function(){
      try { updateStatus('startApp: init…'); } catch(_e) {}
      setupCanvas();
      try {
        var dims = (canvas ? (canvas.width + 'x' + canvas.height) : 'no-canvas');
        updateStatus('startApp: canvas ' + dims + ', ctx ' + (!!ctx));
      } catch(_e) {}
      try{ createInitialRoom(); }catch(e){}
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
    var id='stairs_'+Date.now(); var lvl=(typeof currentFloor==='number'? currentFloor:0);
    var w=1.2,d=3.0; var s=applySnap({x:camera.targetX,z:camera.targetZ,width:w,depth:d,level:lvl,type:'stairs'});
    stairsComponent={ id:id, name:'Stairs', x:s.x, z:s.z, width:w, depth:d, height:3.0, steps:12, type:'stairs', rotation:0, level:lvl };
    window.selectedRoomId = id; if(typeof updateStatus==='function') updateStatus('Added Stairs');
    try { focusCameraOnObject(stairsComponent); } catch(_e) {}
    _needsFullRender=true; startRender();
  };
  function newId(prefix){ return prefix+'_'+Date.now()+Math.random().toString(36).slice(2); }
  if (typeof window.addPergola === 'undefined') window.addPergola = function(){
    var lvl=0, w=3, d=3; var s=applySnap({x:camera.targetX,z:camera.targetZ,width:w,depth:d,level:lvl,type:'pergola'});
    var p={ id:newId('pergola'), name:'Pergola', x:s.x, z:s.z, width:w, depth:d, height:2.2, totalHeight:2.2, legWidth:0.25, slatCount:8, slatWidth:0.12, level:lvl, type:'pergola', rotation:0 };
    (window.pergolaComponents||[]).push(p); window.selectedRoomId=p.id; updateStatus('Added Pergola');
    try { focusCameraOnObject(p); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addGarage === 'undefined') window.addGarage = function(){
    var lvl=0, w=3.2, d=5.5; var s=applySnap({x:camera.targetX,z:camera.targetZ,width:w,depth:d,level:lvl,type:'garage'});
    var g={ id:newId('garage'), name:'Garage', x:s.x, z:s.z, width:w, depth:d, height:2.6, level:lvl, type:'garage', rotation:0 };
    (window.garageComponents||[]).push(g); window.selectedRoomId=g.id; updateStatus('Added Garage');
    try { focusCameraOnObject(g); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addPool === 'undefined') window.addPool = function(){
    var lvl=0, w=4, d=2; var s=applySnap({x:camera.targetX,z:camera.targetZ,width:w,depth:d,level:lvl,type:'pool'});
    var p={ id:newId('pool'), name:'Pool', x:s.x, z:s.z, width:w, depth:d, height:1.5, level:lvl, type:'pool', rotation:0 };
    (window.poolComponents||[]).push(p); window.selectedRoomId=p.id; updateStatus('Added Pool');
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
    (window.roofComponents||[]).push(r); window.selectedRoomId=r.id; updateStatus('Added Roof');
    try { focusCameraOnObject(r); } catch(_e) {}
    _needsFullRender=true; startRender(); };
  if (typeof window.addBalcony === 'undefined') window.addBalcony = function(){
    var lvl=1, w=2.5, d=1.5; var s=applySnap({x:camera.targetX,z:camera.targetZ,width:w,depth:d,level:lvl,type:'balcony'});
    var b={ id:newId('balcony'), name:'Balcony', x:s.x, z:s.z, width:w, depth:d, height:1.0, totalHeight:1.0, wallThickness:0.2, wallHeight:1.0, level:lvl, type:'balcony', rotation:0 };
    (window.balconyComponents||[]).push(b); window.selectedRoomId=b.id; updateStatus('Added Balcony');
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
          if (window.__bootPromise && typeof window.__bootPromise.then === 'function') {
            window.__bootPromise.then(function(){ bootStart(); });
          } else if (window.__requireBoot) {
            // Explicit gating: wait for boot-ready event
            window.addEventListener('gablok:boot-ready', function(){ bootStart(); }, { once:true });
          } else {
            // No gating configured -> start immediately
            bootStart();
          }
        } catch(e) { console.error('startApp failed:', e); }
      });
    }
  } catch(e) {}
})();
