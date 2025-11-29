/**
 * @file app.js
 * @description Main application orchestration and feature integration for Gablok 3D configurator.
 * 
 * **Responsibilities:**
 * - Project persistence (save/load/reset via localStorage & JSON)
 * - File import/export (OBJ, PDF floorplans, SVG, JSON)
 * - Floorplan modal UI (PDF calibration, auto-detection)
 * - Room manipulation (add, edit, delete, duplicate, transform)
 * - Component management (stairs, pergolas, garages, pools, balconies, roofs, furniture)
 * - Floor switching and UI controls
 * - Global event wiring and modal coordination
 * 
 * **Dependencies:**
 * - `js/core/engine3d.js` - 3D rendering engine, camera, grid (must load first)
 * - `js/core/plan-apply.js` - 2D→3D mapping logic
 * - `js/plan2d/editor.js` - 2D floor plan editor (defines __plan2d, openPlan2DModal, etc.)
 * - `js/render/*.js` - Component-specific drawing functions (drawRoom, drawGarage, etc.)
 * - `js/ui/*.js` - UI modules (roomPalette, labels, pricing, modals)
 * - `js/input/events.js` - Mouse/touch input handling
 * 
 * **Global Objects Used:**
 * - `camera`, `allRooms`, `wallStrips`, `currentFloor`, `selectedRoomId` (from engine3d.js)
 * - `__plan2d`, `__plan2dDrafts` (from plan2d/editor.js)
 * - `renderLoop()`, `updateStatus()`, `project3D()` (from engine3d.js)
 * - `applyPlan2DTo3D()` (from plan-apply.js)
 * 
 * **Refactoring Status:**
 * Phase 1 (Nov 2025): Removed ~2,200 lines of duplicate 2D editor code.
 * Next phases: Extract project.js, io/importExport.js, ui/floorplanModal.js, core/roomOperations.js
 * 
 * @version 2.0 (Post-Phase-1-Refactoring)
 * @since 2024
 */

// Core engine bootstrap moved to js/core/engine3d.js

// Global animation frame handle to avoid ReferenceErrors before first render
// (Removed) corner wall markers overlay

// Floor switching from the main dropdown (and hidden select)
function switchLevel(){
  try {
    var sel = document.getElementById('levelSelect');
    var val = sel ? sel.value : '0';
    // Delegate to 2D editor handler when active to keep 2D/3D in lockstep
    if (window.__plan2d && __plan2d.active && typeof plan2dSwitchFloorInEditor==='function'){
      var to = (val==='1') ? 1 : 0;
      plan2dSwitchFloorInEditor(to);
      return;
    }
    // Regular 3D floor switch
    if (val==='0' || val==='1'){
      var newFloor = (val==='1') ? 1 : 0;
      currentFloor = newFloor;
      // Preserve selection when possible: only clear if selected item lives on a different floor
      try {
        if (typeof findObjectById === 'function' && selectedRoomId) {
          var obj = findObjectById(selectedRoomId);
          if (!obj || (typeof obj.level === 'number' && obj.level !== newFloor)) {
            if (typeof window.selectObject==='function') { window.selectObject(null, { noRender: true }); }
            else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eM0) {} }
          }
        }
      } catch(_sel){ /* non-fatal */ }
      // Keep selection consistent via unified helper (ensures measurement panel instant update)
      try {
        if (selectedRoomId && typeof window.selectObject === 'function') {
          window.selectObject(selectedRoomId, { noRender: true });
        }
      } catch(_selH) {}
      renderLoop && renderLoop();
      updateStatus && updateStatus('Switched to ' + (currentFloor===0 ? 'Ground' : 'First') + ' Floor');
      // Keep render style consistent across floors: if solid mode is active, rebuild room perimeter strips
      try {
        if (window.__wallRenderMode === 'solid' && typeof window.rebuildRoomPerimeterStrips === 'function') {
          var t = (typeof window.__roomWallThickness === 'number' && window.__roomWallThickness > 0) ? window.__roomWallThickness : 0.3;
          window.rebuildRoomPerimeterStrips(t);
        }
      } catch(_eRe){ /* non-fatal */ }
      // Ensure measurements panel remains visible after switching
      try { if (typeof ensureMeasurementsVisible==='function') ensureMeasurementsVisible(); } catch(_m){}
      // Sync 2D floor toggle highlight (even if 2D currently closed so next open is correct)
      try { if(typeof window.syncPlan2DFloorButtons==='function') window.syncPlan2DFloorButtons(); }catch(_hl){}
    }
  } catch(e){ /* ignore */ }
}


