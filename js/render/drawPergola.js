// Render: Pergola and its resize handles
// Depends on globals: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor, drawHandle

function drawHandlesForPergola(pergola) {
  try {
    if (window.__useUnifiedHUDHandles) return; // unified HUD draws handles
    // Show handles only for the actively selected object
    if (!window.selectedRoomId || window.selectedRoomId !== pergola.id) return;
    var objA = (typeof window.getObjectUiAlpha==='function') ? window.getObjectUiAlpha(pergola.id) : 1.0;
    var isActive = selectedRoomId === pergola.id;
    var handleY = (pergola.totalHeight!=null ? pergola.totalHeight : (pergola.height||2.2)) * 0.5;
    var handleData = [
      {x: pergola.x + pergola.width/2, y: handleY, z: pergola.z, type: 'width+', label: 'X+'},
      {x: pergola.x - pergola.width/2, y: handleY, z: pergola.z, type: 'width-', label: 'X-'},
      {x: pergola.x, y: handleY, z: pergola.z + pergola.depth/2, type: 'depth+', label: 'Z+'},
      {x: pergola.x, y: handleY, z: pergola.z - pergola.depth/2, type: 'depth-', label: 'Z-'}
    ];
    var cScreen = project3D(pergola.x, handleY, pergola.z);

    for (var i = 0; i < handleData.length; i++) {
      var handle = handleData[i];
  var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;
  if (cScreen) { var dx=cScreen.x-screen.x, dy=cScreen.y-screen.y; var L=Math.hypot(dx,dy)||1; screen.x += (dx/L)*20; screen.y += (dy/L)*20; }

  var r = (typeof computeHandleRadius==='function') ? computeHandleRadius(screen, HANDLE_RADIUS) : HANDLE_RADIUS;
  // Apply per-object and global UI fade alpha to handle drawing
  ctx.save(); var prevGA = ctx.globalAlpha; ctx.globalAlpha = prevGA * Math.max(0, Math.min(1, objA * (typeof window.__uiFadeAlpha==='number'? window.__uiFadeAlpha:1)));
  drawHandle(screen, handle.type, handle.label, isActive, r);
  ctx.restore();

      resizeHandles.push({
        screenX: screen.x - r,
        screenY: screen.y - r,
        width: r * 2,
        height: r * 2,
        type: handle.type,
        roomId: pergola.id
      });
    }
  } catch (e) {}
}

