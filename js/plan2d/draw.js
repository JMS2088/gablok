// Plan2D draw routines (extracted from editor.js)
// Defines: plan2dDraw, plan2dDrawRulers, plan2dHitGuideAtScreen
(function(){
  // Coalesced draw scheduling: multiple calls collapse into one animation frame.
  var __plan2dDrawPending = false;
  function plan2dDrawImmediate(){ var c=document.getElementById('plan2d-canvas'); var ov=document.getElementById('plan2d-overlay'); if(!c||!ov) return; var ctx=c.getContext('2d'); var ovCtx=ov.getContext('2d'); var ox=ovCtx; ctx.setTransform(1,0,0,1,0,0);
    // CAD MODE BACKGROUND: if body has class 'cad-mode', enforce pure white canvas clear instead of dark theme.
    var cadMode = false; try { cadMode = document.body && document.body.classList.contains('cad-mode'); } catch(_cad) {}
    // ------------------------------------------------------------------
    // Per-frame profiling counters (reset at frame start)
    try {
      __plan2d.__frameCounter = (__plan2d.__frameCounter||0)+1;
      __plan2d.__frameProfile = {
        wallsConsidered:0,
        wallsSkipped:0,
        wallSegments:0,
        openingsConsidered:0,
        openingsSkipped:0,
        measureNew:0,
        measureHit:0,
        labelTexts:0,
        dirtyPixelPct:0,
        dirtyPixelArea:0,
        dirtyWorldArea:0,
        elementsTotal:(__plan2d.elements?__plan2d.elements.length:0)
      };
    }catch(_pfInit){}
    // Dynamic performance budget tuning (adaptive to previous frame cost & element count)
    try {
      var elemCount = (__plan2d.elements? __plan2d.elements.length: 0);
      // Base budget scales down as count grows to avoid O(n) label floods
      var baseLimit = 220; // slightly higher initial budget
      if (elemCount > 1200) baseLimit = 80; else if (elemCount > 800) baseLimit = 110; else if (elemCount > 500) baseLimit = 150; else if (elemCount > 300) baseLimit = 190;
      // If last draw was expensive, throttle further
      var lowQualityMode = false;
      if (__plan2d.__lastDrawMs && __plan2d.__lastDrawMs > 16) { lowQualityMode = true; }
      if (__plan2d.__lastDrawMs && __plan2d.__lastDrawMs > 20) baseLimit = Math.min(baseLimit, 120);
      if (__plan2d.__lastDrawMs && __plan2d.__lastDrawMs > 32) baseLimit = Math.min(baseLimit, 90);
      // Allow external override (for perf experiments) via __measureLimitOverride
      if (typeof __plan2d.__measureLimitOverride === 'number' && __plan2d.__measureLimitOverride >= 0) baseLimit = __plan2d.__measureLimitOverride;
      __plan2d.__measureLimit = baseLimit;
      __plan2d.__measureCount = 0;
    } catch(_lim) {}
    // Incremental redraw: if a dirtyRect is present and flagged incremental, only clear that region with padding
    // Incremental region draw activation heuristics: enable incremental if dirty rect covers <40% pixels
    var useDirty = false;
    try {
      if (__plan2d.__incremental && __plan2d.dirtyRect) {
        var dr = __plan2d.dirtyRect; var cArea = (c.width||1)*(c.height||1);
        var aS = worldToScreen2D(dr.minX, dr.minY); var bS = worldToScreen2D(dr.maxX, dr.maxY);
        var wSX = Math.abs(bS.x - aS.x); var hSY = Math.abs(bS.y - aS.y);
        var pxArea = wSX * hSY;
        var pct = pxArea / Math.max(1, cArea);
        if (pct < 0.40) useDirty = true; else __plan2d.__incremental = false; // too big; fall back to full clear
      }
    } catch(_heur) {}
    var clearPadPx = 40; // pad in pixels for stroke/joins
    if(useDirty){
      try{
        // Convert world bbox to screen bbox
        var aS = worldToScreen2D(__plan2d.dirtyRect.minX, __plan2d.dirtyRect.minY);
        var bS = worldToScreen2D(__plan2d.dirtyRect.maxX, __plan2d.dirtyRect.maxY);
        var minSX = Math.min(aS.x, bS.x) - clearPadPx;
        var minSY = Math.min(aS.y, bS.y) - clearPadPx;
        var wSX = Math.abs(bS.x - aS.x) + clearPadPx*2;
        var hSY = Math.abs(bS.y - aS.y) + clearPadPx*2;
        if(cadMode){ ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.fillStyle='#ffffff'; ctx.fillRect(minSX, minSY, wSX, hSY); ctx.restore(); }
        else { ctx.clearRect(minSX, minSY, wSX, hSY); }
        ovCtx.setTransform(1,0,0,1,0,0);
        ovCtx.clearRect(minSX, minSY, wSX, hSY);
        try {
          var pxArea = Math.max(0,wSX) * Math.max(0,hSY);
          var totalPx = (c.width||1)*(c.height||1);
            __plan2d.__frameProfile.dirtyPixelArea = pxArea;
            __plan2d.__frameProfile.dirtyPixelPct = Math.min(100, (pxArea / Math.max(1,totalPx))*100);
            var worldW = (c.width/(__plan2d.scale||50));
            var worldH = (c.height/(__plan2d.scale||50));
            __plan2d.__frameProfile.dirtyWorldArea = ( (__plan2d.dirtyRect.maxX-__plan2d.dirtyRect.minX) * (__plan2d.dirtyRect.maxY-__plan2d.dirtyRect.minY) );
        }catch(_pfDirty){}
      }catch(_cdr){ ctx.clearRect(0,0,c.width,c.height); ovCtx.setTransform(1,0,0,1,0,0); ovCtx.clearRect(0,0,ov.width,ov.height); useDirty=false; }
    } else {
      // Full clear path (optimize by using fill instead of clearRect which can trigger full layer invalidation)
      if(cadMode){ ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,c.width,c.height); ctx.restore(); }
      else { ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,c.width,c.height); ctx.restore(); }
      ovCtx.setTransform(1,0,0,1,0,0); ovCtx.clearRect(0,0,ov.width,ov.height);
    }
    var perfSections = __plan2d.__perfSections = { grid:0, walls:0, openings:0, labels:0, overlay:0, total:0 };
    var tStart = (performance&&performance.now)?performance.now():Date.now();
      // Rulers (top/left): resize if needed, then redraw every frame to avoid vanish/flicker.
      try {
        var rt=document.getElementById('plan2d-ruler-top');
        var rl=document.getElementById('plan2d-ruler-left');
        if(rt && rl){
          var dpr = window.devicePixelRatio || 1;
          var rtb = rt.getBoundingClientRect();
          var rlb = rl.getBoundingClientRect();
          // Keep rulers locked to their CSS size (edge-to-edge) with no shrink on zoom or button presses
          var targetTopW = Math.max(1, Math.round(rtb.width * dpr));
          var targetTopH = Math.max(1, Math.round(rtb.height * dpr));
          var targetLeftW = Math.max(1, Math.round(rlb.width * dpr));
          var targetLeftH = Math.max(1, Math.round(rlb.height * dpr));
          if(rt.width !== targetTopW || rt.height !== targetTopH){ rt.width = targetTopW; rt.height = targetTopH; }
          if(rl.width !== targetLeftW || rl.height !== targetLeftH){ rl.width = targetLeftW; rl.height = targetLeftH; }
          plan2dDrawRulers(rt.getContext('2d'), rl.getContext('2d'));
        }
      } catch(_eR) {}
  // Grid: adapt appearance in CAD mode (light gray lines on white) or dark mode (existing slate scheme)
      var step=__plan2d.scale, w=c.width, h=c.height; 
      var originX = w/2 + (__plan2d.panX * step), originY = h/2 - (__plan2d.panY * step);
      // Grid: use a small repeating pattern (avoids allocating a full-size offscreen canvas)
      (function(){
        try {
          var gridCache = __plan2d.__gridCache || (__plan2d.__gridCache = {});
          var minorStepWorld = 0.1;
          var minorStepPx = step * minorStepWorld;
          var minorEnabled = minorStepPx >= 8;

          // Build (or rebuild) the pattern when zoom/theme changes
          var base = 100; // base px per 1m inside the pattern tile
          var scaleFactor = step / base;
          var canPatternTransform = false;

          if (!gridCache._patternChecked) {
            gridCache._patternChecked = true;
            try {
              var pTest = ctx.createPattern(document.createElement('canvas'), 'repeat');
              canPatternTransform = !!(pTest && typeof pTest.setTransform === 'function');
            } catch(_eP) { canPatternTransform = false; }
            gridCache._canPatternTransform = canPatternTransform;
          }
          canPatternTransform = !!gridCache._canPatternTransform;

          var needsPattern = !gridCache.pattern || gridCache.scale !== step || gridCache.cadMode !== cadMode || gridCache.minorEnabled !== minorEnabled;
          if (needsPattern && canPatternTransform) {
            var tile = gridCache.tile || (gridCache.tile = document.createElement('canvas'));
            tile.width = base;
            tile.height = base;
            var gctx = tile.getContext('2d');
            gctx.setTransform(1,0,0,1,0,0);
            gctx.clearRect(0,0,base,base);
            gctx.save();
            gctx.lineWidth = 1;

            if (minorEnabled) {
              gctx.strokeStyle = cadMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
              var minorStep = base / 10;
              for (var i=1; i<10; i++) {
                var x = i*minorStep + 0.5;
                gctx.beginPath(); gctx.moveTo(x,0); gctx.lineTo(x,base); gctx.stroke();
                var y = i*minorStep + 0.5;
                gctx.beginPath(); gctx.moveTo(0,y); gctx.lineTo(base,y); gctx.stroke();
              }
            }

            // Major (1m) lines at tile origin only; repetition creates the full grid.
            gctx.strokeStyle = cadMode ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.10)';
            gctx.beginPath(); gctx.moveTo(0.5,0); gctx.lineTo(0.5,base); gctx.stroke();
            gctx.beginPath(); gctx.moveTo(0,0.5); gctx.lineTo(base,0.5); gctx.stroke();

            gctx.restore();

            var pat = ctx.createPattern(tile, 'repeat');
            if (pat && typeof pat.setTransform === 'function') {
              pat.setTransform(new DOMMatrix().scale(scaleFactor, scaleFactor));
            }
            gridCache.pattern = pat;
            gridCache.scale = step;
            gridCache.cadMode = cadMode;
            gridCache.minorEnabled = minorEnabled;
          }

          // Paint grid (either full frame or dirty slice) aligned to world origin
          if (gridCache.pattern && canPatternTransform) {
            ctx.save();
            ctx.setTransform(1,0,0,1,0,0);
            ctx.translate(originX, originY);
            ctx.fillStyle = gridCache.pattern;

            if (useDirty) {
              var aS = worldToScreen2D(__plan2d.dirtyRect.minX, __plan2d.dirtyRect.minY);
              var bS = worldToScreen2D(__plan2d.dirtyRect.maxX, __plan2d.dirtyRect.maxY);
              var minSX = Math.min(aS.x, bS.x) - clearPadPx;
              var minSY = Math.min(aS.y, bS.y) - clearPadPx;
              var wSX = Math.abs(bS.x - aS.x) + clearPadPx*2;
              var hSY = Math.abs(bS.y - aS.y) + clearPadPx*2;
              ctx.fillRect(minSX - originX, minSY - originY, wSX, hSY);
            } else {
              ctx.fillRect(-originX, -originY, w, h);
            }
            ctx.restore();

            // Central axes (world 0,0) emphasized
            ctx.save();
            ctx.setTransform(1,0,0,1,0,0);
            ctx.lineWidth = 1;
            ctx.strokeStyle = cadMode ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.16)';
            ctx.beginPath(); ctx.moveTo(originX + 0.5,0); ctx.lineTo(originX + 0.5,h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,originY + 0.5); ctx.lineTo(w,originY + 0.5); ctx.stroke();
            ctx.restore();
          } else {
            // Fallback: draw grid directly (no large offscreen allocation)
            ctx.save();
            ctx.setTransform(1,0,0,1,0,0);
            ctx.lineWidth = 1;
            var worldLeft = screenToWorld2D(0,0).x;
            var worldRight = screenToWorld2D(w,0).x;
            var worldTop = screenToWorld2D(0,0).y;
            var worldBottom = screenToWorld2D(0,h).y;

            if(minorEnabled){
              ctx.strokeStyle = cadMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
              var startMinorX = Math.ceil(worldLeft/minorStepWorld)*minorStepWorld;
              for(var wx=startMinorX; wx<=worldRight; wx+=minorStepWorld){
                if(Math.abs(wx - Math.round(wx)) < 1e-6) continue;
                var sx = worldToScreen2D(wx,0).x + 0.5;
                ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,h); ctx.stroke();
              }
              var startMinorY = Math.ceil(worldBottom/minorStepWorld)*minorStepWorld;
              for(var wy=startMinorY; wy<=worldTop; wy+=minorStepWorld){
                if(Math.abs(wy - Math.round(wy)) < 1e-6) continue;
                var sy = worldToScreen2D(0,wy).y + 0.5;
                ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(w,sy); ctx.stroke();
              }
            }
            ctx.strokeStyle = cadMode ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.10)';
            var startMajorX = Math.ceil(worldLeft);
            for(var mx=startMajorX; mx<=worldRight; mx+=1){
              var sxM = worldToScreen2D(mx,0).x + 0.5;
              ctx.beginPath(); ctx.moveTo(sxM,0); ctx.lineTo(sxM,h); ctx.stroke();
            }
            var startMajorY = Math.ceil(worldBottom);
            for(var my=startMajorY; my<=worldTop; my+=1){
              var syM = worldToScreen2D(0,my).y + 0.5;
              ctx.beginPath(); ctx.moveTo(0,syM); ctx.lineTo(w,syM); ctx.stroke();
            }
            ctx.strokeStyle = cadMode ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.16)';
            ctx.beginPath(); ctx.moveTo(originX + 0.5,0); ctx.lineTo(originX + 0.5,h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,originY + 0.5); ctx.lineTo(w,originY + 0.5); ctx.stroke();
            ctx.restore();
          }
        } catch(e){ /* grid fallback */ }
      })();
      perfSections.grid = ((performance&&performance.now)?performance.now():Date.now()) - tStart;
  // Preview: multi-point wall chain (polyline) when active
      try {
        if(__plan2d.tool==='wall' && __plan2d.chainActive && Array.isArray(__plan2d.chainPoints) && __plan2d.chainPoints.length){
          var pts = __plan2d.chainPoints;
          // Draw existing segments
          ctx.save();
          ctx.strokeStyle = '#64748b'; // slate-500
          ctx.lineWidth = 2;
          for(var pi=0; pi<pts.length-1; pi++){
            var aP = worldToScreen2D(pts[pi].x, pts[pi].y);
            var bP = worldToScreen2D(pts[pi+1].x, pts[pi+1].y);
            ctx.beginPath(); ctx.moveTo(aP.x, aP.y); ctx.lineTo(bP.x, bP.y); ctx.stroke();
          }
          // Live segment to current mouse
          if(__plan2d.mouse && pts.length){
            var lastPt = pts[pts.length-1];
            var mW = screenToWorld2D(__plan2d.mouse.x, __plan2d.mouse.y);
            var snapX = plan2dSnapX(mW.x);
            var snapY = plan2dSnapY(mW.y);
            var axisLock = null;
            if(__plan2d.shiftAxisLock){
              axisLock = __plan2d.__chainAxisLock;
              if(!axisLock){
                axisLock = (Math.abs(snapX - lastPt.x) >= Math.abs(snapY - lastPt.y)) ? 'h' : 'v';
                __plan2d.__chainAxisLock = axisLock;
              }
            } else {
              if(__plan2d.__chainAxisLock) __plan2d.__chainAxisLock = null;
            }
            var targetX = snapX;
            var targetY = snapY;
            if(axisLock === 'h'){ targetY = lastPt.y; }
            else if(axisLock === 'v'){ targetX = lastPt.x; }
            else {
              if(Math.abs(snapX - lastPt.x) >= Math.abs(snapY - lastPt.y)) targetY = lastPt.y;
              else targetX = lastPt.x;
            }
            var mS = worldToScreen2D(targetX, targetY);
            var last = worldToScreen2D(lastPt.x, lastPt.y);
            ctx.setLineDash([6,4]); ctx.strokeStyle = '#0ea5e9'; // sky-600
            ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(mS.x, mS.y); ctx.stroke(); ctx.setLineDash([]);
          }
          // Vertex handles
          for(var pj=0; pj<pts.length; pj++){
            var pS = worldToScreen2D(pts[pj].x, pts[pj].y);
            ctx.beginPath(); ctx.fillStyle = '#f59e0b'; ctx.strokeStyle='rgba(15,23,42,0.8)'; ctx.lineWidth=2; // amber-500
            ctx.arc(pS.x, pS.y, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
          }
          ctx.restore();
        }
      } catch(e) { /* non-fatal chain preview */ }
      
      // Room footprint fills removed by request: no alpha floor planes in 2D
  // Elements
  var tWallsStart = (performance&&performance.now)?performance.now():Date.now();
      // Precompute connections at endpoints to extend walls and make corners flush
      var elems=__plan2d.elements;
      // Precompute wall intersections (cached per edit version) to enable sub-segment selection/deletion
      var __wallIntersections;
      try{
        var cache = __plan2d.__cache || (__plan2d.__cache = {});
        if(!cache.intersections || cache.version !== (__plan2d.__version||0)){
          cache.intersections = plan2dComputeWallIntersections(elems);
          cache.version = (__plan2d.__version||0);
        }
        __wallIntersections = cache.intersections;
      }catch(_cInt){ __wallIntersections = plan2dComputeWallIntersections(elems); }
      // Robust endpoint connectivity map (skip any undefined/invalid entries to avoid TypeErrors)
      var startConn=new Array(elems.length).fill(false), endConn=new Array(elems.length).fill(false);
      (function(){
        function key(x,y){ return (Math.round(x*1000))+','+(Math.round(y*1000)); }
        var map={};
        for(var i=0;i<elems.length;i++){
          var e=elems[i];
          if(!e || e.type!=='wall') continue; // Defensive: skip holes or non-walls
          // Validate numeric endpoints (NaN walls can arise from partial edits)
          if(!isFinite(e.x0)||!isFinite(e.y0)||!isFinite(e.x1)||!isFinite(e.y1)) continue;
          var ks=key(e.x0,e.y0), ke=key(e.x1,e.y1);
          (map[ks]||(map[ks]=[])).push({i:i,end:'s'});
          (map[ke]||(map[ke]=[])).push({i:i,end:'e'});
        }
        Object.keys(map).forEach(function(k){ var arr=map[k]; if(arr.length>1){ for(var j=0;j<arr.length;j++){ var ent=arr[j]; if(!ent) continue; if(ent.end==='s') startConn[ent.i]=true; else endConn[ent.i]=true; } } });
      })();
      // If incremental, only draw elements that intersect dirty rect (expanded by thickness)
      var drawAll = !useDirty;
      var dirtyW = __plan2d.dirtyRect;
      function wallIntersectsDirty(el){
        if(!dirtyW) return true;
        var minX = Math.min(el.x0, el.x1), maxX = Math.max(el.x0, el.x1);
        var minY = Math.min(el.y0, el.y1), maxY = Math.max(el.y0, el.y1);
        // expand by wall thickness to catch edges
        var pad = (el.thickness||__plan2d.wallThicknessM)||0.3;
        minX -= pad; maxX += pad; minY -= pad; maxY += pad;
        return !(maxX < dirtyW.minX || dirtyW.maxX < minX || maxY < dirtyW.minY || dirtyW.maxY < minY);
      }
      // Precompute host-anchored opening spans per wall (cached by plan version)
      var elemsVersion = (__plan2d.__version||0);
      var hostSpansCache = __plan2d.__hostOpeningSpans;
      if(!hostSpansCache || __plan2d.__hostOpeningSpansVersion !== elemsVersion){
        hostSpansCache = new Array(elems.length);
        // Initialize arrays only for walls; avoid sparse lookup cost later
        for(var wiInit=0; wiInit<elems.length; wiInit++){ var wEl=elems[wiInit]; if(wEl && wEl.type==='wall') hostSpansCache[wiInit]=[]; }
        // Collect host-anchored windows/doors into their wall lists
        for(var oi=0; oi<elems.length; oi++){
          var oEl = elems[oi]; if(!oEl) continue; if(oEl.type!=='window' && oEl.type!=='door') continue;
          if(typeof oEl.host==='number' && elems[oEl.host] && elems[oEl.host].type==='wall'){
            var hw = oEl.host;
            var ot0 = Math.max(0, Math.min(1, oEl.t0||0));
            var ot1 = Math.max(0, Math.min(1, oEl.t1||0));
            if(ot1 < ot0){ var tmpSwap=ot0; ot0=ot1; ot1=tmpSwap; }
            if(hostSpansCache[hw]) hostSpansCache[hw].push([ot0, ot1]);
          }
        }
        // Sort and merge spans for each wall NOW to avoid per-wall recompute inside draw loop
        for(var mw=0; mw<hostSpansCache.length; mw++){
          var list = hostSpansCache[mw]; if(!list || list.length<2) continue;
          list.sort(function(A,B){ return A[0]-B[0]; });
          var mergedArr=[]; for(var li=0; li<list.length; li++){ var s=list[li]; if(mergedArr.length===0) mergedArr.push(s); else { var last=mergedArr[mergedArr.length-1]; if(s[0] <= last[1] + 1e-4){ last[1]=Math.max(last[1], s[1]); } else mergedArr.push([s[0], s[1]]); } }
          hostSpansCache[mw]=mergedArr;
        }
        __plan2d.__hostOpeningSpans = hostSpansCache; __plan2d.__hostOpeningSpansVersion = elemsVersion;
      }
      // Build list of free openings (non-host) once; still requires per-wall projection but reduces scanning of host ones
      var freeOpenings = [];
      for(var foi=0; foi<elems.length; foi++){
        var fEl = elems[foi]; if(!fEl) continue; if(fEl.type!=='window' && fEl.type!=='door') continue; if(typeof fEl.host==='number') continue; freeOpenings.push(fEl);
      }
      for(var i=0;i<elems.length;i++){
        var el=elems[i];
        if(!el){ continue; } // Defensive: skip holes/undefined to avoid x0 access errors
        // Profiling counts
        if(el.type==='wall') __plan2d.__frameProfile.wallsConsidered++;
        else if(el.type==='window' || el.type==='door') __plan2d.__frameProfile.openingsConsidered++;
        if(!drawAll){ if(el.type==='wall'){ if(!wallIntersectsDirty(el)){ try{ __plan2d.__frameProfile.wallsSkipped++; }catch(_skw){}; continue; } } else {
            // For doors/windows anchored to a wall, check host wall bbox; else check element endpoints
            if(typeof el.host==='number' && elems[el.host] && elems[el.host].type==='wall'){ if(!wallIntersectsDirty(elems[el.host])){ try{ __plan2d.__frameProfile.openingsSkipped++; }catch(_sko1){}; continue; } }
            else {
              var minXo=Math.min(el.x0,el.x1), maxXo=Math.max(el.x0,el.x1); var minYo=Math.min(el.y0,el.y1), maxYo=Math.max(el.y0,el.y1);
              if(dirtyW && (maxXo < dirtyW.minX || dirtyW.maxX < minXo || maxYo < dirtyW.minY || dirtyW.maxY < minYo)){ try{ __plan2d.__frameProfile.openingsSkipped++; }catch(_sko2){}; continue; }
            }
        } }
        var ax=el.x0, ay=el.y0, bx=el.x1, by=el.y1;
        // Compute dynamic endpoints for host-anchored windows
        var isHostWindow = (el.type==='window' && typeof el.host==='number');
        if(isHostWindow){
          var host = elems[el.host];
          if(!host || host.type!=='wall'){ continue; }
          var hx0=host.x0, hy0=host.y0, hx1=host.x1, hy1=host.y1;
          var t0 = Math.max(0, Math.min(1, el.t0||0));
          var t1 = Math.max(0, Math.min(1, el.t1||0));
          ax = hx0 + (hx1-hx0)*t0; ay = hy0 + (hy1-hy0)*t0;
          bx = hx0 + (hx1-hx0)*t1; by = hy0 + (hy1-hy0)*t1;
        }
        if(el.type==='wall'){
          var isWallSelected = false;
          try {
            if (Array.isArray(__plan2d.selectedIndices) && __plan2d.selectedIndices.indexOf(i) !== -1) isWallSelected = true;
            else if (typeof __plan2d.selectedIndex === 'number' && __plan2d.selectedIndex === i) isWallSelected = true;
          } catch(_sel){}
          // Compute original endpoints and thickness
          var origAx = el.x0, origAy = el.y0, origBx = el.x1, origBy = el.y1;
          var wdx0 = origBx - origAx, wdy0 = origBy - origAy; var wLen0 = Math.hypot(wdx0, wdy0) || 1;
          var dirx = wdx0 / wLen0, diry = wdy0 / wLen0;
          var thick = (el.thickness||__plan2d.wallThicknessM);
          var halfW = thick/2;
          // Cross-floor dimming: walls from other levels get reduced alpha.
          var lvlCur = (typeof window.currentFloor==='number'? window.currentFloor:0);
          var alphaFactor = 1.0;
          if(typeof el.roomLevel==='number' && el.roomLevel !== lvlCur){ alphaFactor = 0.25; }
          // Start with pre-merged host spans for this wall
          var spans = hostSpansCache && hostSpansCache[i] ? hostSpansCache[i].slice() : [];
          // Append free openings that project onto this wall (still requires per-wall check)
          if(freeOpenings.length){
            for(var fo=0; fo<freeOpenings.length; fo++){
              var oElF = freeOpenings[fo];
              var tA = plan2dProjectParamOnWall({x:oElF.x0, y:oElF.y0}, el);
              var tB = plan2dProjectParamOnWall({x:oElF.x1, y:oElF.y1}, el);
              var nearTol = halfW + 0.05;
              function pointWallDistF(px,py){ var dx=origBx-origAx, dy=origBy-origAy; var denom=(dx*dx+dy*dy)||1; var t=((px-origAx)*dx+(py-origAy)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=origAx+t*dx, cy=origAy+t*dy; return Math.hypot(px-cx, py-cy); }
              var dAF = pointWallDistF(oElF.x0,oElF.y0), dBF = pointWallDistF(oElF.x1,oElF.y1);
              if(dAF <= nearTol && dBF <= nearTol){
                var s0f = Math.max(0, Math.min(1, Math.min(tA,tB)));
                var s1f = Math.max(0, Math.min(1, Math.max(tA,tB)));
                if(s1f > s0f + 1e-4) spans.push([s0f,s1f]);
              }
            }
          }
          // Live preview: carve a temporary gap where a door/window would be placed before element creation
          if(__plan2d.mouse && !__plan2d.dragWindow && !__plan2d.dragDoor && !__plan2d.dragDoorWhole && !__plan2d.start){
            var cPt = __plan2d.mouse; // screen-space
            var pWorld = screenToWorld2D(cPt.x, cPt.y);
            var near = plan2dFindNearestWall(pWorld, 0.3);
            if(near && typeof near.index==='number' && near.index===i){
              var tHover = plan2dProjectParamOnWall(pWorld, el);
              if(__plan2d.tool==='door'){
                var halfT = ((__plan2d.doorWidthM||0.92) / 2) / wLen0; var t0p=tHover-halfT, t1p=tHover+halfT;
                if(t1p>t0p){ t0p=Math.max(0,t0p); t1p=Math.min(1,t1p); if(t1p>t0p+1e-6) spans.push([t0p,t1p]); }
              } else if(__plan2d.tool==='window'){
                var wPreview = (__plan2d.windowDefaultWidthM||1.2);
                var halfTw = (wPreview/2)/wLen0; var t0w=tHover-halfTw, t1w=tHover+halfTw;
                if(t1w>t0w){ t0w=Math.max(0,t0w); t1w=Math.min(1,t1w); if(t1w>t0w+1e-6) spans.push([t0w,t1w]); }
              }
            }
          }
          // Merge spans
          spans.sort(function(A,B){ return A[0]-B[0]; });
          var merged=[]; for(var si=0; si<spans.length; si++){ var s=spans[si]; if(merged.length===0) merged.push(s); else { var last=merged[merged.length-1]; if(s[0] <= last[1] + 1e-4){ last[1] = Math.max(last[1], s[1]); } else { merged.push([s[0], s[1]]);} } }
          // Create solid segments as complement of merged spans
          var solids=[]; var cursorT=0; for(var mi=0; mi<merged.length; mi++){ var vs=merged[mi]; if(vs[0] > cursorT + 1e-4) solids.push([cursorT, vs[0]]); cursorT = Math.max(cursorT, vs[1]); }
          if(cursorT < 1 - 1e-4) solids.push([cursorT, 1]);
          // If the wall is fully void due to openings spanning 100% of its length, draw a thin dashed centerline
          if(solids.length===0){
            var aLine = worldToScreen2D(origAx, origAy); var bLine = worldToScreen2D(origBx, origBy);
            ctx.save();
            ctx.strokeStyle = 'rgba(203,213,225,0.9)'; // slate-300
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5,4]);
            ctx.beginPath(); ctx.moveTo(aLine.x, aLine.y); ctx.lineTo(bLine.x, bLine.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
          // Convert each solid segment to world endpoints, applying flush extension only at outer ends
          var thicknessLabelDrawn = false;
          for(var sj=0; sj<solids.length; sj++){
            var s0 = solids[sj][0], s1 = solids[sj][1];
            var sx0 = origAx + dirx * (s0 * wLen0), sy0 = origAy + diry * (s0 * wLen0);
            var sx1 = origAx + dirx * (s1 * wLen0), sy1 = origAy + diry * (s1 * wLen0);
            // Extend only if this touches the true ends
            var touchesStart = (s0 <= 1e-4) && startConn[i];
            var touchesEnd   = (s1 >= 1 - 1e-4) && endConn[i];
            if(touchesStart){ sx0 -= dirx * halfW; sy0 -= diry * halfW; }
            if(touchesEnd){   sx1 += dirx * halfW; sy1 += diry * halfW; }
            var aSeg = worldToScreen2D(sx0, sy0); var bSeg = worldToScreen2D(sx1, sy1);
            var dxs=bSeg.x-aSeg.x, dys=bSeg.y-aSeg.y; var Ls=Math.sqrt(dxs*dxs+dys*dys)||1; var nx=-dys/Ls, ny=dxs/Ls; var halfPx=(thick*__plan2d.scale)/2;
            var midScreenX = (aSeg.x + bSeg.x) * 0.5;
            var midScreenY = (aSeg.y + bSeg.y) * 0.5;
            var segAngle = Math.atan2(dys, dxs);
            try { __plan2d.__frameProfile.wallSegments++; }catch(_pfws){}
            ctx.beginPath(); ctx.fillStyle='#e5e7eb'; ctx.strokeStyle='#334155'; ctx.lineWidth=__plan2d.wallStrokePx;
            ctx.moveTo(aSeg.x+nx*halfPx,aSeg.y+ny*halfPx); ctx.lineTo(bSeg.x+nx*halfPx,bSeg.y+ny*halfPx); ctx.lineTo(bSeg.x-nx*halfPx,bSeg.y-ny*halfPx); ctx.lineTo(aSeg.x-nx*halfPx,aSeg.y-ny*halfPx); ctx.closePath(); ctx.fill(); ctx.stroke();

            // Inline segment length measurement centered inside the wall polygon (no pill)
            (function(){
              var minLabelPx = 30; // skip very tiny segments
              // Zoom-based culling: don't draw labels if zoomed out beyond threshold
              var zoomMin = (__plan2d.labelZoomMin==null?0.12:__plan2d.labelZoomMin);
              if(__plan2d.scale < zoomMin) return;
              if(Ls < minLabelPx) return;
              // Soft cap: avoid measuring if too many solids drawn this frame to reduce text layout cost
              __plan2d.__measureCount = (__plan2d.__measureCount||0) + 1; if(__plan2d.__measureCount > (__plan2d.__measureLimit||200)) return;
              // High density culling: if wall segment count extremely high, raise minimum pixel length
              if((__plan2d.__frameProfile.wallSegments||0) > 800 && Ls < 50) return;
              var segLenM = Math.hypot(sx1 - sx0, sy1 - sy0);
              var rounded = Math.round(segLenM*1000)/1000;
              var cache = __plan2d.__textCache || (__plan2d.__textCache={});
              var entry = cache[rounded];
              if(!entry){
                // Prevent unbounded growth when many unique lengths occur (memory safety)
                var limit = __plan2d.__textCacheLimit || 2000;
                __plan2d.__textCacheSize = (__plan2d.__textCacheSize||0) + 1;
                if(__plan2d.__textCacheSize > limit){
                  __plan2d.__textCache = {};
                  cache = __plan2d.__textCache;
                  __plan2d.__textCacheSize = 1;
                }
                entry = { txt: formatMeters(rounded) + ' m', w: null };
                cache[rounded]=entry;
                try{ __plan2d.__frameProfile.measureNew++; }catch(_pfnm){}
              }
              else { try{ __plan2d.__frameProfile.measureHit++; }catch(_pfmh){} }
              var txt = entry.txt;
              var midx = midScreenX, midy = midScreenY;
              var angle = segAngle;
              if (angle > Math.PI/2 || angle < -Math.PI/2) angle += Math.PI; // keep upright
              var pad = 6; var maxW = Math.max(10, Ls - pad*2);
              var marginY = 2; var maxH = Math.max(6, (2*halfPx) - marginY*2);
              ctx.save();
              ctx.translate(midx, midy);
              ctx.rotate(angle);
              var baseFontSize = 18; ctx.font = baseFontSize + 'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
              var textW = entry.w!=null? entry.w : (entry.w = ctx.measureText(txt).width);
              var scale = Math.min(1, maxW / Math.max(1, textW), maxH / baseFontSize);
              if (scale < 0.5) { ctx.restore(); return; }
              try{ __plan2d.__frameProfile.labelTexts++; }catch(_pflbl){}
              ctx.scale(scale, scale);
              // subtle outline for contrast on light wall fill
              ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(51,65,85,0.7)'; ctx.strokeText(txt, 0, 0.5);
              ctx.fillStyle = '#0b1220';
              ctx.fillText(txt, 0, 0.5);
              ctx.restore();
            })();
            // Wall thickness callout offset from the segment to highlight 300mm width
            (function(){
              if(thicknessLabelDrawn) return;
              if(!isWallSelected) return;
              if(__plan2d.scale < 18) return;
              if(Ls < 40) return;
              var thicknessM = thick || __plan2d.wallThicknessM || 0.3;
              var thicknessMm = Math.round(thicknessM * 1000);
              if(!thicknessMm) return;
              var label = thicknessMm + ' mm';
              var available = Math.max(0, halfPx * 2 - 2);
              // Larger label when zoom allows; still must fit inside wall thickness.
              if(available < 12) return;
              var fontPx = Math.min(18, Math.max(10, available - 2));
              if(fontPx < 9) return;
              // Requirement: keep thickness label horizontal (left-to-right) and inside the wall.
              // We clip drawing to the wall polygon so the label doesn't spill outside on angled walls.
              var maxBoxW = Math.max(18, Ls - 12);

              ctx.save();
              // Clip to wall polygon in screen space
              ctx.beginPath();
              ctx.moveTo(aSeg.x + nx*halfPx, aSeg.y + ny*halfPx);
              ctx.lineTo(bSeg.x + nx*halfPx, bSeg.y + ny*halfPx);
              ctx.lineTo(bSeg.x - nx*halfPx, bSeg.y - ny*halfPx);
              ctx.lineTo(aSeg.x - nx*halfPx, aSeg.y - ny*halfPx);
              ctx.closePath();
              ctx.clip();

              ctx.translate(midScreenX, midScreenY);
              var fontStr = fontPx.toFixed(2).replace(/\.00$/,'') + 'px system-ui, sans-serif';
              ctx.font = fontStr;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              var tw = ctx.measureText(label).width;
              var boxW = tw + 6;
              if(boxW > maxBoxW){
                var scaleDown = maxBoxW / boxW;
                if(scaleDown < 0.55){ ctx.restore(); return; }
                fontPx *= scaleDown;
                ctx.font = fontPx.toFixed(2).replace(/\.00$/,'') + 'px system-ui, sans-serif';
                tw = ctx.measureText(label).width;
                boxW = tw + 6;
              }

              // Subtle contrast without a rotated callout pill
              ctx.lineWidth = 3;
              ctx.strokeStyle = 'rgba(255,255,255,0.9)';
              ctx.strokeText(label, 0, 0.5);
              ctx.fillStyle = '#0b1220';
              ctx.fillText(label, 0, 0.5);
              ctx.restore();
              thicknessLabelDrawn = true;
            })();
            // Overlay live preview keylines for pending door/window placement on this wall
            try {
              if(__plan2d.mouse && !__plan2d.dragWindow && !__plan2d.dragDoor && !__plan2d.dragDoorWhole && !__plan2d.start){
                var mPt = __plan2d.mouse; // screen-space
                var pW = screenToWorld2D(mPt.x, mPt.y);
                var near2 = plan2dFindNearestWall(pW, 0.3);
                if(near2 && typeof near2.index==='number' && near2.index===i){
                  var tHover2 = plan2dProjectParamOnWall(pW, el);
                  if(__plan2d.tool==='window'){
                    var wPrev = (__plan2d.windowDefaultWidthM||1.2);
                    var halfTw2 = (wPrev/2)/wLen0; var t0w2=tHover2-halfTw2, t1w2=tHover2+halfTw2;
                    if(t1w2>t0w2){
                      t0w2=Math.max(0,t0w2); t1w2=Math.min(1,t1w2);
                      if(t1w2>t0w2+1e-6){
                        var wx0 = origAx + dirx*(t0w2*wLen0), wy0 = origAy + diry*(t0w2*wLen0);
                        var wx1 = origAx + dirx*(t1w2*wLen0), wy1 = origAy + diry*(t1w2*wLen0);
                        var wa = worldToScreen2D(wx0, wy0), wb = worldToScreen2D(wx1, wy1);
                        var dx=wb.x-wa.x, dy=wb.y-wa.y; var L=Math.sqrt(dx*dx+dy*dy)||1; var nxp=-dy/L, nyp=dx/L; var halfPxW=(thick*__plan2d.scale)/2;
                        ctx.save();
                        // Window keylines: blue rectangle + center line
                        ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=1.5;
                        ctx.moveTo(wa.x+nxp*halfPxW,wa.y+nyp*halfPxW);
                        ctx.lineTo(wb.x+nxp*halfPxW,wb.y+nyp*halfPxW);
                        ctx.lineTo(wb.x-nxp*halfPxW,wb.y-nyp*halfPxW);
                        ctx.lineTo(wa.x-nxp*halfPxW,wa.y-nyp*halfPxW);
                        ctx.closePath(); ctx.stroke();
                        ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.moveTo(wa.x,wa.y); ctx.lineTo(wb.x,wb.y); ctx.stroke();
                        ctx.restore();
                      }
                    }
                  } else if(__plan2d.tool==='door'){
                    var halfT2 = ((__plan2d.doorWidthM||0.92)/2)/wLen0; var t0p2=tHover2-halfT2, t1p2=tHover2+halfT2;
                    if(t1p2>t0p2){
                      t0p2=Math.max(0,t0p2); t1p2=Math.min(1,t1p2);
                      if(t1p2>t0p2+1e-6){
                        var dx0 = origAx + dirx*(t0p2*wLen0), dy0 = origAy + diry*(t0p2*wLen0);
                        var dx1 = origAx + dirx*(t1p2*wLen0), dy1 = origAy + diry*(t1p2*wLen0);
                        var da = worldToScreen2D(dx0, dy0), db = worldToScreen2D(dx1, dy1);
                        ctx.save(); ctx.strokeStyle='#22c55e'; ctx.lineWidth=2;
                        // Jamb line keyline
                        ctx.beginPath(); ctx.moveTo(da.x,da.y); ctx.lineTo(db.x,db.y); ctx.stroke();
                        // Simple preview arc assuming left hinge & swing-in for immediate feedback
                        var hP = da, oP = db; var angP = Math.atan2(oP.y-hP.y, oP.x-hP.x); var rP = Math.hypot(oP.x-hP.x, oP.y-hP.y);
                        ctx.beginPath(); ctx.arc(hP.x, hP.y, rP, angP, angP + Math.PI/2, false); ctx.stroke();
                        ctx.restore();
                      }
                    }
                  }
                }
              }
            } catch(_pv){}
          }
          // Skip default solid wall draw since we've drawn segments
          continue;
        }
        var a=worldToScreen2D(ax,ay), b=worldToScreen2D(bx,by);
        if(el.type==='window'){
          // Draw window as outline-only rectangle (no fill) at wall thickness and a center blue line
          var dxw=b.x-a.x, dyw=b.y-a.y; var Lw=Math.sqrt(dxw*dxw+dyw*dyw)||1; var nxw=-dyw/Lw, nyw=dxw/Lw;
          // Thickness: inherit from host wall if present, else element thickness or default
          var thickM = isHostWindow ? ( (elems[el.host].thickness||__plan2d.wallThicknessM) ) : (el.thickness||__plan2d.wallThicknessM);
          var halfw=(thickM*__plan2d.scale)/2;
          // Outline rectangle only
          ctx.beginPath();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.moveTo(a.x+nxw*halfw,a.y+nyw*halfw);
          ctx.lineTo(b.x+nxw*halfw,b.y+nyw*halfw);
          ctx.lineTo(b.x-nxw*halfw,b.y-nyw*halfw);
          ctx.lineTo(a.x-nxw*halfw,a.y-nyw*halfw);
          ctx.closePath();
          ctx.stroke();
          // Center blue line
          ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          // Endpoint handles for editing when selected or in window tool
          if((__plan2d.tool==='window' || (__plan2d.tool==='select' && i===__plan2d.selectedIndex))){
            var handleR=5;
            ctx.fillStyle='#38bdf8';
            ctx.beginPath(); ctx.arc(a.x,a.y,handleR,0,Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(b.x,b.y,handleR,0,Math.PI*2); ctx.fill();
          }
          // Persistent window measurement label centered along the window span (stays after finishing drawing)
          try {
            // Skip if this very window is being actively dragged; a dedicated live label is drawn later
            if (!(__plan2d.dragWindow && __plan2d.dragWindow.index === i)){
              var Lpx = Math.hypot(b.x - a.x, b.y - a.y);
              // Zoom-based culling for window labels
              var zoomMinW = (__plan2d.labelZoomMin==null?0.12:__plan2d.labelZoomMin);
              if(__plan2d.scale < zoomMinW) { /* too far zoomed out */ } else {
              if (Lpx >= 20) {
                // Compute span length in meters using host wall for anchored windows; else world distance
                var lenM = 0;
                if (isHostWindow) {
                  var hostWm = elems[el.host];
                  var wallLenM = Math.hypot((hostWm.x1 - hostWm.x0), (hostWm.y1 - hostWm.y0)) || 1;
                  var t0m = Math.max(0, Math.min(1, el.t0||0));
                  var t1m = Math.max(0, Math.min(1, el.t1||0));
                  lenM = wallLenM * Math.abs(t1m - t0m);
                } else {
                  lenM = Math.hypot((bx - ax), (by - ay));
                }
                var txtM = formatMeters(lenM) + ' m';
                var midxM = (a.x + b.x) * 0.5, midyM = (a.y + b.y) * 0.5;
                var angM = Math.atan2(b.y - a.y, b.x - a.x);
                if (angM > Math.PI/2 || angM < -Math.PI/2) angM += Math.PI; // keep upright
                var padM = 6, maxWM = Math.max(10, Lpx - padM*2), maxHM = 18;
                ctx.save();
                ctx.translate(midxM, midyM);
                ctx.rotate(angM);
                var baseFontM = 16; ctx.font = baseFontM + 'px sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                var twM = ctx.measureText(txtM).width;
                var scaleM = Math.min(1, maxWM / Math.max(1, twM), maxHM / baseFontM);
                if (scaleM >= 0.55) {
                  ctx.scale(scaleM, scaleM);
                  // Outline for contrast
                  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15,23,42,0.15)'; ctx.strokeText(txtM, 0, 0.5);
                  ctx.fillStyle = '#111111';
                  ctx.fillText(txtM, 0, 0.5);
                  try{ __plan2d.__frameProfile.labelTexts++; }catch(_pflw){}
                }
                ctx.restore();
              }
              }
            }
          } catch(e) { /* non-fatal measurement draw for windows */ }
        } else if(el.type==='door'){
          // Door rendering: compute endpoints (host-anchored or free)
          var isHostDoor = (typeof el.host==='number');
          var worldA = null, worldB = null;
          if(isHostDoor){
            var hostD = elems[el.host];
            if(hostD && hostD.type==='wall'){
              var t0d = Math.max(0, Math.min(1, el.t0||0));
              var t1d = Math.max(0, Math.min(1, el.t1||0));
              worldA = { x: hostD.x0 + (hostD.x1-hostD.x0)*t0d, y: hostD.y0 + (hostD.y1-hostD.y0)*t0d };
              worldB = { x: hostD.x0 + (hostD.x1-hostD.x0)*t1d, y: hostD.y0 + (hostD.y1-hostD.y0)*t1d };
              a = worldToScreen2D(worldA.x, worldA.y); b = worldToScreen2D(worldB.x, worldB.y);
            }
          } else {
            worldA = { x: el.x0, y: el.y0 }; worldB = { x: el.x1, y: el.y1 };
          }
          // Draw door as a jamb line plus a 90-degree swing arc based on hinge + swing
          ctx.save(); ctx.strokeStyle='#22c55e'; ctx.lineWidth=2;
          // Jamb line (opening)
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
          // Determine hinge side and swing direction
          var hinge = (el.meta && el.meta.hinge) || 't0';
          var swing = (el.meta && el.meta.swing) || 'in'; // 'in' or 'out'
          var hPt = (hinge==='t0') ? a : b;
          var other = (hinge==='t0') ? b : a;
          var ang=Math.atan2(other.y-hPt.y, other.x-hPt.x);
          var r=Math.hypot(other.x-hPt.x, other.y-hPt.y);
          // Swing orientation: default arc 90° CCW; flip direction for swing='out'
          var startAng = ang;
          var endAng = ang + (swing==='out' ? -Math.PI/2 : Math.PI/2);
          ctx.beginPath();
          ctx.arc(hPt.x, hPt.y, r, startAng, endAng, (swing==='out'));
          ctx.stroke();
          // Endpoint handles when editing
          if((__plan2d.tool==='door' || (__plan2d.tool==='select' && i===__plan2d.selectedIndex))){
            var handleR=5; ctx.fillStyle='#22c55e';
            ctx.beginPath(); ctx.arc(a.x,a.y,handleR,0,Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(b.x,b.y,handleR,0,Math.PI*2); ctx.fill();
          }
          ctx.restore();
        }
      }
  perfSections.walls = ((performance&&performance.now)?performance.now():Date.now()) - tWallsStart;
  // Stairs are rendered on the overlay canvas only. Removed base-canvas stairs to avoid duplicates.

      // Color-coded overlays for pergola, garage, and balcony using world coords -> plan mapping
      try {
        if (__plan2d && __plan2d.active) {
          // Collect label boxes (screen-space) to draw text later on the labels-2d canvas
          var labelBoxes = [];
          // Draw stairs footprint(s) on the base canvas (authoritative rendering)
          try {
            var scArrDraw = (Array.isArray(window.stairsComponents) && window.stairsComponents.length) ? window.stairsComponents : (stairsComponent ? [stairsComponent] : []);
            if (scArrDraw.length) {
              var lvlNow = (typeof currentFloor==='number' ? currentFloor : 0);
              var sgnSt = (__plan2d.yFromWorldZSign || 1);
              var cxSt = (typeof __plan2d.centerX==='number' && isFinite(__plan2d.centerX)) ? __plan2d.centerX : 0;
              var czSt = (typeof __plan2d.centerZ==='number' && isFinite(__plan2d.centerZ)) ? __plan2d.centerZ : 0;
              function mapPlanSt(p){ return { x: (p.x - cxSt), y: sgnSt * (p.z - czSt) }; }
              function drawOneStairs(sc){
                var stairsLvl = (typeof sc.level==='number' ? sc.level : 0);
                var rotSt = ((sc.rotation || 0) * Math.PI) / 180;
                var hwSt = (sc.width || 0)/2;
                var hdSt = (sc.depth || 0)/2;
                function rotStW(px, pz){ var dx=px - sc.x, dz=pz - sc.z; return { x: sc.x + dx*Math.cos(rotSt) - dz*Math.sin(rotSt), z: sc.z + dx*Math.sin(rotSt) + dz*Math.cos(rotSt) }; }
                var s1 = rotStW(sc.x - hwSt, sc.z - hdSt);
                var s2 = rotStW(sc.x + hwSt, sc.z - hdSt);
                var s3 = rotStW(sc.x + hwSt, sc.z + hdSt);
                var s4 = rotStW(sc.x - hwSt, sc.z + hdSt);
                var sp1 = worldToScreen2D(mapPlanSt(s1).x, mapPlanSt(s1).y);
                var sp2 = worldToScreen2D(mapPlanSt(s2).x, mapPlanSt(s2).y);
                var sp3 = worldToScreen2D(mapPlanSt(s3).x, mapPlanSt(s3).y);
                var sp4 = worldToScreen2D(mapPlanSt(s4).x, mapPlanSt(s4).y);
                ctx.save();
                ctx.globalAlpha = (stairsLvl === lvlNow) ? 0.95 : 0.35;
                ctx.fillStyle = (stairsLvl === lvlNow) ? 'rgba(15,23,42,0.10)' : 'rgba(15,23,42,0.06)';
                // Match wall stroke weight and use white keylines for consistency in 2D
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = (__plan2d.wallStrokePx || 1.2);
                ctx.beginPath(); ctx.moveTo(sp1.x, sp1.y); ctx.lineTo(sp2.x, sp2.y); ctx.lineTo(sp3.x, sp3.y); ctx.lineTo(sp4.x, sp4.y); ctx.closePath(); ctx.fill(); ctx.stroke();
                // Label backgrounds disabled in 2D plan: skip drawing name pills/text
                try { if(false){
                var minXS = Math.min(sp1.x, sp2.x, sp3.x, sp4.x);
                var minYS = Math.min(sp1.y, sp2.y, sp3.y, sp4.y);
                var __dpr = window.devicePixelRatio || 1;
                // Match room label style: 25% smaller base font, semi-bold, centered
                var padXCss = 11, padYCss = 6, baseFontPxCss = 9, radiusCss = 19;
                var padX = padXCss * __dpr, padY = padYCss * __dpr, fontSize = baseFontPxCss * __dpr, radius = radiusCss * __dpr;
                ctx.save(); ctx.font = '600 ' + fontSize + 'px system-ui, sans-serif';
                var sText = (sc.name || 'Stairs');
                var tW = ctx.measureText(sText).width;
                var bx = Math.round(minXS + 6 * __dpr), by = Math.round(minYS + 6 * __dpr), bw = Math.round(tW + padX*2), bh = Math.round(fontSize + padY*2);
                radius = Math.min(radius, bh/2);
                // Clamp box fully inside canvas to avoid being cut off
                try {
                  var cEl = document.getElementById('plan2d-canvas');
                  if (cEl) { var cw=cEl.width||0, ch=cEl.height||0; bx = Math.max(6, Math.min(bx, Math.max(6, cw - bw - 6))); by = Math.max(6, Math.min(by, Math.max(6, ch - bh - 6))); }
                } catch(e){}
                // store (not used for drawing now) and draw on base canvas at original location
                // Use consistent alpha similar to room labels
                var aVal = 0.95;
                labelBoxes.push({ x: bx, y: by, w: bw, h: bh, text: sText, a: aVal });
                // Draw rounded pill background without shadow
                ctx.globalAlpha = aVal;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                // rounded rect path
                ctx.moveTo(bx + radius, by);
                ctx.lineTo(bx + bw - radius, by);
                ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
                ctx.lineTo(bx + bw, by + bh - radius);
                ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - radius, by + bh);
                ctx.lineTo(bx + radius, by + bh);
                ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - radius);
                ctx.lineTo(bx, by + radius);
                ctx.quadraticCurveTo(bx, by, bx + radius, by);
                ctx.closePath();
                ctx.fill();
                // Draw centered text, auto-fit within padding
                try {
                  var available = Math.max(0, bw - padX*2);
                  var fontPxCss = baseFontPxCss; ctx.font = '600 ' + (fontPxCss * __dpr) + 'px system-ui, sans-serif';
                  var tw = ctx.measureText(sText).width;
                  if (available > 0 && tw > available) {
                    var scale = available / Math.max(1, tw);
                    fontPxCss = Math.max(9, Math.floor(baseFontPxCss * scale));
                    ctx.font = '600 ' + (fontPxCss * __dpr) + 'px system-ui, sans-serif';
                  }
                  var tx = bx + bw/2, ty = by + bh/2;
                  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                  ctx.fillStyle = '#333333'; ctx.fillText(sText, tx, ty);
                } catch(e){}
                ctx.restore();
              }} catch(e) { /* ignore label bg */ }
                // Draw treads with weighted spacing: 10th interval (landing) is 5x deeper
                try {
                  var totalDepth = (sc.depth || 0);
                  var totalSteps = Math.max(1, Math.floor(sc.steps || 19));
                var intervals = Math.max(1, totalSteps - 1);
                var weights = new Array(intervals);
                for (var wi=0; wi<intervals; wi++) {
                  // Default each interval weight to 1; make the 10th interval (index 9) wider if it exists
                  weights[wi] = (wi === 9 ? 5 : 1);
                }
                // Sum of weights for normalization
                var sumW = 0; for (var sw=0; sw<intervals; sw++) sumW += weights[sw];
                for (var siSt = 1; siSt <= intervals; siSt++) {
                  // Position this tread line at the end of interval siSt-1
                  var prevW = 0; for (var pi=0; pi<siSt; pi++) prevW += weights[pi];
                  var tt = (sumW > 0) ? (prevW / sumW) : (siSt / (intervals+0));
                  var zW = sc.z - hdSt + tt * totalDepth;
                  var aW = rotStW(sc.x - hwSt, zW); var bW = rotStW(sc.x + hwSt, zW);
                  var aS = worldToScreen2D(mapPlanSt(aW).x, mapPlanSt(aW).y);
                  var bS = worldToScreen2D(mapPlanSt(bW).x, mapPlanSt(bW).y);
                  ctx.beginPath(); ctx.strokeStyle = 'rgba(100,116,139,0.9)'; ctx.lineWidth = 1; ctx.moveTo(aS.x, aS.y); ctx.lineTo(bS.x, bS.y); ctx.stroke();
                }
                } catch(e) { /* ignore */ }
                ctx.restore();
              }
              // Draw all stairs (both floors visible, current floor emphasized)
              for (var si=0; si<scArrDraw.length; si++){
                var sc = scArrDraw[si]; if(!sc) continue; drawOneStairs(sc);
              }
            }
          } catch(e) { /* base stairs draw non-fatal */ }

          var lvlNowC = (typeof currentFloor==='number' ? currentFloor : 0);
          var sgnC = (__plan2d.yFromWorldZSign || 1);
          function mapPlanXY(wx, wz){ return worldToScreen2D((wx - __plan2d.centerX), sgnC * (wz - __plan2d.centerZ)); }
      function drawBox(x, z, w, d, rotDeg, stroke, fill, alpha, labelText) {
            var rot = ((rotDeg||0) * Math.PI) / 180; var hw=w/2, hd=d/2;
            function r(px,pz){ var dx=px-x, dz=pz-z; return { x: x + dx*Math.cos(rot) - dz*Math.sin(rot), z: z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
            var c1=r(x-hw,z-hd), c2=r(x+hw,z-hd), c3=r(x+hw,z+hd), c4=r(x-hw,z+hd);
            var p1=mapPlanXY(c1.x,c1.z), p2=mapPlanXY(c2.x,c2.z), p3=mapPlanXY(c3.x,c3.z), p4=mapPlanXY(c4.x,c4.z);
            ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y); ctx.closePath(); ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = (__plan2d.wallStrokePx || 1.2); ctx.stroke(); }
            // 2D name labels are disabled
            if (false && labelText) {
              try {
                var minX = Math.min(p1.x,p2.x,p3.x,p4.x), minY = Math.min(p1.y,p2.y,p3.y,p4.y);
                var __dpr2 = window.devicePixelRatio || 1;
                // Match room label style (25% smaller)
                var padXCss2 = 11, padYCss2 = 6, baseFontPxCss2 = 9, radiusCss2 = 19;
                var padX2 = padXCss2 * __dpr2, padY2 = padYCss2 * __dpr2, fontSize2 = baseFontPxCss2 * __dpr2, radius2 = radiusCss2 * __dpr2;
                ctx.font = '600 ' + fontSize2 + 'px system-ui, sans-serif'; var tW = ctx.measureText(labelText).width;
                var bx = Math.round(minX + 6 * __dpr2), by = Math.round(minY + 6 * __dpr2), bw = Math.round(tW + padX2*2), bh = Math.round(fontSize2 + padY2*2);
                radius2 = Math.min(radius2, bh/2);
                // Clamp inside canvas bounds
                try { var cEl=document.getElementById('plan2d-canvas'); if(cEl){ var cw=cEl.width||0, ch=cEl.height||0; bx = Math.max(6, Math.min(bx, Math.max(6, cw - bw - 6))); by = Math.max(6, Math.min(by, Math.max(6, ch - bh - 6))); } } catch(e){}
                // Store info (not used for draw now) and draw on base canvas at original location
                labelBoxes.push({ x: bx, y: by, w: bw, h: bh, text: labelText, a: 0.95 });
                // Background pill without shadow
                ctx.save(); ctx.globalAlpha = 0.95; ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(bx + radius2, by);
                ctx.lineTo(bx + bw - radius2, by);
                ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius2);
                ctx.lineTo(bx + bw, by + bh - radius2);
                ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - radius2, by + bh);
                ctx.lineTo(bx + radius2, by + bh);
                ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - radius2);
                ctx.lineTo(bx, by + radius2);
                ctx.quadraticCurveTo(bx, by, bx + radius2, by);
                ctx.closePath();
                ctx.fill();
                // Centered text with auto-fit inside padding
                try {
                  var available2 = Math.max(0, bw - padX2*2);
                  var fontPxCss2 = baseFontPxCss2; ctx.font = '600 ' + (fontPxCss2 * __dpr2) + 'px system-ui, sans-serif';
                  var tw2 = ctx.measureText(labelText).width;
                  if (available2 > 0 && tw2 > available2) {
                    var scale2 = available2 / Math.max(1, tw2);
                    fontPxCss2 = Math.max(9, Math.floor(baseFontPxCss2 * scale2));
                    ctx.font = '600 ' + (fontPxCss2 * __dpr2) + 'px system-ui, sans-serif';
                  }
                  var tx2 = bx + bw/2, ty2 = by + bh/2;
                  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                  ctx.fillStyle = '#333333'; ctx.fillText(labelText, tx2, ty2);
                } catch(e){}
                ctx.restore();
              } catch(e) { /* ignore */ }
            }
            ctx.restore();
          }
          // Draw components present on the current level (guard against missing globals)
          var pergs = Array.isArray(window.pergolaComponents) ? window.pergolaComponents : [];
          var garages = Array.isArray(window.garageComponents) ? window.garageComponents : [];
          var balconies = Array.isArray(window.balconyComponents) ? window.balconyComponents : [];
          var pools = Array.isArray(window.poolComponents) ? window.poolComponents : [];
          var roofs = Array.isArray(window.roofComponents) ? window.roofComponents : [];

          for (var iPg=0;iPg<pergs.length;iPg++){
            var per=pergs[iPg]; if(!per) continue; if((per.level||0)!==lvlNowC) continue;
            // Pergola: draw with a wall-like outline similar to other objects
            drawBox(per.x, per.z, per.width, per.depth, per.rotation||0, '#10b981', 'rgba(16,185,129,0.15)', 0.95, (per.name||'Pergola'));
          }
          for (var iGg=0;iGg<garages.length;iGg++){
            var gar=garages[iGg]; if(!gar) continue; if((gar.level||0)!==lvlNowC) continue;
            // Use wall-like outline color to match other room outlines
            drawBox(gar.x, gar.z, gar.width, gar.depth, gar.rotation||0, '#334155', 'rgba(245,158,11,0.15)', 0.95, (gar.name||'Garage'));
          }
          for (var iBl=0;iBl<balconies.length;iBl++){
            var bal=balconies[iBl]; if(!bal) continue; if((bal.level||1)!==lvlNowC) continue;
            drawBox(bal.x, bal.z, bal.width, bal.depth, bal.rotation||0, '#6366f1', 'rgba(99,102,241,0.18)', 0.95, (bal.name||'Balcony'));
          }
          // Pools (ground floor by default)
          for (var iPl=0;iPl<pools.length;iPl++){
            var pol=pools[iPl]; if(!pol) continue; if((pol.level||0)!==lvlNowC) continue;
            drawBox(pol.x, pol.z, pol.width, pol.depth, pol.rotation||0, '#06b6d4', 'rgba(6,182,212,0.18)', 0.95, (pol.name||'Pool'));
          }
          // Roofs (draw on their assigned level; default to ground if unspecified)
          for (var iRf=0;iRf<roofs.length;iRf++){
            var rf=roofs[iRf]; if(!rf) continue; if((rf.level||0)!==lvlNowC) continue;
            // Use a distinctive rose color
            drawBox(rf.x, rf.z, rf.width, rf.depth, rf.rotation||0, '#f43f5e', 'rgba(244,63,94,0.14)', 0.90, (rf.name||'Roof'));
          }
          // 2D Room labels
          try {
            if (Array.isArray(allRooms)){
              var __dprR = window.devicePixelRatio || 1;
              var baseFontPxCssRoom = 9; // 25% smaller than 12px
              var minFontPxCssRoom = 8;  // clamp
              var padXCssR = 11, padYCssR = 6, radiusCssR = 19;
              for (var ir=0; ir<allRooms.length; ir++){
                var rm = allRooms[ir]; if(!rm) continue;
                var rLvl = (typeof rm.level==='number'? rm.level : 0);
                if (rLvl !== lvlNowC) continue;
                // Determine label anchor from polygon footprint if available; else use rect fallback
                var minXr = Infinity, minYr = Infinity;
                var usedPoly = false;
                try {
                  if (Array.isArray(rm.footprint) && rm.footprint.length>=3){
                    usedPoly = true;
                    for (var fi=0; fi<rm.footprint.length; fi++){
                      var p = rm.footprint[fi]; if(!p) continue;
                      var ps = mapPlanXY(p.x, p.z);
                      if (ps.x < minXr) minXr = ps.x;
                      if (ps.y < minYr) minYr = ps.y;
                    }
                  }
                } catch(_lbfp){ usedPoly = false; }
                if (!usedPoly){
                  var hwR = (rm.width||0)/2, hdR = (rm.depth||0)/2;
                  var c1r = mapPlanXY(rm.x - hwR, rm.z - hdR);
                  var c2r = mapPlanXY(rm.x + hwR, rm.z - hdR);
                  var c3r = mapPlanXY(rm.x + hwR, rm.z + hdR);
                  var c4r = mapPlanXY(rm.x - hwR, rm.z + hdR);
                  minXr = Math.min(c1r.x,c2r.x,c3r.x,c4r.x);
                  minYr = Math.min(c1r.y,c2r.y,c3r.y,c4r.y);
                }
                var labelTextR = (rm.name || 'Room');
                var padXR = padXCssR * __dprR, padYR = padYCssR * __dprR;
                var fontPxR = baseFontPxCssRoom * __dprR;
                ctx.save();
                ctx.font = '600 ' + fontPxR + 'px system-ui, sans-serif';
                var tWR = ctx.measureText(labelTextR).width;
                var bxR = Math.round(minXr + 6 * __dprR), byR = Math.round(minYr + 6 * __dprR);
                var bwR = Math.round(tWR + padXR*2), bhR = Math.round((baseFontPxCssRoom * __dprR) + padYR*2);
                try { var cElR=document.getElementById('plan2d-canvas'); if(cElR){ var cwR=cElR.width||0, chR=cElR.height||0; bxR = Math.max(6, Math.min(bxR, Math.max(6, cwR - bwR - 6))); byR = Math.max(6, Math.min(byR, Math.max(6, chR - bhR - 6))); } } catch(e){}
                // Defer drawing of room labels to the labels-2d layer and only keep one visible later
                try { labelBoxes.push({ x: bxR, y: byR, w: bwR, h: bhR, text: labelTextR, a: 0.95, kind:'room', roomIndex: ir, area: Math.max(0,(rm.width||0)) * Math.max(0,(rm.depth||0)), id: rm.id }); } catch(_elb){}
                ctx.restore();
              }
            }
          } catch(e) { /* ignore room labels */ }
          // If user is dragging a grouped set of walls that belong to a room, shift that room's label live
          try {
            if (__plan2d && __plan2d.dragGroup && Array.isArray(__plan2d.dragGroup.roomIds)){
              var dg = __plan2d.dragGroup;
              var ids = dg.roomIds;
              var dxS = (typeof dg.dxS==='number') ? dg.dxS : 0;
              var dyS = (typeof dg.dyS==='number') ? dg.dyS : 0;
              if (labelBoxes && (dxS||dyS) && ids.length){
                var scale = (__plan2d.scale||50);
                var dxPx = dxS * scale;
                var dyPx = -dyS * scale; // y up in plan -> y down in screen
                var idSet = Object.create(null);
                for (var si=0; si<ids.length; si++){ idSet[ids[si]] = true; }
                for (var bi=0; bi<labelBoxes.length; bi++){
                  var b = labelBoxes[bi];
                  if(!b || b.kind!=='room') continue;
                  if(!b.id || !idSet[b.id]) continue;
                  b.x = Math.round(b.x + dxPx);
                  b.y = Math.round(b.y + dyPx);
                  // Clamp inside canvas bounds to avoid cut-offs
                  try {
                    var cEl = document.getElementById('plan2d-canvas');
                    if (cEl){ var cw = cEl.width||0, ch = cEl.height||0; b.x = Math.max(6, Math.min(b.x, Math.max(6, cw - (b.w||0) - 6))); b.y = Math.max(6, Math.min(b.y, Math.max(6, ch - (b.h||0) - 6))); }
                  } catch(_clamp){}
                }
              }
            }
          } catch(_lblShift){}
          // After drawing backgrounds, draw the label texts on the labels-2d canvas (handled later)
          __plan2d.__labelBoxes2D = labelBoxes;
        }
      } catch(e) { /* overlay draw for components is non-fatal */ }

      // Preview during drag
      if(__plan2d.start && __plan2d.last){
        var a=worldToScreen2D(__plan2d.start.x,__plan2d.start.y);
        var b=worldToScreen2D(__plan2d.last.x,__plan2d.last.y);
        var dx=b.x-a.x, dy=b.y-a.y;
        if(Math.abs(dx)>Math.abs(dy)) b.y=a.y; else b.x=a.x;
        if(__plan2d.tool==='wall'){
          var L2=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2)||1;
          var nx2=-(b.y-a.y)/L2, ny2=(b.x-a.x)/L2; var half2=(__plan2d.wallThicknessM*__plan2d.scale)/2;
          ctx.beginPath(); ctx.fillStyle='rgba(226,232,240,0.55)'; ctx.strokeStyle='#64748b'; ctx.setLineDash([6,4]);
          ctx.moveTo(a.x+nx2*half2,a.y+ny2*half2); ctx.lineTo(b.x+nx2*half2,b.y+ny2*half2); ctx.lineTo(b.x-nx2*half2,b.y-ny2*half2); ctx.lineTo(a.x-nx2*half2,a.y-ny2*half2); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      // (Removed) Live measurement label centered inside the preview wall
        } else if(__plan2d.tool==='window'){
          ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.setLineDash([4,3]); ctx.lineWidth=2; ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.setLineDash([]);
          // Live window measurement label centered along the preview line (no pill)
          (function(){
            var Ls = Math.hypot(b.x-a.x, b.y-a.y); if(Ls < 20) return;
            var segLenM = Math.hypot(__plan2d.last.x-__plan2d.start.x, __plan2d.last.y-__plan2d.start.y);
            var txt = formatMeters(segLenM) + ' m';
            var midx=(a.x+b.x)/2, midy=(a.y+b.y)/2; var angle=Math.atan2(b.y-a.y, b.x-a.x); if(angle>Math.PI/2||angle<-Math.PI/2) angle+=Math.PI;
            var pad=6, maxW=Math.max(10, Ls - pad*2), maxH=18; // thin text-only label
            ctx.save(); ctx.translate(midx, midy); ctx.rotate(angle);
            var baseFontSize = 16; ctx.font=baseFontSize+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
            var textW=ctx.measureText(txt).width; var scale=Math.min(1, maxW/Math.max(1,textW), maxH/baseFontSize); if(scale<0.55){ ctx.restore(); return; }
            ctx.scale(scale,scale);
            // subtle outline for readability over lines
            ctx.lineWidth = 3; ctx.strokeStyle='rgba(15,23,42,0.7)'; ctx.strokeText(txt,0,0.5);
            ctx.fillStyle='#e5e7eb'; ctx.fillText(txt,0,0.5);
            ctx.restore();
          })();
        }
      }

      // No ghost overlay: 2D walls are live-updated from 3D during drag so both views stay in lockstep

      // Live label while dragging a window endpoint (host-anchored)
      if(__plan2d.dragWindow){
        try {
          var dw = __plan2d.dragWindow;
          var we = __plan2d.elements[dw.index];
          if(we && we.type==='window' && typeof we.host==='number'){
            var host = __plan2d.elements[we.host];
            if(host && host.type==='wall'){
              // Compute world endpoints from host t0/t1
              var t0 = Math.max(0, Math.min(1, we.t0||0));
              var t1 = Math.max(0, Math.min(1, we.t1||0));
              var wx0 = host.x0 + (host.x1-host.x0)*t0, wy0 = host.y0 + (host.y1-host.y0)*t0;
              var wx1 = host.x0 + (host.x1-host.x0)*t1, wy1 = host.y0 + (host.y1-host.y0)*t1;
              var a = worldToScreen2D(wx0, wy0); var b = worldToScreen2D(wx1, wy1);
              // Pixel-space length for visibility threshold
              var Lpx = Math.hypot(b.x - a.x, b.y - a.y);
              if(Lpx >= 20){
                // Window span in meters along the wall
                var wallLen = Math.hypot((host.x1-host.x0), (host.y1-host.y0)) || 1;
                var spanT = Math.abs(t1 - t0);
                var lenM = wallLen * spanT;
                var txt = formatMeters(lenM) + ' m';
                // Midpoint and orientation
                var midx = (a.x + b.x) * 0.5, midy = (a.y + b.y) * 0.5;
                var angle = Math.atan2(b.y - a.y, b.x - a.x);
                if(angle > Math.PI/2 || angle < -Math.PI/2) angle += Math.PI; // keep upright
                var pad = 6, maxW = Math.max(10, Lpx - pad*2), maxH = 18;
                ctx.save();
                ctx.translate(midx, midy);
                ctx.rotate(angle);
                var baseFontSize = 16; ctx.font = baseFontSize + 'px sans-serif';
                ctx.textAlign='center'; ctx.textBaseline='middle';
                var textW = ctx.measureText(txt).width;
                var scale = Math.min(1, maxW / Math.max(1, textW), maxH / baseFontSize);
                if(scale >= 0.55){
                  ctx.scale(scale, scale);
                  // subtle outline for readability
                  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15,23,42,0.15)'; ctx.strokeText(txt, 0, 0.5);
                  ctx.fillStyle = '#111111';
                  ctx.fillText(txt, 0, 0.5);
                }
                ctx.restore();
              }
            }
          }
        } catch(e) { /* non-fatal */ }
      }
      // Hover erase highlight
      if(__plan2d.tool==='erase' && __plan2d.hoverIndex>=0){ var e=__plan2d.elements[__plan2d.hoverIndex]; var a2=worldToScreen2D(e.x0,e.y0), b2=worldToScreen2D(e.x1,e.y1); ctx.beginPath(); ctx.strokeStyle='#ef4444'; ctx.lineWidth=3; ctx.setLineDash([4,4]); ctx.moveTo(a2.x,a2.y); ctx.lineTo(b2.x,b2.y); ctx.stroke(); ctx.setLineDash([]); }
      // Hover highlights in Select tool for feedback
      if(__plan2d.tool==='select'){
        // Door/window segment hover
        if(typeof __plan2d.hoverDoorIndex==='number' && __plan2d.hoverDoorIndex>=0){
          var deh = __plan2d.elements[__plan2d.hoverDoorIndex];
          if(deh){
            var ax,ay,bx,by; if(typeof deh.host==='number'){ var host=__plan2d.elements[deh.host]; if(host){ var t0=Math.max(0,Math.min(1,deh.t0||0)), t1=Math.max(0,Math.min(1,deh.t1||0)); ax=host.x0+(host.x1-host.x0)*t0; ay=host.y0+(host.y1-host.y0)*t0; bx=host.x0+(host.x1-host.x0)*t1; by=host.y0+(host.y1-host.y0)*t1; } }
            if(ax===undefined){ ax=deh.x0; ay=deh.y0; bx=deh.x1; by=deh.y1; }
            var aS=worldToScreen2D(ax,ay), bS=worldToScreen2D(bx,by); ctx.beginPath(); ctx.strokeStyle='#10b981'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(aS.x,aS.y); ctx.lineTo(bS.x,bS.y); ctx.stroke(); ctx.setLineDash([]);
          }
        }
        if(typeof __plan2d.hoverWindowIndex==='number' && __plan2d.hoverWindowIndex>=0){
          var weH = __plan2d.elements[__plan2d.hoverWindowIndex]; if(weH){ var axw,ayw,bxw,byw; if(typeof weH.host==='number'){ var wh=__plan2d.elements[weH.host]; if(wh){ var t0w=Math.max(0,Math.min(1,weH.t0||0)), t1w=Math.max(0,Math.min(1,weH.t1||0)); axw=wh.x0+(wh.x1-wh.x0)*t0w; ayw=wh.y0+(wh.y1-wh.y0)*t0w; bxw=wh.x0+(wh.x1-wh.x0)*t1w; byw=wh.y0+(wh.y1-wh.y0)*t1w; } } if(axw===undefined){ axw=weH.x0; ayw=weH.y0; bxw=weH.x1; byw=weH.y1; } var aSw=worldToScreen2D(axw,ayw), bSw=worldToScreen2D(bxw,byw); ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(aSw.x,aSw.y); ctx.lineTo(bSw.x,bSw.y); ctx.stroke(); ctx.setLineDash([]);} }
        // Wall subsegment hover
        if(__plan2d.hoverSubsegment && __plan2d.hoverDoorIndex<0 && __plan2d.hoverWindowIndex<0){ var hs=__plan2d.hoverSubsegment; var aH=worldToScreen2D(hs.ax,hs.ay), bH=worldToScreen2D(hs.bx,hs.by); ctx.beginPath(); ctx.strokeStyle='#f97316'; ctx.lineWidth=4; ctx.setLineDash([8,4]); ctx.moveTo(aH.x,aH.y); ctx.lineTo(bH.x,bH.y); ctx.stroke(); ctx.setLineDash([]); }
        // Wall endpoint hover: show a small handle at the hovered endpoint for affordance
        if(__plan2d.hoverWallEnd && typeof __plan2d.hoverWallEnd.index==='number'){
          try{
            var wHover = __plan2d.elements[__plan2d.hoverWallEnd.index];
            if(wHover && wHover.type==='wall'){
              var pt = (__plan2d.hoverWallEnd.end==='a') ? {x:wHover.x0,y:wHover.y0} : {x:wHover.x1,y:wHover.y1};
              var pS = worldToScreen2D(pt.x, pt.y);
              ctx.save();
              ctx.fillStyle = '#fbbf24'; // amber-400
              ctx.strokeStyle = 'rgba(15,23,42,0.85)';
              ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(pS.x, pS.y, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
              ctx.restore();
            }
          }catch(e){}
        }
      }
      // Multi-selection highlight (draw all selected walls except primary)
      try{
        if(Array.isArray(__plan2d.selectedIndices) && __plan2d.selectedIndices.length>1){
          for(var mi=0; mi<__plan2d.selectedIndices.length; mi++){
            var idxM = __plan2d.selectedIndices[mi];
            if(idxM === __plan2d.selectedIndex) continue; // primary handled below
            var wM = __plan2d.elements[idxM]; if(!wM || wM.type!=='wall') continue;
            var aM=worldToScreen2D(wM.x0,wM.y0), bM=worldToScreen2D(wM.x1,wM.y1);
            ctx.beginPath(); ctx.strokeStyle='#0ea5e9'; ctx.lineWidth=2.5; ctx.setLineDash([4,3]); ctx.moveTo(aM.x,aM.y); ctx.lineTo(bM.x,bM.y); ctx.stroke(); ctx.setLineDash([]);
          }
        }
      }catch(_msDraw){}
      // Primary selection highlight
      if(__plan2d.selectedIndex>=0){
        var se=__plan2d.elements[__plan2d.selectedIndex];
        var sx0=se.x0, sy0=se.y0, sx1=se.x1, sy1=se.y1;
        if(se && (se.type==='window' || se.type==='door') && typeof se.host==='number'){
          var hostSel = __plan2d.elements[se.host];
          if(hostSel && hostSel.type==='wall'){
            var tt0=Math.max(0,Math.min(1,se.t0||0)), tt1=Math.max(0,Math.min(1,se.t1||0));
            sx0 = hostSel.x0 + (hostSel.x1-hostSel.x0)*tt0; sy0 = hostSel.y0 + (hostSel.y1-hostSel.y0)*tt0;
            sx1 = hostSel.x0 + (hostSel.x1-hostSel.x0)*tt1; sy1 = hostSel.y0 + (hostSel.y1-hostSel.y0)*tt1;
          }
        }
        var sa=worldToScreen2D(sx0,sy0), sb=worldToScreen2D(sx1,sy1);
        ctx.beginPath(); ctx.strokeStyle='#10b981'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke(); ctx.setLineDash([]);
        // When a wall is selected in Select tool, show explicit draggable endpoint handles
        if(__plan2d.tool==='select' && se && se.type==='wall'){
          var handleR = 6;
          // Draw with a strong fill and subtle outline for visibility over walls
          ctx.save();
          ctx.fillStyle = '#f59e0b'; // amber-500
          ctx.strokeStyle = 'rgba(15,23,42,0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sa.x, sa.y, handleR, 0, Math.PI*2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(sb.x, sb.y, handleR, 0, Math.PI*2); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
        // Opening (window/door) endpoint handles for resize
        if(__plan2d.tool==='select' && se && (se.type==='window' || se.type==='door')){
          try {
            var or = 5; // radius
            ctx.save();
            // Differentiate window vs door color theme
            var fillCol = (se.type==='window') ? '#38bdf8' : '#22c55e';
            var strokeCol = 'rgba(15,23,42,0.85)';
            ctx.fillStyle = fillCol; ctx.strokeStyle = strokeCol; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(sa.x, sa.y, or, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.arc(sb.x, sb.y, or, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            // Draw small direction tick to hint drag axis (line between handles already present)
            ctx.lineWidth = 1.5; ctx.strokeStyle = strokeCol; ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
            ctx.restore();
          } catch(_opH){}
        }
      }
      // Draw selected subsegment highlight if present
      if(__plan2d.selectedSubsegment && typeof __plan2d.selectedSubsegment.wallIndex==='number'){
        var ss = __plan2d.selectedSubsegment;
        var aS = worldToScreen2D(ss.ax, ss.ay), bS = worldToScreen2D(ss.bx, ss.by);
        ctx.save();
        ctx.beginPath(); ctx.strokeStyle = '#f97316'; ctx.lineWidth = 4; ctx.setLineDash([8,4]);
        ctx.moveTo(aS.x, aS.y); ctx.lineTo(bS.x, bS.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
      }
      var ox=ov.getContext('2d'); ox.setTransform(1,0,0,1,0,0);
      if(useDirty){
        try{
          var aSd = worldToScreen2D(__plan2d.dirtyRect.minX, __plan2d.dirtyRect.minY);
          var bSd = worldToScreen2D(__plan2d.dirtyRect.maxX, __plan2d.dirtyRect.maxY);
          var minSX2 = Math.min(aSd.x, bSd.x) - clearPadPx;
          var minSY2 = Math.min(aSd.y, bSd.y) - clearPadPx;
          var wSX2 = Math.abs(bSd.x - aSd.x) + clearPadPx*2;
          var hSY2 = Math.abs(bSd.y - aSd.y) + clearPadPx*2;
          ox.clearRect(minSX2, minSY2, wSX2, hSY2);
        }catch(_cdo){ ox.clearRect(0,0,ov.width,ov.height); }
      } else {
        ox.clearRect(0,0,ov.width,ov.height);
      }
      // Draw guides on overlay: snapped to device pixels
      try {
        var s = __plan2d.scale; var w = c.width, h = c.height;
        function sx(wx){ return worldToScreen2D(wx, 0).x; }
        function sy(wy){ return worldToScreen2D(0, wy).y; }
        ox.save();
          ctx.strokeStyle = 'rgba(51,65,85,'+alphaFactor.toFixed(2)+')'; // slate-700 with alpha
        // Prepare label style
        var dpr = window.devicePixelRatio || 1;
        ox.font = (10*dpr) + 'px system-ui, sans-serif';
        ox.fillStyle = '#e5e7eb';
        var labelPad = Math.floor(3*dpr);
        var lastLabelEndX = -Infinity;
        for(var iV=0;iV<(__plan2d.guidesV||[]).length;iV++){
          var xw = __plan2d.guidesV[iV]; var xs = Math.round(sx(xw)) + 0.5;
          ox.strokeStyle = (__plan2d.selectedGuide && __plan2d.selectedGuide.dir==='v' && __plan2d.selectedGuide.index===iV) ? '#f59e0b' : 'rgba(37,99,235,0.88)';
          ox.lineWidth = 1; ox.beginPath(); ox.moveTo(xs,0); ox.lineTo(xs,h); ox.stroke();
          // Label near top ruler: "x m" with overlap avoidance
          try {
            var txt = (typeof formatMeters==='function' ? formatMeters(Math.abs(xw)) + ' m' : (xw.toFixed(2)+' m'));
            var tw = ox.measureText(txt).width;
            var bx = xs + 6; var by = Math.floor(4*dpr);
            if (bx > lastLabelEndX + 6) {
              // draw simple dark backdrop for readability
              ox.save();
              ox.fillStyle = 'rgba(2,6,23,0.55)';
              ox.fillRect(Math.floor(bx - labelPad), Math.floor(by - labelPad), Math.ceil(tw + labelPad*2), Math.ceil(12*dpr + labelPad*2));
              ox.fillStyle = '#e5e7eb'; ox.textAlign='left'; ox.textBaseline='top';
              ox.fillText(txt, bx, by);
              ox.restore();
              lastLabelEndX = bx + tw;
            }
          } catch(e){}
        }
        var lastLabelEndY = -Infinity;
        for(var iH=0;iH<(__plan2d.guidesH||[]).length;iH++){
          var yw = __plan2d.guidesH[iH]; var ys = Math.round(sy(yw)) + 0.5;
          ox.strokeStyle = (__plan2d.selectedGuide && __plan2d.selectedGuide.dir==='h' && __plan2d.selectedGuide.index===iH) ? '#f59e0b' : 'rgba(37,99,235,0.88)';
          ox.lineWidth = 1; ox.beginPath(); ox.moveTo(0,ys); ox.lineTo(w,ys); ox.stroke();
          // Label near left ruler: "y m" with overlap avoidance
          try {
            var txtH = (typeof formatMeters==='function' ? formatMeters(Math.abs(yw)) + ' m' : (yw.toFixed(2)+' m'));
            var twH = ox.measureText(txtH).width;
            var bxH = Math.floor(4*dpr); var byH = ys + 6;
            if (byH > lastLabelEndY + Math.ceil(12*dpr) + 6) {
              ox.save();
              ox.fillStyle = 'rgba(2,6,23,0.55)';
              ox.fillRect(Math.floor(bxH - labelPad), Math.floor(byH - labelPad), Math.ceil(twH + labelPad*2), Math.ceil(12*dpr + labelPad*2));
              ox.fillStyle = '#e5e7eb'; ox.textAlign='left'; ox.textBaseline='top';
              ox.fillText(txtH, bxH, byH);
              ox.restore();
              lastLabelEndY = byH + Math.ceil(12*dpr);
            }
          } catch(e){}
        }
        // Dragging preview
        if(__plan2d.dragGuide){
          ox.strokeStyle = '#f59e0b'; ox.setLineDash([6,4]);
          if(__plan2d.dragGuide.dir==='v'){
            var xs2 = Math.round(sx(__plan2d.dragGuide.value)) + 0.5; ox.beginPath(); ox.moveTo(xs2,0); ox.lineTo(xs2,h); ox.stroke();
            // label for preview
            try { var txt2 = (typeof formatMeters==='function' ? formatMeters(Math.abs(__plan2d.dragGuide.value)) + ' m' : (__plan2d.dragGuide.value.toFixed(2)+' m')); var tw2 = ox.measureText(txt2).width; var bx2 = xs2 + 6; var by2 = Math.floor(4*(window.devicePixelRatio||1)); ox.setLineDash([]); ox.save(); ox.fillStyle='rgba(2,6,23,0.55)'; var lp=Math.floor(3*(window.devicePixelRatio||1)); ox.fillRect(Math.floor(bx2-lp), Math.floor(by2-lp), Math.ceil(tw2+lp*2), Math.ceil(12*(window.devicePixelRatio||1)+lp*2)); ox.fillStyle='#e5e7eb'; ox.textAlign='left'; ox.textBaseline='top'; ox.fillText(txt2, bx2, by2); ox.restore(); ox.setLineDash([6,4]); } catch(e){}
          } else {
            var ys2 = Math.round(sy(__plan2d.dragGuide.value)) + 0.5; ox.beginPath(); ox.moveTo(0,ys2); ox.lineTo(w,ys2); ox.stroke();
            try { var txt3 = (typeof formatMeters==='function' ? formatMeters(Math.abs(__plan2d.dragGuide.value)) + ' m' : (__plan2d.dragGuide.value.toFixed(2)+' m')); var tw3 = ox.measureText(txt3).width; var bx3 = Math.floor(4*(window.devicePixelRatio||1)); var by3 = ys2 + 6; ox.setLineDash([]); ox.save(); ox.fillStyle='rgba(2,6,23,0.55)'; var lp2=Math.floor(3*(window.devicePixelRatio||1)); ox.fillRect(Math.floor(bx3-lp2), Math.floor(by3-lp2), Math.ceil(tw3+lp2*2), Math.ceil(12*(window.devicePixelRatio||1)+lp2*2)); ox.fillStyle='#e5e7eb'; ox.textAlign='left'; ox.textBaseline='top'; ox.fillText(txt3, bx3, by3); ox.restore(); ox.setLineDash([6,4]); } catch(e){}
          }
          ox.setLineDash([]);
        }
        ox.restore();
      } catch(_eG) {}
      // Dedicated 2D labels canvas (draw text here, keep shapes/effects on overlay)
  var l2c = document.getElementById('labels-2d');
  var lx = l2c ? l2c.getContext('2d') : ox; // fallback to overlay if missing
  if (l2c) { lx.setTransform(1,0,0,1,0,0); lx.clearRect(0,0,l2c.width,l2c.height); }

  // Draw room name labels on the labels-2d canvas using the collected boxes, with simple overlap culling
  try {
    if (__plan2d && Array.isArray(__plan2d.__labelBoxes2D) && lx){
      var boxes = __plan2d.__labelBoxes2D.filter(function(b){ return b && b.kind==='room' && b.text; });
      // Sort by area (desc) so larger rooms have priority
      boxes.sort(function(a,b){ return (b.area||0) - (a.area||0); });
      var placed = [];
      var maxLabels = lowQualityMode ? 15 : 40;
      function intersects(a,b){ return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y); }
      function roundedRect(ctx,x,y,w,h,r){ var rr=Math.min(r, Math.min(w,h)/2); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.lineTo(x+w-rr,y); ctx.quadraticCurveTo(x+w,y,x+w,y+rr); ctx.lineTo(x+w,y+h-rr); ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h); ctx.lineTo(x+rr,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-rr); ctx.lineTo(x,y+rr); ctx.quadraticCurveTo(x,y,x+rr,y); ctx.closePath(); }
      var dprL = window.devicePixelRatio || 1;
      var recentId = (__plan2d && __plan2d.__recentAddedRoomId) ? __plan2d.__recentAddedRoomId : null;
      var recentAgeMs = (__plan2d && __plan2d.__recentAddedAt) ? (Date.now() - __plan2d.__recentAddedAt) : Infinity;
      for (var bi=0; bi<boxes.length && placed.length<maxLabels; bi++){
        var b = boxes[bi];
        // Skip if overlaps any already placed
        var overlaps = false;
        for (var pj=0; pj<placed.length; pj++){ if (intersects(b, placed[pj])) { overlaps = true; break; } }
        if (overlaps) continue;
        // Draw pill background
        var radius = 19 * (window.devicePixelRatio||1);
        lx.save();
        // Slight drop shadow for readability
        if (!lowQualityMode) {
          lx.shadowColor = 'rgba(2,6,23,0.35)';
          lx.shadowBlur = 6 * dprL;
          lx.shadowOffsetX = 0; lx.shadowOffsetY = 0;
        } else {
          lx.shadowColor = 'transparent';
          lx.shadowBlur = 0;
        }
        // Highlight recent added room for ~1.2s with a subtle pulse
        var isRecent = (recentId && b.id && b.id === recentId && recentAgeMs < 1200);
        var alpha = Math.max(0.75, Math.min(1.0, b.a||0.95));
        if (isRecent) {
          var t = recentAgeMs / 1200; var pulse = 0.15 * Math.cos(t*Math.PI*2) + 0.2; // small pulse
          alpha = Math.min(1.0, alpha + pulse);
        }
        lx.globalAlpha = alpha;
        lx.fillStyle = '#ffffff';
        roundedRect(lx, b.x, b.y, b.w, b.h, radius);
        lx.fill();
        // Text
        lx.globalAlpha = 1.0;
        lx.textAlign = 'center'; lx.textBaseline = 'middle';
        var fontPx = 9 * dprL; // base font
        lx.font = '600 ' + fontPx + 'px system-ui, sans-serif';
        var avail = Math.max(0, b.w - (11*dprL)*2);
        var tw = lx.measureText(b.text).width;
        if (tw > avail && avail > 0){ var scale = avail / Math.max(1, tw); fontPx = Math.max(8*dprL, Math.floor(fontPx * scale)); lx.font = '600 ' + fontPx + 'px system-ui, sans-serif'; }
        lx.fillStyle = '#111827';
        lx.fillText(b.text, b.x + b.w/2, b.y + b.h/2 + 0.5);
        lx.restore();
        placed.push(b);
      }
    }
  } catch(_lbl2d) { /* non-fatal label draw */ }

  // Overlays: Stairs indicator (both floors) + small labels
  var tOverlayStart = (performance&&performance.now)?performance.now():Date.now();
      (function(){
        try{
          var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
          var cxW = (typeof __plan2d.centerX==='number'? __plan2d.centerX : 0);
          var czW = (typeof __plan2d.centerZ==='number'? __plan2d.centerZ : 0);
          var sgn = (__plan2d.yFromWorldZSign||1);
          function toScreen(wx, wz){ return worldToScreen2D((wx - cxW), sgn * (wz - czW)); }
          // Compute the exact visual center of a rotated box in screen space
          function screenCenterOfBox(x, z, w, d, rotDeg){
            var rot = ((rotDeg||0) * Math.PI) / 180; var hw=(w||0)/2, hd=(d||0)/2;
            function r(px,pz){ var dx=px-x, dz=pz-z; return { x: x + dx*Math.cos(rot) - dz*Math.sin(rot), z: z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
            var c1=r(x-hw,z-hd), c2=r(x+hw,z-hd), c3=r(x+hw,z+hd), c4=r(x-hw,z+hd);
            var p1=toScreen(c1.x,c1.z), p3=toScreen(c3.x,c3.z);
            // For rectangles, the midpoint of opposite corners is the exact center
            return { x:(p1.x+p3.x)/2, y:(p1.y+p3.y)/2 };
          }
          // Debug helpers for label vs overlay center
          function getBoxScreenPoints(x, z, w, d, rotDeg){
            var rot = ((rotDeg||0) * Math.PI) / 180; var hw=(w||0)/2, hd=(d||0)/2;
            function r(px,pz){ var dx=px-x, dz=pz-z; return { x: x + dx*Math.cos(rot) - dz*Math.sin(rot), z: z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
            var c1=r(x-hw,z-hd), c2=r(x+hw,z-hd), c3=r(x+hw,z+hd), c4=r(x-hw,z+hd);
            return [ toScreen(c1.x,c1.z), toScreen(c2.x,c2.z), toScreen(c3.x,c3.z), toScreen(c4.x,c4.z) ];
          }
          function getAABB(pts){ var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; for(var i=0;i<pts.length;i++){ var p=pts[i]; if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; } return {minX:minX,minY:minY,maxX:maxY,maxY:maxY}; }
          var SHOW_2D_LABEL_COORDS = true;
      // Labels layer disabled (simplified: no room labels/edit icons)
      if(__plan2d.debug){
        try {
          var dpr = window.devicePixelRatio || 1;
          ox.save();
          ox.font = '11px monospace';
          ox.textAlign = 'left';
          ox.textBaseline = 'top';
          ox.fillStyle = 'rgba(0,0,0,0.55)';
          ox.fillRect(8,8, 280, 40);
          ox.fillStyle = '#fde68a'; // amber-300
          var msg1 = 'c: '+c.width+'x'+c.height+'  ov: '+ov.width+'x'+ov.height;
          var msg2 = 'scale: '+__plan2d.scale+'  dpr: '+dpr.toFixed(2);
          ox.fillText(msg1, 12, 12);
          ox.fillText(msg2, 12, 28);
          ox.restore();
          if (console && console.debug) console.debug('[2D] c', c.width, c.height, 'ov', ov.width, ov.height, 'scale', __plan2d.scale, 'dpr', dpr);
        } catch(e){}
      }
      // Overlay: Compass disabled (moved to main navigation on the right to always be visible)
      // Intentionally no-op; the compass is drawn in the main UI instead of the 2D overlay.
      (function(){ return; })();

      // (Removed) Overlay: corner wall markers
      } catch(e) {
        // Non-fatal: overlay/labels rendering issues shouldn't break the main render loop
        try { console.warn('2D overlay draw error', e); } catch(_) {}
      }
    })();
      // Record labels time as overlay minus earlier blocks (approx)
      perfSections.labels = ((performance&&performance.now)?performance.now():Date.now()) - tOverlayStart;

      // (Removed) Overlay: Wall orientation hint during wall drawing
      // (Removed) Overlay: live window width dimension label during drag or when selected

      // (Removed) Overlay: live wall dimension during drag
      // (Removed) Overlay: dimension lines for every wall

    perfSections.overlay = ((performance&&performance.now)?performance.now():Date.now()) - tStart - perfSections.grid - perfSections.walls - perfSections.openings - perfSections.labels;
    perfSections.total = ((performance&&performance.now)?performance.now():Date.now()) - tStart;
    // Safety: if there is content but it's likely off-screen (after deletes/pans), occasionally auto-fit once
    try{
      var nowChk = Date.now();
      if(!__plan2d.panning && !__plan2d.dragWall && !__plan2d.dragWindow && !__plan2d.dragDoor && !__plan2d.dragGroup && !__plan2d.userDrawingActive){
        if((__plan2d.__lastFitCheck||0) + 900 < nowChk){
          __plan2d.__lastFitCheck = nowChk;
          var hasEls = Array.isArray(__plan2d.elements) && __plan2d.elements.length>0;
          if(hasEls && typeof plan2dComputeBounds==='function'){
            var b = plan2dComputeBounds();
            if(b){
              // compute screen bbox of bounds
              var aS = worldToScreen2D(b.minX, b.minY), bS = worldToScreen2D(b.maxX, b.maxY);
              var minSX = Math.min(aS.x, bS.x), maxSX = Math.max(aS.x, bS.x);
              var minSY = Math.min(aS.y, bS.y), maxSY = Math.max(aS.y, bS.y);
              var w = c.width||1, h = c.height||1;
              // if bbox is fully outside by a margin on all sides, fit view (force)
              var margin = Math.max(40, Math.min(w,h)*0.15);
              var outside = (maxSX < -margin) || (minSX > w+margin) || (maxSY < -margin) || (minSY > h+margin);
              if(outside && typeof plan2dFitViewToContent==='function'){
                try{ plan2dResetDirty && plan2dResetDirty(); }catch(_rd){}
                plan2dFitViewToContent(40, {force:true});
              }
            }
          }
        }
      }
    }catch(_sfit){}
    // Rolling averages (EMA) for draw ms and dirty percent
    try{
      var ema = __plan2d.__ema || (__plan2d.__ema = {});
      var a = 0.1; // smoothing
      ema.ms = (ema.ms==null) ? perfSections.total : (1-a)*ema.ms + a*perfSections.total;
      var dp = (__plan2d.__frameProfile && __plan2d.__frameProfile.dirtyPixelPct) || 0;
      ema.dirty = (ema.dirty==null) ? dp : (1-a)*ema.dirty + a*dp;
      __plan2d.__ema = ema;
    }catch(_ema){}
  }

  // Public throttled draw entry
  if(typeof window.plan2dDraw!=='function'){
    window.plan2dDraw = function plan2dDraw(){
      if(__plan2dDrawPending){ return; }
      if(document.hidden){ return; }
      __plan2dDrawPending=true;
      requestAnimationFrame(function(){
        __plan2dDrawPending=false;
        __plan2d.__measureCount=0;
        var t0 = (window.performance? performance.now(): Date.now());
        plan2dDrawImmediate();
        var t1=(window.performance? performance.now(): Date.now());
        __plan2d.__lastDrawMs = t1 - t0;
        // After an incremental frame, clear the flag so next full draw can happen when needed
        if(__plan2d.__incremental){ __plan2d.__incremental=false; }
        if(__plan2d.perfHUD){
          try{
            var ov=document.getElementById('plan2d-overlay');
            if(ov){
              var hud=ov.getContext('2d');
              hud.save();
              hud.font='11px monospace';
                var ext = !!__plan2d.perfHUDExt;
                hud.fillStyle='rgba(0,0,0,0.65)';
                hud.fillRect(6,6, ext? 340:300, ext? 164:132);
              hud.fillStyle='#f8fafc';
              hud.textBaseline='top';
              hud.fillText('draw: '+(__plan2d.__lastDrawMs||0).toFixed(2)+' ms', 12,10);
              hud.fillText('elements: '+(__plan2d.elements?__plan2d.elements.length:0),12,24);
              hud.fillText('scale: '+__plan2d.scale,12,38);
              if(__plan2d.__perfSections){
                var ps=__plan2d.__perfSections;
                hud.fillText('grid '+ps.grid.toFixed(1)+'  walls '+ps.walls.toFixed(1)+'  open '+ps.openings.toFixed(1),12,52);
                hud.fillText('labels '+ps.labels.toFixed(1)+'  over '+ps.overlay.toFixed(1)+'  tot '+ps.total.toFixed(1),12,66);
              }
                try {
                  var fp = __plan2d.__frameProfile;
                  if(fp){
                    hud.fillText('dirty: '+fp.dirtyPixelPct.toFixed(1)+'%  segs '+fp.wallSegments,12,80);
                    hud.fillText('meas new '+fp.measureNew+' hit '+fp.measureHit+' lbl '+fp.labelTexts,12,94);
                    hud.fillText('walls '+fp.wallsConsidered+' open '+fp.openingsConsidered,12,108);
                      if(ext){
                        var ema = __plan2d.__ema||{};
                        hud.fillText('avg ms '+(ema.ms?ema.ms.toFixed(2):'–')+'  avg dirty '+(ema.dirty?ema.dirty.toFixed(1):'–')+'%',12,122);
                        hud.fillText('skipped w:'+fp.wallsSkipped+' o:'+fp.openingsSkipped+' limit:'+(__plan2d.__measureLimit||200),12,136);
                      }
                  }
                }catch(_pfhud){}
              hud.restore();
            }
          }catch(_hud){}
        }
          // Periodic console log (every 60 frames) for profiling timeline
          try {
            if((__plan2d.__frameCounter||0)%60===0){ var fpLog=__plan2d.__frameProfile||{}; var ps=__plan2d.__perfSections||{}; console.log('[2D PROF]', { frame:__plan2d.__frameCounter, ms:(__plan2d.__lastDrawMs||0).toFixed(2), dirtyPct:fpLog.dirtyPixelPct&&fpLog.dirtyPixelPct.toFixed?fpLog.dirtyPixelPct.toFixed(1):fpLog.dirtyPixelPct, wallSegs:fpLog.wallSegments, measNew:fpLog.measureNew, measHit:fpLog.measureHit, labels:fpLog.labelTexts, grid:ps.grid, walls:ps.walls, overlay:ps.overlay, total:ps.total }); }
          }catch(_pflog){}
          // Collect lightweight samples for metrics table (every 10 frames)
          try{
            var fc = (__plan2d.__frameCounter||0);
            if(fc % 10 === 0){
              var sArr = __plan2d.__perfSamples || (__plan2d.__perfSamples=[]);
              var fpS = __plan2d.__frameProfile || {};
              var psS = __plan2d.__perfSections || {};
              sArr.push({
                t: Date.now(),
                ms: __plan2d.__lastDrawMs||0,
                dirtyPct: fpS.dirtyPixelPct||0,
                wallSegs: fpS.wallSegments||0,
                measNew: fpS.measureNew||0,
                measHit: fpS.measureHit||0,
                labels: fpS.labelTexts||0,
                wallsConsidered: fpS.wallsConsidered||0,
                wallsSkipped: fpS.wallsSkipped||0,
                opensConsidered: fpS.openingsConsidered||0,
                opensSkipped: fpS.openingsSkipped||0,
                grid: psS.grid||0,
                walls: psS.walls||0,
                overlay: psS.overlay||0,
                total: psS.total||0
              });
              if(sArr.length>180) sArr.shift(); // keep ~180 samples (~30s at 6 samples/sec)
              __plan2d.__perfSamples = sArr;
            }
          }catch(_smp){}
      });
    };
  }

  if (typeof window.plan2dDrawRulers !== 'function') {
    // Draw top and left rulers: adaptive ticks/labels in meters aligned to pan/zoom
    window.plan2dDrawRulers = function plan2dDrawRulers(ctxTop, ctxLeft){
      try {
        var planCanvas = document.getElementById('plan2d-canvas');
        if (!planCanvas || !ctxTop || !ctxLeft) return;
        var dpr = window.devicePixelRatio || 1;
        var s = Math.max(1e-6, __plan2d.scale || 50); // pixels per meter on plan canvas

        // Reset transforms and paint white backgrounds
        ctxTop.setTransform(1,0,0,1,0,0);
        ctxLeft.setTransform(1,0,0,1,0,0);
        ctxTop.fillStyle = '#ffffff'; ctxTop.fillRect(0,0,ctxTop.canvas.width, ctxTop.canvas.height);
        ctxLeft.fillStyle = '#ffffff'; ctxLeft.fillRect(0,0,ctxLeft.canvas.width, ctxLeft.canvas.height);

        var planRect = planCanvas.getBoundingClientRect ? planCanvas.getBoundingClientRect() : null;
        var offsetXDpr = Math.round(((planRect && planRect.left) || 0) * dpr);
        var offsetYDpr = Math.round(((planRect && planRect.top) || 0) * dpr);
        var planWidth = Math.max(1, planCanvas.width || ctxTop.canvas.width);
        var planHeight = Math.max(1, planCanvas.height || ctxLeft.canvas.height);
        if (planRect) {
          planWidth = Math.max(planWidth, Math.round(planRect.width * dpr));
          planHeight = Math.max(planHeight, Math.round(planRect.height * dpr));
        }

        // Map plan canvas pixel coords to ruler canvas coords using the canvas' screen offset (no extra scaling).
        function planToTop(px){ return offsetXDpr + px; }
        function planToLeft(py){ return offsetYDpr + py; }

        function chooseStepWorld(){
          var targetPx = 100; // desired major spacing (plan pixels)
          var worldBase = targetPx / s;
          var pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, worldBase))));
          var steps = [1,2,5,10];
          var bestWorld = steps[0] * pow;
          var bestDiff = Math.abs(bestWorld - worldBase);
          for (var si = 1; si < steps.length; si++) {
            var cand = steps[si] * pow;
            var diff = Math.abs(cand - worldBase);
            if (diff < bestDiff) { bestWorld = cand; bestDiff = diff; }
          }
          var minorWorld = bestWorld / 10;
          if (!isFinite(minorWorld) || minorWorld <= 0) minorWorld = bestWorld;
          return { majorWorld: bestWorld, minorWorld: minorWorld };
        }
        var stepInfo = chooseStepWorld();
        var majorWorld = stepInfo.majorWorld;
        var minorWorld = stepInfo.minorWorld;
        var minorPlanPx = minorWorld * s;
        var majorPlanPx = majorWorld * s;

        var tickColor = '#000000';
        var textColor = '#000000';
        var fontPx = Math.max(10, Math.round(10 * dpr));

        var worldLeft = screenToWorld2D(0, 0).x;
        var worldRight = screenToWorld2D(planWidth, 0).x;
        var worldTop = screenToWorld2D(0, 0).y;
        var worldBottom = screenToWorld2D(0, planHeight).y;
        var worldMinX = Math.min(worldLeft, worldRight);
        var worldMaxX = Math.max(worldLeft, worldRight);
        var worldMinY = Math.min(worldBottom, worldTop);
        var worldMaxY = Math.max(worldBottom, worldTop);
        var eps = 1e-6;

        function formatRulerValue(v){
          if (Math.abs(v) < 1e-6) v = 0;
          if (typeof formatMeters === 'function') {
            var txt = formatMeters(v, { decimals: 2 });
            return txt.replace(/^-0(\.0+)?$/, '0');
          }
          return v.toFixed(2).replace(/^-0\.00$/, '0');
        }

        // Draw top ruler ticks
        ctxTop.save();
        ctxTop.translate(0.5, 0.5);
        ctxTop.strokeStyle = tickColor;
        ctxTop.lineWidth = 1;

        if (minorPlanPx >= 4) {
          var firstMinorX = Math.floor((worldMinX - eps) / minorWorld) * minorWorld;
          var rangeMinorX = (worldMaxX - worldMinX) + minorWorld * 4;
          var maxMinorCount = Math.min(2000, Math.ceil(rangeMinorX / Math.max(minorWorld, 1e-6)) + 4);
          for (var mi = 0; mi < maxMinorCount; mi++) {
            var wx = firstMinorX + mi * minorWorld;
            if (wx > worldMaxX + minorWorld) break;
            var ratioMajor = wx / majorWorld;
            if (Math.abs(ratioMajor - Math.round(ratioMajor)) < 1e-5) continue;
            var planX = worldToScreen2D(wx, 0).x;
            var rulerX = planToTop(planX);
            if (rulerX < -6 || rulerX > ctxTop.canvas.width + 6) continue;
            var px = Math.round(rulerX) + 0.5;
            var lenMinor = Math.floor(10 * dpr);
            ctxTop.beginPath();
            ctxTop.moveTo(px, ctxTop.canvas.height - 1);
            ctxTop.lineTo(px, ctxTop.canvas.height - 1 - lenMinor);
            ctxTop.stroke();
          }
        }

        var firstMajorX = Math.floor((worldMinX - eps) / majorWorld) * majorWorld;
        var rangeMajorX = (worldMaxX - worldMinX) + majorWorld * 4;
        var maxMajorCount = Math.min(400, Math.ceil(rangeMajorX / Math.max(majorWorld, 1e-6)) + 4);
        for (var mx = 0; mx < maxMajorCount; mx++) {
          var wxMajor = firstMajorX + mx * majorWorld;
          if (wxMajor > worldMaxX + majorWorld) break;
          var planXMajor = worldToScreen2D(wxMajor, 0).x;
          var rulerXMajor = planToTop(planXMajor);
          if (rulerXMajor < -6 || rulerXMajor > ctxTop.canvas.width + 6) continue;
          var pxMajor = Math.round(rulerXMajor) + 0.5;
          var lenMajor = Math.floor(18 * dpr);
          ctxTop.beginPath();
          ctxTop.moveTo(pxMajor, ctxTop.canvas.height - 1);
          ctxTop.lineTo(pxMajor, ctxTop.canvas.height - 1 - lenMajor);
          ctxTop.stroke();
        }

        ctxTop.fillStyle = textColor;
        ctxTop.font = fontPx + 'px system-ui, sans-serif';
        ctxTop.textAlign = 'center';
        ctxTop.textBaseline = 'top';
        for (var lx = 0; lx < maxMajorCount; lx++) {
          var wxLabel = firstMajorX + lx * majorWorld;
          if (wxLabel > worldMaxX + majorWorld) break;
          var planXLabel = worldToScreen2D(wxLabel, 0).x;
          var rulerXLabel = planToTop(planXLabel);
          if (rulerXLabel < -6 || rulerXLabel > ctxTop.canvas.width + 6) continue;
          var label = formatRulerValue(wxLabel);
          ctxTop.fillText(label, Math.round(rulerXLabel), Math.floor(2 * dpr));
        }
        ctxTop.restore();

        // Draw left ruler ticks
        ctxLeft.save();
        ctxLeft.translate(0.5, 0.5);
        ctxLeft.strokeStyle = tickColor;
        ctxLeft.lineWidth = 1;

        if (minorPlanPx >= 4) {
          var firstMinorY = Math.floor((worldMinY - eps) / minorWorld) * minorWorld;
          var rangeMinorY = (worldMaxY - worldMinY) + minorWorld * 4;
          var maxMinorCountY = Math.min(2000, Math.ceil(rangeMinorY / Math.max(minorWorld, 1e-6)) + 4);
          for (var miy = 0; miy < maxMinorCountY; miy++) {
            var wy = firstMinorY + miy * minorWorld;
            if (wy > worldMaxY + minorWorld) break;
            var ratioMajorY = wy / majorWorld;
            if (Math.abs(ratioMajorY - Math.round(ratioMajorY)) < 1e-5) continue;
            var planY = worldToScreen2D(0, wy).y;
            var rulerY = planToLeft(planY);
            if (rulerY < -6 || rulerY > ctxLeft.canvas.height + 6) continue;
            var py = Math.round(rulerY) + 0.5;
            var lenMinorY = Math.floor(10 * dpr);
            ctxLeft.beginPath();
            ctxLeft.moveTo(ctxLeft.canvas.width - 1, py);
            ctxLeft.lineTo(ctxLeft.canvas.width - 1 - lenMinorY, py);
            ctxLeft.stroke();
          }
        }

        var firstMajorY = Math.floor((worldMinY - eps) / majorWorld) * majorWorld;
        var rangeMajorY = (worldMaxY - worldMinY) + majorWorld * 4;
        var maxMajorCountY = Math.min(400, Math.ceil(rangeMajorY / Math.max(majorWorld, 1e-6)) + 4);
        for (var my = 0; my < maxMajorCountY; my++) {
          var wyMajor = firstMajorY + my * majorWorld;
          if (wyMajor > worldMaxY + majorWorld) break;
          var planYMajor = worldToScreen2D(0, wyMajor).y;
          var rulerYMajor = planToLeft(planYMajor);
          if (rulerYMajor < -6 || rulerYMajor > ctxLeft.canvas.height + 6) continue;
          var pyMajor = Math.round(rulerYMajor) + 0.5;
          var lenMajorY = Math.floor(18 * dpr);
          ctxLeft.beginPath();
          ctxLeft.moveTo(ctxLeft.canvas.width - 1, pyMajor);
          ctxLeft.lineTo(ctxLeft.canvas.width - 1 - lenMajorY, pyMajor);
          ctxLeft.stroke();
        }

        ctxLeft.fillStyle = textColor;
        ctxLeft.font = fontPx + 'px system-ui, sans-serif';
        ctxLeft.textAlign = 'right';
        ctxLeft.textBaseline = 'middle';
        for (var ly = 0; ly < maxMajorCountY; ly++) {
          var wyLabel = firstMajorY + ly * majorWorld;
          if (wyLabel > worldMaxY + majorWorld) break;
          var planYLabel = worldToScreen2D(0, wyLabel).y;
          var rulerYLabel = planToLeft(planYLabel);
          if (rulerYLabel < -6 || rulerYLabel > ctxLeft.canvas.height + 6) continue;
          var labelY = formatRulerValue(wyLabel);
          ctxLeft.fillText(labelY, ctxLeft.canvas.width - Math.floor(2 * dpr), Math.round(rulerYLabel));
        }
        ctxLeft.restore();
      } catch(_e) { /* non-fatal rulers */ }
    };
  }

  if (typeof window.plan2dHitGuideAtScreen !== 'function') {
    // Hit-test guides near a screen pixel position; returns {dir,index} or null
    window.plan2dHitGuideAtScreen = function plan2dHitGuideAtScreen(px, py){
      try{
        var tol = 6; // px tolerance
        function sx(wx){ return worldToScreen2D(wx, 0).x; }
        function sy(wy){ return worldToScreen2D(0, wy).y; }
        var best=null; var bestD=tol+1;
        for(var i=0;i<(__plan2d.guidesV||[]).length;i++){ var xs=sx(__plan2d.guidesV[i]); var d=Math.abs(px - xs); if(d<=tol && d<bestD){ best={dir:'v', index:i}; bestD=d; } }
        for(var j=0;j<(__plan2d.guidesH||[]).length;j++){ var ys=sy(__plan2d.guidesH[j]); var d2=Math.abs(py - ys); if(d2<=tol && d2<bestD){ best={dir:'h', index:j}; bestD=d2; } }
        return best;
      } catch(_e){ return null; }
    };
  }
})();
