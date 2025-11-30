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
      // Quick shortcuts: L toggles labels, V toggles clean view (only when not typing)
      if(!editing && (key==='l' || key==='L')){ try { if(typeof window.toggleLabelsVisibility==='function'){ window.toggleLabelsVisibility(); ev.preventDefault(); ev.stopPropagation(); return; } } catch(_kl){} }
      if(!editing && (key==='v' || key==='V')){ try { if(typeof window.toggleCleanView==='function'){ window.toggleCleanView(); ev.preventDefault(); ev.stopPropagation(); return; } } catch(_kv){} }
      // Arrow key nudging for 2D selected wall
      if (!editing && (key==='ArrowLeft'||key==='ArrowRight'||key==='ArrowUp'||key==='ArrowDown')){
        try {
          if (window.__plan2d && __plan2d.active && __plan2d.selectedGuide && typeof window.plan2dNudgeGuideByPixels === 'function') {
            var stepPx = ev.shiftKey ? 10 : 1;
            var dxPx = 0, dyPx = 0;
            if (__plan2d.selectedGuide.dir === 'v') {
              if (key==='ArrowLeft') dxPx = -stepPx;
              else if (key==='ArrowRight') dxPx = stepPx;
            } else if (__plan2d.selectedGuide.dir === 'h') {
              if (key==='ArrowUp') dyPx = -stepPx;
              else if (key==='ArrowDown') dyPx = stepPx;
            }
            if ((dxPx||dyPx) && window.plan2dNudgeGuideByPixels(dxPx, dyPx)) {
              ev.preventDefault(); ev.stopPropagation(); return;
            }
          }
          if (window.__plan2d && __plan2d.active){
            var hasSelection = (Array.isArray(__plan2d.selectedIndices) && __plan2d.selectedIndices.length>0) || (typeof __plan2d.selectedIndex==='number' && __plan2d.selectedIndex>=0);
            if (hasSelection){
              var scale = Math.max(1e-6, __plan2d.scale || 50);
              var stepPxSel = ev.shiftKey ? 10 : 1;
              var dxWorld = 0, dyWorld = 0;
              if (key==='ArrowLeft') dxWorld = -(stepPxSel/scale);
              else if (key==='ArrowRight') dxWorld = (stepPxSel/scale);
              else if (key==='ArrowUp') dyWorld = (stepPxSel/scale);
              else if (key==='ArrowDown') dyWorld = -(stepPxSel/scale);
              if ((dxWorld||dyWorld) && typeof window.plan2dNudgeSelection==='function'){
                var didSel = window.plan2dNudgeSelection(dxWorld, dyWorld);
                if (didSel){ ev.preventDefault(); ev.stopPropagation(); return; }
              }
            }
          }
        } catch(_n2d){}
      }
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
        // Do NOT consume Delete for 3D here; allow events.js keydown to handle room / wall strip deletion.
        // (events.js will call preventDefault itself once it processes the deletion.)
      }
      // Arrow key nudging for 3D selected object (unless editing input)
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
        // Allow browser hard reload shortcuts: Ctrl+Shift+R / Cmd+Shift+R
        if (ev.shiftKey && (ev.ctrlKey || ev.metaKey)) {
          // Do NOT consume; let the browser perform a hard refresh.
          return;
        }
        if (typeof setWallRenderMode==='function') {
          setWallRenderMode(window.__wallRenderMode==='solid'?'line':'solid');
          ev.preventDefault();
          ev.stopPropagation();
        }
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
