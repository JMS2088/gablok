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
      var delta = (ev.deltaY < 0 ? 1.1 : 1/1.1);
      var old = __plan2d.scale || 100;
      var next = Math.max(10, Math.min(800, old * delta));
      if(next !== old){
        __plan2d.scale = next;
        if(typeof plan2dDraw==='function') plan2dDraw();
        try{ var scl=document.getElementById('plan2d-scale'); if(scl) scl.textContent='1:'+Math.round(100* (100/__plan2d.scale))/100; }catch(_s){}
      }
      ev.preventDefault(); ev.stopPropagation();
    }, { passive:false });
  }
  function init(){
    try{ wireToolButtons(); }catch(e){}
    try{ wireZoomPan(); }catch(e){}
    try{ if(typeof plan2dBind==='function') plan2dBind(); }catch(e){}
    try{ if(typeof plan2dDraw==='function') plan2dDraw(); }catch(e){}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();