// Render: Rooms and their resize handles
// Depends on globals from engine/app: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor

function drawRoom(room) {
  console.log('drawRoom called for room:', room);
  try {
    // Consider grouped rooms (L/U composites): if one member is selected, highlight all in the group
    var selected = false;
    try {
      if (selectedRoomId === room.id) {
        selected = true;
      } else if (room && room.groupId && Array.isArray(allRooms)) {
        for (var gi=0; gi<allRooms.length; gi++) {
          var rr = allRooms[gi];
          if (rr && rr.id === selectedRoomId && rr.groupId && rr.groupId === room.groupId) { selected = true; break; }
        }
      }
    } catch(_e) { selected = (selectedRoomId === room.id); }
    var currentLevel = room.level === currentFloor;
    var roomFloorY = room.level * 3.5;
    
    var hasFootprint = Array.isArray(room.footprint) && room.footprint.length >= 3;
    var projected = null;
    var corners = null;
    if (!hasFootprint) {
      var hw = room.width / 2;
      var hd = room.depth / 2;
      corners = [
        {x: room.x - hw, y: roomFloorY, z: room.z - hd},
        {x: room.x + hw, y: roomFloorY, z: room.z - hd},
        {x: room.x + hw, y: roomFloorY, z: room.z + hd},
        {x: room.x - hw, y: roomFloorY, z: room.z + hd},
        {x: room.x - hw, y: roomFloorY + room.height, z: room.z - hd},
        {x: room.x + hw, y: roomFloorY + room.height, z: room.z - hd},
        {x: room.x + hw, y: roomFloorY + room.height, z: room.z + hd},
        {x: room.x - hw, y: roomFloorY + room.height, z: room.z + hd}
      ];
      projected = new Array(corners.length);
      for (var i = 0; i < corners.length; i++) {
        projected[i] = project3D(corners[i].x, corners[i].y, corners[i].z) || null;
      }
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
    
    if (!hasFootprint) {
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
    } else {
      // Draw polygonal room: base (floor) fill, side outlines, and top outline
      var topY = roomFloorY + room.height;
      // Project base and top vertices
      var baseProj = [], topProj = [];
      for (var vi=0; vi<room.footprint.length; vi++){
        var p = room.footprint[vi];
        baseProj.push(project3D(p.x, roomFloorY, p.z));
        topProj.push(project3D(p.x, topY, p.z));
      }
      // Fill base (floor) polygon similar to rectangular rooms
      if (baseProj.every(Boolean)){
        if (currentLevel) {
          ctx.fillStyle = selected ? 'rgba(0,122,204,0.18)' : 'rgba(120,120,120,0.10)';
        } else if (selected && room.level !== currentFloor) {
          ctx.fillStyle = 'rgba(0,122,204,0.18)';
        } else {
          ctx.fillStyle = 'rgba(180,180,180,0.10)';
        }
        ctx.beginPath();
        ctx.moveTo(baseProj[0].x, baseProj[0].y);
        for (var bi=1; bi<baseProj.length; bi++) ctx.lineTo(baseProj[bi].x, baseProj[bi].y);
        ctx.closePath();
        ctx.fill();
        // Base outline
        ctx.beginPath();
        ctx.moveTo(baseProj[0].x, baseProj[0].y);
        for (var bo=1; bo<baseProj.length; bo++) ctx.lineTo(baseProj[bo].x, baseProj[bo].y);
        ctx.closePath();
        ctx.stroke();
      }
      // Top outline
      if (topProj.every(Boolean)){
        ctx.beginPath();
        ctx.moveTo(topProj[0].x, topProj[0].y);
        for (var oi=1; oi<topProj.length; oi++) ctx.lineTo(topProj[oi].x, topProj[oi].y);
        ctx.closePath();
        ctx.stroke();
      }
      // Draw side edges (vertical lines along footprint vertices)
      for (var si=0; si<room.footprint.length; si++){
        var pt = room.footprint[si];
        var a0 = project3D(pt.x, roomFloorY, pt.z);
        var a1 = project3D(pt.x, topY, pt.z);
        if (a0 && a1) { ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke(); }
      }
    }
    
    if (!hasFootprint) {
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
    }

    try { if (typeof drawHandlesForRoom === 'function') drawHandlesForRoom(room); } catch(e) {}

    // Draw openings (doors/windows) with full rectangular outline at correct sill/height
    try {
      if (Array.isArray(room.openings) && room.openings.length) {
        var hw2 = room.width / 2; var hd2 = room.depth / 2;
        var yBase = roomFloorY; // floor level
        for (var oi=0; oi<room.openings.length; oi++){
          var op = room.openings[oi]; if(!op) continue;
          // Determine base and top Y positions using sill/height
          var sill = (op.type==='window') ? ((typeof op.sillM==='number') ? op.sillM : 1.0) : 0;
          var oH = (typeof op.heightM==='number') ? op.heightM : ((op.type==='door') ? 2.04 : 1.5);
          var y0 = yBase + sill;
          var y1 = y0 + oH;
          // Build rectangle corners (world space) along the specified edge or by world endpoints
          var pA=null,pB=null,pC=null,pD=null; // A->B bottom edge, B->C right jamb, C->D top edge, D->A left jamb
          if (typeof op.x0 === 'number' && typeof op.z0 === 'number' && typeof op.x1 === 'number' && typeof op.z1 === 'number') {
            // Opening defined by world endpoints (for polygon rooms)
            var x0w = op.x0, z0w = op.z0, x1w = op.x1, z1w = op.z1;
            // Assume orthogonal segment (2D editor ensures walls are axis-aligned)
            pA = {x:x0w, y:y0, z:z0w}; pB = {x:x1w, y:y0, z:z1w}; pC = {x:x1w, y:y1, z:z1w}; pD = {x:x0w, y:y1, z:z0w};
          } else {
            var edge = op.edge; var sM = +op.startM || 0; var eM = +op.endM || 0;
            if (eM <= sM + 1e-6) continue;
            if (edge === 'minZ') { // top edge (north): vary x at z = zMin
              var zE = room.z - hd2; var x0 = room.x - hw2 + sM; var x1 = room.x - hw2 + eM;
              pA = {x:x0,y:y0,z:zE}; pB = {x:x1,y:y0,z:zE}; pC = {x:x1,y:y1,z:zE}; pD = {x:x0,y:y1,z:zE};
            } else if (edge === 'maxZ') { // bottom edge (south)
              var zE2 = room.z + hd2; var x02 = room.x - hw2 + sM; var x12 = room.x - hw2 + eM;
              pA = {x:x02,y:y0,z:zE2}; pB = {x:x12,y:y0,z:zE2}; pC = {x:x12,y:y1,z:zE2}; pD = {x:x02,y:y1,z:zE2};
            } else if (edge === 'minX') { // left edge (west)
              var xE = room.x - hw2; var z0 = room.z - hd2 + sM; var z1 = room.z - hd2 + eM;
              pA = {x:xE,y:y0,z:z0}; pB = {x:xE,y:y0,z:z1}; pC = {x:xE,y:y1,z:z1}; pD = {x:xE,y:y1,z:z0};
            } else if (edge === 'maxX') { // right edge (east)
              var xE2 = room.x + hw2; var z02 = room.z - hd2 + sM; var z12 = room.z - hd2 + eM;
              pA = {x:xE2,y:y0,z:z02}; pB = {x:xE2,y:y0,z:z12}; pC = {x:xE2,y:y1,z:z12}; pD = {x:xE2,y:y1,z:z02};
            }
          }
          // Project and draw rectangle outline
          if (pA && pB && pC && pD) {
            var sA = project3D(pA.x,pA.y,pA.z);
            var sB = project3D(pB.x,pB.y,pB.z);
            var sC = project3D(pC.x,pC.y,pC.z);
            var sD = project3D(pD.x,pD.y,pD.z);
            if (sA && sB && sC && sD) {
              ctx.save();
              var col = (op.type === 'door') ? '#22c55e' : '#38bdf8';
              ctx.strokeStyle = currentLevel ? col : 'rgba(148,163,184,0.8)';
              ctx.lineWidth = currentLevel ? 3 : 1.8;
              ctx.beginPath();
              ctx.moveTo(sA.x, sA.y); ctx.lineTo(sB.x, sB.y);
              ctx.lineTo(sC.x, sC.y); ctx.lineTo(sD.x, sD.y);
              ctx.closePath();
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }
    } catch(e) { /* non-fatal openings overlay */ }
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
