// Simple loading overlay with staged progress
// Depends on loadScript from loader.js if we need to ensure modules
(function(){
  if (window.__splashReady) return; window.__splashReady = true;
  function el(tag, attrs, children){ var n=document.createElement(tag); if(attrs){ for(var k in attrs){ if(k==='style'){ for(var sk in attrs.style){ n.style[sk]=attrs.style[sk]; } } else if(k==='class'){ n.className=attrs[k]; } else { n.setAttribute(k, attrs[k]); } } } (children||[]).forEach(function(c){ if(typeof c==='string') n.appendChild(document.createTextNode(c)); else if(c) n.appendChild(c); }); return n; }

  function ensureOverlay(){
    var ex = document.getElementById('loading-overlay'); if (ex) return ex;
    var barInner = el('div', { id:'loading-bar-inner', style:{ width:'0%' } });
    var bar = el('div', { id:'loading-bar' }, [ barInner ]);
    var text = el('div', { id:'loading-text' }, ['Loading…']);
    var card = el('div', { id:'loading-card' }, [ el('div',{id:'loading-title'},['Gablok 3D']), bar, text ]);
    var root = el('div', { id:'loading-overlay' }, [ card ]);
    document.body.appendChild(root);
    return root;
  }
  function setProgress(pct, msg){ try{ var i=document.getElementById('loading-bar-inner'); if(i) i.style.width = Math.max(0,Math.min(100,pct))+ '%'; var t=document.getElementById('loading-text'); if(t && msg) t.textContent = msg; }catch(e){} }
  function hideOverlay(){ try{ var r=document.getElementById('loading-overlay'); if(r){ r.classList.add('hide'); setTimeout(function(){ if(r && r.parentNode) r.parentNode.removeChild(r); }, 400); } }catch(e){} }

  function has(fn){ return typeof fn === 'function'; }

  // Small public API for external progress ticks (script onload hooks)
  (function(){
    var total=0, loaded=0, lastMsg='';
    function pct(){ return total>0 ? Math.round((loaded/total)*100) : (loaded%100); }
    window.__splashSetTotal = function(n){ try{ total = Math.max(total, parseInt(n)||0); setProgress(pct(), lastMsg||'Loading…'); }catch(e){} };
    window.__splashTick = function(label){ try{ loaded++; lastMsg = label || lastMsg || 'Loading…'; setProgress(pct(), String(lastMsg)); }catch(e){} };
    window.__splashSetMessage = function(msg){ lastMsg = msg || lastMsg; setProgress(pct(), lastMsg); };
    window.__splashHide = hideOverlay;
  })();

  // Show overlay as early as possible
  if (document.readyState !== 'loading') { try { ensureOverlay(); } catch(e){} }
  else { document.addEventListener('DOMContentLoaded', function(){ try { ensureOverlay(); } catch(e){} }); }

  document.addEventListener('DOMContentLoaded', function(){
    var root = ensureOverlay();
    // If explicit totals are not provided, fall back to staged checks
    var steps = [
      { name:'Core engine', fn: function(){ return Promise.resolve(has(window.startApp)); } },
      { name:'Labels', fn: function(){ return Promise.resolve(has(window.updateLabels)); } },
      { name:'Rooms', fn: function(){ return Promise.resolve(has(window.drawRoom)); } },
      { name:'Roof', fn: function(){ if (has(window.drawRoof)) return Promise.resolve(true); if (window.loadScript) return window.loadScript('js/render/drawRoof.js').then(function(){ return true; }); return Promise.resolve(true); } },
      { name:'Stairs', fn: function(){ if (has(window.drawStairs)) return Promise.resolve(true); if (window.loadScript) return window.loadScript('js/render/drawStairs.js').then(function(){ return true; }); return Promise.resolve(true); } },
      { name:'Pergola', fn: function(){ if (has(window.drawPergola)) return Promise.resolve(true); if (window.loadScript) return window.loadScript('js/render/drawPergola.js').then(function(){ return true; }); return Promise.resolve(true); } },
      { name:'Garage', fn: function(){ if (has(window.drawGarage)) return Promise.resolve(true); if (window.loadScript) return window.loadScript('js/render/drawGarage.js').then(function(){ return true; }); return Promise.resolve(true); } },
      { name:'Pool', fn: function(){ if (has(window.drawPool)) return Promise.resolve(true); if (window.loadScript) return window.loadScript('js/render/drawPool.js').then(function(){ return true; }); return Promise.resolve(true); } },
      { name:'Balcony', fn: function(){ if (has(window.drawBalcony)) return Promise.resolve(true); if (window.loadScript) return window.loadScript('js/render/drawBalcony.js').then(function(){ return true; }); return Promise.resolve(true); } }
    ];
    (async function(){
      // If we have explicit tickers, let those drive progress; otherwise use staged
      var hasExplicit = (typeof window.__splashSetTotal==='function');
      if (!hasExplicit) {
        for (var i=0;i<steps.length;i++){
          var pct0 = Math.round(((i) / steps.length) * 100);
          setProgress(pct0, 'Loading ' + steps[i].name + '…');
          try { await steps[i].fn(); } catch(e) { /* continue */ }
        }
        setProgress(100, 'Ready');
      }
      // Hide when the first frame is rendered (preferred), with small safety timeout as fallback
      var hidden=false; function done(){ if(!hidden){ hidden=true; hideOverlay(); } }
      window.addEventListener('gablok:first-render', function(){ setTimeout(done, 100); }, { once:true });
      setTimeout(done, 1800);
    })();
  });
})();
