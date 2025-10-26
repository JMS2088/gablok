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
    { label: 'Core engine', url: 'js/core/engine3d.js?v=20251026-1', critical: true },
    { label: 'Loader', url: 'js/boot/loader.js?v=20251026-1', critical: true },
    { label: 'UI labels', url: 'js/ui/labels.js?v=20251026-1', critical: true },
    { label: 'Room renderer', url: 'js/render/drawRoom.js?v=20251026-2', critical: true },
    { label: 'Input/events', url: 'js/input/events.js?v=20251026-1', critical: true },
    { label: 'App core', url: 'js/app.js?v=20251026-1', critical: true }
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
    // Enable interactive step mode with ?boot=step
    var stepMode = false;
    try { stepMode = /(^|[?&])boot=step(&|$)/.test(String(location.search||'')); } catch(e){}

    var trace = [];
    for (var i=0;i<modules.length;i++){
      var m = modules[i]; var tries = 0; var maxTries = m.critical ? 2 : 1;
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
})();
