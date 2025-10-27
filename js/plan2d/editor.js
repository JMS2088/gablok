// ================= 2D FLOOR PLAN EDITOR (IMPLEMENTATION) =================
// Provides: openPlan2DModal, closePlan2DModal, drawing walls (300mm), windows (thin), erase, clear, export/import.

var __plan2d = {
  active:false,
  scale:50,          // px per meter
  wallThicknessM:0.3,
  // Stroke width (in canvas px) used when outlining walls. Keep dimension overlay in sync.
  wallStrokePx:1.2,
  wallHeightM:3.0,
  // Controls orientation: 2D Y = sign * world Z (1 => North up matches world +Z; -1 flips)
  yFromWorldZSign: 1,
  // Persisted plan center in world meters (used to stabilize recentering)
  centerX: 0,
  centerZ: 0,
  // When set (epoch ms), freeze center/scale for populatePlan2DFromDesign() until this time
  freezeCenterScaleUntil: 0,
  // Grid snapping step (meters)
  gridStep: 0.5,
  elements:[],       // { type:'wall'|'window'|'door', ... }
  tool:'wall',       // current tool: wall | window | door | erase | select
  start:null,        // world coords of drag start
  last:null,         // world coords of current mouse during drag
  mouse:null,        // {x,y} current mouse position in canvas pixels for overlay anchoring
  hoverIndex:-1,
  selectedIndex:-1,
  // Stable reference to the currently selected element object (guards against reindexing)
  selectedRef:null,
  // Geometry snapshot of selected element for resilient re-identification
  selectedSnapshot:null,
  // Briefly pause 3D→2D repopulate after selection so Delete can act before selection is cleared
  freezeSyncUntil: 0,
  // Window editing state (for host-anchored windows)
  dragWindow:null,   // { index, end:'t0'|'t1' }
  // Standard sizes
  doorWidthM:0.87,
  doorHeightM:2.04,
  // Default preview width for windows before sizing
  windowDefaultWidthM:1.2,
  // Door editing state (for dragging endpoints)
  dragDoor:null,      // { index, end:'t0'|'t1'|'a'|'b' }
  // Whole-door drag state for sliding along wall
  dragDoorWhole:null, // { index, startMouseT, startT0, startT1, host }
  // Wall endpoint drag state
  dragWall:null,       // { index, end:'a'|'b', orient:'h'|'v', other:{x,y} }
  // Selected wall subsegment between junctions (for targeted deletion)
  selectedSubsegment:null, // { wallIndex, t0, t1, ax, ay, bx, by }
  // Rendering preference: when false, draw white boxes + text on base canvas at original positions
  drawLabelBoxesOnLabelsLayer:false
};

// Per-floor 2D drafts so in-progress edits persist across floor switches within the 2D editor
var __plan2dDrafts = { 0: null, 1: null };

// Persist 2D drafts across reloads so in-progress edits survive page refresh
function loadPlan2dDraftsFromStorage(){
  try {
    var raw = localStorage.getItem('gablok_plan2dDrafts_v1');
    if (!raw) return false;
    var data = JSON.parse(raw);
    if (data && (typeof data === 'object') && ('0' in data || '1' in data)) {
      __plan2dDrafts = data;
      return true;
    }
  } catch(e) { /* ignore */ }
  return false;
}
function savePlan2dDraftsToStorage(){
  try { localStorage.setItem('gablok_plan2dDrafts_v1', JSON.stringify(__plan2dDrafts)); } catch(e) { /* ignore */ }
}

function plan2dSaveDraft(level){
  try{
    var lvl = (typeof level==='number' ? level : (typeof currentFloor==='number'? currentFloor : 0));
    __plan2dDrafts[lvl] = {
      elements: Array.isArray(__plan2d.elements) ? JSON.parse(JSON.stringify(__plan2d.elements)) : [],
      centerX: __plan2d.centerX || 0,
      centerZ: __plan2d.centerZ || 0,
      scale: __plan2d.scale || 50,
      yFromWorldZSign: __plan2d.yFromWorldZSign || 1,
      lastWallsSig: (__plan2d._lastWallsSig || null),
      last2Dsig: (__plan2d._last2Dsig || null),
      last3Dsig: (function(){ try { return plan2dSig3D(); } catch(e){ return null; } })()
    };
    // Persist drafts so they survive reloads
    savePlan2dDraftsToStorage();
    return true;
  }catch(e){ return false; }
}

function plan2dLoadDraft(level){
  try{
    // Refresh from storage if available
    loadPlan2dDraftsFromStorage();
    var lvl = (typeof level==='number' ? level : (typeof currentFloor==='number'? currentFloor : 0));
    var d = __plan2dDrafts[lvl];
    if(!d || !Array.isArray(d.elements)) return false;
    __plan2d.elements = JSON.parse(JSON.stringify(d.elements));
    __plan2d.centerX = d.centerX || 0;
    __plan2d.centerZ = d.centerZ || 0;
    if (typeof d.scale==='number' && isFinite(d.scale)) __plan2d.scale = d.scale;
    if (d.yFromWorldZSign===1 || d.yFromWorldZSign===-1) __plan2d.yFromWorldZSign = d.yFromWorldZSign;
    __plan2d._lastWallsSig = d.lastWallsSig || null;
    __plan2d._last2Dsig = d.last2Dsig || null;
    __plan2d._last3Dsig = d.last3Dsig || null;
    return true;
  }catch(e){ return false; }
}

// ===== 2D/3D LIVE SYNC HELPERS =====
__plan2d.syncInProgress = false;      // prevent feedback while applying
__plan2d._applyTimer = null;          // debounce timer id
__plan2d._syncTimer = null;           // polling timer for 3D->2D
__plan2d._last3Dsig = null;           // last ground-floor signature
__plan2d._last2Dsig = null;           // last 2D signature applied
__plan2d._lastWallsSig = null;        // last walls-only signature to detect opening-only edits

function plan2dSig3D(){
  try{
    var parts=[];
    for(var i=0;i<allRooms.length;i++){
      var r=allRooms[i];
      var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
      if((r.level||0)!==lvl) continue;
      var ops=(r.openings||[]).map(function(o){ return [o.type,o.edge, +(o.startM||0).toFixed(3), +(o.endM||0).toFixed(3), (typeof o.heightM==='number'? +o.heightM.toFixed(3): null) ]; });
      parts.push([ +r.x.toFixed(3), +r.z.toFixed(3), +r.width.toFixed(3), +r.depth.toFixed(3), ops ]);
    }
    // Include current-floor interior wall strips so 2D sync picks up changes in 3D strips too
    for(var wsi=0; wsi<wallStrips.length; wsi++){
      var ws = wallStrips[wsi]; var lvl2 = (typeof currentFloor==='number' ? currentFloor : 0);
      if((ws.level||0)!==lvl2) continue;
      parts.push(['ws', +ws.x0.toFixed(3), +ws.z0.toFixed(3), +ws.x1.toFixed(3), +ws.z1.toFixed(3), +(ws.thickness||0).toFixed(3), +(ws.height||0).toFixed(3), +(ws.baseY||0).toFixed(3)]);
    }
    // Include non-room components on current floor so overlay refreshes when they change
    var lvlNow = (typeof currentFloor==='number' ? currentFloor : 0);
    try {
      if (stairsComponent && (stairsComponent.level||0)===lvlNow) {
        parts.push(['st', +(+stairsComponent.x).toFixed(3), +(+stairsComponent.z).toFixed(3), +(+stairsComponent.width||0).toFixed(3), +(+stairsComponent.depth||0).toFixed(3), +(+stairsComponent.rotation||0).toFixed(3)]);
      }
    } catch(e){}
    try {
      var pergs = Array.isArray(window.pergolaComponents) ? pergolaComponents : [];
      for (var pg=0; pg<pergs.length; pg++){
        var p = pergs[pg]; if(!p) continue; if((p.level||0)!==lvlNow) continue;
        parts.push(['pg', +(+p.x).toFixed(3), +(+p.z).toFixed(3), +(+p.width||0).toFixed(3), +(+p.depth||0).toFixed(3), +(+p.rotation||0).toFixed(3)]);
      }
    } catch(e){}
    try {
      var gars = Array.isArray(window.garageComponents) ? garageComponents : [];
      for (var gg=0; gg<gars.length; gg++){
        var g = gars[gg]; if(!g) continue; if((g.level||0)!==lvlNow) continue;
        parts.push(['ga', +(+g.x).toFixed(3), +(+g.z).toFixed(3), +(+g.width||0).toFixed(3), +(+g.depth||0).toFixed(3), +(+g.rotation||0).toFixed(3)]);
      }
    } catch(e){}
    try {
      var bls = Array.isArray(window.balconyComponents) ? balconyComponents : [];
      for (var bi=0; bi<bls.length; bi++){
        var b = bls[bi]; if(!b) continue; if((b.level||0)!==lvlNow) continue;
        parts.push(['ba', +(+b.x).toFixed(3), +(+b.z).toFixed(3), +(+b.width||0).toFixed(3), +(+b.depth||0).toFixed(3), +(+b.rotation||0).toFixed(3)]);
      }
    } catch(e){}
    try {
      var pls = Array.isArray(window.poolComponents) ? poolComponents : [];
      for (var pi=0; pi<pls.length; pi++){
        var pl = pls[pi]; if(!pl) continue; if((pl.level||0)!==lvlNow) continue;
        parts.push(['po', +(+pl.x).toFixed(3), +(+pl.z).toFixed(3), +(+pl.width||0).toFixed(3), +(+pl.depth||0).toFixed(3), +(+pl.rotation||0).toFixed(3)]);
      }
    } catch(e){}
    try {
      var rfs = Array.isArray(window.roofComponents) ? roofComponents : [];
      for (var ri=0; ri<rfs.length; ri++){
        var rf = rfs[ri]; if(!rf) continue; if((rf.level||0)!==lvlNow) continue;
        parts.push(['ro', +(+rf.x).toFixed(3), +(+rf.z).toFixed(3), +(+rf.width||0).toFixed(3), +(+rf.depth||0).toFixed(3), +(+rf.rotation||0).toFixed(3), String(rf.roofType||'') ]);
      }
    } catch(e){}
    return JSON.stringify(parts);
  }catch(e){ return ''; }
}
function plan2dSig2D(){
  try{
    var elems=__plan2d.elements||[]; var parts=[];
    for(var i=0;i<elems.length;i++){
      var e=elems[i]; if(!e) continue;
      if(e.type==='wall') parts.push(['w', +e.x0.toFixed(3), +e.y0.toFixed(3), +e.x1.toFixed(3), +e.y1.toFixed(3)]);
      else if(e.type==='window'||e.type==='door'){
        if(typeof e.host==='number') parts.push([e.type==='window'?'win':'door','h', e.host, +(e.t0||0).toFixed(4), +(e.t1||0).toFixed(4)]);
        else parts.push([e.type==='window'?'win':'door', +e.x0.toFixed(3), +e.y0.toFixed(3), +e.x1.toFixed(3), +e.y1.toFixed(3)]);
      }
    }
    return JSON.stringify(parts);
  }catch(e){ return ''; }
}
function plan2dSigWallsOnly(){
  try{
    var elems=__plan2d.elements||[]; var parts=[];
    for(var i=0;i<elems.length;i++){
      var e=elems[i]; if(!e || e.type!=='wall') continue;
      // normalize orientation so signature is order-invariant
      var x0=e.x0, y0=e.y0, x1=e.x1, y1=e.y1;
      var aMinX=Math.min(x0,x1), aMaxX=Math.max(x0,x1);
      var aMinY=Math.min(y0,y1), aMaxY=Math.max(y0,y1);
      parts.push([ +aMinX.toFixed(3), +aMinY.toFixed(3), +aMaxX.toFixed(3), +aMaxY.toFixed(3), +(e.thickness||__plan2d.wallThicknessM||0.3).toFixed(3) ]);
    }
    // sort for stable signature regardless of element array order
    parts.sort(function(A,B){ for(var k=0;k<A.length;k++){ if(A[k]!==B[k]) return A[k]-B[k]; } return 0; });
    return JSON.stringify(parts);
  }catch(e){ return ''; }
}
function plan2dGetElementsSnapshot(){
  var snap = (__plan2d.elements||[]).slice();
  // Include a synthetic preview wall while dragging so 3D updates live
  if(__plan2d.start && __plan2d.last && __plan2d.tool==='wall'){
    var a = __plan2d.start, b = __plan2d.last;
    var dx=b.x-a.x, dy=b.y-a.y; if(Math.abs(dx)>Math.abs(dy)) b={x:b.x,y:a.y}; else b={x:a.x,y:b.y};
    snap.push({type:'wall', x0:a.x, y0:a.y, x1:b.x, y1:b.y, thickness: __plan2d.wallThicknessM});
  }
  return snap;
}
function plan2dScheduleApply(now){
  if(__plan2d._applyTimer){ clearTimeout(__plan2d._applyTimer); __plan2d._applyTimer=null; }
  // Live updates: apply as wall strips only (no rooms) to avoid creating extra rooms while drawing
  var run=function(){
    try{
      __plan2d.syncInProgress=true;
      // Apply live edits level-aware
      var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
      // If walls are unchanged, we can safely rebuild rooms+openings to reflect door/window edits in 3D
      var wallsSigNow = plan2dSigWallsOnly();
      if(wallsSigNow && __plan2d._lastWallsSig && wallsSigNow === __plan2d._lastWallsSig){
        // Walls unchanged -> we are applying opening-only edits. Freeze 2D center/scale briefly
        // so the canvas doesn't re-center/zoom slightly due to quantization while rooms are rebuilt.
        try { __plan2d.freezeCenterScaleUntil = Date.now() + 1000; } catch(e){}
        // Walls unchanged -> safe to rebuild rooms/openings only
        applyPlan2DTo3D(undefined, { allowRooms:true, quiet:true, level: lvl });
      } else {
        // Walls changed: apply live as strips or rooms (if rectangles are closed) to keep 2D and 3D in sync
        // Also freeze 2D center/scale briefly to prevent noticeable jumps during/after wall edits
        try { __plan2d.freezeCenterScaleUntil = Date.now() + 1000; } catch(e){}
        applyPlan2DTo3D(undefined, { allowRooms:true, quiet:true, level: lvl });
      }
      __plan2d._lastWallsSig = wallsSigNow;
      __plan2d._last3Dsig = plan2dSig3D(); __plan2d._last2Dsig = plan2dSig2D();
      // Autosave per-floor draft so changes (including deletes) persist across reloads
      try { plan2dSaveDraft(lvl); } catch(e){}
    } finally { setTimeout(function(){ __plan2d.syncInProgress=false; }, 30); }
  };
  if(now){ run(); } else { __plan2d._applyTimer = setTimeout(run, 150); }
}
// Helper: set current selection index and keep a stable object reference
function plan2dSetSelection(idx){
  try{
    __plan2d.selectedIndex = (typeof idx==='number' ? idx : -1);
    __plan2d.selectedRef = (__plan2d.selectedIndex>=0 && Array.isArray(__plan2d.elements)) ? __plan2d.elements[__plan2d.selectedIndex] : null;
    // Capture a snapshot of selection geometry so we can re-identify on array rebuild
    (function(){
      var snap=null; var els=__plan2d.elements||[]; var e=(__plan2d.selectedIndex>=0? els[__plan2d.selectedIndex] : null);
      if(e){
        if(e.type==='wall'){
          snap={type:'wall', x0:e.x0, y0:e.y0, x1:e.x1, y1:e.y1, thickness:(e.thickness||__plan2d.wallThicknessM)};
        } else if(e.type==='window' || e.type==='door'){
          if(typeof e.host==='number') snap={type:e.type, host:e.host, t0:(e.t0||0), t1:(e.t1||0)};
          else snap={type:e.type, x0:e.x0, y0:e.y0, x1:e.x1, y1:e.y1};
        }
      }
      __plan2d.selectedSnapshot = snap;
    })();
    // Give the user a short grace period to hit Delete without the sync loop clearing selection
    __plan2d.freezeSyncUntil = Date.now() + 900; // ~0.9s
  }catch(e){ __plan2d.selectedIndex = (typeof idx==='number'? idx : -1); __plan2d.selectedRef = null; }
}

// Find element index by matching a stored geometry snapshot (with tolerance)
function plan2dFindElementIndexFromSnapshot(snap){
  try{
    if(!snap) return -1; var els = __plan2d.elements||[];
    var tol = 1e-4; // meters
    function eq(a,b){ return Math.abs((a||0)-(b||0)) <= tol; }
    if(snap.type==='wall'){
      for(var i=0;i<els.length;i++){
        var e=els[i]; if(!e||e.type!=='wall') continue;
        // Match either orientation (endpoints swapped)
        var m1 = eq(e.x0,snap.x0)&&eq(e.y0,snap.y0)&&eq(e.x1,snap.x1)&&eq(e.y1,snap.y1);
        var m2 = eq(e.x0,snap.x1)&&eq(e.y0,snap.y1)&&eq(e.x1,snap.x0)&&eq(e.y1,snap.y0);
        if(m1||m2) return i;
      }
    } else if(snap.type==='window' || snap.type==='door'){
      for(var j=0;j<els.length;j++){
        var d=els[j]; if(!d || d.type!==snap.type) continue;
        if(typeof snap.host==='number' && typeof d.host==='number'){
          // consider same host and similar params
          if(d.host===snap.host){
            if(eq((d.t0||0),(snap.t0||0)) && eq((d.t1||0),(snap.t1||0))) return j;
          }
        } else if(typeof snap.x0==='number'){
          if(eq(d.x0,snap.x0)&&eq(d.y0,snap.y0)&&eq(d.x1,snap.x1)&&eq(d.y1,snap.y1)) return j;
        }
      }
    }
  }catch(e){}
  return -1;
}
function plan2dStartSyncLoop(){
  if(__plan2d._syncTimer) return;
  __plan2d._last3Dsig = plan2dSig3D();
  __plan2d._last2Dsig = plan2dSig2D();
  __plan2d._lastWallsSig = plan2dSigWallsOnly();
  __plan2d._syncTimer = setInterval(function(){
    if(!__plan2d.active) return;
    if(__plan2d.syncInProgress) return;
    // Briefly pause repopulate right after selection so Delete can act on the selected element
    if(__plan2d.freezeSyncUntil && Date.now() < __plan2d.freezeSyncUntil) return;
    // don't overwrite while user is actively dragging in 2D
    if(__plan2d.start || __plan2d.dragWindow || __plan2d.dragDoor || __plan2d.dragDoorWhole || __plan2d.dragWall || __plan2d.chainActive) return;
    var sig = plan2dSig3D();
    if(sig && sig !== __plan2d._last3Dsig){
      try{ if(populatePlan2DFromDesign()){ plan2dDraw(); } }catch(e){}
  // Clear any stale selection, as the elements list was rebuilt from 3D
  __plan2d.selectedIndex = -1; __plan2d.selectedRef = null; __plan2d.selectedSnapshot = null; __plan2d.selectedSubsegment = null;
      __plan2d._last3Dsig = sig; __plan2d._last2Dsig = plan2dSig2D();
    }
  }, 250);
}
function plan2dStopSyncLoop(){ if(__plan2d._syncTimer){ clearInterval(__plan2d._syncTimer); __plan2d._syncTimer=null; } }
function plan2dEdited(){ plan2dScheduleApply(false); }

