// Visualize modal: high-end render preview via three.js with Fabric.js annotations.
(function(){
  if (typeof window === 'undefined') return;

  var THREE = window.THREE;
  var fabricRef = window.fabric;
  var libsPromise = null;

  var PANEL_ID = 'visualize-modal';
  var CANVAS_ID = 'visualize-render-canvas';
  var FABRIC_ID = 'visualize-annotations';
  var QUALITY_ID = 'visualize-quality';
  var LOADING_ID = 'visualize-loading';
  var FOOTNOTE_ID = 'visualize-footnote';
  var PHOTOREAL_ENDPOINT = '/api/photoreal/render';

  var renderer = null;
  var scene = null;
  var camera = null;
  var composer = null;
  var fabricCanvas = null;
  var sceneRoot = null;
  var pmremGenerator = null;
  var envRT = null;
  var envLoadPromise = null;
  var currentQuality = 1;
  var lastHash = null;
  // Optional manual offsets (default zero) to shift the model within the frame if needed.
  // Positive X moves the apparent model right, positive Y moves it up.
  var VISUALIZE_OFFSET_X = 0;
  var VISUALIZE_OFFSET_Y = 0;
  var RENDER_CAMERA_PULLBACK = 1;
  var viewIndex = 0;
  var VIEW_PRESETS = [];
  var viewButtons = [];
  var skyTexture = null;
  var skyGradientPalette = null;
  var galleryShots = [];
  var galleryShotMap = Object.create(null);
  var concreteTextureCache = null;
  var SKY_GRADIENT_PRESETS = [
    // Photorealistic sky variations - different times and weather conditions
    { name: 'Midday Clear', zenith: '#2B5FAB', mid: '#5B9DE8', horizon: '#FFE8C8', sun: '#FFFACD', sunX: 0.7, sunY: 0.22, exposure: 1.85, sunIntensity: 5.2, ambientIntensity: 0.45 },
    { name: 'Morning Golden', zenith: '#4A7BC8', mid: '#87CEEB', horizon: '#FFD48B', sun: '#FFA54F', sunX: 0.82, sunY: 0.28, exposure: 1.65, sunIntensity: 4.0, ambientIntensity: 0.38 },
    { name: 'Afternoon Warm', zenith: '#3B6DC7', mid: '#7AB3D8', horizon: '#FFE0B5', sun: '#FFE4B5', sunX: 0.65, sunY: 0.32, exposure: 1.75, sunIntensity: 4.5, ambientIntensity: 0.42 },
    { name: 'Crisp Morning', zenith: '#1E4D8B', mid: '#4A7BC8', horizon: '#B8D8F0', sun: '#FFFACD', sunX: 0.75, sunY: 0.18, exposure: 1.9, sunIntensity: 5.5, ambientIntensity: 0.35 },
    { name: 'Late Afternoon', zenith: '#5580C8', mid: '#8BB0D8', horizon: '#FFB86C', sun: '#FF9966', sunX: 0.25, sunY: 0.65, exposure: 1.55, sunIntensity: 3.8, ambientIntensity: 0.48 },
    { name: 'Bright Overcast', zenith: '#B0C4D8', mid: '#C8D8E8', horizon: '#E0E8F0', sun: '#FFFFFF', sunX: 0.5, sunY: 0.3, exposure: 1.45, sunIntensity: 3.0, ambientIntensity: 0.55 },
    { name: 'Perfect Blue', zenith: '#357ABD', mid: '#6BA8D8', horizon: '#D0E8FF', sun: '#FFF8E8', sunX: 0.68, sunY: 0.25, exposure: 1.8, sunIntensity: 4.8, ambientIntensity: 0.4 },
    { name: 'Soft Daylight', zenith: '#5A8BC8', mid: '#8AB8E0', horizon: '#F0F4FF', sun: '#FFF8DC', sunX: 0.6, sunY: 0.35, exposure: 1.7, sunIntensity: 3.5, ambientIntensity: 0.5 }
  ];
  var rng = createRandomGenerator();
  var lastCanvasWidth = 0;
  var lastCanvasHeight = 0;
  var lastCanvasCssWidth = 0;
  var lastCanvasCssHeight = 0;
  var resizeHooked = false;
  var resizeObserver = null;
  var tileOverlayCanvas = null;
  var tileRevealTimers = [];
  var tileRevealCleanup = null;
  var TILE_REVEAL_SIZE = 100;
  var alignmentGridEnabled = true;
  var alignmentGridCanvas = null;
  var CAMERA_PULLBACK_METERS = 0;
  var CAMERA_FOCUS_OFFSET_RIGHT = 0;
  var CAMERA_FOCUS_OFFSET_UP = 0;
  var CAMERA_FOCUS_OFFSET_FORWARD = 0;
  var DEBUG_MARKERS_ENABLED = true;
  var debugMarkers = [];
  var lastLiveViewportDataUrl = null;
  var liveViewportProfile = null; // Complete snapshot of viewport state

  function captureCompleteViewportProfile() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📸 CAPTURING COMPLETE VIEWPORT PROFILE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    var profile = {
      timestamp: Date.now(),
      viewport: {},
      camera: {},
      projection: {},
      canvas: {},
      geometry: {},
      rendering: {}
    };
    
    // 1. CAPTURE CANVAS/VIEWPORT DIMENSIONS
    var baseCanvas = document.getElementById('canvas');
    if (baseCanvas) {
      var rect = baseCanvas.getBoundingClientRect();
      profile.canvas = {
        width: baseCanvas.width,
        height: baseCanvas.height,
        cssWidth: baseCanvas.clientWidth || rect.width,
        cssHeight: baseCanvas.clientHeight || rect.height,
        offsetLeft: baseCanvas.offsetLeft,
        offsetTop: baseCanvas.offsetTop,
        rectLeft: rect.left,
        rectTop: rect.top,
        rectWidth: rect.width,
        rectHeight: rect.height,
        devicePixelRatio: window.devicePixelRatio || 1
      };
      console.log('  ✓ Canvas captured:', profile.canvas.width, 'x', profile.canvas.height, 'px');
    }
    
    // 2. CAPTURE CAMERA ORBIT STATE (from window.camera)
    if (window.camera) {
      profile.camera = {
        yaw: window.camera.yaw,
        pitch: window.camera.pitch,
        distance: window.camera.distance,
        targetX: window.camera.targetX,
        targetY: window.camera.targetY,
        targetZ: window.camera.targetZ,
        minPitch: window.camera.minPitch,
        maxPitch: window.camera.maxPitch,
        minDistance: window.camera.minDistance,
        maxDistance: window.camera.maxDistance,
        fov: window.camera.fov,
        near: window.camera.near,
        far: window.camera.far
      };
      console.log('  ✓ Camera orbit:', 
        'yaw=' + profile.camera.yaw.toFixed(3),
        'pitch=' + profile.camera.pitch.toFixed(3),
        'dist=' + profile.camera.distance.toFixed(2));
      console.log('  ✓ Camera target:', 
        '(' + profile.camera.targetX.toFixed(2) + 
        ', ' + profile.camera.targetY.toFixed(2) + 
        ', ' + profile.camera.targetZ.toFixed(2) + ')');
    }
    
    // 3. CAPTURE PROJECTION CACHE (from window.__proj)
    if (window.updateProjectionCache) {
      try { window.updateProjectionCache(); } catch(e) {}
    }
    if (window.__proj) {
      profile.projection = {
        scale: window.__proj.scale,
        cam: window.__proj.cam ? Array.from(window.__proj.cam) : null,
        // Target comes from window.camera, not __proj
        target: (window.camera && typeof window.camera.targetX === 'number') ? 
          [window.camera.targetX, window.camera.targetY || 0, window.camera.targetZ] : null,
        up: window.__proj.up ? Array.from(window.__proj.up) : null,
        right: window.__proj.right ? Array.from(window.__proj.right) : null,
        fwd: window.__proj.fwd ? Array.from(window.__proj.fwd) : null,
        matrix: window.__proj.matrix ? Array.from(window.__proj.matrix) : null,
        perspectiveStrength: (typeof window.PERSPECTIVE_STRENGTH === 'number') ? window.PERSPECTIVE_STRENGTH : null,
        referenceDistance: (window.camera && isFiniteNumber(window.camera.distance)) ? window.camera.distance : null
      };
      console.log('  ✓ Projection scale:', profile.projection.scale);
      if (profile.projection.cam) {
        console.log('  ✓ Projection camera position:', 
          '(' + profile.projection.cam[0].toFixed(2) + 
          ', ' + profile.projection.cam[1].toFixed(2) + 
          ', ' + profile.projection.cam[2].toFixed(2) + ')');
      }
      if (profile.projection.target) {
        console.log('  ✓ Projection target (lookAt):', 
          '(' + profile.projection.target[0].toFixed(2) + 
          ', ' + profile.projection.target[1].toFixed(2) + 
          ', ' + profile.projection.target[2].toFixed(2) + ')');
      }
      if (!profile.projection.perspectiveStrength && typeof window.PERSPECTIVE_STRENGTH === 'number') {
        profile.projection.perspectiveStrength = window.PERSPECTIVE_STRENGTH;
      }
      if (!profile.projection.referenceDistance && window.camera && isFiniteNumber(window.camera.distance)) {
        profile.projection.referenceDistance = window.camera.distance;
      }
      var cssWidth = profile.canvas && isFiniteNumber(profile.canvas.cssWidth) && profile.canvas.cssWidth > 0 ? profile.canvas.cssWidth : null;
      var cssHeight = profile.canvas && isFiniteNumber(profile.canvas.cssHeight) && profile.canvas.cssHeight > 0 ? profile.canvas.cssHeight : null;
      if ((!cssWidth || !cssHeight) && profile.canvas && isFiniteNumber(profile.canvas.width) && profile.canvas.devicePixelRatio) {
        var dprForCanvas = profile.canvas.devicePixelRatio || 1;
        if (!cssWidth || !cssHeight) {
          cssWidth = cssWidth || (profile.canvas.width / dprForCanvas);
          cssHeight = cssHeight || (profile.canvas.height / dprForCanvas);
        }
      }
      if (cssWidth && cssHeight) {
        var nearClip = profile.camera && isFiniteNumber(profile.camera.near) ? profile.camera.near : 0.05;
        var farClip = profile.camera && isFiniteNumber(profile.camera.far) ? profile.camera.far : Math.max(nearClip + 1000, 2000);
        var hybridMatrix = computeHybridProjectionMatrix(cssWidth, cssHeight, nearClip, farClip, {
          scale: profile.projection.scale,
          perspectiveStrength: profile.projection.perspectiveStrength,
          referenceDistance: profile.projection.referenceDistance
        });
        if (hybridMatrix) {
          profile.projection.matrix = Array.from(hybridMatrix.elements);
        }
      }
    }
    
    // 4. CAPTURE PAN OFFSET
    if (window.pan) {
      profile.viewport.pan = {
        x: window.pan.x || 0,
        y: window.pan.y || 0
      };
      console.log('  ✓ Pan offset:', 
        'x=' + profile.viewport.pan.x.toFixed(2),
        'y=' + profile.viewport.pan.y.toFixed(2));
    } else {
      profile.viewport.pan = { x: 0, y: 0 };
      console.log('  ✓ Pan offset: x=0.00 y=0.00 (not set)');
    }
    
    // 5. CAPTURE ZOOM LEVEL
    if (window.zoom !== undefined) {
      profile.viewport.zoom = window.zoom;
      console.log('  ✓ Zoom level:', profile.viewport.zoom);
    } else {
      profile.viewport.zoom = 1;
      console.log('  ✓ Zoom level: 1.0000 (default)');
    }
    
    // 6. CAPTURE SCENE BOUNDS (if available)
    if (window.allRooms && Array.isArray(window.allRooms)) {
      var bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      window.allRooms.forEach(function(room) {
        if (!room) return;
        var hw = (room.width || 0) / 2;
        var hd = (room.depth || 0) / 2;
        bounds.minX = Math.min(bounds.minX, (room.x || 0) - hw);
        bounds.maxX = Math.max(bounds.maxX, (room.x || 0) + hw);
        bounds.minY = Math.min(bounds.minY, room.y || 0);
        bounds.maxY = Math.max(bounds.maxY, (room.y || 0) + (room.height || 3));
        bounds.minZ = Math.min(bounds.minZ, (room.z || 0) - hd);
        bounds.maxZ = Math.max(bounds.maxZ, (room.z || 0) + hd);
      });
      if (isFinite(bounds.minX)) {
        profile.geometry.bounds = bounds;
        profile.geometry.centerX = (bounds.minX + bounds.maxX) / 2;
        profile.geometry.centerY = (bounds.minY + bounds.maxY) / 2;
        profile.geometry.centerZ = (bounds.minZ + bounds.maxZ) / 2;
        profile.geometry.sizeX = bounds.maxX - bounds.minX;
        profile.geometry.sizeY = bounds.maxY - bounds.minY;
        profile.geometry.sizeZ = bounds.maxZ - bounds.minZ;
        console.log('  ✓ Geometry bounds:', 
          'size=(' + profile.geometry.sizeX.toFixed(2) + 
          ' x ' + profile.geometry.sizeY.toFixed(2) + 
          ' x ' + profile.geometry.sizeZ.toFixed(2) + ')');
        console.log('  ✓ Geometry center:', 
          '(' + profile.geometry.centerX.toFixed(2) + 
          ', ' + profile.geometry.centerY.toFixed(2) + 
          ', ' + profile.geometry.centerZ.toFixed(2) + ')');
      }
    }
    
    // 7. CAPTURE SCREENSHOT
    if (baseCanvas && typeof baseCanvas.toDataURL === 'function') {
      try {
        profile.rendering.screenshot = baseCanvas.toDataURL('image/png');
        console.log('  ✓ Screenshot captured:', profile.rendering.screenshot.length, 'bytes');
      } catch(e) {
        console.warn('  ✗ Screenshot capture failed:', e);
      }
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ VIEWPORT PROFILE COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    return profile;
  }

  function applyViewportProfileToCamera(profile) {
    if (!profile || !camera) return false;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 APPLYING VIEWPORT PROFILE TO CAMERA');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    var liveProjection = profile.projection || null;
    var canvasInfo = profile.canvas || null;
    var hasLiveMatrix = !!(liveProjection && Array.isArray(liveProjection.matrix) && liveProjection.matrix.length === 16);
    var hasLiveCam = !!(liveProjection && Array.isArray(liveProjection.cam) && liveProjection.cam.length >= 3);
    var hasBasis = !!(liveProjection && Array.isArray(liveProjection.right) && Array.isArray(liveProjection.up) && Array.isArray(liveProjection.fwd));
    var applied = false;

    // FIX #12: Use projection.target from __proj (the actual lookAt point)
    // NOT camera.target which may be orbit center (0,0,0)
    var target = new THREE.Vector3(0, 0, 0);
    if (liveProjection && Array.isArray(liveProjection.target)) {
      target.set(
        liveProjection.target[0],
        liveProjection.target[1],
        liveProjection.target[2]
      );
      console.log('  ✓ Using projection.target:', target.toArray());
    } else if (profile.camera) {
      target.set(
        isFiniteNumber(profile.camera.targetX) ? profile.camera.targetX : 0,
        isFiniteNumber(profile.camera.targetY) ? profile.camera.targetY : 0,
        isFiniteNumber(profile.camera.targetZ) ? profile.camera.targetZ : 0
      );
      console.log('  ✓ Using camera.target:', target.toArray());
    }
    
    // FIX #7: Use EXACT camera position from projection.cam array
    if (hasLiveCam) {
      camera.position.set(
        liveProjection.cam[0],
        liveProjection.cam[1],
        liveProjection.cam[2]
      );
      console.log('  ✓ Camera position from projection.cam:', camera.position.toArray());
      console.log('  ✓ Target:', target.toArray());
      console.log('  ✓ Distance:', camera.position.distanceTo(target).toFixed(4));
      applied = true;
    }
    
    function isFiniteNumber(val) {
      return typeof val === 'number' && isFinite(val);
    }
    
    var orientationLocked = false;
    if (hasBasis) {
      var rightVec = new THREE.Vector3(liveProjection.right[0], liveProjection.right[1], liveProjection.right[2]).normalize();
      var upVec = new THREE.Vector3(liveProjection.up[0], liveProjection.up[1], liveProjection.up[2]).normalize();
      var fwdVec = new THREE.Vector3(liveProjection.fwd[0], liveProjection.fwd[1], liveProjection.fwd[2]).normalize();
      var cameraMatrix = new THREE.Matrix4();
      var negForward = fwdVec.clone().negate();
      cameraMatrix.makeBasis(rightVec, upVec, negForward);
      camera.quaternion.setFromRotationMatrix(cameraMatrix);
      camera.up.copy(upVec);
      orientationLocked = true;
      console.log('  ✓ Orientation basis copied from live viewport');
      // If target was not provided, derive it from basis + position to guarantee alignment
      if (!profile.camera && target.lengthSq() === 0) {
        target.copy(camera.position).add(fwdVec);
      }
    }
    if (!orientationLocked) {
      if (liveProjection && Array.isArray(liveProjection.up)) {
        camera.up.set(
          liveProjection.up[0],
          liveProjection.up[1],
          liveProjection.up[2]
        ).normalize();
        console.log('  ✓ Camera up vector:', camera.up);
      } else {
        camera.up.set(0, 1, 0);
      }
      camera.lookAt(target);
      console.log('  ✓ Camera oriented via lookAt');
    } else if (target) {
      // Re-assert lookAt to keep Three's internal matrices coherent with the copied quaternion
      camera.lookAt(target);
    }
    
    // Set aspect ratio from canvas (used for logs/diagnostics only; projection matrix may override)
    if (canvasInfo) {
      camera.aspect = canvasInfo.width / canvasInfo.height;
      console.log('  ✓ Aspect ratio:', camera.aspect.toFixed(3));
    }
    
    var fovApplied = false;
    if (profile.camera && isFiniteNumber(profile.camera.fov)) {
      camera.fov = profile.camera.fov;
      fovApplied = true;
      console.log('  ✓ FOV copied from live camera:', camera.fov.toFixed(4));
    }
    if (!fovApplied && liveProjection && liveProjection.scale && canvasInfo) {
      var half = canvasInfo.cssHeight ? (canvasInfo.cssHeight * 0.5) : (canvasInfo.height * 0.5);
      if (half > 0) {
        var fovRad = 2 * Math.atan(half / liveProjection.scale);
        var fovDeg = fovRad * (180 / Math.PI);
        if (isFiniteNumber(fovDeg)) {
          camera.fov = fovDeg;
          fovApplied = true;
          console.log('  ✓ FOV derived from projection scale:', camera.fov.toFixed(4));
        }
      }
    }
    if (!fovApplied) {
      camera.fov = computeViewportFov();
      console.log('  ✓ FOV fallback (computeViewportFov):', camera.fov.toFixed(4));
    }
    
    // Set near/far planes
    if (profile.camera) {
      if (isFiniteNumber(profile.camera.near)) camera.near = profile.camera.near;
      if (isFiniteNumber(profile.camera.far)) camera.far = profile.camera.far;
      console.log('  ✓ Near/Far:', camera.near, '/', camera.far);
    }
    
    // Pan is handled by DOM-level translate (syncLivePanTransform) to keep
    // the live viewport screenshot and WebGL render perfectly aligned. Do not
    // reapply it to the camera, otherwise we introduce a double shift.
    
    // FIX #9: Apply zoom level if present (only when we do not have the live projection matrix)
    if (!hasLiveMatrix && profile.viewport && profile.viewport.zoom) {
      var zoom = profile.viewport.zoom;
      if (zoom !== 1.0) {
        camera.fov = camera.fov / zoom;
        console.log('  ✓ Zoom applied:', zoom.toFixed(4), '-> FOV:', camera.fov.toFixed(2));
      }
    }
    
    var projectionMatrixApplied = false;
    if (hasLiveMatrix) {
      camera.projectionMatrix.fromArray(liveProjection.matrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      projectionMatrixApplied = true;
      console.log('  ✓ Projection matrix copied from live viewport cache');
    } else if (liveProjection && liveProjection.scale && canvasInfo) {
      // Update projection matrix with hybrid projection to match live viewport
      // The live viewport uses PERSPECTIVE_STRENGTH=0.88 to blend perspective and orthographic
      var cssWidth = canvasInfo.cssWidth || (canvasInfo.width / (window.devicePixelRatio || 2));
      var cssHeight = canvasInfo.cssHeight || (canvasInfo.height / (window.devicePixelRatio || 2));
      applyExactProjection(camera, cssWidth, cssHeight, camera.near, camera.far, {
        scale: liveProjection.scale,
        perspectiveStrength: liveProjection.perspectiveStrength,
        referenceDistance: liveProjection.referenceDistance || (profile.camera && profile.camera.distance)
      });
      projectionMatrixApplied = true;
      console.log('  ✓ Hybrid projection applied (PERSPECTIVE_STRENGTH=0.88)');
    }

    if (!projectionMatrixApplied) {
      camera.updateProjectionMatrix();
      console.log('  ✓ Standard projection (fallback)');
    }
    camera.updateMatrixWorld(true);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ CAMERA CONFIGURED FROM PROFILE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // DIAGNOSTIC TABLE: Compare all parameters
    try {
      console.log('');
      console.log('╔════════════════════════════════════════════════════════════════╗');
      console.log('║  CAMERA COMPARISON: LIVE 3D VIEWPORT vs VISUALIZE RENDER      ║');
      console.log('╚════════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('FIXES APPLIED:');
      console.log('  • Camera position pulled directly from live orbit cache');
      console.log('  • Orientation basis (right/up/fwd) cloned for pixel-perfect alignment');
      console.log('  • Live FOV/clip planes copied verbatim (fallbacks only when missing)');
      console.log('  • Hybrid projection matrix reused when available');
      console.log('  • DOM pan handles screen-space offsets (no double-application)');
      console.log('');
      console.log('┌─────────────────────────┬──────────────────────┬──────────────────────┐');
      console.log('│ Parameter               │ Live 3D Viewport     │ Visualize Render     │');
      console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
      if (profile.projection && profile.projection.cam) {
        console.log('│ Camera Position X       │', (profile.projection.cam[0] || 0).toFixed(4).padEnd(20), '│', camera.position.x.toFixed(4).padEnd(20), '│');
        console.log('│ Camera Position Y       │', (profile.projection.cam[1] || 0).toFixed(4).padEnd(20), '│', camera.position.y.toFixed(4).padEnd(20), '│');
        console.log('│ Camera Position Z       │', (profile.projection.cam[2] || 0).toFixed(4).padEnd(20), '│', camera.position.z.toFixed(4).padEnd(20), '│');
      }
      console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
      if (profile.camera) {
        console.log('│ Target X                │', (profile.camera.targetX || 0).toFixed(4).padEnd(20), '│', target.x.toFixed(4).padEnd(20), '│');
        console.log('│ Target Y                │', (profile.camera.targetY || 0).toFixed(4).padEnd(20), '│', target.y.toFixed(4).padEnd(20), '│');
        console.log('│ Target Z                │', (profile.camera.targetZ || 0).toFixed(4).padEnd(20), '│', target.z.toFixed(4).padEnd(20), '│');
        console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
        console.log('│ Distance                │', (profile.camera.distance || 0).toFixed(4).padEnd(20), '│', camera.position.distanceTo(target).toFixed(4).padEnd(20), '│');
        console.log('│ Yaw                     │', (profile.camera.yaw || 0).toFixed(4).padEnd(20), '│', 'N/A'.padEnd(20), '│');
        console.log('│ Pitch                   │', (profile.camera.pitch || 0).toFixed(4).padEnd(20), '│', 'N/A'.padEnd(20), '│');
      }
      console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
      console.log('│ FOV (degrees)           │', ((profile.camera && profile.camera.fov) || 'calc').toString().padEnd(20), '│', camera.fov.toFixed(4).padEnd(20), '│');
      console.log('│ Aspect Ratio            │', (profile.canvas ? (profile.canvas.width / profile.canvas.height).toFixed(4) : '0').padEnd(20), '│', camera.aspect.toFixed(4).padEnd(20), '│');
      console.log('│ Near Plane              │', ((profile.camera && profile.camera.near) || camera.near).toFixed(4).padEnd(20), '│', camera.near.toFixed(4).padEnd(20), '│');
      console.log('│ Far Plane               │', ((profile.camera && profile.camera.far) || camera.far).toFixed(4).padEnd(20), '│', camera.far.toFixed(4).padEnd(20), '│');
      console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
      if (profile.projection) {
        console.log('│ Projection Scale        │', (profile.projection.scale || 0).toFixed(4).padEnd(20), '│', (profile.projection.scale || 0).toFixed(4).padEnd(20), '│');
      }
      if (profile.canvas) {
        console.log('│ Canvas Width            │', (profile.canvas.width || 0).toString().padEnd(20), '│', (profile.canvas.width || 0).toString().padEnd(20), '│');
        console.log('│ Canvas Height           │', (profile.canvas.height || 0).toString().padEnd(20), '│', (profile.canvas.height || 0).toString().padEnd(20), '│');
        console.log('│ CSS Width               │', (profile.canvas.cssWidth || 0).toString().padEnd(20), '│', (profile.canvas.cssWidth || 0).toString().padEnd(20), '│');
        console.log('│ CSS Height              │', (profile.canvas.cssHeight || 0).toString().padEnd(20), '│', (profile.canvas.cssHeight || 0).toString().padEnd(20), '│');
      }
      console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
      if (profile.projection && profile.projection.up) {
        console.log('│ Up Vector X             │', (profile.projection.up[0] || 0).toFixed(4).padEnd(20), '│', camera.up.x.toFixed(4).padEnd(20), '│');
        console.log('│ Up Vector Y             │', (profile.projection.up[1] || 0).toFixed(4).padEnd(20), '│', camera.up.y.toFixed(4).padEnd(20), '│');
        console.log('│ Up Vector Z             │', (profile.projection.up[2] || 0).toFixed(4).padEnd(20), '│', camera.up.z.toFixed(4).padEnd(20), '│');
      }
      console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
      if (profile.viewport && profile.viewport.pan) {
        console.log('│ Pan Offset X            │', (profile.viewport.pan.x || 0).toFixed(4).padEnd(20), '│', (profile.viewport.pan.x || 0).toFixed(4).padEnd(20), '│');
        console.log('│ Pan Offset Y            │', (profile.viewport.pan.y || 0).toFixed(4).padEnd(20), '│', (profile.viewport.pan.y || 0).toFixed(4).padEnd(20), '│');
      }
      if (profile.viewport && profile.viewport.zoom !== undefined) {
        console.log('│ Zoom                    │', (profile.viewport.zoom || 1).toFixed(4).padEnd(20), '│', (profile.viewport.zoom || 1).toFixed(4).padEnd(20), '│');
      }
      console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
      if (profile.geometry) {
        console.log('│ Geometry Center X       │', (profile.geometry.centerX || 0).toFixed(4).padEnd(20), '│', (profile.geometry.centerX || 0).toFixed(4).padEnd(20), '│');
        console.log('│ Geometry Center Y       │', (profile.geometry.centerY || 0).toFixed(4).padEnd(20), '│', (profile.geometry.centerY || 0).toFixed(4).padEnd(20), '│');
        console.log('│ Geometry Center Z       │', (profile.geometry.centerZ || 0).toFixed(4).padEnd(20), '│', (profile.geometry.centerZ || 0).toFixed(4).padEnd(20), '│');
      }
      console.log('└─────────────────────────┴──────────────────────┴──────────────────────┘');
      console.log('');
    } catch(e) {
      console.error('Table rendering error:', e);
    }
    
    return true;
  }

  var floorHeight = (function(){
    var defaultHeight = 3.5;
    try {
      if (window && typeof window.__floorHeight === 'number' && isFinite(window.__floorHeight)) {
        return window.__floorHeight;
      }
    } catch(_e){}
    return defaultHeight;
  })();
  var lights = [];
  var noiseTextures = Object.create(null);
  var materialExposureCache = Object.create(null);
  var EDGE_COLORS = {

    // Subtle edge definition for clean architectural look
    default: 0xe0e5eb,
    roof: 0xc5cad2,
    wall: 0xd8dde5,
    podium: 0xdce0e8,
    frame: 0xb0bcd0,
    glass: 0xe5f0ff,
    accent: 0xd0d8e2
  };
  var LIVE_VIEW_LABEL = 'Current View';
  var staticBaseCache = null;
  var HDRI_CANDIDATES = [
    'textures/env/studio_loft_4k.hdr',
    'textures/env/studio_soft_2k.hdr',
    'https://cdn.jsdelivr.net/gh/gltf-test/glTF-Sample-Environments/EnvironmentMaps/papermill.hdr',
    'https://cdn.jsdelivr.net/gh/gltf-test/glTF-Sample-Environments/EnvironmentMaps/studio_small_08_2k.hdr'
  ];

  function getStaticBase(){
    if (staticBaseCache !== null) return staticBaseCache;
    var base = '';
    try {
      if (typeof window.__VISUALIZE_STATIC_BASE === 'string') {
        base = window.__VISUALIZE_STATIC_BASE.trim();
      }
    } catch(_s){}
    staticBaseCache = base;
    return staticBaseCache;
  }

  function resolveStaticAsset(path){
    if (!path) return path;
    if (/^(?:https?:)?\/\//i.test(path)) return path;
    var base = getStaticBase();
    if (base) return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
    if (path.charAt(0) === '/') return path;
    return path;
  }

  function handleVisualizeError(err){
    console.error('[Visualize] initialization failed', err);
    var loading = qs(LOADING_ID);
    if (loading){
      var message = 'Unable to start renderer. Check your connection and try again.';
      if (err && err.message) message = err.message;
      loading.textContent = message;
      loading.classList.add('visible');
      window.setTimeout(function(){
        loading.textContent = 'Generating...';
        loading.classList.remove('visible');
      }, 4000);
    }
    updateGalleryGrid('Unable to load rendering engine. Please verify you are online and retry.');
    try {
      if (window.updateStatus) window.updateStatus('Visualize failed: ' + (err && err.message ? err.message : 'Renderer unavailable'));
    } catch(_s){}
  }

  function qs(id){ return document.getElementById(id); }

  function isFiniteNumber(val){ return typeof val === 'number' && isFinite(val); }

  function vectorToArray(vec){
    if (!vec) return [0, 0, 0];
    return [Number(vec.x) || 0, Number(vec.y) || 0, Number(vec.z) || 0];
  }

  function computeViewportFov(){
    try {
      if (!window) return 48;
      var scale = window.__proj && isFiniteNumber(window.__proj.scale) ? window.__proj.scale : null;
      if (!scale || scale <= 0) return 48;
        var dpr = window.devicePixelRatio || 1; // Device pixel ratio for accurate viewport calculations.
      var baseCanvas = document.getElementById('canvas');
      var cssHeight = 0;
      if (baseCanvas && isFiniteNumber(baseCanvas.height) && baseCanvas.height > 0) {
        cssHeight = baseCanvas.height / dpr;
      } else {
        cssHeight = window.innerHeight || 720;
      }
      if (!cssHeight || cssHeight <= 0) cssHeight = 720;
      var half = cssHeight * 0.5;
      var fovRad = 2 * Math.atan(half / scale);
      var fovDeg = fovRad * (180 / Math.PI);
      if (isFiniteNumber(fovDeg) && fovDeg > 10 && fovDeg < 170) {
        return fovDeg;
      }
    } catch(_eFov){}
    return 48;
  }

  function numberFromKeys(source, keys, fallback){
    if (!source) return fallback || 0;
    for (var i = 0; i < keys.length; i++){
      var key = keys[i];
      if (isFiniteNumber(source[key])) return Number(source[key]);
    }
    return fallback || 0;
  }

  function computeHybridProjectionMatrix(cssWidth, cssHeight, near, far, options){
    if (!THREE) return null;
    options = options || {};
    var scale = isFiniteNumber(options.scale) ? options.scale : null;
    if (!scale) {
      var proj = (typeof window !== 'undefined') ? window.__proj : null;
      if (proj && isFiniteNumber(proj.scale)) scale = proj.scale;
    }
    if (!isFiniteNumber(scale) || scale <= 0) return null;
    if (!isFiniteNumber(cssWidth) || cssWidth <= 0 || !isFiniteNumber(cssHeight) || cssHeight <= 0) return null;
    if (!isFiniteNumber(near) || near <= 0) near = 0.1;
    if (!isFiniteNumber(far) || far <= near) far = near + 1000;
    var perspectiveStrength = options.hasOwnProperty('perspectiveStrength') && isFiniteNumber(options.perspectiveStrength)
      ? options.perspectiveStrength
      : ((typeof window !== 'undefined' && isFiniteNumber(window.PERSPECTIVE_STRENGTH)) ? window.PERSPECTIVE_STRENGTH : 0.88);
    var k = Math.max(0, Math.min(1, perspectiveStrength));
    var refZ = options && isFiniteNumber(options.referenceDistance) ? options.referenceDistance : null;
    if (!isFiniteNumber(refZ) || refZ <= 0.01) {
      refZ = (typeof window !== 'undefined' && window.camera && isFiniteNumber(window.camera.distance)) ? window.camera.distance : 12;
    }
    refZ = Math.max(0.5, refZ);
    var scaleX =  2 * scale / cssWidth;
    var scaleY = -2 * scale / cssHeight;
    var m = new THREE.Matrix4();
    var e = m.elements;
    e[0] = scaleX; e[4] = 0;       e[8]  = 0;                        e[12] = 0;
    e[1] = 0;      e[5] = scaleY; e[9]  = 0;                        e[13] = 0;
    e[2] = 0;      e[6] = 0;      e[10] = -(far + near) / (far - near); e[14] = -(2 * far * near) / (far - near);
    e[3] = 0;      e[7] = 0;      e[11] = -k;                       e[15] = (1 - k) * refZ;
    return m;
  }

  function applyExactProjection(cam, cssWidth, cssHeight, near, far, options){
    if (!THREE || !cam) return;
    var matrix = computeHybridProjectionMatrix(cssWidth, cssHeight, near, far, options);
    if (!matrix) {
      cam.updateProjectionMatrix();
      return;
    }
    cam.projectionMatrix.copy(matrix);
    cam.projectionMatrixInverse.copy(matrix.clone().invert());
  }

  function cloneFootprint(points){
    if (!Array.isArray(points)) return null;
    var clean = [];
    for (var i = 0; i < points.length; i++){
      var pt = points[i];
      if (!pt) continue;
      var x = isFiniteNumber(pt.x) ? Number(pt.x) : null;
      var z = isFiniteNumber(pt.z) ? Number(pt.z) : null;
      if (x === null || z === null) continue;
      clean.push({ x: x, z: z });
    }
    return clean.length >= 3 ? clean : null;
  }

  function sanitizeCollection(list, transform){
    var result = [];
    if (!Array.isArray(list)) return result;
    list.forEach(function(item){
      var cleaned = transform ? transform(item) : item;
      if (cleaned) result.push(cleaned);
    });
    return result;
  }

  function cleanBoxItem(item, kind, overrides){
    if (!item) return null;
    overrides = overrides || {};
    var width = numberFromKeys(item, overrides.widthKeys || ['width','w','sizeX','lenX','length','spanX','diameter','radius','radiusX'], overrides.defaultWidth || 0);
    var depth = numberFromKeys(item, overrides.depthKeys || ['depth','d','sizeZ','lenZ','lengthZ','spanZ','radius','radiusZ'], overrides.defaultDepth || width);
    var height = numberFromKeys(item, overrides.heightKeys || ['height','sizeY','lenY','spanY'], overrides.defaultHeight || floorHeight);
    var baseHeight = numberFromKeys(item, ['baseHeight','base','baseY','y'], overrides.defaultBase || 0);
    var posX = numberFromKeys(item, ['x','cx','posX'], 0);
    var posZ = numberFromKeys(item, ['z','cz','posZ'], 0);
    var rotation = numberFromKeys(item, ['rotation','rot','angle'], 0);
    var level = numberFromKeys(item, ['level','floor'], 0);
    var footprint = cloneFootprint(item.footprint);
    return {
      kind: kind,
      id: item.id || item.uuid || item.guid || item.name || null,
      name: item.name || kind,
      width: width,
      depth: depth,
      height: height,
      baseHeight: baseHeight,
      x: posX,
      z: posZ,
      level: level,
      rotation: rotation,
      footprint: footprint
    };
  }

  function cleanWallStrip(strip){
    if (!strip) return null;
    var start = {
      x: numberFromKeys(strip, ['x0','startX','x'], 0),
      z: numberFromKeys(strip, ['z0','startZ','z'], 0)
    };
    var end = {
      x: numberFromKeys(strip, ['x1','endX','x'], start.x),
      z: numberFromKeys(strip, ['z1','endZ','z'], start.z)
    };
    var baseHeight = numberFromKeys(strip, ['baseHeight','y','base','baseY'], 0);
    var height = numberFromKeys(strip, ['wallHeight','height'], floorHeight);
    var thickness = numberFromKeys(strip, ['thickness','width','depth'], 0.25);
    return {
      id: strip.id || strip.uuid || strip.guid || null,
      level: numberFromKeys(strip, ['level'], 0),
      start: start,
      end: end,
      baseHeight: baseHeight,
      height: height,
      thickness: Math.max(0.05, thickness)
    };
  }

  function sanitizeSnapshot(raw){
    raw = raw || {};
    return {
      rooms: sanitizeCollection(raw.rooms, function(room){ return cleanBoxItem(room, 'room'); }),
      wallStrips: sanitizeCollection(raw.wallStrips, cleanWallStrip),
      pergolas: sanitizeCollection(raw.pergolas, function(item){ return cleanBoxItem(item, 'pergola'); }),
      garages: sanitizeCollection(raw.garages, function(item){ return cleanBoxItem(item, 'garage'); }),
      pools: sanitizeCollection(raw.pools, function(item){ return cleanBoxItem(item, 'pool', { heightKeys: ['height','depth','sizeY'], defaultHeight: 1.2 }); }),
      roofs: sanitizeCollection(raw.roofs, function(item){ return cleanBoxItem(item, 'roof'); }),
      balconies: sanitizeCollection(raw.balconies, function(item){ return cleanBoxItem(item, 'balcony'); }),
      furniture: sanitizeCollection(raw.furniture, function(item){ return cleanBoxItem(item, 'furniture'); }),
      stairs: sanitizeCollection(raw.stairs, function(item){ return cleanBoxItem(item, 'stairs'); }),
      meta: {
        floorHeight: floorHeight
      }
    };
  }

  function cameraToPayload(cam){
    if (!cam || !THREE) return null;
    var dir = new THREE.Vector3();
    var target;
    try {
      cam.getWorldDirection(dir);
      dir.normalize();
      target = cam.position.clone().add(dir.multiplyScalar(5));
    } catch(_e){
      target = new THREE.Vector3(0, 0, -1);
    }
    return {
      position: vectorToArray(cam.position),
      target: vectorToArray(target),
      up: vectorToArray(cam.up),
      fov: cam.fov,
      near: cam.near,
      far: cam.far,
      aspect: cam.aspect
    };
  }

  function presetToPayload(preset){
    if (!preset) return null;
    return {
      position: preset.position ? vectorToArray(preset.position) : null,
      target: preset.target ? vectorToArray(preset.target) : null,
      up: preset.up ? vectorToArray(preset.up) : null,
      fov: preset.fov,
      near: preset.near,
      far: preset.far
    };
  }

  function collectProjectMeta(){
    var meta = { timestamp: Date.now() };
    try {
      if (window.projectName) meta.projectName = window.projectName;
      else if (window.currentProjectName) meta.projectName = window.currentProjectName;
    } catch(_e){}
    try {
      if (window.currentUser && typeof window.currentUser === 'object') meta.user = window.currentUser;
    } catch(_u){}
    try {
      if (typeof window.currentFloor !== 'undefined') meta.currentFloor = window.currentFloor;
    } catch(_f){}
    meta.floorHeight = floorHeight;
    return meta;
  }

  function ensureSecondaryUV(geometry){
    if (!geometry || !geometry.attributes || !geometry.attributes.uv) return;
    if (geometry.attributes.uv2) return;
    geometry.setAttribute('uv2', geometry.attributes.uv.clone());
  }

  function selectSkyPalette(){
    if (skyGradientPalette && typeof skyGradientPalette === 'object') return skyGradientPalette;
    var source = (rng && typeof rng.next === 'function') ? rng.next() : Math.random();
    var idx = Math.floor((source || 0) * SKY_GRADIENT_PRESETS.length);
    if (!isFiniteNumber(idx) || idx < 0) idx = 0;
    skyGradientPalette = SKY_GRADIENT_PRESETS[idx % SKY_GRADIENT_PRESETS.length] || SKY_GRADIENT_PRESETS[0];
    console.log('[Visualize] Sky preset:', skyGradientPalette.name);
    return skyGradientPalette;
  }

  function createSkyTexture(){
    // Return null to use solid background color
    return null;
  }

  function distortVertices(geometry, strength, randomnessFn){
    if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
    var position = geometry.attributes.position;
    var arr = position.array;
    var random = randomnessFn || function(){ return Math.random(); };
    var max = strength || 0.15;
    for (var i = 0; i < arr.length; i += 3){
      var offset = (random() * 2 - 1) * max;
      arr[i] += offset * 0.6;
      arr[i + 1] += offset;
      arr[i + 2] += offset * 0.6;
    }
    position.needsUpdate = true;
    if (geometry.computeVertexNormals) geometry.computeVertexNormals();
  }

  function createBoulder(radius, detail, colorKey){
    if (!THREE) return null;
    var geom = new THREE.IcosahedronGeometry(radius || 0.5, detail || 2);
    distortVertices(geom, (radius || 0.5) * 0.35, function(){ return rng.next(); });
    ensureSecondaryUV(geom);
    var mat = materialFor(colorKey || 'boulder');
    var mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function createGrassTuft(radius, height){
    if (!THREE) return null;
    var bladeCount = 6;
    var group = new THREE.Group();
    var mat = materialFor('foliage');
    for (var i = 0; i < bladeCount; i++){
      var bladeHeight = height * (0.7 + rng.range(0, 0.6));
      var bladeGeom = new THREE.CylinderGeometry(0.01, 0.06, bladeHeight, 6, 1, true);
      ensureSecondaryUV(bladeGeom);
      var blade = new THREE.Mesh(bladeGeom, mat);
      blade.position.y = bladeHeight / 2;
      blade.rotation.y = rng.range(0, Math.PI * 2);
      blade.geometry.computeVertexNormals();
      blade.castShadow = false;
      blade.receiveShadow = true;
      group.add(blade);
    }
    var baseGeom = new THREE.CylinderGeometry(radius * 0.6, radius, radius * 0.25, 8, 1);
    ensureSecondaryUV(baseGeom);
    var baseMat = materialFor('groundPath');
    var base = new THREE.Mesh(baseGeom, baseMat);
    group.add(base);
    group.traverse(function(obj){
      if (obj && obj.isMesh){
        obj.castShadow = false;
        obj.receiveShadow = true;
      }
    });
    return group;
  }

  function createRandomGenerator(){
    var seed = 1;
    function mulberry32(a){
      return function(){
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    var rand = mulberry32(seed);
    return {
      next: function(){
        return rand();
      },
      reseed: function(nextSeed){
        seed = nextSeed || 1;
        rand = mulberry32(seed);
      },
      range: function(min, max){
        var a = isFiniteNumber(min) ? min : 0;
        var b = isFiniteNumber(max) ? max : 1;
        if (b < a) {
          var tmp = a;
          a = b;
          b = tmp;
        }
        return a + (b - a) * rand();
      },
      rangeInt: function(min, max){
        var a = Math.ceil(isFiniteNumber(min) ? min : 0);
        var b = Math.floor(isFiniteNumber(max) ? max : a);
        if (b < a) {
          var tmp = a;
          a = b;
          b = tmp;
        }
        if (a === b) return a;
        return a + Math.floor(rand() * (b - a + 1));
      }
    };
  }

  function rgbToHex(r, g, b){
    return (clampColor(Math.round(r)) << 16) | (clampColor(Math.round(g)) << 8) | clampColor(Math.round(b));
  }

  function adjustColor(hex, exposure, tint){
    var r = (hex >> 16) & 255;
    var g = (hex >> 8) & 255;
    var b = hex & 255;
    var gain = isFiniteNumber(exposure) ? exposure : 1;
    var tr = tint ? tint.r || 0 : 0;
    var tg = tint ? tint.g || 0 : 0;
    var tb = tint ? tint.b || 0 : 0;
    return rgbToHex(r * gain + tr, g * gain + tg, b * gain + tb);
  }

  function colorLuminance(hex){
    var r = (hex >> 16) & 255;
    var g = (hex >> 8) & 255;
    var b = hex & 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function averageLuminance(palette){
    if (!Array.isArray(palette) || palette.length === 0) return 180;
    var total = 0;
    for (var i = 0; i < palette.length; i++){
      total += colorLuminance(palette[i] || 0);
    }
    return total / palette.length;
  }

  function computedRoofBaseHeight(){
    try {
      if (typeof window.computeRoofBaseHeight === 'function') {
        var value = window.computeRoofBaseHeight();
        if (isFiniteNumber(value)) return value;
      }
    } catch(_e){}
    return null;
  }

  function computedRoofFootprint(){
    try {
      if (typeof window.computeRoofFootprint === 'function') {
        var fp = window.computeRoofFootprint();
        if (fp && isFiniteNumber(fp.width) && isFiniteNumber(fp.depth)) {
          return {
            x: isFiniteNumber(fp.x) ? fp.x : 0,
            z: isFiniteNumber(fp.z) ? fp.z : 0,
            width: Math.max(0.5, fp.width),
            depth: Math.max(0.5, fp.depth)
          };
        }
      }
    } catch(_e){}
    return null;
  }

  function ensureLibraries(){
    if (window.THREE && window.fabric) {
      THREE = window.THREE;
      fabricRef = window.fabric;
      return Promise.resolve();
    }
    if (libsPromise) return libsPromise;
    var loader = window.loadScript || function(url){
      return new Promise(function(resolve, reject){
        try {
          var s = document.createElement('script');
          s.src = url;
          s.async = false;
          s.onload = function(){ resolve(true); };
          s.onerror = function(){ reject(new Error('Failed to load '+url)); };
          document.head.appendChild(s);
        } catch(err){ reject(err); }
      });
    };

    function loadEntry(entry, options){
      options = options || {};
      var sources = [];
      if (Array.isArray(entry)) {
        sources = entry.filter(Boolean).map(resolveStaticAsset);
      } else if (entry) {
        sources = [resolveStaticAsset(entry)];
      }
      if (!sources.length) return Promise.resolve(true);
      var idx = 0;
      function attempt(lastErr){
        if (idx >= sources.length){
          if (options.optional) {
            console.warn('[Visualize] Optional dependency unavailable:', sources[0] || entry, lastErr && lastErr.message ? lastErr.message : lastErr);
            return Promise.resolve(false);
          }
          var err = lastErr || new Error('Unable to load required Visualize dependency.');
          err.entry = entry;
          return Promise.reject(err);
        }
        var src = sources[idx++];
        return loader(src).catch(function(err){
          console.warn('[Visualize] Failed to load script', src, err && err.message ? err.message : err);
          return attempt(err);
        });
      }
      return attempt();
    }

    function loadSequential(entries, options){
      options = options || {};
      return entries.reduce(function(prev, entry){
        return prev.then(function(){ return loadEntry(entry, options); });
      }, Promise.resolve());
    }

    var essentialScripts = [
      ['https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js'],
      ['https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js']
    ];

    var optionalScripts = [
      ['vendor/three/examples/js/postprocessing/Pass.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/postprocessing/Pass.js'],
      ['vendor/three/examples/js/postprocessing/EffectComposer.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/postprocessing/EffectComposer.js'],
      ['vendor/three/examples/js/postprocessing/RenderPass.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/postprocessing/RenderPass.js'],
      ['vendor/three/examples/js/postprocessing/ShaderPass.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/postprocessing/ShaderPass.js'],
      ['vendor/three/examples/js/shaders/CopyShader.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/shaders/CopyShader.js'],
      ['vendor/three/examples/js/shaders/LuminosityHighPassShader.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/shaders/LuminosityHighPassShader.js'],
      ['vendor/three/examples/js/postprocessing/UnrealBloomPass.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/postprocessing/UnrealBloomPass.js'],
      ['vendor/three/examples/js/shaders/SSAOShader.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/shaders/SSAOShader.js'],
      ['vendor/three/examples/js/postprocessing/SSAOPass.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/postprocessing/SSAOPass.js'],
      ['vendor/three/examples/js/loaders/RGBELoader.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/loaders/RGBELoader.js']
    ];

    libsPromise = loadSequential(essentialScripts).then(function(){
      THREE = window.THREE;
      fabricRef = window.fabric;
      console.log('[Visualize] Core libraries ready');
      return loadSequential(optionalScripts, { optional: true }).then(function(){
        if (THREE && THREE.EffectComposer) {
          console.log('[Visualize] Post-processing extensions available');
        }
      });
    });
    return libsPromise;
  }

  function ensureRenderer(){
    var canvas = qs(CANVAS_ID);
    if (!canvas) throw new Error('Visualize render canvas not found.');

    if (renderer && renderer.domElement !== canvas) {
      if (typeof renderer.dispose === 'function') {
        renderer.dispose();
      }
      renderer = null;
      composer = null;
      scene = null;
      camera = null;
      sceneRoot = null;
      pmremGenerator = null;
      envRT = null;
    }

    if (!renderer) {
      THREE = window.THREE || THREE;
      fabricRef = window.fabric || fabricRef;
      if (!THREE || !THREE.WebGLRenderer) {
        throw new Error('Three.js not available; ensure libraries loaded.');
      }

      composer = null;
      pmremGenerator = null;
      envRT = null;

      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: true,
        depth: true,
        logarithmicDepthBuffer: true,
        precision: 'highp'
      });

      if (renderer.capabilities && renderer.capabilities.isWebGL2 === false && renderer.forceContextLoss) {
        console.warn('[Visualize] WebGL1 detected; some effects may degrade.');
      }

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 2000);
      camera.up.set(0, 1, 0);
      sceneRoot = new THREE.Group();
      scene.add(sceneRoot);
    } else if (!sceneRoot && scene) {
      sceneRoot = new THREE.Group();
      scene.add(sceneRoot);
    }

    // Update renderer settings on each ensure to respect current device capabilities
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 4);
    renderer.setPixelRatio(pixelRatio);

    if (THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    renderer.setClearColor(0xffffff, 1);
    renderer.autoClear = false;

    if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (typeof renderer.toneMappingExposure !== 'number') renderer.toneMappingExposure = 1.1;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.shadowMap.needsUpdate = true;

    if (THREE.ColorManagement) THREE.ColorManagement.enabled = true;

    lights.length = 0;

    return renderer;
  }

  function ensurePostProcessing(width, height){
    if (!renderer || !THREE || !THREE.EffectComposer) return null;
    var w = width || (renderer.domElement ? renderer.domElement.width : 1920) || 1920;
    var h = height || (renderer.domElement ? renderer.domElement.height : 1080) || 1080;
    if (!composer){
      if (!THREE.EffectComposer || !THREE.RenderPass) return null;
      if (!THREE.ShaderPass || !THREE.CopyShader) {
        console.warn('[Visualize] Post-processing shaders missing; skipping composer');
        return null;
      }
      composer = new THREE.EffectComposer(renderer);
      var renderPass = new THREE.RenderPass(scene, camera);
      composer.addPass(renderPass);
      var ssaoPass = null;
      if (THREE.SSAOPass){
        ssaoPass = new THREE.SSAOPass(scene, camera, w, h);
        ssaoPass.kernelRadius = 22;
        ssaoPass.minDistance = 0.002;
        ssaoPass.maxDistance = 0.14;
        if (THREE.SSAOPass.OUTPUT && typeof THREE.SSAOPass.OUTPUT.Default !== 'undefined') {
          ssaoPass.output = THREE.SSAOPass.OUTPUT.Default;
        }
        composer.addPass(ssaoPass);
      }
      var bloomPass = null;
      if (THREE.UnrealBloomPass){
        bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.6, 0.85);
        bloomPass.threshold = 0.72;
        bloomPass.strength = 0.42;
        bloomPass.radius = 0.85;
        composer.addPass(bloomPass);
      }
      var copyPass = new THREE.ShaderPass(THREE.CopyShader);
      copyPass.renderToScreen = true;
      composer.addPass(copyPass);
      composer.__renderPass = renderPass;
      composer.__ssaoPass = ssaoPass;
      composer.__bloomPass = bloomPass;
      composer.__copyPass = copyPass;
    }
    try {
      composer.setSize(w, h);
      if (composer.__ssaoPass && composer.__ssaoPass.setSize) composer.__ssaoPass.setSize(w, h);
      if (composer.__bloomPass && composer.__bloomPass.setSize) composer.__bloomPass.setSize(w, h);
    } catch(err){
      console.warn('[Visualize] Unable to resize composer', err);
    }
    return composer;
  }

  function renderSceneWithPostFX(width, height){
    if (!renderer) return;
    // FIX #11: Disable post-processing due to missing SimplexNoise dependency
    // Use direct rendering for now - high quality settings are already applied
    console.log('[Visualize] Using direct render (post-processing disabled)');
    renderer.render(scene, camera);
  }

  function trackLight(light){
    if (!light || !scene) return light;
    scene.add(light);
    lights.push(light);
    if (light.target) {
      scene.add(light.target);
      lights.push(light.target);
    }
    return light;
  }

  function clearLighting(){
    if (!Array.isArray(lights) || lights.length === 0) return;
    lights.forEach(function(light){
      if (!light) return;
      if (light.parent && typeof light.parent.remove === 'function') {
        light.parent.remove(light);
      }
      if (light.shadow && light.shadow.map && light.shadow.map.dispose) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
      if (typeof light.dispose === 'function') {
        try { light.dispose(); } catch(_e){}
      }
    });
    lights.length = 0;
    clearDebugMarkers();
  }

  function ensureFog(span){

  function clearDebugMarkers(){
    for (var i = 0; i < debugMarkers.length; i++){
      var marker = debugMarkers[i];
      if (!marker) continue;
      try {
        if (marker.parent) marker.parent.remove(marker);
        if (marker.material && typeof marker.material.dispose === 'function') marker.material.dispose();
        if (marker.geometry && typeof marker.geometry.dispose === 'function') marker.geometry.dispose();
      } catch(_disposeErr){}
    }
    debugMarkers.length = 0;
  }

  function createTextSprite(text, bgColor, textColor){
    var size = 256;
    var canvasEl = document.createElement('canvas');
    canvasEl.width = size;
    canvasEl.height = size;
    var ctx = canvasEl.getContext('2d');
    if (ctx){
      ctx.fillStyle = bgColor || 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = textColor || '#f8fafc';
      ctx.font = 'bold 160px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, size / 2, size / 2);
    }
    var texture = new THREE.CanvasTexture(canvasEl);
    texture.needsUpdate = true;
    var material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: true });
    var sprite = new THREE.Sprite(material);
    sprite.scale.set(3, 3, 1);
    return sprite;
  }

  function createAxisMarker(length, color){
    var geometry = new THREE.CylinderGeometry(0.05, 0.05, length, 16, 1, true);
    var material = new THREE.MeshBasicMaterial({ color: color || 0xffffff, wireframe: false });
    var mesh = new THREE.Mesh(geometry, material);
    return mesh;
  }

  function injectDebugMarkers(root, focusPoint){
    if (!DEBUG_MARKERS_ENABLED || !root || !THREE) return;
    clearDebugMarkers();
    var focus = focusPoint || { x: 0, y: 0, z: 0 };

    var xSprite = createTextSprite('X', 'rgba(239,68,68,0.85)', '#fff');
    xSprite.position.set(focus.x + 4, focus.y + 1, focus.z);
    root.add(xSprite); debugMarkers.push(xSprite);

    var zSprite = createTextSprite('Z', 'rgba(59,130,246,0.85)', '#fff');
    zSprite.position.set(focus.x, focus.y + 1, focus.z + 4);
    root.add(zSprite); debugMarkers.push(zSprite);

    var originSprite = createTextSprite('O', 'rgba(22,163,74,0.85)', '#fff');
    originSprite.position.set(focus.x, focus.y + 1.5, focus.z);
    root.add(originSprite); debugMarkers.push(originSprite);

    var xAxis = createAxisMarker(10, 0xef4444);
    xAxis.rotation.z = Math.PI / 2;
    xAxis.position.set(focus.x + 5, focus.y, focus.z);
    root.add(xAxis); debugMarkers.push(xAxis);

    var zAxis = createAxisMarker(10, 0x3b82f6);
    zAxis.rotation.x = Math.PI / 2;
    zAxis.position.set(focus.x, focus.y, focus.z + 5);
    root.add(zAxis); debugMarkers.push(zAxis);

    var verticalAxis = createAxisMarker(8, 0x22c55e);
    verticalAxis.position.set(focus.x, focus.y + 4, focus.z);
    root.add(verticalAxis); debugMarkers.push(verticalAxis);
  }
    if (!scene) return;
    // Atmospheric perspective - subtle blue haze for depth
    var near = Math.max(50, span * 2);
    var far = Math.max(400, span * 12);
    scene.fog = new THREE.Fog(0xC8E0F8, near, far);
  }

  function noiseTexture(key, baseBrightness, variation, repeat){
    if (noiseTextures[key]) return noiseTextures[key];
    var size = 512;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var base = (typeof baseBrightness === 'number') ? baseBrightness : 232;
    var range = (typeof variation === 'number') ? variation : 18;

    var gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, 'rgb(' + Math.min(255, base + range * 0.45) + ',' + Math.min(255, base + range * 0.35) + ',' + Math.min(255, base + range * 0.4) + ')');
    gradient.addColorStop(1, 'rgb(' + Math.max(0, base - range * 0.35) + ',' + Math.max(0, base - range * 0.45) + ',' + Math.max(0, base - range * 0.4) + ')');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    var image = ctx.getImageData(0, 0, size, size);
    if (image && image.data && image.data.length) {
      var data = image.data;
      for (var y = 0; y < size; y++){
        for (var x = 0; x < size; x++){
          var idx = (y * size + x) * 4;
          if (idx + 2 >= data.length) continue;
          var macro = Math.sin((x / size) * Math.PI * 2.2) * 0.5 + Math.cos((y / size) * Math.PI * 1.7) * 0.5;
          var streak = Math.sin((x / size) * 28 + Math.sin((y / size) * 6)) * 0.25;
          var micro = (Math.random() - 0.5) * 0.6;
          var tint = Math.sin(((x + y) / size) * Math.PI) * 0.15;
          var delta = (macro * 0.45 + streak * 0.35 + micro * 0.25 + tint * 0.2) * range;
          var shade = data[idx] + delta;
          shade = Math.max(0, Math.min(255, shade));
          data[idx] = data[idx + 1] = data[idx + 2] = shade;
        }
      }
      ctx.putImageData(image, 0, 0);
    }

    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.08;
    for (var i = 0; i < 5; i++){
      var angle = (i / 5) * Math.PI;
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-size, -size * 0.02, size * 2, size * 0.04);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    var texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = renderer ? (renderer.capabilities.getMaxAnisotropy() || 16) : 16;
    var tiles = (typeof repeat === 'number' && repeat > 0) ? repeat : 4;
    texture.repeat.set(tiles, tiles);
    if (typeof texture.colorSpace !== 'undefined' && THREE.SRGBColorSpace) {
      texture.colorSpace = THREE.SRGBColorSpace;
    } else if (typeof texture.encoding !== 'undefined' && THREE.sRGBEncoding) {
      texture.encoding = THREE.sRGBEncoding;
    }
    texture.needsUpdate = true;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    noiseTextures[key] = texture;
    return texture;
  }

  function addEdgesForMesh(mesh, color, threshold){
    if (!mesh || !mesh.geometry) return;
    try {
      var edgeGeo = new THREE.EdgesGeometry(mesh.geometry, threshold || 45);
      var edgeMat = new THREE.LineBasicMaterial({ color: color || EDGE_COLORS.default, linewidth: 1 });
      var edges = new THREE.LineSegments(edgeGeo, edgeMat);
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      edges.scale.copy(mesh.scale);
      edges.userData.__edgeHelper = true;
      edges.castShadow = false;
      edges.receiveShadow = false;
      sceneRoot.add(edges);
    } catch(_e){}
  }

  function registerMesh(mesh, opts){
    if (!mesh) return;
    var options = opts || {};
    if (options.position) mesh.position.copy(options.position);
    if (options.rotation) mesh.rotation.copy(options.rotation);
    if (options.scale) mesh.scale.copy(options.scale);
    var allowCast = options.castShadow !== false;
    var allowReceive = options.receiveShadow !== false;
    mesh.castShadow = allowCast;
    mesh.receiveShadow = allowReceive;
    sceneRoot.add(mesh);
    if (!options.skipEdges) {
      addEdgesForMesh(mesh, options.edgeColor, options.edgeThreshold);
    }
  }

  function ensureEnvironment(){
    if (!renderer) return Promise.resolve(null);
    if (envRT && envRT.texture) {
      scene.environment = envRT.texture;
      return Promise.resolve(envRT.texture);
    }
    if (envLoadPromise) return envLoadPromise;

    function useProceduralEnvironment(){
      pmremGenerator = pmremGenerator || new THREE.PMREMGenerator(renderer);
      pmremGenerator.compileEquirectangularShader();

      var studio = new THREE.Scene();
      studio.background = new THREE.Color(0xffffff);

      function addEmitter(width, height, position, rotation, colorHex, intensity){
        var color = new THREE.Color(colorHex || 0xffffff);
        color.multiplyScalar(intensity || 1);
        var mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
        var plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
        plane.position.copy(position);
        if (rotation) plane.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
        studio.add(plane);
      }

      addEmitter(100, 100, new THREE.Vector3(100, 100, 100), { x: -Math.PI/4, y: Math.PI/4 }, 0xffffff, 4.0);
      addEmitter(100, 100, new THREE.Vector3(-100, 100, 50), { x: -Math.PI/4, y: -Math.PI/4 }, 0xf0f8ff, 2.0);
      addEmitter(100, 100, new THREE.Vector3(0, 100, -100), { x: Math.PI/4, y: 0 }, 0xfffaf0, 3.0);

      if (envRT && envRT.dispose) envRT.dispose();
      envRT = pmremGenerator.fromScene(studio, 0.02);
      scene.environment = envRT.texture;
      return envRT.texture;
    }

    if (!THREE.RGBELoader) {
      return Promise.resolve(useProceduralEnvironment());
    }

    pmremGenerator = pmremGenerator || new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    envLoadPromise = new Promise(function(resolve){
      var loader = new THREE.RGBELoader();
      if (loader.setDataType) loader.setDataType(THREE.UnsignedByteType || THREE.FloatType);
      if (loader.setCrossOrigin) loader.setCrossOrigin('anonymous');
      var index = 0;

      function attempt(){
        if (index >= HDRI_CANDIDATES.length) {
          var tex = useProceduralEnvironment();
          envLoadPromise = null;
          resolve(tex);
          return;
        }
        var url = resolveStaticAsset(HDRI_CANDIDATES[index++]);
        loader.load(url, function(texture){
          try {
            if (envRT && envRT.dispose) envRT.dispose();
            var envMap = pmremGenerator.fromEquirectangular(texture);
            texture.dispose();
            envRT = envMap;
            scene.environment = envMap.texture;
            envLoadPromise = null;
            resolve(envMap.texture);
          } catch(loadErr){
            console.warn('[Visualize] HDR environment processing failed', loadErr);
            texture.dispose();
            attempt();
          }
        }, undefined, function(err){
          console.warn('[Visualize] HDR load failed', url, err && err.message ? err.message : err);
          attempt();
        });
      }

      attempt();
    });

    return envLoadPromise;
  }

  function radialShadowTexture(key, alphaCenter, alphaEdge){
    key = key || 'shadow';
    if (noiseTextures[key]) return noiseTextures[key];
    var size = 512;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createRadialGradient(size/2, size/2, size*0.1, size/2, size/2, size*0.5);
    gradient.addColorStop(0, 'rgba(15,23,42,' + (alphaCenter || 0.35) + ')');
    gradient.addColorStop(0.7, 'rgba(15,23,42,' + (alphaEdge || 0.02) + ')');
    gradient.addColorStop(1, 'rgba(15,23,42,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0,0,size,size);
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    noiseTextures[key] = tex;
    return tex;
  }

  function setupLighting(centerX, centerY, centerZ, span){
    if (!scene) return;
    clearLighting();
    // No fog in studio
    scene.fog = null;

    // Studio Lighting Setup (three-point rig)

    // 1. Ambient lift for subtle base illumination
    trackLight(new THREE.AmbientLight(0xf0f3f8, 0.22));

    // 2. Sky/Ground contribution for believable bounce light
    var hemi = trackLight(new THREE.HemisphereLight(0xe5f0ff, 0xc0c8d2, 0.55));
    hemi.position.set(centerX, centerY + span * 5, centerZ);

    // 3. Key Light - primary directional sun source
    var keyLight = trackLight(new THREE.DirectionalLight(0xffffff, 1.75));
    keyLight.name = 'VisualizeKey';
    keyLight.position.set(centerX + span * 2.4, centerY + span * 4.2, centerZ + span * 2.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(4096, 4096);
    keyLight.shadow.bias = -0.00006;
    keyLight.shadow.normalBias = 0.018;
    keyLight.shadow.radius = 2.8; // Slight softening for natural penumbra

    var extent = span * 3.2;
    keyLight.shadow.camera.left = -extent;
    keyLight.shadow.camera.right = extent;
    keyLight.shadow.camera.top = extent;
    keyLight.shadow.camera.bottom = -extent;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = span * 12;
    keyLight.target.position.set(centerX, centerY, centerZ);

    // 4. Fill Light - softer opposing directional without shadows
    var fillLight = trackLight(new THREE.DirectionalLight(0xe0ecff, 0.65));
    fillLight.name = 'VisualizeFill';
    fillLight.position.set(centerX - span * 2.6, centerY + span * 1.9, centerZ - span * 1.8);
    fillLight.target.position.set(centerX, centerY, centerZ);
    fillLight.castShadow = false;

    // 5. Rim/Back Light - accentuates silhouette, soft shadows for depth
    var rimLight = trackLight(new THREE.SpotLight(0xfafbff, 1.0));
    rimLight.name = 'VisualizeRim';
    rimLight.position.set(centerX, centerY + span * 3.4, centerZ - span * 3.2);
    rimLight.target.position.set(centerX, centerY + span * 0.3, centerZ);
    rimLight.angle = Math.PI / 4;
    rimLight.penumbra = 0.85;
    rimLight.decay = 1.2;
    rimLight.castShadow = true;
    rimLight.shadow.mapSize.set(2048, 2048);
    rimLight.shadow.bias = -0.00005;
    rimLight.shadow.normalBias = 0.01;
    rimLight.shadow.camera.near = 0.5;
    rimLight.shadow.camera.far = span * 10;
    rimLight.shadow.focus = 1.0;
  }

  function createContactShadow(centerX, centerZ, span, groundY){
    var radius = Math.max(6, span * 0.95);
    var shadowGeom = new THREE.PlaneGeometry(radius, radius, 1, 1);
    var shadowMat = new THREE.MeshBasicMaterial({
      map: radialShadowTexture('shadow-heavy', 0.6, 0.06),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      opacity: 1,
      color: new THREE.Color(0x1b1f27)
    });
    var shadow = new THREE.Mesh(shadowGeom, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    var y = (typeof groundY === 'number') ? groundY + 0.01 : 0.01;
    shadow.position.set(centerX, y, centerZ);
    registerMesh(shadow, { skipEdges: true, castShadow: false, receiveShadow: false });
  }

  function disposeSceneChildren(){
    if (!sceneRoot) return;
    while(sceneRoot.children.length){
      var child = sceneRoot.children[0];
      sceneRoot.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(function(m){ if (m && m.dispose) m.dispose(); });
        else if (child.material.dispose) child.material.dispose();
      }
    }
    sceneRoot.position.set(0, 0, 0);
    sceneRoot.rotation.set(0, 0, 0);
    sceneRoot.scale.set(1, 1, 1);
  }

  function gatherProjectSnapshot(){
    try {
      var snapshot = {
        rooms: Array.isArray(window.allRooms) ? window.allRooms.slice() : [],
        wallStrips: Array.isArray(window.wallStrips) ? window.wallStrips.slice() : [],
        pergolas: Array.isArray(window.pergolaComponents) ? window.pergolaComponents.slice() : [],
        garages: Array.isArray(window.garageComponents) ? window.garageComponents.slice() : [],
        pools: Array.isArray(window.poolComponents) ? window.poolComponents.slice() : [],
        roofs: Array.isArray(window.roofComponents) ? window.roofComponents.slice() : [],
        balconies: Array.isArray(window.balconyComponents) ? window.balconyComponents.slice() : [],
        furniture: Array.isArray(window.furnitureItems) ? window.furnitureItems.slice() : [],
        stairs: Array.isArray(window.stairsComponents) ? window.stairsComponents.slice() : []
      };
      console.log('[Visualize] gatherProjectSnapshot:', {
        rooms: snapshot.rooms.length,
        wallStrips: snapshot.wallStrips.length,
        pergolas: snapshot.pergolas.length,
        garages: snapshot.garages.length,
        pools: snapshot.pools.length,
        roofs: snapshot.roofs.length,
        balconies: snapshot.balconies.length,
        furniture: snapshot.furniture.length,
        stairs: snapshot.stairs.length,
        sampleRoom: snapshot.rooms[0] || null
      });
      return snapshot;
    } catch(err){
      console.warn('[Visualize] Failed to gather snapshot', err);
      return { rooms: [], wallStrips: [], pergolas: [], garages: [], pools: [], roofs: [], balconies: [], furniture: [], stairs: [] };
    }
  }

  function boxFromDimensions(item){
    var hasBaseHeight = isFiniteNumber(item.baseHeight);
    var base = hasBaseHeight ? item.baseHeight : (isFiniteNumber(item.y) ? item.y : 0);
    var centerX = (item.x || 0);
    var centerZ = (item.z || 0);
    var width = Math.max(0.1, item.width || 0);
    var depth = Math.max(0.1, item.depth || 0);
    if (Array.isArray(item.footprint) && item.footprint.length >= 3) {
      var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      item.footprint.forEach(function(pt){
        if (!pt) return;
        var px = isFiniteNumber(pt.x) ? pt.x : 0;
        var pz = isFiniteNumber(pt.z) ? pt.z : 0;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (pz < minZ) minZ = pz;
        if (pz > maxZ) maxZ = pz;
      });
      if (isFinite(minX) && isFinite(maxX) && isFinite(minZ) && isFinite(maxZ)) {
        centerX = (minX + maxX) / 2;
        centerZ = (minZ + maxZ) / 2;
        width = Math.max(0.1, maxX - minX);
        depth = Math.max(0.1, maxZ - minZ);
      }
    }
    return {
      cx: centerX,
      cy: (item.y || 0),
      cz: centerZ,
      width: width,
      depth: depth,
      height: Math.max(0.5, item.height || 2.6),
      level: item.level || 0,
      baseY: base,
      baseIsAbsolute: hasBaseHeight,
      rotation: (item.rotation || 0) * Math.PI / 180
    };
  }

  function computeRoomsEnvelope(rooms){
    if (!Array.isArray(rooms) || rooms.length === 0) return null;
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    var topByLevel = Object.create(null);
    var maxTop = -Infinity;

    rooms.forEach(function(room){
      if (!room) return;
      var lvl = room.level || 0;
      var base = isFiniteNumber(room.baseHeight) ? room.baseHeight : (isFiniteNumber(room.y) ? room.y : (lvl * floorHeight));
      var roomHeight = Math.max(0.1, isFiniteNumber(room.height) ? room.height : 3.0);
      var top = base + roomHeight;
      if (!isFiniteNumber(top)) top = base + 3.0;
      if (!isFiniteNumber(topByLevel[lvl]) || top > topByLevel[lvl]) topByLevel[lvl] = top;
      if (top > maxTop) maxTop = top;

      var pts = [];
      if (Array.isArray(room.footprint) && room.footprint.length >= 3) {
        for (var i=0;i<room.footprint.length;i++){
          var p = room.footprint[i];
          if (!p) continue;
          pts.push({ x: isFiniteNumber(p.x) ? p.x : 0, z: isFiniteNumber(p.z) ? p.z : 0 });
        }
      }
      if (pts.length === 0) {
        var cx = isFiniteNumber(room.x) ? room.x : 0;
        var cz = isFiniteNumber(room.z) ? room.z : 0;
        var hw = Math.max(0, (isFiniteNumber(room.width) ? room.width : 0) / 2);
        var hd = Math.max(0, (isFiniteNumber(room.depth) ? room.depth : 0) / 2);
        var rot = (room.rotation || 0) * Math.PI / 180;
        var cos = Math.cos(rot);
        var sin = Math.sin(rot);
        var offsets = [
          { dx: hw,  dz: hd },
          { dx: hw,  dz: -hd },
          { dx: -hw, dz: -hd },
          { dx: -hw, dz: hd }
        ];
        offsets.forEach(function(off){
          var dx = off.dx, dz = off.dz;
          pts.push({
            x: cx + (cos * dx) - (sin * dz),
            z: cz + (sin * dx) + (cos * dz)
          });
        });
      }
      pts.forEach(function(pt){
        if (!pt) return;
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      });
    });

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minZ) || !isFinite(maxZ)) return null;
    if (!isFiniteNumber(maxTop)) maxTop = 3.0;
    var margin = 0.2;
    minX -= margin; maxX += margin;
    minZ -= margin; maxZ += margin;

    return {
      minX: minX,
      maxX: maxX,
      minZ: minZ,
      maxZ: maxZ,
      width: Math.max(0.5, maxX - minX),
      depth: Math.max(0.5, maxZ - minZ),
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      topByLevel: topByLevel,
      maxTop: maxTop
    };
  }

  function isPrimaryStructureKind(kind){
    if (!kind) return false;
    switch(kind){
      case 'room':
      case 'roof':
      case 'balcony':
      case 'garage':
      case 'stairs':
      case 'pergola':
        return true;
      default:
        return false;
    }
  }

  function computePrimaryStructureEnvelope(entries){
    if (!Array.isArray(entries) || entries.length === 0) return null;
    var bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    var found = false;
    entries.forEach(function(entry){
      if (!entry || !entry.box || !isPrimaryStructureKind(entry.kind)) return;
      includeBounds(bounds, entry.box);
      found = true;
    });
    if (!found || !isFinite(bounds.minX) || !isFinite(bounds.maxX) || !isFinite(bounds.minZ) || !isFinite(bounds.maxZ)) {
      return null;
    }
    if (!isFinite(bounds.minY) || !isFinite(bounds.maxY)) {
      bounds.minY = 0;
      bounds.maxY = floorHeight;
    }
    return {
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
      minZ: bounds.minZ,
      maxZ: bounds.maxZ,
      centerX: (bounds.minX + bounds.maxX) / 2,
      centerY: (bounds.minY + bounds.maxY) / 2,
      centerZ: (bounds.minZ + bounds.maxZ) / 2
    };
  }

  function deriveRoofBox(roof, envelope){
    var box = boxFromDimensions(roof || {});
    box.height = Math.max(1.0, (roof && roof.height) || 1.2);

    var footprintOverride = null;
    if (!roof || roof.autoFit !== false) {
      footprintOverride = computedRoofFootprint();
    }

    if (footprintOverride) {
      box.cx = footprintOverride.x;
      box.cz = footprintOverride.z;
      box.width = footprintOverride.width;
      box.depth = footprintOverride.depth;
    } else if (envelope && (!roof || roof.autoFit !== false)) {
      box.cx = envelope.centerX;
      box.cz = envelope.centerZ;
      box.width = envelope.width;
      box.depth = envelope.depth;
    }

    var baseCandidate = null;
    if (!roof || roof.autoBase !== false) {
      baseCandidate = computedRoofBaseHeight();
      if (!isFiniteNumber(baseCandidate) && envelope) {
        var lvl = roof ? (roof.level || 0) : 0;
        var hasLevelTop = envelope && envelope.topByLevel && Object.prototype.hasOwnProperty.call(envelope.topByLevel, lvl);
        var envelopeTop = hasLevelTop ? envelope.topByLevel[lvl] : envelope.maxTop;
        if (isFiniteNumber(envelopeTop)) baseCandidate = envelopeTop;
      }
    }

    if (!isFiniteNumber(baseCandidate) && roof && isFiniteNumber(roof.baseHeight)) {
      baseCandidate = roof.baseHeight;
    }

    if (isFiniteNumber(baseCandidate)) {
      box.baseY = baseCandidate;
      box.baseIsAbsolute = true;
    }

    return box;
  }

  function baseElevation(box){
    if (!box) return 0;
    if (box.baseIsAbsolute) return box.baseY || 0;
    return (box.level || 0) * floorHeight + (box.baseY || 0);
  }

  function includeBounds(bounds, box){
    var halfW = box.width / 2;
    var halfD = box.depth / 2;
    var yBase = baseElevation(box);
    var centerY = yBase + (box.height / 2);
    bounds.minX = Math.min(bounds.minX, box.cx - halfW);
    bounds.maxX = Math.max(bounds.maxX, box.cx + halfW);
    bounds.minZ = Math.min(bounds.minZ, box.cz - halfD);
    bounds.maxZ = Math.max(bounds.maxZ, box.cz + halfD);
    bounds.minY = Math.min(bounds.minY, centerY - box.height / 2);
    bounds.maxY = Math.max(bounds.maxY, centerY + box.height / 2);
  }

  function buildMesh(box, material){
    var geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
    ensureSecondaryUV(geometry);
    var mesh = new THREE.Mesh(geometry, material);
    var yBase = baseElevation(box);
    mesh.position.set(box.cx, yBase + (box.height / 2), box.cz);
    if (box.rotation) mesh.rotation.y = box.rotation;
    return mesh;
  }

  function roomFootprintCenter(points){
    var cx = 0;
    var cz = 0;
    var count = 0;
    for (var i = 0; i < points.length; i++){
      var pt = points[i];
      if (!pt) continue;
      var px = isFiniteNumber(pt.x) ? pt.x : 0;
      var pz = isFiniteNumber(pt.z) ? pt.z : 0;
      cx += px;
      cz += pz;
      count++;
    }
    if (!count) return { x: 0, z: 0 };
    return { x: cx / count, z: cz / count };
  }

  function ensureCounterClockwise(points){
    var area = 0;
    for (var i = 0; i < points.length; i++){
      var current = points[i];
      var next = points[(i + 1) % points.length];
      var x1 = isFiniteNumber(current && current.x) ? current.x : 0;
      var z1 = isFiniteNumber(current && current.z) ? current.z : 0;
      var x2 = isFiniteNumber(next && next.x) ? next.x : 0;
      var z2 = isFiniteNumber(next && next.z) ? next.z : 0;
      area += (x1 * z2) - (x2 * z1);
    }
    if (area < 0) return points.slice().reverse();
    return points.slice();
  }

  function buildHoleShape(loop, center){
    if (!Array.isArray(loop) || loop.length < 3) return null;
    var normalized = ensureCounterClockwise(loop).reverse();
    var hole = new THREE.Path();
    for (var i = 0; i < normalized.length; i++){
      var pt = normalized[i];
      var hx = (isFiniteNumber(pt && pt.x) ? pt.x : 0) - center.x;
      var hz = (isFiniteNumber(pt && pt.z) ? pt.z : 0) - center.z;
      if (i === 0) hole.moveTo(hx, hz);
      else hole.lineTo(hx, hz);
    }
    hole.closePath();
    return hole;
  }

  function buildRoomMeshFromRoom(room, material){
    var baseHeight = isFiniteNumber(room.baseHeight) ? room.baseHeight : (isFiniteNumber(room.y) ? room.y : ((room.level || 0) * floorHeight));
    var targetHeight = Math.max(2.2, isFiniteNumber(room.height) ? room.height : 2.8);
    
    // Get footprint - either from explicit footprint array or derive from x/z/width/depth
    var footprint = null;
    if (Array.isArray(room.footprint) && room.footprint.length >= 3) {
      footprint = room.footprint;
    } else if (isFiniteNumber(room.width) && isFiniteNumber(room.depth) && room.width > 0 && room.depth > 0) {
      // Create rectangular footprint from center, width, depth, and rotation
      var cx = isFiniteNumber(room.x) ? room.x : 0;
      var cz = isFiniteNumber(room.z) ? room.z : 0;
      var hw = room.width / 2;
      var hd = room.depth / 2;
      var rot = ((room.rotation || 0) * Math.PI / 180);
      var cosR = Math.cos(rot);
      var sinR = Math.sin(rot);
      footprint = [
        { x: cx + (cosR * hw - sinR * hd), z: cz + (sinR * hw + cosR * hd) },
        { x: cx + (cosR * hw - sinR * (-hd)), z: cz + (sinR * hw + cosR * (-hd)) },
        { x: cx + (cosR * (-hw) - sinR * (-hd)), z: cz + (sinR * (-hw) + cosR * (-hd)) },
        { x: cx + (cosR * (-hw) - sinR * hd), z: cz + (sinR * (-hw) + cosR * hd) }
      ];
    }
    
    if (!footprint || footprint.length < 3) return null;
    
    footprint = ensureCounterClockwise(footprint);
    var center = roomFootprintCenter(footprint);
    var shape = new THREE.Shape();
    footprint.forEach(function(pt, idx){
      var sx = (isFiniteNumber(pt && pt.x) ? pt.x : 0) - center.x;
      var sz = (isFiniteNumber(pt && pt.z) ? pt.z : 0) - center.z;
      if (idx === 0) shape.moveTo(sx, sz);
      else shape.lineTo(sx, sz);
    });
    shape.closePath();
    if (Array.isArray(room.holes)) {
      room.holes.forEach(function(loop){
        var holePath = buildHoleShape(loop, center);
        if (holePath) shape.holes.push(holePath);
      });
    }
    var extrude = new THREE.ExtrudeGeometry(shape, { depth: targetHeight, bevelEnabled: false });
    extrude.rotateX(-Math.PI / 2);
    extrude.translate(0, baseHeight, 0);
    ensureSecondaryUV(extrude);
    var mesh = new THREE.Mesh(extrude, material);
    // Jitter UVs for rooms to break up uniform patterns
    if (extrude.attributes && extrude.attributes.uv) {
      var uvAttr = extrude.attributes.uv;
      var uvArray = uvAttr.array;
      // Smaller tile factors → larger visible tiles. Halve again to double size.
      var tileU = 0.15 + rng.range(-0.04, 0.04);
      var tileV = 0.15 + rng.range(-0.04, 0.04);
      var offU = rng.range(0, 5);
      var offV = rng.range(0, 5);
      for (var i = 0; i < uvArray.length; i += 2) {
        uvArray[i]   = uvArray[i]   * tileU + offU;
        uvArray[i+1] = uvArray[i+1] * tileV + offV;
      }
      uvAttr.needsUpdate = true;
    }
    mesh.position.set(center.x, 0, center.z);
    return mesh;
  }

  function buildWallMesh(strip, material){
    if (!strip) return { meshes: [], len: 0, wallHeight: 0, thickness: 0, midX: 0, midZ: 0 };
    var x0 = strip.x0 || 0;
    var z0 = strip.z0 || 0;
    var x1 = strip.x1 || 0;
    var z1 = strip.z1 || 0;
    var len = Math.max(0.05, Math.hypot(x1 - x0, z1 - z0));
    var wallHeight = Math.max(2.4, isFiniteNumber(strip.height) ? strip.height : 3.0);
    var thickness = Math.max(0.06, isFiniteNumber(strip.thickness) ? strip.thickness : 0.3);
    var midX = (x0 + x1) / 2;
    var midZ = (z0 + z1) / 2;
    var angle = Math.atan2(z1 - z0, x1 - x0);
    var baseY = (typeof strip.y === 'number') ? strip.y : 0;
    var levelBase = (strip.level || 0) * floorHeight + baseY;

    var dirX = (len > 0) ? ((x1 - x0) / len) : 1;
    var dirZ = (len > 0) ? ((z1 - z0) / len) : 0;

    var EPS = 1e-3;
    var segments = [{ u0: 0, u1: len, v0: 0, v1: wallHeight }];
    var openingRects = [];

    function clampInterval(a, min, max){
      if (a < min) return min;
      if (a > max) return max;
      return a;
    }

    function openingDefaultHeight(type){
      return type === 'door' ? 2.04 : 1.5;
    }

    function openingDefaultSill(type){
      return type === 'door' ? 0 : 0.9;
    }

    if (Array.isArray(strip.openings) && strip.openings.length > 0 && len > EPS){
      var openings = [];
      strip.openings.forEach(function(opening){
        if (!opening) return;
        var sx = isFiniteNumber(opening.x0) ? opening.x0 : null;
        var sz = isFiniteNumber(opening.z0) ? opening.z0 : null;
        var ex = isFiniteNumber(opening.x1) ? opening.x1 : null;
        var ez = isFiniteNumber(opening.z1) ? opening.z1 : null;
        if (sx == null || sz == null || ex == null || ez == null) return;
        var startU = ((sx - x0) * dirX) + ((sz - z0) * dirZ);
        var endU = ((ex - x0) * dirX) + ((ez - z0) * dirZ);
        if (!isFiniteNumber(startU) || !isFiniteNumber(endU)) return;
        var u0 = clampInterval(Math.min(startU, endU), 0, len);
        var u1 = clampInterval(Math.max(startU, endU), 0, len);
        if (u1 - u0 < EPS) return;
        var sill = isFiniteNumber(opening.sillM) ? opening.sillM : openingDefaultSill(opening.type);
        var height = isFiniteNumber(opening.heightM) ? opening.heightM : openingDefaultHeight(opening.type);
        if (!isFiniteNumber(sill)) sill = 0;
        if (!isFiniteNumber(height)) height = openingDefaultHeight(opening.type);
        var v0 = clampInterval(sill, 0, wallHeight);
        var v1 = clampInterval(sill + height, 0, wallHeight);
        if (v1 - v0 < EPS) return;
        openings.push({ u0: u0, u1: u1, v0: v0, v1: v1, type: (opening.type === 'door') ? 'door' : 'window' });
      });

      if (openings.length > 0){
        openings.sort(function(a, b){ return a.u0 - b.u0; });
        segments = openings.reduce(function(currentSegments, rect){
          var next = [];
          currentSegments.forEach(function(seg){
            var overlapU0 = Math.max(seg.u0, rect.u0);
            var overlapU1 = Math.min(seg.u1, rect.u1);
            var overlapV0 = Math.max(seg.v0, rect.v0);
            var overlapV1 = Math.min(seg.v1, rect.v1);
            if (overlapU1 - overlapU0 <= EPS || overlapV1 - overlapV0 <= EPS){
              next.push(seg);
              return;
            }
            if (seg.u0 < rect.u0 - EPS){
              next.push({ u0: seg.u0, u1: rect.u0, v0: seg.v0, v1: seg.v1 });
            }
            if (seg.u1 > rect.u1 + EPS){
              next.push({ u0: rect.u1, u1: seg.u1, v0: seg.v0, v1: seg.v1 });
            }
            var centralU0 = Math.max(seg.u0, rect.u0);
            var centralU1 = Math.min(seg.u1, rect.u1);
            if (centralU1 - centralU0 > EPS){
              if (seg.v0 < rect.v0 - EPS){
                next.push({ u0: centralU0, u1: centralU1, v0: seg.v0, v1: rect.v0 });
              }
              if (seg.v1 > rect.v1 + EPS){
                next.push({ u0: centralU0, u1: centralU1, v0: rect.v1, v1: seg.v1 });
              }
            }
          });
          return next;
        }, segments);
        openingRects = openings;
      }
    }

    var meshes = [];
    var MIN_SPAN = 0.02;
    var MIN_HEIGHT = 0.02;
    segments.forEach(function(seg){
      var span = seg.u1 - seg.u0;
      var height = seg.v1 - seg.v0;
      if (span <= MIN_SPAN || height <= MIN_HEIGHT) return;
      var geometry = new THREE.BoxGeometry(span, height, thickness);
      ensureSecondaryUV(geometry);
      var mesh = new THREE.Mesh(geometry, material.clone());
      var centerU = seg.u0 + span / 2;
      var centerY = levelBase + seg.v0 + height / 2;
      var centerX = x0 + dirX * centerU;
      var centerZ = z0 + dirZ * centerU;
      mesh.position.set(centerX, centerY, centerZ);
      mesh.rotation.y = angle;
      // Jitter UVs for each wall segment to break tiling
      if (geometry.attributes && geometry.attributes.uv) {
        var uvAttr = geometry.attributes.uv;
        var uvs = uvAttr.array;
        // Smaller tile factors → larger visible tiles. Halve again to double size.
        var tileU = 0.15 + rng.range(-0.04, 0.04);
        var tileV = 0.15 + rng.range(-0.04, 0.04);
        var offU = rng.range(0, 5);
        var offV = rng.range(0, 5);
        for (var ui = 0; ui < uvs.length; ui += 2) {
          uvs[ui]   = uvs[ui]   * tileU + offU;
          uvs[ui+1] = uvs[ui+1] * tileV + offV;
        }
        uvAttr.needsUpdate = true;
      }

      meshes.push(mesh);
    });

    if (openingRects.length > 0){
      var detailMeshes = buildOpeningDetailMeshes(openingRects);
      if (detailMeshes.length) {
        Array.prototype.push.apply(meshes, detailMeshes);
      }
    }

    return {
      meshes: meshes,
      len: len,
      wallHeight: wallHeight,
      thickness: thickness,
      midX: midX,
      midZ: midZ
    };

    function buildOpeningDetailMeshes(rects){
      var results = [];
      var normalX = -dirZ;
      var normalZ = dirX;
      var windowFrameMat = materialFor('windowFrame');
      var doorFrameMat = materialFor('doorFrame');
      var doorPanelMat = materialFor('doorPanel');
      var glassMat = materialFor('glass');
      glassMat.depthWrite = false;
      glassMat.side = THREE.DoubleSide;
      windowFrameMat.needsUpdate = true;
      doorFrameMat.needsUpdate = true;
      doorPanelMat.needsUpdate = true;
      glassMat.needsUpdate = true;

      function worldPosition(baseX, baseZ, offsetAlong, depthOffset){
        return {
          x: baseX + dirX * offsetAlong + normalX * depthOffset,
          z: baseZ + dirZ * offsetAlong + normalZ * depthOffset
        };
      }

      function addBox(mat, widthLocal, heightLocal, depthLocal, position, rotationY, overrides){
        if (widthLocal <= MIN_SPAN || heightLocal <= MIN_HEIGHT) return null;
        var geom = new THREE.BoxGeometry(widthLocal, heightLocal, depthLocal);
        ensureSecondaryUV(geom);
        var mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(position.x, position.y, position.z);
        mesh.rotation.y = rotationY;
        mesh.userData = mesh.userData || {};
        if (overrides) {
          var optsCopy = {};
          for (var key in overrides){
            if (Object.prototype.hasOwnProperty.call(overrides, key)) optsCopy[key] = overrides[key];
          }
          mesh.userData.visualizeOpts = optsCopy;
        }
        results.push(mesh);
        return mesh;
      }

      rects.forEach(function(rect){
        if (!rect) return;
        var width = rect.u1 - rect.u0;
        var height = rect.v1 - rect.v0;
        if (width <= MIN_SPAN || height <= MIN_HEIGHT) return;
        var type = rect.type === 'door' ? 'door' : 'window';
        var centerU = rect.u0 + width / 2;
        var baseX = x0 + dirX * centerU;
        var baseZ = z0 + dirZ * centerU;
        var sillY = levelBase + rect.v0;
        var centerY = sillY + height / 2;
        var frameThickness = Math.min(Math.max(width * 0.08, 0.045), 0.18);
        if (type === 'door') frameThickness = Math.min(Math.max(width * 0.07, 0.05), 0.16);
        var frameDepth = thickness * (type === 'door' ? 1.45 : 1.25);
        var exteriorOffset = thickness * 0.2;
        var verticalHeight = height + frameThickness * 0.8;
        var frameMat = (type === 'door') ? doorFrameMat : windowFrameMat;
        var frameOpts = { edgeColor: EDGE_COLORS.frame };
        if (type === 'door') frameOpts.edgeColor = EDGE_COLORS.accent;

        var leftOffset = -width / 2 + frameThickness / 2;
        var rightOffset = width / 2 - frameThickness / 2;
        var verticalY = centerY;
        var leftPos = worldPosition(baseX, baseZ, leftOffset, exteriorOffset);
        leftPos.y = verticalY;
        addBox(frameMat, frameThickness, verticalHeight, frameDepth, leftPos, angle, frameOpts);

        var rightPos = worldPosition(baseX, baseZ, rightOffset, exteriorOffset);
        rightPos.y = verticalY;
        addBox(frameMat, frameThickness, verticalHeight, frameDepth, rightPos, angle, frameOpts);

        var topPos = worldPosition(baseX, baseZ, 0, exteriorOffset);
        topPos.y = sillY + height + frameThickness / 2;
        addBox(frameMat, width + frameThickness * 0.9, frameThickness, frameDepth, topPos, angle, frameOpts);

        if (type !== 'door' || sillY > levelBase + 0.01){
          var bottomPos = worldPosition(baseX, baseZ, 0, exteriorOffset * 0.6);
          bottomPos.y = sillY - frameThickness / 2;
          addBox(frameMat, width + frameThickness * 0.8, frameThickness * 0.9, frameDepth * 0.85, bottomPos, angle, frameOpts);
        }

        if (type === 'window') {
          var mullionDepth = frameDepth * 0.55;
          if (width > 1.4){
            var mullionPos = worldPosition(baseX, baseZ, 0, exteriorOffset * 0.8);
            mullionPos.y = centerY;
            addBox(frameMat, frameThickness * 0.6, height - frameThickness * 1.1, mullionDepth, mullionPos, angle, frameOpts);
          }
          if (height > 1.35){
            var transomPos = worldPosition(baseX, baseZ, 0, exteriorOffset * 0.85);
            transomPos.y = centerY + height * 0.18;
            addBox(frameMat, width - frameThickness * 1.1, frameThickness * 0.55, mullionDepth, transomPos, angle, frameOpts);
          }
          var glassWidth = Math.max(width - frameThickness * 2.1, width * 0.62);
          var glassHeight = Math.max(height - frameThickness * 2.0, height * 0.6);
          if (glassWidth > MIN_SPAN && glassHeight > MIN_HEIGHT){
            var glassDepth = Math.max(thickness * 0.18, 0.01);
            var glassPos = worldPosition(baseX, baseZ, 0, -thickness * 0.05);
            glassPos.y = centerY;
            var glassOverrides = { edgeColor: EDGE_COLORS.glass, skipEdges: true, castShadow: false, receiveShadow: true };
            var glassMesh = addBox(glassMat, glassWidth, glassHeight, glassDepth, glassPos, angle, glassOverrides);
            if (glassMesh) {
              glassMesh.renderOrder = 2;
              glassMesh.material.transparent = true;
            }
          }
        } else {
          var panelWidth = Math.max(width - frameThickness * 1.4, width * 0.7);
          var panelHeight = Math.max(height - frameThickness * 0.8, height * 0.9);
          var panelDepth = Math.max(thickness * 0.7, 0.07);
          var panelPos = worldPosition(baseX, baseZ, 0, -thickness * 0.04);
          panelPos.y = centerY;
          var doorOverrides = { edgeColor: EDGE_COLORS.accent };
          var doorPanel = addBox(doorPanelMat, panelWidth, panelHeight, panelDepth, panelPos, angle, doorOverrides);
          if (doorPanel) doorPanel.castShadow = true;

          var handleWidth = Math.max(frameThickness * 0.4, 0.025);
          var handleHeight = Math.max(panelHeight * 0.16, 0.28);
          var handleDepth = Math.max(panelDepth * 0.25, 0.03);
          var handleOffset = panelWidth * 0.28;
          var handlePos = worldPosition(baseX, baseZ, handleOffset, exteriorOffset * 0.5);
          handlePos.y = sillY + panelHeight * 0.55;
          addBox(doorFrameMat, handleWidth, handleHeight, handleDepth, handlePos, angle, { edgeColor: EDGE_COLORS.accent, castShadow: false });

          var insetPos = worldPosition(baseX, baseZ, -handleOffset, exteriorOffset * 0.4);
          insetPos.y = sillY + panelHeight * 0.35;
          addBox(doorFrameMat, handleWidth * 0.6, panelHeight * 0.4, handleDepth * 0.6, insetPos, angle, { edgeColor: EDGE_COLORS.accent, castShadow: false });
        }
      });

      return results;
    }
  }

  function computeHash(snapshot){
    try {
      return JSON.stringify(snapshot);
    } catch(_e){
      return String(Date.now());
    }
  }

  function formatFootnote(bounds){
    var dx = bounds.maxX - bounds.minX;
    var dz = bounds.maxZ - bounds.minZ;
    var size = Math.max(dx, dz);
    if (!isFinite(size) || size <= 0) return 'Scene dimensions unavailable';
    var perimeter = (2 * dx) + (2 * dz);
    return 'Footprint ≈ ' + size.toFixed(1) + ' m span · Perimeter ≈ ' + perimeter.toFixed(1) + ' m';
  }

  function ensureResizeListener(){
    if (!resizeHooked) {
      resizeHooked = true;
      window.addEventListener('resize', function(){
        window.requestAnimationFrame(fitRenderToStage);
      });
    }
    if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
      var stage = qs('visualize-stage');
      if (stage) {
        resizeObserver = new ResizeObserver(function(){
          window.requestAnimationFrame(fitRenderToStage);
        });
        try { resizeObserver.observe(stage); } catch(_e){}
      }
    }
  }

  function fitRenderToStage(){
    if (!lastCanvasWidth || !lastCanvasHeight) return;
    var stage = qs('visualize-stage');
    var wrap = qs('visualize-canvas-wrap');
    var renderCanvas = qs(CANVAS_ID);
    if (!stage || !wrap || !renderCanvas) return;

    // Align capture overlay with the live viewport in CSS pixel space
    stage.style.display = 'flex';
    stage.style.justifyContent = 'flex-start';
    stage.style.alignItems = 'flex-start';
    stage.style.overflow = 'hidden';

    var baseCanvasEl = document.getElementById('canvas');
    var baseRect = baseCanvasEl && baseCanvasEl.getBoundingClientRect ? baseCanvasEl.getBoundingClientRect() : null;
    var cssWidth = baseRect && baseRect.width > 0 ? baseRect.width : (stage.clientWidth || window.innerWidth || 1920);
    var cssHeight = baseRect && baseRect.height > 0 ? baseRect.height : (stage.clientHeight || window.innerHeight || 1080);

    wrap.style.width = cssWidth + 'px';
    wrap.style.height = cssHeight + 'px';
    wrap.style.margin = '0';
    wrap.style.aspectRatio = '';

    renderCanvas.style.width = cssWidth + 'px';
    renderCanvas.style.height = cssHeight + 'px';
    renderCanvas.style.objectFit = 'fill';

    if (fabricCanvas) {
      fabricCanvas.setDimensions({ width: '100%', height: '100%' }, { cssOnly: true });
      fabricCanvas.calcOffset();
    }
    updateAlignmentGrid(cssWidth, cssHeight);
  }

  function removeAlignmentGrid(){
    if (alignmentGridCanvas && alignmentGridCanvas.parentNode) {
      alignmentGridCanvas.parentNode.removeChild(alignmentGridCanvas);
    }
    alignmentGridCanvas = null;
  }

  function updateAlignmentGrid(cssWidth, cssHeight){
    if (!alignmentGridEnabled) {
      removeAlignmentGrid();
      return;
    }
    var wrap = qs('visualize-canvas-wrap');
    if (!wrap) return;
    var width = isFiniteNumber(cssWidth) && cssWidth > 0 ? cssWidth : (lastCanvasCssWidth || wrap.clientWidth || 0);
    var height = isFiniteNumber(cssHeight) && cssHeight > 0 ? cssHeight : (lastCanvasCssHeight || wrap.clientHeight || 0);
    if (width <= 0 || height <= 0) {
      removeAlignmentGrid();
      return;
    }
    if (!alignmentGridCanvas || alignmentGridCanvas.parentNode !== wrap) {
      if (alignmentGridCanvas && alignmentGridCanvas.parentNode) alignmentGridCanvas.parentNode.removeChild(alignmentGridCanvas);
      alignmentGridCanvas = document.createElement('canvas');
      alignmentGridCanvas.id = 'visualize-alignment-grid';
      alignmentGridCanvas.style.position = 'absolute';
      alignmentGridCanvas.style.inset = '0';
      alignmentGridCanvas.style.pointerEvents = 'none';
      alignmentGridCanvas.style.zIndex = '4';
      alignmentGridCanvas.style.mixBlendMode = 'normal';
      wrap.appendChild(alignmentGridCanvas);
    }
    var dpr = window.devicePixelRatio || 1;
    var scaledWidth = Math.max(1, Math.round(width * dpr));
    var scaledHeight = Math.max(1, Math.round(height * dpr));
    if (alignmentGridCanvas.width !== scaledWidth) alignmentGridCanvas.width = scaledWidth;
    if (alignmentGridCanvas.height !== scaledHeight) alignmentGridCanvas.height = scaledHeight;
    alignmentGridCanvas.style.width = width + 'px';
    alignmentGridCanvas.style.height = height + 'px';
    var ctx = alignmentGridCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, alignmentGridCanvas.width, alignmentGridCanvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    var minorStep = 50;
    var majorStep = 200;
    var centerX = width / 2;
    var centerY = height / 2;

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    for (var x = 0; x <= width; x += minorStep) {
      ctx.beginPath();
      var xPos = Math.round(x) + 0.5;
      ctx.moveTo(xPos, 0);
      ctx.lineTo(xPos, height);
      ctx.stroke();
    }
    for (var y = 0; y <= height; y += minorStep) {
      ctx.beginPath();
      var yPos = Math.round(y) + 0.5;
      ctx.moveTo(0, yPos);
      ctx.lineTo(width, yPos);
      ctx.stroke();
    }

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)';
    for (var mx = 0; mx <= width; mx += majorStep) {
      ctx.beginPath();
      var majorX = Math.round(mx) + 0.5;
      ctx.moveTo(majorX, 0);
      ctx.lineTo(majorX, height);
      ctx.stroke();
    }
    for (var my = 0; my <= height; my += majorStep) {
      ctx.beginPath();
      var majorY = Math.round(my) + 0.5;
      ctx.moveTo(0, majorY);
      ctx.lineTo(width, majorY);
      ctx.stroke();
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
    ctx.beginPath();
    ctx.moveTo(Math.round(centerX) + 0.5, 0);
    ctx.lineTo(Math.round(centerX) + 0.5, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, Math.round(centerY) + 0.5);
    ctx.lineTo(width, Math.round(centerY) + 0.5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function setAlignmentGridState(enabled){
    alignmentGridEnabled = !!enabled;
    if (!alignmentGridEnabled) removeAlignmentGrid();
    else updateAlignmentGrid(lastCanvasCssWidth, lastCanvasCssHeight);
    syncAlignmentGridButton();
  }

  function toggleAlignmentGrid(){
    setAlignmentGridState(!alignmentGridEnabled);
  }

  function syncAlignmentGridButton(){
    var btn = qs('visualize-toggle-grid');
    if (!btn) return;
    btn.textContent = alignmentGridEnabled ? 'Hide Grid Overlay' : 'Show Grid Overlay';
  }

  function ensureFabric(width, height){
    var canvasEl = qs(FABRIC_ID);
    if (!canvasEl) return;
    canvasEl.width = width;
    canvasEl.height = height;
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    canvasEl.style.maxWidth = '';
    canvasEl.style.maxHeight = '';
    canvasEl.style.left = '';
    canvasEl.style.top = '';
    canvasEl.style.transform = '';
    if (fabricCanvas) {
      fabricCanvas.setDimensions({ width: width, height: height });
      fabricCanvas.setDimensions({ width: '100%', height: '100%' }, { cssOnly: true });
      fabricCanvas.calcOffset();
      return;
    }
    fabricCanvas = new fabric.Canvas(FABRIC_ID, {
      backgroundColor: 'transparent',
      selectionBorderColor: '#2563eb',
      selectionColor: 'rgba(37,99,235,0.12)',
      preserveObjectStacking: true
    });
    fabricCanvas.setDimensions({ width: '100%', height: '100%' }, { cssOnly: true });
    fabricCanvas.calcOffset();
  }

  // Grid helper removed for production renders (clean image)

  function addDefaultLabel(){
    // No default label for clean render
    return;
  }

  function setGalleryShots(shots){
    galleryShots = Array.isArray(shots) ? shots.slice() : [];
    galleryShotMap = Object.create(null);
    for (var i = 0; i < galleryShots.length; i++){
      var shot = galleryShots[i] || {};
      var id = shot.id != null ? String(shot.id) : 'shot-' + i;
      shot.id = id;
      if (!shot.previewUrl && shot.dataUrl) shot.previewUrl = shot.dataUrl;
      if (!shot.fullUrl && shot.dataUrl) shot.fullUrl = shot.dataUrl;
      galleryShotMap[id] = shot;
    }
  }

  function updateGalleryGrid(message){
    var container = qs('visualize-gallery');
    if (!container) return;
    container.innerHTML = '';
    if (message){
      var msgEl = document.createElement('div');
      msgEl.className = 'visualize-gallery-empty';
      msgEl.textContent = message;
      container.appendChild(msgEl);
      return;
    }
    if (!galleryShots || galleryShots.length === 0){
      var empty = document.createElement('div');
      empty.className = 'visualize-gallery-empty';
      empty.textContent = 'Generate a render to populate design views.';
      container.appendChild(empty);
      return;
    }
    galleryShots.forEach(function(shot){
      if (!shot) return;
      var preview = shot.previewUrl || shot.fullUrl;
      if (!preview) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'visualize-gallery-thumb';
      btn.setAttribute('data-gallery-id', shot.id);
      btn.style.backgroundImage = 'url(' + preview + ')';
      var label = document.createElement('span');
      label.textContent = shot.label || 'View';
      btn.appendChild(label);
      container.appendChild(btn);
    });
  }

  function focusPhotorealShot(id){
    if (!id) return;
    window.requestAnimationFrame(function(){
      var gallery = qs('visualize-gallery');
      if (!gallery) return;
      var selector = 'button[data-gallery-id="' + id + '"]';
      var btn = gallery.querySelector(selector);
      if (btn) {
        btn.classList.add('highlight');
        try {
          btn.focus({ preventScroll: false });
        } catch(_focusErr){
          try { btn.focus(); } catch(_ignored){}
        }
        window.setTimeout(function(){
          btn.classList.remove('highlight');
        }, 2200);
      }
      openPhotoViewerById(id);
    });
  }

  function openPhotoViewerById(id){
    var shot = galleryShotMap && galleryShotMap[id];
    if (!shot) return;
    var viewer = qs('visualize-photo-viewer');
    var image = qs('visualize-photo-image');
    var caption = qs('visualize-photo-caption');
    if (!viewer || !image) return;
    var src = shot.fullUrl || shot.previewUrl;
    if (!src) return;
    image.src = src;
    image.alt = shot.alt || shot.label || 'Design preview';
    if (caption) caption.textContent = shot.description || shot.label || '';
    viewer.classList.add('visible');
    viewer.setAttribute('data-active-id', shot.id);
  }

  function closePhotoViewer(){
    var viewer = qs('visualize-photo-viewer');
    if (!viewer) return;
    viewer.classList.remove('visible');
    viewer.removeAttribute('data-active-id');
    var image = qs('visualize-photo-image');
    if (image) {
      try { image.removeAttribute('src'); } catch(_e){}
      image.alt = 'Visualize design preview';
    }
    var caption = qs('visualize-photo-caption');
    if (caption) caption.textContent = '';
  }

  function describePreset(index){
    var titles = ['Front Left', 'Front Right', 'Side Left', 'Side Right', 'Rear Left', 'Rear Right', 'Elevated', 'Top', 'Isometric', 'Alt'];
    return titles[index] || ('View ' + (index + 1));
  }

  function waitForFrame(){
    return new Promise(function(resolve){ window.requestAnimationFrame(resolve); });
  }

  function saveCameraState(cam){
    if (!cam) return null;
    return {
      position: cam.position.clone(),
      quaternion: cam.quaternion.clone(),
      up: cam.up.clone(),
      fov: cam.fov,
      near: cam.near,
      far: cam.far
    };
  }

  function restoreCameraState(cam, state){
    if (!cam || !state) return;
    if (state.position) cam.position.copy(state.position);
    if (state.quaternion) cam.quaternion.copy(state.quaternion);
    if (state.up) cam.up.copy(state.up);
    if (isFiniteNumber(state.fov)) cam.fov = state.fov;
    if (isFiniteNumber(state.near)) cam.near = state.near;
    if (isFiniteNumber(state.far)) cam.far = state.far;
    cam.updateProjectionMatrix();
  }

  function clonePreset(preset){
    if (!preset || !THREE) return null;
    return {
      position: preset.position ? preset.position.clone() : null,
      target: preset.target ? preset.target.clone() : null,
      up: preset.up ? preset.up.clone() : new THREE.Vector3(0, 1, 0),
      fov: preset.fov,
      near: preset.near,
      far: preset.far,
      __label: preset.__label || null,
      __source: preset.__source || null
    };
  }

  function captureLiveOrbitPreset(span, meshCenter, meshSize, renderFocus, options){
    if (!THREE || !window || !window.camera) return null;
    options = options || {};
    var recenterScene = options.recenter !== false;
    var pullbackRatio = options && isFiniteNumber(options.pullbackRatio) ? Math.max(1, options.pullbackRatio) : RENDER_CAMERA_PULLBACK;
    var camState = window.camera;
    
    // CRITICAL FIX: When not recentering, camera must look at actual geometry center
    var targetX, targetY, targetZ;
    if (!recenterScene && meshCenter) {
      // Use actual geometry center as camera target
      targetX = isFiniteNumber(meshCenter.x) ? meshCenter.x : 0;
      targetY = isFiniteNumber(renderFocus.y) ? renderFocus.y : 0;
      targetZ = isFiniteNumber(meshCenter.z) ? meshCenter.z : 0;
      console.log('[captureLiveOrbitPreset] Using geometry center as target:', targetX, targetY, targetZ);
    } else {
      // Use camera's current target
      targetX = isFiniteNumber(camState.targetX) ? camState.targetX : 0;
      targetY = isFiniteNumber(camState.targetY) ? camState.targetY : 0;
      targetZ = isFiniteNumber(camState.targetZ) ? camState.targetZ : 0;
      console.log('[captureLiveOrbitPreset] Using camera target:', targetX, targetY, targetZ);
    }
    
    var target = new THREE.Vector3(targetX, targetY, targetZ);
    target.x += CAMERA_FOCUS_OFFSET_RIGHT;
    target.y += CAMERA_FOCUS_OFFSET_UP;
    target.z += CAMERA_FOCUS_OFFSET_FORWARD;
    try {
      if (typeof window.updateProjectionCache === 'function') window.updateProjectionCache();
    } catch(_eCache){}

    // Use exact camera position from live viewport
    var posVec = null;
    if (window.__proj && Array.isArray(window.__proj.cam)) {
      var camArr = window.__proj.cam;
      posVec = new THREE.Vector3(camArr[0], camArr[1], camArr[2]);
      console.log('[captureLiveOrbitPreset] Using exact camera position from __proj.cam:', posVec.toArray());
    }
    
    // Fallback: calculate from orbit parameters
    if (!posVec) {
      var dist = isFiniteNumber(camState.distance) ? camState.distance : 18;
      var yaw = isFiniteNumber(camState.yaw) ? camState.yaw : 0;
      var pitch = isFiniteNumber(camState.pitch) ? camState.pitch : -0.4;
      var cp = Math.cos(pitch);
      var sp = Math.sin(pitch);
      var cy = Math.cos(yaw);
      var sy = Math.sin(yaw);
      var fwd = new THREE.Vector3(sy * cp, sp, cy * cp);
      posVec = target.clone().sub(fwd.multiplyScalar(dist));
      console.log('[captureLiveOrbitPreset] Calculated camera position from orbit:', posVec.toArray());
    }
    
    console.log('[captureLiveOrbitPreset] Final camera state:', {
      position: posVec.toArray(),
      target: target.toArray(),
      distance: posVec.distanceTo(target)
    });

    var distToTarget = Math.max(0.5, posVec.distanceTo(target));
    var safeSpan = Math.max(1, span || distToTarget * 0.5);
    var maxDimension = safeSpan;
    if (meshSize) {
      maxDimension = Math.max(maxDimension, meshSize.x || 0, meshSize.y || 0, meshSize.z || 0);
    }

    var fovEstimate = isFiniteNumber(camState.fov) ? camState.fov : NaN;
    if (!isFiniteNumber(fovEstimate) && window && window.__proj && isFiniteNumber(window.__proj.scale) && window.__proj.scale > 0) {
      var dpr = window.devicePixelRatio || 1;
      var baseCanvas = document.getElementById('canvas');
      var cssHeight = (baseCanvas && isFiniteNumber(baseCanvas.height) && baseCanvas.height > 0) ? (baseCanvas.height / dpr) : (window.innerHeight || 720);
      if (cssHeight > 0) {
        var halfHeight = cssHeight * 0.5;
        var scale = window.__proj.scale;
        var rad = 2 * Math.atan(halfHeight / scale);
        var deg = rad * (180 / Math.PI);
        if (isFiniteNumber(deg) && deg > 0) fovEstimate = deg;
      }
    }
    if (!isFiniteNumber(fovEstimate)) {
      fovEstimate = computeViewportFov();
    }
    if (!isFiniteNumber(fovEstimate)) {
      fovEstimate = 60;
    }

    if (recenterScene && THREE.MathUtils) {
      var radius = Math.max(0.5, maxDimension * 0.6);
      var fovRadians = THREE.MathUtils.degToRad(fovEstimate);
      var fitDist = radius / Math.tan(Math.max(0.2, fovRadians * 0.5));
      var desiredDist = Math.max(distToTarget, fitDist * 1.15);
      if (desiredDist > distToTarget + 0.01) {
        var direction = target.clone().sub(posVec);
        if (direction.lengthSq() > 0.0001) {
          direction.normalize();
          posVec = target.clone().sub(direction.multiplyScalar(desiredDist));
          distToTarget = desiredDist;
        }
      }
    }

    if (pullbackRatio > 1.0001 && distToTarget > 0.1) {
      var pullDir = posVec.clone().sub(target);
      var len = pullDir.length();
      if (len > 0.0001) {
        pullDir.multiplyScalar((distToTarget * pullbackRatio) / len);
        posVec = target.clone().add(pullDir);
        distToTarget *= pullbackRatio;
      }
    }

    var near = isFiniteNumber(camState.near) ? Math.max(0.01, camState.near) : Math.max(0.1, distToTarget * 0.02);
    var far = isFiniteNumber(camState.far) ? Math.max(near + 1, camState.far) : Math.max(distToTarget + maxDimension * 6, distToTarget + 120);

    var upVec = new THREE.Vector3(0, 1, 0);
    if (window && window.__proj && Array.isArray(window.__proj.up)) {
      var upArr = window.__proj.up;
      if (isFiniteNumber(upArr[0]) && isFiniteNumber(upArr[1]) && isFiniteNumber(upArr[2])) {
        upVec.set(upArr[0], upArr[1], upArr[2]).normalize();
      }
    }

    return {
      position: posVec,
      target: target,
      up: upVec,
      fov: fovEstimate,
      near: near,
      far: far,
      __label: LIVE_VIEW_LABEL,
      __source: 'live'
    };
  }

  function applyPresetToCameraObject(cam, preset){
    if (!cam || !preset) return;
    if (preset.position) cam.position.copy(preset.position);
    if (preset.up) cam.up.copy(preset.up);
    if (isFiniteNumber(preset.fov)) cam.fov = preset.fov;
    if (isFiniteNumber(preset.near)) cam.near = preset.near;
    if (isFiniteNumber(preset.far)) cam.far = preset.far;
    var target = preset.target || new THREE.Vector3(0, 0, 0);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  }

  function syncCameraWithLiveView(){
    if (!camera || !window || !window.camera || !window.__proj) return null; // Skip when the visualize camera or live viewport data is unavailable.
    try { if (typeof window.updateProjectionCache === 'function') window.updateProjectionCache(); } catch(_e){ } // Refresh the live projection cache so we copy current matrices.
    var live = window.camera; // Snapshot of the live orbit controller state (target, yaw, pitch, distance).
    var cache = window.__proj; // Projection cache exposing world-space camera position and axes.
    var baseCanvas = document.getElementById('canvas'); // DOM canvas that renders the live 3D viewport.
    var dpr = window.devicePixelRatio || 1; // Device pixel ratio to translate buffer size into CSS pixels.
    var cssWidth = baseCanvas && baseCanvas.width ? baseCanvas.width / dpr : (window.innerWidth || 1920); // Width of the live viewport in CSS pixels.
    var cssHeight = baseCanvas && baseCanvas.height ? baseCanvas.height / dpr : (window.innerHeight || 1080); // Height of the live viewport in CSS pixels.
    if (!isFiniteNumber(cssWidth) || cssWidth <= 0) cssWidth = 1920; // Default width when the canvas has not initialized yet.
    if (!isFiniteNumber(cssHeight) || cssHeight <= 0) cssHeight = 1080; // Default height when the canvas has not initialized yet.
    var target = new THREE.Vector3( // World-space point the live camera focuses on.
      isFiniteNumber(live.targetX) ? live.targetX : 0, // X component of the live target.
      isFiniteNumber(live.targetY) ? live.targetY : 0, // Y component of the live target.
      isFiniteNumber(live.targetZ) ? live.targetZ : 0  // Z component of the live target.
    );
    target.x += CAMERA_FOCUS_OFFSET_RIGHT; // Shift focus toward the positive X axis.
    target.y += CAMERA_FOCUS_OFFSET_UP; // Raise focus vertically to frame taller compositions.
    target.z += CAMERA_FOCUS_OFFSET_FORWARD; // Optional forward/back offset (currently zero).
    var position = (cache && Array.isArray(cache.cam) && cache.cam.length >= 3) // Determine which position source we can trust.
      ? new THREE.Vector3(cache.cam[0], cache.cam[1], cache.cam[2]) // Preferred: exact camera coordinates copied from the cache.
      : target.clone(); // Fallback placeholder that will be replaced by orbit reconstruction.
    if (!Array.isArray(cache.cam) || cache.cam.length < 3) { // When the cache fails to expose a camera vector...
      var distance = isFiniteNumber(live.distance) ? Math.max(0.1, live.distance) : 18; // Use the orbit distance from the live controller.
      var yaw = isFiniteNumber(live.yaw) ? live.yaw : 0; // Live yaw angle for horizontal orbiting.
      var pitch = isFiniteNumber(live.pitch) ? live.pitch : -0.4; // Live pitch angle for vertical orbiting.
      var cp = Math.cos(pitch); // Cosine of pitch for forward vector reconstruction.
      var sp = Math.sin(pitch); // Sine of pitch for forward vector reconstruction.
      var cy = Math.cos(yaw);   // Cosine of yaw for forward vector reconstruction.
      var sy = Math.sin(yaw);   // Sine of yaw for forward vector reconstruction.
      var forward = new THREE.Vector3(sy * cp, sp, cy * cp); // Forward vector pointing from camera to target.
      position = target.clone().sub(forward.multiplyScalar(distance)); // Rebuild camera position by walking back along the forward vector.
    }
    var pullbackVector = position.clone().sub(target); // Vector from focus point toward the camera.
    var pullbackLength = pullbackVector.length(); // Current camera distance before manual pullback.
    var pullbackApplied = false; // Track whether the manual pullback adjustment runs.
    var extendedDistance = pullbackLength + CAMERA_PULLBACK_METERS; // Target distance if pullback triggers.
    if (pullbackLength > 0.0001) { // Only apply pullback when the vector has a measurable length.
      pullbackVector.normalize(); // Normalize so scaling adds the desired meters.
      position.copy(pullbackVector.multiplyScalar(extendedDistance).add(target)); // Move the camera further along the vector by the extra distance.
      pullbackApplied = true; // Flag that the camera distance has been extended.
    }
    var cameraDistance = position.distanceTo(target); // Actual distance between camera and target in world units.
    if (!isFiniteNumber(cameraDistance) || cameraDistance <= 0) { // Guard against degenerate distances.
      cameraDistance = isFiniteNumber(live.distance) ? Math.max(0.1, live.distance) : 18; // Fall back to orbit distance to keep math stable.
    } else if (pullbackApplied && cameraDistance < extendedDistance) { // Ensure cameraDistance reflects the manual pullback.
      cameraDistance = extendedDistance; // Align distance metric with the adjusted position.
    }
    if (cache && Array.isArray(cache.up) && cache.up.length >= 3) { // If the projection cache includes an up vector...
      camera.up.set(cache.up[0], cache.up[1], cache.up[2]).normalize(); // Use the live up vector so roll matches the viewport.
    } else {
      camera.up.set(0, 1, 0); // Otherwise default to world-up.
    }
    camera.position.copy(position); // Place the visualize camera at the reconstructed live position.
    camera.lookAt(target); // Aim the visualize camera at the same target point as the live viewport.
    camera.aspect = cssWidth / cssHeight; // Mirror the live viewport aspect ratio.
    var liveScale = cache && isFiniteNumber(cache.scale) ? cache.scale : null; // Pull the live projection scale for FOV conversion.
    var fovFromScale = liveScale ? (2 * Math.atan((cssHeight * 0.5) / liveScale) * (180 / Math.PI)) : null; // Convert the scale to degrees.
    if (isFiniteNumber(live.fov)) {
      camera.fov = Math.max(10, Math.min(160, live.fov)); // Prefer explicit FOV values from the live camera when available.
    } else if (isFiniteNumber(fovFromScale)) {
      camera.fov = Math.max(10, Math.min(160, fovFromScale)); // Otherwise use the FOV derived from the projection scale.
    } else {
      camera.fov = computeViewportFov(); // Final fallback uses the legacy heuristic to avoid regressions.
    }
    if (isFiniteNumber(live.near)) {
      camera.near = Math.max(0.01, live.near); // Respect live near-plane overrides.
    } else {
      camera.near = Math.max(0.05, cameraDistance * 0.01); // Tie near-plane to camera distance to avoid clipping through geometry.
    }
    if (isFiniteNumber(live.far)) {
      camera.far = Math.max(camera.near + 1, live.far); // Respect live far-plane overrides.
    } else {
      camera.far = Math.max(camera.near + 100, cameraDistance * 6); // Expand the far-plane enough to cover the working scene.
    }
    camera.updateProjectionMatrix(); // Recompute the Three.js projection with the updated aspect/FOV/clip settings.
    return {
      target: target, // Expose the live target so downstream logic can align helpers.
      position: position, // Return the camera position for diagnostics and testing.
      distance: cameraDistance, // Propagate distance for heuristics like ground shadow sizing.
      cssWidth: cssWidth, // Provide viewport width to keep projection helpers in sync.
      cssHeight: cssHeight, // Provide viewport height for the same reason.
      fov: camera.fov // Surface the effective FOV for logging and UI.
    };
  }

  async function generateViewSnapshots(options){
    if (!renderer || !scene || !camera) return [];
    if (!Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) return [];
    var maxShots = options && isFiniteNumber(options.maxShots) ? Math.max(0, Math.floor(options.maxShots)) : 4;
    if (maxShots <= 0) return [];
    var canvas = renderer.domElement;
    if (!canvas) return [];
    var shots = [];
    var originalState = saveCameraState(camera);
    var originalIndex = viewIndex;
    try {
      var count = Math.min(maxShots, VIEW_PRESETS.length);
      for (var i = 0; i < count; i++){
        var preset = VIEW_PRESETS[i];
        if (!preset) continue;
        applyPresetToCameraObject(camera, preset);
        
        // Clear and render with maximum precision
        renderer.clear(true, true, true);
        renderSceneWithPostFX(canvas.width, canvas.height);
        
        await waitForFrame();
        var dataUrl = null;
        try {
          // Capture at maximum quality
          dataUrl = canvas.toDataURL('image/png', 1.0);
        } catch(err){
          console.warn('[Visualize] Failed to capture preset snapshot', err);
        }
        if (dataUrl){
          var presetLabel = preset.__label || describePreset(i);
          var desc = presetLabel || ('Camera preset ' + (i + 1));
          if (preset && preset.target) {
            var t = preset.target;
            desc = desc + ' - Focus (' + t.x.toFixed(1) + ', ' + t.y.toFixed(1) + ', ' + t.z.toFixed(1) + ')';
          }
          shots.push({
            id: 'preset-' + (i + 1),
            label: presetLabel,
            description: desc,
            previewUrl: dataUrl,
            fullUrl: dataUrl,
            source: 'preset',
            presetIndex: i
          });
        }
      }
    } finally {
      restoreCameraState(camera, originalState);
      viewIndex = originalIndex;
      var restoreWidth = canvas ? canvas.width : undefined;
      var restoreHeight = canvas ? canvas.height : undefined;
      renderSceneWithPostFX(restoreWidth, restoreHeight);
      syncViewButtons();
    }
    return shots;
  }

    function primeLivePreview(){
      try {
        var wrap = qs('visualize-canvas-wrap');
        var baseCanvas = document.getElementById('canvas');
        if (!wrap || !baseCanvas) return false;
        if (!baseCanvas.width || !baseCanvas.height) return false;
        var dataUrl = baseCanvas.toDataURL('image/png');
        if (!dataUrl || dataUrl.length < 32) return false;
        wrap.style.backgroundImage = 'url(' + dataUrl + ')';
        wrap.style.backgroundSize = '100% 100%';
        wrap.style.backgroundPosition = '0 0';
        wrap.style.backgroundRepeat = 'no-repeat';
        wrap.classList.add('visualize-live-preview');
        return true;
      } catch(err) {
        console.warn('[Visualize] Unable to prime live preview', err);
        return false;
      }
    }

    function clearLivePreview(){
      var wrap = qs('visualize-canvas-wrap');
      if (!wrap) return;
      wrap.style.backgroundImage = '';
      wrap.style.backgroundSize = '';
      wrap.style.backgroundPosition = '';
      wrap.style.backgroundRepeat = '';
      wrap.classList.remove('visualize-live-preview');
      syncLivePanTransform(true);
    }

    function renderLiveViewportOnly(options){
      options = options || {};
      var baseCanvas = document.getElementById('canvas');
      if (!baseCanvas || !baseCanvas.width || !baseCanvas.height) return null;

      var wrap = qs('visualize-canvas-wrap');
      var renderCanvas = qs(CANVAS_ID);
      if (!renderCanvas) return null;

      var dpr = window.devicePixelRatio || 1;
      var width = baseCanvas.width;
      var height = baseCanvas.height;
      var cssWidth = baseCanvas.clientWidth || Math.round(width / dpr);
      var cssHeight = baseCanvas.clientHeight || Math.round(height / dpr);
      if (!cssWidth || cssWidth <= 0) cssWidth = Math.round(width / dpr) || width;
      if (!cssHeight || cssHeight <= 0) cssHeight = Math.round(height / dpr) || height;

      if (wrap) {
        wrap.style.width = cssWidth + 'px';
        wrap.style.height = cssHeight + 'px';
      }
      renderCanvas.style.width = cssWidth + 'px';
      renderCanvas.style.height = cssHeight + 'px';
      renderCanvas.width = width;
      renderCanvas.height = height;

      lastCanvasWidth = width;
      lastCanvasHeight = height;
      lastCanvasCssWidth = cssWidth;
      lastCanvasCssHeight = cssHeight;

      var dataUrl = null;
      try { dataUrl = baseCanvas.toDataURL('image/png'); } catch(_captureErr){ dataUrl = null; }
      if (dataUrl) {
        lastLiveViewportDataUrl = dataUrl;
        if (wrap) {
          wrap.style.backgroundImage = 'url(' + dataUrl + ')';
          wrap.style.backgroundSize = '100% 100%';
          wrap.style.backgroundPosition = '0 0';
          wrap.style.backgroundRepeat = 'no-repeat';
          wrap.classList.add('visualize-live-preview');
        }
      }

      ensureResizeListener();
      fitRenderToStage();
      updateAlignmentGrid(cssWidth, cssHeight);

      var shot = dataUrl ? {
        id: 'live-viewport',
        label: 'Live View',
        description: 'Captured directly from the 3D viewport.',
        previewUrl: dataUrl,
        fullUrl: dataUrl,
        source: 'live'
      } : null;

      if (options.previewOnly) {
        if (renderer) {
          try { if (typeof renderer.dispose === 'function') renderer.dispose(); } catch(_disposeErr){}
        }
        renderer = null;
        scene = null;
        camera = null;
        composer = null;
        sceneRoot = null;
        pmremGenerator = null;
        envRT = null;
        return { shot: shot, cssWidth: cssWidth, cssHeight: cssHeight };
      }

      return {
        shot: shot,
        cssWidth: cssWidth,
        cssHeight: cssHeight
      };
    }

    function syncLivePanTransform(disable){
      var wrap = qs('visualize-canvas-wrap');
      if (!wrap) return;
      if (disable) {
        wrap.style.transform = '';
        return;
      }
      var panState = (window && window.pan) ? window.pan : null;
      if (!panState) {
        wrap.style.transform = '';
        return;
      }
      var dpr = window.devicePixelRatio || 1;
      var tx = (panState.x || 0);
      var ty = (panState.y || 0);
      if (dpr && dpr !== 1) {
        tx /= dpr;
        ty /= dpr;
      }
      if (Math.abs(tx) < 0.001 && Math.abs(ty) < 0.001) {
        wrap.style.transform = '';
        return;
      }
      wrap.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)';
    }

    function resetTileReveal(){
      if (tileRevealCleanup) {
        var cleanup = tileRevealCleanup;
        tileRevealCleanup = null;
        try { cleanup(false, true); } catch(_eCleanup){}
      } else {
        if (tileRevealTimers && tileRevealTimers.length){
          tileRevealTimers.forEach(function(id){ window.clearTimeout(id); });
          tileRevealTimers.length = 0;
        }
        tileRevealTimers = [];
        if (tileOverlayCanvas && tileOverlayCanvas.parentNode) {
          tileOverlayCanvas.parentNode.removeChild(tileOverlayCanvas);
        }
        tileOverlayCanvas = null;
        if (renderer && renderer.domElement) renderer.domElement.style.opacity = '1';
      }
    }

    function animateRenderReveal(canvas, stageRect, options){
      options = options || {};
      var wrap = qs('visualize-canvas-wrap');
      if (!wrap || !canvas) return null;
      var dataUrl = null;
      try {
        dataUrl = canvas.toDataURL('image/png');
      } catch(err) {
        console.warn('[Visualize] Unable to capture render surface for reveal', err);
        return null;
      }
      if (!dataUrl || dataUrl.length < 32) return null;

      var displayWidth = stageRect && stageRect.width ? stageRect.width : wrap.clientWidth;
      var displayHeight = stageRect && stageRect.height ? stageRect.height : wrap.clientHeight;
      displayWidth = Math.max(1, Math.round(displayWidth));
      displayHeight = Math.max(1, Math.round(displayHeight));

      var overlay = document.createElement('canvas');
      overlay.id = 'visualize-tile-overlay';
      overlay.width = displayWidth;
      overlay.height = displayHeight;
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '5';
      overlay.style.backgroundColor = 'transparent';
      overlay.style.imageRendering = 'auto';
      wrap.appendChild(overlay);
      tileOverlayCanvas = overlay;

      var ctx = overlay.getContext('2d');
      if (!ctx) {
        wrap.removeChild(overlay);
        tileOverlayCanvas = null;
        return null;
      }
      ctx.clearRect(0, 0, displayWidth, displayHeight);

      if (tileRevealTimers && tileRevealTimers.length){
        tileRevealTimers.forEach(function(id){ window.clearTimeout(id); });
        tileRevealTimers.length = 0;
      }
      tileRevealTimers = [];

      if (renderer && renderer.domElement) renderer.domElement.style.opacity = '0';

      var tileSize = (options.tileSize && options.tileSize > 0) ? options.tileSize : TILE_REVEAL_SIZE;
      var delay = (options.delay && options.delay >= 0) ? options.delay : 28;

      var promise = new Promise(function(resolve){
        var resolved = false;
        tileRevealCleanup = function(success, skipCallbacks){
          if (tileRevealTimers && tileRevealTimers.length){
            tileRevealTimers.forEach(function(id){ window.clearTimeout(id); });
            tileRevealTimers.length = 0;
          }
          tileRevealTimers = [];
          if (renderer && renderer.domElement) renderer.domElement.style.opacity = '1';
          if (tileOverlayCanvas && tileOverlayCanvas.parentNode){
            tileOverlayCanvas.parentNode.removeChild(tileOverlayCanvas);
          }
          tileOverlayCanvas = null;
          if (!skipCallbacks && options && typeof options.onComplete === 'function') {
            try { options.onComplete(success); } catch(_cbErr){}
          }
          if (!resolved) {
            resolved = true;
            resolve(success);
          }
          tileRevealCleanup = null;
        };

        var image = new Image();
        image.onload = function(){
          var cols = Math.ceil(displayWidth / tileSize);
          var rows = Math.ceil(displayHeight / tileSize);
          var total = cols * rows;
          var index = 0;
          var drawNext = function(){
            if (!tileOverlayCanvas) {
              tileRevealCleanup(false, true);
              return;
            }
            if (index >= total) {
              tileRevealCleanup(true, false);
              return;
            }
            var col = index % cols;
            var row = Math.floor(index / cols);
            var dx = col * tileSize;
            var dy = row * tileSize;
            var dw = Math.min(tileSize, displayWidth - dx);
            var dh = Math.min(tileSize, displayHeight - dy);
            if (dw <= 0 || dh <= 0) {
              index++;
              tileRevealTimers.push(window.setTimeout(drawNext, delay));
              return;
            }
            var sx = dx / displayWidth * canvas.width;
            var sy = dy / displayHeight * canvas.height;
            var sw = dw / displayWidth * canvas.width;
            var sh = dh / displayHeight * canvas.height;
            try {
              ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
            } catch(drawErr) {
              console.warn('[Visualize] Tile draw failed', drawErr);
              tileRevealCleanup(false, false);
              return;
            }
            index++;
            tileRevealTimers.push(window.setTimeout(drawNext, delay));
          };
          drawNext();
        };
        image.onerror = function(){ tileRevealCleanup(false, false); };
        image.src = dataUrl;
      });

      return promise;
    }

  function captureLiveCanvasShot(){
    try {
      var baseCanvas = document.getElementById('canvas');
      if (!baseCanvas || typeof baseCanvas.toDataURL !== 'function') return null;
      if (baseCanvas.width === 0 || baseCanvas.height === 0) return null;
      var dataUrl = baseCanvas.toDataURL('image/png');
      if (!dataUrl || dataUrl.length < 32) return null;
      return {
        id: 'live-3d',
        label: 'Live 3D View',
        description: 'Snapshot captured from the active 3D workspace.',
        previewUrl: dataUrl,
        fullUrl: dataUrl,
        source: 'live'
      };
    } catch(err){
      console.warn('[Visualize] Live canvas capture failed', err);
      return null;
    }
  }
  async function populateDesignGallery(context){
    var loadingEl = context && context.loadingEl;
    try {
      if (loadingEl) loadingEl.textContent = 'Capturing design views...';
      var shots = await generateViewSnapshots({ maxShots: 4 });
      if (loadingEl) loadingEl.textContent = 'Preparing gallery...';
      var liveShot = captureLiveCanvasShot();
      if (liveShot) shots.unshift(liveShot);
      setGalleryShots(shots);
      updateGalleryGrid();
    } catch(err){
      console.warn('[Visualize] Failed to populate design gallery', err);
      if (!galleryShots || galleryShots.length === 0){
        updateGalleryGrid('Unable to generate design images.');
      }
    }
  }

  function setPhotorealStatus(message, kind){
    var el = qs('visualize-photoreal-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('error', 'success');
    if (kind) el.classList.add(kind);
  }

  function buildPhotorealPayload(){
    var rawSnapshot = gatherProjectSnapshot();
    var snapshot = sanitizeSnapshot(rawSnapshot);
    var preset = null;
    if (Array.isArray(VIEW_PRESETS) && VIEW_PRESETS.length){
      var idx = Math.min(Math.max(viewIndex, 0), VIEW_PRESETS.length - 1);
      preset = VIEW_PRESETS[idx];
    }
    var quality = 1;
    var qualitySelect = qs(QUALITY_ID);
    if (qualitySelect){
      var selected = parseFloat(qualitySelect.value);
      if (isFiniteNumber(selected)) quality = selected;
    }
    return {
      snapshot: snapshot,
      camera: cameraToPayload(camera),
      view: presetToPayload(preset),
      stage: { width: lastCanvasWidth || 0, height: lastCanvasHeight || 0 },
      sky: skyGradientPalette || null,
      project: collectProjectMeta(),
      quality: quality,
      meta: {
        requestedAt: Date.now(),
        presetIndex: viewIndex,
        devicePixelRatio: window.devicePixelRatio || 1
      }
    };
  }

  function handlePhotorealResponse(result){
    if (!result) return;
    if (result.message) {
      setPhotorealStatus(result.message, result.status === 'completed' ? 'success' : undefined);
    } else if (result.status === 'completed') {
      setPhotorealStatus('Photoreal render ready.', 'success');
    }
    if (!result.imageUrl) return;
    var shot = {
      id: result.jobId ? ('photoreal-' + result.jobId) : ('photoreal-' + Date.now()),
      label: result.hasBlender ? 'Photoreal Render' : 'Photoreal Preview',
      description: result.message || 'Server-generated photorealistic view.',
      previewUrl: result.imageUrl,
      fullUrl: result.imageUrl,
      source: 'photoreal',
      job: result
    };
    var list = Array.isArray(galleryShots) ? galleryShots.slice() : [];
    list = list.filter(function(entry){ return entry && entry.id !== shot.id; });
    list.unshift(shot);
    setGalleryShots(list);
    updateGalleryGrid();
    focusPhotorealShot(shot.id);
  }

  async function requestPhotorealRender(){
    var button = qs('visualize-photoreal');
    if (button) button.disabled = true;
    try {
      setPhotorealStatus('Sending design to photoreal renderer...');
      
      // Capture high-quality local render as fallback
      var localFallbackUrl = null;
      try {
        if (renderer && renderer.domElement) {
          localFallbackUrl = renderer.domElement.toDataURL('image/png', 1.0);
        }
      } catch(_c){
        console.warn('[Visualize] Failed to capture local fallback', _c);
      }

      var payload = buildPhotorealPayload();
      var response = await fetch(PHOTOREAL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var result = null;
      try {
        result = await response.json();
      } catch(_e){}
      if (!response.ok){
        var errMsg = (result && result.message) || ('Photoreal request failed (' + response.status + ')');
        throw new Error(errMsg);
      }

      // If server lacks Blender, use our high-quality local render instead of the placeholder
      if (result && !result.hasBlender && localFallbackUrl) {
        result.imageUrl = localFallbackUrl;
        result.message = 'Generated high-quality local render (Cloud renderer unavailable).';
        result.status = 'completed';
      }

      handlePhotorealResponse(result);
      if (!result || !result.message) {
        setPhotorealStatus('Photoreal render ready.', 'success');
      }
    } catch(err){
      setPhotorealStatus(err && err.message ? err.message : 'Unable to request photoreal render.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function gatherBoxes(snapshot){
    var boxes = [];
    var envelope = computeRoomsEnvelope(snapshot.rooms);
    snapshot.rooms.forEach(function(room){
      if (!room) return;
      var box = boxFromDimensions(room);
      box.height = Math.max(2.2, room.height || 2.8);
      boxes.push({ box: box, kind: 'room', room: room });
    });
    snapshot.pergolas.forEach(function(pergola){
      if (!pergola) return;
      var box = boxFromDimensions(pergola);
      box.height = Math.max(2.1, pergola.height || 2.4);
      boxes.push({ box: box, kind: 'pergola' });
    });
    snapshot.garages.forEach(function(garage){
      if (!garage) return;
      var box = boxFromDimensions(garage);
      box.height = Math.max(2.4, garage.height || 3.0);
      boxes.push({ box: box, kind: 'garage' });
    });
    snapshot.pools.forEach(function(pool){
      if (!pool) return;
      var box = boxFromDimensions(pool);
      box.height = Math.max(1.0, pool.height || 0.8);
      boxes.push({ box: box, kind: 'pool' });
    });
    snapshot.roofs.forEach(function(roof){
      if (!roof) return;
      var box = deriveRoofBox(roof, envelope);
      boxes.push({ box: box, kind: 'roof' });
    });
    snapshot.balconies.forEach(function(balcony){
      if (!balcony) return;
      var box = boxFromDimensions(balcony);
      box.height = Math.max(0.6, balcony.height || 0.5);
      boxes.push({ box: box, kind: 'balcony' });
    });
    snapshot.furniture.forEach(function(item){
      if (!item) return;
      var box = boxFromDimensions(item);
      box.height = Math.max(0.4, item.height || 1.0);
      boxes.push({ box: box, kind: 'furniture' });
    });
    // Add stairs if present
    if (Array.isArray(snapshot.stairs)) {
      snapshot.stairs.forEach(function(stair){
        if (!stair) return;
        var box = boxFromDimensions(stair);
        box.height = Math.max(2.8, stair.height || 3.0);
        boxes.push({ box: box, kind: 'room' }); // Render stairs as room-like structure
      });
    }
    return boxes;
  }

  function materialFor(kind){
    var palette = {
      // High-End Photorealistic Concrete Palette
      room: {
        color: 0x6d7075, // Weighty yet daylight-balanced concrete
        roughness: 0.92,
        metalness: 0.0,
        envMapIntensity: 0.78,
        needsTexture: true,
        bumpScale: 0.1
      },
      wall: {
        color: 0x5e6369, // Exterior concrete massing
        roughness: 0.94,
        metalness: 0.02,
        envMapIntensity: 0.85,
        needsTexture: true,
        bumpScale: 0.12
      },
      pergola: { 
        color: 0x333333, // Dark steel/wood
        roughness: 0.4, 
        metalness: 0.6, 
        envMapIntensity: 1.5
      },
      pool: { 
        color: 0x2090D0, 
        roughness: 0.02, 
        metalness: 0.1, 
        transmission: 0.95, 
        thickness: 2.0, 
        envMapIntensity: 3.0, 
        ior: 1.33, 
        clearcoat: 1.0, 
        clearcoatRoughness: 0.02,
        transparent: true,
        opacity: 0.8
      },
      roof: { 
        color: 0x222222, // Dark slate
        roughness: 0.9, 
        metalness: 0.1, 
        envMapIntensity: 0.5,
        needsTexture: true
      },
      balcony: { 
        color: 0x999999, 
        roughness: 0.6, 
        metalness: 0.1, 
        envMapIntensity: 1.0
      },
      furniture: { 
        color: 0x555555, 
        roughness: 0.7, 
        metalness: 0.2, 
        envMapIntensity: 0.8
      },
      garage: null,
      windowFrame: { color: 0x1a1a1a, roughness: 0.2, metalness: 0.8, envMapIntensity: 2.0 },
      doorFrame: { color: 0x222222, roughness: 0.3, metalness: 0.5, envMapIntensity: 1.5 },
      doorPanel: { color: 0x443322, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.8 },
      glass: { color: 0xffffff, roughness: 0.0, metalness: 0.1, transmission: 0.98, thickness: 0.5, transparent: true, opacity: 0.1, envMapIntensity: 3.0, ior: 1.52, clearcoat: 1.0 },
      accentPanel: { color: 0x555555, roughness: 0.6, metalness: 0.2, envMapIntensity: 1.0 },
      groundPath: { color: 0x666666, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.5 },
      woodAccent: { color: 0x6B5840, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.8 },
      boulder: { color: 0x555555, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.4 },
      foliage: { color: 0x335533, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.6 }
    };
    var baseSpec;
    if (kind === 'garage') {
      baseSpec = palette.wall;
    } else {
      baseSpec = palette[kind];
    }
    if (!baseSpec) {
      baseSpec = { color: 0x888888, roughness: 0.8, metalness: 0.1, envMapIntensity: 1.0 };
    }
    var spec = Object.assign({}, baseSpec);
    
    // Use MeshPhysicalMaterial for clean photorealistic rendering
    var mat = new THREE.MeshPhysicalMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      envMapIntensity: spec.envMapIntensity || 1.0
    });
    
    // Add clearcoat for glossy surfaces
    if (spec.clearcoat) {
      mat.clearcoat = spec.clearcoat;
      mat.clearcoatRoughness = spec.clearcoatRoughness || 0.1;
    }
    
    // Handle transmission for glass/water
    if (spec.transmission) {
      mat.transmission = spec.transmission;
      mat.thickness = spec.thickness || 0.1;
      mat.ior = spec.ior || 1.45;
    }
    
    if (typeof spec.opacity === 'number') {
      mat.opacity = spec.opacity;
      mat.transparent = true;
    }
    if (spec.transparent) mat.transparent = true;
    
    // Add concrete/other textures for materials that need it
    if (spec.needsTexture) {
      if ((kind === 'wall' || kind === 'room') && window.THREE && THREE.TextureLoader) {
        if (!concreteTextureCache) {
          try {
            var loader = new THREE.TextureLoader();
            var tex = loader.load('/js/textures/concrete/stone-background-wall-texture-banner-grunge-cement-concrete.jpg');
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.anisotropy = 8;
            // Moderate repeat; UV jitter controls effective tile size
            tex.repeat.set(1, 1);
            if (THREE.SRGBColorSpace && tex.colorSpace !== THREE.SRGBColorSpace) {
              tex.colorSpace = THREE.SRGBColorSpace;
            }
            concreteTextureCache = tex;
          } catch(_e){}
        }
        // Skip texture assignment to avoid "Texture marked for update" errors
        // Material already has proper concrete color/roughness/metalness
      } else {
        // Skip texture assignment - use solid colors only
        // This avoids texture loading errors while still providing photorealistic materials
      }
    }
    
    mat.needsUpdate = true;
    return mat;
  }

  function addArchitecturalAccents(entry){
    // Skip accents - keep it clean for now
    return;
  }

  function addSignatureFacade(bounds, centerX, centerY, centerZ, span){
    // Skip facade - render only user's design
    return;
  }

  function buildGround(bounds, centerX, centerZ, baseY, span){
    // DISABLED: No ground grid - keep it clean
    return baseY || 0;
  }

  function buildViewPresets(centerX, centerY, centerZ, span, bounds, focus){
    if (!THREE) return [];
    var presets = [];
    var safeSpan = Math.max(3, span || 3);
    var maxY = (bounds && isFiniteNumber(bounds.maxY)) ? bounds.maxY : (centerY + safeSpan * 0.5);
    var minY = (bounds && isFiniteNumber(bounds.minY)) ? bounds.minY : 0;
    var heightSpan = Math.max(2.6, maxY - minY);
    var radius = Math.max(4.5, safeSpan * 1.25);
    var focusX = (focus && isFiniteNumber(focus.x)) ? focus.x : centerX;
    var focusZ = (focus && isFiniteNumber(focus.z)) ? focus.z : centerZ;
    var focusY = (focus && isFiniteNumber(focus.y)) ? focus.y : (minY + heightSpan * 0.55);
    var orbitX = focusX;
    var orbitZ = focusZ;
    var orbitY = centerY;

    function pushPreset(angleDeg, options){
      var opts = options || {};
      var heightFactor = (opts.heightFactor != null) ? opts.heightFactor : 0.45;
      var distanceFactor = (opts.distanceFactor != null) ? opts.distanceFactor : 1.2;
      var tiltOffset = opts.tiltOffset != null ? opts.tiltOffset : 0;
      var fov = (opts && Object.prototype.hasOwnProperty.call(opts, 'fov')) ? opts.fov : computeViewportFov();
      var rad = angleDeg * Math.PI / 180;
      var dist = radius * distanceFactor;
      var yPos = Math.max(minY + Math.max(safeSpan * 0.3, heightSpan * heightFactor), orbitY);
      var pos = new THREE.Vector3(
        orbitX + Math.cos(rad) * dist,
        yPos,
        orbitZ + Math.sin(rad) * dist
      );
      var target = new THREE.Vector3(
        focusX + (opts.targetOffsetX || 0) * safeSpan,
        focusY + heightSpan * tiltOffset,
        focusZ + (opts.targetOffsetZ || 0) * safeSpan
      );
      presets.push({
        position: pos,
        target: target,
        up: opts.up ? opts.up.clone() : new THREE.Vector3(0, 1, 0),
        fov: fov,
        near: 0.1,
        far: Math.max(400, dist * 5)
      });
    }

    // 1. Cinematic High-End (object centered, dramatic sweep)
    pushPreset(220, {
      heightFactor: 0.32,
      distanceFactor: 1.28,
      tiltOffset: 0.04,
      targetOffsetX: -0.03,
      fov: 48
    });

    // 2. Balanced Hero
    pushPreset(240, {
      heightFactor: 0.42,
      distanceFactor: 1.35,
      tiltOffset: 0.03,
      targetOffsetZ: -0.03,
      fov: 46
    });

    // 3. Eye Level Detail
    pushPreset(200, {
      heightFactor: 0.38,
      distanceFactor: 1.18,
      tiltOffset: -0.015,
      fov: 50
    });

    // 4. Side Left
    pushPreset(120, {
      heightFactor: 0.4,
      distanceFactor: 1.15,
      tiltOffset: 0.02,
      fov: 48
    });

    // 5. Side Right
    pushPreset(300, {
      heightFactor: 0.4,
      distanceFactor: 1.2,
      tiltOffset: 0.04,
      fov: 48
    });

    // 6. Top / Plan-style (closer, straight down for detail)
    var topPos = new THREE.Vector3(
      orbitX,
      maxY + safeSpan * 1.8,
      orbitZ
    );
    presets.push({
      position: topPos,
      target: new THREE.Vector3(focusX, focusY, focusZ),
      up: new THREE.Vector3(0, 0, -1),
      fov: 45,
      near: 0.5,
      far: Math.max(1000, safeSpan * 10)
    });

    if (!presets.length) {
      var fallback = new THREE.Vector3(orbitX + safeSpan * 2.5, maxY + safeSpan * 0.8, orbitZ + safeSpan * 1.5);
      presets.push({
        position: fallback,
        target: new THREE.Vector3(focusX, focusY, focusZ),
        up: new THREE.Vector3(0, 1, 0),
        fov: 48,
        near: 0.05,
        far: Math.max(600, safeSpan * 8)
      });
    }

    return presets.slice(0, 10);
  }

  function applyCameraPreset(index){
    if (!camera || !Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) return;
    var total = VIEW_PRESETS.length;
    var normalized = ((index % total) + total) % total;
    var preset = VIEW_PRESETS[normalized];
    if (!preset) return;
    viewIndex = normalized;
    camera.position.copy(preset.position);
    if (preset.up) camera.up.copy(preset.up);
    if (isFiniteNumber(preset.fov)) camera.fov = preset.fov;
    if (isFiniteNumber(preset.near)) camera.near = preset.near;
    if (isFiniteNumber(preset.far)) camera.far = preset.far;
    if (preset.target) camera.lookAt(preset.target);
    camera.updateProjectionMatrix();
    syncViewButtons();
  }

  function syncViewButtons(){
    if (!viewButtons || !viewButtons.length) return;
    var total = Array.isArray(VIEW_PRESETS) ? VIEW_PRESETS.length : 0;
    viewButtons.forEach(function(btn, idx){
      if (!btn) return;
      var enabled = idx < total && total > 0;
      btn.disabled = !enabled;
      btn.classList.toggle('active', enabled && idx === viewIndex);
      btn.classList.toggle('inactive', !enabled);
    });
  }

  function handleViewSelection(idx){
    if (!Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) return;
    var total = VIEW_PRESETS.length;
    var clamped = Math.max(0, Math.min(idx, total - 1));
    applyCameraPreset(clamped);
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
      if (fabricCanvas) fabricCanvas.requestRenderAll();
    }
  }

  function setupViewButtons(){
    var container = qs('visualize-view-grid');
    if (!container) return;
    viewButtons = [];
    var buttons = container.querySelectorAll('button[data-view-index]');
    buttons.forEach(function(btn){
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-view-index'), 10);
      if (!isFiniteNumber(idx)) return;
      viewButtons.push(btn);
      if (!btn.__wired){
        btn.__wired = true;
        btn.addEventListener('click', function(){ handleViewSelection(idx); });
      }
    });
    syncViewButtons();
  }

  async function renderSnapshot(){
    var loading = qs(LOADING_ID);
    var shouldHideLoading = true;
    var previewPrimed = false;
    var previewCleared = false;
    var tileRevealPromise = null;
    resetTileReveal();
    previewPrimed = primeLivePreview();
    if (loading) {
      loading.textContent = 'Generating...';
      loading.classList.add('visible');
    }
    try {
      // STEP 1: CAPTURE COMPLETE VIEWPORT PROFILE
      liveViewportProfile = captureCompleteViewportProfile();
      
      var snapshot = gatherProjectSnapshot();
      console.log('[Visualize] Snapshot gathered');
      var hash = computeHash(snapshot);
      if (rng && typeof rng.reseed === 'function') rng.reseed(hash);
      materialExposureCache = Object.create(null);
      skyTexture = null;
      skyGradientPalette = null;
      var qualitySelect = qs(QUALITY_ID);
      var multiplier = qualitySelect ? parseFloat(qualitySelect.value || '1') : 1;
      if (!isFinite(multiplier) || multiplier <= 0) multiplier = 1;
      currentQuality = multiplier;

      var liveCapture = renderLiveViewportOnly({ quality: multiplier });

      // Use 3D renderer to properly rebuild geometry with photorealistic materials
      var USE_LIVE_SCREENSHOT_DIRECTLY = false;
      
      if (USE_LIVE_SCREENSHOT_DIRECTLY && liveCapture && liveCapture.shot) {
        // Apply photorealistic post-processing to the live screenshot
        console.log('[Visualize] Using live screenshot directly with photorealistic enhancements');
        console.log('[Visualize] Live capture data:', {
          hasShot: !!liveCapture.shot,
          cssWidth: liveCapture.cssWidth,
          cssHeight: liveCapture.cssHeight,
          previewUrl: liveCapture.shot ? liveCapture.shot.previewUrl.substring(0, 50) : 'none'
        });
        
        // Create a NEW 2D canvas for image processing (the existing one is WebGL)
        var processingCanvas = document.createElement('canvas');
        var renderCanvas = qs(CANVAS_ID);
        if (!renderCanvas) {
          console.error('[Visualize] Render canvas element not found:', CANVAS_ID);
          if (loading) loading.classList.remove('visible');
          return;
        }
        
        console.log('[Visualize] Created processing canvas');
        
        var cssWidth = liveCapture.cssWidth || window.innerWidth;
        var cssHeight = liveCapture.cssHeight || window.innerHeight;
        
        // Set processing canvas to match live viewport dimensions
        processingCanvas.width = lastCanvasWidth || Math.round(cssWidth * (window.devicePixelRatio || 1));
        processingCanvas.height = lastCanvasHeight || Math.round(cssHeight * (window.devicePixelRatio || 1));
        
        // Replace the WebGL canvas with our 2D processing canvas
        renderCanvas.width = processingCanvas.width;
        renderCanvas.height = processingCanvas.height;
        renderCanvas.style.width = cssWidth + 'px';
        renderCanvas.style.height = cssHeight + 'px';
        
        console.log('[Visualize] Canvas configured:', processingCanvas.width, 'x', processingCanvas.height, 'pixels,', cssWidth, 'x', cssHeight, 'CSS');
        
        // Load the live screenshot onto the canvas
        var img = new Image();
        img.onload = function() {
          console.log('[Visualize] Image loaded, dimensions:', img.width, 'x', img.height);
          
          try {
            var ctx = processingCanvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              console.error('[Visualize] Failed to get 2D context');
              if (loading) loading.classList.remove('visible');
              return;
            }
            
            // Draw the live viewport
            ctx.clearRect(0, 0, processingCanvas.width, processingCanvas.height);
            ctx.drawImage(img, 0, 0, processingCanvas.width, processingCanvas.height);
            
            console.log('[Visualize] Base image drawn, applying concrete material...');
            
            // Apply photorealistic concrete material enhancements
            var imageData = ctx.getImageData(0, 0, processingCanvas.width, processingCanvas.height);
            var data = imageData.data;
            
            console.log('[Visualize] Processing', data.length / 4, 'pixels...');
            
            // Generate concrete texture pattern (Perlin-like noise)
            var concreteNoise = new Uint8Array(processingCanvas.width * processingCanvas.height);
            for (var y = 0; y < processingCanvas.height; y++) {
              for (var x = 0; x < processingCanvas.width; x++) {
                var idx = y * processingCanvas.width + x;
                // Multi-scale noise for realistic concrete
                var n1 = (Math.sin(x * 0.02) + Math.cos(y * 0.03)) * 0.3;
                var n2 = (Math.sin(x * 0.08 + y * 0.05) * Math.cos(x * 0.1)) * 0.2;
                var n3 = (Math.random() - 0.5) * 0.5;
                var noise = (n1 + n2 + n3) * 128 + 128;
                concreteNoise[idx] = Math.max(0, Math.min(255, noise));
              }
            }
            
            // Apply concrete material to detected surfaces
            for (var i = 0; i < data.length; i += 4) {
              var pixelIdx = Math.floor(i / 4);
              var r = data[i];
              var g = data[i + 1];
              var b = data[i + 2];
              var a = data[i + 3];
              
              // Skip transparent pixels
              if (a < 10) continue;
              
              // Detect surfaces that should be concrete (light colored surfaces)
              var luminance = (r * 0.299 + g * 0.587 + b * 0.114);
              var saturation = Math.max(r, g, b) - Math.min(r, g, b);
              var isWallSurface = (luminance > 160 && saturation < 40); // Light, low-saturation = likely wall
              
              if (isWallSurface) {
                // Base concrete color: warm light gray (#D8D8CE)
                var concreteR = 216;
                var concreteG = 216;
                var concreteB = 206;
                
                // Get noise value for this pixel
                var noiseVal = concreteNoise[pixelIdx];
                var noiseFactor = (noiseVal - 128) / 128; // -1 to 1
                
                // Apply concrete base color with luminance preservation
                var targetLuminance = luminance * 0.95; // Slightly darken
                var factor = targetLuminance / ((concreteR * 0.299 + concreteG * 0.587 + concreteB * 0.114) || 1);
                
                r = concreteR * factor;
                g = concreteG * factor;
                b = concreteB * factor;
                
                // Add texture variation
                r += noiseFactor * 12;
                g += noiseFactor * 12;
                b += noiseFactor * 10;
                
                // Clamp and apply
                data[i] = Math.max(0, Math.min(255, r));
                data[i + 1] = Math.max(0, Math.min(255, g));
                data[i + 2] = Math.max(0, Math.min(255, b));
              } else {
                // Enhance contrast for non-concrete surfaces
                data[i] = Math.max(0, Math.min(255, (r - 128) * 1.08 + 128));
                data[i + 1] = Math.max(0, Math.min(255, (g - 128) * 1.08 + 128));
                data[i + 2] = Math.max(0, Math.min(255, (b - 128) * 1.08 + 128));
              }
            }
            
            ctx.putImageData(imageData, 0, 0);
            
            console.log('[Visualize] Concrete material applied successfully');
            
            // Copy the processed image to the display canvas
            var finalDataUrl = processingCanvas.toDataURL('image/png');
            var finalImg = new Image();
            finalImg.onload = function() {
              // Display the result by setting it as background
              var wrap = qs('visualize-canvas-wrap');
              if (wrap) {
                wrap.style.backgroundImage = 'url(' + finalDataUrl + ')';
                wrap.style.backgroundSize = 'cover';
                wrap.style.backgroundPosition = 'center';
                wrap.classList.add('visualize-live-preview');
              }
              
              // Hide the WebGL canvas
              if (renderCanvas) {
                renderCanvas.style.display = 'none';
              }
              
              if (loading) loading.classList.remove('visible');
              console.log('[Visualize] Photorealistic concrete render complete - displaying result');
            };
            finalImg.src = finalDataUrl;
            
          } catch (processingErr) {
            console.error('[Visualize] Error processing screenshot:', processingErr);
            console.error(processingErr.stack);
            if (loading) loading.classList.remove('visible');
          }
        };
        img.onerror = function(err) {
          console.error('[Visualize] Failed to load live screenshot:', err);
          if (loading) loading.classList.remove('visible');
        };
        
        console.log('[Visualize] Starting image load...');
        img.src = liveCapture.shot.previewUrl;
        
        if (loading) {
          loading.classList.remove('visible');
        }
        return;
      }

      ensureRenderer();
      console.log('[Visualize] Renderer ensured');
      
      var useLiveViewportFraming = !!(liveCapture && liveCapture.shot);
      // Sky preset determines exposure for perfect lighting match
      var skyPreset = selectSkyPalette();
      if (renderer) {
        var presetExposure = (skyPreset && typeof skyPreset.exposure === 'number') ? skyPreset.exposure : 1.2;
        var toneExposure = Math.min(1.4, Math.max(0.9, presetExposure * 0.75));
        var qualityBoost = Math.pow(multiplier > 0 ? multiplier : 1, 0.25);
        renderer.toneMappingExposure = toneExposure * qualityBoost;
      }
      try {
        await ensureEnvironment();
        console.log('[Visualize] Environment ensured');
      } catch(envErr){
        console.warn('[Visualize] Environment map unavailable, using procedural fallback', envErr);
      }
      disposeSceneChildren();
      
      // Set sky as background - beautiful blue sky
      // var backgroundTex = createSkyTexture();
      // scene.background = backgroundTex;
      scene.background = new THREE.Color(0xf8fbff);
      console.log('[Visualize] Background set');

      var bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      var boxes = [];
      try {
        boxes = gatherBoxes(snapshot);
        console.log('[Visualize] Boxes gathered', boxes.length);
      } catch(e) { console.error('[Visualize] gatherBoxes failed', e); }

      try {
        boxes.forEach(function(entry){ includeBounds(bounds, entry.box); });
        var primaryStructureEnvelope = computePrimaryStructureEnvelope(boxes);
      } catch(e) { console.error('[Visualize] Envelope computation failed', e); }

      var wallMaterial = materialFor('wall');
      
      // Track if we have any geometry
      var hasGeometry = false;

      console.log('[Visualize] Processing wall strips...');
      try {
        snapshot.wallStrips.forEach(function(strip){
          var mat = wallMaterial.clone();
          // Skip texture assignment to avoid "Texture marked for update but no image data" errors
          // The material already has proper color/roughness/metalness for concrete
          var result = buildWallMesh(strip, mat);
          if (Array.isArray(result.meshes) && result.meshes.length){
            hasGeometry = true;
            result.meshes.forEach(function(mesh){
              var baseOptions = { edgeColor: EDGE_COLORS.wall };
              var overrides = (mesh && mesh.userData) ? mesh.userData.visualizeOpts : null;
              if (overrides) {
                var merged = {};
                var key;
                for (key in baseOptions) merged[key] = baseOptions[key];
                for (key in overrides) {
                  if (Object.prototype.hasOwnProperty.call(overrides, key)) merged[key] = overrides[key];
                }
                registerMesh(mesh, merged);
              } else {
                registerMesh(mesh, baseOptions);
              }
            });
          }
        });
      } catch(e) { console.error('[Visualize] Wall strips processing failed', e); }
      console.log('[Visualize] Wall strips processed');

      console.log('[Visualize] Processing boxes...');
      try {
        boxes.forEach(function(entry){
          var mat = materialFor(entry.kind);
          var mesh = null;
          if (entry.kind === 'room' && entry.room) {
            mesh = buildRoomMeshFromRoom(entry.room, mat);
          }
          if (!mesh) {
            mesh = buildMesh(entry.box, mat);
          }
          if (mesh) {
            hasGeometry = true;
            registerMesh(mesh, { edgeColor: (entry.kind === 'roof' ? EDGE_COLORS.roof : EDGE_COLORS.default) });
            if (entry.kind === 'room') addArchitecturalAccents(entry);
          }
        });
      } catch(e) { console.error('[Visualize] Boxes processing failed', e); }
      console.log('[Visualize] Boxes processed');

      if (!hasGeometry) {
        throw new Error('Nothing to visualize yet. Add rooms or structures first.');
      }

      // Use primary structure envelope (rooms/roofs/etc) for approximate size
      var span = Math.max(3, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
      if (!isFinite(span) || span <= 0) span = 4;

      // Compute actual mesh bounds from the scene so we center the
      // *visible* geometry, not just the abstract project bounds.
      var box3 = new THREE.Box3();
      box3.setFromObject(sceneRoot);
      var meshCenter = new THREE.Vector3();
      box3.getCenter(meshCenter);
      var meshSize = new THREE.Vector3();
      box3.getSize(meshSize);

      if ((meshSize.x || 0) > 0 || (meshSize.z || 0) > 0) {
        var largestSpan = Math.max(0, meshSize.x || 0, meshSize.z || 0);
        if (largestSpan > 0) {
          span = Math.max(3, largestSpan * 1.2);
        }
      }

      var groundY = isFinite(bounds.minY) ? bounds.minY : (isFinite(box3.min.y) ? box3.min.y : 0);

      var centerY = (box3.min.y + box3.max.y) / 2;
      if (!isFinite(centerY)) centerY = floorHeight * 0.5;
      var renderFocus = {
        x: meshCenter.x + VISUALIZE_OFFSET_X,
        y: centerY + VISUALIZE_OFFSET_Y,
        z: meshCenter.z
      };
      renderFocus.x += CAMERA_FOCUS_OFFSET_RIGHT;
      renderFocus.y += CAMERA_FOCUS_OFFSET_UP;
      renderFocus.z += CAMERA_FOCUS_OFFSET_FORWARD;

      var livePreset = null;
      var shouldCenterScene = !useLiveViewportFraming;
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('STEP 1: CAMERA SETUP');
      console.log('  useLiveViewportFraming:', useLiveViewportFraming);
      console.log('  shouldCenterScene:', shouldCenterScene);
      console.log('  meshCenter:', meshCenter);
      console.log('  meshSize:', meshSize);
      console.log('  Live camera from viewport:', window.camera);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // ALWAYS keep geometry in world coordinates - DON'T MOVE IT
      // The camera will position itself to view the geometry
      console.log('STEP 2: Geometry kept in world coordinates (NO RECENTERING)');
      console.log('  sceneRoot.position stays at:', sceneRoot.position);
      
      if (window && window.camera) {
        livePreset = captureLiveOrbitPreset(span, meshCenter, meshSize, renderFocus, { recenter: false, pullbackRatio: RENDER_CAMERA_PULLBACK });
        console.log('  Live preset captured:', livePreset);
        if (livePreset && livePreset.target) {
          renderFocus.x = livePreset.target.x;
          renderFocus.y = livePreset.target.y;
          renderFocus.z = livePreset.target.z;
          console.log('  Updated renderFocus to:', renderFocus);
        }
      }

      syncLivePanTransform(false);

      console.log('[Visualize] Building ground...');
      try {
        // Ground and shadow centered under the geometry
        var groundCenterX = shouldCenterScene ? 0 : meshCenter.x;
        var groundCenterZ = shouldCenterScene ? 0 : meshCenter.z;
        buildGround(null, groundCenterX, groundCenterZ, groundY, span);
        console.log('[Visualize] Ground built');
        createContactShadow(groundCenterX, groundCenterZ, span, groundY);
      } catch(e) { console.error('[Visualize] Ground building failed', e); }

      // Camera Focus Point: start at the visual center of the geometry
      // and apply small manual offsets so you can fine-tune where the
      // model appears relative to the grid (e.g. B2).

      // Log snapshot data for debugging
      console.log('[Visualize] Snapshot data:', {
        rooms: snapshot.rooms.length,
        wallStrips: snapshot.wallStrips.length,
        renderFocus: renderFocus,
        meshCenter: meshCenter
      });
      // Note: Removed addSignatureFacade - only render user's actual design
      try {
        // Use actual mesh center for camera presets - NOT recentered
        var presetCenterX = meshCenter.x;
        var presetCenterZ = meshCenter.z;
        console.log('[Visualize] Building view presets around mesh center:', presetCenterX, presetCenterZ);
        VIEW_PRESETS = buildViewPresets(presetCenterX, renderFocus.y, presetCenterZ, span, bounds, renderFocus) || [];
        if (!Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) {
          VIEW_PRESETS = buildViewPresets(presetCenterX, renderFocus.y, presetCenterZ, span || 8, bounds, renderFocus) || [];
        }
        if (!Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) {
          VIEW_PRESETS = [{
            position: new THREE.Vector3(presetCenterX + span * 1.25, renderFocus.y + span * 0.65, presetCenterZ + span * 1.05),
            target: new THREE.Vector3(presetCenterX, renderFocus.y, presetCenterZ),
            up: new THREE.Vector3(0, 1, 0),
            fov: 48,
            near: 0.05,
            far: Math.max(400, span * 6)
          }];
        }
        if (livePreset) {
          var presetClone = clonePreset(livePreset) || livePreset;
          VIEW_PRESETS.unshift(presetClone);
          viewIndex = 0;
        }
        if (viewIndex >= VIEW_PRESETS.length) viewIndex = VIEW_PRESETS.length - 1;
        if (viewIndex < 0) viewIndex = 0;
        applyCameraPreset(viewIndex);
      } catch(e) { console.error('[Visualize] Camera setup failed', e); }

      try {
        setupLighting(presetCenterX, renderFocus.y, presetCenterZ, span);
        console.log('[Visualize] Lighting setup');
      } catch(e) { console.error('[Visualize] Lighting setup failed', e); }

      try {
        injectDebugMarkers(sceneRoot, renderFocus);
      } catch(e) { console.warn('[Visualize] Debug markers failed', e); }

      var canvas = qs(CANVAS_ID);
      if (canvas) {
        var baseCanvasEl = document.getElementById('canvas');
        var stage = qs('visualize-stage');
        var baseRect = baseCanvasEl && baseCanvasEl.getBoundingClientRect ? baseCanvasEl.getBoundingClientRect() : null;
        var cssWidth = baseRect && baseRect.width > 0 ? baseRect.width : (stage && stage.clientWidth ? stage.clientWidth : window.innerWidth || 1920);
        var cssHeight = baseRect && baseRect.height > 0 ? baseRect.height : (stage && stage.clientHeight ? stage.clientHeight : window.innerHeight || 1080);
        lastCanvasCssWidth = cssWidth;
        lastCanvasCssHeight = cssHeight;
        var dpr = window.devicePixelRatio || 1;
        var backingWidth = baseCanvasEl && baseCanvasEl.width ? baseCanvasEl.width : Math.round(cssWidth * dpr);
        var backingHeight = baseCanvasEl && baseCanvasEl.height ? baseCanvasEl.height : Math.round(cssHeight * dpr);
        if (!isFiniteNumber(backingWidth) || backingWidth <= 0) backingWidth = Math.round(cssWidth * dpr) || 1920;
        if (!isFiniteNumber(backingHeight) || backingHeight <= 0) backingHeight = Math.round(cssHeight * dpr) || 1080;

        var qualityScale = Math.max(1, multiplier);
        if (qualityScale > 2.5) qualityScale = 2.5;
        var width = Math.max(1, Math.round(backingWidth * qualityScale));
        var height = Math.max(1, Math.round(backingHeight * qualityScale));

        var liveCameraState = null;
        if (useLiveViewportFraming && liveViewportProfile) {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('STEP 3: Applying COMPLETE viewport profile to camera');
          var profileApplied = applyViewportProfileToCamera(liveViewportProfile);
          console.log('  Profile applied:', profileApplied);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }
        if (liveViewportProfile && liveViewportProfile.canvas) {
          cssWidth = liveViewportProfile.canvas.cssWidth;
          cssHeight = liveViewportProfile.canvas.cssHeight;
        }
        lastCanvasCssWidth = cssWidth;
        lastCanvasCssHeight = cssHeight;
        
        // DON'T override aspect ratio - it was set correctly by applyViewportProfileToCamera
        if (!useLiveViewportFraming || !liveViewportProfile) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        }
        
        // Profile already applied the projection in applyViewportProfileToCamera
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('STEP 4: Camera fully configured from profile');
        console.log('  Final camera position:', camera.position.toArray());
        console.log('  Final camera FOV:', camera.fov);
        console.log('  Final aspect ratio:', camera.aspect.toFixed(3));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        renderer.setSize(width, height, false);
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = cssHeight + 'px';
        lastCanvasWidth = width;
        lastCanvasHeight = height;
        var stageMetrics = { width: cssWidth, height: cssHeight };
        
        // Multi-pass rendering for maximum quality and sharpness
        if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
        
        // Clear with precision
        renderer.clear(true, true, true);

        // Render scene with cinematic post-processing stack
        console.log('[Visualize] Rendering scene...');
        try {
          renderSceneWithPostFX(width, height);
          console.log('[Visualize] Scene rendered');
        } catch(e) { console.error('[Visualize] Render scene failed', e); renderer.render(scene, camera); }
        
        // Force texture updates for maximum sharpness
        scene.traverse(function(obj) {
          if (obj.material) {
            if (obj.material.map) obj.material.map.needsUpdate = true;
            if (obj.material.normalMap) obj.material.normalMap.needsUpdate = true;
            if (obj.material.roughnessMap) obj.material.roughnessMap.needsUpdate = true;
          }
        });
        
        ensureFabric(width, height);
        ensureResizeListener();
        fitRenderToStage();
        window.requestAnimationFrame(fitRenderToStage);
        updateAlignmentGrid(cssWidth, cssHeight);
        window.requestAnimationFrame(function(){ updateAlignmentGrid(cssWidth, cssHeight); });
        addDefaultLabel();
        tileRevealPromise = animateRenderReveal(canvas, stageMetrics, {
          tileSize: TILE_REVEAL_SIZE,
          delay: 28,
          onComplete: function(){
            if (previewPrimed && !previewCleared) {
              clearLivePreview();
              previewCleared = true;
            }
          }
        });
        if (!tileRevealPromise && previewPrimed && !previewCleared) {
          clearLivePreview();
          previewCleared = true;
        }
      }
      if (loading) loading.textContent = 'Capturing design views...';
      await populateDesignGallery({ loadingEl: loading });
      lastHash = hash;
      var footnote = qs(FOOTNOTE_ID);
      if (footnote) footnote.textContent = formatFootnote(bounds);
    } catch(err){
      console.error('[Visualize] render failed', err);
      shouldHideLoading = false;
      if (loading) {
        var message = err && err.message ? err.message : 'Render failed';
        loading.textContent = message;
        loading.classList.add('visible');
        window.setTimeout(function(){
          if (!loading) return;
          loading.textContent = 'Generating...';
          loading.classList.remove('visible');
        }, 2400);
      }
      updateGalleryGrid(err && err.message ? err.message : 'Unable to generate design images.');
      try { if (window.updateStatus) window.updateStatus('Visualize failed: ' + err.message); } catch(_s){}
    } finally {
      if (shouldHideLoading && previewPrimed && !previewCleared && !tileOverlayCanvas) {
        clearLivePreview();
        previewCleared = true;
      }
      if (shouldHideLoading && loading) {
        loading.textContent = 'Generating...';
        loading.classList.remove('visible');
      }
    }
  }

  function exportImage(){
    var canvas = renderer && renderer.domElement ? renderer.domElement : null;
    if (!canvas) {
      var dataUrlFallback = lastLiveViewportDataUrl;
      if (!dataUrlFallback) {
        var renderCanvas = qs(CANVAS_ID);
        if (renderCanvas && typeof renderCanvas.toDataURL === 'function') {
          try { dataUrlFallback = renderCanvas.toDataURL('image/png'); } catch(_exportErr){ dataUrlFallback = null; }
        }
      }
      if (!dataUrlFallback) {
        console.warn('[Visualize] No captured image available to export.');
        return;
      }
      var fallbackLink = document.createElement('a');
      fallbackLink.download = 'gablok-visualize-' + Date.now() + '.png';
      fallbackLink.href = dataUrlFallback;
      fallbackLink.click();
      return;
    }
    
    // Export at full resolution with maximum quality
    var exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    var ctx = exportCanvas.getContext('2d', { 
      alpha: false,
      desynchronized: false,
      willReadFrequently: false
    });
    
    // Enable image smoothing for high quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.drawImage(canvas, 0, 0);
    if (fabricCanvas) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
      ctx.drawImage(fabricCanvas.getElement(), 0, 0);
    }
    
    var link = document.createElement('a');
    link.download = 'gablok-visualize-' + Date.now() + '.png';
    // Maximum PNG quality
    link.href = exportCanvas.toDataURL('image/png', 1.0);
    link.click();
  }

  function onAddLabel(){
    if (!fabricCanvas) return;
    var text = new fabric.IText('New note', {
      left: 40,
      top: 40,
      fontSize: 32,
      fill: '#1e293b',
      fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif'
    });
    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
    fabricCanvas.requestRenderAll();
  }

  function ensureEvents(){
    setupViewButtons();
    var closeBtn = qs('visualize-close');
    if (closeBtn && !closeBtn.__wired){
      closeBtn.__wired = true;
      closeBtn.addEventListener('click', hideVisualize);
    }
    var backdrop = qs('visualize-backdrop');
    if (backdrop && !backdrop.__wired){
      backdrop.__wired = true;
      backdrop.addEventListener('click', hideVisualize);
    }
    var generate = qs('visualize-generate');
    if (generate && !generate.__wired){
      generate.__wired = true;
      generate.addEventListener('click', function(){ startVisualizeRender(); });
    }
    var qualitySelect = qs(QUALITY_ID);
    if (qualitySelect && !qualitySelect.__wired){
      qualitySelect.__wired = true;
      qualitySelect.addEventListener('change', function(){ startVisualizeRender(); });
    }
    var downloadBtn = qs('visualize-download');
    if (downloadBtn && !downloadBtn.__wired){
      downloadBtn.__wired = true;
      downloadBtn.addEventListener('click', exportImage);
    }
    var gridBtn = qs('visualize-toggle-grid');
    if (gridBtn && !gridBtn.__wired){
      gridBtn.__wired = true;
      gridBtn.addEventListener('click', toggleAlignmentGrid);
    }
    var photorealBtn = qs('visualize-photoreal');
    if (photorealBtn && !photorealBtn.__wired){
      photorealBtn.__wired = true;
      photorealBtn.addEventListener('click', requestPhotorealRender);
    }
    var addLabelBtn = qs('visualize-add-label');
    if (addLabelBtn && !addLabelBtn.__wired){
      addLabelBtn.__wired = true;
      addLabelBtn.addEventListener('click', onAddLabel);
    }
    var gallery = qs('visualize-gallery');
    if (gallery && !gallery.__wired){
      gallery.__wired = true;
      gallery.addEventListener('click', function(ev){
        var target = ev.target;
        if (!target) return;
        var btn = target.closest('button[data-gallery-id]');
        if (!btn) return;
        var id = btn.getAttribute('data-gallery-id');
        if (!id) return;
        openPhotoViewerById(id);
      });
    }
    var photoClose = qs('visualize-photo-close');
    if (photoClose && !photoClose.__wired){
      photoClose.__wired = true;
      photoClose.addEventListener('click', function(){ closePhotoViewer(); });
    }
    var photoViewer = qs('visualize-photo-viewer');
    if (photoViewer && !photoViewer.__wired){
      photoViewer.__wired = true;
      photoViewer.addEventListener('click', function(ev){
        if (ev.target === photoViewer) closePhotoViewer();
      });
    }
    if (!window.__visualizeEscWired) {
      window.__visualizeEscWired = true;
      document.addEventListener('keydown', function(ev){
        if (ev.key === 'Escape') {
          var viewer = qs('visualize-photo-viewer');
          if (viewer && viewer.classList.contains('visible')) {
            closePhotoViewer();
            ev.preventDefault();
            return;
          }
          var modal = qs(PANEL_ID);
          if (modal && modal.classList.contains('visible')) hideVisualize();
        }
      });
    }
    syncViewButtons();
    syncAlignmentGridButton();
  }

  function startVisualizeRender(){
    return ensureLibraries()
      .then(function(){
        ensureRenderer();
        return renderSnapshot();
      })
      .catch(handleVisualizeError);
  }

  function showVisualize(){
    var modal = qs(PANEL_ID);
    if (!modal) return;
    viewIndex = 0;
    modal.classList.add('visible');
    try { document.body.classList.add('visualize-active'); } catch(_b){}
    closePhotoViewer();
    setGalleryShots([]);
    updateGalleryGrid('Generating design images...');
    setPhotorealStatus('');
    ensureEvents();
    window.requestAnimationFrame(fitRenderToStage);
    startVisualizeRender();
  }

  function hideVisualize(){
    var modal = qs(PANEL_ID);
    if (modal) modal.classList.remove('visible');
    try { document.body.classList.remove('visualize-active'); } catch(_b){}
    closePhotoViewer();
    resetTileReveal();
    clearLivePreview();
    syncLivePanTransform(true);
    if (fabricCanvas) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
    }
  }

  window.showVisualize = showVisualize;
  window.hideVisualize = hideVisualize;

}());
