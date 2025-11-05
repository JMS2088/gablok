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
      // If 2D editor is active, route Delete/Backspace to 2D deletion first
      if (window.__plan2d && __plan2d.active) {
        var key = ev.key;
        var isDel = (key==='Delete' || key==='Backspace' || key==='Del' || ev.keyCode===46 || ev.keyCode===8 || ev.code==='Delete');
        if (isDel) {
          // Don't delete while user is typing into a text input inside 2D panels
          if (!isEditingElement(document.activeElement)){
            try {
              var now = Date.now();
              // Initialize shared dedupe markers if missing
              if (typeof __plan2d.__lastDeleteEventAt !== 'number') __plan2d.__lastDeleteEventAt = 0;
              if (typeof __plan2d.__lastDeleteHandledAt !== 'number') __plan2d.__lastDeleteHandledAt = 0;
              if (typeof __plan2d.__handlingDelete !== 'boolean') __plan2d.__handlingDelete = false;
              // If another handler just processed Delete, ignore to prevent double-deletes
              if (__plan2d.__lastDeleteEventAt && (now - __plan2d.__lastDeleteEventAt) < 500) { ev.preventDefault(); ev.stopPropagation(); return; }
              __plan2d.__lastDeleteEventAt = now;
              if (__plan2d.__handlingDelete) { ev.preventDefault(); ev.stopPropagation(); return; }
              __plan2d.__handlingDelete = true;
              __plan2d.freezeSyncUntil = now + 1200; // brief sync freeze to keep selection stable
              if (typeof window.plan2dDeleteSelection === 'function') {
                try {
                  var did = window.plan2dDeleteSelection();
                  if (did) __plan2d.__lastDeleteHandledAt = now;
                } finally { __plan2d.__handlingDelete = false; }
              } else {
                __plan2d.__handlingDelete = false;
              }
              ev.preventDefault(); ev.stopPropagation();
              return;
            } catch(_f){}
          }
        }
      }
    } catch(_e){}
  }

  document.addEventListener('keydown', handleKeydown, true);
})();