function openPlan2DModal(){
  var m=document.getElementById('plan2d-modal'); if(!m) return;
  m.style.display='block';
  __plan2d.active=true;
  // Clear any 3D selection to avoid Delete key acting on 3D while in 2D editor
  try { selectedRoomId = null; } catch(e) {}
  // Sync floor toggle and native level selector to the current 3D floor
  try {
    var bG = document.getElementById('plan2d-floor-ground');
    var bF = document.getElementById('plan2d-floor-first');
    if (bG && bF){
      if ((typeof currentFloor==='number'? currentFloor : 0) === 0){ bG.classList.add('active'); bF.classList.remove('active'); }
      else { bF.classList.add('active'); bG.classList.remove('active'); }
    }
    var nativeSel = document.getElementById('levelSelect');
    if (nativeSel){ nativeSel.value = String(typeof currentFloor==='number' ? currentFloor : 0); }
  } catch(e) {}
  plan2dBind();
  plan2dResize();
  // Bind 2D floor toggle buttons: apply current floor then switch and load the new floor
  try {
    var bGround = document.getElementById('plan2d-floor-ground');
    var bFirst = document.getElementById('plan2d-floor-first');
    if (bGround && !bGround.__bound2d) {
      bGround.__bound2d = true;
      bGround.addEventListener('click', function(){ plan2dSwitchFloorInEditor(0); });
    }
    if (bFirst && !bFirst.__bound2d) {
      bFirst.__bound2d = true;
      bFirst.addEventListener('click', function(){ plan2dSwitchFloorInEditor(1); });
    }
  } catch(e){}
  // Load existing draft for this floor if available; otherwise populate from current 3D
  try {
    var lvlOpen = (typeof currentFloor==='number' ? currentFloor : 0);
    var loaded = plan2dLoadDraft(lvlOpen);
    var currentSig3D = plan2dSig3D();
    // If no draft, or draft's last3Dsig differs from current 3D, repopulate from 3D to ensure sync
    var needsPopulate = (!loaded) || (!__plan2d._last3Dsig) || (__plan2d._last3Dsig !== currentSig3D);
    // Additionally, if a draft loaded but contains no elements while 3D has content, force populate
    try {
      var draftEmpty = !Array.isArray(__plan2d.elements) || __plan2d.elements.length === 0;
      if (!needsPopulate && draftEmpty) {
        var parts = [];
        try { parts = JSON.parse(currentSig3D)||[]; } catch(_e) { parts = []; }
        if (Array.isArray(parts) && parts.length > 0) needsPopulate = true;
        // If parsing failed, err on side of repopulating to avoid empty UI
        if (!Array.isArray(parts)) needsPopulate = true;
      }
    } catch(_e) {}
    if (needsPopulate) {
      populatePlan2DFromDesign();
      __plan2d._last3Dsig = plan2dSig3D();
      __plan2d._last2Dsig = plan2dSig2D();
      __plan2d._lastWallsSig = plan2dSigWallsOnly();
    }
  } catch(e) { console.warn('populatePlan2DFromDesign/loadDraft failed', e); }
  plan2dDraw();
  updatePlan2DInfo();
  // If nothing was populated for the current floor but other floors have content, auto-switch
  try {
    var hasElems = Array.isArray(__plan2d.elements) && __plan2d.elements.length > 0;
    if (!hasElems) {
      function floorHasContent(level){
        try {
          // Rooms
          for (var i=0;i<(allRooms||[]).length;i++){ var r=allRooms[i]; if(r && (r.level||0)===level) return true; }
          // Strips
          for (var j=0;j<(wallStrips||[]).length;j++){ var ws=wallStrips[j]; if(ws && (ws.level||0)===level) return true; }
          // Components
          function any(arr, field){ for (var k=0;k<(arr||[]).length;k++){ var o=arr[k]; if(o && ((o.level!=null?o.level:0)===level)) return true; } return false; }
          if (any(pergolaComponents, 'level')) return true;
          if (any(garageComponents, 'level')) return true;
          if (any(balconyComponents, 'level')) return true;
          if (any(poolComponents, 'level')) return true;
          if (any(roofComponents, 'level')) return true;
        } catch(e) {}
        return false;
      }
      var curLvl = (typeof currentFloor==='number'? currentFloor : 0);
      var otherLvl = (curLvl===0? 1 : 0);
      if (!floorHasContent(curLvl) && floorHasContent(otherLvl)){
        // Switch to the level that actually has content so the user sees something
        currentFloor = otherLvl;
        try { var nativeSel2=document.getElementById('levelSelect'); if(nativeSel2) nativeSel2.value=String(currentFloor); } catch(e){}
        try {
          var bG2 = document.getElementById('plan2d-floor-ground');
          var bF2 = document.getElementById('plan2d-floor-first');
          if (bG2 && bF2){ if(currentFloor===0){ bG2.classList.add('active'); bF2.classList.remove('active'); } else { bF2.classList.add('active'); bG2.classList.remove('active'); } }
        } catch(e){}
        try { populatePlan2DFromDesign(); plan2dDraw(); updatePlan2DInfo(); } catch(e){}
        try { updateStatus && updateStatus('Showing floor with content'); } catch(e){}
      }
    }
  } catch(e){}
  // start live sync with 3D
  try{ plan2dStartSyncLoop(); }catch(e){}
}
function closePlan2DModal(){
  var m=document.getElementById('plan2d-modal'); if(m) m.style.display='none';
  try { if (__plan2d && __plan2d.active) { var lvlClose=(typeof currentFloor==='number'? currentFloor : 0); applyPlan2DTo3D(undefined, { allowRooms:true, quiet:true, level: lvlClose }); plan2dSaveDraft(lvlClose); } } catch(e){}
  __plan2d.active=false;
  plan2dUnbind();
  try{ plan2dStopSyncLoop(); }catch(e){}
}

// Apply current floor and switch floors inside the 2D editor, keeping 3D in sync
function plan2dSwitchFloorInEditor(newLevel){
  try {
    var lvlNow = (typeof currentFloor==='number' ? currentFloor : 0);
    // Apply current floor to 3D before switching
    applyPlan2DTo3D(undefined, { allowRooms:true, quiet:true, level: lvlNow });
    plan2dSaveDraft(lvlNow);
  } catch(e){}
  // Change floor globally so labels/rooms update
  currentFloor = (newLevel===1 ? 1 : 0);
  try { var nativeSel=document.getElementById('levelSelect'); if(nativeSel) nativeSel.value=String(currentFloor); } catch(e){}
  // Update toggle button states
  try {
    var bG = document.getElementById('plan2d-floor-ground');
    var bF = document.getElementById('plan2d-floor-first');
    if (bG && bF){ if(currentFloor===0){ bG.classList.add('active'); bF.classList.remove('active'); } else { bF.classList.add('active'); bG.classList.remove('active'); } }
  } catch(e){}
  // Load draft for new floor or populate from 3D and redraw
  try { if (!plan2dLoadDraft(currentFloor)) { populatePlan2DFromDesign(); } } catch(e){}
  try { plan2dDraw(); updatePlan2DInfo(); } catch(e){}
}

// Screen mapping: X right = +X (world), Y up = +Y in plan space. World Z maps to plan Y with a configurable sign.
function worldToScreen2D(wx,wy){ var c=document.getElementById('plan2d-canvas'); if(!c)return {x:0,y:0}; return { x:c.width/2 + wx*__plan2d.scale, y:c.height/2 - wy*__plan2d.scale }; }
function screenToWorld2D(px,py){ var c=document.getElementById('plan2d-canvas'); if(!c)return {x:0,y:0}; return { x:(px - c.width/2)/__plan2d.scale, y:(c.height/2 - py)/__plan2d.scale }; }

