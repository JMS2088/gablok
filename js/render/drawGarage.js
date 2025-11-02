// Render: Garage and its resize/rotate handles
// Depends on globals: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor, drawHandle, dbg

function drawGarage(garage) {
  if (!garage) return;
  
  try {
    dbg('Drawing garage:', garage.id, 'Selected:', selectedRoomId);
  var selected = selectedRoomId === garage.id;
  var onLevel = currentFloor === (garage.level || 0);
  // Match room stroke colors and widths exactly across components
  // Colors:
  //  - current level: selected #007acc, unselected #D0D0D0
  //  - other level:  selected #005080, unselected #808080
  // Widths:
  //  - current level: selected 3, unselected 2
  //  - other level:  selected 2, unselected 1
  var strokeColor = selected ? (onLevel ? '#007acc' : '#005080') : (onLevel ? '#D0D0D0' : '#808080');
  var fillColor = selected ? 'rgba(0,122,204,0.3)' : 'rgba(208,208,208,0.2)';
  var strokeWidth = selected ? (onLevel ? 3 : 2) : (onLevel ? 2 : 1);
    var rotRad = ((garage.rotation || 0) * Math.PI) / 180; // Add rotation support
  var opacity = onLevel ? 1.0 : 0.6;
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var hw = garage.width / 2;
    var hd = garage.depth / 2;
    
    function rotatePoint(x, z) {
      var dx = x - garage.x;
      var dz = z - garage.z;
      return {
        x: garage.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        z: garage.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
    
    var unrotatedCorners = [
      {x: garage.x - hw, y: 0, z: garage.z - hd},
      {x: garage.x + hw, y: 0, z: garage.z - hd},
      {x: garage.x + hw, y: 0, z: garage.z + hd},
      {x: garage.x - hw, y: 0, z: garage.z + hd},
      {x: garage.x - hw, y: garage.height, z: garage.z - hd},
      {x: garage.x + hw, y: garage.height, z: garage.z - hd},
      {x: garage.x + hw, y: garage.height, z: garage.z + hd},
      {x: garage.x - hw, y: garage.height, z: garage.z + hd}
    ];
    
    var corners = unrotatedCorners.map(function(c) {
      var rotated = rotatePoint(c.x, c.z);
      return {x: rotated.x, y: c.y, z: rotated.z};
    });
    // Note: removed erroneous wall strip block referencing undefined variables that hid the garage

    var projected = [];
    for (var i = 0; i < corners.length; i++) {
      var p = project3D(corners[i].x, corners[i].y, corners[i].z);
      if (!p) return;
      projected.push(p);
    }
    
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
    
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    ctx.lineTo(projected[1].x, projected[1].y);
    ctx.lineTo(projected[2].x, projected[2].y);
    ctx.lineTo(projected[3].x, projected[3].y);
    ctx.closePath();
    ctx.fill();
    
    var doorWidth = garage.width;
    var doorHeight = garage.height * 0.9;
    var doorY = 0;
    
    // Compute door corners and rotate them with the garage
    var doorCorners = [
      {x: garage.x - doorWidth/2, y: doorY, z: garage.z - garage.depth/2},
      {x: garage.x + doorWidth/2, y: doorY, z: garage.z - garage.depth/2},
      {x: garage.x + doorWidth/2, y: doorY + doorHeight, z: garage.z - garage.depth/2},
      {x: garage.x - doorWidth/2, y: doorY + doorHeight, z: garage.z - garage.depth/2}
    ];
    
    var projectedDoor = [];
    var doorVisible = true;
    for (var i2 = 0; i2 < doorCorners.length; i2++) {
      var rp = rotatePoint(doorCorners[i2].x, doorCorners[i2].z);
      var p2 = project3D(rp.x, doorCorners[i2].y, rp.z);
      if (!p2) {
        doorVisible = false;
        break;
      }
      projectedDoor.push(p2);
    }
    
    if (doorVisible) {
      ctx.fillStyle = selected ? '#B8D4F0' : 'rgba(192,192,192,0.5)';
      ctx.beginPath();
      ctx.moveTo(projectedDoor[0].x, projectedDoor[0].y);
      ctx.lineTo(projectedDoor[1].x, projectedDoor[1].y);
      ctx.lineTo(projectedDoor[2].x, projectedDoor[2].y);
      ctx.lineTo(projectedDoor[3].x, projectedDoor[3].y);
      ctx.closePath();
      ctx.fill();
      
      ctx.strokeStyle = selected ? '#007acc' : '#A0A0A0';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      var slatCount = garage.doorSlatCount || 8;
      var slatHeight = doorHeight / slatCount;
      
      for (var slatIdx = 1; slatIdx < slatCount; slatIdx++) {
        var slatY = doorY + slatIdx * slatHeight;
        // Rotate slat endpoints along the door plane
        var leftRot = rotatePoint(garage.x - doorWidth/2, garage.z - garage.depth/2);
        var rightRot = rotatePoint(garage.x + doorWidth/2, garage.z - garage.depth/2);
        var slatLeft = project3D(leftRot.x, slatY, leftRot.z);
        var slatRight = project3D(rightRot.x, slatY, rightRot.z);
        
        if (slatLeft && slatRight) {
          ctx.strokeStyle = selected ? '#007acc' : '#D0D0D0';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(slatLeft.x, slatLeft.y);
          ctx.lineTo(slatRight.x, slatRight.y);
          ctx.stroke();
        }
      }
      
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
    }
    
    ctx.globalAlpha = 1.0;
    
    // Always draw handles so all handles are draggable
    drawHandlesForGarage(garage);
    
  } catch (error) {
    console.error('Garage draw error:', error);
  }
}

function drawHandlesForGarage(garage) {
  try {
    if (window.__useUnifiedHUDHandles) return; // unified HUD draws handles
    // Show handles only for the actively selected object
    if (!window.selectedRoomId || window.selectedRoomId !== garage.id) return;
    var objA = (typeof window.getObjectUiAlpha==='function') ? window.getObjectUiAlpha(garage.id) : 1.0;
    var isActive = selectedRoomId === garage.id;
    dbg('Drawing garage handles');
    // Set constants
    var REGULAR_HANDLE_RADIUS = HANDLE_RADIUS;
    var ROTATION_HANDLE_RADIUS = 14;
  var BASE_HANDLE_Y = (garage.height||2.6) * 0.5;
  var ROTATION_HANDLE_Y = (garage.height||2.6) * 0.5 + 0.6;
    
    var rotRad = ((garage.rotation || 0) * Math.PI) / 180;
    
    function rotateHandle(dx, dz) {
      return {
        x: garage.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        z: garage.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
    
    var hw = garage.width/2;
    var hd = garage.depth/2;
    
    // Create handles (rotation drawn underneath)
    var garageHandles = [];
    garageHandles.push({ x: garage.x, y: ROTATION_HANDLE_Y, z: garage.z, type: 'rotate', label: '360', radius: ROTATION_HANDLE_RADIUS });
    [
      {dx: hw, dz: 0, type: 'width+', label: 'X+'},
      {dx: -hw, dz: 0, type: 'width-', label: 'X-'},
      {dx: 0, dz: hd, type: 'depth+', label: 'Z+'},
      {dx: 0, dz: -hd, type: 'depth-', label: 'Z-'}
    ].forEach(function(data){ var p=rotateHandle(data.dx,data.dz); garageHandles.push({ x:p.x, y: BASE_HANDLE_Y, z:p.z, type:data.type, label:data.label, radius: REGULAR_HANDLE_RADIUS }); });
    
    // Draw each handle
    // Precompute center at handle height for inset
    var cScreen = project3D(garage.x, BASE_HANDLE_Y, garage.z);
    garageHandles.forEach(function(handle) {
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) return;
      if (handle.type !== 'rotate' && cScreen) { var dx=cScreen.x-screen.x, dy=cScreen.y-screen.y; var L=Math.hypot(dx,dy)||1; screen.x += (dx/L)*20; screen.y += (dy/L)*20; }

      var base = (typeof handle.radius==='number'? handle.radius : HANDLE_RADIUS);
      var r = (typeof computeHandleRadius==='function') ? computeHandleRadius(screen, base) : base;
      ctx.save(); var prevGA = ctx.globalAlpha; ctx.globalAlpha = prevGA * Math.max(0, Math.min(1, objA * (typeof window.__uiFadeAlpha==='number'? window.__uiFadeAlpha:1)));
      drawHandle(screen, handle.type, handle.label, isActive, r);
      ctx.restore();
      
      // Register handle for interaction
      resizeHandles.push({
        screenX: screen.x - r,
        screenY: screen.y - r,
        width: r * 2,
        height: r * 2,
        type: handle.type,
        roomId: garage.id
      });
      
      dbg('Registered handle:', handle.type, 'for garage:', garage.id);
    });
  } catch (error) {
    console.error('Garage handle error:', error);
  }
}
