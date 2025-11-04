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
            try { __plan2d.freezeSyncUntil = Date.now() + 1200; } catch(_f){}
            if (typeof window.plan2dDeleteSelection === 'function') {
              var did = window.plan2dDeleteSelection();
              ev.preventDefault(); ev.stopPropagation();
              return;
            }
          }
        }
      }
    } catch(_e){}
  }

  document.addEventListener('keydown', handleKeydown, true);
})();
