// Render: Balcony and its resize handles
// Depends on globals: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor, drawHandle

function drawBalcony(balcony) {
  dbg('Drawing balcony:', balcony);
  if (!balcony) {
    dbg('No balcony provided to draw');
    return;
  }
  
  try {
  var selected = selectedRoomId === balcony.id;
  var onLevel = currentFloor === (balcony.level || 1);
  // Match room stroke colors and widths across components
  var strokeColor = selected ? (onLevel ? '#007acc' : '#005080') : (onLevel ? '#D0D0D0' : '#808080');
  var strokeWidth = selected ? (onLevel ? 3 : 2) : (onLevel ? 2 : 1);
  var opacity = onLevel ? 1.0 : 0.6;
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var legSize = balcony.legWidth;
    var baseY = (balcony.level||0) * 3.5; // Floor level height
    var legPositions = [
      {x: balcony.x - balcony.width/2 + legSize/2, z: balcony.z - balcony.depth/2 + legSize/2},
      {x: balcony.x + balcony.width/2 - legSize/2, z: balcony.z - balcony.depth/2 + legSize/2},
      {x: balcony.x + balcony.width/2 - legSize/2, z: balcony.z + balcony.depth/2 - legSize/2},
      {x: balcony.x - balcony.width/2 + legSize/2, z: balcony.z + balcony.depth/2 - legSize/2}
    ];
    
    // Draw floor slab (thin)
    var floorThick = Math.max(0.06, Math.min(0.2, balcony.floorThickness || 0.1));
    var floorCorners = [
      {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
      {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
      {x: balcony.x - balcony.width/2, y: baseY - floorThick, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: baseY - floorThick, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: baseY - floorThick, z: balcony.z + balcony.depth/2},
      {x: balcony.x - balcony.width/2, y: baseY - floorThick, z: balcony.z + balcony.depth/2}
    ];
    ;(function(){
      var proj=[], ok=true; for(var i=0;i<floorCorners.length;i++){ var p=project3D(floorCorners[i].x,floorCorners[i].y,floorCorners[i].z); if(!p){ ok=false; break; } proj.push(p); }
      if(ok){
        // Top face
        ctx.fillStyle = selected ? 'rgba(0,122,204,0.15)' : 'rgba(180,180,180,0.15)';
        ctx.beginPath(); ctx.moveTo(proj[0].x,proj[0].y); ctx.lineTo(proj[1].x,proj[1].y); ctx.lineTo(proj[2].x,proj[2].y); ctx.lineTo(proj[3].x,proj[3].y); ctx.closePath(); ctx.fill(); ctx.stroke();
        // Bottom face (slightly darker)
        ctx.fillStyle = selected ? 'rgba(0,122,204,0.10)' : 'rgba(160,160,160,0.12)';
        ctx.beginPath(); ctx.moveTo(proj[4].x,proj[4].y); ctx.lineTo(proj[5].x,proj[5].y); ctx.lineTo(proj[6].x,proj[6].y); ctx.lineTo(proj[7].x,proj[7].y); ctx.closePath(); ctx.fill();
        // Sides
        var edges=[[0,4],[1,5],[2,6],[3,7]]; ctx.beginPath(); for(var e=0;e<edges.length;e++){ var ed=edges[e]; ctx.moveTo(proj[ed[0]].x,proj[ed[0]].y); ctx.lineTo(proj[ed[1]].x,proj[ed[1]].y);} ctx.stroke();
      }
    })();

    // Draw walls
    var wallThickness = balcony.wallThickness;
    var wallHeight = balcony.wallHeight;
    var wallCorners = [
      // Front wall
      [
        {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY + wallHeight, z: balcony.z - balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY + wallHeight, z: balcony.z - balcony.depth/2}
      ],
      // Right wall
      [
        {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY + wallHeight, z: balcony.z + balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY + wallHeight, z: balcony.z - balcony.depth/2}
      ],
      // Back wall
      [
        {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY + wallHeight, z: balcony.z + balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY + wallHeight, z: balcony.z + balcony.depth/2}
      ],
      // Left wall
      [
        {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY + wallHeight, z: balcony.z - balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY + wallHeight, z: balcony.z + balcony.depth/2}
      ]
    ];

    // Draw each wall
    for (var wallIdx = 0; wallIdx < wallCorners.length; wallIdx++) {
      var wall = wallCorners[wallIdx];
      var projectedWall = [];
      var wallVisible = true;
      
      for (var i = 0; i < wall.length; i++) {
        var p = project3D(wall[i].x, wall[i].y, wall[i].z);
        if (!p) {
          wallVisible = false;
          break;
        }
        projectedWall.push(p);
      }
      
      if (wallVisible) {
  ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.15)';
        ctx.beginPath();
        ctx.moveTo(projectedWall[0].x, projectedWall[0].y);
        for (var pIdx = 1; pIdx < projectedWall.length; pIdx++) {
          ctx.lineTo(projectedWall[pIdx].x, projectedWall[pIdx].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    
  var roofY = baseY + balcony.height;
    
    // Draw legs (start at floor up to roof)
    for (var legIdx = 0; legIdx < legPositions.length; legIdx++) {
      var legPos = legPositions[legIdx];
      var legHalf = legSize / 2;
      
      var legCorners = [
        {x: legPos.x - legHalf, y: baseY, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: baseY, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: baseY, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: baseY, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: roofY, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: roofY, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: roofY, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: roofY, z: legPos.z + legHalf}
      ];
      
      var projectedLeg = [];
      var allVisible = true;
      for (var j = 0; j < legCorners.length; j++) {
        var p2 = project3D(legCorners[j].x, legCorners[j].y, legCorners[j].z);
        if (!p2) {
          allVisible = false;
          break;
        }
        projectedLeg.push(p2);
      }
      
      if (allVisible) {
        var legEdges = [
          [0,1],[1,2],[2,3],[3,0],
          [4,5],[5,6],[6,7],[7,4],
          [0,4],[1,5],[2,6],[3,7]
        ];
        
        ctx.beginPath();
        for (var e = 0; e < legEdges.length; e++) {
          var edge = legEdges[e];
          ctx.moveTo(projectedLeg[edge[0]].x, projectedLeg[edge[0]].y);
          ctx.lineTo(projectedLeg[edge[1]].x, projectedLeg[edge[1]].y);
        }
        ctx.stroke();
      }
    }
    
    // Draw roof (match pergola style: shallow box + slats)
    var roofHeight = Math.max(0.18, Math.min(0.35, balcony.roofHeight || 0.25));
    var roofCorners = [
      {x: balcony.x - balcony.width/2, y: roofY, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: roofY, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: roofY, z: balcony.z + balcony.depth/2},
      {x: balcony.x - balcony.width/2, y: roofY, z: balcony.z + balcony.depth/2},
      {x: balcony.x - balcony.width/2, y: roofY + roofHeight, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: roofY + roofHeight, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: roofY + roofHeight, z: balcony.z + balcony.depth/2},
      {x: balcony.x - balcony.width/2, y: roofY + roofHeight, z: balcony.z + balcony.depth/2}
    ];
    var projectedRoof = []; var roofVisible = true;
    for (var r = 0; r < roofCorners.length; r++) { var p3 = project3D(roofCorners[r].x, roofCorners[r].y, roofCorners[r].z); if(!p3){ roofVisible=false; break; } projectedRoof.push(p3); }
    if (roofVisible) {
      var roofEdges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.15)';
      // Draw top and bottom faces
      ctx.beginPath(); ctx.moveTo(projectedRoof[4].x, projectedRoof[4].y); ctx.lineTo(projectedRoof[5].x, projectedRoof[5].y); ctx.lineTo(projectedRoof[6].x, projectedRoof[6].y); ctx.lineTo(projectedRoof[7].x, projectedRoof[7].y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(projectedRoof[0].x, projectedRoof[0].y); ctx.lineTo(projectedRoof[1].x, projectedRoof[1].y); ctx.lineTo(projectedRoof[2].x, projectedRoof[2].y); ctx.lineTo(projectedRoof[3].x, projectedRoof[3].y); ctx.closePath(); ctx.fill();
      // Edges
      ctx.beginPath(); for (var k=0;k<roofEdges.length;k++){ var e2=roofEdges[k]; ctx.moveTo(projectedRoof[e2[0]].x, projectedRoof[e2[0]].y); ctx.lineTo(projectedRoof[e2[1]].x, projectedRoof[e2[1]].y);} ctx.stroke();
      // Slats
      var slats = Math.max(0, Math.min(64, Math.floor(balcony.slatCount != null ? balcony.slatCount : 8)));
      var slatThickness = Math.max(0.04, Math.min(0.2, balcony.slatWidth || 0.12));
      if (slats > 0) {
        var slatSpacing = balcony.width / (slats + 1);
        for (var si = 0; si < slats; si++) {
          var slatX = balcony.x - balcony.width/2 + (si + 1) * slatSpacing;
          var sh = slatThickness;
          var sw = slatThickness/2;
          var sc = [
            {x: slatX - sw, y: roofY + roofHeight, z: balcony.z - balcony.depth/2},
            {x: slatX + sw, y: roofY + roofHeight, z: balcony.z - balcony.depth/2},
            {x: slatX + sw, y: roofY + roofHeight, z: balcony.z + balcony.depth/2},
            {x: slatX - sw, y: roofY + roofHeight, z: balcony.z + balcony.depth/2},
            {x: slatX - sw, y: roofY + roofHeight + sh, z: balcony.z - balcony.depth/2},
            {x: slatX + sw, y: roofY + roofHeight + sh, z: balcony.z - balcony.depth/2},
            {x: slatX + sw, y: roofY + roofHeight + sh, z: balcony.z + balcony.depth/2},
            {x: slatX - sw, y: roofY + roofHeight + sh, z: balcony.z + balcony.depth/2}
          ];
          var ps=[]; var ok2=true; for (var si2=0; si2<sc.length; si2++){ var pp=project3D(sc[si2].x,sc[si2].y,sc[si2].z); if(!pp){ ok2=false; break; } ps.push(pp); }
          if (ok2){
            ctx.strokeStyle = selected ? (onLevel ? '#007acc' : '#005080') : (onLevel ? '#D0D0D0' : '#808080');
            ctx.lineWidth = 1;
            ctx.fillStyle = selected ? 'rgba(0,85,128,0.3)' : 'rgba(192,192,192,0.5)';
            // top
            ctx.beginPath(); ctx.moveTo(ps[4].x,ps[4].y); ctx.lineTo(ps[5].x,ps[5].y); ctx.lineTo(ps[6].x,ps[6].y); ctx.lineTo(ps[7].x,ps[7].y); ctx.closePath(); ctx.fill();
            // edges
            var sedges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
            ctx.beginPath(); for (var se=0; se<sedges.length; se++){ var sE=sedges[se]; ctx.moveTo(ps[sE[0]].x,ps[sE[0]].y); ctx.lineTo(ps[sE[1]].x,ps[sE[1]].y);} ctx.stroke();
            ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth;
          }
        }
      }
    }
    
    // Always draw handles so all handles are draggable
    drawHandlesForBalcony(balcony);
    
  } catch (error) {
    console.error('Balcony draw error:', error);
  }
}

function drawHandlesForBalcony(balcony) {
  try {
    var objA = (typeof window.getObjectUiAlpha==='function') ? window.getObjectUiAlpha(balcony.id) : 1.0;
    var isActive = selectedRoomId === balcony.id;
    var handleY = balcony.level * 3.5 + (balcony.height||2.2) * 0.5;
    
    var balconyHandles = [
      {x: balcony.x + balcony.width/2, y: handleY, z: balcony.z, type: 'width+', label: 'X+'},
      {x: balcony.x - balcony.width/2, y: handleY, z: balcony.z, type: 'width-', label: 'X-'},
      {x: balcony.x, y: handleY, z: balcony.z + balcony.depth/2, type: 'depth+', label: 'Z+'},
      {x: balcony.x, y: handleY, z: balcony.z - balcony.depth/2, type: 'depth-', label: 'Z-'}
    ];
    var cScreen = project3D(balcony.x, handleY, balcony.z);
    
    for (var i = 0; i < balconyHandles.length; i++) {
      var handle = balconyHandles[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;
      if (cScreen) { var dx=cScreen.x-screen.x, dy=cScreen.y-screen.y; var L=Math.hypot(dx,dy)||1; screen.x += (dx/L)*20; screen.y += (dy/L)*20; }

  var r = (typeof computeHandleRadius==='function') ? computeHandleRadius(screen, HANDLE_RADIUS) : HANDLE_RADIUS;
  ctx.save(); var prevGA = ctx.globalAlpha; ctx.globalAlpha = prevGA * Math.max(0, Math.min(1, objA * (typeof window.__uiFadeAlpha==='number'? window.__uiFadeAlpha:1)));
  drawHandle(screen, handle.type, handle.label, isActive, r);
  ctx.restore();
      
      resizeHandles.push({
        screenX: screen.x - r,
        screenY: screen.y - r,
        width: r * 2,
        height: r * 2,
        type: handle.type,
        roomId: balcony.id
      });
    }
  } catch (error) {
    console.error('Balcony handle error:', error);
  }
}
