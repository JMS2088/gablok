// Input and interaction events extracted from app.js to slim the orchestrator
// Exposes window.setupEvents(), called by startApp() in engine3d.js
(function(){
  if (typeof window.setupEvents === 'function') return;
  window.setupEvents = function setupEvents() {
    window.addEventListener('resize', setupCanvas);
    // Track UI interactions so we can fade affordances when idle
    try {
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
          if (stairsComponent && (stairsComponent.level||0)===(currentFloor||0)) consider(stairsComponent);
          ['pergolaComponents','garageComponents','poolComponents','roofComponents','balconyComponents','furnitureItems'].forEach(function(k){ var arr=window[k]||[]; for(var i=0;i<arr.length;i++){ var o=arr[i]; if(!o) continue; if((o.level||0)===(currentFloor||0)) consider(o); }});
          // If nothing on current floor, consider all
          if (!bestId){ (allRooms||[]).forEach(consider); if(stairsComponent) consider(stairsComponent); ['pergolaComponents','garageComponents','poolComponents','roofComponents','balconyComponents','furnitureItems'].forEach(function(k){ var arr=window[k]||[]; for(var i=0;i<arr.length;i++) consider(arr[i]); }); }
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
          
          // Set global flag to prevent 2D->3D auto-apply during 3D drag
          window.__dragging3DRoom = true;
          console.log('🟢 START 3D DRAG - Flag set:', window.__dragging3DRoom, 'Room:', target.name || target.id);
          
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
          selectedRoomId = handle.roomId;
          try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
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
        }
      }
      
      // If not resizing a handle, try selecting a wall strip on current floor
      var hitIdx = hitTestWallStrips(mouseX, mouseY);
      if (hitIdx !== -1) {
        selectedWallStripIndex = hitIdx;
        selectedRoomId = null; // clear any object selection
        // Ensure keyboard events (Delete) reach us
        try { if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex','0'); canvas.focus({preventScroll:true}); } catch(_e) {}
        mouse.down = false; mouse.dragType = null; mouse.dragInfo = null;
        updateStatus('Wall selected');
        renderLoop();
        return;
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
        }
      } else if (mouse.dragType === 'stairs' && mouse.dragInfo) {
        if (stairsComponent) {
          var dx = e.clientX - mouse.dragInfo.startX;
          var dy = e.clientY - mouse.dragInfo.startY;
          var movement = worldMovement(dx, dy);
          var newX = mouse.dragInfo.originalX + movement.x;
          var newZ = mouse.dragInfo.originalZ + movement.z;
          var snap = applySnap({x: newX, z: newZ, width: stairsComponent.width, depth: stairsComponent.depth, level: stairsComponent.level, id: stairsComponent.id, type: 'stairs'});
          stairsComponent.x = snap.x;
          stairsComponent.z = snap.z;
          currentSnapGuides = snap.guides;
          updateStatus('Moving ' + stairsComponent.name + '...');
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
        var target = findObjectById(selectedRoomId);
        if (target) {
          // Rotation handle
          if (mouse.dragInfo.handle.type === 'rotate') {
            if (typeof target.rotation !== 'number') target.rotation = 0;
            var step = target.type === 'garage' ? 90 : 22.5;
            target.rotation = (target.rotation + step) % 360;
            renderLoop();
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
          } else if (type === 'height') {
            var heightChange = -(dy * 0.005);
            var maxH = (target.type === 'pool') ? 5 : 10;
            target.height = clamp(target.height + heightChange, 0.5, maxH);
            updateStatus('Resizing height...');
          }

          renderLoop();
        }
      } else if (mouse.dragType === 'camera' && mouse.down) {
        var dx = e.clientX - mouse.lastX;
        var dy = e.clientY - mouse.lastY;
        if (e.shiftKey) {
          pan.x += dx * 1.5;
          pan.y += dy * 1.5;
        } else {
          camera.yaw += dx * 0.008;
          camera.pitch -= dy * 0.008;
          camera.pitch = Math.max(camera.minPitch, Math.min(camera.maxPitch, camera.pitch));
        }
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
      }
    });
    
    document.addEventListener('mouseup', function() {
      // If we just finished resizing OR moving a room, sync to 2D and save
      if ((mouse.dragType === 'handle' || mouse.dragType === 'room' || mouse.dragType === 'balcony') && mouse.dragInfo && mouse.dragInfo.roomId) {
        try {
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
            
            // IMMEDIATELY rebuild 3D from the fresh 2D plan to apply the new center and coordinates
            // This ensures openings get updated with the correct positions before any other code runs
            if (typeof applyPlan2DTo3D === 'function') {
              console.log('🔧 Rebuilding 3D from fresh 2D plan after drag');
              var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
              applyPlan2DTo3D(snap, { allowRooms:true, quiet:true, level: lvl, nonDestructive:true });
            }
            
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
      e.preventDefault();
      camera.distance *= e.deltaY > 0 ? 1.08 : 0.92;
      camera.distance = Math.max(camera.minDistance, Math.min(camera.maxDistance, camera.distance));
    });
    
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var rpm = document.getElementById('room-palette-modal');
        if (rpm && rpm.style.display === 'block') {
          hideRoomPalette();
        } else {
          selectedRoomId = null;
          selectedWallStripIndex = -1;
          updateStatus('Selection cleared');
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedRoomId || (typeof selectedWallStripIndex==='number' && selectedWallStripIndex>-1))) {
        e.preventDefault();
        
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
          selectedRoomId = null;
          updateStatus(room.name + ' deleted');
          return;
        }
        
        if (stairsComponent && stairsComponent.id === selectedRoomId) {
          stairsComponent = null;
          selectedRoomId = null;
          updateStatus('Stairs deleted');
          return;
        }
        
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
          selectedRoomId = null;
          updateStatus(pergola.name + ' deleted');
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
          selectedRoomId = null;
          updateStatus(balcony.name + ' deleted');
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
          selectedRoomId = null;
          updateStatus(garage.name + ' deleted');
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
            return;
          }
        }
        
        updateStatus('Cannot delete - select an object first');
      }
    });
  };
})();
