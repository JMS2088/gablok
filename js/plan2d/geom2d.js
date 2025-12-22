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

  // Compute world-space bounds of current 2D content.
  // Returns {minX,minY,maxX,maxY} or null.
  if (typeof window.plan2dComputeBounds !== 'function') {
    window.plan2dComputeBounds = function plan2dComputeBounds(){
      try {
        if (!window.__plan2d || !Array.isArray(__plan2d.elements) || __plan2d.elements.length === 0) return null;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        function addPt(x, y){
          if (!isFinite(x) || !isFinite(y)) return;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        for (var i=0; i<__plan2d.elements.length; i++){
          var e = __plan2d.elements[i];
          if (!e) continue;
          if (e.type === 'wall'){
            addPt(e.x0, e.y0);
            addPt(e.x1, e.y1);
            continue;
          }
          // Hosted openings: compute endpoints from host wall.
          if ((e.type === 'window' || e.type === 'door') && typeof e.host === 'number'){
            var host = __plan2d.elements[e.host];
            if (host && host.type === 'wall'){
              var t0 = Math.max(0, Math.min(1, e.t0 || 0));
              var t1 = Math.max(0, Math.min(1, e.t1 || 0));
              if (t1 < t0){ var tmp = t0; t0 = t1; t1 = tmp; }
              var ax = host.x0 + (host.x1 - host.x0) * t0;
              var ay = host.y0 + (host.y1 - host.y0) * t0;
              var bx = host.x0 + (host.x1 - host.x0) * t1;
              var by = host.y0 + (host.y1 - host.y0) * t1;
              addPt(ax, ay);
              addPt(bx, by);
              continue;
            }
          }
          // Free openings or unknown types with x0/y0/x1/y1.
          if (typeof e.x0 === 'number' && typeof e.y0 === 'number') addPt(e.x0, e.y0);
          if (typeof e.x1 === 'number' && typeof e.y1 === 'number') addPt(e.x1, e.y1);
        }
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
        if (maxX - minX < 1e-9 || maxY - minY < 1e-9) return null;
        return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
      } catch(e){
        return null;
      }
    };
  }

  // Fit the current plan content into the canvas.
  if (typeof window.plan2dFitViewToContent !== 'function') {
    window.plan2dFitViewToContent = function plan2dFitViewToContent(paddingPx, opts){
      try {
        if (!window.__plan2d || !__plan2d.active) return false;
        var c = document.getElementById('plan2d-canvas');
        if (!c) return false;
        var b = (typeof window.plan2dComputeBounds === 'function') ? window.plan2dComputeBounds() : null;
        if (!b) return false;

        var pad = (typeof paddingPx === 'number' && isFinite(paddingPx)) ? paddingPx : 40;
        var w = Math.max(1, c.width || 1);
        var h = Math.max(1, c.height || 1);

        var contentW = Math.max(1e-6, (b.maxX - b.minX));
        var contentH = Math.max(1e-6, (b.maxY - b.minY));

        var availW = Math.max(10, w - pad * 2);
        var availH = Math.max(10, h - pad * 2);

        var s = Math.min(availW / contentW, availH / contentH);
        // Clamp scale to keep UI stable
        var minS = 10, maxS = 800;
        if (!isFinite(s) || s <= 0) return false;
        s = Math.max(minS, Math.min(maxS, s));

        var cx = (b.minX + b.maxX) / 2;
        var cy = (b.minY + b.maxY) / 2;
        __plan2d.scale = s;
        __plan2d.panX = -cx;
        __plan2d.panY = -cy;

        try{ var scl=document.getElementById('plan2d-scale'); if(scl) scl.textContent='1:'+Math.round(100*(100/(__plan2d.scale||100)))/100; }catch(_s){}
        try{ if (typeof window.plan2dDraw === 'function') window.plan2dDraw(); }catch(_d){}
        return true;
      } catch(e){
        return false;
      }
    };
  }
})();
