// Lightweight 2D editor smoke hook and tiny test harness.
// Triggers on any of:
//  - ?smoke2d=1            -> opens 2D and reports basic status
//  - ?smokeApply=1         -> builds a sample room + openings and applies to 3D
//  - ?test2d=delete        -> runs keyboard Delete tests for window/door removal
(function(){
  function qs(name){ try { var m = String(location.search||'').match(new RegExp('[?&]'+name+'=([^&]+)')); return m ? decodeURIComponent(m[1]) : null; } catch(_) { return null; } }
  var flag2d = qs('smoke2d');
  var flagApply = qs('smokeApply');
  var flagTest = qs('test2d');
  // If none of the known flags are present, do nothing
  if ((!flag2d || flag2d === '0' || flag2d === 'false') && (!flagApply || flagApply === '0' || flagApply === 'false') && (!flagTest || flagTest === '0' || flagTest === 'false')) return;
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
        // Tiny helper to build a simple 4x3m room with one bottom-door + one right-wall window
        function buildSimpleRoomWithOpenings(){
          var wt = (window.__plan2d && window.__plan2d.wallThicknessM) || 0.3;
          if (!window.__plan2d || !Array.isArray(window.__plan2d.elements)) return { ok:false, reason:'no editor state' };
          window.__plan2d.elements = [];
          var walls = [
            {type:'wall', x0:-2, y0:-1.5, x1: 2, y1:-1.5, thickness: wt}, // top
            {type:'wall', x0: 2, y0:-1.5, x1: 2, y1: 1.5, thickness: wt}, // right
            {type:'wall', x0: 2, y0: 1.5, x1:-2, y1: 1.5, thickness: wt}, // bottom
            {type:'wall', x0:-2, y0: 1.5, x1:-2, y1:-1.5, thickness: wt}  // left
          ];
          var baseIdx = window.__plan2d.elements.length;
          for (var i=0;i<walls.length;i++) window.__plan2d.elements.push(walls[i]);
          var idxRight = baseIdx + 1, idxBottom = baseIdx + 2;
          // Door centered on bottom wall (width ~0.92m)
          var doorW = (window.__plan2d && window.__plan2d.doorWidthM) || 0.92;
          var dSpan = Math.max(0.1, doorW / 4.0), dHalf = dSpan/2;
          window.__plan2d.elements.push({ type:'door', host: idxBottom, t0: 0.5 - dHalf, t1: 0.5 + dHalf, widthM: doorW, heightM: (window.__plan2d.doorHeightM||2.04), thickness: wt, meta:{ hinge:'t0', swing:'in' } });
          // Window centered on right wall (width ~1.2m)
          var winW = (window.__plan2d && window.__plan2d.windowDefaultWidthM) || 1.2;
          var wSpan = Math.max(0.1, winW / 3.0), wHalf = wSpan/2;
          window.__plan2d.elements.push({ type:'window', host: idxRight, t0: 0.5 - wHalf, t1: 0.5 + wHalf, thickness: wt, sillM:(window.__plan2d.windowSillM||1.0), heightM:(window.__plan2d.windowHeightM||1.5) });
          try { window.plan2dDraw && window.plan2dDraw(); } catch(_d){}
          return { ok:true };
        }

        // Programmatic keyboard event for Delete
        function report(msg){ try { fetch('/__report?msg='+encodeURIComponent(msg)).catch(function(){}); } catch(_r){} }
        function fireDelete(){ try {
          var ev = new KeyboardEvent('keydown', { key:'Delete', code:'Delete', keyCode:46, which:46, bubbles:true, cancelable:true });
          document.dispatchEvent(ev); window.dispatchEvent(ev);
          var up = new KeyboardEvent('keyup', { key:'Delete', code:'Delete', keyCode:46, which:46, bubbles:true, cancelable:true });
          document.dispatchEvent(up); window.dispatchEvent(up);
        } catch(_e) { try { var e2 = new Event('keydown'); e2.key='Delete'; e2.keyCode=46; e2.which=46; document.dispatchEvent(e2); window.dispatchEvent(e2); } catch(_e2){} } }

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

        // Keyboard Delete tests for 2D editor
        if (flagTest && flagTest !== '0' && flagTest !== 'false'){
          if (flagTest === 'delete'){
            (function(){
              try{
                var res = buildSimpleRoomWithOpenings();
                if(!res.ok){ setStatus('2D Delete tests: ERROR init '+(res.reason||'')); return; }
                var els = window.__plan2d.elements;
                // Find indices of the just-added door and window
                var idxDoor=-1, idxWin=-1;
                for(var i=0;i<els.length;i++){ if(!els[i]) continue; if(els[i].type==='door') idxDoor=i; if(els[i].type==='window') idxWin=i; }
                if(!(idxDoor>=0 && idxWin>=0)){ setStatus('2D Delete tests: ERROR no door/window'); return; }

                function delay(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
                function expect(cond, msg){ if(!cond) throw new Error(msg||'assert failed'); }

                async function run(){
                  // 1) Delete selected window via Delete key
                  var beforeCount = els.length;
                  window.plan2dSetSelection && window.plan2dSetSelection(idxWin);
                  await delay(20);
                  fireDelete();
                  await delay(20);
                  expect(window.__plan2d.elements.length === beforeCount - 1, 'selected window not deleted');

                  // 2) Delete selected door via Delete key
                  // After prior deletion, door index may have shifted; resolve by ref
                  var doorIndexNow = -1;
                  for(var j=0;j<window.__plan2d.elements.length;j++){ var e=window.__plan2d.elements[j]; if(e && e.type==='door'){ doorIndexNow=j; break; } }
                  expect(doorIndexNow>=0, 'door missing before delete test');
                  var count2 = window.__plan2d.elements.length;
                  window.plan2dSetSelection && window.plan2dSetSelection(doorIndexNow);
                  await delay(20);
                  fireDelete();
                  await delay(20);
                  expect(window.__plan2d.elements.length === count2 - 1, 'selected door not deleted');

                  // 3) Quick delete via hover (recreate window, then set hoverWindowIndex)
                  // Rebuild to reset state
                  buildSimpleRoomWithOpenings();
                  await delay(10);
                  // Find a window index and set hover
                  var idxHover=-1; for(var k=0;k<window.__plan2d.elements.length;k++){ var ee=window.__plan2d.elements[k]; if(ee && ee.type==='window'){ idxHover=k; break; } }
                  expect(idxHover>=0, 'no window to test hover delete');
                  window.__plan2d.selectedIndex=-1; window.__plan2d.hoverWindowIndex = idxHover;
                  var c3 = window.__plan2d.elements.length; fireDelete(); await delay(20);
                  expect(window.__plan2d.elements.length === c3 - 1, 'hover window not deleted');

                  // 4) Quick delete via hover over a door
                  buildSimpleRoomWithOpenings();
                  await delay(10);
                  var idxHoverDoor=-1; for(var kd=0;kd<window.__plan2d.elements.length;kd++){ var ed=window.__plan2d.elements[kd]; if(ed && ed.type==='door'){ idxHoverDoor=kd; break; } }
                  expect(idxHoverDoor>=0, 'no door to test hover delete');
                  window.__plan2d.selectedIndex=-1; window.__plan2d.hoverDoorIndex = idxHoverDoor;
                  var c4 = window.__plan2d.elements.length; fireDelete(); await delay(20);
                  expect(window.__plan2d.elements.length === c4 - 1, 'hover door not deleted');

                  // 5) Delete a selected wall and ensure hosted openings are also removed
                  buildSimpleRoomWithOpenings();
                  await delay(10);
                  // Pick the wall hosting the door (guaranteed by our builder)
                  var doorIdx=-1, hostWall=-1, hostedCount=0;
                  for(var t=0;t<window.__plan2d.elements.length;t++){ var ee2=window.__plan2d.elements[t]; if(ee2 && ee2.type==='door'){ doorIdx=t; hostWall = (typeof ee2.host==='number') ? ee2.host : -1; break; } }
                  expect(hostWall>=0, 'no host wall found for door');
                  // Count openings hosted on this wall
                  for(var m=0;m<window.__plan2d.elements.length;m++){ var em=window.__plan2d.elements[m]; if(!em) continue; if((em.type==='door' || em.type==='window') && typeof em.host==='number' && em.host===hostWall){ hostedCount++; } }
                  var c5 = window.__plan2d.elements.length;
                  window.plan2dSetSelection && window.plan2dSetSelection(hostWall);
                  await delay(20);
                  fireDelete();
                  await delay(20);
                  expect(window.__plan2d.elements.length === c5 - (1 + hostedCount), 'selected wall and hosted openings not deleted');

                  var passMsg = '2D Delete tests: PASS (selected window, selected door, hover window, hover door, selected wall+hosted)';
                  setStatus(passMsg);
                  report(passMsg);
                  console.info('[2D Delete tests] PASS');
                }
                run().catch(function(err){ var failMsg = '2D Delete tests: FAIL '+(err && err.message ? err.message : err); setStatus(failMsg); report(failMsg); console.error('[2D Delete tests] FAIL', err); });
              } catch(ex) {
                var errMsg = '2D Delete tests: ERROR '+(ex && ex.message ? ex.message : 'unknown');
                setStatus(errMsg); report(errMsg);
              }
            })();
          } else {
            setStatus('2D tests: unknown test "'+flagTest+'"');
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
