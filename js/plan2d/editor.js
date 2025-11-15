// 2D Plan Editor thin wiring stub (refactored)
// Core logic: editor-core.js; Rendering: draw.js.
// This file only wires tool buttons + wheel zoom to avoid duplication.
(function(){
  function wireToolButtons(){
    var map={ wall:'plan2d-tool-wall', window:'plan2d-tool-window', door:'plan2d-tool-door', select:'plan2d-tool-select', erase:'plan2d-tool-erase' };
    Object.keys(map).forEach(function(tool){
      var el=document.getElementById(map[tool]); if(!el) return;
      el.addEventListener('click', function(){
        // Clear previously selected tool button visual state
        try {
          Object.keys(map).forEach(function(t){ var b=document.getElementById(map[t]); if(b) b.classList.remove('selected'); });
          el.classList.add('selected');
        } catch(_cls) {}
        if(typeof plan2dSetTool==='function'){ plan2dSetTool(tool); }
        else {
          __plan2d.tool = tool;
          if(typeof plan2dCursor==='function') plan2dCursor();
          if(typeof plan2dDraw==='function') plan2dDraw();
        }
        try { if (typeof window.__rtActionPush==='function') window.__rtActionPush({ kind:'2d-tool-select', tool: tool }); } catch(_ta){}
      });
    });
    // Fit, Flip, Clear, Export, Import, Apply buttons
  var fit=document.getElementById('plan2d-fit'); if(fit && !fit.__wired){ fit.__wired=true; fit.addEventListener('click', function(){ try{ if(__plan2d){ __plan2d.autoFitEnabled=true; } plan2dFitViewToContent && plan2dFitViewToContent(40,{force:true}); }catch(_){} }); }
    var flip=document.getElementById('plan2d-flip-y'); if(flip && !flip.__wired){ flip.__wired=true; flip.addEventListener('click', function(){ try{ plan2dFlipVertical && plan2dFlipVertical(); }catch(_){} }); }
    var clear=document.getElementById('plan2d-clear'); if(clear && !clear.__wired){ clear.__wired=true; clear.addEventListener('click', function(){ try{ plan2dClear && plan2dClear(); }catch(_){} }); }
    var exp=document.getElementById('plan2d-export'); if(exp && !exp.__wired){ exp.__wired=true; exp.addEventListener('click', function(){ try{ plan2dExport && plan2dExport(); }catch(_){} }); }
    var imp=document.getElementById('plan2d-import'); var file=document.getElementById('plan2d-import-file');
    if(imp && !imp.__wired){ imp.__wired=true; imp.addEventListener('click', function(){ if(file) file.click(); }); }
    if(file && !file.__wired){ file.__wired=true; file.addEventListener('change', function(ev){ try{ var f=ev.target.files && ev.target.files[0]; if(!f) return; var r=new FileReader(); r.onload=function(){ try{ plan2dImport && plan2dImport(r.result); }catch(_){} }; r.readAsText(f); }catch(_){} finally { try{ ev.target.value=''; }catch(_){} } }); }
    // Apply to 3D button: preserve current zoom/pan so user view doesn't jump.
    // Some downstream apply paths or status updates can trigger a fit (autoFitEnabled) indirectly; we suppress that.
    var apply=document.getElementById('plan2d-apply-3d'); if(apply && !apply.__wired){ apply.__wired=true; apply.addEventListener('click', function(){
      try {
        if(typeof __plan2d==='object'){
          // Capture current view state
          var keepScale=__plan2d.scale, keepPanX=__plan2d.panX, keepPanY=__plan2d.panY;
          // Temporarily block auto-fit logic during apply
          try{ __plan2d.autoFitEnabled=false; __plan2d.freezeCenterScaleUntil=Date.now()+1000; }catch(_af){}
          try { if (typeof window.__rtActionPush==='function') window.__rtActionPush({ kind:'2d-apply-click', level:(typeof window.currentFloor==='number'? window.currentFloor:0), elements:(Array.isArray(__plan2d.elements)? __plan2d.elements.length:0) }); } catch(_tap){}
          if(typeof window.applyPlan2DTo3D==='function'){
            // Explicit user apply should rebuild 3D faithfully: disable nonDestructive to remove rooms
            // when rectangles are no longer closed (e.g., a wall was deleted in 2D)
            window.applyPlan2DTo3D(undefined, {
              allowRooms:true,
              quiet:false,
              level:(typeof window.currentFloor==='number'? window.currentFloor:0),
              nonDestructive:false,
              preservePositions:false,
              // Hint for future: if applyPlan2DTo3D adds view-changing behavior later we can read this flag.
              preserveView:true
            });
          }
          // Restore view state (defensive: only if still defined and numeric)
          try {
            if(isFinite(keepScale)) __plan2d.scale=keepScale;
            if(isFinite(keepPanX)) __plan2d.panX=keepPanX;
            if(isFinite(keepPanY)) __plan2d.panY=keepPanY;
          }catch(_rst){}
          try{ if(typeof plan2dDraw==='function') plan2dDraw(); }catch(_drw){}
          // Auto-close 2D editor and return to 3D view after successful apply
          try {
            if(typeof window.closePlan2DModal==='function') {
              // Defer close one frame to let any status updates render
              requestAnimationFrame(function(){ try{ window.closePlan2DModal(); }catch(_cE){} });
            } else {
              // Fallback: hide page directly
              var pg = document.getElementById('plan2d-page'); if(pg) pg.style.display='none';
            }
          }catch(_close2d){}
        } else if(typeof window.applyPlan2DTo3D==='function') {
          window.applyPlan2DTo3D(undefined,{allowRooms:true,quiet:false,level:(typeof window.currentFloor==='number'? window.currentFloor:0), preservePositions:false});
          // If 2D not active (defensive), ensure page hidden
          try{ var pg2=document.getElementById('plan2d-page'); if(pg2) pg2.style.display='none'; }catch(_pghide){}
        }
      } catch(_){}
    }); }

    // Opening property dropdowns wiring (window type + door swing + door hinge)
    var winType=document.getElementById('plan2d-window-type');
    var doorSwing=document.getElementById('plan2d-door-swing');
    var doorHinge=document.getElementById('plan2d-door-hinge');
    function refreshOpeningControls(){
      try{
        var idx = __plan2d.selectedIndex;
        var el = (typeof idx==='number' && idx>=0)? __plan2d.elements[idx] : null;
        if(el && el.type==='window'){
          if(winType){ winType.classList.add('visible');
            var isFull = (el.sillM===0 && el.heightM === (__plan2d.wallHeightM||3.0));
            winType.value = isFull ? 'full' : 'standard';
          }
          if(doorSwing) doorSwing.classList.remove('visible');
          if(doorHinge) doorHinge.classList.remove('visible');
        } else if(el && el.type==='door'){
          if(winType) winType.classList.remove('visible');
          if(doorSwing){
            doorSwing.classList.add('visible');
            doorSwing.value = (el.meta && el.meta.swing) ? el.meta.swing : 'in';
          }
          if(doorHinge){
            doorHinge.classList.add('visible');
            // Explicitly set default left hinge if missing to ensure UI shows immediately
            var hingeVal = (el.meta && el.meta.hinge) ? el.meta.hinge : 't0';
            doorHinge.value = hingeVal;
          }
        } else {
          if(winType) winType.classList.remove('visible');
          if(doorSwing) doorSwing.classList.remove('visible');
          if(doorHinge) doorHinge.classList.remove('visible');
        }
      }catch(_rOC){}
    }
    // Provide external hook used by core to signal selection updates
    try{ window.onPlan2DSelectionChange = function(){ refreshOpeningControls(); }; }catch(_exh){}
    // Expose for selection changes (editor-core sets selection); patch plan2dSetSelection to call refresh.
    try{
      if(typeof window.plan2dSetSelection==='function' && !window.plan2dSetSelection.__patchedForOpeningControls){
        var origSelFn = window.plan2dSetSelection;
        window.plan2dSetSelection = function(idx){ origSelFn(idx); refreshOpeningControls(); };
        window.plan2dSetSelection.__patchedForOpeningControls=true;
      }
    }catch(_patchSel){}
  if(winType && !winType.__wired){ winType.__wired=true; winType.addEventListener('change', function(){ try{ var idx=__plan2d.selectedIndex; if(idx>=0){ var el=__plan2d.elements[idx]; if(el && el.type==='window'){
        // Freeze view so dropdown edits don't trigger zoom/fit from downstream sync
        try{ __plan2d.freezeCenterScaleUntil = Date.now() + 800; __plan2d.autoFitEnabled=false; }catch(_fzW){}
        if(winType.value==='full'){ el.sillM=0; el.heightM=(__plan2d.wallHeightM||3.0); } else { el.sillM=(__plan2d.windowSillM||1.0); el.heightM=(__plan2d.windowHeightM||1.5); }
        plan2dEdited(); plan2dDraw(); refreshOpeningControls(); } } }catch(_chW){} }); }
  if(doorSwing && !doorSwing.__wired){ doorSwing.__wired=true; doorSwing.addEventListener('change', function(){ try{ var idx=__plan2d.selectedIndex; if(idx>=0){ var el=__plan2d.elements[idx]; if(el && el.type==='door'){
        try{ __plan2d.freezeCenterScaleUntil = Date.now() + 800; __plan2d.autoFitEnabled=false; }catch(_fzDS){}
        el.meta = el.meta || { hinge:'t0', swing:'in' }; el.meta.swing = doorSwing.value==='out' ? 'out' : 'in'; plan2dEdited(); plan2dDraw(); refreshOpeningControls(); } } }catch(_chDS){} }); }
  if(doorHinge && !doorHinge.__wired){ doorHinge.__wired=true; doorHinge.addEventListener('change', function(){ try{ var idx=__plan2d.selectedIndex; if(idx>=0){ var el=__plan2d.elements[idx]; if(el && el.type==='door'){
        try{ __plan2d.freezeCenterScaleUntil = Date.now() + 800; __plan2d.autoFitEnabled=false; }catch(_fzDH){}
        el.meta = el.meta || { hinge:'t0', swing:'in' }; el.meta.hinge = (doorHinge.value==='t1') ? 't1':'t0'; plan2dEdited(); plan2dDraw(); refreshOpeningControls(); } } }catch(_chDH){} }); }
    // Initial state hidden
    refreshOpeningControls();
  }
  function wireZoomPan(){
    var c=document.getElementById('plan2d-canvas'); if(!c) return;
    // Throttled wheel zoom: aggregate wheel deltas and apply once per animation frame
    var zoomAgg = { pending:false, accum:1, px:0, py:0, wx:0, wy:0 };
    function applyZoomFrame(){
      try{
        var old = __plan2d.scale || 100;
        var next = Math.max(10, Math.min(800, old * zoomAgg.accum));
        if(next !== old){
          __plan2d.scale = next;
          var s = __plan2d.scale;
          var ox = c.width/2; var oy = c.height/2;
          // Keep last hovered world point anchored under cursor
          __plan2d.panX = (zoomAgg.px - ox)/s - zoomAgg.wx;
          __plan2d.panY = (oy - zoomAgg.py)/s - zoomAgg.wy;
          if(typeof plan2dDraw==='function') plan2dDraw();
          try{ var scl=document.getElementById('plan2d-scale'); if(scl) scl.textContent='1:'+Math.round(100*(100/__plan2d.scale))/100; }catch(_s){}
        }
      }finally{
        zoomAgg.pending=false; zoomAgg.accum=1;
      }
    }
    c.addEventListener('wheel', function(ev){
      if(!__plan2d.active) return;
      // Suppress wheel zoom during eased initial fit or any locked zoom animation
      if(__plan2d.zoomLocked){ ev.preventDefault(); ev.stopPropagation(); return; }
      // Mouse-centered zoom target: remember screen and world under cursor
      var rect=c.getBoundingClientRect();
      var px=(ev.clientX-rect.left)*(c.width/rect.width);
      var py=(ev.clientY-rect.top)*(c.height/rect.height);
      var worldBefore = screenToWorld2D(px,py);
      // Accumulate a scale multiplier; clamp per-frame jump to avoid huge leaps on fast wheels
      var delta = (ev.deltaY < 0 ? 1.1 : 1/1.1);
      // Combine with any pending delta before the frame applies
      var newAccum = zoomAgg.accum * delta;
      // Limit the magnitude applied in a single frame for stability
      var MAX_UP = 1.8, MAX_DOWN = 1/1.8; // ~80% per frame
      if(newAccum > MAX_UP) newAccum = MAX_UP;
      if(newAccum < MAX_DOWN) newAccum = MAX_DOWN;
      zoomAgg.accum = newAccum;
      zoomAgg.px = px; zoomAgg.py = py; zoomAgg.wx = worldBefore.x; zoomAgg.wy = worldBefore.y;
      if(!zoomAgg.pending){ zoomAgg.pending=true; requestAnimationFrame(applyZoomFrame); }
      ev.preventDefault(); ev.stopPropagation();
    }, { passive:false });
  }
  function init(){
    try{ wireToolButtons(); }catch(e){}
    try{ wireZoomPan(); }catch(e){}
    // Floor toggle binding (Ground/First) for the 2D modal
    try{
      var bG=document.getElementById('plan2d-floor-ground');
      var bF=document.getElementById('plan2d-floor-first');
      function setActive(){ try{ var cur=(typeof window.currentFloor==='number'? window.currentFloor:0); if(bG&&bF){ if(cur===0){ bG.classList.add('active'); bF.classList.remove('active'); } else { bF.classList.add('active'); bG.classList.remove('active'); } } }catch(_){} }
      function switchFloor(to){ try{
        // Save current 2D plan before switching (persist draft for prior floor)
        try{ plan2dSaveDraft && plan2dSaveDraft((typeof window.currentFloor==='number'? window.currentFloor:0)); }catch(_s){}
        window.currentFloor = to;
        // Load draft for new floor if it exists
        try{ plan2dLoadDraft && plan2dLoadDraft(to); }catch(_l){}
        var hadDraft = Array.isArray(__plan2d.elements) && __plan2d.elements.length>0;
        // Always repopulate from 3D for target floor if source exists; discard stale cross-floor draft walls.
        var hasSource=false; try {
          var rooms=Array.isArray(window.allRooms)?window.allRooms:[];
          for(var i=0;i<rooms.length;i++){ var r=rooms[i]; if(r && (r.level||0)===to){ hasSource=true; break; } }
          if(!hasSource){ var strips=Array.isArray(window.wallStrips)?window.wallStrips:[]; for(var j=0;j<strips.length;j++){ var ws=strips[j]; if(ws && (ws.level||0)===to){ hasSource=true; break; } } }
        }catch(_src2){}
        if(hasSource && typeof window.populatePlan2DFromDesign==='function'){
          try{ window.populatePlan2DFromDesign(); hadDraft = Array.isArray(__plan2d.elements) && __plan2d.elements.length>0; __plan2d.__userEdited=false; }catch(_pp){}
          try { window.__plan2dDiag = window.__plan2dDiag||{}; window.__plan2dDiag.lastFloorSwitch = { at:Date.now(), to:to, elements: (__plan2d.elements?__plan2d.elements.length:0) }; if(console&&console.debug) console.debug('[PLAN2D FLOOR SWITCH] to', to, 'elements', (__plan2d.elements?__plan2d.elements.length:0)); }catch(_dbgFS){}
        } else {
          __plan2d.elements = []; try{ plan2dSetSelection && plan2dSetSelection(-1); }catch(_sel2){}
          try { window.__plan2dDiag = window.__plan2dDiag||{}; window.__plan2dDiag.lastFloorSwitch = { at:Date.now(), to:to, elements:0, empty:true }; if(console&&console.debug) console.debug('[PLAN2D FLOOR SWITCH] to', to, 'EMPTY (no source)'); }catch(_dbgFS0){}
        }
        // Fit only if there is content; otherwise keep current scale/pan for empty grid.
        if(hadDraft){ try{ plan2dFitViewToContent && plan2dFitViewToContent(40); }catch(_f){} }
        try{ plan2dDraw && plan2dDraw(); }catch(_d){}
        setActive();
      }catch(e){}}
      if(bG && !bG.__wired){ bG.__wired=true; bG.addEventListener('click', function(){ switchFloor(0); }); }
      if(bF && !bF.__wired){ bF.__wired=true; bF.addEventListener('click', function(){ switchFloor(1); }); }
      setActive();
      try{ if(typeof window.syncPlan2DFloorButtons!=='function'){ window.syncPlan2DFloorButtons = function(){ try{ setActive(); }catch(e){} }; } }catch(_exp){}
    }catch(e){}
    try{ if(typeof plan2dBind==='function') plan2dBind(); }catch(e){}
    try{ if(typeof plan2dDraw==='function') plan2dDraw(); }catch(e){}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

// Expose floor switch helper globally for external callers (e.g., app.js sync while 2D active)
try { if(typeof window.plan2dSwitchFloorInEditor!=='function'){ window.plan2dSwitchFloorInEditor = function(to){ try { if(typeof to!=='number') to=0; if(window.__plan2d && __plan2d.active){ var fn=(function(){ var bG=document.getElementById('plan2d-floor-ground'); /* reused in closure above */ return null; })(); }
    // Fallback: reuse the click handlers by dispatching
    if(to===0){ var g=document.getElementById('plan2d-floor-ground'); if(g) g.click(); else { window.currentFloor=0; if(typeof plan2dLoadDraft==='function'){ plan2dLoadDraft(0); } if(typeof populatePlan2DFromDesign==='function'){ populatePlan2DFromDesign(); plan2dDraw && plan2dDraw(); } } }
    else { var f=document.getElementById('plan2d-floor-first'); if(f) f.click(); else { window.currentFloor=1; if(typeof plan2dLoadDraft==='function'){ plan2dLoadDraft(1); } if(typeof populatePlan2DFromDesign==='function'){ populatePlan2DFromDesign(); plan2dDraw && plan2dDraw(); } } }
  }catch(_eFS){} }; } }catch(_eExpose){}