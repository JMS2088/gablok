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
    try { if (typeof window.selectObject==='function') window.selectObject(obj.id, { noRender: true }); } catch(_eSel){}
    try { if (typeof window.updateMeasurements==='function') window.updateMeasurements(); } catch(_eMs){}
    try { if (typeof window.ensureMeasurementsVisible==='function') window.ensureMeasurementsVisible(); } catch(_eMv){}
    try { if (typeof window.updateStatus==='function' && addedMsg) window.updateStatus(addedMsg); } catch(_eSt){}
    try { if (typeof window.focusCameraOnObject==='function') window.focusCameraOnObject(obj); } catch(_eFc){}
    try { if (typeof window.renderLoop==='function') window.renderLoop(); } catch(_eRl){}
  }

  // Stairs
  if (typeof window.createStairsComponent === 'undefined') window.createStairsComponent = function(opts){
    opts = opts || {}; var arr = ensureArray('stairsComponents');
    var comp = { id: nextId('stairs'), type:'stairs', x: +opts.x||0, z:+opts.z||0, width:+opts.width||1.2, depth:+opts.depth||3.2, level:+opts.level||0, rotation:+opts.rotation||0, meta: opts.meta||null };
    pushAndTrace(arr,comp,'component-add-stairs');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addStairs === 'undefined') window.addStairs = function(){
    var lvl = (typeof window.currentFloor==='number'? window.currentFloor:0);
    var w=1.2, d=4.0, x=0, z=0;
    try { if (typeof window.findFreeSpotForFootprint==='function'){ var spot=window.findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } } catch(_e){}
    try { if (typeof window.applySnap==='function'){ var s=window.applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'stairs'}); x=s.x; z=s.z; } } catch(_e){}
    var comp = window.createStairsComponent({ x:x, z:z, width:w, depth:d, level:lvl });
    postAddSelectAndRender(comp, 'Added Stairs');
    return comp;
  };

  // Pergola
  if (typeof window.createPergolaComponent === 'undefined') window.createPergolaComponent = function(opts){
    opts = opts || {}; var arr = ensureArray('pergolaComponents');
    var comp = { id: nextId('pergola'), type:'pergola', x:+opts.x||0, z:+opts.z||0, width:+opts.width||3.5, depth:+opts.depth||3.0, level:+opts.level||0, rotation:+opts.rotation||0, meta: opts.meta||null };
    pushAndTrace(arr,comp,'component-add-pergola');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addPergola === 'undefined') window.addPergola = function(){
    var lvl=0, w=3.0, d=3.0, x=0, z=0;
    try { if (typeof window.findFreeSpotForFootprint==='function'){ var spot=window.findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } } catch(_e){}
    try { if (typeof window.applySnap==='function'){ var s=window.applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'pergola'}); x=s.x; z=s.z; } } catch(_e){}
    var comp = window.createPergolaComponent({ x:x, z:z, width:w, depth:d, level:lvl });
    postAddSelectAndRender(comp, 'Added Pergola');
    return comp;
  };

  // Garage
  if (typeof window.createGarageComponent === 'undefined') window.createGarageComponent = function(opts){
    opts = opts || {}; var arr = ensureArray('garageComponents');
    var comp = { id: nextId('garage'), type:'garage', x:+opts.x||0, z:+opts.z||0, width:+opts.width||5.8, depth:+opts.depth||6.2, height:+opts.height||2.6, level:+opts.level||0, rotation:+opts.rotation||0, meta: opts.meta||null };
    pushAndTrace(arr,comp,'component-add-garage');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addGarage === 'undefined') window.addGarage = function(){
    var lvl=0, w=3.2, d=5.5, x=0, z=0;
    try { if (typeof window.findFreeSpotForFootprint==='function'){ var spot=window.findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } } catch(_e){}
    try { if (typeof window.applySnap==='function'){ var s=window.applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'garage'}); x=s.x; z=s.z; } } catch(_e){}
    var comp = window.createGarageComponent({ x:x, z:z, width:w, depth:d, level:lvl, height:2.6 });
    postAddSelectAndRender(comp, 'Added Garage');
    return comp;
  };

  // Pool
  if (typeof window.createPoolComponent === 'undefined') window.createPoolComponent = function(opts){
    opts = opts || {}; var arr = ensureArray('poolComponents');
    var comp = { id: nextId('pool'), type:'pool', x:+opts.x||0, z:+opts.z||0, width:+opts.width||5.0, depth:+opts.depth||10.0, level:+opts.level||0, rotation:+opts.rotation||0, meta: opts.meta||null };
    pushAndTrace(arr,comp,'component-add-pool');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addPool === 'undefined') window.addPool = function(){
    var lvl=0, w=4.0, d=2.0, x=0, z=0;
    try { if (typeof window.findFreeSpotForFootprint==='function'){ var spot=window.findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } } catch(_e){}
    try { if (typeof window.applySnap==='function'){ var s=window.applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'pool'}); x=s.x; z=s.z; } } catch(_e){}
    var comp = window.createPoolComponent({ x:x, z:z, width:w, depth:d, level:lvl });
    postAddSelectAndRender(comp, 'Added Pool');
    return comp;
  };

  // Roof
  if (typeof window.createRoofComponent === 'undefined') window.createRoofComponent = function(opts){
    opts = opts || {}; var arr = ensureArray('roofComponents');
    var comp = { id: nextId('roof'), type:'roof', x:+opts.x||0, z:+opts.z||0, width:+opts.width||7.0, depth:+opts.depth||7.0, level:+opts.level||1, rotation:+opts.rotation||0, pitch:+opts.pitch||30, meta: opts.meta||null };
    pushAndTrace(arr,comp,'component-add-roof');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addRoof === 'undefined') window.addRoof = function(){
    var lvl=0, w=6.0, d=6.0, x=0, z=0;
    try { if (typeof window.computeRoofFootprint==='function'){ var fp=window.computeRoofFootprint(); if(fp){ x=fp.x; z=fp.z; w=Math.max(0.5,fp.width||w); d=Math.max(0.5,fp.depth||d); } } } catch(_e){}
    try { if (typeof window.applySnap==='function'){ var s=window.applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'roof'}); x=s.x; z=s.z; } } catch(_e){}
    var baseY = 3.0; try { if (typeof window.computeRoofBaseHeight==='function') baseY = window.computeRoofBaseHeight(); } catch(_e){}
    var comp = window.createRoofComponent({ x:x, z:z, width:w, depth:d, level:lvl, meta:{ baseHeight: baseY } });
    postAddSelectAndRender(comp, 'Added Roof');
    return comp;
  };

  // Balcony
  if (typeof window.createBalconyComponent === 'undefined') window.createBalconyComponent = function(opts){
    opts = opts || {}; var arr = ensureArray('balconyComponents');
    var comp = { id: nextId('balcony'), type:'balcony', x:+opts.x||0, z:+opts.z||0, width:+opts.width||3.0, depth:+opts.depth||2.0, level:+opts.level||1, rotation:+opts.rotation||0, meta: opts.meta||null };
    pushAndTrace(arr,comp,'component-add-balcony');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addBalcony === 'undefined') window.addBalcony = function(){
    var lvl=1, w=2.5, d=1.5, x=0, z=0;
    try { if (typeof window.findFreeSpotForFootprint==='function'){ var spot=window.findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } } catch(_e){}
    try { if (typeof window.applySnap==='function'){ var s=window.applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'balcony'}); x=s.x; z=s.z; } } catch(_e){}
    var comp = window.createBalconyComponent({ x:x, z:z, width:w, depth:d, level:lvl });
    postAddSelectAndRender(comp, 'Added Balcony');
    return comp;
  };
})();
