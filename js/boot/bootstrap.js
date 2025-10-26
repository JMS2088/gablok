// Orchestrated loader that keeps the splash visible and loads all modules before starting the app
(function(){
  if (window.__bootstrapLoaded) return; window.__bootstrapLoaded = true;
  // Gate startup until boot completes
  window.__requireBoot = true;
  var bootResolve; window.__bootPromise = new Promise(function(res){ bootResolve = res; });

  // Minimal loader if not present
  function loadScript(url){
    return new Promise(function(resolve, reject){
      try {
        var s = document.createElement('script');
        s.src = url; s.async = false; s.defer = false; // maintain order
        s.onload = function(){ resolve(true); };
        s.onerror = function(){ reject(new Error('Failed to load '+url)); };
        document.head.appendChild(s);
      } catch(e){ reject(e); }
    });
  }
  var ensure = window.loadScript || loadScript;

  // Race a script load against a timeout; add cache-busting on retries
  function ensureWithTimeout(url, timeoutMs, attempt){
    var u = url;
    if (attempt && attempt > 1) {
      var sep = (u.indexOf('?') === -1) ? '?' : '&';
      u = u + sep + 'cb=' + Date.now();
    }
    var t;
    return Promise.race([
      ensure(u),
      new Promise(function(_, rej){ t = setTimeout(function(){ rej(new Error('Timeout '+u)); }, Math.max(1000, timeoutMs||5000)); })
    ]).finally(function(){ if (t) clearTimeout(t); });
  }

  // Module plan (ordered)
  // Mark renderers and nice-to-haves as optional so a failure there doesn't block first paint
  var modules = [
    { label: 'Core engine', url: 'js/core/engine3d.js?v=20251026-1', critical: true },
    { label: 'UI labels', url: 'js/ui/labels.js?v=20251026-1', critical: true },
    { label: 'Roof dropdown', url: 'js/ui/roofDropdown.js?v=20251026-1', optional: true },
    { label: 'Loader', url: 'js/boot/loader.js?v=20251026-1', critical: true },
    { label: 'Room renderer', url: 'js/render/drawRoom.js?v=20251026-2', critical: true },
    { label: 'Roof renderer', url: 'js/render/drawRoof.js?v=20251026-1', optional: true },
    { label: 'Stairs renderer', url: 'js/render/drawStairs.js?v=20251026-1', optional: true },
    { label: 'Pergola renderer', url: 'js/render/drawPergola.js?v=20251026-1', optional: true },
    { label: 'Garage renderer', url: 'js/render/drawGarage.js?v=20251026-1', optional: true },
    { label: 'Pool renderer', url: 'js/render/drawPool.js?v=20251026-1', optional: true },
    { label: 'Balcony renderer', url: 'js/render/drawBalcony.js?v=20251026-1', optional: true },
    { label: 'Input/events', url: 'js/input/events.js?v=20251026-1', critical: true },
    { label: 'App core', url: 'js/app.js?v=20251026-1', critical: true },
    { label: 'Smoke test', url: 'js/smoke/smoke3d.js?v=20251026-1', optional: true }
  ];

  try {
    // Prepare splash list and total
    var labels = modules.map(function(m){ return m.label; });
    if (typeof window.__splashExpect==='function') window.__splashExpect(labels);
    if (typeof window.__splashSetTotal==='function') window.__splashSetTotal(labels.length);
  } catch(e){}

  function setMsg(msg){ try{ if (typeof window.__splashSetMessage==='function') window.__splashSetMessage(msg); } catch(e){} }
  function tick(label){ try{ if (typeof window.__splashTick==='function') window.__splashTick(label); } catch(e){} }

  (async function(){
    for (var i=0;i<modules.length;i++){
      var m = modules[i]; var tries = 0; var maxTries = 2; // one retry on failure
      while (true){
        try {
          setMsg('Loading '+m.label+'…');
          var to = m.critical ? 8000 : 4000;
          await ensureWithTimeout(m.url, to, tries+1);
          tick(m.label);
          break;
        } catch(err){
          tries++;
          if (tries > maxTries) {
            // If optional, log and continue; otherwise stop boot
            try { console.error('[Boot] Failed to load', m.label, 'from', m.url, err); } catch(e){}
            if (m.optional) {
              setMsg(m.label+' unavailable');
              // still advance the bar for this step so progress completes
              tick(m.label+' (skipped)');
              break;
            } else {
              setMsg('Failed to load '+m.label+'. Please reload.');
              // Stop boot; leave splash visible
              return;
            }
          }
        }
      }
    }
    // All loaded
    window.__bootReady = true;
    try { window.dispatchEvent(new CustomEvent('gablok:boot-ready')); } catch(e){}
    try { if (typeof bootResolve==='function') bootResolve(true); } catch(e){}
    // If engine already defined startApp and DOM ready, it will start via engine3d's gated listener.
    // As a safety, start if everything is ready and it hasn't started.
    try {
      if (document.readyState !== 'loading' && typeof window.startApp==='function' && !window.__appStarted) {
        window.__appStarted = true; window.startApp();
      }
    } catch(e){}
  })();
})();
