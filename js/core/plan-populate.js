"use strict";
// Populate the 2D Floor Plan from the current 3D model for the currently selected floor
// Extracted from app.js for modularity; loaded by bootstrap before app core.
function populatePlan2DFromDesign(){
  // Round-trip diagnostics ring buffer helper
  function __rtPush(evt){ 
    try { 
      // Ensure persistence layer matches apply path
      if (!window.__roundTripTraceLoaded) {
        try {
          var raw = localStorage.getItem('gablok_rtTrace_v1');
          if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) window.__roundTripTrace = arr.slice(-300); }
        } catch(_lp) {}
        window.__roundTripTraceLoaded = true;
      }
      var buf = window.__roundTripTrace || (window.__roundTripTrace=[]);
      var MAX=300; buf.push(Object.assign({ t: Date.now(), source: 'populate' }, evt||{})); if(buf.length>MAX) buf.splice(0, buf.length-MAX);
      // Throttled save
      var now = Date.now(); if(!window.__rtTraceLastSave || now - window.__rtTraceLastSave > 1500){ try { localStorage.setItem('gablok_rtTrace_v1', JSON.stringify(buf)); window.__rtTraceLastSave = now; } catch(_ps){} }
    } catch(_e){}
  }
  // Preserve user-drawn manual walls: if any exist, skip destructive populate to prevent disappearance.
  try {
    if (window.__plan2d) {
      var hasManual=false;
      var manualCount=0;
      if (Array.isArray(__plan2d.elements)) {
        for (var mi=0; mi<__plan2d.elements.length; mi++){
          var e=__plan2d.elements[mi];
          if(e && e.type==='wall' && e.manual){ manualCount++; hasManual=true; }
        }
      }
      __rtPush({ kind:'populate-start', floor: (typeof window.currentFloor==='number')?window.currentFloor:0, manualWalls: manualCount, willSkip: !!hasManual });
      if(hasManual){
        if(console && console.debug) console.debug('[PLAN2D POPULATE] Skipped (manual walls present)');
        __rtPush({ kind:'populate-skip-manual', reason:'manual-walls-present' });
        // Do NOT reset userEdited so openPlan2DModal continues to respect draft
        return false; // signal no populate performed
      }
      __plan2d.__userEdited = false; // reset only when overwriting from 3D
    }
  } catch(_ueInit){}
  // Defensive guards: create local safe views of 3D globals so we don't crash if not yet initialised
  var lvlSafe = (typeof window.currentFloor === 'number') ? window.currentFloor : 0;
  var allRooms = Array.isArray(window.allRooms) ? window.allRooms : [];
  var wallStrips = Array.isArray(window.wallStrips) ? window.wallStrips : [];
  var garageComponents = Array.isArray(window.garageComponents) ? window.garageComponents : [];
  var pergolaComponents = Array.isArray(window.pergolaComponents) ? window.pergolaComponents : [];
  var balconyComponents = Array.isArray(window.balconyComponents) ? window.balconyComponents : [];
  var poolComponents = Array.isArray(window.poolComponents) ? window.poolComponents : [];
  var roofComponents = Array.isArray(window.roofComponents) ? window.roofComponents : [];
  var stairsComponents = Array.isArray(window.stairsComponents) ? window.stairsComponents : [];
  var stairsComponent = (typeof window.stairsComponent === 'object' && window.stairsComponent) ? window.stairsComponent : null;
  var currentFloor = lvlSafe;
  // Debug snapshot at start
  try {
    window.__plan2dDiag = window.__plan2dDiag || {};
    window.__plan2dDiag.lastPopulateStart = {
      at: Date.now(),
      floor: currentFloor,
      roomsTotal: allRooms.length,
      stripsTotal: wallStrips.length,
      roomsByLevel: (function(){ var m={}; for(var i=0;i<allRooms.length;i++){ var r=allRooms[i]; var lv=(r&&r.level)||0; m[lv]=(m[lv]||0)+1; } return m; })(),
      stripsByLevel: (function(){ var m={}; for(var j=0;j<wallStrips.length;j++){ var w=wallStrips[j]; var lv=(w&&w.level)||0; m[lv]=(m[lv]||0)+1; } return m; })()
    };
    if (console && console.debug) console.debug('[PLAN2D POPULATE] start floor='+currentFloor, window.__plan2dDiag.lastPopulateStart);
  } catch(_dbg0) {}
  // Diagnostics: capture snapshot of source counts for debugging missing-wall issues
  try {
    if (!window.__plan2dDiag) window.__plan2dDiag = {};
    window.__plan2dDiag.lastPopulate = {
      at: Date.now(),
      floor: currentFloor,
      allRooms: allRooms.length,
      wallStrips: wallStrips.length,
      wallStripsByLevel: (function(){ var m={}; for(var i=0;i<wallStrips.length;i++){ var ws=wallStrips[i]; if(!ws) continue; var lv=ws.level||0; m[lv]=(m[lv]||0)+1; } return m; })(),
      existingElements: (Array.isArray(__plan2d.elements)? __plan2d.elements.length : 0),
      retriesFlag: true
    };
    if (typeof console !== 'undefined' && console.debug){ console.debug('[PLAN2D POPULATE DIAG] floor='+currentFloor+' rooms='+allRooms.length+' wallStrips='+wallStrips.length, window.__plan2dDiag.lastPopulate.wallStripsByLevel); }
  } catch(_eDiag0) {}
  // Prefer reconstructing from user wall strips (non-room-tagged) when present on this floor.
  // This preserves multi-segment layouts and avoids collapsing into coarse room rectangles.
  try {
    var lvlPref = (typeof currentFloor==='number' ? currentFloor : 0);
    var tagKeyPref = (typeof window !== 'undefined' && window.__roomStripTag) ? window.__roomStripTag : '__fromRooms';
    var userStrips = [];
    for (var wsP=0; wsP<wallStrips.length; wsP++){
      var sP = wallStrips[wsP]; if(!sP) continue;
      if ((sP.level||0)!==lvlPref) continue;
      // Only pick strips NOT generated from rooms
      if (sP[tagKeyPref]) continue;
      userStrips.push(sP);
    }
    if (userStrips.length > 0) {
      // Compute extents for centering and scale fit
      var sMinX1=Infinity, sMaxX1=-Infinity, sMinZ1=Infinity, sMaxZ1=-Infinity;
      for (var ii=0; ii<userStrips.length; ii++){
        var us = userStrips[ii];
        sMinX1 = Math.min(sMinX1, us.x0, us.x1);
        sMaxX1 = Math.max(sMaxX1, us.x0, us.x1);
        sMinZ1 = Math.min(sMinZ1, us.z0, us.z1);
        sMaxZ1 = Math.max(sMaxZ1, us.z0, us.z1);
      }
      var cx1 = (isFinite(sMinX1) && isFinite(sMaxX1)) ? (sMinX1 + sMaxX1) / 2 : 0;
      var cz1 = (isFinite(sMinZ1) && isFinite(sMaxZ1)) ? (sMinZ1 + sMaxZ1) / 2 : 0;
      __plan2d.centerX = cx1; __plan2d.centerZ = cz1;
      var c1 = document.getElementById('plan2d-canvas');
      if (c1) {
        var spanX1 = Math.max(0.5, (sMaxX1 - sMinX1));
        var spanZ1 = Math.max(0.5, (sMaxZ1 - sMinZ1));
        var pad1 = 0.15;
        var fitWm1 = spanX1 * (1 + pad1), fitHm1 = spanZ1 * (1 + pad1);
        var scaleX1 = (c1.width>0) ? (c1.width/(fitWm1||1)) : (__plan2d.scale||50);
        var scaleY1 = (c1.height>0) ? (c1.height/(fitHm1||1)) : (__plan2d.scale||50);
        var newScale1 = Math.max(10, Math.min(140, Math.floor(Math.min(scaleX1, scaleY1))));
        if (isFinite(newScale1) && newScale1>0) __plan2d.scale = newScale1;
      }
      // Populate 2D from user strips: add walls, then attach openings from strips by projection
      __plan2d.elements = [];
      var sgn1 = (__plan2d.yFromWorldZSign||1);
      var wallIdxMap = new Map(); // map from strip object to created wall index
      for (var jj=0; jj<userStrips.length; jj++){
        var ws1 = userStrips[jj];
        var idxW = __plan2d.elements.length;
        var wEl = {
          type: 'wall',
          x0: ws1.x0 - cx1,
          y0: sgn1 * (ws1.z0 - cz1),
          x1: ws1.x1 - cx1,
          y1: sgn1 * (ws1.z1 - cz1),
          thickness: (ws1.thickness || __plan2d.wallThicknessM || 0.3)
        };
        __plan2d.elements.push(wEl);
        wallIdxMap.set(ws1, idxW);
      }
      // Attach openings carried by strips back to their host walls
      try {
        if (typeof plan2dProjectParamOnWall === 'function') {
          for (var kk=0; kk<userStrips.length; kk++){
            var ws2 = userStrips[kk];
            var hostIdx = wallIdxMap.get(ws2);
            if (typeof hostIdx !== 'number') continue;
            var openingsArr = Array.isArray(ws2.openings) ? ws2.openings : [];
            for (var oi=0; oi<openingsArr.length; oi++){
              var op = openingsArr[oi]; if(!op) continue;
              // Convert world endpoints to plan space relative to new center/sign
              var p0 = { x: (op.x0 - cx1), y: sgn1 * (op.z0 - cz1) };
              var p1 = { x: (op.x1 - cx1), y: sgn1 * (op.z1 - cz1) };
              var hostWall = __plan2d.elements[hostIdx];
              if (!hostWall) continue;
              var t0 = plan2dProjectParamOnWall(p0, hostWall);
              var t1 = plan2dProjectParamOnWall(p1, hostWall);
              if (op.type === 'window'){
                var win = { type:'window', host: hostIdx, t0: t0, t1: t1, thickness: (hostWall.thickness||__plan2d.wallThicknessM) };
                if (typeof op.sillM==='number') win.sillM = op.sillM;
                if (typeof op.heightM==='number') win.heightM = op.heightM;
                if (op.meta) win.meta = op.meta;
                __plan2d.elements.push(win);
              } else if (op.type === 'door'){
                __plan2d.elements.push({ type:'door', host: hostIdx, t0: t0, t1: t1, widthM: Math.hypot(p1.x-p0.x, p1.y-p0.y), heightM: (typeof op.heightM==='number'? op.heightM : (__plan2d.doorHeightM||2.04)), thickness: (hostWall.thickness||__plan2d.wallThicknessM), meta: (op.meta||{ hinge:'t0', swing:'in' }) });
              }
            }
          }
        }
      } catch(_eOpeningsFromStrips) { /* non-fatal */ }
  try { if(window.__plan2d) __plan2d.__userEdited=false; }catch(_ueUserStrips){}
  return true;
    }
  } catch(_prefE) { /* ignore and fallback to room-driven path */ }

  // Collect rectangles for rooms on the current floor; include garages on ground and balconies on first
  var rects = [];
  var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
  for (var i=0;i<allRooms.length;i++) {
    var r = allRooms[i];
    var rLevel = (r.level||0);
    if (rLevel !== lvl) continue; // Only include rooms on the active floor
    var hw = r.width/2, hd = r.depth/2;
    rects.push({
      name: r.name || 'Room',
      minX: r.x - hw, maxX: r.x + hw,
      minZ: r.z - hd, maxZ: r.z + hd,
      type: 'room',
      roomId: r.id,
      polyLike: Array.isArray(r.footprint) && r.footprint.length >= 3,
      openings: (Array.isArray(r.openings) ? r.openings.slice() : []),
      level: rLevel,
      current: true
    });
  }
  if(lvl===0){
    for (var g=0; g<garageComponents.length; g++) {
      var gar = garageComponents[g];
      var hwg = gar.width/2, hdg = gar.depth/2;
      rects.push({
        name: gar.name || 'Garage',
        minX: gar.x - hwg, maxX: gar.x + hwg,
        minZ: gar.z - hdg, maxZ: gar.z + hdg,
        type: 'garage',
        cx: gar.x, cz: gar.z, w: gar.width, d: gar.depth, rotation: (gar.rotation||0)
      });
    }
    // Include pergolas as wall rectangles on ground floor
    for (var pg=0; pg<pergolaComponents.length; pg++) {
      var per = pergolaComponents[pg];
      var hwp = per.width/2, hdp = per.depth/2;
      rects.push({
        name: per.name || 'Pergola',
        minX: per.x - hwp, maxX: per.x + hwp,
        minZ: per.z - hdp, maxZ: per.z + hdp,
        type: 'pergola',
        cx: per.x, cz: per.z, w: per.width, d: per.depth, rotation: (per.rotation||0)
      });
    }
  }
  if(lvl===1){
    for (var b=0; b<balconyComponents.length; b++) {
      var bal = balconyComponents[b]; if((bal.level||1)!==1) continue;
      var hwb = bal.width/2, hdb = bal.depth/2;
      rects.push({
        name: bal.name || 'Balcony',
        minX: bal.x - hwb, maxX: bal.x + hwb,
        minZ: bal.z - hdb, maxZ: bal.z + hdb,
        type: 'balcony',
        cx: bal.x, cz: bal.z, w: bal.width, d: bal.depth, rotation: (bal.rotation||0)
      });
    }
  }
  // Include stairs footprints in bounds only on their level (avoid shifting first floor centering)
  (function(){ try {
    var scArrL = window.stairsComponents || [];
    if (Array.isArray(scArrL) && scArrL.length){
      for (var sLi=0; sLi<scArrL.length; sLi++){
        var s = scArrL[sLi]; if(!s || (s.level||0)!==lvl) continue;
        var hwS = (s.width||0)/2, hdS = (s.depth||0)/2;
        var rot = ((s.rotation||0) * Math.PI) / 180;
        function r(px, pz){ var dx=px-s.x, dz=pz-s.z; return { x: s.x + dx*Math.cos(rot) - dz*Math.sin(rot), z: s.z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
        var p1=r(s.x-hwS, s.z-hdS), p2=r(s.x+hwS, s.z-hdS), p3=r(s.x+hwS, s.z+hdS), p4=r(s.x-hwS, s.z+hdS);
        rects.push({ name:'Stairs', minX: Math.min(p1.x,p2.x,p3.x,p4.x), maxX: Math.max(p1.x,p2.x,p3.x,p4.x), minZ: Math.min(p1.z,p2.z,p3.z,p4.z), maxZ: Math.max(p1.z,p2.z,p3.z,p4.z), type:'stairs', cx:s.x, cz:s.z, w:(s.width||0), d:(s.depth||0), rotation:(s.rotation||0) });
      }
    } else if (stairsComponent && (stairsComponent.level||0) === lvl) {
      var s = stairsComponent; var hwS = (s.width||0)/2, hdS = (s.depth||0)/2;
      var rot = ((s.rotation||0) * Math.PI) / 180;
      function r(px, pz){ var dx=px-s.x, dz=pz-s.z; return { x: s.x + dx*Math.cos(rot) - dz*Math.sin(rot), z: s.z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
      var p1=r(s.x-hwS, s.z-hdS), p2=r(s.x+hwS, s.z-hdS), p3=r(s.x+hwS, s.z+hdS), p4=r(s.x-hwS, s.z+hdS);
      rects.push({ name:'Stairs', minX: Math.min(p1.x,p2.x,p3.x,p4.x), maxX: Math.max(p1.x,p2.x,p3.x,p4.x), minZ: Math.min(p1.z,p2.z,p3.z,p4.z), maxZ: Math.max(p1.z,p2.z,p3.z,p4.z), type:'stairs', cx:s.x, cz:s.z, w:(s.width||0), d:(s.depth||0), rotation:(s.rotation||0) });
    }
  } catch(_sl){}})();
  if (rects.length === 0) {
    // If no room/component rectangles, still try to populate from existing 3D wall strips on this floor
    try {
      var lvlNow0 = (typeof currentFloor==='number' ? currentFloor : 0);
      var hasStrips0 = false;
      var sMinX=Infinity, sMaxX=-Infinity, sMinZ=Infinity, sMaxZ=-Infinity;
      for (var wsi0=0; wsi0<wallStrips.length; wsi0++){
        var ws0 = wallStrips[wsi0]; if(!ws0 || (ws0.level||0)!==lvlNow0) continue;
        hasStrips0 = true;
        sMinX = Math.min(sMinX, ws0.x0, ws0.x1);
        sMaxX = Math.max(sMaxX, ws0.x0, ws0.x1);
        sMinZ = Math.min(sMinZ, ws0.z0, ws0.z1);
        sMaxZ = Math.max(sMaxZ, ws0.z0, ws0.z1);
      }
      if (!hasStrips0) return false;
      // Compute center and scale from strips extents
      var cx0 = (isFinite(sMinX) && isFinite(sMaxX)) ? (sMinX + sMaxX) / 2 : 0;
      var cz0 = (isFinite(sMinZ) && isFinite(sMaxZ)) ? (sMinZ + sMaxZ) / 2 : 0;
      __plan2d.centerX = cx0; __plan2d.centerZ = cz0;
      var c0 = document.getElementById('plan2d-canvas');
      if (c0) {
        var spanX0 = Math.max(0.5, (sMaxX - sMinX));
        var spanZ0 = Math.max(0.5, (sMaxZ - sMinZ));
        var pad0 = 0.15;
        var fitWm0 = spanX0 * (1 + pad0), fitHm0 = spanZ0 * (1 + pad0);
        var scaleX0 = (c0.width>0) ? (c0.width/(fitWm0||1)) : (__plan2d.scale||50);
        var scaleY0 = (c0.height>0) ? (c0.height/(fitHm0||1)) : (__plan2d.scale||50);
        var newScale0 = Math.max(10, Math.min(140, Math.floor(Math.min(scaleX0, scaleY0))));
        if (isFinite(newScale0) && newScale0>0) __plan2d.scale = newScale0;
      }
      // Populate 2D elements as free-standing walls from strips
      __plan2d.elements = [];
      var sgn0 = (__plan2d.yFromWorldZSign||1);
      for (var wsi1=0; wsi1<wallStrips.length; wsi1++){
        var ws1 = wallStrips[wsi1]; if(!ws1 || (ws1.level||0)!==lvlNow0) continue;
        __plan2d.elements.push({
          type: 'wall',
          x0: ws1.x0 - cx0,
          y0: sgn0 * (ws1.z0 - cz0),
          x1: ws1.x1 - cx0,
          y1: sgn0 * (ws1.z1 - cz0),
          thickness: (ws1.thickness || __plan2d.wallThicknessM || 0.3)
        });
      }
  try { if(window.__plan2d) __plan2d.__userEdited=false; }catch(_ueStrips){}
  return true;
    } catch(e) { return false; }
  }

  // Compute overall bounds and center (use rotation-aware bounds where available)
  var minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
  // Track rooms-only bounds for scale so non-room elements don't change zoom level
  var rMinX=Infinity, rMaxX=-Infinity, rMinZ=Infinity, rMaxZ=-Infinity; var roomCount=0;
  // Also track rooms across all levels to use as a fallback scale when this floor has no rooms
  var rAllMinX=Infinity, rAllMaxX=-Infinity, rAllMinZ=Infinity, rAllMaxZ=-Infinity; var roomCountAll=0;
  for (var k=0;k<rects.length;k++){
    var b=rects[k];
    // Prefer rotation-aware bounds if this rect has center/size/rotation
    if (typeof b.cx==='number' && typeof b.cz==='number' && typeof b.w==='number' && typeof b.d==='number' && typeof b.rotation==='number'){
      var hwB=b.w/2, hdB=b.d/2, rotB=(b.rotation*Math.PI)/180;
      function rotPt(px,pz){ var dx=px-b.cx, dz=pz-b.cz; return { x: b.cx + dx*Math.cos(rotB) - dz*Math.sin(rotB), z: b.cz + dx*Math.sin(rotB) + dz*Math.cos(rotB) }; }
      var q1=rotPt(b.cx-hwB,b.cz-hdB), q2=rotPt(b.cx+hwB,b.cz-hdB), q3=rotPt(b.cx+hwB,b.cz+hdB), q4=rotPt(b.cx-hwB,b.cz+hdB);
      var bminX=Math.min(q1.x,q2.x,q3.x,q4.x), bmaxX=Math.max(q1.x,q2.x,q3.x,q4.x), bminZ=Math.min(q1.z,q2.z,q3.z,q4.z), bmaxZ=Math.max(q1.z,q2.z,q3.z,q4.z);
      if (bminX<minX) minX=bminX; if (bmaxX>maxX) maxX=bmaxX;
      if (bminZ<minZ) minZ=bminZ; if (bmaxZ>maxZ) maxZ=bmaxZ;
  if (b.type === 'room' && b.level === lvl) { rMinX=Math.min(rMinX,bminX); rMaxX=Math.max(rMaxX,bmaxX); rMinZ=Math.min(rMinZ,bminZ); rMaxZ=Math.max(rMaxZ,bmaxZ); roomCount++; }
    } else {
      if (b.minX<minX) minX=b.minX; if (b.maxX>maxX) maxX=b.maxX;
      if (b.minZ<minZ) minZ=b.minZ; if (b.maxZ>maxZ) maxZ=b.maxZ;
  if (b.type === 'room' && b.level === lvl) { rMinX=Math.min(rMinX,b.minX); rMaxX=Math.max(rMaxX,b.maxX); rMinZ=Math.min(rMinZ,b.minZ); rMaxZ=Math.max(rMaxZ,b.maxZ); roomCount++; }
    }
  }
  // Rooms across all levels (fallback if current floor has no rooms)
  for (var riAll=0; riAll<allRooms.length; riAll++){
    var rA = allRooms[riAll]; var hwA=rA.width/2, hdA=rA.depth/2;
    rAllMinX=Math.min(rAllMinX, rA.x-hwA); rAllMaxX=Math.max(rAllMaxX, rA.x+hwA);
    rAllMinZ=Math.min(rAllMinZ, rA.z-hdA); rAllMaxZ=Math.max(rAllMaxZ, rA.z+hdA);
    roomCountAll++;
  }
  // Also compute global bounds across both floors to keep a stable origin between floor views
  var gMinX=Infinity, gMaxX=-Infinity, gMinZ=Infinity, gMaxZ=-Infinity;
  // Rooms (all levels)
  for (var ri=0; ri<allRooms.length; ri++){
    var rr=allRooms[ri]; var hw=rr.width/2, hd=rr.depth/2;
    gMinX=Math.min(gMinX, rr.x-hw); gMaxX=Math.max(gMaxX, rr.x+hw);
    gMinZ=Math.min(gMinZ, rr.z-hd); gMaxZ=Math.max(gMaxZ, rr.z+hd);
  }
  // Garages & pergolas (ground) - rotation-aware global bounds
  for (var gi=0; gi<garageComponents.length; gi++){
    var gar=garageComponents[gi]; var hwg=gar.width/2, hdg=gar.depth/2; var rotG=((gar.rotation||0)*Math.PI)/180;
    function rG(px,pz){ var dx=px-gar.x, dz=pz-gar.z; return {x:gar.x+dx*Math.cos(rotG)-dz*Math.sin(rotG), z:gar.z+dx*Math.sin(rotG)+dz*Math.cos(rotG)}; }
    var g1=rG(gar.x-hwg, gar.z-hdg), g2=rG(gar.x+hwg, gar.z-hdg), g3=rG(gar.x+hwg, gar.z+hdg), g4=rG(gar.x-hwg, gar.z+hdg);
    gMinX=Math.min(gMinX, g1.x,g2.x,g3.x,g4.x); gMaxX=Math.max(gMaxX, g1.x,g2.x,g3.x,g4.x);
    gMinZ=Math.min(gMinZ, g1.z,g2.z,g3.z,g4.z); gMaxZ=Math.max(gMaxZ, g1.z,g2.z,g3.z,g4.z);
  }
  for (var pi=0; pi<pergolaComponents.length; pi++){
    var per=pergolaComponents[pi]; var hwp=per.width/2, hdp=per.depth/2; var rotP=((per.rotation||0)*Math.PI)/180;
    function rP(px,pz){ var dx=px-per.x, dz=pz-per.z; return {x:per.x+dx*Math.cos(rotP)-dz*Math.sin(rotP), z:per.z+dx*Math.sin(rotP)+dz*Math.cos(rotP)}; }
    var p1=rP(per.x-hwp, per.z-hdp), p2=rP(per.x+hwp, per.z-hdp), p3=rP(per.x+hwp, per.z+hdp), p4=rP(per.x-hwp, per.z+hdp);
    gMinX=Math.min(gMinX, p1.x,p2.x,p3.x,p4.x); gMaxX=Math.max(gMaxX, p1.x,p2.x,p3.x,p4.x);
    gMinZ=Math.min(gMinZ, p1.z,p2.z,p3.z,p4.z); gMaxZ=Math.max(gMaxZ, p1.z,p2.z,p3.z,p4.z);
  }
  // Balconies (first) - rotation-aware global bounds
  for (var bi=0; bi<balconyComponents.length; bi++){
    var bal=balconyComponents[bi]; var hwb=bal.width/2, hdb=bal.depth/2; var rotB=((bal.rotation||0)*Math.PI)/180;
    function rB(px,pz){ var dx=px-bal.x, dz=pz-bal.z; return {x:bal.x+dx*Math.cos(rotB)-dz*Math.sin(rotB), z:bal.z+dx*Math.sin(rotB)+dz*Math.cos(rotB)}; }
    var b1=rB(bal.x-hwb, bal.z-hdb), b2=rB(bal.x+hwb, bal.z-hdb), b3=rB(bal.x+hwb, bal.z+hdb), b4=rB(bal.x-hwb, bal.z+hdb);
    gMinX=Math.min(gMinX, b1.x,b2.x,b3.x,b4.x); gMaxX=Math.max(gMaxX, b1.x,b2.x,b3.x,b4.x);
    gMinZ=Math.min(gMinZ, b1.z,b2.z,b3.z,b4.z); gMaxZ=Math.max(gMaxZ, b1.z,b2.z,b3.z,b4.z);
  }
  // Stairs (global bounds; multiple supported)
  (function(){ try {
    var scArrG = window.stairsComponents || [];
    if (Array.isArray(scArrG) && scArrG.length){
      for (var sg=0; sg<scArrG.length; sg++){
        var s=scArrG[sg]; if(!s) continue; var hwS=(s.width||0)/2, hdS=(s.depth||0)/2; var rot=((s.rotation||0)*Math.PI)/180; function r(px,pz){ var dx=px-s.x, dz=pz-s.z; return {x:s.x+dx*Math.cos(rot)-dz*Math.sin(rot), z:s.z+dx*Math.sin(rot)+dz*Math.cos(rot)}; } var gp1=r(s.x-hwS, s.z-hdS), gp2=r(s.x+hwS, s.z-hdS), gp3=r(s.x+hwS, s.z+hdS), gp4=r(s.x-hwS, s.z+hdS); gMinX=Math.min(gMinX, gp1.x,gp2.x,gp3.x,gp4.x); gMaxX=Math.max(gMaxX, gp1.x,gp2.x,gp3.x,gp4.x); gMinZ=Math.min(gMinZ, gp1.z,gp2.z,gp3.z,gp4.z); gMaxZ=Math.max(gMaxZ, gp1.z,gp2.z,gp3.z,gp4.z);
      }
    } else if (stairsComponent){ var s=stairsComponent; var hwS=s.width/2, hdS=s.depth/2; var rot=((s.rotation||0)*Math.PI)/180; function r(px,pz){ var dx=px-s.x, dz=pz-s.z; return {x:s.x+dx*Math.cos(rot)-dz*Math.sin(rot), z:s.z+dx*Math.sin(rot)+dz*Math.cos(rot)}; } var gp1=r(s.x-hwS, s.z-hdS), gp2=r(s.x+hwS, s.z-hdS), gp3=r(s.x+hwS, s.z+hdS), gp4=r(s.x-hwS, s.z+hdS); gMinX=Math.min(gMinX, gp1.x,gp2.x,gp3.x,gp4.x); gMaxX=Math.max(gMaxX, gp1.x,gp2.x,gp3.x,gp4.x); gMinZ=Math.min(gMinZ, gp1.z,gp2.z,gp3.z,gp4.z); gMaxZ=Math.max(gMaxZ, gp1.z,gp2.z,gp3.z,gp4.z); }
  } catch(_sg){}})();
  var gcx = (isFinite(gMinX)&&isFinite(gMaxX)) ? (gMinX+gMaxX)/2 : (minX+maxX)/2;
  var gcz = (isFinite(gMinZ)&&isFinite(gMaxZ)) ? (gMinZ+gMaxZ)/2 : (minZ+maxZ)/2;
  // Center & scale should be floor-specific so switching floors shows only that floor's geometry perfectly.
  // Previously we used global center (gcx,gcz) causing misalignment between 3D and 2D when changing floors.
  // Now we derive center from current floor bounds (minX/maxX/minZ/maxZ) restricted to this level only.
  var cx = (isFinite(minX) && isFinite(maxX)) ? (minX + maxX) / 2 : gcx;
  var cz = (isFinite(minZ) && isFinite(maxZ)) ? (minZ + maxZ) / 2 : gcz;
  // Use rooms-only span to compute scale:
  // - If this floor has rooms, use them
  // - Else if any rooms exist globally, use global rooms (keep scale consistent across floors)
  // - Else fall back to overall bounds (nothing else to scale by)
  var useMinX, useMaxX, useMinZ, useMaxZ;
  if (roomCount > 0) {
    useMinX = rMinX; useMaxX = rMaxX; useMinZ = rMinZ; useMaxZ = rMaxZ;
  } else if (roomCountAll > 0 && isFinite(rAllMinX) && isFinite(rAllMaxX)) {
    useMinX = rAllMinX; useMaxX = rAllMaxX; useMinZ = rAllMinZ; useMaxZ = rAllMaxZ;
  } else {
    useMinX = minX; useMaxX = maxX; useMinZ = minZ; useMaxZ = maxZ;
  }
  var spanX = Math.max(0.5, useMaxX - useMinX); var spanZ = Math.max(0.5, useMaxZ - useMinZ);
  // If we're applying opening-only edits, freeze center/scale to avoid subtle canvas jumps
  var __freezeScale = false;
  try {
    if (__plan2d && __plan2d.freezeCenterScaleUntil && Date.now() < __plan2d.freezeCenterScaleUntil) {
      if (isFinite(__plan2d.centerX)) cx = __plan2d.centerX;
      if (isFinite(__plan2d.centerZ)) cz = __plan2d.centerZ;
      __freezeScale = true;
    }
  } catch(e) {}
  // Persist center so overlays and helpers can map world->plan consistently
  __plan2d.centerX = cx; __plan2d.centerZ = cz;
  if (typeof console !== 'undefined' && console.log) {
    console.log('📍 Plan center calculated: cx =', cx.toFixed(2), 'cz =', cz.toFixed(2));
  }

  // Fit scale to canvas with margins (only if canvas exists)
  var c=document.getElementById('plan2d-canvas');
  if (c) {
    var pad = 0.15; // 15% margin
    var fitWm = spanX*(1+pad), fitHm = spanZ*(1+pad);
    var scaleX = (c.width>0) ? (c.width/(fitWm||1)) : __plan2d.scale;
    var scaleY = (c.height>0) ? (c.height/(fitHm||1)) : __plan2d.scale;
    var newScale = Math.max(10, Math.min(140, Math.floor(Math.min(scaleX, scaleY)))); // clamp sensible range
    // Suppress scale changes while user is in an active drawing chain OR immediately after adding an opening to avoid view "jump"
    if (
      __freezeScale ||
      (__plan2d && __plan2d.userDrawingActive) ||
      (__plan2d && __plan2d.freezeCenterScaleUntil && Date.now() < __plan2d.freezeCenterScaleUntil)
    ) { newScale = __plan2d.scale || newScale; }
    if (isFinite(newScale) && newScale>0) {
      // Only update scale if not in userDrawingActive and not within freeze window
      var allowScaleUpdate = !(__plan2d && __plan2d.userDrawingActive) && !(__plan2d && __plan2d.freezeCenterScaleUntil && Date.now() < __plan2d.freezeCenterScaleUntil);
      if(allowScaleUpdate) { __plan2d.scale = newScale; }
    }
  }
  // Note: We continue even if canvas doesn't exist, to ensure __plan2d.elements is updated.
  // While userDrawingActive is true we do not mutate pan offsets or scale to keep the interactive view stable.

  // Preserve existing windows/doors before clearing elements so they survive room resizing
  var preservedOpenings = [];
  var preservedCounts = { windows:0, doors:0 };
  try {
    if (Array.isArray(__plan2d.elements)) {
      for (var i = 0; i < __plan2d.elements.length; i++) {
        var el = __plan2d.elements[i];
        if (!el || (el.type !== 'window' && el.type !== 'door')) continue;
        if (typeof el.host !== 'number' || el.host < 0 || el.host >= __plan2d.elements.length) continue;
        var hostWall = __plan2d.elements[el.host];
        if (!hostWall || hostWall.type !== 'wall') continue;
        // Compute world coordinates of opening endpoints
        var t0 = (typeof el.t0 === 'number') ? el.t0 : 0;
        var t1 = (typeof el.t1 === 'number') ? el.t1 : 1;
        var wx0 = hostWall.x0 + t0 * (hostWall.x1 - hostWall.x0);
        var wy0 = hostWall.y0 + t0 * (hostWall.y1 - hostWall.y0);
        var wx1 = hostWall.x0 + t1 * (hostWall.x1 - hostWall.x0);
        var wy1 = hostWall.y0 + t1 * (hostWall.y1 - hostWall.y0);
        
        // Determine which edge this wall belongs to (top/bottom/left/right)
        var wallEdge = null;
        var wallDx = Math.abs(hostWall.x1 - hostWall.x0);
        var wallDy = Math.abs(hostWall.y1 - hostWall.y0);
        var avgX = (hostWall.x0 + hostWall.x1) / 2;
        var avgY = (hostWall.y0 + hostWall.y1) / 2;
        
        if (wallDx > wallDy) {
          // Horizontal wall (top or bottom)
          // Top walls have smaller (more negative) Y values, bottom walls have larger Y values
          wallEdge = (avgY < 0) ? 'top' : 'bottom';
        } else {
          // Vertical wall (left or right)
          // Left walls have smaller (more negative) X values, right walls have larger X values
          wallEdge = (avgX < 0) ? 'left' : 'right';
        }
        
        // Store opening with its world coords and properties
        preservedOpenings.push({
          type: el.type,
          wx0: wx0, wy0: wy0, wx1: wx1, wy1: wy1,
          sillM: el.sillM, heightM: el.heightM, widthM: el.widthM,
          thickness: el.thickness, meta: el.meta,
          groupId: hostWall.groupId, // Track which room this opening belonged to
          edge: wallEdge // Track which edge (top/bottom/left/right)
        });
        if(el.type==='window') preservedCounts.windows++; else if(el.type==='door') preservedCounts.doors++;
      }
    }
  } catch(e) { /* preserve openings failed - non-critical */ }

  // Build wall segments around each rectangle (rooms + structures) for this floor only, shifted relative to per-floor center.
  __plan2d.elements = [];
  function addRectWalls(minX,maxX,minZ,maxZ, groupId, srcLevel){
    var s = (__plan2d.yFromWorldZSign||1);
    var x0=minX - cx, x1=maxX - cx, y0=s*(minZ - cz), y1=s*(maxZ - cz); // map z->y with sign
  var lvlTag = (typeof srcLevel==='number'? srcLevel : lvl);
  var idxTop = __plan2d.elements.length;     __plan2d.elements.push({type:'wall', x0:x0,y0:y0, x1:x1,y1:y0, thickness:__plan2d.wallThicknessM, groupId: groupId||null, level: lvlTag});
  var idxRight = __plan2d.elements.length;   __plan2d.elements.push({type:'wall', x0:x1,y0:y0, x1:x1,y1:y1, thickness:__plan2d.wallThicknessM, groupId: groupId||null, level: lvlTag});
  var idxBottom = __plan2d.elements.length;  __plan2d.elements.push({type:'wall', x0:x1,y0:y1, x1:x0,y1:y1, thickness:__plan2d.wallThicknessM, groupId: groupId||null, level: lvlTag});
  var idxLeft = __plan2d.elements.length;    __plan2d.elements.push({type:'wall', x0:x0,y0:y1, x1:x0,y1:y0, thickness:__plan2d.wallThicknessM, groupId: groupId||null, level: lvlTag});
    return { top: idxTop, right: idxRight, bottom: idxBottom, left: idxLeft, coords: {x0:x0,x1:x1,y0:y0,y1:y1} };
  }
  function addRotatedRectWalls(cxW, czW, w, d, rotationDeg, groupId, srcLevel){
    var s = (__plan2d.yFromWorldZSign||1);
    var hw=w/2, hd=d/2, rot=((rotationDeg||0)*Math.PI)/180;
    function rotW(px,pz){ var dx=px-cxW, dz=pz-czW; return { x: cxW + dx*Math.cos(rot) - dz*Math.sin(rot), z: czW + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
    var c1=rotW(cxW-hw, czW-hd), c2=rotW(cxW+hw, czW-hd), c3=rotW(cxW+hw, czW+hd), c4=rotW(cxW-hw, czW+hd);
    function toPlan(p){ return { x: (p.x - cx), y: s * (p.z - cz) }; }
    var p1=toPlan(c1), p2=toPlan(c2), p3=toPlan(c3), p4=toPlan(c4);
  var lvlTag2 = (typeof srcLevel==='number'? srcLevel : lvl);
  var i1 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p1.x,y0:p1.y, x1:p2.x,y1:p2.y, thickness:__plan2d.wallThicknessM, groupId: groupId||null, level: lvlTag2});
  var i2 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p2.x,y0:p2.y, x1:p3.x,y1:p3.y, thickness:__plan2d.wallThicknessM, groupId: groupId||null, level: lvlTag2});
  var i3 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p3.x,y0:p3.y, x1:p4.x,y1:p4.y, thickness:__plan2d.wallThicknessM, groupId: groupId||null, level: lvlTag2});
  var i4 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p4.x,y0:p4.y, x1:p1.x,y1:p1.y, thickness:__plan2d.wallThicknessM, groupId: groupId||null, level: lvlTag2});
    return { top: i1, right: i2, bottom: i3, left: i4, coords: {p1:p1,p2:p2,p3:p3,p4:p4} };
  }
  function markWallRole(idxObj, role){
    try{
      var r = role||'room';
      var els = __plan2d.elements;
      if(idxObj && els){
        [idxObj.top, idxObj.right, idxObj.bottom, idxObj.left].forEach(function(ii){ if(typeof ii==='number' && els[ii] && els[ii].type==='wall'){ els[ii].wallRole = r; } });
      }
    }catch(e){}
  }
  for (var rci=0;rci<rects.length;rci++){
    var rb=rects[rci];
    // Build walls for rooms only (garage/pergola/balcony handled too). Include rooms from all floors but tag them.
    if(rb.type!=='room' && rb.type!=='garage' && rb.type!=='pergola' && rb.type!=='balcony') continue;
  var wallIdx;
    var hasRotation = (typeof rb.rotation==='number' && Math.abs(rb.rotation)%360>1e-6);
    if (hasRotation) {
      wallIdx = addRotatedRectWalls(rb.cx, rb.cz, rb.w, rb.d, rb.rotation, (rb.type==='room' && rb.roomId && !rb.polyLike ? ('room:'+rb.roomId) : null), rb.level);
    } else {
      wallIdx = addRectWalls(rb.minX, rb.maxX, rb.minZ, rb.maxZ, (rb.type==='room' && rb.roomId && !rb.polyLike ? ('room:'+rb.roomId) : null), rb.level);
    }
    // Tag walls so applyPlan2DTo3D can ignore non-room walls
    markWallRole(wallIdx, (rb.type==='room' ? 'room' : 'nonroom'));
    // Annotate created walls with their source level and whether they're on current floor for draw-layer dimming
    try { ['top','right','bottom','left'].forEach(function(edge){ var idx=wallIdx[edge]; if(typeof idx==='number' && __plan2d.elements[idx]){ __plan2d.elements[idx].roomLevel = rb.level; __plan2d.elements[idx].roomCurrent = rb.current; } }); }catch(_annot){}
    // Re-create openings (windows/doors) anchored to walls for rooms
  if(rb.type==='room' && Array.isArray(rb.openings) && rb.openings.length){
      var s = (__plan2d.yFromWorldZSign||1);
      var minX = rb.minX - cx, maxX = rb.maxX - cx, minY = s*(rb.minZ - cz), maxY = s*(rb.maxZ - cz); // shifted with sign
      for(var oi=0; oi<rb.openings.length; oi++){
        var op = rb.openings[oi];
        if(!op || (op.type!=='window' && op.type!=='door')) continue;
        console.log('  [plan-populate] Processing opening:', op.type, 'with coords x0:', op.x0, 'z0:', op.z0, 'x1:', op.x1, 'z1:', op.z1, 'manuallyPositioned:', op.__manuallyPositioned);
        var hostIdx = -1; var p0={x:0,y:0}, p1={x:0,y:0};
        
        // Check if opening has world coordinates (x0/z0/x1/z1) instead of edge-based (edge/startM/endM)
        if (typeof op.x0 === 'number' && typeof op.z0 === 'number' && typeof op.x1 === 'number' && typeof op.z1 === 'number') {
          // Convert world coordinates to plan coordinates
          var wx0 = op.x0 - cx;
          var wz0 = s * (op.z0 - cz);
          var wx1 = op.x1 - cx;
          var wz1 = s * (op.z1 - cz);
          p0 = {x: wx0, y: wz0};
          p1 = {x: wx1, y: wz1};
          
          // Find which wall this opening is closest to
          var bestDist = Infinity;
          var walls = [
            {idx: wallIdx.top, type: 'top'},
            {idx: wallIdx.bottom, type: 'bottom'},
            {idx: wallIdx.left, type: 'left'},
            {idx: wallIdx.right, type: 'right'}
          ];
          
          // If opening has edge tag, filter walls to only consider matching edge
          if (op.edge) {
            walls = walls.filter(function(w) { return w.type === op.edge; });
          }
          
          for (var wi = 0; wi < walls.length; wi++) {
            var wInfo = walls[wi];
            var wallEl = __plan2d.elements[wInfo.idx];
            if (!wallEl) continue;
            // Calculate distance from opening midpoint to wall
            var midX = (p0.x + p1.x) / 2;
            var midY = (p0.y + p1.y) / 2;
            var wallLen = Math.hypot(wallEl.x1 - wallEl.x0, wallEl.y1 - wallEl.y0);
            if (wallLen < 0.01) continue;
            var dx = wallEl.x1 - wallEl.x0, dy = wallEl.y1 - wallEl.y0;
            var t = Math.max(0, Math.min(1, ((midX - wallEl.x0) * dx + (midY - wallEl.y0) * dy) / (wallLen * wallLen)));
            var closestX = wallEl.x0 + t * dx;
            var closestY = wallEl.y0 + t * dy;
            var dist = Math.hypot(midX - closestX, midY - closestY);
            if (dist < bestDist) {
              bestDist = dist;
              hostIdx = wInfo.idx;
            }
          }
        } else if (op.edge) {
          // Edge-based opening (original format)
          if(op.edge==='minZ'){ // world top (North)
          hostIdx = (s===1 ? wallIdx.top : wallIdx.bottom);
          p0.x = minX + (op.startM||0); p1.x = minX + (op.endM||0);
          p0.y = p1.y = (s===1 ? minY : maxY);
        } else if(op.edge==='maxZ'){ // world bottom (South)
          hostIdx = (s===1 ? wallIdx.bottom : wallIdx.top);
          p0.x = minX + (op.startM||0); p1.x = minX + (op.endM||0);
          p0.y = p1.y = (s===1 ? maxY : minY);
        } else if(op.edge==='minX'){ // left
          hostIdx = wallIdx.left;
          p0.y = minY + (op.startM||0); p1.y = minY + (op.endM||0);
          p0.x = p1.x = minX;
        } else if(op.edge==='maxX'){ // right
          hostIdx = wallIdx.right;
          p0.y = minY + (op.startM||0); p1.y = minY + (op.endM||0);
          p0.x = p1.x = maxX;
        }
        } // end of edge-based opening handling
        
        if(hostIdx>=0){
          var wallEl = __plan2d.elements[hostIdx];
          // Compute param t via projection to ensure correct orientation
          var t0 = plan2dProjectParamOnWall(p0, wallEl);
          var t1 = plan2dProjectParamOnWall(p1, wallEl);
          if(op.type==='window'){
            var winEl = { type:'window', host:hostIdx, t0:t0, t1:t1, thickness: (wallEl.thickness||__plan2d.wallThicknessM), level: lvl };
            // Preserve custom sillM and heightM from original opening
            if(typeof op.sillM === 'number') winEl.sillM = op.sillM;
            if(typeof op.heightM === 'number') winEl.heightM = op.heightM;
            if(op.meta) winEl.meta = op.meta;
            __plan2d.elements.push(winEl);
          } else if(op.type==='door'){
            var widthM = Math.hypot(p1.x-p0.x, p1.y-p0.y);
            __plan2d.elements.push({ type:'door', host:hostIdx, t0:t0, t1:t1, widthM: widthM, heightM: (typeof op.heightM==='number'? op.heightM : (__plan2d.doorHeightM||2.04)), thickness: (wallEl.thickness||__plan2d.wallThicknessM), meta: (op.meta||{ hinge:'t0', swing:'in' }), level: lvl });
          }
        }
      }
    }
  }

  // Also include existing interior user-created wall strips for ONLY this floor as free-standing walls.
  // This ensures previously applied walls are visible/editable in 2D when adding more later.
  try {
    var sgnWS = (__plan2d.yFromWorldZSign||1);
    for (var wsi=0; wsi<wallStrips.length; wsi++){
      var ws = wallStrips[wsi];
      if (!ws) continue;
  if ((ws.level||0) !== lvl) continue; // enforce per-floor filtering
      // Skip perimeter strips that were generated from rooms when in solid render mode.
      // These are tagged in 3D with window.__roomStripTag (default '__fromRooms').
      try {
        var tagKey = (typeof window !== 'undefined' && window.__roomStripTag) ? window.__roomStripTag : '__fromRooms';
        if (ws[tagKey]) continue;
      } catch(_eTag) {}
      // Map world to plan: x -> x-cx, z -> s*(z-cz)
      var eWall = {
        type: 'wall',
        x0: ws.x0 - cx,
        y0: sgnWS * (ws.z0 - cz),
        x1: ws.x1 - cx,
        y1: sgnWS * (ws.z1 - cz),
        thickness: (ws.thickness || __plan2d.wallThicknessM || 0.3),
        level: lvl
      };
      __plan2d.elements.push(eWall);
    }
  } catch(e) { /* non-fatal */ }

  // Reattach preserved openings to nearest matching walls
  try {
    if (preservedOpenings.length > 0) {
      var reusedAttach = { windows:0, doors:0 };
      for (var poi = 0; poi < preservedOpenings.length; poi++) {
        var po = preservedOpenings[poi];
        var bestWallIdx = -1, bestDist = Infinity;
        // Find closest wall that matches the opening's original groupId (room) AND edge
        for (var wi = 0; wi < __plan2d.elements.length; wi++) {
          var w = __plan2d.elements[wi];
          if (!w || w.type !== 'wall') continue;
          
          // MUST match same room group
          if (po.groupId && w.groupId !== po.groupId) continue;
          
          // Determine this wall's edge
          var wDx = Math.abs(w.x1 - w.x0);
          var wDy = Math.abs(w.y1 - w.y0);
          var wAvgX = (w.x0 + w.x1) / 2;
          var wAvgY = (w.y0 + w.y1) / 2;
          var wEdge = null;
          
          if (wDx > wDy) {
            // Horizontal wall (top or bottom)
            wEdge = (wAvgY < 0) ? 'top' : 'bottom';
          } else {
            // Vertical wall (left or right)
            wEdge = (wAvgX < 0) ? 'left' : 'right';
          }
          
          // MUST match same edge to prevent jumping to adjacent walls
          if (po.edge && wEdge !== po.edge) continue;
          
          // Calculate distance from opening midpoint to wall
          var midX = (po.wx0 + po.wx1) / 2;
          var midY = (po.wy0 + po.wy1) / 2;
          var wallLen = Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
          if (wallLen < 0.01) continue; // Skip degenerate walls
          // Project midpoint onto wall to find closest point
          var dx = w.x1 - w.x0, dy = w.y1 - w.y0;
          var t = Math.max(0, Math.min(1, ((midX - w.x0) * dx + (midY - w.y0) * dy) / (wallLen * wallLen)));
          var closestX = w.x0 + t * dx;
          var closestY = w.y0 + t * dy;
          var dist = Math.hypot(midX - closestX, midY - closestY);
          if (dist < bestDist) {
            bestDist = dist;
            bestWallIdx = wi;
          }
        }
        // Only reattach if wall is close enough (within 0.5m tolerance)
        if (bestWallIdx >= 0 && bestDist < 0.5) {
          var bestWall = __plan2d.elements[bestWallIdx];
          // Project opening endpoints onto new wall to get t0/t1
          var newT0 = plan2dProjectParamOnWall({x: po.wx0, y: po.wy0}, bestWall);
          var newT1 = plan2dProjectParamOnWall({x: po.wx1, y: po.wy1}, bestWall);
          // Create new opening element
          if (po.type === 'window') {
            var winEl = { type: 'window', host: bestWallIdx, t0: newT0, t1: newT1, thickness: (po.thickness || bestWall.thickness || __plan2d.wallThicknessM), level: lvl };
            if (typeof po.sillM === 'number') winEl.sillM = po.sillM;
            if (typeof po.heightM === 'number') winEl.heightM = po.heightM;
            if (po.meta) winEl.meta = po.meta;
            __plan2d.elements.push(winEl);
            reusedAttach.windows++;
          } else if (po.type === 'door') {
            __plan2d.elements.push({ 
              type: 'door', host: bestWallIdx, t0: newT0, t1: newT1, 
              widthM: (po.widthM || 0.9), 
              heightM: (typeof po.heightM === 'number' ? po.heightM : (__plan2d.doorHeightM || 2.04)), 
              thickness: (po.thickness || bestWall.thickness || __plan2d.wallThicknessM), 
              meta: (po.meta || { hinge: 't0', swing: 'in' }),
              level: lvl
            });
            reusedAttach.doors++;
          }
        }
      }
      try { __rtPush({ kind:'populate-preserve-summary', floor: currentFloor, preserved: preservedCounts, reattached: reusedAttach }); } catch(_prs){}
    }
  } catch(e) { /* reattach openings failed - non-critical */ }

  // FINAL SAFETY NET: if after all logic there are still zero elements while source data exists, synthesize a minimal representation
  try {
    if ((!Array.isArray(__plan2d.elements) || __plan2d.elements.length===0) && (allRooms.length>0 || wallStrips.length>0)) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[PLAN2D POPULATE SAFETY] No elements produced; synthesizing minimal walls');
      __plan2d.elements = [];
      var sgnF = (__plan2d.yFromWorldZSign||1);
      // Prefer a room on the current level; fallback to any room.
      var r0 = null; var lvlNowF = (typeof currentFloor==='number'? currentFloor:0);
      for (var rr=0; rr<allRooms.length; rr++){ var cr = allRooms[rr]; if(cr && (cr.level||0)===lvlNowF){ r0 = cr; break; } }
      if (!r0 && allRooms.length){ r0 = allRooms[0]; }
      if (r0){
        var hw=r0.width/2, hd=r0.depth/2;
        var cxRoom = r0.x, czRoom = r0.z; // keep global center stable
        if (!isFinite(__plan2d.centerX)) __plan2d.centerX = cxRoom;
        if (!isFinite(__plan2d.centerZ)) __plan2d.centerZ = czRoom;
        var cxP = __plan2d.centerX, czP = __plan2d.centerZ;
        function add(x0,z0,x1,z1){ __plan2d.elements.push({type:'wall', x0: x0-cxP, y0: sgnF*(z0-czP), x1: x1-cxP, y1: sgnF*(z1-czP), thickness: (__plan2d.wallThicknessM||0.3), synthesized:true }); }
        add(r0.x-hw, r0.z-hd, r0.x+hw, r0.z-hd);
        add(r0.x+hw, r0.z-hd, r0.x+hw, r0.z+hd);
        add(r0.x+hw, r0.z+hd, r0.x-hw, r0.z+hd);
        add(r0.x-hw, r0.z+hd, r0.x-hw, r0.z-hd);
      } else {
        // Use first 4 wall strips (or all) mapped relative to first endpoint average
        // Prefer strips on the current level
        var base=null; for (var ww=0; ww<wallStrips.length; ww++){ var wsL=wallStrips[ww]; if(wsL && (wsL.level||0)===lvlNowF){ base = wsL; break; } }
        if(!base) base = wallStrips[0];
        var cxS = (base.x0+base.x1)/2; var czS = (base.z0+base.z1)/2;
        if (!isFinite(__plan2d.centerX)) __plan2d.centerX = cxS;
        if (!isFinite(__plan2d.centerZ)) __plan2d.centerZ = czS;
        var cxP2 = __plan2d.centerX, czP2 = __plan2d.centerZ;
        for (var ss=0; ss<wallStrips.length && ss<200; ss++){
          var wsS = wallStrips[ss]; if(!wsS) continue; if((wsS.level||0)!==lvlNowF) continue;
          __plan2d.elements.push({ type:'wall', x0: wsS.x0 - cxP2, y0: sgnF*(wsS.z0 - czP2), x1: wsS.x1 - cxP2, y1: sgnF*(wsS.z1 - czP2), thickness: (wsS.thickness||__plan2d.wallThicknessM||0.3), synthesized:true });
        }
      }
      try { if(typeof plan2dDraw==='function') plan2dDraw(); } catch(_drwSynth){}
      try { __plan2d.__userEdited=false; }catch(_flag){}
    }
  } catch(_eSynth) {}
  // Final debug snapshot
  try {
    window.__plan2dDiag.lastPopulateEnd = {
      at: Date.now(),
      floor: currentFloor,
      produced: (Array.isArray(__plan2d.elements)? __plan2d.elements.length : 0)
    };
    // Push compact round-trip trace summary
    try {
      var w=0, win=0, d=0, other=0; var elsArr = Array.isArray(__plan2d.elements)? __plan2d.elements:[];
      for (var ci=0; ci<elsArr.length; ci++){ var el=elsArr[ci]; if(!el) continue; if(el.type==='wall') w++; else if(el.type==='window') win++; else if(el.type==='door') d++; else other++; }
      __rtPush({ kind:'populate-end', floor: currentFloor, counts: { walls:w, windows:win, doors:d, other:other, total: (elsArr.length||0) }, preserved: preservedCounts });
    } catch(_rt){ /* ignore */ }
    if (console && console.debug) console.debug('[PLAN2D POPULATE] end floor='+currentFloor+' elements=', window.__plan2dDiag.lastPopulateEnd.produced);
  } catch(_dbg1) {}
  return true;
}