function __wireAppUi(){
  // Room palette is now lazy-loaded on first open (no eager setup here)

  // Wire SVG floorplan upload input
  var uploadSvg = document.getElementById('upload-svg-floorplan');
  if (uploadSvg) uploadSvg.onchange = async function(e){
    var f = e.target.files && e.target.files[0]; if(!f) return; try {
      var text = await f.text();
      importSVGFloorplan(text, f.name || 'floorplan.svg');
    } catch(err){ console.error('SVG load failed', err); updateStatus('Failed to load SVG'); }
    finally { uploadSvg.value=''; }
  };

  // Floor Plan 2D button (lazy-safe binding)
  var fp2dBtn = document.getElementById('btn-floorplan');
  if (fp2dBtn) fp2dBtn.addEventListener('click', function(){
    try {
      if (typeof window.openPlan2DModal === 'function') { window.openPlan2DModal(); return; }
      // Fallback to global symbol if available
      if (typeof openPlan2DModal === 'function') { openPlan2DModal(); return; }
      // As a last resort, try to lazy-load editor module
      if (typeof loadScript === 'function') {
        loadScript('js/plan2d/editor.js').then(function(){ try { if (typeof window.openPlan2DModal==='function') window.openPlan2DModal(); } catch(e){} });
      }
    } catch(e){ /* no-op */ }
  });

  // Custom Level Dropdown wiring
  (function(){
    var dd = document.getElementById('levelDropdown');
    var btn = document.getElementById('levelButton');
    var btnText = document.getElementById('levelButtonText');
    var list = document.getElementById('levelList');
    var nativeSel = document.getElementById('levelSelect');
    function close(){ if(dd) dd.classList.remove('open'); }
    function open(){ if(dd) dd.classList.add('open'); }
    function setLabelFromValue(v){
      var map = { '0':'Ground Floor', '1':'First Floor', 'stairs':'+ Stairs', 'pergola':'+ Pergola', 'garage':'+ Garage', 'roof':'+ Roof', 'pool':'+ Pool', 'balcony':'+ Balcony' };
      if(btnText) btnText.textContent = map[String(v)] || 'Level';
    }
    // Expose a helper to enable/disable add items dynamically based on state (e.g., singleton stairs)
    // With multi-stairs support, ensure "+ Stairs" is always enabled
    function updateLevelMenuStates(){
      try {
        if (!list) return;
        var stairsItem = list.querySelector('.dropdown-item[data-value="stairs"]');
        if (stairsItem){ stairsItem.classList.remove('disabled'); stairsItem.removeAttribute('title'); }
      } catch(_e){}
    }
    try { window.updateLevelMenuStates = updateLevelMenuStates; } catch(_g){}
    if(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); if(dd.classList.contains('open')) close(); else open(); }); }
    if(list){ list.addEventListener('click', function(e){
      var item=e.target.closest('.dropdown-item'); if(!item || item.classList.contains('separator')) return;
      if (item.classList.contains('disabled')) return; // ignore disabled actions
      var val=item.getAttribute('data-value');
      // Handle special add actions directly to avoid creation during generic switchLevel()
      var addMap = {
        'pergola': function(){ if(typeof addPergola==='function') addPergola(); },
        'garage': function(){ if(typeof addGarage==='function') addGarage(); },
        'roof': function(){ if(typeof addRoof==='function') addRoof(); },
        'pool': function(){ if(typeof addPool==='function') addPool(); },
        'balcony': function(){ if(typeof addBalcony==='function') addBalcony(); },
        'stairs': function(){ if(typeof addStairs==='function') addStairs(); }
      };
      if (addMap[val]){
        try { addMap[val](); } catch(err) { console.warn('Add action failed for', val, err); }
        // Normalize selector to the current floor after creation/focus
        if(nativeSel){ nativeSel.value = String(typeof currentFloor==='number' ? currentFloor : 0); }
        setLabelFromValue(nativeSel ? nativeSel.value : '0');
        // Refresh states (kept as a no-op for stairs)
        try { updateLevelMenuStates(); } catch(_u){}
        close();
        return;
      }
      // Regular floor switch
  if(nativeSel){ nativeSel.value = val; }
      setLabelFromValue(val);
      if(typeof switchLevel==='function') switchLevel();
      close();
    }); }
    document.addEventListener('click', close);
    document.addEventListener('keydown', function(ev){ if(ev.key==='Escape') close(); });
    // Initialize label from current state
    if(nativeSel){ setLabelFromValue(nativeSel.value || '0'); }
    // Initialize dynamic states (disable stairs if already present)
    try { updateLevelMenuStates(); } catch(_i){}
  })();

  // Global helper to keep Ground/First toggle buttons in sync with currentFloor
  try {
    if(typeof window.syncPlan2DFloorButtons!=='function'){
      window.syncPlan2DFloorButtons = function(){
        try {
          var cur = (typeof window.currentFloor==='number'? window.currentFloor:0);
          var g=document.getElementById('plan2d-floor-ground');
          var f=document.getElementById('plan2d-floor-first');
          if(g&&f){
            if(cur===0){ g.classList.add('active'); f.classList.remove('active'); }
            else { f.classList.add('active'); g.classList.remove('active'); }
          }
        } catch(e){}
      };
    }
    // Initial sync on UI wiring
    window.syncPlan2DFloorButtons();
  }catch(_syncInit){}

  // Main Actions Dropdown (Info/Share/Export/Import) wiring
  (function(){
    var dd = document.getElementById('actionsDropdown');
    var btn = document.getElementById('actionsButton');
    var list = document.getElementById('actionsList');
    function close(){ if(dd) dd.classList.remove('open'); }
    function open(){ if(dd) dd.classList.add('open'); }
    if(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); if(dd.classList.contains('open')) close(); else open(); }); }
    if(list){ list.addEventListener('click', function(e){
      var item = e.target.closest('.dropdown-item'); if(!item || item.classList.contains('separator')) return;
      var action = item.getAttribute('data-action');
      // Route actions
      try{
        switch(action){
          case 'info': if (typeof showInfo==='function') showInfo(); break;
          case 'share': if (typeof showShare==='function') showShare(); break;
          case 'price': if (typeof showPricing==='function') showPricing(); break;
          case 'visualize':
          case 'visualize-photoreal':
            if (typeof showVisualize === 'function') {
              showVisualize();
            } else if (typeof loadScript === 'function') {
              loadScript('js/ui/visualize-photoreal.js').then(function(){ if (typeof showVisualize === 'function') showVisualize(); });
            }
            break;
          case 'admin': if (typeof showAdmin==='function') showAdmin(); break;
          case 'reset': if (typeof showResetConfirmation==='function') showResetConfirmation(); break;
          case 'obj': exportOBJ && exportOBJ(); break;
          case 'pdf': exportPdfFromCanvas(); break;
          case 'json-download': download('gablok-project.json', serializeProject && serializeProject() || '{}', 'application/json'); try{ updateStatus('Exported JSON'); }catch(_){} break;
          case 'dxf-export': { if (window.FileIO) { FileIO.export('dxf'); } else if (window.DXF) { DXF.exportProject(); } break; }
          case 'dwg-export': { if (window.FileIO) { FileIO.export('dwg'); } else if (window.DWG) { DWG.exportProject(); } break; }
          case 'json-upload': { var f=document.getElementById('upload-file'); if(f) f.click(); } break;
          case 'obj-upload': { var f2=document.getElementById('upload-obj-file'); if(f2) f2.click(); } break;
          case 'pdf-floorplan-upload': { var f3=document.getElementById('upload-pdf-floorplan'); if(f3) f3.click(); } break;
          case 'svg-floorplan-upload': { var f4=document.getElementById('upload-svg-floorplan'); if(f4) f4.click(); } break;
          case 'dxf-floorplan-upload': { var f5=document.getElementById('upload-dxf-floorplan'); if(f5) f5.click(); } break;
          case 'dwg-floorplan-upload': { var f6=document.getElementById('upload-dwg-floorplan'); if(f6) f6.click(); } break;
          default: break;
        }
      }catch(err){ /* ignore */ }
      close();
    }); }
    document.addEventListener('click', close);
    document.addEventListener('keydown', function(ev){ if(ev.key==='Escape') close(); });
  })();

  // Actions: file input handlers (JSON/OBJ/PDF/SVG)
  (function(){
    var jsonIn = document.getElementById('upload-file');
    if(jsonIn){ jsonIn.onchange = async function(e){ try{ var f=e.target.files && e.target.files[0]; if(!f) return; var text = await f.text(); restoreProject && restoreProject(text); renderLoop && renderLoop(); updateStatus && updateStatus('Imported project'); } catch(err){ try{ updateStatus('Import failed'); }catch(_){} } finally { jsonIn.value=''; } }; }
    var objIn = document.getElementById('upload-obj-file');
    if(objIn){ objIn.onchange = async function(e){ try{ var f=e.target.files && e.target.files[0]; if(!f) return; await f.text(); updateStatus && updateStatus('OBJ import not supported yet'); } catch(err){ try{ updateStatus('OBJ import failed'); }catch(_){} } finally { objIn.value=''; } }; }
    var pdfIn = document.getElementById('upload-pdf-floorplan');
    if(pdfIn){ pdfIn.onchange = async function(e){ try{
      var f=e.target.files && e.target.files[0]; if(!f) return;
      var ok = await ensurePdfJsReady(); if(!ok || !window.pdfjsLib){ updateStatus && updateStatus('PDF engine unavailable'); return; }
      var buf = await f.arrayBuffer();
      var loadingTask = window.pdfjsLib.getDocument({ data: buf });
      var pdf = await loadingTask.promise; var page = await pdf.getPage(1);
      openFloorplanModal && openFloorplanModal({ pdf: pdf, page: page });
      updateStatus && updateStatus('PDF loaded');
    } catch(err){ try{ updateStatus('PDF load failed'); }catch(_){} } finally { pdfIn.value=''; } }; }
    // SVG handler already defined above for upload-svg-floorplan
    var dxfIn = document.getElementById('upload-dxf-floorplan');
    if(dxfIn){ dxfIn.onchange = async function(e){ try{ var f=e.target.files && e.target.files[0]; if(!f) return; if (window.DXF && typeof DXF.importFile==='function') { await DXF.importFile(f); } } catch(err){ try{ updateStatus('DXF load failed'); }catch(_){} } finally { dxfIn.value=''; } }; }
    var dwgIn = document.getElementById('upload-dwg-floorplan');
    if(dwgIn){ dwgIn.onchange = async function(e){ try{ var f=e.target.files && e.target.files[0]; if(!f) return; if (window.DWG && typeof DWG.importFile==='function') { await DWG.importFile(f); } } catch(err){ try{ updateStatus('DWG load failed'); }catch(_){} } finally { dwgIn.value=''; } }; }
  })();

  // Floorplan modal: floor toggle wiring
  (function(){
    function setActive(btnGround, btnFirst){
      if(!btnGround || !btnFirst) return;
      try {
        var cur = (typeof currentFloor==='number'? currentFloor : 0);
        if(cur===0){ btnGround.classList.add('active'); btnFirst.classList.remove('active'); }
        else { btnFirst.classList.add('active'); btnGround.classList.remove('active'); }
      } catch(e) {}
    }
    function doSwitch(toFloor){
      try {
        // If 2D editor is active and enhanced switch is available, use it to apply+switch atomically
        if (window.__plan2d && __plan2d.active && typeof plan2dSwitchFloorInEditor==='function') {
          plan2dSwitchFloorInEditor(toFloor);
          return;
        }
        var nativeSel = document.getElementById('levelSelect');
        if(nativeSel){ nativeSel.value = String(toFloor); }
        if(typeof switchLevel==='function') switchLevel();
      } catch(e){}
    }
    var bG = document.getElementById('plan2d-floor-ground');
    var bF = document.getElementById('plan2d-floor-first');
    if(bG){ bG.addEventListener('click', function(){ doSwitch(0); setActive(bG,bF); }); }
    if(bF){ bF.addEventListener('click', function(){ doSwitch(1); setActive(bG,bF); }); }
    // Initialize state when DOM ready
    setActive(bG,bF);
  })();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', __wireAppUi);
  } else {
    setTimeout(__wireAppUi, 0);
  }
}

