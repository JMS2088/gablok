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
    var inBlocks = false;
    var expectingSectionName = false;

    var blocks = Object.create(null);
    var currentBlockName = null;
    var currentBlockBase = { x: 0, y: 0 };
    var currentBlockSegs = null;

    var curType = null;
    var lineEnt = { x0: null, y0: null, x1: null, y1: null };
    var lw = { xs: [], ys: [], flags: 0 };

    var insertEnt = { name: null, x: null, y: null, sx: 1, sy: 1, rotDeg: 0 };
    var insertActive = false;

    var polyActive = false;
    var poly = { xs: [], ys: [], flags: 0 };
    var vertexActive = false;
    var vertex = { x: null, y: null };

    function pushSeg(out, x0, y0, x1, y1){
      if (out.length >= maxSegments) return;
      if (isFinite(x0) && isFinite(y0) && isFinite(x1) && isFinite(y1)) out.push({x0:x0,y0:y0,x1:x1,y1:y1});
    }

    function flushLine(){
      if (curType === 'LINE') {
        var x0 = lineEnt.x0, y0 = lineEnt.y0, x1 = lineEnt.x1, y1 = lineEnt.y1;
        var out = (inBlocks && currentBlockSegs) ? currentBlockSegs : segs;
        pushSeg(out, x0, y0, x1, y1);
      }
      lineEnt.x0 = lineEnt.y0 = lineEnt.x1 = lineEnt.y1 = null;
    }

    function flushLwpoly(){
      if (curType !== 'LWPOLYLINE') return;
      var out = (inBlocks && currentBlockSegs) ? currentBlockSegs : segs;
      var n = Math.min(lw.xs.length, lw.ys.length);
      if (n >= 2) {
        for (var i=0;i<n-1;i++) {
          var x0 = parseFloat(lw.xs[i]); var y0 = parseFloat(lw.ys[i]);
          var x1 = parseFloat(lw.xs[i+1]); var y1 = parseFloat(lw.ys[i+1]);
          if (out.length >= maxSegments) break;
          pushSeg(out, x0, y0, x1, y1);
        }
        if ((lw.flags & 1) === 1) {
          var cx0 = parseFloat(lw.xs[0]); var cy0 = parseFloat(lw.ys[0]);
          var cx1 = parseFloat(lw.xs[n-1]); var cy1 = parseFloat(lw.ys[n-1]);
          if (out.length < maxSegments) pushSeg(out, cx1, cy1, cx0, cy0);
        }
      }
      lw.xs = []; lw.ys = []; lw.flags = 0;
    }

    function flushPolyline(){
      if (!polyActive) return;
      var out = (inBlocks && currentBlockSegs) ? currentBlockSegs : segs;
      var n = Math.min(poly.xs.length, poly.ys.length);
      if (n >= 2) {
        for (var i=0;i<n-1;i++) {
          var x0 = parseFloat(poly.xs[i]); var y0 = parseFloat(poly.ys[i]);
          var x1 = parseFloat(poly.xs[i+1]); var y1 = parseFloat(poly.ys[i+1]);
          if (out.length >= maxSegments) break;
          pushSeg(out, x0, y0, x1, y1);
        }
        if ((poly.flags & 1) === 1) {
          var cx0 = parseFloat(poly.xs[0]); var cy0 = parseFloat(poly.ys[0]);
          var cx1 = parseFloat(poly.xs[n-1]); var cy1 = parseFloat(poly.ys[n-1]);
          if (out.length < maxSegments) pushSeg(out, cx1, cy1, cx0, cy0);
        }
      }
      polyActive = false;
      poly.xs = []; poly.ys = []; poly.flags = 0;
      vertexActive = false;
      vertex.x = vertex.y = null;
    }

    function flushInsert(){
      if (!insertActive) return;
      insertActive = false;
      var name = insertEnt.name;
      if (!name) return;
      var block = blocks[name];
      if (!block || !block.segs || block.segs.length === 0) return;
      var ix = insertEnt.x, iy = insertEnt.y;
      if (!isFinite(ix) || !isFinite(iy)) return;
      var sx = isFinite(insertEnt.sx) ? insertEnt.sx : 1;
      var sy = isFinite(insertEnt.sy) ? insertEnt.sy : 1;
      if (!isFinite(sx) || sx === 0) sx = 1;
      if (!isFinite(sy) || sy === 0) sy = 1;
      var ang = (isFinite(insertEnt.rotDeg) ? insertEnt.rotDeg : 0) * Math.PI / 180;
      var ca = Math.cos(ang), sa = Math.sin(ang);

      // Transform block-local coords -> world
      // block.segs are stored relative to the block base point.
      for (var i=0; i<block.segs.length; i++) {
        if (segs.length >= maxSegments) break;
        var s = block.segs[i];
        var x0 = s.x0 * sx;
        var y0 = s.y0 * sy;
        var x1 = s.x1 * sx;
        var y1 = s.y1 * sy;
        var rx0 = x0 * ca - y0 * sa;
        var ry0 = x0 * sa + y0 * ca;
        var rx1 = x1 * ca - y1 * sa;
        var ry1 = x1 * sa + y1 * ca;
        pushSeg(segs, rx0 + ix, ry0 + iy, rx1 + ix, ry1 + iy);
      }
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
        if (insertActive) flushInsert();
        curType = null;

        if (vtrim === 'SECTION') {
          expectingSectionName = true;
          continue;
        }
        if (vtrim === 'ENDSEC') {
          inEntities = false;
          inBlocks = false;
          expectingSectionName = false;
          continue;
        }

        if (inBlocks) {
          if (vtrim === 'BLOCK') {
            currentBlockName = null;
            currentBlockBase = { x: 0, y: 0 };
            currentBlockSegs = [];
          } else if (vtrim === 'ENDBLK') {
            if (currentBlockName && currentBlockSegs) {
              blocks[currentBlockName] = { base: currentBlockBase, segs: currentBlockSegs };
            }
            currentBlockName = null;
            currentBlockSegs = null;
            currentBlockBase = { x: 0, y: 0 };
          }

          // Inside BLOCK definitions, we parse the same geometry entities into currentBlockSegs.
          if (vtrim === 'LINE' || vtrim === 'LWPOLYLINE') {
            curType = vtrim;
          } else if (vtrim === 'POLYLINE') {
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
          } else if (vtrim === 'INSERT') {
            insertActive = true;
            insertEnt.name = null;
            insertEnt.x = null;
            insertEnt.y = null;
            insertEnt.sx = 1;
            insertEnt.sy = 1;
            insertEnt.rotDeg = 0;
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
          inBlocks = (vtrim === 'BLOCKS');
          expectingSectionName = false;
        }
        continue;
      }

      // BLOCK header metadata: block name and base point
      if (inBlocks && currentBlockSegs) {
        if (currentBlockName === null && code === 2) {
          currentBlockName = vtrim;
          continue;
        }
        if (code === 10) { currentBlockBase.x = parseFloat(vtrim); continue; }
        if (code === 20) { currentBlockBase.y = parseFloat(vtrim); continue; }
      }

      if (!inEntities && !inBlocks) continue;

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

      // INSERT (block reference)
      if (insertActive) {
        if (code === 2) insertEnt.name = vtrim;
        else if (code === 10) insertEnt.x = parseFloat(vtrim);
        else if (code === 20) insertEnt.y = parseFloat(vtrim);
        else if (code === 41) insertEnt.sx = parseFloat(vtrim);
        else if (code === 42) insertEnt.sy = parseFloat(vtrim);
        else if (code === 50) insertEnt.rotDeg = parseFloat(vtrim);
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
            // Store as strings (existing path) to keep behavior consistent
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
    if (insertActive) flushInsert();
    if (polyActive) flushPolyline();

    // Normalize block geometry to be relative to each block base point.
    // We do this after parsing to keep streaming parsing simple.
    try {
      for (var bn in blocks) {
        if (!Object.prototype.hasOwnProperty.call(blocks, bn)) continue;
        var b = blocks[bn];
        if (!b || !b.segs || b.segs.length === 0) continue;
        var bx = (b.base && isFinite(b.base.x)) ? b.base.x : 0;
        var by = (b.base && isFinite(b.base.y)) ? b.base.y : 0;
        if (bx === 0 && by === 0) continue;
        for (var si2=0; si2<b.segs.length; si2++) {
          var ss = b.segs[si2];
          ss.x0 -= bx; ss.y0 -= by; ss.x1 -= bx; ss.y1 -= by;
        }
      }
    } catch(_blkNorm) {}

    progress();
    return segs;
  }

  function _parseInsUnits(text){
    try {
      // DXF HEADER variable format:
      // 9\n$INSUNITS\n70\n<value>
      // Scan a limited prefix for performance.
      var prefix = String(text || '').slice(0, 500000);
      var idx = prefix.indexOf('$INSUNITS');
      if (idx < 0) return null;
      var tail = prefix.slice(idx, idx + 2000);
      var m = tail.match(/\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(-?\d+)/i);
      if (!m) return null;
      var n = parseInt(m[1], 10);
      return isFinite(n) ? n : null;
    } catch (_e) {
      return null;
    }
  }

  function _unitsScaleToMeters(insUnits, approxMaxDim){
    // https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-9E7EF5F1-5AC8-4C45-97A1-CEB780A6F1D9
    // Common values: 0=unitless, 1=inches, 2=feet, 4=mm, 5=cm, 6=m
    if (insUnits === 6) return 1;
    if (insUnits === 4) return 0.001;
    if (insUnits === 5) return 0.01;
    if (insUnits === 1) return 0.0254;
    if (insUnits === 2) return 0.3048;
    // Unitless or unknown: heuristics based on typical building plan extents.
    // If max dimension is huge, assume millimeters.
    if (typeof approxMaxDim === 'number' && isFinite(approxMaxDim)) {
      if (approxMaxDim > 2000) return 0.001; // likely mm
      if (approxMaxDim > 200) return 0.01;   // likely cm
    }
    return 1; // default meters
  }

  function _segmentsApproxBounds(segs){
    try {
      if (!Array.isArray(segs) || segs.length === 0) return null;
      var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      var step = Math.max(1, Math.floor(segs.length / 200000));
      for (var i=0;i<segs.length;i+=step) {
        var s = segs[i];
        if (!s) continue;
        if (isFinite(s.x0) && isFinite(s.y0)) { minX=Math.min(minX,s.x0); minY=Math.min(minY,s.y0); maxX=Math.max(maxX,s.x0); maxY=Math.max(maxY,s.y0); }
        if (isFinite(s.x1) && isFinite(s.y1)) { minX=Math.min(minX,s.x1); minY=Math.min(minY,s.y1); maxX=Math.max(maxX,s.x1); maxY=Math.max(maxY,s.y1); }
      }
      if (!isFinite(minX)||!isFinite(minY)||!isFinite(maxX)||!isFinite(maxY)) return null;
      return { minX:minX, minY:minY, maxX:maxX, maxY:maxY, w:(maxX-minX), h:(maxY-minY) };
    } catch(_e) {
      return null;
    }
  }

  function _topNSegmentsByLength(segs, maxN){
    // Keep the longest N segments using a min-heap (O(n log N)).
    maxN = (typeof maxN === 'number' && maxN > 0) ? Math.floor(maxN) : 0;
    if (!Array.isArray(segs) || maxN <= 0) return [];
    if (segs.length <= maxN) return segs.slice();

    var heap = [];
    function len2(s){
      var dx = (s.x1 - s.x0); var dy = (s.y1 - s.y0);
      return dx*dx + dy*dy;
    }
    function swap(i,j){ var t=heap[i]; heap[i]=heap[j]; heap[j]=t; }
    function siftUp(i){
      while (i > 0) {
        var p = Math.floor((i - 1) / 2);
        if (heap[p].l2 <= heap[i].l2) break;
        swap(p, i);
        i = p;
      }
    }
    function siftDown(i){
      var n = heap.length;
      while (true) {
        var l = i*2 + 1;
        var r = l + 1;
        var m = i;
        if (l < n && heap[l].l2 < heap[m].l2) m = l;
        if (r < n && heap[r].l2 < heap[m].l2) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }

    for (var i=0;i<segs.length;i++) {
      var s = segs[i];
      var l2v = len2(s);
      if (!isFinite(l2v) || l2v <= 0) continue;
      if (heap.length < maxN) {
        heap.push({ l2: l2v, s: s });
        siftUp(heap.length - 1);
      } else if (l2v > heap[0].l2) {
        heap[0] = { l2: l2v, s: s };
        siftDown(0);
      }
    }

    var out = new Array(heap.length);
    for (var k=0;k<heap.length;k++) out[k] = heap[k].s;
    return out;
  }

  function segmentsToPlan2dElements(segs, opts){
    opts = opts || {};
    var thicknessM = (typeof opts.thicknessM === 'number' && isFinite(opts.thicknessM) && opts.thicknessM > 0) ? opts.thicknessM : ((window.__plan2d && __plan2d.wallThicknessM) || 0.3);
    var level = (typeof opts.level === 'number' && isFinite(opts.level)) ? opts.level : (typeof window.currentFloor === 'number' ? window.currentFloor : 0);
    var maxWalls = (typeof opts.maxWalls === 'number' && opts.maxWalls > 0) ? Math.floor(opts.maxWalls) : 15000;
    var minLenM = (typeof opts.minLenM === 'number' && opts.minLenM >= 0) ? opts.minLenM : 0.15;
    var quantM = (typeof opts.quantizeM === 'number' && opts.quantizeM > 0) ? opts.quantizeM : 0.01;
    var scaleToM = (typeof opts.scaleToM === 'number' && isFinite(opts.scaleToM) && opts.scaleToM > 0) ? opts.scaleToM : 1;

    if (!Array.isArray(segs) || segs.length === 0) return { elements: [], stats: { inputSegments: 0, keptSegments: 0, walls: 0 } };

    function q(v){ return Math.round(v / quantM) * quantM; }
    function dist2(x0,y0,x1,y1){ var dx=x1-x0, dy=y1-y0; return dx*dx + dy*dy; }

    // First pass: scale + quantize + filter tiny segments.
    var filtered = [];
    var minLen2 = minLenM * minLenM;
    for (var i=0;i<segs.length;i++) {
      var s = segs[i];
      if (!s) continue;
      var x0 = s.x0 * scaleToM;
      var y0 = s.y0 * scaleToM;
      var x1 = s.x1 * scaleToM;
      var y1 = s.y1 * scaleToM;
      if (!isFinite(x0)||!isFinite(y0)||!isFinite(x1)||!isFinite(y1)) continue;
      x0 = q(x0); y0 = q(y0); x1 = q(x1); y1 = q(y1);
      var l2 = dist2(x0,y0,x1,y1);
      if (!isFinite(l2) || l2 < minLen2) continue;
      // Normalize direction to help dedup key.
      var ax0=x0, ay0=y0, ax1=x1, ay1=y1;
      if (ax0 > ax1 || (ax0 === ax1 && ay0 > ay1)) { var tx=ax0; ax0=ax1; ax1=tx; var ty=ay0; ay0=ay1; ay1=ty; }
      filtered.push({ x0:x0, y0:y0, x1:x1, y1:y1, ax0:ax0, ay0:ay0, ax1:ax1, ay1:ay1, l2:l2 });
    }

    // Deduplicate exact duplicates (after quantization).
    var seen = Object.create(null);
    var dedup = [];
    for (var j=0;j<filtered.length;j++) {
      var f = filtered[j];
      var key = f.ax0 + ',' + f.ay0 + ',' + f.ax1 + ',' + f.ay1;
      if (seen[key]) continue;
      seen[key] = 1;
      dedup.push(f);
    }

    var selected = dedup;
    if (dedup.length > maxWalls) {
      // Prefer longer segments when there are too many.
      selected = _topNSegmentsByLength(dedup, maxWalls).map(function(s){
        // _topNSegmentsByLength expects .x0/.y0 etc; our records have them.
        return s;
      });
    }

    var elements = new Array(selected.length);
    for (var k=0;k<selected.length;k++) {
      var ss = selected[k];
      elements[k] = { type: 'wall', x0: ss.x0, y0: ss.y0, x1: ss.x1, y1: ss.y1, thickness: thicknessM, level: level, manual: true };
    }
    return {
      elements: elements,
      stats: {
        inputSegments: segs.length,
        filteredSegments: filtered.length,
        dedupSegments: dedup.length,
        keptSegments: selected.length,
        walls: elements.length,
        level: level,
        thicknessM: thicknessM,
        minLenM: minLenM,
        quantizeM: quantM,
        scaleToM: scaleToM,
        maxWalls: maxWalls
      }
    };
  }

  async function convertDXFTextToPlan2DJSON(text, opts){
    opts = opts || {};
    _showHint('Parsing DXF…');
    var segs = await parseDXFToSegmentsAsync(String(text || ''), { maxSegments: (opts.maxSegments || 750000) });
    if (!segs || segs.length === 0) return { ok:false, error:'no-geometry' };
    var b = _segmentsApproxBounds(segs);
    var insUnits = _parseInsUnits(text);
    var approxMaxDim = b ? Math.max(Math.abs(b.w||0), Math.abs(b.h||0)) : NaN;
    var scaleToM = _unitsScaleToMeters(insUnits, approxMaxDim);

    // Allow callers (e.g., DWG import) to force units.
    // This is important because many converter-produced DXFs omit/lie about $INSUNITS.
    if (typeof opts.scaleToM === 'number' && isFinite(opts.scaleToM) && opts.scaleToM > 0) {
      scaleToM = opts.scaleToM;
    } else if (opts.forceUnits === 'mm') {
      scaleToM = 0.001;
      if (insUnits === null || insUnits === 0) insUnits = 4;
    } else if (opts.forceUnits === 'cm') {
      scaleToM = 0.01;
      if (insUnits === null || insUnits === 0) insUnits = 5;
    } else if (opts.forceUnits === 'm') {
      scaleToM = 1;
      if (insUnits === null || insUnits === 0) insUnits = 6;
    }
    var level = (typeof opts.level === 'number') ? opts.level : (typeof window.currentFloor === 'number' ? window.currentFloor : 0);
    var conv = segmentsToPlan2dElements(segs, {
      level: level,
      thicknessM: opts.thicknessM,
      maxWalls: opts.maxWalls,
      minLenM: opts.minLenM,
      quantizeM: opts.quantizeM,
      scaleToM: scaleToM
    });
    return {
      ok: true,
      format: 'gablok-2d-plan',
      elements: conv.elements,
      meta: {
        source: 'dxf',
        insUnits: insUnits,
        scaleToM: scaleToM,
        approxBounds: b,
        stats: conv.stats,
        generatedAt: Date.now()
      }
    };
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
  window.DXF = {
    importFile: importFile,
    exportProject: exportCurrentProjectToDXF,
    serializeProjectToDXFString: serializeProjectToDXFString,
    parseDXFToSegmentsAsync: parseDXFToSegmentsAsync,
    segmentsToPlan2dElements: segmentsToPlan2dElements,
    convertDXFTextToPlan2DJSON: convertDXFTextToPlan2DJSON
  };
})();
