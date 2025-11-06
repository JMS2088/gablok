// Lightweight in-browser smoke test to verify grid and initial room render.
// No dependencies. Loads after app.js and runs once on DOMContentLoaded.
(function(){
  function setStatus(msg){ try{ var s=document.getElementById('status'); if(s) s.textContent = msg; }catch(e){} }
  function qs(name){ try { var m = String(location.search||'').match(new RegExp('[?&]'+name+'=([^&]+)')); return m ? decodeURIComponent(m[1]) : null; } catch(_) { return null; } }
  function report(msg){ try { fetch('/__report?msg='+encodeURIComponent(msg)).catch(function(){}); } catch(_r){} }
  function sampleNonWhitePixels(ctx, x, y, w, h){
    try{
      var img = ctx.getImageData(x, y, w, h);
      var data = img.data; var count = 0;
      for (var i=0;i<data.length;i+=4){
        var r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
        // Treat anything not pure white (255,255,255) as drawn content
        if (!(r===255 && g===255 && b===255 && a===255)) count++;
      }
      return count;
    } catch(e){ return 0; }
  }
  function run(){
    var c = window.canvas || document.getElementById('canvas');
    if (!c) { setStatus('Smoke: no canvas'); return; }
    var context = c.getContext('2d'); if(!context){ setStatus('Smoke: no 2D context'); return; }
    // Allow a couple of frames for renderLoop to draw
    var frames=0; function step(){
      frames++;
      if(frames<3){ requestAnimationFrame(step); return; }
      // Sample a central region for non-white pixels (grid/room strokes)
      var w = c.width, h = c.height; var box = 200; // device pixels
      var sx = Math.max(0, Math.floor(w/2 - box/2)), sy = Math.max(0, Math.floor(h/2 - box/2));
      var sw = Math.min(box, w - sx), sh = Math.min(box, h - sy);
      var nonWhite = sampleNonWhitePixels(context, sx, sy, sw, sh);
      var hasGridOrGeometry = nonWhite > 500; // threshold: a few lines/edges should exceed this
      var hasRoom = Array.isArray(window.allRooms) && window.allRooms.length > 0;
      var ok = !!(hasGridOrGeometry && hasRoom);
      if(ok){
        // Avoid overriding sticky debug messages when debug overlay is enabled
        if (!window.__debugStickyStatus) setStatus('Smoke test passed');
        else console.log('[Smoke] passed');
      }
      else {
        var reasons=[]; if(!hasGridOrGeometry) reasons.push('grid/geometry not detected'); if(!hasRoom) reasons.push('no room present');
        if (!window.__debugStickyStatus) setStatus('Smoke test failed: ' + reasons.join(', '));
        else console.warn('[Smoke] failed:', reasons.join(', '));
        // Visual hint (red border) only in debug mode; avoid showing to end users
        try{ if (window.__debug && window.__debug.enabled) { c.style.outline = '3px solid #ef4444'; c.style.outlineOffset = '-3px'; } }catch(e){}
        console.warn('[Smoke] Details:', { w:w, h:h, nonWhite, hasRoom, allRooms: window.allRooms });
      }
    }
    requestAnimationFrame(step);
  }
  function ready(fn){ if(document.readyState==='complete'||document.readyState==='interactive'){ setTimeout(fn,0); } else { document.addEventListener('DOMContentLoaded', fn); } }
  ready(function(){
    // Defer slightly to let startApp run
    setTimeout(run, 150);
    // Optional kitchen placement smoke: ?test3d=kitchen
    try {
      var t3d = qs('test3d');
      if (t3d === 'kitchen') {
        setTimeout(function(){
          try {
            if (!Array.isArray(window.allRooms) || window.allRooms.length===0) {
              if (typeof window.addNewRoom==='function') window.addNewRoom();
            }
            var room = (Array.isArray(window.allRooms) && window.allRooms[0]) || null;
            if (!room) { setStatus('Kitchen smoke: no room'); report('Kitchen smoke: no room'); return; }
            if (!Array.isArray(window.furnitureItems)) window.furnitureItems = [];
            var depth = 0.7;
            var furn = { id: 'furn_smoke_kitchen', x: room.x, z: room.z, width: 3.0, depth: depth, height: 0.9, level: room.level, elevation: 0, name: 'Kitchen Design 01', type: 'furniture', rotation: 0, kind: 'kitchen' };
            window.furnitureItems.push(furn);
            if (typeof window.renderLoop==='function') window.renderLoop();
            setStatus('Kitchen smoke: placed test kitchen'); report('Kitchen smoke: placed');
          } catch(ex){ setStatus('Kitchen smoke: ERROR'); report('Kitchen smoke: ERROR'); }
        }, 250);
      }
    } catch(_e){}
  });
  // Expose manual trigger
  window.smokeTest3D = run;
})();
