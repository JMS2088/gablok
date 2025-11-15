// Plan2D snapping helpers: grid + guide aware
(function(){
  if (typeof window.plan2dSnap !== 'function') window.plan2dSnap = function plan2dSnap(v){ var step = (__plan2d.gridStep || 0.1); return Math.round(v/step)*step; };
  if (typeof window.plan2dSnapX !== 'function') window.plan2dSnapX = function plan2dSnapX(v){
    try { var s = __plan2d.scale || 1; var tolM = 8 / Math.max(1e-6, s); var gs = __plan2d.guidesV || []; var best = null; var bestD = tolM + 1e-6; for (var i=0;i<gs.length;i++){ var d=Math.abs(v-gs[i]); if(d<=tolM && d<bestD){ bestD=d; best=gs[i]; } } if (best!=null) return best; } catch(e){}
    return window.plan2dSnap(v);
  };
  if (typeof window.plan2dSnapY !== 'function') window.plan2dSnapY = function plan2dSnapY(v){
    try { var s = __plan2d.scale || 1; var tolM = 8 / Math.max(1e-6, s); var gs = __plan2d.guidesH || []; var best = null; var bestD = tolM + 1e-6; for (var i=0;i<gs.length;i++){ var d=Math.abs(v-gs[i]); if(d<=tolM && d<bestD){ bestD=d; best=gs[i]; } } if (best!=null) return best; } catch(e){}
    return window.plan2dSnap(v);
  };
  if (typeof window.plan2dSnapPoint !== 'function') window.plan2dSnapPoint = function plan2dSnapPoint(p){ return { x: window.plan2dSnapX(p.x), y: window.plan2dSnapY(p.y) }; };
  if (typeof window.plan2dSnapTOnWall !== 'function') window.plan2dSnapTOnWall = function plan2dSnapTOnWall(wall, t){ t=Math.max(0,Math.min(1,t||0)); var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var dirx=dx/len, diry=dy/len; var wx=x0+dirx*(t*len), wy=y0+diry*(t*len); var sp=window.plan2dSnapPoint({x:wx,y:wy}); var denom=dx*dx+dy*dy||1; var tt=((sp.x-x0)*dx+(sp.y-y0)*dy)/denom; return Math.max(0,Math.min(1,tt)); };
  if (typeof window.plan2dEq !== 'function') window.plan2dEq = function plan2dEq(a,b,t){ return Math.abs(a-b) <= (t||0.05); };
  // Disable auto-join/auto-adjust behavior per request: do not modify
  // walls or endpoints beyond what the user explicitly draws.
  if (typeof window.plan2dAutoSnapAndJoin !== 'function') window.plan2dAutoSnapAndJoin = function plan2dAutoSnapAndJoin(){
    // Intentionally a no-op to avoid auto-joining or auto-closing walls.
    return;
  };
})();
