// Centralized global keyboard routing (capture-phase)
// Ensures Delete always works for 2D selections, and prevents 3D handlers from interfering
(function(){
  if (window.__keyboardRouterInstalled) return; window.__keyboardRouterInstalled = true;

  function isEditingElement(el){
    try {
      if (!el) return false;
      var tag = (el.tagName||'').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
    } catch(_e){}
    return false;
  }

  function handleKeydown(ev){
    try {
      var key = ev.key;
      var isDel = (key==='Delete' || key==='Backspace' || key==='Del' || ev.keyCode===46 || ev.keyCode===8 || ev.code==='Delete');
      var editing = isEditingElement(document.activeElement);
      // Unified deletion handling: prefer active 2D selection, else 3D selection/wall strip.
      if (isDel && !editing) {
        var now = Date.now();
        if (window.__plan2d && __plan2d.active && typeof window.plan2dDeleteSelection === 'function') {
          try {
            if (typeof __plan2d.__lastDeleteEventAt !== 'number') __plan2d.__lastDeleteEventAt = 0;
            if (now - __plan2d.__lastDeleteEventAt < 120) { ev.preventDefault(); ev.stopPropagation(); return; }
            __plan2d.__lastDeleteEventAt = now;
            var did = plan2dDeleteSelection();
            if (did){ ev.preventDefault(); ev.stopPropagation(); return; }
          } catch(_d2d){}
        }
        // 3D fallback: reuse events.js logic by dispatching Delete so its listener processes.
        try {
          if (typeof selectedRoomId === 'string' && selectedRoomId) {
            // Let events.js listener handle actual removal; just prevent page scroll
            ev.preventDefault(); ev.stopPropagation();
            return;
          }
        } catch(_d3d){}
      }
      // Arrow key nudging for both contexts when an object selected (unless editing input)
      if (!editing && selectedRoomId && (key==='ArrowLeft'||key==='ArrowRight'||key==='ArrowUp'||key==='ArrowDown')) {
        var step = ev.shiftKey ? 1.0 : 0.1;
        var obj = (typeof findObjectById==='function')? findObjectById(selectedRoomId):null;
        if (obj) {
          if (key==='ArrowLeft') obj.x -= step; else if (key==='ArrowRight') obj.x += step; else if (key==='ArrowUp') obj.z -= step; else if (key==='ArrowDown') obj.z += step;
          try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_m){}
          try { if (typeof renderLoop==='function') renderLoop(); } catch(_r){}
          ev.preventDefault(); ev.stopPropagation();
        }
      }
      // Toggle render mode with R across contexts
      if (!editing && (key==='r'||key==='R')) {
        if (typeof setWallRenderMode==='function'){ setWallRenderMode(window.__wallRenderMode==='solid'?'line':'solid'); ev.preventDefault(); ev.stopPropagation(); }
      }
    } catch(_e){}
  }

  document.addEventListener('keydown', handleKeydown, true);
})();

// Global undo/redo keyboard shortcuts: Ctrl/Cmd+Z, Ctrl+Y or Ctrl+Shift+Z
(function(){
  function undoRedoHandler(ev){
    try {
      // Don't hijack while user is typing
      // Local helper (duplicated intentionally; previous definition was closure-scoped)
      function isEditingElement(el){
        try {
          if (!el) return false;
          var tag = (el.tagName||'').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
        } catch(_e){}
        return false;
      }
      if (isEditingElement(document.activeElement)) return;
      var mod = (ev.ctrlKey || ev.metaKey);
      if (!mod) return;
      var key = (ev.key || '').toLowerCase();
      if (key === 'z' && !ev.altKey) {
        // Ctrl/Cmd+Z -> undo
        ev.preventDefault(); ev.stopPropagation();
        try { if (typeof window.historyUndo === 'function') window.historyUndo(); }
        catch(_e){}
      } else if (key === 'y' || (key === 'z' && ev.shiftKey)) {
        // Ctrl+Y or Ctrl+Shift+Z -> redo
        ev.preventDefault(); ev.stopPropagation();
        try { if (typeof window.historyRedo === 'function') window.historyRedo(); }
        catch(_e){}
      }
    } catch(_e){}
  }
  document.addEventListener('keydown', undoRedoHandler, true);
})();
