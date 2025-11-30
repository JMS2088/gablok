(function(){
  if (window.__tracePanelInit) return; window.__tracePanelInit = true;
  function h(tag, props, children){ var el=document.createElement(tag); if(props){ Object.keys(props).forEach(function(k){ if(k==='class') el.className=props[k]; else if(k==='style') Object.assign(el.style, props[k]); else if(k==='text') el.textContent=props[k]; else if(k==='html') el.innerHTML=props[k]; else el.setAttribute(k, props[k]); }); } if(children){ children.forEach(function(c){ if(!c) return; if(typeof c==='string') el.appendChild(document.createTextNode(c)); else el.appendChild(c); }); } return el; }
  function fmtTime(t){ try{ var d=new Date(t); return d.toLocaleTimeString(); }catch(_){ return String(t); } }
  function fmt(obj){ try{ return JSON.stringify(obj); }catch(_){ return String(obj); } }
  function getTrace(){ try{ if (typeof window.getLatestRoundTripTrace==='function') return window.getLatestRoundTripTrace(300); var raw=localStorage.getItem('gablok_rtTrace_v1'); if(!raw) return []; var arr=JSON.parse(raw); return Array.isArray(arr)? arr: []; }catch(_e){ return []; } }

  // Inject minimal styles (scoped by ids/classes used below)
  var css = [
    '#trace-toggle{ position:fixed; bottom:16px; right:16px; z-index:12050; padding:8px 10px; font-size:12px; border-radius:6px; background:#0f172a; color:#fff; border:none; box-shadow:0 2px 10px rgba(0,0,0,0.3); cursor:pointer; }',
    '#trace-panel{ position:fixed; right:16px; bottom:56px; width:380px; max-height:50vh; background:#fff; color:#111; border:1px solid #d1d5db; border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,0.2); z-index:12050; display:none; overflow:hidden; font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto; }',
    '#trace-head{ display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }',
    '#trace-head .title{ font-weight:600; font-size:13px; }',
    '#trace-head .spacer{ flex:1; }',
    '#trace-body{ display:flex; gap:6px; padding:8px; border-bottom:1px solid #e5e7eb; }',
    '#trace-body input, #trace-body select{ font-size:12px; padding:4px 6px; }',
    '#trace-list{ max-height: calc(50vh - 90px); overflow:auto; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11px; }',
    '.trace-item{ padding:6px 8px; border-bottom:1px dashed #e5e7eb; }',
    '.trace-item .meta{ color:#6b7280; }',
    '.trace-item .kind{ font-weight:600; }',
    '.trace-controls button{ font-size:11px; padding:4px 6px; margin-left:6px; }',
    '.pill{ padding:1px 6px; border-radius:999px; font-size:10px; background:#eef2ff; color:#3730a3; margin-left:6px; }',
  ].join('\n');
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var toggle = h('button', { id:'trace-toggle', title:'Open diagnostics trace' }, ['Diagnostics']);
  var panel = h('div', { id:'trace-panel' });
  var head = h('div', { id:'trace-head' });
  var title = h('div', { class:'title' }, ['Round-trip trace']);
  var rec = h('span', { class:'pill', title:'Events stored in localStorage (persists across reloads)' }, ['persist']);
  var spacer = h('div', { class:'spacer' });
  var btnExport = h('button', { class:'secondary', title:'Download JSON' }, ['Download']);
  var btnClear = h('button', { class:'secondary', title:'Clear trace' }, ['Clear']);
  head.appendChild(title); head.appendChild(rec); head.appendChild(spacer); head.appendChild(btnExport); head.appendChild(btnClear);

  var body = h('div', { id:'trace-body' });
  var selSource = h('select'); ['all','apply','populate','action'].forEach(function(s){ var o=h('option',{ value:s, text:s.toUpperCase() }); selSource.appendChild(o); });
  var inputKind = h('input', { type:'text', placeholder:'filter kind contains…' });
  var inputSearch = h('input', { type:'text', placeholder:'search payload…' });
  var autoChk = h('input', { type:'checkbox', id:'trace-autoscroll' });
  var autoLbl = h('label', { for:'trace-autoscroll' }, [' autoscroll']); autoChk.checked = true;
  body.appendChild(selSource); body.appendChild(inputKind); body.appendChild(inputSearch); body.appendChild(autoChk); body.appendChild(autoLbl);

  var list = h('div', { id:'trace-list' });
  panel.appendChild(head); panel.appendChild(body); panel.appendChild(list);
  document.body.appendChild(toggle); document.body.appendChild(panel);

  function render(){
    var events = getTrace();
    var src = selSource.value || 'all';
    var kindF = (inputKind.value||'').toLowerCase();
    var q = (inputSearch.value||'').toLowerCase();
    var out = [];
    for (var i=events.length-1;i>=0;i--){
      var e = events[i]; if(!e) continue;
      if (src!=='all' && e.source !== src) continue;
      var kind = String(e.kind||''); if (kindF && kind.toLowerCase().indexOf(kindF)===-1) continue;
      var payloadStr = '';
      try { payloadStr = JSON.stringify(e); } catch(_) { payloadStr = String(e); }
      if (q && payloadStr.toLowerCase().indexOf(q)===-1) continue;
      var row = h('div', { class:'trace-item' });
      var meta = h('div', { class:'meta' }, [fmtTime(e.t||Date.now()), ' · ', e.source||'?', ' · ', h('span', { class:'kind' }, [kind])]);
      var pre = h('pre', { style:{ whiteSpace:'pre-wrap', margin:'4px 0 0 0' } }, [payloadStr]);
      row.appendChild(meta); row.appendChild(pre); out.push(row);
    }
    list.innerHTML=''; out.forEach(function(n){ list.appendChild(n); });
    if (autoChk.checked) { try { list.scrollTop = 0; } catch(_){} }
  }

  var open = false; function setOpen(v){ open = !!v; panel.style.display = open? 'block':'none'; if (open) { render(); } }
  toggle.addEventListener('click', function(){ setOpen(!open); });
  btnExport.addEventListener('click', function(){ try{ var data = getTrace(); var blob = new Blob([JSON.stringify({ exportedAt:Date.now(), events:data }, null, 2)], { type:'application/json' }); var a = h('a', { download:'gablok-trace.json' }); a.href = URL.createObjectURL(blob); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000); }catch(e){ console.error('export failed', e); } });
  btnClear.addEventListener('click', function(){ try{ localStorage.removeItem('gablok_rtTrace_v1'); window.__roundTripTrace = []; render(); }catch(e){} });
  selSource.addEventListener('change', render); inputKind.addEventListener('input', render); inputSearch.addEventListener('input', render);

  // Refresh while open (poll best-effort, since not all writers call a shared push)
  setInterval(function(){ if (open) render(); }, 1000);

  // Also refresh on apply summaries
  try { window.addEventListener('gablok:apply-summary', function(){ if (open) render(); }); } catch(_e){}
})();
