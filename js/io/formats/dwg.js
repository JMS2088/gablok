(function(){
  'use strict';

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

  async function _fetchDwgStatus(){
    try {
      var res = await fetch('/api/dwg/status', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch(_e) {
      return null;
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
          try { updateStatus && updateStatus('Converting DWG'+verMsg+' to DXF…'); } catch(_cs) {}
          var conv = await _convertDwgToDxfViaServer(file);
          if (conv && conv.ok && conv.dxfText) {
            if (window.DXF && typeof DXF.importFile === 'function') {
              var blob = new Blob([conv.dxfText], { type: 'application/dxf' });
              try { blob.name = (file.name || 'converted') + '.dxf'; } catch(_n) {}
              try { updateStatus && updateStatus('DWG converted. Loading DXF…'); } catch(_cs2) {}
              return await DXF.importFile(blob);
            }
            try { updateStatus && updateStatus('DWG converted, but DXF importer unavailable'); } catch(_cs3) {}
            return;
          }

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
