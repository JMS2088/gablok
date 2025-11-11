// Render: Rooms and their resize handles
// Depends on globals from engine/app: ctx, project3D, computeHandleRadius, HANDLE_RADIUS,
// resizeHandles, selectedRoomId, currentFloor

function drawRoom(room) {
  try {
  // Preserve incoming canvas state so stroke styles/alphas don't leak or get clobbered
  if (ctx && typeof ctx.save === 'function') ctx.save();
  // Ensure a predictable baseline for stroke rendering regardless of prior modules
  try {
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    ctx.lineCap = 'butt';
  } catch(_eState){}
  // FOOTPRINT NORMALIZATION GUARD — VERY IMPORTANT: DO NOT DELETE
  // Multi‑wall (polygon) rooms produced by applying a complex 2D plan can sometimes
  // carry a footprint array with: (a) duplicate consecutive vertices, (b) collinear
  // midpoints inserted redundantly, or (c) reversed winding (CW vs CCW) depending on
  // authoring order. These issues can manifest visually as a perimeter outline that
  // appears "broken" or partially detached during a 3D drag because zero‑length or
  // overlapping edges collapse when projected and near‑plane clipping prunes them.
  // To guarantee the perimeter outline ALWAYS renders as a single closed, connected
  // loop while dragging or resizing, we sanitize the footprint once per frame when
  // a polygon room is drawn. This is intentionally lightweight and idempotent.
  // Safe operations performed:
  // 1. Remove consecutive duplicates (distance < EPS).
  // 2. Remove strictly collinear intermediate points (A,B,C aligned, B inside AC).
  // 3. Ensure minimum vertex count (>=3) before drawing.
  // 4. Normalize winding to counter‑clockwise (positive signed area) so other
  //    algorithms relying on orientation (openings mapping, extrusion) remain stable.
  // 5. Write back only if a change occurred (avoid churn for unchanged frames).
  // This guard is critical for maintaining the product requirement: perimeter line
  // is 100% connected and "locked" to the room during any interaction. DO NOT REMOVE.
  (function normalizeFootprintIfNeeded(){
    try {
      if (!room || !Array.isArray(room.footprint) || room.footprint.length < 3) return;
      var fp = room.footprint;
      var EPS = 1e-5;
      // Step 1: remove consecutive duplicates
      var dedup = [];
      for (var i=0;i<fp.length;i++){
        var p=fp[i]; if(!p) continue;
        if (dedup.length){ var prev=dedup[dedup.length-1]; var dx=p.x-prev.x, dz=p.z-prev.z; if(Math.abs(dx)<EPS && Math.abs(dz)<EPS) continue; }
        dedup.push({ x:p.x, z:p.z });
      }
      // If last equals first after dedup, remove last (we draw closed loop implicitly)
      if (dedup.length>1){ var f=dedup[0], l=dedup[dedup.length-1]; if (Math.abs(f.x-l.x)<EPS && Math.abs(f.z-l.z)<EPS) dedup.pop(); }
      // Step 2: remove collinear interior points (A-B-C aligned)
      function collinear(a,b,c){ var abx=b.x-a.x, abz=b.z-a.z, acx=c.x-a.x, acz=c.z-a.z; var cross=abx*acz - abz*acx; if (Math.abs(cross) > EPS) return false; // not collinear
        // check if b lies within bounding box of a & c
        var minX=Math.min(a.x,c.x)-EPS, maxX=Math.max(a.x,c.x)+EPS, minZ=Math.min(a.z,c.z)-EPS, maxZ=Math.max(a.z,c.z)+EPS; return (b.x>=minX && b.x<=maxX && b.z>=minZ && b.z<=maxZ);
      }
      var simplified=[]; for(var j=0;j<dedup.length;j++){ simplified.push(dedup[j]); }
      var changed=true; // iterate until no removal occurs (bounded by vertex count)
      var iter=0; while(changed && simplified.length>=3 && iter<8){
        changed=false; iter++; var out=[]; var N=simplified.length;
        for(var k=0;k<N;k++){
          var a=simplified[(k-1+N)%N], b=simplified[k], c=simplified[(k+1)%N];
          if (collinear(a,b,c)) { changed=true; continue; }
          out.push(b);
        }
        simplified=out;
      }
      // Step 3: ensure >=3
      if (simplified.length < 3) return; // fallback: let original render attempt handle (will skip gracefully)
      // Step 4: normalize winding CCW using signed area
      function signedArea(poly){ var A=0; for(var q=0;q<poly.length;q++){ var p1=poly[q], p2=poly[(q+1)%poly.length]; A += (p1.x*p2.z - p2.x*p1.z); } return A/2; }
      var area = signedArea(simplified);
      if (area < 0) simplified.reverse(); // make CCW
      // Decide if we should write back (compare counts & coordinate deltas)
      var write=false;
      if (simplified.length !== fp.length) write=true; else {
        for (var w=0; w<simplified.length; w++){ var o=fp[w], n=simplified[w]; if (!o || Math.abs(o.x-n.x)>EPS || Math.abs(o.z-n.z)>EPS){ write=true; break; } }
      }
      if (write){ room.footprint = simplified; }
    } catch(_normErr) { /* non-fatal */ }
  })();

  /*
   * ============================================================================
   * 3D ROOM WIREFRAME — VERY IMPORTANT: DO NOT DELETE
   * ----------------------------------------------------------------------------
   * This renderer draws the full 3D wireframe for rooms (base, verticals, top)
   * in BOTH render modes (Lines and Solid). Product requirement: the perimeter
   * outline must ALWAYS be visible to anchor user interactions (drag/resize),
   * prevent loss of spatial context, and avoid regressions where rooms appear
   * to “vanish”.
   *
   * Key guarantees:
   * - Base outline is always stroked (with near-plane fallbacks when needed).
   * - Vertical edges and top outline are always drawn for a full wireframe.
   * - Canvas state is saved/restored to prevent external style leakage.
   *
   * If you need to change visuals, adjust strokeStyle/lineWidth only. Do NOT
   * remove these strokes or the fallback logic; smoke tests and UX depend on it.
   * ============================================================================
   */
  var solidMode = (window.__wallRenderMode === 'solid');
  var lineMode = (window.__wallRenderMode !== 'solid');
  // Updated policy (20251111): Always draw the perimeter outline for the room so users
  // have stable visual feedback while dragging/resizing in BOTH render modes.
  // We still suppress the filled floor in solid mode to avoid the duplicate "ghost" planar fill.
  // (Previous logic suppressed wires entirely in solid mode which made outlines vanish.)
  var suppressFloorFill = !!solidMode; // keep floor fill suppression in solid mode
  var suppressWire = false; // NEVER suppress the base outline; vertical/top edges still gated below by mode
    // Helpers: near-plane clipping in camera space to keep floors/outlines visible without bending
    var kBlend = Math.max(0, Math.min(1, (typeof window.PERSPECTIVE_STRENGTH==='number'? window.PERSPECTIVE_STRENGTH:0.88)));
    var refZ = Math.max(0.5, (camera && camera.distance) || 12);
    var P = (typeof window.__proj==='object' && window.__proj) || null;
    var scalePx = (P && P.scale) || 600;
    var nearEps = 0.01;
    function toCam(p){
      // world -> camera space coordinates
      if (!P) return null;
      var rx = p.x - P.cam[0], ry = p.y - P.cam[1], rz = p.z - P.cam[2];
      return {
        cx: rx*P.right[0] + ry*P.right[1] + rz*P.right[2],
        cy: rx*P.up[0]    + ry*P.up[1]    + rz*P.up[2],
        cz: rx*P.fwd[0]   + ry*P.fwd[1]   + rz*P.fwd[2]
      };
    }
    function camToScreen(v){
      if (!v) return null;
      var czEff = v.cz * kBlend + refZ * (1 - kBlend);
      var s = scalePx / czEff;
      return { x: (canvas.width/2) + (v.cx * s) + pan.x, y: (canvas.height/2) - (v.cy * s) + pan.y };
    }
    function clipSegmentNear(a, b){
      if(!a||!b) return null;
      var az=a.cz, bz=b.cz; var A=a, B=b;
      var ina = az >= nearEps, inb = bz >= nearEps;
      if (ina && inb) return [A,B];
      if (!ina && !inb) return null;
      // compute intersection t with cz=nearEps plane in camera space along segment A->B
      var t = (nearEps - az) / ((bz - az) || 1e-9);
      var I = { cx: A.cx + (B.cx - A.cx)*t, cy: A.cy + (B.cy - A.cy)*t, cz: nearEps };
      if (ina) return [A, I]; else return [I, B];
    }
    function clipPolyNear(camPts){
      // Sutherland–Hodgman against cz >= nearEps
      var out = [];
      if (!camPts || camPts.length === 0) return out;
      var prev = camPts[camPts.length - 1]; var prevIn = prev.cz >= nearEps;
      for (var i=0;i<camPts.length;i++){
        var cur = camPts[i]; var curIn = cur.cz >= nearEps;
        if (curIn){
          if (!prevIn){
            // entering; add intersection
            var t = (nearEps - prev.cz)/((cur.cz - prev.cz)||1e-9);
            out.push({ cx: prev.cx + (cur.cx - prev.cx)*t, cy: prev.cy + (cur.cy - prev.cy)*t, cz: nearEps });
          }
          out.push(cur);
        } else if (prevIn){
          // exiting; add intersection
          var t2 = (nearEps - prev.cz)/((cur.cz - prev.cz)||1e-9);
          out.push({ cx: prev.cx + (cur.cx - prev.cx)*t2, cy: prev.cy + (cur.cy - prev.cy)*t2, cz: nearEps });
        }
        prev = cur; prevIn = curIn;
      }
      return out;
    }
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
      // High-contrast strokes for current floor to ensure visibility
      ctx.strokeStyle = selected ? '#0ea5e9' : '#111827';
      ctx.lineWidth = selected ? 3 : 2.5;
      ctx.globalAlpha = 1.0;
    } else {
      // Off-floor: slightly lighter but still visible
      ctx.strokeStyle = selected ? '#0ea5e9' : '#6b7280';
      ctx.lineWidth = selected ? 2.25 : 1.5;
      ctx.globalAlpha = 0.75;
    }
    
    if (!hasFootprint) {
      // Draw rectangular room with near-plane clipping for edges and floor
      var basePts = [0,1,2,3].map(function(i){ return corners[i]; });
      var topPts = [4,5,6,7].map(function(i){ return corners[i]; });
      // Floor fill (base quad) clipped
      var baseCam = basePts.map(function(p){ return toCam(p); }).filter(Boolean);
      var baseClip = clipPolyNear(baseCam);
      if (baseClip.length >= 3){
        if (!suppressFloorFill) {
          // fill
          ctx.beginPath(); var s0 = camToScreen(baseClip[0]); if(s0){ ctx.moveTo(s0.x, s0.y); }
          for (var bi=1; bi<baseClip.length; bi++){ var sb = camToScreen(baseClip[bi]); if(sb){ ctx.lineTo(sb.x, sb.y); } }
          ctx.closePath();
          // choose fill like below (currentLevel/selected already set)
          if (currentLevel) {
            ctx.fillStyle = selected ? 'rgba(0,122,204,0.18)' : 'rgba(120,120,120,0.10)';
          } else if (selected && room.level !== currentFloor) {
            ctx.fillStyle = 'rgba(0,122,204,0.18)';
          } else {
            ctx.fillStyle = 'rgba(180,180,180,0.10)';
          }
          ctx.fill();
        }
        // outline (skip only while actively dragging in solid mode)
        if (!suppressWire) {
          ctx.beginPath(); var so = camToScreen(baseClip[0]); if(so){ ctx.moveTo(so.x, so.y); }
          for (var bo=1; bo<baseClip.length; bo++){ var sb2 = camToScreen(baseClip[bo]); if(sb2){ ctx.lineTo(sb2.x, sb2.y); } }
          ctx.closePath(); ctx.stroke();
          try { window.__roomOutlineDrawCount = (window.__roomOutlineDrawCount||0) + 1; } catch(_eCnt0) {}
        }
      }
      // Fallback: if clipping removed the whole base (camera extremely close), still stroke raw projected rectangle
      else if (!suppressWire) {
        try {
          var p0 = project3D(basePts[0].x, basePts[0].y, basePts[0].z);
          var p1 = project3D(basePts[1].x, basePts[1].y, basePts[1].z);
          var p2 = project3D(basePts[2].x, basePts[2].y, basePts[2].z);
          var p3 = project3D(basePts[3].x, basePts[3].y, basePts[3].z);
          if (p0 && p1 && p2 && p3) {
            ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.closePath(); ctx.stroke();
          }
        } catch(_eRectFallback) {}
      }
      // Edges: FULL 3D WIREFRAME in all modes (draw base, verticals, and top)
      if (!suppressWire) {
        var edges = [ [0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4], [0,4],[1,5],[2,6],[3,7] ];
        for (var eIdx=0; eIdx<edges.length; eIdx++){
          var e = edges[eIdx]; var a3=corners[e[0]], b3=corners[e[1]];
          var ac = toCam(a3), bc = toCam(b3); var seg = clipSegmentNear(ac, bc); if(!seg) continue;
          var A2 = camToScreen(seg[0]), B2 = camToScreen(seg[1]); if(!A2||!B2) continue; ctx.beginPath(); ctx.moveTo(A2.x,A2.y); ctx.lineTo(B2.x,B2.y); ctx.stroke();
        }
      }
    } else {
      // Draw polygonal room: base (floor) fill, side outlines, and top outline
      var topY = roomFloorY + room.height;
      // Project base and top vertices
      var baseCam = [], topCam = [];
      for (var vi=0; vi<room.footprint.length; vi++){
        var p = room.footprint[vi];
        var bc = toCam({x:p.x,y:roomFloorY,z:p.z}); var tc = toCam({x:p.x,y:topY,z:p.z});
        if (bc) baseCam.push(bc); if (tc) topCam.push(tc);
      }
      // Fill base (floor) polygon with near-plane clipping
      var baseClip = clipPolyNear(baseCam);
      if (baseClip.length >= 3){
        if (!suppressFloorFill) {
          if (currentLevel) {
            ctx.fillStyle = selected ? 'rgba(0,122,204,0.18)' : 'rgba(120,120,120,0.10)';
          } else if (selected && room.level !== currentFloor) {
            ctx.fillStyle = 'rgba(0,122,204,0.18)';
          } else {
            ctx.fillStyle = 'rgba(180,180,180,0.10)';
          }
          ctx.beginPath(); var b0 = camToScreen(baseClip[0]); if(b0){ ctx.moveTo(b0.x, b0.y); }
          for (var bi=1; bi<baseClip.length; bi++){ var sb = camToScreen(baseClip[bi]); if(sb){ ctx.lineTo(sb.x, sb.y); } }
          ctx.closePath();
          ctx.fill();
        }
        // Base outline — skip only while actively dragging in solid mode
        if (!suppressWire) {
          ctx.beginPath(); var b1 = camToScreen(baseClip[0]); if(b1){ ctx.moveTo(b1.x, b1.y); }
          for (var bo=1; bo<baseClip.length; bo++){ var sb2 = camToScreen(baseClip[bo]); if(sb2){ ctx.lineTo(sb2.x, sb2.y); } }
          ctx.closePath();
          ctx.stroke();
          try { window.__roomOutlineDrawCount = (window.__roomOutlineDrawCount||0) + 1; } catch(_eCnt1) {}
        }
      }
      // Polygon fallback (same reasoning as rectangle): ensure outline visible if near-plane clipping discards all points
      else if (!suppressWire && Array.isArray(room.footprint) && room.footprint.length >= 3) {
        try {
          var firstProj = null;
          ctx.beginPath();
          for (var fpi=0; fpi<room.footprint.length; fpi++) {
            var pRaw = room.footprint[fpi];
            var pScr = project3D(pRaw.x, roomFloorY, pRaw.z);
            if (!pScr) continue;
            if (!firstProj) { ctx.moveTo(pScr.x, pScr.y); firstProj = pScr; }
            else { ctx.lineTo(pScr.x, pScr.y); }
          }
          if (firstProj) { ctx.closePath(); ctx.stroke(); }
          try { if (firstProj) window.__roomOutlineDrawCount = (window.__roomOutlineDrawCount||0) + 1; } catch(_eCnt2) {}
        } catch(_ePolyFallback) {}
      }
      // Top outline (clipped) — ALWAYS draw for full 3D wireframe, regardless of mode
      var topClip = clipPolyNear(topCam);
      if (!suppressWire && topClip.length >= 2){
        ctx.beginPath(); var t0 = camToScreen(topClip[0]); if(t0){ ctx.moveTo(t0.x, t0.y); }
        for (var ti=1; ti<topClip.length; ti++){ var st = camToScreen(topClip[ti]); if(st){ ctx.lineTo(st.x, st.y); } }
        ctx.closePath(); ctx.stroke();
      }
      // Side edges (vertical) — ALWAYS draw for full 3D wireframe
      if (!suppressWire) {
        for (var si=0; si<room.footprint.length; si++){
          var pt = room.footprint[si];
          var ac = toCam({x:pt.x,y:roomFloorY,z:pt.z});
          var bc = toCam({x:pt.x,y:topY,z:pt.z});
          var seg = clipSegmentNear(ac, bc); if(!seg) continue; var A = camToScreen(seg[0]), B = camToScreen(seg[1]); if(!A||!B) continue;
          ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.stroke();
        }
      }
    }
    
    // Rectangle case floor fill moved above during clipping

  try { if (typeof drawHandlesForRoom === 'function') drawHandlesForRoom(room); } catch(e) {}
  // Restore canvas state for subsequent draws
  if (ctx && typeof ctx.restore === 'function') ctx.restore();

    // Draw openings (doors/windows) with full rectangular outline at correct sill/height
    // NOTE: Temporarily suppressed in solid wall render mode to diagnose persistent "ghost" outline layer.
    // If the phantom perimeter disappears with this suppression, the openings overlay was the duplicate source.
    try {
      if (!solidMode && Array.isArray(room.openings) && room.openings.length) {
        var hw2 = room.width / 2; var hd2 = room.depth / 2;
        var yBase = roomFloorY; // floor level
        // Precompute the room's top Y to clamp full-height openings safely
        var roomTopY = roomFloorY + (typeof room.height === 'number' ? room.height : 3.0);
        for (var oi=0; oi<room.openings.length; oi++){
          var op = room.openings[oi]; if(!op) continue;
          // Determine base and top Y positions using sill/height
          var sill = (op.type==='window') ? ((typeof op.sillM==='number') ? op.sillM : 1.0) : 0;
          var oH = (typeof op.heightM==='number') ? op.heightM : ((op.type==='door') ? 2.04 : 1.5);
          var y0 = yBase + sill;
          // Clamp to the room's ceiling to ensure "floor-to-ceiling" spans don't exceed room height
          var y1 = Math.min(y0 + oH, roomTopY);
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
              // Draw blue keyline for floor-to-ceiling windows (bottom-right -> top-left)
              try {
                if (op.type === 'window'){
                  var isFull = (Math.abs((sill||0)) < 1e-3) && (Math.abs((y1) - roomTopY) < 1e-3);
                  if (isFull){
                    ctx.beginPath();
                    ctx.strokeStyle = '#38bdf8';
                    ctx.lineWidth = currentLevel ? 2 : 1.4;
                    // bottom-right (B) to top-left (D)
                    ctx.moveTo(sB.x, sB.y);
                    ctx.lineTo(sD.x, sD.y);
                    ctx.stroke();
                  }
                }
              } catch(_eline){}
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
    if (window.__useUnifiedHUDHandles) return; // unified HUD draws handles
    // Show handles only for the actively selected object
    if (!window.selectedRoomId || window.selectedRoomId !== room.id) return;
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
      (function(){ var p=rotPoint(0, -hd); return {x:p.x, y:handleY, z:p.z, type:'depth-', label:'Z-'}; })(),
      // Center MOVE handle (new) — restricts room translation to explicit handle usage
      (function(){ return {x:room.x, y:handleY, z:room.z, type:'move', label:'⟳'}; })()
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