var __fp = {
  active: false,
  pdf: null,
  page: null,
  pageNum: 1,
  pageCount: 1,
  pageBitmap: null,
  viewport: null,
  pxPerMeter: null,
  mode: 'calibrate', // 'calibrate' | 'place'
  clicks: [], // last clicks for calibration: [{x,y}, {x,y}]
  rooms: [], // {x0,y0,x1,y1} in overlay canvas pixels
  dragging: false,
  dragStart: null,
  anchorWorld: null, // {x,z} world anchor
  hintText: '',
  hintUntil: 0,
  autoDetected: false
};

function openFloorplanModal(opts){
  var m = document.getElementById('floorplan-modal'); if (!m) return;
  m.classList.add('visible');
  __fp.active = true;
  __fp.pdf = opts.pdf || null;
  __fp.page = opts.page || null;
  // Allow direct image/canvas background (e.g., from DXF rasterization)
  if (opts.image) {
    __fp.page = null; __fp.pdf = null;
    __fp.pageBitmap = { img: opts.image, dx: 0, dy: 0, dw: 0, dh: 0, external: true };
  } else {
    __fp.pageBitmap = null;
  }
  __fp.pageNum = 1;
  __fp.pageCount = (__fp.pdf && __fp.pdf.numPages) ? __fp.pdf.numPages : 1;
  __fp.viewport = null;
  __fp.pxPerMeter = null;
  __fp.mode = 'calibrate';
  __fp.clicks = [];
  __fp.rooms = [];
  __fp.dragging = false;
  __fp.dragStart = null;
  __fp.anchorWorld = { x: camera.targetX, z: camera.targetZ };
  // Enable pointer events on overlay for interaction
  var ov = document.getElementById('floorplan-overlay'); if (ov) ov.style.pointerEvents = 'auto';
  // Wire buttons
  wireFloorplanUI();
  // Render first page
  renderFloorplanPage();
  updateFpInfo();
}

