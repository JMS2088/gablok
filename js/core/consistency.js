// Simple 2D↔3D consistency checks for diagnostics (dev-only)
(function(){
  "use strict";
  if (typeof window === 'undefined') return;

  function kf(x){ return Math.round((+x||0)*1000)/1000; } // 1mm
  function edgeKey(a,b){
    var ax=kf(a.x), az=kf(a.z), bx=kf(b.x), bz=kf(b.z);
    var k1=ax+","+az, k2=bx+","+bz; return (k1<k2)? (k1+"|"+k2):(k2+"|"+k1);
  }
  function ptKey(p){ return kf(p.x)+","+kf(p.z); }
  function toWorld(x, y, ctx){ return { x: (ctx.centerX||0) + x, z: (ctx.centerZ||0) + (ctx.ySign||1)*y }; }
  function getCtx(snapshot){
    var ctx={ centerX:0, centerZ:0, ySign:1 };
    try{
      if (typeof __plan2d!== 'undefined' && __plan2d){
        if (isFinite(__plan2d.centerX)) ctx.centerX = __plan2d.centerX;
        if (isFinite(__plan2d.centerZ)) ctx.centerZ = __plan2d.centerZ;
        if (__plan2d.yFromWorldZSign===-1 || __plan2d.yFromWorldZSign===1) ctx.ySign = __plan2d.yFromWorldZSign;
      }
      if (snapshot && typeof snapshot==='object'){
        if (isFinite(snapshot.centerX)) ctx.centerX = snapshot.centerX;
        if (isFinite(snapshot.centerZ)) ctx.centerZ = snapshot.centerZ;
        if (snapshot.yFromWorldZSign===-1 || snapshot.yFromWorldZSign===1) ctx.ySign = snapshot.yFromWorldZSign;
      }
    }catch(_e){}
    return ctx;
  }

  function collect2DEdges(level){
    var edges=[]; var points=[]; var ctx=getCtx();
    try{
      var elems=(__plan2d && Array.isArray(__plan2d.elements))? __plan2d.elements: [];
      for (var i=0;i<elems.length;i++){
        var e=elems[i]; if(!e||e.type!=='wall') continue;
        var lv=(typeof e.level==='number')? e.level : (typeof e.roomLevel==='number'? e.roomLevel: 0);
        if ((lv||0)!==(level||0)) continue;
        var a=toWorld(e.x0||0, e.y0||0, ctx); var b=toWorld(e.x1||0, e.y1||0, ctx);
        edges.push({a:a,b:b});
        points.push(a,b);
      }
    }catch(_e){}
    return { edges: edges, points: points };
  }

  function collect3DEdges(level){
    var edges=[]; var points=[]; var lvl=(level||0);
    try{
      // Room perimeters (rectangles)
      if (Array.isArray(window.allRooms)){
        for (var i=0;i<allRooms.length;i++){
          var r=allRooms[i]; if(!r|| (r.level||0)!==lvl) continue;
          var halfW=(r.width||0)/2, halfD=(r.depth||0)/2;
          var minX=(r.x||0)-halfW, maxX=(r.x||0)+halfW;
          var minZ=(r.z||0)-halfD, maxZ=(r.z||0)+halfD;
          var p1={x:minX,z:minZ}, p2={x:maxX,z:minZ}, p3={x:maxX,z:maxZ}, p4={x:minX,z:maxZ};
          edges.push({a:p1, b:p2}); edges.push({a:p2, b:p3}); edges.push({a:p3, b:p4}); edges.push({a:p4, b:p1});
          points.push(p1,p2,p3,p4);
        }
      }
      // Free-standing / interior strips
      if (Array.isArray(window.wallStrips)){
        for (var j=0;j<wallStrips.length;j++){
          var s=wallStrips[j]; if(!s || (s.level||0)!==lvl) continue;
          var a={x:(s.x0||0), z:(s.z0||0)}, b={x:(s.x1||0), z:(s.z1||0)};
          edges.push({a:a, b:b}); points.push(a,b);
        }
      }
    }catch(_e){}
    return { edges: edges, points: points };
  }

  function dedupeKeys(edges){
    var map=Object.create(null);
    for (var i=0;i<edges.length;i++){
      var e=edges[i]; if(!e||!e.a||!e.b) continue;
      map[edgeKey(e.a,e.b)] = true;
    }
    return map;
  }

  function dedupePts(pts){ var m=Object.create(null); var arr=[]; for(var i=0;i<pts.length;i++){ var p=pts[i]; if(!p) continue; var k=ptKey(p); if(!m[k]){ m[k]=true; arr.push(p); } } return { map:m, list:arr }; }
  function sumLength(map){ var L=0; try{ var keys=Object.keys(map); for(var i=0;i<keys.length;i++){ var k=keys[i]; var parts=k.split('|'); if(parts.length!==2) continue; var a=parts[0].split(',').map(parseFloat), b=parts[1].split(',').map(parseFloat); var dx=a[0]-b[0], dz=a[1]-b[1]; L += Math.hypot(dx,dz); } }catch(_e){} return L; }
  function polyArea(pts){ var a=0; for(var i=0,j=pts.length-1;i<pts.length;j=i++){ a += (pts[j].x*pts[i].z - pts[i].x*pts[j].z); } return Math.abs(a/2); }
  function toWorldPoly(poly, ctx){ var out=[]; for(var i=0;i<poly.length;i++){ var p=poly[i]; out.push(toWorld(p.x, p.y, ctx)); } return out; }

  function diffSets(aMap, bMap){
    var missing=[], extra=[];
    var k;
    for (k in aMap){ if (aMap.hasOwnProperty(k) && !bMap[k]) missing.push(k); }
    for (k in bMap){ if (bMap.hasOwnProperty(k) && !aMap[k]) extra.push(k); }
    return { missing: missing, extra: extra };
  }

  if (typeof window.check2D3DConsistency !== 'function'){
    window.check2D3DConsistency = function check2D3DConsistency(opts){
      opts = opts||{}; var lvl = (typeof opts.level==='number')? opts.level: (window.currentLevel||0);
      try {
        var ctx = getCtx();
        var coll2d = collect2DEdges(lvl), coll3d = collect3DEdges(lvl);
        var m2d = dedupeKeys(coll2d.edges), m3d = dedupeKeys(coll3d.edges);
        var d = diffSets(m2d, m3d);
        var twoDCount = Object.keys(m2d).length, threeDCount = Object.keys(m3d).length;
        var L2 = sumLength(m2d), L3 = sumLength(m3d);
        // Areas: 2D via polygons, 3D via rooms sum
        var area2 = 0; try{ if (typeof window.plan2dComputeRoomPolygonsLite==='function' && __plan2d && Array.isArray(__plan2d.elements)){
          var polys = window.plan2dComputeRoomPolygonsLite(__plan2d.elements, { strictClosedLoopsOnly: true }) || [];
          for (var pi=0; pi<polys.length; pi++){ var wp = toWorldPoly(polys[pi], ctx); area2 += polyArea(wp); }
        } }catch(_ea){}
        var area3 = 0; try{ if (Array.isArray(window.allRooms)){ for (var ri=0; ri<allRooms.length; ri++){ var r=allRooms[ri]; if(!r|| (r.level||0)!==lvl) continue; area3 += Math.max(0, (r.width||0)) * Math.max(0, (r.depth||0)); } } }catch(_er){}
        var heightGuess = (window.__plan2d && __plan2d.wallHeightM) || 3.0;
        var vol2 = area2 * heightGuess;
        var vol3 = 0; try { if (Array.isArray(window.allRooms)){ for (var vi=0; vi<allRooms.length; vi++){ var rr=allRooms[vi]; if(!rr|| (rr.level||0)!==lvl) continue; var h=(typeof rr.height==='number' && rr.height>0)? rr.height: heightGuess; vol3 += Math.max(0,(rr.width||0)) * Math.max(0,(rr.depth||0)) * h; } } }catch(_ev){}
        // Unique points counts
        var pts2 = dedupePts(coll2d.points), pts3 = dedupePts(coll3d.points);
        var pointDiff = { twoD: Object.keys(pts2.map).length, threeD: Object.keys(pts3.map).length };
        var res = {
          level: lvl,
          twoDCount: twoDCount,
          threeDCount: threeDCount,
          missingCount: d.missing.length,
          extraCount: d.extra.length,
          missing: d.missing,
          extra: d.extra,
          length2D: +L2.toFixed(3),
          length3D: +L3.toFixed(3),
          area2D: +area2.toFixed(3),
          area3D: +area3.toFixed(3),
          volume2D: +vol2.toFixed(3),
          volume3D: +vol3.toFixed(3),
          points2D: pointDiff.twoD,
          points3D: pointDiff.threeD,
          lengthDiff: +(L3 - L2).toFixed(3),
          areaDiff: +(area3 - area2).toFixed(3),
          volumeDiff: +(vol3 - vol2).toFixed(3)
        };
        try { console.log('[Consistency] L'+lvl+' 2D edges:', res.twoDCount, '3D edges:', res.threeDCount, 'missing:', res.missingCount, 'extra:', res.extraCount); } catch(_c){}
        return res;
      } catch(e){ return { error: String(e&&e.message||e) }; }
    };
  }
})();
