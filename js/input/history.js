// Unified undo/redo history manager (3D + 2D)
// Provides window.historyPushChange, window.historyUndo, window.historyRedo
// Captures shallow snapshots of primary mutable arrays/objects and selected state
// Optimized for up to 60 entries; oldest pruned. Drag operations coalesced.
(function(){
  if (window.__historyInstalled) return; window.__historyInstalled = true;
  var MAX = 60;
  var undoStack = []; // each entry: { stamp, kind, state }
  var redoStack = [];
  var suppress = 0; // increment while performing undo/redo to suppress new capture
  var lastCoalesceKey = null; // key for coalescing drag / arrow move sequences
  var lastCoalesceStamp = 0;
  var COALESCE_MS = 350; // time window to merge sequential micro-moves

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
    // Trigger re-renders / UI updates
    try { if (typeof updateMeasurements==='function') updateMeasurements(); } catch(_um){}
    try { if (typeof updateLabels==='function') updateLabels(); } catch(_ul){}
    try { if (typeof plan2dDraw==='function' && window.__plan2d && __plan2d.active) plan2dDraw(); } catch(_pd){}
    try { if (typeof renderLoop==='function') { window._needsFullRender = true; renderLoop(); } } catch(_rl){}
  }
  function push(kind, opts){
    if(suppress>0) return; // don't capture while restoring
    var now = Date.now();
    var coalesceKey = null;
    if(opts && opts.coalesce){ coalesceKey = kind + ':' + (opts.coalesceKey||''); }
    if(coalesceKey && lastCoalesceKey === coalesceKey && (now - lastCoalesceStamp) < COALESCE_MS && undoStack.length){
      // Replace top entry with fresh snapshot (merge micro-changes)
      undoStack[undoStack.length-1] = { stamp: now, kind: kind, state: shallowState() };
      lastCoalesceStamp = now;
      redoStack.length = 0; // clear redo path on new mutation
      return;
    }
    // Normal push
    undoStack.push({ stamp: now, kind: kind, state: shallowState() });
    if(undoStack.length>MAX) undoStack.splice(0, undoStack.length-MAX);
    redoStack.length = 0; // invalidate forward history
    lastCoalesceKey = coalesceKey;
    lastCoalesceStamp = now;
    try { updateStatus && updateStatus('Saved step: '+kind); } catch(_s){}
  }
  function undo(){
    if(!undoStack.length) { updateStatus && updateStatus('Nothing to undo'); return; }
    var cur = shallowState();
    var entry = undoStack.pop();
    redoStack.push({ stamp: Date.now(), kind: 'redo-base', state: cur });
    suppress++; restoreState(entry.state); suppress--;
    updateStatus && updateStatus('Undo: '+entry.kind);
  }
  function redo(){
    if(!redoStack.length) { updateStatus && updateStatus('Nothing to redo'); return; }
    var cur = shallowState();
    var entry = redoStack.pop();
    undoStack.push({ stamp: Date.now(), kind: 'undo-base', state: cur });
    suppress++; restoreState(entry.state); suppress--;
    updateStatus && updateStatus('Redo');
  }
  // Public API
  window.historyPushChange = push;
  window.historyUndo = undo;
  window.historyRedo = redo;
})();
