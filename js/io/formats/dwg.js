(function(){
  'use strict';

  async function importFile(file){
    try {
      // DWG is a complex binary format; in-browser parsing not supported here
      try { updateStatus && updateStatus('DWG import not supported in-browser. Please convert to DXF and import.'); } catch(_) {}
    } catch (e) {
      try { updateStatus && updateStatus('DWG import failed'); } catch(_){}
    }
  }

  async function exportCurrentProject(){
    try {
      // Offer DXF instead and message
      if (window.DXF && typeof DXF.exportProject==='function') {
        DXF.exportProject();
        try { updateStatus && updateStatus('DWG export not available. Exported DXF instead.'); } catch(_){}
      } else {
        try { updateStatus && updateStatus('DWG export not available'); } catch(_){}
      }
    } catch(e){ try { updateStatus && updateStatus('DWG export failed'); } catch(_){} }
  }

  try { if (window.FileIO && FileIO.registerImport) FileIO.registerImport('dwg', importFile); } catch(e){}
  try { if (window.FileIO && FileIO.registerExport) FileIO.registerExport('dwg', exportCurrentProject); } catch(e){}

  window.DWG = { importFile: importFile, exportProject: exportCurrentProject };
})();
