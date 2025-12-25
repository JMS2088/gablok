// Plan2D wall subsegment modeling and hit-tests
(function(){
  // Basic projection helper used across draw and interactions
  if (typeof window.plan2dProjectParamOnWall !== 'function') window.plan2dProjectParamOnWall = function plan2dProjectParamOnWall(p, wall){
    try{
      var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var denom=dx*dx+dy*dy || 1; var t=((p.x-x0)*dx+(p.y-y0)*dy)/denom; return Math.max(0, Math.min(1, t));
    }catch(e){ return 0; }
  };
  if (typeof window.plan2dComputeWallIntersections !== 'function') window.plan2dComputeWallIntersections = function plan2dComputeWallIntersections(elems){
    var walls = [];
    for(var i=0;i<elems.length;i++){
      var e=elems[i];
      if(!e || e.type!=='wall') continue;
      if(e.wallRole==='nonroom') continue;
      if(e.meta && e.meta.cad) continue;
      walls.push({i:i, e:e});
    }
    var map = {}; // wallIndex -> array of t in (0,1)
    function addT(idx, t){ if(t<=1e-6 || t>=1-1e-6) return; (map[idx]||(map[idx]=[])).push(t); }
    function segIntersect(ax,ay,bx,by,cx,cy,dx,dy){
      var min = Math.min, max=Math.max;
      var aH = Math.abs(ay-by) < 1e-6, cH = Math.abs(cy-dy) < 1e-6;
      if(aH && !cH){ var y = ay; var x = cx; if(x>=min(ax,bx)-1e-6 && x<=max(ax,bx)+1e-6 && y>=min(cy,dy)-1e-6 && y<=max(cy,dy)+1e-6){ return {x:x,y:y}; } }
      else if(!aH && cH){ var y2 = cy; var x2 = ax; if(x2>=min(cx,dx)-1e-6 && x2<=max(cx,dx)+1e-6 && y2>=min(ay,by)-1e-6 && y2<=max(ay,by)+1e-6){ return {x:x2,y:y2}; } }
      else if(aH && cH) { /* colinear horizontals: skip */ }
      else { /* both vertical: skip */ }
      return null;
    }
    for(var a=0;a<walls.length;a++){
      for(var b=a+1;b<walls.length;b++){
        var wa=walls[a], wb=walls[b]; var A=wa.e, B=wb.e; var P = segIntersect(A.x0,A.y0,A.x1,A.y1, B.x0,B.y0,B.x1,B.y1);
        if(P){ var tA = window.plan2dProjectParamOnWall ? window.plan2dProjectParamOnWall(P, A) : (function(){ var dx=A.x1-A.x0, dy=A.y1-A.y0; var denom=dx*dx+dy*dy||1; var t=((P.x-A.x0)*dx+(P.y-A.y0)*dy)/denom; return Math.max(0,Math.min(1,t)); })(); var tB = window.plan2dProjectParamOnWall ? window.plan2dProjectParamOnWall(P, B) : 0; addT(wa.i, tA); addT(wb.i, tB); }
      }
    }
    return map;
  };
  if (typeof window.plan2dBuildWallSubsegments !== 'function') window.plan2dBuildWallSubsegments = function plan2dBuildWallSubsegments(elems, wallIndex){
    var wall = elems[wallIndex]; if(!wall || wall.type!=='wall' || wall.wallRole==='nonroom') return [];
    var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var dirx=dx/len, diry=dy/len;
    var ts=[0,1]; var interMap = window.plan2dComputeWallIntersections(elems); var list = interMap[wallIndex]||[]; for(var i=0;i<list.length;i++){ ts.push(list[i]); }
    for(var ei=0; ei<elems.length; ei++){ var el = elems[ei]; if(!el) continue; if((el.type==='window' || el.type==='door') && typeof el.host==='number' && el.host===wallIndex){ var t0=Math.max(0,Math.min(1,el.t0||0)), t1=Math.max(0,Math.min(1,el.t1||0)); if(t0>t1){var tmp=t0;t0=t1;t1=tmp;} ts.push(t0, t1); } }
    ts = ts.filter(function(v){ return v>=0 && v<=1; }).sort(function(a,b){return a-b;}); var uniq=[]; for(var k=0;k<ts.length;k++){ if(!uniq.length || Math.abs(ts[k]-uniq[uniq.length-1])>1e-6) uniq.push(ts[k]); } ts = uniq;
    var subs=[]; for(var s=0;s<ts.length-1;s++){ var tA = ts[s], tB = ts[s+1]; if(tB <= tA + 1e-6) continue; var mid=(tA+tB)/2; var isVoid=false; for(var ei2=0; ei2<elems.length; ei2++){ var el2=elems[ei2]; if(!el2) continue; if((el2.type==='window'||el2.type==='door') && typeof el2.host==='number' && el2.host===wallIndex){ var a0=Math.min(el2.t0||0, el2.t1||0), a1=Math.max(el2.t0||0, el2.t1||0); if(mid>=a0-1e-6 && mid<=a1+1e-6){ isVoid=true; break; } } } if(isVoid) continue; var ax = x0 + dirx*(tA*len), ay = y0 + diry*(tA*len); var bx = x1 - dirx*((1-tB)*len), by = y1 - diry*((1-tB)*len); subs.push({ wallIndex: wallIndex, t0: tA, t1: tB, ax: ax, ay: ay, bx: bx, by: by }); }
    return subs;
  };
  if (typeof window.plan2dHitWallSubsegment !== 'function') window.plan2dHitWallSubsegment = function plan2dHitWallSubsegment(p, tol){
    var elems = __plan2d.elements||[]; var best=null; var bestD = (typeof tol==='number'? tol : 0.15);
    for(var wi=0; wi<elems.length; wi++){
      var w = elems[wi]; if(!w || w.type!=='wall') continue;
      var subs = window.plan2dBuildWallSubsegments(elems, wi);
      for(var si=0; si<subs.length; si++){
        var s = subs[si]; var dx=s.bx-s.ax, dy=s.by-s.ay; var denom=(dx*dx+dy*dy)||1; var t=((p.x-s.ax)*dx+(p.y-s.ay)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=s.ax+t*dx, cy=s.ay+t*dy; var d=Math.hypot(p.x-cx, p.y-cy); if(d < bestD){ bestD = d; best = s; }
      }
    }
    return best;
  };
  if (typeof window.plan2dDeleteSelectedSubsegment !== 'function') window.plan2dDeleteSelectedSubsegment = function plan2dDeleteSelectedSubsegment(){
    var ss = __plan2d.selectedSubsegment; if(!ss) return false; var idx = ss.wallIndex; var wall = __plan2d.elements[idx]; if(!wall || wall.type!=='wall') return false;
    var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var thick=wall.thickness||__plan2d.wallThicknessM;
    var t0 = Math.max(0, Math.min(1, ss.t0)); var t1 = Math.max(0, Math.min(1, ss.t1)); if(t0>t1){ var tmp=t0;t0=t1;t1=tmp; }
    var remaining = []; if(t0 > 1e-6) remaining.push([0, t0]); if(t1 < 1-1e-6) remaining.push([t1, 1]); var newWalls = [];
    for(var r=0;r<remaining.length;r++){ var a=remaining[r][0], b=remaining[r][1]; var ax=x0+dx*a, ay=y0+dy*a, bx=x0+dx*b, by=y0+dy*b; newWalls.push({ type:'wall', x0:ax, y0:ay, x1:bx, y1:by, thickness: thick }); }
    var oldIndex = idx; var delta = newWalls.length - 1;
    var toRemove = [];
    for(var i=0;i<__plan2d.elements.length;i++){ var e = __plan2d.elements[i]; if(!e) continue; if((e.type==='window' || e.type==='door') && typeof e.host==='number'){ if(e.host === oldIndex){ toRemove.push(i); } else if(e.host > oldIndex){ e.host -= 1; } } }
    // Replace wall
    __plan2d.elements.splice(oldIndex, 1);
    for(var nw=0;nw<newWalls.length;nw++){ __plan2d.elements.splice(oldIndex+nw, 0, newWalls[nw]); }
    // Adjust hosts beyond insertion
    for(var j=0;j<__plan2d.elements.length;j++){ var el = __plan2d.elements[j]; if(!el) continue; if((el.type==='window'||el.type==='door') && typeof el.host==='number' && el.host>=oldIndex){ el.host = Math.min(el.host + delta, __plan2d.elements.length-1); }
    }
    // Remove orphaned openings (reverse order)
    toRemove.sort(function(a,b){return b-a;}); for(var rr=0; rr<toRemove.length; rr++){ __plan2d.elements.splice(toRemove[rr],1); }
    return true;
  };
  if (typeof window.plan2dHitWallEndpoint !== 'function') window.plan2dHitWallEndpoint = function plan2dHitWallEndpoint(p, tol){ var best=null; var bestD=(typeof tol==='number'? tol : 0.30); var els=__plan2d.elements||[]; for(var i=0;i<els.length;i++){ var e=els[i]; if(!e||e.type!=='wall') continue; var d0=Math.hypot(p.x-e.x0, p.y-e.y0); if(d0<bestD){ bestD=d0; best={index:i, end:'a'}; } var d1=Math.hypot(p.x-e.x1, p.y-e.y1); if(d1<bestD){ bestD=d1; best={index:i, end:'b'}; } } return best; };
  if (typeof window.plan2dHitWindowEndpoint !== 'function') window.plan2dHitWindowEndpoint = function plan2dHitWindowEndpoint(p, tol){ var best=null; var bestD=tol||0.15; for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; if(e.type!=='window' || typeof e.host!=='number') continue; var host=__plan2d.elements[e.host]; if(!host || host.type!=='wall') continue; var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0)); var ax=host.x0+(host.x1-host.x0)*t0, ay=host.y0+(host.y1-host.y0)*t0; var bx=host.x0+(host.x1-host.x0)*t1, by=host.y0+(host.y1-host.y0)*t1; var d0=Math.hypot(p.x-ax, p.y-ay), d1=Math.hypot(p.x-bx, p.y-by); if(d0<bestD){ bestD=d0; best={index:i, end:'t0'}; } if(d1<bestD){ bestD=d1; best={index:i, end:'t1'}; } } return best; };
  if (typeof window.plan2dHitDoorEndpoint !== 'function') window.plan2dHitDoorEndpoint = function plan2dHitDoorEndpoint(p, tol){ var best=null; var bestD=tol||0.15; for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; if(e.type!=='door') continue; var ax, ay, bx, by; if(typeof e.host==='number'){ var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue; var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0)); ax = host.x0+(host.x1-host.x0)*t0; ay = host.y0+(host.y1-host.y0)*t0; bx = host.x0+(host.x1-host.x0)*t1; by = host.y0+(host.y1-host.y0)*t1; var d0=Math.hypot(p.x-ax, p.y-ay), d1=Math.hypot(p.x-bx, p.y-by); if(d0<bestD){ bestD=d0; best={index:i, end:'t0'}; } if(d1<bestD){ bestD=d1; best={index:i, end:'t1'}; } } else { ax=e.x0; ay=e.y0; bx=e.x1; by=e.y1; var d0f=Math.hypot(p.x-ax, p.y-ay), d1f=Math.hypot(p.x-bx, p.y-by); if(d0f<bestD){ bestD=d0f; best={index:i, end:'a'}; } if(d1f<bestD){ bestD=d1f; best={index:i, end:'b'}; } } } return best; };
  if (typeof window.plan2dHitDoorSegment !== 'function') window.plan2dHitDoorSegment = function plan2dHitDoorSegment(p, tol){ var best = null; var bestD = (typeof tol==='number'? tol : 0.12); for(var i=0;i<__plan2d.elements.length;i++){ var e = __plan2d.elements[i]; if(e.type!=='door' || typeof e.host!=='number') continue; var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue; var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0)); var ax=host.x0+(host.x1-host.x0)*t0, ay=host.y0+(host.y1-host.y0)*t0; var bx=host.x0+(host.x1-host.x0)*t1, by=host.y0+(host.y1-host.y0)*t1; var dx=bx-ax, dy=by-ay; var denom=(dx*dx+dy*dy)||1; var tt=((p.x-ax)*dx+(p.y-ay)*dy)/denom; tt=Math.max(0,Math.min(1,tt)); var cx=ax+tt*dx, cy=ay+tt*dy; var d=Math.hypot(p.x-cx, p.y-cy); if(d < bestD){ bestD = d; best = { index:i, t:tt }; } } return best; };
  if (typeof window.plan2dHitWindowSegment !== 'function') window.plan2dHitWindowSegment = function plan2dHitWindowSegment(p, tol){ var best = null; var bestD = (typeof tol==='number'? tol : 0.15); for(var i=0;i<__plan2d.elements.length;i++){ var e = __plan2d.elements[i]; if(e.type!=='window') continue; var ax, ay, bx, by; if(typeof e.host==='number'){ var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue; var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0)); ax = host.x0+(host.x1-host.x0)*t0; ay = host.y0+(host.y1-host.y0)*t0; bx = host.x0+(host.x1-host.x0)*t1; by = host.y0+(host.y1-host.y0)*t1; } else { ax=e.x0; ay=e.y0; bx=e.x1; by=e.y1; } var dx=bx-ax, dy=by-ay; var denom=(dx*dx+dy*dy)||1; var tt=((p.x-ax)*dx+(p.y-ay)*dy)/denom; tt=Math.max(0,Math.min(1,tt)); var cx=ax+tt*dx, cy=ay+tt*dy; var d=Math.hypot(p.x-cx, p.y-cy); if(d < bestD){ bestD = d; best = { index:i, t:tt }; } } return best; };
  if (typeof window.plan2dFindNearestWall !== 'function') window.plan2dFindNearestWall = function plan2dFindNearestWall(p, tol){ var bestIdx = -1; var bestD = (typeof tol==='number' ? tol : 0.25); for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; if(e.type!=='wall') continue; var d = (function(px,py,w){ var dx=w.x1-w.x0, dy=w.y1-w.y0; var denom=(dx*dx+dy*dy)||1; var t=((px-w.x0)*dx+(py-w.y0)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=w.x0+t*dx, cy=w.y0+t*dy; return Math.hypot(px-cx, py-cy); })(p.x,p.y,e); if(d < bestD){ bestD = d; bestIdx = i; } } if(bestIdx>=0) return { index: bestIdx, dist: bestD }; return null; };
})();