function closeFloorplanModal(){
  var m = document.getElementById('floorplan-modal'); if (m) m.classList.remove('visible');
  __fp.active = false;
  // remove listeners if any
  unbindFloorplanUI();
}

async function renderFloorplanPage(){
  try {
    var c = document.getElementById('floorplan-canvas'); if (!c) return;
    var ov = document.getElementById('floorplan-overlay'); if (!ov) return;
    // Match canvas size to container css pixels with DPR for quality
    var container = c.parentElement;
    var rect = container.getBoundingClientRect();
    var ratio = Math.min(2, window.devicePixelRatio || 1);
    var cssW = Math.max(400, Math.floor(rect.width));
    var cssH = Math.max(300, Math.floor(rect.height));
    function sizeCanvas(cv){
      var targetW = Math.floor(cssW * ratio), targetH = Math.floor(cssH * ratio);
      if (cv.width !== targetW || cv.height !== targetH) { cv.width = targetW; cv.height = targetH; cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; }
    }
    sizeCanvas(c); sizeCanvas(ov);
    var ctx2d = c.getContext('2d');
    ctx2d.setTransform(1,0,0,1,0,0);
    ctx2d.clearRect(0,0,c.width,c.height);
    // If we have a PDF page, render it to an offscreen then fit into c
    if (__fp.page) {
      // Render at a scale that keeps memory modest
      var vp = __fp.page.getViewport({ scale: 1.5 });
      __fp.viewport = vp;
      var off = document.createElement('canvas'); off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
      var octx = off.getContext('2d');
      await __fp.page.render({ canvasContext: octx, viewport: vp }).promise;
      // draw fitted into visible canvas (account for DPR by drawing at device pixels)
      var scaleFit = Math.min(c.width / off.width, c.height / off.height);
      var drawW = Math.floor(off.width * scaleFit), drawH = Math.floor(off.height * scaleFit);
      var dx = Math.floor((c.width - drawW) / 2), dy = Math.floor((c.height - drawH) / 2);
      ctx2d.drawImage(off, 0, 0, off.width, off.height, dx, dy, drawW, drawH);
      // Save fitted transform metadata
      __fp.pageBitmap = { img: off, dx: dx, dy: dy, dw: drawW, dh: drawH };
    } else if (__fp.pageBitmap && __fp.pageBitmap.img) {
      // Draw provided image/canvas into visible canvas
      var img = __fp.pageBitmap.img;
      var scaleFit2 = Math.min(c.width / img.width, c.height / img.height);
      var drawW2 = Math.floor(img.width * scaleFit2), drawH2 = Math.floor(img.height * scaleFit2);
      var dx2 = Math.floor((c.width - drawW2) / 2), dy2 = Math.floor((c.height - drawH2) / 2);
      ctx2d.drawImage(img, 0, 0, img.width, img.height, dx2, dy2, drawW2, drawH2);
      __fp.pageBitmap.dx = dx2; __fp.pageBitmap.dy = dy2; __fp.pageBitmap.dw = drawW2; __fp.pageBitmap.dh = drawH2;
    } else {
      // No page/image, fill bg
      ctx2d.fillStyle = '#0b1020'; ctx2d.fillRect(0,0,c.width,c.height);
    }
    drawFloorplanOverlay();
    // Update page UI
    var totalSpan = document.getElementById('fp-page-total'); if (totalSpan) totalSpan.textContent = String(__fp.pageCount || 1);
    var input = document.getElementById('fp-page-input'); if (input) input.value = String(__fp.pageNum || 1);
  } catch (e) {
    console.error('renderFloorplanPage error', e);
  }
}

