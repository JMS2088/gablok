// Render: Pool and its handles
// Depends on globals: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor

function drawPool(pool) {
  if (!pool) return;
  try {
    var selected = selectedRoomId === pool.id;
    var strokeColor = selected ? '#007acc' : '#9ecae1';
    var rimColor = selected ? 'rgba(0,122,204,0.25)' : 'rgba(100,150,200,0.18)';
    var waterColor = selected ? 'rgba(40,150,220,0.35)' : 'rgba(60,160,220,0.28)';
    var strokeWidth = selected ? 2 : 1.5;
    var opacity = currentFloor === (pool.level || 0) ? 1.0 : 0.6;
    var rotRad = ((pool.rotation || 0) * Math.PI) / 180;
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;

    var hw = pool.width / 2;
    var hd = pool.depth / 2;
    var depthY = -pool.height; // in-ground

    function rot(x, z) {
      var dx = x - pool.x, dz = z - pool.z;
      return { x: pool.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad), z: pool.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad) };
    }

    // Rim at ground level (y=0)
    var cornersRim = [ rot(pool.x-hw, pool.z-hd), rot(pool.x+hw, pool.z-hd), rot(pool.x+hw, pool.z+hd), rot(pool.x-hw, pool.z+hd) ];
    var pR = cornersRim.map(function(c){ return project3D(c.x, 0, c.z); });
    if (pR.some(function(p){ return !p; })) return;

    // Inner bottom rectangle
    var cornersBottom = [ rot(pool.x-hw, pool.z-hd), rot(pool.x+hw, pool.z-hd), rot(pool.x+hw, pool.z+hd), rot(pool.x-hw, pool.z+hd) ];
    var pB = cornersBottom.map(function(c){ return project3D(c.x, depthY, c.z); });
    if (pB.some(function(p){ return !p; })) return;

    // Draw water surface as top face inside rim
    ctx.fillStyle = waterColor;
    ctx.beginPath();
    ctx.moveTo(pR[0].x, pR[0].y);
    ctx.lineTo(pR[1].x, pR[1].y);
    ctx.lineTo(pR[2].x, pR[2].y);
    ctx.lineTo(pR[3].x, pR[3].y);
    ctx.closePath();
    ctx.fill();

    // Draw inner walls (sides) to suggest depth
    ctx.fillStyle = 'rgba(50,120,180,0.25)';
    var faces = [[0,1],[1,2],[2,3],[3,0]];
    for (var i = 0; i < faces.length; i++) {
      var a = faces[i][0], b = faces[i][1];
      ctx.beginPath();
      ctx.moveTo(pR[a].x, pR[a].y);
      ctx.lineTo(pR[b].x, pR[b].y);
      ctx.lineTo(pB[b].x, pB[b].y);
      ctx.lineTo(pB[a].x, pB[a].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Rim outline
    ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(pR[0].x, pR[0].y);
    for (var i2=1;i2<4;i2++){ ctx.lineTo(pR[i2].x, pR[i2].y); }
    ctx.closePath();
    ctx.stroke();

    // Coping/rim fill slightly lighter
    ctx.fillStyle = rimColor;
    ctx.beginPath();
    ctx.moveTo(pR[0].x, pR[0].y);
    ctx.lineTo(pR[1].x, pR[1].y);
    ctx.lineTo(pR[2].x, pR[2].y);
    ctx.lineTo(pR[3].x, pR[3].y);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1.0;
    drawHandlesForPool(pool);
  } catch (e) { console.error('Pool draw error:', e); }
}

function drawHandlesForPool(pool) {
  try {
    var isActive = selectedRoomId === pool.id;
    var REGULAR_HANDLE_RADIUS = HANDLE_RADIUS;
    var ROTATION_HANDLE_RADIUS = 14;
    var BASE_HANDLE_Y = 0.3; // slightly above ground
    var ROTATION_HANDLE_Y = 0.9;
    var rotRad = ((pool.rotation || 0) * Math.PI) / 180;
    function rotateHandle(dx, dz) {
      return {
        x: pool.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        z: pool.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
    var hw = pool.width/2, hd = pool.depth/2;
    var handles = [];
    // rotation first
    handles.push({ x: pool.x, y: ROTATION_HANDLE_Y, z: pool.z, type: 'rotate', label: '360', radius: ROTATION_HANDLE_RADIUS });
    [
      {dx: hw, dz: 0, type: 'width+', label: 'X+'},
      {dx: -hw, dz: 0, type: 'width-', label: 'X-'},
      {dx: 0, dz: hd, type: 'depth+', label: 'Z+'},
      {dx: 0, dz: -hd, type: 'depth-', label: 'Z-'}
    ].forEach(function(h){ var p=rotateHandle(h.dx,h.dz); handles.push({x:p.x, y: BASE_HANDLE_Y, z:p.z, type:h.type, label:h.label, radius: REGULAR_HANDLE_RADIUS}); });

    handles.forEach(function(h){
      var s=project3D(h.x,h.y,h.z); if(!s) return;
      var base = (typeof h.radius==='number'? h.radius : HANDLE_RADIUS);
      var r = (typeof computeHandleRadius==='function') ? computeHandleRadius(s, base) : base;
      drawHandle(s, h.type, h.label, isActive, r);
      resizeHandles.push({ screenX:s.x - r, screenY:s.y - r, width:r*2, height:r*2, type:h.type, roomId:pool.id });
    });
  } catch (e) { console.error('Pool handle error:', e); }
}
