// Core logic for 2D floor plan editor (state + interaction – no rendering)
// Rendering lives in draw.js (plan2dDraw, rulers, guide hit tests).
// This file intentionally keeps only non-drawing behavior so we stay <1500 lines and avoid duplication.
(function(){
  // Global state container (shared with draw.js helpers)
  if(!window.__plan2d){
    window.__plan2d = {
      active:false,
      elements:[],          // {type:'wall'|'window'|'door', ...}
      tool:'select',         // 'wall','window','door','select','erase'
      selectedIndex:-1,
      selectedSubsegment:null,
      hoverIndex:-1,
      hoverDoorIndex:-1,
      hoverWindowIndex:-1,
      hoverSubsegment:null,
      hoverWallEnd:null,
      guidesV:[], guidesH:[], selectedGuide:null, dragGuide:null,
      scale:50, panX:0, panY:0, centerX:0, centerZ:0, yFromWorldZSign:1,
      gridStep:0.1,
      wallThicknessM:0.30,
      doorWidthM:0.92, doorHeightM:2.0,
      windowDefaultWidthM:1.2, windowSillM:1.0, windowHeightM:1.5,
      chainActive:false, chainPoints:[],
      start:null, last:null, mouse:null,
      panning:null,
      dragWindow:null, dragDoor:null, dragDoorWhole:null, maybeDragDoorWhole:null, dragWall:null,
      mouseDownPosPlan:null,
      freezeSyncUntil:0,
      wallStrokePx:1.2,
      debug:false,
      spacePanActive:false
    };
  }

  // Incremental redraw dirty rectangle helpers ---------------------------------
  // Merge a world-space bbox {minX,minY,maxX,maxY} into the current dirtyRect and flag incremental draw.
  function plan2dMarkDirty(minX, minY, maxX, maxY){
    try {
      if(minX>maxX){ var t=minX; minX=maxX; maxX=t; }
      if(minY>maxY){ var t2=minY; minY=maxY; maxY=t2; }
      var dr = __plan2d.dirtyRect;
      if(!dr){ __plan2d.dirtyRect = {minX:minX, minY:minY, maxX:maxX, maxY:maxY}; }
      else {
        dr.minX = Math.min(dr.minX, minX);
        dr.maxX = Math.max(dr.maxX, maxX);
        dr.minY = Math.min(dr.minY, minY);
        dr.maxY = Math.max(dr.maxY, maxY);
      }
      __plan2d.__incremental = true;
    }catch(_md){ /* non-fatal */ }
  }
  window.plan2dMarkDirty = window.plan2dMarkDirty || plan2dMarkDirty;

  function plan2dResetDirty(){ try{ __plan2d.dirtyRect=null; __plan2d.__incremental=false; }catch(_rd){} }
  window.plan2dResetDirty = window.plan2dResetDirty || plan2dResetDirty;

  // Draft persistence ------------------------------------------------------
  if(!window.__plan2dDrafts) window.__plan2dDrafts = {};
  function loadPlan2dDraftsFromStorage(){
    try{ var raw=localStorage.getItem('gablok_plan2dDrafts_v1'); if(!raw) return false; var data=JSON.parse(raw); if(data && typeof data==='object'){ window.__plan2dDrafts=data; return true; } }catch(e){}
    return false;
  }
  function savePlan2dDraftsToStorage(){ try{ localStorage.setItem('gablok_plan2dDrafts_v1', JSON.stringify(window.__plan2dDrafts)); }catch(e){} }
  window.loadPlan2dDraftsFromStorage = window.loadPlan2dDraftsFromStorage || loadPlan2dDraftsFromStorage;
  window.savePlan2dDraftsToStorage = window.savePlan2dDraftsToStorage || savePlan2dDraftsToStorage;

  function plan2dSaveDraft(floor){
    try {
      if(typeof floor!=='number') floor=0;
      var payload = {
        elements: JSON.parse(JSON.stringify(__plan2d.elements||[])),
        guidesV: JSON.parse(JSON.stringify(__plan2d.guidesV||[])),
        guidesH: JSON.parse(JSON.stringify(__plan2d.guidesH||[])),
        userEdited: !!__plan2d.__userEdited
      };
      window.__plan2dDrafts[floor] = payload;
      savePlan2dDraftsToStorage();
    } catch(e){}
  }
  function plan2dLoadDraft(floor){
    try {
      if(typeof floor!=='number') floor=0;
      var data = window.__plan2dDrafts[floor];
      if(data && typeof data==='object'){
        __plan2d.elements = JSON.parse(JSON.stringify(data.elements||[]));
        __plan2d.guidesV = JSON.parse(JSON.stringify(data.guidesV||[]));
        __plan2d.guidesH = JSON.parse(JSON.stringify(data.guidesH||[]));
        __plan2d.__userEdited = !!data.userEdited;
      } else {
        __plan2d.elements = [];
        __plan2d.guidesV = [];
        __plan2d.guidesH = [];
        __plan2d.__userEdited = false;
      }
      __plan2d.selectedGuide=null; __plan2d.dragGuide=null;
      plan2dSetSelection(-1);
    } catch(e){ /* non-fatal */ }
  }
  window.plan2dSaveDraft = window.plan2dSaveDraft || plan2dSaveDraft;
  window.plan2dLoadDraft = window.plan2dLoadDraft || plan2dLoadDraft;

  // Selection ---------------------------------------------------------------
  function plan2dSetSelection(idx){
    __plan2d.selectedIndex = (typeof idx==='number'? idx : -1);
    __plan2d.selectedSubsegment = null;
    try{ if(typeof window.onPlan2DSelectionChange==='function'){ window.onPlan2DSelectionChange(__plan2d.selectedIndex); } }catch(_selHook){}
  }
  window.plan2dSetSelection = window.plan2dSetSelection || plan2dSetSelection;

  // Dynamic tolerance helper (convert a pixel radius into world meters based on current scale)
  // This makes hit-tests/selection consistent regardless of zoom level.
  function plan2dWorldTolForPixels(px){ try{ var s=__plan2d.scale||50; return px/Math.max(1,s); }catch(e){ return px/50; } }
  window.plan2dWorldTolForPixels = window.plan2dWorldTolForPixels || plan2dWorldTolForPixels;

  // Edit lifecycle hook – save drafts + sync lightweight signals to 3D ------
  function plan2dEdited(){
    try { plan2dSaveDraft(typeof window.currentFloor==='number'? window.currentFloor:0); }catch(e){}
    // Bump plan version and invalidate cached computations used by drawing
    try {
      __plan2d.__version = (typeof __plan2d.__version==='number' ? __plan2d.__version+1 : 1);
      if(__plan2d.__cache){ __plan2d.__cache.intersections = null; __plan2d.__cache.version = -1; }
      __plan2d.__userEdited = true; // mark this draft as user-modified so reopen skips auto-populate
      // Disable future auto-fit after first user edit; require manual Fit button to re-enable
      if(typeof __plan2d.autoFitEnabled==='undefined' || __plan2d.autoFitEnabled===true){ __plan2d.autoFitEnabled=false; }
    } catch(_v){}
    // Record an undo checkpoint for 2D edits (coalesced per-floor)
    try { if (typeof window.historyPushChange === 'function') window.historyPushChange('plan2d-edit', { coalesce: true, coalesceKey: (typeof window.currentFloor === 'number' ? window.currentFloor : 0) }); } catch(_hpcPlan){}
  // optional non-destructive 3D sync, guarded to avoid spam during drags
    // Debounced lightweight 3D sync to prevent flooding during rapid edits
    try {
      if(Date.now() < __plan2d.freezeSyncUntil) return;
      var now = Date.now();
      var nextAllowed = (__plan2d.__next3DSync||0);
      var SYNC_INTERVAL = 250; // ms debounce window
      if (now >= nextAllowed) {
        __plan2d.__next3DSync = now + SYNC_INTERVAL;
        if(typeof window.applyPlan2DTo3D === 'function'){
          window.applyPlan2DTo3D(undefined,{allowRooms:true,quiet:true,level:(typeof window.currentFloor==='number'? window.currentFloor:0),nonDestructive:true});
        }
      } else {
        // Schedule a trailing sync if one isn't already queued
        if(!__plan2d.__syncPending){
          __plan2d.__syncPending = true;
          setTimeout(function(){
            try {
              __plan2d.__syncPending = false;
              if(typeof window.applyPlan2DTo3D === 'function'){
                window.applyPlan2DTo3D(undefined,{allowRooms:true,quiet:true,level:(typeof window.currentFloor==='number'? window.currentFloor:0),nonDestructive:true});
              }
            } catch(_ts){}
          }, Math.max(40, nextAllowed - now));
        }
      }
    } catch(e){}
  }
  window.plan2dEdited = window.plan2dEdited || plan2dEdited;

  // Simple helpers reused by interaction code ------------------------------
  function plan2dPointSegDist(px,py,e){
    var x0=e.x0,y0=e.y0,x1=e.x1,y1=e.y1;
    if(e.type==='window' && typeof e.host==='number'){
      var host=__plan2d.elements[e.host]; if(host && host.type==='wall'){ var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0)); x0=host.x0+(host.x1-host.x0)*t0; y0=host.y0+(host.y1-host.y0)*t0; x1=host.x0+(host.x1-host.x0)*t1; y1=host.y0+(host.y1-host.y0)*t1; }
    }
    if(e.type==='door' && typeof e.host==='number'){
      var hostD=__plan2d.elements[e.host]; if(hostD && hostD.type==='wall'){ var td0=Math.max(0,Math.min(1,e.t0||0)), td1=Math.max(0,Math.min(1,e.t1||0)); x0=hostD.x0+(hostD.x1-hostD.x0)*td0; y0=hostD.y0+(hostD.y1-hostD.y0)*td0; x1=hostD.x0+(hostD.x1-hostD.x0)*td1; y1=hostD.y0+(hostD.y1-hostD.y0)*td1; }
    }
    var dx=x1-x0, dy=y1-y0; var denom=(dx*dx+dy*dy)||1; var t=((px-x0)*dx+(py-y0)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=x0+t*dx, cy=y0+t*dy; var ddx=px-cx, ddy=py-cy; return Math.sqrt(ddx*ddx+ddy*ddy);
  }
  window.plan2dPointSegDist = window.plan2dPointSegDist || plan2dPointSegDist;

  function plan2dSelectAt(p){ var best=-1, bestDist=plan2dWorldTolForPixels(14); // ~14px radius
    for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; } }
    plan2dSetSelection(best); plan2dDraw(); }
  window.plan2dSelectAt = window.plan2dSelectAt || plan2dSelectAt;

  // Preferable wall pick for placing openings near cursor, robust to overlaps.
  function plan2dFindPlacementWall(p, tolPx){
    try{
      var els = __plan2d.elements || [];
      var bestIdx = -1;
      var tolW = plan2dWorldTolForPixels(typeof tolPx==='number'? tolPx : 18);
      var bestPenalty = Infinity, bestDist = Infinity, bestLen = 0;
      for(var i=0;i<els.length;i++){
        var w = els[i]; if(!w || w.type!=='wall') continue;
        var dx = w.x1 - w.x0, dy = w.y1 - w.y0; var len = Math.hypot(dx,dy) || 1;
        var denom = (dx*dx + dy*dy) || 1;
        var t = ((p.x - w.x0)*dx + (p.y - w.y0)*dy) / denom; t = Math.max(0, Math.min(1, t));
        var cx = w.x0 + t*dx, cy = w.y0 + t*dy;
        var d = Math.hypot(p.x - cx, p.y - cy);
        if (d > tolW) continue;
        var openingsNear = 0;
        for (var j=0;j<els.length;j++){
          var e = els[j]; if(!e) continue;
          if ((e.type==='window' || e.type==='door') && typeof e.host==='number' && e.host===i){
            var a = Math.min(e.t0||0, e.t1||0), b = Math.max(e.t0||0, e.t1||0); var mid = (a+b)/2;
            if (Math.abs(mid - t) < 0.08) openingsNear++;
          }
        }
        var penalty = openingsNear;
        if (penalty < bestPenalty || (penalty === bestPenalty && (d < bestDist || (Math.abs(d-bestDist) < 1e-6 && len > bestLen)))){
          bestPenalty = penalty; bestDist = d; bestIdx = i; bestLen = len;
        }
      }
      return (bestIdx >= 0) ? { index: bestIdx, dist: bestDist } : null;
    } catch(_e){ return null; }
  }
  window.plan2dFindPlacementWall = window.plan2dFindPlacementWall || plan2dFindPlacementWall;

  // Element creation -------------------------------------------------------
  // Merge colinear overlapping/adjacent axis-aligned walls into a single expanded wall.
  function plan2dMergeColinearWalls(){
    try {
      var els = __plan2d.elements || []; var changed = true; var EPS = 1e-6; var TOUCH = 0.001; // 1mm adjacency tolerance
      function axisAligned(w){ return w && w.type==='wall' && (Math.abs(w.x0 - w.x1) < EPS || Math.abs(w.y0 - w.y1) < EPS); }
      function horizontal(w){ return axisAligned(w) && Math.abs(w.y0 - w.y1) < EPS; }
      function vertical(w){ return axisAligned(w) && Math.abs(w.x0 - w.x1) < EPS; }
      function normSpan(a0,a1){ return a0<=a1? [a0,a1] : [a1,a0]; }
      function collectWindowsDoorsForWall(idx){ var out=[]; for(var i=0;i<els.length;i++){ var e=els[i]; if(!e) continue; if((e.type==='window'||e.type==='door') && typeof e.host==='number' && e.host===idx){ out.push({el:e}); } } return out; }
      function recomputeOpeningParams(opening, oldWall, newWall){
        try {
          if(!opening || !oldWall || !newWall) return;
          var owx0 = oldWall.x0 + (oldWall.x1 - oldWall.x0) * (opening.t0||0);
          var owy0 = oldWall.y0 + (oldWall.y1 - oldWall.y0) * (opening.t0||0);
          var owx1 = oldWall.x0 + (oldWall.x1 - oldWall.x0) * (opening.t1||0);
          var owy1 = oldWall.y0 + (oldWall.y1 - oldWall.y0) * (opening.t1||0);
          var dx = newWall.x1 - newWall.x0, dy = newWall.y1 - newWall.y0; var len2 = dx*dx + dy*dy || 1;
          function proj(px,py){ return Math.max(0, Math.min(1, ((px - newWall.x0)*dx + (py - newWall.y0)*dy)/len2)); }
          var nt0 = proj(owx0, owy0), nt1 = proj(owx1, owy1);
          opening.t0 = nt0; opening.t1 = nt1;
        } catch(_rp){}
      }
      while(changed){
        changed = false;
        for(var i=0;i<els.length;i++){
          var A = els[i]; if(!horizontal(A) && !vertical(A)) continue;
          for(var j=i+1;j<els.length;j++){
            var B = els[j]; if(!horizontal(B) && !vertical(B)) continue;
            // Must be same orientation and aligned on constant axis
            if(horizontal(A) && horizontal(B)){
              if(Math.abs(A.y0 - B.y0) > TOUCH) continue;
              var sA = normSpan(A.x0, A.x1), sB = normSpan(B.x0, B.x1);
              // Check overlap or touch
              if(sA[1] < sB[0] - TOUCH || sB[1] < sA[0] - TOUCH) continue;
              // Union span
              var n0 = Math.min(sA[0], sB[0]); var n1 = Math.max(sA[1], sB[1]);
              var oldA = {x0:A.x0,y0:A.y0,x1:A.x1,y1:A.y1}; var oldB = {x0:B.x0,y0:B.y0,x1:B.x1,y1:B.y1};
              A.x0 = n0; A.x1 = n1; A.y0 = A.y1 = window.plan2dSnap(A.y0);
              // Re-home openings from B to A
              var openingsB = collectWindowsDoorsForWall(j);
              for(var ob=0; ob<openingsB.length; ob++){ var op = openingsB[ob].el; op.host = i; recomputeOpeningParams(op, oldB, A); }
              // Adjust openings originally on A (due to A expansion) to maintain proportions
              var openingsA = collectWindowsDoorsForWall(i);
              for(var oa=0; oa<openingsA.length; oa++){ recomputeOpeningParams(openingsA[oa].el, oldA, A); }
              // Remove B and fix host indices (>j)
              els.splice(j,1);
              for(var k=0;k<els.length;k++){ var e=els[k]; if(e && (e.type==='window'||e.type==='door') && typeof e.host==='number' && e.host>j){ e.host -= 1; } }
              changed = true; break;
            } else if(vertical(A) && vertical(B)) {
              if(Math.abs(A.x0 - B.x0) > TOUCH) continue;
              var vA = normSpan(A.y0, A.y1), vB = normSpan(B.y0, B.y1);
              if(vA[1] < vB[0] - TOUCH || vB[1] < vA[0] - TOUCH) continue;
              var m0 = Math.min(vA[0], vB[0]); var m1 = Math.max(vA[1], vB[1]);
              var oldAv = {x0:A.x0,y0:A.y0,x1:A.x1,y1:A.y1}; var oldBv = {x0:B.x0,y0:B.y0,x1:B.x1,y1:B.y1};
              A.y0 = m0; A.y1 = m1; A.x0 = A.x1 = window.plan2dSnap(A.x0);
              var openingsBv = collectWindowsDoorsForWall(j);
              for(var obv=0; obv<openingsBv.length; obv++){ var opv = openingsBv[obv].el; opv.host = i; recomputeOpeningParams(opv, oldBv, A); }
              var openingsAv = collectWindowsDoorsForWall(i);
              for(var oav=0; oav<openingsAv.length; oav++){ recomputeOpeningParams(openingsAv[oav].el, oldAv, A); }
              els.splice(j,1);
              for(var kk=0;kk<els.length;kk++){ var ee=els[kk]; if(ee && (ee.type==='window'||ee.type==='door') && typeof ee.host==='number' && ee.host>j){ ee.host -= 1; } }
              changed = true; break;
            }
          }
          if(changed) break;
        }
      }
    } catch(e){ /* non-fatal */ }
  }
  window.plan2dMergeColinearWalls = window.plan2dMergeColinearWalls || plan2dMergeColinearWalls;

  function plan2dFinalize(a,b){ if(!a||!b) return; var dx=b.x-a.x, dy=b.y-a.y; if(Math.abs(dx)>Math.abs(dy)) b.y=a.y; else b.x=a.x; var len=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2); if(len<0.05) return; if(__plan2d.tool==='wall'){ __plan2d.elements.push({type:'wall',x0:a.x,y0:a.y,x1:b.x,y1:b.y,thickness:__plan2d.wallThicknessM, manual:true, level:(typeof window.currentFloor==='number'? window.currentFloor:0)}); plan2dMergeColinearWalls(); } else if(__plan2d.tool==='window'){ __plan2d.elements.push({type:'window',x0:a.x,y0:a.y,x1:b.x,y1:b.y,thickness:__plan2d.wallThicknessM, level:(typeof window.currentFloor==='number'? window.currentFloor:0)}); } else if(__plan2d.tool==='door'){ __plan2d.elements.push({type:'door',x0:a.x,y0:a.y,x1:b.x,y1:b.y,thickness:0.9,meta:{hinge:'left',swing:'in'}, level:(typeof window.currentFloor==='number'? window.currentFloor:0)}); } plan2dEdited(); }
  window.plan2dFinalize = window.plan2dFinalize || plan2dFinalize;

  function plan2dFinalizeChain(){ try { var pts=Array.isArray(__plan2d.chainPoints)?__plan2d.chainPoints:[]; if(pts.length<2){ __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); return; } for(var i=0;i<pts.length-1;i++){ var a=pts[i], b=pts[i+1]; var segLen=Math.hypot(b.x-a.x,b.y-a.y); if(segLen<0.05) continue; var ax=a.x, ay=a.y, bx=b.x, by=b.y; if(Math.abs(bx-ax)>Math.abs(by-ay)) by=ay; else bx=ax; __plan2d.elements.push({type:'wall',x0:ax,y0:ay,x1:bx,y1:by,thickness:__plan2d.wallThicknessM}); plan2dMergeColinearWalls(); } __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dAutoSnapAndJoin(); plan2dDraw(); plan2dEdited(); }catch(e){} }
  // Revised finalize: single snap/join pass at the end + forced full redraw to ensure room polygons appear and prevent mid-chain camera jumps.
  function plan2dFinalizeChain(){
    try {
      var pts = Array.isArray(__plan2d.chainPoints)? __plan2d.chainPoints : [];
      if(pts.length < 2){ __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); return; }
      for(var i=0;i<pts.length-1;i++){
        var a=pts[i], b=pts[i+1];
        var segLen=Math.hypot(b.x-a.x,b.y-a.y); if(segLen<0.05) continue;
        var ax=a.x, ay=a.y, bx=b.x, by=b.y;
    if(Math.abs(bx-ax)>Math.abs(by-ay)) by=ay; else bx=ax; // axis align
  __plan2d.elements.push({type:'wall',x0:ax,y0:ay,x1:bx,y1:by,thickness:__plan2d.wallThicknessM, manual:true, level:(typeof window.currentFloor==='number'? window.currentFloor:0)});
        plan2dMergeColinearWalls();
      }
      __plan2d.chainActive=false; __plan2d.chainPoints=[]; __plan2d.userDrawingActive=false;
      plan2dAutoSnapAndJoin && plan2dAutoSnapAndJoin();
      try{ __plan2d.__incremental=false; __plan2d.dirtyRect=null; }catch(_fr){}
      try{ __plan2d.freezeCenterScaleUntil = Date.now() + 600; }catch(_fz){}
      plan2dEdited();
      plan2dDraw();
    } catch(e) { /* non-fatal */ }
  }
  window.plan2dFinalizeChain = window.plan2dFinalizeChain || plan2dFinalizeChain;

  // End an active wall chain session without adding new segments. Runs snap/join once,
  // forces a full redraw so rooms appear, and freezes view to prevent jump.
  function endWallChainSession(){
    try{
      __plan2d.chainActive=false; __plan2d.userDrawingActive=false; __plan2d.chainPoints=[];
      plan2dAutoSnapAndJoin && plan2dAutoSnapAndJoin();
      try{ __plan2d.__incremental=false; __plan2d.dirtyRect=null; }catch(_fr){}
      try{ __plan2d.freezeCenterScaleUntil = Date.now() + 600; }catch(_fz){}
      plan2dEdited();
      plan2dDraw();
    }catch(_ecs){}
  }
  window.endWallChainSession = window.endWallChainSession || endWallChainSession;

  // Eraser & deletion ------------------------------------------------------
  function plan2dEraseElementAt(idx){ var arr=__plan2d.elements; if(!arr||idx<0||idx>=arr.length) return false; var removed=arr[idx]; arr.splice(idx,1); if(removed && removed.type==='wall'){ for(var i=arr.length-1;i>=0;i--){ var el=arr[i]; if((el.type==='window'||el.type==='door') && typeof el.host==='number'){ if(el.host===idx){ arr.splice(i,1); continue; } if(el.host>idx){ el.host-=1; } } } } else { for(var j=0;j<arr.length;j++){ var e=arr[j]; if((e.type==='window'||e.type==='door') && typeof e.host==='number' && e.host>idx){ e.host-=1; } } } return true; }
  window.plan2dEraseElementAt = window.plan2dEraseElementAt || plan2dEraseElementAt;
  function plan2dFindNearestOfTypes(p, types, maxDist){ var elems=__plan2d.elements||[]; var bestIdx=-1; var bestDist=(typeof maxDist==='number'? maxDist:0.2); for(var i=0;i<elems.length;i++){ var e=elems[i]; if(!e||types.indexOf(e.type)===-1) continue; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; bestIdx=i; } } return {index:bestIdx,dist:bestDist}; }
  window.plan2dFindNearestOfTypes = window.plan2dFindNearestOfTypes || plan2dFindNearestOfTypes;
  function plan2dHoverErase(p){ var best=-1, bestDist=0.25; for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; } } __plan2d.hoverIndex=best; plan2dDraw(); }
  window.plan2dHoverErase = window.plan2dHoverErase || plan2dHoverErase;
  function plan2dEraseAt(p){ var win=plan2dFindNearestOfTypes(p,['window'],0.2); if(win.index>=0){ if(plan2dEraseElementAt(win.index)){ __plan2d.hoverIndex=-1; plan2dDraw(); plan2dEdited(); } return; } var dor=plan2dFindNearestOfTypes(p,['door'],0.2); if(dor.index>=0){ if(plan2dEraseElementAt(dor.index)){ __plan2d.hoverIndex=-1; plan2dDraw(); plan2dEdited(); } return; } var segHit=plan2dHitWallSubsegment && plan2dHitWallSubsegment(p,0.15); if(segHit){ __plan2d.selectedSubsegment=segHit; if(plan2dDeleteSelectedSubsegment && plan2dDeleteSelectedSubsegment()){ __plan2d.selectedSubsegment=null; __plan2d.hoverIndex=-1; plan2dAutoSnapAndJoin(); plan2dDraw(); plan2dEdited(); return; } } plan2dHoverErase(p); if(__plan2d.hoverIndex>=0){ var delIdx=__plan2d.hoverIndex; plan2dEraseElementAt(delIdx); __plan2d.hoverIndex=-1; plan2dDraw(); plan2dEdited(); } }
  window.plan2dEraseAt = window.plan2dEraseAt || plan2dEraseAt;

  // Unified selection deletion entry point (used by global keyboard router)
  // Deletes, in priority order: selected guide, selected wall subsegment, selected element.
  // Returns true if something was removed.
  function plan2dDeleteSelection(){
    try {
      if(!window.__plan2d || !__plan2d.active) return false;
      // Guides (vertical or horizontal)
      if(__plan2d.selectedGuide){
        try {
          if(__plan2d.selectedGuide.dir==='v'){
            if(Array.isArray(__plan2d.guidesV) && __plan2d.selectedGuide.index>=0 && __plan2d.selectedGuide.index<__plan2d.guidesV.length){ __plan2d.guidesV.splice(__plan2d.selectedGuide.index,1); }
          } else if(__plan2d.selectedGuide.dir==='h') {
            if(Array.isArray(__plan2d.guidesH) && __plan2d.selectedGuide.index>=0 && __plan2d.selectedGuide.index<__plan2d.guidesH.length){ __plan2d.guidesH.splice(__plan2d.selectedGuide.index,1); }
          }
        } catch(_gdel){}
        __plan2d.selectedGuide=null; __plan2d.dragGuide=null;
        // Force full redraw (guide removal impacts overlay + potentially dirtyRect logic)
        try{ __plan2d.__incremental=false; __plan2d.dirtyRect=null; }catch(_clrG){}
        plan2dDraw(); plan2dEdited();
        return true;
      }
      // Wall subsegment (splits wall into remaining pieces and removes hosted openings)
      if(__plan2d.selectedSubsegment){
        if(typeof plan2dDeleteSelectedSubsegment==='function' && plan2dDeleteSelectedSubsegment()){
          __plan2d.selectedSubsegment=null; __plan2d.hoverIndex=-1;
          try{ plan2dAutoSnapAndJoin && plan2dAutoSnapAndJoin(); }catch(_sj){}
          try{ __plan2d.__incremental=false; __plan2d.dirtyRect=null; }catch(_clrS){}
          plan2dDraw(); plan2dEdited();
          return true;
        }
      }
      // Direct element deletion (wall/window/door)
      if(__plan2d.selectedIndex>=0){
        if(typeof plan2dEraseElementAt==='function' && plan2dEraseElementAt(__plan2d.selectedIndex)){
          plan2dSetSelection(-1);
          try{ __plan2d.__incremental=false; __plan2d.dirtyRect=null; }catch(_clrEl){}
          plan2dDraw(); plan2dEdited();
          return true;
        }
      }
    } catch(_delSel){ /* non-fatal */ }
    return false;
  }
  if(typeof window.plan2dDeleteSelection!=='function') window.plan2dDeleteSelection = plan2dDeleteSelection;

  // Bounds & view ----------------------------------------------------------
  function plan2dComputeBounds(){ var els=__plan2d.elements||[]; var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; for(var i=0;i<els.length;i++){ var e=els[i]; if(!e) continue; var include=function(x,y){ minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); }; if(e.type==='wall'){ include(e.x0,e.y0); include(e.x1,e.y1); } else if(e.type==='door' || e.type==='window'){ if(typeof e.host==='number'){ var host=els[e.host]; if(host && host.type==='wall'){ var ax=host.x0+(host.x1-host.x0)*(e.t0||0), ay=host.y0+(host.y1-host.y0)*(e.t0||0); var bx=host.x0+(host.x1-host.x0)*(e.t1||0), by=host.y0+(host.y1-host.y0)*(e.t1||0); include(ax,ay); include(bx,by); } } else { include(e.x0,e.y0); include(e.x1,e.y1); } } } if(!isFinite(minX)||!isFinite(maxX)||!isFinite(minY)||!isFinite(maxY)) return null; return {minX,minY,maxX,maxY}; }
  window.plan2dComputeBounds = window.plan2dComputeBounds || plan2dComputeBounds;
  function plan2dFitViewToContent(marginPx, opts){
    try{
      // Respect auto-fit disable unless explicitly forced
      // Global disable: never auto-fit due to object additions or syncs unless caller forces
      if(__plan2d && (__plan2d.autoFitEnabled===false || window.__disableAutoFitOnAdd===true) && !(opts && opts.force)) return false;
      var c=document.getElementById('plan2d-canvas'); if(!c) return false; var b=plan2dComputeBounds(); if(!b) return false; var dpr=window.devicePixelRatio||1; var W=c.width,H=c.height; var contentW=Math.max(0.01,b.maxX-b.minX); var contentH=Math.max(0.01,b.maxY-b.minY); var margin=Math.max(0,(marginPx||40)*dpr); var sX=(W-2*margin)/contentW; var sY=(H-2*margin)/contentH; var sNew=Math.max(10,Math.min(800,Math.min(sX,sY))); __plan2d.scale=sNew; var cx=(b.minX+b.maxX)*0.5; var cy=(b.minY+b.maxY)*0.5; __plan2d.panX=-cx; __plan2d.panY=-cy; plan2dDraw(); return true;
    }catch(e){ return false; }
  }
  window.plan2dFitViewToContent = window.plan2dFitViewToContent || plan2dFitViewToContent;

  // Animated initial fit (eased zoom) -------------------------------------
  // Provides a smooth eased transition when the 2D modal is first opened instead of a jarring jump.
  // Only runs once per modal open; subsequent population retries may still call the instant fit if needed.
  function plan2dAnimateInitialFit(marginPx, opts){
    try{
      if(!__plan2d.active) return false;
      if(__plan2d.initialZoomDone){ return plan2dFitViewToContent(marginPx); }
      var c=document.getElementById('plan2d-canvas'); if(!c) return false;
      var b=plan2dComputeBounds(); if(!b){ return plan2dFitViewToContent(marginPx); }
      var dpr=window.devicePixelRatio||1; var W=c.width,H=c.height; if(!W||!H) return false;
      var contentW=Math.max(0.01,b.maxX-b.minX); var contentH=Math.max(0.01,b.maxY-b.minY);
      var margin=Math.max(0,(marginPx||40)*dpr);
      var sX=(W-2*margin)/contentW; var sY=(H-2*margin)/contentH;
      // Allow a fixed target scale via opts.targetScale; otherwise compute a fit-based target.
      var requested = (opts && typeof opts.targetScale==='number') ? opts.targetScale : null;
      var targetScale = (requested!=null) ? Math.max(10, Math.min(800, requested)) : Math.max(10,Math.min(800,Math.min(sX,sY)));
      var cx=(b.minX+b.maxX)*0.5; var cy=(b.minY+b.maxY)*0.5; var targetPanX=-cx; var targetPanY=-cy;
      var duration = (opts && opts.durationMs) ? opts.durationMs : 600; // ms
      var easeName = (opts && opts.easing) || 'easeOutCubic';
      // Starting values: either current scale (if already near) or a gentle under-zoom to highlight motion.
      var startScale = __plan2d.scale || 50;
      // If current scale is very different, clamp start to 60% of target for a nicer motion; else keep as-is.
      if(startScale > targetScale * 0.95 || startScale < targetScale * 0.4){ startScale = targetScale * 0.6; }
      var startPanX = __plan2d.panX || 0; var startPanY = __plan2d.panY || 0;
      // Easing functions (t in [0,1])
      var easings = {
        easeOutCubic: function(t){ return 1 - Math.pow(1 - t, 3); },
        easeInOutQuad: function(t){ return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2; }
      };
      var ease = easings[easeName] || easings.easeOutCubic;
      // Lock interactive zoom/pan during animation to avoid jumping.
      __plan2d.zoomLocked = true;
      var anim = { start: performance.now(), duration: duration, canceled:false };
      __plan2d.__initialAnim = anim;
      var reveal = !!(opts && opts.revealCanvas);
      var revealed=false;
      var lockPan = !!(opts && opts.lockPan);
      function step(){
        if(anim.canceled){ return; }
        // Abort if user starts drawing or panning mid-animation (respect user intent)
        if(__plan2d.userDrawingActive || __plan2d.panning){ anim.canceled=true; __plan2d.zoomLocked=false; plan2dFitViewToContent(marginPx); __plan2d.initialZoomDone=true; return; }
        var now = performance.now(); var t = (now - anim.start)/anim.duration; if(t >= 1){ t = 1; }
        var k = ease(t);
        __plan2d.scale = startScale + (targetScale - startScale) * k;
        if(!lockPan){
          __plan2d.panX = startPanX + (targetPanX - startPanX) * k;
          __plan2d.panY = startPanY + (targetPanY - startPanY) * k;
        }
        if(reveal && !revealed){
          try{
            var ov=document.getElementById('plan2d-overlay');
            var l2=document.getElementById('labels-2d');
            c.style.visibility='visible'; if(ov) ov.style.visibility='visible'; if(l2) l2.style.visibility='visible';
          }catch(_rv){}
          revealed=true;
        }
        // Update scale label live for feedback
        try{ var scl=document.getElementById('plan2d-scale'); if(scl){ scl.textContent='1:'+Math.round(100*(100/__plan2d.scale))/100; } }catch(_sl){}
        plan2dDraw();
        if(t < 1){ requestAnimationFrame(step); } else { __plan2d.zoomLocked=false; __plan2d.initialZoomDone=true; }
      }
      requestAnimationFrame(step);
      return true;
    }catch(e){ return false; }
  }
  window.plan2dAnimateInitialFit = window.plan2dAnimateInitialFit || plan2dAnimateInitialFit;

  // Flip vertical axis (mirror) -------------------------------------------
  function plan2dFlipVertical(){ try{ var els=__plan2d.elements||[]; for(var i=0;i<els.length;i++){ var e=els[i]; if(!e) continue; if(e.type==='wall'){ e.y0=-(e.y0||0); e.y1=-(e.y1||0); } else if(e.type==='window' || e.type==='door'){ if(typeof e.host!=='number'){ e.y0=-(e.y0||0); e.y1=-(e.y1||0); } } } __plan2d.yFromWorldZSign = (__plan2d.yFromWorldZSign===1? -1:1); plan2dSetSelection(-1); __plan2d.dragWindow=__plan2d.dragDoor=__plan2d.dragDoorWhole=__plan2d.dragWall=null; __plan2d.start=null; __plan2d.last=null; plan2dDraw(); plan2dEdited(); }catch(e){} }
  window.plan2dFlipVertical = window.plan2dFlipVertical || plan2dFlipVertical;

  // UI helpers -------------------------------------------------------------
  function plan2dUpdateActiveButtons(){ try{ var ids=['plan2d-tool-wall','plan2d-tool-window','plan2d-tool-door','plan2d-tool-select','plan2d-tool-erase']; for(var i=0;i<ids.length;i++){ var el=document.getElementById(ids[i]); if(el) el.classList.remove('active'); } var map={wall:'plan2d-tool-wall',window:'plan2d-tool-window',door:'plan2d-tool-door',select:'plan2d-tool-select',erase:'plan2d-tool-erase'}; var id=map[__plan2d.tool]; var btn=id&&document.getElementById(id); if(btn) btn.classList.add('active'); }catch(e){} }
  function plan2dCursor(){ var c=document.getElementById('plan2d-canvas'); if(!c) return; c.style.cursor = (__plan2d.tool==='erase')? 'not-allowed' : (__plan2d.tool==='select' ? 'pointer' : 'crosshair'); plan2dUpdateActiveButtons(); }
  window.plan2dCursor = window.plan2dCursor || plan2dCursor;

  // Centralized tool switching so all code paths (UI and programmatic) keep consistent state.
  function plan2dSetTool(tool){
    try{
      if(!tool) return;
      var prev = __plan2d.tool;
      if(prev === tool){ plan2dCursor(); plan2dDraw && plan2dDraw(); return; }
      __plan2d.tool = tool;
      // Sync selected state on toolbar buttons if present
      try {
        var ids = { select: 'plan2d-tool-select', wall:'plan2d-tool-wall', window:'plan2d-tool-window', door:'plan2d-tool-door', erase:'plan2d-tool-erase' };
        Object.keys(ids).forEach(function(k){ var b=document.getElementById(ids[k]); if(b) b.classList.toggle('selected', k===tool); });
      } catch(_syncSel){}
      // Leaving Wall: clear any in-progress chain so guides don't linger
      if(prev === 'wall' && tool !== 'wall'){
        __plan2d.chainActive = false; __plan2d.chainPoints = []; __plan2d.userDrawingActive=false;
      }
      // Entering Wall fresh: ensure clean start and show hint on first point
      if(tool === 'wall' && prev !== 'wall'){
        __plan2d.chainActive = false; __plan2d.chainPoints = []; __plan2d.userDrawingActive=false;
        __plan2d.__showWallHintNext = true; // display a small hint when the chain actually starts
      }
      plan2dCursor();
      plan2dDraw && plan2dDraw();
    }catch(_st){}
  }
  window.plan2dSetTool = window.plan2dSetTool || plan2dSetTool;

  // Event binding ----------------------------------------------------------
  function plan2dBind(){ var c=document.getElementById('plan2d-canvas'); if(!c) return; if(window.__plan2dResize) return; // already bound
    window.__plan2dResize = function(){
      try {
        var c=document.getElementById('plan2d-canvas');
        var ov=document.getElementById('plan2d-overlay');
        var rt=document.getElementById('plan2d-ruler-top');
        var rl=document.getElementById('plan2d-ruler-left');
        var l2=document.getElementById('labels-2d');
        if(!c||!ov) return;
        var rect=c.getBoundingClientRect();
        var dpr=window.devicePixelRatio||1;
        var W=Math.floor(rect.width*dpr), H=Math.floor(rect.height*dpr);
        if(c.width!==W||c.height!==H){ c.width=W; c.height=H; }
        if(ov.width!==W||ov.height!==H){ ov.width=W; ov.height=H; }
        if(l2 && (l2.width!==W||l2.height!==H)){ l2.width=W; l2.height=H; }
        // Top ruler width should match drawing width, height fixed 28 CSS px
        if(rt){ var stage=document.getElementById('plan2d-stage'); var sr=stage?stage.getBoundingClientRect():rect; var rtw=Math.floor(sr.width*dpr); var rth=Math.floor(28*dpr); if(rt.width!==rtw||rt.height!==rth){ rt.width=rtw; rt.height=rth; } }
        // Left ruler spans from below top ruler to bottom of viewport; width fixed 28 CSS px
        if(rl){ var rlw=Math.floor(28*dpr); var vh=Math.floor((window.innerHeight||document.documentElement.clientHeight||rect.height)*dpr) - Math.floor(28*dpr); if(vh<0) vh=0; if(rl.width!==rlw||rl.height!==vh){ rl.width=rlw; rl.height=vh; } }
        plan2dDraw();
      } catch(e){}
    };
    window.addEventListener('resize', window.__plan2dResize);

    // Allow pulling new guides from rulers
    try {
      var rt=document.getElementById('plan2d-ruler-top');
      var rl=document.getElementById('plan2d-ruler-left');
      if(rt){ rt.addEventListener('mousedown', function(ev){ if(!__plan2d.active) return; if(__plan2d.zoomLocked) return; try{
          var crect=c.getBoundingClientRect();
          var cx=(ev.clientX-crect.left)*(c.width/crect.width);
          // Use canvas mid-height for world mapping (x only matters)
          var cy=(c.height||0)/2;
          var wx = screenToWorld2D(cx, cy).x;
          var idx = (__plan2d.guidesV||(__plan2d.guidesV=[])).push(plan2dSnap(wx)) - 1;
          __plan2d.selectedGuide = { dir:'v', index: idx };
          __plan2d.dragGuide = { dir:'v', index: idx, value: __plan2d.guidesV[idx], startScreen:{x:cx,y:cy}, origValue: __plan2d.guidesV[idx] };
          plan2dDraw();
        }catch(_rt){} }); }
      if(rl){ rl.addEventListener('mousedown', function(ev){ if(!__plan2d.active) return; if(__plan2d.zoomLocked) return; try{
          var crect=c.getBoundingClientRect();
          var cy=(ev.clientY-crect.top)*(c.height/crect.height);
          var cx=(c.width||0)/2;
          var wy = screenToWorld2D(cx, cy).y;
          var idxH = (__plan2d.guidesH||(__plan2d.guidesH=[])).push(plan2dSnap(wy)) - 1;
          __plan2d.selectedGuide = { dir:'h', index: idxH };
          __plan2d.dragGuide = { dir:'h', index: idxH, value: __plan2d.guidesH[idxH], startScreen:{x:cx,y:cy}, origValue: __plan2d.guidesH[idxH] };
          plan2dDraw();
        }catch(_rl){} }); }
    } catch(_bindRulers){}

    c.addEventListener('mousedown', function(ev){ if(!__plan2d.active) return; 
      // Lock interactions during initial eased zoom to prevent flashes/jumps
      if(__plan2d.zoomLocked){ ev.preventDefault(); ev.stopPropagation(); return; }
      var rect=c.getBoundingClientRect(); var cx=(ev.clientX-rect.left)*(c.width/rect.width); var cy=(ev.clientY-rect.top)*(c.height/rect.height); var p=screenToWorld2D(cx,cy); __plan2d.mouseDownPosPlan=p; 
      // Guide selection / drag start (always available regardless of tool)
      try {
        var hitGuide = (typeof plan2dHitGuideAtScreen==='function') ? plan2dHitGuideAtScreen(cx, cy) : null;
        if(hitGuide){
          __plan2d.selectedGuide = { dir: hitGuide.dir, index: hitGuide.index };
          // Begin dragging existing guide
          var gv = (hitGuide.dir==='v'? __plan2d.guidesV[hitGuide.index] : __plan2d.guidesH[hitGuide.index]);
          __plan2d.dragGuide = { dir: hitGuide.dir, index: hitGuide.index, value: gv, startScreen:{x:cx,y:cy}, origValue: gv };
          plan2dDraw();
          return; // don't start other interactions
        }
      }catch(_gsel){}
      // Window/Door endpoint drag start: allow resizing via select tool or direct tool click
      try{
        if(typeof plan2dHitWindowEndpoint==='function'){
          var hw = plan2dHitWindowEndpoint(p, plan2dWorldTolForPixels(12));
          if(hw && typeof hw.index==='number'){
            __plan2d.dragWindow = { index: hw.index, end: hw.end }; plan2dSetSelection(hw.index); plan2dDraw(); return;
          }
        }
      }catch(_hw){}
      try{
        if(typeof plan2dHitDoorEndpoint==='function'){
          var hd = plan2dHitDoorEndpoint(p, plan2dWorldTolForPixels(12));
          if(hd && typeof hd.index==='number'){
            __plan2d.dragDoor = { index: hd.index, end: hd.end }; plan2dSetSelection(hd.index); plan2dDraw(); return;
          }
        }
      }catch(_hd){}
      // Spacebar panning: if space held, start panning regardless of tool and do not modify drawing state
      if(__plan2d.spacePanActive){ if(!__plan2d.zoomLocked){ __plan2d.panning={ mx:cx, my:cy, panX0:__plan2d.panX||0, panY0:__plan2d.panY||0, scale: __plan2d.scale||50 }; plan2dDraw(); } return; }
      if(__plan2d.tool==='erase'){ plan2dEraseAt(p); return; }
      // Wall endpoint drag start (Select tool only)
      if(__plan2d.tool==='select'){
        try {
          var hitEnd = plan2dHitWallEndpoint && plan2dHitWallEndpoint(p, 0.30);
          if(hitEnd && typeof hitEnd.index==='number'){
            var w = __plan2d.elements[hitEnd.index];
            if(w && w.type==='wall'){
              __plan2d.dragWall = {
                index: hitEnd.index,
                end: hitEnd.end, // 'a' or 'b'
                other: (hitEnd.end==='a'? {x: w.x1, y: w.y1} : {x: w.x0, y: w.y0}),
                orig: (hitEnd.end==='a'? {x: w.x0, y: w.y0} : {x: w.x1, y: w.y1})
              };
              plan2dSetSelection(hitEnd.index);
              plan2dDraw();
              return; // do not start selection gesture
            }
          }
        }catch(_we){}
      }
      if(__plan2d.tool==='wall'){
        // Improved wall tool: create a segment immediately on second click instead of waiting for Enter.
        // Start a chain on first click; each subsequent click adds a wall from last point -> new point (axis aligned & snapped).
        var pt = { x: plan2dSnap(p.x), y: plan2dSnap(p.y) };
        if(!__plan2d.chainActive){
          __plan2d.chainActive=true; __plan2d.chainPoints=[pt];
          // Mark user drawing session start: suppress population recentering/auto-fit while actively placing walls
          __plan2d.userDrawingActive = true;
          // UX hint: only on the first point after switching into Wall
          try{
            if(__plan2d.__showWallHintNext){ __plan2d.__showWallHintNext=false; if(typeof updateStatus==='function'){ updateStatus('New wall: click to add points (Enter, double-click, or right-click to finish)'); } }
          }catch(_hint){}
        } else {
          var prev = __plan2d.chainPoints[__plan2d.chainPoints.length-1];
          if(prev){
            var ax = prev.x, ay = prev.y, bx = pt.x, by = pt.y;
            // axis alignment (preserve dominant axis)
            if(Math.abs(bx-ax) >= Math.abs(by-ay)) by = ay; else bx = ax;
            var segLen = Math.hypot(bx-ax, by-ay);
            if(segLen >= 0.05){
              __plan2d.elements.push({type:'wall', x0:ax, y0:ay, x1:bx, y1:by, thickness:__plan2d.wallThicknessM, manual:true, level:(typeof window.currentFloor==='number'? window.currentFloor:0)});
              plan2dEdited();
            }
            // Add the (potentially adjusted) endpoint for the continuing chain preview
            __plan2d.chainPoints.push({x:bx, y:by});
            // Defer auto-snap/join until chain finalize to avoid mid-chain endpoint shifts & view jumps.
            // (Final pass happens in plan2dFinalizeChain.)
          }
        }
        plan2dDraw();
        return;
      }
      if(__plan2d.tool==='window' || __plan2d.tool==='door'){
        // Single-click anchored placement on nearest wall (fallback to drag-create if Shift held)
        try {
          if(ev.shiftKey){ /* allow legacy drag gesture */ }
          else {
            // Use improved placement wall finder (robust to overlapping walls)
            var near = (typeof plan2dFindPlacementWall==='function') ? plan2dFindPlacementWall(p, 22) : ((typeof plan2dFindNearestWall==='function') ? plan2dFindNearestWall(p, 0.35) : null);
            if(near && typeof near.index==='number'){
              var wall = __plan2d.elements[near.index];
              if(wall && wall.type==='wall'){
                // Freeze center/scale briefly so adding multiple openings doesn't refit/zoom the view each time.
                try{ __plan2d.freezeCenterScaleUntil = Date.now() + 400; }catch(_frz){}
                // Auto-fit disable since user has begun interactive placement session
                __plan2d.autoFitEnabled=false;
                var tCenter = (typeof plan2dProjectParamOnWall==='function') ? plan2dProjectParamOnWall(p, wall) : 0.5;
                var wdx = wall.x1-wall.x0, wdy = wall.y1-wall.y0; var wLen = Math.hypot(wdx,wdy)||1;
                var openingWidth = (__plan2d.tool==='door' ? (__plan2d.doorWidthM||0.92) : (__plan2d.windowDefaultWidthM||1.2));
                var halfT = (openingWidth/2)/wLen;
                var t0 = Math.max(0, Math.min(1, tCenter-halfT));
                var t1 = Math.max(0, Math.min(1, tCenter+halfT));
                if(t1 < t0){ var tmp=t0; t0=t1; t1=tmp; }
                // Clamp opening to avoid full 0-length collapse on tiny walls
                if(Math.abs(t1 - t0) < 0.01){ var mid=(t0+t1)/2; t0=Math.max(0, mid-0.005); t1=Math.min(1, mid+0.005); }
                var el = { type: (__plan2d.tool==='door' ? 'door':'window'), host: near.index, t0: t0, t1: t1, thickness: (__plan2d.tool==='door'? (__plan2d.doorWidthM||0.92): (__plan2d.wallThicknessM||0.30)), level:(typeof window.currentFloor==='number'? window.currentFloor:0) };
                if(__plan2d.tool==='door'){ el.meta={hinge:'left',swing:'in'}; }
                // Merge logic for window expansion: if placing a window and an existing window on the same wall overlaps or touches
                if(__plan2d.tool==='window'){
                  try {
                    var eps = 0.002; // ~2mm tolerance for adjacency
                    var spanA0 = Math.min(el.t0, el.t1), spanA1 = Math.max(el.t0, el.t1);
                    for(var mi=0; mi<__plan2d.elements.length; mi++){
                      var other = __plan2d.elements[mi];
                      if(!other || other.type!=='window' || typeof other.host!=='number' || other.host!==near.index) continue;
                      var o0 = Math.min(other.t0||0, other.t1||0), o1 = Math.max(other.t0||0, other.t1||0);
                      // Overlap or immediate touch check
                      var overlap = !(spanA1 < o0 - eps || spanA0 > o1 + eps);
                      if(overlap){
                        // Expand existing window span to cover union; prefer keeping sill/height of existing
                        var n0 = Math.min(spanA0, o0), n1 = Math.max(spanA1, o1);
                        other.t0 = n0; other.t1 = n1;
                        // Do not add new window; treat as resize
                        el = null;
                        // Select the merged window for immediate feedback
                        try { plan2dSetSelection && plan2dSetSelection(mi); }catch(_selM){}
                        break;
                      }
                    }
                  } catch(_mergeWin) { /* non-fatal */ }
                }
                if(el){ __plan2d.elements.push(el); }
                // Ensure full redraw so the new window appears immediately (avoid stale dirtyRect region)
                try{ __plan2d.__incremental=false; __plan2d.dirtyRect=null; }catch(_clr){}
                plan2dEdited();
                // Optionally select the newly added element for instant handle visibility
                try{ if(el){ var newIdx=__plan2d.elements.length-1; plan2dSetSelection && plan2dSetSelection(newIdx); } }catch(_selNew){}
                plan2dDraw();
                return; // placed; stop
              }
            }
          }
        }catch(_place){ /* fallback to legacy drag below */ }
        // Legacy drag-create path if not anchored; begin selection gesture for finalize() logic
      }
      if(__plan2d.tool==='select'){
        // Prefer selecting openings over their host wall when overlapping.
        try{
          var tolSeg = plan2dWorldTolForPixels(10);
          var winHit = (typeof plan2dHitWindowSegment==='function') ? plan2dHitWindowSegment(p, tolSeg) : null;
          if(winHit && typeof winHit.index==='number'){ plan2dSetSelection(winHit.index); plan2dDraw(); return; }
          var doorHit = (typeof plan2dHitDoorSegment==='function') ? plan2dHitDoorSegment(p, tolSeg*0.9) : null;
          if(doorHit && typeof doorHit.index==='number'){ plan2dSetSelection(doorHit.index); plan2dDraw(); return; }
        }catch(_prefSel){}
        // Fallback: nearest element within tolerance; else start panning
        var best=-1, bestDist=plan2dWorldTolForPixels(12);
        for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; } }
        if(best<0){ __plan2d.panning={ mx:cx, my:cy, panX0:__plan2d.panX||0, panY0:__plan2d.panY||0, scale: __plan2d.scale||50 }; plan2dDraw(); return; }
        plan2dSetSelection(best);
      }
      // selection gesture (fallback)
      __plan2d.start=p; __plan2d.last=p; plan2dDraw(); });

    c.addEventListener('mousemove', function(ev){ if(!__plan2d.active) return; if(__plan2d.zoomLocked){ return; } var rect=c.getBoundingClientRect(); var cx=(ev.clientX-rect.left)*(c.width/rect.width); var cy=(ev.clientY-rect.top)*(c.height/rect.height); __plan2d.mouse={x:cx,y:cy}; var p=screenToWorld2D(cx,cy);
      // Window/door endpoint dragging: update t0/t1 while dragging
      if(__plan2d.dragWindow){
        try{
          var dw = __plan2d.dragWindow; var we = __plan2d.elements[dw.index]; if(we && we.type==='window' && typeof we.host==='number'){ var host = __plan2d.elements[we.host]; if(host && host.type==='wall'){ var t = (typeof plan2dProjectParamOnWall==='function') ? plan2dProjectParamOnWall(p, host) : 0.5; var prevT0 = we.t0, prevT1 = we.t1; if(dw.end==='t0' || dw.end==='a' || dw.end==='t0'){ we.t0 = Math.max(0, Math.min(1, t)); } else { we.t1 = Math.max(0, Math.min(1, t)); } if(we.t1 < we.t0){ var tmp=we.t0; we.t0=we.t1; we.t1=tmp; dw.end = (dw.end==='t0'?'t1':'t0'); }
            // Dirty region: span endpoints (old + new) projected to world along host wall
            try{
              var wallLen = Math.hypot(host.x1-host.x0, host.y1-host.y0)||1;
              function spanPoint(tVal){ return { x: host.x0 + (host.x1-host.x0)*tVal, y: host.y0 + (host.y1-host.y0)*tVal }; }
              var aPrev = spanPoint(Math.max(0,Math.min(1,prevT0)));
              var bPrev = spanPoint(Math.max(0,Math.min(1,prevT1)));
              var aNow  = spanPoint(Math.max(0,Math.min(1,we.t0)));
              var bNow  = spanPoint(Math.max(0,Math.min(1,we.t1)));
              var pad = (__plan2d.wallThicknessM||0.3) * 1.2; // expand slightly beyond wall thickness
              var minX = Math.min(aPrev.x,bPrev.x,aNow.x,bNow.x) - pad;
              var maxX = Math.max(aPrev.x,bPrev.x,aNow.x,bNow.x) + pad;
              var minY = Math.min(aPrev.y,bPrev.y,aNow.y,bNow.y) - pad;
              var maxY = Math.max(aPrev.y,bPrev.y,aNow.y,bNow.y) + pad;
              plan2dMarkDirty(minX,minY,maxX,maxY);
            }catch(_dwin){}
            plan2dDraw(); } }
        }catch(_dwMove){}
        return;
      }
      if(__plan2d.dragDoor){
        try{
          var ddw = __plan2d.dragDoor; var de = __plan2d.elements[ddw.index]; if(de && de.type==='door' && typeof de.host==='number'){ var hostD = __plan2d.elements[de.host]; if(hostD && hostD.type==='wall'){ var t2 = (typeof plan2dProjectParamOnWall==='function') ? plan2dProjectParamOnWall(p, hostD) : 0.5; var prevT0d = de.t0, prevT1d = de.t1; if(ddw.end==='t0' || ddw.end==='a' || ddw.end==='t0'){ de.t0 = Math.max(0, Math.min(1, t2)); } else { de.t1 = Math.max(0, Math.min(1, t2)); } if(de.t1 < de.t0){ var tmp2=de.t0; de.t0=de.t1; de.t1=tmp2; ddw.end = (ddw.end==='t0'?'t1':'t0'); }
            // Dirty region for door span change
            try{
              function spanPointD(tVal){ return { x: hostD.x0 + (hostD.x1-hostD.x0)*tVal, y: hostD.y0 + (hostD.y1-hostD.y0)*tVal }; }
              var aPrevD = spanPointD(Math.max(0,Math.min(1,prevT0d)));
              var bPrevD = spanPointD(Math.max(0,Math.min(1,prevT1d)));
              var aNowD  = spanPointD(Math.max(0,Math.min(1,de.t0)));
              var bNowD  = spanPointD(Math.max(0,Math.min(1,de.t1)));
              var padD = (__plan2d.wallThicknessM||0.3) * 1.4;
              var minXD = Math.min(aPrevD.x,bPrevD.x,aNowD.x,bNowD.x) - padD;
              var maxXD = Math.max(aPrevD.x,bPrevD.x,aNowD.x,bNowD.x) + padD;
              var minYD = Math.min(aPrevD.y,bPrevD.y,aNowD.y,bNowD.y) - padD;
              var maxYD = Math.max(aPrevD.y,bPrevD.y,aNowD.y,bNowD.y) + padD;
              plan2dMarkDirty(minXD,minYD,maxXD,maxYD);
            }catch(_ddirty){}
            plan2dDraw(); } }
        }catch(_ddMove){}
        return;
      }
      // Dragging a guide
      if(__plan2d.dragGuide){
        try {
          if(__plan2d.dragGuide.dir==='v'){
            // Convert screen x to world x
            var wx = screenToWorld2D(cx, cy).x; // only x matters
            // Optional snap to nearby guides (excluding itself) for stability
            var snapTol = 0.02; var closest = null; var guides = __plan2d.guidesV||[];
            for(var i=0;i<guides.length;i++){ if(i===__plan2d.dragGuide.index) continue; var d=Math.abs(guides[i]-wx); if(d<snapTol && (closest==null || d<closest.d)){ closest={v:guides[i],d:d}; } }
            if(closest) wx = closest.v;
            __plan2d.dragGuide.value = plan2dSnap(wx);
            __plan2d.guidesV[__plan2d.dragGuide.index] = __plan2d.dragGuide.value;
          } else {
            var wy = screenToWorld2D(cx, cy).y; var snapTolH = 0.02; var closestH = null; var gH = __plan2d.guidesH||[];
            for(var j=0;j<gH.length;j++){ if(j===__plan2d.dragGuide.index) continue; var d2=Math.abs(gH[j]-wy); if(d2<snapTolH && (closestH==null || d2<closestH.d)){ closestH={v:gH[j],d:d2}; } }
            if(closestH) wy = closestH.v;
            __plan2d.dragGuide.value = plan2dSnap(wy);
            __plan2d.guidesH[__plan2d.dragGuide.index] = __plan2d.dragGuide.value;
          }
          // Mark a thin dirty column/row around the moved guide for incremental redraw
          try {
            var padGuide = 0.25; // meters
            if(__plan2d.dragGuide.dir==='v'){
              var gx = __plan2d.dragGuide.value; plan2dMarkDirty(gx-padGuide, -1e6, gx+padGuide, 1e6);
            } else {
              var gy = __plan2d.dragGuide.value; plan2dMarkDirty(-1e6, gy-padGuide, 1e6, gy+padGuide);
            }
          }catch(_gdirty){}
          plan2dDraw();
        }catch(_gdrag){}
        return;
      }
      // Panning when dragging on empty space with Select tool
  if(__plan2d.panning){ var s=__plan2d.panning.scale||(__plan2d.scale||50); var dx=cx-__plan2d.panning.mx; var dy=cy-__plan2d.panning.my; __plan2d.panX = (__plan2d.panning.panX0||0) + dx/Math.max(1e-6,s); __plan2d.panY = (__plan2d.panning.panY0||0) - dy/Math.max(1e-6,s); plan2dResetDirty(); plan2dDraw(); return; }
      // Dragging a wall endpoint
      if(__plan2d.dragWall){
        try {
          var dw = __plan2d.dragWall;
          var w = __plan2d.elements[dw.index];
          if(w && w.type==='wall'){
            // Current raw position
            var nx = p.x, ny = p.y;
            // Previous endpoint world coords (for dirty rectangle)
            var prevX = (dw.end==='a'? w.x0 : w.x1);
            var prevY = (dw.end==='a'? w.y0 : w.y1);
            // If Shift held, quantize direction to 45° increments
            if(ev.shiftKey){
              var ox = dw.other.x, oy = dw.other.y;
              var dx = nx - ox, dy = ny - oy;
              var len = Math.hypot(dx,dy) || 0;
              if(len > 1e-6){
                var ang = Math.atan2(dy,dx);
                var step = Math.PI/4; // 45°
                var q = Math.round(ang/step)*step; // quantized angle
                // preserve length; recompute snapped vector
                dx = len * Math.cos(q);
                dy = len * Math.sin(q);
                nx = ox + dx;
                ny = oy + dy;
              }
            }
            // Grid snap ALWAYS after quantization for consistency
            nx = plan2dSnap(nx); ny = plan2dSnap(ny);
            if(dw.end==='a'){ w.x0 = nx; w.y0 = ny; } else { w.x1 = nx; w.y1 = ny; }
            // Mark dirty region (union of previous and new endpoint + other endpoint)
            try {
              var oxp = dw.other.x, oyp = dw.other.y;
              var minX = Math.min(prevX, nx, oxp), maxX = Math.max(prevX, nx, oxp);
              var minY = Math.min(prevY, ny, oyp), maxY = Math.max(prevY, ny, oyp);
              var dr = __plan2d.dirtyRect;
              if(!dr){
                __plan2d.dirtyRect = {minX:minX, maxX:maxX, minY:minY, maxY:maxY};
              } else {
                dr.minX = Math.min(dr.minX, minX);
                dr.maxX = Math.max(dr.maxX, maxX);
                dr.minY = Math.min(dr.minY, minY);
                dr.maxY = Math.max(dr.maxY, maxY);
              }
              __plan2d.__incremental = true;
            }catch(_dr){}
            // Live draw only (defer applyPlan2DTo3D until mouseup to reduce churn)
            plan2dDraw();
          }
        }catch(_dwMove){}
        return;
      }
      if(__plan2d.tool==='erase'){ plan2dHoverErase(p); return; }
      if(__plan2d.start){ __plan2d.last=p; plan2dDraw(); return; }
      // For wall chain drawing and opening previews, redraw continuously
      if((__plan2d.tool==='wall' && __plan2d.chainActive) || __plan2d.tool==='window' || __plan2d.tool==='door'){ plan2dDraw(); return; }
      // Select tool hover feedback: recompute hover targets, draw only on change to avoid flicker
      if(__plan2d.tool==='select'){
        try{
          var prevDoor = __plan2d.hoverDoorIndex, prevWindow = __plan2d.hoverWindowIndex, prevSeg = __plan2d.hoverSubsegment, prevEnd = __plan2d.hoverWallEnd && __plan2d.hoverWallEnd.index;
          var segTol = plan2dWorldTolForPixels(9);
          var hitDoor = (typeof plan2dHitDoorSegment==='function') ? plan2dHitDoorSegment(p, segTol*0.9) : null;
          __plan2d.hoverDoorIndex = hitDoor && typeof hitDoor.index==='number' ? hitDoor.index : -1;
          var hitWin = (typeof plan2dHitWindowSegment==='function') ? plan2dHitWindowSegment(p, segTol) : null;
          __plan2d.hoverWindowIndex = hitWin && typeof hitWin.index==='number' ? hitWin.index : -1;
          // Only compute wall subsegment if not hovering a door/window to reduce visual noise
          __plan2d.hoverSubsegment = null;
          if(__plan2d.hoverDoorIndex<0 && __plan2d.hoverWindowIndex<0){
            __plan2d.hoverSubsegment = (typeof plan2dHitWallSubsegment==='function') ? plan2dHitWallSubsegment(p, segTol) : null;
          }
          // Endpoint affordance
          __plan2d.hoverWallEnd = (typeof plan2dHitWallEndpoint==='function') ? plan2dHitWallEndpoint(p, plan2dWorldTolForPixels(18)) : null;
          var changed = (prevDoor !== __plan2d.hoverDoorIndex) || (prevWindow !== __plan2d.hoverWindowIndex) || (prevSeg !== __plan2d.hoverSubsegment) || ((prevEnd||-2) !== (__plan2d.hoverWallEnd && __plan2d.hoverWallEnd.index));
          if(changed){ plan2dDraw(); }
          return;
        }catch(_hv){ /* fallback: no redraw to avoid flicker */ return; }
      }
      // Default: no-op on idle mouse move to avoid unnecessary redraws that can cause flashing
      return;
    });

    // Window-level mousemove to continue guide dragging even when cursor is over rulers or outside canvas
    if(!window.__plan2dMousemove){ window.__plan2dMousemove = function(ev){ if(!__plan2d.active) return; if(!__plan2d.dragGuide) return; try{
        var crect=c.getBoundingClientRect();
        var cx=(ev.clientX-crect.left)*(c.width/crect.width);
        var cy=(ev.clientY-crect.top)*(c.height/crect.height);
        if(__plan2d.dragGuide.dir==='v'){
          var wx = screenToWorld2D(cx, cy).x; __plan2d.dragGuide.value = plan2dSnap(wx); __plan2d.guidesV[__plan2d.dragGuide.index] = __plan2d.dragGuide.value;
        } else {
          var wy = screenToWorld2D(cx, cy).y; __plan2d.dragGuide.value = plan2dSnap(wy); __plan2d.guidesH[__plan2d.dragGuide.index] = __plan2d.dragGuide.value;
        }
        plan2dDraw();
      }catch(_wm){} };
      window.addEventListener('mousemove', window.__plan2dMousemove, true);
    }

    // Finish current wall chain with double-click for a predictable UX
    c.addEventListener('dblclick', function(ev){ try{ if(!__plan2d.active) return; if(__plan2d.zoomLocked) return; if(__plan2d.tool==='wall' && __plan2d.chainActive){ endWallChainSession(); } }catch(_e){} });
  // Also allow right-click to end the chain without adding a point
  c.addEventListener('contextmenu', function(ev){ try{ if(!__plan2d.active) return; if(__plan2d.zoomLocked) return; if(__plan2d.tool==='wall' && __plan2d.chainActive){ ev.preventDefault(); endWallChainSession(); } }catch(_e){} });

  window.addEventListener('mouseup', function(){ if(!__plan2d.active) return; 
    if(__plan2d.dragGuide){
      try{ plan2dEdited(); }catch(_gdone){}
      __plan2d.dragGuide=null; plan2dDraw(); return; }
    if(__plan2d.panning){ __plan2d.panning=null; plan2dDraw(); return; }
    // Finish wall endpoint drag
    if(__plan2d.dragWall){
      try { plan2dAutoSnapAndJoin && plan2dAutoSnapAndJoin(); __plan2d.freezeCenterScaleUntil = Date.now() + 600; plan2dEdited(); }catch(_endDrag){}
      __plan2d.dragWall=null; plan2dDraw(); return;
    }
    // Finish window endpoint drag
    if(__plan2d.dragWindow){
      try {
        // Merge overlapping/touching windows on the same host wall into the dragged window span
        var dw = __plan2d.dragWindow;
        var arr = __plan2d.elements || [];
        var we = arr[dw.index];
        if(we && we.type==='window' && typeof we.host==='number'){
          var eps = 0.002; // ~2mm
          var a0 = Math.min(we.t0||0, we.t1||0), a1 = Math.max(we.t0||0, we.t1||0);
          for(var j=arr.length-1; j>=0; j--){
            if(j===dw.index) continue;
            var other = arr[j];
            if(!other || other.type!=='window' || typeof other.host!=='number' || other.host!==we.host) continue;
            var b0 = Math.min(other.t0||0, other.t1||0), b1 = Math.max(other.t0||0, other.t1||0);
            var overlap = !(a1 < b0 - eps || a0 > b1 + eps);
            if(overlap){
              a0 = Math.min(a0, b0); a1 = Math.max(a1, b1);
              // remove the other window; keep properties (sill/height) of dragged one
              arr.splice(j, 1);
              // Adjust drag index if splice removed an earlier element
              if(j < dw.index) dw.index -= 1;
            }
          }
          we.t0 = a0; we.t1 = a1;
          // Reselect merged window (index may have shifted)
          try { var ni = arr.indexOf(we); if(ni>=0) plan2dSetSelection && plan2dSetSelection(ni); }catch(_reSel){}
        }
        plan2dAutoSnapAndJoin && plan2dAutoSnapAndJoin();
        __plan2d.freezeCenterScaleUntil = Date.now() + 600;
        plan2dEdited();
      }catch(_endW){}
      __plan2d.dragWindow=null; plan2dDraw(); return;
    }
    // Finish door endpoint drag
    if(__plan2d.dragDoor){
      try { plan2dAutoSnapAndJoin && plan2dAutoSnapAndJoin(); __plan2d.freezeCenterScaleUntil = Date.now() + 600; plan2dEdited(); }catch(_endD){}
      __plan2d.dragDoor=null; plan2dDraw(); return;
    }
    if(__plan2d.start && __plan2d.last){ var moved=Math.hypot(__plan2d.last.x-__plan2d.start.x, __plan2d.last.y-__plan2d.start.y); if(moved<0.02){ plan2dSelectAt(__plan2d.last); } else { var a=__plan2d.start,b=__plan2d.last; if(__plan2d.tool!=='wall'){ // drag-create still applies for window/door
          plan2dFinalize(a,b); plan2dAutoSnapAndJoin(); plan2dDraw(); } } }
    __plan2d.start=null; __plan2d.last=null; __plan2d.mouse=null; plan2dDraw(); });
  // Remove room drag mouseup listener (simplified)

    // Keyboard (selection delete + chain finalize) ------------------------
  if(!window.__plan2dKeydown){ window.__plan2dKeydown=function(ev){ if(!__plan2d.active) return; 
    // Spacebar hold => temporary pan mode (do not toggle repeatedly on auto-repeat)
    if(ev.code==='Space'){ if(!__plan2d.spacePanActive){ __plan2d.spacePanActive=true; try{ var cEl=document.getElementById('plan2d-canvas'); if(cEl) cEl.style.cursor='grab'; }catch(_){} } ev.preventDefault(); ev.stopPropagation(); }
    // Toggle performance HUD with 'P' (Shift+P toggles extended HUD)
    if(ev.key==='p' || ev.key==='P'){
      if(ev.shiftKey){ __plan2d.perfHUDExt = !__plan2d.perfHUDExt; if(__plan2d.perfHUDExt){ __plan2d.perfHUD = true; } try{ plan2dDraw(); }catch(_){} ev.preventDefault(); ev.stopPropagation(); return; }
      __plan2d.perfHUD = !__plan2d.perfHUD; try{ plan2dDraw(); }catch(_){} ev.preventDefault(); ev.stopPropagation(); return;
    }
  if(__plan2d.tool==='wall' && __plan2d.chainActive){ if(ev.key==='Enter'){ endWallChainSession(); ev.preventDefault(); ev.stopPropagation(); return; } if(ev.key==='Escape'){ __plan2d.chainActive=false; __plan2d.chainPoints=[]; __plan2d.userDrawingActive=false; plan2dDraw(); ev.preventDefault(); ev.stopPropagation(); return; } }
    if(ev.key==='Delete' || ev.key==='Backspace'){ 
      // Delete selected guide first if any
      if(__plan2d.selectedGuide){
        try {
          if(__plan2d.selectedGuide.dir==='v'){
            if(Array.isArray(__plan2d.guidesV) && __plan2d.selectedGuide.index>=0 && __plan2d.selectedGuide.index<__plan2d.guidesV.length){ __plan2d.guidesV.splice(__plan2d.selectedGuide.index,1); }
          } else if(__plan2d.selectedGuide.dir==='h'){
            if(Array.isArray(__plan2d.guidesH) && __plan2d.selectedGuide.index>=0 && __plan2d.selectedGuide.index<__plan2d.guidesH.length){ __plan2d.guidesH.splice(__plan2d.selectedGuide.index,1); }
          }
        }catch(_gdel){}
        __plan2d.selectedGuide=null; __plan2d.dragGuide=null; plan2dDraw(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return;
      }
      if(__plan2d.selectedIndex>=0){ plan2dEraseElementAt(__plan2d.selectedIndex); plan2dSetSelection(-1); plan2dDraw(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return; }
    }
    // Toggle window full height (floor-to-ceiling) when 'F' pressed and a window is selected
    if(ev.key==='f' || ev.key==='F'){
      try{
        if(__plan2d.selectedIndex>=0){ var sel = __plan2d.elements[__plan2d.selectedIndex]; if(sel && sel.type==='window'){
          var isFull = (typeof sel.sillM==='number' && sel.sillM===0 && typeof sel.heightM==='number' && sel.heightM === (__plan2d.wallHeightM||3.0));
          if(!isFull){ sel.sillM = 0; sel.heightM = (__plan2d.wallHeightM||3.0); }
          else { sel.sillM = (__plan2d.windowSillM||1.0); sel.heightM = (__plan2d.windowHeightM||1.5); }
          plan2dEdited(); plan2dDraw();
        } }
      }catch(_tf){}
      ev.preventDefault(); ev.stopPropagation(); return;
    }
  }; document.addEventListener('keydown', window.__plan2dKeydown, true); }

  // Helper to toggle full-height on selected window (can be called from UI dropdown)
  try{ window.toggleSelectedWindowFullHeight = function(){ try{ if(__plan2d.selectedIndex>=0){ var sel = __plan2d.elements[__plan2d.selectedIndex]; if(sel && sel.type==='window'){ var isFull = (typeof sel.sillM==='number' && sel.sillM===0 && typeof sel.heightM==='number' && sel.heightM === (__plan2d.wallHeightM||3.0)); if(!isFull){ sel.sillM = 0; sel.heightM = (__plan2d.wallHeightM||3.0); } else { sel.sillM = (__plan2d.windowSillM||1.0); sel.heightM = (__plan2d.windowHeightM||1.5); } plan2dEdited(); plan2dDraw(); } } }catch(e){} }; }catch(_g){}
  if(!window.__plan2dKeyup){ window.__plan2dKeyup=function(ev){ if(!__plan2d.active) return; if(ev.code==='Space'){ __plan2d.spacePanActive=false; if(__plan2d.panning){ /* end current panning gracefully */ __plan2d.panning=null; } try{ plan2dCursor && plan2dCursor(); }catch(_){} ev.preventDefault(); ev.stopPropagation(); } }; document.addEventListener('keyup', window.__plan2dKeyup, true); }
  }
  window.plan2dBind = window.plan2dBind || plan2dBind;

  function plan2dUnbind(){ try{ if(window.__plan2dResize){ window.removeEventListener('resize', window.__plan2dResize); window.__plan2dResize=null; } if(window.__plan2dKeydown){ try{ document.removeEventListener('keydown', window.__plan2dKeydown, true); }catch(e){} window.__plan2dKeydown=null; } if(window.__plan2dKeyup){ try{ document.removeEventListener('keyup', window.__plan2dKeyup, true); }catch(e){} window.__plan2dKeyup=null; } }catch(e){} }
  window.plan2dUnbind = window.plan2dUnbind || plan2dUnbind;

  // Modal open/close -------------------------------------------------------
  // Rewritten clean openPlan2DModal (previous version became corrupted during patch operations)
  function openPlan2DModal(){
    try {
      if(__plan2d.active) return false;
      __plan2d.active=true;
      var floor = (typeof window.currentFloor==='number'? window.currentFloor:0);
      // Auto-enable CAD mode: professional white drafting background
      try { if(document && document.body) document.body.classList.add('cad-mode'); } catch(_cadAdd){}
      // Show modal container
      try{ var page=document.getElementById('plan2d-page'); if(page) page.style.display='block'; }catch(_d){}
      // Move controls into header
      try {
        var controls = document.getElementById('controls');
        var hdr = document.getElementById('plan2d-header');
        if (controls && hdr && !controls.__movedInto2D) {
          controls.__origParent = controls.parentNode;
          controls.__origNext = controls.nextSibling;
          hdr.insertBefore(controls, hdr.firstChild);
          controls.__movedInto2D = true;
        }
      } catch(e){}
      plan2dBind(); plan2dCursor();
      // Load drafts from storage and bring in guides/elements for this floor
      try { loadPlan2dDraftsFromStorage(); plan2dLoadDraft(floor); }catch(_ld){}
      var draft = window.__plan2dDrafts && window.__plan2dDrafts[floor];
      var shouldPopulate = true;
      if(draft && draft.userEdited){
        // Only skip populate if draft actually has elements
        if(Array.isArray(draft.elements) && draft.elements.length>0){
          shouldPopulate=false;
          if(console && console.log) console.log('[PLAN2D OPEN] Using user-edited draft floor', floor, 'elements=', draft.elements.length);
        } else {
          if(console && console.warn) console.warn('[PLAN2D OPEN] Empty user-edited draft ignored; will populate');
        }
      }
      if(shouldPopulate && typeof populatePlan2DFromDesign==='function'){
        var ok=false; try{ ok=!!populatePlan2DFromDesign(); }catch(_pp){ ok=false; }
        if(console && console.log) console.log('[PLAN2D OPEN] Auto-populate floor', floor, 'ok=', ok, 'elements=', (__plan2d.elements?__plan2d.elements.length:0));
        try { window.__plan2dDiag = window.__plan2dDiag||{}; window.__plan2dDiag.lastOpenSnapshot = { at:Date.now(), floor:floor, elements:(__plan2d.elements?__plan2d.elements.length:0) }; }catch(_snap){}
      }
      // Always sync floor toggle button highlight after determining floor and population
      try { if(typeof window.syncPlan2DFloorButtons==='function') window.syncPlan2DFloorButtons(); }catch(_flSync){}
      // Sync main level dropdown label to reflect active floor
      try { if(typeof window.updateLevelMenuStates==='function') window.updateLevelMenuStates(); }catch(_lvlSync){}
      // Fallback: if still empty but 3D source exists, populate now
      try {
        if((!Array.isArray(__plan2d.elements) || __plan2d.elements.length===0) && typeof populatePlan2DFromDesign==='function'){
          var source=false; var rooms=Array.isArray(window.allRooms)?window.allRooms:[]; for(var i=0;i<rooms.length;i++){ var r=rooms[i]; if(r && (r.level||0)===floor){ source=true; break; } }
          if(!source){ var strips=Array.isArray(window.wallStrips)?window.wallStrips:[]; for(var j=0;j<strips.length;j++){ var ws=strips[j]; if(ws && (ws.level||0)===floor){ source=true; break; } } }
          if(source){ if(console && console.warn) console.warn('[PLAN2D OPEN] Fallback populate (initial empty) floor', floor); try{ populatePlan2DFromDesign(); }catch(_pf){} }
        }
      }catch(_fb){}
      // Simple: make canvases visible, fit instantly (no animation), and draw
      try{
        var c=document.getElementById('plan2d-canvas');
        var ov=document.getElementById('plan2d-overlay');
        var l2=document.getElementById('labels-2d');
        if(c) c.style.visibility='visible'; if(ov) ov.style.visibility='visible'; if(l2) l2.style.visibility='visible';
      }catch(_vis){}
      try{
        // If there's content, fit to content; otherwise just draw the empty grid and set tool to wall
        var hasContent = Array.isArray(__plan2d.elements) && __plan2d.elements.length>0;
        if(hasContent){ plan2dFitViewToContent(40); }
        else { if(typeof plan2dSetTool==='function') plan2dSetTool('wall'); else __plan2d.tool='wall'; }
        plan2dDraw && plan2dDraw();
      }catch(_fit){}
      // Scale label refresh
      try{ var scl=document.getElementById('plan2d-scale'); if(scl) scl.textContent='1:'+Math.round(100*(100/(__plan2d.scale||100)))/100; }catch(_slbl){}
      // Close button wiring
      try{ var btnClose=document.getElementById('plan2d-close'); if(btnClose && !btnClose.__wired){ btnClose.__wired=true; btnClose.addEventListener('click', function(){ closePlan2DModal(); }); } }catch(_cbtn){}
  try{ if(window.updateStatus) updateStatus('2D editor opened'); }catch(_sts){}
  // Final highlight sync (defensive second pass in case buttons created late)
  try { if(typeof window.syncPlan2DFloorButtons==='function') window.syncPlan2DFloorButtons(); }catch(_flSync2){}
  // Also refresh level menu label post-open
  try { if(typeof window.updateLevelMenuStates==='function') window.updateLevelMenuStates(); }catch(_lvlSync2){}
  // Resize pass once to ensure correct canvas backing size
  try{ if(typeof window.__plan2dResize==='function') window.__plan2dResize(); }catch(_rpass){}
      // Live sync listener
      try{ if(!window.__plan2dSyncApplyHandler){ var pending=false; window.__plan2dSyncApplyHandler=function(){ if(!__plan2d.active) return; if(pending) return; pending=true; requestAnimationFrame(function(){ try{ pending=false; if(__plan2d.userDrawingActive) return; if(typeof window.populatePlan2DFromDesign==='function'){ window.populatePlan2DFromDesign(); plan2dDraw && plan2dDraw(); } }catch(_sync){ pending=false; } }); }; window.addEventListener('gablok:apply-summary', window.__plan2dSyncApplyHandler); } }catch(_lsync){}
      return true;
    } catch(err){ if(console && console.error) console.error('[PLAN2D OPEN ERROR]', err); return false; }
  }
  function closePlan2DModal(){
    try {
      if(!__plan2d.active) return;
      __plan2d.active=false;
      plan2dUnbind();
      plan2dSetSelection(-1);
      __plan2d.chainActive=false; __plan2d.chainPoints=[];
      try{ var page=document.getElementById('plan2d-page'); if(page) page.style.display='none'; }catch(_d){}
      try{ var controls=document.getElementById('controls'); if(controls && controls.__movedInto2D){ var parent=controls.__origParent; var next=controls.__origNext; if(parent){ if(next) parent.insertBefore(controls,next); else parent.appendChild(controls);} controls.__movedInto2D=false; } }catch(_rest){}
      // Remove CAD mode when leaving 2D editor to restore original theme for 3D view
      try { if(document && document.body) document.body.classList.remove('cad-mode'); } catch(_cadRem){}
      plan2dDraw();
      try{ if(window.updateStatus) updateStatus('2D editor closed'); }catch(_st){}
      // Sync highlight so next open reflects the (possibly changed) floor retained in currentFloor
      try { if(typeof window.syncPlan2DFloorButtons==='function') window.syncPlan2DFloorButtons(); }catch(_flSyncClose){}
      // Also sync level dropdown / label to current floor when closing
      try { if(typeof window.updateLevelMenuStates==='function') window.updateLevelMenuStates(); }catch(_lvlSyncClose){}
    } catch(e) { if(console && console.error) console.error('[PLAN2D CLOSE ERROR]', e); }
  }
  // Always assign real handlers (do NOT guard with existing value) so loader stub gets replaced
  window.openPlan2DModal = openPlan2DModal;
  window.closePlan2DModal = closePlan2DModal;

  // Export -----------------------------------------------------------------
  function plan2dExport(){ try{ var data=JSON.stringify(__plan2d.elements); var blob=new Blob([data],{type:'application/json'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='plan2d.json'; a.click(); URL.revokeObjectURL(a.href); if(updateStatus) updateStatus('2D plan exported'); }catch(e){ try{ updateStatus && updateStatus('Export failed'); }catch(_){} } }
  window.plan2dExport = window.plan2dExport || plan2dExport;
  // Clear ------------------------------------------------------------------
  function plan2dClear(){ try { __plan2d.elements=[]; __plan2d.selectedIndex=-1; __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); plan2dEdited(); updateStatus && updateStatus('2D plan cleared'); } catch(e){ /* ignore */ } }
  window.plan2dClear = window.plan2dClear || plan2dClear;
  // Import -----------------------------------------------------------------
  function plan2dImport(data){ try { if(typeof data==='string'){ data = JSON.parse(data); } if(Array.isArray(data)){ __plan2d.elements = JSON.parse(JSON.stringify(data)); __plan2d.selectedIndex=-1; plan2dDraw(); plan2dEdited(); updateStatus && updateStatus('2D plan imported'); return true; } } catch(e){ try{ updateStatus && updateStatus('Import failed'); }catch(_){} } return false; }
  window.plan2dImport = window.plan2dImport || plan2dImport;
})();
