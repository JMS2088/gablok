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
  if (typeof window.plan2dAutoSnapAndJoin !== 'function') window.plan2dAutoSnapAndJoin = function plan2dAutoSnapAndJoin(){
    var els = __plan2d.elements||[];
    // 1) Snap endpoints to grid and enforce axis alignment for walls
    for(var i=0;i<els.length;i++){
      var e=els[i]; if(!e) continue;
      if(e.type==='wall'){
        e.x0=window.plan2dSnap(e.x0); e.y0=window.plan2dSnap(e.y0); e.x1=window.plan2dSnap(e.x1); e.y1=window.plan2dSnap(e.y1);
        var dx=e.x1-e.x0, dy=e.y1-e.y0; if(Math.abs(dx)>=Math.abs(dy)){ e.y1=e.y0; } else { e.x1=e.x0; }
      } else if((e.type==='window'||e.type==='door')){
        if(typeof e.host==='number'){
          var host=els[e.host]; if(host && host.type==='wall'){
            e.t0 = window.plan2dSnapTOnWall(host, e.t0||0);
            e.t1 = window.plan2dSnapTOnWall(host, e.t1||0);
          }
        } else {
          e.x0=window.plan2dSnap(e.x0); e.y0=window.plan2dSnap(e.y0); e.x1=window.plan2dSnap(e.x1); e.y1=window.plan2dSnap(e.y1);
        }
      }
    }
    // 2) Join flush when walls cross or meet (more generous snapping)
    for(var a=0;a<els.length;a++){
      var wa=els[a]; if(!wa||wa.type!=='wall') continue;
      var aH = window.plan2dEq(wa.y0, wa.y1);
      for(var b=a+1;b<els.length;b++){
        var wb=els[b]; if(!wb||wb.type!=='wall') continue;
        var bH = window.plan2dEq(wb.y0, wb.y1);
        if(aH && !bH){
          // A horizontal, B vertical
          var y = wa.y0, x = wb.x0;
          var ax0=Math.min(wa.x0,wa.x1), ax1=Math.max(wa.x0,wa.x1);
          var by0=Math.min(wb.y0,wb.y1), by1=Math.max(wb.y0,wb.y1);
          if(x>=ax0-1e-6 && x<=ax1+1e-6 && y>=by0-1e-6 && y<=by1+1e-6){
            if(Math.hypot(wa.x0-x, wa.y0-y) <= 0.20){ wa.x0=x; wa.y0=y; }
            if(Math.hypot(wa.x1-x, wa.y1-y) <= 0.20){ wa.x1=x; wa.y1=y; }
            if(Math.hypot(wb.x0-x, wb.y0-y) <= 0.20){ wb.x0=x; wb.y0=y; }
            if(Math.hypot(wb.x1-x, wb.y1-y) <= 0.20){ wb.x1=x; wb.y1=y; }
          }
        } else if(!aH && bH){
          // A vertical, B horizontal
          var y2 = wb.y0, x2 = wa.x0;
          var bx0=Math.min(wb.x0,wb.x1), bx1=Math.max(wb.x0,wb.x1);
          var ay0=Math.min(wa.y0,wa.y1), ay1=Math.max(wa.y0,wa.y1);
          if(x2>=bx0-1e-6 && x2<=bx1+1e-6 && y2>=ay0-1e-6 && y2<=ay1+1e-6){
            if(Math.hypot(wa.x0-x2, wa.y0-y2) <= 0.20){ wa.x0=x2; wa.y0=y2; }
            if(Math.hypot(wa.x1-x2, wa.y1-y2) <= 0.20){ wa.x1=x2; wa.y1=y2; }
            if(Math.hypot(wb.x0-x2, wb.y0-y2) <= 0.20){ wb.x0=x2; wb.y0=y2; }
            if(Math.hypot(wb.x1-x2, wb.y1-y2) <= 0.20){ wb.x1=x2; wb.y1=y2; }
          }
        } else if(aH && bH){
          if(window.plan2dEq(wa.y0, wb.y0, 0.10)){
            var yH = window.plan2dSnap(wa.y0); wa.y0=wa.y1=yH; wb.y0=wb.y1=yH;
            var ptsA=[wa.x0,wa.x1], ptsB=[wb.x0,wb.x1];
            for(var i1=0;i1<2;i1++) for(var j1=0;j1<2;j1++) if(window.plan2dEq(ptsA[i1], ptsB[j1], 0.10)){ var nv=window.plan2dSnap((ptsA[i1]+ptsB[j1])/2); ptsA[i1]=ptsB[j1]=nv; }
            wa.x0=ptsA[0]; wa.x1=ptsA[1]; wb.x0=ptsB[0]; wb.x1=ptsB[1];
          }
        } else {
          if(window.plan2dEq(wa.x0, wb.x0, 0.10)){
            var xV = window.plan2dSnap(wa.x0); wa.x0=wa.x1=xV; wb.x0=wb.x1=xV;
            var pa=[wa.y0,wa.y1], pb=[wb.y0,wb.y1];
            for(var i2=0;i2<2;i2++) for(var j2=0;j2<2;j2++) if(window.plan2dEq(pa[i2], pb[j2], 0.10)){ var nv2=window.plan2dSnap((pa[i2]+pb[j2])/2); pa[i2]=pb[j2]=nv2; }
            wa.y0=pa[0]; wa.y1=pa[1]; wb.y0=pb[0]; wb.y1=pb[1];
          }
        }
      }
    }
  };
})();
