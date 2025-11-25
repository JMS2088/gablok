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

  var renderer = null;
  var scene = null;
  var camera = null;
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
    // Clean architectural daylight skies - white to soft blue gradients
    [0xffffff, 0xf8fbff, 0xe8f2ff],
    [0xfcfcfc, 0xf5f9ff, 0xe5f0ff],
    [0xfafafa, 0xf2f8ff, 0xe0edff],
    [0xfefefe, 0xf6faff, 0xe8f4ff],
    [0xfdfdfd, 0xf4f8ff, 0xe2f0ff]
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

  function qs(id){ return document.getElementById(id); }

  function isFiniteNumber(val){ return typeof val === 'number' && isFinite(val); }

  function ensureSecondaryUV(geometry){
    if (!geometry || !geometry.attributes || !geometry.attributes.uv) return;
    if (geometry.attributes.uv2) return;
    geometry.setAttribute('uv2', geometry.attributes.uv.clone());
  }

  function selectSkyPalette(){
    if (skyGradientPalette && Array.isArray(skyGradientPalette)) return skyGradientPalette;
    var source = (rng && typeof rng.next === 'function') ? rng.next() : Math.random();
    var idx = Math.floor((source || 0) * SKY_GRADIENT_PRESETS.length);
    if (!isFiniteNumber(idx) || idx < 0) idx = 0;
    skyGradientPalette = SKY_GRADIENT_PRESETS[idx % SKY_GRADIENT_PRESETS.length] || SKY_GRADIENT_PRESETS[0];
    return skyGradientPalette;
  }

  function createSkyTexture(){
    if (skyTexture) return skyTexture;
    if (!THREE) return null;
    var canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Photorealistic outdoor sky - beautiful blue gradient
    var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#3B7DD8');     // Rich blue at zenith
    gradient.addColorStop(0.15, '#5B9DE8');  // Medium blue
    gradient.addColorStop(0.35, '#87CEEB');  // Sky blue
    gradient.addColorStop(0.55, '#B0E0E6');  // Powder blue
    gradient.addColorStop(0.75, '#E0F0FF');  // Very light blue
    gradient.addColorStop(0.9, '#FFF8E8');   // Warm horizon glow
    gradient.addColorStop(1.0, '#FFE8C8');   // Warm horizon
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Bright sun with realistic glow
    var sunX = canvas.width * 0.72;
    var sunY = canvas.height * 0.22;
    
    // Outer glow
    var outerGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, canvas.height * 0.4);
    outerGlow.addColorStop(0, 'rgba(255,255,240,0.5)');
    outerGlow.addColorStop(0.3, 'rgba(255,250,220,0.2)');
    outerGlow.addColorStop(1, 'rgba(255,250,200,0)');
    ctx.fillStyle = outerGlow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Inner bright sun
    var sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, canvas.height * 0.08);
    sunGlow.addColorStop(0, 'rgba(255,255,255,1)');
    sunGlow.addColorStop(0.5, 'rgba(255,255,240,0.9)');
    sunGlow.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = sunGlow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, canvas.height * 0.15, 0, Math.PI * 2);
    ctx.fill();
    
    // Subtle cloud wisps
    ctx.globalAlpha = 0.15;
    for (var i = 0; i < 8; i++) {
      var cloudX = canvas.width * (0.1 + Math.random() * 0.8);
      var cloudY = canvas.height * (0.1 + Math.random() * 0.4);
      var cloudW = canvas.width * (0.1 + Math.random() * 0.2);
      var cloudH = canvas.height * (0.02 + Math.random() * 0.04);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(cloudX, cloudY, cloudW, cloudH, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    if (renderer && renderer.capabilities) {
      var aniso = renderer.capabilities.getMaxAnisotropy && renderer.capabilities.getMaxAnisotropy();
      if (aniso) tex.anisotropy = Math.min(aniso, 16);
    }
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
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
    libsPromise = Promise.all([
      loader('https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js'),
      loader('https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js')
    ]).then(function(){ THREE = window.THREE; fabricRef = window.fabric; });
    return libsPromise;
  }

  function ensureRenderer(){
    if (renderer && scene && camera) return;
    var canvas = qs(CANVAS_ID);
    if (!canvas) return;
    
    // Premium photorealistic WebGL renderer
    renderer = new THREE.WebGLRenderer({ 
      canvas: canvas, 
      antialias: true, 
      preserveDrawingBuffer: true,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true
    });
    
    // Maximum quality - high DPI support
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    
    // Proper color management for photorealism
    if (THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    
    // Clear to sky blue for outdoor scenes
    renderer.setClearColor(0x87CEEB, 1);
    
    // Physical lighting model
    if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;
    if ('physicallyCorrectLights' in renderer) renderer.physicallyCorrectLights = true;
    
    // Cinematic tone mapping with proper exposure
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    
    // High quality soft shadows
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

  function setupLighting(centerX, centerY, centerZ, span){
    if (!scene) return;
    clearLighting();
    ensureFog(span);
    
    // Photorealistic outdoor daylight setup
    
    // Hemisphere light - sky blue from above, ground brown from below
    var hemi = trackLight(new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 0.6));
    if (hemi) hemi.position.set(centerX, centerY + span * 5, centerZ);

    // Soft ambient fill
    var ambient = trackLight(new THREE.AmbientLight(0xE8F0FF, 0.3));

    // Main sun light - warm golden sunlight from upper right
    var sun = trackLight(new THREE.DirectionalLight(0xFFFAF0, 3.5));
    if (sun) {
      sun.position.set(centerX + span * 3, centerY + span * 4, centerZ + span * 2);
      sun.castShadow = true;
      if (sun.shadow && sun.shadow.camera) {
        sun.shadow.mapSize.set(4096, 4096);
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = Math.max(1000, span * 15);
        var extent = span * 4;
        sun.shadow.camera.left = -extent;
        sun.shadow.camera.right = extent;
        sun.shadow.camera.top = extent;
        sun.shadow.camera.bottom = -extent;
        sun.shadow.bias = -0.0001;
        sun.shadow.normalBias = 0.02;
        sun.shadow.radius = 4;
      }
      sun.target.position.set(centerX, centerY, centerZ);
    }

    // Sky fill light - cool blue from opposite side
    var skyFill = trackLight(new THREE.DirectionalLight(0x87CEEB, 1.2));
    if (skyFill) {
      skyFill.position.set(centerX - span * 2, centerY + span * 3, centerZ - span * 2);
      skyFill.castShadow = false;
    }

    // Ground bounce - warm reflected light
    var bounce = trackLight(new THREE.DirectionalLight(0xE8D8C8, 0.5));
    if (bounce) {
      bounce.position.set(centerX, centerY - span, centerZ + span * 2);
      bounce.target.position.set(centerX, centerY + span * 0.5, centerZ);
      bounce.castShadow = false;
    }

    // Rim/back light for edge definition
    var rim = trackLight(new THREE.SpotLight(0xFFFFFF, 1.5, span * 15, Math.PI / 5, 0.5, 1.5));
    if (rim) {
      rim.position.set(centerX - span * 0.35, centerY + span * 4.0, centerZ - span * 1.2);
      rim.target.position.set(centerX, centerY + span * 0.25, centerZ);
      rim.castShadow = true;
      if (rim.shadow) {
        rim.shadow.mapSize.set(2048, 2048);
        rim.shadow.bias = -0.00012;
      }
    }

    // Soft porch fill
    var porch = trackLight(new THREE.PointLight(0xffffff, 0.35, Math.max(15, span * 4.5)));
    if (porch) {
      porch.position.set(centerX + span * 0.2, centerY + span * 0.35, centerZ + span * 0.75);
      porch.castShadow = false;
    }
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
    texture.anisotropy = renderer ? Math.min(renderer.capabilities.getMaxAnisotropy() || 8, 8) : 4;
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
    
    // Create photorealistic HDR-style environment
    pmremGenerator = pmremGenerator || new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
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
    if (!lastCanvasWidth || !lastCanvasHeight) return;
    var stage = qs('visualize-stage');
    var wrap = qs('visualize-canvas-wrap');
    var renderCanvas = qs(CANVAS_ID);
    if (!stage || !wrap || !renderCanvas) return;
    var stageWidth = stage.clientWidth;
    var stageHeight = stage.clientHeight;
    if (stageWidth <= 0 && stageHeight <= 0) {
      wrap.style.width = '100%';
      wrap.style.height = 'auto';
      wrap.style.margin = 'auto';
      return;
    }
    var cssWidth = lastCanvasWidth;
    var cssHeight = lastCanvasHeight;
    var widthRatio = stageWidth > 0 ? stageWidth / lastCanvasWidth : 1;
    var heightRatio = stageHeight > 0 ? stageHeight / lastCanvasHeight : 1;
    var scale = Math.min(widthRatio, heightRatio, 1);
    if (!isFiniteNumber(scale) || scale <= 0) scale = 1;
    cssWidth = Math.max(1, Math.round(lastCanvasWidth * scale));
    cssHeight = Math.max(1, Math.round(lastCanvasHeight * scale));
    wrap.style.width = cssWidth + 'px';
    wrap.style.height = cssHeight + 'px';
    wrap.style.margin = 'auto';
    renderCanvas.style.width = '100%';
    renderCanvas.style.height = '100%';
    var overlay = qs(FABRIC_ID);
    if (overlay) {
      overlay.style.width = '100%';
      overlay.style.height = '100%';
    }
    if (fabricCanvas) {
      fabricCanvas.setDimensions({ width: lastCanvasWidth, height: lastCanvasHeight });
      fabricCanvas.setDimensions({ width: '100%', height: '100%' }, { cssOnly: true });
      fabricCanvas.calcOffset();
      fabricCanvas.requestRenderAll();
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
        renderer.render(scene, camera);
        await waitForFrame();
        var dataUrl = null;
        try {
          dataUrl = canvas.toDataURL('image/png');
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
      renderer.render(scene, camera);
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
      // Photorealistic architectural materials
      room: { color: 0xF5F5F0, roughness: 0.4, metalness: 0.0, envMapIntensity: 1.0 },
      garage: { color: 0xE8E8E0, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.8 },
      pergola: { color: 0x8B7355, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.6 },
      pool: { color: 0x4A90D9, roughness: 0.1, metalness: 0.0, transmission: 0.6, thickness: 0.5, envMapIntensity: 1.5 },
      roof: { color: 0x4A4A4A, roughness: 0.7, metalness: 0.2, envMapIntensity: 0.8 },
      balcony: { color: 0xE0E0D8, roughness: 0.35, metalness: 0.0, envMapIntensity: 0.9 },
      furniture: { color: 0xD2B48C, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.7 },
      wall: { color: 0xFAFAF5, roughness: 0.45, metalness: 0.0, envMapIntensity: 0.9 },
      windowFrame: { color: 0x2F2F2F, roughness: 0.2, metalness: 0.8, envMapIntensity: 1.5 },
      doorFrame: { color: 0x3A3A3A, roughness: 0.25, metalness: 0.6, envMapIntensity: 1.2 },
      doorPanel: { color: 0x6B4423, roughness: 0.4, metalness: 0.1, envMapIntensity: 0.8 },
      glass: { color: 0xE8F4FF, roughness: 0.05, metalness: 0.0, transmission: 0.9, thickness: 0.1, transparent: true, opacity: 0.3, envMapIntensity: 2.0, ior: 1.5 },
      accentPanel: { color: 0xE8E8E0, roughness: 0.3, metalness: 0.1, envMapIntensity: 1.0 },
      groundPath: { color: 0xC0C0B8, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.6 },
      woodAccent: { color: 0x5D4037, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.7 },
      boulder: { color: 0x808075, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.5 },
      foliage: { color: 0x4A7A4A, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.4 }
    };
    var spec = palette[kind] || { color: 0xE0E0D8, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.8 };
    
    var mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness
    });
    mat.envMapIntensity = spec.envMapIntensity || 1.0;
    
    // Handle transmission for glass/water
    if (spec.transmission) {
      mat = new THREE.MeshPhysicalMaterial({
        color: spec.color,
        roughness: spec.roughness,
        metalness: spec.metalness,
        transmission: spec.transmission,
        thickness: spec.thickness || 0.1,
        ior: spec.ior || 1.45,
        envMapIntensity: spec.envMapIntensity || 1.0
      });
    }
    
    if (typeof spec.opacity === 'number') {
      mat.opacity = spec.opacity;
      mat.transparent = true;
    }
    if (spec.transparent) mat.transparent = true;
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
    
    // Photorealistic grass/ground with proper shading
    var groundSize = footprint * 5;
    var floorGeom = new THREE.PlaneGeometry(groundSize, groundSize, 32, 32);
    ensureSecondaryUV(floorGeom);
    
    // Create grass texture
    var grassCanvas = document.createElement('canvas');
    grassCanvas.width = 1024;
    grassCanvas.height = 1024;
    var grassCtx = grassCanvas.getContext('2d');
    
    // Base grass color with variation
    var grassGrad = grassCtx.createRadialGradient(512, 512, 0, 512, 512, 700);
    grassGrad.addColorStop(0, '#4A7A4A');   // Rich green center
    grassGrad.addColorStop(0.5, '#5A8A5A'); // Medium green
    grassGrad.addColorStop(1, '#4A6A4A');   // Darker edges
    grassCtx.fillStyle = grassGrad;
    grassCtx.fillRect(0, 0, 1024, 1024);
    
    // Add noise/texture
    var imageData = grassCtx.getImageData(0, 0, 1024, 1024);
    var data = imageData.data;
    for (var i = 0; i < data.length; i += 4) {
      var noise = (Math.random() - 0.5) * 30;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * 1.2));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * 0.5));
    }
    grassCtx.putImageData(imageData, 0, 0);
    
    var grassTex = new THREE.CanvasTexture(grassCanvas);
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(groundSize / 8, groundSize / 8);
    if (THREE.SRGBColorSpace) grassTex.colorSpace = THREE.SRGBColorSpace;
    
    var floorMat = new THREE.MeshStandardMaterial({ 
      map: grassTex,
      roughness: 0.9, 
      metalness: 0.0,
      envMapIntensity: 0.5
    });
    var floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centerX, groundY - 0.02, centerZ);
    floor.receiveShadow = true;
    registerMesh(floor, { castShadow: false, receiveShadow: true, skipEdges: true });
    
    // Add a subtle concrete/paved area around the building
    var pavingSize = footprint * 1.5;
    var pavingGeom = new THREE.PlaneGeometry(pavingSize, pavingSize, 1, 1);
    ensureSecondaryUV(pavingGeom);
    
    var pavingCanvas = document.createElement('canvas');
    pavingCanvas.width = 512;
    pavingCanvas.height = 512;
    var pavingCtx = pavingCanvas.getContext('2d');
    pavingCtx.fillStyle = '#C8C8C0';
    pavingCtx.fillRect(0, 0, 512, 512);
    // Add subtle texture
    for (var j = 0; j < 512 * 512; j++) {
      if (Math.random() > 0.97) {
        pavingCtx.fillStyle = 'rgba(0,0,0,0.05)';
        pavingCtx.fillRect((j % 512), Math.floor(j / 512), 2, 2);
      }
    }
    
    var pavingTex = new THREE.CanvasTexture(pavingCanvas);
    pavingTex.wrapS = pavingTex.wrapT = THREE.RepeatWrapping;
    pavingTex.repeat.set(pavingSize / 4, pavingSize / 4);
    if (THREE.SRGBColorSpace) pavingTex.colorSpace = THREE.SRGBColorSpace;
    
    var pavingMat = new THREE.MeshStandardMaterial({
      map: pavingTex,
      roughness: 0.7,
      metalness: 0.1,
      envMapIntensity: 0.8
    });
    var paving = new THREE.Mesh(pavingGeom, pavingMat);
    paving.rotation.x = -Math.PI / 2;
    paving.position.set(centerX, groundY - 0.01, centerZ);
    paving.receiveShadow = true;
    registerMesh(paving, { castShadow: false, receiveShadow: true, skipEdges: true });

    return groundY;
  }

  function buildViewPresets(centerX, centerY, centerZ, span, bounds){
    if (!THREE) return [];
    var presets = [];
    var safeSpan = Math.max(6, span || 6);
    var maxY = (bounds && isFiniteNumber(bounds.maxY)) ? bounds.maxY : (centerY + safeSpan * 0.5);
    var minY = (bounds && isFiniteNumber(bounds.minY)) ? bounds.minY : 0;
    var heightSpan = Math.max(2.6, maxY - minY);
    var radius = Math.max(8, safeSpan * 1.92);
    var baseTargetY = minY + heightSpan * 0.55;

    function pushPreset(angleDeg, options){
      var opts = options || {};
      var heightFactor = (opts.heightFactor != null) ? opts.heightFactor : 0.5;
      var distanceFactor = (opts.distanceFactor != null) ? opts.distanceFactor : 1.75;
      var tiltOffset = opts.tiltOffset != null ? opts.tiltOffset : 0;
      var fov = opts.fov || 44;
      var rad = angleDeg * Math.PI / 180;
      var dist = radius * distanceFactor;
      var yPos = minY + Math.max(safeSpan * 0.3, heightSpan * heightFactor);
      var pos = new THREE.Vector3(
        centerX + Math.cos(rad) * dist,
        yPos,
        centerZ + Math.sin(rad) * dist
      );
      var target = new THREE.Vector3(
        centerX + (opts.targetOffsetX || 0) * safeSpan,
        baseTargetY + heightSpan * tiltOffset,
        centerZ + (opts.targetOffsetZ || 0) * safeSpan
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

    // Cinematic architectural photography angles
    // Front 3/4 view - hero shot
    pushPreset(35, { heightFactor: 0.5, distanceFactor: 2.0, tiltOffset: 0, fov: 50 });
    // Opposite 3/4 view
    pushPreset(-35, { heightFactor: 0.5, distanceFactor: 2.0, tiltOffset: 0, fov: 50 });
    // Side view left
    pushPreset(90, { heightFactor: 0.45, distanceFactor: 2.2, tiltOffset: -0.05, fov: 45 });
    // Side view right
    pushPreset(-90, { heightFactor: 0.45, distanceFactor: 2.2, tiltOffset: -0.05, fov: 45 });
    // Elevated corner view
    pushPreset(50, { heightFactor: 0.8, distanceFactor: 2.5, tiltOffset: 0.1, fov: 55 });
    // Back view
    pushPreset(180, { heightFactor: 0.55, distanceFactor: 2.0, tiltOffset: 0, fov: 50 });
    // Low angle dramatic
    pushPreset(25, { heightFactor: 0.25, distanceFactor: 1.8, tiltOffset: -0.1, fov: 60 });
    // Wide establishing shot
    pushPreset(45, { heightFactor: 0.7, distanceFactor: 3.0, tiltOffset: 0.05, fov: 65 });

    // Aerial/bird's eye view
    var topPos = new THREE.Vector3(
      centerX + safeSpan * 0.1,
      maxY + safeSpan * 3,
      centerZ + safeSpan * 0.5
    );
    presets.push({
      position: topPos,
      target: new THREE.Vector3(centerX, baseTargetY, centerZ),
      up: new THREE.Vector3(0, 0, -1),
      fov: 55,
      near: 0.5,
      far: Math.max(1000, safeSpan * 15)
    });

    if (!presets.length) {
      var fallback = new THREE.Vector3(centerX + safeSpan * 2, maxY + safeSpan * 0.8, centerZ + safeSpan * 1.5);
      presets.push({
        position: fallback,
        target: new THREE.Vector3(centerX, baseTargetY, centerZ),
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
      if (renderer && typeof renderer.toneMappingExposure === 'number') {
        // Photorealistic exposure - bright and clear
        renderer.toneMappingExposure = 1.2 + (multiplier - 1) * 0.2;
      }
      ensureEnvironment();
      disposeSceneChildren();
      
      // Set sky as background - beautiful blue sky
      var backgroundTex = createSkyTexture();
      scene.background = backgroundTex;

      var bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      var boxes = gatherBoxes(snapshot);
      boxes.forEach(function(entry){ includeBounds(bounds, entry.box); });

      var wallMaterial = materialFor('wall');
      snapshot.wallStrips.forEach(function(strip){
        var mat = wallMaterial.clone();
        mat.map = noiseTexture('wall-' + (strip.level || 0), 228, 20, 8);
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

      var groundY = buildGround(bounds, centerX, centerZ, bounds.minY, span);
      createContactShadow(centerX, centerZ, span, groundY);
      // Note: Removed addSignatureFacade - only render user's actual design
      VIEW_PRESETS = buildViewPresets(centerX, centerY, centerZ, span, bounds) || [];
      if (!Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) {
        VIEW_PRESETS = buildViewPresets(centerX, centerY, centerZ, span || 8, bounds) || [];
      }
      if (!Array.isArray(VIEW_PRESETS) || VIEW_PRESETS.length === 0) {
        VIEW_PRESETS = [{
          position: new THREE.Vector3(centerX + span * 1.9, centerY + span * 0.8, centerZ + span * 1.4),
          target: new THREE.Vector3(centerX, centerY, centerZ),
          up: new THREE.Vector3(0, 1, 0),
          fov: 48,
          near: 0.05,
          far: Math.max(600, span * 8)
        }];
      }
      if (viewIndex >= VIEW_PRESETS.length) viewIndex = VIEW_PRESETS.length - 1;
      if (viewIndex < 0) viewIndex = 0;
      applyCameraPreset(viewIndex);
      setupLighting(centerX, centerY, centerZ, span);

      var canvas = qs(CANVAS_ID);
      if (canvas) {
        // High resolution full-bleed render
        var baseWidth = 1920;
        var width = Math.floor(baseWidth * Math.max(1, multiplier));
        if (width > 3840) width = 3840;
        var height = Math.floor(width * 9 / 16);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        canvas.width = width;
        canvas.height = height;
        lastCanvasWidth = width;
        lastCanvasHeight = height;
        ensureFabric(width, height);
        ensureResizeListener();
        fitRenderToStage();
        window.requestAnimationFrame(fitRenderToStage);
        if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
        renderer.render(scene, camera);
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
    var exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    var ctx = exportCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    if (fabricCanvas) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
      ctx.drawImage(fabricCanvas.getElement(), 0, 0);
    }
    var link = document.createElement('a');
    link.download = 'gablok-visualize.png';
    link.href = exportCanvas.toDataURL('image/png');
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
      generate.addEventListener('click', function(){ ensureLibraries().then(renderSnapshot); });
    }
    var qualitySelect = qs(QUALITY_ID);
    if (qualitySelect && !qualitySelect.__wired){
      qualitySelect.__wired = true;
      qualitySelect.addEventListener('change', function(){ ensureLibraries().then(renderSnapshot); });
    }
    var downloadBtn = qs('visualize-download');
    if (downloadBtn && !downloadBtn.__wired){
      downloadBtn.__wired = true;
      downloadBtn.addEventListener('click', exportImage);
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

  function showVisualize(){
    var modal = qs(PANEL_ID);
    if (!modal) return;
    viewIndex = 0;
    modal.classList.add('visible');
    closePhotoViewer();
    setGalleryShots([]);
    updateGalleryGrid('Generating design images...');
    ensureEvents();
    window.requestAnimationFrame(fitRenderToStage);
    ensureLibraries().then(function(){
      ensureRenderer();
      renderSnapshot();
    });
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