function canvasToImageCoords(px, py){
  // Map overlay canvas pixel to PDF image pixel coordinates (in the offscreen image space)
  var c = document.getElementById('floorplan-canvas'); if (!c || !__fp.pageBitmap) return { ix: px, iy: py };
  var bm = __fp.pageBitmap;
  // The visible canvas draws the offscreen image inside rect [dx,dy, dw,dh] within [0, c.width/c.height] (device pixels)
  var x = (px - bm.dx) * (bm.img.width / Math.max(1, bm.dw));
  var y = (py - bm.dy) * (bm.img.height / Math.max(1, bm.dh));
  return { ix: x, iy: y };
}

function imageToCanvasCoords(ix, iy){
  var c = document.getElementById('floorplan-canvas'); if (!c || !__fp.pageBitmap) return { x: ix, y: iy };
  var bm = __fp.pageBitmap;
  var x = bm.dx + (ix * (bm.dw / Math.max(1, bm.img.width)));
  var y = bm.dy + (iy * (bm.dh / Math.max(1, bm.img.height)));
  return { x: x, y: y };
}

function drawFloorplanOverlay(){
  var ov = document.getElementById('floorplan-overlay'); if (!ov) return; var cx = ov.getContext('2d');
  // Clear and scale to device pixels
  cx.setTransform(1,0,0,1,0,0);
  cx.clearRect(0,0,ov.width, ov.height);
  // Draw calibration clicks
  if (__fp.clicks.length > 0) {
    cx.strokeStyle = '#16a34a'; cx.fillStyle = '#16a34a'; cx.lineWidth = 2;
    for (var i=0;i<__fp.clicks.length;i++) {
      var p = __fp.clicks[i];
      cx.beginPath(); cx.arc(p.x, p.y, 6, 0, Math.PI*2); cx.fill();
    }
    if (__fp.clicks.length >= 2) {
      cx.beginPath(); cx.moveTo(__fp.clicks[0].x, __fp.clicks[0].y); cx.lineTo(__fp.clicks[1].x, __fp.clicks[1].y); cx.stroke();
    }
  }
  // Draw placed rooms
  cx.strokeStyle = '#3b82f6'; cx.lineWidth = 2; cx.fillStyle = 'rgba(59,130,246,0.12)';
  for (var r=0;r<__fp.rooms.length;r++){
    var rm = __fp.rooms[r]; var x0 = Math.min(rm.x0, rm.x1), y0 = Math.min(rm.y0, rm.y1), x1 = Math.max(rm.x0, rm.x1), y1 = Math.max(rm.y0, rm.y1);
    if (rm.auto) { cx.save(); cx.setLineDash([5,4]); cx.strokeStyle = '#1d4ed8'; cx.fillStyle = 'rgba(59,130,246,0.07)'; }
    cx.beginPath(); cx.rect(x0, y0, x1-x0, y1-y0); cx.fill(); cx.stroke(); if (rm.auto) cx.restore();
    // Show size if scale known
    if (__fp.pxPerMeter) {
      var w = (x1-x0) / __fp.pxPerMeter; var d = (y1-y0) / __fp.pxPerMeter;
      var label = w.toFixed(2)+'m × '+d.toFixed(2)+'m';
      cx.fillStyle = '#111827'; cx.font = 'bold 14px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(label, (x0+x1)/2, (y0+y1)/2);
      cx.fillStyle = 'rgba(59,130,246,0.12)'; // restore
    }
  }
  // Dragging preview
  if (__fp.dragging && __fp.dragStart) {
    var cur = __fp.__lastMouse;
    if (cur) {
      var x0 = __fp.dragStart.x, y0 = __fp.dragStart.y, x1 = cur.x, y1 = cur.y;
      cx.setLineDash([6,4]); cx.strokeStyle = '#2563eb'; cx.lineWidth = 1.5; cx.beginPath(); cx.rect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(x1-x0), Math.abs(y1-y0)); cx.stroke(); cx.setLineDash([]);
    }
  }
  // Hint overlay
  var now = Date.now();
  if (__fp.hintText && __fp.hintUntil > now) {
    cx.save();
    var pad = 10; cx.font = 'bold 14px system-ui, sans-serif';
    var text = __fp.hintText; var tw = cx.measureText(text).width; var tx = Math.floor((ov.width - tw) / 2) - pad; var ty = 16;
    cx.fillStyle = 'rgba(0,0,0,0.65)'; cx.fillRect(tx, ty, tw + pad*2, 28);
    cx.fillStyle = '#ffffff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(text, tx + tw/2 + pad, ty + 14);
    cx.restore();
  }
}

