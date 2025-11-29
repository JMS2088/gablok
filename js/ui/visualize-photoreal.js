/**
 * @file visualize-photoreal.js
 * @description Photorealistic 3D rendering using Three.js PBR materials
 * @version 2.1.0 - Fresh render on each open, updated 2025
 * 
 * Auto-renders the 3D viewport with photorealistic materials when panel opens.
 * Uses MeshPhysicalMaterial for accurate PBR rendering with proper lighting.
 */
(function(){
  if (typeof window === 'undefined') return;

  var THREE = window.THREE;
  var PANEL_ID = 'visualize-modal';
  var STAGE_ID = 'visualize-stage';
  var WRAP_ID = 'visualize-canvas-wrap';
  var SOURCE_CANVAS_ID = 'canvas';
  var RENDER_CANVAS_ID = 'visualize-render-canvas';
  var STATUS_ID = 'visualize-capture-status';
  var LOADING_ID = 'visualize-loading';
  var FOOTNOTE_ID = 'visualize-footnote';
  var GALLERY_ID = 'visualize-gallery';
  var DOWNLOAD_BUTTON_ID = 'visualize-download';
  var GENERATE_BUTTON_ID = 'visualize-generate';
  var CLOSE_BUTTON_ID = 'visualize-close';
  var BACKDROP_ID = 'visualize-backdrop';
  var PHOTO_VIEWER_ID = 'visualize-photo-viewer';
  var PHOTO_IMG_ID = 'visualize-photo-image';
  var PHOTO_CAPTION_ID = 'visualize-photo-caption';
  var PHOTO_CLOSE_ID = 'visualize-photo-close';

  // Photorealistic PBR material palette
  var MATERIAL_PALETTE = {
    // Concrete surfaces (walls, rooms)
    concrete: {
      color: 0xd8d8ce,        // Warm light gray
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.75
    },
    // Exterior concrete massing
    wall: {
      color: 0x6d7075,        // Darker architectural concrete
      roughness: 0.92,
      metalness: 0.02,
      envMapIntensity: 0.85
    },
    // Glass surfaces
    glass: {
      color: 0xffffff,
      roughness: 0.0,
      metalness: 0.1,
      transmission: 0.98,
      thickness: 0.5,
      ior: 1.52,
      clearcoat: 1.0
    },
    // Pool water
    pool: {
      color: 0x2090D0,
      roughness: 0.02,
      metalness: 0.1,
      transmission: 0.95,
      thickness: 2.0,
      ior: 1.33,
      clearcoat: 1.0
    },
    // Dark slate roof
    roof: {
      color: 0x222222,
      roughness: 0.9,
      metalness: 0.1,
      envMapIntensity: 0.5
    },
    // Ground/path - very light grey studio floor
    ground: {
      color: 0xe8eaec,        // Very light grey
      roughness: 0.7,
      metalness: 0.0,
      envMapIntensity: 0.3
    }
  };

  // Architectural lighting presets
  var LIGHTING_PRESETS = [
    { name: 'Golden Hour', sunColor: 0xffeedd, intensity: 1.8, angle: 15, warmth: 0.15 },
    { name: 'Midday', sunColor: 0xffffff, intensity: 2.2, angle: 60, warmth: 0.02 },
    { name: 'Overcast', sunColor: 0xe8f0f8, intensity: 1.2, angle: 45, warmth: -0.03 },
    { name: 'Studio', sunColor: 0xffffff, intensity: 1.6, angle: 35, warmth: 0.0 }
  ];

  // Three.js renderer state
  var renderer = null;
  var scene = null;
  var camera = null;
  var sceneRoot = null;
  var lights = [];
  var pmremGenerator = null;
  var envRT = null;

  // =========================================================================
  // CAMERA TRACKING SYSTEM
  // Captures all camera parameters from 3D viewport for exact render matching
  // =========================================================================
  var cameraTracker = {
    // Position in world space
    x: 0,
    y: 0,
    z: 0,
    // Orientation angles (radians)
    yaw: 0,      // Rotation around Y axis (left-right)
    pitch: 0,    // Rotation around X axis (up-down)
    roll: 0,     // Rotation around Z axis (tilt) - usually 0
    // Camera parameters
    distance: 10,
    fov: 50,
    // Target point camera looks at
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    // Projection parameters from 3D area
    projScale: 500,
    perspectiveStrength: 0.88,
    
    // Capture current camera state from 3D viewport
    capture: function() {
      var mainCam = window.camera || {};
      var proj = window.__proj || {};
      
      // Get orientation from camera object
      this.yaw = (typeof mainCam.yaw === 'number') ? mainCam.yaw : 0.65;
      this.pitch = (typeof mainCam.pitch === 'number') ? mainCam.pitch : -0.55;
      this.roll = 0;  // No roll in the 3D viewport
      this.distance = (typeof mainCam.distance === 'number') ? mainCam.distance : 10;
      
      // Get target position
      this.targetX = (typeof mainCam.targetX === 'number') ? mainCam.targetX : 0;
      this.targetY = (typeof mainCam.targetY === 'number') ? mainCam.targetY : 0;
      this.targetZ = (typeof mainCam.targetZ === 'number') ? mainCam.targetZ : 0;
      
      // Get actual camera position from projection cache
      if (proj.cam && proj.cam.length === 3) {
        this.x = proj.cam[0];
        this.y = proj.cam[1];
        this.z = proj.cam[2];
      } else {
        // Calculate from yaw/pitch/distance if not available
        var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
        this.x = this.targetX - sy * cp * this.distance;
        this.y = this.targetY - sp * this.distance;
        this.z = this.targetZ - cy * cp * this.distance;
      }
      
      // Get projection parameters
      this.projScale = (proj.scale && proj.scale > 0) ? proj.scale : 500;
      this.perspectiveStrength = (typeof proj.perspectiveStrength === 'number') ? proj.perspectiveStrength : 0.88;
      
      // Calculate FOV from projScale
      var dpr = window.devicePixelRatio || 1;
      var canvasHeight = (window.canvas && window.canvas.height) ? window.canvas.height / dpr : 800;
      var tanHalfFov = canvasHeight / (2 * this.projScale);
      this.fov = 2 * Math.atan(tanHalfFov) * (180 / Math.PI);
      
      console.log('[CameraTracker] Captured camera state:', this.toString());
      return this;
    },
    
    // Get a formatted string of all camera parameters
    toString: function() {
      return JSON.stringify({
        position: { x: this.x.toFixed(3), y: this.y.toFixed(3), z: this.z.toFixed(3) },
        orientation: { 
          yaw: (this.yaw * 180 / Math.PI).toFixed(1) + '°', 
          pitch: (this.pitch * 180 / Math.PI).toFixed(1) + '°',
          roll: (this.roll * 180 / Math.PI).toFixed(1) + '°'
        },
        target: { x: this.targetX.toFixed(3), y: this.targetY.toFixed(3), z: this.targetZ.toFixed(3) },
        distance: this.distance.toFixed(2),
        fov: this.fov.toFixed(1) + '°',
        projScale: this.projScale.toFixed(1)
      }, null, 2);
    },
    
    // Apply captured camera to Three.js camera with adjustments for render matching
    applyToRenderCamera: function(threeCamera, bounds, renderWidth, renderHeight) {
      if (!threeCamera || !THREE) return;
      
      // Use the CAPTURED camera target, not the scene bounds center!
      // This ensures we look at the same point as the 3D viewport
      var centerX = this.targetX;
      var centerY = this.targetY;
      var centerZ = this.targetZ;
      
      // Get scene dimensions for distance calculation only
      var sceneWidth = bounds.width || 10;
      var sceneDepth = bounds.depth || 10;
      var sceneHeight = bounds.height || 3;
      
      // Calculate distance that ensures entire scene is visible
      // Use scene diagonal for better framing of multi-room layouts
      var sceneDiagonal = Math.sqrt(sceneWidth * sceneWidth + sceneDepth * sceneDepth);
      
      // Base distance on scene size - ensure camera is far enough to see everything
      var baseFov = 55; // degrees
      var fovRad = baseFov * Math.PI / 180;
      
      // Distance needed to fit scene in view (using FOV geometry)
      var requiredDist = (sceneDiagonal / 2) / Math.tan(fovRad / 2);
      
      // Only enforce minimum distance if user is zoomed in too close
      // But keep the camera at a similar relative position to what the user set
      // Scale factor: how much the photoreal view needs to zoom out vs 3D view
      var minDist = requiredDist * 1.2; // Reduced from 1.5 - less aggressive padding
      
      // Use user's actual distance, but scale proportionally if we need to zoom out
      var viewDist = this.distance;
      if (viewDist < minDist) {
        viewDist = minDist;
      }
      
      // Use the EXACT same math as engine3d.js for camera positioning
      // This matches the 3D viewport exactly
      var yaw = this.yaw;
      var pitch = this.pitch;
      
      var cy = Math.cos(yaw);
      var sy = Math.sin(yaw);
      var cp = Math.cos(pitch);
      var sp = Math.sin(pitch);
      
      // Forward direction - EXACTLY as in engine3d.js: fwd = [sy*cp, sp, cy*cp]
      var fwdX = sy * cp;
      var fwdY = sp;
      var fwdZ = cy * cp;
      
      // Camera position = target - forward * distance (same as engine3d.js)
      var verticalScale = (fwdY < 0) ? 0.6 : 1.0; // Match engine3d.js vertical dampening
      var camX = centerX - fwdX * viewDist;
      var camY = centerY - fwdY * viewDist * verticalScale;
      var camZ = centerZ - fwdZ * viewDist;
      
      // Ensure camera is above ground
      camY = Math.max(sceneHeight * 0.3, camY);
      
      // Since sceneRoot has scale.x = -1, we need to negate camera X and lookAt X
      // to view the mirrored scene correctly
      var mirrorCamX = -camX;
      var mirrorLookX = -centerX;
      
      // Set camera position
      threeCamera.position.set(mirrorCamX, camY, camZ);
      
      // Look at scene center (also mirrored on X)
      threeCamera.up.set(0, 1, 0);
      threeCamera.lookAt(mirrorLookX, centerY, centerZ);
      
      // Calculate FOV based on distance
      var baseFov = 55;
      if (this.distance < 10) baseFov = 45;
      else if (this.distance > 50) baseFov = 65;
      threeCamera.fov = baseFov;
      
      // Update aspect ratio and projection
      var aspect = renderWidth / renderHeight;
      threeCamera.aspect = aspect;
      threeCamera.updateProjectionMatrix();
      
      // Clear any previous view offset
      threeCamera.clearViewOffset();
      
      console.log('[CameraTracker] Camera setup:', {
        camPos: '(' + mirrorCamX.toFixed(2) + ', ' + camY.toFixed(2) + ', ' + camZ.toFixed(2) + ')',
        lookAt: '(' + mirrorLookX.toFixed(2) + ', ' + centerY.toFixed(2) + ', ' + centerZ.toFixed(2) + ')',
        viewDist: viewDist.toFixed(2),
        yaw: (yaw * 180 / Math.PI).toFixed(1) + '°',
        pitch: (pitch * 180 / Math.PI).toFixed(1) + '°',
        aspect: aspect.toFixed(2),
        fov: threeCamera.fov.toFixed(1) + '°'
      });
    }
  };
  
  // Export camera tracker for debugging
  window.cameraTracker = cameraTracker;

  // =========================================================================
  // AUTO-UPDATE SYSTEM
  // Watches for changes in the 3D scene and triggers debounced re-render
  // =========================================================================
  var autoUpdateDebounceTimer = null;
  var AUTO_UPDATE_DELAY = 500; // ms delay before re-rendering after changes
  var lastSceneHash = '';
  
  function computeSceneHash() {
    // Create a hash of all scene data to detect changes
    var parts = [];
    
    // Rooms
    if (Array.isArray(window.allRooms)) {
      window.allRooms.forEach(function(r) {
        parts.push('R:' + r.id + ':' + r.x + ',' + r.z + ',' + r.width + ',' + r.depth + ',' + r.level);
      });
    }
    
    // Walls
    if (Array.isArray(window.wallStrips)) {
      window.wallStrips.forEach(function(w, i) {
        parts.push('W:' + i + ':' + (w.x0||0) + ',' + (w.z0||0) + '-' + (w.x1||0) + ',' + (w.z1||0));
      });
    }
    
    // Garages
    if (Array.isArray(window.garageComponents)) {
      window.garageComponents.forEach(function(g) {
        parts.push('G:' + g.id + ':' + (g.x||0) + ',' + (g.z||0) + ',' + (g.width||0) + ',' + (g.depth||0));
      });
    }
    
    // Pergolas
    if (Array.isArray(window.pergolaComponents)) {
      window.pergolaComponents.forEach(function(p) {
        parts.push('P:' + p.id + ':' + (p.x||0) + ',' + (p.z||0) + ',' + (p.width||0) + ',' + (p.depth||0));
      });
    }
    
    // Pools
    if (Array.isArray(window.poolComponents)) {
      window.poolComponents.forEach(function(p) {
        parts.push('PL:' + p.id + ':' + (p.x||0) + ',' + (p.z||0) + ',' + (p.width||0) + ',' + (p.depth||0));
      });
    }
    
    // Roofs
    if (Array.isArray(window.roofComponents)) {
      window.roofComponents.forEach(function(r) {
        parts.push('RF:' + r.id + ':' + (r.x||0) + ',' + (r.z||0) + ',' + (r.width||0) + ',' + (r.depth||0));
      });
    }
    
    // Balconies
    if (Array.isArray(window.balconyComponents)) {
      window.balconyComponents.forEach(function(b) {
        parts.push('B:' + b.id + ':' + (b.x||0) + ',' + (b.z||0));
      });
    }
    
    // Stairs
    if (Array.isArray(window.stairsComponents)) {
      window.stairsComponents.forEach(function(s) {
        parts.push('S:' + s.id + ':' + (s.x||0) + ',' + (s.z||0));
      });
    }
    
    // Camera state
    if (window.camera) {
      parts.push('CAM:' + Math.round(window.camera.yaw * 100) + ',' + Math.round(window.camera.pitch * 100) + ',' + Math.round(window.camera.distance));
    }
    
    return parts.join('|');
  }
  
  function checkForSceneChanges() {
    if (!state.panel || !state.panel.classList.contains('visible')) return;
    if (state.busy) return;
    
    var currentHash = computeSceneHash();
    if (currentHash !== lastSceneHash) {
      console.log('[Photoreal] Scene change detected, scheduling re-render');
      lastSceneHash = currentHash;
      
      // Clear previous timer
      if (autoUpdateDebounceTimer) {
        clearTimeout(autoUpdateDebounceTimer);
      }
      
      // Schedule new render
      autoUpdateDebounceTimer = setTimeout(function() {
        if (state.panel && state.panel.classList.contains('visible') && !state.busy) {
          console.log('[Photoreal] Auto-updating render due to scene changes');
          startPhotorealisticRender();
        }
      }, AUTO_UPDATE_DELAY);
    }
  }
  
  // Poll for changes when panel is open (more reliable than trying to hook all change points)
  var sceneWatcherInterval = null;
  
  function startSceneWatcher() {
    if (sceneWatcherInterval) return;
    lastSceneHash = computeSceneHash();
    sceneWatcherInterval = setInterval(checkForSceneChanges, 200); // Check 5 times per second
    console.log('[Photoreal] Scene watcher started');
  }
  
  function stopSceneWatcher() {
    if (sceneWatcherInterval) {
      clearInterval(sceneWatcherInterval);
      sceneWatcherInterval = null;
      console.log('[Photoreal] Scene watcher stopped');
    }
    if (autoUpdateDebounceTimer) {
      clearTimeout(autoUpdateDebounceTimer);
      autoUpdateDebounceTimer = null;
    }
  }

  var state = {
    initialized: false,
    panel: null,
    stage: null,
    wrap: null,
    renderCanvas: null,
    loading: null,
    statusEl: null,
    footnoteEl: null,
    downloadButton: null,
    generateButton: null,
    galleryEl: null,
    photoViewer: null,
    photoImg: null,
    photoCaption: null,
    lastRender: null,
    busy: false,
    shots: [],
    shotCounter: 0,
    currentLighting: 0,
    renderStarted: false
  };

  function init(){
    if (state.initialized) return;
    state.panel = document.getElementById(PANEL_ID);
    state.stage = document.getElementById(STAGE_ID);
    state.wrap = document.getElementById(WRAP_ID);
    state.renderCanvas = document.getElementById(RENDER_CANVAS_ID);
    state.loading = document.getElementById(LOADING_ID);
    state.statusEl = document.getElementById(STATUS_ID);
    state.footnoteEl = document.getElementById(FOOTNOTE_ID);
    state.downloadButton = document.getElementById(DOWNLOAD_BUTTON_ID);
    state.generateButton = document.getElementById(GENERATE_BUTTON_ID);
    state.galleryEl = document.getElementById(GALLERY_ID);
    state.photoViewer = document.getElementById(PHOTO_VIEWER_ID);
    state.photoImg = document.getElementById(PHOTO_IMG_ID);
    state.photoCaption = document.getElementById(PHOTO_CAPTION_ID);

    wireButtons();
    renderGallery();
    state.initialized = true;
  }

  function wireButtons(){
    // Generate button now manually triggers additional render if needed
    if (state.generateButton) {
      state.generateButton.addEventListener('click', function(){ startPhotorealisticRender(); });
    }
    if (state.downloadButton) {
      state.downloadButton.addEventListener('click', downloadCurrent);
      state.downloadButton.disabled = true;
    }
    var closeBtn = document.getElementById(CLOSE_BUTTON_ID);
    if (closeBtn) closeBtn.addEventListener('click', hideVisualize);
    var backdrop = document.getElementById(BACKDROP_ID);
    if (backdrop) backdrop.addEventListener('click', hideVisualize);
    var photoClose = document.getElementById(PHOTO_CLOSE_ID);
    if (photoClose) photoClose.addEventListener('click', closePhotoViewer);
    if (state.photoViewer) {
      state.photoViewer.addEventListener('click', function(ev){ if (ev.target === state.photoViewer) closePhotoViewer(); });
    }
  }

  function showVisualize(){
    console.log('[Photoreal] showVisualize() called');
    init();
    if (!state.panel) return;
    
    // If panel is already visible, force a new render immediately
    var wasAlreadyVisible = state.panel.classList.contains('visible');
    
    state.panel.classList.add('visible');
    document.body.classList.add('visualize-open');
    
    // ALWAYS reset and trigger fresh render
    state.renderStarted = false;
    state.busy = false; // Reset busy state to allow re-render
    setStatus('Initializing photorealistic renderer…', 'info');
    
    // Start watching for scene changes
    startSceneWatcher();
    
    if (wasAlreadyVisible) {
      // Panel already open - start render immediately
      console.log('[Photoreal] Panel already visible, triggering immediate fresh render');
      startPhotorealisticRender();
    } else {
      // Start render after a brief delay for panel animation
      setTimeout(function(){
        if (state.panel && state.panel.classList.contains('visible') && !state.renderStarted) {
          startPhotorealisticRender();
        }
      }, 100);
    }
  }

  function hideVisualize(){
    if (!state.panel) return;
    
    // Stop watching for scene changes
    stopSceneWatcher();
    
    state.panel.classList.remove('visible');
    document.body.classList.remove('visualize-open');
    state.renderStarted = false;
    closePhotoViewer();
    disposeRenderer();
  }

  function setStatus(message, mode){
    if (!state.statusEl) return;
    state.statusEl.textContent = message || '';
    state.statusEl.classList.remove('live', 'fallback', 'error', 'info');
    if (mode) state.statusEl.classList.add(mode);
  }

  function setLoading(visible, label){
    if (!state.loading) return;
    if (label) state.loading.textContent = label;
    state.loading.classList.toggle('visible', !!visible);
  }

  function setBusy(flag){
    state.busy = !!flag;
    if (state.generateButton) state.generateButton.disabled = flag;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THREE.JS PHOTOREALISTIC RENDERING PIPELINE
  // ─────────────────────────────────────────────────────────────────────────

  function ensureThreeJS(){
    return new Promise(function(resolve, reject){
      if (window.THREE) {
        THREE = window.THREE;
        resolve();
        return;
      }
      // Try to load Three.js
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js';
      script.onload = function(){
        THREE = window.THREE;
        resolve();
      };
      script.onerror = function(){
        reject(new Error('Failed to load Three.js'));
      };
      document.head.appendChild(script);
    });
  }

  function ensureRenderer(){
    if (!THREE) throw new Error('Three.js not loaded');
    
    var canvas = state.renderCanvas;
    if (!canvas) throw new Error('Render canvas not found');

    console.log('[Photoreal] ensureRenderer: setting up WebGL renderer');

    // Always dispose and recreate renderer for fresh state
    if (renderer) {
      try { 
        renderer.dispose(); 
        console.log('[Photoreal] Disposed old renderer');
      } catch(e){}
      renderer = null;
    }

    // Create new WebGL renderer with photorealistic settings
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: 'high-performance'
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf0f4f8, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Enable shadows for realistic lighting
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;

    return renderer;
  }

  function ensureScene(){
    if (!THREE) throw new Error('Three.js not loaded');
    
    console.log('[Photoreal] ensureScene: rebuilding scene from scratch');
    
    // Dispose old scene completely if exists
    if (scene) {
      // Remove all children from scene
      while (scene.children.length > 0) {
        var child = scene.children[0];
        scene.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(function(m){ if (m.dispose) m.dispose(); });
          } else if (child.material.dispose) {
            child.material.dispose();
          }
        }
      }
    }
    
    // Create fresh scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    
    // Create fresh scene root
    // Mirror on X axis to match engine3d.js coordinate handedness
    // (engine3d uses left-handed coordinates, Three.js uses right-handed)
    sceneRoot = new THREE.Group();
    sceneRoot.name = 'PhotorealSceneRoot';
    sceneRoot.scale.x = -1;
    scene.add(sceneRoot);
    
    // Clear lights array for fresh lighting setup
    lights = [];
    
    return scene;
  }

  function ensureCamera(width, height, bounds){
    if (!THREE) throw new Error('Three.js not loaded');
    
    console.log('[Photoreal] ========== CAMERA SETUP ==========');
    console.log('[Photoreal] Render canvas size:', width, 'x', height);
    console.log('[Photoreal] Scene bounds:', JSON.stringify(bounds));
    
    // Capture current camera state from 3D viewport
    cameraTracker.capture();
    
    // Dispose old camera if exists
    if (camera) {
      camera = null;
    }
    
    // =========================================================================
    // Create Three.js camera and apply tracked camera state
    // =========================================================================
    
    var aspect = width / height;
    var fov = Math.max(25, Math.min(90, cameraTracker.fov * 5.0));  // FOV multiplier for perspective
    var near = 0.1;
    var far = 1000;
    
    camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    
    // Apply camera position and orientation from tracker
    cameraTracker.applyToRenderCamera(camera, bounds, width, height);
    
    console.log('[Photoreal] Camera setup complete using tracker');

    return camera;
  }
  
  // =========================================================================
  // Old camera code removed - now using cameraTracker
  // =========================================================================
  
  function disposeRenderer(){
    // Clear lights
    lights.forEach(function(light){
      if (light && light.parent) light.parent.remove(light);
      if (light && light.dispose) light.dispose();
    });
    lights = [];

    // Clear scene
    if (sceneRoot) {
      while (sceneRoot.children.length > 0) {
        var child = sceneRoot.children[0];
        sceneRoot.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(function(m){ if (m.dispose) m.dispose(); });
          } else if (child.material.dispose) {
            child.material.dispose();
          }
        }
      }
    }

    // Dispose environment
    if (envRT && envRT.dispose) {
      envRT.dispose();
      envRT = null;
    }
    if (pmremGenerator && pmremGenerator.dispose) {
      pmremGenerator.dispose();
      pmremGenerator = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PBR MATERIAL CREATION
  // ─────────────────────────────────────────────────────────────────────────

  function materialFor(kind){
    if (!THREE) return null;
    
    var spec = MATERIAL_PALETTE[kind] || MATERIAL_PALETTE.concrete;
    
    var mat = new THREE.MeshPhysicalMaterial({
      color: spec.color,
      roughness: spec.roughness || 0.8,
      metalness: spec.metalness || 0.0,
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
      mat.transparent = true;
    }

    mat.needsUpdate = true;
    return mat;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LIGHTING SETUP
  // ─────────────────────────────────────────────────────────────────────────

  function setupLighting(centerX, centerY, centerZ, span){
    if (!scene || !THREE) return;
    
    // Clear existing lights
    lights.forEach(function(light){
      if (light && light.parent) light.parent.remove(light);
    });
    lights = [];

    var preset = LIGHTING_PRESETS[state.currentLighting % LIGHTING_PRESETS.length];
    
    // Ensure span is reasonable for shadow calculations
    var effectiveSpan = Math.max(span, 10);

    // 1. Ambient base - slightly stronger for studio look
    var ambient = new THREE.AmbientLight(0xf0f3f8, 0.35);
    scene.add(ambient);
    lights.push(ambient);

    // 2. Hemisphere light for sky/ground bounce
    var hemi = new THREE.HemisphereLight(0xdce8f5, 0x8a9099, 0.45);
    hemi.position.set(centerX, centerY + effectiveSpan * 4, centerZ);
    scene.add(hemi);
    lights.push(hemi);

    // 3. Key light (sun) - main shadow caster
    var sunAngleRad = (preset.angle || 45) * Math.PI / 180;
    var keyLight = new THREE.DirectionalLight(preset.sunColor || 0xffffff, preset.intensity || 2.0);
    keyLight.position.set(
      centerX + effectiveSpan * 3 * Math.cos(sunAngleRad),
      centerY + effectiveSpan * 4,
      centerZ + effectiveSpan * 3 * Math.sin(sunAngleRad)
    );
    keyLight.target.position.set(centerX, 0, centerZ);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(4096, 4096);
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.radius = 3;  // Softer shadows

    // Shadow camera covers entire scene
    var shadowExtent = effectiveSpan * 4;
    keyLight.shadow.camera.left = -shadowExtent;
    keyLight.shadow.camera.right = shadowExtent;
    keyLight.shadow.camera.top = shadowExtent;
    keyLight.shadow.camera.bottom = -shadowExtent;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = effectiveSpan * 15;

    scene.add(keyLight);
    scene.add(keyLight.target);
    lights.push(keyLight);
    lights.push(keyLight.target);

    // 4. Fill light
    var fillLight = new THREE.DirectionalLight(0xe0ecff, 0.6);
    fillLight.position.set(centerX - span * 2, centerY + span * 1.5, centerZ - span * 1.5);
    fillLight.target.position.set(centerX, centerY, centerZ);
    fillLight.castShadow = false;
    scene.add(fillLight);
    scene.add(fillLight.target);
    lights.push(fillLight);
    lights.push(fillLight.target);

    // 5. Rim light for depth
    var rimLight = new THREE.SpotLight(0xfafbff, 0.8);
    rimLight.position.set(centerX, centerY + span * 3, centerZ - span * 2.5);
    rimLight.target.position.set(centerX, centerY, centerZ);
    rimLight.angle = Math.PI / 4;
    rimLight.penumbra = 0.8;
    rimLight.castShadow = true;
    rimLight.shadow.mapSize.set(2048, 2048);
    scene.add(rimLight);
    scene.add(rimLight.target);
    lights.push(rimLight);
    lights.push(rimLight.target);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENVIRONMENT MAP
  // ─────────────────────────────────────────────────────────────────────────

  function ensureEnvironment(){
    if (!renderer || !THREE) return Promise.resolve(null);
    
    if (envRT && envRT.texture) {
      scene.environment = envRT.texture;
      return Promise.resolve(envRT.texture);
    }

    // Create procedural studio environment
    pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    var studio = new THREE.Scene();
    studio.background = new THREE.Color(0xffffff);

    // Add light emitters for environment reflections
    function addEmitter(w, h, pos, rot, color, intensity){
      var c = new THREE.Color(color || 0xffffff);
      c.multiplyScalar(intensity || 1);
      var mat = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      plane.position.copy(pos);
      if (rot) plane.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
      studio.add(plane);
    }

    addEmitter(100, 100, new THREE.Vector3(80, 80, 80), { x: -Math.PI/4, y: Math.PI/4 }, 0xffffff, 3.5);
    addEmitter(100, 100, new THREE.Vector3(-80, 80, 40), { x: -Math.PI/4, y: -Math.PI/4 }, 0xf0f8ff, 2.0);
    addEmitter(100, 100, new THREE.Vector3(0, 80, -80), { x: Math.PI/4, y: 0 }, 0xfffaf0, 2.5);

    envRT = pmremGenerator.fromScene(studio, 0.02);
    scene.environment = envRT.texture;
    
    return Promise.resolve(envRT.texture);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCENE BUILDING FROM PROJECT DATA
  // ─────────────────────────────────────────────────────────────────────────

  function gatherProjectData(){
    var data = {
      rooms: [],
      walls: [],
      roofs: [],
      pools: [],
      garages: [],
      pergolas: [],
      balconies: [],
      furniture: [],
      stairs: []
    };

    // Gather rooms - FORCE fresh read from window.allRooms
    var rawRooms = window.allRooms;
    if (Array.isArray(rawRooms) && rawRooms.length > 0) {
      console.log('[Photoreal] ========== GATHERING FRESH DATA ==========');
      console.log('[Photoreal] Raw allRooms count:', rawRooms.length);
      
      // Log ALL rooms with their current positions
      rawRooms.forEach(function(r, idx) {
        console.log('[Photoreal] Room[' + idx + ']:', r.id, 'pos=(' + r.x + ',' + r.z + ') size=(' + r.width + 'x' + r.depth + ') level=' + r.level + ' y=' + (r.y || 'N/A') + ' baseHeight=' + (r.baseHeight || 'N/A'));
      });
      
      data.rooms = rawRooms.map(function(r){
        // Read Y position from multiple possible sources
        var yPos = 0;
        if (typeof r.y === 'number') yPos = r.y;
        else if (typeof r.baseHeight === 'number') yPos = r.baseHeight;
        
        return {
          id: r.id,
          x: r.x || 0,
          y: yPos,
          z: r.z || 0,
          width: r.width || 4,
          depth: r.depth || 4,
          height: r.height || 3,
          level: r.level || 0,
          rotation: r.rotation || 0
        };
      });
    } else {
      console.warn('[Photoreal] No rooms found in window.allRooms!');
    }

    // Gather wall strips
    if (Array.isArray(window.wallStrips)) {
      data.walls = window.wallStrips.map(function(w){
        return {
          x0: w.x0 || w.start?.x || 0,
          z0: w.z0 || w.start?.z || 0,
          x1: w.x1 || w.end?.x || 0,
          z1: w.z1 || w.end?.z || 0,
          height: w.height || 3,
          thickness: w.thickness || 0.25,
          level: w.level || 0
        };
      });
    }

    // Gather roofs
    if (Array.isArray(window.roofComponents)) {
      data.roofs = window.roofComponents.map(function(r){
        return {
          id: r.id,
          x: r.x || 0,
          z: r.z || 0,
          width: r.width || 10,
          depth: r.depth || 10,
          height: r.height || 0.5,
          level: r.level || 0,
          baseHeight: r.baseHeight || 3
        };
      });
    }

    // Gather pools
    if (Array.isArray(window.poolComponents)) {
      data.pools = window.poolComponents.map(function(p){
        return {
          id: p.id,
          x: p.x || 0,
          z: p.z || 0,
          width: p.width || 4,
          depth: p.depth || 6,
          height: p.height || 1.2
        };
      });
    }

    // Gather garages
    if (Array.isArray(window.garageComponents)) {
      data.garages = window.garageComponents;
    }

    // Gather pergolas
    if (Array.isArray(window.pergolaComponents)) {
      data.pergolas = window.pergolaComponents;
    }

    // Gather balconies
    if (Array.isArray(window.balconyComponents)) {
      data.balconies = window.balconyComponents;
    }

    // Gather furniture
    if (Array.isArray(window.furnitureItems)) {
      data.furniture = window.furnitureItems;
    }

    // Gather stairs
    if (Array.isArray(window.stairsComponents)) {
      data.stairs = window.stairsComponents;
    }

    return data;
  }

  function computeBounds(data){
    var minX = Infinity, maxX = -Infinity;
    var minZ = Infinity, maxZ = -Infinity;
    var maxY = 0;

    function expand(x, z, w, d, h){
      minX = Math.min(minX, x - w/2);
      maxX = Math.max(maxX, x + w/2);
      minZ = Math.min(minZ, z - d/2);
      maxZ = Math.max(maxZ, z + d/2);
      maxY = Math.max(maxY, h || 3);
    }

    data.rooms.forEach(function(r){
      expand(r.x, r.z, r.width, r.depth, (r.level + 1) * r.height);
    });

    data.walls.forEach(function(w){
      var cx = (w.x0 + w.x1) / 2;
      var cz = (w.z0 + w.z1) / 2;
      var len = Math.sqrt((w.x1 - w.x0)**2 + (w.z1 - w.z0)**2);
      expand(cx, cz, len + 1, w.thickness + 1, (w.level + 1) * w.height);
    });

    data.roofs.forEach(function(r){
      expand(r.x, r.z, r.width, r.depth, r.baseHeight + r.height);
    });

    data.pools.forEach(function(p){
      expand(p.x, p.z, p.width, p.depth, 0);
    });

    // Include garages
    data.garages.forEach(function(g){
      expand(g.x || 0, g.z || 0, g.width || 3, g.depth || 5, g.height || 3);
    });

    // Include pergolas
    data.pergolas.forEach(function(p){
      expand(p.x || 0, p.z || 0, p.width || 3, p.depth || 3, p.height || 3);
    });

    // Include balconies
    data.balconies.forEach(function(b){
      expand(b.x || 0, b.z || 0, b.width || 2, b.depth || 1.5, (b.level || 1) * 3);
    });

    // Include furniture
    data.furniture.forEach(function(f){
      expand(f.x || 0, f.z || 0, f.width || 1, f.depth || 1, f.height || 1);
    });

    // Include stairs
    data.stairs.forEach(function(s){
      expand(s.x || 0, s.z || 0, s.width || 1, s.depth || 3, s.height || 3);
    });

    if (minX === Infinity) {
      // No geometry - use defaults
      return { cx: 0, cy: 0, cz: 0, width: 20, depth: 20, height: 5, span: 20, minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    }

    // Store unpaded center for reference
    var unpadCx = (minX + maxX) / 2;
    var unpadCz = (minZ + maxZ) / 2;

    // Add padding around the scene for edge-to-edge framing
    var padding = 2;
    minX -= padding;
    maxX += padding;
    minZ -= padding;
    maxZ += padding;

    var width = maxX - minX;
    var depth = maxZ - minZ;
    
    // Center should be the same with or without padding
    var cx = (minX + maxX) / 2;
    var cz = (minZ + maxZ) / 2;
    
    console.log('[Photoreal] Bounds calculation:', {
      unpadCenter: '(' + unpadCx.toFixed(2) + ', ' + unpadCz.toFixed(2) + ')',
      paddedCenter: '(' + cx.toFixed(2) + ', ' + cz.toFixed(2) + ')',
      minX: minX.toFixed(2), maxX: maxX.toFixed(2),
      minZ: minZ.toFixed(2), maxZ: maxZ.toFixed(2)
    });

    return {
      cx: cx,
      cy: maxY / 2,
      cz: cz,
      width: width,
      depth: depth,
      height: maxY,
      span: Math.max(width, depth, maxY),
      minX: minX,
      maxX: maxX,
      minZ: minZ,
      maxZ: maxZ
    };
  }

  // Store bounds globally for ground plane sizing
  var sceneBounds = null;

  function buildSceneGeometry(data, bounds){
    if (!THREE || !sceneRoot) return;
    
    console.log('[Photoreal] ========== BUILDING SCENE GEOMETRY ==========');
    console.log('[Photoreal] Input data:', JSON.stringify({
      roomCount: data.rooms.length,
      wallCount: data.walls.length,
      roofCount: data.roofs.length,
      bounds: bounds
    }));

    // Store bounds for reference
    sceneBounds = bounds;

    // Clear existing geometry
    while (sceneRoot.children.length > 0) {
      var child = sceneRoot.children[0];
      sceneRoot.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(function(m){ if (m.dispose) m.dispose(); });
        } else if (child.material.dispose) {
          child.material.dispose();
        }
      }
    }

    // Build ground plane - very large to fill entire view edge-to-edge
    var groundSize = Math.max(bounds.width, bounds.depth, 50) * 10;
    var groundGeom = new THREE.PlaneGeometry(groundSize, groundSize, 1, 1);
    var groundMat = materialFor('ground');
    var ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(bounds.cx, 0, bounds.cz);
    ground.receiveShadow = true;
    ground.name = 'GroundPlane';
    sceneRoot.add(ground);
    
    console.log('[Photoreal] Ground plane:', groundSize, 'x', groundSize, 'at', bounds.cx, bounds.cz);

    // Build rooms as concrete boxes
    console.log('[Photoreal] Building', data.rooms.length, 'rooms into scene');
    data.rooms.forEach(function(room, idx){
      var geom = new THREE.BoxGeometry(room.width, room.height, room.depth);
      var mat = materialFor('wall');
      var mesh = new THREE.Mesh(geom, mat);
      
      // Calculate Y position from level OR explicit y/baseHeight
      var baseY = (room.y || 0) + (room.level * room.height);
      var posX = room.x;
      var posY = baseY + room.height / 2;
      var posZ = room.z;
      
      mesh.position.set(posX, posY, posZ);
      if (room.rotation) mesh.rotation.y = (room.rotation * Math.PI) / 180; // Convert degrees to radians
      
      console.log('[Photoreal] Room[' + idx + '] mesh at:', posX.toFixed(2), posY.toFixed(2), posZ.toFixed(2));
      
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      sceneRoot.add(mesh);

      // Add edges for architectural detail
      var edges = new THREE.EdgesGeometry(geom, 30);
      var edgeMat = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 1 });
      var edgeMesh = new THREE.LineSegments(edges, edgeMat);
      edgeMesh.position.copy(mesh.position);
      edgeMesh.rotation.copy(mesh.rotation);
      sceneRoot.add(edgeMesh);
    });

    // Build wall strips
    data.walls.forEach(function(wall){
      var dx = wall.x1 - wall.x0;
      var dz = wall.z1 - wall.z0;
      var length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.1) return;

      var geom = new THREE.BoxGeometry(length, wall.height, wall.thickness);
      var mat = materialFor('wall');
      var mesh = new THREE.Mesh(geom, mat);

      var cx = (wall.x0 + wall.x1) / 2;
      var cz = (wall.z0 + wall.z1) / 2;
      var baseY = (wall.level || 0) * wall.height;
      var angle = Math.atan2(dz, dx);

      mesh.position.set(cx, baseY + wall.height / 2, cz);
      mesh.rotation.y = -angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      sceneRoot.add(mesh);
    });

    // Build roofs
    data.roofs.forEach(function(roof){
      var geom = new THREE.BoxGeometry(roof.width + 0.5, roof.height || 0.3, roof.depth + 0.5);
      var mat = materialFor('roof');
      var mesh = new THREE.Mesh(geom, mat);
      
      mesh.position.set(roof.x, (roof.baseHeight || 3) + (roof.height || 0.3) / 2, roof.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      sceneRoot.add(mesh);
    });

    // Build pools
    data.pools.forEach(function(pool){
      var geom = new THREE.BoxGeometry(pool.width, pool.height, pool.depth);
      var mat = materialFor('pool');
      var mesh = new THREE.Mesh(geom, mat);
      
      mesh.position.set(pool.x, -pool.height / 2, pool.z);
      mesh.receiveShadow = true;
      sceneRoot.add(mesh);
    });

    // Build garages
    data.garages.forEach(function(garage){
      var w = garage.width || 3.2;
      var d = garage.depth || 5.5;
      var h = garage.height || 2.6;
      var geom = new THREE.BoxGeometry(w, h, d);
      var mat = materialFor('wall');
      var mesh = new THREE.Mesh(geom, mat);
      
      var baseY = (garage.level || 0) * 3;
      mesh.position.set(garage.x || 0, baseY + h / 2, garage.z || 0);
      if (garage.rotation) mesh.rotation.y = garage.rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      sceneRoot.add(mesh);

      // Add edges
      var edges = new THREE.EdgesGeometry(geom, 30);
      var edgeMat = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 1 });
      var edgeMesh = new THREE.LineSegments(edges, edgeMat);
      edgeMesh.position.copy(mesh.position);
      edgeMesh.rotation.copy(mesh.rotation);
      sceneRoot.add(edgeMesh);
    });

    // Build pergolas
    data.pergolas.forEach(function(pergola){
      var w = pergola.width || 3;
      var d = pergola.depth || 3;
      var h = pergola.height || 2.8;
      
      // Create pergola posts and beams
      var postMat = materialFor('concrete');
      var postSize = 0.15;
      var posts = [
        [-w/2 + postSize/2, -d/2 + postSize/2],
        [w/2 - postSize/2, -d/2 + postSize/2],
        [-w/2 + postSize/2, d/2 - postSize/2],
        [w/2 - postSize/2, d/2 - postSize/2]
      ];
      
      var baseY = (pergola.level || 0) * 3;
      posts.forEach(function(pos){
        var postGeom = new THREE.BoxGeometry(postSize, h, postSize);
        var post = new THREE.Mesh(postGeom, postMat);
        post.position.set((pergola.x || 0) + pos[0], baseY + h / 2, (pergola.z || 0) + pos[1]);
        post.castShadow = true;
        post.receiveShadow = true;
        sceneRoot.add(post);
      });
      
      // Top beams
      var beamMat = materialFor('roof');
      var beamH = 0.1;
      var beam1 = new THREE.Mesh(new THREE.BoxGeometry(w, beamH, 0.08), beamMat);
      beam1.position.set(pergola.x || 0, baseY + h, (pergola.z || 0) - d/3);
      beam1.castShadow = true;
      sceneRoot.add(beam1);
      
      var beam2 = new THREE.Mesh(new THREE.BoxGeometry(w, beamH, 0.08), beamMat);
      beam2.position.set(pergola.x || 0, baseY + h, (pergola.z || 0) + d/3);
      beam2.castShadow = true;
      sceneRoot.add(beam2);
    });

    // Build balconies
    data.balconies.forEach(function(balcony){
      var w = balcony.width || 2;
      var d = balcony.depth || 1.5;
      var h = 0.15; // Slab thickness
      var geom = new THREE.BoxGeometry(w, h, d);
      var mat = materialFor('concrete');
      var mesh = new THREE.Mesh(geom, mat);
      
      var baseY = (balcony.level || 1) * 3;
      mesh.position.set(balcony.x || 0, baseY - h/2, balcony.z || 0);
      if (balcony.rotation) mesh.rotation.y = balcony.rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      sceneRoot.add(mesh);

      // Add railing
      var railMat = materialFor('glass');
      var railH = 1.0;
      var railGeom = new THREE.BoxGeometry(w, railH, 0.02);
      var rail = new THREE.Mesh(railGeom, railMat);
      rail.position.set(balcony.x || 0, baseY + railH/2 - h, (balcony.z || 0) + d/2);
      if (balcony.rotation) rail.rotation.y = balcony.rotation;
      sceneRoot.add(rail);
    });

    // Build furniture (simplified boxes)
    data.furniture.forEach(function(furn){
      var w = furn.width || 1;
      var d = furn.depth || 1;
      var h = furn.height || 0.8;
      var geom = new THREE.BoxGeometry(w, h, d);
      var mat = materialFor('concrete'); // Neutral furniture color
      var mesh = new THREE.Mesh(geom, mat);
      
      var baseY = (furn.level || 0) * 3 + (furn.elevation || 0);
      mesh.position.set(furn.x || 0, baseY + h / 2, furn.z || 0);
      if (furn.rotation) mesh.rotation.y = furn.rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      sceneRoot.add(mesh);
    });

    // Build stairs
    data.stairs.forEach(function(stair){
      var w = stair.width || 1;
      var d = stair.depth || 3;
      var h = stair.height || 3;
      var steps = Math.max(3, Math.round(h / 0.18)); // ~18cm per step
      var stepH = h / steps;
      var stepD = d / steps;
      
      var mat = materialFor('concrete');
      var baseY = (stair.level || 0) * 3;
      
      for (var i = 0; i < steps; i++) {
        var stepGeom = new THREE.BoxGeometry(w, stepH, stepD);
        var step = new THREE.Mesh(stepGeom, mat);
        step.position.set(
          stair.x || 0,
          baseY + stepH/2 + i * stepH,
          (stair.z || 0) - d/2 + stepD/2 + i * stepD
        );
        if (stair.rotation) step.rotation.y = stair.rotation;
        step.castShadow = true;
        step.receiveShadow = true;
        sceneRoot.add(step);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN RENDER PIPELINE
  // ─────────────────────────────────────────────────────────────────────────

  async function startPhotorealisticRender(){
    console.log('[Photoreal] ===== NEW RENDER STARTED =====');
    console.log('[Photoreal] Time:', new Date().toISOString());
    
    // CRITICAL DEBUG: Log raw window.allRooms state RIGHT NOW
    console.log('[Photoreal] DIRECT READ of window.allRooms:');
    if (window.allRooms && window.allRooms.length > 0) {
      window.allRooms.forEach(function(r, i) {
        console.log('[Photoreal]   Room ' + i + ': x=' + r.x + ', z=' + r.z + ', level=' + r.level + ', w=' + r.width + ', d=' + r.depth);
      });
    } else {
      console.warn('[Photoreal]   NO ROOMS FOUND!');
    }
    
    // Also log camera state
    if (window.camera) {
      console.log('[Photoreal] DIRECT READ of window.camera:');
      console.log('[Photoreal]   yaw=' + window.camera.yaw + ', pitch=' + window.camera.pitch + ', distance=' + window.camera.distance);
      console.log('[Photoreal]   targetX=' + window.camera.targetX + ', targetY=' + window.camera.targetY + ', targetZ=' + window.camera.targetZ);
    }
    
    // Reset busy state if stuck (safety valve)
    if (state.busy) {
      console.warn('[Photoreal] Resetting stuck busy state');
      state.busy = false;
    }
    
    state.renderStarted = true;
    setBusy(true);
    setLoading(true, 'Loading renderer…');
    setStatus('Initializing Three.js photorealistic renderer…', 'info');

    try {
      // Step 1: Ensure Three.js is loaded
      await ensureThreeJS();
      setLoading(true, 'Setting up scene…');
      setStatus('Gathering 3D objects from viewport…', 'info');
      await delay(50);

      // Step 2: Get full stage dimensions for edge-to-edge rendering
      var stageEl = state.stage || document.getElementById(STAGE_ID);
      var width = stageEl ? stageEl.clientWidth : window.innerWidth;
      var height = stageEl ? stageEl.clientHeight : window.innerHeight;
      
      // Ensure minimum dimensions
      width = Math.max(width, 800);
      height = Math.max(height, 600);
      
      // NOTE: pixelRatio is handled by renderer.setPixelRatio() in ensureRenderer()
      // We pass CSS dimensions to setSize and Three.js multiplies internally
      var pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      
      console.log('[Photoreal] Stage dimensions:', width, 'x', height, '(pixelRatio:', pixelRatio, ')');

      // Step 3: Setup renderer and scene
      ensureRenderer();
      // Pass CSS dimensions - renderer.setPixelRatio already handles the internal scaling
      renderer.setSize(width, height, false);
      
      // Calculate the actual render dimensions for logging and camera setup
      var renderWidth = Math.floor(width * pixelRatio);
      var renderHeight = Math.floor(height * pixelRatio);
      
      console.log('[Photoreal] Actual canvas buffer:', renderWidth, 'x', renderHeight);
      
      // Set canvas to fill entire stage
      if (state.renderCanvas) {
        state.renderCanvas.style.width = '100%';
        state.renderCanvas.style.height = '100%';
      }

      ensureScene();
      
      setLoading(true, 'Building geometry…');
      setStatus('Building photorealistic 3D geometry…', 'info');
      await delay(50);

      // Step 4: Gather project data and compute bounds (FRESH each render)
      var projectData = gatherProjectData();
      var bounds = computeBounds(projectData);
      
      console.log('[Photoreal] Project data gathered:', {
        rooms: projectData.rooms.length,
        walls: projectData.walls.length,
        roofs: projectData.roofs.length,
        pools: projectData.pools.length,
        garages: projectData.garages.length
      });
      console.log('[Photoreal] Bounds computed:', bounds);
      
      // Step 5: Build scene geometry with PBR materials (pass bounds for ground sizing)
      buildSceneGeometry(projectData, bounds);

      setLoading(true, 'Setting up lighting…');
      setStatus('Configuring photorealistic lighting…', 'info');
      await delay(50);

      // Step 6: Setup camera to fit scene edge-to-edge
      ensureCamera(renderWidth, renderHeight, bounds);

      // Step 7: Setup lighting
      setupLighting(bounds.cx, bounds.cy, bounds.cz, bounds.span);

      // Step 8: Setup environment for reflections
      await ensureEnvironment();

      setLoading(true, 'Rendering…');
      setStatus('Rendering photorealistic scene…', 'info');
      await delay(50);

      // Step 9: Render the scene
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      // Perform multiple render passes for shadow quality
      for (var pass = 0; pass < 3; pass++) {
        renderer.shadowMap.needsUpdate = true;
        renderer.render(scene, camera);
        await delay(16);
      }

      // Step 10: Save result
      var dataUrl = state.renderCanvas.toDataURL('image/png', 0.95);
      state.lastRender = {
        dataUrl: dataUrl,
        width: renderWidth,
        height: renderHeight
      };

      // Debug canvas dimensions
      console.log('[Photoreal] Final canvas state:', {
        internalWidth: state.renderCanvas.width,
        internalHeight: state.renderCanvas.height,
        cssWidth: state.renderCanvas.style.width,
        cssHeight: state.renderCanvas.style.height,
        offsetWidth: state.renderCanvas.offsetWidth,
        offsetHeight: state.renderCanvas.offsetHeight,
        aspectRatio: (state.renderCanvas.width / state.renderCanvas.height).toFixed(3)
      });

      var preset = LIGHTING_PRESETS[state.currentLighting % LIGHTING_PRESETS.length];

      if (state.footnoteEl) {
        state.footnoteEl.textContent = 'Photorealistic render: ' + renderWidth + '×' + renderHeight + ' px · ' + preset.name + ' lighting';
      }

      rememberShot({
        dataUrl: dataUrl,
        label: 'Photoreal · ' + preset.name,
        width: renderWidth,
        height: renderHeight
      });

      setStatus('Photorealistic render complete. Ready to download.', 'live');
      if (state.downloadButton) state.downloadButton.disabled = false;

      // Cycle lighting for next render
      state.currentLighting = (state.currentLighting + 1) % LIGHTING_PRESETS.length;

    } catch(err) {
      console.error('[Photoreal] Render failed:', err);
      setStatus(err && err.message ? err.message : 'Render failed.', 'error');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }

  function delay(ms){
    return new Promise(function(resolve){ setTimeout(resolve, ms); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GALLERY AND DOWNLOAD UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  function rememberShot(info){
    var entry = {
      id: 'shot-' + (++state.shotCounter),
      label: info.label,
      dataUrl: info.dataUrl,
      width: info.width,
      height: info.height,
      timestamp: Date.now()
    };
    state.shots.unshift(entry);
    if (state.shots.length > 12) state.shots.pop();
    renderGallery();
    return entry;
  }

  function renderGallery(){
    if (!state.galleryEl) return;
    state.galleryEl.innerHTML = '';
    if (!state.shots.length) {
      var empty = document.createElement('div');
      empty.className = 'visualize-gallery-empty';
      empty.textContent = 'Renders will appear here.';
      state.galleryEl.appendChild(empty);
      return;
    }
    state.shots.forEach(function(shot){
      var item = document.createElement('div');
      item.className = 'visualize-gallery-thumb';
      item.style.backgroundImage = 'url(' + shot.dataUrl + ')';
      var label = document.createElement('span');
      label.textContent = shot.label;
      item.appendChild(label);
      item.addEventListener('click', function(){ openShot(shot); });
      state.galleryEl.appendChild(item);
    });
  }

  function openShot(shot){
    if (!state.photoViewer || !state.photoImg) return;
    state.photoImg.src = shot.dataUrl;
    if (state.photoCaption) state.photoCaption.textContent = shot.label + ' · ' + shot.width + '×' + shot.height + ' px';
    state.photoViewer.classList.add('visible');
  }

  function closePhotoViewer(){
    if (!state.photoViewer || !state.photoImg) return;
    state.photoViewer.classList.remove('visible');
    state.photoImg.removeAttribute('src');
    if (state.photoCaption) state.photoCaption.textContent = '';
  }

  function downloadCurrent(){
    if (!state.lastRender) return;
    var link = document.createElement('a');
    link.download = 'gablok-photoreal-render.png';
    link.href = state.lastRender.dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GLOBAL EXPORTS
  // ─────────────────────────────────────────────────────────────────────────

  window.showVisualize = showVisualize;
  window.hideVisualize = hideVisualize;
  window.startPhotorealisticRender = startPhotorealisticRender;
  
  // Export function to check if photoreal panel is open (for external triggers)
  window.isPhotorealPanelOpen = function() {
    return state.panel && state.panel.classList.contains('visible');
  };
  
  // Export function to manually notify of scene changes (alternative to polling)
  window.notifyPhotorealSceneChanged = function() {
    if (state.panel && state.panel.classList.contains('visible')) {
      checkForSceneChanges();
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
