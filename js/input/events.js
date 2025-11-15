// Input and interaction events extracted from app.js to slim the orchestrator
// Exposes window.setupEvents(), called by startApp() in engine3d.js
(function(){
  if (typeof window.setupEvents === 'function') return;
  // Round-trip action tracing helper (persisted like other traces)
  function __rtActionPush(evt){
    try {
      // Lazy-load persisted buffer
      if (!window.__roundTripTraceLoaded) {
        try { var raw = localStorage.getItem('gablok_rtTrace_v1'); if (raw){ var arr = JSON.parse(raw); if (Array.isArray(arr)) window.__roundTripTrace = arr.slice(-300); } } catch(_lp){}
        window.__roundTripTraceLoaded = true;
      }
      var buf = window.__roundTripTrace || (window.__roundTripTrace = []);
      var MAX = 300; buf.push(Object.assign({ t: Date.now(), source: 'action' }, evt||{})); if (buf.length>MAX) buf.splice(0, buf.length-MAX);
      // Throttled persist
      var now = Date.now(); if (!window.__rtTraceLastSave || now - window.__rtTraceLastSave > 1500){ try { localStorage.setItem('gablok_rtTrace_v1', JSON.stringify(buf)); window.__rtTraceLastSave = now; } catch(_ps){} }
    } catch(_e){}
  }
  // Expose globally so other modules (2D editor, core) can log actions
  try { if (typeof window.__rtActionPush !== 'function') window.__rtActionPush = __rtActionPush; } catch(_exp){}
  // Optional tracing for 3D keys/selection: ?trace3d=1 (or reuse ?trace2d=1) or localStorage 'gablok_trace3d'=1
  (function(){
    function qs(name){ try { var m = String(location.search||'').match(new RegExp('[?&]'+name+'=([^&]+)')); return m ? decodeURIComponent(m[1]) : null; } catch(_) { return null; } }
    try {
      if (typeof window.__trace3d === 'undefined'){
        var q3 = qs('trace3d'); var q2 = qs('trace2d');
        var ls3=null; try { ls3 = localStorage.getItem('gablok_trace3d'); } catch(_ls){}
        window.__trace3d = !!( (q3 && q3!=='0' && q3!=='false') || (q2 && q2!=='0' && q2!=='false') || (ls3 && ls3!=='0' && ls3!=='false') );
      }
      if (!window.__log3d){ window.__log3d = function(){ try { if(!window.__trace3d) return; var a=["[3D]"]; for(var i=0;i<arguments.length;i++) a.push(arguments[i]); console.log.apply(console, a); } catch(_e){} }; }
    } catch(_e){}
  })();
  // Throttled live rebuild for solid wall strips so rendered walls follow during drags/resizes
  function __maybeRebuildRoomStripsThrottled(){
    try {
      if (window.__wallRenderMode !== 'solid') return;
      if (typeof window.rebuildRoomPerimeterStrips !== 'function') return;
      // Coalesce multiple calls per frame and avoid re-entrancy
      if (window.__pendingStripRebuild) return;
      window.__pendingStripRebuild = true;
      var t = (typeof window.__roomWallThickness === 'number' && window.__roomWallThickness > 0) ? window.__roomWallThickness : 0.3;
      requestAnimationFrame(function(){
        try {
          // Clear last-snap map so exterior corners recompute cleanly for the new pose
          try { if (window.__extCornerSnap) window.__extCornerSnap = {}; } catch(_eSnap) {}
          if (window.__rebuildingStrips) return; // if a rebuild is in progress, skip this frame
          window.__rebuildingStrips = true;
          window.rebuildRoomPerimeterStrips(t);
        } catch(_eRR) { /* non-fatal */ }
        finally {
          window.__rebuildingStrips = false;
          window.__pendingStripRebuild = false;
          // Record last time for telemetry
          try { window.__lastStripRebuildAt = (performance && performance.now) ? performance.now() : Date.now(); } catch(_t) {}
        }
      });
    } catch(_eRR2) { /* non-fatal */ }
  }
  // Expose for other modules (labels.js) to trigger an immediate rebuild at drag start
  try { if (!window.__maybeRebuildRoomStripsThrottled) window.__maybeRebuildRoomStripsThrottled = __maybeRebuildRoomStripsThrottled; } catch(_eExpose) {}
  // Live-update 2D plan walls for a given 3D room so 2D and 3D move together during drag/resize.
  function updatePlan2DWallsForRoom(room){
    try {
      if (!room || !window.__plan2d || !Array.isArray(__plan2d.elements)) return;
      var gid = 'room:' + room.id;
      // Collect all 2D walls that belong to this room
      var indices = [];
      for (var i=0;i<__plan2d.elements.length;i++){
        var el = __plan2d.elements[i];
        if (!el || el.type !== 'wall') continue;
        if (el.groupId === gid) indices.push(i);
      }
      if (indices.length < 4) return; // no grouped walls to update

      var sgn = (__plan2d.yFromWorldZSign || 1);
      var cx = (typeof __plan2d.centerX==='number'? __plan2d.centerX : 0);
      var cz = (typeof __plan2d.centerZ==='number'? __plan2d.centerZ : 0);
      var hw = (room.width||0)/2, hd = (room.depth||0)/2;
      var rot = ((room.rotation||0) * Math.PI)/180;
      function rotPt(px,pz){ var dx=px-(room.x||0), dz=pz-(room.z||0); return { x: (room.x||0) + dx*Math.cos(rot) - dz*Math.sin(rot), z: (room.z||0) + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
      // World-space corners in consistent order (ccw): c1(-x,-z), c2(+x,-z), c3(+x,+z), c4(-x,+z)
      var c1=rotPt((room.x||0)-hw, (room.z||0)-hd);
      var c2=rotPt((room.x||0)+hw, (room.z||0)-hd);
      var c3=rotPt((room.x||0)+hw, (room.z||0)+hd);
      var c4=rotPt((room.x||0)-hw, (room.z||0)+hd);
      function toPlan(p){ return { x: (p.x - cx), y: sgn * (p.z - cz) }; }
      var p1=toPlan(c1), p2=toPlan(c2), p3=toPlan(c3), p4=toPlan(c4);
      var segs=[ {a:p1,b:p2}, {a:p2,b:p3}, {a:p3,b:p4}, {a:p4,b:p1} ];
      function mid(ptA, ptB){ return { x: (ptA.x+ptB.x)/2, y: (ptA.y+ptB.y)/2 }; }
      function dist2(a,b){ var dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; }
      // Build list of current walls (midpoints) and desired segments (midpoints), then greedy match
      var walls = indices.map(function(idx){ var e=__plan2d.elements[idx]; return { idx: idx, mid: mid({x:e.x0,y:e.y0},{x:e.x1,y:e.y1}) }; });
      var desired = segs.map(function(sg){ return { seg: sg, mid: mid(sg.a, sg.b), taken:false }; });
      for (var w=0; w<walls.length; w++){
        var bestJ=-1, bestD=Infinity;
        for (var j=0;j<desired.length;j++){
          if (desired[j].taken) continue; var d = dist2(walls[w].mid, desired[j].mid); if (d < bestD){ bestD=d; bestJ=j; }
        }
        if (bestJ>=0){
          desired[bestJ].taken = true;
          var el2 = __plan2d.elements[walls[w].idx]; var sg2 = desired[bestJ].seg;
          el2.x0 = sg2.a.x; el2.y0 = sg2.a.y; el2.x1 = sg2.b.x; el2.y1 = sg2.b.y;
        }
      }
      // Redraw 2D if active
      if (__plan2d.active && typeof window.plan2dDraw==='function') window.plan2dDraw();
      // While updating 2D live, also keep solid wall strips in sync when Render mode is active
      __maybeRebuildRoomStripsThrottled();
    } catch(_eU) { /* non-fatal live 2D update */ }
  }
  window.__updatePlan2DWallsForRoom = updatePlan2DWallsForRoom;
  window.setupEvents = function setupEvents() {
    window.addEventListener('resize', setupCanvas);
    // Track UI interactions so we can fade affordances when idle
    try {
      // Prevent default context menu so right-drag can orbit the camera
      canvas.addEventListener('contextmenu', function(e){ e.preventDefault(); });
      canvas.addEventListener('mousemove', function(e){
        _uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now();
        // Track hovered object for focus mode
        try {
          var rect = canvas.getBoundingClientRect();
          var mx = e.clientX - rect.left, my = e.clientY - rect.top;
          var dpr = window.devicePixelRatio || 1; var sx = mx * dpr, sy = my * dpr;
          var bestId = null, bestD = Infinity;
          function consider(obj){
            if(!obj) return; var yMid=0; try{
              if (obj.type === 'roof') { var bY=(typeof obj.baseHeight==='number'?obj.baseHeight:3.0), h=(typeof obj.height==='number'?obj.height:0.6); yMid=bY+h*0.5; }
              else if (obj.type === 'pergola') { yMid = (obj.totalHeight!=null ? obj.totalHeight*0.5 : (obj.height||2.2)*0.5); }
              else if (obj.type === 'pool') { yMid = 0.2; }
              else if (obj.type === 'furniture') { var lv=(obj.level||0)*3.5; yMid = lv + Math.max(0, obj.elevation||0) + (obj.height||0.7)/2; }
              else { yMid = (obj.level||0)*3.5 + (obj.height||3)/2; }
            }catch(_e){ yMid = (obj.level||0)*3.5 + 1.5; }
            var p = project3D(obj.x||0, yMid, obj.z||0); if(!p) return;
            var dx = p.x - sx, dy = p.y - sy; var d2 = dx*dx + dy*dy;
            if (d2 < bestD) { bestD = d2; bestId = obj.id; }
          }
          // Prefer current floor items by considering them first
          for (var i=0;i<(allRooms||[]).length;i++){ if((allRooms[i].level||0)===(currentFloor||0)) consider(allRooms[i]); }
          // Stairs: consider all on current floor (multi-support)
          try { var scArr0 = window.stairsComponents || []; if (Array.isArray(scArr0)) { for (var si0=0; si0<scArr0.length; si0++){ var so0=scArr0[si0]; if(!so0) continue; if((so0.level||0)===(currentFloor||0)) consider(so0); } } else if (stairsComponent && (stairsComponent.level||0)===(currentFloor||0)) consider(stairsComponent); } catch(_s0){}
          ['pergolaComponents','garageComponents','poolComponents','roofComponents','balconyComponents','furnitureItems'].forEach(function(k){ var arr=window[k]||[]; for(var i=0;i<arr.length;i++){ var o=arr[i]; if(!o) continue; if((o.level||0)===(currentFloor||0)) consider(o); }});
          // If nothing on current floor, consider all
          if (!bestId){
            (allRooms||[]).forEach(consider);
            try { var scArr1 = window.stairsComponents || []; if (Array.isArray(scArr1) && scArr1.length){ for (var si1=0; si1<scArr1.length; si1++){ consider(scArr1[si1]); } } else if (stairsComponent) { consider(stairsComponent); } } catch(_s1){}
            ['pergolaComponents','garageComponents','poolComponents','roofComponents','balconyComponents','furnitureItems'].forEach(function(k){ var arr=window[k]||[]; for(var i=0;i<arr.length;i++) consider(arr[i]); });
          }
          var thresh = 180*180; // px^2
          if (bestId && bestD <= thresh) { if (window.__hoverRoomId !== bestId){ window.__hoverRoomId = bestId; renderLoop(); } }
          else if (window.__hoverRoomId) { window.__hoverRoomId = null; renderLoop(); }
        } catch(_e) {}
      });
      canvas.addEventListener('mousedown', function(){ _uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now(); });
      canvas.addEventListener('wheel', function(){
        _uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now();
        try { var nowT = (performance && performance.now)? performance.now(): Date.now(); var tgt = window.__hoverRoomId || selectedRoomId || null; if (tgt){ window.__focusRoomId = tgt; window.__focusUntilTime = nowT + 1800; renderLoop(); } } catch(_e) {}
      }, { passive: true });
      canvas.addEventListener('touchstart', function(){ _uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now(); }, { passive: true });
    } catch (e) { /* canvas may not be ready in some init paths */ }
    
    canvas.addEventListener('mousedown', function(e) {
      var rect = canvas.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;
      var mouseY = e.clientY - rect.top;
        // Ensure canvas can receive keyboard events for 3D shortcuts after any interaction
        try { if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex','0'); canvas.focus({preventScroll:true}); } catch(_cfocus){}
      // Right mouse button: always orbit camera (do not start selection/drag)
      if (e.button === 2) {
        mouse.down = true;
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
        mouse.dragType = 'camera';
        canvas.style.cursor = 'grabbing';
        updateStatus('Orbit');
        return;
      }
      
      var handle = findHandle(mouseX, mouseY);
      if (handle) {
        var target = findObjectById(handle.roomId);
        if (target) {
          if (handle.type === 'rotate') {
            var rotationAngle = (target.type === 'garage' || target.type === 'pool') ? 90 : 22.5;
            target.rotation = ((target.rotation || 0) + rotationAngle) % 360;
            renderLoop();
            updateStatus(target.name + ' rotated ' + rotationAngle + '°');
            return;
          }
          // Fix: Set dragType to 'handle' for room handles so drag logic resizes the room
          mouse.dragType = 'handle';
          mouse.dragInfo = {
            handle: handle,
            startX: e.clientX,
            startY: e.clientY,
            originalWidth: target.width,
            originalDepth: target.depth,
            originalRoomX: target.x,
            originalRoomZ: target.z,
            oldWidth: target.width,  // for opening scaling
            oldDepth: target.depth,  // for opening scaling
            roomId: handle.roomId,   // for 2D sync on mouseup
            // Store side axis and sign so we know which face is being dragged
            sideAxis: (handle.type.indexOf('width') === 0 ? 'x' : (handle.type.indexOf('depth') === 0 ? 'z' : null)),
            sideSign: (handle.type.endsWith('+') ? 1 : (handle.type.endsWith('-') ? -1 : 0))
          };
          // Capture old perimeter edges and bounding box before move/resize for stale-strip purge on mouseup
          try {
            function collectEdgesFor(room){
              var out = [];
              function normKey(x0,z0,x1,z1){ var a = x0.toFixed(3)+','+z0.toFixed(3); var b = x1.toFixed(3)+','+z1.toFixed(3); return (a<b? a+'|'+b : b+'|'+a); }
              if (Array.isArray(room.footprint) && room.footprint.length >= 2){
                for (var i=0;i<room.footprint.length;i++){
                  var A=room.footprint[i], B=room.footprint[(i+1)%room.footprint.length]; if(!A||!B) continue;
                  out.push(normKey(A.x||0,A.z||0,B.x||0,B.z||0));
                }
              } else {
                var hw=(room.width||0)/2, hd=(room.depth||0)/2;
                var xL=(room.x||0)-hw, xR=(room.x||0)+hw, zT=(room.z||0)-hd, zB=(room.z||0)+hd;
                var edges=[[xL,zT,xR,zT],[xR,zT,xR,zB],[xR,zB,xL,zB],[xL,zB,xL,zT]];
                for (var eIdx=0;eIdx<edges.length;eIdx++){ var E=edges[eIdx]; out.push(normKey(E[0],E[1],E[2],E[3])); }
              }
              return out;
            }
            mouse.dragInfo.oldPerimeterKeys = collectEdgesFor(target);
            mouse.dragInfo.level = target.level||0;
            // Bounding box for coarse purge
            var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
            if (Array.isArray(target.footprint) && target.footprint.length){
              for (var fpI=0; fpI<target.footprint.length; fpI++){ var p=target.footprint[fpI]; if(!p) continue; if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.z<minZ)minZ=p.z; if(p.z>maxZ)maxZ=p.z; }
            } else {
              var hwB=(target.width||0)/2, hdB=(target.depth||0)/2; minX=(target.x||0)-hwB; maxX=(target.x||0)+hwB; minZ=(target.z||0)-hdB; maxZ=(target.z||0)+hdB;
            }
            mouse.dragInfo.oldBox = { minX:minX, maxX:maxX, minZ:minZ, maxZ:maxZ, centerX:(target.x||0), centerZ:(target.z||0) };
          } catch(_capOldHandle) {}
          
          // Set global flag to prevent 2D->3D auto-apply during 3D drag
          window.__dragging3DRoom = true;
          // Track which room is actively dragged for targeted purge in solid rebuilds
          try { window.__activelyDraggedRoomId = target.id; } catch(_ad) {}
          console.log('🟢 START 3D DRAG - Flag set:', window.__dragging3DRoom, 'Room:', target.name || target.id);
          try { __rtActionPush({ kind:'3d-drag-start', id: target.id, type: target.type||'room', name: target.name||null, handle: handle.type }); } catch(_trS){}
          
          // Capture original opening positions for rectangular rooms (before poly check)
          var rectOpenSnap = [];
          if (Array.isArray(target.openings) && target.openings.length > 0) {
            for (var roi=0; roi<target.openings.length; roi++) {
              var rop = target.openings[roi]; if (!rop) continue;
              if (typeof rop.x0 === 'number' && typeof rop.z0 === 'number' && typeof rop.x1 === 'number' && typeof rop.z1 === 'number') {
                rectOpenSnap.push({ idx: roi, x0: rop.x0, z0: rop.z0, x1: rop.x1, z1: rop.z1, type: rop.type, sillM: rop.sillM, heightM: rop.heightM, meta: rop.meta, edge: rop.edge });
              }
            }
          }
          if (rectOpenSnap.length > 0) {
            mouse.dragInfo.rectOpenings = rectOpenSnap;
          }
          
          // If this is a polygonal room (has a footprint), capture the original footprint
          // and its bounding box so we can rescale it consistently during the drag.
          try {
            if (Array.isArray(target.footprint) && target.footprint.length >= 3) {
              var fp = target.footprint;
              var bxMin = Infinity, bxMax = -Infinity, bzMin = Infinity, bzMax = -Infinity;
              for (var fi=0; fi<fp.length; fi++) {
                var pt = fp[fi]; if (!pt) continue;
                if (pt.x < bxMin) bxMin = pt.x; if (pt.x > bxMax) bxMax = pt.x;
                if (pt.z < bzMin) bzMin = pt.z; if (pt.z > bzMax) bzMax = pt.z;
              }
              var openSnap = [];
              if (Array.isArray(target.openings)) {
                for (var oi=0; oi<target.openings.length; oi++) {
                  var op = target.openings[oi]; if (!op) continue;
                  // Only store world-endpoint anchored openings for polygon rooms
                  if (typeof op.x0 === 'number' && typeof op.z0 === 'number' && typeof op.x1 === 'number' && typeof op.z1 === 'number') {
                    openSnap.push({ idx: oi, x0: op.x0, z0: op.z0, x1: op.x1, z1: op.z1, type: op.type, sillM: op.sillM, heightM: op.heightM, meta: op.meta });
                  }
                }
              }
              mouse.dragInfo.poly = {
                origFootprint: fp.map(function(p){ return { x: p.x, z: p.z }; }),
                box: { minX: bxMin, maxX: bxMax, minZ: bzMin, maxZ: bzMax },
                openings: openSnap
              };
            }
          } catch(_polyCapErr) {}
          mouse.down = true;
          if (typeof window.selectObject==='function') {
            window.selectObject(handle.roomId, { noRender: true });
          } else {
            selectedRoomId = handle.roomId;
            try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
          }
          canvas.style.cursor = 'grabbing';
          updateStatus('Resizing...');

          // Compute start positions for dragged face and opposite face in world space
          try {
            var rotRadS = ((target.rotation || 0) * Math.PI) / 180;
            var axisXxS = Math.cos(rotRadS), axisXzS = Math.sin(rotRadS);
            var axisZxS = -Math.sin(rotRadS), axisZzS = Math.cos(rotRadS);
            var sSign = mouse.dragInfo.sideSign;
            if (mouse.dragInfo.sideAxis === 'x') {
              var halfW0 = target.width / 2;
              var fx = target.x + sSign * halfW0 * axisXxS;
              var fz = target.z + sSign * halfW0 * axisXzS;
              var ox = target.x - sSign * halfW0 * axisXxS;
              var oz = target.z - sSign * halfW0 * axisXzS;
              mouse.dragInfo.faceDraggedStart = { x: fx, z: fz };
              mouse.dragInfo.faceOppStart = { x: ox, z: oz };
            } else if (mouse.dragInfo.sideAxis === 'z') {
              var halfD0 = target.depth / 2;
              var fxz = target.x + sSign * halfD0 * axisZxS;
              var fzz = target.z + sSign * halfD0 * axisZzS;
              var oxz = target.x - sSign * halfD0 * axisZxS;
              var ozz = target.z - sSign * halfD0 * axisZzS;
              mouse.dragInfo.faceDraggedStart = { x: fxz, z: fzz };
              mouse.dragInfo.faceOppStart = { x: oxz, z: ozz };
            }
          } catch (err) {
            console.warn('Face start compute failed:', err);
          }
          return;
        } else if (handle.type === 'wall-move' && typeof handle.wallIndex === 'number') {
          // Begin dragging a freestanding wall strip
          var w = (window.wallStrips && window.wallStrips[handle.wallIndex]) ? window.wallStrips[handle.wallIndex] : null;
          if (w) {
            mouse.dragType = 'wall-strip';
            mouse.dragInfo = {
              wallIndex: handle.wallIndex,
              startX: e.clientX,
              startY: e.clientY,
              originalX0: w.x0, originalZ0: w.z0,
              originalX1: w.x1, originalZ1: w.z1,
              level: w.level||0
            };
            window.selectedWallStripIndex = handle.wallIndex;
            if (typeof window.selectObject==='function') window.selectObject(null, { noRender:true });
            updateStatus('Moving wall...');
            mouse.down = true;
            canvas.style.cursor = 'grabbing';
            renderLoop();
            return;
          }
        }
      }
      
      // If not resizing a handle, try selecting a wall strip on current floor
      var hitIdx = hitTestWallStrips(mouseX, mouseY);
      if (hitIdx !== -1) {
        selectedWallStripIndex = hitIdx;
        // Clear object selection via unified helper so the measurements panel reflects wall mode instantly
        if (typeof window.selectObject === 'function') { window.selectObject(null, { noRender: true }); }
        else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMw) {} }
        // Ensure measurements panel is visible for wall edits, too
        try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
        // Ensure keyboard events (Delete) reach us
        try { if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex','0'); canvas.focus({preventScroll:true}); } catch(_e) {}
        mouse.down = false; mouse.dragType = null; mouse.dragInfo = null;
        updateStatus('Wall selected');
        try { var wSel = (window.wallStrips && window.wallStrips[hitIdx]) ? window.wallStrips[hitIdx] : null; __rtActionPush({ kind:'wall-strip-select', index: hitIdx, level: (wSel&&wSel.level)||0, from:'3d' }); } catch(_ts){}
        renderLoop();
        return;
      }

      // If not on a handle or wall strip, attempt direct object hit test so components (pergola, garage, roof, pool, balcony, stairs, furniture)
      // can be selected and dragged without relying on the DOM label. This restores expected interaction parity.
      // Hit test strategy: project object center and four footprint corners, build a convex quad in screen space, then
      // check if mouse point lies inside (fallback: circle distance to center). Prefer nearest object within threshold.
      function hitTestObjects(mxCss, myCss){
        try {
          var dpr = window.devicePixelRatio || 1; var mx = mxCss * dpr, my = myCss * dpr;
          var candidates = [];
          function consider(o){ if(!o) return; if (o.width==null || o.depth==null) return; candidates.push(o); }
          (allRooms||[]).forEach(consider);
          try { var scA = window.stairsComponents||[]; if(Array.isArray(scA) && scA.length) scA.forEach(consider); else if (stairsComponent) consider(stairsComponent); } catch(_sht){}
          ['pergolaComponents','garageComponents','poolComponents','roofComponents','balconyComponents','furnitureItems'].forEach(function(k){ var arr=window[k]||[]; if(Array.isArray(arr)) arr.forEach(consider); });
          var best=null, bestScore=Infinity;
          for (var i=0;i<candidates.length;i++){
            var o=candidates[i];
            // Center Y from shared helper
            var yMid = (typeof window.getObjectCenterY==='function') ? window.getObjectCenterY(o) : ((o.level||0)*3.5 + (o.height||3)/2);
            var rot=((o.rotation||0)*Math.PI)/180;
            var hw=(o.width||0)/2, hd=(o.depth||0)/2;
            function corner(lx,lz){ var dx=lx, dz=lz; return { x:(o.x||0)+dx*Math.cos(rot)-dz*Math.sin(rot), z:(o.z||0)+dx*Math.sin(rot)+dz*Math.cos(rot) }; }
            var c = project3D(o.x||0, yMid, o.z||0); if(!c) continue;
            var p1=project3D(corner(-hw,-hd).x, yMid, corner(-hw,-hd).z);
            var p2=project3D(corner(hw,-hd).x, yMid, corner(hw,-hd).z);
            var p3=project3D(corner(hw,hd).x, yMid, corner(hw,hd).z);
            var p4=project3D(corner(-hw,hd).x, yMid, corner(-hw,hd).z);
            if (!(p1&&p2&&p3&&p4)) continue;
            // Point-in-quad via barycentric subdivision (two triangles)
            function ptInTri(pt,a,b,c){ var v0x=c.x-a.x,v0y=c.y-a.y,v1x=b.x-a.x,v1y=b.y-a.y,v2x=pt.x-a.x,v2y=pt.y-a.y; var den=v0x*v1y - v1x*v0y; if(Math.abs(den)<1e-6) return false; var u=(v2x*v1y - v1x*v2y)/den; var v=(v0x*v2y - v2x*v0y)/den; return (u>=0&&v>=0&&(u+v)<=1); }
            var inside = ptInTri({x:mx,y:my}, p1,p2,p3) || ptInTri({x:mx,y:my}, p1,p3,p4);
            if (!inside){
              var dx=c.x-mx, dy=c.y-my; var dist2=dx*dx+dy*dy; var rad=(Math.max(p1.x,p2.x,p3.x,p4.x)-Math.min(p1.x,p2.x,p3.x,p4.x))*0.5; // rough footprint size in screen px
              if (dist2 > (rad*rad)) continue; // outside loose circle
              // keep but apply penalty factor so true hits rank earlier
            }
            var areaApprox = Math.abs((p2.x-p1.x)*(p3.y-p1.y) - (p2.y-p1.y)*(p3.x-p1.x));
            var dxC=c.x-mx, dyC=c.y-my; var score = dxC*dxC+dyC*dyC + areaApprox*0.0005; // favor nearer + smaller footprint
            if (score < bestScore){ bestScore=score; best=o; }
          }
          return best;
        } catch(_eHT){ return null; }
      }

      var hitObj = hitTestObjects(mouseX, mouseY);
      if (hitObj){
        // Select object; require handle drag for ALL object types (standardized)
        if (typeof window.selectObject==='function') window.selectObject(hitObj.id, { noRender: true }); else { selectedRoomId = hitObj.id; }
        // Focus canvas so Delete / arrows work immediately after selection
        try { if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex','0'); canvas.focus({preventScroll:true}); } catch(_cfocus2){}
        updateStatus((hitObj.name||hitObj.type||'Item') + ' selected');
        renderLoop();
        // Do not return: allow left-drag after selection to orbit the camera
      }

      mouse.down = true;
      mouse.lastX = e.clientX;
      mouse.lastY = e.clientY;
      mouse.dragType = 'camera';
      canvas.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', function(e) {
      resizeHandles = [];

      if ((mouse.dragType === 'room' || mouse.dragType === 'balcony') && mouse.dragInfo) {
        var object = findObjectById(mouse.dragInfo.roomId);
        if (object) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var movement = worldMovement(dx, dy);
          var newX = mouse.dragInfo.originalX + movement.x;
          var newZ = mouse.dragInfo.originalZ + movement.z;
          var snap = applySnap({
            x: newX, 
            z: newZ, 
            width: object.width, 
            depth: object.depth, 
            level: object.level, 
            id: object.id,
            type: object.type
          });
          
          // Calculate delta movement for this frame
          var deltaX = snap.x - object.x;
          var deltaZ = snap.z - object.z;

          // If this is a polygonal room (has a footprint), translate its footprint so solids follow live
          try {
            if (Array.isArray(object.footprint) && object.footprint.length > 0 && (deltaX !== 0 || deltaZ !== 0)) {
              for (var fpi = 0; fpi < object.footprint.length; fpi++) {
                var pt = object.footprint[fpi]; if (!pt) continue;
                // Mutate in place so rebuildRoomPerimeterStrips reads updated world coords
                pt.x = (pt.x||0) + deltaX;
                pt.z = (pt.z||0) + deltaZ;
              }
            }
          } catch(_fpMove) { /* non-fatal */ }
          
          // Move openings (doors/windows) with the room
          if (Array.isArray(object.openings) && object.openings.length > 0 && (deltaX !== 0 || deltaZ !== 0)) {
            for (var oi = 0; oi < object.openings.length; oi++) {
              var op = object.openings[oi];
              if (!op || typeof op.x0 !== 'number') continue;
              op.x0 += deltaX;
              op.z0 += deltaZ;
              op.x1 += deltaX;
              op.z1 += deltaZ;
              op.__manuallyPositioned = true;
            }
          }
          
          object.x = snap.x;
          object.z = snap.z;
          currentSnapGuides = snap.guides;
          updateStatus('Moving ' + object.name + '...');
          // Live-update 2D grouped walls to follow the 3D room during drag (no ghosts, no duplication)
          try { updatePlan2DWallsForRoom(object); } catch(_g) {}
          // And keep solid wall strips following the move during Render mode
          __maybeRebuildRoomStripsThrottled();
        }
      } else if (mouse.dragType === 'stairs' && mouse.dragInfo) {
        var stairsObj = findObjectById && mouse.dragInfo && mouse.dragInfo.roomId ? findObjectById(mouse.dragInfo.roomId) : (window.stairsComponent||null);
        if (stairsObj) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var movement = worldMovement(dx, dy);
          var newX = mouse.dragInfo.originalX + movement.x;
          var newZ = mouse.dragInfo.originalZ + movement.z;
          var snap = applySnap({x: newX, z: newZ, width: stairsObj.width, depth: stairsObj.depth, level: stairsObj.level, id: stairsObj.id, type: 'stairs'});
          stairsObj.x = snap.x;
          stairsObj.z = snap.z;
          currentSnapGuides = snap.guides;
          updateStatus('Moving ' + (stairsObj.name||'Stairs') + '...');
        }
      } else if (mouse.dragType === 'pergola' && mouse.dragInfo) {
        var pergola = findObjectById(mouse.dragInfo.roomId);
        if (pergola) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var movement = worldMovement(dx, dy);
          var newX = mouse.dragInfo.originalX + movement.x;
          var newZ = mouse.dragInfo.originalZ + movement.z;
          var snap = applySnap({x: newX, z: newZ, width: pergola.width, depth: pergola.depth, level: pergola.level, id: pergola.id, type: 'pergola'});
          pergola.x = snap.x;
          pergola.z = snap.z;
          currentSnapGuides = snap.guides;
          updateStatus('Moving ' + pergola.name + '...');
        }
      } else if (mouse.dragType === 'garage' && mouse.dragInfo) {
        var garage = findObjectById(mouse.dragInfo.roomId);
        if (garage) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var movement = worldMovement(dx, dy);
          var newX = mouse.dragInfo.originalX + movement.x;
          var newZ = mouse.dragInfo.originalZ + movement.z;
          var snap = applySnap({x: newX, z: newZ, width: garage.width, depth: garage.depth, level: garage.level, id: garage.id, type: 'garage'});
          garage.x = snap.x;
          garage.z = snap.z;
          currentSnapGuides = snap.guides;
          updateStatus('Moving ' + garage.name + '...');
          // Keep solid room/garage wall strips in sync while dragging in Render mode
          __maybeRebuildRoomStripsThrottled();
        }
      } else if (mouse.dragType === 'pool' && mouse.dragInfo) {
        var pool = findObjectById(mouse.dragInfo.roomId);
        if (pool) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var movement = worldMovement(dx, dy);
          var newX = mouse.dragInfo.originalX + movement.x;
          var newZ = mouse.dragInfo.originalZ + movement.z;
          var snap = applySnap({x: newX, z: newZ, width: pool.width, depth: pool.depth, level: pool.level, id: pool.id, type: 'pool'});
          pool.x = snap.x;
          pool.z = snap.z;
          currentSnapGuides = snap.guides;
          updateStatus('Moving ' + pool.name + '...');
        }
      } else if (mouse.dragType === 'roof' && mouse.dragInfo) {
        var roof = findObjectById(mouse.dragInfo.roomId);
        if (roof) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var movement = worldMovement(dx, dy);
          var newX = mouse.dragInfo.originalX + movement.x;
          var newZ = mouse.dragInfo.originalZ + movement.z;
          var snap = applySnap({x: newX, z: newZ, width: roof.width, depth: roof.depth, level: roof.level, id: roof.id, type: 'roof'});
          roof.x = snap.x;
          roof.z = snap.z;
          // User moved the roof manually: disable autoFit so it doesn't snap back
          roof.autoFit = false;
          currentSnapGuides = snap.guides;
          updateStatus('Moving ' + roof.name + '...');
        }
      } else if (mouse.dragType === 'furniture' && mouse.dragInfo) {
        var furn = findObjectById(mouse.dragInfo.roomId);
        if (furn) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var movement = worldMovement(dx, dy);
          var newX = mouse.dragInfo.originalX + movement.x;
          var newZ = mouse.dragInfo.originalZ + movement.z;
          var snap = applySnap({x: newX, z: newZ, width: furn.width, depth: furn.depth, level: furn.level, id: furn.id, type: 'furniture'});
          furn.x = snap.x;
          furn.z = snap.z;
          currentSnapGuides = snap.guides;
          updateStatus('Moving ' + (furn.name || 'Item') + '...');
        }
      } else if (mouse.dragType === 'handle' && mouse.dragInfo && mouse.dragInfo.handle) {
        var target = findObjectById(mouse.dragInfo.roomId);
        if (target) {
          // Move handle: translate the room's center (restrict dragging to handles only)
          if (mouse.dragInfo.handle.type === 'move') {
            var dxM = e.clientX - mouse.dragInfo.startX;
            var dyM = e.clientY - mouse.dragInfo.startY;
            var mvM = worldMovement(dxM, dyM);
            var newXM = mouse.dragInfo.originalRoomX + mvM.x;
            var newZM = mouse.dragInfo.originalRoomZ + mvM.z;
            var snapM = applySnap({ x: newXM, z: newZM, width: target.width, depth: target.depth, level: target.level, id: target.id, type: target.type });
            var deltaXM = snapM.x - target.x;
            var deltaZM = snapM.z - target.z;
            // Translate polygon footprint if present
            try {
              if (Array.isArray(target.footprint) && target.footprint.length > 0 && (deltaXM !== 0 || deltaZM !== 0)) {
                for (var ti=0; ti<target.footprint.length; ti++){
                  var ptM = target.footprint[ti]; if(!ptM) continue; ptM.x = (ptM.x||0) + deltaXM; ptM.z = (ptM.z||0) + deltaZM;
                }
              }
            } catch(_mvFp) {}
            // Move openings
            if (Array.isArray(target.openings) && target.openings.length > 0 && (deltaXM !== 0 || deltaZM !== 0)) {
              for (var oiM=0; oiM<target.openings.length; oiM++){
                var opM = target.openings[oiM]; if(!opM || typeof opM.x0 !== 'number') continue;
                opM.x0 += deltaXM; opM.z0 += deltaZM; opM.x1 += deltaXM; opM.z1 += deltaZM; opM.__manuallyPositioned = true;
              }
            }
            target.x = snapM.x; target.z = snapM.z; currentSnapGuides = snapM.guides;
            updateStatus('Moving ' + (target.name||'Room') + '...');
            try { updatePlan2DWallsForRoom(target); } catch(_upd2dM) {}
            __maybeRebuildRoomStripsThrottled();
            renderLoop();
            return;
          }
          // Rotation handle
          if (mouse.dragInfo.handle.type === 'rotate') {
            if (typeof target.rotation !== 'number') target.rotation = 0;
            var step = target.type === 'garage' ? 90 : 22.5;
            target.rotation = (target.rotation + step) % 360;
            renderLoop();
            try { updatePlan2DWallsForRoom(target); } catch(_rotU) {}
            __maybeRebuildRoomStripsThrottled();
            updateStatus(target.name + ' rotated ' + step + '°');
            return;
          }

          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var move = worldMovement(dx, dy);
          var rotRad = ((target.rotation || 0) * Math.PI) / 180;

          // Local axes
          var axisXx = Math.cos(rotRad), axisXz = Math.sin(rotRad);       // local +X
          var axisZx = -Math.sin(rotRad), axisZz = Math.cos(rotRad);      // local +Z

          var type = mouse.dragInfo.handle.type;
          var sizeDelta = 0;

          // Helpers
          function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

          // Defaults per type
          var minSize = (target.type === 'roof' || target.type === 'stairs') ? 1 : 0.5;
          var maxSize = 40;

          if (type === 'width+' || type === 'width-') {
            // Measure along dragged face normal (sX * axisX) so outward drag always increases
            var sX = mouse.dragInfo.sideSign || (type === 'width+' ? 1 : -1);
            var proj = move.x * axisXx + move.z * axisXz; // motion along +X

            // New dragged face position
            var fx = mouse.dragInfo.faceDraggedStart.x + proj * axisXx;
            var fz = mouse.dragInfo.faceDraggedStart.z + proj * axisXz;
            var vx = fx - mouse.dragInfo.faceOppStart.x;
            var vz = fz - mouse.dragInfo.faceOppStart.z;
            var along = vx * (sX * axisXx) + vz * (sX * axisXz); // distance along dragged face normal
            var newW = clamp(Math.max(minSize, Math.min(maxSize, along)), minSize, maxSize);
            // Snap width to nearest GRID_SPACING when within HANDLE_SNAP_TOLERANCE
            var snappedW = Math.round(newW / GRID_SPACING) * GRID_SPACING;
            if (Math.abs(newW - snappedW) <= HANDLE_SNAP_TOLERANCE) {
              newW = clamp(snappedW, minSize, maxSize);
            }
            // Capture previous frame state BEFORE mutating target for correct deltas
            var prevCenterX = target.x;
            var prevCenterZ = target.z;
            var prevW = target.width;
            var prevHalfW = prevW / 2;

            // Compute new center from fixed opposite face and new width
            var newCenterX = mouse.dragInfo.faceOppStart.x + (newW / 2) * (sX * axisXx);
            var newCenterZ = mouse.dragInfo.faceOppStart.z + (newW / 2) * (sX * axisXz);

            // Per-frame center delta
            var deltaCenterX = newCenterX - prevCenterX;
            var deltaCenterZ = newCenterZ - prevCenterZ;

            // Update size and center
            target.width = newW;
            target.x = newCenterX;
            target.z = newCenterZ;
            
            // Rectangular rooms: move openings with correct wall coupling
            if (!mouse.dragInfo.poly && Array.isArray(target.openings) && target.openings.length > 0 && (deltaCenterX !== 0 || deltaCenterZ !== 0)) {
              try {
                // Movement vectors in world space
                var centerShift = { dx: deltaCenterX, dz: deltaCenterZ };
                // Dragged face moves by twice the center shift along width axis
                var draggedFaceShift = { dx: 2*deltaCenterX, dz: 2*deltaCenterZ };
                // Determine which edge name is being dragged/opposite for rectangular rooms
                var draggedEdge = (sX === 1 ? 'right' : 'left');
                var oppositeEdge = (sX === 1 ? 'left' : 'right');
                // Helper to classify edge if not present by projecting midpoint into local axes
                function classifyEdge(op){
                  function normEdge(e){ if(!e) return e; if(e==='minX') return 'left'; if(e==='maxX') return 'right'; if(e==='minZ') return 'top'; if(e==='maxZ') return 'bottom'; return e; }
                  if (op && typeof op.edge === 'string') return normEdge(op.edge);
                  try {
                    var mx = ((op.x0||0)+(op.x1||0))/2;
                    var mz = ((op.z0||0)+(op.z1||0))/2;
                    // Local coordinates relative to previous center
                    var relX = (mx - prevCenterX) * axisXx + (mz - prevCenterZ) * axisXz; // along local +X
                    var relZ = (mx - prevCenterX) * axisZx + (mz - prevCenterZ) * axisZz; // along local +Z
                    var tol = Math.max(0.12, prevW*0.02);
                    if (Math.abs(relX - (+prevHalfW)) <= tol) return 'right';
                    if (Math.abs(relX - (-prevHalfW)) <= tol) return 'left';
                    // Use sign of relZ to disambiguate top/bottom
                    // relZ > 0 means near local +Z (world maxZ) -> 'bottom'; relZ < 0 -> 'top'
                    return (relZ >= 0 ? 'bottom' : 'top');
                  } catch(_ce) { return null; }
                }
                for (var oi = 0; oi < target.openings.length; oi++) {
                  var op = target.openings[oi]; if (!op || typeof op.x0 !== 'number') continue;
                  var edge = classifyEdge(op);
                  var d = null;
                  if (edge === draggedEdge) {
                    d = draggedFaceShift; // move fully with the dragged wall
                  } else if (edge === oppositeEdge) {
                    d = { dx: 0, dz: 0 }; // opposite wall stays put
                  } else {
                    d = centerShift; // perpendicular walls follow center shift
                  }
                  op.x0 += d.dx; op.z0 += d.dz; op.x1 += d.dx; op.z1 += d.dz;
                  op.__manuallyPositioned = true;
                }
              } catch(_rectWidthErr) {
                console.warn('Failed to move rect room openings on width change:', _rectWidthErr);
              }
            }
            
            // Polygonal rooms: scale footprint along X relative to fixed side
            try {
              if (mouse.dragInfo.poly && Array.isArray(target.footprint) && target.footprint.length >= 3) {
                var box = mouse.dragInfo.poly.box;
                var oldW = Math.max(0.01, (box.maxX - box.minX));
                var scale = newW / oldW;
                var fixedLeft = (type === 'width+' ? box.minX : null);
                var fixedRight = (type === 'width-' ? box.maxX : null);
                var newFp = [];
                for (var pi=0; pi<mouse.dragInfo.poly.origFootprint.length; pi++){
                  var q = mouse.dragInfo.poly.origFootprint[pi];
                  var nx;
                  if (fixedLeft != null) {
                    nx = fixedLeft + (q.x - fixedLeft) * scale;
                  } else if (fixedRight != null) {
                    nx = fixedRight - (fixedRight - q.x) * scale;
                  } else {
                    nx = q.x; // fallback
                  }
                  newFp.push({ x: nx, z: q.z });
                }
                // Apply footprint and recompute center from new bbox
                target.footprint = newFp;
                var nMinX=Infinity,nMaxX=-Infinity,nMinZ=Infinity,nMaxZ=-Infinity;
                for (var pj=0; pj<newFp.length; pj++){ var pnt=newFp[pj]; if(!pnt) continue; if(pnt.x<nMinX) nMinX=pnt.x; if(pnt.x>nMaxX) nMaxX=pnt.x; if(pnt.z<nMinZ) nMinZ=pnt.z; if(pnt.z>nMaxZ) nMaxZ=pnt.z; }
                target.x = (nMinX + nMaxX) / 2; target.z = (nMinZ + nMaxZ) / 2;
                // Transform openings anchored by world endpoints along X as well
                if (Array.isArray(target.openings) && mouse.dragInfo.poly.openings.length) {
                  for (var ok=0; ok<mouse.dragInfo.poly.openings.length; ok++){
                    var os = mouse.dragInfo.poly.openings[ok]; var o = target.openings[os.idx]; if(!o) continue;
                    // Scale center position but maintain opening width
                    var origCenterX = (os.x0 + os.x1) / 2;
                    var origDx = os.x1 - os.x0;
                    var halfOrigDx = origDx / 2;
                    function mapX(x){ if (fixedLeft != null) return fixedLeft + (x - fixedLeft) * scale; if (fixedRight != null) return fixedRight - (fixedRight - x) * scale; return x; }
                    var newCenterX = mapX(origCenterX);
                    o.x0 = newCenterX - halfOrigDx;
                    o.x1 = newCenterX + halfOrigDx;
                    // z stays same for X-resize
                  }
                }
              }
            } catch(_polyXErr) {}
            if (target.type === 'roof') target.autoFit = false; // manual resize disables auto-fit
            updateStatus('Resizing width...');
            try { updatePlan2DWallsForRoom(target); } catch(_gw) {}
            __maybeRebuildRoomStripsThrottled();
          } else if (type === 'depth+' || type === 'depth-') {
            // Measure along dragged face normal (sZ * axisZ)
            var sZ = mouse.dragInfo.sideSign || (type === 'depth+' ? 1 : -1);
            var projZ = move.x * axisZx + move.z * axisZz; // motion along +Z

            var fxz = mouse.dragInfo.faceDraggedStart.x + projZ * axisZx;
            var fzz = mouse.dragInfo.faceDraggedStart.z + projZ * axisZz;
            var vxz = fxz - mouse.dragInfo.faceOppStart.x;
            var vzz = fzz - mouse.dragInfo.faceOppStart.z;
            var alongZ = vxz * (sZ * axisZx) + vzz * (sZ * axisZz);
            var newD = clamp(Math.max(minSize, Math.min(maxSize, alongZ)), minSize, maxSize);
            // Snap depth to nearest GRID_SPACING when within HANDLE_SNAP_TOLERANCE
            var snappedD = Math.round(newD / GRID_SPACING) * GRID_SPACING;
            if (Math.abs(newD - snappedD) <= HANDLE_SNAP_TOLERANCE) {
              newD = clamp(snappedD, minSize, maxSize);
            }
            // Capture previous frame state BEFORE mutating target for correct deltas
            var prevCenterXD = target.x;
            var prevCenterZD = target.z;
            var prevD = target.depth;
            var prevHalfD = prevD / 2;

            var newCenterXD = mouse.dragInfo.faceOppStart.x + (newD / 2) * (sZ * axisZx);
            var newCenterZD = mouse.dragInfo.faceOppStart.z + (newD / 2) * (sZ * axisZz);

            var deltaCenterXD = newCenterXD - prevCenterXD;
            var deltaCenterZD = newCenterZD - prevCenterZD;

            target.depth = newD;
            target.x = newCenterXD;
            target.z = newCenterZD;
            
            // Rectangular rooms: move openings with correct wall coupling
            if (!mouse.dragInfo.poly && Array.isArray(target.openings) && target.openings.length > 0 && (deltaCenterXD !== 0 || deltaCenterZD !== 0)) {
              try {
                var centerShiftD = { dx: deltaCenterXD, dz: deltaCenterZD };
                var draggedFaceShiftD = { dx: 2*deltaCenterXD, dz: 2*deltaCenterZD };
                // For depth drag: +Z handle (depth+) moves the bottom (maxZ) wall; -Z moves the top (minZ)
                var draggedEdgeD = (sZ === 1 ? 'bottom' : 'top');
                var oppositeEdgeD = (sZ === 1 ? 'top' : 'bottom');
                function classifyEdgeD(op){
                  function normEdge(e){ if(!e) return e; if(e==='minX') return 'left'; if(e==='maxX') return 'right'; if(e==='minZ') return 'top'; if(e==='maxZ') return 'bottom'; return e; }
                  if (op && typeof op.edge === 'string') return normEdge(op.edge);
                  try {
                    var mx = ((op.x0||0)+(op.x1||0))/2;
                    var mz = ((op.z0||0)+(op.z1||0))/2;
                    var relX = (mx - prevCenterXD) * axisXx + (mz - prevCenterZD) * axisXz; // along local +X
                    var relZ = (mx - prevCenterXD) * axisZx + (mz - prevCenterZD) * axisZz; // along local +Z
                    var tol = Math.max(0.12, prevD*0.02);
                    // relZ ~ +halfD -> bottom (maxZ); relZ ~ -halfD -> top (minZ)
                    if (Math.abs(relZ - (+prevHalfD)) <= tol) return 'bottom';
                    if (Math.abs(relZ - (-prevHalfD)) <= tol) return 'top';
                    return (relX >= 0 ? 'right' : 'left');
                  } catch(_ced) { return null; }
                }
                for (var oiD = 0; oiD < target.openings.length; oiD++) {
                  var opD = target.openings[oiD]; if (!opD || typeof opD.x0 !== 'number') continue;
                  var edgeD = classifyEdgeD(opD);
                  var d2 = null;
                  if (edgeD === draggedEdgeD) d2 = draggedFaceShiftD;
                  else if (edgeD === oppositeEdgeD) d2 = { dx: 0, dz: 0 };
                  else d2 = centerShiftD;
                  opD.x0 += d2.dx; opD.z0 += d2.dz; opD.x1 += d2.dx; opD.z1 += d2.dz;
                  opD.__manuallyPositioned = true;
                }
              } catch(_rectDepthErr) {
                console.warn('Failed to move rect room openings on depth change:', _rectDepthErr);
              }
            }
            
            // Polygonal rooms: scale footprint along Z relative to fixed side
            try {
              if (mouse.dragInfo.poly && Array.isArray(target.footprint) && target.footprint.length >= 3) {
                var boxZ = mouse.dragInfo.poly.box;
                var oldD = Math.max(0.01, (boxZ.maxZ - boxZ.minZ));
                var scaleZ = newD / oldD;
                var fixedTop = (type === 'depth+' ? boxZ.minZ : null);   // dragging +Z keeps top fixed
                var fixedBottom = (type === 'depth-' ? boxZ.maxZ : null); // dragging -Z keeps bottom fixed
                var newFpZ = [];
                for (var pi2=0; pi2<mouse.dragInfo.poly.origFootprint.length; pi2++){
                  var q2 = mouse.dragInfo.poly.origFootprint[pi2];
                  var nz;
                  if (fixedTop != null) {
                    nz = fixedTop + (q2.z - fixedTop) * scaleZ;
                  } else if (fixedBottom != null) {
                    nz = fixedBottom - (fixedBottom - q2.z) * scaleZ;
                  } else {
                    nz = q2.z;
                  }
                  newFpZ.push({ x: q2.x, z: nz });
                }
                target.footprint = newFpZ;
                var n2MinX=Infinity,n2MaxX=-Infinity,n2MinZ=Infinity,n2MaxZ=-Infinity;
                for (var pk=0; pk<newFpZ.length; pk++){ var p2=newFpZ[pk]; if(!p2) continue; if(p2.x<n2MinX) n2MinX=p2.x; if(p2.x>n2MaxX) n2MaxX=p2.x; if(p2.z<n2MinZ) n2MinZ=p2.z; if(p2.z>n2MaxZ) n2MaxZ=p2.z; }
                target.x = (n2MinX + n2MaxX) / 2; target.z = (n2MinZ + n2MaxZ) / 2;
                // Transform openings anchored by world endpoints along Z as well
                if (Array.isArray(target.openings) && mouse.dragInfo.poly.openings.length) {
                  for (var ok2=0; ok2<mouse.dragInfo.poly.openings.length; ok2++){
                    var os2 = mouse.dragInfo.poly.openings[ok2]; var o2 = target.openings[os2.idx]; if(!o2) continue;
                    // Scale center position but maintain opening width
                    var origCenterZ = (os2.z0 + os2.z1) / 2;
                    var origDz = os2.z1 - os2.z0;
                    var halfOrigDz = origDz / 2;
                    function mapZ(z){ if (fixedTop != null) return fixedTop + (z - fixedTop) * scaleZ; if (fixedBottom != null) return fixedBottom - (fixedBottom - z) * scaleZ; return z; }
                    var newCenterZ = mapZ(origCenterZ);
                    o2.z0 = newCenterZ - halfOrigDz;
                    o2.z1 = newCenterZ + halfOrigDz;
                    // x stays same for Z-resize
                  }
                }
              }
            } catch(_polyZErr) {}
            if (target.type === 'roof') target.autoFit = false; // manual resize disables auto-fit
            updateStatus('Resizing depth...');
            try { updatePlan2DWallsForRoom(target); } catch(_gd) {}
            __maybeRebuildRoomStripsThrottled();
          } else if (type === 'height') {
            var heightChange = -(dy * 0.005);
            var maxH = (target.type === 'pool') ? 5 : 10;
            target.height = clamp(target.height + heightChange, 0.5, maxH);
            updateStatus('Resizing height...');
          }

          renderLoop();
        }
      } else if (mouse.dragType === 'wall-strip' && mouse.dragInfo && typeof mouse.dragInfo.wallIndex === 'number') {
        var wsIdx = mouse.dragInfo.wallIndex;
        var wArr = window.wallStrips || [];
        var wObj = wArr[wsIdx];
        if (wObj) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var mv = worldMovement(dx, dy);
          // Translate both endpoints uniformly (keep length and orientation)
          wObj.x0 = mouse.dragInfo.originalX0 + mv.x;
          wObj.z0 = mouse.dragInfo.originalZ0 + mv.z;
          wObj.x1 = mouse.dragInfo.originalX1 + mv.x;
          wObj.z1 = mouse.dragInfo.originalZ1 + mv.z;
          updateStatus('Moving wall...');
          // Mark need for full render (no rebuild needed; free wall)
          try { window._needsFullRender = true; } catch(_nf) {}
          renderLoop();
        }
      } else if (mouse.dragType === 'camera' && mouse.down) {
        var dx = e.clientX - mouse.lastX;
        var dy = e.clientY - mouse.lastY;
        if (e.shiftKey) {
          // Screen-space pan retained for familiarity
          pan.x += dx * 1.5;
          pan.y += dy * 1.5;
        } else {
          // Use orbit helper with clamping and distance-aware speed
          if (typeof orbitCamera === 'function') orbitCamera(dx, dy);
          else { camera.yaw += dx * 0.008; camera.pitch -= dy * 0.008; camera.pitch = Math.max(camera.minPitch, Math.min(camera.maxPitch, camera.pitch)); }
        }
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
        // Keep render loop active during orbit/pan for immediate feedback
        try { if (typeof startRender === 'function') startRender(); else if (typeof renderLoop === 'function') renderLoop(); } catch(_rr){}
        try { window._camLastMoveTime = (performance && performance.now) ? performance.now() : Date.now(); } catch(_tm){}
      }
    });
    
    document.addEventListener('mouseup', function() {
      // If we just finished resizing OR moving a room, sync to 2D and save
      if ((mouse.dragType === 'handle' || mouse.dragType === 'room' || mouse.dragType === 'balcony') && mouse.dragInfo && mouse.dragInfo.roomId) {
  try { var obj = findObjectById(mouse.dragInfo.roomId); if (obj) __rtActionPush({ kind:'3d-drag-end', id: obj.id, type: obj.type||'room', name: obj.name||null, pose:{ x:obj.x, z:obj.z, w:obj.width, d:obj.depth, rot:obj.rotation||0 } }); } catch(_trE){}
  try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-drag', { coalesce: true, coalesceKey: (obj && obj.id) || null }); } catch(_hpc){}
      // Wall strip drag end
      if (mouse.dragType === 'wall-strip' && mouse.dragInfo && typeof mouse.dragInfo.wallIndex === 'number') {
        updateStatus('Wall moved');
  try { var wE = (window.wallStrips && window.wallStrips[mouse.dragInfo.wallIndex]) ? window.wallStrips[mouse.dragInfo.wallIndex] : null; if (wE) __rtActionPush({ kind:'wall-strip-move-end', index: mouse.dragInfo.wallIndex, to:{ x0:wE.x0, z0:wE.z0, x1:wE.x1, z1:wE.z1 }, level:(wE.level||0) }); } catch(_te){}
  try { if (typeof window.historyPushChange === 'function') window.historyPushChange('wall-strip-move', { coalesce: false, index: mouse.dragInfo.wallIndex }); } catch(_hpc3){}
        // Persist project after move
        try { if (typeof saveProjectSilently==='function') saveProjectSilently(); } catch(_spw) {}
        renderLoop();
      }
        try {
          // Ensure final 2D grouped walls match the final 3D room pose
          try { var rmFinal = findObjectById(mouse.dragInfo.roomId); if (rmFinal) updatePlan2DWallsForRoom(rmFinal); } catch(_cf) {}
          // Purge stale perimeter wall strips that correspond to the room's previous footprint (ghost keylines)
          try {
            var info = mouse.dragInfo;
            var roomNow = findObjectById(info.roomId);
            if (roomNow && Array.isArray(window.wallStrips)) {
              function collectEdges(room){
                var out=[]; function normKey(x0,z0,x1,z1){ var a=x0.toFixed(3)+','+z0.toFixed(3); var b=x1.toFixed(3)+','+z1.toFixed(3); return (a<b? a+'|'+b : b+'|'+a); }
                if (Array.isArray(room.footprint) && room.footprint.length>=2){
                  for (var i=0;i<room.footprint.length;i++){ var A=room.footprint[i], B=room.footprint[(i+1)%room.footprint.length]; if(!A||!B) continue; out.push(normKey(A.x||0,A.z||0,B.x||0,B.z||0)); }
                } else {
                  var hw=(room.width||0)/2, hd=(room.depth||0)/2; var xL=(room.x||0)-hw, xR=(room.x||0)+hw, zT=(room.z||0)-hd, zB=(room.z||0)+hd; var edges=[[xL,zT,xR,zT],[xR,zT,xR,zB],[xR,zB,xL,zB],[xL,zB,xL,zT]]; for (var e=0;e<edges.length;e++){ var E=edges[e]; out.push(normKey(E[0],E[1],E[2],E[3])); }
                }
                return out;
              }
              var newEdges = collectEdges(roomNow);
              var oldEdges = Array.isArray(info.oldPerimeterKeys) ? info.oldPerimeterKeys : [];
              var newSet = Object.create(null); for (var ni=0; ni<newEdges.length; ni++) newSet[newEdges[ni]] = true;
              var oldSet = Object.create(null); for (var oi=0; oi<oldEdges.length; oi++) oldSet[oldEdges[oi]] = true;
              // Remove wall strips whose segment key is in oldSet but not in newSet (stale) on same level
              function keyForStrip(ws){ var a=ws.x0.toFixed(3)+','+ws.z0.toFixed(3); var b=ws.x1.toFixed(3)+','+ws.z1.toFixed(3); return (a<b? a+'|'+b : b+'|'+a); }
              var before = wallStrips.length;
              // Only consider purging strips that actually belong to the dragged room.
              // Avoid removing unrelated walls that happen to share geometry.
              wallStrips = wallStrips.filter(function(ws){
                try {
                  if (!ws) return false;
                  if ((ws.level||0) !== (roomNow.level||0)) return true;
                  if (ws.roomId !== roomNow.id) return true;
                  var k = keyForStrip(ws);
                  // For the dragged room's own perimeter strips, remove if the edge is no longer part of its new geometry
                  if (!newSet[k]) return false;
                  return true;
                } catch(_e){ return true; }
              });
              var removed = before - wallStrips.length;
              // Restrictive coarse purge: only remove strips in the old box that belonged to this room.
              if (removed === 0 && info.oldBox) {
                var shiftDist = Math.hypot((roomNow.x||0) - (info.originalX||info.oldBox.centerX||roomNow.x), (roomNow.z||0) - (info.originalZ||info.oldBox.centerZ||roomNow.z));
                if (shiftDist > 0.05) {
                  var pad = 0.05;
                  var minXb = info.oldBox.minX - pad, maxXb = info.oldBox.maxX + pad;
                  var minZb = info.oldBox.minZ - pad, maxZb = info.oldBox.maxZ + pad;
                  function segIntersects(x0,z0,x1,z1){
                    if ((x0 < minXb && x1 < minXb) || (x0 > maxXb && x1 > maxXb) || (z0 < minZb && z1 < minZb) || (z0 > maxZb && z1 > maxZb)) return false;
                    function inside(x,z){ return x>=minXb && x<=maxXb && z>=minZb && z<=maxZb; }
                    if (inside(x0,z0) || inside(x1,z1)) return true;
                    function orient(ax,ay,bx,by,cx,cy){ var v=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax); return (v>0)?1:(v<0?-1:0); }
                    function inter(ax,ay,bx,by,cx,cy,dx,dy){ var o1=orient(ax,ay,bx,by,cx,cy), o2=orient(ax,ay,bx,by,dx,dy), o3=orient(cx,cy,dx,dy,ax,ay), o4=orient(cx,cy,dx,dy,bx,by); if(o1!==o2 && o3!==o4) return true; return false; }
                    if (inter(x0,z0,x1,z1, minXb,minZb, maxXb,minZb)) return true;
                    if (inter(x0,z0,x1,z1, maxXb,minZb, maxXb,maxZb)) return true;
                    if (inter(x0,z0,x1,z1, maxXb,maxZb, minXb,maxZb)) return true;
                    if (inter(x0,z0,x1,z1, minXb,maxZb, minXb,minZb)) return true;
                    return false;
                  }
                  var beforeBox = wallStrips.length;
                  wallStrips = wallStrips.filter(function(ws){
                    try {
                      if (!ws) return false;
                      if ((ws.level||0)!==(roomNow.level||0)) return true;
                      if (ws.roomId !== roomNow.id) return true;
                      return !segIntersects(ws.x0||0, ws.z0||0, ws.x1||0, ws.z1||0);
                    } catch(_e){ return true; }
                  });
                  removed += Math.max(0, beforeBox - wallStrips.length);
                }
              }
              if (removed > 0) {
                try { if (typeof window.dedupeWallStrips==='function') window.dedupeWallStrips(); } catch(_d) {}
                try { if (typeof saveProjectSilently==='function') saveProjectSilently(); } catch(_sps) {}
                try { if (typeof renderLoop==='function') renderLoop(); } catch(_rl) {}
                console.log('🧹 Purged', removed, 'stale perimeter wall strips');
              }
            }
          } catch(_purgeStale) { console.warn('Stale perimeter purge failed', _purgeStale); }
          console.log('🔄 SYNCING 3D -> 2D (flag still true to block feedback)');
          // Sync 3D changes to 2D plan (ALWAYS sync, even if 2D plan is not visible,
          // to ensure openings stay in correct positions when applyPlan2DTo3D is called later)
          if (typeof populatePlan2DFromDesign === 'function' && window.__plan2d) {
            var result = populatePlan2DFromDesign();
            console.log('✅ populatePlan2DFromDesign() returned:', result, '__plan2d.elements.length:', (__plan2d && __plan2d.elements) ? __plan2d.elements.length : 0);
            // Build a consistent snapshot of elements + center/sign/scale for apply
            var snap = null;
            try {
              if (typeof populatePlan2DFromDesignSnapshot === 'function') {
                snap = populatePlan2DFromDesignSnapshot();
              }
            } catch(_snapErr) { snap = null; }
            if (!snap) {
              snap = {
                elements: (__plan2d && Array.isArray(__plan2d.elements)) ? __plan2d.elements : [],
                centerX: (__plan2d && isFinite(__plan2d.centerX)) ? __plan2d.centerX : 0,
                centerZ: (__plan2d && isFinite(__plan2d.centerZ)) ? __plan2d.centerZ : 0,
                yFromWorldZSign: (__plan2d && (__plan2d.yFromWorldZSign===-1||__plan2d.yFromWorldZSign===1)) ? __plan2d.yFromWorldZSign : 1,
                scale: (__plan2d && isFinite(__plan2d.scale)) ? __plan2d.scale : undefined
              };
            }
            
            // Clear the __manuallyPositioned flag from all openings after sync
            // This allows future applyPlan2DTo3D calls to update coordinates normally
            var target = mouse.dragInfo.room || findObjectById(mouse.dragInfo.roomId);
            if (target && Array.isArray(target.openings)) {
              for (var i = 0; i < target.openings.length; i++) {
                if (target.openings[i] && target.openings[i].__manuallyPositioned) {
                  delete target.openings[i].__manuallyPositioned;
                  console.log('🧹 Cleared __manuallyPositioned flag from:', target.openings[i].type);
                }
              }
            }
            
            // IMPORTANT: Do NOT rebuild 3D from 2D after a 3D drag.
            // This used to cause clones/ghosts due to back-and-forth rebuilds.
            // We keep 2D in sync from 3D (populatePlan2DFromDesign) and leave 3D as the source of truth.
            // Solid perimeter strips are already rebuilt incrementally during the drag when in Render mode.
            
            // Only redraw if the 2D plan is actually visible
            if (__plan2d.active && typeof plan2dDraw === 'function') {
              plan2dDraw();
            }
          }
          // Save the project
          if (typeof saveProjectSilently === 'function') {
            saveProjectSilently();
          }
          updateStatus('Room resized');
        } catch(e) {
          console.error('Failed to sync 2D after resize:', e);
        }
      }
      
      // Clear the 3D drag flag AFTER plan2dScheduleApply's 150ms timer expires
      // This prevents applyPlan2DTo3D from rebuilding rooms immediately after drag
      setTimeout(function() {
        window.__dragging3DRoom = false;
        try { window.__activelyDraggedRoomId = null; } catch(_ad2) {}
        console.log('🔴 END 3D DRAG - Flag cleared after 200ms:', window.__dragging3DRoom);
      }, 200);
      
      currentSnapGuides = [];
      mouse.down = false;
      mouse.dragType = null;
      mouse.dragInfo = null;
      canvas.style.cursor = 'grab';
      updateStatus('Ready');
    });
    
    canvas.addEventListener('wheel', function(e) {
      try { if (window.__trace3d) console.log('[3D] wheel@canvas', e.deltaY); } catch(_t){}
      e.preventDefault();
      camera.distance *= e.deltaY > 0 ? 1.08 : 0.92;
      // Clamp using camera bounds (engine ensures defaults exist)
      if (typeof clampCamera === 'function') clampCamera();
      else { camera.distance = Math.max(camera.minDistance||6, Math.min(camera.maxDistance||140, camera.distance)); }
      // Ensure the renderer is active so zoom reflects immediately
      try { if (typeof startRender === 'function') startRender(); else if (typeof renderLoop === 'function') renderLoop(); } catch(_r){}
    }, { passive: false });

    // Global wheel zoom proxy so zoom works even when hovering labels/overlays
    // Guarded to avoid interfering with 2D editor or modals
    document.addEventListener('wheel', function(e){
      try {
        // Ignore when event targets 2D editor surfaces or modal UIs
        var tgt = e.target;
        var in2D = false;
        try {
          if (window.__plan2d && __plan2d.active) {
            in2D = !!(tgt && tgt.closest && (tgt.closest('#plan2d-page') || tgt.closest('#plan2d-canvas') || tgt.closest('#labels-2d')));
          }
        } catch(_gd) { in2D = false; }
        if (in2D) return;
        if (tgt && (tgt.closest && (tgt.closest('#room-palette-content') || tgt.closest('.dropdown-list') || tgt.closest('#info-content')))) return;
        // Only react if event is over the 3D canvas area or labels overlay/body
        var overCanvas = !!(tgt && tgt.closest && tgt.closest('#canvas'));
        var overLabels = !!(tgt && tgt.closest && tgt.closest('#labels-3d'));
        var overBody = (tgt === document.body || tgt === document.documentElement);
        if (!(overCanvas || overLabels || overBody)) return;
        e.preventDefault();
        try { if (window.__trace3d) console.log('[3D] wheel@document', e.deltaY); } catch(_t2){}
        camera.distance *= e.deltaY > 0 ? 1.08 : 0.92;
        if (typeof clampCamera === 'function') clampCamera();
        try { if (typeof startRender === 'function') startRender(); else if (typeof renderLoop === 'function') renderLoop(); } catch(_r2){}
      } catch(_w) {}
    }, { passive: false });
    
    // ------------------------------------------------------------------
    // TOUCH / MOBILE GESTURES (single‑finger orbit or handle drag, pinch zoom, two‑finger pan)
    // Product requirement: add mobile gestures so user can test on touch devices.
    // Design:
    //  - 1 finger tap / drag on a handle: behaves exactly like mouse drag (reuse existing logic by dispatching synthetic mouse events)
    //  - 1 finger drag NOT on a handle: orbit camera (same as right‑drag desktop)
    //  - 2 finger pinch: zoom (adjust camera.distance, clamped)
    //  - 2 finger drag (midpoint move while pinching): pan world (panCameraWorld)
    //  - Touch end synthesizes mouseup to finalize drags (resize / move) ensuring existing cleanup logic runs.
    // Guarded by window.__enableTouchGestures (default true) so we can disable quickly if needed.
    if (typeof window.__enableTouchGestures === 'undefined') window.__enableTouchGestures = true;
    (function initTouchGestures(){
      try {
        if (!canvas) return;
        // Internal state
        var activeMode = null; // 'single' | 'pinch'
        var lastX = 0, lastY = 0;
        var pinchLastDist = 0;
        var pinchLastMid = null;
        function synthMouse(type, x, y){
          try { var evt = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }); document.dispatchEvent(evt); } catch(_e){}
        }
        canvas.addEventListener('touchstart', function(e){
          if(!window.__enableTouchGestures) return; if(!e.touches || !e.touches.length) return; _uiLastInteractionTime = (performance && performance.now)? performance.now(): Date.now();
          if (e.touches.length === 1){
            var t = e.touches[0];
            // Hit-test handles first (CSS pixels). We mimic mousedown so existing code sets up dragInfo.
            try {
              var rect = canvas.getBoundingClientRect();
              var mx = t.clientX - rect.left; var my = t.clientY - rect.top;
              var handle = findHandle(mx, my);
              if (handle){
                // Dispatch synthetic mouse events to reuse the robust mousedown logic (selection, dragInfo capture, footprints/openings, etc.)
                synthMouse('mousedown', t.clientX, t.clientY);
              } else {
                // Prepare for orbit mode
                mouse.down = true; mouse.dragType = 'camera'; lastX = t.clientX; lastY = t.clientY; canvas.style.cursor='grabbing';
              }
            } catch(_ht) {
              // Fallback to orbit
              mouse.down = true; mouse.dragType = 'camera'; lastX = t.clientX; lastY = t.clientY; canvas.style.cursor='grabbing';
            }
            // Focus canvas on first touch so external keyboards (tablet) work for shortcuts
            try { if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex','0'); canvas.focus({preventScroll:true}); } catch(_tfocus){}
            activeMode = 'single';
          } else if (e.touches.length === 2){
            var t0 = e.touches[0], t1 = e.touches[1];
            pinchLastDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
            pinchLastMid = { x: (t0.clientX + t1.clientX)/2, y: (t0.clientY + t1.clientY)/2 };
            activeMode = 'pinch';
          }
          // Prevent browser scrolling / pinch-zoom of page
          e.preventDefault();
        }, { passive: false });
        canvas.addEventListener('touchmove', function(e){
          if(!window.__enableTouchGestures) return; if(!activeMode) return; if(!e.touches || !e.touches.length) return; _uiLastInteractionTime = (performance && performance.now)? performance.now(): Date.now();
          if (activeMode === 'single' && e.touches.length === 1){
            var t = e.touches[0];
            // If a handle drag was initiated we forward as mousemove so existing resize logic applies.
            if (mouse.dragType === 'handle'){ synthMouse('mousemove', t.clientX, t.clientY); }
            else if (mouse.dragType === 'camera') {
              var dx = t.clientX - lastX; var dy = t.clientY - lastY; lastX = t.clientX; lastY = t.clientY;
              if (typeof orbitCamera === 'function') orbitCamera(dx, dy); else { camera.yaw += dx*0.008; camera.pitch -= dy*0.008; if (typeof clampCamera==='function') clampCamera(); }
              if (typeof renderLoop==='function') renderLoop();
            } else {
              // No current dragType (e.g., simple tap-move off handle) -> orbit
              var dx2 = t.clientX - lastX; var dy2 = t.clientY - lastY; lastX = t.clientX; lastY = t.clientY;
              if (typeof orbitCamera === 'function') orbitCamera(dx2, dy2); else { camera.yaw += dx2*0.008; camera.pitch -= dy2*0.008; if (typeof clampCamera==='function') clampCamera(); }
              if (typeof renderLoop==='function') renderLoop();
            }
          } else if (activeMode === 'pinch' && e.touches.length === 2){
            var t0 = e.touches[0], t1 = e.touches[1];
            var dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || pinchLastDist;
            // Zoom (pinch) -> adjust distance inversely to scale change
            var scale = dist / pinchLastDist; if (scale !== 0){ camera.distance /= scale; }
            if (typeof clampCamera === 'function') clampCamera();
            // Midpoint pan (two-finger drag): translate camera target in world space
            var mid = { x:(t0.clientX + t1.clientX)/2, y:(t0.clientY + t1.clientY)/2 };
            if (pinchLastMid){ var dxm = mid.x - pinchLastMid.x; var dym = mid.y - pinchLastMid.y; if (typeof panCameraWorld === 'function') panCameraWorld(-dxm, dym); }
            pinchLastDist = dist; pinchLastMid = mid;
            if (typeof renderLoop==='function') renderLoop();
          }
          e.preventDefault();
        }, { passive: false });
        canvas.addEventListener('touchend', function(e){
          if(!window.__enableTouchGestures) return;
            if (activeMode === 'single') {
              // Synthesize mouseup so existing cleanup (sync, save, purge) runs
              synthMouse('mouseup', lastX, lastY);
            }
            if (e.touches.length === 0){ activeMode = null; mouse.down = false; if (canvas) canvas.style.cursor='grab'; }
          e.preventDefault();
        }, { passive: false });
        canvas.addEventListener('touchcancel', function(e){
          if(!window.__enableTouchGestures) return; activeMode = null; mouse.down = false; synthMouse('mouseup', lastX, lastY); if (canvas) canvas.style.cursor='grab'; e.preventDefault();
        }, { passive: false });
      } catch(_tg){ /* non-fatal touch init */ }
    })();
    
    document.addEventListener('keydown', function(e) {
      try { __log3d('keydown', { key:e.key, code:e.code, keyCode:e.keyCode, which:e.which, target:(e.target&&e.target.tagName), active2D:(window.__plan2d && __plan2d.active) }); } catch(_l){}
      // When 2D editor is active, ignore 3D keyboard shortcuts entirely
      try { if (window.__plan2d && __plan2d.active) { __log3d('keydown ignored (2D active)'); return; } } catch(_e) {}
      // If user is typing in an input/textarea (e.g., Object Measurements panel), do not hijack Delete/Backspace
      try {
        var ae = document.activeElement;
        var tag = (ae && ae.tagName ? ae.tagName.toLowerCase() : '');
        var editing = (tag === 'input' || tag === 'textarea' || (ae && ae.isContentEditable));
        if (editing) return; // allow native text deletion and editing
      } catch(_foc) {}
      if (e.key === 'Escape') {
        var rpm = document.getElementById('room-palette-modal');
        if (rpm && rpm.style.display === 'block') {
          hideRoomPalette();
        } else {
          // Use unified helper so measurements panel clears instantly
          if (typeof window.selectObject === 'function') { window.selectObject(null, { noRender: true }); }
          else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMu) {} }
          selectedWallStripIndex = -1;
          updateStatus('Selection cleared');
        }
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedRoomId || (typeof selectedWallStripIndex==='number' && selectedWallStripIndex>-1))) {
        e.preventDefault();
    try { __log3d('Delete pressed in 3D', { selectedRoomId: selectedRoomId, selectedWallStripIndex: selectedWallStripIndex }); } catch(_l2){}
        
        var roomIndex = -1;
        for (var i = 0; i < allRooms.length; i++) {
          if (allRooms[i].id === selectedRoomId) {
            roomIndex = i;
            break;
          }
        }
        
        if (roomIndex > -1 && allRooms.length > 1) {
          var room = allRooms[roomIndex];
          allRooms.splice(roomIndex, 1);
          try { __rtActionPush({ kind:'3d-delete', target:'room', id: room.id, name: room.name||null, level: (room.level||0) }); } catch(_td1){}
          try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'room', id: room.id, coalesce: false }); } catch(_hpdRoom){}
          if (typeof window.selectObject === 'function') { window.selectObject(null, { noRender: true }); }
          else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMs) {} }
          updateStatus(room.name + ' deleted');
          try { __log3d('Deleted room'); } catch(_l3){}
          return;
        }
        
        // Stairs deletion: support multiple; remove matching stairs by id
        try {
          var delIdx = -1; var scArrD = window.stairsComponents || [];
          if (Array.isArray(scArrD) && scArrD.length){ for (var sdi=0; sdi<scArrD.length; sdi++){ var sObj=scArrD[sdi]; if (sObj && sObj.id === selectedRoomId) { delIdx = sdi; break; } } }
          if (delIdx > -1) {
            var delS = scArrD[delIdx]; scArrD.splice(delIdx,1);
            try { __rtActionPush({ kind:'3d-delete', target:'stairs', id: delS.id, level: (delS.level||0) }); } catch(_tds){}
            try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'stairs', id: delS.id, coalesce: false }); } catch(_hpdStairs){}
            try { window.stairsComponents = scArrD; } catch(_keep){}
            if (window.stairsComponent && window.stairsComponent.id === selectedRoomId){ window.stairsComponent = scArrD.length ? scArrD[scArrD.length-1] : null; }
            if (typeof window.selectObject === 'function') { window.selectObject(null, { noRender: true }); }
            else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMd1) {} }
            updateStatus((delS && delS.name ? delS.name : 'Stairs') + ' deleted');
            try { __log3d('Deleted stairs'); } catch(_l4){}
            try { if (typeof window.updateLevelMenuStates==='function') window.updateLevelMenuStates(); } catch(_u){}
            return;
          } else if (stairsComponent && stairsComponent.id === selectedRoomId) {
            var oldStairsId = stairsComponent.id;
            stairsComponent = null;
            try { __rtActionPush({ kind:'3d-delete', target:'stairs', id: oldStairsId }); } catch(_tds2){}
            try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'stairs', id: oldStairsId, coalesce: false }); } catch(_hpdStairs2){}
            if (typeof window.selectObject === 'function') { window.selectObject(null, { noRender: true }); }
            else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMd2) {} }
            updateStatus('Stairs deleted');
            try { __log3d('Deleted stairs'); } catch(_l4){}
            try { if (typeof window.updateLevelMenuStates==='function') window.updateLevelMenuStates(); } catch(_u){}
            return;
          }
        } catch(_delS){}
        
        var pergolaIndex = -1;
        for (var i = 0; i < pergolaComponents.length; i++) {
          if (pergolaComponents[i].id === selectedRoomId) {
            pergolaIndex = i;
            break;
          }
        }
        
        if (pergolaIndex > -1) {
          var pergola = pergolaComponents[pergolaIndex];
          pergolaComponents.splice(pergolaIndex, 1);
          try { __rtActionPush({ kind:'3d-delete', target:'pergola', id: pergola.id, level:(pergola.level||0) }); } catch(_tdp){}
          try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'pergola', id: pergola.id, coalesce: false }); } catch(_hpdPerg){}
          if (typeof window.selectObject === 'function') { window.selectObject(null, { noRender: true }); }
          else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMp) {} }
          updateStatus(pergola.name + ' deleted');
          try { __log3d('Deleted pergola'); } catch(_l5){}
          return;
        }
        
        var balconyIndex = -1;
        for (var i = 0; i < balconyComponents.length; i++) {
          if (balconyComponents[i].id === selectedRoomId) {
            balconyIndex = i;
            break;
          }
        }
        
        if (balconyIndex > -1) {
          var balcony = balconyComponents[balconyIndex];
          balconyComponents.splice(balconyIndex, 1);
          try { __rtActionPush({ kind:'3d-delete', target:'balcony', id: balcony.id, level:(balcony.level||0) }); } catch(_tdb){}
          try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'balcony', id: balcony.id, coalesce: false }); } catch(_hpdBalc){}
          if (typeof window.selectObject === 'function') { window.selectObject(null, { noRender: true }); }
          else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMb) {} }
          updateStatus(balcony.name + ' deleted');
          try { __log3d('Deleted balcony'); } catch(_l6){}
          return;
        }
        
        var garageIndex = -1;
        for (var i = 0; i < garageComponents.length; i++) {
          if (garageComponents[i].id === selectedRoomId) {
            garageIndex = i;
            break;
          }
        }
        
        if (garageIndex > -1) {
          var garage = garageComponents[garageIndex];
          garageComponents.splice(garageIndex, 1);
          try { __rtActionPush({ kind:'3d-delete', target:'garage', id: garage.id, level:(garage.level||0) }); } catch(_tdg){}
          try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'garage', id: garage.id, coalesce: false }); } catch(_hpdGar){}
          if (typeof window.selectObject === 'function') { window.selectObject(null, { noRender: true }); }
          else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMg) {} }
          updateStatus(garage.name + ' deleted');
          try { __log3d('Deleted garage'); } catch(_l7){}
          return;
        }
        
        var poolIndex = -1;
        for (var i = 0; i < poolComponents.length; i++) {
          if (poolComponents[i].id === selectedRoomId) {
            poolIndex = i;
            break;
          }
        }
        if (poolIndex > -1) {
          var pool = poolComponents[poolIndex];
          poolComponents.splice(poolIndex, 1);
          selectedRoomId = null;
          updateStatus(pool.name + ' deleted');
          try { __log3d('Deleted pool'); } catch(_l8){}
          try { __rtActionPush({ kind:'3d-delete', target:'pool', id: pool.id, level:(pool.level||0) }); } catch(_tdpl){}
          try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'pool', id: pool.id, coalesce: false }); } catch(_hpdPool){}
          return;
        }
        
        var roofIndex = -1;
        for (var i = 0; i < roofComponents.length; i++) {
          if (roofComponents[i].id === selectedRoomId) {
            roofIndex = i;
            break;
          }
        }
        
        if (roofIndex > -1) {
          var roof = roofComponents[roofIndex];
          roofComponents.splice(roofIndex, 1);
          selectedRoomId = null;
          updateStatus(roof.name + ' deleted');
          try { __log3d('Deleted roof'); } catch(_l9){}
          try { __rtActionPush({ kind:'3d-delete', target:'roof', id: roof.id, level:(roof.level||0) }); } catch(_tdr){}
          try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'roof', id: roof.id, coalesce: false }); } catch(_hpdRoof){}
          return;
        }
        
        var furnIndex = -1;
        for (var i = 0; i < furnitureItems.length; i++) {
          if (furnitureItems[i].id === selectedRoomId) { furnIndex = i; break; }
        }
        if (furnIndex > -1) {
          var furn = furnitureItems[furnIndex];
          furnitureItems.splice(furnIndex, 1);
          selectedRoomId = null;
          updateStatus((furn.name || 'Item') + ' deleted');
          try { __log3d('Deleted furniture'); } catch(_l10){}
          try { __rtActionPush({ kind:'3d-delete', target:'furniture', id: furn.id, level:(furn.level||0) }); } catch(_tdf){}
          try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'furniture', id: furn.id, coalesce: false }); } catch(_hpdFurn){}
          return;
        }
        // If a wall strip is selected (and no object matched), delete it
        if (typeof selectedWallStripIndex === 'number' && selectedWallStripIndex > -1) {
          var del = wallStrips[selectedWallStripIndex];
          if (del) {
            wallStrips.splice(selectedWallStripIndex, 1);
            selectedWallStripIndex = -1;
            selectedRoomId = null;
            saveProjectSilently();
            renderLoop();
            updateStatus('Wall deleted');
            try { __log3d('Deleted wall strip'); } catch(_l11){}
            try { __rtActionPush({ kind:'3d-delete', target:'wall-strip' }); } catch(_tdw){}
            try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-delete', { target: 'wall-strip', coalesce: false }); } catch(_hpdWall){}
            return;
          }
        }
        
        updateStatus('Cannot delete - select an object first');
        try { __log3d('Delete ignored: nothing selected'); } catch(_l12){}
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Nudge selected 3D object by 0.1m (hold Shift for 1.0m)
        // Ignore when nothing is selected or when a wall strip (not an object) is selected
        if (!selectedRoomId) { return; }
        // Do not hijack arrows while typing in inputs (already handled above), but prevent page scroll here
        e.preventDefault();
        try {
          var obj = (typeof findObjectById==='function') ? findObjectById(selectedRoomId) : null;
          if (!obj) { updateStatus('No object selected'); return; }
          var step = e.shiftKey ? 1.0 : 0.1; // meters
          var dx = 0, dz = 0;
          if (e.key === 'ArrowLeft') dx = -step;
          else if (e.key === 'ArrowRight') dx = step;
          else if (e.key === 'ArrowUp') dz = -step;    // Up = move toward negative Z (north)
          else if (e.key === 'ArrowDown') dz = step;   // Down = move toward positive Z (south)
          // Apply
          obj.x = (obj.x || 0) + dx;
          obj.z = (obj.z || 0) + dz;
          // Optional: record runtime action
          try { __rtActionPush && __rtActionPush({ kind:'3d-move', id: obj.id, dx:dx, dz:dz, level:(obj.level||0) }); } catch(_ta){}
          try { if (typeof window.historyPushChange === 'function') window.historyPushChange('3d-move', { coalesce: true, coalesceKey: obj.id }); } catch(_hpcMove){}
          // Keep UI awake and update panels/labels immediately
          try { window._uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now(); } catch(_tui){}
          try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_em){}
          try { if (typeof updateLabels==='function') updateLabels(); } catch(_el){}
          try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_ev){}
          // Re-render
          try { window._needsFullRender = true; if (typeof renderLoop==='function') renderLoop(); } catch(_er){}
          // Status
          try { updateStatus('Moved ' + (dx!==0? ('X '+(dx>0?'+':'')+dx.toFixed(2)+'m') : ('Z '+(dz>0?'+':'')+dz.toFixed(2)+'m'))); } catch(_es){}
        } catch(_move) { /* non-fatal */ }
      }
    });
  };
})();