function plan2dBind(){
  // Ensure key events reach the editor reliably
  try { var content=document.getElementById('plan2d-content'); if(content){ if(!content.hasAttribute('tabindex')) content.setAttribute('tabindex','0'); content.focus({preventScroll:true}); } } catch(e) {}
  var c=document.getElementById('plan2d-canvas'); var ov=document.getElementById('plan2d-overlay'); if(!c||!ov) return;
  if(!window.__plan2dResize){
    window.__plan2dResize=function(){ if(__plan2d.active){ plan2dResize(); plan2dDraw(); } };
    window.addEventListener('resize', window.__plan2dResize);
  }
  // Tool buttons
  var bWall=document.getElementById('plan2d-tool-wall'); if(bWall) bWall.onclick=function(){ __plan2d.tool='wall'; plan2dCursor(); };
  var bWin=document.getElementById('plan2d-tool-window'); if(bWin) bWin.onclick=function(){ __plan2d.tool='window'; plan2dCursor(); updateStatus('Window tool: click a wall to place a window, then drag the endpoints to size it.'); };
  var bDoor=document.getElementById('plan2d-tool-door'); if(bDoor) bDoor.onclick=function(){ __plan2d.tool='door'; plan2dCursor(); };
  var bSel=document.getElementById('plan2d-tool-select'); if(bSel) bSel.onclick=function(){ __plan2d.tool='select'; plan2dCursor(); };
  var bErase=document.getElementById('plan2d-tool-erase'); if(bErase) bErase.onclick=function(){ __plan2d.tool='erase'; plan2dCursor(); };
  var bClear=document.getElementById('plan2d-clear'); if(bClear) bClear.onclick=function(){ if(confirm('Clear all elements?')) { __plan2d.elements=[]; __plan2d.selectedIndex=-1; __plan2d.selectedRef=null; __plan2d.selectedSnapshot=null; __plan2d.selectedSubsegment=null; plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); } };
  var bClose=document.getElementById('plan2d-close'); if(bClose) bClose.onclick=closePlan2DModal;
  var bExp=document.getElementById('plan2d-export'); if(bExp) bExp.onclick=plan2dExport;
  var bImp=document.getElementById('plan2d-import'); if(bImp) bImp.onclick=function(){ var f=document.getElementById('plan2d-import-file'); if(f) f.click(); };
  var fi=document.getElementById('plan2d-import-file'); if(fi) fi.onchange=function(e){ var f=e.target.files&&e.target.files[0]; if(!f)return; var r=new FileReader(); r.onload=function(){ try{ var arr=JSON.parse(r.result); if(Array.isArray(arr)){ __plan2d.elements=arr; __plan2d.selectedIndex=-1; __plan2d.selectedRef=null; __plan2d.selectedSnapshot=null; __plan2d.selectedSubsegment=null; plan2dDraw(); updatePlan2DInfo(); updateStatus('2D plan imported'); plan2dEdited(); } }catch(err){ updateStatus('Import failed'); } }; r.readAsText(f); fi.value=''; };
  var bApply3D=document.getElementById('plan2d-apply-3d'); if(bApply3D) bApply3D.onclick=function(){ try{
    var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
    applyPlan2DTo3D(undefined, { allowRooms:true, quiet:false, level: lvl });
  }catch(e){} };
  // Central deletion used by both keyboard and button; supports subsegment, selection, or hovered element
  function plan2dDeleteSelection(){
    if(!__plan2d.active) return false;
    // 1) Prefer wall subsegment if selected
    if(__plan2d.selectedSubsegment){
      if(plan2dDeleteSelectedSubsegment()){
  __plan2d.selectedSubsegment=null; __plan2d.selectedIndex=-1; __plan2d.selectedRef=null;
        plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); return true;
      }
    }
    // 2) Next: delete current explicit selection (door/window/wall)
    if(__plan2d.selectedIndex>=0){
      // Resolve current index using stable object reference if available
      var delIdx = __plan2d.selectedIndex; var didDel=false;
      try{
        if(__plan2d.selectedRef){
          var idxNow = __plan2d.elements.indexOf(__plan2d.selectedRef);
          if(idxNow >= 0) delIdx = idxNow;
          else if (delIdx>=__plan2d.elements.length || __plan2d.elements[delIdx]!==__plan2d.selectedRef){ delIdx = -1; }
        }
      }catch(e){}
      // If reference lookup failed, try geometry snapshot matching
      if(delIdx<0 && __plan2d.selectedSnapshot){
        var idxSnap = plan2dFindElementIndexFromSnapshot(__plan2d.selectedSnapshot);
        if(idxSnap>=0) delIdx = idxSnap;
      }
      if(delIdx>=0){ __plan2d.elements.splice(delIdx,1); didDel=true; }
      if(didDel){
        __plan2d.selectedIndex=-1; __plan2d.selectedRef=null; __plan2d.selectedSnapshot=null; __plan2d.selectedSubsegment=null;
        plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); return true;
      }
      // If we could not resolve the element (stale ref/index), fall through to hover-based deletion
    }
    // 3) If nothing explicitly selected, delete hovered door/window or hovered wall subsegment (quick delete)
    if(typeof __plan2d.hoverWindowIndex==='number' && __plan2d.hoverWindowIndex>=0){
      __plan2d.elements.splice(__plan2d.hoverWindowIndex,1);
  __plan2d.hoverWindowIndex = -1; __plan2d.selectedIndex=-1; __plan2d.selectedRef=null; __plan2d.selectedSnapshot=null; __plan2d.selectedSubsegment=null;
      plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); return true;
    }
    if(typeof __plan2d.hoverDoorIndex==='number' && __plan2d.hoverDoorIndex>=0){
      __plan2d.elements.splice(__plan2d.hoverDoorIndex,1);
  __plan2d.hoverDoorIndex = -1; __plan2d.selectedIndex=-1; __plan2d.selectedRef=null; __plan2d.selectedSnapshot=null; __plan2d.selectedSubsegment=null;
      plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); return true;
    }
    if(__plan2d.hoverSubsegment){
      // Promote hover subsegment to selected and delete via the same routine
      __plan2d.selectedSubsegment = __plan2d.hoverSubsegment;
      if(plan2dDeleteSelectedSubsegment()){
  __plan2d.selectedSubsegment = null; __plan2d.selectedIndex = -1; __plan2d.selectedRef = null; __plan2d.selectedSnapshot = null;
        plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); return true;
      }
    }
    // Else: nothing selected; do nothing
    updateStatus && updateStatus('Select a door, window, or wall segment first');
    return false;
  }
  // Hook Delete Selected button to shared deletion
  var bDelSel=document.getElementById('plan2d-delete-selected'); if(bDelSel) bDelSel.onclick=function(){ plan2dDeleteSelection(); };
  if(!c.__plan2dBound){
    c.__plan2dBound=true;
    c.addEventListener('mousedown', function(e){
      if(!__plan2d.active) return;
      var rect=c.getBoundingClientRect();
      var p=screenToWorld2D((e.clientX-rect.left)*(c.width/rect.width),(e.clientY-rect.top)*(c.height/rect.height));
      // marker drag removed
      if(__plan2d.tool==='erase'){ plan2dEraseAt(p); return; }
      // Multi-point wall chain: Shift-click to start/add points; finish with double-click or Enter; Esc to cancel
      if(__plan2d.tool==='wall' && (e.shiftKey || __plan2d.chainActive===true)){
        __plan2d.chainActive = true;
        if(!Array.isArray(__plan2d.chainPoints)) __plan2d.chainPoints = [];
        var pt = plan2dSnapPoint(p);
        if(__plan2d.chainPoints.length===0){
          __plan2d.chainPoints.push(pt);
        } else {
          // If near first point, close and finalize
          var p0 = __plan2d.chainPoints[0];
          if(Math.hypot(pt.x - p0.x, pt.y - p0.y) <= 0.1){
            __plan2d.chainPoints.push({x:p0.x, y:p0.y});
            plan2dFinalizeChain();
            return;
          }
          __plan2d.chainPoints.push(pt);
        }
        plan2dDraw();
        return;
      }
      if(__plan2d.tool==='select'){
        // Track click position for click-vs-drag detection in plan units
        __plan2d.mouseDownPosPlan = { x: p.x, y: p.y };
        __plan2d.pendingSelectIndex = null;
        __plan2d.maybeDragDoorWhole = null;

        // If a window is selected, allow grabbing endpoints to drag (supports host-anchored windows)
        var hit = plan2dHitWindowEndpoint(p, 0.15);
        if(hit){ __plan2d.dragWindow = hit; return; }
        // If a door is near, allow grabbing door endpoints
        var hitD = plan2dHitDoorEndpoint(p, 0.15);
        if(hitD){ __plan2d.dragDoor = hitD; return; }
        // Walls: grab an endpoint for resizing
        var hitWEnd = plan2dHitWallEndpoint(p, 0.18);
        if(hitWEnd){
          var w = __plan2d.elements[hitWEnd.index];
          if(w && w.type==='wall'){
            // Select the wall so both endpoint handles are visible and allow repeated adjustments
            plan2dSetSelection(hitWEnd.index); __plan2d.selectedSubsegment = null;
            var horiz = Math.abs(w.y1 - w.y0) <= 1e-6;
            __plan2d.dragWall = { index: hitWEnd.index, end: hitWEnd.end, orient: horiz ? 'h' : 'v', other: (hitWEnd.end==='a'? {x:w.x1,y:w.y1}:{x:w.x0,y:w.y0}) };
            plan2dDraw();
            return;
          }
        }
        // Prefer door/window segment selection before wall subsegment
        var selDoor = plan2dHitDoorSegment(p, 0.18);
        if(selDoor && typeof selDoor.index==='number'){
          // Set up click-to-select; escalate to drag on move
          var de0 = __plan2d.elements[selDoor.index];
          if(de0 && de0.type==='door' && typeof de0.host==='number'){
            // Clear any previously selected wall subsegment when selecting a door
            __plan2d.selectedSubsegment = null;
            __plan2d.pendingSelectIndex = selDoor.index;
            plan2dSetSelection(selDoor.index); // reflect selection immediately
            plan2dDraw();
            __plan2d.maybeDragDoorWhole = {
              index: selDoor.index,
              startMouseT: plan2dProjectParamOnWall(p, __plan2d.elements[de0.host]),
              startT0: de0.t0 || 0,
              startT1: de0.t1 || 0,
              host: de0.host
            };
            return;
          }
        }
        var selWin = plan2dHitWindowSegment(p, 0.18);
        if(selWin && typeof selWin.index==='number'){
          // Clear any previously selected wall subsegment when selecting a window
          __plan2d.selectedSubsegment = null;
          __plan2d.pendingSelectIndex = selWin.index;
          plan2dSetSelection(selWin.index); // reflect selection immediately
          plan2dDraw();
          return;
        }
        // If user clicks a wall centerline: prefer selecting the wall for endpoint editing.
        // Hold Alt/Ctrl to select a subsegment instead (for precise deletes).
        var segHit = plan2dHitWallSubsegment(p, 0.15);
        if(segHit){
          if(e.altKey || e.ctrlKey || e.metaKey){
            plan2dSetSelection(-1);
            __plan2d.selectedSubsegment = segHit;
          } else {
            plan2dSetSelection(segHit.wallIndex);
            __plan2d.selectedSubsegment = null;
          }
          plan2dDraw();
          return;
        }
        // Clear subsegment selection when selecting regular elements
        __plan2d.selectedSubsegment = null;
        plan2dSelectAt(p); return; }
      if(__plan2d.tool==='door'){
        // Place a standard door onto a selected wall or nearest wall under cursor
        var hostIdx = -1;
        if(__plan2d.selectedIndex>=0 && __plan2d.elements[__plan2d.selectedIndex] && __plan2d.elements[__plan2d.selectedIndex].type==='wall'){
          hostIdx = __plan2d.selectedIndex;
        } else {
          var nearest = plan2dFindNearestWall(p, 0.25);
          if(nearest && typeof nearest.index==='number') hostIdx = nearest.index;
        }
        if(hostIdx>=0){
          var wall = __plan2d.elements[hostIdx];
          var t = plan2dProjectParamOnWall(p, wall);
          var wdx = wall.x1 - wall.x0, wdy = wall.y1 - wall.y0; var wLen = Math.hypot(wdx, wdy) || 1;
          var halfT = (__plan2d.doorWidthM/2) / wLen;
          var t0 = t - halfT, t1 = t + halfT;
          // Shift to fit entirely on wall
          if(t0 < 0){ t1 -= t0; t0 = 0; }
          if(t1 > 1){ var over = t1 - 1; t0 -= over; t1 = 1; }
          t0 = Math.max(0, Math.min(1, t0));
          t1 = Math.max(0, Math.min(1, t1));
          // Ensure ordering
          if(t0 > t1){ var tmp=t0; t0=t1; t1=tmp; }
          var door = { type:'door', host:hostIdx, t0:t0, t1:t1, widthM: __plan2d.doorWidthM, heightM: __plan2d.doorHeightM, thickness: wall.thickness || __plan2d.wallThicknessM, meta:{ hinge:'t0', swing:'in' } };
          __plan2d.elements.push(door);
          plan2dSetSelection(__plan2d.elements.length - 1);
          plan2dDraw(); updatePlan2DInfo(); plan2dEdited();
          return;
        } else {
          updateStatus('Click near a wall to place a door');
        }
      }
      if(__plan2d.tool==='window'){
        // Try to grab an existing window endpoint
        var hitW = plan2dHitWindowEndpoint(p, 0.15);
        if(hitW){ __plan2d.dragWindow = hitW; return; }
        // Prefer attaching to a wall: selected or nearest under cursor
        var sel = __plan2d.selectedIndex>=0 ? __plan2d.elements[__plan2d.selectedIndex] : null;
        var widx = -1;
        if(sel && sel.type==='wall') { widx = __plan2d.selectedIndex; }
        if(widx < 0){ var near = plan2dFindNearestWall(p, 0.25); if(near) widx = near.index; }
        if(widx >= 0){
          var hostW = __plan2d.elements[widx];
          var t = plan2dProjectParamOnWall(p, hostW);
          var win = { type:'window', host:widx, t0:t, t1:t, thickness: hostW.thickness || __plan2d.wallThicknessM };
          __plan2d.elements.push(win);
          plan2dSetSelection(__plan2d.elements.length - 1);
          __plan2d.dragWindow = { index: __plan2d.selectedIndex, end:'t1' };
          plan2dDraw();
          // No preview gap until user moves the mouse again
          __plan2d.mouse = null;
          plan2dEdited();
          return;
        }
        // Fallback: legacy free-draw if no wall nearby
      }
      if(__plan2d.tool==='door'){
        // Try to grab an existing door endpoint
        var dHit = plan2dHitDoorEndpoint(p, 0.15);
        if(dHit){ __plan2d.dragDoor = dHit; return; }
        // Or slide an existing anchored door by grabbing its segment
        var dSeg = plan2dHitDoorSegment(p, 0.12);
        if(dSeg && typeof dSeg.index==='number'){
          var de2 = __plan2d.elements[dSeg.index];
          if(de2 && de2.type==='door' && typeof de2.host==='number'){
            var host2 = __plan2d.elements[de2.host]; if(host2 && host2.type==='wall'){
              __plan2d.dragDoorWhole = {
                index: dSeg.index,
                startMouseT: plan2dProjectParamOnWall(p, host2),
                startT0: de2.t0 || 0,
                startT1: de2.t1 || 0,
                host: de2.host
              };
              return;
            }
          }
        }
      }
      __plan2d.start=p; __plan2d.last=p; plan2dDraw();
    });
    // Double-click finishes multi-point wall chain
    c.addEventListener('dblclick', function(e){
      if(!__plan2d.active) return;
      if(__plan2d.tool==='wall' && __plan2d.chainActive){
        plan2dFinalizeChain();
      }
    });
    c.addEventListener('mousemove', function(e){
      if(!__plan2d.active) return;
      var rect=c.getBoundingClientRect();
      var cx = (e.clientX-rect.left)*(c.width/rect.width);
      var cy = (e.clientY-rect.top)*(c.height/rect.height);
      __plan2d.mouse = { x: cx, y: cy };
      var p=screenToWorld2D(cx, cy);
      // Hover hints for select/erase
      __plan2d.hoverDoorIndex = -1; __plan2d.hoverWindowIndex = -1; __plan2d.hoverSubsegment = null;
      if(__plan2d.tool==='select' && !__plan2d.dragDoor && !__plan2d.dragDoorWhole && !__plan2d.dragWindow && !__plan2d.dragWall && !__plan2d.start){
        var hD = plan2dHitDoorSegment(p, 0.2); if(hD && typeof hD.index==='number') __plan2d.hoverDoorIndex = hD.index;
        var hW = plan2dHitWindowSegment(p, 0.2); if(hW && typeof hW.index==='number') __plan2d.hoverWindowIndex = hW.index;
        if(__plan2d.hoverDoorIndex<0 && __plan2d.hoverWindowIndex<0){ __plan2d.hoverSubsegment = plan2dHitWallSubsegment(p, 0.2); }
        // Hover endpoint on walls for better affordance
        __plan2d.hoverWallEnd = plan2dHitWallEndpoint(p, 0.18) || null;
        // Cursor hint: grab when near a wall endpoint
        try { if(__plan2d.hoverWallEnd){ c.style.cursor='grab'; } else { c.style.cursor='pointer'; } } catch(_){}
      }
      // If we had a pending door selection for click, but user moved beyond threshold, escalate to dragDoorWhole
      if(__plan2d.maybeDragDoorWhole && __plan2d.mouseDownPosPlan){
        var md = __plan2d.mouseDownPosPlan; var moveDist = Math.hypot((p.x - md.x), (p.y - md.y));
        if(moveDist > 0.02){ // ~2cm
          __plan2d.dragDoorWhole = __plan2d.maybeDragDoorWhole; __plan2d.maybeDragDoorWhole = null; __plan2d.pendingSelectIndex = null;
        }
      }
      // marker drag removed
  if(__plan2d.dragWindow){
        var dw = __plan2d.dragWindow; var we = __plan2d.elements[dw.index];
        if(we && we.type==='window' && typeof we.host==='number'){
          var host = __plan2d.elements[we.host];
          if(host && host.type==='wall'){
            var t = plan2dProjectParamOnWall(p, host);
            if(dw.end==='t0') we.t0 = t; else we.t1 = t;
            plan2dDraw();
            plan2dEdited();
          }
        }
  } else if(__plan2d.dragDoor){
        var dd = __plan2d.dragDoor; var de = __plan2d.elements[dd.index];
        if(de && de.type==='door'){
          if(typeof de.host==='number'){
            var dhost = __plan2d.elements[de.host];
            if(dhost && dhost.type==='wall'){
              var t = plan2dProjectParamOnWall(p, dhost);
              if(dd.end==='t0') de.t0 = t; else if(dd.end==='t1') de.t1 = t;
              plan2dDraw();
              plan2dEdited();
            }
          } else {
            // Free door: move endpoint directly
            if(dd.end==='a'){ de.x0 = p.x; de.y0 = p.y; }
            if(dd.end==='b'){ de.x1 = p.x; de.y1 = p.y; }
            plan2dDraw(); plan2dEdited();
          }
        }
  } else if(__plan2d.dragDoorWhole){
        var dh = __plan2d.dragDoorWhole; var deh = __plan2d.elements[dh.index];
        var hosth = __plan2d.elements[dh.host];
        if(deh && hosth && hosth.type==='wall'){
          var tNow = plan2dProjectParamOnWall(p, hosth);
          var delta = (tNow - dh.startMouseT) || 0;
          var t0new = (dh.startT0 || 0) + delta;
          var t1new = (dh.startT1 || 0) + delta;
          // Preserve span and clamp to [0,1]
          var tmin = Math.min(t0new, t1new), tmax = Math.max(t0new, t1new);
          var span = Math.max(0, tmax - tmin);
          if(tmin < 0){ tmin = 0; tmax = span; }
          if(tmax > 1){ tmax = 1; tmin = 1 - span; }
          // Assign back preserving original ordering
          if((dh.startT0||0) <= (dh.startT1||0)) { deh.t0 = tmin; deh.t1 = tmax; }
          else { deh.t0 = tmax; deh.t1 = tmin; }
          plan2dDraw();
          plan2dDraw(); plan2dEdited();
        }
      } else if(__plan2d.dragWall){
        var dwl = __plan2d.dragWall; var w = __plan2d.elements[dwl.index]; if(w && w.type==='wall'){
          // Keep orientation axis-locked and snap to grid; join will be handled on mouseup
          if(dwl.end==='a'){
            if(dwl.orient==='h'){ w.x0 = plan2dSnap(p.x); w.y0 = w.y1 = plan2dSnap(w.y0); }
            else { w.y0 = plan2dSnap(p.y); w.x0 = w.x1 = plan2dSnap(w.x0); }
          } else {
            if(dwl.orient==='h'){ w.x1 = plan2dSnap(p.x); w.y1 = w.y0 = plan2dSnap(w.y1); }
            else { w.y1 = plan2dSnap(p.y); w.x1 = w.x0 = plan2dSnap(w.x1); }
          }
          plan2dDraw(); plan2dEdited();
        }
      } else if(__plan2d.start){ __plan2d.last=p; plan2dDraw(); plan2dEdited(); }
      else if(__plan2d.tool==='erase'){ plan2dHoverErase(p); }
    });
    window.addEventListener('mouseup', function(){
      if(!__plan2d.active) return;
      // Clear mouse to avoid lingering preview gaps for window/door after finishing interaction
      __plan2d.mouse = null;
  // marker drag removed
  if(__plan2d.dragWindow){ __plan2d.dragWindow=null; updatePlan2DInfo(); plan2dEdited(); }
    if(__plan2d.dragDoor){ __plan2d.dragDoor=null; updatePlan2DInfo(); plan2dEdited(); }
    if(__plan2d.dragDoorWhole){ __plan2d.dragDoorWhole=null; updatePlan2DInfo(); plan2dEdited(); }
      // If click without drag on door/window segment was pending, select it
      if(__plan2d.maybeDragDoorWhole && typeof __plan2d.pendingSelectIndex==='number'){
        plan2dSetSelection(__plan2d.pendingSelectIndex);
        __plan2d.pendingSelectIndex = null; __plan2d.maybeDragDoorWhole = null; plan2dDraw(); updatePlan2DInfo(); return;
      }
      if(typeof __plan2d.pendingSelectIndex==='number'){
        plan2dSetSelection(__plan2d.pendingSelectIndex);
        __plan2d.pendingSelectIndex = null; plan2dDraw(); updatePlan2DInfo(); return;
      }
  if(__plan2d.dragWall){ __plan2d.dragWall=null; plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); }
      else if(__plan2d.start && __plan2d.last){
        // If it was a short click (no real drag), treat as selection even if not in 'select' tool
        var dx = __plan2d.last.x - __plan2d.start.x, dy = __plan2d.last.y - __plan2d.start.y;
        var moved = Math.hypot(dx, dy);
        if(moved < 0.02){ // ~2cm in plan units
          __plan2d.selectedSubsegment = null; plan2dSelectAt(__plan2d.last);
        } else {
          var a=__plan2d.start, b=__plan2d.last; __plan2d.selectedSubsegment = null; plan2dFinalize(a,b); plan2dAutoSnapAndJoin(); updatePlan2DInfo(); plan2dEdited();
        }
      }
      __plan2d.start=null; __plan2d.last=null; plan2dDraw();
    });
    // Delete selected via keyboard (capture-phase to prevent global handlers)
    if(!window.__plan2dKeydown){
      window.__plan2dKeydown = function(ev){
        if(!__plan2d.active) return;
        var key = ev.key;
        // Finish/cancel multi-point wall chain
        if(__plan2d.tool==='wall' && __plan2d.chainActive){
          if(key==='Enter'){
            plan2dFinalizeChain(); ev.preventDefault(); ev.stopPropagation(); return;
          }
          if(key==='Escape'){
            __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); ev.preventDefault(); ev.stopPropagation(); return;
          }
        }
        if(key==='Delete' || key==='Backspace'){
          var did = plan2dDeleteSelection();
          ev.preventDefault(); ev.stopPropagation();
          return;
        }
        // Door hinge/swing toggles when a door is selected
        if(__plan2d.selectedIndex>=0){
          var selEl = __plan2d.elements[__plan2d.selectedIndex];
          if(selEl && selEl.type==='door'){
            selEl.meta = selEl.meta || { hinge:'t0', swing:'in' };
            if(key==='h' || key==='H'){
              selEl.meta.hinge = (selEl.meta.hinge==='t0' ? 't1' : 't0');
              plan2dDraw(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return;
            }
            if(key==='f' || key==='F'){
              selEl.meta.swing = (selEl.meta.swing==='in' ? 'out' : 'in');
              plan2dDraw(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return;
            }
          }
        }
        // Arrow keys nudge selected element(s) by gridStep
        var step = __plan2d.gridStep || 0.5;
        var dx=0, dy=0; if(key==='ArrowLeft') dx=-step; else if(key==='ArrowRight') dx=step; else if(key==='ArrowUp') dy=step; else if(key==='ArrowDown') dy=-step;
        if(dx!==0 || dy!==0){
          var moved=false; var els=__plan2d.elements||[];
          if(__plan2d.selectedIndex>=0){
            var e = els[__plan2d.selectedIndex];
            if(e){
              if(e.type==='wall'){
                e.x0=plan2dSnap(e.x0+dx); e.y0=plan2dSnap(e.y0+dy); e.x1=plan2dSnap(e.x1+dx); e.y1=plan2dSnap(e.y1+dy);
                moved=true;
              } else if(typeof e.host==='number'){
                // Nudge along wall direction
                var host=els[e.host]; if(host && host.type==='wall'){
                  var dirx=(host.x1-host.x0), diry=(host.y1-host.y0); var len=Math.hypot(dirx,diry)||1; dirx/=len; diry/=len;
                  // Project the dx,dy onto wall axis to get delta meters
                  var delta = (dx*dirx + dy*diry);
                  e.t0 = plan2dSnapTOnWall(host, (e.t0||0) + (delta/len));
                  e.t1 = plan2dSnapTOnWall(host, (e.t1||0) + (delta/len));
                  moved=true;
                }
              } else {
                e.x0=plan2dSnap((e.x0||0)+dx); e.y0=plan2dSnap((e.y0||0)+dy); e.x1=plan2dSnap((e.x1||0)+dx); e.y1=plan2dSnap((e.y1||0)+dy);
                moved=true;
              }
            }
          }
          if(moved){ plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return; }
        }
      };
      // Use capture=true so this runs before document-level handlers
      document.addEventListener('keydown', window.__plan2dKeydown, true);
    }
  }
  plan2dCursor();
}
function plan2dUnbind(){
  try{
    if(window.__plan2dResize){ window.removeEventListener('resize', window.__plan2dResize); }
    if(window.__plan2dKeydown){ document.removeEventListener('keydown', window.__plan2dKeydown, true); }
  }catch(e){}
  // Ensure handlers are re-attachable next time we open the 2D editor
  try { window.__plan2dResize = null; } catch(e){}
  try { window.__plan2dKeydown = null; } catch(e){}
}

function plan2dResize(){
  var c=document.getElementById('plan2d-canvas');
  var ov=document.getElementById('plan2d-overlay');
  var l2=document.getElementById('labels-2d');
  if(!c||!ov) return;
  var rect=c.getBoundingClientRect();
  var dpr=window.devicePixelRatio||1;
  var W=Math.floor(rect.width*dpr), H=Math.floor(rect.height*dpr);
  // Always ensure each canvas matches the device pixel size to avoid clipping text
  if(c.width!==W||c.height!==H){ c.width=W; c.height=H; }
  if(ov.width!==W||ov.height!==H){ ov.width=W; ov.height=H; }
  if(l2 && (l2.width!==W||l2.height!==H)){ l2.width=W; l2.height=H; }
}
function plan2dUpdateActiveButtons(){
  try {
    var ids=['plan2d-tool-wall','plan2d-tool-window','plan2d-tool-door','plan2d-tool-select','plan2d-tool-erase'];
    for(var i=0;i<ids.length;i++){ var el=document.getElementById(ids[i]); if(!el) continue; el.classList.remove('active'); }
    var map={ wall:'plan2d-tool-wall', window:'plan2d-tool-window', door:'plan2d-tool-door', select:'plan2d-tool-select', erase:'plan2d-tool-erase' };
    var id = map[__plan2d.tool]; var btn = id && document.getElementById(id); if(btn) btn.classList.add('active');
  } catch(e){}
}
function plan2dCursor(){
  var c=document.getElementById('plan2d-canvas'); if(!c) return;
  c.style.cursor = (__plan2d.tool==='erase') ? 'not-allowed' : (__plan2d.tool==='select' ? 'pointer' : 'crosshair');
  plan2dUpdateActiveButtons();
}