// Convenience helper: populate __plan2d from current 3D and return a self-contained snapshot
// Snapshot contains elements plus the exact coordinate context (center/sign/scale) used to build them
function populatePlan2DFromDesignSnapshot(){
  var ok = false;
  try { ok = !!populatePlan2DFromDesign(); } catch(_e) { ok = false; }
  try {
    var snap = {
      ok: !!ok,
      centerX: (typeof __plan2d.centerX === 'number' && isFinite(__plan2d.centerX)) ? __plan2d.centerX : 0,
      centerZ: (typeof __plan2d.centerZ === 'number' && isFinite(__plan2d.centerZ)) ? __plan2d.centerZ : 0,
      yFromWorldZSign: (__plan2d && (__plan2d.yFromWorldZSign === -1 || __plan2d.yFromWorldZSign === 1)) ? __plan2d.yFromWorldZSign : 1,
      scale: (typeof __plan2d.scale === 'number' && isFinite(__plan2d.scale)) ? __plan2d.scale : undefined,
      elements: []
    };
    if (Array.isArray(__plan2d.elements)) {
      // Deep clone to decouple from live editor state
      try { snap.elements = JSON.parse(JSON.stringify(__plan2d.elements)); }
      catch(_eJ){
        var out=[]; for (var i=0;i<__plan2d.elements.length;i++){ var el=__plan2d.elements[i]; out.push(el? Object.assign({}, el): el); }
        snap.elements = out;
      }
    }
    return snap;
  } catch(e) {
    return { ok:false, centerX:0, centerZ:0, yFromWorldZSign:1, elements:[] };
  }
}

