// ui/roofDropdown.js
// Roof controls: type selector (7 types) + 360° spin button to preview fit across rooms
(function(){
  var TYPES = [
    {v:'flat', label:'Flat'},
    {v:'gable', label:'Gable'},
    {v:'apex', label:'Apex'},
    {v:'hip', label:'Hip'},
    {v:'pyramid', label:'Pyramid'},
    {v:'skillion', label:'Skillion'},
    {v:'barn', label:'Barn'},
    {v:'mansard', label:'Mansard'},
    {v:'cylinder', label:'Cylinder'}
  ];

  function getTargetRoof(){
    if (!Array.isArray(window.roofComponents) || roofComponents.length===0) return null;
    if (window.selectedRoomId){ for (var i=0;i<roofComponents.length;i++){ var r=roofComponents[i]; if(r && r.id===selectedRoomId) return r; } }
    return roofComponents[roofComponents.length-1];
  }

  function ensureControls(){
    var container = document.getElementById('roof-controls');
    if (!container){
      container = document.createElement('div');
      container.id = 'roof-controls';
      container.style.display = 'none';
      container.style.gap = '8px';
      container.style.alignItems = 'center';
      container.style.marginLeft = '8px';
      // Label
      var label = document.createElement('span');
      label.textContent = 'Roof:';
      label.style.fontSize = '12px';
      label.style.color = '#374151';
      // Select
      var dd = document.createElement('select');
      dd.id = 'roof-type-dropdown';
      dd.title = 'Roof Type';
      dd.style.padding = '6px 10px';
      dd.style.border = '1px solid #cbd5e1';
      dd.style.borderRadius = '8px';
      dd.style.background = '#ffffff';
      dd.style.font = '12px system-ui, sans-serif';
      TYPES.forEach(function(t){ var opt=document.createElement('option'); opt.value=t.v; opt.textContent=t.label; dd.appendChild(opt); });
      dd.addEventListener('change', function(){
        var target = getTargetRoof(); if (!target) return;
        target.roofType = dd.value;
        if (typeof updateStatus==='function') updateStatus('Roof type: ' + dd.options[dd.selectedIndex].text);
        if (typeof renderLoop==='function') renderLoop();
      });
      // 360 button
      var spinBtn = document.createElement('button');
      spinBtn.id = 'roof-rotate-button';
      spinBtn.className = 'secondary';
      spinBtn.textContent = '360°';
      spinBtn.title = 'Rotate roof 360°';
      spinBtn.style.padding = '6px 10px';
      spinBtn.addEventListener('click', function(){ spinRoofOnce(); });
      container.appendChild(label);
      container.appendChild(dd);
      container.appendChild(spinBtn);
      var controlsBar = document.getElementById('controls') || document.body;
      controlsBar.appendChild(container);
    }
    return container;
  }

  function syncControls(){
    var ui = ensureControls();
    var hasRoof = Array.isArray(window.roofComponents) && roofComponents.length>0;
    ui.style.display = hasRoof ? 'inline-flex' : 'none';
    if (!hasRoof) return;
    var dd = document.getElementById('roof-type-dropdown');
    var target = getTargetRoof();
    var cur = (target && target.roofType) ? String(target.roofType) : 'flat';
    if (dd && dd.value !== cur) dd.value = cur;
  }

  function spinRoofOnce(){
    var r = getTargetRoof(); if (!r) return;
    try {
      var start = (typeof r.rotation==='number' ? r.rotation : 0);
      var durationMs = 2000; // 2s full spin
      var startTs = (performance && performance.now) ? performance.now() : Date.now();
      if (r.__spinTimer) { cancelAnimationFrame(r.__spinTimer); r.__spinTimer = null; }
      function step(){
        var now = (performance && performance.now) ? performance.now() : Date.now();
        var t = Math.min(1, (now - startTs) / durationMs);
        var angle = start + 360 * t;
        r.rotation = angle % 360;
        if (typeof renderLoop==='function') renderLoop();
        if (t < 1) { r.__spinTimer = requestAnimationFrame(step); } else { r.__spinTimer = null; }
      }
      r.__spinTimer = requestAnimationFrame(step);
    } catch(e){}
  }

  // Init and periodic sync
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ ensureControls(); syncControls(); });
  } else { ensureControls(); syncControls(); }
  setInterval(syncControls, 350);
})();
