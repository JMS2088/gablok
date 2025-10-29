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
    } catch(e){ /* non-fatal */ }
  }
  drawFurniture.__native = true;
  window.drawFurniture = drawFurniture;
})();