function plan2dFinalize(a,b){ if(!a||!b) return; // snap to straight axis
  var dx=b.x-a.x, dy=b.y-a.y; if(Math.abs(dx)>Math.abs(dy)) b.y=a.y; else b.x=a.x; var len=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2); if(len<0.05) return; if(__plan2d.tool==='wall'){ __plan2d.elements.push({type:'wall', x0:a.x,y0:a.y,x1:b.x,y1:b.y, thickness:__plan2d.wallThicknessM}); } else if(__plan2d.tool==='window'){ __plan2d.elements.push({type:'window', x0:a.x,y0:a.y,x1:b.x,y1:b.y, thickness:__plan2d.wallThicknessM}); } else if(__plan2d.tool==='door'){ __plan2d.elements.push({type:'door', x0:a.x,y0:a.y,x1:b.x,y1:b.y, thickness:0.9, meta:{hinge:'left'}}); } plan2dEdited(); }

// Finalize multi-point wall chain: create wall segments between consecutive points
function plan2dFinalizeChain(){
  try {
    var pts = Array.isArray(__plan2d.chainPoints) ? __plan2d.chainPoints : [];
    if(pts.length < 2){ __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); return; }
    for(var i=0;i<pts.length-1;i++){
      var a=pts[i], b=pts[i+1];
      var segLen = Math.hypot((b.x - a.x), (b.y - a.y));
      if(segLen < 0.05) continue; // skip tiny
      // Snap to axis like single-segment finalize
      var ax=a.x, ay=a.y, bx=b.x, by=b.y;
      if(Math.abs(bx-ax) > Math.abs(by-ay)) by = ay; else bx = ax;
      __plan2d.elements.push({ type:'wall', x0:ax, y0:ay, x1:bx, y1:by, thickness: __plan2d.wallThicknessM });
    }
    __plan2d.chainActive=false; __plan2d.chainPoints=[];
    plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited();
  } catch(e){ try{ console.warn('plan2dFinalizeChain failed', e); }catch(_){} }
}

