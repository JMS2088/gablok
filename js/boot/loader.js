// Lightweight staged loader and lazy stubs
// - Provides loadScript(url) with caching
// - Adds on-demand loaders for UI modules and extra renderers
// - Exposes stubs so app.js can call functions before modules are present

(function(){
  var cache = Object.create(null);
  function loadScript(url){
    if (cache[url]) return cache[url];
    cache[url] = new Promise(function(resolve, reject){
      try {
        var s = document.createElement('script');
        s.src = url; s.async = true; s.defer = true;
        s.onload = function(){ resolve(true); };
        s.onerror = function(){ delete cache[url]; reject(new Error('Failed '+url)); };
        document.head.appendChild(s);
      } catch (e) { delete cache[url]; reject(e); }
    });
    return cache[url];
  }
  window.loadScript = window.loadScript || loadScript;

  // Renderer lazy maps
  var RENDERER_URL = {
    stairs: 'js/render/drawStairs.js',
    pergola: 'js/render/drawPergola.js',
    balcony: 'js/render/drawBalcony.js',
    garage: 'js/render/drawGarage.js',
    pool: 'js/render/drawPool.js',
    roof: 'js/render/drawRoof.js'
  };
  function ensureRenderer(kind){
    var url = RENDERER_URL[kind]; if (!url) return Promise.resolve(false);
    return loadScript(url).then(function(){ return true; }).catch(function(){ return false; });
  }

  // UI module loaders
  function ensurePalette(){ return loadScript('js/ui/roomPalette.js').then(function(){ try{ if(typeof setupPalette==='function') setupPalette(); }catch(e){} return true; }); }
  function ensurePricing(){ return loadScript('js/ui/pricing.js').then(function(){ return true; }); }
  function ensureModals(){ return loadScript('js/ui/modals.js').then(function(){ return true; }); }
  function ensurePlan2D(){ return loadScript('js/plan2d/editor.js').then(function(){ return true; }); }

  // Stubs: renderers (drawX)
  function nudgeRender(){ try { window._needsFullRender = true; if (typeof window.renderLoop==='function') window.renderLoop(); } catch(_e){} }
  if (typeof window.drawStairs !== 'function') window.drawStairs = function(obj){ try{ updateStatus && updateStatus('Loading stairs…'); }catch(_){} ensureRenderer('stairs').then(nudgeRender); };
  if (typeof window.drawPergola !== 'function') window.drawPergola = function(obj){ try{ updateStatus && updateStatus('Loading pergola…'); }catch(_){} ensureRenderer('pergola').then(nudgeRender); };
  if (typeof window.drawBalcony !== 'function') window.drawBalcony = function(obj){ try{ updateStatus && updateStatus('Loading balcony…'); }catch(_){} ensureRenderer('balcony').then(nudgeRender); };
  if (typeof window.drawGarage !== 'function') window.drawGarage = function(obj){ try{ updateStatus && updateStatus('Loading garage…'); }catch(_){} ensureRenderer('garage').then(nudgeRender); };
  if (typeof window.drawPool !== 'function') window.drawPool = function(obj){ try{ updateStatus && updateStatus('Loading pool…'); }catch(_){} ensureRenderer('pool').then(nudgeRender); };
  if (typeof window.drawRoof !== 'function') window.drawRoof = function(obj){ try{ updateStatus && updateStatus('Loading roof…'); }catch(_){} ensureRenderer('roof').then(nudgeRender); };

  // Stubs: UI entry points
  if (typeof window.openRoomPalette !== 'function') window.openRoomPalette = function(roomId){ ensurePalette().then(function(){ try{ openRoomPalette(roomId); }catch(e){} }); };
  if (typeof window.hideRoomPalette !== 'function') window.hideRoomPalette = function(){ ensurePalette().then(function(){ try{ hideRoomPalette(); }catch(e){} }); };
  if (typeof window.setupPalette !== 'function') window.setupPalette = function(){ ensurePalette(); };

  if (typeof window.showPricing !== 'function') window.showPricing = function(){ ensurePricing().then(function(){ try{ showPricing(); }catch(e){} }); };
  if (typeof window.hidePricing !== 'function') window.hidePricing = function(){ ensurePricing().then(function(){ try{ hidePricing(); }catch(e){} }); };

  if (typeof window.showInfo !== 'function') window.showInfo = function(){ ensureModals().then(function(){ try{ showInfo(); }catch(e){} }); };
  if (typeof window.hideInfo !== 'function') window.hideInfo = function(){ ensureModals().then(function(){ try{ hideInfo(); }catch(e){} }); };
  if (typeof window.showShare !== 'function') window.showShare = function(){ ensureModals().then(function(){ try{ showShare(); }catch(e){} }); };
  if (typeof window.hideShare !== 'function') window.hideShare = function(){ ensureModals().then(function(){ try{ hideShare(); }catch(e){} }); };
  if (typeof window.copyShareUrl !== 'function') window.copyShareUrl = function(){ ensureModals().then(function(){ try{ copyShareUrl(); }catch(e){} }); };

  if (typeof window.openPlan2DModal !== 'function') window.openPlan2DModal = function(){ ensurePlan2D().then(function(){ try{ openPlan2DModal(); }catch(e){} }); };
  if (typeof window.closePlan2DModal !== 'function') window.closePlan2DModal = function(){ ensurePlan2D().then(function(){ try{ closePlan2DModal(); }catch(e){} }); };

  // Stage some prefetching after first frame/idling to improve next-use latency
  function prefetch(url){
    try { var l = document.createElement('link'); l.rel='prefetch'; l.href=url; document.head.appendChild(l);} catch(e){}
  }
  function afterFirstPaint(fn){
    if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 600);
  }
  afterFirstPaint(function(){
    // Prefetch commonly used assets but stagger them to avoid bursty connection spikes
    var urls = ['js/ui/roomPalette.js','js/ui/pricing.js','js/ui/modals.js','js/ui/roofDropdown.js','js/plan2d/editor.js',
      'js/render/drawPergola.js','js/render/drawGarage.js','js/render/drawBalcony.js','js/render/drawStairs.js','js/render/drawPool.js','js/render/drawRoof.js'];
    var delay = 0;
    for (var i=0;i<urls.length;i++){
      (function(u, d){ setTimeout(function(){ prefetch(u); }, d); })(urls[i], delay);
      delay += 120; // 120ms spacing keeps concurrency low
    }
  });
})();