function wireFloorplanUI(){
  // Buttons
  var bClose = document.getElementById('floorplan-close'); if (bClose) bClose.onclick = closeFloorplanModal;
  var bCancel = document.getElementById('fp-cancel'); if (bCancel) bCancel.onclick = closeFloorplanModal;
  var back = document.getElementById('floorplan-backdrop'); if (back) back.onclick = closeFloorplanModal;
  var bCal = document.getElementById('fp-mode-calibrate'); if (bCal) bCal.onclick = function(){ __fp.mode = 'calibrate'; updateFloorplanCursor(); showFpHint('Click two points a known distance apart, enter it, then Apply.', 2800); drawFloorplanOverlay(); };
  var bPlace = document.getElementById('fp-mode-place'); if (bPlace) bPlace.onclick = function(){ __fp.mode = 'place'; updateFloorplanCursor(); showFpHint('Drag on the plan to draw room rectangles', 2200); drawFloorplanOverlay(); };
  var bUndo = document.getElementById('fp-undo'); if (bUndo) bUndo.onclick = function(){ if (__fp.rooms.length>0) { __fp.rooms.pop(); drawFloorplanOverlay(); updateFpInfo(); } };
  var bApply = document.getElementById('fp-apply-scale'); if (bApply) bApply.onclick = function(){ applyCalibration(); };
  var bCommit = document.getElementById('fp-commit'); if (bCommit) bCommit.onclick = function(){ commitFloorplanRooms(); };
  var bRefine = document.getElementById('fp-refine-detect'); if (bRefine) bRefine.onclick = function(){ if (!__fp.pxPerMeter) { updateStatus('Calibrate first'); return; } __fp.rooms = __fp.rooms.filter(function(r){ return !r.auto; }); __fp.autoDetected = false; autoDetectGroundFloor(true); };
  // Page controls
  var inPage = document.getElementById('fp-page-input'); if (inPage) inPage.onchange = function(){ var n = Math.max(1, Math.min(__fp.pageCount||1, parseInt(this.value||'1',10)||1)); goToFloorplanPage(n); };
  var bPrev = document.getElementById('fp-page-prev'); if (bPrev) bPrev.onclick = function(){ if (__fp.pageNum>1) goToFloorplanPage(__fp.pageNum-1); };
  var bNext = document.getElementById('fp-page-next'); if (bNext) bNext.onclick = function(){ if (__fp.pageNum<(__fp.pageCount||1)) goToFloorplanPage(__fp.pageNum+1); };
  // Canvas interactions
  var ov = document.getElementById('floorplan-overlay');
  var base = document.getElementById('floorplan-canvas');
  function attachCanvasHandlers(cv){
    if (!cv) return;
    function getPos(e){ var rect = cv.getBoundingClientRect(); var ratio = cv.width / Math.max(1, rect.width); return { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio }; }
    var onDown = function(e){
      if (!__fp.active) return; var p = getPos(e); __fp.__lastMouse = p;
      if (__fp.mode === 'calibrate') {
        __fp.clicks.push({ x:p.x, y:p.y }); if (__fp.clicks.length > 2) __fp.clicks.shift();
        drawFloorplanOverlay();
      } else if (__fp.mode === 'place') {
        __fp.dragging = true; __fp.dragStart = p; drawFloorplanOverlay();
      }
      updateFloorplanCursor();
    };
    cv.addEventListener('mousedown', onDown);
    // Store refs for potential cleanup
    cv.__fpOnDown = onDown;
  }
  attachCanvasHandlers(ov);
  attachCanvasHandlers(base);
  // Shared move/up on window to track outside canvas
  window.__fpMouseMove = function(e){
    if (!__fp.active) return;
    // Prefer overlay for coordinate mapping if present, else base
    var cv = ov || base; if (!cv) return;
    var rect = cv.getBoundingClientRect(); var ratio = cv.width / Math.max(1, rect.width);
    var p = { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio };
    __fp.__lastMouse = p;
    if (__fp.dragging) drawFloorplanOverlay();
  };
  window.__fpMouseUp = function(){
    if (!__fp.active) return;
    if (__fp.dragging && __fp.dragStart && __fp.__lastMouse) {
      var s = __fp.dragStart, c = __fp.__lastMouse;
      __fp.rooms.push({ x0:s.x, y0:s.y, x1:c.x, y1:c.y });
      updateFpInfo();
    }
    __fp.dragging = false; __fp.dragStart = null; drawFloorplanOverlay(); updateFloorplanCursor();
  };
  window.addEventListener('mousemove', window.__fpMouseMove);
  window.addEventListener('mouseup', window.__fpMouseUp);
  // Resize handler
  window.__fpResize = function(){ if (!__fp.active) return; renderFloorplanPage(); };
  window.addEventListener('resize', window.__fpResize);
  updateFloorplanCursor();
}

function unbindFloorplanUI(){
  try { if (window.__fpMouseMove) window.removeEventListener('mousemove', window.__fpMouseMove); } catch(e){}
  try { if (window.__fpMouseUp) window.removeEventListener('mouseup', window.__fpMouseUp); } catch(e){}
  try { if (window.__fpResize) window.removeEventListener('resize', window.__fpResize); } catch(e){}
  try {
    var ov = document.getElementById('floorplan-overlay');
    var base = document.getElementById('floorplan-canvas');
    if (ov && ov.__fpOnDown) { ov.removeEventListener('mousedown', ov.__fpOnDown); ov.__fpOnDown = null; }
    if (base && base.__fpOnDown) { base.removeEventListener('mousedown', base.__fpOnDown); base.__fpOnDown = null; }
  } catch(e){}
}

function applyCalibration(){
  if (__fp.clicks.length < 2) { updateStatus('Pick two points for calibration'); return; }
  var a = __fp.clicks[0], b = __fp.clicks[1];
  var dx = b.x - a.x, dy = b.y - a.y; var distPx = Math.sqrt(dx*dx + dy*dy);
  var input = document.getElementById('fp-real-distance'); var real = parseFloat(input && input.value ? input.value : '');
  if (!(real > 0)) { updateStatus('Enter a valid real distance'); return; }
  __fp.pxPerMeter = distPx / real;
  updateFpInfo();
  // Switch to place mode and guide the user
  __fp.mode = 'place';
  showFpHint('Scale set. Drag on the plan to draw room rectangles, then click Commit.', 3500);
  drawFloorplanOverlay();
  updateFloorplanCursor();
  // Attempt automatic ground floor detection (one-time) so the user can commit immediately
  setTimeout(function(){
    try { if (__fp.active && !__fp.autoDetected) { autoDetectGroundFloor(); } } catch(e) { console.warn('Auto floor detect failed', e); }
  }, 30);
}

