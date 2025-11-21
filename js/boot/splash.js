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
    var title=document.createElement('div'); title.textContent='Loading…'; title.className='splash-message'; title.style.marginBottom='12px'; title.style.color='#c9d1d9';
    var barWrap=document.createElement('div'); barWrap.style.width='320px'; barWrap.style.height='10px'; barWrap.style.border='1px solid #30363d'; barWrap.style.borderRadius='999px'; barWrap.style.background='#161b22'; barWrap.style.overflow='hidden';
    var bar=document.createElement('div'); bar.className='splash-progress-bar'; bar.style.height='100%'; bar.style.width='0%'; bar.style.background='linear-gradient(90deg,#238636,#2ea043)'; bar.style.transition='width .25s ease'; barWrap.appendChild(bar);
    var pct=document.createElement('div'); pct.className='splash-percent'; pct.style.marginTop='8px'; pct.style.fontSize='12px'; pct.style.color='#8b949e'; pct.textContent='0%';
    var list=document.createElement('div'); list.className='splash-module-list'; list.style.marginTop='16px'; list.style.width='320px'; list.style.display='flex'; list.style.flexDirection='column'; list.style.gap='4px'; list.style.fontSize='11px'; list.style.color='#8b949e';
    root.appendChild(title); root.appendChild(barWrap); root.appendChild(pct); root.appendChild(list);
    document.body.appendChild(root);
  }

  var barEl = root.querySelector('.splash-progress-bar');
  var pctEl = root.querySelector('.splash-percent');
  var msgEl = root.querySelector('.splash-message');
  var listEl = root.querySelector('.splash-module-list');

  function render(){
    if(!barEl || total===0) return;
    var p = Math.min(100, Math.round(loaded/total*100));
    barEl.style.width = p + '%';
    if(pctEl) pctEl.textContent = p + '%';
  }
  function hideSplash(){
    if(hidden) return; hidden = true;
    root.classList.add('splash-hide');
    root.style.opacity='0';
    setTimeout(function(){ try{ root.remove(); }catch(e){} }, 400);
  }
  function maybeHide(){
    if(hidden) return;
    // Allow early hide once essential modules loaded + first frame OR full load complete.
    // Maintain minimum display to avoid flash.
    var now = Date.now();
    var minDisplayTime = 600; // Slightly reduced for snappier feel
    var loadStartTime = window.__loadStartTime || now;
    var timeSinceStart = now - loadStartTime;
    var essentialsDone = false;
    try {
      if (typeof window.__bootEssentialLoaded === 'number' && typeof window.__bootEssentialTotal === 'number') {
        essentialsDone = (window.__bootEssentialLoaded >= window.__bootEssentialTotal && window.__bootEssentialTotal > 0);
      }
    } catch(_eChk){}
    var fullDone = (loaded === total && total > 0);
    if ((essentialsDone || fullDone) && firstFrame && timeSinceStart >= minDisplayTime){
      console.log('[Splash] Hiding (essentialsDone='+essentialsDone+', fullDone='+fullDone+', firstFrame='+firstFrame+', ms='+timeSinceStart+')');
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
  // Listen for essential completion to attempt early hide
  window.addEventListener('gablok:essential-complete', function(){ setTimeout(maybeHide, 50); });
  window.__splashMark = function(){ /* no-op maintained for compatibility */ };

  // Absolute failsafe: if still not hidden after very long (render failure), hide anyway after 15s.
  setTimeout(function(){ if(!hidden) hideSplash(); }, 15000);
})();
