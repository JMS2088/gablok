// 2D Geometry mapping helpers for Plan2D
// Screen mapping: X right = +X (world), Y up = +Y in plan space. World Z maps to plan Y with a configurable sign.
(function(){
  if (typeof window.worldToScreen2D !== 'function') {
    window.worldToScreen2D = function worldToScreen2D(wx, wy){
      try {
        var c = document.getElementById('plan2d-canvas'); if(!c) return {x:0,y:0};
        var s = __plan2d.scale || 50;
        var ox = c.width/2 + ((__plan2d.panX||0) * s);
        var oy = c.height/2 - ((__plan2d.panY||0) * s);
        return { x: ox + wx*s, y: oy - wy*s };
      } catch(e){ return {x:0,y:0}; }
    };
  }
  if (typeof window.screenToWorld2D !== 'function') {
    window.screenToWorld2D = function screenToWorld2D(px, py){
      try {
        var c = document.getElementById('plan2d-canvas'); if(!c) return {x:0,y:0};
        var s = __plan2d.scale || 50;
        var ox = c.width/2 + ((__plan2d.panX||0) * s);
        var oy = c.height/2 - ((__plan2d.panY||0) * s);
        return { x: (px - ox)/s, y: (oy - py)/s };
      } catch(e){ return {x:0,y:0}; }
    };
  }
})();
