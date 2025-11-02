(function(){
  'use strict';

  // Minimal DXF ASCII parser for LINE and LWPOLYLINE to draw a preview image
  function parseDXFEntities(text){
    var lines = text.split(/\r?\n/);
    var i = 0; var pairs = [];
    // Build [code, value] pairs
    while (i < lines.length - 1) {
      var code = parseInt(lines[i++].trim(), 10);
      var val = lines[i++] || '';
      if (!isNaN(code)) pairs.push([code, val]);
    }
    // Find ENTITIES section
    var idx = 0, inEntities = false;
    var entities = [];
    while (idx < pairs.length) {
      var c = pairs[idx][0], v = String(pairs[idx][1]).trim();
      if (c === 0 && v === 'SECTION') {
        // peek next 2 value for name
        var name = null;
        if (pairs[idx+1] && pairs[idx+1][0] === 2) name = String(pairs[idx+1][1]).trim();
        inEntities = (name === 'ENTITIES');
        idx += 2; continue;
      }
      if (c === 0 && v === 'ENDSEC') { inEntities = false; idx++; continue; }
      if (inEntities && c === 0) {
        var type = v; var ent = { type: type, data: {} };
        idx++;
        // Collect until next 0 or ENDSEC
        while (idx < pairs.length) {
          var cc = pairs[idx][0]; var vv = pairs[idx][1];
          if (cc === 0) break;
          // Accumulate by code
          if (!ent.data[cc]) ent.data[cc] = [];
          ent.data[cc].push(vv);
          idx++;
        }
        entities.push(ent);
        continue;
      }
      idx++;
    }
    return entities;
  }

  function entitiesToSegments(entities){
    var segs = [];
    entities.forEach(function(e){
      if (e.type === 'LINE') {
        var x0 = parseFloat((e.data[10]||['0'])[0]);
        var y0 = parseFloat((e.data[20]||['0'])[0]);
        var x1 = parseFloat((e.data[11]||['0'])[0]);
        var y1 = parseFloat((e.data[21]||['0'])[0]);
        if (isFinite(x0) && isFinite(y0) && isFinite(x1) && isFinite(y1)) segs.push({x0:x0,y0:y0,x1:x1,y1:y1});
      } else if (e.type === 'LWPOLYLINE') {
        var xs = e.data[10]||[]; var ys = e.data[20]||[]; var closed = false;
        var flags = parseInt((e.data[70]||['0'])[0],10); if ((flags & 1) === 1) closed = true;
        var n = Math.min(xs.length, ys.length);
        for (var i=0;i<n-1;i++) {
          var x0 = parseFloat(xs[i]); var y0 = parseFloat(ys[i]);
          var x1 = parseFloat(xs[i+1]); var y1 = parseFloat(ys[i+1]);
          if (isFinite(x0) && isFinite(y0) && isFinite(x1) && isFinite(y1)) segs.push({x0:x0,y0:y0,x1:x1,y1:y1});
        }
        if (closed && n>1) {
          var cx0 = parseFloat(xs[0]); var cy0 = parseFloat(ys[0]);
          var cx1 = parseFloat(xs[n-1]); var cy1 = parseFloat(ys[n-1]);
          if (isFinite(cx0) && isFinite(cy0) && isFinite(cx1) && isFinite(cy1)) segs.push({x0:cx1,y0:cy1,x1:cx0,y1:cy0});
        }
      }
    });
    return segs;
  }

  function drawSegmentsToCanvas(segs, maxSize){
    if (!Array.isArray(segs) || segs.length === 0) return null;
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    segs.forEach(function(s){ minX=Math.min(minX,s.x0,s.x1); maxX=Math.max(maxX,s.x0,s.x1); minY=Math.min(minY,s.y0,s.y1); maxY=Math.max(maxY,s.y0,s.y1); });
    if (!isFinite(minX)||!isFinite(minY)||!isFinite(maxX)||!isFinite(maxY)) return null;
    var w = maxX-minX, h=maxY-minY; if (w<=0||h<=0) return null;
    var pad = Math.max(w,h)*0.02 + 10; // 2% + 10px
    var target = Math.max(600, Math.min(2048, maxSize||1200));
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
    return cv;
  }

  async function importFile(file){
    try {
      var text = await file.text();
      // Quick signature sanity check for ASCII DXF
      if (!/\bSECTION\b[\s\S]*\bENTITIES\b/.test(text)) {
        try{ updateStatus('DXF parse warning: No ENTITIES section'); }catch(_){}
      }
      var entities = parseDXFEntities(text);
      var segs = entitiesToSegments(entities);
      if (!segs.length) { try{ updateStatus('DXF contains no supported geometry'); }catch(_){} return; }
      var cv = drawSegmentsToCanvas(segs, 1400);
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

  function exportCurrentProjectToDXF(){
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
      var dxf = out.join('\n');
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
  window.DXF = { importFile: importFile, exportProject: exportCurrentProjectToDXF };
})();