function updateFpInfo(){
  var scaleSpan = document.getElementById('fp-scale-display'); if (scaleSpan) scaleSpan.textContent = __fp.pxPerMeter ? __fp.pxPerMeter.toFixed(2) : '—';
  var cnt = document.getElementById('fp-rooms-count'); if (cnt) cnt.textContent = (__fp.rooms||[]).length;
}

async function goToFloorplanPage(n){
  if (!__fp.pdf) return;
  try {
    __fp.pageNum = n;
    __fp.page = await __fp.pdf.getPage(n);
    renderFloorplanPage();
    // reset calibration clicks when switching pages (keeps scale value, as it may be a multi-page plan)
    __fp.clicks = [];
    __fp.autoDetected = false;
    drawFloorplanOverlay();
  } catch(e) {
    console.error('Failed to switch PDF page', e);
  }
}

function commitFloorplanRooms(){
  if (!__fp.pxPerMeter) { updateStatus('Calibrate scale first'); return; }
  if (!__fp.rooms || __fp.rooms.length === 0) {
    updateStatus('No rooms to import. Use "Place Room" and drag to draw rectangles over rooms, then Commit.');
    __fp.mode = 'place';
    showFpHint('Drag to draw room rectangles on the plan', 3000);
    drawFloorplanOverlay();
    return;
  }
  var created = 0;
  // Use the first room center as origin for relative placement
  var first = __fp.rooms[0]; var fx = (Math.min(first.x0, first.x1) + Math.max(first.x0, first.x1)) / 2; var fz = (Math.min(first.y0, first.y1) + Math.max(first.y0, first.y1)) / 2;
  var worldOrigin = __fp.anchorWorld || { x: 0, z: 0 };
  for (var i=0;i<__fp.rooms.length;i++){
    var r = __fp.rooms[i];
    var x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    var w = Math.max(0.5, (x1 - x0) / __fp.pxPerMeter);
    var d = Math.max(0.5, (y1 - y0) / __fp.pxPerMeter);
    var cx = (x0 + x1)/2, cz = (y0 + y1)/2;
    var rx = worldOrigin.x + (cx - fx) / __fp.pxPerMeter;
    var rz = worldOrigin.z + (cz - fz) / __fp.pxPerMeter;
    var room = createRoom(rx, rz, 0);
    room.width = parseFloat(w.toFixed(2));
    room.depth = parseFloat(d.toFixed(2));
    room.height = 3;
    room.name = 'Imported ' + (i+1);
    allRooms.push(room); created++;
    // Reflect immediately in 2D so added rooms show walls without extra steps
    // Force populate to bypass userEdited/manual-wall guard during import commit
    try { if (typeof populatePlan2DFromDesign==='function') { populatePlan2DFromDesign(true); if (window.__plan2d && __plan2d.active && typeof plan2dDraw==='function') plan2dDraw(); } } catch(_e2d) {}
  }
  saveProjectSilently();
  // Clear selection using unified helper for immediate measurement panel refresh
  if (typeof window.selectObject==='function') { window.selectObject(null, { noRender: true }); }
  else { selectedRoomId = null; try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_eMU) {} }
  renderLoop();
  updateStatus('Added ' + created + ' room(s) from floorplan');
  closeFloorplanModal();
}

