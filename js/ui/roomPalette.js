// ui/roomPalette.js
// Centralized Room Palette UI module.
// Responsibilities:
// - Build and render the furniture catalog list (thumbnails)
// - Open/close the room palette modal for a given room id
// - Manage 3D-ish preview canvas with orbit and drag-to-place items
// - Commit/clear preview items and add to furnitureItems in the scene
// Dependencies (globals expected):
// - findObjectById, furnitureItems, saveProjectSilently, renderLoop, updateStatus
// - DOM elements: #room-palette-modal, #room-preview-canvas, #palette-list, buttons
(function(){
  // Exported palette-open state
  if (typeof window.paletteOpenForId === 'undefined') window.paletteOpenForId = null;

  // Catalog items
  var PALETTE_ITEMS = [
    { name: 'Single Bed',           width: 1.1, depth: 2.2, height: 0.6, kind: 'bed',       desc: 'Standard single bed.' },
    { name: 'Double Bed',           width: 1.6, depth: 2.2, height: 0.6, kind: 'bed',       desc: 'Comfortable double bed.' },
    { name: 'Queen Bed',            width: 1.8, depth: 2.2, height: 0.6, kind: 'bed',       desc: 'Popular queen-size bed.' },
    { name: 'King Bed',             width: 2.0, depth: 2.2, height: 0.6, kind: 'bed',       desc: 'Spacious king-size bed.' },
    { name: 'Bath',                 width: 1.0, depth: 1.8, height: 0.6, kind: 'bath',      desc: 'Freestanding bathtub.' },
    { name: 'Shower',               width: 1.1, depth: 1.1, height: 3.0, kind: 'shower',    desc: 'Single shower enclosure.' },
    { name: 'Double Shower',        width: 1.8, depth: 1.1, height: 3.0, kind: 'shower',    desc: 'Double-width shower.' },
    { name: 'Sink',                 width: 0.6, depth: 0.5, height: 0.9, kind: 'sink',      desc: 'Single vanity sink.' },
    { name: 'Double Sink',          width: 1.6, depth: 0.5, height: 0.9, kind: 'sink',      desc: 'Double vanity sink.' },
    { name: 'Bedside Table',        width: 0.5, depth: 0.4, height: 0.5, kind: 'table',     desc: 'Compact bedside table.' },
    { name: 'Kitchen Design 01',    width: 3.0, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Straight-line kitchen run.' },
    { name: 'Kitchen Design 02',    width: 2.4, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Corner kitchen layout.' },
    { name: 'Kitchen Design 03',    width: 3.6, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Large corner kitchen.' },
    { name: 'Kitchen Design 04',    width: 2.8, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Compact kitchen run.' },
    { name: 'Kitchen Design 05',    width: 3.2, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Extended kitchen run.' },
    { name: 'Single Fridge',        width: 0.7, depth: 0.7, height: 1.8, kind: 'fridge',    desc: 'Single-door fridge.' },
    { name: 'Double Fridge',        width: 1.2, depth: 0.8, height: 1.9, kind: 'fridge',    desc: 'Double-door fridge.' },
    { name: '42" TV',               width: 0.95, depth: 0.1, height: 0.6, kind: 'tv',       desc: 'Compact TV for wall or stand.' },
    { name: '72" TV',               width: 1.6,  depth: 0.1, height: 1.0, kind: 'tv',       desc: 'Large 72-inch television.' },
    { name: '84" TV',               width: 1.9,  depth: 0.1, height: 1.1, kind: 'tv',       desc: 'Extra-large 84-inch TV.' },
    { name: '108" TV',              width: 2.4,  depth: 0.1, height: 1.4, kind: 'tv',       desc: 'Home theater scale screen.' },
    { name: 'Sofa 3 seats',         width: 2.0, depth: 0.9, height: 0.9, kind: 'sofa',      desc: 'Three-seat sofa.' },
    { name: 'Sofa 4 seats',         width: 2.4, depth: 0.9, height: 0.9, kind: 'sofa',      desc: 'Four-seat sofa.' },
    { name: 'Sofa 5 seats',         width: 2.8, depth: 0.9, height: 0.9, kind: 'sofa',      desc: 'Five-seat sofa.' },
    { name: 'Sofa 6 seats L',       width: 2.8, depth: 2.0, height: 0.9, kind: 'sofaL',     desc: 'L-shaped sofa (6 seats).' },
    { name: 'Sofa 7 seats L',       width: 3.2, depth: 2.2, height: 0.9, kind: 'sofaL',     desc: 'L-shaped sofa (7 seats).' },
    { name: 'Armchair',             width: 1.0, depth: 1.0, height: 1.1, kind: 'armchair',  desc: 'Single armchair.' },
    { name: 'Dishwasher',           width: 0.7, depth: 0.7, height: 0.90, kind: 'appliance',desc: 'Standard dishwasher.' },
    { name: '4 Seat kitchen table', width: 1.5, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 4.' },
    { name: '6 Seat kitchen table', width: 1.8, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 6.' },
    { name: '8 seat kitchen table', width: 2.3, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 8.' },
    { name: '10 Seat Kitchen table',width: 2.8, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 10.' },
    { name: '4 Seat Dinning table', width: 1.5, depth: 0.8, height: 0.75, kind: 'table',    desc: 'Dining table for 4.' },
    { name: '6 Seat Dinning table', width: 1.8, depth: 0.9, height: 0.75, kind: 'table',    desc: 'Dining table for 6.' },
    { name: '8 seat Dinning table', width: 2.3, depth: 0.9, height: 0.75, kind: 'table',    desc: 'Dining table for 8.' },
    { name: '10 Seat Dinning table',width: 2.9, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 10.' },
    { name: 'Bar stool 1-8',        width: 0.45, depth: 0.45, height: 0.75, kind: 'stool',  desc: 'Kitchen bar stool.' }
  ];

  // Temporary preview state for the room palette (items are previewed here before committing)
  var __paletteState = {
    yaw: 0.6,         // radians
    pitch: 0.5,       // radians (slightly looking down)
    items: [],        // {width, depth, height, x, z, name, kind}
    draggingIndex: -1,
    lastMouse: null
  };

  function setupPalette() {
    var list = document.getElementById('palette-list');
    if (!list) return;
    list.innerHTML = '';
    for (var i=0;i<PALETTE_ITEMS.length;i++) {
      var it = PALETTE_ITEMS[i];
      var item = document.createElement('div');
      item.className = 'palette-item';
      var thumb = document.createElement('div'); thumb.className = 'palette-thumb';
      var c = document.createElement('canvas'); c.className = 'palette-thumb-canvas'; c.width = 220; c.height = 168; thumb.appendChild(c);
      item.appendChild(thumb);
      var infoDiv = document.createElement('div');
      var nameDiv = document.createElement('div'); nameDiv.className = 'palette-name'; nameDiv.textContent = it.name;
      var dimsDiv = document.createElement('div'); dimsDiv.className = 'palette-dims';
      dimsDiv.textContent = 'Width: ' + it.width.toFixed(2) + 'm · Depth: ' + it.depth.toFixed(2) + 'm · Height: ' + it.height.toFixed(2) + 'm';
      var descDiv = document.createElement('div'); descDiv.className = 'palette-desc'; descDiv.textContent = it.desc || '';
      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(dimsDiv);
      infoDiv.appendChild(descDiv);
      item.appendChild(infoDiv);
      // draw simple 3D-ish wireframe thumbnail to scale
      renderItemThumb(c, it);
      // In preview mode, clicking adds to the palette preview without closing
      (function(def){ item.onclick = function(){ addPalettePreviewItem(def); }; })(it);
      list.appendChild(item);
    }
  }

  function openRoomPalette(roomId) {
    var modal = document.getElementById('room-palette-modal');
    var title = document.getElementById('room-palette-title');
    if (!modal || !title) return;
    var room = findObjectById(roomId);
    if (!room || room.type === 'roof') return;
    paletteOpenForId = roomId;
    window.selectedRoomId = roomId;
    title.textContent = room.name || 'Room';
    // Hide roof dropdown while open
    var dd = document.getElementById('roof-type-dropdown'); if (dd) dd.style.display = 'none';
    modal.style.display = 'flex';
    try { console.log('Room Palette opened for', roomId, '->', title.textContent); } catch(e){}
    // Reset preview state and preload existing furniture for this room
    var preload = loadExistingFurniturePreview(room);
    __paletteState = { yaw: 0.6, pitch: 0.5, items: preload, draggingIndex: -1, lastMouse: null };
    renderRoomPreview(room);
    // Keep preview responsive while open
    try {
      if (window.__paletteResizeHandler) window.removeEventListener('resize', window.__paletteResizeHandler);
      window.__paletteResizeHandler = function(){ var r = findObjectById(paletteOpenForId); if (r) renderRoomPreview(r); };
      window.addEventListener('resize', window.__paletteResizeHandler);
    } catch(e){}

    // Wire preview canvas interactions (orbit + drag, no zoom)
    try {
      var cv = document.getElementById('room-preview-canvas');
      if (cv) {
        if (window.__paletteMouseDown) cv.removeEventListener('mousedown', window.__paletteMouseDown);
        if (window.__paletteMouseMove) window.removeEventListener('mousemove', window.__paletteMouseMove);
        if (window.__paletteMouseUp) window.removeEventListener('mouseup', window.__paletteMouseUp);
        if (window.__paletteWheel) cv.removeEventListener('wheel', window.__paletteWheel, { passive: false });

        window.__paletteMouseDown = function(e){
          var rect = cv.getBoundingClientRect();
          var mx = e.clientX - rect.left; var my = e.clientY - rect.top;
          __paletteState.lastMouse = { x: mx, y: my };
          // Hit-test items (prefer top-most)
          var idx = hitTestPaletteItem(mx, my, findObjectById(paletteOpenForId));
          if (idx >= 0) {
            __paletteState.draggingIndex = idx;
            e.preventDefault();
          } else {
            __paletteState.draggingIndex = -1;
            __paletteState.isOrbiting = true;
          }
        };
        cv.addEventListener('mousedown', window.__paletteMouseDown);

        window.__paletteMouseMove = function(e){
          if (!paletteOpenForId) return;
          var room = findObjectById(paletteOpenForId); if (!room) return;
          var rect = cv.getBoundingClientRect();
          var mx = e.clientX - rect.left; var my = e.clientY - rect.top;
          var lm = __paletteState.lastMouse; if (!lm) { __paletteState.lastMouse = {x:mx,y:my}; return; }
          var du = mx - lm.x; var dv = my - lm.y; __paletteState.lastMouse = {x:mx,y:my};
          if (__paletteState.draggingIndex >= 0) {
            // Move item on ground using inverse mapping
            var k = Math.sin(__paletteState.pitch) * 0.5; var yaw = __paletteState.yaw;
            var scaleInfo = getPaletteScaleInfo(room, cv);
            var s = scaleInfo.scale;
            var inv = 1 / Math.max(1e-4, s * Math.max(1e-4, k));
            var cos = Math.cos(yaw), sin = Math.sin(yaw);
            var dxw = inv * (cos * k * du - sin * dv); // simplified from derived inverse
            var dzw = inv * (sin * k * du + cos * dv);
            var it = __paletteState.items[__paletteState.draggingIndex];
            it.x += dxw; it.z += dzw;
            // Clamp inside room footprint
            var maxX = room.width/2 - it.width/2; var maxZ = room.depth/2 - it.depth/2;
            it.x = Math.max(-maxX, Math.min(maxX, it.x));
            it.z = Math.max(-maxZ, Math.min(maxZ, it.z));
            renderRoomPreview(room);
          } else if (__paletteState.isOrbiting) {
            __paletteState.yaw += du * 0.01;
            __paletteState.pitch = Math.max(-1.0, Math.min(1.0, __paletteState.pitch + dv * 0.01));
            renderRoomPreview(room);
          }
        };
        window.addEventListener('mousemove', window.__paletteMouseMove);

        window.__paletteMouseUp = function(){ __paletteState.draggingIndex = -1; __paletteState.isOrbiting = false; };
        window.addEventListener('mouseup', window.__paletteMouseUp);

        window.__paletteWheel = function(e){ e.preventDefault(); };
        cv.addEventListener('wheel', window.__paletteWheel, { passive: false });
      }
    } catch(e){}

    // Wire actions (commit / clear)
    try {
      var commitBtn = document.getElementById('palette-commit');
      if (commitBtn) commitBtn.onclick = function(){ commitPaletteItems(); };
      var clearBtn = document.getElementById('palette-clear');
      if (clearBtn) clearBtn.onclick = function(){ clearPalettePreview(); var r = findObjectById(paletteOpenForId); if (r) renderRoomPreview(r); };
    } catch(e){}
  }

  function hideRoomPalette() {
    var modal = document.getElementById('room-palette-modal');
    if (modal) modal.style.display = 'none';
    paletteOpenForId = null;
    var dd = document.getElementById('roof-type-dropdown'); if (dd) dd.style.display = 'block';
    try { if (window.__paletteResizeHandler) { window.removeEventListener('resize', window.__paletteResizeHandler); window.__paletteResizeHandler = null; } } catch(e){}
    try {
      var cv = document.getElementById('room-preview-canvas');
      if (cv) {
        if (window.__paletteMouseDown) cv.removeEventListener('mousedown', window.__paletteMouseDown);
        if (window.__paletteWheel) cv.removeEventListener('wheel', window.__paletteWheel);
      }
      if (window.__paletteMouseMove) window.removeEventListener('mousemove', window.__paletteMouseMove);
      if (window.__paletteMouseUp) window.removeEventListener('mouseup', window.__paletteMouseUp);
    } catch(e){}
  }

  function renderRoomPreview(room) {
    var cv = document.getElementById('room-preview-canvas');
    if (!cv) return; var cx = cv.getContext('2d');
    // Match the canvas buffer to its displayed size with devicePixelRatio for crisp lines
    var rect = cv.getBoundingClientRect();
    var ratio = Math.min(2, window.devicePixelRatio || 1);
    var targetW = Math.max(320, Math.floor(rect.width * ratio));
    var targetH = Math.max(320, Math.floor(rect.height * ratio));
    if (cv.width !== targetW || cv.height !== targetH) {
      cv.width = targetW;
      cv.height = targetH;
    }
    // Draw in CSS pixel coordinates
    cx.setTransform(1,0,0,1,0,0);
    cx.scale(ratio, ratio);
    cx.clearRect(0,0,rect.width,rect.height);
    // Subtle grid (very light)
    var padG = 20; var step = 30; cx.save(); cx.globalAlpha = 0.45; cx.strokeStyle = '#f5f7fa'; cx.lineWidth = 1;
    for (var gx = padG; gx <= rect.width - padG; gx += step) { cx.beginPath(); cx.moveTo(gx, padG); cx.lineTo(gx, rect.height - padG); cx.stroke(); }
    for (var gy = padG; gy <= rect.height - padG; gy += step) { cx.beginPath(); cx.moveTo(padG, gy); cx.lineTo(rect.width - padG, gy); cx.stroke(); }
    cx.restore();

    // 3D-ish room wireframe box that fits the available space and draws a grey floor
    var padX = 48, padY = 48; // padding
    var availW = rect.width - padX*2; var availH = rect.height - padY*2;
    var rw = room.width, rd = room.depth, ry = room.height;
    var yaw = __paletteState.yaw || 0.6; var pitch = __paletteState.pitch || 0.5;
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    function projUV(x,y,z){ var rx = cy * x + sy * z; var rz = -sy * x + cy * z; var u = rx; var v = -y * cp + rz * sp * 0.5; return { u: u, v: v }; }
    var hw = rw/2, hd = rd/2, ht = ry;
    var ptsUnit = [
      projUV(-hw, 0, -hd), projUV(hw, 0, -hd), projUV(hw, 0, hd), projUV(-hw, 0, hd),
      projUV(-hw, ht, -hd), projUV(hw, ht, -hd), projUV(hw, ht, hd), projUV(-hw, ht, hd)
    ];
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (var i=0;i<ptsUnit.length;i++){ var p=ptsUnit[i]; if (p.u<minU)minU=p.u; if(p.u>maxU)maxU=p.u; if(p.v<minV)minV=p.v; if(p.v>maxV)maxV=p.v; }
    var bboxW = (maxU - minU); var bboxH = (maxV - minV);
    var centerU = (minU + maxU) * 0.5; var centerV = (minV + maxV) * 0.5;
    var fixed = __paletteState.__fixedScale;
    var widthFitFraction = 0.8;
    if (!fixed || fixed.availW !== availW || fixed.roomWidth !== rw) {
      var baseDenom = Math.max(0.1, rw);
      var fixedValue = (availW * widthFitFraction) / baseDenom;
      __paletteState.__fixedScale = { value: fixedValue, availW: availW, roomWidth: rw };
      fixed = __paletteState.__fixedScale;
    }
    var scale = fixed.value;
    function toScreen(p){ return { x: rect.width/2 + (p.u - centerU)*scale, y: rect.height/2 + (p.v - centerV)*scale }; }
    __paletteState.__scaleInfo = { centerU: centerU, centerV: centerV, scale: scale, yaw: yaw, pitch: pitch, cy: cy, sy: sy, cp: cp, sp: sp, rect: rect };
    var pts = ptsUnit.map(toScreen);

    // Floor fill
    cx.fillStyle = '#e5e7eb';
    cx.beginPath(); cx.moveTo(pts[0].x, pts[0].y); cx.lineTo(pts[1].x, pts[1].y); cx.lineTo(pts[2].x, pts[2].y); cx.lineTo(pts[3].x, pts[3].y); cx.closePath(); cx.fill();
    // Edges
    var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    cx.strokeStyle = '#2d6cdf'; cx.lineWidth = 1.0;
    cx.beginPath(); for (var ei=0;ei<edges.length;ei++){ var e=edges[ei]; cx.moveTo(pts[e[0]].x, pts[e[0]].y); cx.lineTo(pts[e[1]].x, pts[e[1]].y);} cx.stroke();
    // Dimensions label
    cx.fillStyle = '#2d6cdf'; cx.font = '12px system-ui'; cx.textAlign = 'left'; cx.textBaseline = 'top';
    cx.fillText(room.width.toFixed(2)+' x '+room.depth.toFixed(2)+' x '+room.height.toFixed(2)+' m', 10, 10);

    // Draw preview items
    for (var ii=0; ii<__paletteState.items.length; ii++) {
      var it = __paletteState.items[ii];
      var ihw = it.width/2, ihd = it.depth/2, iht = Math.max(0.3, it.height);
      var elev = Math.max(0, it.elevation || 0);
      var ipts = [
        projUV(it.x - ihw, elev,            it.z - ihd),
        projUV(it.x + ihw, elev,            it.z - ihd),
        projUV(it.x + ihw, elev,            it.z + ihd),
        projUV(it.x - ihw, elev,            it.z + ihd),
        projUV(it.x - ihw, elev + iht,      it.z - ihd),
        projUV(it.x + ihw, elev + iht,      it.z - ihd),
        projUV(it.x + ihw, elev + iht,      it.z + ihd),
        projUV(it.x - ihw, elev + iht,      it.z + ihd)
      ].map(toScreen);
      // Base fill
      cx.fillStyle = 'rgba(0,0,0,0.05)';
      cx.beginPath(); cx.moveTo(ipts[0].x,ipts[0].y); cx.lineTo(ipts[1].x,ipts[1].y); cx.lineTo(ipts[2].x,ipts[2].y); cx.lineTo(ipts[3].x,ipts[3].y); cx.closePath(); cx.fill();
      // Edges
      cx.strokeStyle = '#7a8aa0'; cx.lineWidth = 1.0;
      cx.beginPath(); for (var j=0;j<edges.length;j++){ var eg=edges[j]; cx.moveTo(ipts[eg[0]].x,ipts[eg[0]].y); cx.lineTo(ipts[eg[1]].x,ipts[eg[1]].y);} cx.stroke();

      // Kitchen details in preview
      if (it.kind === 'kitchen') {
        var topY = elev + iht;
        var isLargeKitchP = (it.name && (/large|03/i).test(it.name)) || (it.depth >= 1.6 || it.width >= 3.4);
        var sinkW = isLargeKitchP ? 0.9 : 0.55;
        var sinkD = 0.45;
        var sinkH = 0.12; // tap stem height
        var sinkDepthDown = 0.18; // recess depth below top
        var sinkGap = isLargeKitchP ? 0.04 : 0.0;
        var plateR = 0.12;
        var plateGap = 0.28;
        function toScreen2(p){ return toScreen(p); }
        function projTop(x,z){ return toScreen(projUV(x, topY, z)); }
        function drawRectTop(x0,z0,x1,z1){ var p0=projTop(x0,z0), p1=projTop(x1,z0), p2=projTop(x1,z1), p3=projTop(x0,z1); cx.fillStyle='rgba(200,210,220,0.55)'; cx.strokeStyle='#5b6773'; cx.lineWidth=1; cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); cx.fill(); cx.stroke(); }
        function drawCircleTopP(cxw,czw,rw,col){ var steps=18; cx.strokeStyle = col || '#333'; cx.lineWidth = 1.2; cx.beginPath(); for (var k=0;k<=steps;k++){ var a=(k/steps)*Math.PI*2; var p=projTop(cxw+Math.cos(a)*rw, czw+Math.sin(a)*rw); if(k===0) cx.moveTo(p.x,p.y); else cx.lineTo(p.x,p.y);} cx.stroke(); }
        var sinkCx = it.x - ihw * 0.35;
        var sinkCz = it.z + 0;
        function drawRecessTopAndWalls(x0,x1,zc){
          drawRectTop(x0, zc - sinkD/2, x1, zc + sinkD/2);
          var pTop0 = projTop(x0, zc - sinkD/2), pTop1 = projTop(x1, zc + sinkD/2);
          var pBot = [ toScreen(projUV(x0, topY - sinkDepthDown, zc - sinkD/2)), toScreen(projUV(x1, topY - sinkDepthDown, zc - sinkD/2)), toScreen(projUV(x1, topY - sinkDepthDown, zc + sinkD/2)), toScreen(projUV(x0, topY - sinkDepthDown, zc + sinkD/2)) ];
          cx.fillStyle = 'rgba(200,210,220,0.45)'; cx.strokeStyle = '#5b6773'; cx.lineWidth = 1;
          var idx=[[0,1],[1,2],[2,3],[3,0]]; var pTop=[projTop(x0, zc - sinkD/2), projTop(x1, zc - sinkD/2), projTop(x1, zc + sinkD/2), projTop(x0, zc + sinkD/2)];
          for (var i=0;i<4;i++){ var a=idx[i][0], b=idx[i][1]; cx.beginPath(); cx.moveTo(pTop[a].x,pTop[a].y); cx.lineTo(pTop[b].x,pTop[b].y); cx.lineTo(pBot[b].x,pBot[b].y); cx.lineTo(pBot[a].x,pBot[a].y); cx.closePath(); cx.fill(); cx.stroke(); }
          cx.fillStyle = 'rgba(35,40,48,0.55)'; cx.strokeStyle='#4b5563'; cx.beginPath(); cx.moveTo(pBot[0].x,pBot[0].y); cx.lineTo(pBot[1].x,pBot[1].y); cx.lineTo(pBot[2].x,pBot[2].y); cx.lineTo(pBot[3].x,pBot[3].y); cx.closePath(); cx.fill(); cx.stroke();
          var drainR = Math.min(sinkW, sinkD) * 0.07; var dcx=(x0+x1)/2; var dcz=zc; drawCircleTopP(dcx, dcz, drainR, '#9aa3ad');
        }
        if (isLargeKitchP) {
          var w2 = (sinkW - sinkGap)/2; var a0x0 = sinkCx - (w2+sinkGap/2) - w2/2, a0x1 = sinkCx - (w2+sinkGap/2) + w2/2; var a1x0 = sinkCx + (w2+sinkGap/2) - w2/2, a1x1 = sinkCx + (w2+sinkGap/2) + w2/2; drawRecessTopAndWalls(a0x0,a0x1,sinkCz); drawRecessTopAndWalls(a1x0,a1x1,sinkCz);
        } else {
          var sx0 = sinkCx - sinkW/2, sx1 = sinkCx + sinkW/2; drawRecessTopAndWalls(sx0,sx1,sinkCz);
        }
        function drawTapP(tx, tz) {
          var stemH = 0.10, spoutL = 0.07;
          var base = toScreen(projUV(tx, topY, tz - sinkD/2 - 0.03));
          var topP = toScreen(projUV(tx, topY + stemH, tz - sinkD/2 - 0.03));
          cx.strokeStyle = '#6b7280'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(base.x, base.y); cx.lineTo(topP.x, topP.y); cx.stroke();
          var sp = toScreen(projUV(tx, topY + stemH, tz - sinkD/2 - 0.03 + spoutL));
          cx.beginPath(); cx.moveTo(topP.x, topP.y); cx.lineTo(sp.x, sp.y); cx.stroke();
        }
        if (isLargeKitchP) {
          var w2t = (sinkW - sinkGap)/2;
          drawTapP(sinkCx - (w2t+sinkGap/2) - w2t*0.2, sinkCz);
          drawTapP(sinkCx + (w2t+sinkGap/2) + w2t*0.2, sinkCz);
        } else {
          drawTapP(sinkCx - sinkW*0.15, sinkCz);
          drawTapP(sinkCx + sinkW*0.15, sinkCz);
        }
        var platesOnRight = sinkCx <= it.x;
        var plateBaseX = it.x + (platesOnRight ? ihw * 0.30 : -ihw * 0.30);
        var plateBaseZ = it.z - plateGap/2;
        var sinkMinX = sinkCx - (isLargeKitchP ? (sinkW/2) : (sinkW/2));
        var sinkMaxX = sinkCx + (isLargeKitchP ? (sinkW/2) : (sinkW/2));
        var plateMinX = plateBaseX - plateR;
        var plateMaxX = plateBaseX + plateGap + plateR;
        if (!(plateMaxX < sinkMinX - 0.05 || plateMinX > sinkMaxX + 0.05)) {
          plateBaseX = it.x + (platesOnRight ? ihw * 0.40 : -ihw * 0.40);
        }
        drawCircleTopP(plateBaseX, plateBaseZ, plateR, '#111');
        drawCircleTopP(plateBaseX + plateGap, plateBaseZ, plateR, '#111');
        drawCircleTopP(plateBaseX, plateBaseZ + plateGap, plateR, '#111');
        drawCircleTopP(plateBaseX + plateGap, plateBaseZ + plateGap, plateR, '#111');
        var ovenW = Math.min(0.7, it.width*0.5), ovenH = 0.45;
        var hobCenterX = plateBaseX + plateGap/2;
        var ox0 = hobCenterX - ovenW/2, ox1 = hobCenterX + ovenW/2, oz = it.z + ihd;
        var oy0 = elev + 0.15, oy1 = Math.min(elev + iht - 0.1, oy0 + ovenH);
        var p0 = toScreen(projUV(ox0, oy0, oz)), p1 = toScreen(projUV(ox1, oy0, oz)), p2 = toScreen(projUV(ox1, oy1, oz)), p3 = toScreen(projUV(ox0, oy1, oz));
        cx.fillStyle = 'rgba(20,20,25,0.35)'; cx.strokeStyle='#444';
        cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); cx.fill(); cx.stroke();
        var hy = (p2.y + p3.y)*0.5 - 3; cx.strokeStyle = '#c0c0c0'; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(p0.x+5, hy); cx.lineTo(p1.x-5, hy); cx.stroke();
      }
      // Bed details in preview (pillows and sheet on top)
      if (it.kind === 'bed') {
        var topYb = elev + iht;
        function projTopB(x,z){ return toScreen(projUV(x, topYb, z)); }
        function drawRectTopB(x0,z0,x1,z1, fillCol, strokeCol, lw){ var p0=projTopB(x0,z0), p1=projTopB(x1,z0), p2=projTopB(x1,z1), p3=projTopB(x0,z1); if (fillCol){ cx.fillStyle=fillCol; } cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); if (fillCol) cx.fill(); if (strokeCol){ cx.strokeStyle=strokeCol; cx.lineWidth=lw||1; cx.stroke(); } }
        var headInset = Math.min(0.12, it.depth*0.08);
        var pillowDepth = Math.min(0.30, it.depth*0.20);
        var pillowGap = Math.min(0.06, it.width*0.06);
        var pillowW = Math.min(0.42, it.width*0.44);
        var halfGap = pillowGap/2;
        if (it.width >= 1.2) {
          var leftCx = -pillowW/2 - halfGap;
          var rightCx = pillowW/2 + halfGap;
          var z0b = -ihd + headInset; var z1b = z0b + pillowDepth;
          drawRectTopB(leftCx - pillowW/2, z0b, leftCx + pillowW/2, z1b, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
          drawRectTopB(rightCx - pillowW/2, z0b, rightCx + pillowW/2, z1b, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
        } else {
          var pw = Math.min(0.6, it.width*0.8); var pd = pillowDepth; var z0s = -ihd + headInset; var z1s = z0s + pd;
          drawRectTopB(-pw/2, z0s, pw/2, z1s, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
        }
        var sheetStart = -ihd + headInset + pillowDepth + Math.min(0.06, it.depth*0.04);
        var sheetEnd = ihd - Math.min(0.08, it.depth*0.06);
        var sheetMarginX = Math.min(0.06, it.width*0.06);
        drawRectTopB(-ihw + sheetMarginX, sheetStart, ihw - sheetMarginX, sheetEnd, 'rgba(186, 210, 255, 0.22)', '#93c5fd', 0.8);
      }
    }

    try { drawPaletteCompass(cx, rect, yaw); } catch(e) {}
  }

  // Draw a small compass in the top-right corner of the popover preview
  function drawPaletteCompass(cx, rect, yaw) {
    var size = 56; var padding = 10; var x = rect.width - size - padding; var y = padding;
    cx.save(); cx.globalAlpha = 0.95;
    var r = 10; cx.beginPath(); cx.moveTo(x + r, y); cx.lineTo(x + size - r, y); cx.quadraticCurveTo(x + size, y, x + size, y + r); cx.lineTo(x + size, y + size - r); cx.quadraticCurveTo(x + size, y + size, x + size - r, y + size); cx.lineTo(x + r, y + size); cx.quadraticCurveTo(x, y + size, x, y + size - r); cx.lineTo(x, y + r); cx.quadraticCurveTo(x, y, x + r, y); cx.closePath(); cx.fillStyle = 'rgba(255,255,255,0.88)'; cx.strokeStyle = '#cfcfcf'; cx.lineWidth = 1; cx.fill(); cx.stroke();
    var cx0 = x + size/2; var cy0 = y + size/2; var rad = (size/2) - 9; function pt(a, rr){ return { x: cx0 + Math.cos(a)*rr, y: cy0 + Math.sin(a)*rr }; }
    cx.strokeStyle = '#6b7280'; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(cx0, cy0 - rad); cx.lineTo(cx0, cy0 + rad); cx.moveTo(cx0 - rad, cy0); cx.lineTo(cx0 + rad, cy0); cx.stroke();
    cx.fillStyle = '#374151'; cx.font = 'bold 11px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; var lr = rad - 5; var LN = pt(-Math.PI/2, lr), LE = pt(0, lr), LS = pt(Math.PI/2, lr), LW = pt(Math.PI, lr); cx.fillText('N', LN.x, LN.y); cx.fillText('E', LE.x, LE.y); cx.fillText('S', LS.x, LS.y); cx.fillText('W', LW.x, LW.y);
    var angleNeedle = -Math.PI/2 + yaw; var needle = pt(angleNeedle, rad - 1); cx.strokeStyle = '#ef4444'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(cx0, cy0); cx.lineTo(needle.x, needle.y); cx.stroke(); cx.restore();
  }

  function getPaletteScaleInfo(room, cv){ if (!__paletteState.__scaleInfo) { renderRoomPreview(room); } return __paletteState.__scaleInfo; }

  function addPalettePreviewItem(def){
    var room = findObjectById(paletteOpenForId); if (!room) return;
    var offset = (__paletteState.items.length % 5) * 0.3;
    var depth = def.kind === 'kitchen' ? 0.7 : def.depth;
    var it = { width: def.width, depth: depth, height: def.height, x: 0 + offset, z: 0 + offset, name: def.name, kind: def.kind, elevation: (def.kind==='tv'?0.8:0), isExisting: false };
    var maxX = room.width/2 - it.width/2; var maxZ = room.depth/2 - it.depth/2;
    it.x = Math.max(-maxX, Math.min(maxX, it.x));
    it.z = Math.max(-maxZ, Math.min(maxZ, it.z));
    __paletteState.items.push(it);
    renderRoomPreview(room);
  }

  function commitPaletteItems(){
    if (!paletteOpenForId || __paletteState.items.length === 0) return;
    var room = findObjectById(paletteOpenForId); if (!room) return;
    for (var i=0;i<__paletteState.items.length;i++){
      var it = __paletteState.items[i];
      if (it.isExisting) continue;
      var elevation = (it.kind === 'tv') ? 0.8 : 0.0;
      var depth = it.kind === 'kitchen' ? 0.7 : it.depth;
      var furn = { id: 'furn_'+Date.now()+Math.random().toString(36).slice(2), x: room.x + it.x, z: room.z + it.z, width: it.width, depth: depth, height: it.height, level: room.level, elevation: elevation, name: it.name, type: 'furniture', rotation: 0, kind: it.kind };
      furnitureItems.push(furn);
    }
    saveProjectSilently();
    var addedCount = __paletteState.items.filter(function(it){ return !it.isExisting; }).length;
    updateStatus('Added '+addedCount+' item(s) to '+(room.name||'Room'));
    __paletteState.items = __paletteState.items.filter(function(it){ return it.isExisting; });
    hideRoomPalette();
    renderLoop();
  }

  function clearPalettePreview(){ __paletteState.items = __paletteState.items.filter(function(it){ return it.isExisting; }); }

  function hitTestPaletteItem(mx, my, room){
    if (!__paletteState || __paletteState.items.length === 0) return -1;
    for (var i=__paletteState.items.length-1;i>=0;i--){
      var it = __paletteState.items[i];
      var pts = projectItemBase(it, room);
      if (pointInPolygon(mx, my, pts)) return i;
    }
    return -1;
  }

  function projectItemBase(it, room){
    var info = __paletteState.__scaleInfo; if (!info) { renderRoomPreview(room); info = __paletteState.__scaleInfo; }
    var cy = info.cy, sy = info.sy, cp = info.cp, sp = info.sp, scale = info.scale, centerU = info.centerU, centerV = info.centerV, rect = info.rect;
    function projUV(x,y,z){ var rx = cy*x + sy*z; var rz = -sy*x + cy*z; return { u: rx, v: -y*cp + rz*sp*0.5 }; }
    function toScreen(p){ return { x: rect.width/2 + (p.u - centerU)*scale, y: rect.height/2 + (p.v - centerV)*scale }; }
    var ihw = it.width/2, ihd = it.depth/2;
    var elev = Math.max(0, it.elevation || 0);
    return [
      projUV(it.x - ihw, elev, it.z - ihd),
      projUV(it.x + ihw, elev, it.z - ihd),
      projUV(it.x + ihw, elev, it.z + ihd),
      projUV(it.x - ihw, elev, it.z + ihd)
    ].map(toScreen);
  }

  function pointInPolygon(x, y, pts){
    var inside = false;
    for (var i=0, j=pts.length-1; i<pts.length; j=i++){
      var xi = pts[i].x, yi = pts[i].y; var xj = pts[j].x, yj = pts[j].y;
      var intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / Math.max(1e-6, (yj - yi)) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function loadExistingFurniturePreview(room){
    var list = [];
    for (var i=0;i<furnitureItems.length;i++){
      var f = furnitureItems[i];
      if (f.level !== room.level) continue;
      var relX = f.x - room.x; var relZ = f.z - room.z;
      var inside = Math.abs(relX) <= (room.width/2) && Math.abs(relZ) <= (room.depth/2);
      if (!inside) continue;
      list.push({ width: f.width, depth: f.depth, height: f.height, x: relX, z: relZ, name: f.name, kind: f.kind, elevation: (f.elevation||0), isExisting: true });
    }
    return list;
  }

  function addPaletteItem(def) {
    if (!paletteOpenForId) return;
    var room = findObjectById(paletteOpenForId);
    if (!room) return;
    var elevation = (def.kind === 'tv') ? 0.8 : 0.0;
    var depth = def.kind === 'kitchen' ? 0.7 : def.depth;
    var furn = { id: 'furn_'+Date.now()+Math.random().toString(36).slice(2), x: room.x, z: room.z, width: def.width, depth: depth, height: def.height, level: room.level, elevation: elevation, name: def.name, type: 'furniture', rotation: 0, kind: def.kind };
    furnitureItems.push(furn);
    updateStatus('Added: '+def.name+' to '+(room.name||'Room'));
    hideRoomPalette();
    saveProjectSilently();
    renderLoop();
  }

  // Draw a scaled 3D wireframe box for the item on its thumbnail canvas
  function renderItemThumb(canvas, def) {
    var cx = canvas.getContext('2d');
    cx.clearRect(0,0,canvas.width,canvas.height);
    var pad = 12;
    var w = canvas.width - pad*2, h = canvas.height - pad*2;
    var sx = def.width, sz = def.depth, sy = Math.max(0.3, def.height || 0.7);
    var maxFoot = Math.max(sx, sz);
    var scale = (Math.min(w, h) * 0.9) / maxFoot;
    var angle = Math.PI/6; var cos = Math.cos(angle), sin = Math.sin(angle);
    function proj3(x,y,z){ var u = (x - z) * cos; var v = -y + (x + z) * sin * 0.5; return { x: canvas.width/2 + u*scale, y: canvas.height/2 + v*scale }; }
    var hw = sx/2, hd = sz/2, ht = sy;
    var pts = [
      proj3(-hw, 0, -hd), proj3(hw, 0, -hd), proj3(hw, 0, hd), proj3(-hw, 0, hd),
      proj3(-hw, ht, -hd), proj3(hw, ht, -hd), proj3(hw, ht, hd), proj3(-hw, ht, hd)
    ];
    var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    cx.strokeStyle = '#007acc'; cx.lineWidth = 1.2;
    cx.beginPath(); for (var i=0;i<edges.length;i++){ var e = edges[i]; cx.moveTo(pts[e[0]].x, pts[e[0]].y); cx.lineTo(pts[e[1]].x, pts[e[1]].y);} cx.stroke();
    if (def.kind === 'kitchen') {
      function to2(x,y,z){ return proj3(x,y,z); }
      var isLargeK = (def.name && (/large|03/i).test(def.name)) || (def.depth >= 1.6 || def.width >= 3.4);
      var sinkW = isLargeK ? 0.9 : 0.55; var sinkD = 0.45; var sinkCx = -hw * 0.35; var sinkCz = 0;
      function drawRectTop(x0,z0,x1,z1){ var p0=to2(x0,ht,z0), p1=to2(x1,ht,z0), p2=to2(x1,ht,z1), p3=to2(x0,ht,z1); cx.fillStyle='rgba(200,210,220,0.55)'; cx.strokeStyle='#5b6773'; cx.lineWidth=1; cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); cx.fill(); cx.stroke(); }
      function drawCircleTop(cxw,czw,rw){ cx.strokeStyle='#111'; cx.lineWidth=1.2; cx.beginPath(); for (var k=0;k<=18;k++){ var a=(k/18)*Math.PI*2; var p=to2(cxw+Math.cos(a)*rw, ht, czw+Math.sin(a)*rw); if(k===0) cx.moveTo(p.x,p.y); else cx.lineTo(p.x,p.y);} cx.stroke(); }
      if (isLargeK) {
        var w2 = sinkW/2 - 0.02; drawRectTop(sinkCx - 0.02 - w2, sinkCz - sinkD/2, sinkCx - 0.02 + w2, sinkCz + sinkD/2); drawRectTop(sinkCx + 0.02 - w2, sinkCz - sinkD/2, sinkCx + 0.02 + w2, sinkCz + sinkD/2);
      } else {
        drawRectTop(sinkCx - sinkW/2, sinkCz - sinkD/2, sinkCx + sinkW/2, sinkCz + sinkD/2);
      }
      var plateR = 0.12, plateGap = 0.28; var plateBaseX = hw * 0.25; var plateBaseZ = -plateGap/2;
      drawCircleTop(plateBaseX, plateBaseZ, plateR);
      drawCircleTop(plateBaseX + plateGap, plateBaseZ, plateR);
      drawCircleTop(plateBaseX, plateBaseZ + plateGap, plateR);
      drawCircleTop(plateBaseX + plateGap, plateBaseZ + plateGap, plateR);
    }
    if (def.kind === 'bed') {
      function to2b(x,y,z){ return proj3(x,y,z); }
      function drawRectTopB(x0,z0,x1,z1, fillCol, strokeCol, lw2){ var p0=to2b(x0,ht,z0), p1=to2b(x1,ht,z0), p2=to2b(x1,ht,z1), p3=to2b(x0,ht,z1); if (fillCol){ cx.fillStyle=fillCol; } cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); if (fillCol) cx.fill(); if (strokeCol){ cx.strokeStyle=strokeCol; cx.lineWidth=lw2||1; cx.stroke(); } }
      var headInset = Math.min(0.12, sz*0.08);
      var pillowDepth = Math.min(0.30, sz*0.20);
      var pillowGap = Math.min(0.06, sx*0.06);
      var pillowW = Math.min(0.42, sx*0.44);
      var halfGap = pillowGap/2;
      if (sx >= 1.2) {
        var leftCx = -pillowW/2 - halfGap; var rightCx = pillowW/2 + halfGap; var z0 = -hd + headInset; var z1 = z0 + pillowDepth;
        drawRectTopB(leftCx - pillowW/2, z0, leftCx + pillowW/2, z1, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
        drawRectTopB(rightCx - pillowW/2, z0, rightCx + pillowW/2, z1, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
      } else {
        var pw = Math.min(0.6, sx*0.8); var pd = pillowDepth; var z0s = -hd + headInset; var z1s = z0s + pd;
        drawRectTopB(-pw/2, z0s, pw/2, z1s, 'rgba(240,243,247,0.95)', '#94a3b8', 1);
      }
      var sheetStart = -hd + headInset + pillowDepth + Math.min(0.06, sz*0.04);
      var sheetEnd = hd - Math.min(0.08, sz*0.06);
      var sheetMarginX = Math.min(0.06, sx*0.06);
      drawRectTopB(-hw + sheetMarginX, sheetStart, hw - sheetMarginX, sheetEnd, 'rgba(186, 210, 255, 0.22)', '#93c5fd', 0.8);
    }
  }

  // Expose API
  window.setupPalette = setupPalette;
  window.openRoomPalette = openRoomPalette;
  window.hideRoomPalette = hideRoomPalette;
  window.addPaletteItem = addPaletteItem;
})();
