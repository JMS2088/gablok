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
  var SKY_GRADIENT_PRESETS = [
    [0xf7cfa1, 0xf5dfc6, 0xf0f5fb],
    [0xf9c9ae, 0xf8dcc7, 0xf2f4f8],
    [0xe5eefb, 0xeff4fb, 0xf6f8fc],
    [0xf6d6a7, 0xf4e2c9, 0xeff4f9],
    [0xf4d7b8, 0xefe2cf, 0xedeff6]
  ];
  var rng = createRandomGenerator();
  var lastCanvasWidth = 0;
  var lastCanvasHeight = 0;
  var resizeHooked = false;

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
    default: 0xcbd5df,
    roof: 0xaeb4bf,
    wall: 0xbcc3cd,
    podium: 0xbfc6d2,
    frame: 0x90a4bd,
    glass: 0xd2e3ff,
    accent: 0xb8c2d3
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
    var palette = selectSkyPalette();
    var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    var topColor = palette && palette[0] != null ? palette[0] : 0xf8c68a;
    var midColor = palette && palette[1] != null ? palette[1] : 0xf5e0c4;
    var bottomColor = palette && palette[2] != null ? palette[2] : 0xf1f4fb;
    gradient.addColorStop(0, '#' + ('000000' + topColor.toString(16)).slice(-6));
    gradient.addColorStop(0.45, '#' + ('000000' + midColor.toString(16)).slice(-6));
    gradient.addColorStop(1, '#' + ('000000' + bottomColor.toString(16)).slice(-6));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var sunRadius = canvas.height * 0.28;
    var sunX = canvas.width * 0.68;
    var sunY = canvas.height * 0.36;
    var sunGrad = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.08, sunX, sunY, sunRadius);
    sunGrad.addColorStop(0, 'rgba(255,233,196,0.95)');
    sunGrad.addColorStop(0.45, 'rgba(255,208,150,0.55)');
    sunGrad.addColorStop(1, 'rgba(255,194,120,0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fill();

    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    if (renderer && renderer.capabilities) {
      var aniso = renderer.capabilities.getMaxAnisotropy && renderer.capabilities.getMaxAnisotropy();
      if (aniso) tex.anisotropy = Math.min(aniso, 8);
    }
    if (typeof tex.colorSpace !== 'undefined' && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    else if (typeof tex.encoding !== 'undefined' && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
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
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
    if (renderer.setPixelRatio && window.devicePixelRatio) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.25));
    }
    if (typeof renderer.outputColorSpace !== 'undefined' && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (typeof renderer.outputEncoding !== 'undefined' && THREE.sRGBEncoding) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    if (typeof renderer.setClearColor === 'function') renderer.setClearColor(0xffffff, 0);
    if ('physicallyCorrectLights' in renderer) renderer.physicallyCorrectLights = true;
    if ('toneMapping' in renderer && THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = 1.32;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = (THREE.PCFSoftShadowMap || renderer.shadowMap.type);
      renderer.shadowMap.autoUpdate = true;
    }
    if (THREE.ColorManagement) THREE.ColorManagement.enabled = true;
    scene = new THREE.Scene();
    var bg = createSkyTexture();
    if (bg) {
      if (THREE && THREE.EquirectangularReflectionMapping) bg.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = bg;
    } else {
      scene.background = new THREE.Color(0xf6f7fb);
    }
    camera = new THREE.PerspectiveCamera(48, 16/9, 0.05, 1200);
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
    var near = Math.max(70, span * 2.8);
    var far = Math.max(360, span * 12.5);
    scene.fog = new THREE.Fog(0xf6ddbd, near, far);
  }

  function setupLighting(centerX, centerY, centerZ, span){
    if (!scene) return;
    clearLighting();
    ensureFog(span);
    var hemi = trackLight(new THREE.HemisphereLight(0xfff2d2, 0xf3d3a4, 0.78));
    if (hemi) hemi.position.set(centerX, centerY + span * 2.6, centerZ);

    var ambient = trackLight(new THREE.AmbientLight(0xffffff, 0.18));
    if (ambient) ambient.castShadow = false;

    var sun = trackLight(new THREE.DirectionalLight(0xffb777, 1.85));
    if (sun) {
      sun.position.set(centerX + span * 2.4, centerY + span * 1.35, centerZ + span * 2.6);
      sun.castShadow = true;
      if (sun.shadow && sun.shadow.camera) {
        sun.shadow.mapSize.set(4096, 4096);
        sun.shadow.camera.near = 0.35;
        sun.shadow.camera.far = Math.max(600, span * 8.5);
        var extent = span * 2.6;
        sun.shadow.camera.left = -extent;
        sun.shadow.camera.right = extent;
        sun.shadow.camera.top = extent;
        sun.shadow.camera.bottom = -extent;
        sun.shadow.bias = -0.00016;
        sun.shadow.normalBias = 0.0075;
        sun.shadow.radius = 3.2;
      }
      sun.target.position.set(centerX, centerY + span * 0.12, centerZ - span * 0.08);
    }

    var fill = trackLight(new THREE.DirectionalLight(0xcde3ff, 0.46));
    if (fill) {
      fill.position.set(centerX - span * 1.5, centerY + span * 1.2, centerZ - span * 1.9);
      fill.castShadow = false;
    }

    var bounce = trackLight(new THREE.DirectionalLight(0xffcaa0, 0.34));
    if (bounce) {
      bounce.position.set(centerX - span * 0.8, centerY + span * 0.6, centerZ + span * 2.2);
      bounce.target.position.set(centerX, centerY + span * 0.18, centerZ);
      bounce.castShadow = false;
    }

    var rim = trackLight(new THREE.SpotLight(0xffefd9, 0.54, span * 9.5, Math.PI / 5.4, 0.42, 1.2));
    if (rim) {
      rim.position.set(centerX - span * 0.42, centerY + span * 3.2, centerZ - span * 1.4);
      rim.target.position.set(centerX, centerY + span * 0.35, centerZ);
      rim.castShadow = true;
      if (rim.shadow) {
        rim.shadow.mapSize.set(1820, 1820);
        rim.shadow.bias = -0.00021;
      }
    }

    var porch = trackLight(new THREE.PointLight(0xffc48d, 0.28, Math.max(12, span * 3.8)));
    if (porch) {
      porch.position.set(centerX + span * 0.22, centerY + span * 0.42, centerZ + span * 0.88);
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
    pmremGenerator = pmremGenerator || new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    var studio = new THREE.Scene();
    var dome = new THREE.Mesh(new THREE.SphereGeometry(60, 64, 32), new THREE.MeshBasicMaterial({ color: 0xfff4e1, side: THREE.BackSide }));
    studio.add(dome);

    var floor = new THREE.Mesh(new THREE.CircleGeometry(45, 64), new THREE.MeshStandardMaterial({ color: 0xf6e6d2, roughness: 0.38, metalness: 0.16 }));
    floor.rotation.x = -Math.PI / 2;
    studio.add(floor);

    var wallPanel = new THREE.Mesh(new THREE.BoxGeometry(38, 24, 2), new THREE.MeshStandardMaterial({ color: 0xf3e5d6, roughness: 0.35, metalness: 0.22, emissive: new THREE.Color(0xf5d3a6), emissiveIntensity: 0.18 }));
    wallPanel.position.set(-10, 6, -30);
    studio.add(wallPanel);

    var coolPanel = new THREE.Mesh(new THREE.BoxGeometry(28, 22, 1.8), new THREE.MeshStandardMaterial({ color: 0xdfe7f5, roughness: 0.42, metalness: 0.28 }));
    coolPanel.position.set(24, 4, 26);
    coolPanel.rotation.y = Math.PI / 4;
    studio.add(coolPanel);

    var pillar = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.6, 30, 32), new THREE.MeshStandardMaterial({ color: 0xdadfe4, roughness: 0.38, metalness: 0.24 }));
    pillar.position.set(-18, 0, 14);
    studio.add(pillar);

    var pillar2 = pillar.clone();
    pillar2.position.set(18, -2, -18);
    studio.add(pillar2);

    function addEmitter(width, height, position, rotation, colorHex, intensity){
      var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex || 0xffffff).multiplyScalar(intensity || 1.2) });
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.copy(position);
      if (rotation) plane.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
      studio.add(plane);
    }

    addEmitter(28, 18, new THREE.Vector3(-32, 18, 6), { y: Math.PI / 2.2 }, 0xffffff, 4.8);
    addEmitter(18, 12, new THREE.Vector3(24, 12, -28), { y: -Math.PI / 2.4 }, 0xf7f0df, 3.6);
    addEmitter(16, 10, new THREE.Vector3(6, 20, 30), { x: -Math.PI / 12 }, 0xcbe2ff, 2.4);

    envRT = pmremGenerator.fromScene(studio, 0.05);
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
      return {
        rooms: Array.isArray(window.allRooms) ? window.allRooms.slice() : [],
        wallStrips: Array.isArray(window.wallStrips) ? window.wallStrips.slice() : [],
        pergolas: Array.isArray(window.pergolaComponents) ? window.pergolaComponents.slice() : [],
        garages: Array.isArray(window.garageComponents) ? window.garageComponents.slice() : [],
        pools: Array.isArray(window.poolComponents) ? window.poolComponents.slice() : [],
        roofs: Array.isArray(window.roofComponents) ? window.roofComponents.slice() : [],
        balconies: Array.isArray(window.balconyComponents) ? window.balconyComponents.slice() : [],
        furniture: Array.isArray(window.furnitureItems) ? window.furnitureItems.slice() : []
      };
    } catch(err){
      console.warn('[Visualize] Failed to gather snapshot', err);
      return { rooms: [], wallStrips: [] };
    }
  }

  function boxFromDimensions(item){
    var hasBaseHeight = isFiniteNumber(item.baseHeight);
    var base = hasBaseHeight ? item.baseHeight : (isFiniteNumber(item.y) ? item.y : 0);
    return {
      cx: (item.x || 0),
      cy: (item.y || 0),
      cz: (item.z || 0),
      width: Math.max(0.1, item.width || 0),
      depth: Math.max(0.1, item.depth || 0),
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
    if (resizeHooked) return;
    resizeHooked = true;
    window.addEventListener('resize', function(){
      window.requestAnimationFrame(fitRenderToStage);
    });
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
    var label = new fabric.IText('Double-click to edit notes…', {
      left: 24,
      top: 24,
      fontSize: 28,
      fill: '#0f172a',
      fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif'
    });
    fabricCanvas.add(label);
  }

  function gatherBoxes(snapshot){
    var boxes = [];
    var envelope = computeRoomsEnvelope(snapshot.rooms);
    snapshot.rooms.forEach(function(room){
      if (!room) return;
      var box = boxFromDimensions(room);
      box.height = Math.max(2.2, room.height || 2.8);
      boxes.push({ box: box, kind: 'room' });
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
    return boxes;
  }

  function materialFor(kind){
    var palette = {
      room: { color: 0xf4efe8, roughness: 0.28, metalness: 0.06, clearcoat: 0.55, clearcoatRoughness: 0.18, sheen: 0.45, sheenColor: 0xfdf6ed, sheenRoughness: 0.72, noiseKey: 'room', brightness: 236, variation: 18, repeat: 3.5, bumpScale: 0.045, envMapIntensity: 1.4 },
      garage: { color: 0xdde2e8, roughness: 0.42, metalness: 0.08, clearcoat: 0.18, clearcoatRoughness: 0.38, noiseKey: 'garage', brightness: 222, variation: 22, repeat: 4.5, bumpScale: 0.06, envMapIntensity: 1.2 },
      pergola: { color: 0xd8c6b4, roughness: 0.32, metalness: 0.04, clearcoat: 0.46, clearcoatRoughness: 0.14, noiseKey: 'pergola', brightness: 220, variation: 26, repeat: 2.8, bumpScale: 0.08, envMapIntensity: 1.15 },
      pool: { color: 0xc9d8e8, roughness: 0.1, metalness: 0.04, clearcoat: 0.72, clearcoatRoughness: 0.04, transmission: 0.86, thickness: 0.75, attenuationDistance: 3.2, attenuationColor: 0xc8ddf6, opacity: 1, noiseKey: 'pool', brightness: 240, variation: 8, repeat: 3.5, bumpScale: 0.035, envMapIntensity: 1.6 },
      roof: { color: 0x4b4f56, roughness: 0.52, metalness: 0.18, clearcoat: 0.12, clearcoatRoughness: 0.5, noiseKey: 'roof', brightness: 210, variation: 32, repeat: 5.5, bumpScale: 0.12, envMapIntensity: 1.1 },
      balcony: { color: 0xe8dfd2, roughness: 0.36, metalness: 0.07, clearcoat: 0.24, clearcoatRoughness: 0.3, sheen: 0.25, sheenColor: 0xf3eade, sheenRoughness: 0.6, noiseKey: 'balcony', brightness: 232, variation: 18, repeat: 3.8, bumpScale: 0.05, envMapIntensity: 1.35 },
      furniture: { color: 0xe0d4c5, roughness: 0.48, metalness: 0.08, clearcoat: 0.22, clearcoatRoughness: 0.42, sheen: 0.3, sheenColor: 0xf7ede2, sheenRoughness: 0.68, noiseKey: 'furn', brightness: 224, variation: 26, repeat: 4.2, bumpScale: 0.06, envMapIntensity: 1.28 },
      wall: { color: 0xe6eaef, roughness: 0.38, metalness: 0.05, clearcoat: 0.28, clearcoatRoughness: 0.32, noiseKey: 'wall', brightness: 228, variation: 24, repeat: 5.2, bumpScale: 0.055, envMapIntensity: 1.25 },
      windowFrame: { color: 0xdbe2ec, roughness: 0.24, metalness: 0.58, clearcoat: 0.92, clearcoatRoughness: 0.22, specularIntensity: 0.92, specularColor: 0xf8fbff, noiseKey: 'window-frame', brightness: 236, variation: 12, repeat: 6, bumpScale: 0.018, envMapIntensity: 2.6 },
      doorFrame: { color: 0xe4d3c0, roughness: 0.26, metalness: 0.42, clearcoat: 0.68, clearcoatRoughness: 0.28, specularIntensity: 0.78, specularColor: 0xf6ede4, noiseKey: 'door-frame', brightness: 230, variation: 18, repeat: 4.5, bumpScale: 0.02, envMapIntensity: 2.1 },
      doorPanel: { color: 0xcaa585, roughness: 0.38, metalness: 0.18, clearcoat: 0.42, clearcoatRoughness: 0.28, sheen: 0.24, sheenColor: 0xfbf3eb, sheenRoughness: 0.62, specularIntensity: 0.62, specularColor: 0xf2e5db, noiseKey: 'door-panel', brightness: 224, variation: 28, repeat: 3.4, bumpScale: 0.045, envMapIntensity: 1.4 },
      glass: { color: 0xf6fbff, roughness: 0.04, metalness: 0.02, clearcoat: 0.12, clearcoatRoughness: 0.05, transmission: 0.98, thickness: 0.5, attenuationDistance: 14, attenuationColor: 0xdbe7ff, opacity: 0.95, envMapIntensity: 1.9, useNoiseMap: false, transparent: true, depthWrite: false, doubleSide: true, specularIntensity: 0.96, specularColor: 0xf1f5ff, ior: 1.52 },
      accentPanel: { color: 0xf0ede5, roughness: 0.32, metalness: 0.22, clearcoat: 0.48, clearcoatRoughness: 0.16, specularIntensity: 0.74, specularColor: 0xf9f6f0, sheen: 0.18, sheenColor: 0xf4ede2, sheenRoughness: 0.58, noiseKey: 'accent-panel', brightness: 232, variation: 18, repeat: 3.5, bumpScale: 0.035, envMapIntensity: 1.75 },
      groundPath: { color: 0xd7dae0, roughness: 0.28, metalness: 0.24, clearcoat: 0.22, clearcoatRoughness: 0.28, specularIntensity: 0.68, specularColor: 0xf1f4f8, noiseKey: 'ground-path', brightness: 230, variation: 16, repeat: 8, bumpScale: 0.03, envMapIntensity: 1.65 },
      woodAccent: { color: 0x3d2a20, roughness: 0.42, metalness: 0.32, clearcoat: 0.68, clearcoatRoughness: 0.32, sheen: 0.35, sheenColor: 0xf0d7c0, sheenRoughness: 0.55, specularIntensity: 0.82, specularColor: 0xf6e4d2, noiseKey: 'wood-accent', brightness: 196, variation: 34, repeat: 5.4, bumpScale: 0.06, envMapIntensity: 2.4 },
      boulder: { color: 0x6f6761, roughness: 0.94, metalness: 0.12, clearcoat: 0.05, clearcoatRoughness: 0.78, noiseKey: 'boulder', brightness: 190, variation: 36, repeat: 2.6, bumpScale: 0.12, envMapIntensity: 0.9, aoMapIntensity: 0.9 },
      foliage: { color: 0x5e7f4b, roughness: 0.58, metalness: 0.18, clearcoat: 0.22, clearcoatRoughness: 0.42, transmission: 0, noiseKey: 'foliage', brightness: 178, variation: 42, repeat: 3, bumpScale: 0.08, envMapIntensity: 1.8, aoMapIntensity: 0.4 }
    };
    var spec = palette[kind] || { color: 0xf2f3f5, roughness: 0.4, metalness: 0.05, clearcoat: 0.18, clearcoatRoughness: 0.35, noiseKey: 'default', brightness: 230, variation: 16, repeat: 4 };
    var exposureJitter = getMaterialExposureJitter(kind);
    if (exposureJitter !== 1) {
      spec.color = adjustColor(spec.color, exposureJitter);
    }
    var mat = new THREE.MeshPhysicalMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      clearcoat: spec.clearcoat || 0,
      clearcoatRoughness: spec.clearcoatRoughness || 0,
      transmission: spec.transmission || 0,
      thickness: spec.thickness || 0.1,
      attenuationDistance: spec.attenuationDistance || 0,
      attenuationColor: new THREE.Color(spec.attenuationColor || 0xffffff),
      reflectivity: spec.reflectivity != null ? spec.reflectivity : 0.5,
      ior: spec.ior || 1.45
    });
    mat.envMapIntensity = spec.envMapIntensity || 1.2;
    if (typeof spec.opacity === 'number') {
      mat.opacity = spec.opacity;
      mat.transparent = spec.transparent === true || spec.opacity < 1 || (spec.transmission && spec.transmission > 0);
    }
    if (spec.depthWrite === false) mat.depthWrite = false;
    mat.side = spec.doubleSide ? THREE.DoubleSide : ((kind === 'pergola' || kind === 'roof') ? THREE.DoubleSide : THREE.FrontSide);
    if (typeof spec.specularIntensity === 'number') mat.specularIntensity = spec.specularIntensity;
    if (typeof spec.specularColor !== 'undefined') mat.specularColor = new THREE.Color(spec.specularColor);
    if (spec.useNoiseMap !== false) {
      var tex = noiseTexture(spec.noiseKey || kind, spec.brightness, spec.variation, spec.repeat);
      mat.map = tex;
      mat.roughnessMap = tex;
      mat.bumpMap = tex;
      mat.aoMap = tex;
      mat.aoMapIntensity = spec.aoMapIntensity != null ? spec.aoMapIntensity : 0.6;
      mat.bumpScale = spec.bumpScale || 0.04;
    } else {
      mat.bumpScale = spec.bumpScale || 0;
    }
    if (spec.sheen) {
      mat.sheen = spec.sheen;
      mat.sheenColor = new THREE.Color(spec.sheenColor || 0xffffff);
      mat.sheenRoughness = spec.sheenRoughness != null ? spec.sheenRoughness : 0.6;
    }
    mat.needsUpdate = true;
    return mat;
  }

  function addArchitecturalAccents(entry){
    if (!entry || entry.kind !== 'room') return;
    var box = entry.box;
    if (!box || box.height < 0.8) return;
    var baseY = baseElevation(box);
    var trimHeight = Math.min(0.35, Math.max(0.08, box.height * 0.14));
    var trimGeom = new THREE.BoxGeometry(box.width * 1.025, trimHeight, box.depth * 1.025);
    ensureSecondaryUV(trimGeom);
    var trimMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0.05,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.45,
      map: noiseTexture('room-trim', 244, 12, 4)
    });
    var trim = new THREE.Mesh(trimGeom, trimMat);
    trim.position.set(box.cx, baseY + box.height - (trimHeight / 2), box.cz);
    registerMesh(trim, { edgeColor: EDGE_COLORS.default, castShadow: false });

    var socleHeight = Math.min(0.25, Math.max(0.05, box.height * 0.07));
    var socleGeom = new THREE.BoxGeometry(box.width * 1.05, socleHeight, box.depth * 1.05);
    ensureSecondaryUV(socleGeom);
    var socleMat = new THREE.MeshPhysicalMaterial({
      color: 0xe1e5eb,
      roughness: 0.58,
      metalness: 0.04,
      clearcoat: 0.18,
      clearcoatRoughness: 0.4,
      envMapIntensity: 1.1,
      map: noiseTexture('room-base', 220, 20, 5)
    });
    var socle = new THREE.Mesh(socleGeom, socleMat);
    socle.position.set(box.cx, baseY + (socleHeight / 2), box.cz);
    registerMesh(socle, { edgeColor: EDGE_COLORS.default, castShadow: true });
  }

  function addSignatureFacade(bounds, centerX, centerY, centerZ, span){
    if (!bounds || !THREE) return;
    var baseY = isFiniteNumber(bounds.minY) ? bounds.minY : 0;
    var height = Math.max(3.2, (bounds.maxY - baseY) * 0.88);
    var width = Math.max(6, (bounds.maxX - bounds.minX) * 0.78);
    var offsetZ = Math.max(0.32, span * 0.18);
    var frontZ = bounds.maxZ + offsetZ;
    var frameDepth = Math.max(0.14, span * 0.035);

    var frameGeom = new THREE.BoxGeometry(width + frameDepth * 0.55, height + frameDepth * 0.38, frameDepth);
    ensureSecondaryUV(frameGeom);
    var frame = new THREE.Mesh(frameGeom, materialFor('woodAccent'));
    frame.position.set(centerX, baseY + height * 0.52, frontZ);
    frame.castShadow = true;
    registerMesh(frame, { edgeColor: EDGE_COLORS.accent, receiveShadow: true });

    var glassGeom = new THREE.PlaneGeometry(width * 0.94, height * 0.9);
    var glass = new THREE.Mesh(glassGeom, materialFor('glass'));
    glass.position.set(centerX, baseY + height * 0.5, frontZ - frameDepth * 0.42);
    glass.castShadow = false;
    glass.renderOrder = 2.5;
    registerMesh(glass, { skipEdges: true, edgeColor: EDGE_COLORS.glass, receiveShadow: true });

    var canopyGeom = new THREE.BoxGeometry(width * 1.05, frameDepth * 0.55, frameDepth * 2.6);
    ensureSecondaryUV(canopyGeom);
    var canopy = new THREE.Mesh(canopyGeom, materialFor('accentPanel'));
    canopy.position.set(centerX, baseY + height + frameDepth * 0.4, frontZ - frameDepth * 0.6);
    canopy.castShadow = true;
    registerMesh(canopy, { edgeColor: EDGE_COLORS.accent, receiveShadow: true });

    var slatCount = 6;
    var slatSpacing = width / slatCount;
    var slatMat = materialFor('woodAccent');
    for (var i = 0; i < slatCount; i++){
      var slatGeom = new THREE.BoxGeometry(Math.max(0.12, slatSpacing * 0.12), height + frameDepth * 0.42, frameDepth * 0.38);
      ensureSecondaryUV(slatGeom);
      var slat = new THREE.Mesh(slatGeom, slatMat);
      var offset = -width / 2 + slatSpacing * (i + 0.5);
      slat.position.set(centerX + offset, baseY + height * 0.5, frontZ + frameDepth * 0.12);
      slat.castShadow = true;
      registerMesh(slat, { edgeColor: EDGE_COLORS.accent, receiveShadow: true });
    }

    var plinthGeom = new THREE.BoxGeometry(width * 0.92, frameDepth * 0.4, frameDepth * 1.6);
    ensureSecondaryUV(plinthGeom);
    var plinth = new THREE.Mesh(plinthGeom, materialFor('groundPath'));
    plinth.position.set(centerX, baseY + frameDepth * 0.2, frontZ - frameDepth * 0.4);
    registerMesh(plinth, { edgeColor: EDGE_COLORS.accent, receiveShadow: false, castShadow: false });
  }

  function buildGround(bounds, centerX, centerZ, baseY, span){
    var dx = bounds.maxX - bounds.minX;
    var dz = bounds.maxZ - bounds.minZ;
    if (!isFinite(dx) || !isFinite(dz) || dx <= 0 || dz <= 0) {
      dx = dz = 12;
    }
    var footprint = Math.max(dx, dz, span);
    var podiumHeight = Math.max(0.08, footprint * 0.015);
    var baseGeom = new THREE.BoxGeometry(footprint * 1.65, podiumHeight, footprint * 1.5);
    ensureSecondaryUV(baseGeom);
    var baseMat = new THREE.MeshPhysicalMaterial({ color: 0xe2e6ec, roughness: 0.85, metalness: 0.02, clearcoat: 0.08, clearcoatRoughness: 0.6, map: noiseTexture('ground-base', 224, 18, 2.5) });
    var base = new THREE.Mesh(baseGeom, baseMat);
    var groundY = (typeof baseY === 'number') ? baseY : 0;
    base.position.set(centerX, groundY - (podiumHeight / 2), centerZ);
    registerMesh(base, { edgeColor: EDGE_COLORS.podium, castShadow: false });

    var deckGeom = new THREE.BoxGeometry(footprint * 1.35, podiumHeight * 0.55, footprint * 1.25);
    ensureSecondaryUV(deckGeom);
    var deckMat = new THREE.MeshPhysicalMaterial({ color: 0xf5f6f8, roughness: 0.62, metalness: 0.04, clearcoat: 0.12, clearcoatRoughness: 0.25, map: noiseTexture('ground-deck', 236, 10, 3) });
    var deck = new THREE.Mesh(deckGeom, deckMat);
    deck.position.set(centerX, groundY + podiumHeight * 0.12, centerZ);
    registerMesh(deck, { edgeColor: EDGE_COLORS.default, castShadow: false });

    var pathGeom = new THREE.BoxGeometry(footprint * 0.82, podiumHeight * 0.32, footprint * 0.26);
    ensureSecondaryUV(pathGeom);
    var path = new THREE.Mesh(pathGeom, materialFor('groundPath'));
    path.position.set(centerX, groundY + podiumHeight * 0.28, centerZ + footprint * 0.38);
    registerMesh(path, { edgeColor: EDGE_COLORS.accent, castShadow: false });

    var paverMat = materialFor('groundPath');
    var paverCount = 4;
    for (var i = 0; i < paverCount; i++){
      var stepGeom = new THREE.BoxGeometry(footprint * 0.26, podiumHeight * 0.24, footprint * 0.08);
      ensureSecondaryUV(stepGeom);
      var step = new THREE.Mesh(stepGeom, paverMat);
      var forward = footprint * 0.55 + i * footprint * 0.12;
      step.position.set(centerX, groundY + podiumHeight * 0.38, centerZ + forward);
      registerMesh(step, { edgeColor: EDGE_COLORS.accent, castShadow: false });
    }

    var boulderConfigs = [
      { offsetX: -0.42, offsetZ: 0.24, scale: 0.11 },
      { offsetX: 0.35, offsetZ: 0.18, scale: 0.08 },
      { offsetX: -0.18, offsetZ: -0.42, scale: 0.06 }
    ];

    boulderConfigs.forEach(function(cfg){
      var radius = Math.max(0.35, span * cfg.scale);
      var detail = 2 + Math.floor(rng.range(0, 3));
      var boulder = createBoulder(radius, detail, 'boulder');
      if (!boulder) return;
      boulder.position.set(
        centerX + footprint * cfg.offsetX,
        groundY + podiumHeight * 0.42 + radius * 0.35,
        centerZ + footprint * cfg.offsetZ
      );
      boulder.rotation.y = rng.range(0, Math.PI * 2);
      registerMesh(boulder, { skipEdges: true, edgeColor: EDGE_COLORS.accent, castShadow: true });
    });

    var tuftConfigs = [
      { offsetX: -0.26, offsetZ: 0.32, radius: 0.28, height: 0.9 },
      { offsetX: 0.28, offsetZ: 0.28, radius: 0.24, height: 0.8 },
      { offsetX: 0.04, offsetZ: -0.36, radius: 0.22, height: 0.7 }
    ];

    tuftConfigs.forEach(function(cfg){
      var tuft = createGrassTuft(Math.max(0.12, span * cfg.radius * 0.12), Math.max(0.4, span * cfg.height * 0.12));
      if (!tuft) return;
      tuft.position.set(
        centerX + footprint * cfg.offsetX,
        groundY + podiumHeight * 0.32,
        centerZ + footprint * cfg.offsetZ
      );
      tuft.rotation.y = rng.range(0, Math.PI * 2);
      registerMesh(tuft, { skipEdges: true, castShadow: false, receiveShadow: true });
    });

    var floorGeom = new THREE.PlaneGeometry(footprint * 2.2, footprint * 2.2, 1, 1);
    ensureSecondaryUV(floorGeom);
    var floorMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f7, roughness: 0.95, metalness: 0.0, map: noiseTexture('ground-plane', 240, 6, 4) });
    var floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centerX, groundY - 0.002, centerZ);
    registerMesh(floor, { castShadow: false, receiveShadow: false, skipEdges: true });

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
      var yPos = minY + Math.max(safeSpan * 0.2, heightSpan * heightFactor);
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
        near: 0.05,
        far: Math.max(600, dist * 6.5)
      });
    }

    pushPreset(20, { heightFactor: 0.28, distanceFactor: 1.48, tiltOffset: -0.06, fov: 40 });
    pushPreset(-18, { heightFactor: 0.3, distanceFactor: 1.5, tiltOffset: -0.05, fov: 40 });
    pushPreset(38, { heightFactor: 0.46, distanceFactor: 1.72, tiltOffset: 0.03, fov: 44 });
    pushPreset(-36, { heightFactor: 0.46, distanceFactor: 1.72, tiltOffset: 0.03, fov: 44 });
    pushPreset(70, { heightFactor: 0.6, distanceFactor: 1.86, tiltOffset: 0.05, fov: 46 });
    pushPreset(-68, { heightFactor: 0.6, distanceFactor: 1.86, tiltOffset: 0.05, fov: 46 });
    pushPreset(110, { heightFactor: 0.7, distanceFactor: 2.05, tiltOffset: 0.08, fov: 48 });
    pushPreset(-108, { heightFactor: 0.7, distanceFactor: 2.05, tiltOffset: 0.08, fov: 48 });
    pushPreset(150, { heightFactor: 0.6, distanceFactor: 1.92, tiltOffset: 0.04, fov: 50 });

    var topPos = new THREE.Vector3(
      centerX + safeSpan * 0.04,
      maxY + safeSpan * 4.2,
      centerZ + safeSpan * 0.04
    );
    presets.push({
      position: topPos,
      target: new THREE.Vector3(centerX, baseTargetY, centerZ),
      up: new THREE.Vector3(0, 0, -1),
      fov: 52,
      near: 0.5,
      far: Math.max(800, safeSpan * 12)
    });

    if (!presets.length) {
      var fallback = new THREE.Vector3(centerX + safeSpan * 1.9, maxY + safeSpan * 0.8, centerZ + safeSpan * 1.4);
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
    if (loading) loading.classList.add('visible');
    try {
      var snapshot = gatherProjectSnapshot();
      var hash = computeHash(snapshot);
      if (rng && typeof rng.reseed === 'function') rng.reseed(hash);
      materialExposureCache = Object.create(null);
      skyTexture = null;
      skyGradientPalette = null;
      var skyPalette = selectSkyPalette();
      var qualitySelect = qs(QUALITY_ID);
      var multiplier = qualitySelect ? parseFloat(qualitySelect.value || '1') : 1;
      if (!isFinite(multiplier) || multiplier <= 0) multiplier = 1;
      currentQuality = multiplier;
      ensureRenderer();
      if (renderer && typeof renderer.toneMappingExposure === 'number') {
        var lum = skyPalette && skyPalette.length ? averageLuminance(skyPalette) : 180;
        var normalized = lum / 255;
        var exposureBase = 1.35 + (normalized - 0.5) * 0.22;
        renderer.toneMappingExposure = exposureBase + (multiplier - 1) * 0.24;
      }
      ensureEnvironment();
      disposeSceneChildren();
      var backgroundTex = createSkyTexture();
      scene.background = backgroundTex || new THREE.Color(0xf5f6f8);

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
        var mesh = buildMesh(entry.box, mat);
        registerMesh(mesh, { edgeColor: (entry.kind === 'roof' ? EDGE_COLORS.roof : EDGE_COLORS.default) });
        if (entry.kind === 'room') addArchitecturalAccents(entry);
      });

      if (!isFinite(bounds.minX)) {
        bounds = { minX: -3, maxX: 3, minZ: -3, maxZ: 3, minY: 0, maxY: 3 };
        var placeholder = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 4), materialFor('room'));
        placeholder.position.y = 1.3;
        registerMesh(placeholder, { edgeColor: EDGE_COLORS.default });
      }

      var spanX = bounds.maxX - bounds.minX;
      var spanZ = bounds.maxZ - bounds.minZ;
      var span = Math.max(6, spanX, spanZ);
      var centerX = (bounds.minX + bounds.maxX) / 2;
      var centerY = Math.max(1.4, (bounds.minY + bounds.maxY) / 2);
      var centerZ = (bounds.minZ + bounds.maxZ) / 2;

      var groundY = buildGround(bounds, centerX, centerZ, bounds.minY, span);
      createContactShadow(centerX, centerZ, span, groundY);
      addSignatureFacade(bounds, centerX, centerY, centerZ, span);
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
        var baseWidth = 2500;
        var width = Math.floor(baseWidth * multiplier);
        if (width > 2800) width = 2800;
        var height = Math.floor(width * 9 / 16);
        camera.aspect = width / height;
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
      lastHash = hash;
      var footnote = qs(FOOTNOTE_ID);
      if (footnote) footnote.textContent = formatFootnote(bounds);
    } catch(err){
      console.error('[Visualize] render failed', err);
      try { if (window.updateStatus) window.updateStatus('Visualize failed: ' + err.message); } catch(_s){}
    } finally {
      if (loading) loading.classList.remove('visible');
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
    if (!window.__visualizeEscWired) {
      window.__visualizeEscWired = true;
      document.addEventListener('keydown', function(ev){
        if (ev.key === 'Escape') {
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
    if (fabricCanvas) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
    }
  }

  window.showVisualize = showVisualize;
  window.hideVisualize = hideVisualize;
})();
