(function(){
  'use strict';

  function _sleep(ms){
    return new Promise(function(res){ setTimeout(res, ms||0); });
  }

  function _showImportProgress(msg){
    try { if (typeof window.showFpHint === 'function') window.showFpHint(msg, 5000); } catch(_h) {}
    try { if (typeof window.updateStatus === 'function') window.updateStatus(msg); } catch(_s) {}
  }

  function _arrayBufferToBase64(buf){
    try {
      var bytes = new Uint8Array(buf);
      var chunkSize = 0x8000;
      var binary = '';
      for (var i=0; i<bytes.length; i += chunkSize) {
        var sub = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, sub);
      }
      return btoa(binary);
    } catch(_e) {
      return '';
    }
  }

  function _base64ToUint8Array(b64){
    try {
      var binary = atob(String(b64||''));
      var len = binary.length;
      var out = new Uint8Array(len);
      for (var i=0;i<len;i++) out[i] = binary.charCodeAt(i) & 255;
      return out;
    } catch(_e) {
      return null;
    }
  }

  async function _convertDwgToDxfViaServer(file){
    try {
      var buf = await file.arrayBuffer();
      var b64 = _arrayBufferToBase64(buf);
      if (!b64) return { ok: false, error: 'base64-failed' };
      var res = await fetch('/api/dwg/to-dxf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name || 'input.dwg', bytesBase64: b64 })
      });
      var json = null;
      try { json = await res.json(); } catch(_je) { json = null; }
      if (!res.ok) {
        var msg = (json && (json.message || json.error)) || ('HTTP ' + res.status);
        return { ok: false, error: 'server-error', message: msg, detail: json };
      }
      if (json && json.dxfText) {
        return { ok: true, dxfText: String(json.dxfText) };
      }
      if (json && json.dxfBase64) {
        var u8 = _base64ToUint8Array(json.dxfBase64);
        if (!u8) return { ok: false, error: 'decode-failed' };
        try {
          var txt = new TextDecoder('utf-8').decode(u8);
          return { ok: true, dxfText: txt };
        } catch(_td) {
          // Fallback best-effort
          var s = '';
          for (var i=0;i<u8.length;i++) s += String.fromCharCode(u8[i]);
          return { ok: true, dxfText: s };
        }
      }
      return { ok: false, error: 'no-output' };
    } catch(e) {
      return { ok: false, error: 'exception', message: String(e && e.message || e) };
    }
  }

  async function _convertDwgToPlan2dViaServer(file, opts){
    opts = opts || {};
    try {
      var buf = await file.arrayBuffer();
      var b64 = _arrayBufferToBase64(buf);
      if (!b64) return { ok: false, error: 'base64-failed' };
      var payload = {
        filename: file.name || 'input.dwg',
        bytesBase64: b64,
        units: opts.units || 'mm',
        level: (typeof opts.level === 'number' ? opts.level : (typeof window.currentFloor === 'number' ? window.currentFloor : 0)),
        thicknessM: (typeof opts.thicknessM === 'number' ? opts.thicknessM : 0.01),
        // Conservative defaults; server will also apply its own caps.
        maxWalls: (typeof opts.maxWalls === 'number' ? opts.maxWalls : 12000),
        minLenMm: (typeof opts.minLenMm === 'number' ? opts.minLenMm : 100),
        quantMm: (typeof opts.quantMm === 'number' ? opts.quantMm : 20),
        maxSegments: (typeof opts.maxSegments === 'number' ? opts.maxSegments : 300000),
        expandInserts: (typeof opts.expandInserts === 'boolean' ? opts.expandInserts : true),
        maxInsertSegs: (typeof opts.maxInsertSegs === 'number' ? opts.maxInsertSegs : 2500)
      };
      var res = await fetch('/api/dwg/to-plan2d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var json = null;
      try { json = await res.json(); } catch(_je) { json = null; }
      if (!res.ok) {
        var msg = (json && (json.message || json.error)) || ('HTTP ' + res.status);
        return { ok: false, error: 'server-error', message: msg, detail: json };
      }
      if (json && json.ok && Array.isArray(json.elements)) {
        return { ok: true, plan: json };
      }
      return { ok: false, error: 'no-output', detail: json };
    } catch (e) {
      return { ok: false, error: 'exception', message: String(e && e.message || e) };
    }
  }

  async function _fetchDwgStatus(){
    try {
      var res = await fetch('/api/dwg/status', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch(_e) {
      return null;
    }
  }

  async function _ensurePlan2DLoaded(){
    try {
      if (typeof window.plan2dImport === 'function' && typeof window.openPlan2DModal === 'function') return true;
      if (typeof window.loadScript !== 'function') return false;
      await loadScript('js/plan2d/geom2d.js');
      await loadScript('js/plan2d/snap.js');
      await loadScript('js/plan2d/walls.js');
      await loadScript('js/plan2d/draw.js');
      await loadScript('js/plan2d/editor-core.js');
      await loadScript('js/plan2d/editor.js');
      return (typeof window.plan2dImport === 'function' && typeof window.openPlan2DModal === 'function');
    } catch (_e) {
      return false;
    }
  }

  function _bytesToAscii(u8){
    try {
      var out = '';
      var n = Math.min(u8.length, 4096);
      for (var i=0;i<n;i++) {
        var c = u8[i];
        // keep printable ASCII, normalize NUL/controls to space
        if (c === 9 || c === 10 || c === 13) { out += String.fromCharCode(c); continue; }
        if (c >= 32 && c <= 126) out += String.fromCharCode(c);
        else out += ' ';
      }
      return out;
    } catch(_e) {
      return '';
    }
  }

  async function _readHeaderBytes(file, maxBytes){
    try {
      var slice = file.slice(0, Math.max(64, maxBytes||2048));
      var buf = await slice.arrayBuffer();
      return new Uint8Array(buf);
    } catch(_e) {
      return null;
    }
  }

  function _looksLikeDXF(ascii){
    if (!ascii) return false;
    // DXF commonly starts with group codes like "0\nSECTION" or comment codes.
    // We keep this liberal to catch renamed DXFs.
    return /\bSECTION\b[\s\S]*\bENTITIES\b/.test(ascii) || /^\s*(0\s*\r?\n\s*SECTION\b|999\s*\r?\n)/i.test(ascii);
  }

  function _looksLikePDF(ascii){ return /^\s*%PDF-/.test(ascii||''); }
  function _looksLikeSVG(ascii){ return /<svg[\s>]/i.test(ascii||''); }

  function _dwgVersionFromHeaderAscii(ascii){
    try {
      // DWG files start with "AC10xx" in the first 6 bytes (e.g. AC1027).
      var m = (ascii||'').match(/\bAC10\d\d\b/);
      return m ? m[0] : '';
    } catch(_e){
      return '';
    }
  }

  async function importFile(file){
    try {
      if (!file) return;

      // Bring up the floorplan modal early so the user sees progress.
      try {
        if (typeof window.openFloorplanModal === 'function') {
          window.openFloorplanModal({});
        }
      } catch(_om) {}

      var hdr = await _readHeaderBytes(file, 4096);
      var ascii = hdr ? _bytesToAscii(hdr) : '';

      // Common real-world issue: vendors send DXF renamed to .DWG.
      // If the payload looks like ASCII DXF, import it through the DXF importer.
      if (_looksLikeDXF(ascii)) {
        if (window.DXF && typeof DXF.importFile === 'function') {
          try { updateStatus && updateStatus('File looks like DXF (despite .DWG). Importing as DXF…'); } catch(_s1) {}
          return await DXF.importFile(file);
        }
        try { updateStatus && updateStatus('DXF importer unavailable'); } catch(_s2) {}
        return;
      }

      // Helpful detection for other common mis-uploads
      if (_looksLikePDF(ascii)) {
        try { updateStatus && updateStatus('This file is a PDF. Use Import → Floorplan (PDF).'); } catch(_s3) {}
        return;
      }
      if (_looksLikeSVG(ascii)) {
        try { updateStatus && updateStatus('This file is an SVG. Use Import → Floorplan (SVG).'); } catch(_s4) {}
        return;
      }

      // True DWG: we can at least identify the version and guide the user.
      var ver = _dwgVersionFromHeaderAscii(ascii);
      var verMsg = ver ? (' ('+ver+')') : '';

      // Attempt server-side conversion (if configured) so true DWGs can import.
      try {
        if (typeof fetch === 'function') {
          var startTs = Date.now();
          var running = true;
          (async function(){
            while (running) {
              var sec = Math.max(0, Math.round((Date.now() - startTs)/1000));
              _showImportProgress('Converting DWG'+verMsg+'… ' + sec + 's');
              await _sleep(500);
            }
          })();

          // Preferred: server generates simplified Plan2D JSON (avoids client DXF parsing stalls)
          var planRes = await _convertDwgToPlan2dViaServer(file, {
            units: 'mm',
            level: (typeof window.currentFloor === 'number' ? window.currentFloor : 0),
            // Hairline import: CAD lines are not wall thickness.
            thicknessM: 0.01,
            // Help tiny endpoint gaps “join” by snapping to a 1mm grid server-side.
            weldMm: 1
          });
          if (planRes && planRes.ok && planRes.plan) {
            running = false;
            _showImportProgress('DWG converted. Opening 2D editor…');
            var ok2d = await _ensurePlan2DLoaded();
            if (!ok2d) {
              try { updateStatus && updateStatus('2D editor not available (plan2d scripts not loaded)'); } catch(_p2) {}
              return;
            }
            try { if (typeof window.resetSceneForImport === 'function') window.resetSceneForImport(); } catch(_ri) {}
            try { if (typeof window.openPlan2DModal === 'function') window.openPlan2DModal(); } catch(_op2) {}
            try { if (typeof window.plan2dClear === 'function') window.plan2dClear(); } catch(_clr) {}
            // Keep Plan2D defaults consistent with the imported (hairline) geometry.
            try { if (window.__plan2d && typeof __plan2d.wallThicknessM === 'number') __plan2d.wallThicknessM = 0.01; } catch(_wt) {}
            try { window.__lastDwgPlan2dJson = planRes.plan; } catch(_dbg2) {}
            try { if (typeof window.plan2dImport === 'function') window.plan2dImport(planRes.plan); } catch(_imp2) {}
            try { if (typeof window.plan2dFitViewToContent === 'function') window.plan2dFitViewToContent(40); } catch(_fit2) {}
            try { if (typeof window.plan2dDraw === 'function') window.plan2dDraw(); } catch(_dr2) {}
            try { updateStatus && updateStatus('DWG loaded into 2D editor (' + (planRes.plan.elements ? planRes.plan.elements.length : 0) + ' walls)'); } catch(_ok2) {}
            return;
          }

          // Fallback: DWG->DXF and then client-side conversion
          var conv = await _convertDwgToDxfViaServer(file);
          running = false;
          if (conv && conv.ok && conv.dxfText) {
            // New flow: convert DXF geometry into Plan2D JSON so the user can edit.
            if (window.DXF && typeof DXF.convertDXFTextToPlan2DJSON === 'function') {
              _showImportProgress('DWG converted. Building editable 2D plan…');
              var ok2d = await _ensurePlan2DLoaded();
              if (!ok2d) {
                try { updateStatus && updateStatus('2D editor not available (plan2d scripts not loaded)'); } catch(_p2) {}
                return;
              }

              // Clear scene for a clean import.
              try { if (typeof window.resetSceneForImport === 'function') window.resetSceneForImport(); } catch(_ri) {}
              try { if (typeof window.openPlan2DModal === 'function') window.openPlan2DModal(); } catch(_op2) {}
              try { if (typeof window.plan2dClear === 'function') window.plan2dClear(); } catch(_clr) {}

              var planJson = await DXF.convertDXFTextToPlan2DJSON(conv.dxfText, {
                level: (typeof window.currentFloor === 'number' ? window.currentFloor : 0),
                // User-provided: client DWGs are authored in millimeters.
                forceUnits: 'mm',
                // Keep this conservative so Plan2D stays responsive.
                maxWalls: 15000,
                minLenM: 0.15,
                quantizeM: 0.01
              });
              if (!planJson || !planJson.ok || !Array.isArray(planJson.elements) || planJson.elements.length === 0) {
                try { updateStatus && updateStatus('DWG imported but no usable 2D geometry found'); } catch(_ng) {}
                return;
              }

              try { window.__lastDwgPlan2dJson = planJson; } catch(_dbg) {}
              try { if (typeof window.plan2dImport === 'function') window.plan2dImport(planJson); } catch(_imp) {}
              try { if (typeof window.plan2dFitViewToContent === 'function') window.plan2dFitViewToContent(40); } catch(_fit) {}
              try { if (typeof window.plan2dDraw === 'function') window.plan2dDraw(); } catch(_dr) {}
              try { updateStatus && updateStatus('DWG loaded into 2D editor (' + planJson.elements.length + ' walls)'); } catch(_ok) {}
              return;
            }

            // Fallback to legacy preview modal if Plan2D converter isn't available.
            if (window.DXF && typeof DXF.importFile === 'function') {
              var blob = new Blob([conv.dxfText], { type: 'application/dxf' });
              try { blob.name = (file.name || 'converted') + '.dxf'; } catch(_n) {}
              _showImportProgress('DWG converted. Parsing DXF…');
              return await DXF.importFile(blob);
            }

            try { updateStatus && updateStatus('DWG converted, but DXF importer unavailable'); } catch(_cs3) {}
            return;
          }

          running = false;

          // If the server explicitly says conversion isn't configured, show actionable guidance.
          try {
            var detail = conv && conv.detail;
            if (detail && detail.error && (detail.error === 'dwg-converter-not-configured' || detail.error === 'converter-not-found')) {
              if (typeof window.showAppleAlert === 'function') {
                var required = detail.requiredEnv ? String(detail.requiredEnv) : '';
                var status = await _fetchDwgStatus();
                var statusLine = '';
                try {
                  if (status && status.dwgToDxf) {
                    var s = status.dwgToDxf;
                    statusLine = '\n\nServer status: ' +
                      (s.configured ? 'configured' : 'not configured') +
                      (s.bin ? (' (bin: ' + s.bin + (s.binFound ? ', found' : ', NOT found') + ')') : '');
                  }
                } catch(_st) {}

                var msg = (detail.message ? String(detail.message) : 'DWG converter is not configured on the server.') +
                  (required ? ('\n\nRequired env: ' + required) : '') +
                  statusLine +
                  '\n\nOn Linux you must install a DWG converter tool and set the env vars in the server/service. See DWG_CONVERSION_SETUP.md.';
                window.showAppleAlert('DWG Import', msg);
              }
            }
          } catch(_convMsg) {}
        }
      } catch(_convErr) {}

      try {
        updateStatus && updateStatus('DWG import not supported in-browser'+verMsg+'. Convert to DXF and import.');
      } catch(_s5) {}

      // Provide a more actionable modal when available
      try {
        if (typeof window.showAppleAlert === 'function') {
          var fname = (file && file.name) ? String(file.name) : 'DWG file';
          var details = ver ? ('Detected DWG version: '+ver+'.\n\n') : '';
          window.showAppleAlert(
            'DWG Import',
            fname + '\n\n' +
            details +
            'This app can import DXF/PDF/SVG floorplans, but it cannot parse native DWG files in the browser.\n\n' +
            'Ask the client to export/save as DXF (ASCII preferred) and re-upload the .dxf. If they have AutoCAD: File → Save As → DXF (AutoCAD 2000 or R12 ASCII).'
          );
        }
      } catch(_s6) {}
    } catch (e) {
      try { updateStatus && updateStatus('DWG import failed'); } catch(_){}
    }
  }

  async function exportCurrentProject(){
    try {
      // Prefer server-side DXF->DWG conversion when configured.
      if (!(window.DXF && (typeof DXF.serializeProjectToDXFString === 'function' || typeof DXF.exportProject === 'function'))) {
        try { updateStatus && updateStatus('DWG export not available'); } catch(_){ }
        return;
      }

      var dxfText = null;
      if (typeof DXF.serializeProjectToDXFString === 'function') {
        dxfText = DXF.serializeProjectToDXFString();
      }
      if (!dxfText) {
        // Fall back to DXF download path
        if (typeof DXF.exportProject === 'function') {
          DXF.exportProject();
          try { updateStatus && updateStatus('DWG export not available. Exported DXF instead.'); } catch(_){ }
        }
        return;
      }

      try { updateStatus && updateStatus('Converting DXF to DWG…'); } catch(_s) {}
      var res = await fetch('/api/dwg/to-dwg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'gablok-export.dxf', dxfText: String(dxfText) })
      });
      var json = null;
      try { json = await res.json(); } catch(_je) { json = null; }
      if (!res.ok) {
        var msg = (json && (json.message || json.error)) || ('HTTP ' + res.status);
        // Server not configured -> fallback to DXF
        if (window.DXF && typeof DXF.exportProject === 'function') {
          DXF.exportProject();
          try { updateStatus && updateStatus('DWG export unavailable ('+msg+'). Exported DXF instead.'); } catch(_){ }
        } else {
          try { updateStatus && updateStatus('DWG export failed: '+msg); } catch(_){ }
        }
        return;
      }
      if (!json || !json.bytesBase64) {
        if (window.DXF && typeof DXF.exportProject === 'function') {
          DXF.exportProject();
          try { updateStatus && updateStatus('DWG export unavailable. Exported DXF instead.'); } catch(_){ }
        }
        return;
      }

      var u8 = _base64ToUint8Array(json.bytesBase64);
      if (!u8) {
        if (window.DXF && typeof DXF.exportProject === 'function') {
          DXF.exportProject();
          try { updateStatus && updateStatus('DWG export decode failed. Exported DXF instead.'); } catch(_){ }
        }
        return;
      }

      // Download DWG
      try {
        var blob = new Blob([u8], { type: 'application/acad' });
        var name = 'gablok-export.dwg';
        if (typeof download === 'function') {
          download(name, blob, 'application/acad');
        } else {
          // basic anchor fallback
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a);
          a.click();
          setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(_e){} try{ a.remove(); }catch(_e2){} }, 1000);
        }
        try { updateStatus && updateStatus('Exported DWG'); } catch(_){ }
      } catch(_dl) {
        if (window.DXF && typeof DXF.exportProject === 'function') {
          DXF.exportProject();
          try { updateStatus && updateStatus('DWG download failed. Exported DXF instead.'); } catch(_){ }
        }
      }
    } catch(e){ try { updateStatus && updateStatus('DWG export failed'); } catch(_){} }
  }

  try { if (window.FileIO && FileIO.registerImport) FileIO.registerImport('dwg', importFile); } catch(e){}
  try { if (window.FileIO && FileIO.registerExport) FileIO.registerExport('dwg', exportCurrentProject); } catch(e){}

  window.DWG = { importFile: importFile, exportProject: exportCurrentProject };
})();
