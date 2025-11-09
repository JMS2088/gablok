// 2D↔3D schema export/import utilities
// Provides stable JSON structure for saving/restoring multi-floor projects
// Includes: version, precision, floors with center/scale/sign, elements (walls/openings), and 3D rooms summary
(function(){
  if (typeof window.plan2dExportSchema === 'function' && typeof window.plan2dImportSchema === 'function') return;

  function safeNum(v, def){ return (typeof v==='number' && isFinite(v)) ? v : def; }
  function clone(obj){ try{ return JSON.parse(JSON.stringify(obj||null)); }catch(e){ return null; } }

  function collect2DElements(){
    var els = Array.isArray(window.__plan2d && __plan2d.elements) ? __plan2d.elements : [];
    // Strip volatile fields and normalize
    var out = [];
    for (var i=0;i<els.length;i++){
      var e = els[i]; if(!e) continue;
      if (e.type==='wall'){
        out.push({ type:'wall', x0:safeNum(e.x0,0), y0:safeNum(e.y0,0), x1:safeNum(e.x1,0), y1:safeNum(e.y1,0), thickness:safeNum(e.thickness, (__plan2d&&__plan2d.wallThicknessM)||0.3), level: (typeof e.level==='number'? e.level : (typeof e.roomLevel==='number'? e.roomLevel : 0)), manual: !!e.manual });
      } else if (e.type==='window' || e.type==='door'){
        var rec = { type:e.type, thickness:safeNum(e.thickness, (__plan2d&&__plan2d.wallThicknessM)||0.3), level: (typeof e.level==='number'? e.level : 0) };
        if (typeof e.host==='number') { rec.host = safeNum(e.host,0); rec.t0=safeNum(e.t0,0); rec.t1=safeNum(e.t1,0); }
        else { rec.x0=safeNum(e.x0,0); rec.y0=safeNum(e.y0,0); rec.x1=safeNum(e.x1,0); rec.y1=safeNum(e.y1,0); }
        if (e.type==='window'){ if (typeof e.sillM==='number') rec.sillM=e.sillM; if (typeof e.heightM==='number') rec.heightM=e.heightM; }
        if (e.type==='door'){ if (typeof e.widthM==='number') rec.widthM=e.widthM; if (typeof e.heightM==='number') rec.heightM=e.heightM; if (e.meta) rec.meta = clone(e.meta); }
        out.push(rec);
      }
    }
    return out;
  }

  function collect3DRooms(){
    var arr = Array.isArray(window.allRooms) ? window.allRooms : [];
    var out = [];
    for (var i=0;i<arr.length;i++){
      var r = arr[i]; if(!r) continue;
      var rec = { id: r.id, name: r.name, x:safeNum(r.x,0), z:safeNum(r.z,0), width:safeNum(r.width,0), depth:safeNum(r.depth,0), height:safeNum(r.height,3), level: (r.level||0) };
      if (Array.isArray(r.openings)){
        rec.openings = [];
        for (var j=0;j<r.openings.length;j++){
          var op=r.openings[j]; if(!op) continue; rec.openings.push({ type: op.type, x0:safeNum(op.x0,0), z0:safeNum(op.z0,0), x1:safeNum(op.x1,0), z1:safeNum(op.z1,0), sillM:safeNum(op.sillM, (op.type==='door'?0:1.0)), heightM:safeNum(op.heightM, (op.type==='door'?2.04:1.5)), meta: clone(op.meta)||null });
        }
      }
      if (Array.isArray(r.footprint) && r.footprint.length>=3){ rec.footprint = r.footprint.map(function(p){ return { x:safeNum(p.x,0), z:safeNum(p.z,0) }; }); }
      out.push(rec);
    }
    return out;
  }

  function plan2dExportSchema(){
    var floors = [];
    try {
      var maxLevel = 1; // support 0 and 1 for now; schema can hold more
      for (var lvl=0; lvl<=maxLevel; lvl++){
        floors.push({
          level: lvl,
          centerX: safeNum(__plan2d && __plan2d.centerX, 0),
          centerZ: safeNum(__plan2d && __plan2d.centerZ, 0),
          yFromWorldZSign: (__plan2d && (__plan2d.yFromWorldZSign===-1||__plan2d.yFromWorldZSign===1))? __plan2d.yFromWorldZSign : 1,
          scale: safeNum(__plan2d && __plan2d.scale, 50),
          elements: collect2DElements().filter(function(e){ return (e.level||0)===lvl; })
        });
      }
    } catch(e){}
    return {
      schema: 'gablok.plan2d.v1',
      timestamp: Date.now(),
      precisionStepM: (__plan2d && __plan2d.precisionStepM) || 0.01,
      wallThicknessM: (__plan2d && __plan2d.wallThicknessM) || 0.3,
      wallHeightM: (__plan2d && __plan2d.wallHeightM) || 3.0,
      floors: floors,
      rooms3D: collect3DRooms()
    };
  }

  function plan2dImportSchema(obj){
    try {
      var data = (typeof obj==='string') ? JSON.parse(obj) : obj;
      if(!data || data.schema!=='gablok.plan2d.v1') throw new Error('Unsupported schema');
      // Reset 2D elements and apply precision/config
      if (!window.__plan2d) window.__plan2d = { elements: [] };
      __plan2d.precisionStepM = (typeof data.precisionStepM==='number' && data.precisionStepM>0) ? data.precisionStepM : (__plan2d.precisionStepM||0.01);
      if (typeof data.wallThicknessM==='number') __plan2d.wallThicknessM = data.wallThicknessM;
      if (typeof data.wallHeightM==='number') __plan2d.wallHeightM = data.wallHeightM;
      __plan2d.elements = [];
      // Load floors into elements array
      var fs = Array.isArray(data.floors) ? data.floors : [];
      for (var i=0;i<fs.length;i++){
        var f = fs[i]; if(!f) continue;
        var els = Array.isArray(f.elements) ? f.elements : [];
        for (var j=0;j<els.length;j++){
          var e = els[j]; if(!e) continue;
          if (e.type==='wall') __plan2d.elements.push({ type:'wall', x0:safeNum(e.x0,0), y0:safeNum(e.y0,0), x1:safeNum(e.x1,0), y1:safeNum(e.y1,0), thickness:safeNum(e.thickness, __plan2d.wallThicknessM||0.3), level: (typeof e.level==='number'? e.level : (f.level||0)), manual: !!e.manual });
          else if (e.type==='window' || e.type==='door'){
            var rec = { type:e.type, thickness:safeNum(e.thickness, __plan2d.wallThicknessM||0.3), level:(typeof e.level==='number'? e.level : (f.level||0)) };
            if (typeof e.host==='number'){ rec.host=e.host; rec.t0=safeNum(e.t0,0); rec.t1=safeNum(e.t1,0); }
            else { rec.x0=safeNum(e.x0,0); rec.y0=safeNum(e.y0,0); rec.x1=safeNum(e.x1,0); rec.y1=safeNum(e.y1,0); }
            if (e.type==='window'){ if (typeof e.sillM==='number') rec.sillM=e.sillM; if (typeof e.heightM==='number') rec.heightM=e.heightM; }
            if (e.type==='door'){ if (typeof e.widthM==='number') rec.widthM=e.widthM; if (typeof e.heightM==='number') rec.heightM=e.heightM; if (e.meta) rec.meta = clone(e.meta); }
            __plan2d.elements.push(rec);
          }
        }
      }
      // Optionally restore 3D rooms
      if (Array.isArray(data.rooms3D)){
        window.allRooms = [];
        for (var r=0;r<data.rooms3D.length;r++){
          var rr = data.rooms3D[r]; if(!rr) continue; var rm = window.createRoom ? window.createRoom(safeNum(rr.x,0), safeNum(rr.z,0), rr.level||0) : { id: rr.id || ('room_'+r), x:safeNum(rr.x,0), z:safeNum(rr.z,0), width:safeNum(rr.width,0), depth:safeNum(rr.depth,0), height:safeNum(rr.height,3), level:(rr.level||0), name: rr.name || 'Room' };
          rm.width=safeNum(rr.width,0); rm.depth=safeNum(rr.depth,0); rm.height=safeNum(rr.height,3); rm.name=rr.name || rm.name; if(Array.isArray(rr.openings)){ rm.openings=[]; for (var o=0;o<rr.openings.length;o++){ var op=rr.openings[o]; rm.openings.push({ type:op.type, x0:safeNum(op.x0,0), z0:safeNum(op.z0,0), x1:safeNum(op.x1,0), z1:safeNum(op.z1,0), sillM:safeNum(op.sillM, (op.type==='door'?0:1.0)), heightM:safeNum(op.heightM, (op.type==='door'?2.04:1.5)), meta: clone(op.meta)||null }); } }
          if (Array.isArray(rr.footprint) && rr.footprint.length>=3){ rm.footprint = rr.footprint.map(function(p){ return { x:safeNum(p.x,0), z:safeNum(p.z,0) }; }); }
          window.allRooms.push(rm);
        }
      }
      // Update UI and 2D
      try { if (typeof window.populatePlan2DFromDesign==='function'){ window.populatePlan2DFromDesign(); } } catch(_p){}
      try { if (typeof window.renderLoop==='function'){ window.renderLoop(); } } catch(_r){}
      return true;
    } catch(e){ console.error('plan2dImportSchema failed', e); return false; }
  }

  try { window.plan2dExportSchema = plan2dExportSchema; window.plan2dImportSchema = plan2dImportSchema; } catch(_e){}
})();
