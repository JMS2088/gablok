// Orchestrated loader that keeps the splash visible and loads all modules before starting the app
(function(){
  if (window.__bootstrapLoaded) return; window.__bootstrapLoaded = true;
  // Gate startup until boot completes
  window.__requireBoot = true;
  window.__renderingEnabled = false; // Prevent rendering until splash ready
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

  // Unified global asset version (overrides scattered per-file versions)
  var GLOBAL_VERSION = window.__ASSET_VERSION || '20251121-9';
  function withV(path){
    // Remove any existing v= or gv= param then append unified param for hard cache bust
    try {
      var base = path.split('?')[0];
      return base + '?v=' + GLOBAL_VERSION;
    } catch(_e){ return path + '?v=' + GLOBAL_VERSION; }
  }
  console.log('[Boot] Global asset version:', GLOBAL_VERSION);
  // Ordered modules list (essentials first). All versioned uniformly.
  var modules = [
    { label: 'Camera core', url: withV('js/core/engine/camera.js'), critical: true, essential: true },
    { label: 'Placement helper', url: withV('js/core/placement.js'), critical: true, essential: true },
    { label: 'Engine wall strips', url: withV('js/core/engine/wallStrips.js'), critical: true, essential: true },
    { label: 'Engine components', url: withV('js/core/engine/components.js'), critical: true, essential: true },
    { label: 'Core engine', url: withV('js/core/engine3d.js'), critical: true, essential: true },
    { label: 'Project mgmt', url: withV('js/core/project.js'), critical: true, essential: true },
    { label: 'Import/Export', url: withV('js/io/importExport.js'), critical: true },
    { label: 'File I/O', url: withV('js/io/fileIO.js'), critical: true },
    { label: 'DXF', url: withV('js/io/formats/dxf.js'), critical: false },
    { label: 'DWG', url: withV('js/io/formats/dwg.js'), critical: false },
    { label: 'Loader', url: withV('js/boot/loader.js'), critical: true, essential: true },
    { label: 'UI labels', url: withV('js/ui/labels.js'), critical: true, essential: true },
    { label: 'Room palette', url: withV('js/ui/roomPalette.js'), critical: false },
    { label: 'Room renderer', url: withV('js/render/drawRoom.js'), critical: true, essential: true },
    { label: 'Stairs renderer', url: withV('js/render/drawStairs.js'), critical: false },
    { label: 'Pergola renderer', url: withV('js/render/drawPergola.js'), critical: false },
    { label: 'Garage renderer', url: withV('js/render/drawGarage.js'), critical: false },
    { label: 'Roof renderer', url: withV('js/render/drawRoof.js'), critical: false },
    { label: 'Roof dropdown', url: withV('js/ui/roofDropdown.js'), critical: false },
    { label: 'Pool renderer', url: withV('js/render/drawPool.js'), critical: false },
    { label: 'Balcony renderer', url: withV('js/render/drawBalcony.js'), critical: false },
    { label: 'Furniture renderer', url: withV('js/render/drawFurniture.js'), critical: false },
    { label: 'Input events', url: withV('js/input/events.js'), critical: true, essential: true },
    { label: 'History', url: withV('js/input/history.js'), critical: true, essential: true },
    { label: 'Keyboard router', url: withV('js/input/keyboard.js'), critical: true, essential: true },
    { label: 'Plan apply', url: withV('js/core/plan-apply.js'), critical: true },
    { label: 'Plan populate', url: withV('js/core/plan-populate.js'), critical: true },
    { label: 'Consistency checks', url: withV('js/core/consistency.js'), critical: false },
    { label: 'Trace panel', url: withV('js/ui/trace-panel.js'), critical: false },
    { label: 'Admin client', url: withV('js/ui/admin.js'), critical: false },
    { label: 'Info modal', url: withV('js/ui/modals.js'), critical: false },
    { label: 'Pricing modal', url: withV('js/ui/pricing.js'), critical: false },
    { label: 'Plan2D geom', url: withV('js/plan2d/geom2d.js'), critical: false },
    { label: 'Plan2D walls', url: withV('js/plan2d/walls.js'), critical: false },
    { label: 'Plan2D snap', url: withV('js/plan2d/snap.js'), critical: false },
    { label: 'Plan2D core', url: withV('js/plan2d/editor-core.js'), critical: false },
    { label: 'Plan2D draw', url: withV('js/plan2d/draw.js'), critical: false },
    { label: 'Plan2D editor wiring', url: withV('js/plan2d/editor.js'), critical: false },
    { label: 'Plan2D WebGL', url: withV('js/plan2d/webgl.js'), critical: false },
    { label: 'App core', url: withV('js/app.js'), critical: true, essential: true }
  ];

  // Build essential list (modules marked essential)
  try {
    var allLabels = modules.map(function(m){ return (typeof m==='string')? m : m.label; });
    var essentialLabels = modules.filter(function(m){ return m && m.essential; }).map(function(m){ return m.label; });
    if (typeof window.__splashExpect==='function') {
      for (var i=0;i<allLabels.length;i++){ try{ window.__splashExpect(allLabels[i]); }catch(_eSE){} }
    }
    if (typeof window.__splashSetTotal==='function') window.__splashSetTotal(allLabels.length);
    window.__bootEssentialTotal = essentialLabels.length;
    window.__bootEssentialLoaded = 0;
    window.__bootAllTotal = allLabels.length;
    window.__bootAllLoaded = 0;
  } catch(e){}

  function setMsg(msg){ try{ if (typeof window.__splashSetMessage==='function') window.__splashSetMessage(msg); } catch(e){} }
  function tick(label){ try{ if (typeof window.__splashTick==='function') window.__splashTick(label); } catch(e){} }

  (async function(){
    // Simplified parallel loader: essentials sequential, others parallel.
    var trace = [];
    var appStarted = false;
    var essentialDone = false;
    var allDone = false;

    var essentials = modules.filter(function(m){ return m.essential; });
    var others = modules.filter(function(m){ return !m.essential; });

    async function loadOne(m){
      if(typeof m === 'string') m = { label: m, url: m, critical:false };
      var tries=0, maxTries = m.critical ? 2 : 1; var ok=false; var errLast=null; var t0,t1;
      while(tries<maxTries && !ok){
        try {
          setMsg('Loading '+m.label+'…');
          t0 = (performance && performance.now)? performance.now(): Date.now();
          await ensureWithTimeout(m.url, m.critical? 6000:3000, tries+1);
          t1 = (performance && performance.now)? performance.now(): Date.now();
          ok=true;
        } catch(e){ errLast=e; tries++; }
      }
      if(!ok && m.critical){
        try { setMsg('Recovering '+m.label+'…'); t0=(performance&&performance.now)?performance.now():Date.now(); await loadByFetch(m.url); t1=(performance&&performance.now)?performance.now():Date.now(); ok=true; } catch(e2){ errLast = errLast||e2; }
      }
      var dur = (t1&&t0)? Math.round(t1-t0): null;
      trace.push({ module:m.label, url:m.url, ok:!!ok, ms:dur, attempts:tries||1, critical:!!m.critical, version: GLOBAL_VERSION });
      if(ok){
        tick(m.label);
        try { console.log('[BootLoad]', m.label, 'version='+GLOBAL_VERSION, 'ms='+dur); } catch(_eLog){}
        try {
          window.__bootAllLoaded = (window.__bootAllLoaded||0)+1;
          window.dispatchEvent(new CustomEvent('gablok:module-progress', { detail:{ loaded:window.__bootAllLoaded, total:window.__bootAllTotal, label:m.label, ms:dur } }));
          if(m.essential){
            window.__bootEssentialLoaded = (window.__bootEssentialLoaded||0)+1;
            if(window.__bootEssentialLoaded === window.__bootEssentialTotal){ 
              essentialDone=true; 
              window.__renderingEnabled = true; // Enable rendering after essentials loaded
              window.dispatchEvent(new CustomEvent('gablok:essential-complete')); 
              // Auto-select solid render mode once so windows/glass appear immediately
              try {
                if (!window.__wallRenderMode && typeof window.setWallRenderMode==='function') {
                  window.setWallRenderMode('solid');
                  window.__autoWallModeApplied = true;
                }
              } catch(_eAutoMode){}
              // Force early first frame if engine ready but renderLoop not yet kicked
              try {
                if (!window.__firstFrameEmitted) {
                  if (typeof window.setupCanvas==='function') window.setupCanvas();
                  if (typeof window.updateProjectionCache==='function') window.updateProjectionCache();
                  if (typeof window.renderLoop==='function') window.renderLoop();
                }
              } catch(_eForceFF){}
            }
            else window.dispatchEvent(new CustomEvent('gablok:essential-progress', { detail:{ loaded:window.__bootEssentialLoaded, total:window.__bootEssentialTotal, label:m.label } }));
          }
        } catch(_eP){}
      } else {
        try { console[(m.optional?'warn':'error')]('[Boot] Failed', m.label, errLast); } catch(_eC){}
        tick(m.label + ' (failed)');
        try {
          window.__bootAllLoaded = (window.__bootAllLoaded||0)+1;
          window.dispatchEvent(new CustomEvent('gablok:module-progress', { detail:{ loaded:window.__bootAllLoaded, total:window.__bootAllTotal, label:m.label, failed:true } }));
          if(m.essential){
            window.__bootEssentialLoaded = (window.__bootEssentialLoaded||0)+1;
            window.dispatchEvent(new CustomEvent('gablok:essential-progress', { detail:{ loaded:window.__bootEssentialLoaded, total:window.__bootEssentialTotal, label:m.label, failed:true } }));
            if(window.__bootEssentialLoaded === window.__bootEssentialTotal){ essentialDone=true; window.dispatchEvent(new CustomEvent('gablok:essential-complete')); }
          }
        } catch(_ePF){}
      }
      if(!appStarted && ((m.label==='App core') || (m.url && /js\/app\.js/.test(m.url)))){
        appStarted = true; window.__bootReady = true; if(typeof bootResolve==='function') bootResolve(true);
        try { window.dispatchEvent(new CustomEvent('gablok:boot-ready')); } catch(_eEvt){}
        try { if(document.readyState!=='loading' && typeof window.startApp==='function' && !window.__appStarted){ window.__appStarted=true; window.startApp(); } } catch(_eStart){}
      }
    }

    // Load essentials sequentially
    for(var i=0;i<essentials.length;i++){ await loadOne(essentials[i]); }

    // Start app if not yet started after essentials loaded
    if(!appStarted){ window.__bootReady = true; if(typeof bootResolve==='function') bootResolve(true); try{ window.dispatchEvent(new CustomEvent('gablok:boot-ready')); }catch(_eBR){} try{ if(document.readyState!=='loading' && typeof window.startApp==='function' && !window.__appStarted){ window.__appStarted=true; window.startApp(); } }catch(_eSA){} 
      // Ensure a render is attempted immediately after boot-ready
      try { if (!window.__firstFrameEmitted && typeof window.renderLoop==='function') window.renderLoop(); } catch(_eKick){}
    }

    // Load others in parallel
    await Promise.all(others.map(function(m){ return loadOne(m); }));

    // Mark all done
    if(!allDone){ allDone=true; window.dispatchEvent(new CustomEvent('gablok:all-modules-complete')); }

    // Diagnostics
    try {
      window.__bootTrace = trace.slice();
      var slow = trace.filter(function(r){ return r && r.ok && typeof r.ms==='number' && r.ms>300; });
      window.__bootSlowModules = slow;
      if(slow.length && console && console.warn) console.warn('[Boot] Slow modules:', slow.map(function(s){ return s.module+':'+s.ms+'ms'; }).join(', '));
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
      if (!window.__firstFrameEmitted && window.__renderingEnabled) {
        console.warn('[Watchdog] First frame not emitted after 6000ms – attempting recovery render.');
        var s = document.getElementById('status'); if (s && !window.__debugStickyStatus) s.textContent = 'Recovering…';
        if (typeof window.setupCanvas === 'function') window.setupCanvas();
        if (typeof window.updateProjectionCache === 'function') window.updateProjectionCache();
        if (typeof window.renderLoop === 'function') window.renderLoop();
      }
    } catch(e){ /* non-fatal */ }
  }, 6000);
})();
