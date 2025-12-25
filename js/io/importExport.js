/**
 * @file importExport.js
 * @description Import and export functionality for Gablok 3D configurator.
 * 
 * **Responsibilities:**
 * - Export 3D models to OBJ format
 * - Import floorplans from SVG files
 * - Export current view to PDF
 * - Export/import project as JSON
 * - Lazy-load PDF.js and jsPDF libraries
 * 
 * **Dependencies:**
 * - `js/core/engine3d.js` - Provides: allRooms, wallStrips, updateStatus
 * - `js/core/project.js` - Provides: saveProjectSilently
 * - Assumes global state objects are available
 * 
 * **Global Objects Used (from engine3d.js):**
 * - `allRooms` - Array of room objects
 * - `wallStrips` - Array of standalone wall segments
 * - `stairsComponent` - Stairs object (nullable)
 * - `pergolaComponents` - Array of pergola objects
 * - `garageComponents` - Array of garage objects
 * - `poolComponents` - Array of pool objects
 * - `roofComponents` - Array of roof objects
 * - `balconyComponents` - Array of balcony objects
 * - `furnitureItems` - Array of furniture objects
 * - `renderLoop()` - Function to trigger re-render
 * - `updateStatus(msg)` - Function to show status message
 * 
 * **Global Objects Used (from project.js):**
 * - `saveProjectSilently()` - Save project after import
 * 
 * **Exports to window:**
 * - `window.exportOBJ()` - Export 3D model to OBJ format
 * - `window.importSVGFloorplan(svgText, fileName)` - Import SVG floorplan
 * - `window.loadScript(url)` - Dynamically load external script
 * - `window.ensurePdfJsReady()` - Lazy-load PDF.js library
 * - `window.ensureJsPdfReady()` - Lazy-load jsPDF library
 * - `window.download(name, text, type)` - Download text file
 * - `window.exportPdfFromCanvas()` - Export canvas to PDF
 * 
 * @version 2.0 (Phase-2-Extraction)
 * @since 2024
 */

