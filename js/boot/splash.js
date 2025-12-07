// Simplified splash screen implementation
(function(){
  if(window.__simpleSplashInit) return; window.__simpleSplashInit = true;

  // Track when splash started for minimum display time
  window.__loadStartTime = Date.now();

  var total = 0;
  var loaded = 0;
  var firstFrame = false;
  var allDoneTime = 0;
  var watchdogStarted = false;
  var hidden = false;

  // Create minimal overlay if not present
  var root = document.getElementById('splash');
  if(!root){
    root = document.createElement('div');
    root.id = 'splash';
    root.style.position='fixed';
    root.style.inset='0';
    root.style.background='#0d1117';
    root.style.display='flex';
    root.style.flexDirection='column';
    root.style.alignItems='center';
    root.style.justifyContent='center';
    root.style.fontFamily='system-ui, sans-serif';
    root.style.zIndex='9999';
    var pct=document.createElement('div'); pct.className='splash-percent'; pct.style.fontSize='72px'; pct.style.fontWeight='700'; pct.style.color='#c9d1d9'; pct.textContent='0%';
    var list=document.createElement('div'); list.className='splash-module-list';
    root.appendChild(pct); root.appendChild(list);
    document.body.appendChild(root);
  }

  var pctEl = root.querySelector('.splash-percent');
  var listEl = root.querySelector('.splash-module-list');
  var helixConfig = {
    strands: 2,
    radius: 170,
    verticalGap: 30,
    twistDeg: 32,
    phaseOffsetDeg: 180,
    strandSeparation: 22,
    driftX: 180,
    driftZ: -140,
    spinPeriodMs: 18000,
    baselineRungs: 24
  };
  var helixState = {
    items: [],
    rungCount: 0,
    spinDeg: 0,
    rafId: null,
    lastTs: 0,
    connectors: [],
    expectedRungs: helixConfig.baselineRungs || 0,
    layoutPinned: false,
    layoutDenominator: Math.max(1, (helixConfig.baselineRungs || 1) - 1),
    originYOffset: -((Math.max(helixConfig.baselineRungs || 1, 1) - 1) *  helixConfig.verticalGap) / 2,
    nextSlot: 0
  };

  function syncHelixConnectors(rungCount){
    if(!listEl) return;
    if(!helixState.connectors) helixState.connectors = [];
    for(var r=0;r<rungCount;r++){
      if(!helixState.connectors[r] || !helixState.connectors[r].node){
        var connectorEl = document.createElement('div');
        connectorEl.className = 'splash-helix-connector is-pending';
        connectorEl.style.visibility = 'hidden';
        if(listEl.firstChild){
          listEl.insertBefore(connectorEl, listEl.firstChild);
        } else {
          listEl.appendChild(connectorEl);
        }
        helixState.connectors[r] = { node: connectorEl };
      }
    }
    for(var r=helixState.connectors.length - 1; r>=rungCount; r--){
      var conn = helixState.connectors[r];
      if(conn && conn.node && conn.node.parentNode){
        conn.node.parentNode.removeChild(conn.node);
      }
      helixState.connectors.pop();
    }
  }

  function updateConnectorTransforms(rungData){
    if(!helixState.connectors || !helixState.connectors.length) return;
    var cfg = helixConfig;
    for(var r=0;r<helixState.connectors.length;r++){
      var conn = helixState.connectors[r];
      if(!conn || !conn.node) continue;
      var rungInfo = rungData[r];
      var endpoints = rungInfo && rungInfo.points;
      if(!endpoints || !endpoints[0] || !endpoints[1]){
        conn.node.style.opacity = '0';
        conn.node.style.visibility = 'hidden';
        continue;
      }
      var priority = rungInfo.priority || 0;
      conn.node.classList.remove('is-pending','is-loading','is-loaded');
      conn.node.classList.add(priority>=2?'is-loaded':priority===1?'is-loading':'is-pending');
      var a = endpoints[0];
      var b = endpoints[1];
      var midX = (a.x + b.x) / 2;
      var midY = (a.y + b.y) / 2;
      var midZ = (a.z + b.z) / 2;
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var dz = b.z - a.z;
      var planar = Math.sqrt(dx*dx + dz*dz) || 0.0001;
      var length = Math.sqrt(planar*planar + dy*dy);
      var yaw = Math.atan2(dx, dz) * 180 / Math.PI;
      var pitch = Math.atan2(dy, planar) * 180 / Math.PI;
      var depth = Math.max(-cfg.radius, Math.min(cfg.radius, midZ));
      var opacity = 0.2 + (depth + cfg.radius) / (2 * cfg.radius) * 0.4;
      conn.node.style.width = length.toFixed(1) + 'px';
      conn.node.style.transform = 'translate3d(' + midX.toFixed(1) + 'px,' + midY.toFixed(1) + 'px,' + midZ.toFixed(1) + 'px) rotateY(' + yaw.toFixed(1) + 'deg) rotateX(' + (-pitch).toFixed(1) + 'deg)';
      conn.node.style.zIndex = String(Math.round(midZ) - 2);
      conn.node.style.opacity = opacity.toFixed(3);
      conn.node.style.visibility = 'visible';
    }
  }

  function rebuildHelixLayout(){
    if(!listEl) return;
    var nodes = Array.prototype.slice.call(listEl.querySelectorAll('.splash-module-cell'));
    nodes.sort(function(a, b){
      var aSlot = parseInt(a.dataset.helixSlot || '0', 10);
      var bSlot = parseInt(b.dataset.helixSlot || '0', 10);
      if(isNaN(aSlot)) aSlot = 0;
      if(isNaN(bSlot)) bSlot = 0;
      return aSlot - bSlot;
    });

    helixState.items = [];
    var total = nodes.length;
    if(!total){
      helixState.rungCount = 0;
      syncHelixConnectors(0);
      return;
    }

    var strands = Math.max(1, helixConfig.strands);
    var rungCount = Math.ceil(total / strands);

    for(var i=0;i<total;i++){
      var node = nodes[i];
      var slot = parseInt(node.dataset.helixSlot || String(i), 10);
      if(isNaN(slot)) slot = i;
      var strandIndex = strands === 1 ? 0 : (slot % strands);
      var rungIndex = Math.floor(slot / strands);
      var t = helixState.layoutDenominator > 0 ? (rungIndex / helixState.layoutDenominator) - 0.5 : 0;

      helixState.items.push({
        node: node,
        strandIndex: strandIndex,
        rungIndex: rungIndex,
        t: t
      });
    }

    helixState.rungCount = rungCount;
    syncHelixConnectors(rungCount);
  }

  function updateHelixTransforms(){
    if(!helixState.items.length) return;
    var cfg = helixConfig;
    var rungData = [];

    for(var i=0;i<helixState.items.length;i++){
      var info = helixState.items[i];
      var node = info.node;
      if(!node) continue;

      var angleDeg = info.rungIndex * cfg.twistDeg + info.strandIndex * cfg.phaseOffsetDeg + helixState.spinDeg;
      var angleRad = angleDeg * Math.PI / 180;

      var xBase = Math.sin(angleRad) * cfg.radius;
      var zBase = Math.cos(angleRad) * cfg.radius;
      var yBase = helixState.originYOffset + (info.rungIndex * cfg.verticalGap);
      var strandLift = (info.strandIndex === 0 ? -1 : 1) * (cfg.strandSeparation / 2);

      var driftFactor = info.t;
      var x = xBase + driftFactor * cfg.driftX;
      var z = zBase + driftFactor * cfg.driftZ;
      var y = yBase + strandLift;

      var transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + z.toFixed(1) + 'px) rotateY(' + angleDeg.toFixed(1) + 'deg)';
      if(node.classList && node.classList.contains('is-loaded')){
        transform += ' translateZ(8px) scale(1.05)';
      }
      node.style.transform = transform;
      node.style.zIndex = String(Math.round(z));
      var depth = Math.max(-cfg.radius, Math.min(cfg.radius, zBase));
      var depthOpacity = 0.35 + (depth + cfg.radius) / (2 * cfg.radius) * 0.65;
      node.style.opacity = (node.classList && node.classList.contains('is-loaded')) ? '1' : depthOpacity.toFixed(3);
      node.style.visibility = 'visible';

      if(!rungData[info.rungIndex]){
        rungData[info.rungIndex] = { points: [], priority: 0 };
      }
      var rungInfo = rungData[info.rungIndex];
      var nodePriority = 0;
      if(node.classList.contains('is-loaded')) nodePriority = 2;
      else if(node.classList.contains('is-loading')) nodePriority = 1;
      if(nodePriority > rungInfo.priority) rungInfo.priority = nodePriority;
      rungInfo.points[info.strandIndex] = { x: x, y: y, z: z };
    }

    updateConnectorTransforms(rungData);
  }

  function ensureHelixAnimator(){
    if(helixState.rafId) return;
    if(!listEl) return;
    helixState.lastTs = performance.now();

    var step = function(now){
      var delta = now - helixState.lastTs;
      helixState.lastTs = now;
      if(delta < 0) delta = 0;
      if(delta > 120) delta = 120; // clamp tab switches
      if(helixConfig.spinPeriodMs > 0){
        helixState.spinDeg = (helixState.spinDeg + 360 * (delta / helixConfig.spinPeriodMs)) % 360;
      }
      updateHelixTransforms();
      helixState.rafId = window.requestAnimationFrame(step);
    };

    helixState.rafId = window.requestAnimationFrame(step);
  }

  function positionHelixCells(){
    rebuildHelixLayout();
    updateHelixTransforms();
    ensureHelixAnimator();
  }

  function render(){
    if(total===0) return;
    var p = Math.min(100, Math.round(loaded/total*100));
    if(pctEl) pctEl.textContent = p + '%';
  }
  function hideSplash(){
    if(hidden) return; hidden = true;
    root.classList.add('splash-hide');
    root.style.opacity='0';
    // Add app-ready class to body to show 3D canvas and UI
    setTimeout(function(){ 
      try { document.body.classList.add('app-ready'); } catch(e){}
    }, 200);
    setTimeout(function(){ try{ root.remove(); }catch(e){} }, 400);
  }
  function maybeHide(){
    if(hidden) return;
    // Wait for ALL modules to load (not just essentials) + first frame + minimum display time
    var now = Date.now();
    var minDisplayTime = 600; // Slightly reduced for snappier feel
    var loadStartTime = window.__loadStartTime || now;
    var timeSinceStart = now - loadStartTime;
    var fullDone = (loaded === total && total > 0);
    if (fullDone && firstFrame && timeSinceStart >= minDisplayTime){
      console.log('[Splash] Hiding (fullDone='+fullDone+', firstFrame='+firstFrame+', ms='+timeSinceStart+')');
      hideSplash();
    }
  }

  // Public API (kept names for compatibility)
  function pinHelixLayout(expected){
    var r = Math.max(expected || helixConfig.baselineRungs || 1, 1);
    helixState.expectedRungs = r;
    helixState.layoutDenominator = Math.max(1, r - 1);
    helixState.originYOffset = -((r - 1) * helixConfig.verticalGap) / 2;
    helixState.layoutPinned = true;
  }

  window.__splashSetTotal = function(t){
    total = parseInt(t)||0;
    render();
    var expected = Math.ceil((total || 0) / Math.max(1, helixConfig.strands));
    expected = Math.max(expected, helixConfig.baselineRungs || 0);
    if(!helixState.layoutPinned && expected){
      pinHelixLayout(expected);
      positionHelixCells();
    }
  };

  // Create a floating DNA cell for a module name
  window.__splashExpect = function(name){
    if(listEl){
      var cell = document.createElement('div');
      cell.className = 'splash-module-cell';

      var keyline = document.createElement('span');
      keyline.className = 'splash-module-keyline';

      var label = document.createElement('span');
      label.className = 'splash-module-label';
      label.textContent = name;

      cell.appendChild(keyline);
      cell.appendChild(label);

      var slotIndex = helixState.nextSlot++;
      cell.dataset.helixSlot = String(slotIndex);
      cell.setAttribute('data-module', name);
      cell.style.visibility = 'hidden';
      listEl.appendChild(cell);
      positionHelixCells();

      cell.classList.add('is-pending');
      (function(target){
        setTimeout(function(){
          if(!target || target.classList.contains('is-loaded')) return;
          target.classList.add('is-loading');
          target.classList.remove('is-pending');
        }, 300);
      })(cell);
    }
  };
  window.__splashTick = function(name){
    loaded++; render();
    if(listEl){
      var cell = listEl.querySelector('[data-module="'+name+'"]');
      if(cell){
        cell.classList.remove('is-pending');
        cell.classList.remove('is-loading');
        cell.classList.add('is-loaded');
      }
    }
    if(loaded===total){
      allDoneTime = Date.now();
      // Start watchdog to force first frame if renderer hasn't produced one shortly.
      if(!watchdogStarted){
        watchdogStarted = true;
        setTimeout(function(){
          try {
            if(!firstFrame && !hidden){
              if(typeof window.setupCanvas==='function') window.setupCanvas();
              if(typeof window.updateProjectionCache==='function') window.updateProjectionCache();
              if(typeof window.renderLoop==='function') window.renderLoop();
            }
          } catch(_eForce){}
        }, 1500);
        setTimeout(function(){ maybeHide(); }, 2000);
      }
    }
    maybeHide();
  };
  window.__splashSetMessage = function(m){ if(msgEl) msgEl.textContent = m; };
  window.__splashFirstFrame = function(){ firstFrame = true; maybeHide(); };
  // Listen for all modules completion to attempt hide
  window.addEventListener('gablok:all-modules-complete', function(){ setTimeout(maybeHide, 50); });
  window.__splashMark = function(){ /* no-op maintained for compatibility */ };

  window.addEventListener('resize', function(){
    positionHelixCells();
  });

  // Accelerated failsafe sequence: attempt progressive hide if first frame delayed
  setTimeout(function(){ if(!hidden) { console.warn('[Splash] 2500ms fallback check'); maybeHide(); } }, 2500);
  setTimeout(function(){ if(!hidden) { console.warn('[Splash] 4000ms forcing hide'); hideSplash(); } }, 4000);
})();
