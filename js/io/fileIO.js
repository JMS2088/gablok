(function(){
  'use strict';

  // Simple registry for import/export handlers by format id
  var registry = {
    importers: {}, // id -> async (file) => void
    exporters: {}  // id -> async () => void
  };

  function registerImport(id, handler){ if(id && typeof handler==='function'){ registry.importers[id] = handler; } }
  function registerExport(id, handler){ if(id && typeof handler==='function'){ registry.exporters[id] = handler; } }
  async function doImport(id, file){ var h = registry.importers[id]; if(!h) { try{ updateStatus && updateStatus('No importer for '+id); }catch(_){} return; } return h(file); }
  async function doExport(id){ var h = registry.exporters[id]; if(!h) { try{ updateStatus && updateStatus('No exporter for '+id); }catch(_){} return; } return h(); }

  // Expose
  window.FileIO = {
    registerImport: registerImport,
    registerExport: registerExport,
    import: doImport,
    export: doExport,
    _registry: registry
  };

  // Register built-ins when available (keep lightweight)
  // JSON
  try {
    if (typeof serializeProject==='function' && typeof download==='function') {
      registerExport('json', async function(){ try{ download('gablok-project.json', serializeProject(), 'application/json'); updateStatus && updateStatus('Exported JSON'); } catch(e){ try{ updateStatus('JSON export failed'); }catch(_){} } });
    }
    if (typeof restoreProject==='function') {
      registerImport('json', async function(file){ try{ var text = await file.text(); restoreProject(text); renderLoop && renderLoop(); updateStatus && updateStatus('Imported project'); } catch(e){ try{ updateStatus('JSON import failed'); }catch(_){} } });
    }
  } catch(e) {}

  // OBJ
  try {
    if (typeof exportOBJ==='function') registerExport('obj', async function(){ exportOBJ(); });
  } catch(e) {}

  // PDF (export view)
  try {
    if (typeof exportPdfFromCanvas==='function') registerExport('pdf', async function(){ exportPdfFromCanvas(); });
  } catch(e) {}

  // SVG floorplan
  try {
    if (typeof importSVGFloorplan==='function') registerImport('svg-floorplan', async function(file){ try{ var text = await file.text(); importSVGFloorplan(text, file && file.name || 'floorplan.svg'); } catch(e){ try{ updateStatus('SVG import failed'); }catch(_){} } });
  } catch(e) {}

  // DXF / DWG registered by their own scripts (see js/io/formats/*.js)
})();
