// Lightweight 2D editor smoke hook. Does nothing unless ?smoke2d=1 is present.
(function(){
  function qs(name){ try { var m = String(location.search||'').match(new RegExp('[?&]'+name+'=([^&]+)')); return m ? decodeURIComponent(m[1]) : null; } catch(_) { return null; } }
  var flag2d = qs('smoke2d');
  var flagApply = qs('smokeApply');
  if ((!flag2d || flag2d === '0' || flag2d === 'false') && (!flagApply || flagApply === '0' || flagApply === 'false')) return;
  function setStatus(msg){ try{ var s=document.getElementById('status'); if(s) s.textContent = msg; }catch(e){} }
  function ready(fn){ if(document.readyState==='complete'||document.readyState==='interactive'){ setTimeout(fn,0); } else { document.addEventListener('DOMContentLoaded', fn); } }
  ready(function(){
    // Ensure editor module is loaded
    function ensureEditor(){
      return new Promise(function(resolve){
        if (typeof window.openPlan2DModal === 'function') { resolve(true); return; }
        try {
          if (typeof window.loadScript === 'function') {
            window.loadScript('js/plan2d/editor.js').then(function(){ resolve(true); }).catch(function(){ resolve(false); });
            return;
          }
        } catch(_){}
        // Fallback: inject script tag
        try {
          var s = document.createElement('script'); s.src='js/plan2d/editor.js'; s.onload=function(){ resolve(true); }; s.onerror=function(){ resolve(false); }; document.head.appendChild(s);
        } catch(_) { resolve(false); }
      });
    }
    ensureEditor().then(function(ok){
      if (!ok) { setStatus('2D smoke: failed to load editor module'); return; }
      // Always open the editor so drawing APIs are bound
      try { window.openPlan2DModal(); } catch(e){}
      // Wait a beat for editor init
      setTimeout(function(){
        // Basic 2D-open smoke
        if (flag2d && flag2d !== '0' && flag2d !== 'false'){
          try {
            var hadElems = (window.__plan2d && Array.isArray(window.__plan2d.elements) && window.__plan2d.elements.length>0);
            // If empty, attempt to populate from 3D and redraw
            if (!hadElems && typeof window.populatePlan2DFromDesign==='function') {
              try { var populated = window.populatePlan2DFromDesign(); if (populated && typeof window.plan2dDraw==='function') window.plan2dDraw(); } catch(_e){}
              hadElems = (window.__plan2d && Array.isArray(window.__plan2d.elements) && window.__plan2d.elements.length>0);
            }
            if (hadElems) setStatus('2D smoke: editor opened and has content');
            else setStatus('2D smoke: editor opened (no content)');
          } catch(_){}
        }

        // 2D→3D apply smoke: programmatically draw a 4x3m room with one door + one window and apply
        if (flagApply && flagApply !== '0' && flagApply !== 'false'){
          try {
            var okApply = false, err = null;
            if (!window.__plan2d || !Array.isArray(window.__plan2d.elements)) throw new Error('Editor state unavailable');
            // Clear current 2D elements (floor-aware)
            window.__plan2d.elements = [];
            var wt = window.__plan2d.wallThicknessM || 0.3;
            // Define axis-aligned rectangle walls centered at origin: 4m x 3m
            var seg = qs('seg');
            var walls;
            if (seg === 'polyL'){
              // L-shaped closed loop (8 segments) to validate non-rectangular loop handling
              walls = [
                {type:'wall', x0:-2, y0:-1.5, x1: 1, y1:-1.5, thickness: wt},
                {type:'wall', x0: 1, y0:-1.5, x1: 1, y1:-0.5, thickness: wt},
                {type:'wall', x0: 1, y0:-0.5, x1: 2, y1:-0.5, thickness: wt},
                {type:'wall', x0: 2, y0:-0.5, x1: 2, y1: 1.5, thickness: wt},
                {type:'wall', x0: 2, y0: 1.5, x1:-2, y1: 1.5, thickness: wt},
                {type:'wall', x0:-2, y0: 1.5, x1:-2, y1:-1.5, thickness: wt},
                {type:'wall', x0:-2, y0:-1.5, x1:-1, y1:-1.5, thickness: wt},
                {type:'wall', x0:-1, y0:-1.5, x1:-1, y1: 0.5, thickness: wt}
              ];
            } else if (seg === 'shared'){
              // Two adjacent 4x3 rooms sharing a central wall (tests T-junction/shared wall face extraction)
              walls = [
                {type:'wall', x0:-4, y0:-1.5, x1: 4, y1:-1.5, thickness: wt}, // top outer
                {type:'wall', x0:-4, y0: 1.5, x1: 4, y1: 1.5, thickness: wt}, // bottom outer
                {type:'wall', x0:-4, y0:-1.5, x1:-4, y1: 1.5, thickness: wt}, // left outer
                {type:'wall', x0: 4, y0:-1.5, x1: 4, y1: 1.5, thickness: wt}, // right outer
                {type:'wall', x0: 0,  y0:-1.5, x1: 0,  y1: 1.5, thickness: wt}  // middle partition
              ];
            } else if (seg === '8'){
              // Split each side into two segments (8 walls total)
              walls = [
                {type:'wall', x0:-2, y0:-1.5, x1: 0, y1:-1.5, thickness: wt},
                {type:'wall', x0: 0, y0:-1.5, x1: 2, y1:-1.5, thickness: wt},
                {type:'wall', x0: 2, y0:-1.5, x1: 2, y1: 0, thickness: wt},
                {type:'wall', x0: 2, y0: 0, x1: 2, y1: 1.5, thickness: wt},
                {type:'wall', x0: 2, y0: 1.5, x1: 0, y1: 1.5, thickness: wt},
                {type:'wall', x0: 0, y0: 1.5, x1:-2, y1: 1.5, thickness: wt},
                {type:'wall', x0:-2, y0: 1.5, x1:-2, y1: 0, thickness: wt},
                {type:'wall', x0:-2, y0: 0, x1:-2, y1:-1.5, thickness: wt}
              ];
            } else if (seg && seg !== '0' && seg !== 'false'){
              // Split one side into two segments (5 walls total)
              walls = [
                {type:'wall', x0:-2, y0:-1.5, x1: 2, y1:-1.5, thickness: wt}, // top
                {type:'wall', x0: 2, y0:-1.5, x1: 2, y1: 1.5, thickness: wt}, // right
                {type:'wall', x0: 2, y0: 1.5, x1: 0, y1: 1.5, thickness: wt}, // bottom part A
                {type:'wall', x0: 0, y0: 1.5, x1:-2, y1: 1.5, thickness: wt}, // bottom part B
                {type:'wall', x0:-2, y0: 1.5, x1:-2, y1:-1.5, thickness: wt}  // left
              ];
            } else {
              walls = [
                {type:'wall', x0:-2, y0:-1.5, x1: 2, y1:-1.5, thickness: wt}, // top
                {type:'wall', x0: 2, y0:-1.5, x1: 2, y1: 1.5, thickness: wt}, // right
                {type:'wall', x0: 2, y0: 1.5, x1:-2, y1: 1.5, thickness: wt}, // bottom
                {type:'wall', x0:-2, y0: 1.5, x1:-2, y1:-1.5, thickness: wt}  // left
              ];
            }
            // Push walls and remember indices
            var baseIdx = window.__plan2d.elements.length;
            for (var i=0;i<walls.length;i++) window.__plan2d.elements.push(walls[i]);
            var idxTop = baseIdx + 0, idxRight = baseIdx + 1, idxBottom = baseIdx + 2, idxLeft = baseIdx + 3;
            // Add a door centered on the bottom wall (width 0.92m)
            var doorW = window.__plan2d.doorWidthM || 0.92; var bottomLen = 4.0; var dSpan = Math.max(0.1, doorW / bottomLen);
            var dHalf = dSpan/2; var d0 = 0.5 - dHalf, d1 = 0.5 + dHalf;
            window.__plan2d.elements.push({ type:'door', host: idxBottom, t0: d0, t1: d1, widthM: doorW, heightM: window.__plan2d.doorHeightM || 2.04, thickness: wt, meta:{ hinge:'t0', swing:'in' } });
            // Add a window centered on the right wall (width 1.2m)
            var winW = window.__plan2d.windowDefaultWidthM || 1.2; var rightLen = 3.0; var wSpan = Math.max(0.1, winW / rightLen);
            var wHalf = wSpan/2; var w0 = 0.5 - wHalf, w1 = 0.5 + wHalf;
            // Support testing full-height windows via ?fullWin=1
            var fullWin = (flagApply && (qs('fullWin') && qs('fullWin') !== '0' && qs('fullWin') !== 'false'));
            var winEl = { type:'window', host: idxRight, t0: w0, t1: w1, thickness: wt };
            if (fullWin) {
              winEl.sillM = 0;
              winEl.heightM = (window.__plan2d.wallHeightM || 3.0);
            }
            window.__plan2d.elements.push(winEl);
            try { window.plan2dDraw && window.plan2dDraw(); } catch(_d){}
            // Apply to 3D
            var lvl = (typeof window.currentFloor==='number'? window.currentFloor : 0);
            if (typeof window.applyPlan2DTo3D === 'function') {
              try { window.applyPlan2DTo3D(undefined, { allowRooms:true, quiet:true, level: lvl }); } catch(e1){ err = e1; }
            } else {
              err = new Error('applyPlan2DTo3D missing');
            }
            // Validate results
            var foundRoom = null; var rooms = Array.isArray(window.allRooms)? window.allRooms : [];
            if (seg === 'shared'){
              var countLvl = 0;
              for (var r=0;r<rooms.length;r++){ var rm = rooms[r]; if (!rm) continue; if ((rm.level||0)!==lvl) continue; countLvl++; }
              okApply = (countLvl >= 2);
              if (okApply) setStatus('2D→3D smoke: PASS (shared-wall -> '+countLvl+' rooms)');
              else setStatus('2D→3D smoke: FAIL (shared-wall -> rooms='+countLvl+')');
            } else {
              for (var r=0;r<rooms.length;r++){
                var rm = rooms[r]; if (!rm) continue; if ((rm.level||0)!==lvl) continue;
                var w = +((rm.width||0).toFixed(2)); var d = +((rm.depth||0).toFixed(2));
                if (Math.abs(w - 4.00) <= 0.05 && Math.abs(d - 3.00) <= 0.05) { foundRoom = rm; break; }
              }
              var doorCt = 0, winCt = 0;
              if (foundRoom && Array.isArray(foundRoom.openings)){
                for (var oi=0; oi<foundRoom.openings.length; oi++){ var op = foundRoom.openings[oi]; if(!op) continue; if(op.type==='door') doorCt++; else if(op.type==='window') winCt++; }
              }
              okApply = !!(foundRoom && doorCt>=1 && winCt>=1);
              if (okApply) setStatus('2D→3D smoke: PASS (room 4x3, door='+doorCt+', window='+winCt+')');
              else if (foundRoom) setStatus('2D→3D smoke: PARTIAL (room ok; openings door='+doorCt+', window='+winCt+')');
              else setStatus('2D→3D smoke: FAIL (no 4x3 room)');
            }
          } catch(ex) {
            setStatus('2D→3D smoke: ERROR '+ (ex && ex.message ? ex.message : 'unknown'));
          }
        }

        // Auto-close to avoid blocking manual testing unless explicitly kept open
        if (!qs('keep2d')){
          setTimeout(function(){ try { window.closePlan2DModal && window.closePlan2DModal(); } catch(_e){} }, 900);
        }
      }, 600);
    });
  });
})();
