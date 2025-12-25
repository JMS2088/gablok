/**
 * @file wallStrips.js
 * @description Extracted wall strip & perimeter management from engine3d.js to reduce file size.
 * Provides: dedupeWallStrips, removeRoomPerimeterStrips, rebuildRoomPerimeterStrips (with endpoint unification).
 * Safe idempotent definitions (only define if undefined) so legacy engine3d.js stubs can coexist.
 */
(function(){
  if (typeof window === 'undefined') return;

  // Utility: purge wall strips intersecting a given world-aligned box on a level.
  // Useful to clear stale perimeter lines left behind during 3D drags when not in solid mode.
  if (typeof window.purgeWallStripsInBox === 'undefined') window.purgeWallStripsInBox = function(level, minX, minZ, maxX, maxZ){
    try {
      if (!Array.isArray(window.wallStrips) || window.wallStrips.length === 0) return 0;
      function pointIn(px,pz){ return px>=minX && px<=maxX && pz>=minZ && pz<=maxZ; }
      function segsIntersect(ax,az,bx,bz,cx,cz,dx,dz){
        function orient(px,py,qx,qy,rx,ry){ var v=(qx-px)*(ry-py)-(qy-py)*(rx-px); return (v>0)?1:(v<0?-1:0); }
        function onSeg(px,py,qx,qy,rx,ry){ return Math.min(px,qx)-1e-9<=rx && rx<=Math.max(px,qx)+1e-9 && Math.min(py,qy)-1e-9<=ry && ry<=Math.max(py,qy)+1e-9; }
        var o1=orient(ax,az,bx,bz,cx,cz), o2=orient(ax,az,bx,bz,dx,dz), o3=orient(cx,cz,dx,dz,ax,az), o4=orient(cx,cz,dx,dz,bx,bz);
        if(o1!==o2 && o3!==o4) return true;
        if(o1===0 && onSeg(ax,az,bx,bz,cx,cz)) return true;
        if(o2===0 && onSeg(ax,az,bx,bz,dx,dz)) return true;
        if(o3===0 && onSeg(cx,cz,dx,dz,ax,az)) return true;
        if(o4===0 && onSeg(cx,cz,dx,dz,bx,bz)) return true;
        return false;
      }
      function segIntersectsBox(x0,z0,x1,z1){
        if (pointIn(x0,z0) || pointIn(x1,z1)) return true;
        if ((x0<minX && x1<minX) || (x0>maxX && x1>maxX) || (z0<minZ && z1<minZ) || (z0>maxZ && z1>maxZ)) return false;
        return segsIntersect(x0,z0,x1,z1, minX,minZ, maxX,minZ) ||
               segsIntersect(x0,z0,x1,z1, maxX,minZ, maxX,maxZ) ||
               segsIntersect(x0,z0,x1,z1, maxX,maxZ, minX,maxZ) ||
               segsIntersect(x0,z0,x1,z1, minX,maxZ, minX,minZ);
      }
      var before = window.wallStrips.length;
      window.wallStrips = window.wallStrips.filter(function(ws){
        try {
          if (!ws) return false;
          if ((ws.level||0) !== (level||0)) return true;
          return !segIntersectsBox(ws.x0||0, ws.z0||0, ws.x1||0, ws.z1||0);
        } catch(_e){ return true; }
      });
      if (typeof window.dedupeWallStrips==='function') window.dedupeWallStrips();
      if (typeof window.renderLoop==='function') window.renderLoop();
      var after = window.wallStrips.length;
      return Math.max(0, before - after);
    } catch(e){ return 0; }
  };

  // Deduplicate wallStrips by unordered endpoints and level.
  if (typeof window.dedupeWallStrips === 'undefined') window.dedupeWallStrips = function(){
    try {
      var arr = window.wallStrips; if (!Array.isArray(arr) || arr.length < 2) return;
      function kf(v){ return Math.round((+v||0)*1000)/1000; }
      function key(s){ var a=kf(s.x0)+","+kf(s.z0), b=kf(s.x1)+","+kf(s.z1); var u=(a<b)?(a+"|"+b):(b+"|"+a); return (s.level||0)+"#"+u; }
      var tag = window.__roomStripTag || '__fromRooms';
      var best = Object.create(null);
      for (var i=arr.length-1; i>=0; i--){
        var s = arr[i]; if(!s) continue; var k = key(s);
        if (!best[k]) { best[k] = s; }
        else { var curBest = best[k]; if (!!s[tag] && !curBest[tag]) { best[k] = s; } }
      }
      var out = []; var kept = Object.create(null);
      for (var j=0; j<arr.length; j++){
        var sj = arr[j]; if(!sj) continue; var kj = key(sj);
        if (best[kj] === sj && !kept[kj]) { out.push(sj); kept[kj] = true; }
      }
      window.wallStrips = out;
    } catch(_eDed) {}
  };

  // Remove previously generated perimeter strips (created from rooms)
  if (typeof window.removeRoomPerimeterStrips === 'undefined') window.removeRoomPerimeterStrips = function(){
    try {
      var tag = window.__roomStripTag || '__fromRooms';
      if (!Array.isArray(window.wallStrips)) return;
      var beforeLen = window.wallStrips.length;
      function kf(v){ return Math.round((+v||0)*1000)/1000; }
      function edgeKeyWithLevel(level,x0,z0,x1,z1){
        var a = kf(x0)+","+kf(z0), b = kf(x1)+","+kf(z1);
        var u=(a<b)?(a+"|"+b):(b+"|"+a); return (level||0)+"#"+u;
      }
      var perimeterKeys = Object.create(null);
      try {
        var rooms = Array.isArray(window.allRooms) ? window.allRooms : [];
        for (var i=0;i<rooms.length;i++){
          var r = rooms[i]; if(!r) continue; var lev=(r.level||0);
          if (Array.isArray(r.footprint) && r.footprint.length>=2){
            var pts=r.footprint;
            for (var k=0;k<pts.length;k++){ var A=pts[k], B=pts[(k+1)%pts.length]; if(!A||!B) continue; perimeterKeys[ edgeKeyWithLevel(lev,A.x,A.z,B.x,B.z) ] = true; }
          } else {
            var hw=(r.width||0)/2, hd=(r.depth||0)/2; if(hw>0 && hd>0){
              var xL=(r.x||0)-hw, xR=(r.x||0)+hw, zT=(r.z||0)-hd, zB=(r.z||0)+hd;
              var edges = [ [xL,zT,xR,zT], [xR,zT,xR,zB], [xR,zB,xL,zB], [xL,zB,xL,zT] ];
              for (var e=0;e<edges.length;e++){ var E=edges[e]; perimeterKeys[ edgeKeyWithLevel(lev,E[0],E[1],E[2],E[3]) ] = true; }
            }
          }
        }
        var garages = Array.isArray(window.garageComponents)? window.garageComponents: [];
        for (var g=0; g<garages.length; g++){
          var gar = garages[g]; if(!gar) continue; var levG=(gar.level||0);
          var hwg=(gar.width||0)/2, hdg=(gar.depth||0)/2, rot=((gar.rotation||0)*Math.PI)/180;
          function RG(px,pz){ var dx=px-(gar.x||0), dz=pz-(gar.z||0); return { x:(gar.x||0)+dx*Math.cos(rot)-dz*Math.sin(rot), z:(gar.z||0)+dx*Math.sin(rot)+dz*Math.cos(rot) }; }
          var p1=RG((gar.x||0)-hwg,(gar.z||0)-hdg), p2=RG((gar.x||0)+hwg,(gar.z||0)-hdg), p3=RG((gar.x||0)+hwg,(gar.z||0)+hdg), p4=RG((gar.x||0)-hwg,(gar.z||0)+hdg);
          var edgesG=[ [p1,p2], [p2,p3], [p3,p4], [p4,p1] ];
          var maxLen=-1, longestIdx=-1;
          for (var gi=0; gi<edgesG.length; gi++){ var A0=edgesG[gi][0], B0=edgesG[gi][1]; var L=Math.hypot(B0.x-A0.x,B0.z-A0.z); if(L>maxLen){maxLen=L; longestIdx=gi;} }
          for (var gi2=0; gi2<edgesG.length; gi2++){ if (gi2===longestIdx) continue; var A1=edgesG[gi2][0], B1=edgesG[gi2][1]; perimeterKeys[ edgeKeyWithLevel(levG,A1.x,A1.z,B1.x,B1.z) ] = true; }
        }
      } catch(_eKeys) {}
      try { var prev = window.__lastPerimeterEdges || null; if (prev){ Object.keys(prev).forEach(function(k){ perimeterKeys[k]=true; }); } } catch(_ePrev) {}
      // Only remove strips that originated from rooms (tagged or have roomId/garageId).
      // Preserve free-standing user walls even if they align with a room perimeter.
      window.wallStrips = window.wallStrips.filter(function(ws){
        try {
          if (!ws) return false;
          var lev = (ws.level||0);
          var fromRoom = !!ws[tag] || !!ws.roomId || !!ws.garageId;
          if (!fromRoom) return true; // keep user/free wall strips
          // If this is a perimeter strip from rooms, drop it when it matches a current perimeter edge
          var k = edgeKeyWithLevel(lev, ws.x0, ws.z0, ws.x1, ws.z1);
          if (perimeterKeys[k]) return false;
          return true;
        } catch(_eF){ return true; }
      });
      var afterLen = window.wallStrips.length;
      var removed = Math.max(0, beforeLen - afterLen);
      try { window.__lastPerimeterPurgeStats = { before: beforeLen, after: afterLen, removed: removed, ts: Date.now() }; } catch(_eStats) {}
      try { if (typeof window.__rtTracePush==='function') window.__rtTracePush({ kind:'perimeter-purge', removed: removed, before: beforeLen, after: afterLen }); } catch(_eTrace) {}
      if (removed>0 && window.__debugPerimeterMetrics){ console.log('[perimeter] purge removed', removed, '->', afterLen); }
      if (typeof window.dedupeWallStrips==='function') window.dedupeWallStrips();
      if (typeof window.saveProjectSilently==='function') window.saveProjectSilently();
      if (typeof window.renderLoop==='function') window.renderLoop();
    } catch(_e) {}
  };

  // Rebuild room perimeter strips (large function moved verbatim from engine3d.js)
  if (typeof window.rebuildRoomPerimeterStrips === 'undefined') window.rebuildRoomPerimeterStrips = function(thickness){
    try {
      var tag = window.__roomStripTag || '__fromRooms';
      var t = Math.max(0.01, +thickness || 0.3);
      if (!Array.isArray(window.allRooms)) return;
      if (!Array.isArray(window.wallStrips)) window.wallStrips = [];
      var startLen = window.wallStrips.length;
      function kf(v){ return Math.round((+v||0)*1000)/1000; }
      function edgeKeyWithLevel(level,x0,z0,x1,z1){ var a=kf(x0)+","+kf(z0), b=kf(x1)+","+kf(z1); var k=(a<b)?(a+"|"+b):(b+"|"+a); return (level||0)+"#"+k; }
      // Helper: normalized edge key without level (for roomId comparison sets)
      function normEdgeKey(x0,z0,x1,z1){ var a=x0.toFixed(3)+","+z0.toFixed(3); var b=x1.toFixed(3)+","+z1.toFixed(3); return (a<b? a+"|"+b : b+"|"+a); }
      // Helper: segment-box intersection (inclusive). Removes strips crossing drag area even if endpoints are outside.
      function __pointInBox(px,pz,minX,minZ,maxX,maxZ){ return px>=minX && px<=maxX && pz>=minZ && pz<=maxZ; }
      function __segmentsIntersect(ax,az,bx,bz,cx,cz,dx,dz){
        function orient(px,py,qx,qy,rx,ry){ var v=(qx-px)*(ry-py)-(qy-py)*(rx-px); return (v>0)?1:(v<0?-1:0); }
        function onSeg(px,py,qx,qy,rx,ry){ return Math.min(px,qx)-1e-9<=rx && rx<=Math.max(px,qx)+1e-9 && Math.min(py,qy)-1e-9<=ry && ry<=Math.max(py,qy)+1e-9; }
        var o1=orient(ax,az,bx,bz,cx,cz), o2=orient(ax,az,bx,bz,dx,dz), o3=orient(cx,cz,dx,dz,ax,az), o4=orient(cx,cz,dx,dz,bx,bz);
        if(o1!==o2 && o3!==o4) return true;
        if(o1===0 && onSeg(ax,az,bx,bz,cx,cz)) return true;
        if(o2===0 && onSeg(ax,az,bx,bz,dx,dz)) return true;
        if(o3===0 && onSeg(cx,cz,dx,dz,ax,az)) return true;
        if(o4===0 && onSeg(cx,cz,dx,dz,bx,bz)) return true;
        return false;
      }
      function __segIntersectsBox(x0,z0,x1,z1,minX,minZ,maxX,maxZ){
        // Quick accept if any endpoint inside
        if(__pointInBox(x0,z0,minX,minZ,maxX,maxZ) || __pointInBox(x1,z1,minX,minZ,maxX,maxZ)) return true;
        // Reject if segment entirely left/right/above/below
        if((x0<minX && x1<minX) || (x0>maxX && x1>maxX) || (z0<minZ && z1<minZ) || (z0>maxZ && z1>maxZ)) return false;
        // Check intersection with each box edge
        return __segmentsIntersect(x0,z0,x1,z1, minX,minZ, maxX,minZ) ||
               __segmentsIntersect(x0,z0,x1,z1, maxX,minZ, maxX,maxZ) ||
               __segmentsIntersect(x0,z0,x1,z1, maxX,maxZ, minX,maxZ) ||
               __segmentsIntersect(x0,z0,x1,z1, minX,maxZ, minX,minZ);
      }
      var perimeterKeys = Object.create(null);
      try {
        for (var ri=0; ri<window.allRooms.length; ri++){
          var r0 = window.allRooms[ri]; if(!r0) continue; var lev=(r0.level||0);
          if (Array.isArray(r0.footprint) && r0.footprint.length>=2){
            var pts0 = r0.footprint; for (var kk=0; kk<pts0.length; kk++){ var a0=pts0[kk], b0=pts0[(kk+1)%pts0.length]; if(!a0||!b0) continue; perimeterKeys[edgeKeyWithLevel(lev,a0.x,a0.z,b0.x,b0.z)]=true; }
          } else {
            var hw0=(r0.width||0)/2, hd0=(r0.depth||0)/2; if(hw0>0 && hd0>0){
              var xL=(r0.x||0)-hw0, xR=(r0.x||0)+hw0, zT=(r0.z||0)-hd0, zB=(r0.z||0)+hd0;
              var edges0=[[xL,zT,xR,zT],[xR,zT,xR,zB],[xR,zB,xL,zB],[xL,zB,xL,zT]];
              for (var ee=0; ee<edges0.length; ee++){ var E=edges0[ee]; perimeterKeys[edgeKeyWithLevel(lev,E[0],E[1],E[2],E[3])]=true; }
            }
          }
        }
        var garages0 = Array.isArray(window.garageComponents) ? window.garageComponents : [];
        for (var gi0=0; gi0<garages0.length; gi0++){
          var g0 = garages0[gi0]; if(!g0) continue; var levG=(g0.level||0);
          var hwg=(g0.width||0)/2, hdg=(g0.depth||0)/2; if(hwg<=0||hdg<=0) continue;
          var rot0=((g0.rotation||0)*Math.PI)/180; var cos0=Math.cos(rot0), sin0=Math.sin(rot0);
          function rL(lx,lz){ var rx=lx*cos0 - lz*sin0, rz=lx*sin0 + lz*cos0; return { x:(g0.x||0)+rx, z:(g0.z||0)+rz }; }
          var c0=rL(-hwg,-hdg), c1=rL(hwg,-hdg), c2=rL(hwg,hdg), c3=rL(-hwg,hdg); var egs=[[c0,c1],[c1,c2],[c2,c3],[c3,c0]];
          var maxLen=-1,longestIdx=-1; for (var gi=0; gi<egs.length; gi++){ var A=egs[gi][0], B=egs[gi][1]; var L=Math.hypot(B.x-A.x,B.z-A.z); if(L>maxLen){maxLen=L; longestIdx=gi;} }
          for (var gi2=0; gi2<egs.length; gi2++){ if (gi2===0) continue; var A1=egs[gi2][0], B1=egs[gi2][1]; perimeterKeys[edgeKeyWithLevel(levG,A1.x,A1.z,B1.x,B1.z)]=true; }
        }
      } catch(_ePK) {}
      // Build live per-room edge key sets (without level) to identify stale tagged strips by roomId
      var roomEdgeMap = Object.create(null); // roomId -> Set of normEdgeKey
      try {
        for (var rIdx=0; rIdx<(window.allRooms||[]).length; rIdx++){
          var rm = window.allRooms[rIdx]; if(!rm) continue;
          var set = Object.create(null);
          if (Array.isArray(rm.footprint) && rm.footprint.length>=2){
            for (var fpI=0; fpI<rm.footprint.length; fpI++){ var A=rm.footprint[fpI], B=rm.footprint[(fpI+1)%rm.footprint.length]; if(!A||!B) continue; set[normEdgeKey(A.x||0,A.z||0,B.x||0,B.z||0)] = true; }
          } else {
            var hwR=(rm.width||0)/2, hdR=(rm.depth||0)/2; if(hwR>0 && hdR>0){
              var xLR=(rm.x||0)-hwR, xRR=(rm.x||0)+hwR, zTR=(rm.z||0)-hdR, zBR=(rm.z||0)+hdR;
              var rectEdges=[[xLR,zTR,xRR,zTR],[xRR,zTR,xRR,zBR],[xRR,zBR,xLR,zBR],[xLR,zBR,xLR,zTR]];
              for (var rE=0; rE<rectEdges.length; rE++){ var RE=rectEdges[rE]; set[normEdgeKey(RE[0],RE[1],RE[2],RE[3])] = true; }
            }
          }
          roomEdgeMap[rm.id] = set;
        }
      } catch(_eRoomMap) {}
      try { var prevKeys=(window.__lastPerimeterEdges && typeof window.__lastPerimeterEdges==='object')?window.__lastPerimeterEdges:null; if(prevKeys){ window.wallStrips=(window.wallStrips||[]).filter(function(ws){ if(!ws) return false; var keyPrev=edgeKeyWithLevel((ws.level||0),ws.x0,ws.z0,ws.x1,ws.z1); return !prevKeys[keyPrev]; }); } } catch(_ePrev) {}
      try { window.wallStrips=(window.wallStrips||[]).filter(function(ws){ if(!ws) return false; var key=edgeKeyWithLevel((ws.level||0),ws.x0,ws.z0,ws.x1,ws.z1); return !perimeterKeys[key]; }); } catch(_eFilt) {}
      // Additional stale purge: any tagged strip with a roomId whose current geometry no longer includes its edge gets removed
      try {
        window.wallStrips = (window.wallStrips||[]).filter(function(ws){
          try {
            if (!ws) return false;
            if (ws.roomId){
              var liveSet = roomEdgeMap[ws.roomId];
              if (liveSet){
                var nk = normEdgeKey(ws.x0||0, ws.z0||0, ws.x1||0, ws.z1||0);
                if (!liveSet[nk]) return false; // stale tagged perimeter
              }
            }
            return true;
          } catch(_eTagPurge){ return true; }
        });
      } catch(_eTagRm) {}
      try { var dragId=window.__activelyDraggedRoomId||null; if(dragId){
        var theRoom=null; for (var ri2=0; ri2<window.allRooms.length; ri2++){ var rr=window.allRooms[ri2]; if(rr&&rr.id===dragId){ theRoom=rr; break; } }
        if(theRoom){ var levD=(theRoom.level||0);
          var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
          if(Array.isArray(theRoom.footprint)&&theRoom.footprint.length>0){
            for(var pi=0; pi<theRoom.footprint.length; pi++){ var p=theRoom.footprint[pi]; if(!p) continue; minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minZ=Math.min(minZ,p.z); maxZ=Math.max(maxZ,p.z); }
          } else { var hw=(theRoom.width||0)/2, hd=(theRoom.depth||0)/2; minX=(theRoom.x||0)-hw; maxX=(theRoom.x||0)+hw; minZ=(theRoom.z||0)-hd; maxZ=(theRoom.z||0)+hd; }
          var pad=0.8; minX-=pad; maxX+=pad; minZ-=pad; maxZ+=pad;
          // Union with previous drag bounds (same level) to ensure stale segments in overlap get cleared.
          var prevB=window.__lastDragBounds; if(prevB && prevB.level===levD){
            minX=Math.min(minX, prevB.minX); maxX=Math.max(maxX, prevB.maxX);
            minZ=Math.min(minZ, prevB.minZ); maxZ=Math.max(maxZ, prevB.maxZ);
          }
          var purgeMinX=minX, purgeMaxX=maxX, purgeMinZ=minZ, purgeMaxZ=maxZ;
          // Only purge perimeter strips that belong to the actively dragged room.
          // Do NOT remove unrelated free walls or other rooms' strips.
          window.wallStrips=(window.wallStrips||[]).filter(function(ws){
            try {
              if(!ws) return false;
              if((ws.level||0)!==levD) return true; // different level untouched
              var belongsToDragged = (ws.roomId === theRoom.id);
              if (!belongsToDragged) return true;
              return !__segIntersectsBox(ws.x0||0, ws.z0||0, ws.x1||0, ws.z1||0, purgeMinX, purgeMinZ, purgeMaxX, purgeMaxZ);
            } catch(_e){ return true; }
          });
          window.__lastDragBounds = { level: levD, minX: purgeMinX, maxX: purgeMaxX, minZ: purgeMinZ, maxZ: purgeMaxZ };
        }
      } } catch(_eDragPurge) {}
      window.removeRoomPerimeterStrips();
      function kf2(x){ return Math.round((+x||0)*1000)/1000; }
      function keyFor(x0,z0,x1,z1){ var a=kf2(x0)+","+kf2(z0), b=kf2(x1)+","+kf2(z1); return (a<b)?(a+"|"+b):(b+"|"+a); }
      var existing=Object.create(null); for (var ei=0; ei<window.wallStrips.length; ei++){ var s=window.wallStrips[ei]; if(!s) continue; existing[keyFor(s.x0,s.z0,s.x1,s.z1)]=true; }
      var added=Object.create(null);
      function pointSegInfo(px,pz,x0s,z0s,x1s,z1s){ var vx=x1s-x0s, vz=z1s-z0s; var L2=vx*vx+vz*vz; if(L2<1e-9) return null; var ux=px-x0s, uz=pz-z0s; var u=(ux*vx+uz*vz)/L2; var clamped=Math.max(0,Math.min(1,u)); var qx=x0s+clamped*vx, qz=z0s+clamped*vz; return { d:Math.hypot(px-qx,pz-qz), u:clamped, qx:qx, qz:qz, vx:vx, vz:vz }; }
      function openingsForEdge(room,x0e,z0e,x1e,z1e,isRect,rectMeta){ var outs=[]; if(!room||!Array.isArray(room.openings)) return outs; var EPS=0.06; for (var oi=0; oi<room.openings.length; oi++){ var op=room.openings[oi]; if(!op) continue; if (typeof op.x0==='number'&&typeof op.z0==='number'&&typeof op.x1==='number'&&typeof op.z1==='number'){ var i0=pointSegInfo(op.x0,op.z0,x0e,z0e,x1e,z1e); var i1=pointSegInfo(op.x1,op.z1,x0e,z0e,x1e,z1e); if(i0&&i1&&i0.d<=EPS&&i1.d<=EPS&&i0.u>=-1e-3&&i1.u<=1+1e-3){ var defaultSill = (op.type==='door') ? 0 : 0.9; var defaultHeight = (op.type==='door') ? 2.04 : 1.5; var finalSill = (typeof op.sillM==='number'?op.sillM:defaultSill); var finalHeight = (typeof op.heightM==='number'?op.heightM:defaultHeight); if (window.__debugOpenings && op.type==='window') { console.log('[wallStrips] Copying window opening:', { origSillM: op.sillM, origHeightM: op.heightM, finalSill: finalSill, finalHeight: finalHeight }); } outs.push({ type:op.type, x0:op.x0, z0:op.z0, x1:op.x1, z1:op.z1, sillM:finalSill, heightM:finalHeight, meta:(op.meta||null) }); } } else if (isRect && op && typeof op.edge==='string' && typeof op.startM==='number' && typeof op.endM==='number' && rectMeta){ var edge=op.edge; var sM=op.startM, eM=op.endM; if(eM<sM){ var tmp=sM; sM=eM; eM=tmp; } var xL=rectMeta.xL,xR=rectMeta.xR,zT=rectMeta.zT,zB=rectMeta.zB; var wx0,wz0,wx1,wz1,match=false; if(edge==='minZ'){ if(Math.abs(zT - z0e)<=1e-6 && Math.abs(zT - z1e)<=1e-6){ wx0=xL+sM; wx1=xL+eM; wz0=zT; wz1=zT; match=true; } } else if(edge==='maxZ'){ if(Math.abs(zB - z0e)<=1e-6 && Math.abs(zB - z1e)<=1e-6){ wx0=xL+sM; wx1=xL+eM; wz0=zB; wz1=zB; match=true; } } else if(edge==='minX'){ if(Math.abs(xL - x0e)<=1e-6 && Math.abs(xL - x1e)<=1e-6){ wz0=zT+sM; wz1=zT+eM; wx0=xL; wx1=xL; match=true; } } else if(edge==='maxX'){ if(Math.abs(xR - x0e)<=1e-6 && Math.abs(xR - x1e)<=1e-6){ wz0=zT+sM; wz1=zT+eM; wx0=xR; wx1=xR; match=true; } } if(match){ var defaultSill2 = (op.type==='door') ? 0 : 0.9; var defaultHeight2 = (op.type==='door') ? 2.04 : 1.5; outs.push({ type:op.type, x0:wx0, z0:wz0, x1:wx1, z1:wz1, sillM:(typeof op.sillM==='number'?op.sillM:defaultSill2), heightM:(typeof op.heightM==='number'?op.heightM:defaultHeight2), meta:(op.meta||null) }); } } } return outs; }
      function polySignedAreaXZ(pts){ try { var s=0; var n=(pts||[]).length; if(n<3) return 0; for (var ii=0; ii<n; ii++){ var a=pts[ii], b=pts[(ii+1)%n]; if(!a||!b) continue; s+=(a.x||0)*(b.z||0)-(b.x||0)*(a.z||0); } return s*0.5; } catch(_eA){ return 0; } }
      for (var i=0; i<window.allRooms.length; i++){
        var r=window.allRooms[i]; if(!r) continue; var level=(r.level||0); var baseY=level*3.5; var height=(typeof r.height==='number')?r.height:3.0;
  if (Array.isArray(r.footprint) && r.footprint.length>=2){ var pts=r.footprint; var area=polySignedAreaXZ(pts); var isCCW=(area>0); var interiorIsLeft=isCCW; var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity; for (var pi=0; pi<pts.length; pi++){ var pp=pts[pi]; if(!pp) continue; minX=Math.min(minX,pp.x||0); maxX=Math.max(maxX,pp.x||0); minZ=Math.min(minZ,pp.z||0); maxZ=Math.max(maxZ,pp.z||0); } var spanX=(isFinite(minX)&&isFinite(maxX))?(maxX-minX):0; var spanZ=(isFinite(minZ)&&isFinite(maxZ))?(maxZ-minZ):0; var longerAxis=(spanX>=spanZ)?'x':'z'; for (var k=0; k<pts.length; k++){ var a=pts[k], b=pts[(k+1)%pts.length]; if(!a||!b) continue; var key=keyFor(a.x,a.z,b.x,b.z); if(existing[key]||added[key]) continue; var sdx=(b.x-a.x), sdz=(b.z-a.z); var xDominant=Math.abs(sdx)>=Math.abs(sdz); var isOuterBias=(xDominant && longerAxis==='x') || (!xDominant && longerAxis==='z'); var outerFaceLeft=isOuterBias?(!interiorIsLeft):(interiorIsLeft); var openEdge=openingsForEdge(r,a.x,a.z,b.x,b.z,false,null); window.wallStrips.push({ x0:a.x, z0:a.z, x1:b.x, z1:b.z, thickness:t, height:height, baseY:baseY, level:level, openings:openEdge, [tag]:true, __outerFaceLeft:outerFaceLeft, __interiorLeft:interiorIsLeft, roomId:(r.id||null) }); added[key]=true; } } else { var hw=(r.width||0)/2, hd=(r.depth||0)/2; if(hw<=0||hd<=0) continue; var xL=(r.x||0)-hw, xR=(r.x||0)+hw, zT=(r.z||0)-hd, zB=(r.z||0)+hd; var rectPts=[{x:xL,z:zT},{x:xR,z:zT},{x:xR,z:zB},{x:xL,z:zB}]; var areaR=polySignedAreaXZ(rectPts); var isCCWR=(areaR>0); var interiorIsLeftR=isCCWR; var longerAxisR=((r.width||0)>=(r.depth||0))?'x':'z'; var edges=[[xL,zT,xR,zT],[xR,zT,xR,zB],[xR,zB,xL,zB],[xL,zB,xL,zT]]; for (var e=0; e<edges.length; e++){ var E=edges[e]; var key2=keyFor(E[0],E[1],E[2],E[3]); if(existing[key2]||added[key2]) continue; var edx=E[2]-E[0], edz=E[3]-E[1]; var xDom=Math.abs(edx)>=Math.abs(edz); var isOuterBiasR=(xDom && longerAxisR==='x') || (!xDom && longerAxisR==='z'); var outerFaceLeftR=isOuterBiasR?(!interiorIsLeftR):(interiorIsLeftR); var openEdgeR=openingsForEdge(r,E[0],E[1],E[2],E[3],true,{xL:xL,xR:xR,zT:zT,zB:zB}); window.wallStrips.push({ x0:E[0], z0:E[1], x1:E[2], z1:E[3], thickness:t, height:height, baseY:baseY, level:level, openings:openEdgeR, [tag]:true, __outerFaceLeft:outerFaceLeftR, __interiorLeft:interiorIsLeftR, roomId:(r.id||null) }); added[key2]=true; } }
      }
  try { var garages=Array.isArray(window.garageComponents)?window.garageComponents:[]; for (var gi=0; gi<garages.length; gi++){ var g=garages[gi]; if(!g) continue; var levelG=(g.level||0); var baseYG=levelG*3.5; var heightG=(typeof g.height==='number')?g.height:2.6; var hwg=(g.width||0)/2, hdg=(g.depth||0)/2; if(hwg<=0||hdg<=0) continue; var rot=((g.rotation||0)*Math.PI)/180; var cos=Math.cos(rot), sin=Math.sin(rot); function rotPtLocal(lx,lz){ var rx=lx*cos - lz*sin; var rz=lx*sin + lz*cos; return { x:(g.x||0)+rx, z:(g.z||0)+rz }; } var c0=rotPtLocal(-hwg,-hdg), c1=rotPtLocal(hwg,-hdg), c2=rotPtLocal(hwg,hdg), c3=rotPtLocal(-hwg,hdg); var polyG=[c0,c1,c2,c3]; var areaG=polySignedAreaXZ(polyG); var interiorIsLeftG=(areaG>0); var longerAxisG=((g.width||0)>=(g.depth||0))?'x':'z'; var edgesG=[[c0,c1],[c1,c2],[c2,c3],[c3,c0]]; for (var egi=0; egi<edgesG.length; egi++){ if(egi===0) continue; var E0=edgesG[egi][0], E1=edgesG[egi][1]; var keyG=keyFor(E0.x,E0.z,E1.x,E1.z); if(existing[keyG]||added[keyG]) continue; var edx=E1.x-E0.x, edz=E1.z-E0.z; var xDomG=Math.abs(edx)>=Math.abs(edz); var isOuterBiasG=(xDomG && longerAxisG==='x') || (!xDomG && longerAxisG==='z'); var outerFaceLeftG=isOuterBiasG?(!interiorIsLeftG):(interiorIsLeftG); window.wallStrips.push({ x0:E0.x, z0:E0.z, x1:E1.x, z1:E1.z, thickness:t, height:heightG, baseY:baseYG, level:levelG, openings:[], [tag]:true, __outerFaceLeft:outerFaceLeftG, __interiorLeft:interiorIsLeftG, garageId:(g.id||null) }); added[keyG]=true; } } } catch(_eGar) {}
      try { window.__lastPerimeterEdges = perimeterKeys; } catch(_eSavePk) {}
      try { if (typeof window.dedupeWallStrips==='function') window.dedupeWallStrips(); } catch(_eDd) {}
      try { var TOL=0.005; var stripsArr=Array.isArray(window.wallStrips)?window.wallStrips:[]; var endpoints=[]; for (var ui=0; ui<stripsArr.length; ui++){ var sU=stripsArr[ui]; if(!sU) continue; endpoints.push({ level:(sU.level||0), x:sU.x0||0, z:sU.z0||0, strip:sU, which:0 }); endpoints.push({ level:(sU.level||0), x:sU.x1||0, z:sU.z1||0, strip:sU, which:1 }); }
        endpoints.sort(function(a,b){ if(a.level!==b.level) return a.level-b.level; if(a.x!==b.x) return a.x-b.x; return a.z-b.z; });
        var clusters=[]; var current=[]; function flush(){ if(current.length>0){ clusters.push(current.slice()); current.length=0; } }
        for (var ei=0; ei<endpoints.length; ei++){ var e=endpoints[ei]; if(!current.length){ current.push(e); continue; } var last=current[current.length-1]; if(e.level===last.level){ var dx=e.x - last.x, dz=e.z - last.z; if(Math.hypot(dx,dz)<=TOL){ current.push(e); continue; } } flush(); current.push(e); }
        flush(); var merges=0; for (var ci=0; ci<clusters.length; ci++){ var cl=clusters[ci]; if(cl.length<2) continue; var sumX=0,sumZ=0; for (var cj=0; cj<cl.length; cj++){ sumX+=cl[cj].x; sumZ+=cl[cj].z; } var ax=Math.round((sumX/cl.length)*1000)/1000; var az=Math.round((sumZ/cl.length)*1000)/1000; for (var ck=0; ck<cl.length; ck++){ var m=cl[ck]; if(m.which===0){ m.strip.x0=ax; m.strip.z0=az; } else { m.strip.x1=ax; m.strip.z1=az; } } merges += (cl.length - 1); }
        try { if(merges>0 && typeof window.dedupeWallStrips==='function') window.dedupeWallStrips(); } catch(_eDd2) {}
        if(merges>0 && typeof window.__rtTracePush==='function'){ window.__rtTracePush({ kind:'engine-perimeter-unify', merges:merges, clusters:clusters.length, tolerance:TOL }); }
      } catch(_eUnify) {}
      if (typeof window.saveProjectSilently==='function') window.saveProjectSilently();
      if (typeof window.renderLoop==='function') window.renderLoop();
      var endLen = window.wallStrips.length;
      var added = Math.max(0, endLen - startLen);
      try { window.__lastPerimeterRebuildStats = { before: startLen, after: endLen, added: added, ts: Date.now() }; } catch(_eRStats) {}
      try { if (typeof window.__rtTracePush==='function') window.__rtTracePush({ kind:'perimeter-rebuild', added: added, before: startLen, after: endLen }); } catch(_eRTrace) {}
      if (window.__debugPerimeterMetrics){ console.log('[perimeter] rebuild added', added, '->', endLen); }
    } catch(_e) {}
  };

  // Utility: purge all wall strips intersecting a box on a level (used as coarse fallback after drags)
  if (typeof window.purgeWallStripsInBox === 'undefined') window.purgeWallStripsInBox = function(level, minX, minZ, maxX, maxZ){
    try {
      var before = (Array.isArray(window.wallStrips)? window.wallStrips.length : 0);
      function segIntersects(x0,z0,x1,z1){
        // Quick reject if both endpoints fully outside on same side
        if ((x0 < minX && x1 < minX) || (x0 > maxX && x1 > maxX) || (z0 < minZ && z1 < minZ) || (z0 > maxZ && z1 > maxZ)) return false;
        // If either endpoint inside -> intersects
        function inside(x,z){ return x>=minX && x<=maxX && z>=minZ && z<=maxZ; }
        if (inside(x0,z0) || inside(x1,z1)) return true;
        // Check intersection with box edges via parametric segment intersection
        function orient(ax,ay,bx,by,cx,cy){ var v=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax); return (v>0)?1:(v<0?-1:0); }
        function inter(ax,ay,bx,by,cx,cy,dx,dy){ var o1=orient(ax,ay,bx,by,cx,cy), o2=orient(ax,ay,bx,by,dx,dy), o3=orient(cx,cy,dx,dy,ax,ay), o4=orient(cx,cy,dx,dy,bx,by); if(o1!==o2 && o3!==o4) return true; return false; }
        if (inter(x0,z0,x1,z1, minX,minZ, maxX,minZ)) return true;
        if (inter(x0,z0,x1,z1, maxX,minZ, maxX,maxZ)) return true;
        if (inter(x0,z0,x1,z1, maxX,maxZ, minX,maxZ)) return true;
        if (inter(x0,z0,x1,z1, minX,maxZ, minX,minZ)) return true;
        return false;
      }
      window.wallStrips = (window.wallStrips||[]).filter(function(ws){ try { if(!ws) return false; if ((ws.level||0)!==level) return true; return !segIntersects(ws.x0||0, ws.z0||0, ws.x1||0, ws.z1||0); } catch(_e){ return true; } });
      var removed = before - (Array.isArray(window.wallStrips)? window.wallStrips.length : 0);
      if (removed>0){ try { if (typeof window.dedupeWallStrips==='function') window.dedupeWallStrips(); } catch(_d) {} try { if (typeof window.renderLoop==='function') window.renderLoop(); } catch(_r) {} }
      return removed;
    } catch(_e){ return 0; }
  };
})();
