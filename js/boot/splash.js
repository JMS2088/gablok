// Simple loading overlay with staged progress
// Depends on loadScript from loader.js if we need to ensure modules
(function(){
  if (window.__splashReady) return; window.__splashReady = true;
  function el(tag, attrs, children){ var n=document.createElement(tag); if(attrs){ for(var k in attrs){ if(k==='style'){ for(var sk in attrs.style){ n.style[sk]=attrs.style[sk]; } } else if(k==='class'){ n.className=attrs[k]; } else { n.setAttribute(k, attrs[k]); } } } (children||[]).forEach(function(c){ if(typeof c==='string') n.appendChild(document.createTextNode(c)); else if(c) n.appendChild(c); }); return n; }

  var __splash = { continueResolve: null };
  function ensureOverlay(){
    var ex = document.getElementById('loading-overlay'); if (ex) return ex;
    var barInner = el('div', { id:'loading-bar-inner', style:{ width:'0%' } });
    var bar = el('div', { id:'loading-bar' }, [ barInner ]);
    var text = el('div', { id:'loading-text' }, ['Loading…']);
    // Per-module list wrapper (optional)
    var listWrap = el('div', { id:'loading-list', style:{ marginTop:'10px', display:'flex', flexDirection:'column', gap:'6px' } }, []);
    var title = el('div', { id:'loading-title', style:{ textAlign:'center', fontWeight:'700', fontSize:'32px', letterSpacing:'1px' } }, ['Gablok']);
    var subtitle = el('div', { id:'loading-subtitle' }, ['3D Home Configurator']);
    var btn = el('button', { id:'loading-continue', style:{ display:'none', marginTop:'10px', alignSelf:'center', padding:'6px 12px', border:'1px solid #30363d', borderRadius:'8px', background:'#0f172a', color:'#cbd5e1', cursor:'pointer' } }, ['Continue']);
    btn.addEventListener('click', function(){ try{ var r=__splash.continueResolve; __splash.continueResolve=null; btn.style.display='none'; if(r) r(true); }catch(e){} });
    var card = el('div', { id:'loading-card' }, [ title, subtitle, bar, text, listWrap, btn ]);
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
    var items = Object.create(null); // per-label rows (legacy)
    var groupMode = true; // enable grouped bars to keep only ~6-7 rows visible
    var groupDefs = [
      { name: 'Core', match: function(l){ return /(Camera core|Placement helper|Engine wall strips|Engine components|Core engine|App core|Loader)/i.test(l); } },
      { name: 'Project & I/O', match: function(l){ return /(Project mgmt|Import\/Export|File I\/O)/i.test(l); } },
      { name: 'Input', match: function(l){ return /(Keyboard router|input\/events\.js)/i.test(l); } },
      { name: 'Renderers', match: function(l){ return /(Room renderer|Stairs renderer|Pergola renderer|Garage renderer|Roof renderer|Pool renderer|Balcony renderer|Furniture renderer)/i.test(l); } },
      { name: 'UI', match: function(l){ return /(UI labels|Room palette|Roof dropdown|Info modal|Pricing modal|Trace panel)/i.test(l); } },
      { name: 'Plan2D', match: function(l){ return /(Plan2D (geom|walls|snap|core|draw|editor wiring|WebGL))/i.test(l); } },
      { name: 'Formats', match: function(l){ return /(DXF|DWG|pdf|vendor)/i.test(l); } }
    ];
    var labelToGroup = Object.create(null); // label -> groupName
    var groupTotals = Object.create(null);  // groupName -> count of labels
    var groupLoaded = Object.create(null);  // groupName -> count loaded
    var groupItems = Object.create(null);   // groupName -> {row, bar, lab}

    function classifyGroup(label){
      for(var i=0;i<groupDefs.length;i++){ if(groupDefs[i].match(label)) return groupDefs[i].name; }
      return 'Misc';
    }
    function ensureGroupItem(groupName){
      try{
        var list = document.getElementById('loading-list'); if(!list) return null;
        if(groupItems[groupName]) return groupItems[groupName];
        var outer = document.createElement('div'); outer.style.display='flex'; outer.style.flexDirection='column'; outer.style.gap='4px'; outer.setAttribute('data-group', groupName);
        var lab = document.createElement('div'); lab.textContent = groupName; lab.style.fontSize='12px'; lab.style.color='#8b949e'; lab.id = 'loading-group-label-'+groupName.replace(/[^a-z0-9_-]+/ig,'_');
        var barO = document.createElement('div'); barO.style.height='6px'; barO.style.border='1px solid #30363d'; barO.style.borderRadius='999px'; barO.style.overflow='hidden'; barO.style.background='#21262d';
        var barI = document.createElement('div'); barI.style.height='100%'; barI.style.width='0%'; barI.style.background='linear-gradient(90deg, #238636, #2ea043)'; barI.style.transition='width .3s ease';
        barO.appendChild(barI);
        outer.appendChild(lab); outer.appendChild(barO);
        list.appendChild(outer);
        groupItems[groupName] = { row: outer, bar: barI, lab: lab };
        return groupItems[groupName];
      }catch(e){ return null; }
    }
    function ensureItem(label){
      if(groupMode){ return ensureGroupItem(classifyGroup(label)); }
      try{
        var list = document.getElementById('loading-list'); if(!list) return null;
        if(items[label]) return items[label];
        var outer = document.createElement('div'); outer.style.display='flex'; outer.style.flexDirection='column'; outer.style.gap='4px'; outer.setAttribute('data-label', label);
        var lab = document.createElement('div'); lab.textContent = label; lab.style.fontSize='12px'; lab.style.color='#8b949e'; lab.id = 'loading-item-label-'+label.replace(/[^a-z0-9_-]+/ig,'_');
        var barO = document.createElement('div'); barO.style.height='6px'; barO.style.border='1px solid #30363d'; barO.style.borderRadius='999px'; barO.style.overflow='hidden'; barO.style.background='#21262d';
        var barI = document.createElement('div'); barI.style.height='100%'; barI.style.width='0%'; barI.style.background='linear-gradient(90deg, #238636, #2ea043)'; barI.style.transition='width .3s ease';
        barO.appendChild(barI);
        outer.appendChild(lab); outer.appendChild(barO);
        list.appendChild(outer);
        items[label] = { row: outer, bar: barI, lab: lab };
        return items[label];
      }catch(e){ return null; }
    }
    function pct(){ return total>0 ? Math.round((loaded/total)*100) : (loaded%100); }
    window.__splashSetTotal = function(n){ try{ total = Math.max(total, parseInt(n)||0); setProgress(pct(), lastMsg||'Loading…'); }catch(e){} };
    window.__splashExpect = function(labels){ try{
      ensureOverlay();
      if(!Array.isArray(labels)) return;
      // Build group maps
      if(groupMode){
        labelToGroup = Object.create(null); groupTotals = Object.create(null); groupLoaded = Object.create(null);
        labels.forEach(function(lbl){ var l=String(lbl); var g = classifyGroup(l); labelToGroup[l]=g; groupTotals[g]=(groupTotals[g]||0)+1; });
        Object.keys(groupTotals).forEach(function(g){ groupLoaded[g]=0; ensureGroupItem(g); });
      } else {
        labels.forEach(function(l){ ensureItem(String(l)); });
      }
    }catch(e){} };
    window.__splashTick = function(label){ try{
      loaded++; lastMsg = label || lastMsg || 'Loading…'; setProgress(pct(), String(lastMsg));
      if(!label) return;
      var l = String(label);
      if(groupMode){
        var g = labelToGroup[l] || classifyGroup(l);
        groupLoaded[g] = Math.min((groupLoaded[g]||0)+1, groupTotals[g]||1);
        var itG = ensureGroupItem(g);
        var denom = Math.max(1, groupTotals[g]||1);
        var gpct = Math.round((groupLoaded[g] / denom) * 100);
        if(itG && itG.bar) itG.bar.style.width = gpct+'%';
        if(itG && itG.lab) itG.lab.textContent = g + ' — ' + groupLoaded[g] + '/' + denom;
      } else {
        var it = ensureItem(l); if(it && it.bar) it.bar.style.width = '100%';
      }
    }catch(e){} };
    window.__splashMark = function(label, text){ try{
      var l=String(label);
      if(groupMode){ var g = labelToGroup[l] || classifyGroup(l); var itG = ensureGroupItem(g); if(itG && itG.lab){ var denom=Math.max(1, groupTotals[g]||1); var cur=(groupLoaded[g]||0); itG.lab.textContent = g + ' — ' + cur + '/' + denom + (text? (' · '+text):''); } }
      else { var it = ensureItem(l); if(it && it.lab){ it.lab.textContent = String(label) + (text ? ' — '+ String(text) : ''); } }
    }catch(e){} };
    window.__splashWaitForContinue = function(){ try { ensureOverlay(); var b = document.getElementById('loading-continue'); if(!b) return Promise.resolve(true); b.style.display='inline-block'; return new Promise(function(res){ __splash.continueResolve = res; }); } catch(e){ return Promise.resolve(true); } };
    window.__splashSetMessage = function(msg){ lastMsg = msg || lastMsg; setProgress(pct(), lastMsg); };
    window.__splashHide = hideOverlay;
    // Listen for overall module progress to adjust headline when essentials done.
    window.addEventListener('gablok:module-progress', function(ev){
      try {
        var d = ev.detail||{};
        if (typeof window.__bootEssentialTotal==='number' && typeof window.__bootEssentialLoaded==='number') {
          var essentialsPct = (window.__bootEssentialTotal>0)? Math.round((window.__bootEssentialLoaded/window.__bootEssentialTotal)*100):0;
          // Show dual-phase message until essentials complete
          if (window.__bootEssentialLoaded < window.__bootEssentialTotal) {
            setProgress(Math.max(essentialsPct, pct()), 'Core '+essentialsPct+'% · '+(d.loaded||0)+'/'+(d.total||0));
          } else {
            // After essentials, progress reflects total modules
            var totalPct = (d.total>0)? Math.round((d.loaded/d.total)*100):pct();
            setProgress(totalPct, 'Modules '+totalPct+'%');
          }
        }
      } catch(_eModP){}
    });
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
      // Splash hide gating: require essentials + first frame OR extended fallback.
      var hidden=false; function done(){ if(!hidden){ hidden=true; hideOverlay(); } }
      var essentialsComplete = false;
      var firstFrame = false;
      function tryHide(){ if(essentialsComplete && firstFrame){ setTimeout(done, 120); } }
      window.addEventListener('gablok:essential-progress', function(ev){
        try {
          var d = ev.detail||{}; var pctE = (d.total>0)? Math.round((d.loaded/d.total)*100):0;
          setProgress(pctE, 'Loading core… '+pctE+'%');
        } catch(_eP){}
      });
      window.addEventListener('gablok:essential-complete', function(){
        essentialsComplete = true;
        setProgress(100, 'Core ready');
        tryHide();
      }, { once:true });
      window.addEventListener('gablok:first-render', function(){ firstFrame = true; tryHide(); }, { once:true });
      // Extended fallback: if essentials loaded but no frame, force recovery after 4000ms; else if neither ready after 9000ms, hide anyway.
      setTimeout(function(){ if(essentialsComplete && !firstFrame){ setProgress(100,'Starting…'); try { if (typeof window.renderLoop==='function') window.renderLoop(); } catch(_eR){} } }, 4000);
      setTimeout(function(){ if(!hidden){ done(); } }, 9000);
    })();
  });
})();
