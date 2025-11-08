// 2D Plan Editor thin wiring stub (refactored)
// Core logic: editor-core.js; Rendering: draw.js.
// This file only wires tool buttons + wheel zoom to avoid duplication.
(function(){
  function wireToolButtons(){
    var map={ wall:'plan2d-tool-wall', window:'plan2d-tool-window', door:'plan2d-tool-door', select:'plan2d-tool-select', erase:'plan2d-tool-erase' };
    Object.keys(map).forEach(function(tool){
      var el=document.getElementById(map[tool]); if(!el) return;
      el.addEventListener('click', function(){
        __plan2d.tool = tool;
        if(typeof plan2dCursor==='function') plan2dCursor();
        if(typeof plan2dDraw==='function') plan2dDraw();
      });
    });
    // Fit, Flip, Clear, Export, Import, Apply buttons
    var fit=document.getElementById('plan2d-fit'); if(fit && !fit.__wired){ fit.__wired=true; fit.addEventListener('click', function(){ try{ plan2dFitViewToContent && plan2dFitViewToContent(40); }catch(_){} }); }
    var flip=document.getElementById('plan2d-flip-y'); if(flip && !flip.__wired){ flip.__wired=true; flip.addEventListener('click', function(){ try{ plan2dFlipVertical && plan2dFlipVertical(); }catch(_){} }); }
    var clear=document.getElementById('plan2d-clear'); if(clear && !clear.__wired){ clear.__wired=true; clear.addEventListener('click', function(){ try{ plan2dClear && plan2dClear(); }catch(_){} }); }
    var exp=document.getElementById('plan2d-export'); if(exp && !exp.__wired){ exp.__wired=true; exp.addEventListener('click', function(){ try{ plan2dExport && plan2dExport(); }catch(_){} }); }
    var imp=document.getElementById('plan2d-import'); var file=document.getElementById('plan2d-import-file');
    if(imp && !imp.__wired){ imp.__wired=true; imp.addEventListener('click', function(){ if(file) file.click(); }); }
    if(file && !file.__wired){ file.__wired=true; file.addEventListener('change', function(ev){ try{ var f=ev.target.files && ev.target.files[0]; if(!f) return; var r=new FileReader(); r.onload=function(){ try{ plan2dImport && plan2dImport(r.result); }catch(_){} }; r.readAsText(f); }catch(_){} finally { try{ ev.target.value=''; }catch(_){} } }); }
    var apply=document.getElementById('plan2d-apply-3d'); if(apply && !apply.__wired){ apply.__wired=true; apply.addEventListener('click', function(){ try{ if(typeof window.applyPlan2DTo3D==='function'){ window.applyPlan2DTo3D(undefined,{allowRooms:true,quiet:false,level:(typeof window.currentFloor==='number'? window.currentFloor:0)}); } }catch(_){} }); }
  }
  function wireZoomPan(){
    var c=document.getElementById('plan2d-canvas'); if(!c) return;
    c.addEventListener('wheel', function(ev){
      if(!__plan2d.active) return;
      // Suppress wheel zoom during eased initial fit or any locked zoom animation
      if(__plan2d.zoomLocked){ ev.preventDefault(); ev.stopPropagation(); return; }
      // Mouse-centered zoom: keep the world point under the cursor fixed while scaling
      var rect=c.getBoundingClientRect();
      var px=(ev.clientX-rect.left)*(c.width/rect.width);
      var py=(ev.clientY-rect.top)*(c.height/rect.height);
      var worldBefore = screenToWorld2D(px,py);
      var delta = (ev.deltaY < 0 ? 1.1 : 1/1.1);
      var old = __plan2d.scale || 100;
      var next = Math.max(10, Math.min(800, old * delta));
      if(next !== old){
        __plan2d.scale = next;
        // Recompute pan so worldBefore maps back to same screen px, solving label/button drift
        var s = __plan2d.scale;
        var ox = c.width/2; var oy = c.height/2;
        // screenX = ox + (panX + wx)*s  => panX = (px - ox)/s - wx
        // screenY = oy - (panY + wy)*s  => panY = (oy - py)/s - wy
        __plan2d.panX = (px - ox)/s - worldBefore.x;
        __plan2d.panY = (oy - py)/s - worldBefore.y;
        if(typeof plan2dDraw==='function') plan2dDraw();
        try{ var scl=document.getElementById('plan2d-scale'); if(scl) scl.textContent='1:'+Math.round(100* (100/__plan2d.scale))/100; }catch(_s){}
      }
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
        if(!hadDraft){
          // Only auto-populate from 3D if there is source content on this floor.
          var hasSource=false;
          try {
            var rooms=Array.isArray(window.allRooms)?window.allRooms:[];
            for(var i=0;i<rooms.length;i++){ var r=rooms[i]; if(r && (r.level||0)===to){ hasSource=true; break; } }
            if(!hasSource){
              var strips=Array.isArray(window.wallStrips)?window.wallStrips:[];
              for(var j=0;j<strips.length;j++){ var ws=strips[j]; if(ws && (ws.level||0)===to){ hasSource=true; break; } }
            }
          } catch(_src){}
          if(hasSource && typeof window.populatePlan2DFromDesign==='function'){
            try{ window.populatePlan2DFromDesign(); hadDraft = Array.isArray(__plan2d.elements) && __plan2d.elements.length>0; }catch(_p){}
          } else {
            // Ensure blank state for floors with no content (e.g. First floor before any rooms added)
            __plan2d.elements = []; try{ plan2dSetSelection && plan2dSetSelection(-1); }catch(_sel){}
            // Maintain existing pan/scale; do NOT fit view on an empty floor
          }
        }
        // Fit only if there is content; otherwise keep current scale/pan for empty grid.
        if(hadDraft){ try{ plan2dFitViewToContent && plan2dFitViewToContent(40); }catch(_f){} }
        try{ plan2dDraw && plan2dDraw(); }catch(_d){}
        setActive();
      }catch(e){}}
      if(bG && !bG.__wired){ bG.__wired=true; bG.addEventListener('click', function(){ switchFloor(0); }); }
      if(bF && !bF.__wired){ bF.__wired=true; bF.addEventListener('click', function(){ switchFloor(1); }); }
      setActive();
    }catch(e){}
    try{ if(typeof plan2dBind==='function') plan2dBind(); }catch(e){}
    try{ if(typeof plan2dDraw==='function') plan2dDraw(); }catch(e){}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();