// Render: Furniture items as simple boxes with elevation
// Depends on: ctx, project3D, computeHandleRadius, selectedRoomId, currentFloor
(function(){
  if (typeof window.drawFurniture === 'function' && window.drawFurniture.__native) return;
  function drawFurniture(obj){
    try {
      if (!obj || !window.ctx || !window.canvas) return;
      var level = (obj.level||0);
      var onCurrent = (level === (window.currentFloor||0));
      var y0 = level * 3.5 + Math.max(0, obj.elevation || 0);
      var w = Math.max(0.1, obj.width || 0.7);
      var d = Math.max(0.1, obj.depth || 0.7);
      var h = Math.max(0.1, obj.height || 0.7);
      var rot = ((obj.rotation||0) * Math.PI) / 180;
      var cos = Math.cos(rot), sin = Math.sin(rot);

      function rotPoint(dx, dz){ return { x: obj.x + dx*cos - dz*sin, z: obj.z + dx*sin + dz*cos }; }

      var hx = w/2, hz = d/2;
      var corners = [
        rotPoint(-hx, -hz), rotPoint(hx, -hz), rotPoint(hx, hz), rotPoint(-hx, hz)
      ];
      var topY = y0 + h;
      // Project 8 corners
      var pts = [
        window.project3D(corners[0].x, y0, corners[0].z),
        window.project3D(corners[1].x, y0, corners[1].z),
        window.project3D(corners[2].x, y0, corners[2].z),
        window.project3D(corners[3].x, y0, corners[3].z),
        window.project3D(corners[0].x, topY, corners[0].z),
        window.project3D(corners[1].x, topY, corners[1].z),
        window.project3D(corners[2].x, topY, corners[2].z),
        window.project3D(corners[3].x, topY, corners[3].z)
      ];
      // Choose styles
      var selected = (window.selectedRoomId === obj.id);
      var stroke = selected ? '#0ea5e9' : (onCurrent ? '#475569' : '#94a3b8');
      var fill   = selected ? 'rgba(14,165,233,0.18)' : (onCurrent ? 'rgba(120,120,120,0.08)' : 'rgba(180,180,180,0.08)');
      var lw = selected ? 2.2 : 1.6;

      // Draw base fill if all base points are valid
      if (pts[0] && pts[1] && pts[2] && pts[3]){
        ctx.save();
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.lineTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // Draw edges
      var edges = [ [0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4], [0,4],[1,5],[2,6],[3,7] ];
      ctx.save(); ctx.lineWidth = lw; ctx.strokeStyle = stroke;
      for (var i=0;i<edges.length;i++){
        var e = edges[i]; var a = pts[e[0]], b = pts[e[1]]; if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();

      // Bed extras: pillows and sheet on the top face for kind==='bed'
      try {
        if (obj.kind === 'bed') {
          var top = topY;
          // Helper to project top rectangle by world coords
          function drawTopRect(x0,z0,x1,z1, fillCol, strokeCol, lw2){
            var p0 = window.project3D(x0, top, z0);
            var p1 = window.project3D(x1, top, z0);
            var p2 = window.project3D(x1, top, z1);
            var p3 = window.project3D(x0, top, z1);
            if (!p0||!p1||!p2||!p3) return;
            ctx.save(); if (fillCol){ ctx.fillStyle = fillCol; }
            ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.closePath(); if (fillCol) ctx.fill();
            if (strokeCol){ ctx.strokeStyle = strokeCol; ctx.lineWidth = lw2||1; ctx.stroke(); }
            ctx.restore();
          }
          // Local -> world for convenience (top plane)
          function worldAt(localX, localZ){ var p = rotPoint(localX, localZ); return { x: p.x, z: p.z }; }
          // Determine head side (-hz by convention)
          var headInset = Math.min(0.12, d*0.08);
          var pillowDepth = Math.min(0.30, d*0.20);
          var pillowGap = Math.min(0.06, w*0.06);
          var pillowW = Math.min(0.42, w*0.44);
          var halfGap = pillowGap/2;
          // Two pillows side-by-side if width allows; else single centered pillow
          if (w >= 1.2) {
            var leftCx = -pillowW/2 - halfGap;
            var rightCx = pillowW/2 + halfGap;
            var z0 = -hz + headInset; var z1 = z0 + pillowDepth;
            var L0 = worldAt(leftCx - pillowW/2, z0), L1 = worldAt(leftCx + pillowW/2, z0), L2 = worldAt(leftCx + pillowW/2, z1), L3 = worldAt(leftCx - pillowW/2, z1);
            drawTopRect(L0.x,L0.z,L1.x,L2.z, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
            var R0 = worldAt(rightCx - pillowW/2, z0), R1 = worldAt(rightCx + pillowW/2, z0), R2 = worldAt(rightCx + pillowW/2, z1), R3 = worldAt(rightCx - pillowW/2, z1);
            drawTopRect(R0.x,R0.z,R1.x,R2.z, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
          } else {
            var pw = Math.min(0.6, w*0.8); var pd = pillowDepth;
            var z0s = -hz + headInset; var z1s = z0s + pd;
            var S0 = worldAt(-pw/2, z0s), S1 = worldAt(pw/2, z0s), S2 = worldAt(pw/2, z1s);
            drawTopRect(S0.x,S0.z,S1.x,S2.z, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
          }
          // Sheet/duvet: from just past pillows to foot
          var sheetStart = -hz + headInset + pillowDepth + Math.min(0.06, d*0.04);
          var sheetEnd = hz - Math.min(0.08, d*0.06);
          var sheetMarginX = Math.min(0.06, w*0.06);
          var A = worldAt(-hx + sheetMarginX, sheetStart), B = worldAt(hx - sheetMarginX, sheetStart);
          var C = worldAt(hx - sheetMarginX, sheetEnd), D = worldAt(-hx + sheetMarginX, sheetEnd);
          drawTopRect(A.x,A.z,B.x,C.z, 'rgba(186, 210, 255, 0.22)', '#93c5fd', 0.8);
        }
      } catch(_bed){ /* non-fatal */ }
    } catch(e){ /* non-fatal */ }
  }
  drawFurniture.__native = true;
  window.drawFurniture = drawFurniture;
})();
