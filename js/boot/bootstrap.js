// Orchestrated loader that keeps the splash visible and loads all modules before starting the app
(function(){
  if (window.__bootstrapLoaded) return; window.__bootstrapLoaded = true;
  // Gate startup until boot completes
  window.__requireBoot = true;
  var bootResolve; window.__bootPromise = new Promise(function(res){ bootResolve = res; });

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
    { label: 'Camera core', url: 'js/core/engine/camera.js?v=20251109-1', critical: true },
    { label: 'Placement helper', url: 'js/core/placement.js', critical: true },
    // Split engine: load extracted helpers BEFORE main engine so engine can skip defining duplicates
    { label: 'Engine wall strips', url: 'js/core/engine/wallStrips.js?v=20251109-1', critical: true },
    { label: 'Engine components', url: 'js/core/engine/components.js?v=20251109-1', critical: true },
    { label: 'Core engine', url: 'js/core/engine3d.js?v=20251026-1', critical: true },
    { label: 'Project mgmt', url: 'js/core/project.js?v=20251128-1', critical: true },
    { label: 'Import/Export', url: 'js/io/importExport.js?v=20251128-1', critical: true },
    { label: 'File I/O', url: 'js/io/fileIO.js?v=20251128-1', critical: true },
    { label: 'DXF', url: 'js/io/formats/dxf.js?v=20251128-1', critical: true },
    { label: 'DWG', url: 'js/io/formats/dwg.js?v=20251128-1', critical: false },
    { label: 'Loader', url: 'js/boot/loader.js?v=20251026-1', critical: true },
    { label: 'UI labels', url: 'js/ui/labels.js?v=20251026-1', critical: true },
    // Room palette (needed for Edit buttons to function). Previously missing → Edit buttons appeared broken.
    { label: 'Room palette', url: 'js/ui/roomPalette.js?v=20251128-1', critical: false },
    { label: 'Room renderer', url: 'js/render/drawRoom.js?v=20251026-2', critical: true },
    { label: 'Stairs renderer', url: 'js/render/drawStairs.js?v=20251026-1', critical: false },
    { label: 'Pergola renderer', url: 'js/render/drawPergola.js?v=20251026-1', critical: false },
    { label: 'Garage renderer', url: 'js/render/drawGarage.js?v=20251026-1', critical: false },
    { label: 'Roof renderer', url: 'js/render/drawRoof.js?v=20251026-1', critical: false },
    // Roof type dropdown UI (missing earlier → user reported roof types "missing"). Load after roof renderer & components.
    { label: 'Roof dropdown', url: 'js/ui/roofDropdown.js?v=20251128-1', critical: false },
    { label: 'Pool renderer', url: 'js/render/drawPool.js?v=20251026-1', critical: false },
    { label: 'Balcony renderer', url: 'js/render/drawBalcony.js?v=20251026-1', critical: false },
    { label: 'Furniture renderer', url: 'js/render/drawFurniture.js?v=20251026-1', critical: false },
  'js/input/events.js?v=20251101-6',
  { label: 'History', url: 'js/input/history.js?v=20251109-1', critical: true },
  { label: 'Keyboard router', url: 'js/input/keyboard.js?v=20251109-1', critical: true },
  { label: 'Plan apply', url: 'js/core/plan-apply.js?v=20251101-7', critical: true },
  { label: 'Plan populate', url: 'js/core/plan-populate.js?v=20251101-4', critical: true },
    { label: 'Trace panel', url: 'js/ui/trace-panel.js?v=20251109-1', critical: false },
  { label: 'Admin client', url: 'js/ui/admin.js?v=20251109-1', critical: false },
  // Core UI modals
  { label: 'Info modal', url: 'js/ui/modals.js?v=20251128-1', critical: false },
  { label: 'Pricing modal', url: 'js/ui/pricing.js?v=20251128-1', critical: false },
    // Plan2D foundational helpers must come BEFORE core/draw/editor wires
    { label: 'Plan2D geom', url: 'js/plan2d/geom2d.js?v=20251108-2', critical: false },
    { label: 'Plan2D walls', url: 'js/plan2d/walls.js?v=20251108-2', critical: false },
    { label: 'Plan2D snap', url: 'js/plan2d/snap.js?v=20251108-2', critical: false },
    { label: 'Plan2D core', url: 'js/plan2d/editor-core.js?v=20251108-1', critical: false },
    { label: 'Plan2D draw', url: 'js/plan2d/draw.js?v=20251108-1', critical: false },
    { label: 'Plan2D editor wiring', url: 'js/plan2d/editor.js?v=20251108-1', critical: false },
    { label: 'Plan2D WebGL', url: 'js/plan2d/webgl.js?v=20251108-1', critical: false },
    { label: 'App core', url: 'js/app.js?v=20251026-1', critical: true }
  ];

  try {
    // Prepare splash list and total (support string entries as URLs)
    var labels = modules.map(function(m){ return (typeof m === 'string') ? m : m.label; });
    if (typeof window.__splashExpect==='function') window.__splashExpect(labels);
    if (typeof window.__splashSetTotal==='function') window.__splashSetTotal(labels.length);
  } catch(e){}

  function setMsg(msg){ try{ if (typeof window.__splashSetMessage==='function') window.__splashSetMessage(msg); } catch(e){} }
  function tick(label){ try{ if (typeof window.__splashTick==='function') window.__splashTick(label); } catch(e){} }

  (async function(){
    // Enable interactive step mode with ?boot=step
    var stepMode = false;
    try { stepMode = /(^|[?&])boot=step(&|$)/.test(String(location.search||'')); } catch(e){}

    var trace = [];
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
      if (ok) tick(m.label); else {
        try { console[(m.optional? 'warn':'error')]('[Boot] '+(m.optional? 'Optional failed':'Critical failed'), m.label, 'from', m.url, errLast); } catch(_e){}
        // For critical failures, continue to next to allow app to try starting; splash has a hard cap auto-hide.
        tick(m.label + (m.optional? ' (skipped)':' (failed)'));
      }
      if (stepMode) { try { if (typeof window.__splashWaitForContinue==='function') await window.__splashWaitForContinue(); } catch(_e){} }
    }
    try { if (console && console.table) console.table(trace); else console.log('[Boot trace]', trace); } catch(e){}

    // All attempted; start app if possible
    window.__bootReady = true;
    try { if (typeof bootResolve === 'function') bootResolve(true); } catch(e){}
    try { window.dispatchEvent(new CustomEvent('gablok:boot-ready')); } catch(e){}
    try { if (document.readyState !== 'loading' && typeof window.startApp==='function' && !window.__appStarted) { window.__appStarted = true; window.startApp(); } } catch(e){}
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
  // Force startApp if not begun shortly after boot, and attempt recovery render/reload if first frame never appears.
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
        console.warn('[Watchdog] First frame not emitted after 6000ms – attempting recovery.');
        var s = document.getElementById('status'); if (s && !window.__debugStickyStatus) s.textContent = 'Recovering…';
        if (typeof window.renderLoop === 'function') window.renderLoop();
        // If canvas/context still missing, attempt a one-time reload.
        if ((!window.canvas || !window.ctx) && !window.__watchdogReloaded) {
          window.__watchdogReloaded = true;
          setTimeout(function(){ try { if (!window.__firstFrameEmitted) location.reload(); } catch(_r){} }, 800);
        }
      }
    } catch(e){ /* non-fatal */ }
  }, 6000);
})();
