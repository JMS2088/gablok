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
    var height = (typeof roof.height === 'number' && isFinite(roof.height)) ? roof.height : 0.6;
    var topY = baseY + height;
    var w = Math.max(0.5, roof.width || 4);
    var d = Math.max(0.5, roof.depth || 4);
    var hw = w / 2;
    var hd = d / 2;

    function rot(x, z) {
      var dx = x - roof.x, dz = z - roof.z;
      return { x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad), z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad) };
    }

    // 8 corners of the roof box
    var c = [
      rot(roof.x - hw, roof.z - hd), rot(roof.x + hw, roof.z - hd), rot(roof.x + hw, roof.z + hd), rot(roof.x - hw, roof.z + hd)
    ];
    var pts = [
      {x:c[0].x,y:baseY,z:c[0].z}, {x:c[1].x,y:baseY,z:c[1].z}, {x:c[2].x,y:baseY,z:c[2].z}, {x:c[3].x,y:baseY,z:c[3].z},
      {x:c[0].x,y:topY,z:c[0].z},   {x:c[1].x,y:topY,z:c[1].z},   {x:c[2].x,y:topY,z:c[2].z},   {x:c[3].x,y:topY,z:c[3].z}
    ];
    var p = new Array(8);
    for (var i=0;i<8;i++){ var pr = project3D(pts[i].x, pts[i].y, pts[i].z); if(!pr) return; p[i]=pr; }

  if (!ctx) return; // guard
  ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth;
    var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.beginPath();
    for (var e=0;e<edges.length;e++){ var E=edges[e]; ctx.moveTo(p[E[0]].x,p[E[0]].y); ctx.lineTo(p[E[1]].x,p[E[1]].y); }
    ctx.stroke();
    // Fill top face for subtle presence
    ctx.fillStyle = fillColor;
    ctx.beginPath(); ctx.moveTo(p[4].x,p[4].y); ctx.lineTo(p[5].x,p[5].y); ctx.lineTo(p[6].x,p[6].y); ctx.lineTo(p[7].x,p[7].y); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Handles
    drawHandlesForRoof(roof);
  } catch(e){ console.error('Roof draw error:', e); }
}

function drawHandlesForRoof(roof){
  try {
    var isActive = selectedRoomId === roof.id;
    var y = ((typeof roof.baseHeight==='number' && isFinite(roof.baseHeight)) ? roof.baseHeight : 3.0) + ((typeof roof.height==='number' && isFinite(roof.height)) ? roof.height : 0.6) + 0.2;
    var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
    function r(dx,dz){ return { x: roof.x + dx*Math.cos(rotRad) - dz*Math.sin(rotRad), z: roof.z + dx*Math.sin(rotRad) + dz*Math.cos(rotRad) }; }
    var hw = Math.max(0.25, (roof.width||4)/2), hd=Math.max(0.25, (roof.depth||4)/2);
    var handles = [
      (function(){ var q=r(hw,0); return {x:q.x,y:y,z:q.z,type:'width+',label:'X+'}; })(),
      (function(){ var q=r(-hw,0); return {x:q.x,y:y,z:q.z,type:'width-',label:'X-'}; })(),
      (function(){ var q=r(0,hd); return {x:q.x,y:y,z:q.z,type:'depth+',label:'Z+'}; })(),
      (function(){ var q=r(0,-hd); return {x:q.x,y:y,z:q.z,type:'depth-',label:'Z-'}; })()
    ];
    for (var i=0;i<handles.length;i++){
      var h=handles[i]; var s=project3D(h.x,h.y,h.z); if(!s) continue; var rr = (typeof computeHandleRadius==='function')? computeHandleRadius(s,HANDLE_RADIUS): HANDLE_RADIUS;
      drawHandle(s, h.type, h.label, isActive, rr);
      if (Array.isArray(resizeHandles)) resizeHandles.push({ screenX:s.x-rr, screenY:s.y-rr, width:rr*2, height:rr*2, type:h.type, roomId:roof.id });
    }
  } catch(e){ console.error('Roof handle error:', e); }
}
