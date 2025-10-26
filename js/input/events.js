// Input and interaction events extracted from app.js to slim the orchestrator
// Exposes window.setupEvents(), called by startApp() in engine3d.js
(function(){
  if (typeof window.setupEvents === 'function') return;
  window.setupEvents = function setupEvents() {
    window.addEventListener('resize', setupCanvas);
    // Track UI interactions so we can fade affordances when idle
    try {
      canvas.addEventListener('mousemove', function(){ _uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now(); });
      canvas.addEventListener('mousedown', function(){ _uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now(); });
      canvas.addEventListener('wheel', function(){ _uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now(); }, { passive: true });
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
            // Store side axis and sign so we know which face is being dragged
            sideAxis: (handle.type.indexOf('width') === 0 ? 'x' : (handle.type.indexOf('depth') === 0 ? 'z' : null)),
            sideSign: (handle.type.endsWith('+') ? 1 : (handle.type.endsWith('-') ? -1 : 0))
          };
          mouse.down = true;
          selectedRoomId = handle.roomId;
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
            target.width = newW;

            // Center is midpoint between opposite face and dragged face
            target.x = mouse.dragInfo.faceOppStart.x + (newW / 2) * (sX * axisXx);
            target.z = mouse.dragInfo.faceOppStart.z + (newW / 2) * (sX * axisXz);
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
            target.depth = newD;

            target.x = mouse.dragInfo.faceOppStart.x + (newD / 2) * (sZ * axisZx);
            target.z = mouse.dragInfo.faceOppStart.z + (newD / 2) * (sZ * axisZz);
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
