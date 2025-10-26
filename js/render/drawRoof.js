// Render: Roof and its resize/rotate handles
// Depends on globals: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor, drawHandle

function drawRoof(roof) {
  if (!roof) return;
  try {
    var selected = selectedRoomId === roof.id;
    var strokeColor = selected ? '#007acc' : '#A0A0A0';
    var fillColor = selected ? 'rgba(0,122,204,0.18)' : 'rgba(160,160,160,0.12)';
    var strokeWidth = selected ? 2 : 1.5;
    var opacity = (typeof currentFloor==='number' ? (currentFloor === (roof.level || 0)) : true) ? 1.0 : 0.7;
    var rotRad = ((roof.rotation || 0) * Math.PI) / 180;

    var baseY = (typeof roof.baseHeight === 'number' && isFinite(roof.baseHeight)) ? roof.baseHeight : 3.0;
    var height = (typeof roof.height === 'number' && isFinite(roof.height)) ? roof.height : 1.0;
    var w = Math.max(0.5, roof.width || 4);
    var d = Math.max(0.5, roof.depth || 4);
    var hw = w / 2;
    var hd = d / 2;

    function rot(x, z) {
      var dx = x - roof.x, dz = z - roof.z;
      return { x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad), z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad) };
    }
    function P(x, y, z){ var pr = project3D(x,y,z); return pr; }

    // Eave corners (world) at baseY
    var e0 = rot(roof.x - hw, roof.z - hd);
    var e1 = rot(roof.x + hw, roof.z - hd);
    var e2 = rot(roof.x + hw, roof.z + hd);
    var e3 = rot(roof.x - hw, roof.z + hd);

    function normalizeType(t){
      try{
        var s = String(t||'').toLowerCase();
        if (s==='gambrel' || s==='barn') return 'barn';
        if (s==='apex') return 'apex';
        if (s==='cylinder' || s==='cylindrical' || s==='cycinder' || s==='barrel' || s==='barrel-vault') return 'cylinder';
        return s || 'flat';
      }catch(e){ return 'flat'; }
    }
    var type = normalizeType(roof.roofType || 'flat');
    var apexY = baseY + height; // default apex for non-flat

    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;

    // Draw eave rectangle outline for all types
    var pe0 = P(e0.x, baseY, e0.z), pe1 = P(e1.x, baseY, e1.z), pe2 = P(e2.x, baseY, e2.z), pe3 = P(e3.x, baseY, e3.z);
    if (!pe0 || !pe1 || !pe2 || !pe3) { ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(pe0.x,pe0.y); ctx.lineTo(pe1.x,pe1.y); ctx.lineTo(pe2.x,pe2.y); ctx.lineTo(pe3.x,pe3.y); ctx.closePath(); ctx.stroke();

    // Fill + stroke helper to ensure keylines around every plane
    function fillStrokePoly(points, color){
      var ok = true; var ps = [];
      for (var i=0;i<points.length;i++){ var pr=P(points[i].x, points[i].y, points[i].z); if(!pr){ ok=false; break; } ps.push(pr); }
      if(!ok) return; ctx.fillStyle = color||fillColor; ctx.beginPath(); ctx.moveTo(ps[0].x, ps[0].y); for (var j=1;j<ps.length;j++){ ctx.lineTo(ps[j].x, ps[j].y); } ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    function line(a,b){ var pa=P(a.x,a.y,a.z), pb=P(b.x,b.y,b.z); if(pa&&pb){ ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke(); } }

    if (type === 'flat') {
      // Simple box top
      var t0 = {x:e0.x, y: baseY+height, z:e0.z};
      var t1 = {x:e1.x, y: baseY+height, z:e1.z};
      var t2 = {x:e2.x, y: baseY+height, z:e2.z};
      var t3 = {x:e3.x, y: baseY+height, z:e3.z};
  fillStrokePoly([t0,t1,t2,t3], fillColor);
      // Vertical hints
      line({x:e0.x,y:baseY,z:e0.z}, t0); line({x:e1.x,y:baseY,z:e1.z}, t1); line({x:e2.x,y:baseY,z:e2.z}, t2); line({x:e3.x,y:baseY,z:e3.z}, t3);
      apexY = baseY + height;
      // Top outline keyline
      ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; line(t0,t1); line(t1,t2); line(t2,t3); line(t3,t0);
    } else if (type === 'gable' || type === 'apex') {
      // Ridge along local X at center Z
      var rL = rot(roof.x - hw, roof.z + 0); rL = { x:rL.x, y: apexY, z:rL.z };
      var rR = rot(roof.x + hw, roof.z + 0); rR = { x:rR.x, y: apexY, z:rR.z };
      // Two sloped faces
  fillStrokePoly([rL, {x:e1.x,y:baseY,z:e1.z}, {x:e2.x,y:baseY,z:e2.z}, rR], fillColor);
  fillStrokePoly([rL, {x:e0.x,y:baseY,z:e0.z}, {x:e3.x,y:baseY,z:e3.z}, rR], fillColor);
      // End gables outline
      line({x:e0.x,y:baseY,z:e0.z}, rL); line(rL, {x:e1.x,y:baseY,z:e1.z});
      line({x:e3.x,y:baseY,z:e3.z}, rR); line(rR, {x:e2.x,y:baseY,z:e2.z});
      // Ridge keyline
      ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; line(rL, rR);
    } else if (type === 'hip') {
      var ridgeHalf = hw * 0.5;
      var rLh = rot(roof.x - ridgeHalf, roof.z + 0); rLh = { x:rLh.x, y: apexY, z:rLh.z };
      var rRh = rot(roof.x + ridgeHalf, roof.z + 0); rRh = { x:rRh.x, y: apexY, z:rRh.z };
      // Near and far planes
  fillStrokePoly([rLh, rRh, {x:e2.x,y:baseY,z:e2.z}, {x:e1.x,y:baseY,z:e1.z}], fillColor);
  fillStrokePoly([rLh, rRh, {x:e3.x,y:baseY,z:e3.z}, {x:e0.x,y:baseY,z:e0.z}], fillColor);
      // Ends
  fillStrokePoly([{x:e0.x,y:baseY,z:e0.z}, {x:e3.x,y:baseY,z:e3.z}, rLh], fillColor);
  fillStrokePoly([{x:e1.x,y:baseY,z:e1.z}, {x:e2.x,y:baseY,z:e2.z}, rRh], fillColor);
      // Ridge line
      line(rLh, rRh);
    } else if (type === 'pyramid') {
      var apex = rot(roof.x + 0, roof.z + 0); apex = { x:apex.x, y:apexY, z:apex.z };
  fillStrokePoly([apex, {x:e0.x,y:baseY,z:e0.z}, {x:e1.x,y:baseY,z:e1.z}], fillColor);
  fillStrokePoly([apex, {x:e1.x,y:baseY,z:e1.z}, {x:e2.x,y:baseY,z:e2.z}], fillColor);
  fillStrokePoly([apex, {x:e2.x,y:baseY,z:e2.z}, {x:e3.x,y:baseY,z:e3.z}], fillColor);
  fillStrokePoly([apex, {x:e3.x,y:baseY,z:e3.z}, {x:e0.x,y:baseY,z:e0.z}], fillColor);
      // Keylines to apex
      line(apex, {x:e0.x,y:baseY,z:e0.z}); line(apex, {x:e1.x,y:baseY,z:e1.z}); line(apex, {x:e2.x,y:baseY,z:e2.z}); line(apex, {x:e3.x,y:baseY,z:e3.z});
    } else if (type === 'skillion') {
      // Tilt along local +Z: back edge high, front low
      var k0 = {x:e0.x, y: baseY,         z:e0.z};
      var k1 = {x:e1.x, y: baseY,         z:e1.z};
      var k2 = {x:e2.x, y: baseY+height,  z:e2.z};
      var k3 = {x:e3.x, y: baseY+height,  z:e3.z};
  fillStrokePoly([k0,k1,k2,k3], fillColor);
      // Keyline along high edge
      line(k2, k3);
    } else if (type === 'barn') {
      // Approximate gambrel as gable with a visual break
  var rLg = rot(roof.x - hw, roof.z + 0); rLg = { x:rLg.x, y: apexY, z:rLg.z };
  var rRg = rot(roof.x + hw, roof.z + 0); rRg = { x:rRg.x, y: apexY, z:rRg.z };
  fillStrokePoly([rLg, {x:e1.x,y:baseY,z:e1.z}, {x:e2.x,y:baseY,z:e2.z}, rRg], fillColor);
    fillStrokePoly([rLg, {x:e0.x,y:baseY,z:e0.z}, {x:e3.x,y:baseY,z:e3.z}, rRg], fillColor);
      // Break lines at 60% of height from eave
      var by = baseY + height * 0.6;
      var b0 = rot(roof.x - hw, roof.z - hd*0.2); b0 = {x:b0.x, y:by, z:b0.z};
      var b1 = rot(roof.x + hw, roof.z - hd*0.2); b1 = {x:b1.x, y:by, z:b1.z};
      var b2 = rot(roof.x + hw, roof.z + hd*0.2); b2 = {x:b2.x, y:by, z:b2.z};
      var b3 = rot(roof.x - hw, roof.z + hd*0.2); b3 = {x:b3.x, y:by, z:b3.z};
      line(b0,b1); line(b3,b2);
      // Ridge line keyline
      line(rLg, rRg);
    } else if (type === 'cylinder') {
      // Barrel vault: curve along local X, extruded along Z
      var slices = Math.max(6, Math.floor(Math.min(16, hw * 6)));
      for (var si=0; si<slices; si++){
        var x0r = -hw + (si    /slices) * (2*hw);
        var x1r = -hw + ((si+1)/slices) * (2*hw);
        var y0r = baseY + height * Math.max(0, Math.sqrt(Math.max(0, 1 - Math.pow(x0r/hw,2))));
        var y1r = baseY + height * Math.max(0, Math.sqrt(Math.max(0, 1 - Math.pow(x1r/hw,2))));
        var a0f = rot(roof.x + x0r, roof.z - hd), a1f = rot(roof.x + x1r, roof.z - hd);
        var a0b = rot(roof.x + x0r, roof.z + hd), a1b = rot(roof.x + x1r, roof.z + hd);
        fillStrokePoly([
          {x:a0f.x,y:y0r,z:a0f.z},
          {x:a1f.x,y:y1r,z:a1f.z},
          {x:a1b.x,y:y1r,z:a1b.z},
          {x:a0b.x,y:y0r,z:a0b.z}
        ], fillColor);
      }
      // Keylines: ridge along center and eave arcs ends
      var cF = rot(roof.x, roof.z - hd), cB = rot(roof.x, roof.z + hd);
      line({x:cF.x,y:baseY+height,z:cF.z}, {x:cB.x,y:baseY+height,z:cB.z});
    } else if (type === 'mansard') {
      // Hip with a small flat top
      var inset = 0.4; // fraction inset for flat top
      var tx0 = rot(roof.x - hw*inset, roof.z - hd*inset);
      var tx1 = rot(roof.x + hw*inset, roof.z - hd*inset);
      var tx2 = rot(roof.x + hw*inset, roof.z + hd*inset);
      var tx3 = rot(roof.x - hw*inset, roof.z + hd*inset);
      var t0m = {x:tx0.x, y:apexY, z:tx0.z}, t1m={x:tx1.x, y:apexY, z:tx1.z}, t2m={x:tx2.x, y:apexY, z:tx2.z}, t3m={x:tx3.x, y:apexY, z:tx3.z};
      // Sloped skirts
  fillStrokePoly([{x:e0.x,y:baseY,z:e0.z}, {x:e1.x,y:baseY,z:e1.z}, t1m, t0m], fillColor);
  fillStrokePoly([{x:e1.x,y:baseY,z:e1.z}, {x:e2.x,y:baseY,z:e2.z}, t2m, t1m], fillColor);
  fillStrokePoly([{x:e2.x,y:baseY,z:e2.z}, {x:e3.x,y:baseY,z:e3.z}, t3m, t2m], fillColor);
  fillStrokePoly([{x:e3.x,y:baseY,z:e3.z}, {x:e0.x,y:baseY,z:e0.z}, t0m, t3m], fillColor);
      // Flat top
  fillStrokePoly([t0m,t1m,t2m,t3m], fillColor);
    } else {
      // Fallback to flat
      var tf0 = {x:e0.x, y: baseY+height, z:e0.z};
      var tf1 = {x:e1.x, y: baseY+height, z:e1.z};
      var tf2 = {x:e2.x, y: baseY+height, z:e2.z};
      var tf3 = {x:e3.x, y: baseY+height, z:e3.z};
  fillStrokePoly([tf0,tf1,tf2,tf3], fillColor);
    }

    ctx.restore();

    // Handles
    drawHandlesForRoof(roof, apexY);
  } catch(e){ console.error('Roof draw error:', e); }
}