function plan2dDraw(){ var c=document.getElementById('plan2d-canvas'); var ov=document.getElementById('plan2d-overlay'); if(!c||!ov) return; var ctx=c.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,c.width,c.height);
  // Grid (1m): increase contrast and draw center axes for better visibility
  var step=__plan2d.scale, w=c.width, h=c.height; 
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for(var x=w/2 % step; x<w; x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(var y=h/2 % step; y<h; y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  // Center axes (X/Y) a touch brighter
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  // Preview: multi-point wall chain (polyline) when active
  try {
    if(__plan2d.tool==='wall' && __plan2d.chainActive && Array.isArray(__plan2d.chainPoints) && __plan2d.chainPoints.length){
      var pts = __plan2d.chainPoints;
      // Draw existing segments
      ctx.save();
      ctx.strokeStyle = '#64748b'; // slate-500
      ctx.lineWidth = 2;
      for(var pi=0; pi<pts.length-1; pi++){
        var aP = worldToScreen2D(pts[pi].x, pts[pi].y);
        var bP = worldToScreen2D(pts[pi+1].x, pts[pi+1].y);
        ctx.beginPath(); ctx.moveTo(aP.x, aP.y); ctx.lineTo(bP.x, bP.y); ctx.stroke();
      }
      // Live segment to current mouse
      if(__plan2d.mouse && pts.length){
        var mW = screenToWorld2D(__plan2d.mouse.x, __plan2d.mouse.y);
        var mS = worldToScreen2D(plan2dSnap(mW.x), plan2dSnap(mW.y));
        var last = worldToScreen2D(pts[pts.length-1].x, pts[pts.length-1].y);
        ctx.setLineDash([6,4]); ctx.strokeStyle = '#0ea5e9'; // sky-600
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(mS.x, mS.y); ctx.stroke(); ctx.setLineDash([]);
      }
      // Vertex handles
      for(var pj=0; pj<pts.length; pj++){
        var pS = worldToScreen2D(pts[pj].x, pts[pj].y);
        ctx.beginPath(); ctx.fillStyle = '#f59e0b'; ctx.strokeStyle='rgba(15,23,42,0.8)'; ctx.lineWidth=2; // amber-500
        ctx.arc(pS.x, pS.y, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  } catch(e) { /* non-fatal chain preview */ }
  // Elements
  // Precompute connections at endpoints to extend walls and make corners flush
  var elems=__plan2d.elements;
  // Precompute wall intersections to enable sub-segment selection/deletion
  var __wallIntersections = plan2dComputeWallIntersections(elems);
  var startConn=new Array(elems.length).fill(false), endConn=new Array(elems.length).fill(false);
  (function(){
    function key(x,y){ return (Math.round(x*1000))+','+(Math.round(y*1000)); }
    var map={};
    for(var i=0;i<elems.length;i++){
      var e=elems[i]; if(e.type!=='wall') continue;
      var ks=key(e.x0,e.y0), ke=key(e.x1,e.y1);
      (map[ks]||(map[ks]=[])).push({i:i,end:'s'});
      (map[ke]||(map[ke]=[])).push({i:i,end:'e'});
    }
    Object.keys(map).forEach(function(k){ var arr=map[k]; if(arr.length>1){ for(var j=0;j<arr.length;j++){ if(arr[j].end==='s') startConn[arr[j].i]=true; else endConn[arr[j].i]=true; } } });
  })();
  for(var i=0;i<elems.length;i++){
    var el=elems[i];
    var ax=el.x0, ay=el.y0, bx=el.x1, by=el.y1;
    // Compute dynamic endpoints for host-anchored windows
    var isHostWindow = (el.type==='window' && typeof el.host==='number');
    if(isHostWindow){
      var host = elems[el.host];
      if(!host || host.type!=='wall'){ continue; }
      var hx0=host.x0, hy0=host.y0, hx1=host.x1, hy1=host.y1;
      var t0 = Math.max(0, Math.min(1, el.t0||0));
      var t1 = Math.max(0, Math.min(1, el.t1||0));
      ax = hx0 + (hx1-hx0)*t0; ay = hy0 + (hy1-hy0)*t0;
      bx = hx0 + (hx1-hx0)*t1; by = hy0 + (hy1-hy0)*t1;
    }
    if(el.type==='wall'){
      // Compute original endpoints and thickness
      var origAx = el.x0, origAy = el.y0, origBx = el.x1, origBy = el.y1;
      var wdx0 = origBx - origAx, wdy0 = origBy - origAy; var wLen0 = Math.hypot(wdx0, wdy0) || 1;
      var dirx = wdx0 / wLen0, diry = wdy0 / wLen0;
      var thick = (el.thickness||__plan2d.wallThicknessM);
      var halfW = thick/2;
      // Build void spans (windows and doors) in t-space [0,1]
      var spans = [];
      for(var wi=0; wi<elems.length; wi++){
        var oEl = elems[wi]; if(oEl.type!=='window' && oEl.type!=='door') continue;
        if(typeof oEl.host==='number' && oEl.host===i){
          var ot0 = Math.max(0, Math.min(1, oEl.t0||0));
          var ot1 = Math.max(0, Math.min(1, oEl.t1||0));
          if(ot1 < ot0){ var tmpo=ot0; ot0=ot1; ot1=tmpo; }
          spans.push([ot0, ot1]);
        } else {
          // Free opening: if it lies along this wall, treat as void
          var tA = plan2dProjectParamOnWall({x:oEl.x0, y:oEl.y0}, el);
          var tB = plan2dProjectParamOnWall({x:oEl.x1, y:oEl.y1}, el);
          // Check that both endpoints are near the wall centerline
          var nearTol = halfW + 0.05; // meters
          function pointWallDist(px,py){ var dx=origBx-origAx, dy=origBy-origAy; var denom=(dx*dx+dy*dy)||1; var t=((px-origAx)*dx+(py-origAy)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=origAx+t*dx, cy=origAy+t*dy; return Math.hypot(px-cx, py-cy); }
          var dA = pointWallDist(oEl.x0,oEl.y0), dB = pointWallDist(oEl.x1,oEl.y1);
          if(dA <= nearTol && dB <= nearTol){
            var s0 = Math.max(0, Math.min(1, Math.min(tA,tB)));
            var s1 = Math.max(0, Math.min(1, Math.max(tA,tB)));
            if(s1 > s0 + 1e-4) spans.push([s0,s1]);
          }
        }
      }
      // Live preview: carve a temporary gap where a door/window would be placed before element creation
      if(__plan2d.mouse && !__plan2d.dragWindow && !__plan2d.dragDoor && !__plan2d.dragDoorWhole && !__plan2d.start){
        var cPt = __plan2d.mouse; // screen-space
        var pWorld = screenToWorld2D(cPt.x, cPt.y);
        var near = plan2dFindNearestWall(pWorld, 0.3);
        if(near && typeof near.index==='number' && near.index===i){
          var tHover = plan2dProjectParamOnWall(pWorld, el);
          if(__plan2d.tool==='door'){
            var halfT = ((__plan2d.doorWidthM||0.87) / 2) / wLen0; var t0p=tHover-halfT, t1p=tHover+halfT;
            if(t1p>t0p){ t0p=Math.max(0,t0p); t1p=Math.min(1,t1p); if(t1p>t0p+1e-6) spans.push([t0p,t1p]); }
          } else if(__plan2d.tool==='window'){
            var wPreview = (__plan2d.windowDefaultWidthM||1.2);
            var halfTw = (wPreview/2)/wLen0; var t0w=tHover-halfTw, t1w=tHover+halfTw;
            if(t1w>t0w){ t0w=Math.max(0,t0w); t1w=Math.min(1,t1w); if(t1w>t0w+1e-6) spans.push([t0w,t1w]); }
          }
        }
      }
      // Merge spans
      spans.sort(function(A,B){ return A[0]-B[0]; });
      var merged=[]; for(var si=0; si<spans.length; si++){ var s=spans[si]; if(merged.length===0) merged.push(s); else { var last=merged[merged.length-1]; if(s[0] <= last[1] + 1e-4){ last[1] = Math.max(last[1], s[1]); } else { merged.push([s[0], s[1]]);} } }
      // Create solid segments as complement of merged spans
      var solids=[]; var cursorT=0; for(var mi=0; mi<merged.length; mi++){ var vs=merged[mi]; if(vs[0] > cursorT + 1e-4) solids.push([cursorT, vs[0]]); cursorT = Math.max(cursorT, vs[1]); }
      if(cursorT < 1 - 1e-4) solids.push([cursorT, 1]);
      // Convert each solid segment to world endpoints, applying flush extension only at outer ends
      for(var sj=0; sj<solids.length; sj++){
        var s0 = solids[sj][0], s1 = solids[sj][1];
        var sx0 = origAx + dirx * (s0 * wLen0), sy0 = origAy + diry * (s0 * wLen0);
        var sx1 = origAx + dirx * (s1 * wLen0), sy1 = origAy + diry * (s1 * wLen0);
        // Extend only if this touches the true ends
        var touchesStart = (s0 <= 1e-4) && startConn[i];
        var touchesEnd   = (s1 >= 1 - 1e-4) && endConn[i];
        if(touchesStart){ sx0 -= dirx * halfW; sy0 -= diry * halfW; }
        if(touchesEnd){   sx1 += dirx * halfW; sy1 += diry * halfW; }
        var aSeg = worldToScreen2D(sx0, sy0); var bSeg = worldToScreen2D(sx1, sy1);
        var dxs=bSeg.x-aSeg.x, dys=bSeg.y-aSeg.y; var Ls=Math.sqrt(dxs*dxs+dys*dys)||1; var nx=-dys/Ls, ny=dxs/Ls; var halfPx=(thick*__plan2d.scale)/2;
        ctx.beginPath(); ctx.fillStyle='#e5e7eb'; ctx.strokeStyle='#334155'; ctx.lineWidth=__plan2d.wallStrokePx;
        ctx.moveTo(aSeg.x+nx*halfPx,aSeg.y+ny*halfPx); ctx.lineTo(bSeg.x+nx*halfPx,bSeg.y+ny*halfPx); ctx.lineTo(bSeg.x-nx*halfPx,bSeg.y-ny*halfPx); ctx.lineTo(aSeg.x-nx*halfPx,aSeg.y-ny*halfPx); ctx.closePath(); ctx.fill(); ctx.stroke();

        // Inline segment length measurement centered inside the wall polygon (no pill)
        (function(){
          var minLabelPx = 30; // skip very tiny segments
          if(Ls < minLabelPx) return;
          var segLenM = Math.hypot(sx1 - sx0, sy1 - sy0);
          var txt = formatMeters(segLenM) + ' m';
          var midx = (aSeg.x + bSeg.x) * 0.5, midy = (aSeg.y + bSeg.y) * 0.5;
          var angle = Math.atan2(dys, dxs);
          if (angle > Math.PI/2 || angle < -Math.PI/2) angle += Math.PI; // keep upright
          var pad = 6; var maxW = Math.max(10, Ls - pad*2);
          var marginY = 2; var maxH = Math.max(6, (2*halfPx) - marginY*2);
          ctx.save();
          ctx.translate(midx, midy);
          ctx.rotate(angle);
          var baseFontSize = 18; ctx.font = baseFontSize + 'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
          var textW = ctx.measureText(txt).width;
          var scale = Math.min(1, maxW / Math.max(1, textW), maxH / baseFontSize);
          if (scale < 0.5) { ctx.restore(); return; }
          ctx.scale(scale, scale);
          // subtle outline for contrast on light wall fill
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(51,65,85,0.7)'; ctx.strokeText(txt, 0, 0.5);
          ctx.fillStyle = '#0b1220';
          ctx.fillText(txt, 0, 0.5);
          ctx.restore();
        })();
  // Live preview: carve a temporary gap where a door/window would be placed before element creation
      }
      // Skip default solid wall draw since we've drawn segments
      continue;
    }
    var a=worldToScreen2D(ax,ay), b=worldToScreen2D(bx,by);
    if(el.type==='window'){
      // Draw window as outline-only rectangle (no fill) at wall thickness and a center blue line
      var dxw=b.x-a.x, dyw=b.y-a.y; var Lw=Math.sqrt(dxw*dxw+dyw*dyw)||1; var nxw=-dyw/Lw, nyw=dxw/Lw;
      // Thickness: inherit from host wall if present, else element thickness or default
      var thickM = isHostWindow ? ( (elems[el.host].thickness||__plan2d.wallThicknessM) ) : (el.thickness||__plan2d.wallThicknessM);
      var halfw=(thickM*__plan2d.scale)/2;
      // Outline rectangle only
      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.moveTo(a.x+nxw*halfw,a.y+nyw*halfw);
      ctx.lineTo(b.x+nxw*halfw,b.y+nyw*halfw);
      ctx.lineTo(b.x-nxw*halfw,b.y-nyw*halfw);
      ctx.lineTo(a.x-nxw*halfw,a.y-nyw*halfw);
      ctx.closePath();
      ctx.stroke();
      // Center blue line
      ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // Endpoint handles for editing when selected or in window tool
      if((__plan2d.tool==='window' || (__plan2d.tool==='select' && i===__plan2d.selectedIndex))){
        var handleR=5;
        ctx.fillStyle='#38bdf8';
        ctx.beginPath(); ctx.arc(a.x,a.y,handleR,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x,b.y,handleR,0,Math.PI*2); ctx.fill();
      }
      // Persistent window measurement label centered along the window span (stays after finishing drawing)
      try {
        // Skip if this very window is being actively dragged; a dedicated live label is drawn later
        if (!(__plan2d.dragWindow && __plan2d.dragWindow.index === i)){
          var Lpx = Math.hypot(b.x - a.x, b.y - a.y);
          if (Lpx >= 20) {
            // Compute span length in meters using host wall for anchored windows; else world distance
            var lenM = 0;
            if (isHostWindow) {
              var hostWm = elems[el.host];
              var wallLenM = Math.hypot((hostWm.x1 - hostWm.x0), (hostWm.y1 - hostWm.y0)) || 1;
              var t0m = Math.max(0, Math.min(1, el.t0||0));
              var t1m = Math.max(0, Math.min(1, el.t1||0));
              lenM = wallLenM * Math.abs(t1m - t0m);
            } else {
              lenM = Math.hypot((bx - ax), (by - ay));
            }
            var txtM = formatMeters(lenM) + ' m';
            var midxM = (a.x + b.x) * 0.5, midyM = (a.y + b.y) * 0.5;
            var angM = Math.atan2(b.y - a.y, b.x - a.x);
            if (angM > Math.PI/2 || angM < -Math.PI/2) angM += Math.PI; // keep upright
            var padM = 6, maxWM = Math.max(10, Lpx - padM*2), maxHM = 18;
            ctx.save();
            ctx.translate(midxM, midyM);
            ctx.rotate(angM);
            var baseFontM = 16; ctx.font = baseFontM + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            var twM = ctx.measureText(txtM).width;
            var scaleM = Math.min(1, maxWM / Math.max(1, twM), maxHM / baseFontM);
            if (scaleM >= 0.55) {
              ctx.scale(scaleM, scaleM);
              // Outline for contrast
              ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15,23,42,0.7)'; ctx.strokeText(txtM, 0, 0.5);
              ctx.fillStyle = '#e5e7eb';
              ctx.fillText(txtM, 0, 0.5);
            }
            ctx.restore();
          }
        }
      } catch(e) { /* non-fatal measurement draw for windows */ }
    } else if(el.type==='door'){
      // Door rendering: compute endpoints (host-anchored or free)
      var isHostDoor = (typeof el.host==='number');
      var worldA = null, worldB = null;
      if(isHostDoor){
        var hostD = elems[el.host];
        if(hostD && hostD.type==='wall'){
          var t0d = Math.max(0, Math.min(1, el.t0||0));
          var t1d = Math.max(0, Math.min(1, el.t1||0));
          worldA = { x: hostD.x0 + (hostD.x1-hostD.x0)*t0d, y: hostD.y0 + (hostD.y1-hostD.y0)*t0d };
          worldB = { x: hostD.x0 + (hostD.x1-hostD.x0)*t1d, y: hostD.y0 + (hostD.y1-hostD.y0)*t1d };
          a = worldToScreen2D(worldA.x, worldA.y); b = worldToScreen2D(worldB.x, worldB.y);
        }
      } else {
        worldA = { x: el.x0, y: el.y0 }; worldB = { x: el.x1, y: el.y1 };
      }
      // Draw door as a jamb line plus a 90-degree swing arc based on hinge + swing
      ctx.save(); ctx.strokeStyle='#22c55e'; ctx.lineWidth=2;
      // Jamb line (opening)
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      // Determine hinge side and swing direction
      var hinge = (el.meta && el.meta.hinge) || 't0';
      var swing = (el.meta && el.meta.swing) || 'in'; // 'in' or 'out'
      var hPt = (hinge==='t0') ? a : b;
      var other = (hinge==='t0') ? b : a;
      var ang=Math.atan2(other.y-hPt.y, other.x-hPt.x);
      var r=Math.hypot(other.x-hPt.x, other.y-hPt.y);
      // Swing orientation: default arc 90° CCW; flip direction for swing='out'
      var startAng = ang;
      var endAng = ang + (swing==='out' ? -Math.PI/2 : Math.PI/2);
      ctx.beginPath();
      ctx.arc(hPt.x, hPt.y, r, startAng, endAng, (swing==='out'));
      ctx.stroke();
      // Endpoint handles when editing
      if((__plan2d.tool==='door' || (__plan2d.tool==='select' && i===__plan2d.selectedIndex))){
        var handleR=5; ctx.fillStyle='#22c55e';
        ctx.beginPath(); ctx.arc(a.x,a.y,handleR,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x,b.y,handleR,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }
  // Stairs are rendered on the overlay canvas only. Removed base-canvas stairs to avoid duplicates.

  // Color-coded overlays for pergola, garage, and balcony using world coords -> plan mapping
  try {
    if (__plan2d && __plan2d.active) {
      // Collect label boxes (screen-space) to draw text later on the labels-2d canvas
      var labelBoxes = [];
      // Draw stairs footprint on the base canvas (authoritative rendering)
      try {
        if (stairsComponent) {
          var lvlNow = (typeof currentFloor==='number' ? currentFloor : 0);
          var stairsLvl = (typeof stairsComponent.level==='number' ? stairsComponent.level : 0);
          var sgnSt = (__plan2d.yFromWorldZSign || 1);
          var rotSt = ((stairsComponent.rotation || 0) * Math.PI) / 180;
          var hwSt = (stairsComponent.width || 0)/2;
          var hdSt = (stairsComponent.depth || 0)/2;
          function rotStW(px, pz){ var dx=px - stairsComponent.x, dz=pz - stairsComponent.z; return { x: stairsComponent.x + dx*Math.cos(rotSt) - dz*Math.sin(rotSt), z: stairsComponent.z + dx*Math.sin(rotSt) + dz*Math.cos(rotSt) }; }
          var s1 = rotStW(stairsComponent.x - hwSt, stairsComponent.z - hdSt);
          var s2 = rotStW(stairsComponent.x + hwSt, stairsComponent.z - hdSt);
          var s3 = rotStW(stairsComponent.x + hwSt, stairsComponent.z + hdSt);
          var s4 = rotStW(stairsComponent.x - hwSt, stairsComponent.z + hdSt);
          function mapPlanSt(p){ return { x: (p.x - __plan2d.centerX), y: sgnSt * (p.z - __plan2d.centerZ) }; }
          var sp1 = worldToScreen2D(mapPlanSt(s1).x, mapPlanSt(s1).y);
          var sp2 = worldToScreen2D(mapPlanSt(s2).x, mapPlanSt(s2).y);
          var sp3 = worldToScreen2D(mapPlanSt(s3).x, mapPlanSt(s3).y);
          var sp4 = worldToScreen2D(mapPlanSt(s4).x, mapPlanSt(s4).y);
          ctx.save();
          ctx.globalAlpha = (stairsLvl === lvlNow) ? 0.95 : 0.35;
          ctx.fillStyle = (stairsLvl === lvlNow) ? 'rgba(15,23,42,0.10)' : 'rgba(15,23,42,0.06)';
          // Match wall stroke weight and use white keylines for consistency in 2D
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = (__plan2d.wallStrokePx || 1.2);
          ctx.beginPath(); ctx.moveTo(sp1.x, sp1.y); ctx.lineTo(sp2.x, sp2.y); ctx.lineTo(sp3.x, sp3.y); ctx.lineTo(sp4.x, sp4.y); ctx.closePath(); ctx.fill(); ctx.stroke();
          // Label background for stairs at top-left of its screen-space AABB
          try {
            var minXS = Math.min(sp1.x, sp2.x, sp3.x, sp4.x);
            var minYS = Math.min(sp1.y, sp2.y, sp3.y, sp4.y);
            var __dpr = window.devicePixelRatio || 1;
            // Match room label style: 25% smaller base font, semi-bold, centered
            var padXCss = 11, padYCss = 6, baseFontPxCss = 9, radiusCss = 19;
            var padX = padXCss * __dpr, padY = padYCss * __dpr, fontSize = baseFontPxCss * __dpr, radius = radiusCss * __dpr;
            ctx.save(); ctx.font = '600 ' + fontSize + 'px system-ui, sans-serif';
            var sText = (stairsComponent.name || 'Stairs');
            var tW = ctx.measureText(sText).width;
            var bx = Math.round(minXS + 6 * __dpr), by = Math.round(minYS + 6 * __dpr), bw = Math.round(tW + padX*2), bh = Math.round(fontSize + padY*2);
            radius = Math.min(radius, bh/2);
            // Clamp box fully inside canvas to avoid being cut off
            try {
              var cEl = document.getElementById('plan2d-canvas');
              if (cEl) { var cw=cEl.width||0, ch=cEl.height||0; bx = Math.max(6, Math.min(bx, Math.max(6, cw - bw - 6))); by = Math.max(6, Math.min(by, Math.max(6, ch - bh - 6))); }
            } catch(e){}
            // store (not used for drawing now) and draw on base canvas at original location
            // Use consistent alpha similar to room labels
            var aVal = 0.95;
            labelBoxes.push({ x: bx, y: by, w: bw, h: bh, text: sText, a: aVal });
            // Draw rounded pill background without shadow
            ctx.globalAlpha = aVal;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            // rounded rect path
            ctx.moveTo(bx + radius, by);
            ctx.lineTo(bx + bw - radius, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
            ctx.lineTo(bx + bw, by + bh - radius);
            ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - radius, by + bh);
            ctx.lineTo(bx + radius, by + bh);
            ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - radius);
            ctx.lineTo(bx, by + radius);
            ctx.quadraticCurveTo(bx, by, bx + radius, by);
            ctx.closePath();
            ctx.fill();
            // Draw centered text, auto-fit within padding
            try {
              var available = Math.max(0, bw - padX*2);
              var fontPxCss = baseFontPxCss; ctx.font = '600 ' + (fontPxCss * __dpr) + 'px system-ui, sans-serif';
              var tw = ctx.measureText(sText).width;
              if (available > 0 && tw > available) {
                var scale = available / Math.max(1, tw);
                fontPxCss = Math.max(9, Math.floor(baseFontPxCss * scale));
                ctx.font = '600 ' + (fontPxCss * __dpr) + 'px system-ui, sans-serif';
              }
              var tx = bx + bw/2, ty = by + bh/2;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillStyle = '#333333'; ctx.fillText(sText, tx, ty);
            } catch(e){}
            ctx.restore();
          } catch(e) { /* ignore label bg */ }
          // Draw treads with weighted spacing: 10th interval (landing) is 5x deeper
          try {
            var totalDepth = (stairsComponent.depth || 0);
            var totalSteps = Math.max(1, Math.floor(stairsComponent.steps || 19));
            var intervals = Math.max(1, totalSteps - 1);
            var weights = new Array(intervals);
            for (var wi=0; wi<intervals; wi++) {
              // Default each interval weight to 1; make the 10th interval (index 9) wider if it exists
              weights[wi] = (wi === 9 ? 5 : 1);
            }
            // Sum of weights for normalization
            var sumW = 0; for (var sw=0; sw<intervals; sw++) sumW += weights[sw];
            for (var siSt = 1; siSt <= intervals; siSt++) {
              // Position this tread line at the end of interval siSt-1
              var prevW = 0; for (var pi=0; pi<siSt; pi++) prevW += weights[pi];
              var tt = (sumW > 0) ? (prevW / sumW) : (siSt / (intervals+0));
              var zW = stairsComponent.z - hdSt + tt * totalDepth;
              var aW = rotStW(stairsComponent.x - hwSt, zW); var bW = rotStW(stairsComponent.x + hwSt, zW);
              var aS = worldToScreen2D(mapPlanSt(aW).x, mapPlanSt(aW).y);
              var bS = worldToScreen2D(mapPlanSt(bW).x, mapPlanSt(bW).y);
              ctx.beginPath(); ctx.strokeStyle = 'rgba(100,116,139,0.9)'; ctx.lineWidth = 1; ctx.moveTo(aS.x, aS.y); ctx.lineTo(bS.x, bS.y); ctx.stroke();
            }
          } catch(e) { /* ignore */ }
          ctx.restore();
        }
      } catch(e) { /* base stairs draw non-fatal */ }

      var lvlNowC = (typeof currentFloor==='number' ? currentFloor : 0);
      var sgnC = (__plan2d.yFromWorldZSign || 1);
      function mapPlanXY(wx, wz){ return worldToScreen2D((wx - __plan2d.centerX), sgnC * (wz - __plan2d.centerZ)); }
  function drawBox(x, z, w, d, rotDeg, stroke, fill, alpha, labelText) {
        var rot = ((rotDeg||0) * Math.PI) / 180; var hw=w/2, hd=d/2;
        function r(px,pz){ var dx=px-x, dz=pz-z; return { x: x + dx*Math.cos(rot) - dz*Math.sin(rot), z: z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
        var c1=r(x-hw,z-hd), c2=r(x+hw,z-hd), c3=r(x+hw,z+hd), c4=r(x-hw,z+hd);
        var p1=mapPlanXY(c1.x,c1.z), p2=mapPlanXY(c2.x,c2.z), p3=mapPlanXY(c3.x,c3.z), p4=mapPlanXY(c4.x,c4.z);
        ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = fill;
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y); ctx.closePath(); ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = (__plan2d.wallStrokePx || 1.2); ctx.stroke(); }
        // Draw a white label background at top-left of the overlay's AABB and remember its box for later text drawing
        if (labelText) {
          try {
            var minX = Math.min(p1.x,p2.x,p3.x,p4.x), minY = Math.min(p1.y,p2.y,p3.y,p4.y);
            var __dpr2 = window.devicePixelRatio || 1;
            // Match room label style (25% smaller)
            var padXCss2 = 11, padYCss2 = 6, baseFontPxCss2 = 9, radiusCss2 = 19;
            var padX2 = padXCss2 * __dpr2, padY2 = padYCss2 * __dpr2, fontSize2 = baseFontPxCss2 * __dpr2, radius2 = radiusCss2 * __dpr2;
            ctx.font = '600 ' + fontSize2 + 'px system-ui, sans-serif'; var tW = ctx.measureText(labelText).width;
            var bx = Math.round(minX + 6 * __dpr2), by = Math.round(minY + 6 * __dpr2), bw = Math.round(tW + padX2*2), bh = Math.round(fontSize2 + padY2*2);
            radius2 = Math.min(radius2, bh/2);
            // Clamp inside canvas bounds
            try { var cEl=document.getElementById('plan2d-canvas'); if(cEl){ var cw=cEl.width||0, ch=cEl.height||0; bx = Math.max(6, Math.min(bx, Math.max(6, cw - bw - 6))); by = Math.max(6, Math.min(by, Math.max(6, ch - bh - 6))); } } catch(e){}
            // Store info (not used for draw now) and draw on base canvas at original location
            labelBoxes.push({ x: bx, y: by, w: bw, h: bh, text: labelText, a: 0.95 });
            // Background pill without shadow
            ctx.save(); ctx.globalAlpha = 0.95; ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(bx + radius2, by);
            ctx.lineTo(bx + bw - radius2, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius2);
            ctx.lineTo(bx + bw, by + bh - radius2);
            ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - radius2, by + bh);
            ctx.lineTo(bx + radius2, by + bh);
            ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - radius2);
            ctx.lineTo(bx, by + radius2);
            ctx.quadraticCurveTo(bx, by, bx + radius2, by);
            ctx.closePath();
            ctx.fill();
            // Centered text with auto-fit inside padding
            try {
              var available2 = Math.max(0, bw - padX2*2);
              var fontPxCss2 = baseFontPxCss2; ctx.font = '600 ' + (fontPxCss2 * __dpr2) + 'px system-ui, sans-serif';
              var tw2 = ctx.measureText(labelText).width;
              if (available2 > 0 && tw2 > available2) {
                var scale2 = available2 / Math.max(1, tw2);
                fontPxCss2 = Math.max(9, Math.floor(baseFontPxCss2 * scale2));
                ctx.font = '600 ' + (fontPxCss2 * __dpr2) + 'px system-ui, sans-serif';
              }
              var tx2 = bx + bw/2, ty2 = by + bh/2;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillStyle = '#333333'; ctx.fillText(labelText, tx2, ty2);
            } catch(e){}
            ctx.restore();
          } catch(e) { /* ignore */ }
        }
        ctx.restore();
      }
      // Draw components present on the current level (guard against missing globals)
      var pergs = Array.isArray(window.pergolaComponents) ? window.pergolaComponents : [];
      var garages = Array.isArray(window.garageComponents) ? window.garageComponents : [];
      var balconies = Array.isArray(window.balconyComponents) ? window.balconyComponents : [];
      var pools = Array.isArray(window.poolComponents) ? window.poolComponents : [];
      var roofs = Array.isArray(window.roofComponents) ? window.roofComponents : [];

      for (var iPg=0;iPg<pergs.length;iPg++){
        var per=pergs[iPg]; if(!per) continue; if((per.level||0)!==lvlNowC) continue;
        // Pergola: draw with a wall-like outline similar to other objects
        drawBox(per.x, per.z, per.width, per.depth, per.rotation||0, '#10b981', 'rgba(16,185,129,0.15)', 0.95, (per.name||'Pergola'));
      }
      for (var iGg=0;iGg<garages.length;iGg++){
        var gar=garages[iGg]; if(!gar) continue; if((gar.level||0)!==lvlNowC) continue;
        // Use wall-like outline color to match other room outlines
        drawBox(gar.x, gar.z, gar.width, gar.depth, gar.rotation||0, '#334155', 'rgba(245,158,11,0.15)', 0.95, (gar.name||'Garage'));
      }
      for (var iBl=0;iBl<balconies.length;iBl++){
        var bal=balconies[iBl]; if(!bal) continue; if((bal.level||1)!==lvlNowC) continue;
        drawBox(bal.x, bal.z, bal.width, bal.depth, bal.rotation||0, '#6366f1', 'rgba(99,102,241,0.18)', 0.95, (bal.name||'Balcony'));
      }
      // Pools (ground floor by default)
      for (var iPl=0;iPl<pools.length;iPl++){
        var pol=pools[iPl]; if(!pol) continue; if((pol.level||0)!==lvlNowC) continue;
        drawBox(pol.x, pol.z, pol.width, pol.depth, pol.rotation||0, '#06b6d4', 'rgba(6,182,212,0.18)', 0.95, (pol.name||'Pool'));
      }
      // Roofs (draw on their assigned level; default to ground if unspecified)
      for (var iRf=0;iRf<roofs.length;iRf++){
        var rf=roofs[iRf]; if(!rf) continue; if((rf.level||0)!==lvlNowC) continue;
        // Use a distinctive rose color
        drawBox(rf.x, rf.z, rf.width, rf.depth, rf.rotation||0, '#f43f5e', 'rgba(244,63,94,0.14)', 0.90, (rf.name||'Roof'));
      }
      // 2D Room outlines and labels: draw subtle room footprint plus a small top-left label
      try {
        if (Array.isArray(allRooms)){
          var __dprR = window.devicePixelRatio || 1;
          var baseFontPxCssRoom = 9; // 25% smaller than 12px
          var minFontPxCssRoom = 8;  // clamp
          var padXCssR = 11, padYCssR = 6, radiusCssR = 19;
          for (var ir=0; ir<allRooms.length; ir++){
            var rm = allRooms[ir]; if(!rm) continue;
            var rLvl = (typeof rm.level==='number'? rm.level : 0);
            if (rLvl !== lvlNowC) continue;
            var hwR = (rm.width||0)/2, hdR = (rm.depth||0)/2;
            var c1r = mapPlanXY(rm.x - hwR, rm.z - hdR);
            var c2r = mapPlanXY(rm.x + hwR, rm.z - hdR);
            var c3r = mapPlanXY(rm.x + hwR, rm.z + hdR);
            var c4r = mapPlanXY(rm.x - hwR, rm.z + hdR);
            // Subtle room footprint fill under walls
            try {
              ctx.save();
              // Single alpha for clear but subtle footprint on dark background
              ctx.fillStyle = 'rgba(148,163,184,0.18)'; // slate-400 at ~18%
              ctx.beginPath();
              ctx.moveTo(c1r.x, c1r.y);
              ctx.lineTo(c2r.x, c2r.y);
              ctx.lineTo(c3r.x, c3r.y);
              ctx.lineTo(c4r.x, c4r.y);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            } catch(e){}
            var minXr = Math.min(c1r.x,c2r.x,c3r.x,c4r.x);
            var minYr = Math.min(c1r.y,c2r.y,c3r.y,c4r.y);
            var labelTextR = (rm.name || 'Room');
            var padXR = padXCssR * __dprR, padYR = padYCssR * __dprR;
            var fontPxR = baseFontPxCssRoom * __dprR;
            ctx.save();
            ctx.font = '600 ' + fontPxR + 'px system-ui, sans-serif';
            var tWR = ctx.measureText(labelTextR).width;
            var bxR = Math.round(minXr + 6 * __dprR), byR = Math.round(minYr + 6 * __dprR);
            var bwR = Math.round(tWR + padXR*2), bhR = Math.round((baseFontPxCssRoom * __dprR) + padYR*2);
            var radiusR = Math.min(radiusCssR * __dprR, bhR/2);
            try { var cElR=document.getElementById('plan2d-canvas'); if(cElR){ var cwR=cElR.width||0, chR=cElR.height||0; bxR = Math.max(6, Math.min(bxR, Math.max(6, cwR - bwR - 6))); byR = Math.max(6, Math.min(byR, Math.max(6, chR - bhR - 6))); } } catch(e){}
            ctx.globalAlpha = 0.95; ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(bxR + radiusR, byR);
            ctx.lineTo(bxR + bwR - radiusR, byR);
            ctx.quadraticCurveTo(bxR + bwR, byR, bxR + bwR, byR + radiusR);
            ctx.lineTo(bxR + bwR, byR + bhR - radiusR);
            ctx.quadraticCurveTo(bxR + bwR, byR + bhR, bxR + bwR - radiusR, byR + bhR);
            ctx.lineTo(bxR + radiusR, byR + bhR);
            ctx.quadraticCurveTo(bxR, byR + bhR, bxR, byR + bhR - radiusR);
            ctx.lineTo(bxR, byR + radiusR);
            ctx.quadraticCurveTo(bxR, byR, bxR + radiusR, byR);
            ctx.closePath(); ctx.fill();
            try {
              var availableR = Math.max(0, bwR - padXR*2);
              var fontCssNow = baseFontPxCssRoom; ctx.font = '600 ' + (fontCssNow * __dprR) + 'px system-ui, sans-serif';
              var twNow = ctx.measureText(labelTextR).width;
              if (availableR > 0 && twNow > availableR){ var scaleR = availableR / Math.max(1, twNow); fontCssNow = Math.max(minFontPxCssRoom, Math.floor(baseFontPxCssRoom * scaleR)); ctx.font = '600 ' + (fontCssNow * __dprR) + 'px system-ui, sans-serif'; }
              var txR = bxR + bwR/2, tyR = byR + bhR/2; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#333333'; ctx.fillText(labelTextR, txR, tyR);
            } catch(e){}
            ctx.restore();
          }
        }
      } catch(e) { /* ignore room labels */ }
      // After drawing backgrounds, draw the label texts on the labels-2d canvas (handled later)
      __plan2d.__labelBoxes2D = labelBoxes;
    }
  } catch(e) { /* overlay draw for components is non-fatal */ }

  // Preview during drag
  if(__plan2d.start && __plan2d.last){
    var a=worldToScreen2D(__plan2d.start.x,__plan2d.start.y);
    var b=worldToScreen2D(__plan2d.last.x,__plan2d.last.y);
    var dx=b.x-a.x, dy=b.y-a.y;
    if(Math.abs(dx)>Math.abs(dy)) b.y=a.y; else b.x=a.x;
    if(__plan2d.tool==='wall'){
      var L2=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2)||1;
      var nx2=-(b.y-a.y)/L2, ny2=(b.x-a.x)/L2; var half2=(__plan2d.wallThicknessM*__plan2d.scale)/2;
      ctx.beginPath(); ctx.fillStyle='rgba(226,232,240,0.55)'; ctx.strokeStyle='#64748b'; ctx.setLineDash([6,4]);
      ctx.moveTo(a.x+nx2*half2,a.y+ny2*half2); ctx.lineTo(b.x+nx2*half2,b.y+ny2*half2); ctx.lineTo(b.x-nx2*half2,b.y-ny2*half2); ctx.lineTo(a.x-nx2*half2,a.y-ny2*half2); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  // (Removed) Live measurement label centered inside the preview wall
    } else if(__plan2d.tool==='window'){
      ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.setLineDash([4,3]); ctx.lineWidth=2; ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.setLineDash([]);
      // Live window measurement label centered along the preview line (no pill)
      (function(){
        var Ls = Math.hypot(b.x-a.x, b.y-a.y); if(Ls < 20) return;
        var segLenM = Math.hypot(__plan2d.last.x-__plan2d.start.x, __plan2d.last.y-__plan2d.start.y);
        var txt = formatMeters(segLenM) + ' m';
        var midx=(a.x+b.x)/2, midy=(a.y+b.y)/2; var angle=Math.atan2(b.y-a.y, b.x-a.x); if(angle>Math.PI/2||angle<-Math.PI/2) angle+=Math.PI;
        var pad=6, maxW=Math.max(10, Ls - pad*2), maxH=18; // thin text-only label
        ctx.save(); ctx.translate(midx, midy); ctx.rotate(angle);
        var baseFontSize = 16; ctx.font=baseFontSize+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        var textW=ctx.measureText(txt).width; var scale=Math.min(1, maxW/Math.max(1,textW), maxH/baseFontSize); if(scale<0.55){ ctx.restore(); return; }
        ctx.scale(scale,scale);
        // subtle outline for readability over lines
        ctx.lineWidth = 3; ctx.strokeStyle='rgba(15,23,42,0.7)'; ctx.strokeText(txt,0,0.5);
        ctx.fillStyle='#e5e7eb'; ctx.fillText(txt,0,0.5);
        ctx.restore();
      })();
    }
  }

  // Live label while dragging a window endpoint (host-anchored)
  if(__plan2d.dragWindow){
    try {
      var dw = __plan2d.dragWindow;
      var we = __plan2d.elements[dw.index];
      if(we && we.type==='window' && typeof we.host==='number'){
        var host = __plan2d.elements[we.host];
        if(host && host.type==='wall'){
          // Compute world endpoints from host t0/t1
          var t0 = Math.max(0, Math.min(1, we.t0||0));
          var t1 = Math.max(0, Math.min(1, we.t1||0));
          var wx0 = host.x0 + (host.x1-host.x0)*t0, wy0 = host.y0 + (host.y1-host.y0)*t0;
          var wx1 = host.x0 + (host.x1-host.x0)*t1, wy1 = host.y0 + (host.y1-host.y0)*t1;
          var a = worldToScreen2D(wx0, wy0); var b = worldToScreen2D(wx1, wy1);
          // Pixel-space length for visibility threshold
          var Lpx = Math.hypot(b.x - a.x, b.y - a.y);
          if(Lpx >= 20){
            // Window span in meters along the wall
            var wallLen = Math.hypot((host.x1-host.x0), (host.y1-host.y0)) || 1;
            var spanT = Math.abs(t1 - t0);
            var lenM = wallLen * spanT;
            var txt = formatMeters(lenM) + ' m';
            // Midpoint and orientation
            var midx = (a.x + b.x) * 0.5, midy = (a.y + b.y) * 0.5;
            var angle = Math.atan2(b.y - a.y, b.x - a.x);
            if(angle > Math.PI/2 || angle < -Math.PI/2) angle += Math.PI; // keep upright
            var pad = 6, maxW = Math.max(10, Lpx - pad*2), maxH = 18;
            ctx.save();
            ctx.translate(midx, midy);
            ctx.rotate(angle);
            var baseFontSize = 16; ctx.font = baseFontSize + 'px sans-serif';
            ctx.textAlign='center'; ctx.textBaseline='middle';
            var textW = ctx.measureText(txt).width;
            var scale = Math.min(1, maxW / Math.max(1, textW), maxH / baseFontSize);
            if(scale >= 0.55){
              ctx.scale(scale, scale);
              // subtle outline for readability
              ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15,23,42,0.7)'; ctx.strokeText(txt, 0, 0.5);
              ctx.fillStyle = '#e5e7eb';
              ctx.fillText(txt, 0, 0.5);
            }
            ctx.restore();
          }
        }
      }
    } catch(e) { /* non-fatal */ }
  }
  // Hover erase highlight
  if(__plan2d.tool==='erase' && __plan2d.hoverIndex>=0){ var e=__plan2d.elements[__plan2d.hoverIndex]; var a2=worldToScreen2D(e.x0,e.y0), b2=worldToScreen2D(e.x1,e.y1); ctx.beginPath(); ctx.strokeStyle='#ef4444'; ctx.lineWidth=3; ctx.setLineDash([4,4]); ctx.moveTo(a2.x,a2.y); ctx.lineTo(b2.x,b2.y); ctx.stroke(); ctx.setLineDash([]); }
  // Hover highlights in Select tool for feedback
  if(__plan2d.tool==='select'){
    // Door/window segment hover
    if(typeof __plan2d.hoverDoorIndex==='number' && __plan2d.hoverDoorIndex>=0){
      var deh = __plan2d.elements[__plan2d.hoverDoorIndex];
      if(deh){
        var ax,ay,bx,by; if(typeof deh.host==='number'){ var host=__plan2d.elements[deh.host]; if(host){ var t0=Math.max(0,Math.min(1,deh.t0||0)), t1=Math.max(0,Math.min(1,deh.t1||0)); ax=host.x0+(host.x1-host.x0)*t0; ay=host.y0+(host.y1-host.y0)*t0; bx=host.x0+(host.x1-host.x0)*t1; by=host.y0+(host.y1-host.y0)*t1; } }
        if(ax===undefined){ ax=deh.x0; ay=deh.y0; bx=deh.x1; by=deh.y1; }
        var aS=worldToScreen2D(ax,ay), bS=worldToScreen2D(bx,by); ctx.beginPath(); ctx.strokeStyle='#10b981'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(aS.x,aS.y); ctx.lineTo(bS.x,bS.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if(typeof __plan2d.hoverWindowIndex==='number' && __plan2d.hoverWindowIndex>=0){
      var weH = __plan2d.elements[__plan2d.hoverWindowIndex]; if(weH){ var axw,ayw,bxw,byw; if(typeof weH.host==='number'){ var wh=__plan2d.elements[weH.host]; if(wh){ var t0w=Math.max(0,Math.min(1,weH.t0||0)), t1w=Math.max(0,Math.min(1,weH.t1||0)); axw=wh.x0+(wh.x1-wh.x0)*t0w; ayw=wh.y0+(wh.y1-wh.y0)*t0w; bxw=wh.x0+(wh.x1-wh.x0)*t1w; byw=wh.y0+(wh.y1-wh.y0)*t1w; } } if(axw===undefined){ axw=weH.x0; ayw=weH.y0; bxw=weH.x1; byw=weH.y1; } var aSw=worldToScreen2D(axw,ayw), bSw=worldToScreen2D(bxw,byw); ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(aSw.x,aSw.y); ctx.lineTo(bSw.x,bSw.y); ctx.stroke(); ctx.setLineDash([]);} }
    // Wall subsegment hover
    if(__plan2d.hoverSubsegment && __plan2d.hoverDoorIndex<0 && __plan2d.hoverWindowIndex<0){ var hs=__plan2d.hoverSubsegment; var aH=worldToScreen2D(hs.ax,hs.ay), bH=worldToScreen2D(hs.bx,hs.by); ctx.beginPath(); ctx.strokeStyle='#f97316'; ctx.lineWidth=4; ctx.setLineDash([8,4]); ctx.moveTo(aH.x,aH.y); ctx.lineTo(bH.x,bH.y); ctx.stroke(); ctx.setLineDash([]); }
    // Wall endpoint hover: show a small handle at the hovered endpoint for affordance
    if(__plan2d.hoverWallEnd && typeof __plan2d.hoverWallEnd.index==='number'){
      try{
        var wHover = __plan2d.elements[__plan2d.hoverWallEnd.index];
        if(wHover && wHover.type==='wall'){
          var pt = (__plan2d.hoverWallEnd.end==='a') ? {x:wHover.x0,y:wHover.y0} : {x:wHover.x1,y:wHover.y1};
          var pS = worldToScreen2D(pt.x, pt.y);
          ctx.save();
          ctx.fillStyle = '#fbbf24'; // amber-400
          ctx.strokeStyle = 'rgba(15,23,42,0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(pS.x, pS.y, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
      }catch(e){}
    }
  }
  // Selection highlight
  if(__plan2d.selectedIndex>=0){
    var se=__plan2d.elements[__plan2d.selectedIndex];
    var sx0=se.x0, sy0=se.y0, sx1=se.x1, sy1=se.y1;
    if(se && (se.type==='window' || se.type==='door') && typeof se.host==='number'){
      var hostSel = __plan2d.elements[se.host];
      if(hostSel && hostSel.type==='wall'){
        var tt0=Math.max(0,Math.min(1,se.t0||0)), tt1=Math.max(0,Math.min(1,se.t1||0));
        sx0 = hostSel.x0 + (hostSel.x1-hostSel.x0)*tt0; sy0 = hostSel.y0 + (hostSel.y1-hostSel.y0)*tt0;
        sx1 = hostSel.x0 + (hostSel.x1-hostSel.x0)*tt1; sy1 = hostSel.y0 + (hostSel.y1-hostSel.y0)*tt1;
      }
    }
    var sa=worldToScreen2D(sx0,sy0), sb=worldToScreen2D(sx1,sy1);
    ctx.beginPath(); ctx.strokeStyle='#10b981'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke(); ctx.setLineDash([]);
    // When a wall is selected in Select tool, show explicit draggable endpoint handles
    if(__plan2d.tool==='select' && se && se.type==='wall'){
      var handleR = 6;
      // Draw with a strong fill and subtle outline for visibility over walls
      ctx.save();
      ctx.fillStyle = '#f59e0b'; // amber-500
      ctx.strokeStyle = 'rgba(15,23,42,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sa.x, sa.y, handleR, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(sb.x, sb.y, handleR, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  // Draw selected subsegment highlight if present
  if(__plan2d.selectedSubsegment && typeof __plan2d.selectedSubsegment.wallIndex==='number'){
    var ss = __plan2d.selectedSubsegment;
    var aS = worldToScreen2D(ss.ax, ss.ay), bS = worldToScreen2D(ss.bx, ss.by);
    ctx.save();
    ctx.beginPath(); ctx.strokeStyle = '#f97316'; ctx.lineWidth = 4; ctx.setLineDash([8,4]);
    ctx.moveTo(aS.x, aS.y); ctx.lineTo(bS.x, bS.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }
  var ox=ov.getContext('2d'); ox.setTransform(1,0,0,1,0,0); ox.clearRect(0,0,ov.width,ov.height);
  // Dedicated 2D labels canvas (draw text here, keep shapes/effects on overlay)
  var l2c = document.getElementById('labels-2d');
  var lx = l2c ? l2c.getContext('2d') : ox; // fallback to overlay if missing
  if (l2c) { lx.setTransform(1,0,0,1,0,0); lx.clearRect(0,0,l2c.width,l2c.height); }

  // Overlays: Stairs indicator (both floors) + small labels
  (function(){
    try{
      var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
      var cxW = (typeof __plan2d.centerX==='number'? __plan2d.centerX : 0);
      var czW = (typeof __plan2d.centerZ==='number'? __plan2d.centerZ : 0);
      var sgn = (__plan2d.yFromWorldZSign||1);
      function toScreen(wx, wz){ return worldToScreen2D((wx - cxW), sgn * (wz - czW)); }
      // Compute the exact visual center of a rotated box in screen space
      function screenCenterOfBox(x, z, w, d, rotDeg){
        var rot = ((rotDeg||0) * Math.PI) / 180; var hw=(w||0)/2, hd=(d||0)/2;
        function r(px,pz){ var dx=px-x, dz=pz-z; return { x: x + dx*Math.cos(rot) - dz*Math.sin(rot), z: z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
        var c1=r(x-hw,z-hd), c2=r(x+hw,z-hd), c3=r(x+hw,z+hd), c4=r(x-hw,z+hd);
        var p1=toScreen(c1.x,c1.z), p3=toScreen(c3.x,c3.z);
        // For rectangles, the midpoint of opposite corners is the exact center
        return { x:(p1.x+p3.x)/2, y:(p1.y+p3.y)/2 };
      }
      // Debug helpers for label vs overlay center
      function getBoxScreenPoints(x, z, w, d, rotDeg){
        var rot = ((rotDeg||0) * Math.PI) / 180; var hw=(w||0)/2, hd=(d||0)/2;
        function r(px,pz){ var dx=px-x, dz=pz-z; return { x: x + dx*Math.cos(rot) - dz*Math.sin(rot), z: z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
        var c1=r(x-hw,z-hd), c2=r(x+hw,z-hd), c3=r(x+hw,z+hd), c4=r(x-hw,z+hd);
        return [ toScreen(c1.x,c1.z), toScreen(c2.x,c2.z), toScreen(c3.x,c3.z), toScreen(c4.x,c4.z) ];
      }
      function getAABB(pts){ var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; for(var i=0;i<pts.length;i++){ var p=pts[i]; if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; } return {minX:minX,minY:minY,maxX:maxX,maxY:maxY}; }
      var SHOW_2D_LABEL_COORDS = true;
  if (__plan2d.drawLabelBoxesOnLabelsLayer && l2c) {
    lx.save();
    lx.font = '12px sans-serif';
    lx.textAlign = 'center';
    lx.textBaseline = 'middle';
    // Draw white box + centered text on labels layer if explicitly enabled
    lx.save();
    var __dprT = window.devicePixelRatio || 1;
    // Match DOM room-label appearance
    var baseFontPx = 12, minFontPx = 9;
    lx.textBaseline = 'middle';
    var boxes = (__plan2d.__labelBoxes2D || []);
    for (var li=0; li<boxes.length; li++){
      var lb = boxes[li] || {};
      var bx = +lb.x || 0, by = +lb.y || 0, bw = +lb.w || 0, bh = +lb.h || 0;
      var labelText = (lb.text == null ? '' : String(lb.text));
      var alpha = (typeof lb.a === 'number' ? lb.a : 0.95);
  // background pill without shadow
  lx.save(); lx.globalAlpha = alpha; lx.fillStyle = '#ffffff';
  var radius = 19 * __dprT;
      lx.beginPath();
      lx.moveTo(bx + radius, by);
      lx.lineTo(bx + bw - radius, by);
      lx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
      lx.lineTo(bx + bw, by + bh - radius);
      lx.quadraticCurveTo(bx + bw, by + bh, bx + bw - radius, by + bh);
      lx.lineTo(bx + radius, by + bh);
      lx.quadraticCurveTo(bx, by + bh, bx, by + bh - radius);
      lx.lineTo(bx, by + radius);
      lx.quadraticCurveTo(bx, by, bx + radius, by);
      lx.closePath();
      lx.fill();
      lx.restore();
      // text centered with padding fit
      var padX = 11 * __dprT;
      var available = Math.max(0, bw - padX * 2);
      var fontPx = baseFontPx; lx.font = '600 ' + (fontPx * __dprT) + 'px system-ui, sans-serif';
      var tw = lx.measureText(labelText).width;
      if (available > 0 && tw > available) {
        var scale = available / Math.max(1, tw);
        fontPx = Math.max(minFontPx, Math.floor(baseFontPx * scale));
        lx.font = '600 ' + (fontPx * __dprT) + 'px system-ui, sans-serif';
      }
      lx.textAlign = 'center'; lx.fillStyle = '#333333';
      var tx = bx + bw / 2, ty = by + bh / 2;
      lx.fillText(labelText, tx, ty);
    }
    lx.restore();
  }
  if(__plan2d.debug){
    try {
      var dpr = window.devicePixelRatio || 1;
      ox.save();
      ox.font = '11px monospace';
      ox.textAlign = 'left';
      ox.textBaseline = 'top';
      ox.fillStyle = 'rgba(0,0,0,0.55)';
      ox.fillRect(8,8, 280, 40);
      ox.fillStyle = '#fde68a'; // amber-300
      var msg1 = 'c: '+c.width+'x'+c.height+'  ov: '+ov.width+'x'+ov.height;
      var msg2 = 'scale: '+__plan2d.scale+'  dpr: '+dpr.toFixed(2);
      ox.fillText(msg1, 12, 12);
      ox.fillText(msg2, 12, 28);
      ox.restore();
      if (console && console.debug) console.debug('[2D] c', c.width, c.height, 'ov', ov.width, ov.height, 'scale', __plan2d.scale, 'dpr', dpr);
    } catch(e){}
  }
  // Overlay: Compass rose (screen-space orientation consistent with 3D). +X = East (right). North (world +Z)
  // is up if __plan2d.yFromWorldZSign === 1, and down if it's -1.
  (function(){
    var pad = 16; var cx = pad + 22, cy = pad + 22; var r = 18;
    ox.save();
    // Outer circle
    ox.beginPath(); ox.arc(cx, cy, r, 0, Math.PI*2); ox.fillStyle='rgba(15,23,42,0.55)'; ox.fill();
    ox.strokeStyle='rgba(148,163,184,0.8)'; ox.lineWidth=1; ox.stroke();
    // Axes lines
    ox.strokeStyle='rgba(203,213,225,0.9)';
    ox.beginPath(); ox.moveTo(cx, cy-r+4); ox.lineTo(cx, cy+r-4); ox.stroke(); // N-S
    ox.beginPath(); ox.moveTo(cx-r+4, cy); ox.lineTo(cx+r-4, cy); ox.stroke(); // W-E
    // Arrowhead and labels respect orientation sign
    var sgn = (__plan2d.yFromWorldZSign||1);
    var northUp = (sgn===1);
    // Arrowhead for North
    if(northUp){
      ox.beginPath(); ox.moveTo(cx, cy-r+4); ox.lineTo(cx-4, cy-r+10); ox.lineTo(cx+4, cy-r+10); ox.closePath(); ox.fillStyle='rgba(59,130,246,0.95)'; ox.fill();
    } else {
      // North points down
      ox.beginPath(); ox.moveTo(cx, cy+r-4); ox.lineTo(cx-4, cy+r-10); ox.lineTo(cx+4, cy+r-10); ox.closePath(); ox.fillStyle='rgba(59,130,246,0.95)'; ox.fill();
    }
    // Labels N/E/S/W (flip N/S positions when sign=-1)
    ox.fillStyle='rgba(226,232,240,0.95)'; ox.font='11px sans-serif'; ox.textAlign='center'; ox.textBaseline='middle';
    var nY = northUp ? (cy - r - 8) : (cy + r + 8);
    var sY = northUp ? (cy + r + 8) : (cy - r - 8);
    ox.fillText('N', cx, nY);
    ox.fillText('S', cx, sY);
    ox.fillText('E', cx + r + 10, cy);
    ox.fillText('W', cx - r - 10, cy);
    ox.restore();
  })();

  // Overlay: corner wall markers (yellow ticks at connected corners)
  (function(){
    var elems = __plan2d.elements || [];
    if(!elems.length) return;
    __plan2d.__cornerMarkers = [];
    ox.save();
    ox.strokeStyle = '#facc15'; // yellow-400
    ox.lineWidth = 2;
    for(var i=0;i<elems.length;i++){
      var el = elems[i]; if(!el || el.type !== 'wall') continue;
      // Mirror wall geometry calculations used in main wall render
      var origAx = el.x0, origAy = el.y0, origBx = el.x1, origBy = el.y1;
      var wdx0 = origBx - origAx, wdy0 = origBy - origAy; var wLen0 = Math.hypot(wdx0, wdy0) || 1;
      var dirx = wdx0 / wLen0, diry = wdy0 / wLen0;
      var thick = (el.thickness||__plan2d.wallThicknessM);
      var halfW = thick/2;
      // Build void spans (windows/doors) in t-space [0,1]
      var spans = [];
      for(var wi=0; wi<elems.length; wi++){
        var oEl = elems[wi]; if(!oEl || (oEl.type!=='window' && oEl.type!=='door')) continue;
        if(typeof oEl.host==='number' && oEl.host===i){
          var ot0 = Math.max(0, Math.min(1, oEl.t0||0));
          var ot1 = Math.max(0, Math.min(1, oEl.t1||0));
          if(ot1 < ot0){ var tmpo=ot0; ot0=ot1; ot1=tmpo; }
          spans.push([ot0, ot1]);
        } else {
          // Free opening: include if near wall centerline
          var tA = plan2dProjectParamOnWall({x:oEl.x0, y:oEl.y0}, el);
          var tB = plan2dProjectParamOnWall({x:oEl.x1, y:oEl.y1}, el);
          var nearTol = halfW + 0.05; // meters
          function pointWallDist(px,py){ var dx=origBx-origAx, dy=origBy-origAy; var denom=(dx*dx+dy*dy)||1; var t=((px-origAx)*dx+(py-origAy)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=origAx+t*dx, cy=origAy+t*dy; return Math.hypot(px-cx, py-cy); }
          var dA = pointWallDist(oEl.x0,oEl.y0), dB = pointWallDist(oEl.x1,oEl.y1);
          if(dA <= nearTol && dB <= nearTol){ var s0=Math.max(0,Math.min(1,Math.min(tA,tB))); var s1=Math.max(0,Math.min(1,Math.max(tA,tB))); if(s1 > s0 + 1e-4) spans.push([s0,s1]); }
        }
      }
      // Merge spans
      spans.sort(function(A,B){ return A[0]-B[0]; });
      var merged=[]; for(var si=0; si<spans.length; si++){ var s=spans[si]; if(merged.length===0) merged.push(s); else { var last=merged[merged.length-1]; if(s[0] <= last[1] + 1e-4){ last[1] = Math.max(last[1], s[1]); } else { merged.push([s[0], s[1]]);} } }
      // Solid segments are the complement of merged voids
      var solids=[]; var cursorT=0; for(var mi=0; mi<merged.length; mi++){ var vs=merged[mi]; if(vs[0] > cursorT + 1e-4) solids.push([cursorT, vs[0]]); cursorT = Math.max(cursorT, vs[1]); }
      if(cursorT < 1 - 1e-4) solids.push([cursorT, 1]);
      // For each solid, compute screen-space normal and draw ticks at true corners
      for(var sj=0; sj<solids.length; sj++){
        var s0 = solids[sj][0], s1 = solids[sj][1];
        var sx0 = origAx + dirx * (s0 * wLen0), sy0 = origAy + diry * (s0 * wLen0);
        var sx1 = origAx + dirx * (s1 * wLen0), sy1 = origAy + diry * (s1 * wLen0);
        var touchesStart = (s0 <= 1e-4) && startConn[i];
        var touchesEnd   = (s1 >= 1 - 1e-4) && endConn[i];
        if(touchesStart){ sx0 -= dirx * halfW; sy0 -= diry * halfW; }
        if(touchesEnd){   sx1 += dirx * halfW; sy1 += diry * halfW; }
        // Debug: also compute base endpoints before extension
        var baseAS = worldToScreen2D(origAx + dirx * (s0 * wLen0), origAy + diry * (s0 * wLen0));
        var baseBS = worldToScreen2D(origAx + dirx * (s1 * wLen0), origAy + diry * (s1 * wLen0));
        var aS = worldToScreen2D(sx0, sy0); var bS = worldToScreen2D(sx1, sy1);
        var dxs = bS.x - aS.x, dys = bS.y - aS.y; var Ls = Math.hypot(dxs, dys) || 1;
        var nx = -dys / Ls, ny = dxs / Ls; var halfPx = (thick * __plan2d.scale) / 2;
        if(touchesStart){
          var keyS = i+':s'; var offS = __plan2d.debugCornerOffset[keyS] || {dx:0,dy:0};
          var ax1=aS.x + nx*halfPx + offS.dx, ay1=aS.y + ny*halfPx + offS.dy, ax2=aS.x - nx*halfPx + offS.dx, ay2=aS.y - ny*halfPx + offS.dy;
          ox.beginPath(); ox.moveTo(ax1, ay1); ox.lineTo(ax2, ay2); ox.stroke();
          // small draggable handle
          ox.fillStyle = '#fde047'; ox.beginPath(); ox.arc(aS.x + offS.dx, aS.y + offS.dy, 4, 0, Math.PI*2); ox.fill(); ox.fillStyle = '#facc15';
          __plan2d.__cornerMarkers.push({ key: keyS, i: i, end: 's', x: aS.x + offS.dx, y: aS.y + offS.dy, nx: nx, ny: ny, halfPx: halfPx });
        }
        if(touchesEnd){
          var keyE = i+':e'; var offE = __plan2d.debugCornerOffset[keyE] || {dx:0,dy:0};
          var bx1=bS.x + nx*halfPx + offE.dx, by1=bS.y + ny*halfPx + offE.dy, bx2=bS.x - nx*halfPx + offE.dx, by2=bS.y - ny*halfPx + offE.dy;
          ox.beginPath(); ox.moveTo(bx1, by1); ox.lineTo(bx2, by2); ox.stroke();
          ox.fillStyle = '#fde047'; ox.beginPath(); ox.arc(bS.x + offE.dx, bS.y + offE.dy, 4, 0, Math.PI*2); ox.fill(); ox.fillStyle = '#facc15';
          __plan2d.__cornerMarkers.push({ key: keyE, i: i, end: 'e', x: bS.x + offE.dx, y: bS.y + offE.dy, nx: nx, ny: ny, halfPx: halfPx });
        }
        if(__plan2d.debug){
          // draw small markers for base vs extended endpoints
          ox.save();
          ox.fillStyle = '#f0abfc'; // fuchsia-300 base
          ox.beginPath(); ox.arc(baseAS.x, baseAS.y, 2.5, 0, Math.PI*2); ox.fill();
          ox.beginPath(); ox.arc(baseBS.x, baseBS.y, 2.5, 0, Math.PI*2); ox.fill();
          ox.fillStyle = '#22d3ee'; // cyan-400 extended
          ox.beginPath(); ox.arc(aS.x, aS.y, 2.5, 0, Math.PI*2); ox.fill();
          ox.beginPath(); ox.arc(bS.x, bS.y, 2.5, 0, Math.PI*2); ox.fill();
          ox.restore();
        }
      }
    }
    ox.restore();
  })();
  } catch(e) {
    // Non-fatal: overlay/labels rendering issues shouldn't break the main render loop
    try { console.warn('2D overlay draw error', e); } catch(_) {}
  }
})();

  // (Removed) Overlay: Wall orientation hint during wall drawing
  // (Removed) Overlay: live window width dimension label during drag or when selected

  // (Removed) Overlay: live wall dimension during drag
  // (Removed) Overlay: dimension lines for every wall
}
function plan2dHoverErase(p){
  var best=-1, bestDist=0.25;
  for(var i=0;i<__plan2d.elements.length;i++){
    var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; }
  }
  __plan2d.hoverIndex=best; plan2dDraw();
}

// Find nearest element of specific types to point p within maxDist (meters in plan space)
function plan2dFindNearestOfTypes(p, types, maxDist){
  var elems = __plan2d.elements||[]; var bestIdx=-1; var bestDist=(typeof maxDist==='number'? maxDist : 0.2);
  for(var i=0;i<elems.length;i++){
    var e=elems[i]; if(!e || types.indexOf(e.type)===-1) continue;
    var d = plan2dPointSegDist(p.x,p.y,e);
    if(d < bestDist){ bestDist = d; bestIdx = i; }
  }
  return { index: bestIdx, dist: bestDist };
}

// Robust element eraser that keeps window/door host indices consistent
function plan2dEraseElementAt(idx){
  var arr = __plan2d.elements; if(!arr || idx<0 || idx>=arr.length) return false;
  var removed = arr[idx];
  // Remove the element
  arr.splice(idx, 1);
  if(removed && removed.type==='wall'){
    // Remove all openings hosted on this wall and fix host indices for remaining
    for(var i=arr.length-1; i>=0; i--){
      var el = arr[i]; if(!el) continue;
      if((el.type==='window' || el.type==='door') && typeof el.host==='number'){
        if(el.host === idx){ arr.splice(i,1); continue; }
        if(el.host > idx){ el.host -= 1; }
      }
    }
  } else {
    // Non-wall removed: shift host indices for openings that point to walls after idx
    for(var j=0; j<arr.length; j++){
      var e = arr[j]; if(!e) continue;
      if((e.type==='window' || e.type==='door') && typeof e.host==='number'){
        if(e.host > idx){ e.host -= 1; }
      }
    }
  }
  return true;
}

function plan2dEraseAt(p){
  // 1) Prefer deleting a window under cursor
  var win = plan2dFindNearestOfTypes(p, ['window'], 0.2);
  if(win.index>=0){ if(plan2dEraseElementAt(win.index)){ __plan2d.hoverIndex=-1; plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); } return; }
  // 2) Prefer deleting a door under cursor
  var dor = plan2dFindNearestOfTypes(p, ['door'], 0.2);
  if(dor.index>=0){ if(plan2dEraseElementAt(dor.index)){ __plan2d.hoverIndex=-1; plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); } return; }
  // 3) Try deleting a wall subsegment (replaces just that span with solid wall)
  var segHit = plan2dHitWallSubsegment(p, 0.15);
  if(segHit){
    __plan2d.selectedSubsegment = segHit;
    if(plan2dDeleteSelectedSubsegment()){
      __plan2d.selectedSubsegment = null; __plan2d.hoverIndex=-1; plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited();
      return;
    }
  }
  // 4) Fallback to erase nearest element (with host index fixups)
  plan2dHoverErase(p);
  if(__plan2d.hoverIndex>=0){ var delIdx = __plan2d.hoverIndex; plan2dEraseElementAt(delIdx); __plan2d.hoverIndex=-1; plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); }
}
// Selection prefers windows if window tool is active; else any nearest element
function plan2dSelectAt(p){
  var best=-1, bestDist=0.2;
  for(var i=0;i<__plan2d.elements.length;i++){
    var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e);
    if(d<bestDist){ bestDist=d; best=i; }
  }
  plan2dSetSelection(best);
  plan2dDraw();
}
function plan2dPointSegDist(px,py,e){
  var x0=e.x0,y0=e.y0,x1=e.x1,y1=e.y1;
  if(e && e.type==='window' && typeof e.host==='number'){
    var host = __plan2d.elements && __plan2d.elements[e.host];
    if(host && host.type==='wall'){
      var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
      x0 = host.x0 + (host.x1-host.x0)*t0; y0 = host.y0 + (host.y1-host.y0)*t0;
      x1 = host.x0 + (host.x1-host.x0)*t1; y1 = host.y0 + (host.y1-host.y0)*t1;
    }
  }
  if(e && e.type==='door' && typeof e.host==='number'){
    var hostD = __plan2d.elements && __plan2d.elements[e.host];
    if(hostD && hostD.type==='wall'){
      var td0=Math.max(0,Math.min(1,e.t0||0)), td1=Math.max(0,Math.min(1,e.t1||0));
      x0 = hostD.x0 + (hostD.x1-hostD.x0)*td0; y0 = hostD.y0 + (hostD.y1-hostD.y0)*td0;
      x1 = hostD.x0 + (hostD.x1-hostD.x0)*td1; y1 = hostD.y0 + (hostD.y1-hostD.y0)*td1;
    }
  }
  var dx=x1-x0, dy=y1-y0; var denom=(dx*dx+dy*dy)||1; var t=((px-x0)*dx+(py-y0)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=x0+t*dx, cy=y0+t*dy; var ddx=px-cx, ddy=py-cy; return Math.sqrt(ddx*ddx+ddy*ddy);
}
// Project arbitrary point onto a wall; returns param t in [0,1]
function plan2dProjectParamOnWall(p, wall){ var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var denom=dx*dx+dy*dy||1; var t=((p.x-x0)*dx+(p.y-y0)*dy)/denom; return Math.max(0,Math.min(1,t)); }

// ===== Wall subsegment modeling (intersections and openings) =====
function plan2dComputeWallIntersections(elems){
  var walls = [];
  for(var i=0;i<elems.length;i++){ var e=elems[i]; if(e && e.type==='wall' && e.wallRole!=='nonroom') walls.push({i:i, e:e}); }
  // Precompute param positions along each wall where intersections occur
  var map = {}; // wallIndex -> array of t in (0,1)
  function addT(idx, t){ if(t<=1e-6 || t>=1-1e-6) return; (map[idx]||(map[idx]=[])).push(t); }
  // Segment intersection for axis-aligned walls
  function segIntersect(ax,ay,bx,by,cx,cy,dx,dy){
    // Return intersection point if exists
    var min = Math.min, max=Math.max;
    var aH = Math.abs(ay-by) < 1e-6, cH = Math.abs(cy-dy) < 1e-6;
    if(aH && !cH){
      var y = ay; var x = cx; // vertical at x=cx
      if(x>=min(ax,bx)-1e-6 && x<=max(ax,bx)+1e-6 && y>=min(cy,dy)-1e-6 && y<=max(cy,dy)+1e-6){ return {x:x,y:y}; }
    } else if(!aH && cH){
      var y2 = cy; var x2 = ax; // vertical first wall
      if(x2>=min(cx,dx)-1e-6 && x2<=max(cx,dx)+1e-6 && y2>=min(ay,by)-1e-6 && y2<=max(ay,by)+1e-6){ return {x:x2,y:y2}; }
    } else if(aH && cH){
      // colinear horizontals: treat as no single intersection param; skip
    } else {
      // both vertical: skip
    }
    return null;
  }
  for(var a=0;a<walls.length;a++){
    for(var b=a+1;b<walls.length;b++){
      var wa=walls[a], wb=walls[b];
      var A=wa.e, B=wb.e;
      var P = segIntersect(A.x0,A.y0,A.x1,A.y1, B.x0,B.y0,B.x1,B.y1);
      if(P){
        // Add param positions along each wall
        var tA = plan2dProjectParamOnWall(P, A);
        var tB = plan2dProjectParamOnWall(P, B);
        addT(wa.i, tA); addT(wb.i, tB);
      }
    }
  }
  // Include endpoints implicitly for subsegment building (but we won't store endpoints in map)
  return map;
}

function plan2dBuildWallSubsegments(elems, wallIndex){
  var wall = elems[wallIndex]; if(!wall || wall.type!=='wall' || wall.wallRole==='nonroom') return [];
  var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var dirx=dx/len, diry=dy/len;
  // Collect split params: intersections + openings
  var ts=[0,1];
  var interMap = plan2dComputeWallIntersections(elems);
  var list = interMap[wallIndex]||[];
  for(var i=0;i<list.length;i++){ ts.push(list[i]); }
  // Openings host on this wall: push their endpoints in t
  for(var ei=0; ei<elems.length; ei++){
    var el = elems[ei]; if(!el) continue;
    if((el.type==='window' || el.type==='door') && typeof el.host==='number' && el.host===wallIndex){
      var t0=Math.max(0,Math.min(1,el.t0||0)), t1=Math.max(0,Math.min(1,el.t1||0)); if(t0>t1){var tmp=t0;t0=t1;t1=tmp;}
      ts.push(t0, t1);
    }
  }
  // Dedup and sort
  ts = ts.filter(function(v){ return v>=0 && v<=1; }).sort(function(a,b){return a-b;});
  var uniq=[]; for(var k=0;k<ts.length;k++){ if(!uniq.length || Math.abs(ts[k]-uniq[uniq.length-1])>1e-6) uniq.push(ts[k]); }
  ts = uniq;
  // Build subsegments between consecutive t's, skipping zero-length and pure opening gaps
  var subs=[];
  for(var s=0;s<ts.length-1;s++){
    var tA = ts[s], tB = ts[s+1]; if(tB <= tA + 1e-6) continue;
    // Determine if this interval is void (fully inside an opening)
    var mid = (tA+tB)/2; var isVoid=false;
    for(var ei2=0; ei2<elems.length; ei2++){
      var el2=elems[ei2]; if(!el2) continue;
      if((el2.type==='window' || el2.type==='door') && typeof el2.host==='number' && el2.host===wallIndex){
        var a0=Math.min(el2.t0||0, el2.t1||0), a1=Math.max(el2.t0||0, el2.t1||0);
        if(mid>=a0-1e-6 && mid<=a1+1e-6){ isVoid=true; break; }
      }
    }
    if(isVoid) continue;
    var ax = x0 + dirx*(tA*len), ay = y0 + diry*(tA*len);
    var bx = x1 - dirx*((1-tB)*len), by = y1 - diry*((1-tB)*len);
    subs.push({ wallIndex: wallIndex, t0: tA, t1: tB, ax: ax, ay: ay, bx: bx, by: by });
  }
  return subs;
}

function plan2dHitWallSubsegment(p, tol){
  var elems = __plan2d.elements||[]; var best=null; var bestD = (typeof tol==='number'? tol : 0.15);
  for(var wi=0; wi<elems.length; wi++){
    var w = elems[wi]; if(!w || w.type!=='wall') continue;
    var subs = plan2dBuildWallSubsegments(elems, wi);
    for(var si=0; si<subs.length; si++){
      var s = subs[si];
      // distance from point to segment s.ax,ay - s.bx,by
      var dx=s.bx-s.ax, dy=s.by-s.ay; var denom=(dx*dx+dy*dy)||1; var t=((p.x-s.ax)*dx+(p.y-s.ay)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=s.ax+t*dx, cy=s.ay+t*dy; var d=Math.hypot(p.x-cx, p.y-cy);
      if(d < bestD){ bestD = d; best = s; }
    }
  }
  return best;
}

function plan2dDeleteSelectedSubsegment(){
  var ss = __plan2d.selectedSubsegment; if(!ss) return false;
  var idx = ss.wallIndex; var wall = __plan2d.elements[idx]; if(!wall || wall.type!=='wall') return false;
  var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var thick=wall.thickness||__plan2d.wallThicknessM;
  var t0 = Math.max(0, Math.min(1, ss.t0)); var t1 = Math.max(0, Math.min(1, ss.t1)); if(t0>t1){ var tmp=t0;t0=t1;t1=tmp; }
  // Determine remaining spans: [0,t0] and [t1,1] (exclude the deleted middle), skip zero-length
  var remaining = [];
  if(t0 > 1e-6) remaining.push([0, t0]);
  if(t1 < 1-1e-6) remaining.push([t1, 1]);
  var newWalls = [];
  for(var r=0;r<remaining.length;r++){
    var a=remaining[r][0], b=remaining[r][1]; var ax=x0+dx*a, ay=y0+dy*a, bx=x0+dx*b, by=y0+dy*b;
    newWalls.push({ type:'wall', x0:ax, y0:ay, x1:bx, y1:by, thickness: thick });
  }
  var oldIndex = idx;
  var delta = newWalls.length - 1; // net change in wall count at this index
  // Update hosts for all elements referencing walls beyond oldIndex (they will shift by delta)
  var toRemove = []; // openings to remove (indices found later)
  for(var i=0;i<__plan2d.elements.length;i++){
    var e = __plan2d.elements[i]; if(!e) continue;
    if((e.type==='window'||e.type==='door') && typeof e.host==='number'){
      if(e.host === oldIndex){
        // Rehost onto one of the new walls if possible, else mark for removal
        var t0o=Math.max(0,Math.min(1,e.t0||0)), t1o=Math.max(0,Math.min(1,e.t1||0)); var mid=(t0o+t1o)/2; var placed=false;
        for(var s=0;s<remaining.length;s++){
          var aSpan=remaining[s][0], bSpan=remaining[s][1]; if(bSpan<=aSpan+1e-6) continue;
          if(mid>=aSpan-1e-6 && mid<=bSpan+1e-6){
            var spanLen=(bSpan-aSpan)||1; var nt0=(t0o-aSpan)/spanLen, nt1=(t1o-aSpan)/spanLen; nt0=Math.max(0,Math.min(1,nt0)); nt1=Math.max(0,Math.min(1,nt1));
            e.t0=nt0; e.t1=nt1; e.host = oldIndex + s; placed=true; break;
          }
        }
        if(!placed){ toRemove.push(e); }
      } else if(e.host > oldIndex){ e.host += delta; }
    }
  }
  // Replace the wall in-place with new walls
  __plan2d.elements.splice(oldIndex, 1, ...newWalls);
  // Remove any openings that fell into the deleted span
  if(toRemove.length){
    for(var rr=toRemove.length-1; rr>=0; rr--){ var el=toRemove[rr]; var idxNow = __plan2d.elements.indexOf(el); if(idxNow>=0){ __plan2d.elements.splice(idxNow,1); }
    }
  }
  return true;
}

// ===== Grid snapping and joining helpers =====
function plan2dSnap(v){ var step = (__plan2d.gridStep || 0.5); return Math.round(v/step)*step; }
function plan2dSnapPoint(p){ return { x: plan2dSnap(p.x), y: plan2dSnap(p.y) }; }
function plan2dSnapTOnWall(wall, t){
  t = Math.max(0, Math.min(1, t||0));
  var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1;
  var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var dirx=dx/len, diry=dy/len;
  var wx = x0 + dirx * (t*len), wy = y0 + diry * (t*len);
  var sp = plan2dSnapPoint({x:wx,y:wy});
  var denom = dx*dx+dy*dy||1; var tt=((sp.x-x0)*dx+(sp.y-y0)*dy)/denom; return Math.max(0, Math.min(1, tt));
}
function plan2dEq(a,b,t){ return Math.abs(a-b) <= (t||0.02); }
function plan2dAutoSnapAndJoin(){
  var els = __plan2d.elements||[];
  // 1) Snap endpoints to grid and enforce axis alignment for walls
  for(var i=0;i<els.length;i++){
    var e=els[i]; if(!e) continue;
    if(e.type==='wall'){
      e.x0=plan2dSnap(e.x0); e.y0=plan2dSnap(e.y0); e.x1=plan2dSnap(e.x1); e.y1=plan2dSnap(e.y1);
      var dx=e.x1-e.x0, dy=e.y1-e.y0; if(Math.abs(dx)>=Math.abs(dy)){ e.y1=e.y0; } else { e.x1=e.x0; }
    } else if((e.type==='window'||e.type==='door')){
      if(typeof e.host==='number'){
        var host=els[e.host]; if(host && host.type==='wall'){
          e.t0 = plan2dSnapTOnWall(host, e.t0||0);
          e.t1 = plan2dSnapTOnWall(host, e.t1||0);
        }
      } else {
        e.x0=plan2dSnap(e.x0); e.y0=plan2dSnap(e.y0); e.x1=plan2dSnap(e.x1); e.y1=plan2dSnap(e.y1);
      }
    }
  }
  // 2) Join flush when walls cross or meet
  for(var a=0;a<els.length;a++){
    var wa=els[a]; if(!wa||wa.type!=='wall') continue;
    var aH = plan2dEq(wa.y0, wa.y1);
    for(var b=a+1;b<els.length;b++){
      var wb=els[b]; if(!wb||wb.type!=='wall') continue;
      var bH = plan2dEq(wb.y0, wb.y1);
      if(aH && !bH){
        // A horizontal, B vertical
        var y = wa.y0, x = wb.x0;
        var ax0=Math.min(wa.x0,wa.x1), ax1=Math.max(wa.x0,wa.x1);
        var by0=Math.min(wb.y0,wb.y1), by1=Math.max(wb.y0,wb.y1);
        if(x>=ax0-1e-6 && x<=ax1+1e-6 && y>=by0-1e-6 && y<=by1+1e-6){
          // Snap nearby endpoints to exact intersection
          if(Math.hypot(wa.x0-x, wa.y0-y) <= 0.08){ wa.x0=x; wa.y0=y; }
          if(Math.hypot(wa.x1-x, wa.y1-y) <= 0.08){ wa.x1=x; wa.y1=y; }
          if(Math.hypot(wb.x0-x, wb.y0-y) <= 0.08){ wb.x0=x; wb.y0=y; }
          if(Math.hypot(wb.x1-x, wb.y1-y) <= 0.08){ wb.x1=x; wb.y1=y; }
        }
      } else if(!aH && bH){
        // A vertical, B horizontal
        var y2 = wb.y0, x2 = wa.x0;
        var bx0=Math.min(wb.x0,wb.x1), bx1=Math.max(wb.x0,wb.x1);
        var ay0=Math.min(wa.y0,wa.y1), ay1=Math.max(wa.y0,wa.y1);
        if(x2>=bx0-1e-6 && x2<=bx1+1e-6 && y2>=ay0-1e-6 && y2<=ay1+1e-6){
          if(Math.hypot(wa.x0-x2, wa.y0-y2) <= 0.08){ wa.x0=x2; wa.y0=y2; }
          if(Math.hypot(wa.x1-x2, wa.y1-y2) <= 0.08){ wa.x1=x2; wa.y1=y2; }
          if(Math.hypot(wb.x0-x2, wb.y0-y2) <= 0.08){ wb.x0=x2; wb.y0=y2; }
          if(Math.hypot(wb.x1-x2, wb.y1-y2) <= 0.08){ wb.x1=x2; wb.y1=y2; }
        }
      } else if(aH && bH){
        // both horizontal same Y: snap Y and any near-equal X endpoints
        if(plan2dEq(wa.y0, wb.y0, 0.05)){
          var yH = plan2dSnap(wa.y0); wa.y0=wa.y1=yH; wb.y0=wb.y1=yH;
          var ptsA=[wa.x0,wa.x1], ptsB=[wb.x0,wb.x1];
          for(var i1=0;i1<2;i1++) for(var j1=0;j1<2;j1++) if(plan2dEq(ptsA[i1], ptsB[j1], 0.05)){ var nv=plan2dSnap((ptsA[i1]+ptsB[j1])/2); ptsA[i1]=ptsB[j1]=nv; }
          wa.x0=ptsA[0]; wa.x1=ptsA[1]; wb.x0=ptsB[0]; wb.x1=ptsB[1];
        }
      } else {
        // both vertical same X
        if(plan2dEq(wa.x0, wb.x0, 0.05)){
          var xV = plan2dSnap(wa.x0); wa.x0=wa.x1=xV; wb.x0=wb.x1=xV;
          var pa=[wa.y0,wa.y1], pb=[wb.y0,wb.y1];
          for(var i2=0;i2<2;i2++) for(var j2=0;j2<2;j2++) if(plan2dEq(pa[i2], pb[j2], 0.05)){ var nv2=plan2dSnap((pa[i2]+pb[j2])/2); pa[i2]=pb[j2]=nv2; }
          wa.y0=pa[0]; wa.y1=pa[1]; wb.y0=pb[0]; wb.y1=pb[1];
        }
      }
    }
  }
}

// Hit-test near wall endpoints for dragging
function plan2dHitWallEndpoint(p, tol){
  var best=null; var bestD=tol||0.18;
  var els=__plan2d.elements||[];
  for(var i=0;i<els.length;i++){
    var e=els[i]; if(!e||e.type!=='wall') continue;
    var d0=Math.hypot(p.x-e.x0, p.y-e.y0); if(d0<bestD){ bestD=d0; best={index:i, end:'a'}; }
    var d1=Math.hypot(p.x-e.x1, p.y-e.y1); if(d1<bestD){ bestD=d1; best={index:i, end:'b'}; }
  }
  return best;
}
// Hit-test near window endpoints for dragging
function plan2dHitWindowEndpoint(p, tol){
  var best=null; var bestD=tol||0.15;
  for(var i=0;i<__plan2d.elements.length;i++){
    var e=__plan2d.elements[i]; if(e.type!=='window' || typeof e.host!=='number') continue;
    var host=__plan2d.elements[e.host]; if(!host || host.type!=='wall') continue;
    var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
    var ax=host.x0+(host.x1-host.x0)*t0, ay=host.y0+(host.y1-host.y0)*t0;
    var bx=host.x0+(host.x1-host.x0)*t1, by=host.y0+(host.y1-host.y0)*t1;
    var d0=Math.hypot(p.x-ax, p.y-ay), d1=Math.hypot(p.x-bx, p.y-by);
    if(d0<bestD){ bestD=d0; best={index:i, end:'t0'}; }
    if(d1<bestD){ bestD=d1; best={index:i, end:'t1'}; }
  }
  return best;
}

// Hit-test near door endpoints for dragging
function plan2dHitDoorEndpoint(p, tol){
  var best=null; var bestD=tol||0.15;
  for(var i=0;i<__plan2d.elements.length;i++){
    var e=__plan2d.elements[i]; if(e.type!=='door') continue;
    var ax, ay, bx, by;
    if(typeof e.host==='number'){
      var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue;
      var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
      ax = host.x0+(host.x1-host.x0)*t0; ay = host.y0+(host.y1-host.y0)*t0;
      bx = host.x0+(host.x1-host.x0)*t1; by = host.y0+(host.y1-host.y0)*t1;
      var d0=Math.hypot(p.x-ax, p.y-ay), d1=Math.hypot(p.x-bx, p.y-by);
      if(d0<bestD){ bestD=d0; best={index:i, end:'t0'}; }
      if(d1<bestD){ bestD=d1; best={index:i, end:'t1'}; }
    } else {
      ax=e.x0; ay=e.y0; bx=e.x1; by=e.y1;
      var d0f=Math.hypot(p.x-ax, p.y-ay), d1f=Math.hypot(p.x-bx, p.y-by);
      if(d0f<bestD){ bestD=d0f; best={index:i, end:'a'}; }
      if(d1f<bestD){ bestD=d1f; best={index:i, end:'b'}; }
    }
  }
  return best;
}

// Hit-test near a door segment (for sliding along host wall)
function plan2dHitDoorSegment(p, tol){
  var best = null; var bestD = (typeof tol==='number'? tol : 0.12);
  for(var i=0;i<__plan2d.elements.length;i++){
    var e = __plan2d.elements[i]; if(e.type!=='door' || typeof e.host!=='number') continue;
    var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue;
    var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
    var ax=host.x0+(host.x1-host.x0)*t0, ay=host.y0+(host.y1-host.y0)*t0;
    var bx=host.x0+(host.x1-host.x0)*t1, by=host.y0+(host.y1-host.y0)*t1;
    // Distance from point to segment
    var dx=bx-ax, dy=by-ay; var denom=(dx*dx+dy*dy)||1; var tt=((p.x-ax)*dx+(p.y-ay)*dy)/denom; tt=Math.max(0,Math.min(1,tt)); var cx=ax+tt*dx, cy=ay+tt*dy; var d=Math.hypot(p.x-cx, p.y-cy);
    if(d < bestD){ bestD = d; best = { index:i, t:tt }; }
  }
  return best;
}
// Hit-test near a window segment (for click-to-select)
function plan2dHitWindowSegment(p, tol){
  var best = null; var bestD = (typeof tol==='number'? tol : 0.15);
  for(var i=0;i<__plan2d.elements.length;i++){
    var e = __plan2d.elements[i]; if(e.type!=='window') continue;
    var ax, ay, bx, by;
    if(typeof e.host==='number'){
      var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue;
      var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
      ax = host.x0+(host.x1-host.x0)*t0; ay = host.y0+(host.y1-host.y0)*t0;
      bx = host.x0+(host.x1-host.x0)*t1; by = host.y0+(host.y1-host.y0)*t1;
    } else {
      ax=e.x0; ay=e.y0; bx=e.x1; by=e.y1;
    }
    var dx=bx-ax, dy=by-ay; var denom=(dx*dx+dy*dy)||1; var tt=((p.x-ax)*dx+(p.y-ay)*dy)/denom; tt=Math.max(0,Math.min(1,tt)); var cx=ax+tt*dx, cy=ay+tt*dy; var d=Math.hypot(p.x-cx, p.y-cy);
    if(d < bestD){ bestD = d; best = { index:i, t:tt }; }
  }
  return best;
}
// Find nearest wall element to point p within tolerance (meters)
function plan2dFindNearestWall(p, tol){
  var bestIdx = -1; var bestD = (typeof tol==='number' ? tol : 0.25);
  for(var i=0;i<__plan2d.elements.length;i++){
    var e=__plan2d.elements[i]; if(e.type!=='wall') continue;
    var d = (function(px,py,w){ var dx=w.x1-w.x0, dy=w.y1-w.y0; var denom=(dx*dx+dy*dy)||1; var t=((px-w.x0)*dx+(py-w.y0)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=w.x0+t*dx, cy=w.y0+t*dy; return Math.hypot(px-cx, py-cy); })(p.x,p.y,e);
    if(d < bestD){ bestD = d; bestIdx = i; }
  }
  if(bestIdx>=0) return { index: bestIdx, dist: bestD };
  return null;
}
function updatePlan2DInfo(){ var cnt=document.getElementById('plan2d-count'); if(cnt) cnt.textContent=__plan2d.elements.length; }
function plan2dExport(){ try{ var data=JSON.stringify(__plan2d.elements); var blob=new Blob([data],{type:'application/json'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='plan2d.json'; a.click(); URL.revokeObjectURL(a.href); updateStatus('2D plan exported'); }catch(e){ updateStatus('Export failed'); } }
// ================= END 2D FLOOR PLAN EDITOR =================