(function() {
  'use strict';

  /**
   * Export the entire 3D scene to OBJ format.
   * Converts all rooms, walls, and components to simple box geometry.
   */
  function exportOBJ() {
    // Minimal OBJ exporter for boxes (rooms/components)
    var lines = ['# Gablok Export'];
    var vcount = 0;
    function pushBox(obj, y0, y1, tag) {
      var hw = obj.width / 2, hd = obj.depth / 2;
      var cx = obj.x, cz = obj.z;
      var rotRad = ((obj.rotation || 0) * Math.PI) / 180;
      function rot(x, z) {
        var dx = x - cx, dz = z - cz;
        return {
          x: cx + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
          z: cz + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
        };
      }
      var corners = [
        rot(cx - hw, cz - hd), rot(cx + hw, cz - hd),
        rot(cx + hw, cz + hd), rot(cx - hw, cz + hd)
      ];
      // 8 vertices
      if (tag) lines.push('g ' + tag);
      var verts = [
        [corners[0].x, y0, corners[0].z], [corners[1].x, y0, corners[1].z],
        [corners[2].x, y0, corners[2].z], [corners[3].x, y0, corners[3].z],
        [corners[0].x, y1, corners[0].z], [corners[1].x, y1, corners[1].z],
        [corners[2].x, y1, corners[2].z], [corners[3].x, y1, corners[3].z]
      ];
      verts.forEach(function(v) {
        lines.push('v ' + v[0] + ' ' + v[1] + ' ' + v[2]);
      });
      // faces (1-indexed)
      var f = function(a, b, c, d) {
        lines.push('f ' + (vcount + a) + ' ' + (vcount + b) + ' ' + (vcount + c) + ' ' + (vcount + d));
      };
      vcount += 8;
      f(1, 2, 3, 4); f(5, 6, 7, 8); f(1, 2, 6, 5);
      f(2, 3, 7, 6); f(3, 4, 8, 7); f(4, 1, 5, 8);
    }
    // Rooms
    allRooms.forEach(function(r) {
      var y0 = r.level * 3.5, y1 = y0 + r.height;
      pushBox(r, y0, y1, 'room_' + (r.name || ''));
    });
    // Standalone wall strips exported as thin boxes with given height and thickness
    wallStrips.forEach(function(w) {
      // Build a centered thin box along the strip centerline
      var dx = w.x1 - w.x0, dz = w.z1 - w.z0;
      var L = Math.hypot(dx, dz) || 0;
      var cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
      var rot = (Math.atan2(dz, dx) * 180 / Math.PI) || 0;
      pushBox({
        x: cx, z: cz, width: L, depth: (w.thickness || 0.3), rotation: rot
      }, 0, (w.height || 3.0), 'wallstrip');
    });
    // Stairs: multiple supported; fallback to singleton
    (function(){ try {
      var scArr = window.stairsComponents || [];
      if (Array.isArray(scArr) && scArr.length){ for (var si=0; si<scArr.length; si++){ var s=scArr[si]; if(!s) continue; pushBox(s, 0, s.height, 'stairs'); } }
      else if (stairsComponent) pushBox(stairsComponent, 0, stairsComponent.height, 'stairs');
    } catch(_s){ if (stairsComponent) pushBox(stairsComponent, 0, stairsComponent.height, 'stairs'); } })();
    pergolaComponents.forEach(function(p) {
      pushBox(p, 0, p.totalHeight, 'pergola');
    });
    garageComponents.forEach(function(g) {
      pushBox(g, 0, g.height, 'garage');
    });
    poolComponents.forEach(function(p) {
      pushBox({
        x: p.x, z: p.z, width: p.width, depth: p.depth, rotation: p.rotation || 0
      }, -p.height, 0, 'pool');
    });
    roofComponents.forEach(function(r) {
      pushBox({
        x: r.x, z: r.z, width: r.width, depth: r.depth, rotation: r.rotation || 0
      }, r.baseHeight, r.baseHeight + r.height, 'roof');
    });
    balconyComponents.forEach(function(b) {
      var y0 = b.level * 3.5, y1 = y0 + b.height;
      pushBox(b, y0, y1, 'balcony');
    });
    furnitureItems.forEach(function(f) {
      var y0 = (f.level || 0) * 3.5, y1 = y0 + (f.height || 0.7);
      pushBox(f, y0, y1, 'furniture_' + (f.name || ''));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gablok-export.obj';
    a.click();
    URL.revokeObjectURL(a.href);
    updateStatus('Exported OBJ');
  }

  /**
   * Import an SVG floorplan and convert it to 3D rooms.
   * @param {string} svgText - SVG file content as text
   * @param {string} fileName - Original filename for reference
   */
  function importSVGFloorplan(svgText, fileName) {
    try {
      // Ensure a clean slate so previous content doesn't overlap
      try { if (typeof window.resetSceneForImport === 'function') window.resetSceneForImport(); } catch(_ri) {}
      var parser = new DOMParser();
      var doc = parser.parseFromString(svgText, 'image/svg+xml');
      // Parser error detection (browser inserts <parsererror>)
      if (doc.getElementsByTagName('parsererror').length > 0) {
        updateStatus('SVG parser error');
        return;
      }
      var svg = doc.documentElement;
      if (!svg || svg.tagName.toLowerCase() !== 'svg') {
        updateStatus('Invalid SVG root');
        return;
      }

      // Clone entire SVG into hidden DOM so getBBox() honors transforms
      var container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
      var cloneRoot = svg.cloneNode(true);
      container.appendChild(cloneRoot);
      document.body.appendChild(container);

      // Extract viewBox & physical size for unit scaling
      var vbAttr = cloneRoot.getAttribute('viewBox');
      var vb = null;
      if (vbAttr) {
        var parts = vbAttr.trim().split(/[,\s]+/).map(parseFloat);
        if (parts.length === 4 && parts.every(function(v) { return !isNaN(v); })) {
          vb = { minX: parts[0], minY: parts[1], w: parts[2], h: parts[3] };
        }
      }

      function parseSize(attr) {
        if (!attr) return null;
        var m = String(attr).trim().match(/([0-9.]+)([a-z%]*)/i);
        if (!m) return null;
        var v = parseFloat(m[1]);
        var unit = (m[2] || '').toLowerCase();
        if (isNaN(v)) return null;
        var mult = 1;
        switch (unit) {
          case 'mm': mult = 0.001; break;
          case 'cm': mult = 0.01; break;
          case 'm': mult = 1; break;
          case 'in': mult = 0.0254; break;
          case 'ft': mult = 0.3048; break;
          case 'px': default: mult = 1;
        }
        return { meters: v * mult, raw: v, unit: unit || 'px' };
      }

      var widthInfo = parseSize(cloneRoot.getAttribute('width'));
      var heightInfo = parseSize(cloneRoot.getAttribute('height'));
      var coordWidth = vb ? vb.w : (widthInfo ? widthInfo.raw : null);
      var scaleGuess = 1; // default: 1 svg unit -> 1 meter
      if (vb && widthInfo && widthInfo.unit !== 'px') {
        // derive scale from physical width vs viewBox width
        if (coordWidth && coordWidth > 0) scaleGuess = widthInfo.meters / coordWidth;
      }
      // Heuristic fallback if still huge
      if (scaleGuess === 1 && vb) {
        var maxSpan = Math.max(vb.w, vb.h);
        if (maxSpan > 500) {
          scaleGuess = 0.01;
        } else if (maxSpan > 100) {
          scaleGuess = 0.1;
        }
      }

      // Collect geometry elements
      var rects = Array.from(cloneRoot.querySelectorAll('rect'));
      var paths = Array.from(cloneRoot.querySelectorAll('path'));
      var allShapes = rects.concat(paths);

      // Compute bounding boxes
      var boxes = [];
      allShapes.forEach(function(el) {
        try {
          var bb = el.getBBox();
          if (bb.width > 0 && bb.height > 0) {
            boxes.push({
              x: bb.x, y: bb.y, w: bb.width, h: bb.height
            });
          }
        } catch (e) {}
      });

      if (boxes.length === 0) {
        document.body.removeChild(container);
        updateStatus('SVG contains no recognizable rooms');
        return;
      }

      // Convert to 3D rooms
      var roomsCreated = 0;
      var usedIds = {};
      allRooms.forEach(function(r) { if (r.id) usedIds[r.id] = true; });

      function genId() {
        var id;
        do { id = 'r' + Math.floor(Math.random() * 1e9); } while (usedIds[id]);
        usedIds[id] = true;
        return id;
      }

      boxes.forEach(function(b, idx) {
        var cx = (b.x + b.w / 2) * scaleGuess;
        var cz = (b.y + b.h / 2) * scaleGuess;
        var w = b.w * scaleGuess;
        var d = b.h * scaleGuess;
        // Filter tiny or gigantic boxes
        if (w < 0.5 || d < 0.5 || w > 50 || d > 50) return;
        allRooms.push({
          id: genId(),
          x: cx, z: cz,
          width: w, depth: d,
          height: 2.8,
          rotation: 0,
          level: 0,
          name: 'Room' + (roomsCreated + 1),
          category: 'generic',
          doors: [], windows: []
        });
        roomsCreated++;
      });

      document.body.removeChild(container);
      if (roomsCreated > 0) {
        saveProjectSilently();
        renderLoop();
        updateStatus('SVG imported ' + roomsCreated + ' room' + (roomsCreated !== 1 ? 's' : ''));
      } else {
        updateStatus('SVG import created 0 rooms');
      }
    } catch (err) {
      console.error('SVG parse error', err);
      updateStatus('SVG parse failed');
    }
  }

  /**
   * Dynamically load an external script.
   * @param {string} url - Script URL to load
   * @returns {Promise<boolean>} True if loaded successfully
   */
  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      try {
        var s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = function() { resolve(true); };
        s.onerror = function() { reject(new Error('Failed to load ' + url)); };
        document.head.appendChild(s);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Lazy-load PDF.js library for PDF import functionality.
   * Tries multiple CDN sources and local vendor files.
   * @returns {Promise<boolean>} True if PDF.js is available
   */
  var PDFJS_VERSION = '4.5.136';
  async function ensurePdfJsReady() {
    if (window.pdfjsLib) return true;
    try { updateStatus('Loading PDF engine…'); } catch (e) {}
    // Prefer local vendored files first, then CDNs (including a stable v3 path)
    var sources = [
      'vendor/pdfjs/pdf.min.js',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/build/pdf.min.js',
      'https://unpkg.com/pdfjs-dist@' + PDFJS_VERSION + '/build/pdf.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    ];
    for (var i = 0; i < sources.length; i++) {
      try {
        await loadScript(sources[i]);
        if (window.pdfjsLib) {
          // Set worker to matching CDN if possible
          try {
            var base = sources[i].replace(/pdf\.min\.js$/, '');
            var worker = base + 'pdf.worker.min.js';
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
          } catch (e) {}
          try { updateStatus('PDF engine ready'); } catch (e) {}
          return true;
        }
      } catch (e) {
        // try next source
      }
    }
    try {
      updateStatus('PDF Import not available (offline or blocked)');
    } catch (e) {}
    return false;
  }

  /**
   * Lazy-load jsPDF library for PDF export functionality.
   * @returns {Promise<boolean>} True if jsPDF is available
   */
  async function ensureJsPdfReady() {
    if (window.jspdf && window.jspdf.jsPDF) return true;
    try {
      if (typeof updateStatus === 'function') updateStatus('Loading PDF export…');
    } catch (e) {}
    var sources = [
      'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
      'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
    ];
    for (var i = 0; i < sources.length; i++) {
      try {
        await loadScript(sources[i]);
        if (window.jspdf && window.jspdf.jsPDF) {
          try { updateStatus('PDF export ready'); } catch (e) {}
          return true;
        }
      } catch (e) { /* try next */ }
    }
    try { updateStatus('Failed to load PDF export'); } catch (e) {}
    return false;
  }

  /**
   * Download text content as a file.
   * @param {string} name - Filename for download
   * @param {string} text - File content
   * @param {string} type - MIME type (default: text/plain)
   */
  function download(name, text, type) {
    try {
      var blob = new Blob([text], { type: type || 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(function() {
        URL.revokeObjectURL(a.href);
      }, 0);
    } catch (e) {}
  }

  /**
   * Export the current 3D canvas view to a PDF file.
   */
  async function exportPdfFromCanvas() {
    try {
      var ok = await ensureJsPdfReady();
      if (!ok || !(window.jspdf && window.jspdf.jsPDF)) {
        updateStatus && updateStatus('PDF export unavailable');
        return;
      }
      var cnv = document.getElementById('canvas');
      if (!cnv) {
        updateStatus && updateStatus('No canvas to export');
        return;
      }
      var dataUrl = cnv.toDataURL('image/jpeg', 0.92);
      var doc = new window.jspdf.jsPDF('landscape', 'pt', 'a4');
      // Fit canvas image into A4 page keeping aspect
      var pageW = doc.internal.pageSize.getWidth();
      var pageH = doc.internal.pageSize.getHeight();
      var img = new Image();
      await new Promise(function(res) {
        img.onload = res;
        img.src = dataUrl;
      });
      var iw = img.width, ih = img.height;
      var scale = Math.min(pageW / iw, pageH / ih);
      var dw = Math.floor(iw * scale), dh = Math.floor(ih * scale);
      var dx = Math.floor((pageW - dw) / 2), dy = Math.floor((pageH - dh) / 2);
      doc.addImage(dataUrl, 'JPEG', dx, dy, dw, dh);
      doc.save('gablok-export.pdf');
      updateStatus && updateStatus('Exported PDF');
    } catch (e) {
      try {
        updateStatus('PDF export failed');
      } catch (_) {}
    }
  }

  // Export to global scope
  window.exportOBJ = exportOBJ;
  window.importSVGFloorplan = importSVGFloorplan;
  window.loadScript = loadScript;
  window.ensurePdfJsReady = ensurePdfJsReady;
  window.ensureJsPdfReady = ensureJsPdfReady;
  window.download = download;
  window.exportPdfFromCanvas = exportPdfFromCanvas;

})();
