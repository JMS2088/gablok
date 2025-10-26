// Render: Rooms and their resize handles
// Depends on globals from engine/app: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor

function drawRoom(room) {
  console.log('drawRoom called for room:', room);
  try {
    var selected = selectedRoomId === room.id;
    var currentLevel = room.level === currentFloor;
    var roomFloorY = room.level * 3.5;
    
    var hw = room.width / 2;
    var hd = room.depth / 2;
    
    var corners = [
      {x: room.x - hw, y: roomFloorY, z: room.z - hd},
      {x: room.x + hw, y: roomFloorY, z: room.z - hd},
      {x: room.x + hw, y: roomFloorY, z: room.z + hd},
      {x: room.x - hw, y: roomFloorY, z: room.z + hd},
      {x: room.x - hw, y: roomFloorY + room.height, z: room.z - hd},
      {x: room.x + hw, y: roomFloorY + room.height, z: room.z - hd},
      {x: room.x + hw, y: roomFloorY + room.height, z: room.z + hd},
      {x: room.x - hw, y: roomFloorY + room.height, z: room.z + hd}
    ];
    
    var projected = new Array(corners.length);
    for (var i = 0; i < corners.length; i++) {
      projected[i] = project3D(corners[i].x, corners[i].y, corners[i].z) || null;
    }
    
    if (currentLevel) {
      ctx.strokeStyle = selected ? '#007acc' : '#4b5563';
      ctx.lineWidth = selected ? 3 : 2.25;
      ctx.globalAlpha = 1.0;
    } else {
      ctx.strokeStyle = selected ? '#005080' : '#9ca3af';
      ctx.lineWidth = selected ? 2.25 : 1.25;
      ctx.globalAlpha = 0.7;
    }
    
    var edges = [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7]
    ];
    
    ctx.beginPath();
    for (var eIdx = 0; eIdx < edges.length; eIdx++) {
      var e = edges[eIdx];
      var a = projected[e[0]];
      var b = projected[e[1]];
      if (!a || !b) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    
    var p0=projected[0], p1=projected[1], p2=projected[2], p3=projected[3];
    if (p0 && p1 && p2 && p3) {
      if (currentLevel) {
        ctx.fillStyle = selected ? 'rgba(0,122,204,0.18)' : 'rgba(120,120,120,0.10)';
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
      } else if (selected && room.level !== currentFloor) {
        ctx.fillStyle = 'rgba(0,122,204,0.18)';
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    try { if (typeof drawHandlesForRoom === 'function') drawHandlesForRoom(room); } catch(e) {}
  } catch (e) {}
}

// Resize handles for rooms (X and Z directions).
function drawHandlesForRoom(room) {
  try {
    if (!room) return;
    var objA = (typeof window.getObjectUiAlpha==='function') ? window.getObjectUiAlpha(room.id) : 1.0;
    var isActive = selectedRoomId === room.id;
    var levelY = (room.level || 0) * 3.5;
    var handleY = levelY + (room.height || 3) * 0.5; // mid-height of object
    var rot = ((room.rotation || 0) * Math.PI) / 180;
    var cos = Math.cos(rot), sin = Math.sin(rot);
    var hw = (room.width || 1) / 2;
    var hd = (room.depth || 1) / 2;

    function rotPoint(dx, dz) {
      return {
        x: room.x + dx * cos - dz * sin,
        z: room.z + dx * sin + dz * cos
      };
    }

    var handles = [
      (function(){ var p=rotPoint(hw, 0); return {x:p.x, y:handleY, z:p.z, type:'width+', label:'X+'}; })(),
      (function(){ var p=rotPoint(-hw, 0); return {x:p.x, y:handleY, z:p.z, type:'width-', label:'X-'}; })(),
      (function(){ var p=rotPoint(0, hd); return {x:p.x, y:handleY, z:p.z, type:'depth+', label:'Z+'}; })(),
      (function(){ var p=rotPoint(0, -hd); return {x:p.x, y:handleY, z:p.z, type:'depth-', label:'Z-'}; })()
    ];

    // Project center for 20px inset calculation
    var cScreen = project3D(room.x, handleY, room.z);

    for (var i = 0; i < handles.length; i++) {
      var h = handles[i];
      var s = project3D(h.x, h.y, h.z);
      if (!s) continue;
      // Inset 20px toward center in screen space
      if (cScreen) {
        var dx = (cScreen.x - s.x), dy = (cScreen.y - s.y); var L = Math.hypot(dx,dy)||1; var ux = dx/L, uy = dy/L; s.x += ux*20; s.y += uy*20;
      }
  var r = (typeof computeHandleRadius==='function') ? computeHandleRadius(s, HANDLE_RADIUS) : HANDLE_RADIUS;
  // Apply per-object alpha to handle drawing
  ctx.save(); var prevGA = ctx.globalAlpha; ctx.globalAlpha = prevGA * Math.max(0, Math.min(1, objA * (typeof window.__uiFadeAlpha==='number'? window.__uiFadeAlpha:1)));
      drawHandle(s, h.type, h.label, isActive, r);
  ctx.restore();
      resizeHandles.push({
        screenX: s.x - r,
        screenY: s.y - r,
        width: r * 2,
        height: r * 2,
        type: h.type,
        roomId: room.id
      });
    }
  } catch(e) { console.warn('drawHandlesForRoom failed', e); }
}
