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
  function pushAndTrace(arr,obj,kind){
    arr.push(obj);
    try {
      if (!Array.isArray(window.allComponents)) window.allComponents = [];
      window.allComponents.push(obj);
    } catch(_eAll){}
    if(typeof window.__rtTracePush==='function'){
      window.__rtTracePush({ kind:kind||'component-add', type:obj.type, id:obj.id, name: obj.name||null });
    }
  }
  function defaultNameForType(t){
    var m = {
      stairs:'Stairs', pergola:'Pergola', garage:'Garage', pool:'Pool', roof:'Roof', balcony:'Balcony', furniture:'Furniture'
    }; return m[String(t||'').toLowerCase()] || (String(t||'Object').charAt(0).toUpperCase() + String(t||'object').slice(1));
  }
  function postAddSelectAndRender(obj, addedMsg){
    try { if (typeof window.selectObject==='function') window.selectObject(obj.id, { noRender: true }); else window.selectedRoomId = obj.id; } catch(_eSel){}
    try { if (typeof window.updateMeasurements==='function') window.updateMeasurements(); } catch(_eMs){}
    try { if (typeof window.ensureMeasurementsVisible==='function') window.ensureMeasurementsVisible(); } catch(_eMv){}
    try { if (typeof window.updateStatus==='function' && addedMsg) window.updateStatus(addedMsg); } catch(_eSt){}
    try { if (typeof window.focusCameraOnObject==='function') window.focusCameraOnObject(obj); } catch(_eFc){}
    try { if (typeof window.renderLoop==='function') window.renderLoop(); } catch(_eRl){}
  }
  // --- Generic non-overlap placement helper (macro components) ---
  function __collectMacroFootprints(level){
    var out=[];
    try { (window.allRooms||[]).forEach(function(r){ if(r && (r.level||0)===level) out.push({x:r.x,z:r.z,w:r.width,d:r.depth}); }); } catch(_r){}
    var names=['stairsComponents','pergolaComponents','garageComponents','poolComponents','roofComponents','balconyComponents'];
    for (var ni=0; ni<names.length; ni++){
      var arr = window[names[ni]] || [];
      for (var i=0;i<arr.length;i++){ var o=arr[i]; if(o && (o.level||0)===level) out.push({x:o.x,z:o.z,w:o.width,d:o.depth}); }
    }
    return out;
  }
  function __aabbOverlapInclusive(ax0,ax1,az0,az1,bx0,bx1,bz0,bz1){
    return (ax0 <= bx1 && ax1 >= bx0 && az0 <= bz1 && az1 >= bz0);
  }
  function __findFreeNonOverlapping(x,z,w,d,level){
    try {
      w = Math.max(0.1,w||0); d=Math.max(0.1,d||0);
      var halfW=w/2, halfD=d/2; var footprints=__collectMacroFootprints(level);
      function collides(cx,cz){
        var ax0=cx-halfW, ax1=cx+halfW, az0=cz-halfD, az1=cz+halfD; // inclusive edges considered touching
        for (var i=0;i<footprints.length;i++){
          var f=footprints[i]; var bx0=f.x-(f.w||0)/2, bx1=f.x+(f.w||0)/2, bz0=f.z-(f.d||0)/2, bz1=f.z+(f.d||0)/2;
          if (__aabbOverlapInclusive(ax0,ax1,az0,az1,bx0,bx1,bz0,bz1)) return true;
        }
        return false;
      }
      if(!collides(x,z)) return {x:x,z:z};
      var grid = (typeof window.GRID_SPACING==='number' && window.GRID_SPACING>0) ? window.GRID_SPACING : 1;
      var maxRing=40; // search radius
      for (var ring=1; ring<=maxRing; ring++){
        for (var dx=-ring; dx<=ring; dx++){
          for (var dz=-ring; dz<=ring; dz++){
            if (Math.max(Math.abs(dx),Math.abs(dz))!==ring) continue;
            var cx = x + dx*grid, cz = z + dz*grid;
            if(!collides(cx,cz)) return {x:cx,z:cz};
          }
        }
      }
      return {x:x,z:z};
    } catch(e){ return {x:x,z:z}; }
  }

  // --- Default field sets (mirrors earlier engine3d implementations) ---
  function hydrateStairs(s){
    if (s.type!=='stairs') return; if (!s.name) s.name = defaultNameForType('stairs'); if (s.height==null||!isFinite(s.height)) s.height = 3.0; if (s.steps==null||!isFinite(s.steps)) s.steps = 19; if (s.width==null) s.width=1.2; if (s.depth==null) s.depth=4.0; if (s.rotation==null) s.rotation=0; }
  function hydratePergola(p){
    if (p.type!=='pergola') return; if (!p.name) p.name = defaultNameForType('pergola'); if(p.height==null) p.height=2.2; if(p.totalHeight==null) p.totalHeight=p.height; if(p.legWidth==null) p.legWidth=0.25; if(p.slatCount==null) p.slatCount=8; if(p.slatWidth==null) p.slatWidth=0.12; if(p.width==null) p.width=3.0; if(p.depth==null) p.depth=3.0; if(p.rotation==null) p.rotation=0; }
  function hydrateGarage(g){ if(g.type!=='garage') return; if(g.height==null) g.height=2.6; if(g.width==null) g.width=3.2; if(g.depth==null) g.depth=5.5; if(g.rotation==null) g.rotation=0; }
  function hydratePool(p){ if(p.type!=='pool') return; if (!p.name) p.name = defaultNameForType('pool'); if(p.height==null||!isFinite(p.height)) p.height=2.0; if(p.width==null) p.width=4.0; if(p.depth==null) p.depth=2.0; if(p.edgeWidth==null) p.edgeWidth=0.3; if(p.rotation==null) p.rotation=0; }
  function hydrateRoof(r){ if(r.type!=='roof') return; if (!r.name) r.name = defaultNameForType('roof'); if(r.width==null) r.width=6.0; if(r.depth==null) r.depth=6.0; if(r.height==null) r.height=1.2; if(r.roofType==null) r.roofType='flat'; if(r.baseHeight==null){ if(r.meta && typeof r.meta.baseHeight==='number') r.baseHeight=r.meta.baseHeight; else r.baseHeight=(typeof window.computeRoofBaseHeight==='function'? window.computeRoofBaseHeight():3.0); } if(r.rotation==null) r.rotation=0; }
  function hydrateBalcony(b){ if(b.type!=='balcony') return; if (!b.name) b.name = defaultNameForType('balcony'); if(b.height==null) b.height=3.0; if(b.totalHeight==null) b.totalHeight=b.height; if(b.wallThickness==null) b.wallThickness=0.12; if(b.wallHeight==null) b.wallHeight=1.0; if(b.legWidth==null) b.legWidth=0.18; if(b.floorThickness==null) b.floorThickness=0.1; if(b.slatCount==null) b.slatCount=8; if(b.slatWidth==null) b.slatWidth=0.12; if(b.roofHeight==null) b.roofHeight=0.25; if(b.width==null) b.width=2.5; if(b.depth==null) b.depth=1.5; if(b.rotation==null) b.rotation=0; }

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
  var comp = { id: nextId('stairs'), type:'stairs', name: (opts.name||defaultNameForType('stairs')), x:+opts.x||0, z:+opts.z||0, width:+opts.width||1.2, depth:+opts.depth||4.0, height:+opts.height||3.0, steps:+opts.steps||19, level:+opts.level||0, rotation:+opts.rotation||0 };
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
  var comp={ id:nextId('pergola'), type:'pergola', name:(opts.name||defaultNameForType('pergola')), x:+opts.x||0, z:+opts.z||0, width:+opts.width||3.0, depth:+opts.depth||3.0, height:+opts.height||2.2, totalHeight:+opts.totalHeight||opts.height||2.2, legWidth:+opts.legWidth||0.25, slatCount:(opts.slatCount!=null? +opts.slatCount:8), slatWidth:+opts.slatWidth||0.12, level:+opts.level||0, rotation:+opts.rotation||0 };
    hydratePergola(comp); pushAndTrace(arr,comp,'component-add-pergola');
    if(typeof window.saveProjectSilently==='function') window.saveProjectSilently();
    if(typeof window.renderLoop==='function') window.renderLoop();
    return comp;
  };
  if (typeof window.addPergola === 'undefined') window.addPergola = function(){
    var lvl=0,w=3.0,d=3.0,x=0,z=0; try{ if(typeof findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'pergola'}); x=s.x; z=s.z; } }catch(_e2){}
    // Enforce non-overlap (including edge contact) after snap
    var adj=__findFreeNonOverlapping(x,z,w,d,lvl); x=adj.x; z=adj.z;
    var comp=createPergolaComponent({x:x,z:z,width:w,depth:d,level:lvl}); postAddSelectAndRender(comp,'Added Pergola'); return comp; };

  // Garage
  if (typeof window.createGarageComponent === 'undefined') window.createGarageComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('garageComponents');
  var comp={ id:nextId('garage'), type:'garage', name:(opts.name||defaultNameForType('garage')), x:+opts.x||0, z:+opts.z||0, width:+opts.width||3.2, depth:+opts.depth||5.5, height:+opts.height||2.6, level:+opts.level||0, rotation:+opts.rotation||0 };
    hydrateGarage(comp); pushAndTrace(arr,comp,'component-add-garage'); if(typeof window.saveProjectSilently==='function') window.saveProjectSilently(); if(typeof window.renderLoop==='function') window.renderLoop(); return comp; };
  if (typeof window.addGarage === 'undefined') window.addGarage = function(){
    var lvl=0,w=3.2,d=5.5,x=0,z=0; try{ if(typeof findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'garage'}); x=s.x; z=s.z; } }catch(_e2){}
    var adj=__findFreeNonOverlapping(x,z,w,d,lvl); x=adj.x; z=adj.z;
    var comp=createGarageComponent({x:x,z:z,width:w,depth:d,level:lvl}); postAddSelectAndRender(comp,'Added Garage'); return comp; };

  // Pool
  if (typeof window.createPoolComponent === 'undefined') window.createPoolComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('poolComponents');
  var comp={ id:nextId('pool'), type:'pool', name:(opts.name||defaultNameForType('pool')), x:+opts.x||0, z:+opts.z||0, width:+opts.width||4.0, depth:+opts.depth||2.0, height:+opts.height||2.0, edgeWidth:(opts.edgeWidth!=null? +opts.edgeWidth:0.3), level:+opts.level||0, rotation:+opts.rotation||0 };
    hydratePool(comp); pushAndTrace(arr,comp,'component-add-pool'); if(typeof window.saveProjectSilently==='function') window.saveProjectSilently(); if(typeof window.renderLoop==='function') window.renderLoop(); return comp; };
  if (typeof window.addPool === 'undefined') window.addPool = function(){
    var lvl=0,w=4.0,d=2.0,x=0,z=0; try{ if(typeof findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'pool'}); x=s.x; z=s.z; } }catch(_e2){}
    var adj=__findFreeNonOverlapping(x,z,w,d,lvl); x=adj.x; z=adj.z;
    var comp=createPoolComponent({x:x,z:z,width:w,depth:d,level:lvl}); postAddSelectAndRender(comp,'Added Pool'); return comp; };

  // Roof
  if (typeof window.createRoofComponent === 'undefined') window.createRoofComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('roofComponents');
    var baseH=(opts.baseHeight!=null? +opts.baseHeight : (typeof window.computeRoofBaseHeight==='function'? window.computeRoofBaseHeight():3.0));
  var comp={ id:nextId('roof'), type:'roof', name:(opts.name||defaultNameForType('roof')), x:+opts.x||0, z:+opts.z||0, width:+opts.width||6.0, depth:+opts.depth||6.0, height:+opts.height||1.2, roofType: opts.roofType||'flat', baseHeight: baseH, level:+opts.level||0, rotation:+opts.rotation||0 };
    hydrateRoof(comp); pushAndTrace(arr,comp,'component-add-roof'); if(typeof window.saveProjectSilently==='function') window.saveProjectSilently(); if(typeof window.renderLoop==='function') window.renderLoop(); return comp; };
  if (typeof window.addRoof === 'undefined') window.addRoof = function(){
    var lvl=0,w=6.0,d=6.0,x=0,z=0; try{ if(typeof computeRoofFootprint==='function'){ var fp=computeRoofFootprint(); if(fp){ x=fp.x; z=fp.z; w=Math.max(0.5,fp.width); d=Math.max(0.5,fp.depth); } } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'roof'}); x=s.x; z=s.z; } }catch(_e2){}
    var adj=__findFreeNonOverlapping(x,z,w,d,lvl); x=adj.x; z=adj.z;
    var baseH=(typeof computeRoofBaseHeight==='function'? computeRoofBaseHeight():3.0);
    var comp=createRoofComponent({x:x,z:z,width:w,depth:d,level:lvl,baseHeight:baseH}); postAddSelectAndRender(comp,'Added Roof'); return comp; };

  // Balcony
  if (typeof window.createBalconyComponent === 'undefined') window.createBalconyComponent = function(opts){
    opts=opts||{}; var arr=ensureArray('balconyComponents');
  var comp={ id:nextId('balcony'), type:'balcony', name:(opts.name||defaultNameForType('balcony')), x:+opts.x||0, z:+opts.z||0, width:+opts.width||2.5, depth:+opts.depth||1.5, height:+opts.height||3.0, totalHeight:+opts.totalHeight||opts.height||3.0, wallThickness:+opts.wallThickness||0.12, wallHeight:+opts.wallHeight||1.0, legWidth:+opts.legWidth||0.18, floorThickness:+opts.floorThickness||0.1, slatCount:(opts.slatCount!=null? +opts.slatCount:8), slatWidth:+opts.slatWidth||0.12, roofHeight:+opts.roofHeight||0.25, level:+opts.level||1, rotation:+opts.rotation||0 };
    hydrateBalcony(comp); pushAndTrace(arr,comp,'component-add-balcony'); if(typeof window.saveProjectSilently==='function') window.saveProjectSilently(); if(typeof window.renderLoop==='function') window.renderLoop(); return comp; };
  if (typeof window.addBalcony === 'undefined') window.addBalcony = function(){
    var lvl=1,w=2.5,d=1.5,x=0,z=0; try{ if(typeof findFreeSpotForFootprint==='function'){ var spot=findFreeSpotForFootprint(w,d,lvl); x=spot.x; z=spot.z; } }catch(_e){}
    try{ if(typeof applySnap==='function'){ var s=applySnap({x:x,z:z,width:w,depth:d,level:lvl,type:'balcony'}); x=s.x; z=s.z; } }catch(_e2){}
    var adj=__findFreeNonOverlapping(x,z,w,d,lvl); x=adj.x; z=adj.z;
    var comp=createBalconyComponent({x:x,z:z,width:w,depth:d,level:lvl}); postAddSelectAndRender(comp,'Added Balcony'); return comp; };

  // Hydrate any previously created components (from earlier stripped definitions) so they become visible again.
  hydrateAllExisting();
})();
