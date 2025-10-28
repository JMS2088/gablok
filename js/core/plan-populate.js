"use strict";
// Populate the 2D Floor Plan from the current 3D model for the currently selected floor
// Extracted from app.js for modularity; loaded by bootstrap before app core.
function populatePlan2DFromDesign(){
  // Collect rectangles for rooms on the current floor; include garages on ground and balconies on first
  var rects = [];
  var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
  for (var i=0;i<allRooms.length;i++) {
    var r = allRooms[i];
    if ((r.level||0) !== lvl) continue; // current floor only
    var hw = r.width/2, hd = r.depth/2;
    rects.push({
      name: r.name || 'Room',
      minX: r.x - hw, maxX: r.x + hw,
      minZ: r.z - hd, maxZ: r.z + hd,
      type: 'room',
      roomId: r.id,
      polyLike: Array.isArray(r.footprint) && r.footprint.length >= 3,
      openings: (Array.isArray(r.openings) ? r.openings.slice() : [])
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
  // Include stairs footprint in bounds only on their level (avoid shifting first floor centering)
  if (stairsComponent && (stairsComponent.level||0) === lvl) {
    var s = stairsComponent; var hwS = (s.width||0)/2, hdS = (s.depth||0)/2;
    // Account for rotation when computing extents
    var rot = ((s.rotation||0) * Math.PI) / 180;
    function r(px, pz){ var dx=px-s.x, dz=pz-s.z; return { x: s.x + dx*Math.cos(rot) - dz*Math.sin(rot), z: s.z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
    var p1=r(s.x-hwS, s.z-hdS), p2=r(s.x+hwS, s.z-hdS), p3=r(s.x+hwS, s.z+hdS), p4=r(s.x-hwS, s.z+hdS);
    rects.push({ name:'Stairs', minX: Math.min(p1.x,p2.x,p3.x,p4.x), maxX: Math.max(p1.x,p2.x,p3.x,p4.x), minZ: Math.min(p1.z,p2.z,p3.z,p4.z), maxZ: Math.max(p1.z,p2.z,p3.z,p4.z), type:'stairs' });
  }
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
      var c0 = document.getElementById('plan2d-canvas'); if(!c0) return false;
      var spanX0 = Math.max(0.5, (sMaxX - sMinX));
      var spanZ0 = Math.max(0.5, (sMaxZ - sMinZ));
      var pad0 = 0.15;
      var fitWm0 = spanX0 * (1 + pad0), fitHm0 = spanZ0 * (1 + pad0);
      var scaleX0 = (c0.width>0) ? (c0.width/(fitWm0||1)) : (__plan2d.scale||50);
      var scaleY0 = (c0.height>0) ? (c0.height/(fitHm0||1)) : (__plan2d.scale||50);
      var newScale0 = Math.max(10, Math.min(140, Math.floor(Math.min(scaleX0, scaleY0))));
      if (isFinite(newScale0) && newScale0>0) __plan2d.scale = newScale0;
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
      if (b.type === 'room') { rMinX=Math.min(rMinX,bminX); rMaxX=Math.max(rMaxX,bmaxX); rMinZ=Math.min(rMinZ,bminZ); rMaxZ=Math.max(rMaxZ,bmaxZ); roomCount++; }
    } else {
      if (b.minX<minX) minX=b.minX; if (b.maxX>maxX) maxX=b.maxX;
      if (b.minZ<minZ) minZ=b.minZ; if (b.maxZ>maxZ) maxZ=b.maxZ;
      if (b.type === 'room') { rMinX=Math.min(rMinX,b.minX); rMaxX=Math.max(rMaxX,b.maxX); rMinZ=Math.min(rMinZ,b.minZ); rMaxZ=Math.max(rMaxZ,b.maxZ); roomCount++; }
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
  // Stairs (single location)
  if (stairsComponent){ var s=stairsComponent; var hwS=s.width/2, hdS=s.depth/2; var rot=((s.rotation||0)*Math.PI)/180; function r(px,pz){ var dx=px-s.x, dz=pz-s.z; return {x:s.x+dx*Math.cos(rot)-dz*Math.sin(rot), z:s.z+dx*Math.sin(rot)+dz*Math.cos(rot)}; } var gp1=r(s.x-hwS, s.z-hdS), gp2=r(s.x+hwS, s.z-hdS), gp3=r(s.x+hwS, s.z+hdS), gp4=r(s.x-hwS, s.z+hdS); gMinX=Math.min(gMinX, gp1.x,gp2.x,gp3.x,gp4.x); gMaxX=Math.max(gMaxX, gp1.x,gp2.x,gp3.x,gp4.x); gMinZ=Math.min(gMinZ, gp1.z,gp2.z,gp3.z,gp4.z); gMaxZ=Math.max(gMaxZ, gp1.z,gp2.z,gp3.z,gp4.z); }
  var gcx = (isFinite(gMinX)&&isFinite(gMaxX)) ? (gMinX+gMaxX)/2 : (minX+maxX)/2;
  var gcz = (isFinite(gMinZ)&&isFinite(gMaxZ)) ? (gMinZ+gMaxZ)/2 : (minZ+maxZ)/2;
  // Use global center so both floors share the same origin
  var cx = gcx; var cz = gcz;
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

  // Fit scale to canvas with margins
  var c=document.getElementById('plan2d-canvas');
  if (!c) return false;
  var pad = 0.15; // 15% margin
  var fitWm = spanX*(1+pad), fitHm = spanZ*(1+pad);
  var scaleX = (c.width>0) ? (c.width/(fitWm||1)) : __plan2d.scale;
  var scaleY = (c.height>0) ? (c.height/(fitHm||1)) : __plan2d.scale;
  var newScale = Math.max(10, Math.min(140, Math.floor(Math.min(scaleX, scaleY)))); // clamp sensible range
  if (__freezeScale) { newScale = __plan2d.scale || newScale; }
  if (isFinite(newScale) && newScale>0) __plan2d.scale = newScale;

  // Build wall segments around each rectangle, shifted so center is at (0,0)
  __plan2d.elements = [];
  function addRectWalls(minX,maxX,minZ,maxZ, groupId){
    var s = (__plan2d.yFromWorldZSign||1);
    var x0=minX - cx, x1=maxX - cx, y0=s*(minZ - cz), y1=s*(maxZ - cz); // map z->y with sign
    var idxTop = __plan2d.elements.length;     __plan2d.elements.push({type:'wall', x0:x0,y0:y0, x1:x1,y1:y0, thickness:__plan2d.wallThicknessM, groupId: groupId||null});
    var idxRight = __plan2d.elements.length;   __plan2d.elements.push({type:'wall', x0:x1,y0:y0, x1:x1,y1:y1, thickness:__plan2d.wallThicknessM, groupId: groupId||null});
    var idxBottom = __plan2d.elements.length;  __plan2d.elements.push({type:'wall', x0:x1,y0:y1, x1:x0,y1:y1, thickness:__plan2d.wallThicknessM, groupId: groupId||null});
    var idxLeft = __plan2d.elements.length;    __plan2d.elements.push({type:'wall', x0:x0,y0:y1, x1:x0,y1:y0, thickness:__plan2d.wallThicknessM, groupId: groupId||null});
    return { top: idxTop, right: idxRight, bottom: idxBottom, left: idxLeft, coords: {x0:x0,x1:x1,y0:y0,y1:y1} };
  }
  function addRotatedRectWalls(cxW, czW, w, d, rotationDeg, groupId){
    var s = (__plan2d.yFromWorldZSign||1);
    var hw=w/2, hd=d/2, rot=((rotationDeg||0)*Math.PI)/180;
    function rotW(px,pz){ var dx=px-cxW, dz=pz-czW; return { x: cxW + dx*Math.cos(rot) - dz*Math.sin(rot), z: czW + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
    var c1=rotW(cxW-hw, czW-hd), c2=rotW(cxW+hw, czW-hd), c3=rotW(cxW+hw, czW+hd), c4=rotW(cxW-hw, czW+hd);
    function toPlan(p){ return { x: (p.x - cx), y: s * (p.z - cz) }; }
    var p1=toPlan(c1), p2=toPlan(c2), p3=toPlan(c3), p4=toPlan(c4);
    var i1 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p1.x,y0:p1.y, x1:p2.x,y1:p2.y, thickness:__plan2d.wallThicknessM, groupId: groupId||null});
    var i2 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p2.x,y0:p2.y, x1:p3.x,y1:p3.y, thickness:__plan2d.wallThicknessM, groupId: groupId||null});
    var i3 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p3.x,y0:p3.y, x1:p4.x,y1:p4.y, thickness:__plan2d.wallThicknessM, groupId: groupId||null});
    var i4 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p4.x,y0:p4.y, x1:p1.x,y1:p1.y, thickness:__plan2d.wallThicknessM, groupId: groupId||null});
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
  // Build walls for rooms only; non-room outlines should not feedback into 3D room creation
  if(rb.type!=='room' && rb.type!=='garage' && rb.type!=='pergola' && rb.type!=='balcony') continue;
    var wallIdx;
    var hasRotation = (typeof rb.rotation==='number' && Math.abs(rb.rotation)%360>1e-6);
    if (hasRotation) {
      wallIdx = addRotatedRectWalls(rb.cx, rb.cz, rb.w, rb.d, rb.rotation, (rb.type==='room' && rb.roomId && !rb.polyLike ? ('room:'+rb.roomId) : null));
    } else {
      wallIdx = addRectWalls(rb.minX, rb.maxX, rb.minZ, rb.maxZ, (rb.type==='room' && rb.roomId && !rb.polyLike ? ('room:'+rb.roomId) : null));
    }
    // Tag walls so applyPlan2DTo3D can ignore non-room walls
    markWallRole(wallIdx, (rb.type==='room' ? 'room' : 'nonroom'));
    // Re-create openings (windows/doors) anchored to walls for rooms
    if(rb.type==='room' && Array.isArray(rb.openings) && rb.openings.length){
      var s = (__plan2d.yFromWorldZSign||1);
      var minX = rb.minX - cx, maxX = rb.maxX - cx, minY = s*(rb.minZ - cz), maxY = s*(rb.maxZ - cz); // shifted with sign
      for(var oi=0; oi<rb.openings.length; oi++){
        var op = rb.openings[oi]; if(!op || (op.type!=='window' && op.type!=='door')) continue;
        var hostIdx = -1; var p0={x:0,y:0}, p1={x:0,y:0};
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
        if(hostIdx>=0){
          var wallEl = __plan2d.elements[hostIdx];
          // Compute param t via projection to ensure correct orientation
          var t0 = plan2dProjectParamOnWall(p0, wallEl);
          var t1 = plan2dProjectParamOnWall(p1, wallEl);
          if(op.type==='window'){
            __plan2d.elements.push({ type:'window', host:hostIdx, t0:t0, t1:t1, thickness: (wallEl.thickness||__plan2d.wallThicknessM) });
          } else if(op.type==='door'){
            var widthM = Math.hypot(p1.x-p0.x, p1.y-p0.y);
            __plan2d.elements.push({ type:'door', host:hostIdx, t0:t0, t1:t1, widthM: widthM, heightM: (typeof op.heightM==='number'? op.heightM : (__plan2d.doorHeightM||2.04)), thickness: (wallEl.thickness||__plan2d.wallThicknessM), meta: (op.meta||{ hinge:'t0', swing:'in' }) });
          }
        }
      }
    }
  }

  // Also include existing interior wall strips from 3D for the current floor as free-standing walls.
  // This ensures previously applied walls are visible/editable in 2D when adding more later.
  try {
    var sgnWS = (__plan2d.yFromWorldZSign||1);
    for (var wsi=0; wsi<wallStrips.length; wsi++){
      var ws = wallStrips[wsi];
      if ((ws.level||0) !== lvl) continue;
      // Map world to plan: x -> x-cx, z -> s*(z-cz)
      var eWall = {
        type: 'wall',
        x0: ws.x0 - cx,
        y0: sgnWS * (ws.z0 - cz),
        x1: ws.x1 - cx,
        y1: sgnWS * (ws.z1 - cz),
        thickness: (ws.thickness || __plan2d.wallThicknessM || 0.3)
      };
      __plan2d.elements.push(eWall);
    }
  } catch(e) { /* non-fatal */ }
  return true;
}
