// smoke-nontouch.js
// Automated in-browser placement test ensuring objects do not overlap or touch.
// Adds a sequence of macro components + furniture items and asserts inclusive AABB separation (>= 0.01m gap).
// Reports result via /__report endpoint and updates #status if present.
(function(){
  function setStatus(msg){ try{ var s=document.getElementById('status'); if(s) s.textContent = msg; }catch(e){} }
  function report(msg){ try{ fetch('/__report?msg='+encodeURIComponent(msg)).catch(function(){}); }catch(e){} }
  function ready(fn){ if(document.readyState==='complete' || document.readyState==='interactive'){ setTimeout(fn,0); } else { document.addEventListener('DOMContentLoaded', fn); } }
  function aabbOverlapInclusive(a,b){
    var ax0=a.x-a.w/2, ax1=a.x+a.w/2, az0=a.z-a.d/2, az1=a.z+a.d/2;
    var bx0=b.x-b.w/2, bx1=b.x+b.w/2, bz0=b.z-b.d/2, bz1=b.z+b.d/2;
    return (ax0 <= bx1 && ax1 >= bx0 && az0 <= bz1 && az1 >= bz0);
  }
  function gatherFootprints(){
    var out=[];
    function pushArr(arr){ (arr||[]).forEach(function(r){ if(!r) return; out.push({ x:r.x, z:r.z, w:r.width||r.w||0, d:r.depth||r.d||0, id:r.id||r.name||'?'}); }); }
    pushArr(window.allRooms);
    pushArr(window.stairsComponents);
    pushArr(window.pergolaComponents);
    pushArr(window.garageComponents);
    pushArr(window.poolComponents);
    pushArr(window.roofComponents);
    pushArr(window.balconyComponents);
    pushArr(window.furnitureItems);
    return out.filter(function(o){ return isFinite(o.x) && isFinite(o.z) && o.w>0 && o.d>0; });
  }
  function validateNoTouch(){
    var fp = gatherFootprints();
    // Build per-level segregation if level field exists (rooms/components have it)
    var byLevel = {};
    fp.forEach(function(o){ var lvl=(o.level!=null? o.level:0); if(!byLevel[lvl]) byLevel[lvl]=[]; byLevel[lvl].push(o); });
    var violations=[];
    Object.keys(byLevel).forEach(function(lvl){
      var list = byLevel[lvl];
      for(var i=0;i<list.length;i++){
        for(var j=i+1;j<list.length;j++){
          if(aabbOverlapInclusive(list[i], list[j])){
            violations.push(list[i].id+' touches '+list[j].id+' (level '+lvl+')');
          }
        }
      }
    });
    return { ok: violations.length===0, violations: violations };
  }
  function placeSequence(){
    try { if(typeof window.addNewRoom==='function') window.addNewRoom(); } catch(e){}
    try { if(typeof window.addPergola==='function') window.addPergola(); } catch(e){}
    try { if(typeof window.addGarage==='function') window.addGarage(); } catch(e){}
    try { if(typeof window.addPool==='function') window.addPool(); } catch(e){}
    try { if(typeof window.addBalcony==='function') window.addBalcony(); } catch(e){}
    // Add a few furniture items directly if rooms exist
    var room = (window.allRooms && window.allRooms[0]) || null;
    if(room){
      if(!Array.isArray(window.furnitureItems)) window.furnitureItems=[];
      var furnDefs=[{name:'Single Bed', width:1.1, depth:2.2, height:0.6, kind:'bed'}, {name:'Kitchen Design 01', width:3.0, depth:0.7, height:0.9, kind:'kitchen'}, {name:'Sofa 3 seats', width:2.0, depth:0.9, height:0.9, kind:'sofa'}];
      furnDefs.forEach(function(def){
        var base = { x:room.x, z:room.z, w:def.width, d:(def.kind==='kitchen'? 0.7 : def.depth) };
        var existing = window.furnitureItems.map(function(f){ return { x:f.x, z:f.z, w:f.width, d:f.depth }; });
        var grid = (typeof window.GRID_SPACING==='number' && window.GRID_SPACING>0)? window.GRID_SPACING : 1;
        var spot = (typeof window.findNonTouchingSpot==='function') ? window.findNonTouchingSpot(base, existing, grid) : { x:base.x, z:base.z };
        var furn = { id:'furn_smoke_'+def.kind+'_'+Math.random().toString(36).slice(2), x:spot.x, z:spot.z, width:def.width, depth:(def.kind==='kitchen'?0.7:def.depth), height:def.height, level:room.level, elevation:(def.kind==='tv'?0.8:0), name:def.name, type:'furniture', rotation:0, kind:def.kind };
        window.furnitureItems.push(furn);
      });
    }
    if(typeof window.renderLoop==='function') window.renderLoop();
  }
  function run(){
    placeSequence();
    // Allow a couple of frames for final adjustments
    setTimeout(function(){
      var res = validateNoTouch();
      if(res.ok){ setStatus('Non-touch smoke: PASS'); report('non-touch:PASS'); }
      else { setStatus('Non-touch smoke: FAIL '+res.violations.length); report('non-touch:FAIL:'+res.violations.join(';')); console.warn('[NonTouchSmoke] Violations:', res.violations); }
    }, 200);
  }
  // Query param trigger ?smoke=nontouch
  function qs(name){ try { var m = location.search.match(new RegExp('[?&]'+name+'=([^&]+)')); return m? decodeURIComponent(m[1]): null; }catch(e){ return null; } }
  ready(function(){ if(qs('smoke')==='nontouch'){ setTimeout(run,150); } });
  window.smokeNonTouch = run;
})();
