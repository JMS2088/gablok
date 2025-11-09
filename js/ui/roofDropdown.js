// ui/roofDropdown.js
// Roof controls: type selector (7 types)
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

  function setRoofType(value){
    var target = getTargetRoof(); if (!target) return;
    target.roofType = value;
    if (typeof updateStatus==='function') updateStatus('Roof type: ' + (TYPES.find(function(t){return t.v===value;})||{label:value}).label);
    if (typeof renderLoop==='function') renderLoop();
  }

  function closeDropdown(dd){ try { if(dd) dd.classList.remove('open'); } catch(e){} }
  function openDropdown(dd){ try { if(dd) dd.classList.add('open'); } catch(e){} }

  function ensureControls(){
    var container = document.getElementById('roof-controls');
    if (!container){
      container = document.createElement('div');
      container.id = 'roof-controls';
  // Styling now handled via CSS (#roof-controls)

      // Label (kept small for clarity; matches other control labels)
      var label = document.createElement('span');
      label.textContent = 'Roof:';
  label.className = 'roof-label';

      // Styled dropdown matching other menus
      var ddWrap = document.createElement('div');
      ddWrap.id = 'roof-type-dropdown';
      ddWrap.className = 'dropdown';
      ddWrap.setAttribute('aria-label','Roof Type');

      var btn = document.createElement('button');
      btn.id = 'roof-type-button';
      btn.type = 'button';
      btn.className = 'dropdown-button';
      var btnText = document.createElement('span');
      btnText.id = 'roof-type-button-text';
      btnText.textContent = 'Flat';
      var caret = document.createElement('span');
      caret.className = 'caret';
      caret.innerHTML = '<svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L6 6L11 1" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      btn.appendChild(btnText);
      btn.appendChild(caret);

      var list = document.createElement('div');
      list.id = 'roof-type-list';
      list.className = 'dropdown-list';
      list.setAttribute('role','menu');
      // Items
      TYPES.forEach(function(t){
        var item = document.createElement('div');
        item.className = 'dropdown-item';
        item.setAttribute('data-value', t.v);
        item.textContent = t.label;
        list.appendChild(item);
      });

      ddWrap.appendChild(btn);
      ddWrap.appendChild(list);

      container.appendChild(label);
      container.appendChild(ddWrap);
  // Removed top navigation 360° rotate button per request

      var controlsBar = document.getElementById('controls') || document.body;
      controlsBar.appendChild(container);

      // Wiring for dropdown behavior (match other menus)
      btn.addEventListener('click', function(e){ e.stopPropagation(); if(ddWrap.classList.contains('open')) closeDropdown(ddWrap); else openDropdown(ddWrap); });
      list.addEventListener('click', function(e){
        var it = e.target && e.target.closest('.dropdown-item'); if(!it) return;
        var val = it.getAttribute('data-value');
        if (val) { setRoofType(val); setButtonLabel(val); }
        closeDropdown(ddWrap);
      });
      document.addEventListener('click', function(){ closeDropdown(ddWrap); });
      document.addEventListener('keydown', function(ev){ if(ev.key==='Escape') closeDropdown(ddWrap); });
    }
    return container;
  }

  function setButtonLabel(val){
    try{
      var btnText = document.getElementById('roof-type-button-text');
      var t = TYPES.find(function(x){ return x.v===val; });
      if (btnText && t) btnText.textContent = t.label;
    }catch(e){}
  }

  function syncControls(){
    var ui = ensureControls();
    var hasRoof = Array.isArray(window.roofComponents) && roofComponents.length>0;
  if (hasRoof) ui.classList.add('visible'); else ui.classList.remove('visible');
    if (!hasRoof) return;
    var target = getTargetRoof();
    var cur = (target && target.roofType) ? String(target.roofType) : 'flat';
    setButtonLabel(cur);
  }

  // Removed spinRoofOnce animation; rotation is handled via per-roof overlay button in labels.js

  // Init and periodic sync
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ ensureControls(); syncControls(); });
  } else { ensureControls(); syncControls(); }
  setInterval(syncControls, 350);
})();
