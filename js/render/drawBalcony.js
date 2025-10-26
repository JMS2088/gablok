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
    var strokeColor = selected ? '#007acc' : '#D0D0D0';
    var strokeWidth = selected ? 2 : 1.5;
    var opacity = currentFloor === 1 ? 1.0 : 0.6;
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var legSize = balcony.legWidth;
    var baseY = balcony.level * 3.5; // Floor level height
    var legPositions = [
      {x: balcony.x - balcony.width/2 + legSize/2, z: balcony.z - balcony.depth/2 + legSize/2},
      {x: balcony.x + balcony.width/2 - legSize/2, z: balcony.z - balcony.depth/2 + legSize/2},
      {x: balcony.x + balcony.width/2 - legSize/2, z: balcony.z + balcony.depth/2 - legSize/2},
      {x: balcony.x - balcony.width/2 + legSize/2, z: balcony.z + balcony.depth/2 - legSize/2}
    ];
    
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
    
    // Draw legs
    for (var legIdx = 0; legIdx < legPositions.length; legIdx++) {
      var legPos = legPositions[legIdx];
      var legHalf = legSize / 2;
      
      var legCorners = [
        {x: legPos.x - legHalf, y: baseY + wallHeight, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: baseY + wallHeight, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: baseY + wallHeight, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: baseY + wallHeight, z: legPos.z + legHalf},
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
    
    // Draw roof/floor
    var roofCorners = [
      {x: balcony.x - balcony.width/2, y: roofY, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: roofY, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: roofY, z: balcony.z + balcony.depth/2},
      {x: balcony.x - balcony.width/2, y: roofY, z: balcony.z + balcony.depth/2}
    ];
    
    var projectedRoof = [];
    var roofVisible = true;
    for (var r = 0; r < roofCorners.length; r++) {
      var p3 = project3D(roofCorners[r].x, roofCorners[r].y, roofCorners[r].z);
      if (!p3) {
        roofVisible = false;
        break;
      }
      projectedRoof.push(p3);
    }
    
    if (roofVisible) {
      ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.15)';
      ctx.beginPath();
      ctx.moveTo(projectedRoof[0].x, projectedRoof[0].y);
      ctx.lineTo(projectedRoof[1].x, projectedRoof[1].y);
      ctx.lineTo(projectedRoof[2].x, projectedRoof[2].y);
      ctx.lineTo(projectedRoof[3].x, projectedRoof[3].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    
    // Always draw handles so all handles are draggable
    drawHandlesForBalcony(balcony);
    
  } catch (error) {
    console.error('Balcony draw error:', error);
  }
}

function drawHandlesForBalcony(balcony) {
  try {
    var isActive = selectedRoomId === balcony.id;
    var handleY = balcony.level * 3.5 + balcony.height + 0.2;
    
    var balconyHandles = [
      {x: balcony.x + balcony.width/2, y: handleY, z: balcony.z, type: 'width+', label: 'X+'},
      {x: balcony.x - balcony.width/2, y: handleY, z: balcony.z, type: 'width-', label: 'X-'},
      {x: balcony.x, y: handleY, z: balcony.z + balcony.depth/2, type: 'depth+', label: 'Z+'},
      {x: balcony.x, y: handleY, z: balcony.z - balcony.depth/2, type: 'depth-', label: 'Z-'}
    ];
    
    for (var i = 0; i < balconyHandles.length; i++) {
      var handle = balconyHandles[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;

      var r = (typeof computeHandleRadius==='function') ? computeHandleRadius(screen, HANDLE_RADIUS) : HANDLE_RADIUS;
      drawHandle(screen, handle.type, handle.label, isActive, r);
      
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