function drawHandlesForRoof(roof, apexY){
  try {
    if (window.__focusActive && window.__focusId && roof.id !== window.__focusId) return;
    var isActive = selectedRoomId === roof.id;
    var baseY = (typeof roof.baseHeight==='number' && isFinite(roof.baseHeight)) ? roof.baseHeight : 3.0;
    var hgt = (typeof roof.height==='number' && isFinite(roof.height)) ? roof.height : 1.0;
    var yMid = baseY + hgt * 0.5;
    var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
    function r(dx,dz){ return { x: roof.x + dx*Math.cos(rotRad) - dz*Math.sin(rotRad), z: roof.z + dx*Math.sin(rotRad) + dz*Math.cos(rotRad) }; }
    var hw = Math.max(0.25, (roof.width||4)/2), hd=Math.max(0.25, (roof.depth||4)/2);
    var handles = [
      (function(){ var q=r(hw,0); return {x:q.x,y:yMid,z:q.z,type:'width+',label:'X+'}; })(),
      (function(){ var q=r(-hw,0); return {x:q.x,y:yMid,z:q.z,type:'width-',label:'X-'}; })(),
      (function(){ var q=r(0,hd); return {x:q.x,y:yMid,z:q.z,type:'depth+',label:'Z+'}; })(),
      (function(){ var q=r(0,-hd); return {x:q.x,y:yMid,z:q.z,type:'depth-',label:'Z-'}; })()
    ];
    var cScreen = project3D(roof.x, yMid, roof.z);
    for (var i=0;i<handles.length;i++){
      var h=handles[i]; var s=project3D(h.x,h.y,h.z); if(!s) continue; if(cScreen){ var dx=cScreen.x-s.x, dy=cScreen.y-s.y; var L=Math.hypot(dx,dy)||1; s.x+=(dx/L)*20; s.y+=(dy/L)*20; }
      var rr = (typeof computeHandleRadius==='function')? computeHandleRadius(s,HANDLE_RADIUS): HANDLE_RADIUS;
      drawHandle(s, h.type, h.label, isActive, rr);
      if (Array.isArray(resizeHandles)) resizeHandles.push({ screenX:s.x-rr, screenY:s.y-rr, width:rr*2, height:rr*2, type:h.type, roomId:roof.id });
    }
    // Height handle above center remains
    var sH = project3D(roof.x, yMid + 0.5, roof.z); if (sH) { var rrH = (typeof computeHandleRadius==='function')? computeHandleRadius(sH,HANDLE_RADIUS): HANDLE_RADIUS; drawHandle(sH, 'height', 'Y', isActive, rrH); if (Array.isArray(resizeHandles)) resizeHandles.push({ screenX:sH.x-rrH, screenY:sH.y-rrH, width:rrH*2, height:rrH*2, type:'height', roomId:roof.id }); }
  } catch(e){ console.error('Roof handle error:', e); }
}
