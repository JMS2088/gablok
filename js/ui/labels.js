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
  if (typeof window.updateLabels === 'function') {
    // Already provided elsewhere; honor single-source contract.
    return;
  }

  window.updateLabels = function updateLabels(){
    try {
      var container = document.getElementById('labels-3d'); if(!container) return;
      // keyed reconciliation by id
      var existingLabel = {}, existingEdit = {};
      Array.prototype.forEach.call(container.querySelectorAll('.room-label'), function(el){ var id = el.getAttribute('data-id'); if(id) existingLabel[id] = el; });
      Array.prototype.forEach.call(container.querySelectorAll('.room-edit-btn'), function(el){ var id = el.getAttribute('data-id'); if(id) existingEdit[id] = el; });
      var seen = {};

      function placeLabelFor(box){
        if(!box || !box.id) return;
        var y = (box.level||0)*3.5 + (box.height||3)/2;
        var p = project3D(box.x||0, y, box.z||0); if(!p) return;
        var dpr = window.devicePixelRatio||1;
        var left = (p.x / dpr)|0, top = (p.y / dpr)|0;

        // Label pill
        var el = existingLabel[box.id];
        if(!el){
          el = document.createElement('div');
          el.className='room-label';
          el.setAttribute('data-id', box.id);
          el.textContent = box.name || 'Room';
          // Select on click
          el.addEventListener('click', function(e){ e.stopPropagation(); try{ window.selectedRoomId = box.id; if(typeof updateStatus==='function') updateStatus((box.name||'Room')+' selected'); if (typeof renderLoop==='function') renderLoop(); }catch(_){} });
          // Drag room by label
          var startDrag = function(clientX, clientY){
            try {
              window.selectedRoomId = box.id;
              window.mouse.dragType = 'room';
              window.mouse.dragInfo = { roomId: box.id, startX: clientX, startY: clientY, originalX: box.x, originalZ: box.z };
              window.mouse.down = true;
              try { if (canvas) canvas.style.cursor = 'grabbing'; } catch(_e){}
              window._uiLastInteractionTime = (performance && performance.now) ? performance.now() : Date.now();
            } catch(_e){}
          };
          el.addEventListener('mousedown', function(e){ e.preventDefault(); e.stopPropagation(); startDrag(e.clientX, e.clientY); });
          el.addEventListener('touchstart', function(e){ try{ var t=e.touches&&e.touches[0]; if(t){ startDrag(t.clientX, t.clientY); e.preventDefault(); e.stopPropagation(); } }catch(_e){} }, { passive:false });
          container.appendChild(el);
        } else {
          if (el.textContent !== (box.name || 'Room')) el.textContent = box.name || 'Room';
        }
        el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.opacity = String(Math.max(0.15, (window.__uiFadeAlpha||1.0)));

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
          var rect = el.getBoundingClientRect();
          var gap = 12; // px gap between pill and button
          var editLeft = left + (rect.width/2) + gap;
          var editTop = top; // align centers vertically
          eb.style.left = editLeft + 'px';
          eb.style.top = editTop + 'px';
        } catch(_e) {
          eb.style.left = (left + 32) + 'px';
          eb.style.top = top + 'px';
        }
        eb.style.opacity = String(Math.max(0.15, (window.__uiFadeAlpha||1.0)));
        seen[box.id] = true;
      }

      // Rooms only for now
      for (var i=0;i<(allRooms||[]).length;i++) placeLabelFor(allRooms[i]);
      // Remove stale labels
      for (var id in existingLabel){ if(!seen[id]) { var n1 = existingLabel[id]; if(n1 && n1.parentNode===container) container.removeChild(n1); } }
      for (var id2 in existingEdit){ if(!seen[id2]) { var n2 = existingEdit[id2]; if(n2 && n2.parentNode===container) container.removeChild(n2); } }
    } catch(e) { /* non-fatal */ }
  };
})();
