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
  var EDGE_COLORS = {
    default: 0xcbd5df,
    roof: 0xaeb4bf,
    wall: 0xbcc3cd,
    podium: 0xbfc6d2
  };

  function qs(id){ return document.getElementById(id); }

  function isFiniteNumber(val){ return typeof val === 'number' && isFinite(val); }

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
    if (typeof renderer.outputColorSpace !== 'undefined' && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (typeof renderer.outputEncoding !== 'undefined' && THREE.sRGBEncoding) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    if (typeof renderer.setClearColor === 'function') renderer.setClearColor(0xf5f6f8, 1);
    if ('physicallyCorrectLights' in renderer) renderer.physicallyCorrectLights = true;
    if ('toneMapping' in renderer && THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = 1.1;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = (THREE.PCFSoftShadowMap || renderer.shadowMap.type);
      renderer.shadowMap.autoUpdate = true;
    }
    if (THREE.ColorManagement) THREE.ColorManagement.enabled = true;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf6f7fb);
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
    var near = Math.max(30, span * 2.4);
    var far = Math.max(160, span * 7);
    scene.fog = new THREE.FogExp2(0xf6f7fb, 1 / Math.max(200, span * 11));
  }

  function setupLighting(centerX, centerY, centerZ, span){
    if (!scene) return;
    clearLighting();
    ensureFog(span);
    var ambient = trackLight(new THREE.AmbientLight(0xf7f8fa, 0.42));
    if (ambient) ambient.castShadow = false;

    var key = trackLight(new THREE.DirectionalLight(0xffffff, 1.18));
    if (key) {
      key.position.set(centerX + span * 1.45, centerY + span * 1.9, centerZ + span * 1.2);
      key.castShadow = true;
      if (key.shadow && key.shadow.camera) {
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = Math.max(400, span * 6.5);
        key.shadow.camera.left = -span * 2.2;
        key.shadow.camera.right = span * 2.2;
        key.shadow.camera.top = span * 2.2;
        key.shadow.camera.bottom = -span * 2.2;
        key.shadow.bias = -0.00035;
        key.shadow.radius = 2;
      }
    }

    var fill = trackLight(new THREE.DirectionalLight(0xf0f2f6, 0.32));
    if (fill) {
      fill.position.set(centerX - span * 1.4, centerY + span * 0.95, centerZ - span * 1.6);
      fill.castShadow = false;
    }

    var rim = trackLight(new THREE.SpotLight(0xffffff, 0.55, span * 7.5, Math.PI / 5.5, 0.45, 1.35));
    if (rim) {
      rim.position.set(centerX - span * 0.65, centerY + span * 2.4, centerZ + span * 1.9);
      rim.target.position.set(centerX, centerY + span * 0.12, centerZ);
      rim.castShadow = true;
      if (rim.shadow) {
        rim.shadow.mapSize.set(1024, 1024);
        rim.shadow.bias = -0.0003;
      }
    }
  }

  function noiseTexture(key, baseBrightness, variation, repeat){
    if (noiseTextures[key]) return noiseTextures[key];
    var size = 256;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var data = ctx.createImageData(size, size);
    var base = (typeof baseBrightness === 'number') ? baseBrightness : 232;
    var range = (typeof variation === 'number') ? variation : 16;
    for (var i=0; i<data.data.length; i+=4){
      var shade = base + Math.round((Math.random() - 0.5) * range);
      shade = Math.max(0, Math.min(255, shade));
      data.data[i] = data.data[i+1] = data.data[i+2] = shade;
      data.data[i+3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    var texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = renderer ? Math.min(renderer.capabilities.getMaxAnisotropy() || 8, 8) : 4;
    var tiles = (typeof repeat === 'number' && repeat > 0) ? repeat : 4;
    texture.repeat.set(tiles, tiles);
    texture.needsUpdate = true;
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
    if (!renderer || envRT) return;
    pmremGenerator = pmremGenerator || new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    var roomScene = new THREE.Scene();
    var neutral = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 32), new THREE.MeshBasicMaterial({ color: 0xfafafa, side: THREE.BackSide }));
    roomScene.add(neutral);
    var accent1 = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0xe0e3e8 }));
    accent1.position.set(18, -8, -14);
    roomScene.add(accent1);
    var accent2 = new THREE.Mesh(new THREE.BoxGeometry(8, 16, 6), new THREE.MeshBasicMaterial({ color: 0xd1d6dd }));
    accent2.position.set(-22, 6, 18);
    roomScene.add(accent2);
    envRT = pmremGenerator.fromScene(roomScene, 0.04);
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
    var mesh = new THREE.Mesh(geometry, material);
    var yBase = baseElevation(box);
    mesh.position.set(box.cx, yBase + (box.height / 2), box.cz);
    if (box.rotation) mesh.rotation.y = box.rotation;
    return mesh;
  }

  function buildWallMesh(strip, material){
    var x0 = strip.x0 || 0, z0 = strip.z0 || 0;
    var x1 = strip.x1 || 0, z1 = strip.z1 || 0;
    var len = Math.max(0.05, Math.hypot(x1 - x0, z1 - z0));
    var wallHeight = Math.max(2.4, strip.height || 3.0);
    var thickness = Math.max(0.06, strip.thickness || 0.3);
    var midX = (x0 + x1) / 2;
    var midZ = (z0 + z1) / 2;
    var angle = Math.atan2(z1 - z0, x1 - x0);
    var geometry = new THREE.BoxGeometry(len, wallHeight, thickness);
    var mesh = new THREE.Mesh(geometry, material);
    var baseY = (typeof strip.y === 'number') ? strip.y : 0;
    var levelBase = (strip.level || 0) * floorHeight + baseY;
    mesh.position.set(midX, levelBase + wallHeight / 2, midZ);
    mesh.rotation.y = angle;
    return { mesh: mesh, len: len, wallHeight: wallHeight, thickness: thickness, midX: midX, midZ: midZ };
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

  function ensureFabric(width, height){
    var canvasEl = qs(FABRIC_ID);
    if (!canvasEl) return;
    canvasEl.width = width;
    canvasEl.height = height;
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    if (fabricCanvas) {
      fabricCanvas.setDimensions({ width: width, height: height });
      return;
    }
    fabricCanvas = new fabric.Canvas(FABRIC_ID, {
      backgroundColor: 'transparent',
      selectionBorderColor: '#2563eb',
      selectionColor: 'rgba(37,99,235,0.12)',
      preserveObjectStacking: true
    });
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
      room: { color: 0xf7f7f5, roughness: 0.32, metalness: 0.03, clearcoat: 0.38, clearcoatRoughness: 0.2, noiseKey: 'room', brightness: 234, variation: 12, repeat: 3.5 },
      garage: { color: 0xe9eaec, roughness: 0.38, metalness: 0.04, clearcoat: 0.22, clearcoatRoughness: 0.3, noiseKey: 'garage', brightness: 228, variation: 18, repeat: 4 },
      pergola: { color: 0xf0f1f3, roughness: 0.25, metalness: 0.02, clearcoat: 0.5, clearcoatRoughness: 0.08, opacity: 0.82, transmission: 0.2, thickness: 0.25, noiseKey: 'pergola', brightness: 236, variation: 10, repeat: 5 },
      pool: { color: 0xf3f4f6, roughness: 0.08, metalness: 0.02, clearcoat: 0.65, clearcoatRoughness: 0.05, transmission: 0.78, thickness: 0.6, attenuationDistance: 2.5, opacity: 1, noiseKey: 'pool', brightness: 240, variation: 6, repeat: 3 },
      roof: { color: 0xd2d6dc, roughness: 0.28, metalness: 0.12, clearcoat: 0.15, clearcoatRoughness: 0.4, noiseKey: 'roof', brightness: 222, variation: 20, repeat: 4 },
      balcony: { color: 0xf5f6f7, roughness: 0.35, metalness: 0.03, clearcoat: 0.3, clearcoatRoughness: 0.22, noiseKey: 'balcony', brightness: 235, variation: 10, repeat: 5 },
      furniture: { color: 0xe6e8ec, roughness: 0.45, metalness: 0.05, clearcoat: 0.1, clearcoatRoughness: 0.5, noiseKey: 'furn', brightness: 226, variation: 22, repeat: 6 },
      wall: { color: 0xe0e4e9, roughness: 0.4, metalness: 0.04, clearcoat: 0.2, clearcoatRoughness: 0.35, noiseKey: 'wall', brightness: 225, variation: 18, repeat: 6 }
    };
    var spec = palette[kind] || { color: 0xf2f3f5, roughness: 0.4, metalness: 0.05, clearcoat: 0.18, clearcoatRoughness: 0.35, noiseKey: 'default', brightness: 230, variation: 16, repeat: 4 };
    var mat = new THREE.MeshPhysicalMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      clearcoat: spec.clearcoat || 0,
      clearcoatRoughness: spec.clearcoatRoughness || 0,
      transmission: spec.transmission || 0,
      thickness: spec.thickness || 0.1,
      attenuationDistance: spec.attenuationDistance || 0,
      attenuationColor: new THREE.Color(0xffffff)
    });
    mat.envMapIntensity = spec.envMapIntensity || 1.25;
    if (typeof spec.opacity === 'number') {
      mat.opacity = spec.opacity;
      mat.transparent = spec.opacity < 1 || (spec.transmission && spec.transmission > 0);
    }
    mat.side = (kind === 'pergola' || kind === 'roof') ? THREE.DoubleSide : THREE.FrontSide;
    var tex = noiseTexture(spec.noiseKey || kind, spec.brightness, spec.variation, spec.repeat);
    mat.map = tex;
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

  function buildGround(bounds, centerX, centerZ, baseY, span){
    var dx = bounds.maxX - bounds.minX;
    var dz = bounds.maxZ - bounds.minZ;
    if (!isFinite(dx) || !isFinite(dz) || dx <= 0 || dz <= 0) {
      dx = dz = 12;
    }
    var footprint = Math.max(dx, dz, span);
    var podiumHeight = Math.max(0.08, footprint * 0.015);
    var baseGeom = new THREE.BoxGeometry(footprint * 1.65, podiumHeight, footprint * 1.5);
    var baseMat = new THREE.MeshPhysicalMaterial({ color: 0xe2e6ec, roughness: 0.85, metalness: 0.02, clearcoat: 0.08, clearcoatRoughness: 0.6, map: noiseTexture('ground-base', 224, 18, 2.5) });
    var base = new THREE.Mesh(baseGeom, baseMat);
    var groundY = (typeof baseY === 'number') ? baseY : 0;
    base.position.set(centerX, groundY - (podiumHeight / 2), centerZ);
    registerMesh(base, { edgeColor: EDGE_COLORS.podium, castShadow: false });

    var deckGeom = new THREE.BoxGeometry(footprint * 1.35, podiumHeight * 0.55, footprint * 1.25);
    var deckMat = new THREE.MeshPhysicalMaterial({ color: 0xf5f6f8, roughness: 0.62, metalness: 0.04, clearcoat: 0.12, clearcoatRoughness: 0.25, map: noiseTexture('ground-deck', 236, 10, 3) });
    var deck = new THREE.Mesh(deckGeom, deckMat);
    deck.position.set(centerX, groundY + podiumHeight * 0.12, centerZ);
    registerMesh(deck, { edgeColor: EDGE_COLORS.default, castShadow: false });

    var floorGeom = new THREE.PlaneGeometry(footprint * 2.2, footprint * 2.2, 1, 1);
    var floorMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f7, roughness: 0.95, metalness: 0.0, map: noiseTexture('ground-plane', 240, 6, 4) });
    var floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centerX, groundY - 0.002, centerZ);
    registerMesh(floor, { castShadow: false, receiveShadow: false, skipEdges: true });

    return groundY;
  }

  function renderSnapshot(){
    var loading = qs(LOADING_ID);
    if (loading) loading.classList.add('visible');
    try {
      var snapshot = gatherProjectSnapshot();
      var hash = computeHash(snapshot);
      var qualitySelect = qs(QUALITY_ID);
      var multiplier = qualitySelect ? parseFloat(qualitySelect.value || '1') : 1;
      if (!isFinite(multiplier) || multiplier <= 0) multiplier = 1;
      currentQuality = multiplier;
      ensureRenderer();
      ensureEnvironment();
      disposeSceneChildren();
      scene.background = new THREE.Color(0xf5f6f8);

      var bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      var boxes = gatherBoxes(snapshot);
      boxes.forEach(function(entry){ includeBounds(bounds, entry.box); });

      var wallMaterial = materialFor('wall');
      snapshot.wallStrips.forEach(function(strip){
        var mat = wallMaterial.clone();
        mat.map = noiseTexture('wall-' + (strip.level || 0), 228, 20, 8);
        var result = buildWallMesh(strip, mat);
        includeBounds(bounds, { cx: result.midX, cz: result.midZ, width: result.len, depth: result.thickness, height: result.wallHeight, level: strip.level || 0 });
        registerMesh(result.mesh, { edgeColor: EDGE_COLORS.wall });
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

      var animElevation = Math.max(0.2, span * 0.18);
      var camDistance = span * 1.9;
      var elevation = centerY + (span * 0.72) + animElevation;
      camera.position.set(centerX + camDistance, elevation, centerZ + camDistance * 0.78);
      camera.near = 0.05;
      camera.far = Math.max(600, camDistance * 6.5);
      camera.lookAt(new THREE.Vector3(centerX, centerY + (span * 0.14), centerZ));
      camera.updateProjectionMatrix();
      setupLighting(centerX, centerY, centerZ, span);

      var canvas = qs(CANVAS_ID);
      if (canvas) {
        var width = Math.floor(1600 * multiplier);
        var height = Math.floor(width * 9 / 16);
        camera.aspect = width / height;
        renderer.setSize(width, height, false);
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        ensureFabric(width, height);
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
  }

  function showVisualize(){
    var modal = qs(PANEL_ID);
    if (!modal) return;
    modal.classList.add('visible');
    ensureEvents();
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