// Attempt to automatically detect ground floor rectangular rooms from the PDF page bitmap.
// Heuristic approach: analyze a downscaled grayscale image, threshold walls, find large whitespace rectangles.
function autoDetectGroundFloor(manual){
  if (!__fp.pageBitmap || !__fp.pageBitmap.img || !__fp.pxPerMeter) return;
  if (__fp.rooms.length > 0) return; // don't override user work
  var img = __fp.pageBitmap.img;
  try {
    var minInput = document.getElementById('fp-auto-min');
    var arInput = document.getElementById('fp-auto-ar');
    var borderInput = document.getElementById('fp-auto-border');
    var minMeters = Math.max(1, parseFloat(minInput && minInput.value || '2'));
    var maxAspect = Math.max(2, parseFloat(arInput && arInput.value || '8'));
    var minBorderRatio = Math.min(1, Math.max(0, parseFloat(borderInput && borderInput.value || '0.15')));
    var downScale = 0.25; // process at quarter size for speed
    var w = Math.max(20, Math.floor(img.width * downScale));
    var h = Math.max(20, Math.floor(img.height * downScale));
    var can = document.createElement('canvas'); can.width = w; can.height = h; var ctx = can.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0,0,w,h).data;
    // Build occupancy map: wall/ink pixels vs background (assume darker is wall)
    var occ = new Uint8Array(w*h);
    for (var y=0;y<h;y++){
      for (var x=0;x<w;x++){
        var idx = (y*w + x)*4;
        var r=data[idx], g=data[idx+1], b=data[idx+2];
        var lum = 0.299*r + 0.587*g + 0.114*b; // 0..255
        occ[y*w + x] = lum < 200 ? 1 : 0; // treat darker areas as ink
      }
    }
    // Integral image for fast sum queries of ink density
    var integral = new Uint32Array((w+1)*(h+1));
    for (var y2=1;y2<=h;y2++){
      var rowSum=0;
      for (var x2=1;x2<=w;x2++){
        rowSum += occ[(y2-1)*w + (x2-1)];
        integral[y2*(w+1)+x2] = integral[(y2-1)*(w+1)+x2] + rowSum;
      }
    }
    function rectInk(x0,y0,x1,y1){ // inclusive-exclusive coordinates in downscaled space
      return integral[y1*(w+1)+x1] - integral[y0*(w+1)+x1] - integral[y1*(w+1)+x0] + integral[y0*(w+1)+x0];
    }
    var candidates = [];
    // Scan for rectangles larger than minimal size (in meters) and low ink fill inside (rooms interior) with surrounding ink border.
  var maxMeters = 30.0;
    var minPx = minMeters * __fp.pxPerMeter * downScale; // interior size in downscaled px
    var maxPx = maxMeters * __fp.pxPerMeter * downScale;
    // Limit loops for performance by stepping
    var step = Math.max(4, Math.floor(w/120));
    for (var y0=0;y0<h-10;y0+=step){
      for (var x0=0;x0<w-10;x0+=step){
        for (var y1=y0+Math.floor(minPx); y1<h && y1-y0<=maxPx; y1+=step){
          var height = y1 - y0; if (height < minPx) continue;
          for (var x1=x0+Math.floor(minPx); x1<w && x1-x0<=maxPx; x1+=step){
            var width = x1 - x0; if (width < minPx) continue;
            var area = width*height; if (area <= 0) continue;
            var inkInside = rectInk(x0,y0,x1,y1);
            var fillRatio = inkInside / area;
            if (fillRatio < 0.10) { // mostly empty interior
              // Check a rough border having ink (sample perimeter cells)
              var borderHits=0, borderSamples=0;
              for (var xx=x0; xx<x1; xx+=Math.max(1, Math.floor((x1-x0)/8))){
                var top = occ[y0*w+xx]; var bot = occ[(y1-1)*w+xx];
                borderHits += top + bot; borderSamples += 2;
              }
              for (var yy=y0; yy<y1; yy+=Math.max(1, Math.floor((y1-y0)/8))){
                var left = occ[yy*w + x0]; var right = occ[yy*w + (x1-1)];
                borderHits += left + right; borderSamples += 2;
              }
              var borderRatio = borderHits / Math.max(1, borderSamples);
              if (borderRatio > minBorderRatio) {
                candidates.push({ x0:x0, y0:y0, x1:x1, y1:y1, area: area });
              }
            }
          }
        }
      }
    }
    // Sort by area descending, then perform non-overlap selection
    candidates.sort(function(a,b){ return b.area - a.area; });
    var selected = [];
    function overlap(a,b){ return !(a.x1<=b.x0 || b.x1<=a.x0 || a.y1<=b.y0 || b.y1<=a.y0); }
    for (var c=0;c<candidates.length;c++){
      var cand = candidates[c];
      // Filter extremely elongated shapes (aspect ratio > 8) which are probably corridors or artifacts
      var wCand = cand.x1 - cand.x0, hCand = cand.y1 - cand.y0;
      var ar = wCand > hCand ? wCand / Math.max(1,hCand) : hCand / Math.max(1,wCand);
      if (ar > maxAspect) continue;
      var keep = true;
      for (var k=0;k<selected.length;k++){ if (overlap(cand, selected[k])) { keep=false; break; } }
      if (keep) selected.push(cand);
      if (selected.length >= 20) break; // safety cap
    }
    if (selected.length === 0) { console.log('Auto-detect: no candidates'); return; }
    // Map back to overlay canvas coordinates using imageToCanvasCoords
    for (var s=0;s<selected.length;s++){
      var R = selected[s];
      // Convert downscaled rectangle corners to original image coords
      var ix0 = R.x0 / downScale, iy0 = R.y0 / downScale, ix1 = R.x1 / downScale, iy1 = R.y1 / downScale;
      var c0 = imageToCanvasCoords(ix0, iy0); var c1 = imageToCanvasCoords(ix1, iy1);
      __fp.rooms.push({ x0: c0.x, y0: c0.y, x1: c1.x, y1: c1.y, auto:true });
    }
    __fp.autoDetected = true;
    updateFpInfo();
    drawFloorplanOverlay();
    showFpHint('Auto-detected '+selected.length+' room(s). '+(manual?'(Refined) ':'')+'Review & Commit or adjust.', 4000);
  } catch (e) {
    console.warn('autoDetectGroundFloor error', e);
  }
}

// Small helper to show a transient hint overlay in the floorplan modal
function showFpHint(msg, durationMs){
  __fp.hintText = String(msg || '');
  __fp.hintUntil = Date.now() + Math.max(500, durationMs || 2000);
  drawFloorplanOverlay();
}

// Update cursor style in floorplan canvases based on current mode/drag state
function updateFloorplanCursor(){
  var ov = document.getElementById('floorplan-overlay');
  var base = document.getElementById('floorplan-canvas');
  var cur = 'default';
  if (__fp.active) {
    if (__fp.mode === 'calibrate') cur = 'crosshair';
    else if (__fp.mode === 'place') cur = __fp.dragging ? 'crosshair' : 'crosshair';
  }
  if (ov) ov.style.cursor = cur;
  if (base) base.style.cursor = cur;
}

// ---------- Room Palette ----------
// Catalog with rough real-world dimensions (meters) and a simple type tag for thumbnail rendering
// Width (X), Depth (Z), Height (Y) are approximate; adjust as needed.
// Room palette moved to js/ui/roomPalette.js

// ================= 2D FLOOR PLAN EDITOR (REMOVED) =================
// The authoritative 2D editor implementation lives in js/plan2d/editor.js (loaded by bootstrap).
// The legacy inline ~2,200 line copy was removed in Phase 1 refactoring (Nov 2025).
// All __plan2d state, modal functions, drawing, and interaction logic now come from editor.js.
// 2D/3D plan apply logic moved to js/core/plan-apply.js

// ================= ROOM MANIPULATION =================

