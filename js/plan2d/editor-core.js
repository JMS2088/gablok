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
    try { if(typeof floor!=='number') floor=0; window.__plan2dDrafts[floor] = JSON.parse(JSON.stringify(__plan2d.elements)); savePlan2dDraftsToStorage(); } catch(e){}
  }
  function plan2dLoadDraft(floor){
    try { if(typeof floor!=='number') floor=0; var arr = window.__plan2dDrafts[floor]; if(Array.isArray(arr)){ __plan2d.elements = JSON.parse(JSON.stringify(arr)); plan2dSetSelection(-1); } } catch(e){}
  }
  window.plan2dSaveDraft = window.plan2dSaveDraft || plan2dSaveDraft;
  window.plan2dLoadDraft = window.plan2dLoadDraft || plan2dLoadDraft;

  // Selection ---------------------------------------------------------------
  function plan2dSetSelection(idx){
    __plan2d.selectedIndex = (typeof idx==='number'? idx : -1);
    __plan2d.selectedSubsegment = null;
  }
  window.plan2dSetSelection = window.plan2dSetSelection || plan2dSetSelection;

  // Edit lifecycle hook – save drafts + sync lightweight signals to 3D ------
  function plan2dEdited(){
    try { plan2dSaveDraft(typeof window.currentFloor==='number'? window.currentFloor:0); }catch(e){}
    // Bump plan version and invalidate cached computations used by drawing
    try {
      __plan2d.__version = (typeof __plan2d.__version==='number' ? __plan2d.__version+1 : 1);
      if(__plan2d.__cache){ __plan2d.__cache.intersections = null; __plan2d.__cache.version = -1; }
    } catch(_v){}
    // optional non-destructive 3D sync, guarded to avoid spam during drags
    try {
      if(Date.now() < __plan2d.freezeSyncUntil) return;
      if(typeof window.applyPlan2DTo3D === 'function'){
        window.applyPlan2DTo3D(undefined,{allowRooms:true,quiet:true,level:(typeof window.currentFloor==='number'? window.currentFloor:0),nonDestructive:true});
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

  function plan2dSelectAt(p){ var best=-1, bestDist=0.2; for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; } } plan2dSetSelection(best); plan2dDraw(); }
  window.plan2dSelectAt = window.plan2dSelectAt || plan2dSelectAt;

  // Element creation -------------------------------------------------------
  function plan2dFinalize(a,b){ if(!a||!b) return; var dx=b.x-a.x, dy=b.y-a.y; if(Math.abs(dx)>Math.abs(dy)) b.y=a.y; else b.x=a.x; var len=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2); if(len<0.05) return; if(__plan2d.tool==='wall'){ __plan2d.elements.push({type:'wall',x0:a.x,y0:a.y,x1:b.x,y1:b.y,thickness:__plan2d.wallThicknessM}); } else if(__plan2d.tool==='window'){ __plan2d.elements.push({type:'window',x0:a.x,y0:a.y,x1:b.x,y1:b.y,thickness:__plan2d.wallThicknessM}); } else if(__plan2d.tool==='door'){ __plan2d.elements.push({type:'door',x0:a.x,y0:a.y,x1:b.x,y1:b.y,thickness:0.9,meta:{hinge:'left',swing:'in'}}); } plan2dEdited(); }
  window.plan2dFinalize = window.plan2dFinalize || plan2dFinalize;

  function plan2dFinalizeChain(){ try { var pts=Array.isArray(__plan2d.chainPoints)?__plan2d.chainPoints:[]; if(pts.length<2){ __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); return; } for(var i=0;i<pts.length-1;i++){ var a=pts[i], b=pts[i+1]; var segLen=Math.hypot(b.x-a.x,b.y-a.y); if(segLen<0.05) continue; var ax=a.x, ay=a.y, bx=b.x, by=b.y; if(Math.abs(bx-ax)>Math.abs(by-ay)) by=ay; else bx=ax; __plan2d.elements.push({type:'wall',x0:ax,y0:ay,x1:bx,y1:by,thickness:__plan2d.wallThicknessM}); } __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dAutoSnapAndJoin(); plan2dDraw(); plan2dEdited(); }catch(e){} }
  window.plan2dFinalizeChain = window.plan2dFinalizeChain || plan2dFinalizeChain;

  // Eraser & deletion ------------------------------------------------------
  function plan2dEraseElementAt(idx){ var arr=__plan2d.elements; if(!arr||idx<0||idx>=arr.length) return false; var removed=arr[idx]; arr.splice(idx,1); if(removed && removed.type==='wall'){ for(var i=arr.length-1;i>=0;i--){ var el=arr[i]; if((el.type==='window'||el.type==='door') && typeof el.host==='number'){ if(el.host===idx){ arr.splice(i,1); continue; } if(el.host>idx){ el.host-=1; } } } } else { for(var j=0;j<arr.length;j++){ var e=arr[j]; if((e.type==='window'||e.type==='door') && typeof e.host==='number' && e.host>idx){ e.host-=1; } } } return true; }
  window.plan2dEraseElementAt = window.plan2dEraseElementAt || plan2dEraseElementAt;
  function plan2dFindNearestOfTypes(p, types, maxDist){ var elems=__plan2d.elements||[]; var bestIdx=-1; var bestDist=(typeof maxDist==='number'? maxDist:0.2); for(var i=0;i<elems.length;i++){ var e=elems[i]; if(!e||types.indexOf(e.type)===-1) continue; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; bestIdx=i; } } return {index:bestIdx,dist:bestDist}; }
  window.plan2dFindNearestOfTypes = window.plan2dFindNearestOfTypes || plan2dFindNearestOfTypes;
  function plan2dHoverErase(p){ var best=-1, bestDist=0.25; for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; } } __plan2d.hoverIndex=best; plan2dDraw(); }
  window.plan2dHoverErase = window.plan2dHoverErase || plan2dHoverErase;
  function plan2dEraseAt(p){ var win=plan2dFindNearestOfTypes(p,['window'],0.2); if(win.index>=0){ if(plan2dEraseElementAt(win.index)){ __plan2d.hoverIndex=-1; plan2dDraw(); plan2dEdited(); } return; } var dor=plan2dFindNearestOfTypes(p,['door'],0.2); if(dor.index>=0){ if(plan2dEraseElementAt(dor.index)){ __plan2d.hoverIndex=-1; plan2dDraw(); plan2dEdited(); } return; } var segHit=plan2dHitWallSubsegment && plan2dHitWallSubsegment(p,0.15); if(segHit){ __plan2d.selectedSubsegment=segHit; if(plan2dDeleteSelectedSubsegment && plan2dDeleteSelectedSubsegment()){ __plan2d.selectedSubsegment=null; __plan2d.hoverIndex=-1; plan2dAutoSnapAndJoin(); plan2dDraw(); plan2dEdited(); return; } } plan2dHoverErase(p); if(__plan2d.hoverIndex>=0){ var delIdx=__plan2d.hoverIndex; plan2dEraseElementAt(delIdx); __plan2d.hoverIndex=-1; plan2dDraw(); plan2dEdited(); } }
  window.plan2dEraseAt = window.plan2dEraseAt || plan2dEraseAt;

  // Bounds & view ----------------------------------------------------------
  function plan2dComputeBounds(){ var els=__plan2d.elements||[]; var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; for(var i=0;i<els.length;i++){ var e=els[i]; if(!e) continue; var include=function(x,y){ minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); }; if(e.type==='wall'){ include(e.x0,e.y0); include(e.x1,e.y1); } else if(e.type==='door' || e.type==='window'){ if(typeof e.host==='number'){ var host=els[e.host]; if(host && host.type==='wall'){ var ax=host.x0+(host.x1-host.x0)*(e.t0||0), ay=host.y0+(host.y1-host.y0)*(e.t0||0); var bx=host.x0+(host.x1-host.x0)*(e.t1||0), by=host.y0+(host.y1-host.y0)*(e.t1||0); include(ax,ay); include(bx,by); } } else { include(e.x0,e.y0); include(e.x1,e.y1); } } } if(!isFinite(minX)||!isFinite(maxX)||!isFinite(minY)||!isFinite(maxY)) return null; return {minX,minY,maxX,maxY}; }
  window.plan2dComputeBounds = window.plan2dComputeBounds || plan2dComputeBounds;
  function plan2dFitViewToContent(marginPx){ try{ var c=document.getElementById('plan2d-canvas'); if(!c) return false; var b=plan2dComputeBounds(); if(!b) return false; var dpr=window.devicePixelRatio||1; var W=c.width,H=c.height; var contentW=Math.max(0.01,b.maxX-b.minX); var contentH=Math.max(0.01,b.maxY-b.minY); var margin=Math.max(0,(marginPx||40)*dpr); var sX=(W-2*margin)/contentW; var sY=(H-2*margin)/contentH; var sNew=Math.max(10,Math.min(800,Math.min(sX,sY))); __plan2d.scale=sNew; var cx=(b.minX+b.maxX)*0.5; var cy=(b.minY+b.maxY)*0.5; __plan2d.panX=-cx; __plan2d.panY=-cy; plan2dDraw(); return true; }catch(e){ return false; } }
  window.plan2dFitViewToContent = window.plan2dFitViewToContent || plan2dFitViewToContent;

  // Flip vertical axis (mirror) -------------------------------------------
  function plan2dFlipVertical(){ try{ var els=__plan2d.elements||[]; for(var i=0;i<els.length;i++){ var e=els[i]; if(!e) continue; if(e.type==='wall'){ e.y0=-(e.y0||0); e.y1=-(e.y1||0); } else if(e.type==='window' || e.type==='door'){ if(typeof e.host!=='number'){ e.y0=-(e.y0||0); e.y1=-(e.y1||0); } } } __plan2d.yFromWorldZSign = (__plan2d.yFromWorldZSign===1? -1:1); plan2dSetSelection(-1); __plan2d.dragWindow=__plan2d.dragDoor=__plan2d.dragDoorWhole=__plan2d.dragWall=null; __plan2d.start=null; __plan2d.last=null; plan2dDraw(); plan2dEdited(); }catch(e){} }
  window.plan2dFlipVertical = window.plan2dFlipVertical || plan2dFlipVertical;

  // UI helpers -------------------------------------------------------------
  function plan2dUpdateActiveButtons(){ try{ var ids=['plan2d-tool-wall','plan2d-tool-window','plan2d-tool-door','plan2d-tool-select','plan2d-tool-erase']; for(var i=0;i<ids.length;i++){ var el=document.getElementById(ids[i]); if(el) el.classList.remove('active'); } var map={wall:'plan2d-tool-wall',window:'plan2d-tool-window',door:'plan2d-tool-door',select:'plan2d-tool-select',erase:'plan2d-tool-erase'}; var id=map[__plan2d.tool]; var btn=id&&document.getElementById(id); if(btn) btn.classList.add('active'); }catch(e){} }
  function plan2dCursor(){ var c=document.getElementById('plan2d-canvas'); if(!c) return; c.style.cursor = (__plan2d.tool==='erase')? 'not-allowed' : (__plan2d.tool==='select' ? 'pointer' : 'crosshair'); plan2dUpdateActiveButtons(); }
  window.plan2dCursor = window.plan2dCursor || plan2dCursor;

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

    c.addEventListener('mousedown', function(ev){ if(!__plan2d.active) return; var rect=c.getBoundingClientRect(); var cx=(ev.clientX-rect.left)*(c.width/rect.width); var cy=(ev.clientY-rect.top)*(c.height/rect.height); var p=screenToWorld2D(cx,cy); __plan2d.mouseDownPosPlan=p; 
      // Spacebar panning: if space held, start panning regardless of tool and do not modify drawing state
      if(__plan2d.spacePanActive){ __plan2d.panning={ mx:cx, my:cy, panX0:__plan2d.panX||0, panY0:__plan2d.panY||0, scale: __plan2d.scale||50 }; plan2dDraw(); return; }
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
        } else {
          var prev = __plan2d.chainPoints[__plan2d.chainPoints.length-1];
          if(prev){
            var ax = prev.x, ay = prev.y, bx = pt.x, by = pt.y;
            // axis alignment (preserve dominant axis)
            if(Math.abs(bx-ax) >= Math.abs(by-ay)) by = ay; else bx = ax;
            var segLen = Math.hypot(bx-ax, by-ay);
            if(segLen >= 0.05){
              __plan2d.elements.push({type:'wall', x0:ax, y0:ay, x1:bx, y1:by, thickness:__plan2d.wallThicknessM});
              plan2dEdited();
            }
            // Add the (potentially adjusted) endpoint for the continuing chain preview
            __plan2d.chainPoints.push({x:bx, y:by});
            // Auto-snap & join after each new segment for immediate feedback
            try{ plan2dAutoSnapAndJoin && plan2dAutoSnapAndJoin(); }catch(_sj){}
          }
        }
        plan2dDraw();
        return;
      }
      if(__plan2d.tool==='select'){
        // Hit-test any element near cursor; if none, start panning
        var best=-1, bestDist=0.18; for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; } }
        if(best<0){ __plan2d.panning={ mx:cx, my:cy, panX0:__plan2d.panX||0, panY0:__plan2d.panY||0, scale: __plan2d.scale||50 }; plan2dDraw(); return; }
        // Clicked on element -> set selection; allow future element-drag extensions
        plan2dSetSelection(best);
      }
      // selection gesture (fallback)
      __plan2d.start=p; __plan2d.last=p; plan2dDraw(); });

    c.addEventListener('mousemove', function(ev){ if(!__plan2d.active) return; var rect=c.getBoundingClientRect(); var cx=(ev.clientX-rect.left)*(c.width/rect.width); var cy=(ev.clientY-rect.top)*(c.height/rect.height); __plan2d.mouse={x:cx,y:cy}; var p=screenToWorld2D(cx,cy);
      // Panning when dragging on empty space with Select tool
      if(__plan2d.panning){ var s=__plan2d.panning.scale||(__plan2d.scale||50); var dx=cx-__plan2d.panning.mx; var dy=cy-__plan2d.panning.my; __plan2d.panX = (__plan2d.panning.panX0||0) + dx/Math.max(1e-6,s); __plan2d.panY = (__plan2d.panning.panY0||0) - dy/Math.max(1e-6,s); plan2dDraw(); return; }
      // Dragging a wall endpoint
      if(__plan2d.dragWall){
        try {
          var dw = __plan2d.dragWall;
          var w = __plan2d.elements[dw.index];
          if(w && w.type==='wall'){
            // Current raw position
            var nx = p.x, ny = p.y;
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
            // Live draw only (defer applyPlan2DTo3D until mouseup to reduce churn)
            plan2dDraw();
          }
        }catch(_dwMove){}
        return;
      }
      if(__plan2d.tool==='erase'){ plan2dHoverErase(p); return; }
      if(__plan2d.start){ __plan2d.last=p; plan2dDraw(); return; }
      plan2dDraw();
    });

    // Finish current wall chain with double-click for a predictable UX
    c.addEventListener('dblclick', function(ev){ try{ if(!__plan2d.active) return; if(__plan2d.tool==='wall' && __plan2d.chainActive){ __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); } }catch(_e){} });
  // Also allow right-click to end the chain without adding a point
  c.addEventListener('contextmenu', function(ev){ try{ if(!__plan2d.active) return; if(__plan2d.tool==='wall' && __plan2d.chainActive){ ev.preventDefault(); __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); } }catch(_e){} });

  window.addEventListener('mouseup', function(){ if(!__plan2d.active) return; 
    if(__plan2d.panning){ __plan2d.panning=null; plan2dDraw(); return; }
    // Finish wall endpoint drag
    if(__plan2d.dragWall){
      try { plan2dAutoSnapAndJoin && plan2dAutoSnapAndJoin(); plan2dEdited(); }catch(_endDrag){}
      __plan2d.dragWall=null; plan2dDraw(); return;
    }
    if(__plan2d.start && __plan2d.last){ var moved=Math.hypot(__plan2d.last.x-__plan2d.start.x, __plan2d.last.y-__plan2d.start.y); if(moved<0.02){ plan2dSelectAt(__plan2d.last); } else { var a=__plan2d.start,b=__plan2d.last; if(__plan2d.tool!=='wall'){ // drag-create still applies for window/door
          plan2dFinalize(a,b); plan2dAutoSnapAndJoin(); plan2dDraw(); } } }
    __plan2d.start=null; __plan2d.last=null; __plan2d.mouse=null; plan2dDraw(); });
  // Remove room drag mouseup listener (simplified)

    // Keyboard (selection delete + chain finalize) ------------------------
  if(!window.__plan2dKeydown){ window.__plan2dKeydown=function(ev){ if(!__plan2d.active) return; 
    // Spacebar hold => temporary pan mode (do not toggle repeatedly on auto-repeat)
    if(ev.code==='Space'){ if(!__plan2d.spacePanActive){ __plan2d.spacePanActive=true; try{ var cEl=document.getElementById('plan2d-canvas'); if(cEl) cEl.style.cursor='grab'; }catch(_){} } ev.preventDefault(); ev.stopPropagation(); }
    // Toggle performance HUD with 'P'
    if(ev.key==='p' || ev.key==='P'){ __plan2d.perfHUD = !__plan2d.perfHUD; try{ plan2dDraw(); }catch(_){} ev.preventDefault(); ev.stopPropagation(); return; }
    if(__plan2d.tool==='wall' && __plan2d.chainActive){ if(ev.key==='Enter'){ plan2dFinalizeChain(); ev.preventDefault(); ev.stopPropagation(); return; } if(ev.key==='Escape'){ __plan2d.chainActive=false; __plan2d.chainPoints=[]; plan2dDraw(); ev.preventDefault(); ev.stopPropagation(); return; } }
    if(ev.key==='Delete' || ev.key==='Backspace'){ if(__plan2d.selectedIndex>=0){ plan2dEraseElementAt(__plan2d.selectedIndex); plan2dSetSelection(-1); plan2dDraw(); plan2dEdited(); } ev.preventDefault(); ev.stopPropagation(); return; }
  }; document.addEventListener('keydown', window.__plan2dKeydown, true); }
  if(!window.__plan2dKeyup){ window.__plan2dKeyup=function(ev){ if(!__plan2d.active) return; if(ev.code==='Space'){ __plan2d.spacePanActive=false; if(__plan2d.panning){ /* end current panning gracefully */ __plan2d.panning=null; } try{ plan2dCursor && plan2dCursor(); }catch(_){} ev.preventDefault(); ev.stopPropagation(); } }; document.addEventListener('keyup', window.__plan2dKeyup, true); }
  }
  window.plan2dBind = window.plan2dBind || plan2dBind;

  function plan2dUnbind(){ try{ if(window.__plan2dResize){ window.removeEventListener('resize', window.__plan2dResize); window.__plan2dResize=null; } if(window.__plan2dKeydown){ try{ document.removeEventListener('keydown', window.__plan2dKeydown, true); }catch(e){} window.__plan2dKeydown=null; } if(window.__plan2dKeyup){ try{ document.removeEventListener('keyup', window.__plan2dKeyup, true); }catch(e){} window.__plan2dKeyup=null; } }catch(e){} }
  window.plan2dUnbind = window.plan2dUnbind || plan2dUnbind;

  // Modal open/close -------------------------------------------------------
  function openPlan2DModal(){
    if(__plan2d.active) return;
    __plan2d.active=true;
    // Show modal container
    try{ var page=document.getElementById('plan2d-page'); if(page) page.style.display='block'; }catch(_d){}
    plan2dBind();
    plan2dCursor();
    // Load drafts + current floor
    try{ loadPlan2dDraftsFromStorage(); plan2dLoadDraft(typeof window.currentFloor==='number'? window.currentFloor:0); }catch(e){}
    // Always sync walls from 3D design for accuracy (simplified behavior)
    try{ if(typeof window.populatePlan2DFromDesign==='function'){ window.populatePlan2DFromDesign(); } }catch(_pop){}
    // Initial fit (non-fatal)
    try{ plan2dFitViewToContent(40); }catch(e){}
  // First draw
  plan2dDraw();
    // Refresh scale label
    try{ var scl=document.getElementById('plan2d-scale'); if(scl) scl.textContent='1:'+Math.round(100*(__plan2d.scale? (100/__plan2d.scale):1))/100; }catch(_s){}
    // Wire close button if not already done
    try{ var btnClose=document.getElementById('plan2d-close'); if(btnClose && !btnClose.__wired){ btnClose.__wired=true; btnClose.addEventListener('click', function(){ closePlan2DModal(); }); } }catch(_c){}
    // Status
    try{ if(window.updateStatus) updateStatus('2D editor opened'); }catch(e){}
  // Trigger multiple resize passes: once now and once on next frame to guarantee correct CSS->canvas sizing
  try{ if(typeof window.__plan2dResize==='function') window.__plan2dResize(); requestAnimationFrame(function(){ try{ window.__plan2dResize && window.__plan2dResize(); }catch(_r2){} }); }catch(_r){}
    // Force redraw one more time so rulers align after resize
    try{ plan2dDraw(); }catch(_rd){}
  }
  function closePlan2DModal(){
    if(!__plan2d.active) return;
    __plan2d.active=false;
    plan2dUnbind();
    plan2dSetSelection(-1);
    __plan2d.chainActive=false;
    __plan2d.chainPoints=[];
    // Hide modal container
    try{ var page=document.getElementById('plan2d-page'); if(page) page.style.display='none'; }catch(_d){}
    plan2dDraw();
    try{ if(window.updateStatus) updateStatus('2D editor closed'); }catch(e){}
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
