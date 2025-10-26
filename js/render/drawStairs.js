// Render: Stairs and their resize/rotate handles
// Depends on globals from engine/app: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor, drawHandle

function drawStairs(stairs) {
  if (!stairs) return;
  
  try {
    var selected = selectedRoomId === stairs.id;
    var stepsCount = Math.max(1, Math.floor(stairs.steps || 19));
    var stepHeight = stairs.height / stepsCount;
    // Weighted per-step depths so the 10th step (index 9) is 5x deeper to create a landing
    var totalDepth3D = stairs.depth;
    var stepWeights = new Array(stepsCount);
    for (var wi3=0; wi3<stepsCount; wi3++) stepWeights[wi3] = (wi3 === 9 ? 5 : 1);
    var sumW3 = 0; for (var sw3=0; sw3<stepsCount; sw3++) sumW3 += stepWeights[sw3];
    // Build per-step depths and cumulative Z positions from front (-depth/2) to back (+depth/2)
    var perStepDepth = new Array(stepsCount);
    for (var ps=0; ps<stepsCount; ps++) {
      perStepDepth[ps] = (sumW3 > 0 ? (totalDepth3D * stepWeights[ps] / sumW3) : (totalDepth3D / stepsCount));
    }
    
    // Show fully on its own floor, dim on others (mirror rooms)
    var onLevel = currentFloor === (stairs.level || 0);
    var opacity = onLevel ? 1.0 : 0.6;
    // Match room stroke colors exactly
    // Rooms:
    //  - current level: selected #007acc, unselected #D0D0D0
    //  - other level:  selected #005080, unselected #808080
    var strokeColor = selected
      ? (onLevel ? '#007acc' : '#005080')
      : (onLevel ? '#D0D0D0' : '#808080');
    // Match room line widths exactly
    //  - current level: selected 3, unselected 2
    //  - other level:  selected 2, unselected 1
    var strokeWidth = selected
      ? (onLevel ? 3 : 2)
      : (onLevel ? 2 : 1);
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var rotRad = ((stairs.rotation || 0) * Math.PI) / 180;
    var zCursor = stairs.z - stairs.depth/2; // start at front edge
    for (var step = 0; step < stepsCount; step++) {
      var stepY = step * stepHeight;
      var sd = perStepDepth[step];
      var stepZ = zCursor;
      // Apply rotation around stairs center
      var corners = [
        {x: stairs.x - stairs.width/2, z: stepZ},
        {x: stairs.x + stairs.width/2, z: stepZ},
        {x: stairs.x + stairs.width/2, z: stepZ + sd},
        {x: stairs.x - stairs.width/2, z: stepZ + sd},
        {x: stairs.x - stairs.width/2, z: stepZ},
        {x: stairs.x + stairs.width/2, z: stepZ},
        {x: stairs.x + stairs.width/2, z: stepZ + sd},
        {x: stairs.x - stairs.width/2, z: stepZ + sd}
      ];
      var rotatedCorners = [];
      for (var i = 0; i < corners.length; i++) {
        var dx = corners[i].x - stairs.x;
        var dz = corners[i].z - stairs.z;
        var rx = stairs.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad);
        var rz = stairs.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad);
        var y = stepY + (i >= 4 ? stepHeight : 0);
        rotatedCorners.push({x: rx, y: y, z: rz});
      }
      var projected = [];
      var allVisible = true;
      for (var i2 = 0; i2 < rotatedCorners.length; i2++) {
        var p = project3D(rotatedCorners[i2].x, rotatedCorners[i2].y, rotatedCorners[i2].z);
        if (!p) {
          allVisible = false;
          break;
        }
        projected.push(p);
      }
      
      if (!allVisible) continue;
      
      var edges = [
        [0,1],[1,2],[2,3],[3,0],
        [4,5],[5,6],[6,7],[7,4],
        [0,4],[1,5],[2,6],[3,7]
      ];
      
      ctx.beginPath();
      for (var e = 0; e < edges.length; e++) {
        var edge = edges[e];
        ctx.moveTo(projected[edge[0]].x, projected[edge[0]].y);
        ctx.lineTo(projected[edge[1]].x, projected[edge[1]].y);
      }
      ctx.stroke();
      
      // Keep fill subtle; rooms use 0.15 / 0.1 on current level; we retain a slightly visible fill
      ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.2)';
      ctx.beginPath();
      ctx.moveTo(projected[4].x, projected[4].y);
      ctx.lineTo(projected[5].x, projected[5].y);
      ctx.lineTo(projected[6].x, projected[6].y);
      ctx.lineTo(projected[7].x, projected[7].y);
      ctx.closePath();
      ctx.fill();

      // advance to next step start position
      zCursor += sd;
    }
    
    ctx.globalAlpha = 1.0;
    
    // Always draw handles so all handles are draggable
    drawHandlesForStairs(stairs);
    
  } catch (error) {
    console.error('Stairs draw error:', error);
  }
}

function drawHandlesForStairs(stairs) {
  try {
    var isActive = selectedRoomId === stairs.id;
    var handleY = stairs.height + 0.2;
    
    var rotRad = ((stairs.rotation || 0) * Math.PI) / 180;
    function rotateHandle(dx, dz) {
      return {
        x: stairs.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        z: stairs.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
    var stairHandles = [
      // X+ (width+)
      (function() { var p = rotateHandle(stairs.width/2, 0); return {x: p.x, y: handleY, z: p.z, type: 'width+', label: 'X+'}; })(),
      // X- (width-)
      (function() { var p = rotateHandle(-stairs.width/2, 0); return {x: p.x, y: handleY, z: p.z, type: 'width-', label: 'X-'}; })(),
      // Z+ (depth+)
      (function() { var p = rotateHandle(0, stairs.depth/2); return {x: p.x, y: handleY, z: p.z, type: 'depth+', label: 'Z+'}; })(),
      // Z- (depth-)
      (function() { var p = rotateHandle(0, -stairs.depth/2); return {x:p.x, y:handleY, z:p.z, type: 'depth-', label: 'Z-'}; })(),
      // 360 handle remains centered
      {x: stairs.x, y: handleY + 0.3, z: stairs.z, type: 'rotate', label: '360'}
    ];
    
    for (var i = 0; i < stairHandles.length; i++) {
      var handle = stairHandles[i];
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
        roomId: stairs.id
      });
    }
  } catch (error) {
    console.error('Stairs handle error:', error);
  }
}