function drawPergola(pergola) {
  if (!pergola) return;
  
  try {
  var selected = selectedRoomId === pergola.id;
  var onLevel = currentFloor === (pergola.level || 0);
  // Match room stroke colors and widths across components
  var strokeColor = selected ? (onLevel ? '#007acc' : '#005080') : (onLevel ? '#D0D0D0' : '#808080');
  var strokeWidth = selected ? (onLevel ? 3 : 2) : (onLevel ? 2 : 1);
  var opacity = onLevel ? 1.0 : 0.6;
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var legSize = pergola.legWidth;
    var legPositions = [
      {x: pergola.x - pergola.width/2 + legSize/2, z: pergola.z - pergola.depth/2 + legSize/2},
      {x: pergola.x + pergola.width/2 - legSize/2, z: pergola.z - pergola.depth/2 + legSize/2},
      {x: pergola.x + pergola.width/2 - legSize/2, z: pergola.z + pergola.depth/2 - legSize/2},
      {x: pergola.x - pergola.width/2 + legSize/2, z: pergola.z + pergola.depth/2 - legSize/2}
    ];
    
    var roofHeight = 0.25;
    var roofY = pergola.height;
    
    for (var legIdx = 0; legIdx < legPositions.length; legIdx++) {
      var legPos = legPositions[legIdx];
      var legHalf = legSize / 2;
      
      var legCorners = [
        {x: legPos.x - legHalf, y: 0, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: 0, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: 0, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: 0, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: roofY + roofHeight, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: roofY + roofHeight, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: roofY + roofHeight, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: roofY + roofHeight, z: legPos.z + legHalf}
      ];
      
      var projectedLeg = [];
      var allVisible = true;
      for (var i2 = 0; i2 < legCorners.length; i2++) {
        var p = project3D(legCorners[i2].x, legCorners[i2].y, legCorners[i2].z);
        if (!p) {
          allVisible = false;
          break;
        }
        projectedLeg.push(p);
      }
      
      if (allVisible) {
        var legEdges = [
          [0,1],[1,2],[2,3],[3,0],
          [4,5],[5,6],[6,7],[7,4],
          [0,4],[1,5],[2,6],[3,7]
        ];
        
        ctx.beginPath();
        for (var j = 0; j < legEdges.length; j++) {
          var edge = legEdges[j];
          ctx.moveTo(projectedLeg[edge[0]].x, projectedLeg[edge[0]].y);
          ctx.lineTo(projectedLeg[edge[1]].x, projectedLeg[edge[1]].y);
        }
        ctx.stroke();
      }
    }
    
    var roofCorners = [
      {x: pergola.x - pergola.width/2, y: roofY, z: pergola.z - pergola.depth/2},
      {x: pergola.x + pergola.width/2, y: roofY, z: pergola.z - pergola.depth/2},
      {x: pergola.x + pergola.width/2, y: roofY, z: pergola.z + pergola.depth/2},
      {x: pergola.x - pergola.width/2, y: roofY, z: pergola.z + pergola.depth/2},
      {x: pergola.x - pergola.width/2, y: roofY + roofHeight, z: pergola.z - pergola.depth/2},
      {x: pergola.x + pergola.width/2, y: roofY + roofHeight, z: pergola.z - pergola.depth/2},
      {x: pergola.x + pergola.width/2, y: roofY + roofHeight, z: pergola.z + pergola.depth/2},
      {x: pergola.x - pergola.width/2, y: roofY + roofHeight, z: pergola.z + pergola.depth/2}
    ];
    
    var projectedRoof = [];
    var roofVisible = true;
    for (var i3 = 0; i3 < roofCorners.length; i3++) {
      var p2 = project3D(roofCorners[i3].x, roofCorners[i3].y, roofCorners[i3].z);
      if (!p2) {
        roofVisible = false;
        break;
      }
      projectedRoof.push(p2);
    }
    
    if (roofVisible) {
      var roofEdges = [
        [0,1],[1,2],[2,3],[3,0],
        [4,5],[5,6],[6,7],[7,4],
        [0,4],[1,5],[2,6],[3,7]
      ];
      
      ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.15)';
      
      ctx.beginPath();
      ctx.moveTo(projectedRoof[4].x, projectedRoof[4].y);
      ctx.lineTo(projectedRoof[5].x, projectedRoof[5].y);
      ctx.lineTo(projectedRoof[6].x, projectedRoof[6].y);
      ctx.lineTo(projectedRoof[7].x, projectedRoof[7].y);
      ctx.closePath();
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(projectedRoof[0].x, projectedRoof[0].y);
      ctx.lineTo(projectedRoof[1].x, projectedRoof[1].y);
      ctx.lineTo(projectedRoof[2].x, projectedRoof[2].y);
      ctx.lineTo(projectedRoof[3].x, projectedRoof[3].y);
      ctx.closePath();
      ctx.fill();
      
      ctx.beginPath();
      for (var k = 0; k < roofEdges.length; k++) {
        var edge2 = roofEdges[k];
        ctx.moveTo(projectedRoof[edge2[0]].x, projectedRoof[edge2[0]].y);
        ctx.lineTo(projectedRoof[edge2[1]].x, projectedRoof[edge2[1]].y);
      }
      ctx.stroke();
      
      var slatSpacing = pergola.width / (pergola.slatCount + 1);
      var slatThickness = 0.08;
      
      for (var slatIdx = 0; slatIdx < pergola.slatCount; slatIdx++) {
        var slatX = pergola.x - pergola.width/2 + (slatIdx + 1) * slatSpacing;
        var slatHalf = slatThickness / 2;
        
        var slatCorners = [
          {x: slatX - slatHalf, y: roofY + roofHeight, z: pergola.z - pergola.depth/2},
          {x: slatX + slatHalf, y: roofY + roofHeight, z: pergola.z - pergola.depth/2},
          {x: slatX + slatHalf, y: roofY + roofHeight, z: pergola.z + pergola.depth/2},
          {x: slatX - slatHalf, y: roofY + roofHeight, z: pergola.z + pergola.depth/2},
          {x: slatX - slatHalf, y: roofY + roofHeight + slatThickness, z: pergola.z - pergola.depth/2},
          {x: slatX + slatHalf, y: roofY + roofHeight + slatThickness, z: pergola.z - pergola.depth/2},
          {x: slatX + slatHalf, y: roofY + roofHeight + slatThickness, z: pergola.z + pergola.depth/2},
          {x: slatX - slatHalf, y: roofY + roofHeight + slatThickness, z: pergola.z + pergola.depth/2}
        ];
        
        var projectedSlat = [];
        var slatValid = true;
        for (var s = 0; s < slatCorners.length; s++) {
          var p3 = project3D(slatCorners[s].x, slatCorners[s].y, slatCorners[s].z);
          if (!p3) {
            slatValid = false;
            break;
          }
          projectedSlat.push(p3);
        }
        
        if (slatValid) {
          var slatEdges = [
            [0,1],[1,2],[2,3],[3,0],
            [4,5],[5,6],[6,7],[7,4],
            [0,4],[1,5],[2,6],[3,7]
          ];
          
          ctx.strokeStyle = selected ? (onLevel ? '#007acc' : '#005080') : (onLevel ? '#D0D0D0' : '#808080');
          ctx.lineWidth = 1;
          ctx.fillStyle = selected ? 'rgba(0,85,128,0.3)' : 'rgba(192,192,192,0.5)';
          
          ctx.beginPath();
          ctx.moveTo(projectedSlat[4].x, projectedSlat[4].y);
          ctx.lineTo(projectedSlat[5].x, projectedSlat[5].y);
          ctx.lineTo(projectedSlat[6].x, projectedSlat[6].y);
          ctx.lineTo(projectedSlat[7].x, projectedSlat[7].y);
          ctx.closePath();
          ctx.fill();
          
          ctx.beginPath();
          for (var t = 0; t < slatEdges.length; t++) {
            var edge3 = slatEdges[t];
            ctx.moveTo(projectedSlat[edge3[0]].x, projectedSlat[edge3[0]].y);
            ctx.lineTo(projectedSlat[edge3[1]].x, projectedSlat[edge3[1]].y);
          }
          ctx.stroke();
          
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
        }
      }
    }
    
    ctx.globalAlpha = 1.0;
    
    // Always draw handles so all handles are draggable
    drawHandlesForPergola(pergola);
    
  } catch (error) {
    console.error('Pergola draw error:', error);
  }
}
