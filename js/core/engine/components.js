/**
 * @file components.js
 * @description Extracted component creation helpers (stairs, pergola, garage, pool, roof, balcony) from engine3d.js.
 * Provides: createStairsComponent, createPergolaComponent, createGarageComponent, createPoolComponent, createRoofComponent, createBalconyComponent.
 * Each function is idempotent and preserves legacy global arrays (stairsComponents, pergolaComponents, garageComponents, poolComponents, roofComponents, balconyComponents).
 */
(function(){
  if (typeof window === 'undefined') return;
  function ensureArray(name){ if(!Array.isArray(window[name])) window[name] = []; return window[name]; }
  function nextId(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,10); }
  function pushAndTrace(arr,obj,kind){ arr.push(obj); if(typeof window.__rtTracePush==='function'){ window.__rtTracePush({ kind:kind||'component-add', type:obj.type, id:obj.id }); } }
  function postAddSelectAndRender(obj, addedMsg){
    try { if (typeof window.selectObject==='function') window.selectObject(obj.id, { noRender: true }); else window.selectedRoomId = obj.id; } catch(_eSel){}
    try { if (typeof window.updateMeasurements==='function') window.updateMeasurements(); } catch(_eMs){}
    try { if (typeof window.ensureMeasurementsVisible==='function') window.ensureMeasurementsVisible(); } catch(_eMv){}
    try { if (typeof window.updateStatus==='function' && addedMsg) window.updateStatus(addedMsg); } catch(_eSt){}
    try { if (typeof window.focusCameraOnObject==='function') window.focusCameraOnObject(obj); } catch(_eFc){}
    try { if (typeof window.renderLoop==='function') window.renderLoop(); } catch(_eRl){}
  }

  // --- Default field sets (mirrors earlier engine3d implementations) ---
  function hydrateStairs(s){
    if (s.type!=='stairs') return; if (s.height==null||!isFinite(s.height)) s.height = 3.0; if (s.steps==null||!isFinite(s.steps)) s.steps = 19; if (s.width==null) s.width=1.2; if (s.depth==null) s.depth=4.0; if (s.rotation==null) s.rotation=0; }
  function hydratePergola(p){
    if (p.type!=='pergola') return; if(p.height==null) p.height=2.2; if(p.totalHeight==null) p.totalHeight=p.height; if(p.legWidth==null) p.legWidth=0.25; if(p.slatCount==null) p.slatCount=8; if(p.slatWidth==null) p.slatWidth=0.12; if(p.width==null) p.width=3.0; if(p.depth==null) p.depth=3.0; if(p.rotation==null) p.rotation=0; }
  function hydrateGarage(g){ if(g.type!=='garage') return; if(g.height==null) g.height=2.6; if(g.width==null) g.width=3.2; if(g.depth==null) g.depth=5.5; if(g.rotation==null) g.rotation=0; }
  function hydratePool(p){ if(p.type!=='pool') return; if(p.height==null||!isFinite(p.height)) p.height=2.0; if(p.width==null) p.width=4.0; if(p.depth==null) p.depth=2.0; if(p.edgeWidth==null) p.edgeWidth=0.3; if(p.rotation==null) p.rotation=0; }
  function hydrateRoof(r){ if(r.type!=='roof') return; if(r.width==null) r.width=6.0; if(r.depth==null) r.depth=6.0; if(r.height==null) r.height=1.2; if(r.roofType==null) r.roofType='flat'; if(r.baseHeight==null){ if(r.meta && typeof r.meta.baseHeight==='number') r.baseHeight=r.meta.baseHeight; else r.baseHeight=(typeof window.computeRoofBaseHeight==='function'? window.computeRoofBaseHeight():3.0); } if(r.rotation==null) r.rotation=0; }
  function hydrateBalcony(b){ if(b.type!=='balcony') return; if(b.height==null) b.height=3.0; if(b.totalHeight==null) b.totalHeight=b.height; if(b.wallThickness==null) b.wallThickness=0.12; if(b.wallHeight==null) b.wallHeight=1.0; if(b.legWidth==null) b.legWidth=0.18; if(b.floorThickness==null) b.floorThickness=0.1; if(b.slatCount==null) b.slatCount=8; if(b.slatWidth==null) b.slatWidth=0.12; if(b.roofHeight==null) b.roofHeight=0.25; if(b.width==null) b.width=2.5; if(b.depth==null) b.depth=1.5; if(b.rotation==null) b.rotation=0; }

  function hydrateAllExisting(){
    try { (window.stairsComponents||[]).forEach(hydrateStairs); if(window.stairsComponent) hydrateStairs(window.stairsComponent); } catch(_e){}
    try { (window.pergolaComponents||[]).forEach(hydratePergola); } catch(_e2){}
    try { (window.garageComponents||[]).forEach(hydrateGarage); } catch(_e3){}
    try { (window.poolComponents||[]).forEach(hydratePool); } catch(_e4){}
    try { (window.roofComponents||[]).forEach(hydrateRoof); } catch(_e5){}
    try { (window.balconyComponents||[]).forEach(hydrateBalcony); } catch(_e6){}
  }

  // Stairs
  if (typeof window.createStairsComponent === 'undefined') window.createStairsComponent = function(opts){
    opts = opts || {}; var arr = ensureArray('stairsComponents');
    var comp = { id: nextId('stairs'), type:'stairs', x:+opts.x||0, z:+opts.z||0, width:+opts.width||1.2, depth:+opts.depth||4.0, height:+opts.height||3.0, steps:+opts.steps||19, level:+opts.level||0, rotation:+opts.rotation||0 };
    hydrateStairs(comp); pushAndTrace(arr,comp,'component-add-stairs');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addStairs === 'undefined') window.addStairs = function(){
    var lvl=(typeof window.currentFloor==='number'? window.currentFloor:0), w=1.2,d=4.0,x=0,z=0;
    try{ if(typeof window.findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof window.applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'stairs'}); x=s.x; z=s.z; } }catch(_e2){}
    var comp=createStairsComponent({x:x,z:z,width:w,depth:d,level:lvl});
    postAddSelectAndRender(comp,'Added Stairs');
    return comp;
  };

  // Pergola
  if (typeof window.createPergolaComponent === 'undefined') window.createPergolaComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('pergolaComponents');
    var comp={ id:nextId('pergola'), type:'pergola', x:+opts.x||0, z:+opts.z||0, width:+opts.width||3.0, depth:+opts.depth||3.0, height:+opts.height||2.2, totalHeight:+opts.totalHeight||opts.height||2.2, legWidth:+opts.legWidth||0.25, slatCount:(opts.slatCount!=null? +opts.slatCount:8), slatWidth:+opts.slatWidth||0.12, level:+opts.level||0, rotation:+opts.rotation||0 };
    hydratePergola(comp); pushAndTrace(arr,comp,'component-add-pergola');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addPergola === 'undefined') window.addPergola = function(){
    var lvl=0,w=3.0,d=3.0,x=0,z=0; try{ if(typeof findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'pergola'}); x=s.x; z=s.z; } }catch(_e2){}
    var comp=createPergolaComponent({x:x,z:z,width:w,depth:d,level:lvl}); postAddSelectAndRender(comp,'Added Pergola'); return comp; };

  // Garage
  if (typeof window.createGarageComponent === 'undefined') window.createGarageComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('garageComponents');
    var comp={ id:nextId('garage'), type:'garage', x:+opts.x||0, z:+opts.z||0, width:+opts.width||3.2, depth:+opts.depth||5.5, height:+opts.height||2.6, level:+opts.level||0, rotation:+opts.rotation||0 };
    hydrateGarage(comp); pushAndTrace(arr,comp,'component-add-garage'); if(typeof window.saveProjectSilently==='function') window.saveProjectSilently(); if(typeof window.renderLoop==='function') window.renderLoop(); return comp; };
  if (typeof window.addGarage === 'undefined') window.addGarage = function(){
    var lvl=0,w=3.2,d=5.5,x=0,z=0; try{ if(typeof findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'garage'}); x=s.x; z=s.z; } }catch(_e2){}
    var comp=createGarageComponent({x:x,z:z,width:w,depth:d,level:lvl}); postAddSelectAndRender(comp,'Added Garage'); return comp; };

  // Pool
  if (typeof window.createPoolComponent === 'undefined') window.createPoolComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('poolComponents');
    var comp={ id:nextId('pool'), type:'pool', x:+opts.x||0, z:+opts.z||0, width:+opts.width||4.0, depth:+opts.depth||2.0, height:+opts.height||2.0, edgeWidth:(opts.edgeWidth!=null? +opts.edgeWidth:0.3), level:+opts.level||0, rotation:+opts.rotation||0 };
    hydratePool(comp); pushAndTrace(arr,comp,'component-add-pool'); if(typeof window.saveProjectSilently==='function') window.saveProjectSilently(); if(typeof window.renderLoop==='function') window.renderLoop(); return comp; };
  if (typeof window.addPool === 'undefined') window.addPool = function(){
    var lvl=0,w=4.0,d=2.0,x=0,z=0; try{ if(typeof findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'pool'}); x=s.x; z=s.z; } }catch(_e2){}
    var comp=createPoolComponent({x:x,z:z,width:w,depth:d,level:lvl}); postAddSelectAndRender(comp,'Added Pool'); return comp; };

  // Roof
  if (typeof window.createRoofComponent === 'undefined') window.createRoofComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('roofComponents');
    var baseH=(opts.baseHeight!=null? +opts.baseHeight : (typeof window.computeRoofBaseHeight==='function'? window.computeRoofBaseHeight():3.0));
    var comp={ id:nextId('roof'), type:'roof', x:+opts.x||0, z:+opts.z||0, width:+opts.width||6.0, depth:+opts.depth||6.0, height:+opts.height||1.2, roofType: opts.roofType||'flat', baseHeight: baseH, level:+opts.level||0, rotation:+opts.rotation||0 };
    hydrateRoof(comp); pushAndTrace(arr,comp,'component-add-roof'); if(typeof window.saveProjectSilently==='function') window.saveProjectSilently(); if(typeof window.renderLoop==='function') window.renderLoop(); return comp; };
  if (typeof window.addRoof === 'undefined') window.addRoof = function(){
    var lvl=0,w=6.0,d=6.0,x=0,z=0; try{ if(typeof computeRoofFootprint==='function'){ var fp=computeRoofFootprint(); if(fp){ x=fp.x; z=fp.z; w=Math.max(0.5,fp.width); d=Math.max(0.5,fp.depth); } } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'roof'}); x=s.x; z=s.z; } }catch(_e2){}
    var baseH=(typeof computeRoofBaseHeight==='function'? computeRoofBaseHeight():3.0);
    var comp=createRoofComponent({x:x,z:z,width:w,depth:d,level:lvl,baseHeight:baseH}); postAddSelectAndRender(comp,'Added Roof'); return comp; };

  // Balcony
  if (typeof window.createBalconyComponent === 'undefined') window.createBalconyComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('balconyComponents');
    var comp={ id:nextId('balcony'), type:'balcony', x:+opts.x||0, z:+opts.z||0, width:+opts.width||2.5, depth:+opts.depth||1.5, height:+opts.height||3.0, totalHeight:+opts.totalHeight||opts.height||3.0, wallThickness:+opts.wallThickness||0.12, wallHeight:+opts.wallHeight||1.0, legWidth:+opts.legWidth||0.18, floorThickness:+opts.floorThickness||0.1, slatCount:(opts.slatCount!=null? +opts.slatCount:8), slatWidth:+opts.slatWidth||0.12, roofHeight:+opts.roofHeight||0.25, level:+opts.level||1, rotation:+opts.rotation||0 };
    hydrateBalcony(comp); pushAndTrace(arr,comp,'component-add-balcony'); if(typeof window.saveProjectSilently==='function') window.saveProjectSilently(); if(typeof window.renderLoop==='function') window.renderLoop(); return comp; };
  if (typeof window.addBalcony === 'undefined') window.addBalcony = function(){
    var lvl=1,w=2.5,d=1.5,x=0,z=0; try{ if(typeof findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'balcony'}); x=s.x; z=s.z; } }catch(_e2){}
    var comp=createBalconyComponent({x:x,z:z,width:w,depth:d,level:lvl}); postAddSelectAndRender(comp,'Added Balcony'); return comp; };

  // Hydrate any previously created components (from earlier stripped definitions) so they become visible again.
  hydrateAllExisting();
})();
