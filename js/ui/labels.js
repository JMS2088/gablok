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
    // Fixed placement: no smoothing, use direct projected position
    var left = targetLeft, top = targetTop;
        var objA = (typeof window.getObjectUiAlpha === 'function') ? window.getObjectUiAlpha(box.id) : 1.0;
        var globalA = Math.max(0, Math.min(1, (window.__uiFadeAlpha||1.0)));
  var cssLeft = Math.round(left), cssTop = Math.round(top);
  el.style.left = cssLeft + 'px'; el.style.top = cssTop + 'px';
        // Labels must always be visible and clickable (do not fade out other labels)
        el.style.opacity = '1';
        el.style.pointerEvents = '';

        // Keep label in fixed anchor; do not nudge away from handles

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
          var offsetRight = 25; // default extra shift
          var editLeft = Math.round(left + (rect.width/2) + gap + offsetRight);
          var editTop = Math.round(top); // center aligned vertically
          eb.style.left = editLeft + 'px';
          eb.style.top = editTop + 'px';
        } catch(_e) {
          eb.style.left = Math.round(left + 32 + 25) + 'px';
          eb.style.top = Math.round(top) + 'px';
        }
        // Show Edit only for the selected object; fade in via CSS transition
        if (!eb.__hudTransition) { eb.__hudTransition = true; eb.style.transition = 'opacity 150ms ease-out'; }
        (function(){
          var selId2 = (typeof window.selectedRoomId==='string' || typeof window.selectedRoomId==='number') ? window.selectedRoomId : null;
          if (selId2 && selId2 === box.id) {
            eb.style.opacity = String(Math.max(0, Math.min(1, 1 * globalA)));
            eb.style.pointerEvents = '';
          } else {
            eb.style.opacity = '0';
            eb.style.pointerEvents = 'none';
          }
        })();

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
            // Inline layout: [Label] [Rotate 360] [Edit]
            var rSize = 32, rRad = rSize/2; // rotate button is 32x32
            var gapInline = 10, gapAfterRotate = 12; // spacing between items
            var rect2 = { width: (el.__w||60), height: (el.__h||22) };
            // Center of rotate button: to the right of the label pill
            var rotCenterLeft = Math.round(left + (rect2.width/2) + gapInline + rRad);
            var rotCenterTop = Math.round(top);
            rb.style.left = rotCenterLeft + 'px';
            rb.style.top = rotCenterTop + 'px';
            // Show Rotate only for the selected roof; hide otherwise (transition handled in CSS of the element)
            var selId3 = (typeof window.selectedRoomId==='string' || typeof window.selectedRoomId==='number') ? window.selectedRoomId : null;
            if (selId3 && selId3 === box.id) {
              rb.style.opacity = String(Math.max(0, Math.min(1, 1 * globalA)));
              rb.style.pointerEvents = '';
            } else {
              rb.style.opacity = '0';
              rb.style.pointerEvents = 'none';
            }
            // Move the Edit button to the right of the rotate button, aligned center
            var editHalf = 22; // room-edit-btn min width is 44px; use half for center offset
            var ebCenterLeft = Math.round(rotCenterLeft + rRad + gapAfterRotate + editHalf);
            eb.style.left = ebCenterLeft + 'px';
            eb.style.top = Math.round(top) + 'px';
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

      // After reconciling labels, draw canvas handles for the selected item only (unified here).
      try { drawSelectedHandlesUnified(); } catch(_hud){ /* non-fatal */ }
    } catch(e) { /* non-fatal */ }
  };

  // Centralized handle drawing for selected object only.
  function drawSelectedHandlesUnified(){
    try {
      if (!window.canvas || !window.ctx) return;
      var sid = window.selectedRoomId; if (!sid) { window.resizeHandles = []; return; }
      var o = (typeof window.findObjectById==='function') ? window.findObjectById(sid) : null; if (!o) { window.resizeHandles = []; return; }
      if (!Array.isArray(window.resizeHandles)) window.resizeHandles = [];
      // Clear previous frame's hit regions
      window.resizeHandles.length = 0;

      var isActive = true;
      var objA = (typeof window.getObjectUiAlpha==='function') ? window.getObjectUiAlpha(o.id) : 1.0;
      var gA = (typeof window.__uiFadeAlpha==='number') ? window.__uiFadeAlpha : 1.0;
      // Fade-in on selection change
      var nowT = (performance && performance.now)? performance.now(): Date.now();
      if (window.__hudPrevSelId !== sid) { window.__hudPrevSelId = sid; window.__hudSelChangeTime = nowT; }
      var t0 = (typeof window.__hudSelChangeTime==='number') ? window.__hudSelChangeTime : nowT;
      var fadeIn = Math.max(0, Math.min(1, (nowT - t0) / 220));
      var alpha = Math.max(0, Math.min(1, objA * gA * fadeIn)); if (alpha <= 0) return;

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
