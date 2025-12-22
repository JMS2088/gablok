(function(){
  'use strict';

  function _yieldToUi(){
    return new Promise(function(resolve){
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function(){ resolve(); });
      else setTimeout(resolve, 0);
    });
  }

  function _showHint(msg){
    try { if (typeof window.showFpHint === 'function') window.showFpHint(msg, 5000); } catch(_h) {}
    try { if (typeof window.updateStatus === 'function') window.updateStatus(msg); } catch(_s) {}
  }

  // Streaming DXF parser: extracts LINE/LWPOLYLINE/POLYLINE vertices into segments.
  // Avoids building a full pairs array so huge DXFs don't freeze the UI.
  async function parseDXFToSegmentsAsync(text, opts){
    var segs = [];
    if (!text) return segs;

    opts = opts || {};
    var maxSegments = (typeof opts.maxSegments === 'number' && opts.maxSegments > 0) ? opts.maxSegments : 500000;

    var len = text.length;
    var pos = 0;
    var lastYield = 0;
    var lastPct = -1;

    function readLine(){
      if (pos >= len) return null;
      var nl = text.indexOf('\n', pos);
      var line;
      if (nl === -1) { line = text.slice(pos); pos = len; }
      else { line = text.slice(pos, nl); pos = nl + 1; }
      if (line && line.charCodeAt(line.length-1) === 13) line = line.slice(0, -1);
      return line;
    }

    function progress(){
      var pct = Math.max(0, Math.min(100, Math.floor((pos / Math.max(1, len)) * 100)));
      if (pct !== lastPct) {
        lastPct = pct;
        _showHint('Parsing DXF… ' + pct + '%');
      }
    }

    var inEntities = false;
    var expectingSectionName = false;

    var curType = null;
    var lineEnt = { x0: null, y0: null, x1: null, y1: null };
    var lw = { xs: [], ys: [], flags: 0 };

    var polyActive = false;
    var poly = { xs: [], ys: [], flags: 0 };
    var vertexActive = false;
    var vertex = { x: null, y: null };

    function flushLine(){
      if (curType === 'LINE') {
        var x0 = lineEnt.x0, y0 = lineEnt.y0, x1 = lineEnt.x1, y1 = lineEnt.y1;
        if (isFinite(x0) && isFinite(y0) && isFinite(x1) && isFinite(y1) && segs.length < maxSegments) segs.push({x0:x0,y0:y0,x1:x1,y1:y1});
      }
      lineEnt.x0 = lineEnt.y0 = lineEnt.x1 = lineEnt.y1 = null;
    }

    function flushLwpoly(){
      if (curType !== 'LWPOLYLINE') return;
      var n = Math.min(lw.xs.length, lw.ys.length);
      if (n >= 2) {
        for (var i=0;i<n-1;i++) {
          var x0 = parseFloat(lw.xs[i]); var y0 = parseFloat(lw.ys[i]);
          var x1 = parseFloat(lw.xs[i+1]); var y1 = parseFloat(lw.ys[i+1]);
          if (segs.length >= maxSegments) break;
          if (isFinite(x0) && isFinite(y0) && isFinite(x1) && isFinite(y1)) segs.push({x0:x0,y0:y0,x1:x1,y1:y1});
        }
        if ((lw.flags & 1) === 1) {
          var cx0 = parseFloat(lw.xs[0]); var cy0 = parseFloat(lw.ys[0]);
          var cx1 = parseFloat(lw.xs[n-1]); var cy1 = parseFloat(lw.ys[n-1]);
          if (segs.length < maxSegments && isFinite(cx0) && isFinite(cy0) && isFinite(cx1) && isFinite(cy1)) segs.push({x0:cx1,y0:cy1,x1:cx0,y1:cy0});
        }
      }
      lw.xs = []; lw.ys = []; lw.flags = 0;
    }

    function flushPolyline(){
      if (!polyActive) return;
      var n = Math.min(poly.xs.length, poly.ys.length);
      if (n >= 2) {
        for (var i=0;i<n-1;i++) {
          var x0 = parseFloat(poly.xs[i]); var y0 = parseFloat(poly.ys[i]);
          var x1 = parseFloat(poly.xs[i+1]); var y1 = parseFloat(poly.ys[i+1]);
          if (segs.length >= maxSegments) break;
          if (isFinite(x0) && isFinite(y0) && isFinite(x1) && isFinite(y1)) segs.push({x0:x0,y0:y0,x1:x1,y1:y1});
        }
        if ((poly.flags & 1) === 1) {
          var cx0 = parseFloat(poly.xs[0]); var cy0 = parseFloat(poly.ys[0]);
          var cx1 = parseFloat(poly.xs[n-1]); var cy1 = parseFloat(poly.ys[n-1]);
          if (segs.length < maxSegments && isFinite(cx0) && isFinite(cy0) && isFinite(cx1) && isFinite(cy1)) segs.push({x0:cx1,y0:cy1,x1:cx0,y1:cy0});
        }
      }
      polyActive = false;
      poly.xs = []; poly.ys = []; poly.flags = 0;
      vertexActive = false;
      vertex.x = vertex.y = null;
    }

    while (true) {
      var codeLine = readLine();
      if (codeLine === null) break;
      var valLine = readLine();
      if (valLine === null) break;

      var code = parseInt(String(codeLine).trim(), 10);
      if (!isFinite(code)) continue;
      var val = String(valLine);
      var vtrim = val.trim();

      // Yield periodically to keep UI responsive on large files
      if (pos - lastYield > 250000) {
        lastYield = pos;
        progress();
        await _yieldToUi();
      }

      if (segs.length >= maxSegments) {
        _showHint('DXF preview simplified (max ' + maxSegments + ' segments)');
        break;
      }

      if (code === 0) {
        // Entity boundary / section markers
        if (curType === 'LINE') flushLine();
        if (curType === 'LWPOLYLINE') flushLwpoly();
        curType = null;

        if (vtrim === 'SECTION') {
          expectingSectionName = true;
          continue;
        }
        if (vtrim === 'ENDSEC') {
          inEntities = false;
          expectingSectionName = false;
          continue;
        }

        if (inEntities) {
          // POLYLINE sequences span multiple records until SEQEND
          if (vtrim === 'POLYLINE') {
            polyActive = true;
            poly.xs = []; poly.ys = []; poly.flags = 0;
            vertexActive = false;
          } else if (vtrim === 'VERTEX') {
            if (polyActive) {
              vertexActive = true;
              vertex.x = null; vertex.y = null;
            }
          } else if (vtrim === 'SEQEND') {
            flushPolyline();
          }

          // Single-record entities
          if (vtrim === 'LINE' || vtrim === 'LWPOLYLINE') {
            curType = vtrim;
          } else {
            // Keep curType null for types we don't parse
            curType = null;
          }
        }
        continue;
      }

      if (expectingSectionName) {
        if (code === 2) {
          inEntities = (vtrim === 'ENTITIES');
          expectingSectionName = false;
        }
        continue;
      }

      if (!inEntities) continue;

      // LINE
      if (curType === 'LINE') {
        if (code === 10) lineEnt.x0 = parseFloat(vtrim);
        else if (code === 20) lineEnt.y0 = parseFloat(vtrim);
        else if (code === 11) lineEnt.x1 = parseFloat(vtrim);
        else if (code === 21) lineEnt.y1 = parseFloat(vtrim);
        continue;
      }

      // LWPOLYLINE
      if (curType === 'LWPOLYLINE') {
        if (code === 10) lw.xs.push(vtrim);
        else if (code === 20) lw.ys.push(vtrim);
        else if (code === 70) lw.flags = parseInt(vtrim || '0', 10) || 0;
        continue;
      }

      // POLYLINE / VERTEX sequence
      if (polyActive) {
        if (!vertexActive) {
          if (code === 70) poly.flags = parseInt(vtrim || '0', 10) || 0;
        } else {
          if (code === 10) vertex.x = parseFloat(vtrim);
          else if (code === 20) vertex.y = parseFloat(vtrim);
          // When both coords present, push and keep collecting (some VERTEX records repeat codes)
          if (isFinite(vertex.x) && isFinite(vertex.y)) {
            poly.xs.push(String(vertex.x));
            poly.ys.push(String(vertex.y));
            vertex.x = vertex.y = null;
          }
        }
      }
    }

    // Flush any trailing entity
    if (curType === 'LINE') flushLine();
    if (curType === 'LWPOLYLINE') flushLwpoly();
    if (polyActive) flushPolyline();
    progress();
    return segs;
  }

  function drawSegmentsToCanvas(segs, maxSize){
    if (!Array.isArray(segs) || segs.length === 0) return null;
    // Many real DXFs include far-out stray geometry (title blocks, xrefs, annotation blocks)
    // that can blow up bounds and make the main plan look tiny.
    // Heuristic: use a robust center estimate (median) + spread (MAD) on sampled points,
    // then compute bounds from points within a generous radius.
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    var usedOutlierFilter = false;
    var debug = { samplePoints: 0, inlierPoints: 0, madX: null, madY: null };

    var step = Math.max(1, Math.floor(segs.length / 25000));
    var xs = [], ys = [];
    for (var si=0; si<segs.length; si+=step) {
      var s = segs[si];
      if (!s) continue;
      if (isFinite(s.x0) && isFinite(s.y0)) { xs.push(s.x0); ys.push(s.y0); }
      if (isFinite(s.x1) && isFinite(s.y1)) { xs.push(s.x1); ys.push(s.y1); }
    }
    debug.samplePoints = xs.length;

    function median(arr){
      if (!arr || arr.length === 0) return NaN;
      arr.sort(function(a,b){ return a-b; });
      var mid = Math.floor(arr.length/2);
      if (arr.length % 2) return arr[mid];
      return 0.5*(arr[mid-1] + arr[mid]);
    }
    function mad(arr, med){
      if (!arr || arr.length === 0 || !isFinite(med)) return NaN;
      var dev = new Array(arr.length);
      for (var i=0;i<arr.length;i++) dev[i] = Math.abs(arr[i]-med);
      return median(dev);
    }

    var medX = median(xs.slice());
    var medY = median(ys.slice());
    var madX = mad(xs, medX);
    var madY = mad(ys, medY);
    debug.madX = madX; debug.madY = madY;

    // If MAD is too small (degenerate), fall back to simple bounds sampling.
    var useMad = isFinite(medX) && isFinite(medY) && isFinite(madX) && isFinite(madY) && (madX > 0 || madY > 0);
    var maxDx = useMad ? Math.max(1, madX) * 30 : Infinity;
    var maxDy = useMad ? Math.max(1, madY) * 30 : Infinity;
    usedOutlierFilter = useMad;

    // Compute bounds from inliers over a denser sample.
    var bStep = Math.max(1, Math.floor(segs.length / 200000));
    var kept = 0;
    function considerPoint(x, y){
      if (!isFinite(x) || !isFinite(y)) return;
      if (useMad) {
        if (Math.abs(x - medX) > maxDx) return;
        if (Math.abs(y - medY) > maxDy) return;
      }
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      kept++;
    }
    for (var bi=0; bi<segs.length; bi+=bStep) {
      var s2 = segs[bi];
      if (!s2) continue;
      considerPoint(s2.x0, s2.y0);
      considerPoint(s2.x1, s2.y1);
    }
    debug.inlierPoints = kept;

    // Fallback: if filtering produced nothing, compute broader sample bounds.
    if (kept === 0 || !isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      usedOutlierFilter = false;
      minX=Infinity;minY=Infinity;maxX=-Infinity;maxY=-Infinity;
      for (var fi=0; fi<segs.length; fi+=bStep) {
        var s3 = segs[fi];
        if (!s3) continue;
        minX = Math.min(minX, s3.x0, s3.x1);
        maxX = Math.max(maxX, s3.x0, s3.x1);
        minY = Math.min(minY, s3.y0, s3.y1);
        maxY = Math.max(maxY, s3.y0, s3.y1);
      }
    }

    if (!isFinite(minX)||!isFinite(minY)||!isFinite(maxX)||!isFinite(maxY)) return null;
    var w = maxX-minX, h=maxY-minY; if (w<=0||h<=0) return null;
    var pad = Math.max(w,h)*0.02 + 10; // 2% + 10px
    var target = Math.max(900, Math.min(2800, maxSize||2200));
    var scale = (target - 2*pad) / Math.max(w, h);
    var cw = Math.ceil(w*scale + 2*pad), ch = Math.ceil(h*scale + 2*pad);
    var cv = document.createElement('canvas'); cv.width=cw; cv.height=ch; var ctx=cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,cw,ch);
    ctx.save();
    // Map DXF world to canvas: scale, translate, flip Y
    ctx.translate(pad, pad + h*scale);
    ctx.scale(scale, -scale);
    ctx.translate(-minX, -minY);
    ctx.lineWidth = 1/scale; ctx.strokeStyle = '#111827';
    ctx.beginPath();
    segs.forEach(function(s){ ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); });
    ctx.stroke();
    ctx.restore();
    // Light border
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.strokeRect(0.5,0.5,cw-1,ch-1);
    try {
      _showHint('DXF preview: ' + segs.length + ' segments' + (usedOutlierFilter ? ' (auto-zoom)' : ''));
    } catch(_h) {}
    try {
      window.__lastDxfDebug = {
        segments: segs.length,
        bounds: { minX:minX, minY:minY, maxX:maxX, maxY:maxY, w:w, h:h },
        canvas: { w: cw, h: ch, target: target, scale: scale },
        outlier: { used: usedOutlierFilter, medX: medX, medY: medY, madX: madX, madY: madY, maxDx: maxDx, maxDy: maxDy, samplePoints: debug.samplePoints, inlierPoints: debug.inlierPoints }
      };
      console.log('[DXF]', 'segments', segs.length, 'bounds', (maxX-minX).toFixed(2)+'x'+(maxY-minY).toFixed(2), 'canvas', cw+'x'+ch, 'autoZoom', usedOutlierFilter);
    } catch(_dbg) {}
    return cv;
  }

  async function importFile(file){
    try {
      // Clear existing 3D and 2D state so the new plan starts clean
      try { if (typeof window.resetSceneForImport === 'function') window.resetSceneForImport(); } catch(_ri) {}

      // Bring up the floorplan modal immediately so progress is visible.
      try { if (typeof openFloorplanModal === 'function') openFloorplanModal({}); } catch(_om) {}

      _showHint('Reading DXF…');
      var text = await file.text();
      // Quick signature sanity check for ASCII DXF
      if (!/\bSECTION\b[\s\S]*\bENTITIES\b/.test(text)) {
        try{ updateStatus('DXF parse warning: No ENTITIES section'); }catch(_){}
      }

      var segs = await parseDXFToSegmentsAsync(text, { maxSegments: 500000 });
      if (!segs.length) { try{ updateStatus('DXF contains no supported geometry'); }catch(_){} return; }
      _showHint('Rendering…');
      var cv = drawSegmentsToCanvas(segs, 2200);
      if (!cv) { try{ updateStatus('DXF render failed'); }catch(_){} return; }
      if (typeof openFloorplanModal==='function') {
        // Let the floorplan modal treat this canvas as a page bitmap
        openFloorplanModal({ image: cv });
        try{ updateStatus('DXF loaded. Calibrate scale, draw rooms, then Commit.'); }catch(_){}
      }
    } catch (e) {
      console.error('DXF import failed', e);
      try{ updateStatus('DXF import failed'); }catch(_){}
    }
  }

  function writeHeader(){
    return [
      '0','SECTION','2','HEADER','0','ENDSEC',
      '0','SECTION','2','ENTITIES'
    ].join('\n');
  }
  function writeFooter(){ return ['0','ENDSEC','0','EOF'].join('\n'); }

  function rot(cx, cz, deg, x, z){ var r = (deg||0)*Math.PI/180; var dx=x-cx, dz=z-cz; return { x: cx + dx*Math.cos(r) - dz*Math.sin(r), z: cz + dx*Math.sin(r) + dz*Math.cos(r) }; }

  function serializeProjectToDXFString(){
    try {
      if (!Array.isArray(allRooms) || allRooms.length===0) { try{ updateStatus('No rooms to export'); }catch(_){} return; }
      var out = [writeHeader()];
      allRooms.forEach(function(r){
        var hw = (r.width||0)/2, hd=(r.depth||0)/2; var cx=r.x||0, cz=r.z||0, rotDeg=r.rotation||0;
        var corners = [
          rot(cx,cz,rotDeg, cx-hw, cz-hd),
          rot(cx,cz,rotDeg, cx+hw, cz-hd),
          rot(cx,cz,rotDeg, cx+hw, cz+hd),
          rot(cx,cz,rotDeg, cx-hw, cz+hd)
        ];
        out.push('0','LWPOLYLINE','8','0','90','4','70','1');
        for (var i=0;i<4;i++){ out.push('10', String(corners[i].x), '20', String(corners[i].z)); }
      });
      out.push(writeFooter());
      return out.join('\n');
    } catch (e) {
      console.error('DXF export failed', e);
      try{ updateStatus('DXF export failed'); }catch(_){}
    }
  }

  function exportCurrentProjectToDXF(){
    try {
      var dxf = serializeProjectToDXFString();
      if (!dxf) return;
      if (typeof download==='function') download('gablok-export.dxf', dxf, 'application/dxf');
      try{ updateStatus('Exported DXF'); }catch(_){}
    } catch (e) {
      console.error('DXF export failed', e);
      try{ updateStatus('DXF export failed'); }catch(_){}
    }
  }

  // Register with FileIO if present
  try { if (window.FileIO && FileIO.registerImport) FileIO.registerImport('dxf', importFile); } catch(e){}
  try { if (window.FileIO && FileIO.registerExport) FileIO.registerExport('dxf', exportCurrentProjectToDXF); } catch(e){}

  // Also expose minimal API
  window.DXF = { importFile: importFile, exportProject: exportCurrentProjectToDXF, serializeProjectToDXFString: serializeProjectToDXFString };
})();
