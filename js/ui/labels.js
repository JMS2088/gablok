// ui/labels.js
// Centralized DOM labels system for 3D rooms.
// Responsibilities:
// - Render and reconcile room name pills anchored to 3D positions
// - Provide click-to-select, drag-by-label, and an Edit button that opens the room palette
// - Respect global UI fade alpha (__uiFadeAlpha) for visibility transitions
// Inputs/Deps:
// - project3D(x,y,z): projects world to screen (in device pixels)
// - allRooms[]: array of rooms with { id, name, x, z, width, depth, height, level }
// - window.selectedRoomId: current selection
// - window.openRoomPalette(id), window.renderLoop(), window.updateStatus()
// - Global container div#labels-3d in DOM; CSS enables pointer-events on pills/buttons only
(function(){
  // Always provide the authoritative labels implementation.
  // If a stub exists (from engine bootstrap), override it.
  window.updateLabels = function updateLabels(){
    try {
      var container = document.getElementById('labels-3d'); if(!container) return;
      var nowT = (performance && performance.now)? performance.now(): Date.now();
      if (!window.__labelCache) window.__labelCache = Object.create(null);
      var focusId = null;
      try {
        if (typeof window.__focusUntilTime==='number' && window.__focusUntilTime > nowT && window.__focusRoomId) focusId = window.__focusRoomId;
        else if (window.__hoverRoomId) focusId = window.__hoverRoomId;
      } catch(_e) {}
      // keyed reconciliation by id
  var existingLabel = {}, existingEdit = {}, existingRotate = {};
      Array.prototype.forEach.call(container.querySelectorAll('.room-label'), function(el){ var id = el.getAttribute('data-id'); if(id) existingLabel[id] = el; });
      Array.prototype.forEach.call(container.querySelectorAll('.room-edit-btn'), function(el){ var id = el.getAttribute('data-id'); if(id) existingEdit[id] = el; });
  Array.prototype.forEach.call(container.querySelectorAll('.roof-rotate-btn'), function(el){ var id = el.getAttribute('data-id'); if(id) existingRotate[id] = el; });
      var seen = {};

      function anchorYFor(obj){
        try {
          var lvlY = ((obj.level||0) * 3.5);
          if (obj.type === 'roof') {
            return (obj.baseHeight||3.0) + (obj.height||0.6)/2;
          }
          if (obj.type === 'pergola') {
            return (obj.totalHeight!=null ? (obj.totalHeight/2) : (obj.height||2.2)/2);
          }
          if (obj.type === 'pool') {
            // Pools are below ground; anchor just above ground
            return Math.max(0.0, (obj.anchorY!=null? obj.anchorY : 0.2));
          }
          if (obj.type === 'stairs') {
            // Place label closer to the lower portion of the stairs so it appears near the geometry
            var h = (obj.height!=null ? obj.height : 3.0);
            // Aim around 0.8–1.0m above the floor, capped relative to total height
            var rel = Math.min(1.0, Math.max(0.5, h * 0.35));
            return lvlY + rel;
          }
          if (obj.type === 'furniture') {
            var elev = Math.max(0, obj.elevation||0);
            return lvlY + elev + (obj.height||0.7)/2;
          }
          // rooms, stairs, garage, balcony default
          return lvlY + (obj.height!=null ? obj.height/2 : 1.5);
        } catch(e){ return (obj.level||0)*3.5 + 1.5; }
      }

      function dragTypeFor(obj){
        var t = (obj && obj.type) || 'room';
        if (t==='room' || t==='balcony' || t==='stairs' || t==='pergola' || t==='garage' || t==='pool' || t==='roof' || t==='furniture') return t;
        return 'room';
      }

      function stairsLabelAnchor(obj){
        try {
          var stepsCount = Math.max(1, Math.floor(obj.steps || 19));
          var stepHeight = (obj.height || 3.0) / stepsCount;
          // Depth distribution with the 9th step (index 8) weighted deeper to match renderer
          var stepWeights = new Array(stepsCount);
          for (var wi=0; wi<stepsCount; wi++) stepWeights[wi] = (wi === 8 ? 5 : 1);
          var sumW = 0; for (var sw=0; sw<stepsCount; sw++) sumW += stepWeights[sw];
          var perStepDepth = new Array(stepsCount);
          for (var ps=0; ps<stepsCount; ps++) perStepDepth[ps] = (sumW > 0 ? ((obj.depth||1) * stepWeights[ps] / sumW) : ((obj.depth||1) / stepsCount));
          // Target the middle of the stairs (around step 9-10 for 19 steps)
          var targetIdx = Math.max(0, Math.min(stepsCount-1, Math.floor(stepsCount / 2)));
          var cum = 0; for (var i=0;i<targetIdx;i++) cum += perStepDepth[i];
          var localZ = - (obj.depth||1)/2 + cum + perStepDepth[targetIdx] * 0.5;
          var rot = ((obj.rotation||0) * Math.PI) / 180;
          var dx = 0, dz = localZ;
          var worldX = (obj.x||0) + dx * Math.cos(rot) - dz * Math.sin(rot);
          var worldZ = (obj.z||0) + dx * Math.sin(rot) + dz * Math.cos(rot);
          var lvlY = ((obj.level||0) * 3.5);
          var worldY = lvlY + (targetIdx + 1) * stepHeight + 0.05; // a touch above the tread
          return { x: worldX, y: worldY, z: worldZ };
        } catch(e){ return { x: obj.x||0, y: ((obj.level||0)*3.5) + Math.min(1.0, (obj.height||3.0)*0.35), z: obj.z||0 }; }
      }

      function placeLabelFor(box){
        if(!box || !box.id) return;
        var anchorPos;
        if (box.type === 'stairs') {
          anchorPos = stairsLabelAnchor(box);
        } else {
          anchorPos = { x: box.x||0, y: anchorYFor(box), z: box.z||0 };
        }
        var p = project3D(anchorPos.x, anchorPos.y, anchorPos.z); if(!p) return;
        var dpr = window.devicePixelRatio||1;
        var targetLeft = (p.x / dpr), targetTop = (p.y / dpr);

        // Label pill
        var el = existingLabel[box.id];
        if(!el){
          el = document.createElement('div');
          el.className='room-label';
          el.setAttribute('data-id', box.id);
          el.textContent = box.name || 'Room'; el.__txt = (box.name || 'Room'); el.__w = null; el.__h = null;
          // Select on click (also switch to the object's floor without clearing selection)
          el.addEventListener('click', function(e){
            e.preventDefault();
            e.stopPropagation();
            try {
              // Preserve selection
              window.selectedRoomId = box.id;
              // Ensure measurements panel stays visible on selection
              try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
              // If the item lives on a different floor, switch currentFloor directly (avoid switchLevel() which clears selection)
              var lvl = (typeof box.level === 'number' && isFinite(box.level)) ? box.level : 0;
              if (typeof window.currentFloor === 'number' && window.currentFloor !== lvl) {
                window.currentFloor = lvl;
                try {
                  var nativeSel = document.getElementById('levelSelect'); if (nativeSel) nativeSel.value = String(lvl);
                  var btnText = document.getElementById('levelButtonText'); if (btnText) btnText.textContent = (lvl === 1 ? 'First Floor' : 'Ground Floor');
                } catch(_ui) {}
              }
              if (typeof updateStatus==='function') updateStatus((box.name||'Item')+' selected');
              if (typeof renderLoop==='function') renderLoop();
            } catch(_) {}
          });
          // Drag room by label
          var startDrag = function(clientX, clientY){
            try {
              window.selectedRoomId = box.id;
              try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
              window.mouse.dragType = dragTypeFor(box);
              window.mouse.dragInfo = { roomId: box.id, startX: clientX, startY: clientY, originalX: box.x, originalZ: box.z };
              window.mouse.down = true;
              try { if (canvas) canvas.style.cursor = 'grabbing'; } catch(_e){}
              window._uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now();
            } catch(_e){}
          };
          el.addEventListener('mousedown', function(e){ e.preventDefault(); e.stopPropagation();
            // Ensure drag happens on the correct floor
            try { var lvl = (typeof box.level === 'number' && isFinite(box.level)) ? box.level : 0; if (typeof window.currentFloor==='number' && window.currentFloor !== lvl){ window.currentFloor = lvl; var nativeSel=document.getElementById('levelSelect'); if(nativeSel) nativeSel.value=String(lvl); var btnText=document.getElementById('levelButtonText'); if(btnText) btnText.textContent = (lvl===1 ? 'First Floor' : 'Ground Floor'); } } catch(_e) {}
            startDrag(e.clientX, e.clientY);
          });
          el.addEventListener('touchstart', function(e){ try{ var t=e.touches&&e.touches[0]; if(t){ startDrag(t.clientX, t.clientY); e.preventDefault(); e.stopPropagation(); } }catch(_e){} }, { passive:false });
          container.appendChild(el);
        } else {
          var newTxt = (box.name || 'Room');
          if (el.__txt !== newTxt) { el.textContent = newTxt; el.__txt = newTxt; el.__w = null; el.__h = null; }
        }
        // Smooth placement to reduce jitter while camera is moving
        var prev = window.__labelCache[box.id] || { x: targetLeft, y: targetTop };
        var isCamDrag = !!(window.mouse && window.mouse.down && window.mouse.dragType === 'camera');
        var recentlyMoved = (typeof window._camLastMoveTime==='number') ? (nowT - window._camLastMoveTime < 80) : false;
        var k = (isCamDrag || recentlyMoved) ? 0.25 : 1.0; // stronger smoothing while moving
        var smX = prev.x + (targetLeft - prev.x) * k;
        var smY = prev.y + (targetTop - prev.y) * k;
        window.__labelCache[box.id] = { x: smX, y: smY };
        var left = smX, top = smY;
  var objA = (typeof window.getObjectUiAlpha === 'function') ? window.getObjectUiAlpha(box.id) : 1.0;
  var globalA = Math.max(0, Math.min(1, (window.__uiFadeAlpha||1.0)));
  el.style.left = left.toFixed(2) + 'px'; el.style.top = top.toFixed(2) + 'px';
  // Exclude name labels from all fades (global inactivity and per-object focus dimming)
  // Keep labels always fully visible so the user can click to select items even when unfocused.
  el.style.opacity = '1';

        // Ensure label doesn't sit on top of this object's handles: nudge away from overlapping handle circles
        try {
          var skipAvoid = !!(window.mouse && window.mouse.down && window.mouse.dragType === 'camera');
          var handles = Array.isArray(window.resizeHandles) ? window.resizeHandles.filter(function(h){ return h && h.roomId === box.id; }) : [];
          if (handles.length && !skipAvoid) {
            // Use current rect to know size; fallback to approx if not measurable yet
            var w = Math.max(40, (el.__w || 0) || 60), h = Math.max(18, (el.__h || 0) || 22);
            var posX = left, posY = top;
            function overlapsAny(x, y){
              var Lx = x - w/2, Rx = x + w/2, Ty = y - h/2, By = y + h/2;
              for (var hi=0; hi<handles.length; hi++){
                var hh = handles[hi];
                var hx = (hh.screenX + hh.width/2) / dpr; var hy = (hh.screenY + hh.height/2) / dpr;
                var hr = Math.max(hh.width, hh.height) / (2*dpr);
                // Circle-rect overlap test: clamp circle center to rect
                var cx = Math.max(Lx, Math.min(hx, Rx));
                var cy = Math.max(Ty, Math.min(hy, By));
                var dx = hx - cx, dy = hy - cy; if ((dx*dx + dy*dy) <= (hr*hr)) return { overlap:true, hx:hx, hy:hy };
              }
              return { overlap:false };
            }
            var tries = 0, maxTries = 4; var step = 20;
            while (tries < maxTries){
              var ov = overlapsAny(posX, posY); if (!ov.overlap) break;
              // Push away from the nearest overlapping handle center
              var dx = posX - ov.hx, dy = posY - ov.hy; var len = Math.hypot(dx,dy) || 1; posX += (dx/len) * step; posY += (dy/len) * step; tries++;
            }
            left = posX; top = posY;
            el.style.left = left + 'px'; el.style.top = top + 'px';
          }
        } catch(_e) {}

        // Edit button to the right of the label, vertically centered
        var eb = existingEdit[box.id];
        if (!eb) {
          eb = document.createElement('button');
          eb.className = 'room-edit-btn';
          eb.setAttribute('data-id', box.id);
          eb.type = 'button';
          eb.textContent = 'Edit';
          eb.addEventListener('click', function(e){ e.stopPropagation(); try{ if (typeof openRoomPalette==='function') openRoomPalette(box.id); else if (typeof updateStatus==='function') updateStatus('Room palette unavailable'); } catch(_e){} });
          container.appendChild(eb);
        }
        try {
          if (!el.__w || !el.__h) { var rectM = el.getBoundingClientRect(); el.__w = rectM.width; el.__h = rectM.height; }
          var rect = { width: el.__w, height: el.__h };
          var gap = 12; // base gap between pill and button
          var offsetRight = 25; // additional right shift requested
          var editLeft = left + (rect.width/2) + gap + offsetRight;
          var editTop = top; // align centers vertically
          eb.style.left = editLeft + 'px';
          eb.style.top = editTop + 'px';
        } catch(_e) {
          eb.style.left = (left + 32 + 25) + 'px';
          eb.style.top = top + 'px';
        }
  eb.style.opacity = String(Math.max(0, Math.min(1, objA * globalA)));

        // Roof rotate button (360°) above the label; rotates 45° per press
        if (box.type === 'roof') {
          var rb = existingRotate[box.id];
          if (!rb) {
            rb = document.createElement('button');
            rb.className = 'roof-rotate-btn';
            rb.setAttribute('data-id', box.id);
            rb.type = 'button';
            rb.title = 'Rotate roof 22.5°';
            // Match stairs label text (no degree symbol)
            rb.textContent = '360';
            rb.addEventListener('click', function(e){
              e.stopPropagation();
              try {
                var r = findObjectById(box.id); if (!r) return;
                var delta = 22.5;
                r.rotation = ((r.rotation || 0) + delta) % 360;
                if (typeof saveProjectSilently==='function') saveProjectSilently();
                if (typeof updateStatus==='function') updateStatus('Roof rotated ' + delta + '°');
                if (typeof renderLoop==='function') renderLoop();
              } catch(_rot){}
            });
            container.appendChild(rb);
          }
          try {
            var rSize = 32; var rRad = rSize/2; var rGap = 10;
            var rect2 = { width: (el.__w||60), height: (el.__h||22) };
            var rotLeft = left - rRad; // center align with label
            var rotTop = top - (rect2.height/2) - rGap - rRad; // above label
            rb.style.left = rotLeft + 'px';
            rb.style.top = rotTop + 'px';
            rb.style.opacity = String(Math.max(0, Math.min(1, objA * globalA)));
          } catch(_posRot){}
        }
        seen[box.id] = true;
      }

      // Rooms
      for (var i=0;i<(allRooms||[]).length;i++) placeLabelFor(allRooms[i]);
      // Stairs (single)
      if (window.stairsComponent) placeLabelFor(window.stairsComponent);
      // Other components
      var ARR = [ 'pergolaComponents', 'garageComponents', 'poolComponents', 'roofComponents', 'balconyComponents', 'furnitureItems' ];
      for (var ai=0; ai<ARR.length; ai++){
        var arr = window[ARR[ai]] || [];
        for (var j=0;j<arr.length;j++) placeLabelFor(arr[j]);
      }
      // Remove stale labels
      for (var id in existingLabel){ if(!seen[id]) { var n1 = existingLabel[id]; if(n1 && n1.parentNode===container) container.removeChild(n1); } }
  for (var id2 in existingEdit){ if(!seen[id2]) { var n2 = existingEdit[id2]; if(n2 && n2.parentNode===container) container.removeChild(n2); } }
  for (var id3 in existingRotate){ if(!seen[id3]) { var n3 = existingRotate[id3]; if(n3 && n3.parentNode===container) container.removeChild(n3); } }
    } catch(e) { /* non-fatal */ }
  };
})();
