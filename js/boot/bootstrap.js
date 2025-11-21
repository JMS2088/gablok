// Orchestrated loader that keeps the splash visible and loads all modules before starting the app
(function(){
  if (window.__bootstrapLoaded) return; window.__bootstrapLoaded = true;
  // Gate startup until boot completes
  window.__requireBoot = true;
  var bootResolve; window.__bootPromise = new Promise(function(res){ bootResolve = res; });

  // Dev-friendly status: show #status during boot, hide on first render unless sticky
  (function(){
    try{
      var s = document.getElementById('status');
      if (!s) return;
      // Only auto-show if not explicitly requested hidden
      if (!window.__debugStickyStatus) {
        s.style.display = 'block';
        s.textContent = 'Booting…';
        // Hide after first frame
        window.addEventListener('gablok:first-render', function(){
          try { if (!window.__debugStickyStatus) s.style.display = 'none'; } catch(_e){}
        }, { once:true });
      }
    } catch(_eStat){}
  })();

  // Global error handler to surface early script failures in the status bar & admin log
  if (!window.__bootErrorWired) {
    window.__bootErrorWired = true;
    window.addEventListener('error', function(evt){
      try {
        var msg = '[BootError] ' + (evt.message || evt.error && evt.error.message || 'unknown');
        var s = document.getElementById('status'); if (s && !window.__debugStickyStatus) s.textContent = msg;
        console.error(msg, evt.error || evt);
        // Send to lightweight admin error collector (best-effort)
        try {
          fetch('/__log-error', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: msg, stack: (evt.error && evt.error.stack) || null }) }).catch(function(){});
        } catch(_fe){}
      } catch(_eTop){}
    });
    window.addEventListener('unhandledrejection', function(evt){
      try {
        var reason = (evt && (evt.reason && (evt.reason.message||evt.reason) || evt)) || 'unhandledrejection';
        var msg = '[BootError] Promise rejection: ' + String(reason);
        var s = document.getElementById('status'); if (s && !window.__debugStickyStatus) s.textContent = msg;
        console.error(msg, evt);
        try {
          fetch('/__log-error', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: msg, stack: (reason && reason.stack) || null }) }).catch(function(){});
        } catch(_fe2){}
      } catch(_eTop2){}
    });
  }

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

  // Fallback: fetch JS text and execute synchronously via inline script
  async function loadByFetch(url){
    var u = url; try {
      // Avoid cached broken responses
      var sep = (u.indexOf('?') === -1) ? '?' : '&';
      u = u + sep + 'cbf=' + Date.now();
    } catch(_){}
    var res = await fetch(u, { cache: 'no-store' });
    if (!res.ok) throw new Error('Fetch failed '+url+' '+res.status);
    var code = await res.text();
    return new Promise(function(resolve){
      var s = document.createElement('script');
      // Add sourceURL for better stack traces in devtools
      try { s.text = code + "\n//# sourceURL=" + url; } catch(_e) { s.appendChild(document.createTextNode(code)); }
      document.head.appendChild(s);
      resolve(true);
    });
  }

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

  // Single ordered list (simple, step-by-step). Keep renderers after core.
  // Keep boot minimal: only hard requirements to render grid + a room and accept input.
  var modules = [
    { label: 'Camera core', url: 'js/core/engine/camera.js?v=20251109-1', critical: true, essential: true },
    { label: 'Placement helper', url: 'js/core/placement.js', critical: true, essential: true },
    { label: 'Engine wall strips', url: 'js/core/engine/wallStrips.js?v=20251109-1', critical: true, essential: true },
    { label: 'Engine components', url: 'js/core/engine/components.js?v=20251109-1', critical: true, essential: true },
    { label: 'Core engine', url: 'js/core/engine3d.js?v=20251026-1', critical: true, essential: true },
    { label: 'Project mgmt', url: 'js/core/project.js?v=20251128-1', critical: true, essential: true },
    { label: 'Import/Export', url: 'js/io/importExport.js?v=20251128-1', critical: true },
    { label: 'File I/O', url: 'js/io/fileIO.js?v=20251128-1', critical: true },
    { label: 'DXF', url: 'js/io/formats/dxf.js?v=20251128-1', critical: false },
    { label: 'DWG', url: 'js/io/formats/dwg.js?v=20251128-1', critical: false },
    { label: 'Loader', url: 'js/boot/loader.js?v=20251026-1', critical: true, essential: true },
    { label: 'UI labels', url: 'js/ui/labels.js?v=20251026-1', critical: true, essential: true },
    { label: 'Room palette', url: 'js/ui/roomPalette.js?v=20251128-1', critical: false },
    { label: 'Room renderer', url: 'js/render/drawRoom.js?v=20251026-2', critical: true, essential: true },
    { label: 'Stairs renderer', url: 'js/render/drawStairs.js?v=20251026-1', critical: false },
    { label: 'Pergola renderer', url: 'js/render/drawPergola.js?v=20251026-1', critical: false },
    { label: 'Garage renderer', url: 'js/render/drawGarage.js?v=20251026-1', critical: false },
    { label: 'Roof renderer', url: 'js/render/drawRoof.js?v=20251026-1', critical: false },
    { label: 'Roof dropdown', url: 'js/ui/roofDropdown.js?v=20251128-1', critical: false },
    { label: 'Pool renderer', url: 'js/render/drawPool.js?v=20251026-1', critical: false },
    { label: 'Balcony renderer', url: 'js/render/drawBalcony.js?v=20251026-1', critical: false },
    { label: 'Furniture renderer', url: 'js/render/drawFurniture.js?v=20251026-1', critical: false },
    { label: 'Input events', url: 'js/input/events.js?v=20251101-6', critical: true, essential: true },
    { label: 'History', url: 'js/input/history.js?v=20251109-1', critical: true, essential: true },
    { label: 'Keyboard router', url: 'js/input/keyboard.js?v=20251109-1', critical: true, essential: true },
    { label: 'Plan apply', url: 'js/core/plan-apply.js?v=20251101-7', critical: true },
    { label: 'Plan populate', url: 'js/core/plan-populate.js?v=20251101-4', critical: true },
    { label: 'Consistency checks', url: 'js/core/consistency.js?v=20251128-1', critical: false },
    { label: 'Trace panel', url: 'js/ui/trace-panel.js?v=20251109-1', critical: false },
    { label: 'Admin client', url: 'js/ui/admin.js?v=20251109-1', critical: false },
    { label: 'Info modal', url: 'js/ui/modals.js?v=20251128-1', critical: false },
    { label: 'Pricing modal', url: 'js/ui/pricing.js?v=20251128-1', critical: false },
    { label: 'Plan2D geom', url: 'js/plan2d/geom2d.js?v=20251108-2', critical: false },
    { label: 'Plan2D walls', url: 'js/plan2d/walls.js?v=20251108-2', critical: false },
    { label: 'Plan2D snap', url: 'js/plan2d/snap.js?v=20251108-2', critical: false },
    { label: 'Plan2D core', url: 'js/plan2d/editor-core.js?v=20251108-1', critical: false },
    { label: 'Plan2D draw', url: 'js/plan2d/draw.js?v=20251108-1', critical: false },
    { label: 'Plan2D editor wiring', url: 'js/plan2d/editor.js?v=20251108-1', critical: false },
    { label: 'Plan2D WebGL', url: 'js/plan2d/webgl.js?v=20251108-1', critical: false },
    { label: 'App core', url: 'js/app.js?v=20251026-1', critical: true, essential: true }
  ];

  // Build essential list (modules marked essential)
  try {
    var allLabels = modules.map(function(m){ return (typeof m==='string')? m : m.label; });
    var essentialLabels = modules.filter(function(m){ return m && m.essential; }).map(function(m){ return m.label; });
    if (typeof window.__splashExpect==='function') window.__splashExpect(allLabels);
    if (typeof window.__splashSetTotal==='function') window.__splashSetTotal(allLabels.length);
    window.__bootEssentialTotal = essentialLabels.length;
    window.__bootEssentialLoaded = 0;
    window.__bootAllTotal = allLabels.length;
    window.__bootAllLoaded = 0;
  } catch(e){}

  function setMsg(msg){ try{ if (typeof window.__splashSetMessage==='function') window.__splashSetMessage(msg); } catch(e){} }
  function tick(label){ try{ if (typeof window.__splashTick==='function') window.__splashTick(label); } catch(e){} }

  (async function(){
    // Enable interactive step mode with ?boot=step
    var stepMode = false;
    try { stepMode = /(^|[?&])boot=step(&|$)/.test(String(location.search||'')); } catch(e){}

    var trace = [];
    var essentialDone = false;
    var appStartedViaBoot = false;
    for (var i=0;i<modules.length;i++){
      var m = modules[i];
      if (typeof m === 'string') { m = { label: m, url: m, critical: false }; }
      var tries = 0; var maxTries = m.critical ? 2 : 1;
      var ok = false; var errLast = null; var t0, t1;
      while (tries < maxTries && !ok){
        try {
          setMsg('Loading '+m.label+'…');
          t0 = (performance && performance.now) ? performance.now() : Date.now();
          await ensureWithTimeout(m.url, m.critical ? 6000 : 3000, tries+1);
          t1 = (performance && performance.now) ? performance.now() : Date.now();
          ok = true;
        } catch(err){ errLast = err; tries++; }
      }
      // Final fallback for critical modules: fetch-and-eval to bypass missing onload events
      if (!ok && m.critical) {
        try {
          setMsg('Recovering '+m.label+'…');
          t0 = (performance && performance.now) ? performance.now() : Date.now();
          await loadByFetch(m.url);
          t1 = (performance && performance.now) ? performance.now() : Date.now();
          ok = true;
        } catch(err2){ errLast = errLast || err2; }
      }
      var dur = (t1 && t0) ? Math.round(t1 - t0) : null;
      trace.push({ module: m.label, url: m.url, ok: !!ok, ms: dur, attempts: tries || 1, critical: !!m.critical });
      try { if (typeof window.__splashMark==='function') window.__splashMark(m.label, (ok? 'Loaded' : (m.optional? 'Skipped' : 'Failed')) + (dur!=null? (' in '+dur+'ms') : '')); } catch(e){}
      if (ok) {
        tick(m.label);
        // Track overall progress & essential progress; emit events
        try {
          window.__bootAllLoaded = (window.__bootAllLoaded||0)+1;
          window.dispatchEvent(new CustomEvent('gablok:module-progress', { detail:{ loaded: window.__bootAllLoaded, total: window.__bootAllTotal, label: m.label, ms: dur || null } }));
          if (m.essential) {
            window.__bootEssentialLoaded = (window.__bootEssentialLoaded||0) + 1;
            if (window.__bootEssentialLoaded === window.__bootEssentialTotal) {
              essentialDone = true;
              window.dispatchEvent(new CustomEvent('gablok:essential-complete'));
            } else {
              window.dispatchEvent(new CustomEvent('gablok:essential-progress', { detail:{ loaded: window.__bootEssentialLoaded, total: window.__bootEssentialTotal, label: m.label } }));
            }
          }
        } catch(_eEss) {}
      } else {
        try { console[(m.optional? 'warn':'error')]('[Boot] '+(m.optional? 'Optional failed':'Critical failed'), m.label, 'from', m.url, errLast); } catch(_e){}
        // For critical failures, continue to next to allow app to try starting; splash has a hard cap auto-hide.
        tick(m.label + (m.optional? ' (skipped)':' (failed)'));
        try{ var s=document.getElementById('status'); if(s && !window.__debugStickyStatus){ s.style.display='block'; s.textContent='Boot issue: '+m.label+' failed'; } }catch(_se){}
      }
      // Progressive boot: as soon as App core is loaded, start the app (only once)
      try {
        if (!appStartedViaBoot && ((m.label === 'App core') || (m.url && /js\/app\.js/.test(m.url)))) {
          window.__bootReady = true;
          if (typeof bootResolve === 'function') bootResolve(true);
          try { window.dispatchEvent(new CustomEvent('gablok:boot-ready')); } catch(_evt) {}
          if (document.readyState !== 'loading' && typeof window.startApp==='function' && !window.__appStarted) {
            window.__appStarted = true; window.startApp();
          }
          appStartedViaBoot = true;
          // If essentials not previously marked complete (App core might be last), emit completion now.
          try {
            if (!essentialDone && window.__bootEssentialLoaded === window.__bootEssentialTotal) {
              essentialDone = true; window.dispatchEvent(new CustomEvent('gablok:essential-complete')); }
          } catch(_eEDone){}
        }
      } catch(_pb) {}
      if (stepMode) { try { if (typeof window.__splashWaitForContinue==='function') await window.__splashWaitForContinue(); } catch(_e){} }
    }
    try { if (console && console.table) console.table(trace); else console.log('[Boot trace]', trace); } catch(e){}

    // All attempted; ensure app has started (in case App core was skipped)
    window.__bootReady = true;
    try { if (typeof bootResolve === 'function') bootResolve(true); } catch(e){}
    try { window.dispatchEvent(new CustomEvent('gablok:boot-ready')); } catch(e){}
    try { if (!appStartedViaBoot && document.readyState !== 'loading' && typeof window.startApp==='function' && !window.__appStarted) { window.__appStarted = true; window.startApp(); } } catch(e){}
    try { if (!essentialDone && window.__bootEssentialLoaded === window.__bootEssentialTotal) { window.dispatchEvent(new CustomEvent('gablok:essential-complete')); } } catch(_eFinalEss){}
    // Post-load diagnostics: flag slow modules (>300ms) & expose trace
    try {
      window.__bootTrace = trace.slice();
      var slow = trace.filter(function(r){ return r && r.ok && typeof r.ms==='number' && r.ms>300; });
      window.__bootSlowModules = slow;
      if (slow.length && console && console.warn) console.warn('[Boot] Slow modules:', slow.map(function(s){ return s.module+':'+s.ms+'ms'; }).join(', '));
    } catch(_eDiag){}
  })();
  // Wire Floor Plan button (robust against early clicks before modules are ready)
  (function(){
    try{
      var btn = document.getElementById('btn-floorplan');
      if(!btn) return;
      if(btn.__wiredFloorPlan) return; btn.__wiredFloorPlan=true;
      btn.addEventListener('click', function(){
        // If 2D modules loaded, open immediately; else wait for boot-ready event
        if(typeof window.openPlan2DModal === 'function'){ window.openPlan2DModal(); return; }
        var opened=false;
        function tryOpen(){ if(opened) return; if(typeof window.openPlan2DModal==='function'){ opened=true; window.openPlan2DModal(); window.removeEventListener('gablok:boot-ready', tryOpen); } }
        window.addEventListener('gablok:boot-ready', tryOpen);
      });
    }catch(e){ console.warn('Floor plan button wiring failed', e); }
  })();

  // Startup watchdogs: ensure the app never silently stalls on splash
  // Force startApp if not begun shortly after boot. Avoid auto-reload loops.
  setTimeout(function(){
    try {
      if (!window.__appStarted && typeof window.startApp === 'function') {
        console.warn('[Watchdog] startApp not started after 2500ms – forcing start.');
        window.__appStarted = true; window.startApp();
      }
    } catch(e){ console.error('[Watchdog] Forced startApp failed', e); }
  }, 2500);
  setTimeout(function(){
    try {
      if (!window.__firstFrameEmitted) {
        console.warn('[Watchdog] First frame not emitted after 6000ms – attempting recovery render.');
        var s = document.getElementById('status'); if (s && !window.__debugStickyStatus) s.textContent = 'Recovering…';
        if (typeof window.setupCanvas === 'function') window.setupCanvas();
        if (typeof window.updateProjectionCache === 'function') window.updateProjectionCache();
        if (typeof window.renderLoop === 'function') window.renderLoop();
      }
    } catch(e){ /* non-fatal */ }
  }, 6000);
})();
