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
  // Unified HUD controls: labels, overlay buttons, and canvas handles in one module.
  // Enable unified handle drawing and disable per-renderer handle drawing.
  window.__useUnifiedHUDHandles = true;
  // Global flags for visibility modes
  window.__labelsHidden = false;
  window.__cleanViewActive = false;

  // Public toggles -------------------------------------------------
  window.toggleLabelsVisibility = function(){
    try {
      window.__labelsHidden = !window.__labelsHidden;
      var body = document.body; if(!body) return;
      body.classList.toggle('hide-labels', window.__labelsHidden);
      // Force labels redraw removal if hiding, but still trigger updateLabels to draw handles
      if(window.__labelsHidden){
        var c = document.getElementById('labels-3d'); if(c){ while(c.firstChild) c.removeChild(c.firstChild); }
      }
      // Always call updateLabels (it will draw handles even when labels are hidden)
      if(typeof window.updateLabels==='function') window.updateLabels();
      // Update button text if present
      try { var btn=document.getElementById('btn-hide-labels'); if(btn) btn.textContent = window.__labelsHidden? 'Show Labels':'Hide Labels'; }catch(_btxt){}
    }catch(_tLbl){}
  };
  window.toggleCleanView = function(){
    try {
      window.__cleanViewActive = !window.__cleanViewActive;
      var body=document.body; if(!body) return;
      body.classList.toggle('clean-view', window.__cleanViewActive);
      // When entering Clean View, hide labels; when exiting, ALWAYS show labels
      if(window.__cleanViewActive){
        window.__labelsHidden = true;
        body.classList.add('hide-labels');
        // Also enable debug flags while in Clean View and remember previous states
        try {
          window.__prevDbgHandles = (window.__enableCornerHandles === true);
          window.__prevDbgLogs = (window.__debugCornerCache === true);
          window.__enableCornerHandles = true;
          window.__debugCornerCache = true;
          // Reflect in Debug dropdown checkboxes if present
          try { var chkH = document.getElementById('chk-corner-handles'); if (chkH) chkH.checked = true; } catch(_eH) {}
          try { var chkD = document.getElementById('chk-corner-debug'); if (chkD) chkD.checked = true; } catch(_eD) {}
        } catch(_eDbgSet) {}
      } else {
        window.__labelsHidden = false;
        body.classList.remove('hide-labels');
        // Restore previous debug flags when exiting Clean View
        try {
          var prevH = (window.__prevDbgHandles === true);
          var prevD = (window.__prevDbgLogs === true);
          window.__enableCornerHandles = !!prevH;
          window.__debugCornerCache = !!prevD;
          // Update checkboxes accordingly
          try { var chkH2 = document.getElementById('chk-corner-handles'); if (chkH2) chkH2.checked = !!prevH; } catch(_eH2) {}
          try { var chkD2 = document.getElementById('chk-corner-debug'); if (chkD2) chkD2.checked = !!prevD; } catch(_eD2) {}
        } catch(_eDbgRestore) {}
      }
      // Redraw - always call updateLabels (it will draw handles even when labels are hidden)
      try { if(typeof renderLoop==='function') renderLoop(); }catch(_rLoop){}
      if(typeof window.updateLabels==='function') window.updateLabels();
      try { var btn=document.getElementById('btn-clean-view'); if(btn) btn.textContent = window.__cleanViewActive? 'Exit Clean View':'Clean View'; }catch(_btxt2){}
    }catch(_tCV){}
  };
  // Always provide the authoritative labels implementation.
  // If a stub exists (from engine bootstrap), override it.
  window.updateLabels = function updateLabels(){
    try {
      var container = document.getElementById('labels-3d'); if(!container) return;
  // Respect global hide-labels flag - but still draw handles even if labels are hidden
  if(window.__labelsHidden){
    while(container.firstChild) container.removeChild(container.firstChild);
    // Still draw handles even when labels are hidden (handles are essential for manipulation)
    try { drawSelectedHandlesUnified(); } catch(_hud){}
    return;
  }
      // When the 2D floor plan is active, remove all DOM labels/buttons from the 2D area.
      try {
        if (window.__plan2d && __plan2d.active) {
          while (container.firstChild) container.removeChild(container.firstChild);
          return;
        }
      } catch(_hide2d) {}
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
            // Middle-center vertically for stairs label
            var h = (obj.height!=null ? obj.height : 3.0);
            return lvlY + (h/2);
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
        // Anchor labels to the object's center for all types so UI does not shift when rotating
        var anchorPos = { x: box.x||0, y: anchorYFor(box), z: box.z||0 };
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
              var lvl = (typeof box.level === 'number' && isFinite(box.level)) ? box.level : 0;
              if (typeof window.currentFloor === 'number' && window.currentFloor !== lvl) {
                window.currentFloor = lvl;
                try {
                  var nativeSel = document.getElementById('levelSelect'); if (nativeSel) nativeSel.value = String(lvl);
                  var btnText = document.getElementById('levelButtonText');
                  if (typeof window.setLevelButtonLabel === 'function') { window.setLevelButtonLabel(lvl); }
                  else if (btnText) { btnText.textContent = (lvl === 1 ? 'First Floor' : 'Ground Floor'); }
                } catch(_ui) {}
              }
              if (typeof window.selectObject==='function') window.selectObject(box.id, { noRender: true });
              if (typeof updateStatus==='function') updateStatus((box.name||'Item')+' selected');
              // Trigger a render after immediate UI updates
              if (typeof renderLoop==='function') renderLoop();
            } catch(_) {}
          });
          // Drag-by-label with movement threshold (don't start drag on simple click/tap)
          var dragActive = false, downX = 0, downY = 0, downT = 0;
          function beginPotentialDrag(clientX, clientY){
            dragActive = false; downX = clientX; downY = clientY; downT = (performance && performance.now)? performance.now(): Date.now();
            // Ensure floor alignment immediately (so selection/drag reflects correct floor)
            try {
              var lvl = (typeof box.level === 'number' && isFinite(box.level)) ? box.level : 0;
              if (typeof window.currentFloor==='number' && window.currentFloor !== lvl){
                window.currentFloor = lvl;
                var nativeSel=document.getElementById('levelSelect'); if(nativeSel) nativeSel.value=String(lvl);
                var btnText=document.getElementById('levelButtonText');
                if (typeof window.setLevelButtonLabel === 'function') { window.setLevelButtonLabel(lvl); }
                else if (btnText) { btnText.textContent = (lvl===1 ? 'First Floor' : 'Ground Floor'); }
              }
            } catch(_e) {}
            // Attach move/up listeners to start drag only after threshold
            function onMove(ev){
              var cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX);
              var cy = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY);
              if (cx == null || cy == null) return;
              var dx = cx - downX, dy = cy - downY;
              if (!dragActive && (Math.abs(dx) > 3 || Math.abs(dy) > 3)){
                // Start actual drag now
                try {
                  if (typeof window.selectObject==='function') window.selectObject(box.id, { noRender: true });
                  window.mouse.dragType = dragTypeFor(box);
                  window.mouse.dragInfo = { roomId: box.id, startX: cx, startY: cy, originalX: box.x, originalZ: box.z };
                  window.mouse.down = true;
                  // Block 2D->3D auto-apply while dragging in 3D via label to avoid duplication
                  window.__dragging3DRoom = true;
                  // Track which room is actively dragged for targeted purge
                  try { window.__activelyDraggedRoomId = box.id; } catch(_adLbl) {}
                  try { console.log('🟢 START 3D DRAG (label) - Flag set:', window.__dragging3DRoom, 'Room:', box.name || box.id); } catch(_log){}
                  try { if (canvas) canvas.style.cursor = 'grabbing'; } catch(_e){}
                  // Kick an immediate perimeter rebuild in solid mode so the render follows from the first frame
                  try { if (typeof window.__maybeRebuildRoomStripsThrottled === 'function') window.__maybeRebuildRoomStripsThrottled(); } catch(_rb){}
                  window._uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now();
                  dragActive = true;
                } catch(_e2){}
              }
            }
            function onEnd(){
              try { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onEnd); } catch(_r){}
            }
            function onTouchEnd(){
              try { document.removeEventListener('touchmove', onMove, { passive:false }); document.removeEventListener('touchend', onTouchEnd); } catch(_r){}
              // If no drag occurred, treat as a tap selection
              if (!dragActive){
                try {
                  if (typeof window.selectObject==='function') window.selectObject(box.id, { noRender: true });
                  if (typeof updateStatus==='function') updateStatus((box.name||'Item')+' selected');
                  if (typeof renderLoop==='function') renderLoop();
                } catch(_sel){}
              }
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive:false });
            document.addEventListener('touchend', onTouchEnd);
          }
          // Disable drag-by-label when the 2D floor plan is active; allow normal click selection to proceed.
          el.addEventListener('mousedown', function(e){
            // Allow right-drag orbit to pass through labels to the canvas
            if (e && e.button === 2) {
              return; // don't intercept right-click; let canvas handle orbit
            }
            try{
              if (window.__plan2d && __plan2d.active) {
                // Do not prevent default so the click handler can still select the room if needed.
                return;
              }
            }catch(_pd){}
            e.preventDefault(); e.stopPropagation();
            beginPotentialDrag(e.clientX, e.clientY);
          });
          el.addEventListener('touchstart', function(e){
            try{
              if (window.__plan2d && __plan2d.active) {
                // While 2D is active, ignore drag starts from labels.
                return;
              }
              var t=e.touches&&e.touches[0];
              if(t){ beginPotentialDrag(t.clientX, t.clientY); e.preventDefault(); e.stopPropagation(); }
            }catch(_e){}
          }, { passive:false });
          container.appendChild(el);
        } else {
          var newTxt = (box.name || 'Room');
          if (el.__txt !== newTxt) { el.textContent = newTxt; el.__txt = newTxt; el.__w = null; el.__h = null; }
        }
    // Fixed placement: no smoothing, use direct projected position
    var left = targetLeft, top = targetTop;
        var objA = (typeof window.getObjectUiAlpha === 'function') ? window.getObjectUiAlpha(box.id) : 1.0;
        var globalA = Math.max(0, Math.min(1, (window.__uiFadeAlpha||1.0)));
        var cssLeft = Math.round(left), cssTop = Math.round(top);
        el.style.left = cssLeft + 'px'; el.style.top = cssTop + 'px';
        // Refined scaling: keep labels near a consistent UI size and damp extreme zoom effects.
        // Measure pixels per meter, then ease toward 1.0 so close zoom does not explode size.
        var meterPx = 60; // fallback baseline (approx 1m ~ 60px)
        try {
          var p2 = project3D(anchorPos.x + 1, anchorPos.y, anchorPos.z);
          if (p2 && typeof p2.x === 'number' && typeof p2.y === 'number') {
            meterPx = Math.max(1, Math.hypot(p2.x - p.x, p2.y - p.y));
          }
        } catch(_pm) {}
        var baseMeterPx = 60;
        var rawScale = meterPx / baseMeterPx;
        // Ease function: compress deviation (s-curve) then clamp narrowly
        var eased = 1 + (rawScale - 1) * 0.25; // only 25% of raw delta applied
        var scaleWorld = Math.max(0.85, Math.min(1.25, eased));
        el.__scaleWorld = scaleWorld;
        el.style.transform = 'translate(-50%, -50%) scale(' + scaleWorld.toFixed(4) + ')';
        // Labels must always be visible and clickable.
        // Policy: when viewing first floor, fade ground-floor labels slightly;
        // additionally, apply a distance-based fade so far labels recede a bit.
        var labelAlpha = 1.0;
        try {
          if (typeof window.currentFloor === 'number' && window.currentFloor === 1 && ((box.level||0) === 0)) {
            labelAlpha *= 0.6; // subtle fade for ground floor while on first floor
          }
        } catch(_fa) {}
        // Distance fade: compute camera-relative depth and fade between near/far thresholds
        try {
          var depth = (typeof p === 'object' && p && typeof p._cz === 'number') ? p._cz : ((window.camera && typeof camera.distance==='number') ? camera.distance : 12);
          var camD = (window.camera && typeof camera.distance==='number') ? camera.distance : 12;
          var nearD = Math.max(4, camD * 0.6); // full color until ~60% of current zoom distance
          var farD = Math.max(8, camD * 1.8);  // start to fade past ~180% of current zoom distance
          var minAlpha = 0.65;                 // keep labels readable even when far
          var t = 0;
          if (farD > nearD) t = Math.max(0, Math.min(1, (depth - nearD) / (farD - nearD)));
          var distAlpha = 1 - t * (1 - minAlpha); // lerp(1 -> minAlpha)
          // Keep selected label fully opaque for clarity
          var isSelected = (window.selectedRoomId && window.selectedRoomId === box.id);
          if (!isSelected) labelAlpha *= distAlpha;
        } catch(_df) {}
        el.style.opacity = String(Math.max(0, Math.min(1, labelAlpha)));
        el.style.pointerEvents = '';

        // Keep label in fixed anchor; do not nudge away from handles

        // Edit button to the right of the label, vertically centered
        var eb = existingEdit[box.id];
        if (!eb) {
          eb = document.createElement('button');
          eb.className = 'room-edit-btn';
          eb.setAttribute('data-id', box.id);
          eb.type = 'button';
          // Dynamic label: Roof objects use 'Roof Type'; others use 'Edit'
          eb.textContent = (box.type === 'roof') ? 'Roof Type' : 'Edit';
          eb.addEventListener('click', function(e){
            e.stopPropagation();
            try {
              if (box.type === 'roof') {
                // Open roof type dropdown UI (ensure module loaded)
                if (typeof window.openRoofTypeDropdown === 'function') {
                  window.openRoofTypeDropdown();
                } else if (typeof updateStatus === 'function') updateStatus('Roof controls not loaded');
              } else {
                if (typeof openRoomPalette === 'function') openRoomPalette(box.id);
                else if (typeof updateStatus === 'function') updateStatus('Room palette unavailable');
              }
            } catch(_eEdit){}
          });
          container.appendChild(eb);
        }
        try {
          if (!el.__w || !el.__h) { var rectM = el.getBoundingClientRect(); el.__w = rectM.width; el.__h = rectM.height; }
          var rect = { width: el.__w, height: el.__h };
          var sW = el.__scaleWorld || 1;
          // Buttons keep global style: do NOT scale size, only adjust position mildly.
          // Use globally tunable spacing constants (defined on window for rapid UI iteration)
          var gap = (typeof window.LABEL_GAP==='number'? window.LABEL_GAP : 12);
          var offsetRight = (typeof window.LABEL_EDIT_OFFSET==='number'? window.LABEL_EDIT_OFFSET : 17); // reduced from original 25
          var editLeft = Math.round(left + (rect.width * sW / 2) + gap + offsetRight);
          var editTop = Math.round(top); // center aligned vertically
          eb.style.left = editLeft + 'px';
          eb.style.top = editTop + 'px';
          eb.style.transform = 'translate(-50%, -50%)';
        } catch(_e) {
          eb.style.left = Math.round(left + 32 + 17) + 'px';
          eb.style.top = Math.round(top) + 'px';
        }
        // Show Edit only for the selected object; keep visible (no inactivity fade)
        if (!eb.__hudTransition) { eb.__hudTransition = true; eb.style.transition = 'opacity 150ms ease-out'; }
        (function(){
          var selId2 = (typeof window.selectedRoomId==='string' || typeof window.selectedRoomId==='number') ? window.selectedRoomId : null;
          if (selId2 && selId2 === box.id) {
            eb.style.opacity = '1';
            eb.style.pointerEvents = '';
            // Keep button text accurate if type changed post-creation (rare)
            var desired = (box.type === 'roof') ? 'Roof Type' : 'Edit';
            if (eb.textContent !== desired) eb.textContent = desired;
          } else {
            eb.style.opacity = '0';
            eb.style.pointerEvents = 'none';
          }
        })();

        // Rotate button (360°) for roof, stairs, and garage
        if (box.type === 'roof' || box.type === 'stairs' || box.type === 'garage') {
          var rb = existingRotate[box.id];
          if (!rb) {
            rb = document.createElement('button');
            rb.className = 'roof-rotate-btn'; // reuse style for all rotate buttons
            rb.setAttribute('data-id', box.id);
            rb.type = 'button';
            rb.textContent = '360';
            rb.addEventListener('click', function(e){
              e.stopPropagation();
              try {
                var r = findObjectById(box.id); if (!r) return;
                var delta = 45; // rotate by 45° for all types
                r.rotation = ((r.rotation || 0) + delta) % 360;
                if (typeof saveProjectSilently==='function') saveProjectSilently();
                if (typeof updateStatus==='function') updateStatus((r.name||'Item') + ' rotated ' + delta + '°');
                if (typeof renderLoop==='function') renderLoop();
              } catch(_rot){}
            });
            container.appendChild(rb);
          }
          try {
            // Title reflects step size
            rb.title = 'Rotate 45°';
            // Inline layout: [Label] [Rotate 360] [Edit]
            var rSize = 32, rRad = rSize/2; // rotate button is 32x32
            var gapInline = (typeof window.LABEL_ROTATE_GAP_INLINE==='number'? window.LABEL_ROTATE_GAP_INLINE : 10);
            var gapAfterRotate = (typeof window.LABEL_ROTATE_TO_EDIT_GAP==='number'? window.LABEL_ROTATE_TO_EDIT_GAP : 12); // spacing between rotate and edit
            var rect2 = { width: (el.__w||60), height: (el.__h||22) };
            var sW = el.__scaleWorld || 1;
            // Position uses damped label scale horizontally but button itself keeps base size.
            var rotCenterLeft = Math.round(left + (rect2.width * sW / 2) + gapInline + rRad);
            var rotCenterTop = Math.round(top);
            rb.style.left = rotCenterLeft + 'px';
            rb.style.top = rotCenterTop + 'px';
            rb.style.transform = 'translate(-50%, -50%)';
            // Show Rotate only for the selected item; keep visible (no inactivity fade)
            var selId3 = (typeof window.selectedRoomId==='string' || typeof window.selectedRoomId==='number') ? window.selectedRoomId : null;
            if (selId3 && selId3 === box.id) {
              rb.style.opacity = '1';
              rb.style.pointerEvents = '';
            } else {
              rb.style.opacity = '0';
              rb.style.pointerEvents = 'none';
            }
            // Move the Edit button to the right of the rotate button, aligned center
            var editHalf = 22;
            // Move the Edit button 8px closer to the label (leftwards) relative to rotate button
            var reduce = (typeof window.LABEL_EDIT_REDUCE==='number'? window.LABEL_EDIT_REDUCE : 8); // shift closer to label
            var ebCenterLeft = Math.round(rotCenterLeft + rRad + gapAfterRotate + editHalf - reduce);
            eb.style.left = ebCenterLeft + 'px';
            eb.style.top = Math.round(top) + 'px';
          } catch(_posRot){}
        }
        seen[box.id] = true;
      }

  // Rooms
      for (var i=0;i<(allRooms||[]).length;i++) placeLabelFor(allRooms[i]);
      // Stairs (multiple supported; fallback to singleton)
      (function(){
        try {
          var scArr = window.stairsComponents || [];
          if (Array.isArray(scArr) && scArr.length){ for (var si=0; si<scArr.length; si++){ placeLabelFor(scArr[si]); } }
          else if (window.stairsComponent) { placeLabelFor(window.stairsComponent); }
        } catch(_e) { if (window.stairsComponent) placeLabelFor(window.stairsComponent); }
      })();
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

      // After reconciling labels, draw canvas handles for the selected item only (unified here).
      try { drawSelectedHandlesUnified(); } catch(_hud){ /* non-fatal */ }
    } catch(e) { /* non-fatal */ }
  };

  // Centralized handle drawing for selected object only.
  function drawSelectedHandlesUnified(){
    try {
      if (!window.canvas || !window.ctx) return;
      // If a wall strip is selected, draw a center drag handle for moving it
      if (typeof window.selectedWallStripIndex === 'number' && window.selectedWallStripIndex > -1 && Array.isArray(window.wallStrips) && window.wallStrips[window.selectedWallStripIndex]) {
        if (!Array.isArray(window.resizeHandles)) window.resizeHandles = [];
        window.resizeHandles.length = 0;
        var ws = window.wallStrips[window.selectedWallStripIndex];
        var yMidW = (typeof ws.baseY==='number' ? ws.baseY : ((ws.level||0)*3.5)) + Math.min(Math.max(0.1, ws.height||3.0)*0.5, 1.2);
        var cx = ((ws.x0||0) + (ws.x1||0)) / 2;
        var cz = ((ws.z0||0) + (ws.z1||0)) / 2;
        var p = (typeof window.project3D==='function') ? window.project3D(cx, yMidW, cz) : null; if (!p) { window.resizeHandles = []; return; }
        var baseR = (typeof window.HANDLE_RADIUS==='number'? window.HANDLE_RADIUS : 14);
        var r = (typeof window.computeHandleRadius==='function') ? window.computeHandleRadius(p, baseR) : baseR;
        // Draw handle as a teal dot with label 'M'
        window.ctx.save(); var prevGA = window.ctx.globalAlpha; window.ctx.globalAlpha = prevGA * 1.0;
        if (typeof window.drawHandle==='function') window.drawHandle(p, 'move', 'M', true, r);
        window.ctx.restore();
        window.resizeHandles.push({ screenX: p.x - r, screenY: p.y - r, width: r*2, height: r*2, type: 'wall-move', wallIndex: window.selectedWallStripIndex });
        return; // Only draw wall handle in this mode
      }
      var sid = window.selectedRoomId; if (!sid) { window.resizeHandles = []; return; }
      var o = (typeof window.findObjectById==='function') ? window.findObjectById(sid) : null; if (!o) { window.resizeHandles = []; return; }
      if (!Array.isArray(window.resizeHandles)) window.resizeHandles = [];
      // Clear previous frame's hit regions
      window.resizeHandles.length = 0;

  var isActive = true;
  var objA = (typeof window.getObjectUiAlpha==='function') ? window.getObjectUiAlpha(o.id) : 1.0;
  // Selected HUD should not fade out with inactivity; ignore global UI fade for handles
  var gA = 1.0;
      // Fade-in on selection change
      var nowT = (performance && performance.now)? performance.now(): Date.now();
      if (window.__hudPrevSelId !== sid) { window.__hudPrevSelId = sid; window.__hudSelChangeTime = nowT; }
      var t0 = (typeof window.__hudSelChangeTime==='number') ? window.__hudSelChangeTime : nowT;
      var fadeIn = Math.max(0, Math.min(1, (nowT - t0) / 220));
  var alpha = Math.max(0, Math.min(1, objA * /*no inactivity fade*/ 1.0 * fadeIn)); if (alpha <= 0) return;

      // Helpers
      function rotPoint(dx, dz){
        var r = ((o.rotation||0) * Math.PI)/180; var c=Math.cos(r), s=Math.sin(r);
        return { x: (o.x||0) + dx*c - dz*s, z: (o.z||0) + dx*s + dz*c };
      }
      function centerY(){
        if (o.type==='roof') { var b=(typeof o.baseHeight==='number'?o.baseHeight:3.0), h=(typeof o.height==='number'?o.height:1.0); return b + h*0.5; }
        if (o.type==='pergola') { var th=(o.totalHeight!=null? o.totalHeight : (o.height||2.2)); return th*0.5; }
        if (o.type==='balcony') { var lv=(o.level||0)*3.5; return lv + (o.height||3.0)*0.5; }
        if (o.type==='garage') { return (o.height||2.6)*0.5; }
        if (o.type==='pool') { return 0.3; }
        if (o.type==='stairs') { return (o.height||3.0)*0.5; }
        // rooms/furniture
        var lvlY=(o.level||0)*3.5; return lvlY + (o.height!=null? o.height*0.5 : 1.5);
      }
      function halfW(){ return Math.max(0.25, (o.width||1)/2); }
      function halfD(){ return Math.max(0.25, (o.depth||1)/2); }

      // Build handles spec for selected object
      var yMid = centerY();
      var hw = halfW(), hd = halfD();
      var handles = [];
      // Per requirement: on selection, fade-in only X/Z handles
      // Placement functions may rotate for appropriate types
      function atX(sign){ var p = (o.type==='roof'||o.type==='garage'||o.type==='pool'||o.type==='stairs')? rotPoint(sign*hw,0) : { x:(o.x||0)+sign*hw, z:(o.z||0) }; return { x:p.x, y:yMid, z:p.z, type:(sign>0?'width+':'width-'), label:(sign>0?'X+':'X-')}; }
      function atZ(sign){ var p = (o.type==='roof'||o.type==='garage'||o.type==='pool'||o.type==='stairs')? rotPoint(0,sign*hd) : { x:(o.x||0), z:(o.z||0)+sign*hd }; return { x:p.x, y:yMid, z:p.z, type:(sign>0?'depth+':'depth-'), label:(sign>0?'Z+':'Z-')}; }
      handles.push(atX(+1), atX(-1), atZ(+1), atZ(-1));
      // No height/rotate handles in the label-selection fade-in per requirement

      // Draw all handles and register hit regions
      var cScreen = (typeof window.project3D==='function') ? window.project3D((o.x||0), yMid, (o.z||0)) : null;
      for (var i=0;i<handles.length;i++){
        var h = handles[i]; var s = (typeof window.project3D==='function') ? window.project3D(h.x,h.y,h.z) : null; if(!s) continue;
        // Inset toward center for planar X/Z handles
        if (cScreen && (h.type==='width+'||h.type==='width-'||h.type==='depth+'||h.type==='depth-')){
          var dx=cScreen.x - s.x, dy=cScreen.y - s.y; var L=Math.hypot(dx,dy)||1; s.x += (dx/L)*20; s.y += (dy/L)*20;
        }
        var baseR = (typeof window.HANDLE_RADIUS==='number'? window.HANDLE_RADIUS : 14);
        var r = (typeof window.computeHandleRadius==='function') ? window.computeHandleRadius(s, baseR) : baseR;
        window.ctx.save(); var prevGA = window.ctx.globalAlpha; window.ctx.globalAlpha = prevGA * alpha; if (typeof window.drawHandle==='function') window.drawHandle(s, h.type, h.label, isActive, r); window.ctx.restore();
        window.resizeHandles.push({ screenX: s.x - r, screenY: s.y - r, width: r*2, height: r*2, type: h.type, roomId: o.id });
      }
    } catch(e){ /* non-fatal */ }
  }
})();
