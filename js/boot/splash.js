// Simplified splash screen implementation
(function(){
  if(window.__simpleSplashInit) return; window.__simpleSplashInit = true;

  // Track when splash started for minimum display time
  window.__loadStartTime = Date.now();

  var total = 0;
  var loaded = 0;
  var firstFrame = false;
  var allDoneTime = 0;
  var watchdogStarted = false;
  var hidden = false;

  // Create minimal overlay if not present
  var root = document.getElementById('splash');
  if(!root){
    root = document.createElement('div');
    root.id = 'splash';
    root.style.position='fixed';
    root.style.inset='0';
    root.style.background='#0d1117';
    root.style.display='flex';
    root.style.flexDirection='column';
    root.style.alignItems='center';
    root.style.justifyContent='center';
    root.style.fontFamily='system-ui, sans-serif';
    root.style.zIndex='9999';
    var pct=document.createElement('div'); pct.className='splash-percent'; pct.style.fontSize='72px'; pct.style.fontWeight='700'; pct.style.color='#c9d1d9'; pct.textContent='0%';
    var list=document.createElement('div'); list.className='splash-module-list';
    root.appendChild(pct); root.appendChild(list);
    document.body.appendChild(root);
  }

  var pctEl = root.querySelector('.splash-percent');
  var listEl = root.querySelector('.splash-module-list');

  function render(){
    if(total===0) return;
    var p = Math.min(100, Math.round(loaded/total*100));
    if(pctEl) pctEl.textContent = p + '%';
  }
  function hideSplash(){
    if(hidden) return; hidden = true;
    root.classList.add('splash-hide');
    root.style.opacity='0';
    // Add app-ready class to body to show 3D canvas and UI
    setTimeout(function(){ 
      try { document.body.classList.add('app-ready'); } catch(e){}
    }, 200);
    setTimeout(function(){ try{ root.remove(); }catch(e){} }, 400);
  }
  function maybeHide(){
    if(hidden) return;
    // Wait for ALL modules to load (not just essentials) + first frame + minimum display time
    var now = Date.now();
    var minDisplayTime = 600; // Slightly reduced for snappier feel
    var loadStartTime = window.__loadStartTime || now;
    var timeSinceStart = now - loadStartTime;
    var fullDone = (loaded === total && total > 0);
    if (fullDone && firstFrame && timeSinceStart >= minDisplayTime){
      console.log('[Splash] Hiding (fullDone='+fullDone+', firstFrame='+firstFrame+', ms='+timeSinceStart+')');
      hideSplash();
    }
  }

  // Public API (kept names for compatibility)
  window.__splashSetTotal = function(t){ total = parseInt(t)||0; render(); };
  window.__splashExpect = function(name){
    if(listEl){
      var row=document.createElement('div');
      row.textContent = name;
      row.style.opacity='0.6';
      row.setAttribute('data-module', name);
      listEl.appendChild(row);
    }
  };
  window.__splashTick = function(name){
    loaded++; render();
    if(listEl){
      var r=listEl.querySelector('[data-module="'+name+'"]');
      if(r){ r.style.opacity='1'; r.style.color='#c9d1d9'; }
    }
    if(loaded===total){
      allDoneTime = Date.now();
      // Start watchdog to force first frame if renderer hasn't produced one shortly.
      if(!watchdogStarted){
        watchdogStarted = true;
        setTimeout(function(){
          try {
            if(!firstFrame && !hidden){
              if(typeof window.setupCanvas==='function') window.setupCanvas();
              if(typeof window.updateProjectionCache==='function') window.updateProjectionCache();
              if(typeof window.renderLoop==='function') window.renderLoop();
            }
          } catch(_eForce){}
        }, 1500);
        setTimeout(function(){ maybeHide(); }, 2000);
      }
    }
    maybeHide();
  };
  window.__splashSetMessage = function(m){ if(msgEl) msgEl.textContent = m; };
  window.__splashFirstFrame = function(){ firstFrame = true; maybeHide(); };
  // Listen for all modules completion to attempt hide
  window.addEventListener('gablok:all-modules-complete', function(){ setTimeout(maybeHide, 50); });
  window.__splashMark = function(){ /* no-op maintained for compatibility */ };

  // Accelerated failsafe sequence: attempt progressive hide if first frame delayed
  setTimeout(function(){ if(!hidden) { console.warn('[Splash] 2500ms fallback check'); maybeHide(); } }, 2500);
  setTimeout(function(){ if(!hidden) { console.warn('[Splash] 4000ms forcing hide'); hideSplash(); } }, 4000);
})();
