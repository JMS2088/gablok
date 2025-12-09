// Unified undo/redo history manager (3D + 2D)
// Provides window.historyPushChange, window.historyUndo, window.historyRedo
// Captures shallow snapshots of primary mutable arrays/objects and selected state
// Optimized for up to 60 entries; oldest pruned. Drag operations coalesced.
(function(){
  if (window.__historyInstalled) return; window.__historyInstalled = true;
  var MAX = 60;
  var undoStack = []; // entries: { stamp, kind, prevState, forwardState }
  var redoStack = []; // same shape for redo operations
  var suppress = 0;
  var lastCoalesceKey = null;
  var lastCoalesceStamp = 0;
  var COALESCE_MS = 350;
  function cloneArray(arr){ if(!Array.isArray(arr)) return []; return arr.map(function(o){ if(!o||typeof o!=='object') return o; var c={}; for(var k in o){ if(!Object.prototype.hasOwnProperty.call(o,k)) continue; var v=o[k]; if(v && typeof v==='object'){ if(Array.isArray(v)){ c[k]=v.slice(); } else { c[k]=JSON.parse(JSON.stringify(v)); } } else { c[k]=v; } } return c; }); }
  function shallowState(){
    return {
      allRooms: cloneArray(window.allRooms||[]),
      wallStrips: cloneArray(window.wallStrips||[]),
      pergola: cloneArray(window.pergolaComponents||[]),
      garage: cloneArray(window.garageComponents||[]),
      pool: cloneArray(window.poolComponents||[]),
      roof: cloneArray(window.roofComponents||[]),
      balcony: cloneArray(window.balconyComponents||[]),
      furniture: cloneArray(window.furnitureItems||[]),
      stairs: cloneArray(window.stairsComponents||[]),
      singleStairs: (window.stairsComponent? JSON.parse(JSON.stringify(window.stairsComponent)): null),
      selectedId: window.selectedRoomId || null,
      selectedWallStripIndex: (typeof window.selectedWallStripIndex==='number'? window.selectedWallStripIndex : -1),
      plan2d: (window.__plan2d && Array.isArray(__plan2d.elements)) ? cloneArray(__plan2d.elements) : null,
      currentFloor: (typeof window.currentFloor==='number'? window.currentFloor : 0)
    };
  }
  function restoreState(st){
    if(!st) return;
    function repl(name, val){ try { window[name] = val; } catch(_e){} }
    repl('allRooms', cloneArray(st.allRooms||[]));
    repl('wallStrips', cloneArray(st.wallStrips||[]));
    repl('pergolaComponents', cloneArray(st.pergola||[]));
    repl('garageComponents', cloneArray(st.garage||[]));
    repl('poolComponents', cloneArray(st.pool||[]));
    repl('roofComponents', cloneArray(st.roof||[]));
    repl('balconyComponents', cloneArray(st.balcony||[]));
    repl('furnitureItems', cloneArray(st.furniture||[]));
    repl('stairsComponents', cloneArray(st.stairs||[]));
    try { window.stairsComponent = st.singleStairs ? JSON.parse(JSON.stringify(st.singleStairs)) : null; } catch(_s){}
    try { window.selectedRoomId = st.selectedId || null; } catch(_sl){}
    try { window.selectedWallStripIndex = st.selectedWallStripIndex; } catch(_sw){}
    try { if(st.plan2d && window.__plan2d) { __plan2d.elements = cloneArray(st.plan2d); } } catch(_p){}
    try { if (typeof st.currentFloor==='number') window.currentFloor = st.currentFloor; } catch(_cf){}
    try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_um){}
    try { if (typeof updateLabels==='function') updateLabels(); } catch(_ul){}
    try { if (typeof plan2dDraw==='function' && window.__plan2d && __plan2d.active) plan2dDraw(); } catch(_pd){}
    try { if (typeof renderLoop==='function') { window._needsFullRender = true; renderLoop(); } } catch(_rl){}
  }
  var lastSnapshot = shallowState(); // state BEFORE next mutation
  function push(kind, opts){
    if(suppress>0) return;
    var now = Date.now();
    var currentState = shallowState(); // AFTER mutation (push called post-change)
    var coalesceKey = (opts && opts.coalesce) ? (kind+':'+(opts.coalesceKey||'')) : null;
    if (coalesceKey && lastCoalesceKey===coalesceKey && (now-lastCoalesceStamp)<COALESCE_MS && undoStack.length){
      // Extend existing coalesced entry forwardState only
      var top = undoStack[undoStack.length-1];
      top.forwardState = currentState;
      lastCoalesceStamp = now;
      redoStack.length = 0;
      lastSnapshot = currentState; // update baseline for next non-coalesced push
      return;
    }
    undoStack.push({ stamp: now, kind: kind, prevState: lastSnapshot, forwardState: currentState });
    if (undoStack.length>MAX) undoStack.splice(0, undoStack.length-MAX);
    redoStack.length = 0;
    lastCoalesceKey = coalesceKey;
    lastCoalesceStamp = now;
    lastSnapshot = currentState; // baseline shifts to newest state
    try { updateStatus && updateStatus('Saved step: '+kind); } catch(_s){}
  }
  function undo(){
    if(!undoStack.length){ updateStatus && updateStatus('Nothing to undo'); return; }
    var entry = undoStack.pop();
    redoStack.push(entry);
    suppress++; restoreState(entry.prevState); suppress--;
    lastSnapshot = entry.prevState; // baseline now previous state
    updateStatus && updateStatus('Undo: '+entry.kind);
  }
  function redo(){
    if(!redoStack.length){ updateStatus && updateStatus('Nothing to redo'); return; }
    var entry = redoStack.pop();
    suppress++; restoreState(entry.forwardState); suppress--;
    undoStack.push(entry); // reinsert so further undo works
    lastSnapshot = entry.forwardState;
    updateStatus && updateStatus('Redo: '+entry.kind);
  }
  window.historyPushChange = push;
  window.historyUndo = undo;
  window.historyRedo = redo;
})();
