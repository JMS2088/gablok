/**
 * @file visualize-photoreal.js
 * @description Photorealistic 3D rendering using Three.js PBR materials
 * @version 3.0.0 - Enhanced rendering with post-processing, SSAO, bloom
 * 
 * Auto-renders the 3D viewport with photorealistic materials when panel opens.
 * Uses MeshPhysicalMaterial for accurate PBR rendering with proper lighting.
 * Includes post-processing for ambient occlusion, bloom, and color grading.
 */
(function(){
  if (typeof window === 'undefined') return;

  var THREE = window.THREE;
  
  // Post-processing composers
  var composer = null;
  var ssaoPass = null;
  var bloomPass = null;
  var renderPass = null;
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

  // Photorealistic PBR material palette - ENHANCED with better tonal variation
  var MATERIAL_PALETTE = {
    // Concrete surfaces (walls, rooms) - with texture support and subtle tonal shifts
    concrete: {
      color: 0xd8d8d0,        // Warmer light gray with subtle yellow undertone
      roughness: 0.82,
      metalness: 0.02,
      envMapIntensity: 1.0,
      bumpScale: 0.018,
      textureRepeat: 2.0,
      normalScale: 0.15,
      aoIntensity: 0.8
    },
    // Exterior concrete massing - darker with more character
    wall: {
      color: 0x8a8a82,        // Medium architectural concrete with warm undertone
      roughness: 0.72,
      metalness: 0.04,
      envMapIntensity: 1.1,
      bumpScale: 0.025,
      textureRepeat: 3.0,
      normalScale: 0.2,
      aoIntensity: 0.9,
      clearcoat: 0.15,
      clearcoatRoughness: 0.6
    },
    // Glass surfaces - blue tinted architectural glass with strong reflections
    glass: {
      color: 0x7db8d8,        // Cooler blue tint
      roughness: 0.02,
      metalness: 0.25,
      transmission: 0.82,      // Slightly less transparent for visibility
      thickness: 0.6,
      ior: 1.52,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      envMapIntensity: 2.0,    // Very strong reflections
      reflectivity: 0.95,
      specularIntensity: 1.5,
      sheen: 0.2,
      sheenColor: 0xaaddff
    },
    // Pool water - deeper blue with caustics simulation
    pool: {
      color: 0x1878B8,
      roughness: 0.01,
      metalness: 0.15,
      transmission: 0.92,
      thickness: 2.5,
      ior: 1.33,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      envMapIntensity: 1.8
    },
    // Flat roof - white/light gray plastic with realistic finish
    roof: {
      color: 0xf2f2f0,        // White/very light gray with warmth
      roughness: 0.32,        // Smooth plastic finish
      metalness: 0.02,
      envMapIntensity: 1.4,
      clearcoat: 0.7,         // Strong plastic sheen
      clearcoatRoughness: 0.15,
      bumpScale: 0.008,
      normalScale: 0.08
    },
    // Roof edge trim - subtle shadow line accent
    roofEdge: {
      color: 0xe0e0de,        // Slightly darker edge
      roughness: 0.28,
      metalness: 0.08,
      envMapIntensity: 1.2,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12
    },
    // Ground/path - textured ground with variation
    ground: {
      color: 0xc8ccd0,        // Cool grey ground
      roughness: 0.88,
      metalness: 0.01,
      envMapIntensity: 0.5,
      bumpScale: 0.008,
      textureRepeat: 25.0,
      normalScale: 0.12,
      aoIntensity: 1.0
    },
    // Pergola wood - warm natural tones
    pergola: {
      color: 0x7a5812,        // Warmer wood color
      roughness: 0.65,
      metalness: 0.0,
      envMapIntensity: 0.6,
      clearcoat: 0.25,
      clearcoatRoughness: 0.4,
      bumpScale: 0.02
    },
    // Garage door metal - brushed aluminum look
    garage: {
      color: 0x606068,
      roughness: 0.35,
      metalness: 0.85,
      envMapIntensity: 1.5,
      clearcoat: 0.3,
      clearcoatRoughness: 0.25
    },
    // Balcony railing - polished dark metal
    balcony: {
      color: 0x2a2a30,
      roughness: 0.22,
      metalness: 0.92,
      envMapIntensity: 1.8,
      clearcoat: 0.4,
      clearcoatRoughness: 0.1
    },
    // Stairs - smooth concrete
    stairs: {
      color: 0xa8a8a0,
      roughness: 0.75,
      metalness: 0.06,
      envMapIntensity: 0.85,
      bumpScale: 0.012,
      normalScale: 0.1,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5
    },
    // Window frame - white painted wood (thicker 50mm frames)
    windowFrame: {
      color: 0xfafafa,        // Clean white paint
      roughness: 0.20,        // Smooth painted finish
      metalness: 0.02,
      envMapIntensity: 1.2,
      clearcoat: 0.65,        // Strong sheen from paint
      clearcoatRoughness: 0.15
    },
    // Door panel - wood grain with varnish
    door: {
      color: 0x654321,        // Rich wood brown
      roughness: 0.45,
      metalness: 0.0,
      envMapIntensity: 0.8,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
      bumpScale: 0.015
    }
  };

  // Texture cache
  var textureCache = {};
  var textureLoader = null;

  // Architectural lighting presets - enhanced with more dramatic options
  var LIGHTING_PRESETS = [
    { name: 'Golden Hour', sunColor: 0xffe8c8, intensity: 2.8, angle: 12, warmth: 0.20, shadowSoftness: 3, ambientIntensity: 0.35, fillIntensity: 0.5, contrast: 1.2 },
    { name: 'Midday', sunColor: 0xffffff, intensity: 3.2, angle: 65, warmth: 0.0, shadowSoftness: 1.5, ambientIntensity: 0.5, fillIntensity: 0.65, contrast: 1.0 },
    { name: 'Overcast', sunColor: 0xe0eaf4, intensity: 1.8, angle: 50, warmth: -0.05, shadowSoftness: 5, ambientIntensity: 0.65, fillIntensity: 0.8, contrast: 0.85 },
    { name: 'Studio', sunColor: 0xfff8f0, intensity: 2.5, angle: 38, warmth: 0.05, shadowSoftness: 2.5, ambientIntensity: 0.45, fillIntensity: 0.6, contrast: 1.1 },
    { name: 'Dramatic', sunColor: 0xffd4a0, intensity: 3.5, angle: 8, warmth: 0.25, shadowSoftness: 2, ambientIntensity: 0.25, fillIntensity: 0.35, contrast: 1.4 },
    { name: 'Cool Evening', sunColor: 0xc8d8f0, intensity: 2.0, angle: 20, warmth: -0.1, shadowSoftness: 4, ambientIntensity: 0.4, fillIntensity: 0.55, contrast: 1.15 }
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
      
      // Use the user's distance from the 3D viewport with a slight push-back
      // Multiply by 1.25 to push camera back for better framing
      var viewDist = this.distance * 1.25;
      
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
      
      // Allow camera to go very low (just above ground) to match 3D viewport
      // This enables looking up at buildings from ground level
      camY = Math.max(0.1, camY);
      
      // Since sceneRoot has scale.x = -1, we need to negate camera X and lookAt X
      // to view the mirrored scene correctly
      var mirrorCamX = -camX;
      var mirrorLookX = -centerX;
      
      // Set camera position
      threeCamera.position.set(mirrorCamX, camY, camZ);
      
      // Look at scene center (also mirrored on X)
      threeCamera.up.set(0, 1, 0);
      threeCamera.lookAt(mirrorLookX, centerY, centerZ);
      
      // Use the captured FOV from the 3D viewport for matching perspective
      // Allow wider FOV for stronger perspective effect matching the 3D area
      var capturedFov = this.fov || 80;
      // Allow up to 100° FOV for strong perspective
      threeCamera.fov = Math.max(60, Math.min(100, capturedFov));
      
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

  /**
   * Load post-processing modules for enhanced visual effects
   */
  function loadPostProcessingModules() {
    return new Promise(function(resolve) {
      if (!THREE) {
        console.log('[Photoreal] THREE not available for post-processing');
        resolve(false);
        return;
      }
      
      // Check if already loaded
      if (THREE.EffectComposer && THREE.RenderPass && THREE.SSAOPass) {
        console.log('[Photoreal] Post-processing already loaded');
        resolve(true);
        return;
      }
      
      var basePath = 'vendor/three/examples/js/';
      var modules = [
        'postprocessing/Pass.js',
        'shaders/CopyShader.js',
        'postprocessing/ShaderPass.js',
        'postprocessing/EffectComposer.js',
        'postprocessing/RenderPass.js',
        'shaders/SSAOShader.js',
        'postprocessing/SSAOPass.js',
        'shaders/LuminosityHighPassShader.js',
        'postprocessing/UnrealBloomPass.js'
      ];
      
      var loaded = 0;
      var total = modules.length;
      
      function loadNext() {
        if (loaded >= total) {
          console.log('[Photoreal] All post-processing modules loaded');
          resolve(true);
          return;
        }
        
        var script = document.createElement('script');
        script.src = basePath + modules[loaded];
        script.onload = function() {
          loaded++;
          loadNext();
        };
        script.onerror = function() {
          console.warn('[Photoreal] Failed to load: ' + modules[loaded]);
          loaded++;
          loadNext();  // Continue even if one fails
        };
        document.head.appendChild(script);
      }
      
      loadNext();
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
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true  // Better depth precision
    });

    // High DPI rendering for sharper details
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    renderer.setClearColor(0xf8f9fb, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
    
    // Enhanced tone mapping for better dynamic range
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;  // Slightly brighter for punch

    // High quality shadows with better filtering
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;  // Variance Shadow Maps for softer shadows
    renderer.shadowMap.autoUpdate = true;
    
    // Enable physically correct lighting for realistic falloff
    if (renderer.physicallyCorrectLights !== undefined) {
      renderer.physicallyCorrectLights = true;
    }
    
    // Enable additional render quality features
    if (renderer.outputEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    return renderer;
  }

  /**
   * Setup post-processing pipeline for enhanced visuals
   * Includes SSAO for ambient occlusion, bloom for highlights, and color grading
   */
  function setupPostProcessing(width, height) {
    // Check if post-processing classes are available
    if (!THREE.EffectComposer || !THREE.RenderPass) {
      console.log('[Photoreal] Post-processing not available, using standard rendering');
      return null;
    }

    console.log('[Photoreal] Setting up post-processing pipeline');

    // Dispose old composer if exists
    if (composer) {
      try { composer.dispose(); } catch(e) {}
      composer = null;
    }

    // Create effect composer
    composer = new THREE.EffectComposer(renderer);
    composer.setSize(width, height);

    // Render pass - renders the scene
    renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);

    // SSAO pass for ambient occlusion (soft shadows in corners and crevices)
    if (THREE.SSAOPass) {
      try {
        ssaoPass = new THREE.SSAOPass(scene, camera, width, height);
        ssaoPass.kernelRadius = 16;       // AO radius
        ssaoPass.minDistance = 0.005;     // Min distance for AO
        ssaoPass.maxDistance = 0.1;       // Max distance for AO
        ssaoPass.output = THREE.SSAOPass.OUTPUT_Default;
        composer.addPass(ssaoPass);
        console.log('[Photoreal] SSAO pass added');
      } catch(e) {
        console.log('[Photoreal] SSAO pass failed:', e.message);
      }
    }

    // Bloom pass for highlights and glow
    if (THREE.UnrealBloomPass) {
      try {
        bloomPass = new THREE.UnrealBloomPass(
          new THREE.Vector2(width, height),
          0.3,    // strength - subtle bloom
          0.4,    // radius
          0.85    // threshold - only bright areas bloom
        );
        composer.addPass(bloomPass);
        console.log('[Photoreal] Bloom pass added');
      } catch(e) {
        console.log('[Photoreal] Bloom pass failed:', e.message);
      }
    }

    // Color grading shader pass for final polish
    if (THREE.ShaderPass && THREE.CopyShader) {
      try {
        // Custom color grading shader
        var colorGradeShader = {
          uniforms: {
            tDiffuse: { value: null },
            contrast: { value: 1.08 },
            saturation: { value: 1.1 },
            brightness: { value: 1.02 },
            vignette: { value: 0.25 }
          },
          vertexShader: [
            'varying vec2 vUv;',
            'void main() {',
            '  vUv = uv;',
            '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
            '}'
          ].join('\n'),
          fragmentShader: [
            'uniform sampler2D tDiffuse;',
            'uniform float contrast;',
            'uniform float saturation;',
            'uniform float brightness;',
            'uniform float vignette;',
            'varying vec2 vUv;',
            'void main() {',
            '  vec4 color = texture2D(tDiffuse, vUv);',
            '  // Brightness',
            '  color.rgb *= brightness;',
            '  // Contrast',
            '  color.rgb = (color.rgb - 0.5) * contrast + 0.5;',
            '  // Saturation',
            '  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));',
            '  color.rgb = mix(vec3(gray), color.rgb, saturation);',
            '  // Vignette',
            '  vec2 center = vUv - 0.5;',
            '  float dist = length(center);',
            '  color.rgb *= 1.0 - vignette * dist * dist;',
            '  gl_FragColor = color;',
            '}'
          ].join('\n')
        };
        
        var colorGradePass = new THREE.ShaderPass(colorGradeShader);
        colorGradePass.renderToScreen = true;
        composer.addPass(colorGradePass);
        console.log('[Photoreal] Color grading pass added');
      } catch(e) {
        console.log('[Photoreal] Color grading pass failed:', e.message);
      }
    }

    return composer;
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
  // TEXTURE LOADING
  // ─────────────────────────────────────────────────────────────────────────

  function getTextureLoader() {
    if (!textureLoader && THREE) {
      textureLoader = new THREE.TextureLoader();
    }
    return textureLoader;
  }

  function loadConcreteTexture(repeatX, repeatY) {
    var cacheKey = 'concrete_' + repeatX + '_' + repeatY;
    if (textureCache[cacheKey]) {
      return textureCache[cacheKey];
    }
    
    var loader = getTextureLoader();
    if (!loader) return null;
    
    var texturePath = 'js/textures/concrete/stone-background-wall-texture-banner-grunge-cement-concrete.jpg';
    var texture = loader.load(texturePath, function(tex) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX || 2, repeatY || 2);
      tex.anisotropy = 16;
      console.log('[Photoreal] Concrete texture loaded');
    }, undefined, function(err) {
      console.warn('[Photoreal] Failed to load concrete texture:', err);
    });
    
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX || 2, repeatY || 2);
    
    textureCache[cacheKey] = texture;
    return texture;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PBR MATERIAL CREATION - ENHANCED with full material properties
  // ─────────────────────────────────────────────────────────────────────────

  function materialFor(kind, width, height){
    if (!THREE) return null;
    
    var spec = MATERIAL_PALETTE[kind] || MATERIAL_PALETTE.concrete;
    
    // Calculate texture repeat based on surface size
    var repeatX = spec.textureRepeat || 1;
    var repeatY = spec.textureRepeat || 1;
    if (width && height) {
      repeatX = Math.max(1, width * (spec.textureRepeat || 1) / 4);
      repeatY = Math.max(1, height * (spec.textureRepeat || 1) / 4);
    }
    
    // Build comprehensive material configuration
    var matConfig = {
      color: spec.color,
      roughness: spec.roughness || 0.8,
      metalness: spec.metalness || 0.0,
      envMapIntensity: spec.envMapIntensity || 1.0,
      flatShading: false,
      side: THREE.FrontSide
    };
    
    // Add texture for concrete-like materials
    if (kind === 'wall' || kind === 'concrete' || kind === 'ground' || kind === 'stairs' || kind === 'pergola' || kind === 'door') {
      var texture = loadConcreteTexture(repeatX, repeatY);
      if (texture) {
        matConfig.map = texture;
        // Use texture as bump map for surface detail
        matConfig.bumpMap = texture;
        matConfig.bumpScale = spec.bumpScale || 0.01;
        // Also use as normal map for better lighting response
        if (spec.normalScale) {
          matConfig.normalMap = texture;
          matConfig.normalScale = new THREE.Vector2(spec.normalScale, spec.normalScale);
        }
      }
    }
    
    // Add clearcoat for glossy surfaces
    if (spec.clearcoat !== undefined) {
      matConfig.clearcoat = spec.clearcoat;
      matConfig.clearcoatRoughness = spec.clearcoatRoughness || 0.1;
    }
    
    // Add sheen for fabric-like or velvet surfaces
    if (spec.sheen !== undefined) {
      matConfig.sheen = spec.sheen;
      if (spec.sheenColor) {
        matConfig.sheenColor = new THREE.Color(spec.sheenColor);
      }
      matConfig.sheenRoughness = spec.sheenRoughness || 0.5;
    }
    
    // Specular intensity for non-metallic highlights
    if (spec.specularIntensity !== undefined) {
      matConfig.specularIntensity = spec.specularIntensity;
    }
    
    // Handle transmission for glass/water
    if (spec.transmission) {
      matConfig.transmission = spec.transmission;
      matConfig.thickness = spec.thickness || 0.1;
      matConfig.ior = spec.ior || 1.45;
      matConfig.transparent = true;
      matConfig.opacity = 1.0;
      matConfig.depthWrite = false;  // Better glass rendering
    }
    
    // Handle reflectivity
    if (spec.reflectivity !== undefined) {
      matConfig.reflectivity = spec.reflectivity;
    }
    
    var mat = new THREE.MeshPhysicalMaterial(matConfig);

    mat.needsUpdate = true;
    return mat;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LIGHTING SETUP - ENHANCED
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
    var shadowSoftness = preset.shadowSoftness || 3;
    var ambientIntensity = preset.ambientIntensity || 0.45;
    var fillIntensity = preset.fillIntensity || 0.6;

    // 1. Ambient base - subtle base illumination
    var ambient = new THREE.AmbientLight(0xf0f4f8, ambientIntensity);
    scene.add(ambient);
    lights.push(ambient);

    // 2. Hemisphere light for sky/ground color bounce - enhanced
    var skyColor = new THREE.Color(0xb8d4f0);  // Cooler sky
    var groundColor = new THREE.Color(0x907050);  // Warmer ground bounce
    if (preset.warmth > 0) {
      skyColor.lerp(new THREE.Color(0xfff0d0), preset.warmth);
    } else if (preset.warmth < 0) {
      skyColor.lerp(new THREE.Color(0xa0c0e0), -preset.warmth);
    }
    var hemi = new THREE.HemisphereLight(skyColor, groundColor, 0.65);
    hemi.position.set(centerX, centerY + effectiveSpan * 5, centerZ);
    scene.add(hemi);
    lights.push(hemi);

    // 3. Key light (sun) - main shadow caster with high quality shadows
    var sunAngleRad = (preset.angle || 45) * Math.PI / 180;
    var keyLight = new THREE.DirectionalLight(preset.sunColor || 0xffffff, preset.intensity || 2.5);
    keyLight.position.set(
      centerX + effectiveSpan * 4 * Math.cos(sunAngleRad),
      centerY + effectiveSpan * 6,
      centerZ + effectiveSpan * 4 * Math.sin(sunAngleRad)
    );
    keyLight.target.position.set(centerX, centerY * 0.3, centerZ);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(4096, 4096);  // High resolution shadows
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.normalBias = 0.03;
    keyLight.shadow.radius = shadowSoftness;
    keyLight.shadow.blurSamples = 16;  // Softer shadow edges

    // Shadow camera covers entire scene with padding
    var shadowExtent = effectiveSpan * 5;
    keyLight.shadow.camera.left = -shadowExtent;
    keyLight.shadow.camera.right = shadowExtent;
    keyLight.shadow.camera.top = shadowExtent;
    keyLight.shadow.camera.bottom = -shadowExtent;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = effectiveSpan * 20;

    scene.add(keyLight);
    scene.add(keyLight.target);
    lights.push(keyLight);
    lights.push(keyLight.target);

    // 4. Fill light - cooler tone from opposite side for depth
    var fillColor = new THREE.Color(0xc8e0f8);
    if (preset.warmth > 0) fillColor.lerp(new THREE.Color(0xf8e8d8), preset.warmth * 0.5);
    var fillLight = new THREE.DirectionalLight(fillColor, fillIntensity * 0.9);
    fillLight.position.set(centerX - effectiveSpan * 3.5, centerY + effectiveSpan * 2.5, centerZ - effectiveSpan * 2.5);
    fillLight.target.position.set(centerX, centerY * 0.4, centerZ);
    fillLight.castShadow = false;
    scene.add(fillLight);
    scene.add(fillLight.target);
    lights.push(fillLight);
    lights.push(fillLight.target);

    // 5. Back/rim light for edge definition and separation
    var rimColor = new THREE.Color(0xfff8f0);
    var rimLight = new THREE.DirectionalLight(rimColor, 0.65);
    rimLight.position.set(centerX + effectiveSpan * 2.5, centerY + effectiveSpan * 4, centerZ - effectiveSpan * 4);
    rimLight.target.position.set(centerX, centerY, centerZ);
    rimLight.castShadow = false;
    scene.add(rimLight);
    scene.add(rimLight.target);
    lights.push(rimLight);
    lights.push(rimLight.target);

    // 6. Ground bounce light - simulates light reflecting off ground
    var bounceColor = new THREE.Color(0xf0e8dc);
    var bounceLight = new THREE.DirectionalLight(bounceColor, 0.35);
    bounceLight.position.set(centerX, centerY - effectiveSpan * 0.5, centerZ);
    bounceLight.target.position.set(centerX, centerY + effectiveSpan * 2, centerZ);
    bounceLight.castShadow = false;
    scene.add(bounceLight);
    scene.add(bounceLight.target);
    lights.push(bounceLight);
    lights.push(bounceLight.target);

    // 7. Accent spot light for architectural highlight
    var accentLight = new THREE.SpotLight(0xffffff, 0.75);
    accentLight.position.set(centerX - effectiveSpan * 1.5, centerY + effectiveSpan * 5, centerZ + effectiveSpan * 1.5);
    accentLight.target.position.set(centerX, centerY * 0.5, centerZ);
    accentLight.angle = Math.PI / 6;
    accentLight.penumbra = 0.95;
    accentLight.decay = 1.8;
    accentLight.castShadow = true;
    accentLight.shadow.mapSize.set(2048, 2048);
    accentLight.shadow.bias = -0.0002;
    accentLight.shadow.radius = 2;
    scene.add(accentLight);
    scene.add(accentLight.target);
    lights.push(accentLight);
    lights.push(accentLight.target);
    
    // 8. Secondary accent for depth
    var accent2 = new THREE.SpotLight(0xf0f8ff, 0.45);
    accent2.position.set(centerX + effectiveSpan * 2, centerY + effectiveSpan * 3.5, centerZ + effectiveSpan * 2);
    accent2.target.position.set(centerX, 0, centerZ);
    accent2.angle = Math.PI / 5;
    accent2.penumbra = 0.85;
    accent2.decay = 2.0;
    accent2.castShadow = false;
    scene.add(accent2);
    scene.add(accent2.target);
    lights.push(accent2);
    lights.push(accent2.target);
    
    // 9. Subtle point light for interior glow simulation
    var interiorGlow = new THREE.PointLight(0xfff8e8, 0.25, effectiveSpan * 3);
    interiorGlow.position.set(centerX, centerY + 1.5, centerZ);
    interiorGlow.castShadow = false;
    scene.add(interiorGlow);
    lights.push(interiorGlow);
    
    console.log('[Photoreal] Enhanced lighting setup:', preset.name, '- 9 lights configured');
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

    // Create enhanced procedural HDR-like studio environment
    pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    var studio = new THREE.Scene();
    
    // Gradient sky background for more natural reflections
    var skyColor = new THREE.Color(0xdbe8f4);
    var groundColor = new THREE.Color(0xf4f0ec);
    studio.background = new THREE.Color(0xf8f9fa);

    // Add light emitters for environment reflections - more nuanced
    function addEmitter(w, h, pos, rot, color, intensity){
      var c = new THREE.Color(color || 0xffffff);
      c.multiplyScalar(intensity || 1);
      var mat = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      plane.position.copy(pos);
      if (rot) plane.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
      studio.add(plane);
    }
    
    // Main key light reflection (sun area)
    addEmitter(120, 120, new THREE.Vector3(90, 100, 90), { x: -Math.PI/3, y: Math.PI/4 }, 0xfffef8, 4.5);
    
    // Cool fill from opposite side
    addEmitter(100, 100, new THREE.Vector3(-85, 90, 50), { x: -Math.PI/3.5, y: -Math.PI/4 }, 0xe8f4ff, 2.5);
    
    // Back light area
    addEmitter(90, 90, new THREE.Vector3(10, 90, -95), { x: Math.PI/3.5, y: 0 }, 0xfff8f0, 3.0);
    
    // Ground reflection (warm bounce)
    addEmitter(200, 200, new THREE.Vector3(0, -30, 0), { x: Math.PI/2, y: 0 }, 0xf8f0e8, 1.5);
    
    // Subtle side accents
    addEmitter(60, 80, new THREE.Vector3(-100, 50, -30), { x: -Math.PI/5, y: -Math.PI/3 }, 0xf0f8ff, 1.8);
    addEmitter(60, 80, new THREE.Vector3(100, 50, -50), { x: -Math.PI/5, y: Math.PI/3 }, 0xfff4e8, 1.8);
    
    // Sky dome simulation - gradient from horizon to zenith
    var skyGeom = new THREE.SphereGeometry(200, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    var skyMat = new THREE.MeshBasicMaterial({
      color: 0xd0e4f8,
      side: THREE.BackSide
    });
    var sky = new THREE.Mesh(skyGeom, skyMat);
    sky.position.set(0, 0, 0);
    studio.add(sky);

    envRT = pmremGenerator.fromScene(studio, 0.015);
    scene.environment = envRT.texture;
    
    console.log('[Photoreal] Enhanced HDR-like environment created');
    
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

    // Gather wall strips with their openings (windows/doors)
    // Skip walls that are part of room perimeters (rooms are already solid boxes)
    // Only include walls that have openings OR are standalone (not from room perimeters)
    if (Array.isArray(window.wallStrips)) {
      // Build a set of room perimeter edges to filter out
      var roomEdges = {};
      if (Array.isArray(rawRooms)) {
        rawRooms.forEach(function(r) {
          if (!r) return;
          var hw = (r.width || 4) / 2;
          var hd = (r.depth || 4) / 2;
          var cx = r.x || 0;
          var cz = r.z || 0;
          var lv = r.level || 0;
          // 4 edges of the room bbox
          var edges = [
            [cx - hw, cz - hd, cx + hw, cz - hd], // front
            [cx + hw, cz - hd, cx + hw, cz + hd], // right
            [cx + hw, cz + hd, cx - hw, cz + hd], // back
            [cx - hw, cz + hd, cx - hw, cz - hd]  // left
          ];
          edges.forEach(function(e) {
            var key = lv + ':' + [e[0], e[1], e[2], e[3]].map(function(v) { return Math.round(v * 100); }).join(',');
            var keyRev = lv + ':' + [e[2], e[3], e[0], e[1]].map(function(v) { return Math.round(v * 100); }).join(',');
            roomEdges[key] = true;
            roomEdges[keyRev] = true;
          });
        });
      }
      
      data.walls = window.wallStrips.filter(function(w) {
        if (!w) return false;
        // Always include walls with openings (we need to render windows/doors)
        if (Array.isArray(w.openings) && w.openings.length > 0) return true;
        // Skip walls that match room perimeter edges (they're already rendered as room boxes)
        var x0 = w.x0 || 0, z0 = w.z0 || 0, x1 = w.x1 || 0, z1 = w.z1 || 0;
        var lv = w.level || 0;
        var key = lv + ':' + [x0, z0, x1, z1].map(function(v) { return Math.round(v * 100); }).join(',');
        if (roomEdges[key]) return false;
        // Include standalone walls
        return true;
      }).map(function(w){
        // Check if this wall is a room perimeter edge
        var x0 = w.x0 || 0, z0 = w.z0 || 0, x1 = w.x1 || 0, z1 = w.z1 || 0;
        var lv = w.level || 0;
        var key = lv + ':' + [x0, z0, x1, z1].map(function(v) { return Math.round(v * 100); }).join(',');
        var isRoomPerimeter = !!roomEdges[key];
        
        return {
          x0: w.x0 || w.start?.x || 0,
          z0: w.z0 || w.start?.z || 0,
          x1: w.x1 || w.end?.x || 0,
          z1: w.z1 || w.end?.z || 0,
          height: w.height || 3,
          thickness: w.thickness || 0.25,
          level: w.level || 0,
          openings: Array.isArray(w.openings) ? w.openings : [],
          isRoomPerimeter: isRoomPerimeter
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
    var groundGeom = new THREE.PlaneGeometry(groundSize, groundSize, 32, 32);
    var groundMat = materialFor('ground', groundSize, groundSize);
    var ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(bounds.cx, 0, bounds.cz);
    ground.receiveShadow = true;
    ground.name = 'GroundPlane';
    sceneRoot.add(ground);
    
    console.log('[Photoreal] Ground plane:', groundSize, 'x', groundSize, 'at', bounds.cx, bounds.cz);

    // Build rooms as detailed concrete boxes with beveled edges
    console.log('[Photoreal] Building', data.rooms.length, 'rooms into scene');
    data.rooms.forEach(function(room, idx){
      // Create room geometry with segments for better lighting
      var geom = new THREE.BoxGeometry(room.width, room.height, room.depth, 4, 4, 4);
      var mat = materialFor('wall', room.width, room.height);
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
      mesh.name = 'Room_' + idx;
      sceneRoot.add(mesh);

      // Add subtle edge lines for architectural definition
      var edges = new THREE.EdgesGeometry(geom, 25);
      var edgeMat = new THREE.LineBasicMaterial({ 
        color: 0x404040, 
        linewidth: 1,
        transparent: true,
        opacity: 0.6
      });
      var edgeMesh = new THREE.LineSegments(edges, edgeMat);
      edgeMesh.position.copy(mesh.position);
      edgeMesh.rotation.copy(mesh.rotation);
      edgeMesh.name = 'RoomEdges_' + idx;
      sceneRoot.add(edgeMesh);
      
      // Add a subtle base/plinth for grounding
      var plinthGeom = new THREE.BoxGeometry(room.width + 0.1, 0.05, room.depth + 0.1);
      var plinthMat = materialFor('stairs', room.width, room.depth);
      var plinth = new THREE.Mesh(plinthGeom, plinthMat);
      plinth.position.set(posX, baseY + 0.025, posZ);
      if (room.rotation) plinth.rotation.y = (room.rotation * Math.PI) / 180;
      plinth.receiveShadow = true;
      plinth.name = 'RoomPlinth_' + idx;
      sceneRoot.add(plinth);
    });

    // Build wall strips with windows and doors
    data.walls.forEach(function(wall, wallIdx){
      var dx = wall.x1 - wall.x0;
      var dz = wall.z1 - wall.z0;
      var length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.1) return;

      var cx = (wall.x0 + wall.x1) / 2;
      var cz = (wall.z0 + wall.z1) / 2;
      var baseY = (wall.level || 0) * wall.height;
      var angle = Math.atan2(dz, dx);
      var wallHeight = wall.height || 3;
      var wallThickness = wall.thickness || 0.25;
      var openings = wall.openings || [];
      
      // Check if this wall is part of a room perimeter
      var isRoomWall = wall.isRoomPerimeter === true;
      
      // If no openings and not a room wall, build simple wall
      if (openings.length === 0) {
        var geom = new THREE.BoxGeometry(length, wallHeight, wallThickness, 4, 4, 1);
        var mat = materialFor('wall', length, wallHeight);
        var mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(cx, baseY + wallHeight / 2, cz);
        mesh.rotation.y = -angle;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = 'Wall_' + wallIdx;
        sceneRoot.add(mesh);
        return;
      }
      
      // Build wall segments around openings
      // First, calculate opening positions along wall in local coordinates
      var wallDir = { x: dx / length, z: dz / length };
      var sortedOpenings = [];
      
      openings.forEach(function(op, opIdx) {
        if (!op) return;
        // Calculate opening position along wall length (0 to length)
        var opX0 = op.x0 !== undefined ? op.x0 : wall.x0;
        var opZ0 = op.z0 !== undefined ? op.z0 : wall.z0;
        var opX1 = op.x1 !== undefined ? op.x1 : wall.x1;
        var opZ1 = op.z1 !== undefined ? op.z1 : wall.z1;
        
        // Project onto wall direction
        var t0 = ((opX0 - wall.x0) * wallDir.x + (opZ0 - wall.z0) * wallDir.z);
        var t1 = ((opX1 - wall.x0) * wallDir.x + (opZ1 - wall.z0) * wallDir.z);
        if (t0 > t1) { var tmp = t0; t0 = t1; t1 = tmp; }
        
        var sillM = op.sillM !== undefined ? op.sillM : 0.9;
        var heightM = op.heightM !== undefined ? op.heightM : 1.5;
        var isDoor = op.type === 'door';
        
        if (isDoor) {
          sillM = 0;
          heightM = op.heightM !== undefined ? op.heightM : 2.1;
        }
        
        sortedOpenings.push({
          start: Math.max(0, t0),
          end: Math.min(length, t1),
          sill: sillM,
          height: heightM,
          type: op.type || 'window',
          idx: opIdx
        });
      });
      
      // Sort openings by start position
      sortedOpenings.sort(function(a, b) { return a.start - b.start; });
      
      // Build wall group - position at wall start, not center, for easier local coords
      var wallGroup = new THREE.Group();
      wallGroup.position.set(wall.x0, 0, wall.z0);
      wallGroup.rotation.y = -angle;
      wallGroup.name = 'WallGroup_' + wallIdx;
      
      // Helper to add wall segment (only for standalone walls, not room perimeters)
      function addWallSegment(startX, endX, startY, endY) {
        // Skip wall segments for room perimeter walls - room boxes already have the solid walls
        if (isRoomWall) return;
        
        var segWidth = endX - startX;
        var segHeight = endY - startY;
        if (segWidth < 0.01 || segHeight < 0.01) return;
        
        var geom = new THREE.BoxGeometry(segWidth, segHeight, wallThickness, 2, 2, 1);
        var mat = materialFor('wall', segWidth, segHeight);
        var mesh = new THREE.Mesh(geom, mat);
        
        var localX = startX + segWidth / 2;
        var localY = baseY + startY + segHeight / 2;
        mesh.position.set(localX, localY, 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        wallGroup.add(mesh);
      }
      
      // Build wall with openings
      var currentX = 0;
      
      sortedOpenings.forEach(function(op) {
        // Wall segment before opening
        if (op.start > currentX + 0.01) {
          addWallSegment(currentX, op.start, 0, wallHeight);
        }
        
        // Wall below opening (sill)
        if (op.sill > 0.01) {
          addWallSegment(op.start, op.end, 0, op.sill);
        }
        
        // Wall above opening
        var topOfOpening = op.sill + op.height;
        if (topOfOpening < wallHeight - 0.01) {
          addWallSegment(op.start, op.end, topOfOpening, wallHeight);
        }
        
        // Add window glass and frame for windows
        if (op.type === 'window') {
          var winWidth = op.end - op.start;
          var winHeight = op.height;
          var winCenterX = op.start + winWidth / 2; // Local X from wall start
          var winCenterY = baseY + op.sill + winHeight / 2;
          var frameThickness = 0.05; // 50mm thick frames
          
          // Glass pane - blue tinted with reflections
          var glassMat = materialFor('glass');
          var glassGeom = new THREE.BoxGeometry(winWidth - frameThickness * 2, winHeight - frameThickness * 2, 0.006);
          var glassMesh = new THREE.Mesh(glassGeom, glassMat);
          glassMesh.position.set(winCenterX, winCenterY, 0);
          glassMesh.name = 'WindowGlass';
          glassMesh.renderOrder = 1; // Render glass after opaque objects
          wallGroup.add(glassMesh);
          
          // Window frame - white wood
          var frameMat = materialFor('windowFrame');
          
          // Top frame - 50mm thick
          var topFrame = new THREE.Mesh(
            new THREE.BoxGeometry(winWidth + frameThickness, frameThickness, wallThickness * 0.7),
            frameMat
          );
          topFrame.position.set(winCenterX, winCenterY + winHeight / 2 - frameThickness / 2, 0);
          topFrame.castShadow = true;
          topFrame.receiveShadow = true;
          wallGroup.add(topFrame);
          
          // Bottom frame (sill) - 50mm thick, slightly deeper
          var bottomFrame = new THREE.Mesh(
            new THREE.BoxGeometry(winWidth + frameThickness * 2, frameThickness * 1.5, wallThickness * 0.9),
            frameMat
          );
          bottomFrame.position.set(winCenterX, winCenterY - winHeight / 2 + frameThickness / 2, wallThickness * 0.15);
          bottomFrame.castShadow = true;
          bottomFrame.receiveShadow = true;
          wallGroup.add(bottomFrame);
          
          // Left frame - 50mm thick
          var leftFrame = new THREE.Mesh(
            new THREE.BoxGeometry(frameThickness, winHeight, wallThickness * 0.7),
            frameMat
          );
          leftFrame.position.set(winCenterX - winWidth / 2 + frameThickness / 2, winCenterY, 0);
          leftFrame.castShadow = true;
          leftFrame.receiveShadow = true;
          wallGroup.add(leftFrame);
          
          // Right frame - 50mm thick
          var rightFrame = new THREE.Mesh(
            new THREE.BoxGeometry(frameThickness, winHeight, wallThickness * 0.7),
            frameMat
          );
          rightFrame.position.set(winCenterX + winWidth / 2 - frameThickness / 2, winCenterY, 0);
          rightFrame.castShadow = true;
          rightFrame.receiveShadow = true;
          wallGroup.add(rightFrame);
          
          // Center mullion for larger windows
          if (winWidth > 1.2) {
            var mullion = new THREE.Mesh(
              new THREE.BoxGeometry(frameThickness, winHeight - frameThickness * 2, wallThickness * 0.5),
              frameMat
            );
            mullion.position.set(winCenterX, winCenterY, 0);
            mullion.castShadow = true;
            wallGroup.add(mullion);
          }
          
          // Horizontal transom bar for taller windows
          if (winHeight > 1.5) {
            var transom = new THREE.Mesh(
              new THREE.BoxGeometry(winWidth - frameThickness * 2, frameThickness * 0.6, wallThickness * 0.4),
              frameMat
            );
            transom.position.set(winCenterX, winCenterY, 0);
            transom.castShadow = true;
            wallGroup.add(transom);
          }
        }
        
        currentX = op.end;
      });
      
      // Wall segment after last opening
      if (currentX < length - 0.01) {
        addWallSegment(currentX, length, 0, wallHeight);
      }
      
      sceneRoot.add(wallGroup);
    });

    // Build roofs - white plastic flat roofs with edge trim
    data.roofs.forEach(function(roof, idx){
      var roofWidth = roof.width + 0.5;
      var roofDepth = roof.depth + 0.5;
      var roofHeight = roof.height || 0.25;
      var edgeThickness = 0.08;
      
      // Main roof surface - white plastic
      var geom = new THREE.BoxGeometry(roofWidth, roofHeight, roofDepth, 2, 1, 2);
      var mat = materialFor('roof', roofWidth, roofDepth);
      var mesh = new THREE.Mesh(geom, mat);
      
      var roofY = (roof.baseHeight || 3) + roofHeight / 2;
      mesh.position.set(roof.x, roofY, roof.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'Roof_' + idx;
      sceneRoot.add(mesh);
      
      // Add edge trim around the roof perimeter
      var edgeMat = materialFor('roofEdge');
      
      // Front edge
      var frontEdge = new THREE.Mesh(
        new THREE.BoxGeometry(roofWidth + edgeThickness * 2, roofHeight + 0.05, edgeThickness),
        edgeMat
      );
      frontEdge.position.set(roof.x, roofY, roof.z + roofDepth / 2 + edgeThickness / 2);
      frontEdge.castShadow = true;
      frontEdge.receiveShadow = true;
      sceneRoot.add(frontEdge);
      
      // Back edge
      var backEdge = new THREE.Mesh(
        new THREE.BoxGeometry(roofWidth + edgeThickness * 2, roofHeight + 0.05, edgeThickness),
        edgeMat
      );
      backEdge.position.set(roof.x, roofY, roof.z - roofDepth / 2 - edgeThickness / 2);
      backEdge.castShadow = true;
      backEdge.receiveShadow = true;
      sceneRoot.add(backEdge);
      
      // Left edge
      var leftEdge = new THREE.Mesh(
        new THREE.BoxGeometry(edgeThickness, roofHeight + 0.05, roofDepth),
        edgeMat
      );
      leftEdge.position.set(roof.x - roofWidth / 2 - edgeThickness / 2, roofY, roof.z);
      leftEdge.castShadow = true;
      leftEdge.receiveShadow = true;
      sceneRoot.add(leftEdge);
      
      // Right edge
      var rightEdge = new THREE.Mesh(
        new THREE.BoxGeometry(edgeThickness, roofHeight + 0.05, roofDepth),
        edgeMat
      );
      rightEdge.position.set(roof.x + roofWidth / 2 + edgeThickness / 2, roofY, roof.z);
      rightEdge.castShadow = true;
      rightEdge.receiveShadow = true;
      sceneRoot.add(rightEdge);
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
      
      // Step 1b: Load post-processing modules
      setLoading(true, 'Loading rendering effects…');
      setStatus('Loading post-processing modules…', 'info');
      await loadPostProcessingModules();
      
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

      // Step 8b: Setup post-processing pipeline
      setLoading(true, 'Setting up post-processing…');
      setStatus('Configuring post-processing effects…', 'info');
      await delay(30);
      
      var postComposer = setupPostProcessing(renderWidth, renderHeight);

      setLoading(true, 'Rendering…');
      setStatus('Rendering photorealistic scene…', 'info');
      await delay(50);

      // Step 9: Render the scene with post-processing if available
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      renderer.clear(true, true, true);

      if (postComposer) {
        console.log('[Photoreal] Rendering with post-processing');
        // First pass to build shadow maps
        renderer.render(scene, camera);
        
        // Multiple passes for shadow quality
        for (var pass = 0; pass < 3; pass++) {
          renderer.shadowMap.needsUpdate = true;
          renderer.render(scene, camera);
          await delay(16);
        }
        
        // Final render with post-processing
        postComposer.render();
      } else {
        console.log('[Photoreal] Rendering without post-processing');
        renderer.render(scene, camera);
        
        // Perform multiple render passes for shadow quality
        for (var pass = 0; pass < 3; pass++) {
          renderer.shadowMap.needsUpdate = true;
          renderer.render(scene, camera);
          await delay(16);
        }
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
