(function(){
  // Visualize modal: high-end render preview via three.js with Fabric.js annotations.
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
  var currentQuality = 1;
  var lastHash = null;
  var viewIndex = 0;
  var VIEW_PRESETS = [];
  var viewButtons = [];
  var skyTexture = null;
  var skyGradientPalette = null;
  var galleryShots = [];
  var galleryShotMap = Object.create(null);
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
  var resizeHooked = false;
  var resizeObserver = null;

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

  function numberFromKeys(source, keys, fallback){
    if (!source) return fallback || 0;
    for (var i = 0; i < keys.length; i++){
      var key = keys[i];
      if (isFiniteNumber(source[key])) return Number(source[key]);
    }
    return fallback || 0;
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
    if (skyTexture) return skyTexture;
    if (!THREE) return null;
    // Simple, clean gradient for engineering view - no clouds, no sun orb
    var canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 512;
    var ctx = canvas.getContext('2d');
    
    var gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#f1f5f9');     // Zenith: Very light grey/white
    gradient.addColorStop(1, '#cbd5e1');     // Horizon: Soft slate grey
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 512);

    var tex = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    skyTexture = tex;
    return tex;
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
    var randomFn = mulberry32(seed);
    return {
      reseed: function(str){
        if (!str) str = String(Date.now());
        var hash = 0;
        for (var i = 0; i < str.length; i++){
          hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
        }
        if (hash === 0) hash = 1;
        seed = hash >>> 0;
        randomFn = mulberry32(seed);
      },
      next: function(){ return randomFn(); },
      range: function(min, max){
        if (!isFiniteNumber(min)) min = 0;
        if (!isFiniteNumber(max)) max = 1;
        return min + (max - min) * randomFn();
      }
    };
  }

  function getMaterialExposureJitter(kind){
    var key = kind || 'default';
    if (Object.prototype.hasOwnProperty.call(materialExposureCache, key)) return materialExposureCache[key];
    var factor = 1;
    if (rng && typeof rng.range === 'function') {
      factor = rng.range(0.92, 1.08);
    }
    materialExposureCache[key] = factor;
    return factor;
  }

  function clampColor(value){
    return Math.max(0, Math.min(255, value));
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
    if (window.THREE && window.fabric) return Promise.resolve();
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

    var staticBase = '';
    try {
      if (typeof window.__VISUALIZE_STATIC_BASE === 'string') {
        staticBase = window.__VISUALIZE_STATIC_BASE.trim();
      }
    } catch(_s){}

    function resolveLocal(path){
      if (!path) return path;
      if (/^(?:https?:)?\/\//i.test(path)) return path;
      if (staticBase) {
        return staticBase.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
      }
      if (path.charAt(0) === '/') return path;
      return path;
    }

    function loadEntry(entry, options){
      options = options || {};
      var sources = [];
      if (Array.isArray(entry)) {
        sources = entry.filter(Boolean).map(resolveLocal);
      } else if (entry) {
        sources = [resolveLocal(entry)];
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
      ['vendor/three/examples/js/shaders/BokehShader.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/shaders/BokehShader.js'],
      ['vendor/three/examples/js/postprocessing/BokehPass.js', 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/postprocessing/BokehPass.js']
    ];

    libsPromise = loadSequential(essentialScripts).then(function(){
      THREE = window.THREE;
      fabricRef = window.fabric;
      console.log('[Visualize] Core libraries ready');
      return loadSequential(optionalScripts, { optional: true }).then(function(){
        if (THREE && THREE.EffectComposer) {
          console.log('[Visualize] Post-processing extensions available');
        } else {
          console.warn('[Visualize] Post-processing extensions unavailable. Falling back to direct render.');
        }
      });
    }).catch(function(err){
      libsPromise = null;
      throw err;
    });
    return libsPromise;
  }

  function ensureRenderer(){
    if (renderer && scene && camera) return;
    var canvas = qs(CANVAS_ID);
    if (!canvas) return;

    if (composer && typeof composer.dispose === 'function') {
      try { composer.dispose(); } catch(_c){}
    }
    composer = null;
    
    // Ultra-realistic WebGL renderer with advanced settings
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
    
    // Explicitly use 1.0 pixel ratio since we set high-res dimensions manually (4K+)
    // This ensures exact alignment with Fabric.js overlay and consistent export size
    renderer.setPixelRatio(1.0);
    
    // Proper color management for photorealism
    if (THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    
    // Clear to sky blue for outdoor scenes
    renderer.setClearColor(0x87CEEB, 1);
    renderer.autoClear = false;
    
    // Physical lighting model
    if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;
    if ('physicallyCorrectLights' in renderer) renderer.physicallyCorrectLights = true;
    
    // Cinematic tone mapping with bright photorealistic exposure
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.8; // Bright like reference images
    
    // Ultra high quality soft shadows (8K resolution)
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    
    if (THREE.ColorManagement) THREE.ColorManagement.enabled = true;
    
    // Scene setup
    scene = new THREE.Scene();
    
    // Camera - professional architectural lens (24mm equivalent)
    camera = new THREE.PerspectiveCamera(50, 16/9, 0.1, 2000);
    camera.up.set(0, 1, 0);
    
    sceneRoot = new THREE.Group();
    scene.add(sceneRoot);
  }

  function ensurePostProcessing(width, height){
    if (!renderer || !THREE || !THREE.EffectComposer) return null;
    var w = width || (renderer.domElement ? renderer.domElement.width : 1920) || 1920;
    var h = height || (renderer.domElement ? renderer.domElement.height : 1080) || 1080;
    if (!composer){
      composer = new THREE.EffectComposer(renderer);
      var renderPass = new THREE.RenderPass(scene, camera);
      composer.addPass(renderPass);
      var ssaoPass = null;
      if (THREE.SSAOPass){
        ssaoPass = new THREE.SSAOPass(scene, camera, w, h);
        ssaoPass.kernelRadius = 18;
        ssaoPass.minDistance = 0.003;
        ssaoPass.maxDistance = 0.12;
        composer.addPass(ssaoPass);
      }
      var bloomPass = null;
      if (THREE.UnrealBloomPass){
        bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.15, 0.4, 0.85);
        bloomPass.threshold = 0.85;
        bloomPass.strength = 0.15; // Reduced from 0.42 to reduce fuzziness
        bloomPass.radius = 0.4;
        composer.addPass(bloomPass);
      }
      
      // Depth of Field (Bokeh)
      var bokehPass = null;
      if (THREE.BokehPass) {
        bokehPass = new THREE.BokehPass(scene, camera, {
          focus: 10.0,
          aperture: 0.0001, // Subtle DoF
          maxblur: 0.01,
          width: w,
          height: h
        });
        composer.addPass(bokehPass);
      }

      var copyPass = new THREE.ShaderPass(THREE.CopyShader);
      copyPass.renderToScreen = true;
      composer.addPass(copyPass);
      composer.__renderPass = renderPass;
      composer.__ssaoPass = ssaoPass;
      composer.__bloomPass = bloomPass;
      composer.__bokehPass = bokehPass;
      composer.__copyPass = copyPass;
    }
    try {
      composer.setSize(w, h);
      if (composer.__ssaoPass && composer.__ssaoPass.setSize) composer.__ssaoPass.setSize(w, h);
      if (composer.__bloomPass && composer.__bloomPass.setSize) composer.__bloomPass.setSize(w, h);
      if (composer.__bokehPass && composer.__bokehPass.setSize) composer.__bokehPass.setSize(w, h);
    } catch(err){
      console.warn('[Visualize] Unable to resize composer', err);
    }
    return composer;
  }

  function renderSceneWithPostFX(width, height){
    if (!renderer) return;
    var w = width || lastCanvasWidth || (renderer.domElement ? renderer.domElement.width : 0) || 1920;
    var h = height || lastCanvasHeight || (renderer.domElement ? renderer.domElement.height : 0) || 1080;
    var useComposer = null;
    try {
      useComposer = ensurePostProcessing(w, h);
    } catch(err){
      console.warn('[Visualize] Post-processing unavailable, falling back to direct render', err);
    }
    if (useComposer){
      if (useComposer.__renderPass){
        useComposer.__renderPass.scene = scene;
        useComposer.__renderPass.camera = camera;
      }
      if (useComposer.__ssaoPass){
        useComposer.__ssaoPass.scene = scene;
        useComposer.__ssaoPass.camera = camera;
      }
      // Update DoF focus based on camera target distance
      if (composer && composer.__bokehPass) {
        var focusDist = 10;
        if (camera && VIEW_PRESETS[viewIndex] && VIEW_PRESETS[viewIndex].target) {
          focusDist = camera.position.distanceTo(VIEW_PRESETS[viewIndex].target);
        } else {
          // Fallback: raycast to center
          var raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
          var intersects = raycaster.intersectObjects(scene.children, true);
          if (intersects.length > 0) {
            focusDist = intersects[0].distance;
          }
        }
        composer.__bokehPass.uniforms['focus'].value = focusDist;
        composer.__bokehPass.uniforms['aperture'].value = 0.00005 * currentQuality; // Adjust aperture based on quality
        composer.__bokehPass.uniforms['maxblur'].value = 0.015;
      }

      useComposer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  function clearLighting(){
    if (!scene) return;
    for (var i=0; i<lights.length; i++){
      var light = lights[i];
      if (!light) continue;
      scene.remove(light);
      if (light.target) scene.remove(light.target);
      try {
        if (light.shadow && light.shadow.map) light.shadow.map.dispose();
      } catch(_s){}
      try { if (light.dispose) light.dispose(); } catch(_d){}
    }
    lights = [];
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

  function ensureFog(span){
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
    var data = image.data;
    for (var y = 0; y < size; y++){
      for (var x = 0; x < size; x++){
        var idx = (y * size + x) * 4;
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
    if (!renderer) return;
    if (envRT) {
      scene.environment = envRT.texture;
      return;
    }
    
    // Professional HDR environment for photorealistic rendering
    pmremGenerator = pmremGenerator || new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
    // Create procedural HDR environment
    var studio = new THREE.Scene();
    
    // Sky dome with realistic gradient - bright blue sky
    var skyCanvas = document.createElement('canvas');
    skyCanvas.width = 1024;
    skyCanvas.height = 512;
    var skyCtx = skyCanvas.getContext('2d');
    var skyGrad = skyCtx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#4A90D9');      // Deep blue at top
    skyGrad.addColorStop(0.3, '#87CEEB');    // Sky blue
    skyGrad.addColorStop(0.6, '#B0E0E6');    // Powder blue
    skyGrad.addColorStop(0.85, '#E6F3FF');   // Very light blue near horizon
    skyGrad.addColorStop(1.0, '#FFF8DC');    // Warm cream at horizon
    skyCtx.fillStyle = skyGrad;
    skyCtx.fillRect(0, 0, 1024, 512);
    
    // Add sun glow
    var sunGrad = skyCtx.createRadialGradient(750, 100, 0, 750, 100, 150);
    sunGrad.addColorStop(0, 'rgba(255,255,240,1)');
    sunGrad.addColorStop(0.1, 'rgba(255,250,220,0.9)');
    sunGrad.addColorStop(0.4, 'rgba(255,240,200,0.3)');
    sunGrad.addColorStop(1, 'rgba(255,240,200,0)');
    skyCtx.fillStyle = sunGrad;
    skyCtx.fillRect(0, 0, 1024, 512);
    
    var skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    
    var domeMat = new THREE.MeshBasicMaterial({ 
      map: skyTex,
      side: THREE.BackSide 
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 32), domeMat);
    studio.add(dome);

    // Ground plane for reflections - warm concrete/grass tint
    var groundCanvas = document.createElement('canvas');
    groundCanvas.width = 512;
    groundCanvas.height = 512;
    var groundCtx = groundCanvas.getContext('2d');
    var groundGrad = groundCtx.createRadialGradient(256, 256, 0, 256, 256, 400);
    groundGrad.addColorStop(0, '#90A090');   // Greenish center (grass)
    groundGrad.addColorStop(0.5, '#A0A090'); // Transition
    groundGrad.addColorStop(1, '#B0A898');   // Warm edge
    groundCtx.fillStyle = groundGrad;
    groundCtx.fillRect(0, 0, 512, 512);
    
    var groundTex = new THREE.CanvasTexture(groundCanvas);
    var floorMat = new THREE.MeshBasicMaterial({ map: groundTex });
    var floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1;
    studio.add(floor);

    // Sun light emitter (very bright, warm)
    function addEmitter(width, height, position, rotation, colorHex, intensity){
      var color = new THREE.Color(colorHex || 0xffffff);
      color.multiplyScalar(intensity || 1);
      var mat = new THREE.MeshBasicMaterial({ color: color });
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.copy(position);
      if (rotation) plane.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
      studio.add(plane);
    }

    // Bright sun (key light)
    addEmitter(80, 80, new THREE.Vector3(200, 150, 100), { x: -0.5, y: -0.3 }, 0xFFFAF0, 8.0);
    
    // Sky fill (large soft)
    addEmitter(200, 150, new THREE.Vector3(0, 200, 0), { x: Math.PI/2 }, 0x87CEEB, 2.0);
    
    // Ground bounce (warm)
    addEmitter(300, 300, new THREE.Vector3(0, -50, 0), { x: -Math.PI/2 }, 0xE8DCC8, 0.8);

    envRT = pmremGenerator.fromScene(studio, 0.02);
    scene.environment = envRT.texture;
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
    ensureFog(span);

    // Engineering Studio Lighting - Neutral and Clean
    var hemi = trackLight(new THREE.HemisphereLight(0xffffff, 0xe0e0e0, 0.6));
    if (hemi) hemi.position.set(centerX, centerY + span * 5, centerZ);

    trackLight(new THREE.AmbientLight(0xffffff, 0.4));

    // Main Key Light (Sun) - Neutral White
    var sunDist = 3.5;
    var sun = trackLight(new THREE.DirectionalLight(0xffffff, 1.2));
    if (sun) {
      sun.position.set(
        centerX + span * 1.5,
        centerY + span * 3.0,
        centerZ + span * 2.0
      );
      sun.castShadow = true;
      if (sun.shadow && sun.shadow.camera) {
        sun.shadow.mapSize.set(4096, 4096);
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = Math.max(1000, span * 15);
        var extent = span * 2.5;
        sun.shadow.camera.left = -extent;
        sun.shadow.camera.right = extent;
        sun.shadow.camera.top = extent;
        sun.shadow.camera.bottom = -extent;
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 0.05;
        sun.shadow.radius = 2;
      }
      sun.target.position.set(centerX, centerY, centerZ);
    }

    // Fill Light - Soft Cool
    var fill = trackLight(new THREE.DirectionalLight(0xdbeafe, 0.5));
    if (fill) {
      fill.position.set(
        centerX - span * 2,
        centerY + span * 1.5,
        centerZ - span * 1.5
      );
      fill.target.position.set(centerX, centerY, centerZ);
    }

    // Rim Light - Sharp White for edge definition
    var rim = trackLight(new THREE.SpotLight(0xffffff, 0.8, span * 15, Math.PI / 5, 0.5, 1.5));
    if (rim) {
      rim.position.set(centerX - span * 0.5, centerY + span * 4.0, centerZ - span * 2.0);
      rim.target.position.set(centerX, centerY, centerZ);
    }
  }

  function createContactShadow(centerX, centerZ, span, groundY){
    var radius = Math.max(8, span * 1.05);
    var shadowGeom = new THREE.PlaneGeometry(radius, radius, 1, 1);
    var shadowMat = new THREE.MeshBasicMaterial({ map: radialShadowTexture('shadow-main', 0.42, 0.02), transparent: true, depthWrite: false, depthTest: true, opacity: 1 });
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
    mesh.position.set(center.x, 0, center.z);
    return mesh;
  }

  function buildWallMesh(strip, material){
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
    var stage = qs('visualize-stage');
    var wrap = qs('visualize-canvas-wrap');
    var renderCanvas = qs(CANVAS_ID);
    if (!stage || !wrap || !renderCanvas || !renderer || !camera) return;
    
    var stageWidth = stage.clientWidth;
    var stageHeight = stage.clientHeight;
    if (stageWidth <= 0 || stageHeight <= 0) return;

    // Calculate target aspect ratio based on stage dimensions
    var targetAspect = stageWidth / stageHeight;
    
    // Determine target resolution (keep high quality)
    var baseWidth = 3840;
    var multiplier = currentQuality || 1;
    var targetWidth = Math.floor(baseWidth * Math.max(1, multiplier));
    if (targetWidth > 7680) targetWidth = 7680;
    
    var targetHeight = Math.floor(targetWidth / targetAspect);
    
    // Check if we need to resize (tolerance to avoid jitter)
    var currentWidth = renderer.domElement.width;
    var currentHeight = renderer.domElement.height;
    
    // Only resize if dimensions changed significantly or aspect ratio is off
    if (Math.abs(currentWidth - targetWidth) > 2 || Math.abs(currentHeight - targetHeight) > 2) {
      renderer.setSize(targetWidth, targetHeight, false);
      camera.aspect = targetAspect;
      camera.updateProjectionMatrix();
      
      if (composer) {
        try {
          composer.setSize(targetWidth, targetHeight);
          if (composer.__ssaoPass && composer.__ssaoPass.setSize) composer.__ssaoPass.setSize(targetWidth, targetHeight);
          if (composer.__bloomPass && composer.__bloomPass.setSize) composer.__bloomPass.setSize(targetWidth, targetHeight);
        } catch(e) { console.warn('Composer resize failed', e); }
      }
      
      lastCanvasWidth = targetWidth;
      lastCanvasHeight = targetHeight;
      renderCanvas.width = targetWidth;
      renderCanvas.height = targetHeight;
      
      // Re-render scene
      renderSceneWithPostFX(targetWidth, targetHeight);
      
      // Update Fabric
      ensureFabric(targetWidth, targetHeight);
    }

    // CSS styling to fill the stage
    wrap.style.position = 'absolute';
    wrap.style.left = '0';
    wrap.style.top = '0';
    wrap.style.width = '100%';
    wrap.style.height = '100%';
    wrap.style.transform = 'none';
    wrap.style.margin = '0';
    
    renderCanvas.style.width = '100%';
    renderCanvas.style.height = '100%';
    
    var overlay = qs(FABRIC_ID);
    if (overlay) {
      overlay.style.width = '100%';
      overlay.style.height = '100%';
    }
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

  function addDefaultLabel(){
    if (!fabricCanvas || fabricCanvas.getObjects().length > 0) return;
    var label = new fabric.IText('Double-click to edit notes...', {
      left: 24,
      top: 24,
      fontSize: 28,
      fill: '#0f172a',
      fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif'
    });
    fabricCanvas.add(label);
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
          var desc = 'Camera preset ' + (i + 1);
          if (preset && preset.target) {
            var t = preset.target;
            desc = desc + ' - Focus (' + t.x.toFixed(1) + ', ' + t.y.toFixed(1) + ', ' + t.z.toFixed(1) + ')';
          }
          shots.push({
            id: 'preset-' + (i + 1),
            label: describePreset(i),
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
      // Clean, bright materials for photorealistic renders
      room: { 
        color: 0xFFFFFF, 
        roughness: 0.15, 
        metalness: 0.0, 
        envMapIntensity: 2.5,
        clearcoat: 0.4, 
        clearcoatRoughness: 0.1
      },
      garage: { 
        color: 0xF0F0E8, 
        roughness: 0.25, 
        metalness: 0.0, 
        envMapIntensity: 2.0,
        clearcoat: 0.2,
        clearcoatRoughness: 0.2
      },
      pergola: { 
        color: 0x9B8568, 
        roughness: 0.5, 
        metalness: 0.0, 
        envMapIntensity: 1.5
      },
      pool: { 
        color: 0x0080C8, 
        roughness: 0.01, 
        metalness: 0.0, 
        transmission: 0.96, 
        thickness: 2.0, 
        envMapIntensity: 5.0, 
        ior: 1.333, 
        clearcoat: 1.0, 
        clearcoatRoughness: 0.01,
        transparent: true,
        opacity: 0.3
      },
      roof: { 
        color: 0x3A3A3A, 
        roughness: 0.4, 
        metalness: 0.3, 
        envMapIntensity: 2.0,
        clearcoat: 0.3,
        clearcoatRoughness: 0.2
      },
      balcony: { 
        color: 0xFFFFFF, 
        roughness: 0.2, 
        metalness: 0.0, 
        envMapIntensity: 2.2,
        clearcoat: 0.3, 
        clearcoatRoughness: 0.15
      },
      furniture: { 
        color: 0xC8B896, 
        roughness: 0.4, 
        metalness: 0.0, 
        envMapIntensity: 1.6
      },
      wall: { 
        color: 0xFFFFFF, 
        roughness: 0.2, 
        metalness: 0.0, 
        envMapIntensity: 2.0,
        clearcoat: 0.25, 
        clearcoatRoughness: 0.2
      },
      roof: { 
        color: 0x2A2A2A, 
        roughness: 0.45, 
        metalness: 0.25, 
        envMapIntensity: 1.8, 
        needsTexture: true,
        clearcoat: 0.2,
        clearcoatRoughness: 0.3 
      },
      balcony: { 
        color: 0xF0F0E8, 
        roughness: 0.22, 
        metalness: 0.0, 
        envMapIntensity: 1.9, 
        needsTexture: true, 
        clearcoat: 0.28, 
        clearcoatRoughness: 0.18,
        reflectivity: 0.5
      },
      furniture: { 
        color: 0xC8B087, 
        roughness: 0.42, 
        metalness: 0.0, 
        envMapIntensity: 1.3, 
        needsTexture: true,
        sheen: 0.15,
        sheenColor: 0xE8D8C8
      },
      wall: { 
        color: 0xFFFFFD, 
        roughness: 0.25, 
        metalness: 0.0, 
        envMapIntensity: 1.6, 
        needsTexture: true, 
        clearcoat: 0.18, 
        clearcoatRoughness: 0.28,
        reflectivity: 0.4,
        sheen: 0.1,
        sheenColor: 0xFFFFFF
      },
      windowFrame: { color: 0x2A2A2A, roughness: 0.1, metalness: 0.95, envMapIntensity: 2.5, clearcoat: 0.6, clearcoatRoughness: 0.05 },
      doorFrame: { color: 0x333333, roughness: 0.15, metalness: 0.9, envMapIntensity: 2.2, clearcoat: 0.5, clearcoatRoughness: 0.1 },
      doorPanel: { color: 0x704830, roughness: 0.35, metalness: 0.0, envMapIntensity: 1.4 },
      glass: { color: 0xE8F4FF, roughness: 0.01, metalness: 0.0, transmission: 0.96, thickness: 0.1, transparent: true, opacity: 0.1, envMapIntensity: 3.0, ior: 1.52, clearcoat: 1.0, clearcoatRoughness: 0.01 },
      accentPanel: { color: 0xF0F0E8, roughness: 0.25, metalness: 0.0, envMapIntensity: 1.8 },
      groundPath: { color: 0xC0C0B8, roughness: 0.6, metalness: 0.0, envMapIntensity: 1.0 },
      woodAccent: { color: 0x6B5840, roughness: 0.5, metalness: 0.0, envMapIntensity: 1.2 },
      boulder: { color: 0x808078, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.8 },
      foliage: { color: 0x5A8A5A, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.7 }
    };
    var spec = palette[kind] || { color: 0xF0F0F0, roughness: 0.3, metalness: 0.0, envMapIntensity: 1.5 };
    
    // Use MeshPhysicalMaterial for clean photorealistic rendering
    var mat = new THREE.MeshPhysicalMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      envMapIntensity: spec.envMapIntensity || 1.0
    });
    
    // Concrete/Wall specific tweaks
    if (kind === 'wall') {
      // Photorealistic Concrete - Engineering Style
      mat.color.setHex(0x999999); // Neutral concrete
      mat.roughness = 0.95; // Matte finish
      mat.metalness = 0.0;
      mat.envMapIntensity = 0.2; // Low reflection
      mat.clearcoat = 0.0;
      mat.flatShading = false;
      
      // Add bump map for texture depth if noise texture is available
      // (Will be assigned later in the build process)
    } else {
      // Add clearcoat for glossy surfaces
      if (spec.clearcoat) {
        mat.clearcoat = spec.clearcoat;
        mat.clearcoatRoughness = spec.clearcoatRoughness || 0.1;
      }
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
    
    // Add procedural texture for materials that need it
    if (spec.needsTexture) {
      var texBrightness = kind === 'wall' ? 252 : (kind === 'room' ? 250 : 230);
      var texVariation = kind === 'wall' ? 4 : (kind === 'room' ? 6 : 15);
      var tex = noiseTexture(kind, texBrightness, texVariation, 6);
      if (tex) {
        mat.map = tex;
        mat.roughnessMap = tex;
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
    var dx = bounds.maxX - bounds.minX;
    var dz = bounds.maxZ - bounds.minZ;
    if (!isFinite(dx) || !isFinite(dz) || dx <= 0 || dz <= 0) {
      dx = dz = 12;
    }
    var footprint = Math.max(dx, dz, span);
    var groundY = (typeof baseY === 'number') ? baseY : 0;
    var padSize = Math.max(footprint * 4, 32);

    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    var ctx = canvas.getContext('2d');
    var baseColor = '#d9d6d1';
    var accentColor = '#c5c1ba';
    var gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
    gradient.addColorStop(0, baseColor);
    gradient.addColorStop(1, accentColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 1024);
    var noise = ctx.getImageData(0, 0, 1024, 1024);
    for (var i = 0; i < noise.data.length; i += 4){
      var jitter = (Math.random() - 0.5) * 8;
      noise.data[i] = Math.max(0, Math.min(255, noise.data[i] + jitter));
      noise.data[i + 1] = Math.max(0, Math.min(255, noise.data[i + 1] + jitter * 0.6));
      noise.data[i + 2] = Math.max(0, Math.min(255, noise.data[i + 2] + jitter * 0.3));
    }
    ctx.putImageData(noise, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (var l = 0; l < 20; l++){
      ctx.beginPath();
      ctx.moveTo(0, Math.random() * 1024);
      ctx.lineTo(1024, Math.random() * 1024);
      ctx.stroke();
    }

    var baseTex = new THREE.CanvasTexture(canvas);
    baseTex.wrapS = baseTex.wrapT = THREE.RepeatWrapping;
    baseTex.repeat.set(padSize / 18, padSize / 18);
    baseTex.anisotropy = renderer ? (renderer.capabilities.getMaxAnisotropy() || 16) : 16;
    baseTex.minFilter = THREE.LinearMipmapLinearFilter;
    baseTex.magFilter = THREE.LinearFilter;
    baseTex.generateMipmaps = true;
    if (THREE.SRGBColorSpace) baseTex.colorSpace = THREE.SRGBColorSpace;

    var padGeom = new THREE.PlaneGeometry(padSize, padSize, 1, 1);
    ensureSecondaryUV(padGeom);
    var padMat = new THREE.MeshStandardMaterial({
      map: baseTex,
      roughness: 0.9,
      metalness: 0.02,
      envMapIntensity: 0.4,
      color: 0xddddda
    });
    var pad = new THREE.Mesh(padGeom, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(centerX, groundY - 0.01, centerZ);
    pad.receiveShadow = true;
    registerMesh(pad, { castShadow: false, receiveShadow: true, skipEdges: true });

    return groundY;
  }

  function buildViewPresets(centerX, centerY, centerZ, span, bounds, focus){
    if (!THREE) return [];
    var presets = [];
    var safeSpan = Math.max(6, span || 6);
    var maxY = (bounds && isFiniteNumber(bounds.maxY)) ? bounds.maxY : (centerY + safeSpan * 0.5);
    var minY = (bounds && isFiniteNumber(bounds.minY)) ? bounds.minY : 0;
    var heightSpan = Math.max(2.6, maxY - minY);
    var radius = Math.max(8, safeSpan * 1.92);
    var focusX = (focus && isFiniteNumber(focus.x)) ? focus.x : centerX;
    var focusZ = (focus && isFiniteNumber(focus.z)) ? focus.z : centerZ;
    var focusY = (focus && isFiniteNumber(focus.y)) ? focus.y : (minY + heightSpan * 0.55);
    var orbitX = focusX;
    var orbitZ = focusZ;
    var orbitY = centerY;

    function pushPreset(angleDeg, options){
      var opts = options || {};
      var heightFactor = (opts.heightFactor != null) ? opts.heightFactor : 0.5;
      var distanceFactor = (opts.distanceFactor != null) ? opts.distanceFactor : 1.75;
      var tiltOffset = opts.tiltOffset != null ? opts.tiltOffset : 0;
      var fov = opts.fov || 42;
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
        far: Math.max(1000, dist * 8)
      });
    }

    pushPreset(42, { heightFactor: 0.52, distanceFactor: 1.95, tiltOffset: 0, fov: 48 });
    pushPreset(138, { heightFactor: 0.48, distanceFactor: 2.1, tiltOffset: 0.02, fov: 46 });
    pushPreset(85, { heightFactor: 0.42, distanceFactor: 2.3, tiltOffset: -0.08, fov: 52 });
    pushPreset(225, { heightFactor: 0.65, distanceFactor: 2.2, tiltOffset: 0.05, fov: 44 });
    pushPreset(315, { heightFactor: 0.35, distanceFactor: 2.6, tiltOffset: -0.12, fov: 58 });
    pushPreset(20, { heightFactor: 0.78, distanceFactor: 2.8, tiltOffset: 0.15, fov: 38 });
    pushPreset(180, { heightFactor: 0.45, distanceFactor: 1.8, tiltOffset: 0, fov: 50 });
    pushPreset(270, { heightFactor: 0.55, distanceFactor: 2.4, tiltOffset: 0.08, fov: 42 });
    pushPreset(110, { heightFactor: 0.32, distanceFactor: 2.9, tiltOffset: -0.15, fov: 62 });
    pushPreset(65, { heightFactor: 0.88, distanceFactor: 3.2, tiltOffset: 0.2, fov: 35 });
    pushPreset(200, { heightFactor: 0.28, distanceFactor: 3.0, tiltOffset: -0.18, fov: 65 });
    pushPreset(340, { heightFactor: 0.58, distanceFactor: 2.0, tiltOffset: 0.05, fov: 46 });
    pushPreset(180, { heightFactor: 0.55, distanceFactor: 2.0, tiltOffset: 0, fov: 50 });
    pushPreset(25, { heightFactor: 0.25, distanceFactor: 1.8, tiltOffset: -0.1, fov: 60 });
    pushPreset(45, { heightFactor: 0.7, distanceFactor: 3.0, tiltOffset: 0.05, fov: 65 });

    var topPos = new THREE.Vector3(
      orbitX + safeSpan * 0.1,
      maxY + safeSpan * 3,
      orbitZ + safeSpan * 0.5
    );
    presets.push({
      position: topPos,
      target: new THREE.Vector3(focusX, focusY, focusZ),
      up: new THREE.Vector3(0, 0, -1),
      fov: 55,
      near: 0.5,
      far: Math.max(1000, safeSpan * 15)
    });

    if (!presets.length) {
      var fallback = new THREE.Vector3(orbitX + safeSpan * 2, maxY + safeSpan * 0.8, orbitZ + safeSpan * 1.5);
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
      renderer.clear(true, true, true);
      renderSceneWithPostFX();
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
    if (loading) {
      loading.textContent = 'Generating...';
      loading.classList.add('visible');
    }
    try {
      var snapshot = gatherProjectSnapshot();
      var hash = computeHash(snapshot);
      if (rng && typeof rng.reseed === 'function') rng.reseed(hash);
      materialExposureCache = Object.create(null);
      skyTexture = null;
      skyGradientPalette = null;
      var qualitySelect = qs(QUALITY_ID);
      var multiplier = qualitySelect ? parseFloat(qualitySelect.value || '1') : 1;
      if (!isFinite(multiplier) || multiplier <= 0) multiplier = 1;
      currentQuality = multiplier;
      ensureRenderer();
      // Sky preset determines exposure for perfect lighting match
      var skyPreset = selectSkyPalette();
      if (renderer && typeof renderer.toneMappingExposure === 'number') {
        renderer.toneMappingExposure = skyPreset.exposure + (multiplier - 1) * 0.15;
      }
      ensureEnvironment();
      disposeSceneChildren();
      
      // Set sky as background - beautiful blue sky
      var backgroundTex = createSkyTexture();
      scene.background = backgroundTex;

      var bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      var boxes = gatherBoxes(snapshot);
      boxes.forEach(function(entry){ includeBounds(bounds, entry.box); });
      var primaryStructureEnvelope = computePrimaryStructureEnvelope(boxes);

      var wallMaterial = materialFor('wall');
      snapshot.wallStrips.forEach(function(strip){
        var mat = wallMaterial.clone();
        // High-frequency concrete grain for realism
        var tex = noiseTexture('wall-' + (strip.level || 0), 180, 30, 12); 
        mat.map = tex;
        mat.roughnessMap = tex;
        mat.bumpMap = tex;
        mat.bumpScale = 0.015; // Fine grain
        
        var result = buildWallMesh(strip, mat);
        includeBounds(bounds, { cx: result.midX, cz: result.midZ, width: result.len, depth: result.thickness, height: result.wallHeight, level: strip.level || 0 });
        if (Array.isArray(result.meshes) && result.meshes.length){
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

      boxes.forEach(function(entry){
        var mat = materialFor(entry.kind);
        var mesh = null;
        if (entry.kind === 'room' && entry.room) {
          mesh = buildRoomMeshFromRoom(entry.room, mat);
        }
        if (!mesh) {
          mesh = buildMesh(entry.box, mat);
        }
        registerMesh(mesh, { edgeColor: (entry.kind === 'roof' ? EDGE_COLORS.roof : EDGE_COLORS.default) });
        if (entry.kind === 'room') addArchitecturalAccents(entry);
      });

      if (!isFinite(bounds.minX)) {
        throw new Error('Nothing to visualize yet. Add rooms or structures first.');
      }

      var spanX = bounds.maxX - bounds.minX;
      var spanZ = bounds.maxZ - bounds.minZ;
      var span = Math.max(6, spanX, spanZ);
      var centerX = (bounds.minX + bounds.maxX) / 2;
      var centerY = Math.max(1.4, (bounds.minY + bounds.maxY) / 2);
      var centerZ = (bounds.minZ + bounds.maxZ) / 2;
      var structureEnvelope = computeRoomsEnvelope(snapshot.rooms);
      var focusCenter = null;
      if (structureEnvelope) {
        focusCenter = {
          x: structureEnvelope.centerX,
          y: centerY,
          z: structureEnvelope.centerZ
        };
      } else if (primaryStructureEnvelope) {
        focusCenter = {
          x: primaryStructureEnvelope.centerX,
          y: isFiniteNumber(primaryStructureEnvelope.centerY) ? primaryStructureEnvelope.centerY : centerY,
          z: primaryStructureEnvelope.centerZ
        };
      }
      var cameraFocus = focusCenter || { x: centerX, y: centerY, z: centerZ };
      var focusOriginX = isFiniteNumber(cameraFocus.x) ? cameraFocus.x : centerX;
      var focusOriginZ = isFiniteNumber(cameraFocus.z) ? cameraFocus.z : centerZ;
      var recenterOffset = { x: focusOriginX, z: focusOriginZ };
      var renderFocus = {
        x: focusOriginX - recenterOffset.x,
        y: isFiniteNumber(cameraFocus.y) ? cameraFocus.y : centerY,
        z: focusOriginZ - recenterOffset.z
      };

      // Log snapshot data for debugging
      console.log('[Visualize] Snapshot data:', {
        rooms: snapshot.rooms.length,
        wallStrips: snapshot.wallStrips.length,
        pools: snapshot.pools.length,
        roofs: snapshot.roofs.length,
        pergolas: snapshot.pergolas.length,
        garages: snapshot.garages.length,
        balconies: snapshot.balconies.length,
        furniture: snapshot.furniture.length,
        bounds: bounds,
        span: span
      });

      var groundY = buildGround(bounds, recenterOffset.x, recenterOffset.z, bounds.minY, span);
      createContactShadow(recenterOffset.x, recenterOffset.z, span, groundY);
      if (sceneRoot) {
        sceneRoot.position.set(-recenterOffset.x, 0, -recenterOffset.z);
      }
      // Note: Removed addSignatureFacade - only render user's actual design
      VIEW_PRESETS = buildViewPresets(renderFocus.x, renderFocus.y, renderFocus.z, span, bounds, renderFocus) || [];
      if (!Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) {
        VIEW_PRESETS = buildViewPresets(renderFocus.x, renderFocus.y, renderFocus.z, span || 8, bounds, renderFocus) || [];
      }
      if (!Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) {
        VIEW_PRESETS = [{
          position: new THREE.Vector3(renderFocus.x + span * 1.9, renderFocus.y + span * 0.8, renderFocus.z + span * 1.4),
          target: new THREE.Vector3(renderFocus.x, renderFocus.y, renderFocus.z),
          up: new THREE.Vector3(0, 1, 0),
          fov: 48,
          near: 0.05,
          far: Math.max(600, span * 8)
        }];
      }
      if (viewIndex >= VIEW_PRESETS.length) viewIndex = VIEW_PRESETS.length - 1;
      if (viewIndex < 0) viewIndex = 0;
      applyCameraPreset(viewIndex);
      setupLighting(renderFocus.x, renderFocus.y, renderFocus.z, span);

      var canvas = qs(CANVAS_ID);
      if (canvas) {
        // Ultra high resolution - start at 4K for maximum sharpness
        var baseWidth = 3840;
        var width = Math.floor(baseWidth * Math.max(1, multiplier));
        if (width > 7680) width = 7680; // Allow up to 8K
        var stage = qs('visualize-stage');
        var stageAspect = 16/9;
        if (stage && stage.clientWidth > 0 && stage.clientHeight > 0) {
          stageAspect = stage.clientWidth / stage.clientHeight;
        }
        var height = Math.floor(width / stageAspect);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        canvas.width = width;
        canvas.height = height;
        lastCanvasWidth = width;
        lastCanvasHeight = height;
        
        // Multi-pass rendering for maximum quality and sharpness
        if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
        
        // Clear with precision
        renderer.clear(true, true, true);

        // Render scene with cinematic post-processing stack
        renderSceneWithPostFX(width, height);
        
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
        addDefaultLabel();
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
      if (shouldHideLoading && loading) {
        loading.textContent = 'Generating...';
        loading.classList.remove('visible');
      }
    }
  }

  function exportImage(){
    if (!renderer) return;
    var canvas = renderer.domElement;
    if (!canvas) return;
    
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
    closePhotoViewer();
    if (fabricCanvas) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
    }
  }

  window.showVisualize = showVisualize;
  window.hideVisualize = hideVisualize;
})();
