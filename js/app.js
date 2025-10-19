function drawHandlesForPergola(pergola) {
  try {
    var isActive = selectedRoomId === pergola.id;
    var handleY = pergola.height + 0.2;
    var handleData = [
      {x: pergola.x + pergola.width/2, y: handleY, z: pergola.z, type: 'width+', label: 'X+'},
      {x: pergola.x - pergola.width/2, y: handleY, z: pergola.z, type: 'width-', label: 'X-'},
      {x: pergola.x, y: handleY, z: pergola.z + pergola.depth/2, type: 'depth+', label: 'Z+'},
      {x: pergola.x, y: handleY, z: pergola.z - pergola.depth/2, type: 'depth-', label: 'Z-'}
    ];

    for (var i = 0; i < handleData.length; i++) {
      var handle = handleData[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;

      drawHandle(screen, handle.type, handle.label, isActive);

      resizeHandles.push({
        screenX: screen.x - HANDLE_RADIUS,
        screenY: screen.y - HANDLE_RADIUS,
        width: HANDLE_RADIUS * 2,
        height: HANDLE_RADIUS * 2,
        type: handle.type,
        roomId: pergola.id
      });
    }
  } catch (error) {
    console.error('Pergola handle error:', error);
  }
}
'use strict';

var canvas = null;
var ctx = null;
var screenW = 0;
var screenH = 0;
var centerX = 0;
var centerY = 0;
var deviceRatio = 1;
var allRooms = [];
// Standalone wall strips extruded from 2D plan when no closed rooms are present
var wallStrips = [];
var selectedRoomId = null;
var editingLabelId = null; // which object's label is currently being edited
var paletteOpenForId = null; // which room/component is open in palette
var currentFloor = 0;
var resizeHandles = [];
var animationId = null;
var stairsComponent = null;
var pergolaComponents = [];
var balconyComponents = [];
var garageComponents = [];
var poolComponents = [];
var roofComponents = [];
var currentSnapGuides = [];
var furnitureItems = [];

// Lightweight debug logger to avoid per-frame console overhead
var DEBUG = false;
function dbg() {
  if (DEBUG && typeof console !== 'undefined' && console.log) {
    try { console.log.apply(console, arguments); } catch (e) {}
  }
}

// Projection cache to avoid repeated trig in hot path
var _projCache = {
  yaw: null,
  pitch: null,
  cosYaw: 1,
  sinYaw: 0,
  cosPitch: 1,
  sinPitch: 0,
  fov: 800
};
function updateProjectionCache() {
  if (_projCache.yaw !== camera.yaw) {
    _projCache.yaw = camera.yaw;
    _projCache.cosYaw = Math.cos(camera.yaw);
    _projCache.sinYaw = Math.sin(camera.yaw);
  }
  if (_projCache.pitch !== camera.pitch) {
    _projCache.pitch = camera.pitch;
    _projCache.cosPitch = Math.cos(camera.pitch);
    _projCache.sinPitch = Math.sin(camera.pitch);
  }
}

// Quick offscreen culling using object center with generous margins
function isOffscreenByCenter(screenPt) {
  if (!screenPt) return true;
  var margin = 200; // generous margin to avoid pop-in
  return (screenPt.x < -margin || screenPt.x > (screenW + margin) || screenPt.y < -margin || screenPt.y > (screenH + margin));
}

var HANDLE_RADIUS = 12;
var GRID_SPACING = 0.5;
var SNAP_GRID_TOLERANCE = 1.0;
var SNAP_CENTER_TOLERANCE = 0.6;
var HANDLE_SNAP_TOLERANCE = 0.25;
// Screen-space offset for the world height bar: push left by N pixels from camera target
var HEIGHT_BAR_SCREEN_OFFSET_PX = 500;
// Fade settings for the height bar (fade out when camera inactive)
var HEIGHT_BAR_INACTIVITY_MS = 1200;
var _camLastMoveTime = 0;
var _heightBarAlpha = 1;

// Throttles for expensive DOM updates
var LABEL_UPDATE_INTERVAL_MS = 120;
var MEASURE_UPDATE_INTERVAL_MS = 250;
// Consistent meter formatting across 2D/3D UIs
function formatMeters(value){
  var n = Number(value);
  if (!isFinite(n)) return '0.00';
  return n.toFixed(2);
}
// Numeric quantizer (returns Number) for meter values
function quantizeMeters(value, decimals){
  var n = Number(value);
  if (!isFinite(n)) return 0;
  var d = (typeof decimals==='number' && decimals>=0) ? decimals : 2;
  return +n.toFixed(d);
}
var _lastLabelsUpdate = 0;
var _lastMeasurementsUpdate = 0;
// Prevent label/button flashing: when hovering an edit button, freeze label DOM updates
window.__labelsFrozen = false;

// Offscreen grid cache
var _gridCache = {
  canvas: null,
  ctx: null,
  key: '',
  w: 0,
  h: 0
};
function getGridCacheKey(interacting, spacing, rangeFactor, minGrid) {
  // Include pan and use finer rounding to avoid visible drift
  var rx = camera.targetX.toFixed(2);
  var rz = camera.targetZ.toFixed(2);
  var rd = camera.distance.toFixed(2);
  var ry = (camera.yaw % (Math.PI * 2)).toFixed(3);
  var rp = camera.pitch.toFixed(3);
  var px = (pan.x || 0).toFixed(0);
  var py = (pan.y || 0).toFixed(0);
  return [rx, rz, rd, ry, rp, px, py, interacting ? 1 : 0, spacing, rangeFactor, minGrid, screenW, screenH, deviceRatio].join('|');
}

// Global handle styles and helpers
var HANDLE_STYLE = {
  active: {
    fill: { width: '#007acc', depth: '#0099ff', height: '#00cc66', rotate: '#ff9900' },
    stroke: { default: 'white', rotate: '#ffcc00' },
    label: '#ffffff',
    opacity: 1.0
  },
  inactive: {
    fill: { any: '#cfcfcf' },
    stroke: { default: '#e0e0e0', rotate: '#e0e0e0' },
    label: '#909090',
    opacity: 0.5
  }
};

function getHandleStyle(type, isActive) {
  var s = isActive ? HANDLE_STYLE.active : HANDLE_STYLE.inactive;
  function prefix(t) {
    if (t.indexOf('width') === 0) return 'width';
    if (t.indexOf('depth') === 0) return 'depth';
    if (t === 'height') return 'height';
    if (t === 'rotate') return 'rotate';
    return 'any';
  }
  var p = prefix(type);
  return {
    fill: isActive ? (p === 'width' ? s.fill.width : p === 'depth' ? s.fill.depth : p === 'height' ? s.fill.height : s.fill.rotate) : s.fill.any,
    stroke: isActive ? (type === 'rotate' ? s.stroke.rotate : s.stroke.default) : s.stroke.default,
    label: s.label,
    opacity: s.opacity
  };
}

function drawHandle(screen, type, label, isActive, radius) {
  var style = getHandleStyle(type, isActive);
  var font = type === 'rotate' ? 'bold 14px sans-serif' : 'bold 10px sans-serif';

  // Shadow glow only for active rotate handles
  if (isActive && type === 'rotate') {
    ctx.save();
    ctx.shadowColor = HANDLE_STYLE.active.stroke.rotate;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = style.opacity;
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = type === 'rotate' ? 3 : 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius || HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = style.opacity;
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = type === 'rotate' ? 3 : 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius || HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Label
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.fillStyle = style.label;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, screen.x, screen.y);
  ctx.restore();
}

var camera = {
  yaw: 0.0,
  pitch: -0.5,
  distance: 12,
  targetX: 0,
  targetZ: 0,
  minPitch: -Math.PI * 0.4,
  maxPitch: 0.1,
  minDistance: 3,
  maxDistance: 80
};

var mouse = {
  down: false,
  lastX: 0,
  lastY: 0,
  dragType: null,
  dragInfo: null
};

var pan = { x: 0, y: 0 };

var PRICING = {
  room: 600,
  stairs: 1200,
  pergola: 500,
  garage: 500,
  pool: 700,
  roof: 215,
  balcony: 800,
  // Openings
  windowTripleGlazedPerM2: 1400, // $/m² glass area (triple glazed)
  doorUnit: 850,                 // $ per standard door unit
  // Concrete slab and soil prep (AUD)
  concreteSlabPerSqm: 330,      // $/m² (includes reinforcement)
  slabThicknessM: 0.10,         // meters (100mm typical)
  soilCostPerTonne: 600,        // $/tonne of soil for formwork/prep/disposal
  soilDensityTPerM3: 1.5        // tonnes per m³ (typical bulk density)
};

function createBalcony(x, z) {
  var count = balconyComponents.length;
  return {
    id: 'balcony_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    x: x || 8,
    z: z || 8,
    width: 4,
    depth: 3,
    height: 2.7,
    roofThickness: 0.3,
    totalHeight: 3,
    legWidth: 0.3,
    slatCount: 8,
    slatWidth: 0.15,
    wallThickness: 0.2,
    wallHeight: 1.0,
    name: count === 0 ? 'Balcony' : 'Balcony ' + (count + 1),
    type: 'balcony',
    level: 1  // Always on first floor
  };
}

function addBalcony() {
  dbg('Adding new balcony...');
  var newBalcony = createBalcony();
  dbg('Created balcony:', newBalcony);
  
  var spot = findFreeSpot(newBalcony);
  newBalcony.x = spot.x;
  newBalcony.z = spot.z;
  dbg('Found spot for balcony:', spot);
  
  balconyComponents.push(newBalcony);
  dbg('Balcony components now:', balconyComponents);
  
  currentFloor = 1;  // Switch to first floor
  selectedRoomId = newBalcony.id;
  dbg('Set current floor to:', currentFloor, 'Selected ID:', selectedRoomId);
  
  var selector = document.getElementById('levelSelect');
  if (selector) {
    selector.value = '1';
  dbg('Updated selector value to:', selector.value);
  }
  
  renderLoop(); // Force a render update
  updateStatus('Balcony added (' + balconyComponents.length + ' total)');
}

function startApp() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  setupCanvas();
  createInitialRoom();
  setupEvents();
  startRender();
  updateStatus('Ready');
}

function updateStatus(message) {
  var status = document.getElementById('status');
  if (status) status.textContent = message;
}

function setupCanvas() {
  var ratio = Math.min(2, window.devicePixelRatio || 1);
  screenW = window.innerWidth;
  screenH = window.innerHeight;
  
  canvas.width = screenW * ratio;
  canvas.height = screenH * ratio;
  canvas.style.width = screenW + 'px';
  canvas.style.height = screenH + 'px';
  
  centerX = screenW / 2;
  centerY = screenH / 2 + 200;
  
  ctx.scale(ratio, ratio);
  ctx.imageSmoothingEnabled = true;
  deviceRatio = ratio;
}

function project3D(worldX, worldY, worldZ) {
  try {
    var dx = worldX - camera.targetX;
    var dy = worldY;
    var dz = worldZ - camera.targetZ;

    // Use cached trig
    var rotX = _projCache.cosYaw * dx + _projCache.sinYaw * dz;
    var rotZ = -_projCache.sinYaw * dx + _projCache.cosYaw * dz;

    var finalY = _projCache.cosPitch * dy - _projCache.sinPitch * rotZ;
    var finalZ = _projCache.sinPitch * dy + _projCache.cosPitch * rotZ + camera.distance;

    if (finalZ <= 0.1) return null;

    var fov = _projCache.fov;
    var screenX = centerX + (rotX * fov) / finalZ + pan.x;
    var screenY = centerY - (finalY * fov) / finalZ + pan.y;

    return { x: screenX, y: screenY, depth: finalZ };
  } catch (e) {
    return null;
  }
}

function createRoom(x, z, level) {
  var count = allRooms.filter(function(r) { return r.level === level; }).length;
  return {
    id: 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    x: x, z: z, width: 4, depth: 3, height: 3, level: level,
    name: 'Room ' + (count + 1) + (level > 0 ? ' (Floor ' + (level + 1) + ')' : '')
  };
}

function createInitialRoom() {
  var room = createRoom(0, 0, 0);
  allRooms.push(room);
  selectedRoomId = room.id;
  // Make sure camera can see the room
  camera.targetX = 0;
  camera.targetZ = 0;
  camera.distance = 15;
  camera.pitch = -0.6;
  camera.yaw = 0.2;
}

function addNewRoom() {
  try {
    var room = createRoom(0, 0, currentFloor);
    var spot = findFreeSpot(room);
    room.x = spot.x;
    room.z = spot.z;
    allRooms.push(room);
    selectedRoomId = room.id;
    updateStatus('Room added');
  } catch (error) {
    console.error('Add room error:', error);
    updateStatus('Error adding room');
  }
}

function createStairs() {
  return {
    id: 'stairs_' + Date.now(),
    x: -6, z: -6, width: 3, depth: 8, height: 3.5, steps: 14,
    name: 'Stairs', type: 'stairs', level: 0
  };
}

function addStairs() {
  if (stairsComponent) {
    updateStatus('Stairs already exist');
    return;
  }
  stairsComponent = createStairs();
  var spot = findFreeSpot(stairsComponent);
  stairsComponent.x = spot.x;
  stairsComponent.z = spot.z;
  currentFloor = 0;
  selectedRoomId = stairsComponent.id;
  var selector = document.getElementById('levelSelect');
  if (selector) selector.value = '0';
  updateStatus('Stairs added');
}

function createPergola(x, z) {
  var count = pergolaComponents.length;
  return {
    id: 'pergola_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    x: x || 8,
    z: z || 8,
    width: 4,
    depth: 3,
    height: 2.7,
    roofThickness: 0.3,
    totalHeight: 3,
    legWidth: 0.3,
    slatCount: 8,
    slatWidth: 0.15,
    name: count === 0 ? 'Pergola' : 'Pergola ' + (count + 1),
    type: 'pergola',
    level: 0
  };
}

function addPergola() {
  var newPergola = createPergola();
  var spot = findFreeSpot(newPergola);
  newPergola.x = spot.x;
  newPergola.z = spot.z;
  
  pergolaComponents.push(newPergola);
  currentFloor = 0;
  selectedRoomId = newPergola.id;
  
  var selector = document.getElementById('levelSelect');
  if (selector) selector.value = '0';
  
  updateStatus('Pergola added (' + pergolaComponents.length + ' total)');
}

function createGarage(x, z) {
  var count = garageComponents.length;
  return {
    id: 'garage_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    x: x || 10, z: z || 10, width: 4, depth: 3, height: 3, wallThickness: 0.2,
    doorSlatCount: 8, doorSlatHeight: 0.3, doorSlatDepth: 0.05,
    rotation: 0, // Add rotation property
    name: count === 0 ? 'Garage' : 'Garage ' + (count + 1),
    type: 'garage', level: 0
  };
}

function addGarage() {
  var newGarage = createGarage();
  var spot = findFreeSpot(newGarage);
  newGarage.x = spot.x;
  newGarage.z = spot.z;
  garageComponents.push(newGarage);
  currentFloor = 0;
  selectedRoomId = newGarage.id;
  var selector = document.getElementById('levelSelect');
  if (selector) selector.value = '0';
  updateStatus('Garage added (' + garageComponents.length + ' total)');
}

function createPool(x, z) {
  var count = poolComponents.length;
  return {
    id: 'pool_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    x: x || 6, z: z || 6, width: 6, depth: 3, height: 1.5,
    wallThickness: 0.3, rotation: 0,
    name: count === 0 ? 'Pool' : 'Pool ' + (count + 1),
    type: 'pool', level: 0
  };
}

function addPool() {
  var newPool = createPool();
  var spot = findFreeSpot(newPool);
  newPool.x = spot.x;
  newPool.z = spot.z;
  poolComponents.push(newPool);
  currentFloor = 0;
  selectedRoomId = newPool.id;
  var selector = document.getElementById('levelSelect');
  if (selector) selector.value = '0';
  updateStatus('Pool added (' + poolComponents.length + ' total)');
}

function createRoof(x, z) {
  var count = roofComponents.length;
  
  // Check if there are any first floor rooms
  var hasFirstFloor = allRooms.some(function(room) {
    return room.level === 1;
  });
  
  var roofLevel = hasFirstFloor ? 1 : 0;
  var baseHeight = roofLevel * 3.5 + 3; // Room height is 3
  
  // Calculate roof dimensions to match existing rooms/buildings
  var allBuildings = allRooms.concat(garageComponents);
  var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  
  for (var i = 0; i < allBuildings.length; i++) {
    var building = allBuildings[i];
    if (building.level === roofLevel) {
      var hw = building.width / 2;
      var hd = building.depth / 2;
      minX = Math.min(minX, building.x - hw);
      maxX = Math.max(maxX, building.x + hw);
      minZ = Math.min(minZ, building.z - hd);
      maxZ = Math.max(maxZ, building.z + hd);
    }
  }
  
  var roofWidth = 6;
  var roofDepth = 8;
  var roofCenterX = 0;
  var roofCenterZ = 0;
  
  if (minX !== Infinity) {
    roofWidth = Math.max(6, maxX - minX + 2);
    roofDepth = Math.max(8, maxZ - minZ + 2);
    roofCenterX = (minX + maxX) / 2;
    roofCenterZ = (minZ + maxZ) / 2;
  }
  
  return {
    id: 'roof_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    x: x || roofCenterX,
    z: z || roofCenterZ,
    width: roofWidth,
    depth: roofDepth,
    height: 1.5,
    baseHeight: baseHeight,
    roofType: 'gable',
    name: count === 0 ? 'Roof' : 'Roof ' + (count + 1),
    type: 'roof',
    level: roofLevel
  };
}

function addRoof() {
  var newRoof = createRoof();
  // newRoof.x and newRoof.z are already centered in createRoof
  roofComponents.push(newRoof);
  currentFloor = 0;
  selectedRoomId = newRoof.id;
  var selector = document.getElementById('levelSelect');
  if (selector) selector.value = '0';
  updateStatus('Roof added (' + roofComponents.length + ' total)');
}

function objectsOverlap(objA, objB, padding) {
  if (!padding) padding = 0.5;
  if (objA.level !== objB.level && objA.type !== 'stairs' && objB.type !== 'stairs') {
    return false;
  }
  
  var aLeft = objA.x - objA.width/2 - padding;
  var aRight = objA.x + objA.width/2 + padding;
  var aFront = objA.z - objA.depth/2 - padding;
  var aBack = objA.z + objA.depth/2 + padding;
  
  var bLeft = objB.x - objB.width/2;
  var bRight = objB.x + objB.width/2;
  var bFront = objB.z - objB.depth/2;
  var bBack = objB.z + objB.depth/2;
  
  return !(aRight <= bLeft || bRight <= aLeft || aBack <= bFront || bBack <= aFront);
}

function findFreeSpot(newObject) {
  var existing = allRooms.filter(function(r) { return r.level === newObject.level; });
  
  if (stairsComponent && stairsComponent.id !== newObject.id) {
    existing.push(stairsComponent);
  }
  
  for (var i = 0; i < balconyComponents.length; i++) {
    if (balconyComponents[i].id !== newObject.id && balconyComponents[i].level === newObject.level) {
      existing.push(balconyComponents[i]);
    }
  }
  
  for (var i = 0; i < pergolaComponents.length; i++) {
    if (pergolaComponents[i].id !== newObject.id) {
      existing.push(pergolaComponents[i]);
    }
  }
  
  for (var i = 0; i < garageComponents.length; i++) {
    if (garageComponents[i].id !== newObject.id) {
      existing.push(garageComponents[i]);
    }
  }
  
  for (var i = 0; i < poolComponents.length; i++) {
    if (poolComponents[i].id !== newObject.id) {
      existing.push(poolComponents[i]);
    }
  }
  
  for (var i = 0; i < roofComponents.length; i++) {
    if (roofComponents[i].id !== newObject.id) {
      existing.push(roofComponents[i]);
    }
  }
  
  for (var radius = 0; radius <= 30; radius += GRID_SPACING) {
    var positions = [];
    
    if (radius === 0) {
      positions = [{x: 0, z: 0}];
    } else {
      var steps = Math.max(8, Math.floor(radius * 0.5));
      for (var i = 0; i < steps; i++) {
        var angle = (i / steps) * Math.PI * 2;
        var rawX = Math.cos(angle) * radius;
        var rawZ = Math.sin(angle) * radius;
        var gridX = Math.round(rawX / GRID_SPACING) * GRID_SPACING;
        var gridZ = Math.round(rawZ / GRID_SPACING) * GRID_SPACING;
        positions.push({x: gridX, z: gridZ});
      }
    }
    
    for (var j = 0; j < positions.length; j++) {
      var pos = positions[j];
      var test = {
        x: pos.x, z: pos.z, width: newObject.width, depth: newObject.depth,
        level: newObject.level, type: newObject.type
      };
      
      var hasCollision = false;
      for (var k = 0; k < existing.length; k++) {
        if (objectsOverlap(test, existing[k])) {
          hasCollision = true;
          break;
        }
      }
      
      if (!hasCollision) return pos;
    }
  }
  
  return {x: 36, z: 36};
}

function applySnap(object) {
  var snapX = object.x;
  var snapZ = object.z;
  var guides = [];
  
  var others = allRooms.filter(function(r) {
    return r.id !== object.id && r.level === object.level;
  });
  
  if (stairsComponent && stairsComponent.id !== object.id) {
    others.push(stairsComponent);
  }
  
  for (var i = 0; i < pergolaComponents.length; i++) {
    if (pergolaComponents[i].id !== object.id) {
      others.push(pergolaComponents[i]);
    }
  }
  
  for (var i = 0; i < garageComponents.length; i++) {
    if (garageComponents[i].id !== object.id) {
      others.push(garageComponents[i]);
    }
  }
  
  for (var i = 0; i < poolComponents.length; i++) {
    if (poolComponents[i].id !== object.id) {
      others.push(poolComponents[i]);
    }
  }
  
  for (var i = 0; i < roofComponents.length; i++) {
    if (roofComponents[i].id !== object.id) {
      others.push(roofComponents[i]);
    }
  }
  
  var gridX = Math.round(object.x / GRID_SPACING) * GRID_SPACING;
  var gridZ = Math.round(object.z / GRID_SPACING) * GRID_SPACING;
  
  if (Math.abs(object.x - gridX) < SNAP_GRID_TOLERANCE) {
    snapX = gridX;
    guides.push({type: 'vertical', x: gridX, color: '#95a5a6'});
  }
  
  if (Math.abs(object.z - gridZ) < SNAP_GRID_TOLERANCE) {
    snapZ = gridZ;
    guides.push({type: 'horizontal', z: gridZ, color: '#95a5a6'});
  }
  
  for (var i = 0; i < others.length; i++) {
    var other = others[i];
    if (Math.abs(object.x - other.x) < SNAP_CENTER_TOLERANCE) {
      snapX = other.x;
      guides.push({type: 'vertical', x: other.x, color: '#e74c3c'});
    }
    if (Math.abs(object.z - other.z) < SNAP_CENTER_TOLERANCE) {
      snapZ = other.z;
      guides.push({type: 'horizontal', z: other.z, color: '#e74c3c'});
    }
  }
  
  return {x: snapX, z: snapZ, guides: guides};
}

function clearCanvas() {
  ctx.fillStyle = '#f8fbff';
  ctx.fillRect(0, 0, screenW, screenH);
}

function drawGrid() {
  // Params depend on interaction to reduce cost while dragging
  var interacting = !!mouse.down;
  var spacing = GRID_SPACING; // keep spacing constant for consistent alignment
  var rangeFactor = interacting ? 1.0 : 1.5; // only reduce range during interaction
  var minGrid = interacting ? 12 : 20;
  var gridRange = Math.max(minGrid, camera.distance * rangeFactor);

  // Ensure projection cache is current for this frame
  updateProjectionCache();

  // Build a coarse key and reuse cached grid if possible
  var key = getGridCacheKey(interacting, spacing, rangeFactor, minGrid);
  var needsRebuild = !_gridCache.canvas || _gridCache.key !== key || _gridCache.w !== screenW || _gridCache.h !== screenH;

  if (needsRebuild) {
    // Create or resize offscreen canvas
    var oc = _gridCache.canvas || document.createElement('canvas');
    var octx = _gridCache.ctx || oc.getContext('2d');
    oc.width = Math.max(1, Math.floor(screenW * deviceRatio));
    oc.height = Math.max(1, Math.floor(screenH * deviceRatio));
    // Clear
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, oc.width, oc.height);
    // Draw in device pixels; match main canvas scale
    octx.scale(deviceRatio, deviceRatio);

    // Draw grid onto offscreen (minor lines at 0.5m, major at 1.0m)
    function isMajor(v){
      // Treat values close to an integer meter as major
      var m = Math.round(v);
      return Math.abs(v - m) < 1e-6;
    }

    var minX = camera.targetX - gridRange;
    var maxX = camera.targetX + gridRange;
    var minZ = camera.targetZ - gridRange;
    var maxZ = camera.targetZ + gridRange;

    // Snap to spacing to avoid jitter
    minX = Math.floor(minX / spacing) * spacing;
    maxX = Math.ceil(maxX / spacing) * spacing;
    minZ = Math.floor(minZ / spacing) * spacing;
    maxZ = Math.ceil(maxZ / spacing) * spacing;

    for (var z = minZ; z <= maxZ; z += spacing) {
      var h1 = project3D(minX, 0, z);
      var h2 = project3D(maxX, 0, z);
      if (h1 && h2) {
        // Style per-line so 1m lines stand out
        if (isMajor(z)) { octx.strokeStyle = '#cbd5e1'; octx.lineWidth = 1.5; }
        else { octx.strokeStyle = '#e5e7eb'; octx.lineWidth = 1; }
        octx.beginPath();
        octx.moveTo(h1.x, h1.y);
        octx.lineTo(h2.x, h2.y);
        octx.stroke();
      }
    }

    for (var x = minX; x <= maxX; x += spacing) {
      var v1 = project3D(x, 0, minZ);
      var v2 = project3D(x, 0, maxZ);
      if (v1 && v2) {
        if (isMajor(x)) { octx.strokeStyle = '#cbd5e1'; octx.lineWidth = 1.5; }
        else { octx.strokeStyle = '#e5e7eb'; octx.lineWidth = 1; }
        octx.beginPath();
        octx.moveTo(v1.x, v1.y);
        octx.lineTo(v2.x, v2.y);
        octx.stroke();
      }
    }

    // Axis lines
    octx.lineWidth = 2;
    // X axis
    octx.strokeStyle = '#ff4444';
    var xStart = project3D(-gridRange, 0, 0);
    var xEnd = project3D(gridRange, 0, 0);
    if (xStart && xEnd) {
      octx.beginPath();
      octx.moveTo(xStart.x, xStart.y);
      octx.lineTo(xEnd.x, xEnd.y);
      octx.stroke();
    }
    // Z axis
    octx.strokeStyle = '#4444ff';
    var zStart = project3D(0, 0, -gridRange);
    var zEnd = project3D(0, 0, gridRange);
    if (zStart && zEnd) {
      octx.beginPath();
      octx.moveTo(zStart.x, zStart.y);
      octx.lineTo(zEnd.x, zEnd.y);
      octx.stroke();
    }

    // North arrow
    try {
      var nBaseW = { x: camera.targetX, y: 0.02, z: camera.targetZ + Math.min(4, gridRange * 0.2) };
      var nTipW  = { x: camera.targetX, y: 0.02, z: camera.targetZ + Math.min(5.5, gridRange * 0.27) };
      var nBase = project3D(nBaseW.x, nBaseW.y, nBaseW.z);
      var nTip  = project3D(nTipW.x,  nTipW.y,  nTipW.z);
      if (nBase && nTip) {
        octx.strokeStyle = '#e74c3c';
        octx.fillStyle = '#e74c3c';
        octx.lineWidth = 2;
        octx.beginPath();
        octx.moveTo(nBase.x, nBase.y);
        octx.lineTo(nTip.x, nTip.y);
        octx.stroke();

        var ang = Math.atan2(nTip.y - nBase.y, nTip.x - nBase.x);
        var headLen = 10;
        var leftX = nTip.x - headLen * Math.cos(ang - Math.PI / 6);
        var leftY = nTip.y - headLen * Math.sin(ang - Math.PI / 6);
        var rightX = nTip.x - headLen * Math.cos(ang + Math.PI / 6);
        var rightY = nTip.y - headLen * Math.sin(ang + Math.PI / 6);
        octx.beginPath();
        octx.moveTo(nTip.x, nTip.y);
        octx.lineTo(leftX, leftY);
        octx.lineTo(rightX, rightY);
        octx.closePath();
        octx.fill();

        octx.fillStyle = '#333';
        octx.font = 'bold 12px system-ui, sans-serif';
        octx.textAlign = 'center';
        octx.textBaseline = 'bottom';
        octx.fillText('N', nTip.x, nTip.y - 4);
      }
    } catch (e) {
      // ignore
    }

    // Save cache
    _gridCache.canvas = oc; _gridCache.ctx = octx; _gridCache.key = key; _gridCache.w = screenW; _gridCache.h = screenH;
  }

  // Blit cached grid using the current canvas transform (already scaled to CSS px)
  if (_gridCache.canvas) {
    ctx.drawImage(_gridCache.canvas, 0, 0, screenW, screenH);
  }
}

// Draw a height scale pole anchored in world space near the camera target, so it sits on the grid
function drawWorldHeightScale() {
  try {
    // Find closest room to camera target
    var closestRoom = null;
    var bestD2 = Infinity;
    for (var i = 0; i < allRooms.length; i++) {
      var rm = allRooms[i];
      var dxr = rm.x - camera.targetX;
      var dzr = rm.z - camera.targetZ;
      var d2 = dxr*dxr + dzr*dzr;
      if (d2 < bestD2) { bestD2 = d2; closestRoom = rm; }
    }
    if (!closestRoom) return;

    // Choose the nearest corner of that room to the camera target (XZ plane)
    var hw = closestRoom.width / 2;
    var hd = closestRoom.depth / 2;
    var corners = [
      { x: closestRoom.x - hw, z: closestRoom.z - hd },
      { x: closestRoom.x + hw, z: closestRoom.z - hd },
      { x: closestRoom.x + hw, z: closestRoom.z + hd },
      { x: closestRoom.x - hw, z: closestRoom.z + hd }
    ];
    var baseX = corners[0].x, baseZ = corners[0].z;
    bestD2 = Infinity;
    for (var c = 0; c < corners.length; c++) {
      var cx = corners[c].x, cz = corners[c].z;
      var ddx = cx - camera.targetX, ddz = cz - camera.targetZ;
      var cd2 = ddx*ddx + ddz*ddz;
      if (cd2 < bestD2) { bestD2 = cd2; baseX = cx; baseZ = cz; }
    }
    // Snap to grid
    baseX = Math.round(baseX / GRID_SPACING) * GRID_SPACING;
    baseZ = Math.round(baseZ / GRID_SPACING) * GRID_SPACING;

    // Compute actual home max height from rooms and roof
    var homeMax = 0;
    for (var rj = 0; rj < allRooms.length; rj++) {
      var rr = allRooms[rj];
      var top = rr.level * 3.5 + rr.height;
      if (top > homeMax) homeMax = top;
    }
    var roofMax = 0;
    for (var rk = 0; rk < roofComponents.length; rk++) {
      var rf2 = roofComponents[rk];
      roofMax = Math.max(roofMax, rf2.baseHeight + rf2.height);
    }
    var maxH = Math.min(12, Math.max(3.0, Math.ceil(Math.max(homeMax, roofMax))));

    // Project base and top
    var pBase = project3D(baseX, 0, baseZ);
    var pTop  = project3D(baseX, maxH, baseZ);
    if (!pBase || !pTop || isOffscreenByCenter(pBase)) return; // if completely off, skip

    // Fade based on camera inactivity
    var nowT = (performance && performance.now) ? performance.now() : Date.now();
    var inactive = (nowT - _camLastMoveTime) > HEIGHT_BAR_INACTIVITY_MS;
    var targetAlpha = inactive ? 0 : 1;
    _heightBarAlpha += (targetAlpha - _heightBarAlpha) * 0.15;
    if (_heightBarAlpha <= 0.02) return; // fully hidden

    // Main pole
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, _heightBarAlpha));
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pBase.x, pBase.y);
    ctx.lineTo(pTop.x, pTop.y);
    ctx.stroke();

    // Ticks every 0.5m, labels every 1m (screen-space small horizontal ticks to the right)
    ctx.strokeStyle = '#222';
    ctx.fillStyle = '#222';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var minor = 0.5;
    var major = 1.0;
    for (var m = 0; m <= maxH + 1e-6; m += minor) {
      var isMajor = Math.abs(m % major) < 1e-6;
      var pt = project3D(baseX, m, baseZ);
      if (!pt) continue;
      var tickLen = isMajor ? 16 : 10;
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x + tickLen, pt.y);
      ctx.stroke();
      if (isMajor) {
        ctx.fillText(formatMeters(m) + ' m', pt.x + tickLen + 4, pt.y);
      }
    }

    // Base label and top height label
    ctx.fillStyle = '#333';
    ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillText(formatMeters(0) + ' m', pBase.x + 20, pBase.y + 10);
  ctx.fillText(formatMeters(maxH) + ' m', pTop.x + 20, pTop.y - 10);

    ctx.restore();
  } catch (e) {
    // never break frame
  }
}

function drawSnapGuides() {
  if (currentSnapGuides.length === 0) return;
  
  ctx.save();
  ctx.setLineDash([8, 4]);
  ctx.lineWidth = 2;
  
  for (var i = 0; i < currentSnapGuides.length; i++) {
    var guide = currentSnapGuides[i];
    ctx.strokeStyle = guide.color;
    ctx.globalAlpha = 0.8;
    
    ctx.beginPath();
    
    if (guide.type === 'vertical') {
      var top = project3D(guide.x, 3, camera.targetZ - 8);
      var bottom = project3D(guide.x, 0, camera.targetZ + 8);
      if (top && bottom) {
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
      }
    } else {
      var left = project3D(camera.targetX - 8, 0, guide.z);
      var right = project3D(camera.targetX + 8, 0, guide.z);
      if (left && right) {
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
      }
    }
    ctx.stroke();
  }
  
  ctx.restore();
}

function drawCompass() {
  try {
    var size = 70;
    var padding = 16;
    var x = screenW - size - padding;
    var y = screenH - size - padding - 100; // moved up by 100px

    ctx.save();
    ctx.globalAlpha = 0.9;

    // Background with manual rounded rectangle (no roundRect dependency)
    var r = 10;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + size - r, y);
    ctx.quadraticCurveTo(x + size, y, x + size, y + r);
    ctx.lineTo(x + size, y + size - r);
    ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
    ctx.lineTo(x + r, y + size);
    ctx.quadraticCurveTo(x, y + size, x, y + size - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    // Rotated crosshair based on camera yaw so N/E/S/W indicate world directions
    var cx = x + size/2;
    var cy = y + size/2;
    var r = (size/2) - 10;

    // Define angles for cardinal directions relative to screen
    // North is world +Z. When yaw = 0, North points up (angle -PI/2 in canvas).
    var angleN = -Math.PI/2 + camera.yaw;
    var angleE = angleN + Math.PI/2;
    var angleS = angleN + Math.PI;
    var angleW = angleN + 3*Math.PI/2;

    function dirPoint(angle, radius) {
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    }

    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var pN = dirPoint(angleN, r), pS = dirPoint(angleS, r);
    ctx.moveTo(pN.x, pN.y); ctx.lineTo(pS.x, pS.y);
    var pE = dirPoint(angleE, r), pW = dirPoint(angleW, r);
    ctx.moveTo(pE.x, pE.y); ctx.lineTo(pW.x, pW.y);
    ctx.stroke();

    // Labels positioned near the ring along their respective angles
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var labelR = r - 6;
    var LN = dirPoint(angleN, labelR);
    var LE = dirPoint(angleE, labelR);
    var LS = dirPoint(angleS, labelR);
    var LW = dirPoint(angleW, labelR);
    ctx.fillText('N', LN.x, LN.y);
    ctx.fillText('E', LE.x, LE.y);
    ctx.fillText('S', LS.x, LS.y);
    ctx.fillText('W', LW.x, LW.y);

    // North needle (arrow) pointing to world North
    var needleR = r - 2;
    var tip = dirPoint(angleN, needleR);
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    // Arrowhead at the tip
    var headLen = 10;
    var headSpread = 0.45; // radians
    var left = dirPoint(angleN + headSpread, needleR - headLen);
    var right = dirPoint(angleN - headSpread, needleR - headLen);
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  } catch (e) {
    // Never let compass drawing break the frame
    dbg('Compass draw skipped:', e);
  }
}

function drawRoom(room) {
  console.log('drawRoom called for room:', room);
  try {
    var selected = selectedRoomId === room.id;
    var currentLevel = room.level === currentFloor;
    var roomFloorY = room.level * 3.5;
    
    var hw = room.width / 2;
    var hd = room.depth / 2;
    
    var corners = [
      {x: room.x - hw, y: roomFloorY, z: room.z - hd},
      {x: room.x + hw, y: roomFloorY, z: room.z - hd},
      {x: room.x + hw, y: roomFloorY, z: room.z + hd},
      {x: room.x - hw, y: roomFloorY, z: room.z + hd},
      {x: room.x - hw, y: roomFloorY + room.height, z: room.z - hd},
      {x: room.x + hw, y: roomFloorY + room.height, z: room.z - hd},
      {x: room.x + hw, y: roomFloorY + room.height, z: room.z + hd},
      {x: room.x - hw, y: roomFloorY + room.height, z: room.z + hd}
    ];
    
  var projected = [];
    for (var i = 0; i < corners.length; i++) {
      var p = project3D(corners[i].x, corners[i].y, corners[i].z);
      if (!p) return;
      projected.push(p);
    }
    
    if (currentLevel) {
      ctx.strokeStyle = selected ? '#007acc' : '#D0D0D0';
      ctx.lineWidth = selected ? 3 : 2;
      ctx.globalAlpha = 1.0;
    } else {
      ctx.strokeStyle = selected ? '#005080' : '#808080';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.globalAlpha = 0.6;
    }
    
    var edges = [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7]
    ];
    
    // Draw all edges as continuous lines to keep the room visually closed
    ctx.beginPath();
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      ctx.moveTo(projected[e[0]].x, projected[e[0]].y);
      ctx.lineTo(projected[e[1]].x, projected[e[1]].y);
    }
    ctx.stroke();
    
    if (currentLevel) {
      ctx.fillStyle = selected ? 'rgba(0,122,204,0.15)' : 'rgba(208,208,208,0.1)';
      ctx.beginPath();
      ctx.moveTo(projected[0].x, projected[0].y);
      ctx.lineTo(projected[1].x, projected[1].y);
      ctx.lineTo(projected[2].x, projected[2].y);
      ctx.lineTo(projected[3].x, projected[3].y);
      ctx.closePath();
      ctx.fill();
    } else if (selected && room.level !== currentFloor) {
      ctx.fillStyle = 'rgba(0,122,204,0.15)';
      ctx.beginPath();
      ctx.moveTo(projected[0].x, projected[0].y);
      ctx.lineTo(projected[1].x, projected[1].y);
      ctx.lineTo(projected[2].x, projected[2].y);
      ctx.lineTo(projected[3].x, projected[3].y);
      ctx.closePath();
      ctx.fill();
    }
    
    ctx.globalAlpha = 1.0;
    
    // Always draw handles so all handles are draggable, not only when selected
    drawHandlesForRoom(room);

    // Draw opening markers within the wall span (room remains visually closed)
    if (room.openings && room.openings.length) {
      var floorY = room.level * 3.5;
      var wallTopY = floorY + room.height;
      function edgeToWorld(edgeKey, t) {
        // t in [0,1] along the specific edge
        if (edgeKey === 'minZ') { // along +X at z = minZ
          var z = room.z - hd; var x = (room.x - hw) + t * (room.width);
          return { x:x, z:z };
        } else if (edgeKey === 'maxZ') { // along +X at z = maxZ
          var z2 = room.z + hd; var x2 = (room.x - hw) + t * (room.width);
          return { x:x2, z:z2 };
        } else if (edgeKey === 'minX') { // along +Z at x = minX
          var x3 = room.x - hw; var z3 = (room.z - hd) + t * (room.depth);
          return { x:x3, z:z3 };
        } else if (edgeKey === 'maxX') { // along +Z at x = maxX
          var x4 = room.x + hw; var z4 = (room.z - hd) + t * (room.depth);
          return { x:x4, z:z4 };
        }
        return null;
      }
      for (var oi=0; oi<room.openings.length; oi++) {
        var op = room.openings[oi]; if (!op || !op.edge) continue;
        var rectLen = (op.edge==='minZ'||op.edge==='maxZ') ? room.width : room.depth;
        if (!(rectLen > 1e-6)) continue;
        var t0 = Math.max(0, Math.min(1, (op.startM||0) / rectLen));
        var t1 = Math.max(0, Math.min(1, (op.endM||0)   / rectLen));
        var W0 = edgeToWorld(op.edge, t0);
        var W1 = edgeToWorld(op.edge, t1);
        if (!W0 || !W1) continue;
        // Choose color/style by type
        var color = (op.type === 'door') ? '#22c55e' : '#38bdf8';
        var aFloor = project3D(W0.x, floorY, W0.z);
        var bFloor = project3D(W1.x, floorY, W1.z);
        if (!aFloor || !bFloor) continue;
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = color;
        // Door: jambs from floor to lintel (default 2.04m), lintel dashed; wall above remains (room edges intact)
        if (op.type === 'door'){
          var doorH = (typeof op.heightM === 'number' && op.heightM>0) ? op.heightM : 2.04;
          var lintelY = Math.min(wallTopY, floorY + doorH);
          var aTop = project3D(W0.x, lintelY, W0.z);
          var bTop = project3D(W1.x, lintelY, W1.z);
          if(aTop && bTop){
            // jambs
            ctx.beginPath(); ctx.moveTo(aFloor.x, aFloor.y); ctx.lineTo(aTop.x, aTop.y);
            ctx.moveTo(bFloor.x, bFloor.y); ctx.lineTo(bTop.x, bTop.y); ctx.stroke();
            // lintel
            ctx.setLineDash([6,4]); ctx.beginPath(); ctx.moveTo(aTop.x, aTop.y); ctx.lineTo(bTop.x, bTop.y); ctx.stroke(); ctx.setLineDash([]);
          }
        } else {
          // Window: sill default 1.0m; head stops 0.5m from top of wall
          var headY = Math.max(floorY + 0.51, wallTopY - 0.5);
          var defaultSill = floorY + 1.0;
          var sillY = Math.min(headY - 0.1, Math.max(floorY + 0.1, defaultSill));
          var aSill = project3D(W0.x, sillY, W0.z);
          var bSill = project3D(W1.x, sillY, W1.z);
          var aHead = project3D(W0.x, headY, W0.z);
          var bHead = project3D(W1.x, headY, W1.z);
          if(aSill && bSill && aHead && bHead){
            // jambs between sill and head
            ctx.beginPath(); ctx.moveTo(aSill.x, aSill.y); ctx.lineTo(aHead.x, aHead.y);
            ctx.moveTo(bSill.x, bSill.y); ctx.lineTo(bHead.x, bHead.y); ctx.stroke();
            // head (lintel) dashed
            ctx.setLineDash([6,4]); ctx.beginPath(); ctx.moveTo(aHead.x, aHead.y); ctx.lineTo(bHead.x, bHead.y); ctx.stroke(); ctx.setLineDash([]);
            // sill thin solid
            ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(aSill.x, aSill.y); ctx.lineTo(bSill.x, bSill.y); ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
    
  } catch (error) {
    console.error('Room draw error:', error);
  }
}

function drawHandlesForRoom(room) {
  try {
    var isActive = selectedRoomId === room.id;
    var handleY = room.level * 3.5 + room.height + 0.2;
    
    var handleData = [
      {x: room.x + room.width/2, y: handleY, z: room.z, type: 'width+', label: 'X+'},
      {x: room.x - room.width/2, y: handleY, z: room.z, type: 'width-', label: 'X-'},
      {x: room.x, y: handleY, z: room.z + room.depth/2, type: 'depth+', label: 'Z+'},
      {x: room.x, y: handleY, z: room.z - room.depth/2, type: 'depth-', label: 'Z-'}
    ];
    
    for (var i = 0; i < handleData.length; i++) {
      var handle = handleData[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;

      drawHandle(screen, handle.type, handle.label, isActive);
      
      resizeHandles.push({
        screenX: screen.x - HANDLE_RADIUS,
        screenY: screen.y - HANDLE_RADIUS,
        width: HANDLE_RADIUS * 2,
        height: HANDLE_RADIUS * 2,
        type: handle.type,
        roomId: room.id
      });
    }
  } catch (error) {
    console.error('Handle draw error:', error);
  }
}

function drawRoof(roof) {
  if (!roof) return;
  
  try {
    var selected = selectedRoomId === roof.id;
    var strokeColor = selected ? '#007acc' : '#D0D0D0';
    var fillColor = selected ? 'rgba(0,122,204,0.3)' : 'rgba(208,208,208,0.2)';
    var strokeWidth = selected ? 2 : 1.5;
    
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    // Draw different roof types
    switch (roof.roofType) {
      case 'gable':
        drawGableRoof(roof, selected, strokeColor, fillColor, strokeWidth);
        break;
      case 'hip':
        drawHipRoof(roof, selected, strokeColor, fillColor, strokeWidth);
        break;
      case 'flat':
        drawFlatRoof(roof, selected, strokeColor, fillColor, strokeWidth);
        break;
      case 'skillion':
        drawSkillionRoof(roof, selected, strokeColor, fillColor, strokeWidth);
        break;
      case 'apex':
        drawApexRoof(roof, selected, strokeColor, fillColor, strokeWidth);
        break;
      case 'barn':
        drawBarnRoof(roof, selected, strokeColor, fillColor, strokeWidth);
        break;
      case 'curved':
        drawCurvedRoof(roof, selected, strokeColor, fillColor, strokeWidth);
        break;
      case 'crossed-hip':
        drawCrossedHipRoof(roof, selected, strokeColor, fillColor, strokeWidth);
        break;
      default:
        drawGableRoof(roof, selected, strokeColor, fillColor, strokeWidth);
    }
    
    // Always draw handles so all handles are draggable
    drawHandlesForRoof(roof);
    
  } catch (error) {
    console.error('Roof draw error:', error);
  }
}

// Draw a single standalone wall strip between (x0,z0)-(x1,z1), extruded from y=0 to y=height
function drawWallStrip(strip){
  try{
    var dx = strip.x1 - strip.x0, dz = strip.z1 - strip.z0; var L = Math.hypot(dx,dz)||0; if(L<=1e-6) return;
    var t = (strip.thickness||0.3);
    var h0 = (typeof strip.baseY === 'number' ? strip.baseY : 0), h1 = h0 + (strip.height||3.0);
    // Build 4 bottom/top corners by offsetting the segment by +/- normal * (t/2)
    var nx = -(dz / (L||1)); var nz = (dx / (L||1)); var half = t/2;
    var p0 = {x: strip.x0 + nx*half, z: strip.z0 + nz*half};
    var p1 = {x: strip.x1 + nx*half, z: strip.z1 + nz*half};
    var p2 = {x: strip.x1 - nx*half, z: strip.z1 - nz*half};
    var p3 = {x: strip.x0 - nx*half, z: strip.z0 - nz*half};
    var ptsBottom = [p0,p1,p2,p3].map(function(w){ return project3D(w.x, h0, w.z); });
    var ptsTop    = [p0,p1,p2,p3].map(function(w){ return project3D(w.x, h1, w.z); });
    if(ptsBottom.some(function(p){return !p;}) || ptsTop.some(function(p){return !p;})) return;
    // style
    ctx.save();
    ctx.strokeStyle = '#a8a29e';
    ctx.fillStyle = 'rgba(168,162,158,0.28)';
    ctx.lineWidth = 2;
    // vertical faces (quads 0-1-1'-0', 1-2-2'-1', ...)
    for(var i=0;i<4;i++){
      var j=(i+1)%4;
      var a0=ptsBottom[i], b0=ptsBottom[j], a1=ptsTop[i], b1=ptsTop[j];
      ctx.beginPath(); ctx.moveTo(a0.x,a0.y); ctx.lineTo(b0.x,b0.y); ctx.lineTo(b1.x,b1.y); ctx.lineTo(a1.x,a1.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // top face
    ctx.beginPath(); ctx.moveTo(ptsTop[0].x,ptsTop[0].y); for(var k=1;k<4;k++){ ctx.lineTo(ptsTop[k].x, ptsTop[k].y); } ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }catch(e){ /* ignore strip draw errors */ }
}

function drawGableRoof(roof, selected, strokeColor, fillColor, strokeWidth) {
  var hw = roof.width / 2;
  var hd = roof.depth / 2;
  var baseY = roof.baseHeight;
  var peakY = baseY + roof.height;
  var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
  function rotate(x, z) {
    var dx = x - roof.x;
    var dz = z - roof.z;
    return {
      x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
      z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
    };
  }
  var roofCorners = [
    (function(){var p=rotate(roof.x-hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z);return {x:p.x,y:peakY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z);return {x:p.x,y:peakY,z:p.z};})()
  ];
  var projected = [];
  for (var i = 0; i < roofCorners.length; i++) {
    var p = project3D(roofCorners[i].x, roofCorners[i].y, roofCorners[i].z);
    if (!p) return;
    projected.push(p);
  }
  
  ctx.fillStyle = fillColor;
  
  ctx.beginPath();
  ctx.moveTo(projected[0].x, projected[0].y);
  ctx.lineTo(projected[1].x, projected[1].y);
  ctx.lineTo(projected[5].x, projected[5].y);
  ctx.lineTo(projected[4].x, projected[4].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(projected[2].x, projected[2].y);
  ctx.lineTo(projected[3].x, projected[3].y);
  ctx.lineTo(projected[4].x, projected[4].y);
  ctx.lineTo(projected[5].x, projected[5].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(projected[4].x, projected[4].y);
  ctx.lineTo(projected[5].x, projected[5].y);
  ctx.stroke();
}

function drawHipRoof(roof, selected, strokeColor, fillColor, strokeWidth) {
  var hw = roof.width / 2;
  var hd = roof.depth / 2;
  var baseY = roof.baseHeight;
  var peakY = baseY + roof.height;
  var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
  function rotate(x, z) {
    var dx = x - roof.x;
    var dz = z - roof.z;
    return {
      x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
      z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
    };
  }
  var corners = [
    (function(){var p=rotate(roof.x-hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x,roof.z);return {x:p.x,y:peakY,z:p.z};})()
  ];
  var projected = [];
  for (var i = 0; i < corners.length; i++) {
    var p = project3D(corners[i].x, corners[i].y, corners[i].z);
    if (!p) return;
    projected.push(p);
  }
  
  ctx.fillStyle = fillColor;
  
  var faces = [[0,1,4], [1,2,4], [2,3,4], [3,0,4]];
  
  for (var i = 0; i < faces.length; i++) {
    var face = faces[i];
    ctx.beginPath();
    ctx.moveTo(projected[face[0]].x, projected[face[0]].y);
    ctx.lineTo(projected[face[1]].x, projected[face[1]].y);
    ctx.lineTo(projected[face[2]].x, projected[face[2]].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawFlatRoof(roof, selected, strokeColor, fillColor, strokeWidth) {
  var hw = roof.width / 2;
  var hd = roof.depth / 2;
  var roofY = roof.baseHeight + roof.height * 0.2;
  var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
  function rotate(x, z) {
    var dx = x - roof.x;
    var dz = z - roof.z;
    return {
      x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
      z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
    };
  }
  var corners = [
    (function(){var p=rotate(roof.x-hw,roof.z-hd);return {x:p.x,y:roofY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z-hd);return {x:p.x,y:roofY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z+hd);return {x:p.x,y:roofY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z+hd);return {x:p.x,y:roofY,z:p.z};})()
  ];
  var projected = [];
  for (var i = 0; i < corners.length; i++) {
    var p = project3D(corners[i].x, corners[i].y, corners[i].z);
    if (!p) return;
    projected.push(p);
  }
  
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(projected[0].x, projected[0].y);
  ctx.lineTo(projected[1].x, projected[1].y);
  ctx.lineTo(projected[2].x, projected[2].y);
  ctx.lineTo(projected[3].x, projected[3].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawSkillionRoof(roof, selected, strokeColor, fillColor, strokeWidth) {
  var hw = roof.width / 2;
  var hd = roof.depth / 2;
  var baseY = roof.baseHeight;
  var highY = baseY + roof.height;
  var lowY = baseY + roof.height * 0.3;
  var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
  function rotate(x, z) {
    var dx = x - roof.x;
    var dz = z - roof.z;
    return {
      x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
      z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
    };
  }
  var corners = [
    (function(){var p=rotate(roof.x-hw,roof.z-hd);return {x:p.x,y:highY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z-hd);return {x:p.x,y:highY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z+hd);return {x:p.x,y:lowY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z+hd);return {x:p.x,y:lowY,z:p.z};})()
  ];
  var projected = [];
  for (var i = 0; i < corners.length; i++) {
    var p = project3D(corners[i].x, corners[i].y, corners[i].z);
    if (!p) return;
    projected.push(p);
  }
  
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(projected[0].x, projected[0].y);
  ctx.lineTo(projected[1].x, projected[1].y);
  ctx.lineTo(projected[2].x, projected[2].y);
  ctx.lineTo(projected[3].x, projected[3].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawApexRoof(roof, selected, strokeColor, fillColor, strokeWidth) {
  var hw = roof.width / 2;
  var hd = roof.depth / 2;
  var baseY = roof.baseHeight;
  var peakY = baseY + roof.height;
  var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
  function rotate(x, z) {
    var dx = x - roof.x;
    var dz = z - roof.z;
    return {
      x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
      z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
    };
  }
  var corners = [
    (function(){var p=rotate(roof.x-hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z);return {x:p.x,y:peakY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z);return {x:p.x,y:peakY,z:p.z};})()
  ];
  var projected = [];
  for (var i = 0; i < corners.length; i++) {
    var p = project3D(corners[i].x, corners[i].y, corners[i].z);
    if (!p) return;
    projected.push(p);
  }
  
  ctx.fillStyle = fillColor;
  
  // Front slope
  ctx.beginPath();
  ctx.moveTo(projected[0].x, projected[0].y);
  ctx.lineTo(projected[1].x, projected[1].y);
  ctx.lineTo(projected[5].x, projected[5].y);
  ctx.lineTo(projected[4].x, projected[4].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Back slope
  ctx.beginPath();
  ctx.moveTo(projected[2].x, projected[2].y);
  ctx.lineTo(projected[3].x, projected[3].y);
  ctx.lineTo(projected[4].x, projected[4].y);
  ctx.lineTo(projected[5].x, projected[5].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Flat north end
  ctx.beginPath();
  ctx.moveTo(projected[0].x, projected[0].y);
  ctx.lineTo(projected[3].x, projected[3].y);
  ctx.lineTo(projected[4].x, projected[4].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Flat south end
  ctx.beginPath();
  ctx.moveTo(projected[1].x, projected[1].y);
  ctx.lineTo(projected[2].x, projected[2].y);
  ctx.lineTo(projected[5].x, projected[5].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Center ridge beam
  ctx.beginPath();
  ctx.moveTo(projected[4].x, projected[4].y);
  ctx.lineTo(projected[5].x, projected[5].y);
  ctx.stroke();
}

function drawBarnRoof(roof, selected, strokeColor, fillColor, strokeWidth) {
  var hw = roof.width / 2;
  var hd = roof.depth / 2;
  var baseY = roof.baseHeight;
  var midY = baseY + roof.height * 0.6;
  var peakY = baseY + roof.height;
  var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
  function rotate(x, z) {
    var dx = x - roof.x;
    var dz = z - roof.z;
    return {
      x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
      z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
    };
  }
  var corners = [
    (function(){var p=rotate(roof.x-hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw*0.7,roof.z-hd);return {x:p.x,y:midY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw*0.7,roof.z-hd);return {x:p.x,y:midY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw*0.7,roof.z+hd);return {x:p.x,y:midY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw*0.7,roof.z+hd);return {x:p.x,y:midY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw*0.7,roof.z);return {x:p.x,y:peakY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw*0.7,roof.z);return {x:p.x,y:peakY,z:p.z};})()
  ];
  var projected = [];
  for (var i = 0; i < corners.length; i++) {
    var p = project3D(corners[i].x, corners[i].y, corners[i].z);
    if (!p) return;
    projected.push(p);
  }
  
  ctx.fillStyle = fillColor;
  
  ctx.beginPath();
  ctx.moveTo(projected[0].x, projected[0].y);
  ctx.lineTo(projected[4].x, projected[4].y);
  ctx.lineTo(projected[8].x, projected[8].y);
  ctx.lineTo(projected[9].x, projected[9].y);
  ctx.lineTo(projected[5].x, projected[5].y);
  ctx.lineTo(projected[1].x, projected[1].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(projected[2].x, projected[2].y);
  ctx.lineTo(projected[6].x, projected[6].y);
  ctx.lineTo(projected[9].x, projected[9].y);
  ctx.lineTo(projected[8].x, projected[8].y);
  ctx.lineTo(projected[7].x, projected[7].y);
  ctx.lineTo(projected[3].x, projected[3].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawCurvedRoof(roof, selected, strokeColor, fillColor, strokeWidth) {
  var hw = roof.width / 2;
  var hd = roof.depth / 2;
  var baseY = roof.baseHeight;
  var peakY = baseY + roof.height;
  var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
  function rotate(x, z) {
    var dx = x - roof.x;
    var dz = z - roof.z;
    return {
      x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
      z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
    };
  }
  var segments = 8;
  var points = [];
  for (var i = 0; i <= segments; i++) {
    var t = i / segments;
    var x = roof.x + (t - 0.5) * roof.width;
    var curveHeight = Math.sin(t * Math.PI) * roof.height;
    var y = baseY + curveHeight;
    var p1 = rotate(x, roof.z - hd);
    var p2 = rotate(x, roof.z + hd);
    points.push([
      project3D(p1.x, y, p1.z),
      project3D(p2.x, y, p2.z)
    ]);
  }
  
  ctx.fillStyle = fillColor;
  
  for (var i = 0; i < segments; i++) {
    if (points[i][0] && points[i][1] && points[i+1][0] && points[i+1][1]) {
      ctx.beginPath();
      ctx.moveTo(points[i][0].x, points[i][0].y);
      ctx.lineTo(points[i+1][0].x, points[i+1][0].y);
      ctx.lineTo(points[i+1][1].x, points[i+1][1].y);
      ctx.lineTo(points[i][1].x, points[i][1].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawCrossedHipRoof(roof, selected, strokeColor, fillColor, strokeWidth) {
  var hw = roof.width / 2;
  var hd = roof.depth / 2;
  var baseY = roof.baseHeight;
  var peakY = baseY + roof.height;
  var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
  function rotate(x, z) {
    var dx = x - roof.x;
    var dz = z - roof.z;
    return {
      x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
      z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
    };
  }
  var corners = [
    (function(){var p=rotate(roof.x-hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z-hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw,roof.z+hd);return {x:p.x,y:baseY,z:p.z};})(),
    (function(){var p=rotate(roof.x,roof.z);return {x:p.x,y:peakY,z:p.z};})(),
    (function(){var p=rotate(roof.x-hw*0.3,roof.z);return {x:p.x,y:peakY*0.9,z:p.z};})(),
    (function(){var p=rotate(roof.x+hw*0.3,roof.z);return {x:p.x,y:peakY*0.9,z:p.z};})(),
    (function(){var p=rotate(roof.x,roof.z-hd*0.3);return {x:p.x,y:peakY*0.9,z:p.z};})(),
    (function(){var p=rotate(roof.x,roof.z+hd*0.3);return {x:p.x,y:peakY*0.9,z:p.z};})()
  ];
  var projected = [];
  for (var i = 0; i < corners.length; i++) {
    var p = project3D(corners[i].x, corners[i].y, corners[i].z);
    if (!p) return;
    projected.push(p);
  }
  
  ctx.fillStyle = fillColor;
  
  var faces = [
    [0,1,4], [1,2,4], [2,3,4], [3,0,4],
    [5,6,7], [6,7,8], [7,8,5], [8,5,6]
  ];
  
  for (var i = 0; i < faces.length; i++) {
    var face = faces[i];
    ctx.beginPath();
    ctx.moveTo(projected[face[0]].x, projected[face[0]].y);
    ctx.lineTo(projected[face[1]].x, projected[face[1]].y);
    ctx.lineTo(projected[face[2]].x, projected[face[2]].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawHandlesForRoof(roof) {
  try {
    var isActive = selectedRoomId === roof.id;
    var handleY = roof.baseHeight + roof.height + 0.5;
    
    var rotRad = ((roof.rotation || 0) * Math.PI) / 180;
    function rotateHandle(dx, dz, dy) {
      return {
        x: roof.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        y: handleY + (dy || 0),
        z: roof.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
  var roofHandles = [
      // X+ (width+)
  (function() { var p = rotateHandle(roof.width/2, 0); return {x: p.x, y: p.y, z: p.z, type: 'width+', label: 'X+'}; })(),
      // X- (width-)
  (function() { var p = rotateHandle(-roof.width/2, 0); return {x: p.x, y: p.y, z: p.z, type: 'width-', label: 'X-'}; })(),
      // Z+ (depth+)
  (function() { var p = rotateHandle(0, roof.depth/2); return {x: p.x, y: p.y, z: p.z, type: 'depth+', label: 'Z+'}; })(),
      // Z- (depth-)
  (function() { var p = rotateHandle(0, -roof.depth/2); return {x: p.x, y: p.y, z: p.z, type: 'depth-', label: 'Z-'}; })(),
      // Y handle
  (function() { var p = rotateHandle(0, 0, 0.5); return {x: p.x, y: p.y, z: p.z, type: 'height', label: 'Y'}; })(),
      // 360 handle, moved to the left of Y handle
      (function() { var p = rotateHandle(-0.5, 0, 0.5); return {x: p.x, y: p.y, z: p.z, type: 'rotate', label: '360'}; })()
    ];
    
    for (var i = 0; i < roofHandles.length; i++) {
      var handle = roofHandles[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;

      drawHandle(screen, handle.type, handle.label, isActive);
      
      resizeHandles.push({
        screenX: screen.x - HANDLE_RADIUS,
        screenY: screen.y - HANDLE_RADIUS,
        width: HANDLE_RADIUS * 2,
        height: HANDLE_RADIUS * 2,
        type: handle.type,
        roomId: roof.id
      });
    }
  } catch (error) {
    console.error('Roof handle error:', error);
  }
}

function updateMeasurements() {
  var measurementsPanel = document.getElementById('measurements');
  if (!measurementsPanel) return;
  
  if (!selectedRoomId) {
    measurementsPanel.className = '';
    return;
  }
  
  var selectedObject = findObjectById(selectedRoomId);
  if (!selectedObject) {
    measurementsPanel.className = '';
    return;
  }
  
  measurementsPanel.className = 'visible';

  // Populate input fields with current values
  var widthInput = document.getElementById('input-width');
  var depthInput = document.getElementById('input-depth');
  var heightInput = document.getElementById('input-height');
  var posXInput = document.getElementById('input-pos-x');
  var posZInput = document.getElementById('input-pos-z');
  var nameInput = document.getElementById('input-name');
  if (nameInput) {
    nameInput.value = selectedObject.name || '';
    nameInput.disabled = false;
    nameInput.oninput = function() { selectedObject.name = this.value; saveProjectSilently(); };
  }
  widthInput.value = selectedObject.width.toFixed(2);
  depthInput.value = selectedObject.depth.toFixed(2);
  heightInput.value = selectedObject.height.toFixed(2);
  posXInput.value = selectedObject.x.toFixed(2);
  posZInput.value = selectedObject.z.toFixed(2);
  widthInput.disabled = false;
  depthInput.disabled = false;
  heightInput.disabled = false;
  posXInput.disabled = false;
  posZInput.disabled = false;

  // Update object immediately on input change or arrow key
  widthInput.oninput = function() { if (!isNaN(this.value) && this.value !== '') { selectedObject.width = Math.max(1, Math.min(40, parseFloat(this.value))); } };
  depthInput.oninput = function() { if (!isNaN(this.value) && this.value !== '') { selectedObject.depth = Math.max(1, Math.min(40, parseFloat(this.value))); } };
  heightInput.oninput = function() { if (!isNaN(this.value) && this.value !== '') { selectedObject.height = Math.max(0.5, Math.min(10, parseFloat(this.value))); } };
  posXInput.oninput = function() { if (!isNaN(this.value) && this.value !== '') { selectedObject.x = Math.max(-100, Math.min(100, parseFloat(this.value))); } };
  posZInput.oninput = function() { if (!isNaN(this.value) && this.value !== '') { selectedObject.z = Math.max(-100, Math.min(100, parseFloat(this.value))); } };

  var floorText = selectedObject.level === 0 ? 'Ground' : 'Floor ' + (selectedObject.level + 1);
  document.getElementById('measure-floor').textContent = floorText;

  var saveBtn = document.getElementById('save-measurements');
  if (saveBtn) {
    saveBtn.onclick = function() {
      saveProject();
      updateStatus('Measurements saved');
    };
  }
}

function calculatePricing() {
  var breakdown = {
    rooms: [],
    components: [],
    totalCost: 0
  };
  
  // Accumulators for slab and soil
  var groundSlabArea = 0; // m²
  
  var totalWindowArea = 0; // m² (for triple glazed)
  var totalDoorUnits = 0;  // count
  for (var i = 0; i < allRooms.length; i++) {
    var room = allRooms[i];
    var area = room.width * room.depth;
    var cost = area * PRICING.room;
    breakdown.rooms.push({
      name: room.name,
      area: area,
      cost: cost
    });
    breakdown.totalCost += cost;
    if (room.level === 0) groundSlabArea += area;

    // Openings pricing: collect windows (area) and doors (count)
    if (Array.isArray(room.openings) && room.openings.length) {
      for (var oi=0; oi<room.openings.length; oi++){
        var op = room.openings[oi]; if(!op) continue;
        if (op.type === 'window'){
          var spanM = Math.max(0, (op.endM||0) - (op.startM||0));
          // Window height: use difference between head and sill as in drawRoom defaults (head = wallTop-0.5, sill = 1.0), but without wall height here we use a conservative 1.0m height
          var hM = 1.0;
          var areaM2 = spanM * hM;
          totalWindowArea += areaM2;
        } else if (op.type === 'door'){
          totalDoorUnits += 1;
        }
      }
    }
  }
  
  if (stairsComponent) {
    var stairsArea = stairsComponent.width * stairsComponent.depth;
    var stairsCost = stairsArea * PRICING.stairs;
    breakdown.components.push({
      name: stairsComponent.name,
      area: stairsArea,
      cost: stairsCost
    });
    breakdown.totalCost += stairsCost;
  }
  
  for (var i = 0; i < pergolaComponents.length; i++) {
    var pergola = pergolaComponents[i];
    var pergolaArea = pergola.width * pergola.depth;
    var pergolaCost = pergolaArea * PRICING.pergola;
    breakdown.components.push({
      name: pergola.name,
      area: pergolaArea,
      cost: pergolaCost
    });
    breakdown.totalCost += pergolaCost;
  }
  
  for (var i = 0; i < garageComponents.length; i++) {
    var garage = garageComponents[i];
    var garageArea = garage.width * garage.depth;
    var garageCost = garageArea * PRICING.garage;
    breakdown.components.push({
      name: garage.name,
      area: garageArea,
      cost: garageCost
    });
    breakdown.totalCost += garageCost;
    groundSlabArea += garageArea;
  }
  
  for (var i = 0; i < poolComponents.length; i++) {
    var pool = poolComponents[i];
    var poolArea = pool.width * pool.depth;
    var poolCost = poolArea * (PRICING.pool || PRICING.garage);
    breakdown.components.push({
      name: pool.name,
      area: poolArea,
      cost: poolCost
    });
    breakdown.totalCost += poolCost;
  }
  
  for (var i = 0; i < roofComponents.length; i++) {
    var roof = roofComponents[i];
    var roofArea = roof.width * roof.depth;
    var roofCost = roofArea * PRICING.roof;
    breakdown.components.push({
      name: roof.name,
      area: roofArea,
      cost: roofCost
    });
    breakdown.totalCost += roofCost;
  }
  // Add triple glazed windows cost
  if (totalWindowArea > 0 && PRICING.windowTripleGlazedPerM2 > 0){
    var winCost = totalWindowArea * PRICING.windowTripleGlazedPerM2;
    breakdown.components.push({ name:'Windows (Triple Glazed)', area: totalWindowArea, cost: winCost });
    breakdown.totalCost += winCost;
  }
  // Add doors cost (per unit)
  if (totalDoorUnits > 0 && PRICING.doorUnit > 0){
    var doorCost = totalDoorUnits * PRICING.doorUnit;
    breakdown.components.push({ name:'Doors', area: totalDoorUnits, cost: doorCost, _units: { units: totalDoorUnits } });
    breakdown.totalCost += doorCost;
  }
  
  // Add concrete slab cost for ground-level footprint (rooms+garages)
  if (groundSlabArea > 0 && PRICING.concreteSlabPerSqm > 0) {
    var slabCost = groundSlabArea * PRICING.concreteSlabPerSqm;
    breakdown.components.push({
      name: 'Concrete Slab (incl. reinforcement)',
      area: groundSlabArea, // m²
      cost: slabCost
    });
    breakdown.totalCost += slabCost;
  }
  // Add formwork & prep (soil) based on slab excavation
  if (groundSlabArea > 0 && PRICING.slabThicknessM > 0) {
    var soilVolumeM3 = groundSlabArea * PRICING.slabThicknessM; // m³
    var soilCost = 0;
    var unitsInfo = { volumeM3: soilVolumeM3 };
    if (PRICING.soilPerM3 > 0) {
      soilCost = soilVolumeM3 * PRICING.soilPerM3;
    } else if (PRICING.soilDensityTPerM3 > 0 && PRICING.soilCostPerTonne > 0) {
      var soilTonnes = soilVolumeM3 * PRICING.soilDensityTPerM3; // tonnes
      unitsInfo.tonnes = soilTonnes;
      soilCost = soilTonnes * PRICING.soilCostPerTonne;
    }
    if (soilCost > 0) {
      breakdown.components.push({
        name: 'Formwork and Prep (Soil)',
        area: soilVolumeM3,
        cost: soilCost,
        _units: unitsInfo
      });
      breakdown.totalCost += soilCost;
    }
  }
  
  return breakdown;
}

function formatCurrency(amount) {
  return '$' + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function showPricing() {
  var modal = document.getElementById('pricing-modal');
  if (!modal) return;
  
  // Hide roof dropdown when pricing modal opens
  var existingDropdown = document.getElementById('roof-type-dropdown');
  if (existingDropdown) {
    existingDropdown.style.display = 'none';
  }
  
  // Initialize pricing controls
  var slabMmEl = document.getElementById('pricing-slab-mm');
  var soilM3El = document.getElementById('pricing-soil-per-m3');
  if (slabMmEl) slabMmEl.value = Math.round((PRICING.slabThicknessM || 0.1) * 1000);
  if (soilM3El) soilM3El.value = Math.round(PRICING.soilPerM3 || (PRICING.soilCostPerTonne && PRICING.soilDensityTPerM3 ? PRICING.soilCostPerTonne * PRICING.soilDensityTPerM3 : 600));
  var applyBtn = document.getElementById('pricing-apply');
  if (applyBtn) applyBtn.onclick = function(){
    var mm = parseFloat(slabMmEl && slabMmEl.value) || 100;
    var perM3 = parseFloat(soilM3El && soilM3El.value) || 600;
    // Update PRICING values
    PRICING.slabThicknessM = Math.max(0.05, Math.min(0.3, mm / 1000));
    // Switch model to per m³ pricing for soil
    PRICING.soilPerM3 = Math.max(0, perM3);
    // Clear tonne-based pricing so we prefer m³ path
    PRICING.soilCostPerTonne = 0;
    // Re-render pricing
    renderPricingBreakdown();
  };
  
  renderPricingBreakdown();
  
  modal.style.display = 'block';
}

// Renders the pricing breakdown using current PRICING
function renderPricingBreakdown(){
  var breakdown = calculatePricing();
  var roomPricingDiv = document.getElementById('room-pricing');
  if (roomPricingDiv) {
    roomPricingDiv.innerHTML = '';
    
    if (breakdown.rooms.length === 0) {
      roomPricingDiv.innerHTML = '<div class="pricing-item"><span class="pricing-item-name">No rooms</span><span class="pricing-item-cost">$0</span></div>';
    } else {
      for (var i = 0; i < breakdown.rooms.length; i++) {
        var room = breakdown.rooms[i];
        var itemDiv = document.createElement('div');
        itemDiv.className = 'pricing-item';
        itemDiv.innerHTML = 
          '<span class="pricing-item-name">' + room.name + ' (' + room.area.toFixed(1) + 'm²)</span>' +
          '<span class="pricing-item-cost">' + formatCurrency(room.cost) + '</span>';
        roomPricingDiv.appendChild(itemDiv);
      }
    }
  }
  
  // Split components between general components and concrete/site works
  var concreteNames = ['Concrete Slab (incl. reinforcement)', 'Formwork and Prep (Soil)'];
  var concreteItems = [];
  var otherComponents = [];
  for (var ci = 0; ci < breakdown.components.length; ci++) {
    var comp = breakdown.components[ci];
    if (concreteNames.indexOf(comp.name) !== -1) {
      concreteItems.push(comp);
    } else {
      otherComponents.push(comp);
    }
  }

  var componentPricingDiv = document.getElementById('component-pricing');
  if (componentPricingDiv) {
    componentPricingDiv.innerHTML = '';
    if (otherComponents.length === 0) {
      componentPricingDiv.innerHTML = '<div class="pricing-item"><span class="pricing-item-name">No additional components</span><span class="pricing-item-cost">$0</span></div>';
    } else {
      for (var i = 0; i < otherComponents.length; i++) {
        var component = otherComponents[i];
        var itemDiv = document.createElement('div');
        itemDiv.className = 'pricing-item';
        var units = 'm²';
        var qty = component.area;
        if (component._units && typeof component._units.units === 'number') {
          qty = component._units.units;
          units = 'units';
        } else if (component._units && typeof component._units.volumeM3 === 'number') {
          qty = component._units.volumeM3;
          units = 'm³' + (typeof component._units.tonnes === 'number' ? ' ~ ' + component._units.tonnes.toFixed(2) + ' t' : '');
        }
        itemDiv.innerHTML =
          '<span class="pricing-item-name">' + component.name + ' (' + qty.toFixed(2) + units + ')</span>' +
          '<span class="pricing-item-cost">' + formatCurrency(component.cost) + '</span>';
        componentPricingDiv.appendChild(itemDiv);
      }
    }
  }

  var concretePricingDiv = document.getElementById('concrete-pricing');
  if (concretePricingDiv) {
    concretePricingDiv.innerHTML = '';
    var concreteSectionEl = concretePricingDiv.parentElement;
    if (concreteItems.length === 0) {
      if (concreteSectionEl) concreteSectionEl.style.display = 'none';
    } else {
      if (concreteSectionEl) concreteSectionEl.style.display = '';
      for (var j = 0; j < concreteItems.length; j++) {
        var citem = concreteItems[j];
        var cdiv = document.createElement('div');
        cdiv.className = 'pricing-item';
        var cunits = 'm²';
        var cqty = citem.area;
        if (citem._units && typeof citem._units.volumeM3 === 'number') {
          cqty = citem._units.volumeM3;
          cunits = 'm³' + (typeof citem._units.tonnes === 'number' ? ' ~ ' + citem._units.tonnes.toFixed(2) + ' t' : '');
        }
        cdiv.innerHTML =
          '<span class="pricing-item-name">' + citem.name + ' (' + cqty.toFixed(2) + cunits + ')</span>' +
          '<span class="pricing-item-cost">' + formatCurrency(citem.cost) + '</span>';
        concretePricingDiv.appendChild(cdiv);
      }
    }
  }
  
  var totalPricingDiv = document.getElementById('total-pricing');
  if (totalPricingDiv) {
    totalPricingDiv.innerHTML = 
      '<div class="pricing-item">' +
        '<span class="pricing-item-name">Total Project Cost</span>' +
        '<span class="pricing-item-cost">' + formatCurrency(breakdown.totalCost) + '</span>' +
      '</div>';
  }
}

function hidePricing() {
  var modal = document.getElementById('pricing-modal');
  if (modal) modal.style.display = 'none';
  
  // Show roof dropdown again when pricing modal closes
  var existingDropdown = document.getElementById('roof-type-dropdown');
  if (existingDropdown) {
    existingDropdown.style.display = 'block';
  }
}

// Info modal controls (for ℹ button)
function showInfo() {
  var modal = document.getElementById('info-modal');
  if (!modal) return;
  // Hide roof dropdown while modal is open
  var existingDropdown = document.getElementById('roof-type-dropdown');
  if (existingDropdown) existingDropdown.style.display = 'none';
  modal.style.display = 'block';
}

function hideInfo() {
  var modal = document.getElementById('info-modal');
  if (modal) modal.style.display = 'none';
  // Restore roof dropdown visibility after closing
  var existingDropdown = document.getElementById('roof-type-dropdown');
  if (existingDropdown) existingDropdown.style.display = 'block';
}

// Share modal controls (for 🔗 Share button)
function showShare(){
  try{
    var modal = document.getElementById('share-modal'); if(!modal) return;
    var input = document.getElementById('share-url');
    var openA = document.getElementById('share-open');
    var hint = document.getElementById('share-hint');
    var fallUrl = window.location.href;
    // Try to fetch forwarded URL from server helper
    fetch('/__forwarded', { cache: 'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(info){
      var best = fallUrl;
      if (info && info.url) best = info.url;
      if (input) { input.value = best; input.focus(); input.select(); }
      if (openA) { openA.href = best; }
      var isForwarded = /app\.github\.dev|githubpreview\.dev|gitpod\.io|codespaces|gitpod/.test(best);
      if (hint) {
        hint.textContent = isForwarded ? 'Forwarded URL detected.' : 'If using Codespaces/Gitpod, share the forwarded URL from your browser address bar.';
      }
      modal.style.display = 'flex';
    }).catch(function(){
      // Fallback to current href
      if(input) { input.value = fallUrl; input.focus(); input.select(); }
      if(openA) { openA.href = fallUrl; }
      if(hint) hint.textContent = 'If using Codespaces/Gitpod, share the forwarded URL from your browser address bar.';
      modal.style.display = 'flex';
    });
  }catch(e){ console.warn('showShare failed', e); }
}
function hideShare(){ var modal = document.getElementById('share-modal'); if(modal) modal.style.display='none'; }
function copyShareUrl(){
  var input = document.getElementById('share-url'); if(!input) return;
  input.select(); input.setSelectionRange(0, 99999);
  try { document.execCommand('copy'); updateStatus('URL copied'); }
  catch(e){ if(navigator.clipboard){ navigator.clipboard.writeText(input.value).then(function(){ updateStatus('URL copied'); }).catch(function(){ updateStatus('Copy failed'); }); } }
}

function findObjectById(objectId) {
  for (var i = 0; i < allRooms.length; i++) {
    if (allRooms[i].id === objectId) return allRooms[i];
  }
  
  if (stairsComponent && stairsComponent.id === objectId) {
    return stairsComponent;
  }
  
  for (var i = 0; i < balconyComponents.length; i++) {
    if (balconyComponents[i].id === objectId) return balconyComponents[i];
  }
  
  for (var i = 0; i < pergolaComponents.length; i++) {
    if (pergolaComponents[i].id === objectId) return pergolaComponents[i];
  }
  
  for (var i = 0; i < garageComponents.length; i++) {
    if (garageComponents[i].id === objectId) return garageComponents[i];
  }
  for (var i = 0; i < poolComponents.length; i++) {
    if (poolComponents[i].id === objectId) return poolComponents[i];
  }
  
  for (var i = 0; i < roofComponents.length; i++) {
    if (roofComponents[i].id === objectId) return roofComponents[i];
  }
  for (var i = 0; i < furnitureItems.length; i++) {
    if (furnitureItems[i].id === objectId) return furnitureItems[i];
  }
  
  return null;
}

function findHandle(mouseX, mouseY) {
  for (var i = 0; i < resizeHandles.length; i++) {
    var handle = resizeHandles[i];
    if (mouseX >= handle.screenX && mouseX <= handle.screenX + handle.width &&
        mouseY >= handle.screenY && mouseY <= handle.screenY + handle.height) {
      return handle;
    }
  }
  return null;
}

function getDistanceFromCamera(object) {
  var objectY = (object.level || 0) * 3.5 + (object.height || 3) / 2;
  return Math.sqrt(
    Math.pow(object.x - camera.targetX, 2) +
    Math.pow(objectY, 2) +
    Math.pow(object.z - camera.targetZ, 2)
  );
}

function worldMovement(screenDX, screenDY) {
  var scale = camera.distance / 800;
  var cos = Math.cos(camera.yaw);
  var sin = Math.sin(camera.yaw);
  
  var worldDX = screenDX * scale;
  var worldDZ = -screenDY * scale;
  
  return {
    x: cos * worldDX - sin * worldDZ,
    z: sin * worldDX + cos * worldDZ
  };
}

function updateLabels() {
  var container = document.getElementById('labels');
  if (!container) return;
  // Bind hover-freeze listeners once (delegated to container)
  if (!container._hoverFreezeBound) {
    container.addEventListener('pointerover', function(e){
      var btn = e.target && e.target.closest && e.target.closest('.room-edit-btn');
      if (btn) { window.__labelsFrozen = true; }
    }, true);
    container.addEventListener('pointerout', function(e){
      var btn = e.target && e.target.closest && e.target.closest('.room-edit-btn');
      if (btn) { window.__labelsFrozen = false; }
    }, true);
    container._hoverFreezeBound = true;
  }
  // If frozen (hovering the edit button), skip rebuilding to avoid flicker
  if (window.__labelsFrozen) return;
  
  container.innerHTML = '';
  
  // Clean up any existing roof dropdown if no roof is selected
  if (!selectedRoomId || !findObjectById(selectedRoomId) || findObjectById(selectedRoomId).type !== 'roof') {
    var existingDropdown = document.getElementById('roof-type-dropdown');
    if (existingDropdown) {
      existingDropdown.remove();
    }
  }
  
  var allLabels = [];
  
  for (var i = 0; i < allRooms.length; i++) {
    var room = allRooms[i];
    var labelY = room.level * 3.5 + 1.5;
    var screen = project3D(room.x, labelY, room.z);
    
    if (screen && screen.x > -100 && screen.x < screenW + 100) {
      allLabels.push({
        screen: screen,
        object: room,
        type: 'room',
        depth: screen.depth
      });
    }
  }
  
  if (stairsComponent) {
    var labelY = 1.5;
    var screen = project3D(stairsComponent.x, labelY, stairsComponent.z);
    
    if (screen && screen.x > -100 && screen.x < screenW + 100) {
      allLabels.push({
        screen: screen,
        object: stairsComponent,
        type: 'stairs',
        depth: screen.depth
      });
    }
  }

  for (var i = 0; i < pergolaComponents.length; i++) {
    var pergola = pergolaComponents[i];
    var labelY = 1.5;
    var screen = project3D(pergola.x, labelY, pergola.z);
    
    if (screen && screen.x > -100 && screen.x < screenW + 100) {
      allLabels.push({
        screen: screen,
        object: pergola,
        type: 'pergola',
        depth: screen.depth
      });
    }
  }
  
  for (var i = 0; i < garageComponents.length; i++) {
    var garage = garageComponents[i];
    var labelY = 1.5;
    var screen = project3D(garage.x, labelY, garage.z);
    
    if (screen && screen.x > -100 && screen.x < screenW + 100) {
      allLabels.push({
        screen: screen,
        object: garage,
        type: 'garage',
        depth: screen.depth
      });
    }
  }

  for (var i = 0; i < poolComponents.length; i++) {
    var pool = poolComponents[i];
    var labelY = 0.5;
    var screen = project3D(pool.x, labelY, pool.z);
    
    if (screen && screen.x > -100 && screen.x < screenW + 100) {
      allLabels.push({
        screen: screen,
        object: pool,
        type: 'pool',
        depth: screen.depth
      });
    }
  }

  for (var i = 0; i < balconyComponents.length; i++) {
    var balcony = balconyComponents[i];
    var labelY = balcony.level * 3.5 + 1.5;
    var screen = project3D(balcony.x, labelY, balcony.z);
    
    if (screen && screen.x > -100 && screen.x < screenW + 100) {
      allLabels.push({
        screen: screen,
        object: balcony,
        type: 'balcony',
        depth: screen.depth
      });
    }
  }
  
  for (var i = 0; i < roofComponents.length; i++) {
    var roof = roofComponents[i];
    var labelY = roof.baseHeight + roof.height / 2;
    var screen = project3D(roof.x, labelY, roof.z);
    
    if (screen && screen.x > -100 && screen.x < screenW + 100) {
      allLabels.push({
        screen: screen,
        object: roof,
        type: 'roof',
        depth: screen.depth
      });
    }
  }

  for (var i = 0; i < furnitureItems.length; i++) {
    var furn = furnitureItems[i];
    var labelY = (furn.level || 0) * 3.5 + Math.min(1.0, furn.height || 0.7);
    var screen = project3D(furn.x, labelY, furn.z);
    
    if (screen && screen.x > -100 && screen.x < screenW + 100) {
      allLabels.push({
        screen: screen,
        object: furn,
        type: 'furniture',
        depth: screen.depth
      });
    }
  }
  
  allLabels.sort(function(a, b) {
    return b.depth - a.depth;
  });
  
  for (var i = 0; i < allLabels.length; i++) {
    var labelData = allLabels[i];
    var obj = labelData.object;
    var screen = labelData.screen;
    
    var label = document.createElement('div');
    label.className = 'room-label';
    // Mark with data attributes for delegated events
    label.dataset.id = obj.id;
    label.dataset.type = labelData.type;
    if (selectedRoomId === obj.id) label.className += ' selected';
    label.style.left = Math.round(screen.x) + 'px';
    label.style.top = Math.round(screen.y) + 'px';
    label.style.backgroundColor = selectedRoomId === obj.id ? '#007acc' : 'white';
    label.style.color = selectedRoomId === obj.id ? 'white' : '#333';

    // Show static text by default for drag-friendly labels; switch to input on dblclick
    if (editingLabelId === obj.id) {
      var input = document.createElement('input');
      input.type = 'text';
      input.value = obj.name || '';
      input.style.border = 'none';
      input.style.background = 'transparent';
      input.style.color = 'inherit';
      input.style.font = 'bold 12px system-ui, sans-serif';
      input.style.textAlign = 'center';
      input.style.outline = 'none';
      input.style.width = 'auto';
      input.style.minWidth = '40px';
      input.style.maxWidth = '220px';
      input.style.pointerEvents = 'auto';
      input.style.caretColor = 'currentColor';
      input.setAttribute('maxlength', '60');
      input.onfocus = function(e) { e.stopPropagation(); label.style.cursor = 'text'; };
      input.onblur = function() { label.style.cursor = 'grab'; editingLabelId = null; saveProjectSilently(); renderLoop(); };
      input.onmousedown = function(e) { e.stopPropagation(); };
      input.onkeydown = function(e) { e.stopPropagation(); if (e.key === 'Enter') this.blur(); };
      input.oninput = function() { obj.name = this.value; saveProjectSilently(); autoSizeInput(this); };
      label.appendChild(input);
      // Auto-size input to content for better centering
      function autoSizeInput(el){
        var mirror = document.createElement('span');
        mirror.style.visibility = 'hidden';
        mirror.style.position = 'absolute';
        mirror.style.whiteSpace = 'pre';
        mirror.style.font = el.style.font;
        mirror.textContent = el.value || 'Room';
        document.body.appendChild(mirror);
        var w = mirror.getBoundingClientRect().width + 16;
        document.body.removeChild(mirror);
        el.style.width = Math.min(220, Math.max(40, Math.ceil(w))) + 'px';
      }
      autoSizeInput(input);
      // Focus after append
      setTimeout(function(){ try { input.focus(); input.select(); } catch(e){} }, 0);
    } else {
      var span = document.createElement('span');
      span.textContent = obj.name || '';
      label.appendChild(span);
    }

    // No inline actions anymore
    
    if (labelData.type === 'room' && obj.level !== currentFloor) {
      label.style.opacity = '0.6';
    }
    
    // Create or update roof type dropdown for roof objects
    if (labelData.type === 'roof' && selectedRoomId === obj.id) {
      var existingDropdown = document.getElementById('roof-type-dropdown');
      if (!existingDropdown) {
        var dropdown = document.createElement('select');
        dropdown.id = 'roof-type-dropdown';
        dropdown.style.position = 'fixed';
        dropdown.style.fontSize = '10px';
        dropdown.style.padding = '4px 8px';
        dropdown.style.border = '1px solid #ccc';
        dropdown.style.borderRadius = '6px';
        dropdown.style.background = 'white';
        dropdown.style.color = '#333';
        dropdown.style.fontFamily = 'system-ui, sans-serif';
        dropdown.style.cursor = 'pointer';
        dropdown.style.minWidth = '90px';
        dropdown.style.zIndex = '99999';
        dropdown.style.pointerEvents = 'auto';
        dropdown.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
        dropdown.style.transition = 'all 0.2s ease';
        
        var roofTypes = ['gable', 'hip', 'flat', 'skillion', 'apex', 'barn', 'curved', 'crossed-hip'];
        var roofNames = ['Gable', 'Hip', 'Flat', 'Skillion', 'Apex', 'Barn', 'Curved', 'Crossed Hip'];
        
        for (var typeIdx = 0; typeIdx < roofTypes.length; typeIdx++) {
          var option = document.createElement('option');
          option.value = roofTypes[typeIdx];
          option.textContent = roofNames[typeIdx];
          dropdown.appendChild(option);
        }
        
        dropdown.onchange = function() {
          var selectedRoof = findObjectById(selectedRoomId);
          if (selectedRoof && selectedRoof.type === 'roof') {
            var prevRotation = selectedRoof.rotation || 0;
            selectedRoof.roofType = this.value;
            selectedRoof.rotation = prevRotation; // Ensure rotation persists
            updateStatus('Roof type changed to ' + this.options[this.selectedIndex].text + ' (Rotation: ' + prevRotation + '°)');
            renderLoop();
          }
        };
        
        document.body.appendChild(dropdown);
      }
      
      // Update dropdown position and selected value
      var dropdown = document.getElementById('roof-type-dropdown');
      if (dropdown) {
        dropdown.style.left = (Math.round(screen.x) + 40) + 'px';
        dropdown.style.top = (Math.round(screen.y) - 10) + 'px';
        dropdown.value = obj.roofType;
      }
    }
    
    (function(objRef, dragType) {
      label.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION' || e.target.tagName === 'INPUT') return;
        
        e.preventDefault();
        e.stopPropagation();
        
        selectedRoomId = selectedRoomId === objRef.id ? null : objRef.id;
        
        if (selectedRoomId) {
          mouse.dragType = dragType;
          mouse.dragInfo = {
            roomId: objRef.id,
            startX: e.clientX,
            startY: e.clientY,
            originalX: objRef.x,
            originalZ: objRef.z
          };
          updateStatus('Selected: ' + objRef.name);
        } else {
          updateStatus('Deselected');
        }
      });
      // dblclick is now delegated on container for robustness
    })(obj, labelData.type);
    
    container.appendChild(label);

    // External Edit button for rooms: sits outside to the right of the label
    if (labelData.type === 'room') {
      var btn = document.createElement('button');
      btn.className = 'room-edit-btn';
      btn.type = 'button';
      btn.title = 'Open Room Palette';
  btn.textContent = 'Edit';
      btn.dataset.id = obj.id;
      btn.style.position = 'fixed';
      // Compute horizontal offset based on label width so it sits just outside the pill
      var halfW = Math.round((label.offsetWidth || 60) / 2);
  var offset = halfW + 26; // 26px gap outside the label edge (16px + 10px extra)
      btn.style.left = (Math.round(screen.x) + offset) + 'px';
      btn.style.top = Math.round(screen.y) + 'px';
      // Open on mousedown to avoid losing click due to frequent re-renders
      btn.onmousedown = function(e){ e.stopPropagation(); e.preventDefault(); openRoomPalette(this.dataset.id); };
      container.appendChild(btn);
    }

    // (Removed duplicate smaller edit button)
  }

  // Delegated handlers once per update
  if (!container._dblBound) {
    container.addEventListener('dblclick', function(e) {
      var target = e.target.closest('.room-label');
      if (!target) return;
      var type = target.dataset.type;
      var id = target.dataset.id;
      e.preventDefault();
      e.stopPropagation();
      if (type === 'room') {
        openRoomPalette(id);
      } else {
        editingLabelId = id;
        selectedRoomId = id;
        renderLoop();
      }
    });
    // Fallback delegated click for edit button
    container.addEventListener('mousedown', function(e) {
      var btn = e.target.closest('.room-edit-btn');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      var id = btn.dataset.id; if (id) openRoomPalette(id);
    });
    container._dblBound = true;
  }
}

function setupEvents() {
  window.addEventListener('resize', setupCanvas);
  
  canvas.addEventListener('mousedown', function(e) {
    var rect = canvas.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mouseY = e.clientY - rect.top;
    
    var handle = findHandle(mouseX, mouseY);
    if (handle) {
      var target = findObjectById(handle.roomId);
      if (target) {
        if (handle.type === 'rotate') {
          var rotationAngle = (target.type === 'garage' || target.type === 'pool') ? 90 : 22.5;
          target.rotation = ((target.rotation || 0) + rotationAngle) % 360;
          renderLoop();
          updateStatus(target.name + ' rotated ' + rotationAngle + '°');
          return;
        }
        // Fix: Set dragType to 'handle' for room handles so drag logic resizes the room
        mouse.dragType = 'handle';
        mouse.dragInfo = {
          handle: handle,
          startX: e.clientX,
          startY: e.clientY,
          originalWidth: target.width,
          originalDepth: target.depth,
          originalRoomX: target.x,
          originalRoomZ: target.z,
          // Store side axis and sign so we know which face is being dragged
          sideAxis: (handle.type.indexOf('width') === 0 ? 'x' : (handle.type.indexOf('depth') === 0 ? 'z' : null)),
          sideSign: (handle.type.endsWith('+') ? 1 : (handle.type.endsWith('-') ? -1 : 0))
        };
        mouse.down = true;
        selectedRoomId = handle.roomId;
        canvas.style.cursor = 'grabbing';
        updateStatus('Resizing...');

        // Compute start positions for dragged face and opposite face in world space
        try {
          var rotRadS = ((target.rotation || 0) * Math.PI) / 180;
          var axisXxS = Math.cos(rotRadS), axisXzS = Math.sin(rotRadS);
          var axisZxS = -Math.sin(rotRadS), axisZzS = Math.cos(rotRadS);
          var sSign = mouse.dragInfo.sideSign;
          if (mouse.dragInfo.sideAxis === 'x') {
            var halfW0 = target.width / 2;
            var fx = target.x + sSign * halfW0 * axisXxS;
            var fz = target.z + sSign * halfW0 * axisXzS;
            var ox = target.x - sSign * halfW0 * axisXxS;
            var oz = target.z - sSign * halfW0 * axisXzS;
            mouse.dragInfo.faceDraggedStart = { x: fx, z: fz };
            mouse.dragInfo.faceOppStart = { x: ox, z: oz };
          } else if (mouse.dragInfo.sideAxis === 'z') {
            var halfD0 = target.depth / 2;
            var fxz = target.x + sSign * halfD0 * axisZxS;
            var fzz = target.z + sSign * halfD0 * axisZzS;
            var oxz = target.x - sSign * halfD0 * axisZxS;
            var ozz = target.z - sSign * halfD0 * axisZzS;
            mouse.dragInfo.faceDraggedStart = { x: fxz, z: fzz };
            mouse.dragInfo.faceOppStart = { x: oxz, z: ozz };
          }
        } catch (err) {
          console.warn('Face start compute failed:', err);
        }
        return;
      }
    }
    
    mouse.down = true;
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;
    mouse.dragType = 'camera';
    canvas.style.cursor = 'grabbing';
  });
  
  document.addEventListener('mousemove', function(e) {
    resizeHandles = [];

    if ((mouse.dragType === 'room' || mouse.dragType === 'balcony') && mouse.dragInfo) {
      var object = findObjectById(mouse.dragInfo.roomId);
      if (object) {
        var dx = e.clientX - mouse.dragInfo.startX;
        var dy = e.clientY - mouse.dragInfo.startY;
        var movement = worldMovement(dx, dy);
        var newX = mouse.dragInfo.originalX + movement.x;
        var newZ = mouse.dragInfo.originalZ + movement.z;
        var snap = applySnap({
          x: newX, 
          z: newZ, 
          width: object.width, 
          depth: object.depth, 
          level: object.level, 
          id: object.id,
          type: object.type
        });
        object.x = snap.x;
        object.z = snap.z;
        currentSnapGuides = snap.guides;
        updateStatus('Moving ' + object.name + '...');
      }
    } else if (mouse.dragType === 'stairs' && mouse.dragInfo) {
      if (stairsComponent) {
        var dx = e.clientX - mouse.dragInfo.startX;
        var dy = e.clientY - mouse.dragInfo.startY;
        var movement = worldMovement(dx, dy);
        var newX = mouse.dragInfo.originalX + movement.x;
        var newZ = mouse.dragInfo.originalZ + movement.z;
        var snap = applySnap({x: newX, z: newZ, width: stairsComponent.width, depth: stairsComponent.depth, level: stairsComponent.level, id: stairsComponent.id, type: 'stairs'});
        stairsComponent.x = snap.x;
        stairsComponent.z = snap.z;
        currentSnapGuides = snap.guides;
        updateStatus('Moving ' + stairsComponent.name + '...');
      }
    } else if (mouse.dragType === 'pergola' && mouse.dragInfo) {
      var pergola = findObjectById(mouse.dragInfo.roomId);
      if (pergola) {
        var dx = e.clientX - mouse.dragInfo.startX;
        var dy = e.clientY - mouse.dragInfo.startY;
        var movement = worldMovement(dx, dy);
        var newX = mouse.dragInfo.originalX + movement.x;
        var newZ = mouse.dragInfo.originalZ + movement.z;
        var snap = applySnap({x: newX, z: newZ, width: pergola.width, depth: pergola.depth, level: pergola.level, id: pergola.id, type: 'pergola'});
        pergola.x = snap.x;
        pergola.z = snap.z;
        currentSnapGuides = snap.guides;
        updateStatus('Moving ' + pergola.name + '...');
      }
    } else if (mouse.dragType === 'garage' && mouse.dragInfo) {
      var garage = findObjectById(mouse.dragInfo.roomId);
      if (garage) {
        var dx = e.clientX - mouse.dragInfo.startX;
        var dy = e.clientY - mouse.dragInfo.startY;
        var movement = worldMovement(dx, dy);
        var newX = mouse.dragInfo.originalX + movement.x;
        var newZ = mouse.dragInfo.originalZ + movement.z;
        var snap = applySnap({x: newX, z: newZ, width: garage.width, depth: garage.depth, level: garage.level, id: garage.id, type: 'garage'});
        garage.x = snap.x;
        garage.z = snap.z;
        currentSnapGuides = snap.guides;
        updateStatus('Moving ' + garage.name + '...');
      }
    } else if (mouse.dragType === 'pool' && mouse.dragInfo) {
      var pool = findObjectById(mouse.dragInfo.roomId);
      if (pool) {
        var dx = e.clientX - mouse.dragInfo.startX;
        var dy = e.clientY - mouse.dragInfo.startY;
        var movement = worldMovement(dx, dy);
        var newX = mouse.dragInfo.originalX + movement.x;
        var newZ = mouse.dragInfo.originalZ + movement.z;
        var snap = applySnap({x: newX, z: newZ, width: pool.width, depth: pool.depth, level: pool.level, id: pool.id, type: 'pool'});
        pool.x = snap.x;
        pool.z = snap.z;
        currentSnapGuides = snap.guides;
        updateStatus('Moving ' + pool.name + '...');
      }
    } else if (mouse.dragType === 'roof' && mouse.dragInfo) {
      var roof = findObjectById(mouse.dragInfo.roomId);
      if (roof) {
        var dx = e.clientX - mouse.dragInfo.startX;
        var dy = e.clientY - mouse.dragInfo.startY;
        var movement = worldMovement(dx, dy);
        var newX = mouse.dragInfo.originalX + movement.x;
        var newZ = mouse.dragInfo.originalZ + movement.z;
        var snap = applySnap({x: newX, z: newZ, width: roof.width, depth: roof.depth, level: roof.level, id: roof.id, type: 'roof'});
        roof.x = snap.x;
        roof.z = snap.z;
        currentSnapGuides = snap.guides;
        updateStatus('Moving ' + roof.name + '...');
      }
    } else if (mouse.dragType === 'furniture' && mouse.dragInfo) {
      var furn = findObjectById(mouse.dragInfo.roomId);
      if (furn) {
        var dx = e.clientX - mouse.dragInfo.startX;
        var dy = e.clientY - mouse.dragInfo.startY;
        var movement = worldMovement(dx, dy);
        var newX = mouse.dragInfo.originalX + movement.x;
        var newZ = mouse.dragInfo.originalZ + movement.z;
        var snap = applySnap({x: newX, z: newZ, width: furn.width, depth: furn.depth, level: furn.level, id: furn.id, type: 'furniture'});
        furn.x = snap.x;
        furn.z = snap.z;
        currentSnapGuides = snap.guides;
        updateStatus('Moving ' + (furn.name || 'Item') + '...');
      }
    } else if (mouse.dragType === 'handle' && mouse.dragInfo && mouse.dragInfo.handle) {
      var target = findObjectById(selectedRoomId);
      if (target) {
        // Rotation handle
        if (mouse.dragInfo.handle.type === 'rotate') {
          if (typeof target.rotation !== 'number') target.rotation = 0;
          var step = target.type === 'garage' ? 90 : 22.5;
          target.rotation = (target.rotation + step) % 360;
          renderLoop();
          updateStatus(target.name + ' rotated ' + step + '°');
          return;
        }

        var dx = e.clientX - mouse.dragInfo.startX;
        var dy = e.clientY - mouse.dragInfo.startY;
        var move = worldMovement(dx, dy);
        var rotRad = ((target.rotation || 0) * Math.PI) / 180;

        // Local axes
        var axisXx = Math.cos(rotRad), axisXz = Math.sin(rotRad);       // local +X
        var axisZx = -Math.sin(rotRad), axisZz = Math.cos(rotRad);      // local +Z

        var type = mouse.dragInfo.handle.type;
        var sizeDelta = 0;

        // Helpers
        function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

        // Defaults per type
        var minSize = (target.type === 'roof' || target.type === 'stairs') ? 1 : 0.5;
  var maxSize = 40;

        if (type === 'width+' || type === 'width-') {
          // Measure along dragged face normal (sX * axisX) so outward drag always increases
          var sX = mouse.dragInfo.sideSign || (type === 'width+' ? 1 : -1);
          var proj = move.x * axisXx + move.z * axisXz; // motion along +X

          // New dragged face position
          var fx = mouse.dragInfo.faceDraggedStart.x + proj * axisXx;
          var fz = mouse.dragInfo.faceDraggedStart.z + proj * axisXz;
          var vx = fx - mouse.dragInfo.faceOppStart.x;
          var vz = fz - mouse.dragInfo.faceOppStart.z;
          var along = vx * (sX * axisXx) + vz * (sX * axisXz); // distance along dragged face normal
          var newW = clamp(Math.max(minSize, Math.min(maxSize, along)), minSize, maxSize);
          // Snap width to nearest GRID_SPACING when within HANDLE_SNAP_TOLERANCE
          var snappedW = Math.round(newW / GRID_SPACING) * GRID_SPACING;
          if (Math.abs(newW - snappedW) <= HANDLE_SNAP_TOLERANCE) {
            newW = clamp(snappedW, minSize, maxSize);
          }
          target.width = newW;

          // Center is midpoint between opposite face and dragged face
          target.x = mouse.dragInfo.faceOppStart.x + (newW / 2) * (sX * axisXx);
          target.z = mouse.dragInfo.faceOppStart.z + (newW / 2) * (sX * axisXz);
          updateStatus('Resizing width...');
        } else if (type === 'depth+' || type === 'depth-') {
          // Measure along dragged face normal (sZ * axisZ)
          var sZ = mouse.dragInfo.sideSign || (type === 'depth+' ? 1 : -1);
          var projZ = move.x * axisZx + move.z * axisZz; // motion along +Z

          var fxz = mouse.dragInfo.faceDraggedStart.x + projZ * axisZx;
          var fzz = mouse.dragInfo.faceDraggedStart.z + projZ * axisZz;
          var vxz = fxz - mouse.dragInfo.faceOppStart.x;
          var vzz = fzz - mouse.dragInfo.faceOppStart.z;
          var alongZ = vxz * (sZ * axisZx) + vzz * (sZ * axisZz);
          var newD = clamp(Math.max(minSize, Math.min(maxSize, alongZ)), minSize, maxSize);
          // Snap depth to nearest GRID_SPACING when within HANDLE_SNAP_TOLERANCE
          var snappedD = Math.round(newD / GRID_SPACING) * GRID_SPACING;
          if (Math.abs(newD - snappedD) <= HANDLE_SNAP_TOLERANCE) {
            newD = clamp(snappedD, minSize, maxSize);
          }
          target.depth = newD;

          target.x = mouse.dragInfo.faceOppStart.x + (newD / 2) * (sZ * axisZx);
          target.z = mouse.dragInfo.faceOppStart.z + (newD / 2) * (sZ * axisZz);
          updateStatus('Resizing depth...');
        } else if (type === 'height') {
          var heightChange = -(dy * 0.005);
          var maxH = (target.type === 'pool') ? 5 : 10;
          target.height = clamp(target.height + heightChange, 0.5, maxH);
          updateStatus('Resizing height...');
        }

        renderLoop();
      }
    } else if (mouse.dragType === 'camera' && mouse.down) {
      var dx = e.clientX - mouse.lastX;
      var dy = e.clientY - mouse.lastY;
      if (e.shiftKey) {
        pan.x += dx * 1.5;
        pan.y += dy * 1.5;
      } else {
        camera.yaw -= dx * 0.008;
        camera.pitch -= dy * 0.008;
        camera.pitch = Math.max(camera.minPitch, Math.min(camera.maxPitch, camera.pitch));
      }
      mouse.lastX = e.clientX;
      mouse.lastY = e.clientY;
    }
  });
  
  document.addEventListener('mouseup', function() {
    currentSnapGuides = [];
    mouse.down = false;
    mouse.dragType = null;
    mouse.dragInfo = null;
    canvas.style.cursor = 'grab';
    updateStatus('Ready');
  });
  
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    camera.distance *= e.deltaY > 0 ? 1.08 : 0.92;
    camera.distance = Math.max(camera.minDistance, Math.min(camera.maxDistance, camera.distance));
  });
  
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var rpm = document.getElementById('room-palette-modal');
      if (rpm && rpm.style.display === 'block') {
        hideRoomPalette();
      } else {
        selectedRoomId = null;
        updateStatus('Selection cleared');
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRoomId) {
      e.preventDefault();
      
      var roomIndex = -1;
      for (var i = 0; i < allRooms.length; i++) {
        if (allRooms[i].id === selectedRoomId) {
          roomIndex = i;
          break;
        }
      }
      
      if (roomIndex > -1 && allRooms.length > 1) {
        var room = allRooms[roomIndex];
        allRooms.splice(roomIndex, 1);
        selectedRoomId = null;
        updateStatus(room.name + ' deleted');
        return;
      }
      
      if (stairsComponent && stairsComponent.id === selectedRoomId) {
        stairsComponent = null;
        selectedRoomId = null;
        updateStatus('Stairs deleted');
        return;
      }
      
      var pergolaIndex = -1;
      for (var i = 0; i < pergolaComponents.length; i++) {
        if (pergolaComponents[i].id === selectedRoomId) {
          pergolaIndex = i;
          break;
        }
      }
      
      if (pergolaIndex > -1) {
        var pergola = pergolaComponents[pergolaIndex];
        pergolaComponents.splice(pergolaIndex, 1);
        selectedRoomId = null;
        updateStatus(pergola.name + ' deleted');
        return;
      }
      
      var balconyIndex = -1;
      for (var i = 0; i < balconyComponents.length; i++) {
        if (balconyComponents[i].id === selectedRoomId) {
          balconyIndex = i;
          break;
        }
      }
      
      if (balconyIndex > -1) {
        var balcony = balconyComponents[balconyIndex];
        balconyComponents.splice(balconyIndex, 1);
        selectedRoomId = null;
        updateStatus(balcony.name + ' deleted');
        return;
      }
      
      var garageIndex = -1;
      for (var i = 0; i < garageComponents.length; i++) {
        if (garageComponents[i].id === selectedRoomId) {
          garageIndex = i;
          break;
        }
      }
      
      if (garageIndex > -1) {
        var garage = garageComponents[garageIndex];
        garageComponents.splice(garageIndex, 1);
        selectedRoomId = null;
        updateStatus(garage.name + ' deleted');
        return;
      }
      
      var poolIndex = -1;
      for (var i = 0; i < poolComponents.length; i++) {
        if (poolComponents[i].id === selectedRoomId) {
          poolIndex = i;
          break;
        }
      }
      if (poolIndex > -1) {
        var pool = poolComponents[poolIndex];
        poolComponents.splice(poolIndex, 1);
        selectedRoomId = null;
        updateStatus(pool.name + ' deleted');
        return;
      }
      
      var roofIndex = -1;
      for (var i = 0; i < roofComponents.length; i++) {
        if (roofComponents[i].id === selectedRoomId) {
          roofIndex = i;
          break;
        }
      }
      
      if (roofIndex > -1) {
        var roof = roofComponents[roofIndex];
        roofComponents.splice(roofIndex, 1);
        selectedRoomId = null;
        updateStatus(roof.name + ' deleted');
        return;
      }
      
      var furnIndex = -1;
      for (var i = 0; i < furnitureItems.length; i++) {
        if (furnitureItems[i].id === selectedRoomId) { furnIndex = i; break; }
      }
      if (furnIndex > -1) {
        var furn = furnitureItems[furnIndex];
        furnitureItems.splice(furnIndex, 1);
        selectedRoomId = null;
        updateStatus((furn.name || 'Item') + ' deleted');
        return;
      }
      
      updateStatus('Cannot delete - select an object first');
    }
  });

}

function switchLevel() {
  var selector = document.getElementById('levelSelect');
  if (!selector) return;
  
  var value = selector.value;
  var resetToFloor = '0';
  
  // Handle special components first
  if (value === 'stairs') {
    addStairs();
    selector.value = resetToFloor;
    renderLoop();
    return;
  } else if (value === 'pergola') {
    addPergola();
    selector.value = resetToFloor;
    renderLoop();
    return;
  } else if (value === 'garage') {
    addGarage();
    selector.value = resetToFloor;
    renderLoop();
    return;
  } else if (value === 'roof') {
    addRoof();
    selector.value = resetToFloor;
    renderLoop();
    return;
  } else if (value === 'pool') {
    addPool();
    selector.value = resetToFloor;
    renderLoop();
    return;
  } else if (value === 'balcony') {
    dbg('Balcony option selected in switchLevel');
    addBalcony();
    currentFloor = 1;  // Ensure we're on first floor
    selector.value = '1';
    dbg('Current floor after balcony added:', currentFloor);
    renderLoop();
    return;
  }

  // Handle floor changes
  var newFloor = parseInt(value) || 0;
  if (newFloor !== currentFloor) {
    currentFloor = newFloor;
    selectedRoomId = null;

      // If switching to first floor and there are no rooms on that floor, add one
      if (newFloor === 1 && !allRooms.some(room => room.level === 1)) {
        var newRoom = createRoom(0, 0, 1);
        var spot = findFreeSpot(newRoom);
        newRoom.x = spot.x;
        newRoom.z = spot.z;
        allRooms.push(newRoom);
        selectedRoomId = newRoom.id;
        updateStatus('Added room on Floor 2');
      } else {
        updateStatus('Floor ' + (newFloor + 1));
      }
      renderLoop();
    }
}

function fitView() {
  var rooms = allRooms.filter(function(r) { return r.level === currentFloor; });
  var objects = rooms.slice();
  
  if (stairsComponent && currentFloor === 0) {
    objects.push(stairsComponent);
  }
  if (currentFloor === 0) {
    objects = objects.concat(pergolaComponents);
    objects = objects.concat(garageComponents);
    objects = objects.concat(poolComponents);
    objects = objects.concat(roofComponents);
  }
  if (currentFloor === 1) {
    objects = objects.concat(balconyComponents);
  }
  
  if (objects.length === 0 && currentFloor === 0 && wallStrips.length === 0) return;
  
  var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  
  for (var i = 0; i < objects.length; i++) {
    var obj = objects[i];
    var hw = obj.width / 2;
    var hd = obj.depth / 2;
    minX = Math.min(minX, obj.x - hw);
    maxX = Math.max(maxX, obj.x + hw);
    minZ = Math.min(minZ, obj.z - hd);
    maxZ = Math.max(maxZ, obj.z + hd);
  }
  // Include wallStrips on ground floor in fit
  if (currentFloor === 0) {
    for (var wsI=0; wsI<wallStrips.length; wsI++){
      var ws = wallStrips[wsI]; var t = (ws.thickness||0.3)/2;
      var xMin = Math.min(ws.x0, ws.x1) - t, xMax = Math.max(ws.x0, ws.x1) + t;
      var zMin = Math.min(ws.z0, ws.z1) - t, zMax = Math.max(ws.z0, ws.z1) + t;
      minX = Math.min(minX, xMin); maxX = Math.max(maxX, xMax);
      minZ = Math.min(minZ, zMin); maxZ = Math.max(maxZ, zMax);
    }
  }
  
  camera.targetX = (minX + maxX) / 2;
  camera.targetZ = (minZ + maxZ) / 2;
  camera.distance = Math.max(8, Math.max(maxX - minX, maxZ - minZ) * 2 + 5);
  
  pan.x = 0;
  pan.y = 0;
  
  updateStatus('View fitted');
}

function resetAll() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  
  // Clear selections, handles, snap guides, and editing state
  selectedRoomId = null;
  editingLabelId = null;
  resizeHandles = [];
  currentSnapGuides = [];
  mouse.down = false;
  mouse.dragType = null;
  mouse.dragInfo = null;

  // Reset camera and pan
  camera.yaw = 0.0;
  camera.pitch = -0.5;
  camera.distance = 12;
  camera.targetX = 0;
  camera.targetZ = 0;
  pan.x = 0; pan.y = 0;

  // Reset floor selector
  currentFloor = 0;
  var selector = document.getElementById('levelSelect');
  if (selector) selector.value = '0';

  // Remove any transient UI like roof dropdown
  var roofDd = document.getElementById('roof-type-dropdown'); if (roofDd) roofDd.remove();

  // Clear all objects
  allRooms = [];
  wallStrips = [];
  stairsComponent = null;
  pergolaComponents = [];
  garageComponents = [];
  poolComponents = [];
  roofComponents = [];
  balconyComponents = [];

  // Start with a fresh initial room
  createInitialRoom();

  // Hide info/pricing modals if open
  var infoModal = document.getElementById('info-modal');
  if (infoModal) infoModal.style.display = 'none';
  var pricingModal = document.getElementById('pricing-modal');
  if (pricingModal) pricingModal.style.display = 'none';

  // Persist new clean state
  saveProjectSilently();
  updateStatus('Reset to default');
  startRender();
}

document.addEventListener('click', function(e) {
  var infoModal = document.getElementById('info-modal');
  var pricingModal = document.getElementById('pricing-modal');
  var paletteModal = document.getElementById('room-palette-modal');
  
  if (infoModal && e.target === infoModal) {
    hideInfo();
  }
  
  if (pricingModal && e.target === pricingModal) {
    hidePricing();
    }
  if (paletteModal && e.target === paletteModal) {
    hideRoomPalette();
  }
  });

function drawStairs(stairs) {
  if (!stairs) return;
  
  try {
    var selected = selectedRoomId === stairs.id;
    var stepHeight = stairs.height / stairs.steps;
    var stepDepth = stairs.depth / stairs.steps;
    
    var opacity = currentFloor === 0 ? 1.0 : 0.6;
    var strokeColor = selected ? '#007acc' : '#D0D0D0';
    var strokeWidth = selected ? 2 : 1;
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var rotRad = ((stairs.rotation || 0) * Math.PI) / 180;
    for (var step = 0; step < stairs.steps; step++) {
      var stepY = step * stepHeight;
      var stepZ = stairs.z - stairs.depth/2 + step * stepDepth;
      // Apply rotation around stairs center
      var corners = [
        {x: stairs.x - stairs.width/2, z: stepZ},
        {x: stairs.x + stairs.width/2, z: stepZ},
        {x: stairs.x + stairs.width/2, z: stepZ + stepDepth},
        {x: stairs.x - stairs.width/2, z: stepZ + stepDepth},
        {x: stairs.x - stairs.width/2, z: stepZ},
        {x: stairs.x + stairs.width/2, z: stepZ},
        {x: stairs.x + stairs.width/2, z: stepZ + stepDepth},
        {x: stairs.x - stairs.width/2, z: stepZ + stepDepth}
      ];
      var rotatedCorners = [];
      for (var i = 0; i < corners.length; i++) {
        var dx = corners[i].x - stairs.x;
        var dz = corners[i].z - stairs.z;
        var rx = stairs.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad);
        var rz = stairs.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad);
        var y = stepY + (i >= 4 ? stepHeight : 0);
        rotatedCorners.push({x: rx, y: y, z: rz});
      }
      var projected = [];
      var allVisible = true;
      for (var i = 0; i < rotatedCorners.length; i++) {
        var p = project3D(rotatedCorners[i].x, rotatedCorners[i].y, rotatedCorners[i].z);
        if (!p) {
          allVisible = false;
          break;
        }
        projected.push(p);
      }
      
      if (!allVisible) continue;
      
      var edges = [
        [0,1],[1,2],[2,3],[3,0],
        [4,5],[5,6],[6,7],[7,4],
        [0,4],[1,5],[2,6],[3,7]
      ];
      
      ctx.beginPath();
      for (var i = 0; i < edges.length; i++) {
        var edge = edges[i];
        ctx.moveTo(projected[edge[0]].x, projected[edge[0]].y);
        ctx.lineTo(projected[edge[1]].x, projected[edge[1]].y);
      }
      ctx.stroke();
      
      ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.2)';
      ctx.beginPath();
      ctx.moveTo(projected[4].x, projected[4].y);
      ctx.lineTo(projected[5].x, projected[5].y);
      ctx.lineTo(projected[6].x, projected[6].y);
      ctx.lineTo(projected[7].x, projected[7].y);
      ctx.closePath();
      ctx.fill();
    }
    
    ctx.globalAlpha = 1.0;
    
    // Always draw handles so all handles are draggable
    drawHandlesForStairs(stairs);
    
  } catch (error) {
    console.error('Stairs draw error:', error);
  }
}

function drawHandlesForStairs(stairs) {
  try {
    var isActive = selectedRoomId === stairs.id;
    var handleY = stairs.height + 0.2;
    
    var rotRad = ((stairs.rotation || 0) * Math.PI) / 180;
    function rotateHandle(dx, dz) {
      return {
        x: stairs.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        z: stairs.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
  var stairHandles = [
      // X+ (width+)
  (function() { var p = rotateHandle(stairs.width/2, 0); return {x: p.x, y: handleY, z: p.z, type: 'width+', label: 'X+'}; })(),
      // X- (width-)
  (function() { var p = rotateHandle(-stairs.width/2, 0); return {x: p.x, y: handleY, z: p.z, type: 'width-', label: 'X-'}; })(),
      // Z+ (depth+)
  (function() { var p = rotateHandle(0, stairs.depth/2); return {x: p.x, y: handleY, z: p.z, type: 'depth+', label: 'Z+'}; })(),
      // Z- (depth-)
  (function() { var p = rotateHandle(0, -stairs.depth/2); return {x:p.x, y:handleY, z:p.z, type: 'depth-', label: 'Z-'}; })(),
      // 360 handle remains centered
      {x: stairs.x, y: handleY + 0.3, z: stairs.z, type: 'rotate', label: '360'}
    ];
    
    for (var i = 0; i < stairHandles.length; i++) {
      var handle = stairHandles[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;

      drawHandle(screen, handle.type, handle.label, isActive);
      
      resizeHandles.push({
        screenX: screen.x - HANDLE_RADIUS,
        screenY: screen.y - HANDLE_RADIUS,
        width: HANDLE_RADIUS * 2,
        height: HANDLE_RADIUS * 2,
        type: handle.type,
        roomId: stairs.id
      });
    }
  } catch (error) {
    console.error('Stairs handle error:', error);
  }
}

function drawPergola(pergola) {
  if (!pergola) return;
  
  try {
    var selected = selectedRoomId === pergola.id;
    var strokeColor = selected ? '#007acc' : '#D0D0D0';
    var strokeWidth = selected ? 2 : 1.5;
    var opacity = currentFloor === 0 ? 1.0 : 0.6;
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var legSize = pergola.legWidth;
    var legPositions = [
      {x: pergola.x - pergola.width/2 + legSize/2, z: pergola.z - pergola.depth/2 + legSize/2},
      {x: pergola.x + pergola.width/2 - legSize/2, z: pergola.z - pergola.depth/2 + legSize/2},
      {x: pergola.x + pergola.width/2 - legSize/2, z: pergola.z + pergola.depth/2 - legSize/2},
      {x: pergola.x - pergola.width/2 + legSize/2, z: pergola.z + pergola.depth/2 - legSize/2}
    ];
    
    var roofHeight = 0.25;
    var roofY = pergola.height;
    
    for (var legIdx = 0; legIdx < legPositions.length; legIdx++) {
      var legPos = legPositions[legIdx];
      var legHalf = legSize / 2;
      
      var legCorners = [
        {x: legPos.x - legHalf, y: 0, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: 0, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: 0, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: 0, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: roofY + roofHeight, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: roofY + roofHeight, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: roofY + roofHeight, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: roofY + roofHeight, z: legPos.z + legHalf}
      ];
      
      var projectedLeg = [];
      var allVisible = true;
      for (var i = 0; i < legCorners.length; i++) {
        var p = project3D(legCorners[i].x, legCorners[i].y, legCorners[i].z);
        if (!p) {
          allVisible = false;
          break;
        }
        projectedLeg.push(p);
      }
      
      if (allVisible) {
        var legEdges = [
          [0,1],[1,2],[2,3],[3,0],
          [4,5],[5,6],[6,7],[7,4],
          [0,4],[1,5],[2,6],[3,7]
        ];
        
        ctx.beginPath();
        for (var i = 0; i < legEdges.length; i++) {
          var edge = legEdges[i];
          ctx.moveTo(projectedLeg[edge[0]].x, projectedLeg[edge[0]].y);
          ctx.lineTo(projectedLeg[edge[1]].x, projectedLeg[edge[1]].y);
        }
        ctx.stroke();
      }
    }
    
    var roofCorners = [
      {x: pergola.x - pergola.width/2, y: roofY, z: pergola.z - pergola.depth/2},
      {x: pergola.x + pergola.width/2, y: roofY, z: pergola.z - pergola.depth/2},
      {x: pergola.x + pergola.width/2, y: roofY, z: pergola.z + pergola.depth/2},
      {x: pergola.x - pergola.width/2, y: roofY, z: pergola.z + pergola.depth/2},
      {x: pergola.x - pergola.width/2, y: roofY + roofHeight, z: pergola.z - pergola.depth/2},
      {x: pergola.x + pergola.width/2, y: roofY + roofHeight, z: pergola.z - pergola.depth/2},
      {x: pergola.x + pergola.width/2, y: roofY + roofHeight, z: pergola.z + pergola.depth/2},
      {x: pergola.x - pergola.width/2, y: roofY + roofHeight, z: pergola.z + pergola.depth/2}
    ];
    
    var projectedRoof = [];
    var roofVisible = true;
    for (var i = 0; i < roofCorners.length; i++) {
      var p = project3D(roofCorners[i].x, roofCorners[i].y, roofCorners[i].z);
      if (!p) {
        roofVisible = false;
        break;
      }
      projectedRoof.push(p);
    }
    
    if (roofVisible) {
      var roofEdges = [
        [0,1],[1,2],[2,3],[3,0],
        [4,5],[5,6],[6,7],[7,4],
        [0,4],[1,5],[2,6],[3,7]
      ];
      
      ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.15)';
      
      ctx.beginPath();
      ctx.moveTo(projectedRoof[4].x, projectedRoof[4].y);
      ctx.lineTo(projectedRoof[5].x, projectedRoof[5].y);
      ctx.lineTo(projectedRoof[6].x, projectedRoof[6].y);
      ctx.lineTo(projectedRoof[7].x, projectedRoof[7].y);
      ctx.closePath();
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(projectedRoof[0].x, projectedRoof[0].y);
      ctx.lineTo(projectedRoof[1].x, projectedRoof[1].y);
      ctx.lineTo(projectedRoof[2].x, projectedRoof[2].y);
      ctx.lineTo(projectedRoof[3].x, projectedRoof[3].y);
      ctx.closePath();
      ctx.fill();
      
      ctx.beginPath();
      for (var i = 0; i < roofEdges.length; i++) {
        var edge = roofEdges[i];
        ctx.moveTo(projectedRoof[edge[0]].x, projectedRoof[edge[0]].y);
        ctx.lineTo(projectedRoof[edge[1]].x, projectedRoof[edge[1]].y);
      }
      ctx.stroke();
      
      var slatSpacing = pergola.width / (pergola.slatCount + 1);
      var slatThickness = 0.08;
      
      for (var slatIdx = 0; slatIdx < pergola.slatCount; slatIdx++) {
        var slatX = pergola.x - pergola.width/2 + (slatIdx + 1) * slatSpacing;
        var slatHalf = slatThickness / 2;
        
        var slatCorners = [
          {x: slatX - slatHalf, y: roofY + roofHeight, z: pergola.z - pergola.depth/2},
          {x: slatX + slatHalf, y: roofY + roofHeight, z: pergola.z - pergola.depth/2},
          {x: slatX + slatHalf, y: roofY + roofHeight, z: pergola.z + pergola.depth/2},
          {x: slatX - slatHalf, y: roofY + roofHeight, z: pergola.z + pergola.depth/2},
          {x: slatX - slatHalf, y: roofY + roofHeight + slatThickness, z: pergola.z - pergola.depth/2},
          {x: slatX + slatHalf, y: roofY + roofHeight + slatThickness, z: pergola.z - pergola.depth/2},
          {x: slatX + slatHalf, y: roofY + roofHeight + slatThickness, z: pergola.z + pergola.depth/2},
          {x: slatX - slatHalf, y: roofY + roofHeight + slatThickness, z: pergola.z + pergola.depth/2}
        ];
        
        var projectedSlat = [];
        var slatValid = true;
        for (var i = 0; i < slatCorners.length; i++) {
          var p = project3D(slatCorners[i].x, slatCorners[i].y, slatCorners[i].z);
          if (!p) {
            slatValid = false;
            break;
          }
          projectedSlat.push(p);
        }
        
        if (slatValid) {
          var slatEdges = [
            [0,1],[1,2],[2,3],[3,0],
            [4,5],[5,6],[6,7],[7,4],
            [0,4],[1,5],[2,6],[3,7]
          ];
          
          ctx.strokeStyle = selected ? '#007acc' : '#909090';
          ctx.lineWidth = 1;
          ctx.fillStyle = selected ? 'rgba(0,85,128,0.3)' : 'rgba(192,192,192,0.5)';
          
          ctx.beginPath();
          ctx.moveTo(projectedSlat[4].x, projectedSlat[4].y);
          ctx.lineTo(projectedSlat[5].x, projectedSlat[5].y);
          ctx.lineTo(projectedSlat[6].x, projectedSlat[6].y);
          ctx.lineTo(projectedSlat[7].x, projectedSlat[7].y);
          ctx.closePath();
          ctx.fill();
          
          ctx.beginPath();
          for (var i = 0; i < slatEdges.length; i++) {
            var edge = slatEdges[i];
            ctx.moveTo(projectedSlat[edge[0]].x, projectedSlat[edge[0]].y);
            ctx.lineTo(projectedSlat[edge[1]].x, projectedSlat[edge[1]].y);
          }
          ctx.stroke();
          
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
        }
      }
    }
    
    ctx.globalAlpha = 1.0;
    
    // Always draw handles so all handles are draggable
    drawHandlesForPergola(pergola);
    
  } catch (error) {
    console.error('Pergola draw error:', error);
  }
}

function drawBalcony(balcony) {
  dbg('Drawing balcony:', balcony);
  if (!balcony) {
    dbg('No balcony provided to draw');
    return;
  }
  
  try {
    var selected = selectedRoomId === balcony.id;
    var strokeColor = selected ? '#007acc' : '#D0D0D0';
    var strokeWidth = selected ? 2 : 1.5;
    var opacity = currentFloor === 1 ? 1.0 : 0.6;
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var legSize = balcony.legWidth;
    var baseY = balcony.level * 3.5; // Floor level height
    var legPositions = [
      {x: balcony.x - balcony.width/2 + legSize/2, z: balcony.z - balcony.depth/2 + legSize/2},
      {x: balcony.x + balcony.width/2 - legSize/2, z: balcony.z - balcony.depth/2 + legSize/2},
      {x: balcony.x + balcony.width/2 - legSize/2, z: balcony.z + balcony.depth/2 - legSize/2},
      {x: balcony.x - balcony.width/2 + legSize/2, z: balcony.z + balcony.depth/2 - legSize/2}
    ];
    
    // Draw walls
    var wallThickness = balcony.wallThickness;
    var wallHeight = balcony.wallHeight;
    var wallCorners = [
      // Front wall
      [
        {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY + wallHeight, z: balcony.z - balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY + wallHeight, z: balcony.z - balcony.depth/2}
      ],
      // Right wall
      [
        {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY + wallHeight, z: balcony.z + balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY + wallHeight, z: balcony.z - balcony.depth/2}
      ],
      // Back wall
      [
        {x: balcony.x + balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY + wallHeight, z: balcony.z + balcony.depth/2},
        {x: balcony.x + balcony.width/2, y: baseY + wallHeight, z: balcony.z + balcony.depth/2}
      ],
      // Left wall
      [
        {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z + balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY, z: balcony.z - balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY + wallHeight, z: balcony.z - balcony.depth/2},
        {x: balcony.x - balcony.width/2, y: baseY + wallHeight, z: balcony.z + balcony.depth/2}
      ]
    ];

    // Draw each wall
    for (var wallIdx = 0; wallIdx < wallCorners.length; wallIdx++) {
      var wall = wallCorners[wallIdx];
      var projectedWall = [];
      var wallVisible = true;
      
      for (var i = 0; i < wall.length; i++) {
        var p = project3D(wall[i].x, wall[i].y, wall[i].z);
        if (!p) {
          wallVisible = false;
          break;
        }
        projectedWall.push(p);
      }
      
      if (wallVisible) {
        ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.15)';
        ctx.beginPath();
        ctx.moveTo(projectedWall[0].x, projectedWall[0].y);
        for (var i = 1; i < projectedWall.length; i++) {
          ctx.lineTo(projectedWall[i].x, projectedWall[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    
    var roofY = baseY + balcony.height;
    
    // Draw legs
    for (var legIdx = 0; legIdx < legPositions.length; legIdx++) {
      var legPos = legPositions[legIdx];
      var legHalf = legSize / 2;
      
      var legCorners = [
        {x: legPos.x - legHalf, y: baseY + wallHeight, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: baseY + wallHeight, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: baseY + wallHeight, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: baseY + wallHeight, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: roofY, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: roofY, z: legPos.z - legHalf},
        {x: legPos.x + legHalf, y: roofY, z: legPos.z + legHalf},
        {x: legPos.x - legHalf, y: roofY, z: legPos.z + legHalf}
      ];
      
      var projectedLeg = [];
      var allVisible = true;
      for (var i = 0; i < legCorners.length; i++) {
        var p = project3D(legCorners[i].x, legCorners[i].y, legCorners[i].z);
        if (!p) {
          allVisible = false;
          break;
        }
        projectedLeg.push(p);
      }
      
      if (allVisible) {
        var legEdges = [
          [0,1],[1,2],[2,3],[3,0],
          [4,5],[5,6],[6,7],[7,4],
          [0,4],[1,5],[2,6],[3,7]
        ];
        
        ctx.beginPath();
        for (var i = 0; i < legEdges.length; i++) {
          var edge = legEdges[i];
          ctx.moveTo(projectedLeg[edge[0]].x, projectedLeg[edge[0]].y);
          ctx.lineTo(projectedLeg[edge[1]].x, projectedLeg[edge[1]].y);
        }
        ctx.stroke();
      }
    }
    
    // Draw roof/floor
    var roofCorners = [
      {x: balcony.x - balcony.width/2, y: roofY, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: roofY, z: balcony.z - balcony.depth/2},
      {x: balcony.x + balcony.width/2, y: roofY, z: balcony.z + balcony.depth/2},
      {x: balcony.x - balcony.width/2, y: roofY, z: balcony.z + balcony.depth/2}
    ];
    
    var projectedRoof = [];
    var roofVisible = true;
    for (var i = 0; i < roofCorners.length; i++) {
      var p = project3D(roofCorners[i].x, roofCorners[i].y, roofCorners[i].z);
      if (!p) {
        roofVisible = false;
        break;
      }
      projectedRoof.push(p);
    }
    
    if (roofVisible) {
      ctx.fillStyle = selected ? 'rgba(0,122,204,0.2)' : 'rgba(208,208,208,0.15)';
      ctx.beginPath();
      ctx.moveTo(projectedRoof[0].x, projectedRoof[0].y);
      ctx.lineTo(projectedRoof[1].x, projectedRoof[1].y);
      ctx.lineTo(projectedRoof[2].x, projectedRoof[2].y);
      ctx.lineTo(projectedRoof[3].x, projectedRoof[3].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    
    // Always draw handles so all handles are draggable
    drawHandlesForBalcony(balcony);
    
  } catch (error) {
    console.error('Balcony draw error:', error);
  }
}

function drawPool(pool) {
  if (!pool) return;
  try {
    var selected = selectedRoomId === pool.id;
    var strokeColor = selected ? '#007acc' : '#9ecae1';
    var rimColor = selected ? 'rgba(0,122,204,0.25)' : 'rgba(100,150,200,0.18)';
    var waterColor = selected ? 'rgba(40,150,220,0.35)' : 'rgba(60,160,220,0.28)';
    var strokeWidth = selected ? 2 : 1.5;
    var opacity = currentFloor === 0 ? 1.0 : 0.6;
    var rotRad = ((pool.rotation || 0) * Math.PI) / 180;
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;

    var hw = pool.width / 2;
    var hd = pool.depth / 2;
    var depthY = -pool.height; // in-ground

    function rot(x, z) {
      var dx = x - pool.x, dz = z - pool.z;
      return { x: pool.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad), z: pool.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad) };
    }

    // Rim at ground level (y=0)
    var cornersRim = [ rot(pool.x-hw, pool.z-hd), rot(pool.x+hw, pool.z-hd), rot(pool.x+hw, pool.z+hd), rot(pool.x-hw, pool.z+hd) ];
    var pR = cornersRim.map(function(c){ return project3D(c.x, 0, c.z); });
    if (pR.some(function(p){ return !p; })) return;

    // Inner bottom rectangle
    var cornersBottom = [ rot(pool.x-hw, pool.z-hd), rot(pool.x+hw, pool.z-hd), rot(pool.x+hw, pool.z+hd), rot(pool.x-hw, pool.z+hd) ];
    var pB = cornersBottom.map(function(c){ return project3D(c.x, depthY, c.z); });
    if (pB.some(function(p){ return !p; })) return;

    // Draw water surface as top face inside rim
    ctx.fillStyle = waterColor;
    ctx.beginPath();
    ctx.moveTo(pR[0].x, pR[0].y);
    ctx.lineTo(pR[1].x, pR[1].y);
    ctx.lineTo(pR[2].x, pR[2].y);
    ctx.lineTo(pR[3].x, pR[3].y);
    ctx.closePath();
    ctx.fill();

    // Draw inner walls (sides) to suggest depth
    ctx.fillStyle = 'rgba(50,120,180,0.25)';
    var faces = [[0,1],[1,2],[2,3],[3,0]];
    for (var i = 0; i < faces.length; i++) {
      var a = faces[i][0], b = faces[i][1];
      ctx.beginPath();
      ctx.moveTo(pR[a].x, pR[a].y);
      ctx.lineTo(pR[b].x, pR[b].y);
      ctx.lineTo(pB[b].x, pB[b].y);
      ctx.lineTo(pB[a].x, pB[a].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Rim outline
    ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(pR[0].x, pR[0].y);
    for (var i2=1;i2<4;i2++){ ctx.lineTo(pR[i2].x, pR[i2].y); }
    ctx.closePath();
    ctx.stroke();

    // Coping/rim fill slightly lighter
    ctx.fillStyle = rimColor;
    ctx.beginPath();
    ctx.moveTo(pR[0].x, pR[0].y);
    ctx.lineTo(pR[1].x, pR[1].y);
    ctx.lineTo(pR[2].x, pR[2].y);
    ctx.lineTo(pR[3].x, pR[3].y);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1.0;
    drawHandlesForPool(pool);
  } catch (e) { console.error('Pool draw error:', e); }
}

function drawHandlesForPool(pool) {
  try {
    var isActive = selectedRoomId === pool.id;
    var REGULAR_HANDLE_RADIUS = HANDLE_RADIUS;
    var ROTATION_HANDLE_RADIUS = 14;
    var BASE_HANDLE_Y = 0.3; // slightly above ground
    var ROTATION_HANDLE_Y = 0.9;
    var rotRad = ((pool.rotation || 0) * Math.PI) / 180;
    function rotateHandle(dx, dz) {
      return {
        x: pool.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        z: pool.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
    var hw = pool.width/2, hd = pool.depth/2;
    var handles = [];
    // rotation first
    handles.push({ x: pool.x, y: ROTATION_HANDLE_Y, z: pool.z, type: 'rotate', label: '360', radius: ROTATION_HANDLE_RADIUS });
    [
      {dx: hw, dz: 0, type: 'width+', label: 'X+'},
      {dx: -hw, dz: 0, type: 'width-', label: 'X-'},
      {dx: 0, dz: hd, type: 'depth+', label: 'Z+'},
      {dx: 0, dz: -hd, type: 'depth-', label: 'Z-'}
    ].forEach(function(h){ var p=rotateHandle(h.dx,h.dz); handles.push({x:p.x, y: BASE_HANDLE_Y, z:p.z, type:h.type, label:h.label, radius: REGULAR_HANDLE_RADIUS}); });

    handles.forEach(function(h){ var s=project3D(h.x,h.y,h.z); if(!s) return; drawHandle(s, h.type, h.label, isActive, h.radius); resizeHandles.push({screenX:s.x-h.radius,screenY:s.y-h.radius,width:h.radius*2,height:h.radius*2,type:h.type,roomId:pool.id}); });
  } catch (e) { console.error('Pool handle error:', e); }
}

function drawFurniture(f) {
  try {
    var selected = selectedRoomId === f.id;
    var levelY = (f.level || 0) * 3.5;
    var elev = Math.max(0, f.elevation || 0);
    var hw = (f.width || 1) / 2;
    var hd = (f.depth || 1) / 2;
    var h = f.height || 0.7;
    var rotRad = ((f.rotation || 0) * Math.PI) / 180;
    function rot(x, z) {
      var dx = x - f.x, dz = z - f.z;
      return { x: f.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad), z: f.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad) };
    }
    var corners = [
      rot(f.x - hw, f.z - hd), rot(f.x + hw, f.z - hd), rot(f.x + hw, f.z + hd), rot(f.x - hw, f.z + hd)
    ];
    var pts = [
      {x: corners[0].x, y: levelY + elev, z: corners[0].z},
      {x: corners[1].x, y: levelY + elev, z: corners[1].z},
      {x: corners[2].x, y: levelY + elev, z: corners[2].z},
      {x: corners[3].x, y: levelY + elev, z: corners[3].z},
      {x: corners[0].x, y: levelY + elev + h, z: corners[0].z},
      {x: corners[1].x, y: levelY + elev + h, z: corners[1].z},
      {x: corners[2].x, y: levelY + elev + h, z: corners[2].z},
      {x: corners[3].x, y: levelY + elev + h, z: corners[3].z}
    ];
    var proj = [];
    for (var i = 0; i < pts.length; i++) {
      var p = project3D(pts[i].x, pts[i].y, pts[i].z);
      if (!p) return;
      proj.push(p);
    }
    ctx.strokeStyle = selected ? '#007acc' : '#A0A0A0';
    ctx.lineWidth = selected ? 2 : 1;
    var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.beginPath();
    for (var i=0;i<edges.length;i++){ var e = edges[i]; ctx.moveTo(proj[e[0]].x, proj[e[0]].y); ctx.lineTo(proj[e[1]].x, proj[e[1]].y);} 
    ctx.stroke();
    // Simple top fill
    ctx.fillStyle = selected ? 'rgba(0,122,204,0.18)' : 'rgba(180,180,180,0.15)';
    ctx.beginPath();
    ctx.moveTo(proj[4].x, proj[4].y); ctx.lineTo(proj[5].x, proj[5].y); ctx.lineTo(proj[6].x, proj[6].y); ctx.lineTo(proj[7].x, proj[7].y);
    ctx.closePath(); ctx.fill();

    // Kitchen details: sink as cuboid with taps, oven front aligned with hobs, and four hot plates (non-overlapping sink)
    if (f.kind === 'kitchen') {
      var topY = levelY + elev + h;
      // Decide double sink for large kitchens
      var isLargeKitch = (f.name && (/large|03/i).test(f.name)) || (f.depth >= 1.6 || f.width >= 3.4);
      // Sizes (meters)
    var sinkW = isLargeKitch ? 0.9 : 0.55; // double or single basin width (footprint)
    var sinkD = 0.45;
    var sinkGap = isLargeKitch ? 0.04 : 0.0; // divider gap for double sink
    var sinkH = 0.12; // tap stem height
    var sinkDepthDown = 0.18; // how deep the sink recess goes below the worktop
      var plateR = 0.12;
      var plateGap = 0.28;
      // Place sinks towards left half, mid-depth
      var sinkCx = f.x - hw * 0.35;
      var sinkCz = f.z + 0; // center depth
      // Draw sink as a downward recess: inner walls + bottom
      function drawSinkCube(cx0, cz0, w, d, hSink) {
        var bx0 = cx0 - w/2, bx1 = cx0 + w/2;
        var bz0 = cz0 - d/2, bz1 = cz0 + d/2;
        var b00 = rot(bx0, bz0), b10 = rot(bx1, bz0), b11 = rot(bx1, bz1), b01 = rot(bx0, bz1);
        var yTop = topY, yBot = topY - sinkDepthDown;
        var pTop = [ project3D(b00.x, yTop, b00.z), project3D(b10.x, yTop, b10.z), project3D(b11.x, yTop, b11.z), project3D(b01.x, yTop, b01.z) ];
        var pBot = [ project3D(b00.x, yBot, b00.z), project3D(b10.x, yBot, b10.z), project3D(b11.x, yBot, b11.z), project3D(b01.x, yBot, b01.z) ];
        if (pTop.every(Boolean) && pBot.every(Boolean)) {
          // Inner side walls
          var walls = [[0,1],[1,2],[2,3],[3,0]];
          ctx.fillStyle = 'rgba(200,210,220,0.45)';
          ctx.strokeStyle = '#5b6773';
          ctx.lineWidth = 1;
          for (var wi=0; wi<walls.length; wi++){
            var a = walls[wi][0], c = walls[wi][1];
            ctx.beginPath();
            ctx.moveTo(pTop[a].x, pTop[a].y);
            ctx.lineTo(pTop[c].x, pTop[c].y);
            ctx.lineTo(pBot[c].x, pBot[c].y);
            ctx.lineTo(pBot[a].x, pBot[a].y);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
          }
          // Bottom
          ctx.fillStyle = 'rgba(35,40,48,0.55)';
          ctx.strokeStyle = '#4b5563';
          ctx.beginPath(); ctx.moveTo(pBot[0].x, pBot[0].y); ctx.lineTo(pBot[1].x, pBot[1].y); ctx.lineTo(pBot[2].x, pBot[2].y); ctx.lineTo(pBot[3].x, pBot[3].y); ctx.closePath(); ctx.fill(); ctx.stroke();
          // Drain at bottom center
          (function(){
            var steps = 18; var dr = Math.min(w,d) * 0.07; var cxw = (bx0+bx1)/2, czw = (bz0+bz1)/2;
            ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 1.2; ctx.beginPath();
            for (var i=0;i<=steps;i++){ var a=(i/steps)*Math.PI*2; var pxz=rot(cxw+Math.cos(a)*dr, czw+Math.sin(a)*dr); var p=project3D(pxz.x, yBot+0.005, pxz.z); if(!p) continue; if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);} ctx.stroke();
          })();
          // Top rim outline
          ctx.strokeStyle = '#5b6773'; ctx.beginPath(); ctx.moveTo(pTop[0].x,pTop[0].y); ctx.lineTo(pTop[1].x,pTop[1].y); ctx.lineTo(pTop[2].x,pTop[2].y); ctx.lineTo(pTop[3].x,pTop[3].y); ctx.closePath(); ctx.stroke();
        }
      }
      function drawCircleTop(cxw, czw, rw, strokeCol) {
        var steps = 18;
        ctx.strokeStyle = strokeCol || '#333';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (var i=0;i<=steps;i++) {
          var a = (i/steps) * Math.PI * 2;
          var pxz = rot(cxw + Math.cos(a)*rw, czw + Math.sin(a)*rw);
          var p = project3D(pxz.x, topY, pxz.z);
          if (!p) continue;
          if (i===0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      // Draw sink(s) as downward recesses
      if (isLargeKitch) {
        var w2 = (sinkW - sinkGap) / 2;
        drawSinkCube(sinkCx - (w2+sinkGap/2), sinkCz, w2, sinkD, sinkH);
        drawSinkCube(sinkCx + (w2+sinkGap/2), sinkCz, w2, sinkD, sinkH);
      } else {
        drawSinkCube(sinkCx, sinkCz, sinkW, sinkD, sinkH);
      }
      // Draw taps (two taps on the worktop just behind sink, towards -Z)
      function drawTap(tx, tz) {
        var stemH = sinkH, spoutL = 0.07;
        var p0w = rot(tx, tz - sinkD/2 - 0.03);
        var p1w = p0w;
        var base = project3D(p0w.x, topY, p0w.z);
        var top = project3D(p1w.x, topY + stemH, p1w.z);
        if (base && top) {
          ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
          // spout towards +Z
          var sp = rot(tx, tz - sinkD/2 - 0.03 + spoutL);
          var spP = project3D(sp.x, topY + stemH, sp.z);
          if (spP) { ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(spP.x, spP.y); ctx.stroke(); }
        }
      }
      if (isLargeKitch) {
        var w2c = (sinkW - sinkGap) / 2;
        drawTap(sinkCx - (w2c+sinkGap/2) - w2c*0.2, sinkCz);
        drawTap(sinkCx + (w2c+sinkGap/2) + w2c*0.2, sinkCz);
      } else {
        drawTap(sinkCx - sinkW*0.15, sinkCz);
        drawTap(sinkCx + sinkW*0.15, sinkCz);
      }
      // Compute hob area ensuring no overlap with sink; place on the opposite half
      var platesOnRight = sinkCx <= f.x; // if sink on left, place plates on right
      var plateBaseX = f.x + (platesOnRight ? hw * 0.30 : -hw * 0.30);
      var plateBaseZ = f.z - plateGap/2;
      // Ensure separation in X from sink footprint
      var sinkMinX = sinkCx - (isLargeKitch ? (sinkW/2) : (sinkW/2));
      var sinkMaxX = sinkCx + (isLargeKitch ? (sinkW/2) : (sinkW/2));
      var plateMinX = plateBaseX - plateR;
      var plateMaxX = plateBaseX + plateGap + plateR;
      if (!(plateMaxX < sinkMinX - 0.05 || plateMinX > sinkMaxX + 0.05)) {
        // push further away within the chosen half
        plateBaseX = f.x + (platesOnRight ? hw * 0.40 : -hw * 0.40);
      }
      drawCircleTop(plateBaseX, plateBaseZ, plateR, '#111');
      drawCircleTop(plateBaseX + plateGap, plateBaseZ, plateR, '#111');
      drawCircleTop(plateBaseX, plateBaseZ + plateGap, plateR, '#111');
      drawCircleTop(plateBaseX + plateGap, plateBaseZ + plateGap, plateR, '#111');
      // Oven front on +Z face
      var ovenW = Math.min(0.7, f.width*0.5), ovenH = 0.45;
      var oy0 = levelY + 0.15, oy1 = Math.min(levelY + h - 0.1, oy0 + ovenH);
      // Align oven horizontally with hob center
      var hobCenterX = plateBaseX + plateGap/2;
      var ox0 = hobCenterX - ovenW/2, ox1 = hobCenterX + ovenW/2, oz = f.z + hd;
      var v0 = rot(ox0, oz), v1 = rot(ox1, oz);
      var p0 = project3D(v0.x, oy0, v0.z), p1 = project3D(v1.x, oy0, v1.z), p2 = project3D(v1.x, oy1, v1.z), p3 = project3D(v0.x, oy1, v0.z);
      if (p0 && p1 && p2 && p3) {
        ctx.fillStyle = 'rgba(20,20,25,0.35)';
        ctx.strokeStyle = '#444';
        ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.closePath(); ctx.fill(); ctx.stroke();
        // handle
        var hy = (p2.y + p3.y)*0.5 - 4;
        ctx.strokeStyle = '#c0c0c0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p0.x+6, hy); ctx.lineTo(p1.x-6, hy); ctx.stroke();
      }
    }
  } catch(e){ console.warn('drawFurniture failed', e); }
}

function drawHandlesForBalcony(balcony) {
  try {
    var isActive = selectedRoomId === balcony.id;
    var handleY = balcony.level * 3.5 + balcony.height + 0.2;
    
    var balconyHandles = [
      {x: balcony.x + balcony.width/2, y: handleY, z: balcony.z, type: 'width+', label: 'X+'},
      {x: balcony.x - balcony.width/2, y: handleY, z: balcony.z, type: 'width-', label: 'X-'},
      {x: balcony.x, y: handleY, z: balcony.z + balcony.depth/2, type: 'depth+', label: 'Z+'},
      {x: balcony.x, y: handleY, z: balcony.z - balcony.depth/2, type: 'depth-', label: 'Z-'}
    ];
    
    for (var i = 0; i < balconyHandles.length; i++) {
      var handle = balconyHandles[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;

      drawHandle(screen, handle.type, handle.label, isActive);
      
      resizeHandles.push({
        screenX: screen.x - HANDLE_RADIUS,
        screenY: screen.y - HANDLE_RADIUS,
        width: HANDLE_RADIUS * 2,
        height: HANDLE_RADIUS * 2,
        type: handle.type,
        roomId: balcony.id
      });
    }
  } catch (error) {
    console.error('Balcony handle error:', error);
  }
}

function drawGarage(garage) {
  if (!garage) return;
  
  try {
    dbg('Drawing garage:', garage.id, 'Selected:', selectedRoomId);
    var selected = selectedRoomId === garage.id;
    var strokeColor = selected ? '#007acc' : '#D0D0D0';
    var fillColor = selected ? 'rgba(0,122,204,0.3)' : 'rgba(208,208,208,0.2)';
    var strokeWidth = selected ? 2 : 1.5;
    var rotRad = ((garage.rotation || 0) * Math.PI) / 180; // Add rotation support
    var opacity = currentFloor === 0 ? 1.0 : 0.6;
    
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    
    var hw = garage.width / 2;
    var hd = garage.depth / 2;
    
    function rotatePoint(x, z) {
      var dx = x - garage.x;
      var dz = z - garage.z;
      return {
        x: garage.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        z: garage.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
    
    var unrotatedCorners = [
      {x: garage.x - hw, y: 0, z: garage.z - hd},
      {x: garage.x + hw, y: 0, z: garage.z - hd},
      {x: garage.x + hw, y: 0, z: garage.z + hd},
      {x: garage.x - hw, y: 0, z: garage.z + hd},
      {x: garage.x - hw, y: garage.height, z: garage.z - hd},
      {x: garage.x + hw, y: garage.height, z: garage.z - hd},
      {x: garage.x + hw, y: garage.height, z: garage.z + hd},
      {x: garage.x - hw, y: garage.height, z: garage.z + hd}
    ];
    
    var corners = unrotatedCorners.map(function(c) {
      var rotated = rotatePoint(c.x, c.z);
      return {x: rotated.x, y: c.y, z: rotated.z};
    });
    // Note: removed erroneous wall strip block referencing undefined variables that hid the garage

    var projected = [];
    for (var i = 0; i < corners.length; i++) {
      var p = project3D(corners[i].x, corners[i].y, corners[i].z);
      if (!p) return;
      projected.push(p);
    }
    
    var edges = [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7]
    ];
    
    ctx.beginPath();
    for (var i = 0; i < edges.length; i++) {
      var edge = edges[i];
      ctx.moveTo(projected[edge[0]].x, projected[edge[0]].y);
      ctx.lineTo(projected[edge[1]].x, projected[edge[1]].y);
    }
    ctx.stroke();
    
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    ctx.lineTo(projected[1].x, projected[1].y);
    ctx.lineTo(projected[2].x, projected[2].y);
    ctx.lineTo(projected[3].x, projected[3].y);
    ctx.closePath();
    ctx.fill();
    
    var doorWidth = garage.width;
    var doorHeight = garage.height * 0.9;
    var doorY = 0;
    
    // Compute door corners and rotate them with the garage
    var doorCorners = [
      {x: garage.x - doorWidth/2, y: doorY, z: garage.z - garage.depth/2},
      {x: garage.x + doorWidth/2, y: doorY, z: garage.z - garage.depth/2},
      {x: garage.x + doorWidth/2, y: doorY + doorHeight, z: garage.z - garage.depth/2},
      {x: garage.x - doorWidth/2, y: doorY + doorHeight, z: garage.z - garage.depth/2}
    ];
    
    var projectedDoor = [];
    var doorVisible = true;
    for (var i = 0; i < doorCorners.length; i++) {
      var rp = rotatePoint(doorCorners[i].x, doorCorners[i].z);
      var p = project3D(rp.x, doorCorners[i].y, rp.z);
      if (!p) {
        doorVisible = false;
        break;
      }
      projectedDoor.push(p);
    }
    
    if (doorVisible) {
      ctx.fillStyle = selected ? '#B8D4F0' : 'rgba(192,192,192,0.5)';
      ctx.beginPath();
      ctx.moveTo(projectedDoor[0].x, projectedDoor[0].y);
      ctx.lineTo(projectedDoor[1].x, projectedDoor[1].y);
      ctx.lineTo(projectedDoor[2].x, projectedDoor[2].y);
      ctx.lineTo(projectedDoor[3].x, projectedDoor[3].y);
      ctx.closePath();
      ctx.fill();
      
      ctx.strokeStyle = selected ? '#007acc' : '#A0A0A0';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      var slatCount = garage.doorSlatCount || 8;
      var slatHeight = doorHeight / slatCount;
      
      for (var slatIdx = 1; slatIdx < slatCount; slatIdx++) {
        var slatY = doorY + slatIdx * slatHeight;
  // Rotate slat endpoints along the door plane
  var leftRot = rotatePoint(garage.x - doorWidth/2, garage.z - garage.depth/2);
  var rightRot = rotatePoint(garage.x + doorWidth/2, garage.z - garage.depth/2);
  var slatLeft = project3D(leftRot.x, slatY, leftRot.z);
  var slatRight = project3D(rightRot.x, slatY, rightRot.z);
        
        if (slatLeft && slatRight) {
          ctx.strokeStyle = selected ? '#007acc' : '#D0D0D0';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(slatLeft.x, slatLeft.y);
          ctx.lineTo(slatRight.x, slatRight.y);
          ctx.stroke();
        }
      }
      
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
    }
    
    ctx.globalAlpha = 1.0;
    
    // Always draw handles so all handles are draggable
    drawHandlesForGarage(garage);
    
  } catch (error) {
    console.error('Garage draw error:', error);
  }
}

function drawHandlesForGarage(garage) {
  try {
    var isActive = selectedRoomId === garage.id;
    dbg('Drawing garage handles');
    // Set constants
    var REGULAR_HANDLE_RADIUS = HANDLE_RADIUS;
    var ROTATION_HANDLE_RADIUS = 14;
    var BASE_HANDLE_Y = garage.height + 0.2;
    var ROTATION_HANDLE_Y = garage.height + 1.0;
    
    var handleY = BASE_HANDLE_Y;
    var rotRad = ((garage.rotation || 0) * Math.PI) / 180;
    
    function rotateHandle(dx, dz) {
      return {
        x: garage.x + dx * Math.cos(rotRad) - dz * Math.sin(rotRad),
        z: garage.z + dx * Math.sin(rotRad) + dz * Math.cos(rotRad)
      };
    }
    
    var hw = garage.width/2;
    var hd = garage.depth/2;
    
    // Create resize handles first
    var garageHandles = [];
    
    // Rotation handle - add this first so it's drawn underneath
    garageHandles.push({
      x: garage.x,
      y: ROTATION_HANDLE_Y,
      z: garage.z,
      type: 'rotate',
      label: '360',
      radius: ROTATION_HANDLE_RADIUS
    });
    
    // Add resize handles
    var resizeHandleData = [
      {dx: hw, dz: 0, type: 'width+', label: 'X+'},
      {dx: -hw, dz: 0, type: 'width-', label: 'X-'},
      {dx: 0, dz: hd, type: 'depth+', label: 'Z+'},
      {dx: 0, dz: -hd, type: 'depth-', label: 'Z-'}
    ];
    
    resizeHandleData.forEach(function(data) {
      var p = rotateHandle(data.dx, data.dz);
      garageHandles.push({
        x: p.x,
        y: BASE_HANDLE_Y,
        z: p.z,
        type: data.type,
        label: data.label,
        radius: REGULAR_HANDLE_RADIUS
      });
    });
    
  dbg('Drawing handles:', garageHandles.length);
    // Draw each handle
    garageHandles.forEach(function(handle) {
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) return;

      drawHandle(screen, handle.type, handle.label, isActive, handle.radius);
      
      // Register handle for interaction
      resizeHandles.push({
        screenX: screen.x - handle.radius,
        screenY: screen.y - handle.radius,
        width: handle.radius * 2,
        height: handle.radius * 2,
        type: handle.type,
        roomId: garage.id
      });
      
  dbg('Registered handle:', handle.type, 'for garage:', garage.id);
    });
  } catch (error) {
    console.error('Garage handle error:', error);
  }
}

function renderLoop() {
  var frameStart = (performance && performance.now) ? performance.now() : Date.now();
  try {
    // Detect camera / selection changes to decide if a re-render is necessary
    var camChanged = false;
    var lc = __perf.lastCamera;
    if (lc.yaw !== camera.yaw || lc.pitch !== camera.pitch || lc.targetX !== camera.targetX || lc.targetZ !== camera.targetZ || lc.distance !== camera.distance || lc.floor !== currentFloor || lc.sel !== selectedRoomId) {
      camChanged = true;
      lc.yaw = camera.yaw; lc.pitch = camera.pitch; lc.targetX = camera.targetX; lc.targetZ = camera.targetZ; lc.distance = camera.distance; lc.floor = currentFloor; lc.sel = selectedRoomId;
      _camLastMoveTime = frameStart;
    }
    var dynamicActivity = camChanged || _needsFullRender;
    var nowTs = frameStart;
    var dtSinceLast = nowTs - __perf.lastFrameTime;
    var minInterval = dynamicActivity ? _minFrameInterval : (1000 / MIN_DYNAMIC_FPS);
    if (!dynamicActivity && dtSinceLast < minInterval) {
      __perf.skipStreak++;
      animationId = requestAnimationFrame(renderLoop);
      return;
    }
    __perf.skipStreak = 0;
    __perf.lastFrameTime = nowTs;

    resizeHandles = [];
    updateProjectionCache();
    clearCanvas();
    drawGrid();
    drawSnapGuides();

    // Build unified object list with squared distance culling
    var allObjects = [];
    var cullR = Math.max(40, camera.distance * 4);
    var cullR2 = cullR * cullR;
    function withinCull(x,y,z){ var dx=x-camera.targetX, dz=z-camera.targetZ; var d2=dx*dx+dz*dz; return d2 <= cullR2; }

    for (var i=0;i<allRooms.length;i++){
      var room=allRooms[i]; var roomCenterY=room.level*3.5+room.height/2; if(!withinCull(room.x,roomCenterY,room.z)) continue; var centerScreen=project3D(room.x,roomCenterY,room.z); if(centerScreen && !isOffscreenByCenter(centerScreen)){ var dx=room.x-camera.targetX, dz=room.z-camera.targetZ; var d=Math.sqrt(dx*dx+dz*dz); allObjects.push({object:room,type:'room',distance:d,maxHeight:room.level*3.5+room.height}); }
    }
    if(stairsComponent){ var scY=stairsComponent.height/2; if(withinCull(stairsComponent.x,scY,stairsComponent.z)){ var sScreen=project3D(stairsComponent.x,scY,stairsComponent.z); if(sScreen && !isOffscreenByCenter(sScreen)){ var dxs=stairsComponent.x-camera.targetX, dzs=stairsComponent.z-camera.targetZ; var ds=Math.sqrt(dxs*dxs+dzs*dzs); allObjects.push({object:stairsComponent,type:'stairs',distance:ds,maxHeight:stairsComponent.height}); } } }
    for (var iB=0;iB<balconyComponents.length;iB++){ var balcony=balconyComponents[iB]; var bCY=balcony.level*3.5+balcony.height/2; if(!withinCull(balcony.x,bCY,balcony.z)) continue; var bScreen=project3D(balcony.x,bCY,balcony.z); if(bScreen && !isOffscreenByCenter(bScreen)){ var dxb=balcony.x-camera.targetX, dzb=balcony.z-camera.targetZ; var db=Math.sqrt(dxb*dxb+dzb*dzb); allObjects.push({object:balcony,type:'balcony',distance:db,maxHeight:balcony.level*3.5+balcony.height}); } }
    for (var iP=0;iP<pergolaComponents.length;iP++){ var perg=pergolaComponents[iP]; var pCY=perg.totalHeight/2; if(!withinCull(perg.x,pCY,perg.z)) continue; var pScreen=project3D(perg.x,pCY,perg.z); if(pScreen && !isOffscreenByCenter(pScreen)){ var dxp=perg.x-camera.targetX, dzp=perg.z-camera.targetZ; var dp=Math.sqrt(dxp*dxp+dzp*dzp); allObjects.push({object:perg,type:'pergola',distance:dp,maxHeight:perg.totalHeight}); } }
    for (var iG=0;iG<garageComponents.length;iG++){ var gar=garageComponents[iG]; var gCY=gar.height/2; if(!withinCull(gar.x,gCY,gar.z)) continue; var gScreen=project3D(gar.x,gCY,gar.z); if(gScreen && !isOffscreenByCenter(gScreen)){ var dxg=gar.x-camera.targetX, dzg=gar.z-camera.targetZ; var dg=Math.sqrt(dxg*dxg+dzg*dzg); allObjects.push({object:gar,type:'garage',distance:dg,maxHeight:gar.height}); } }
  for (var iPl=0;iPl<poolComponents.length;iPl++){ var pol=poolComponents[iPl]; var pCY2=0.2; if(!withinCull(pol.x,pCY2,pol.z)) continue; var plScreen=project3D(pol.x,pCY2,pol.z); if(plScreen && !isOffscreenByCenter(plScreen)){ var dxpl=pol.x-camera.targetX, dzpl=pol.z-camera.targetZ; var dpl=Math.sqrt(dxpl*dxpl+dzpl*dzpl); allObjects.push({object:pol,type:'pool',distance:dpl,maxHeight:0}); } }
    for (var iR=0;iR<roofComponents.length;iR++){ var roof=roofComponents[iR]; var rCY=roof.baseHeight+roof.height/2; if(!withinCull(roof.x,rCY,roof.z)) continue; var rScreen=project3D(roof.x,rCY,roof.z); if(rScreen && !isOffscreenByCenter(rScreen)){ var dxr=roof.x-camera.targetX, dzr=roof.z-camera.targetZ; var dr=Math.sqrt(dxr*dxr+dzr*dzr); allObjects.push({object:roof,type:'roof',distance:dr,maxHeight:roof.baseHeight+roof.height}); } }
    for (var iF=0;iF<furnitureItems.length;iF++){ var furn=furnitureItems[iF]; var fCY=(furn.level||0)*3.5+(furn.height||0.7)/2; if(!withinCull(furn.x,fCY,furn.z)) continue; var fScreen=project3D(furn.x,fCY,furn.z); if(fScreen && !isOffscreenByCenter(fScreen)){ var dxf=furn.x-camera.targetX, dzf=furn.z-camera.targetZ; var df=Math.sqrt(dxf*dxf+dzf*dzf); allObjects.push({object:furn,type:'furniture',distance:df,maxHeight:(furn.level||0)*3.5+(furn.elevation||0)+(furn.height||0.7)}); } }

    allObjects.sort(function(a,b){ var distDiff=b.distance-a.distance; if(Math.abs(distDiff)>1.0) return distDiff; return a.maxHeight-b.maxHeight; });

  // Draw standalone wall strips first (ground-level); not part of allObjects
  for (var iWS=0;iWS<wallStrips.length;iWS++){
    var ws = wallStrips[iWS];
    // simple cull by mid point and half height
    var cx=(ws.x0+ws.x1)/2, cz=(ws.z0+ws.z1)/2, cy=(ws.height||3.0)/2; if(!withinCull(cx,cy,cz)) continue; drawWallStrip(ws);
  }
  var selectedEntry=null; for (var iO=0;iO<allObjects.length;iO++){ var it=allObjects[iO]; if(selectedRoomId && it.object && it.object.id===selectedRoomId){ selectedEntry=it; continue;} switch(it.type){ case 'room': drawRoom(it.object); break; case 'stairs': drawStairs(it.object); break; case 'furniture': drawFurniture(it.object); break; case 'balcony': drawBalcony(it.object); break; case 'pergola': drawPergola(it.object); break; case 'garage': drawGarage(it.object); break; case 'pool': drawPool(it.object); break; case 'roof': drawRoof(it.object); break; } }
  if(selectedEntry){ switch(selectedEntry.type){ case 'room': drawRoom(selectedEntry.object); break; case 'stairs': drawStairs(selectedEntry.object); break; case 'furniture': drawFurniture(selectedEntry.object); break; case 'balcony': drawBalcony(selectedEntry.object); break; case 'pergola': drawPergola(selectedEntry.object); break; case 'garage': drawGarage(selectedEntry.object); break; case 'pool': drawPool(selectedEntry.object); break; case 'roof': drawRoof(selectedEntry.object); break; }}

    // Draw world-anchored height scale after objects so it appears in front
    drawWorldHeightScale();

    var now = (performance && performance.now)? performance.now(): Date.now();
    if (now - _lastLabelsUpdate > LABEL_UPDATE_INTERVAL_MS) {
      if (!window.__labelsFrozen) { updateLabels(); _lastLabelsUpdate = now; }
    }
  drawCompass();
    if (now - _lastMeasurementsUpdate > MEASURE_UPDATE_INTERVAL_MS) { updateMeasurements(); _lastMeasurementsUpdate = now; }
    _needsFullRender = false;
  } catch (error) {
    console.error('Render error:', error); updateStatus('Render error');
  }
  var frameEnd = (performance && performance.now) ? performance.now() : Date.now();
  var frameDur = frameEnd - frameStart; __perf.frameMs = frameDur; __perf.frames++;
  if(frameEnd - __perf.lastFpsSample > 1000){ __perf.fps = (__perf.frames * 1000)/(frameEnd-__perf.lastFpsSample); __perf.frames=0; __perf.lastFpsSample=frameEnd; updatePerfStatsOverlay(); }
  animationId = requestAnimationFrame(renderLoop);
}

function startRender() {
  if (animationId) cancelAnimationFrame(animationId);
  renderLoop();
}

document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, starting app...');
  startApp();
});

// ================= PERFORMANCE & RENDER OPTIMIZATIONS =================
// Lightweight instrumentation & adaptive rendering to reduce CPU/GPU usage when scene is static.
var __perf = {
  frames:0, fps:0, lastFpsSample:0, lastFrameTime:0, frameMs:0,
  lastCamera:{yaw:null,pitch:null,targetX:null,targetZ:null,distance:null,floor:null, sel:null},
  skipStreak:0
};
var ENABLE_PERF_OVERLAY = false; // toggle overlay (disabled by default)
var DISABLE_DEBUG_LOGS = true;  // silences dbg() heavy logging loops
var TARGET_FPS = 60;            // base target
var MIN_DYNAMIC_FPS = 10;       // when idle we allow dropping to 10fps equivalent checks
var _minFrameInterval = 1000 / TARGET_FPS;
function ensurePerfOverlay(){ if(!ENABLE_PERF_OVERLAY) return; var el=document.getElementById('perf-stats'); if(!el){ el=document.createElement('div'); el.id='perf-stats'; el.style.cssText='position:fixed;left:4px;top:4px;font:11px/1.2 monospace;z-index:9999;background:rgba(0,0,0,0.45);color:#9fef00;padding:4px 6px;border-radius:4px;pointer-events:none;'; document.body.appendChild(el);} return el; }
function updatePerfStatsOverlay(){ var el=ensurePerfOverlay(); if(!el) return; el.textContent = 'fps '+__perf.fps.toFixed(0)+'  frame '+__perf.frameMs.toFixed(2)+'ms'+(__perf.skipStreak>0?'  idle-skip:'+__perf.skipStreak:''); }
// Wrap dbg so we can globally silence frequent logs
if(typeof dbg === 'function'){
  var _dbgRef = dbg;
  dbg = function(){ if(DISABLE_DEBUG_LOGS) return; _dbgRef.apply(this, arguments); };
}
// Flag-based invalidation: call invalidateScene() when something structural changes
var _needsFullRender = true; function invalidateScene(){ _needsFullRender = true; }


// ---------- Save/Load and Export ----------
function serializeProject() {
  return JSON.stringify({
    version: 1,
    camera: camera,
    rooms: allRooms,
    wallStrips: wallStrips,
    stairs: stairsComponent,
    pergolas: pergolaComponents,
    garages: garageComponents,
    pools: poolComponents,
    roofs: roofComponents,
    balconies: balconyComponents,
    furniture: furnitureItems,
    currentFloor: currentFloor
  });
}

function restoreProject(json) {
  try {
    var data = JSON.parse(json);
    if (!data) return;
    camera = Object.assign(camera, data.camera || {});
    allRooms = Array.isArray(data.rooms) ? data.rooms : [];
    wallStrips = Array.isArray(data.wallStrips) ? data.wallStrips : [];
    stairsComponent = data.stairs || null;
    pergolaComponents = Array.isArray(data.pergolas) ? data.pergolas : [];
    garageComponents = Array.isArray(data.garages) ? data.garages : [];
  poolComponents = Array.isArray(data.pools) ? data.pools : [];
    roofComponents = Array.isArray(data.roofs) ? data.roofs : [];
    balconyComponents = Array.isArray(data.balconies) ? data.balconies : [];
  furnitureItems = Array.isArray(data.furniture) ? data.furniture : [];
  // Normalize: all kitchens must have 0.7m depth
  for (var i=0;i<furnitureItems.length;i++) {
    if (furnitureItems[i] && furnitureItems[i].kind === 'kitchen') {
      furnitureItems[i].depth = 0.7;
    }
  }
    currentFloor = typeof data.currentFloor === 'number' ? data.currentFloor : currentFloor;
    selectedRoomId = null;
    renderLoop();
  } catch (e) {
    console.error('Restore failed', e);
  }
}

function saveProjectSilently() {
  try { localStorage.setItem('gablok_project', serializeProject()); } catch (e) {}
}

function saveProject() {
  try {
    localStorage.setItem('gablok_project', serializeProject());
    updateStatus('Project saved');
  } catch (e) {
    console.error(e); updateStatus('Save failed');
  }
}

function loadProject() {
  try {
    var json = localStorage.getItem('gablok_project');
    if (!json) { updateStatus('No saved project'); return; }
    restoreProject(json);
    updateStatus('Project loaded');
  } catch (e) {
    console.error(e); updateStatus('Load failed');
  }
}

function exportOBJ() {
  // Minimal OBJ exporter for boxes (rooms/components)
  var lines = ['# Gablok Export'];
  var vcount = 0;
  function pushBox(obj, y0, y1, tag) {
    var hw = obj.width/2, hd = obj.depth/2;
    var cx = obj.x, cz = obj.z;
    var rotRad = ((obj.rotation || 0) * Math.PI) / 180;
    function rot(x, z) {
      var dx = x - cx, dz = z - cz;
      return { x: cx + dx * Math.cos(rotRad) - dz * Math.sin(rotRad), z: cz + dx * Math.sin(rotRad) + dz * Math.cos(rotRad) };
    }
    var corners = [
      rot(cx-hw, cz-hd), rot(cx+hw, cz-hd), rot(cx+hw, cz+hd), rot(cx-hw, cz+hd)
    ];
    // 8 vertices
    if (tag) lines.push('g ' + tag);
    var verts = [
      [corners[0].x, y0, corners[0].z], [corners[1].x, y0, corners[1].z], [corners[2].x, y0, corners[2].z], [corners[3].x, y0, corners[3].z],
      [corners[0].x, y1, corners[0].z], [corners[1].x, y1, corners[1].z], [corners[2].x, y1, corners[2].z], [corners[3].x, y1, corners[3].z]
    ];
    verts.forEach(function(v){ lines.push('v ' + v[0] + ' ' + v[1] + ' ' + v[2]); });
    // faces (1-indexed)
    var f = function(a,b,c,d){ lines.push('f ' + (vcount+a) + ' ' + (vcount+b) + ' ' + (vcount+c) + ' ' + (vcount+d)); };
    vcount += 8;
    f(1,2,3,4); f(5,6,7,8); f(1,2,6,5); f(2,3,7,6); f(3,4,8,7); f(4,1,5,8);
  }
  // Rooms
  allRooms.forEach(function(r){ var y0=r.level*3.5, y1=y0+r.height; pushBox(r,y0,y1,'room_'+(r.name||'')); });
  // Standalone wall strips exported as thin boxes with given height and thickness
  wallStrips.forEach(function(w){
    // Build a centered thin box along the strip centerline
    var dx = w.x1 - w.x0, dz = w.z1 - w.z0; var L = Math.hypot(dx,dz) || 0;
    var cx = (w.x0 + w.x1)/2, cz = (w.z0 + w.z1)/2; var rot = (Math.atan2(dz, dx) * 180/Math.PI) || 0;
    pushBox({x:cx, z:cz, width:L, depth:(w.thickness||0.3), rotation:rot}, 0, (w.height||3.0), 'wallstrip');
  });
  if (stairsComponent) pushBox(stairsComponent, 0, stairsComponent.height, 'stairs');
  pergolaComponents.forEach(function(p){ pushBox(p,0,p.totalHeight,'pergola'); });
  garageComponents.forEach(function(g){ pushBox(g,0,g.height,'garage'); });
  poolComponents.forEach(function(p){ pushBox({x:p.x,z:p.z,width:p.width,depth:p.depth,rotation:p.rotation||0}, -p.height, 0, 'pool'); });
  roofComponents.forEach(function(r){ pushBox({x:r.x,z:r.z,width:r.width,depth:r.depth,rotation:r.rotation||0}, r.baseHeight, r.baseHeight + r.height, 'roof'); });
  balconyComponents.forEach(function(b){ var y0=b.level*3.5, y1=y0+b.height; pushBox(b,y0,y1,'balcony'); });
  furnitureItems.forEach(function(f){ var y0=(f.level||0)*3.5, y1=y0+(f.height||0.7); pushBox(f,y0,y1,'furniture_'+(f.name||'')); });
  var blob = new Blob([lines.join('\n')], {type: 'text/plain'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gablok-export.obj';
  a.click();
  URL.revokeObjectURL(a.href);
  updateStatus('Exported OBJ');
}

// Import OBJ produced by exportOBJ: rebuild boxes by group from 8 vertices
function importOBJ(text) {
  try {
    var lines = text.split(/\r?\n/);
    var groups = [];
    var current = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line[0] === '#') continue;
      if (line.startsWith('g ')) {
        // finalize previous if had vertices
        if (current && current.verts.length >= 8) groups.push(current);
        current = { tag: line.substring(2).trim(), verts: [] };
      } else if (line.startsWith('v ')) {
        if (!current) { current = { tag: '', verts: [] }; }
        var parts = line.split(/\s+/);
        var x = parseFloat(parts[1]), y = parseFloat(parts[2]), z = parseFloat(parts[3]);
        if (isFinite(x) && isFinite(y) && isFinite(z)) current.verts.push({x:x,y:y,z:z});
      }
      // ignore faces and others
    }
    if (current && current.verts.length >= 8) groups.push(current);

    var created = 0;
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      var vs = g.verts;
      // compute bbox
      var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
      for (var vi=0; vi<vs.length; vi++) {
        var v = vs[vi];
        if (v.x<minX) minX=v.x; if (v.x>maxX) maxX=v.x;
        if (v.y<minY) minY=v.y; if (v.y>maxY) maxY=v.y;
        if (v.z<minZ) minZ=v.z; if (v.z>maxZ) maxZ=v.z;
      }
      if (!isFinite(minX) || !isFinite(minY) || !isFinite(minZ)) continue;
      var cx = (minX+maxX)/2;
      var cz = (minZ+maxZ)/2;
      var width = Math.max(0.1, maxX-minX);
      var depth = Math.max(0.1, maxZ-minZ);
      var height = Math.max(0.1, maxY-minY);
      var level = Math.max(0, Math.round(minY/3.5));
      var tag = (g.tag||'').toLowerCase();
      function addRoom(name) {
        var room = createRoom(cx, cz, level);
        room.width = width; room.depth = depth; room.height = height; room.name = name || room.name;
        allRooms.push(room);
      }
      if (tag.startsWith('room')) {
        addRoom('Imported ' + (g.tag || 'Room'));
        created++;
      } else if (tag.indexOf('garage') !== -1) {
        var garage = { id: 'garage_'+Date.now()+Math.random().toString(36).slice(2), x: cx, z: cz, width: width, depth: depth, height: height, name: 'Imported Garage', type: 'garage', rotation: 0 };
        garageComponents.push(garage); created++;
      } else if (tag.indexOf('pergola') !== -1) {
        var pergola = { id: 'pergola_'+Date.now()+Math.random().toString(36).slice(2), x: cx, z: cz, width: width, depth: depth, height: height, totalHeight: height, legWidth: 0.3, slatCount: 8, slatWidth: 0.15, name: 'Imported Pergola', type: 'pergola', rotation: 0 };
        pergolaComponents.push(pergola); created++;
      } else if (tag.indexOf('pool') !== -1) {
        var pool = { id: 'pool_'+Date.now()+Math.random().toString(36).slice(2), x: cx, z: cz, width: width, depth: depth, height: height, name: 'Imported Pool', type: 'pool', rotation: 0 };
        poolComponents.push(pool); created++;
      } else if (tag.indexOf('stairs') !== -1) {
        stairsComponent = { id: 'stairs_'+Date.now(), x: cx, z: cz, width: width, depth: depth, height: height, steps: Math.max(3, Math.round(height/0.25)), name: 'Imported Stairs', type: 'stairs', rotation: 0 };
        created++;
      } else if (tag.indexOf('roof') !== -1) {
        var roof = { id: 'roof_'+Date.now()+Math.random().toString(36).slice(2), x: cx, z: cz, width: width, depth: depth, baseHeight: minY, height: height, name: 'Imported Roof', type: 'roof', roofType: 'flat', rotation: 0 };
        roofComponents.push(roof); created++;
      } else if (tag.indexOf('balcony') !== -1) {
        var balcony = { id: 'balcony_'+Date.now()+Math.random().toString(36).slice(2), x: cx, z: cz, width: width, depth: depth, height: height, level: level, totalHeight: height, wallThickness: 0.2, wallHeight: Math.min(1.2, height), name: 'Imported Balcony', type: 'balcony', rotation: 0 };
        balconyComponents.push(balcony); created++;
      } else if (tag.indexOf('furniture') !== -1) {
        var furn = { id: 'furn_'+Date.now()+Math.random().toString(36).slice(2), x: cx, z: cz, width: width, depth: depth, height: height, level: level, name: 'Imported Furniture', type: 'furniture', rotation: 0 };
        furnitureItems.push(furn); created++;
      } else {
        // default to a room on inferred level
        addRoom('Imported Room'); created++;
      }
    }
    if (created > 0) {
      selectedRoomId = null;
      saveProjectSilently();
      renderLoop();
      updateStatus('Imported ' + created + ' object(s) from OBJ');
    } else {
      updateStatus('No importable objects found in OBJ');
    }
  } catch (e) {
    console.error('OBJ import failed', e);
    updateStatus('OBJ import failed');
  }
}

async function exportPDF() {
  try {
    // Ensure jsPDF is available (lazy-load if necessary)
    if (!(window.jspdf && window.jspdf.jsPDF)) {
      var ok = await ensureJsPdfReady();
      if (!ok) { updateStatus('PDF export not available'); return; }
    }
    var { jsPDF } = window.jspdf || {};
    var pdf = new jsPDF({ unit: 'px', format: 'a4' });
    var views = 20;
    var yaw0 = camera.yaw;
    for (var i=0;i<views;i++) {
      camera.yaw = yaw0 + (i * 2*Math.PI / views);
      // Render a frame and wait a tick for canvas to update
      await new Promise(requestAnimationFrame);
      var dataURL = canvas.toDataURL('image/png');
      if (i>0) pdf.addPage();
      pdf.addImage(dataURL, 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
    }
    camera.yaw = yaw0;
    pdf.save('gablok-views.pdf');
    updateStatus('Exported PDF');
  } catch (e) {
    console.error(e); updateStatus('Export PDF failed');
  }
}

// Wire buttons
document.addEventListener('DOMContentLoaded', function(){
  // Force dropdown styles at runtime (fallback for environments that ignore CSS)
  try {
    function forceSelectStyle(sel){
      if(!sel) return;
      sel.style.backgroundColor = '#ffffff';
      sel.style.color = '#000000';
      sel.style.border = '1px solid #ccc';
      sel.style.borderRadius = '6px';
    }
    Array.prototype.forEach.call(document.querySelectorAll('select'), forceSelectStyle);
    var mo = new MutationObserver(function(muts){
      muts.forEach(function(m){
        if(m.type === 'childList'){
          Array.prototype.forEach.call(m.addedNodes || [], function(n){
            if(n && n.nodeType===1){
              if(n.tagName === 'SELECT') forceSelectStyle(n);
              Array.prototype.forEach.call(n.querySelectorAll ? n.querySelectorAll('select') : [], forceSelectStyle);
            }
          });
        }
      });
    });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  } catch(e) { /* non-fatal */ }

  var bSave = document.getElementById('save-project'); if (bSave) bSave.onclick = saveProject;
  var bLoad = document.getElementById('load-project'); if (bLoad) bLoad.onclick = loadProject;
  var bObj = document.getElementById('export-obj'); if (bObj) bObj.onclick = exportOBJ;
  var bPdf = document.getElementById('export-pdf'); if (bPdf) bPdf.onclick = exportPDF;
  var bDl = document.getElementById('download-json'); if (bDl) bDl.onclick = function(){
    var blob = new Blob([serializeProject()], {type:'application/json'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gablok-project.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  var bUp = document.getElementById('upload-json'); if (bUp) bUp.onclick = function(){ document.getElementById('upload-file').click(); };
  var fileInput = document.getElementById('upload-file'); if (fileInput) fileInput.onchange = function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function(){ restoreProject(reader.result); updateStatus('Project loaded from file'); };
    reader.readAsText(f);
  };

  // Custom Actions Dropdown wiring
  (function(){
    var dd = document.getElementById('actionsDropdown');
    var btn = document.getElementById('actionsButton');
    var list = document.getElementById('actionsList');
    function toggle(open){ if(!dd) return; dd.classList[open? 'add':'remove']('open'); }
    function closeAll(){ toggle(false); }
    function doAction(name){
      switch(name){
        case 'info': showInfo(); break;
        case 'share': showShare(); break;
        case 'obj': exportOBJ(); break;
        case 'pdf': exportPDF(); break;
        case 'pdf-floorplan-upload':
          ensurePdfJsReady().then(function(ok){ if(!ok) return; var fpf=document.getElementById('upload-pdf-floorplan'); if(fpf) fpf.click(); });
          break;
        case 'svg-floorplan-upload': { var svgIn=document.getElementById('upload-svg-floorplan'); if(svgIn) svgIn.click(); } break;
        case 'obj-upload': { var foi=document.getElementById('upload-obj-file'); if(foi) foi.click(); } break;
        case 'json-download': {
          var blob = new Blob([serializeProject()], {type:'application/json'});
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gablok-project.json'; a.click(); URL.revokeObjectURL(a.href);
          break;
        }
        case 'json-upload': { var fi=document.getElementById('upload-file'); if(fi) fi.click(); } break;
      }
    }
    if(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); toggle(!dd.classList.contains('open')); }); }
    if(list){ list.addEventListener('click', function(e){
      var t = e.target.closest('.dropdown-item');
      if(!t || t.classList.contains('disabled') || t.classList.contains('separator')) return;
      var action = t.getAttribute('data-action');
      if(action) doAction(action);
      closeAll();
    }); }
    document.addEventListener('click', function(){ closeAll(); });
    document.addEventListener('keydown', function(ev){ if(ev.key==='Escape') closeAll(); });
  })();

  // Wire OBJ upload file input
  var uploadObjInput = document.getElementById('upload-obj-file');
  if (uploadObjInput) uploadObjInput.onchange = function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function(){
      importOBJ(reader.result);
    };
    reader.readAsText(f);
  };

  // Wire Floorplan PDF upload
  var uploadPdfFloorplan = document.getElementById('upload-pdf-floorplan');
  if (uploadPdfFloorplan) uploadPdfFloorplan.onchange = async function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (!window.pdfjsLib) {
      var ok = await ensurePdfJsReady();
      if (!ok) { updateStatus('PDF Import not available'); return; }
    }
    try {
      var arrayBuf = await f.arrayBuffer();
      var loadingTask = window.pdfjsLib.getDocument({ data: arrayBuf });
      var pdf = await loadingTask.promise;
      var page = await pdf.getPage(1);
      openFloorplanModal({ pdf: pdf, page: page, fileName: f.name });
    } catch (err) {
      console.error('PDF load failed', err); updateStatus('Failed to load PDF');
    } finally {
      // reset the input so selecting the same file again will trigger change
      uploadPdfFloorplan.value = '';
    }
  };

  // Populate palette items
  setupPalette();

  // Wire SVG floorplan upload input
  var uploadSvg = document.getElementById('upload-svg-floorplan');
  if (uploadSvg) uploadSvg.onchange = async function(e){
    var f = e.target.files && e.target.files[0]; if(!f) return; try {
      var text = await f.text();
      importSVGFloorplan(text, f.name || 'floorplan.svg');
    } catch(err){ console.error('SVG load failed', err); updateStatus('Failed to load SVG'); }
    finally { uploadSvg.value=''; }
  };

  // Floor Plan 2D button
  var fp2dBtn = document.getElementById('btn-floorplan'); if (fp2dBtn) fp2dBtn.onclick = openPlan2DModal;

  // Custom Level Dropdown wiring
  (function(){
    var dd = document.getElementById('levelDropdown');
    var btn = document.getElementById('levelButton');
    var btnText = document.getElementById('levelButtonText');
    var list = document.getElementById('levelList');
    var nativeSel = document.getElementById('levelSelect');
    function close(){ if(dd) dd.classList.remove('open'); }
    function open(){ if(dd) dd.classList.add('open'); }
    function setLabelFromValue(v){
      var map = { '0':'Ground Floor', '1':'First Floor', 'stairs':'+ Stairs', 'pergola':'+ Pergola', 'garage':'+ Garage', 'roof':'+ Roof', 'pool':'+ Pool', 'balcony':'+ Balcony' };
      if(btnText) btnText.textContent = map[String(v)] || 'Level';
    }
    if(btn){ btn.addEventListener('click', function(e){ e.stopPropagation(); if(dd.classList.contains('open')) close(); else open(); }); }
    if(list){ list.addEventListener('click', function(e){ var item=e.target.closest('.dropdown-item'); if(!item || item.classList.contains('separator')) return; var val=item.getAttribute('data-value'); if(nativeSel){ nativeSel.value = val; } setLabelFromValue(val); if(typeof switchLevel==='function') switchLevel(); close(); }); }
    document.addEventListener('click', close);
    document.addEventListener('keydown', function(ev){ if(ev.key==='Escape') close(); });
    // Initialize label from current state
    if(nativeSel){ setLabelFromValue(nativeSel.value || '0'); }
  })();

  // Floorplan modal: floor toggle wiring
  (function(){
    function setActive(btnGround, btnFirst){
      if(!btnGround || !btnFirst) return;
      try {
        var cur = (typeof currentFloor==='number'? currentFloor : 0);
        if(cur===0){ btnGround.classList.add('active'); btnFirst.classList.remove('active'); }
        else { btnFirst.classList.add('active'); btnGround.classList.remove('active'); }
      } catch(e) {}
    }
    function doSwitch(toFloor){
      try {
        var nativeSel = document.getElementById('levelSelect');
        if(nativeSel){ nativeSel.value = String(toFloor); }
        if(typeof switchLevel==='function') switchLevel();
        // When switching floors, refresh 2D contents if modal is open
        if(__plan2d && __plan2d.active){ try { populatePlan2DFromDesign(); plan2dDraw(); updatePlan2DInfo(); } catch(e){} }
      } catch(e){}
    }
    var bG = document.getElementById('plan2d-floor-ground');
    var bF = document.getElementById('plan2d-floor-first');
    if(bG){ bG.addEventListener('click', function(){ doSwitch(0); setActive(bG,bF); }); }
    if(bF){ bF.addEventListener('click', function(){ doSwitch(1); setActive(bG,bF); }); }
    // Initialize state when DOM ready
    setActive(bG,bF);
  })();
});

// ---------------- Floorplan Import (SVG) ----------------
// Basic heuristic: extract <rect> and top-level <path> elements, compute bounding boxes in SVG user units, map to meters.
// Assumes SVG units ~ meters OR attempts scale by guessing if overall extent > 200 then divide by 100 (treat cm) etc.
function importSVGFloorplan(svgText, fileName){
  try {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    // Parser error detection (browser inserts <parsererror>)
    if (doc.getElementsByTagName('parsererror').length>0) { updateStatus('SVG parser error'); return; }
    var svg = doc.documentElement;
    if(!svg || svg.tagName.toLowerCase()!=='svg'){ updateStatus('Invalid SVG root'); return; }

    // Clone entire SVG into hidden DOM so getBBox() honors transforms
    var container = document.createElement('div'); container.style.cssText='position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
    var cloneRoot = svg.cloneNode(true);
    container.appendChild(cloneRoot); document.body.appendChild(container);

    // Extract viewBox & physical size for unit scaling
    var vbAttr = cloneRoot.getAttribute('viewBox');
    var vb = null; if(vbAttr){ var parts = vbAttr.trim().split(/[,\s]+/).map(parseFloat); if(parts.length===4 && parts.every(function(v){return !isNaN(v);})){ vb = {minX:parts[0],minY:parts[1],w:parts[2],h:parts[3]}; } }
    function parseSize(attr){ if(!attr) return null; var m=String(attr).trim().match(/([0-9.]+)([a-z%]*)/i); if(!m) return null; var v=parseFloat(m[1]); var unit=(m[2]||'').toLowerCase(); if(isNaN(v)) return null; var mult=1; switch(unit){ case 'mm': mult=0.001; break; case 'cm': mult=0.01; break; case 'm': mult=1; break; case 'in': mult=0.0254; break; case 'ft': mult=0.3048; break; case 'px': default: mult=1; } return {meters:v*mult, raw:v, unit:unit||'px'}; }
    var widthInfo = parseSize(cloneRoot.getAttribute('width'));
    var heightInfo = parseSize(cloneRoot.getAttribute('height'));
    var coordWidth = vb? vb.w : (widthInfo? widthInfo.raw : null);
    var scaleGuess = 1; // default: 1 svg unit -> 1 meter
    if (vb && widthInfo && widthInfo.unit!=='px'){ // derive scale from physical width vs viewBox width
      if (coordWidth && coordWidth>0) scaleGuess = widthInfo.meters / coordWidth;
    }
    // Heuristic fallback if still huge
    if (scaleGuess===1 && vb){ var maxSpan = Math.max(vb.w, vb.h); if(maxSpan>500){ scaleGuess=0.01; } else if (maxSpan>100){ scaleGuess=0.1; } }

    // Collect geometry elements
    var rects = Array.from(cloneRoot.querySelectorAll('rect'));
    var paths = Array.from(cloneRoot.querySelectorAll('path'));
    var polys = Array.from(cloneRoot.querySelectorAll('polygon,polyline'));
    var boxes = [];

    function pushBox(bb){ if(!bb) return; if(!(bb.width>0 && bb.height>0)) return; if(bb.width<0.2 && bb.height<0.2) return; if(bb.width*bb.height>2e6) return; boxes.push({x:bb.x,y:bb.y,w:bb.width,h:bb.height}); }

    rects.forEach(function(r){ try { pushBox(r.getBBox()); } catch(e){} });
    polys.forEach(function(p){ try { pushBox(p.getBBox()); } catch(e){} });
    // Limit path processing to avoid huge CPU for icon-heavy files
    for (var i=0;i<paths.length && i<500;i++){ try { pushBox(paths[i].getBBox()); } catch(e){} }

    if(boxes.length===0){ updateStatus('No shapes in SVG'); document.body.removeChild(container); return; }

    // Compute combined extents
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    boxes.forEach(function(b){ if(b.x<minX)minX=b.x; if(b.y<minY)minY=b.y; if(b.x+b.w>maxX)maxX=b.x+b.w; if(b.y+b.h>maxY)maxY=b.y+b.h; });
    var spanX = maxX-minX, spanY=maxY-minY;
    if(!isFinite(spanX) || !isFinite(spanY) || spanX<=0 || spanY<=0){ updateStatus('SVG bounds invalid'); document.body.removeChild(container); return; }

    var roomsCreated=0;
    var cxWorld = camera.targetX;
    var czWorld = camera.targetZ;
    boxes.forEach(function(b){
      var rw = b.w * scaleGuess;
      var rd = b.h * scaleGuess;
      if(rw<0.5 || rd<0.5) return; // skip tiny
      var cx = ((b.x + b.w/2) - (minX + spanX/2)) * scaleGuess + cxWorld;
      var cz = ((b.y + b.h/2) - (minY + spanY/2)) * scaleGuess + czWorld;
      var room = addRoom('SVG'); room.width=rw; room.depth=rd; room.x=cx; room.z=cz; roomsCreated++;
    });

    document.body.removeChild(container);
    if(roomsCreated>0){ saveProjectSilently(); renderLoop(); updateStatus('SVG imported '+roomsCreated+' room'+(roomsCreated!==1?'s':'')); }
    else updateStatus('SVG import created 0 rooms');
  } catch(err){ console.error('SVG parse error', err); updateStatus('SVG parse failed'); }
}

// (Removed duplicate Share modal functions; canonical versions are defined earlier around UI controls.)

// ---------------- Floorplan Import (PDF) ----------------
// Lazy loader for PDF.js in case CDN script hasn't arrived yet
var PDFJS_VERSION = '4.5.136';
function loadScript(url){
  return new Promise(function(resolve, reject){
    try {
      var s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = function(){ resolve(true); };
      s.onerror = function(){ reject(new Error('Failed to load '+url)); };
      document.head.appendChild(s);
    } catch (e) { reject(e); }
  });
}
async function ensurePdfJsReady(){
  if (window.pdfjsLib) return true;
  try { updateStatus('Loading PDF engine…'); } catch(e){}
  // Prefer local vendored files first, then CDNs (including a stable v3 path)
  var sources = [
    'vendor/pdfjs/pdf.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_VERSION+'/build/pdf.min.js',
    'https://unpkg.com/pdfjs-dist@'+PDFJS_VERSION+'/build/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
  ];
  for (var i=0;i<sources.length;i++){
    try {
      await loadScript(sources[i]);
      if (window.pdfjsLib) {
        // Set worker to matching CDN if possible
        try {
          var base = sources[i].replace(/pdf\.min\.js$/, '');
          var worker = base + 'pdf.worker.min.js';
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
        } catch(e){}
        try { updateStatus('PDF engine ready'); } catch(e){}
        return true;
      }
    } catch (e) {
      // try next source
    }
  }
  try { updateStatus('PDF Import not available (offline or blocked)'); } catch(e){}
  return false;
}

// Lazy loader for jsPDF to avoid loading on initial page view
async function ensureJsPdfReady(){
  if (window.jspdf && window.jspdf.jsPDF) return true;
  try { if (typeof updateStatus === 'function') updateStatus('Loading PDF export…'); } catch(e){}
  var sources = [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
  ];
  for (var i=0;i<sources.length;i++){
    try {
      await loadScript(sources[i]);
      if (window.jspdf && window.jspdf.jsPDF) { try { updateStatus('PDF export ready'); } catch(e){} return true; }
    } catch(e) { /* try next */ }
  }
  try { updateStatus('Failed to load PDF export'); } catch(e){}
  return false;
}
var __fp = {
  active: false,
  pdf: null,
  page: null,
  pageNum: 1,
  pageCount: 1,
  pageBitmap: null,
  viewport: null,
  pxPerMeter: null,
  mode: 'calibrate', // 'calibrate' | 'place'
  clicks: [], // last clicks for calibration: [{x,y}, {x,y}]
  rooms: [], // {x0,y0,x1,y1} in overlay canvas pixels
  dragging: false,
  dragStart: null,
  anchorWorld: null, // {x,z} world anchor
  hintText: '',
  hintUntil: 0,
  autoDetected: false
};

function openFloorplanModal(opts){
  var m = document.getElementById('floorplan-modal'); if (!m) return;
  m.style.display = 'flex';
  __fp.active = true;
  __fp.pdf = opts.pdf || null;
  __fp.page = opts.page || null;
  __fp.pageNum = 1;
  __fp.pageCount = (__fp.pdf && __fp.pdf.numPages) ? __fp.pdf.numPages : 1;
  __fp.pageBitmap = null;
  __fp.viewport = null;
  __fp.pxPerMeter = null;
  __fp.mode = 'calibrate';
  __fp.clicks = [];
  __fp.rooms = [];
  __fp.dragging = false;
  __fp.dragStart = null;
  __fp.anchorWorld = { x: camera.targetX, z: camera.targetZ };
  // Enable pointer events on overlay for interaction
  var ov = document.getElementById('floorplan-overlay'); if (ov) ov.style.pointerEvents = 'auto';
  // Wire buttons
  wireFloorplanUI();
  // Render first page
  renderFloorplanPage();
  updateFpInfo();
}

function closeFloorplanModal(){
  var m = document.getElementById('floorplan-modal'); if (m) m.style.display = 'none';
  __fp.active = false;
  // remove listeners if any
  unbindFloorplanUI();
}

async function renderFloorplanPage(){
  try {
    var c = document.getElementById('floorplan-canvas'); if (!c) return;
    var ov = document.getElementById('floorplan-overlay'); if (!ov) return;
    // Match canvas size to container css pixels with DPR for quality
    var container = c.parentElement;
    var rect = container.getBoundingClientRect();
    var ratio = Math.min(2, window.devicePixelRatio || 1);
    var cssW = Math.max(400, Math.floor(rect.width));
    var cssH = Math.max(300, Math.floor(rect.height));
    function sizeCanvas(cv){
      var targetW = Math.floor(cssW * ratio), targetH = Math.floor(cssH * ratio);
      if (cv.width !== targetW || cv.height !== targetH) { cv.width = targetW; cv.height = targetH; cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; }
    }
    sizeCanvas(c); sizeCanvas(ov);
    var ctx2d = c.getContext('2d');
    ctx2d.setTransform(1,0,0,1,0,0);
    ctx2d.clearRect(0,0,c.width,c.height);
    // If we have a PDF page, render it to an offscreen then fit into c
    if (__fp.page) {
      // Render at a scale that keeps memory modest
      var vp = __fp.page.getViewport({ scale: 1.5 });
      __fp.viewport = vp;
      var off = document.createElement('canvas'); off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
      var octx = off.getContext('2d');
      await __fp.page.render({ canvasContext: octx, viewport: vp }).promise;
      // draw fitted into visible canvas (account for DPR by drawing at device pixels)
      var scaleFit = Math.min(c.width / off.width, c.height / off.height);
      var drawW = Math.floor(off.width * scaleFit), drawH = Math.floor(off.height * scaleFit);
      var dx = Math.floor((c.width - drawW) / 2), dy = Math.floor((c.height - drawH) / 2);
      ctx2d.drawImage(off, 0, 0, off.width, off.height, dx, dy, drawW, drawH);
      // Save fitted transform metadata
      __fp.pageBitmap = { img: off, dx: dx, dy: dy, dw: drawW, dh: drawH };
    } else {
      // No page, fill bg
      ctx2d.fillStyle = '#0b1020'; ctx2d.fillRect(0,0,c.width,c.height);
    }
    drawFloorplanOverlay();
    // Update page UI
    var totalSpan = document.getElementById('fp-page-total'); if (totalSpan) totalSpan.textContent = String(__fp.pageCount || 1);
    var input = document.getElementById('fp-page-input'); if (input) input.value = String(__fp.pageNum || 1);
  } catch (e) {
    console.error('renderFloorplanPage error', e);
  }
}

function canvasToImageCoords(px, py){
  // Map overlay canvas pixel to PDF image pixel coordinates (in the offscreen image space)
  var c = document.getElementById('floorplan-canvas'); if (!c || !__fp.pageBitmap) return { ix: px, iy: py };
  var bm = __fp.pageBitmap;
  // The visible canvas draws the offscreen image inside rect [dx,dy, dw,dh] within [0, c.width/c.height] (device pixels)
  var x = (px - bm.dx) * (bm.img.width / Math.max(1, bm.dw));
  var y = (py - bm.dy) * (bm.img.height / Math.max(1, bm.dh));
  return { ix: x, iy: y };
}

function imageToCanvasCoords(ix, iy){
  var c = document.getElementById('floorplan-canvas'); if (!c || !__fp.pageBitmap) return { x: ix, y: iy };
  var bm = __fp.pageBitmap;
  var x = bm.dx + (ix * (bm.dw / Math.max(1, bm.img.width)));
  var y = bm.dy + (iy * (bm.dh / Math.max(1, bm.img.height)));
  return { x: x, y: y };
}

function drawFloorplanOverlay(){
  var ov = document.getElementById('floorplan-overlay'); if (!ov) return; var cx = ov.getContext('2d');
  // Clear and scale to device pixels
  cx.setTransform(1,0,0,1,0,0);
  cx.clearRect(0,0,ov.width, ov.height);
  // Draw calibration clicks
  if (__fp.clicks.length > 0) {
    cx.strokeStyle = '#16a34a'; cx.fillStyle = '#16a34a'; cx.lineWidth = 2;
    for (var i=0;i<__fp.clicks.length;i++) {
      var p = __fp.clicks[i];
      cx.beginPath(); cx.arc(p.x, p.y, 6, 0, Math.PI*2); cx.fill();
    }
    if (__fp.clicks.length >= 2) {
      cx.beginPath(); cx.moveTo(__fp.clicks[0].x, __fp.clicks[0].y); cx.lineTo(__fp.clicks[1].x, __fp.clicks[1].y); cx.stroke();
    }
  }
  // Draw placed rooms
  cx.strokeStyle = '#3b82f6'; cx.lineWidth = 2; cx.fillStyle = 'rgba(59,130,246,0.12)';
  for (var r=0;r<__fp.rooms.length;r++){
    var rm = __fp.rooms[r]; var x0 = Math.min(rm.x0, rm.x1), y0 = Math.min(rm.y0, rm.y1), x1 = Math.max(rm.x0, rm.x1), y1 = Math.max(rm.y0, rm.y1);
    if (rm.auto) { cx.save(); cx.setLineDash([5,4]); cx.strokeStyle = '#1d4ed8'; cx.fillStyle = 'rgba(59,130,246,0.07)'; }
    cx.beginPath(); cx.rect(x0, y0, x1-x0, y1-y0); cx.fill(); cx.stroke(); if (rm.auto) cx.restore();
    // Show size if scale known
    if (__fp.pxPerMeter) {
      var w = (x1-x0) / __fp.pxPerMeter; var d = (y1-y0) / __fp.pxPerMeter;
      var label = w.toFixed(2)+'m × '+d.toFixed(2)+'m';
      cx.fillStyle = '#111827'; cx.font = 'bold 14px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(label, (x0+x1)/2, (y0+y1)/2);
      cx.fillStyle = 'rgba(59,130,246,0.12)'; // restore
    }
  }
  // Dragging preview
  if (__fp.dragging && __fp.dragStart) {
    var cur = __fp.__lastMouse;
    if (cur) {
      var x0 = __fp.dragStart.x, y0 = __fp.dragStart.y, x1 = cur.x, y1 = cur.y;
      cx.setLineDash([6,4]); cx.strokeStyle = '#2563eb'; cx.lineWidth = 1.5; cx.beginPath(); cx.rect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(x1-x0), Math.abs(y1-y0)); cx.stroke(); cx.setLineDash([]);
    }
  }
  // Hint overlay
  var now = Date.now();
  if (__fp.hintText && __fp.hintUntil > now) {
    cx.save();
    var pad = 10; cx.font = 'bold 14px system-ui, sans-serif';
    var text = __fp.hintText; var tw = cx.measureText(text).width; var tx = Math.floor((ov.width - tw) / 2) - pad; var ty = 16;
    cx.fillStyle = 'rgba(0,0,0,0.65)'; cx.fillRect(tx, ty, tw + pad*2, 28);
    cx.fillStyle = '#ffffff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(text, tx + tw/2 + pad, ty + 14);
    cx.restore();
  }
}

function wireFloorplanUI(){
  // Buttons
  var bClose = document.getElementById('floorplan-close'); if (bClose) bClose.onclick = closeFloorplanModal;
  var bCancel = document.getElementById('fp-cancel'); if (bCancel) bCancel.onclick = closeFloorplanModal;
  var back = document.getElementById('floorplan-backdrop'); if (back) back.onclick = closeFloorplanModal;
  var bCal = document.getElementById('fp-mode-calibrate'); if (bCal) bCal.onclick = function(){ __fp.mode = 'calibrate'; updateFloorplanCursor(); showFpHint('Click two points a known distance apart, enter it, then Apply.', 2800); drawFloorplanOverlay(); };
  var bPlace = document.getElementById('fp-mode-place'); if (bPlace) bPlace.onclick = function(){ __fp.mode = 'place'; updateFloorplanCursor(); showFpHint('Drag on the plan to draw room rectangles', 2200); drawFloorplanOverlay(); };
  var bUndo = document.getElementById('fp-undo'); if (bUndo) bUndo.onclick = function(){ if (__fp.rooms.length>0) { __fp.rooms.pop(); drawFloorplanOverlay(); updateFpInfo(); } };
  var bApply = document.getElementById('fp-apply-scale'); if (bApply) bApply.onclick = function(){ applyCalibration(); };
  var bCommit = document.getElementById('fp-commit'); if (bCommit) bCommit.onclick = function(){ commitFloorplanRooms(); };
  var bRefine = document.getElementById('fp-refine-detect'); if (bRefine) bRefine.onclick = function(){ if (!__fp.pxPerMeter) { updateStatus('Calibrate first'); return; } __fp.rooms = __fp.rooms.filter(function(r){ return !r.auto; }); __fp.autoDetected = false; autoDetectGroundFloor(true); };
  // Page controls
  var inPage = document.getElementById('fp-page-input'); if (inPage) inPage.onchange = function(){ var n = Math.max(1, Math.min(__fp.pageCount||1, parseInt(this.value||'1',10)||1)); goToFloorplanPage(n); };
  var bPrev = document.getElementById('fp-page-prev'); if (bPrev) bPrev.onclick = function(){ if (__fp.pageNum>1) goToFloorplanPage(__fp.pageNum-1); };
  var bNext = document.getElementById('fp-page-next'); if (bNext) bNext.onclick = function(){ if (__fp.pageNum<(__fp.pageCount||1)) goToFloorplanPage(__fp.pageNum+1); };
  // Canvas interactions
  var ov = document.getElementById('floorplan-overlay');
  var base = document.getElementById('floorplan-canvas');
  function attachCanvasHandlers(cv){
    if (!cv) return;
    function getPos(e){ var rect = cv.getBoundingClientRect(); var ratio = cv.width / Math.max(1, rect.width); return { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio }; }
    var onDown = function(e){
      if (!__fp.active) return; var p = getPos(e); __fp.__lastMouse = p;
      if (__fp.mode === 'calibrate') {
        __fp.clicks.push({ x:p.x, y:p.y }); if (__fp.clicks.length > 2) __fp.clicks.shift();
        drawFloorplanOverlay();
      } else if (__fp.mode === 'place') {
        __fp.dragging = true; __fp.dragStart = p; drawFloorplanOverlay();
      }
      updateFloorplanCursor();
    };
    cv.addEventListener('mousedown', onDown);
    // Store refs for potential cleanup
    cv.__fpOnDown = onDown;
  }
  attachCanvasHandlers(ov);
  attachCanvasHandlers(base);
  // Shared move/up on window to track outside canvas
  window.__fpMouseMove = function(e){
    if (!__fp.active) return;
    // Prefer overlay for coordinate mapping if present, else base
    var cv = ov || base; if (!cv) return;
    var rect = cv.getBoundingClientRect(); var ratio = cv.width / Math.max(1, rect.width);
    var p = { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio };
    __fp.__lastMouse = p;
    if (__fp.dragging) drawFloorplanOverlay();
  };
  window.__fpMouseUp = function(){
    if (!__fp.active) return;
    if (__fp.dragging && __fp.dragStart && __fp.__lastMouse) {
      var s = __fp.dragStart, c = __fp.__lastMouse;
      __fp.rooms.push({ x0:s.x, y0:s.y, x1:c.x, y1:c.y });
      updateFpInfo();
    }
    __fp.dragging = false; __fp.dragStart = null; drawFloorplanOverlay(); updateFloorplanCursor();
  };
  window.addEventListener('mousemove', window.__fpMouseMove);
  window.addEventListener('mouseup', window.__fpMouseUp);
  // Resize handler
  window.__fpResize = function(){ if (!__fp.active) return; renderFloorplanPage(); };
  window.addEventListener('resize', window.__fpResize);
  updateFloorplanCursor();
}

function unbindFloorplanUI(){
  try { if (window.__fpMouseMove) window.removeEventListener('mousemove', window.__fpMouseMove); } catch(e){}
  try { if (window.__fpMouseUp) window.removeEventListener('mouseup', window.__fpMouseUp); } catch(e){}
  try { if (window.__fpResize) window.removeEventListener('resize', window.__fpResize); } catch(e){}
  try {
    var ov = document.getElementById('floorplan-overlay');
    var base = document.getElementById('floorplan-canvas');
    if (ov && ov.__fpOnDown) { ov.removeEventListener('mousedown', ov.__fpOnDown); ov.__fpOnDown = null; }
    if (base && base.__fpOnDown) { base.removeEventListener('mousedown', base.__fpOnDown); base.__fpOnDown = null; }
  } catch(e){}
}

function applyCalibration(){
  if (__fp.clicks.length < 2) { updateStatus('Pick two points for calibration'); return; }
  var a = __fp.clicks[0], b = __fp.clicks[1];
  var dx = b.x - a.x, dy = b.y - a.y; var distPx = Math.sqrt(dx*dx + dy*dy);
  var input = document.getElementById('fp-real-distance'); var real = parseFloat(input && input.value ? input.value : '');
  if (!(real > 0)) { updateStatus('Enter a valid real distance'); return; }
  __fp.pxPerMeter = distPx / real;
  updateFpInfo();
  // Switch to place mode and guide the user
  __fp.mode = 'place';
  showFpHint('Scale set. Drag on the plan to draw room rectangles, then click Commit.', 3500);
  drawFloorplanOverlay();
  updateFloorplanCursor();
  // Attempt automatic ground floor detection (one-time) so the user can commit immediately
  setTimeout(function(){
    try { if (__fp.active && !__fp.autoDetected) { autoDetectGroundFloor(); } } catch(e) { console.warn('Auto floor detect failed', e); }
  }, 30);
}

function updateFpInfo(){
  var scaleSpan = document.getElementById('fp-scale-display'); if (scaleSpan) scaleSpan.textContent = __fp.pxPerMeter ? __fp.pxPerMeter.toFixed(2) : '—';
  var cnt = document.getElementById('fp-rooms-count'); if (cnt) cnt.textContent = (__fp.rooms||[]).length;
}

async function goToFloorplanPage(n){
  if (!__fp.pdf) return;
  try {
    __fp.pageNum = n;
    __fp.page = await __fp.pdf.getPage(n);
    renderFloorplanPage();
    // reset calibration clicks when switching pages (keeps scale value, as it may be a multi-page plan)
    __fp.clicks = [];
    __fp.autoDetected = false;
    drawFloorplanOverlay();
  } catch(e) {
    console.error('Failed to switch PDF page', e);
  }
}

function commitFloorplanRooms(){
  if (!__fp.pxPerMeter) { updateStatus('Calibrate scale first'); return; }
  if (!__fp.rooms || __fp.rooms.length === 0) {
    updateStatus('No rooms to import. Use "Place Room" and drag to draw rectangles over rooms, then Commit.');
    __fp.mode = 'place';
    showFpHint('Drag to draw room rectangles on the plan', 3000);
    drawFloorplanOverlay();
    return;
  }
  var created = 0;
  // Use the first room center as origin for relative placement
  var first = __fp.rooms[0]; var fx = (Math.min(first.x0, first.x1) + Math.max(first.x0, first.x1)) / 2; var fz = (Math.min(first.y0, first.y1) + Math.max(first.y0, first.y1)) / 2;
  var worldOrigin = __fp.anchorWorld || { x: 0, z: 0 };
  for (var i=0;i<__fp.rooms.length;i++){
    var r = __fp.rooms[i];
    var x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    var w = Math.max(0.5, (x1 - x0) / __fp.pxPerMeter);
    var d = Math.max(0.5, (y1 - y0) / __fp.pxPerMeter);
    var cx = (x0 + x1)/2, cz = (y0 + y1)/2;
    var rx = worldOrigin.x + (cx - fx) / __fp.pxPerMeter;
    var rz = worldOrigin.z + (cz - fz) / __fp.pxPerMeter;
    var room = createRoom(rx, rz, 0);
    room.width = parseFloat(w.toFixed(2));
    room.depth = parseFloat(d.toFixed(2));
    room.height = 3;
    room.name = 'Imported ' + (i+1);
    allRooms.push(room); created++;
  }
  saveProjectSilently();
  selectedRoomId = null;
  renderLoop();
  updateStatus('Added ' + created + ' room(s) from floorplan');
  closeFloorplanModal();
}

// Attempt to automatically detect ground floor rectangular rooms from the PDF page bitmap.
// Heuristic approach: analyze a downscaled grayscale image, threshold walls, find large whitespace rectangles.
function autoDetectGroundFloor(manual){
  if (!__fp.pageBitmap || !__fp.pageBitmap.img || !__fp.pxPerMeter) return;
  if (__fp.rooms.length > 0) return; // don't override user work
  var img = __fp.pageBitmap.img;
  try {
    var minInput = document.getElementById('fp-auto-min');
    var arInput = document.getElementById('fp-auto-ar');
    var borderInput = document.getElementById('fp-auto-border');
    var minMeters = Math.max(1, parseFloat(minInput && minInput.value || '2'));
    var maxAspect = Math.max(2, parseFloat(arInput && arInput.value || '8'));
    var minBorderRatio = Math.min(1, Math.max(0, parseFloat(borderInput && borderInput.value || '0.15')));
    var downScale = 0.25; // process at quarter size for speed
    var w = Math.max(20, Math.floor(img.width * downScale));
    var h = Math.max(20, Math.floor(img.height * downScale));
    var can = document.createElement('canvas'); can.width = w; can.height = h; var ctx = can.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0,0,w,h).data;
    // Build occupancy map: wall/ink pixels vs background (assume darker is wall)
    var occ = new Uint8Array(w*h);
    for (var y=0;y<h;y++){
      for (var x=0;x<w;x++){
        var idx = (y*w + x)*4;
        var r=data[idx], g=data[idx+1], b=data[idx+2];
        var lum = 0.299*r + 0.587*g + 0.114*b; // 0..255
        occ[y*w + x] = lum < 200 ? 1 : 0; // treat darker areas as ink
      }
    }
    // Integral image for fast sum queries of ink density
    var integral = new Uint32Array((w+1)*(h+1));
    for (var y2=1;y2<=h;y2++){
      var rowSum=0;
      for (var x2=1;x2<=w;x2++){
        rowSum += occ[(y2-1)*w + (x2-1)];
        integral[y2*(w+1)+x2] = integral[(y2-1)*(w+1)+x2] + rowSum;
      }
    }
    function rectInk(x0,y0,x1,y1){ // inclusive-exclusive coordinates in downscaled space
      return integral[y1*(w+1)+x1] - integral[y0*(w+1)+x1] - integral[y1*(w+1)+x0] + integral[y0*(w+1)+x0];
    }
    var candidates = [];
    // Scan for rectangles larger than minimal size (in meters) and low ink fill inside (rooms interior) with surrounding ink border.
  var maxMeters = 30.0;
    var minPx = minMeters * __fp.pxPerMeter * downScale; // interior size in downscaled px
    var maxPx = maxMeters * __fp.pxPerMeter * downScale;
    // Limit loops for performance by stepping
    var step = Math.max(4, Math.floor(w/120));
    for (var y0=0;y0<h-10;y0+=step){
      for (var x0=0;x0<w-10;x0+=step){
        for (var y1=y0+Math.floor(minPx); y1<h && y1-y0<=maxPx; y1+=step){
          var height = y1 - y0; if (height < minPx) continue;
          for (var x1=x0+Math.floor(minPx); x1<w && x1-x0<=maxPx; x1+=step){
            var width = x1 - x0; if (width < minPx) continue;
            var area = width*height; if (area <= 0) continue;
            var inkInside = rectInk(x0,y0,x1,y1);
            var fillRatio = inkInside / area;
            if (fillRatio < 0.10) { // mostly empty interior
              // Check a rough border having ink (sample perimeter cells)
              var borderHits=0, borderSamples=0;
              for (var xx=x0; xx<x1; xx+=Math.max(1, Math.floor((x1-x0)/8))){
                var top = occ[y0*w+xx]; var bot = occ[(y1-1)*w+xx];
                borderHits += top + bot; borderSamples += 2;
              }
              for (var yy=y0; yy<y1; yy+=Math.max(1, Math.floor((y1-y0)/8))){
                var left = occ[yy*w + x0]; var right = occ[yy*w + (x1-1)];
                borderHits += left + right; borderSamples += 2;
              }
              var borderRatio = borderHits / Math.max(1, borderSamples);
              if (borderRatio > minBorderRatio) {
                candidates.push({ x0:x0, y0:y0, x1:x1, y1:y1, area: area });
              }
            }
          }
        }
      }
    }
    // Sort by area descending, then perform non-overlap selection
    candidates.sort(function(a,b){ return b.area - a.area; });
    var selected = [];
    function overlap(a,b){ return !(a.x1<=b.x0 || b.x1<=a.x0 || a.y1<=b.y0 || b.y1<=a.y0); }
    for (var c=0;c<candidates.length;c++){
      var cand = candidates[c];
      // Filter extremely elongated shapes (aspect ratio > 8) which are probably corridors or artifacts
      var wCand = cand.x1 - cand.x0, hCand = cand.y1 - cand.y0;
      var ar = wCand > hCand ? wCand / Math.max(1,hCand) : hCand / Math.max(1,wCand);
      if (ar > maxAspect) continue;
      var keep = true;
      for (var k=0;k<selected.length;k++){ if (overlap(cand, selected[k])) { keep=false; break; } }
      if (keep) selected.push(cand);
      if (selected.length >= 20) break; // safety cap
    }
    if (selected.length === 0) { console.log('Auto-detect: no candidates'); return; }
    // Map back to overlay canvas coordinates using imageToCanvasCoords
    for (var s=0;s<selected.length;s++){
      var R = selected[s];
      // Convert downscaled rectangle corners to original image coords
      var ix0 = R.x0 / downScale, iy0 = R.y0 / downScale, ix1 = R.x1 / downScale, iy1 = R.y1 / downScale;
      var c0 = imageToCanvasCoords(ix0, iy0); var c1 = imageToCanvasCoords(ix1, iy1);
      __fp.rooms.push({ x0: c0.x, y0: c0.y, x1: c1.x, y1: c1.y, auto:true });
    }
    __fp.autoDetected = true;
    updateFpInfo();
    drawFloorplanOverlay();
    showFpHint('Auto-detected '+selected.length+' room(s). '+(manual?'(Refined) ':'')+'Review & Commit or adjust.', 4000);
  } catch (e) {
    console.warn('autoDetectGroundFloor error', e);
  }
}

// Small helper to show a transient hint overlay in the floorplan modal
function showFpHint(msg, durationMs){
  __fp.hintText = String(msg || '');
  __fp.hintUntil = Date.now() + Math.max(500, durationMs || 2000);
  drawFloorplanOverlay();
}

// Update cursor style in floorplan canvases based on current mode/drag state
function updateFloorplanCursor(){
  var ov = document.getElementById('floorplan-overlay');
  var base = document.getElementById('floorplan-canvas');
  var cur = 'default';
  if (__fp.active) {
    if (__fp.mode === 'calibrate') cur = 'crosshair';
    else if (__fp.mode === 'place') cur = __fp.dragging ? 'crosshair' : 'crosshair';
  }
  if (ov) ov.style.cursor = cur;
  if (base) base.style.cursor = cur;
}

// ---------- Room Palette ----------
// Catalog with rough real-world dimensions (meters) and a simple type tag for thumbnail rendering
// Width (X), Depth (Z), Height (Y) are approximate; adjust as needed.
var PALETTE_ITEMS = [
  { name: 'Single Bed',           width: 1.1, depth: 2.2, height: 0.6, kind: 'bed',       desc: 'Standard single bed.' },
  { name: 'Double Bed',           width: 1.6, depth: 2.2, height: 0.6, kind: 'bed',       desc: 'Comfortable double bed.' },
  { name: 'Queen Bed',            width: 1.8, depth: 2.2, height: 0.6, kind: 'bed',       desc: 'Popular queen-size bed.' },
  { name: 'King Bed',             width: 2.0, depth: 2.2, height: 0.6, kind: 'bed',       desc: 'Spacious king-size bed.' },
  { name: 'Bath',                 width: 1.0, depth: 1.8, height: 0.6, kind: 'bath',      desc: 'Freestanding bathtub.' },
  { name: 'Shower',               width: 1.1, depth: 1.1, height: 3.0, kind: 'shower',    desc: 'Single shower enclosure.' },
  { name: 'Double Shower',        width: 1.8, depth: 1.1, height: 3.0, kind: 'shower',    desc: 'Double-width shower.' },
  { name: 'Sink',                 width: 0.6, depth: 0.5, height: 0.9, kind: 'sink',      desc: 'Single vanity sink.' },
  { name: 'Double Sink',          width: 1.6, depth: 0.5, height: 0.9, kind: 'sink',      desc: 'Double vanity sink.' },
  { name: 'Bedside Table',        width: 0.5, depth: 0.4, height: 0.5, kind: 'table',     desc: 'Compact bedside table.' },
  { name: 'Kitchen Design 01',    width: 3.0, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Straight-line kitchen run.' },
  { name: 'Kitchen Design 02',    width: 2.4, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Corner kitchen layout.' },
  { name: 'Kitchen Design 03',    width: 3.6, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Large corner kitchen.' },
  { name: 'Kitchen Design 04',    width: 2.8, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Compact kitchen run.' },
  { name: 'Kitchen Design 05',    width: 3.2, depth: 0.7, height: 0.9, kind: 'kitchen',   desc: 'Extended kitchen run.' },
  { name: 'Single Fridge',        width: 0.7, depth: 0.7, height: 1.8, kind: 'fridge',    desc: 'Single-door fridge.' },
  { name: 'Double Fridge',        width: 1.2, depth: 0.8, height: 1.9, kind: 'fridge',    desc: 'Double-door fridge.' },
  { name: '42" TV',               width: 0.95, depth: 0.1, height: 0.6, kind: 'tv',       desc: 'Compact TV for wall or stand.' },
  { name: '72" TV',               width: 1.6,  depth: 0.1, height: 1.0, kind: 'tv',       desc: 'Large 72-inch television.' },
  { name: '84" TV',               width: 1.9,  depth: 0.1, height: 1.1, kind: 'tv',       desc: 'Extra-large 84-inch TV.' },
  { name: '108" TV',              width: 2.4,  depth: 0.1, height: 1.4, kind: 'tv',       desc: 'Home theater scale screen.' },
  { name: 'Sofa 3 seats',         width: 2.0, depth: 0.9, height: 0.9, kind: 'sofa',      desc: 'Three-seat sofa.' },
  { name: 'Sofa 4 seats',         width: 2.4, depth: 0.9, height: 0.9, kind: 'sofa',      desc: 'Four-seat sofa.' },
  { name: 'Sofa 5 seats',         width: 2.8, depth: 0.9, height: 0.9, kind: 'sofa',      desc: 'Five-seat sofa.' },
  { name: 'Sofa 6 seats L',       width: 2.8, depth: 2.0, height: 0.9, kind: 'sofaL',     desc: 'L-shaped sofa (6 seats).' },
  { name: 'Sofa 7 seats L',       width: 3.2, depth: 2.2, height: 0.9, kind: 'sofaL',     desc: 'L-shaped sofa (7 seats).' },
  { name: 'Armchair',             width: 1.0, depth: 1.0, height: 1.1, kind: 'armchair',  desc: 'Single armchair.' },
  { name: 'Dishwasher',           width: 0.7, depth: 0.7, height: 0.90, kind: 'appliance',desc: 'Standard dishwasher.' },
  { name: '4 Seat kitchen table', width: 1.5, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 4.' },
  { name: '6 Seat kitchen table', width: 1.8, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 6.' },
  { name: '8 seat kitchen table', width: 2.3, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 8.' },
  { name: '10 Seat Kitchen table',width: 2.8, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 10.' },
  { name: '4 Seat Dinning table', width: 1.5, depth: 0.8, height: 0.75, kind: 'table',    desc: 'Dining table for 4.' },
  { name: '6 Seat Dinning table', width: 1.8, depth: 0.9, height: 0.75, kind: 'table',    desc: 'Dining table for 6.' },
  { name: '8 seat Dinning table', width: 2.3, depth: 0.9, height: 0.75, kind: 'table',    desc: 'Dining table for 8.' },
  { name: '10 Seat Dinning table',width: 2.9, depth: 1.0, height: 0.75, kind: 'table',    desc: 'Dining table for 10.' },
  { name: 'Bar stool 1-8',        width: 0.45, depth: 0.45, height: 0.75, kind: 'stool',  desc: 'Kitchen bar stool.' }
];

// Temporary preview state for the room palette (items are previewed here before committing)
var __paletteState = {
  yaw: 0.6,         // radians
  pitch: 0.5,       // radians (slightly looking down)
  items: [],        // {width, depth, height, x, z, name, kind}
  draggingIndex: -1,
  lastMouse: null
};

function setupPalette() {
  var list = document.getElementById('palette-list');
  if (!list) return;
  list.innerHTML = '';
  for (var i=0;i<PALETTE_ITEMS.length;i++) {
    var it = PALETTE_ITEMS[i];
    var item = document.createElement('div');
    item.className = 'palette-item';
    var thumb = document.createElement('div'); thumb.className = 'palette-thumb';
    var c = document.createElement('canvas'); c.className = 'palette-thumb-canvas'; c.width = 220; c.height = 168; thumb.appendChild(c);
    item.appendChild(thumb);
  var infoDiv = document.createElement('div');
  var nameDiv = document.createElement('div'); nameDiv.className = 'palette-name'; nameDiv.textContent = it.name;
  var dimsDiv = document.createElement('div'); dimsDiv.className = 'palette-dims';
  dimsDiv.textContent = 'Width: ' + it.width.toFixed(2) + 'm · Depth: ' + it.depth.toFixed(2) + 'm · Height: ' + it.height.toFixed(2) + 'm';
  var descDiv = document.createElement('div'); descDiv.className = 'palette-desc'; descDiv.textContent = it.desc || '';
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(dimsDiv);
  infoDiv.appendChild(descDiv);
    item.appendChild(infoDiv);
    // draw simple 3D-ish wireframe thumbnail to scale
    renderItemThumb(c, it);
    // In preview mode, clicking adds to the palette preview without closing
    (function(def){ item.onclick = function(){ addPalettePreviewItem(def); }; })(it);
    list.appendChild(item);
  }
}

function openRoomPalette(roomId) {
  var modal = document.getElementById('room-palette-modal');
  var title = document.getElementById('room-palette-title');
  if (!modal || !title) return;
  var room = findObjectById(roomId);
  if (!room || room.type === 'roof') return;
  paletteOpenForId = roomId;
  selectedRoomId = roomId;
  title.textContent = room.name || 'Room';
  // Hide roof dropdown while open
  var dd = document.getElementById('roof-type-dropdown'); if (dd) dd.style.display = 'none';
  modal.style.display = 'flex';
  try { console.log('Room Palette opened for', roomId, '->', title.textContent); } catch(e){}
  // Reset preview state and preload existing furniture for this room
  var preload = loadExistingFurniturePreview(room);
  __paletteState = { yaw: 0.6, pitch: 0.5, items: preload, draggingIndex: -1, lastMouse: null };
  renderRoomPreview(room);
  // Keep preview responsive while open
  try {
    if (window.__paletteResizeHandler) window.removeEventListener('resize', window.__paletteResizeHandler);
    window.__paletteResizeHandler = function(){ var r = findObjectById(paletteOpenForId); if (r) renderRoomPreview(r); };
    window.addEventListener('resize', window.__paletteResizeHandler);
  } catch(e){}

  // Wire preview canvas interactions (orbit + drag, no zoom)
  try {
    var cv = document.getElementById('room-preview-canvas');
    if (cv) {
      if (window.__paletteMouseDown) cv.removeEventListener('mousedown', window.__paletteMouseDown);
      if (window.__paletteMouseMove) window.removeEventListener('mousemove', window.__paletteMouseMove);
      if (window.__paletteMouseUp) window.removeEventListener('mouseup', window.__paletteMouseUp);
      if (window.__paletteWheel) cv.removeEventListener('wheel', window.__paletteWheel, { passive: false });

      window.__paletteMouseDown = function(e){
        var rect = cv.getBoundingClientRect();
        var mx = e.clientX - rect.left; var my = e.clientY - rect.top;
        __paletteState.lastMouse = { x: mx, y: my };
        // Hit-test items (prefer top-most)
        var idx = hitTestPaletteItem(mx, my, findObjectById(paletteOpenForId));
        if (idx >= 0) {
          __paletteState.draggingIndex = idx;
          e.preventDefault();
        } else {
          __paletteState.draggingIndex = -1;
          __paletteState.isOrbiting = true;
        }
      };
      cv.addEventListener('mousedown', window.__paletteMouseDown);

      window.__paletteMouseMove = function(e){
        if (!paletteOpenForId) return;
        var room = findObjectById(paletteOpenForId); if (!room) return;
        var rect = cv.getBoundingClientRect();
        var mx = e.clientX - rect.left; var my = e.clientY - rect.top;
        var lm = __paletteState.lastMouse; if (!lm) { __paletteState.lastMouse = {x:mx,y:my}; return; }
        var du = mx - lm.x; var dv = my - lm.y; __paletteState.lastMouse = {x:mx,y:my};
        if (__paletteState.draggingIndex >= 0) {
          // Move item on ground using inverse mapping
          var k = Math.sin(__paletteState.pitch) * 0.5; var yaw = __paletteState.yaw;
          var scaleInfo = getPaletteScaleInfo(room, cv);
          var s = scaleInfo.scale;
          var inv = 1 / Math.max(1e-4, s * Math.max(1e-4, k));
          var cos = Math.cos(yaw), sin = Math.sin(yaw);
          var dxw = inv * (cos * k * du - sin * dv); // simplified from derived inverse
          var dzw = inv * (sin * k * du + cos * dv);
          var it = __paletteState.items[__paletteState.draggingIndex];
          it.x += dxw; it.z += dzw;
          // Clamp inside room footprint
          var maxX = room.width/2 - it.width/2; var maxZ = room.depth/2 - it.depth/2;
          it.x = Math.max(-maxX, Math.min(maxX, it.x));
          it.z = Math.max(-maxZ, Math.min(maxZ, it.z));
          renderRoomPreview(room);
        } else if (__paletteState.isOrbiting) {
          __paletteState.yaw += du * 0.01;
          __paletteState.pitch = Math.max(-1.0, Math.min(1.0, __paletteState.pitch + dv * 0.01));
          renderRoomPreview(room);
        }
      };
      window.addEventListener('mousemove', window.__paletteMouseMove);

      window.__paletteMouseUp = function(){ __paletteState.draggingIndex = -1; __paletteState.isOrbiting = false; };
      window.addEventListener('mouseup', window.__paletteMouseUp);

      window.__paletteWheel = function(e){ e.preventDefault(); };
      cv.addEventListener('wheel', window.__paletteWheel, { passive: false });
    }
  } catch(e){}

  // Wire actions (commit / clear)
  try {
    var commitBtn = document.getElementById('palette-commit');
    if (commitBtn) commitBtn.onclick = function(){ commitPaletteItems(); };
    var clearBtn = document.getElementById('palette-clear');
    if (clearBtn) clearBtn.onclick = function(){ clearPalettePreview(); var r = findObjectById(paletteOpenForId); if (r) renderRoomPreview(r); };
  } catch(e){}
}

function hideRoomPalette() {
  var modal = document.getElementById('room-palette-modal');
  if (modal) modal.style.display = 'none';
  paletteOpenForId = null;
  var dd = document.getElementById('roof-type-dropdown'); if (dd) dd.style.display = 'block';
  try { if (window.__paletteResizeHandler) { window.removeEventListener('resize', window.__paletteResizeHandler); window.__paletteResizeHandler = null; } } catch(e){}
  try {
    var cv = document.getElementById('room-preview-canvas');
    if (cv) {
      if (window.__paletteMouseDown) cv.removeEventListener('mousedown', window.__paletteMouseDown);
      if (window.__paletteWheel) cv.removeEventListener('wheel', window.__paletteWheel);
    }
    if (window.__paletteMouseMove) window.removeEventListener('mousemove', window.__paletteMouseMove);
    if (window.__paletteMouseUp) window.removeEventListener('mouseup', window.__paletteMouseUp);
  } catch(e){}
}

function renderRoomPreview(room) {
  var cv = document.getElementById('room-preview-canvas');
  if (!cv) return; var cx = cv.getContext('2d');
  // Match the canvas buffer to its displayed size with devicePixelRatio for crisp lines
  var rect = cv.getBoundingClientRect();
  var ratio = Math.min(2, window.devicePixelRatio || 1);
  var targetW = Math.max(320, Math.floor(rect.width * ratio));
  var targetH = Math.max(320, Math.floor(rect.height * ratio));
  if (cv.width !== targetW || cv.height !== targetH) {
    cv.width = targetW;
    cv.height = targetH;
  }
  // Draw in CSS pixel coordinates
  cx.setTransform(1,0,0,1,0,0);
  cx.scale(ratio, ratio);
  cx.clearRect(0,0,rect.width,rect.height);
  // Subtle grid (very light) — draw in CSS pixel space (context already scaled by DPR)
  var padG = 20; var step = 30; cx.save(); cx.globalAlpha = 0.45; cx.strokeStyle = '#f5f7fa'; cx.lineWidth = 1;
  for (var gx = padG; gx <= rect.width - padG; gx += step) { cx.beginPath(); cx.moveTo(gx, padG); cx.lineTo(gx, rect.height - padG); cx.stroke(); }
  for (var gy = padG; gy <= rect.height - padG; gy += step) { cx.beginPath(); cx.moveTo(padG, gy); cx.lineTo(rect.width - padG, gy); cx.stroke(); }
  cx.restore();
  // 3D-ish room wireframe box that fits the available space and draws a grey floor
  // Reserve a bit more horizontal padding so there is clear space left and right of the room.
  var padX = 48; // horizontal padding (px)
  var padY = 48; // vertical padding (px) — increased to ensure clear space at bottom
  var availW = rect.width - padX*2; var availH = rect.height - padY*2;
  var rw = room.width, rd = room.depth, ry = room.height;
  var yaw = __paletteState.yaw || 0.6; var pitch = __paletteState.pitch || 0.5;
  var cy = Math.cos(yaw), sy = Math.sin(yaw);
  var cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Compute projected points at unit scale to derive a fitting scale (orthographic-ish)
  function projUV(x,y,z){
    var rx = cy * x + sy * z;
    var rz = -sy * x + cy * z;
    var u = rx;
    var v = -y * cp + rz * sp * 0.5;
    return { u: u, v: v };
  }
  var hw = rw/2, hd = rd/2, ht = ry;
  var ptsUnit = [
    projUV(-hw, 0, -hd), projUV(hw, 0, -hd), projUV(hw, 0, hd), projUV(-hw, 0, hd),
    projUV(-hw, ht, -hd), projUV(hw, ht, -hd), projUV(hw, ht, hd), projUV(-hw, ht, hd)
  ];
  var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (var i=0;i<ptsUnit.length;i++){ var p=ptsUnit[i]; if (p.u<minU)minU=p.u; if(p.u>maxU)maxU=p.u; if(p.v<minV)minV=p.v; if(p.v>maxV)maxV=p.v; }
  var bboxW = (maxU - minU); var bboxH = (maxV - minV);
  var centerU = (minU + maxU) * 0.5; var centerV = (minV + maxV) * 0.5;
  // Width-locked scaling: keep a constant scale based purely on room.width and available width.
  // Recompute only when the canvas width/height (availW) changes to remain responsive.
  var fixed = __paletteState.__fixedScale;
  // Use a width fit fraction so the room renders narrower than the available width to leave clear left/right space
  var widthFitFraction = 0.8; // 80% of available width (after padX), leaves ~10% gap on each side
  if (!fixed || fixed.availW !== availW || fixed.roomWidth !== rw) {
    var baseDenom = Math.max(0.1, rw); // avoid divide by zero
    var fixedValue = (availW * widthFitFraction) / baseDenom;
    __paletteState.__fixedScale = { value: fixedValue, availW: availW, roomWidth: rw };
    fixed = __paletteState.__fixedScale;
  }
  var scale = fixed.value;
  function toScreen(p){ return { x: rect.width/2 + (p.u - centerU)*scale, y: rect.height/2 + (p.v - centerV)*scale }; }
  // Save scale info for interaction
  __paletteState.__scaleInfo = { centerU: centerU, centerV: centerV, scale: scale, yaw: yaw, pitch: pitch, cy: cy, sy: sy, cp: cp, sp: sp, rect: rect };
  var pts = ptsUnit.map(toScreen);
  // Floor (bottom face) fill as grey
  cx.fillStyle = '#e5e7eb';
  cx.beginPath(); cx.moveTo(pts[0].x, pts[0].y); cx.lineTo(pts[1].x, pts[1].y); cx.lineTo(pts[2].x, pts[2].y); cx.lineTo(pts[3].x, pts[3].y); cx.closePath(); cx.fill();
  // Edges
  var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  cx.strokeStyle = '#2d6cdf'; cx.lineWidth = 1.0;
  cx.beginPath(); for (var i=0;i<edges.length;i++){ var e=edges[i]; cx.moveTo(pts[e[0]].x, pts[e[0]].y); cx.lineTo(pts[e[1]].x, pts[e[1]].y);} cx.stroke();
  // Dimensions label
  cx.fillStyle = '#2d6cdf'; cx.font = '12px system-ui'; cx.textAlign = 'left'; cx.textBaseline = 'top';
  cx.fillText(room.width.toFixed(2)+' x '+room.depth.toFixed(2)+' x '+room.height.toFixed(2)+' m', 10, 10);

  // Draw preview items
  for (var ii=0; ii<__paletteState.items.length; ii++) {
    var it = __paletteState.items[ii];
    var ihw = it.width/2, ihd = it.depth/2, iht = Math.max(0.3, it.height);
    var elev = Math.max(0, it.elevation || 0);
    var ipts = [
      projUV(it.x - ihw, elev,            it.z - ihd),
      projUV(it.x + ihw, elev,            it.z - ihd),
      projUV(it.x + ihw, elev,            it.z + ihd),
      projUV(it.x - ihw, elev,            it.z + ihd),
      projUV(it.x - ihw, elev + iht,      it.z - ihd),
      projUV(it.x + ihw, elev + iht,      it.z - ihd),
      projUV(it.x + ihw, elev + iht,      it.z + ihd),
      projUV(it.x - ihw, elev + iht,      it.z + ihd)
    ].map(toScreen);
    // Base fill (light)
    cx.fillStyle = 'rgba(0,0,0,0.05)';
    cx.beginPath(); cx.moveTo(ipts[0].x,ipts[0].y); cx.lineTo(ipts[1].x,ipts[1].y); cx.lineTo(ipts[2].x,ipts[2].y); cx.lineTo(ipts[3].x,ipts[3].y); cx.closePath(); cx.fill();
    // Edges
    cx.strokeStyle = '#7a8aa0'; cx.lineWidth = 1.0;
    cx.beginPath(); for (var j=0;j<edges.length;j++){ var eg=edges[j]; cx.moveTo(ipts[eg[0]].x,ipts[eg[0]].y); cx.lineTo(ipts[eg[1]].x,ipts[eg[1]].y);} cx.stroke();

    // Kitchen details in preview (cube sink with taps, hob alignment, oven alignment)
    if (it.kind === 'kitchen') {
      var topY = elev + iht;
      var isLargeKitchP = (it.name && (/large|03/i).test(it.name)) || (it.depth >= 1.6 || it.width >= 3.4);
    var sinkW = isLargeKitchP ? 0.9 : 0.55;
    var sinkD = 0.45;
    var sinkH = 0.12; // tap stem height
    var sinkDepthDown = 0.18; // recess depth below top
      var sinkGap = isLargeKitchP ? 0.04 : 0.0;
      var plateR = 0.12;
      var plateGap = 0.28;
      function projTop(x,z){ return toScreen(projUV(x, topY, z)); }
      function drawRectTop(x0,z0,x1,z1, fill, stroke){
        var p0 = projTop(x0,z0), p1 = projTop(x1,z0), p2 = projTop(x1,z1), p3 = projTop(x0,z1);
        cx.fillStyle = fill; cx.strokeStyle = stroke; cx.lineWidth = 1;
        cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); cx.fill(); cx.stroke();
      }
      function drawRectSide(x0,z0,x1,z1,h, fill, stroke){
        var p0 = toScreen(projUV(x0, topY, z0)), p1 = toScreen(projUV(x1, topY, z1)), p2 = toScreen(projUV(x1, topY + h, z1)), p3 = toScreen(projUV(x0, topY + h, z0));
        cx.fillStyle = fill; cx.strokeStyle = stroke; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); cx.fill(); cx.stroke();
      }
      function drawCircleTopP(cxw,czw,rw,col){
        var steps=18; cx.strokeStyle = col || '#333'; cx.lineWidth = 1.2; cx.beginPath();
        for (var k=0;k<=steps;k++){ var a=(k/steps)*Math.PI*2; var p=projTop(cxw+Math.cos(a)*rw, czw+Math.sin(a)*rw); if(k===0) cx.moveTo(p.x,p.y); else cx.lineTo(p.x,p.y);} cx.stroke();
      }
      // sink(s)
      var sinkCx = it.x - ihw * 0.35;
      var sinkCz = it.z + 0;
      function drawRecessTopAndWalls(x0,x1,zc){
        // top rim
        drawRectTop(x0, zc - sinkD/2, x1, zc + sinkD/2, 'rgba(200,210,220,0.55)', '#5b6773');
        // inner walls and bottom
        function polyAt(y, X0,X1,Z0,Z1){ return [ projTop(X0,Z0), projTop(X1,Z0), projTop(X1,Z1), projTop(X0,Z1) ]; }
        var pTop = polyAt(topY, x0,x1, sinkCz - sinkD/2, sinkCz + sinkD/2);
        var pBot = [ toScreen(projUV(x0, topY - sinkDepthDown, sinkCz - sinkD/2)), toScreen(projUV(x1, topY - sinkDepthDown, sinkCz - sinkD/2)), toScreen(projUV(x1, topY - sinkDepthDown, sinkCz + sinkD/2)), toScreen(projUV(x0, topY - sinkDepthDown, sinkCz + sinkD/2)) ];
        cx.fillStyle = 'rgba(200,210,220,0.45)'; cx.strokeStyle = '#5b6773'; cx.lineWidth = 1;
        var idx=[[0,1],[1,2],[2,3],[3,0]];
        for (var i=0;i<4;i++){ var a=idx[i][0], b=idx[i][1]; cx.beginPath(); cx.moveTo(pTop[a].x,pTop[a].y); cx.lineTo(pTop[b].x,pTop[b].y); cx.lineTo(pBot[b].x,pBot[b].y); cx.lineTo(pBot[a].x,pBot[a].y); cx.closePath(); cx.fill(); cx.stroke(); }
        // bottom
        cx.fillStyle = 'rgba(35,40,48,0.55)'; cx.strokeStyle='#4b5563'; cx.beginPath(); cx.moveTo(pBot[0].x,pBot[0].y); cx.lineTo(pBot[1].x,pBot[1].y); cx.lineTo(pBot[2].x,pBot[2].y); cx.lineTo(pBot[3].x,pBot[3].y); cx.closePath(); cx.fill(); cx.stroke();
        // drain at bottom center
        var drainR = Math.min(sinkW, sinkD) * 0.07; var dcx=(x0+x1)/2; var dcz=zc; drawCircleTopP(dcx, dcz, drainR, '#9aa3ad');
      }
      if (isLargeKitchP) {
        var w2 = (sinkW - sinkGap)/2; var a0x0 = sinkCx - (w2+sinkGap/2) - w2/2, a0x1 = sinkCx - (w2+sinkGap/2) + w2/2; var a1x0 = sinkCx + (w2+sinkGap/2) - w2/2, a1x1 = sinkCx + (w2+sinkGap/2) + w2/2; drawRecessTopAndWalls(a0x0,a0x1,sinkCz); drawRecessTopAndWalls(a1x0,a1x1,sinkCz);
      } else {
        var sx0 = sinkCx - sinkW/2, sx1 = sinkCx + sinkW/2; drawRecessTopAndWalls(sx0,sx1,sinkCz);
      }
      // taps
      function drawTapP(tx, tz) {
        var stemH = 0.10, spoutL = 0.07;
        var base = toScreen(projUV(tx, topY, tz - sinkD/2 - 0.03));
        var topP = toScreen(projUV(tx, topY + stemH, tz - sinkD/2 - 0.03));
        cx.strokeStyle = '#6b7280'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(base.x, base.y); cx.lineTo(topP.x, topP.y); cx.stroke();
        var sp = toScreen(projUV(tx, topY + stemH, tz - sinkD/2 - 0.03 + spoutL));
        cx.beginPath(); cx.moveTo(topP.x, topP.y); cx.lineTo(sp.x, sp.y); cx.stroke();
      }
      if (isLargeKitchP) {
        var w2t = (sinkW - sinkGap)/2;
        drawTapP(sinkCx - (w2t+sinkGap/2) - w2t*0.2, sinkCz);
        drawTapP(sinkCx + (w2t+sinkGap/2) + w2t*0.2, sinkCz);
      } else {
        drawTapP(sinkCx - sinkW*0.15, sinkCz);
        drawTapP(sinkCx + sinkW*0.15, sinkCz);
      }
      // hot plates
      var platesOnRight = sinkCx <= it.x;
      var plateBaseX = it.x + (platesOnRight ? ihw * 0.30 : -ihw * 0.30);
      var plateBaseZ = it.z - plateGap/2;
      var sinkMinX = sinkCx - (isLargeKitchP ? (sinkW/2) : (sinkW/2));
      var sinkMaxX = sinkCx + (isLargeKitchP ? (sinkW/2) : (sinkW/2));
      var plateMinX = plateBaseX - plateR;
      var plateMaxX = plateBaseX + plateGap + plateR;
      if (!(plateMaxX < sinkMinX - 0.05 || plateMinX > sinkMaxX + 0.05)) {
        plateBaseX = it.x + (platesOnRight ? ihw * 0.40 : -ihw * 0.40);
      }
      drawCircleTopP(plateBaseX, plateBaseZ, plateR, '#111');
      drawCircleTopP(plateBaseX + plateGap, plateBaseZ, plateR, '#111');
      drawCircleTopP(plateBaseX, plateBaseZ + plateGap, plateR, '#111');
      drawCircleTopP(plateBaseX + plateGap, plateBaseZ + plateGap, plateR, '#111');
      // oven front as simple rectangle on +Z face projection (approximate)
      var ovenW = Math.min(0.7, it.width*0.5), ovenH = 0.45;
      var hobCenterX = plateBaseX + plateGap/2;
      var ox0 = hobCenterX - ovenW/2, ox1 = hobCenterX + ovenW/2, oz = it.z + ihd;
      var oy0 = elev + 0.15, oy1 = Math.min(elev + iht - 0.1, oy0 + ovenH);
      var p0 = toScreen(projUV(ox0, oy0, oz)), p1 = toScreen(projUV(ox1, oy0, oz)), p2 = toScreen(projUV(ox1, oy1, oz)), p3 = toScreen(projUV(ox0, oy1, oz));
      cx.fillStyle = 'rgba(20,20,25,0.35)'; cx.strokeStyle='#444';
      cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); cx.fill(); cx.stroke();
      // handle
      var hy = (p2.y + p3.y)*0.5 - 3; cx.strokeStyle = '#c0c0c0'; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(p0.x+5, hy); cx.lineTo(p1.x-5, hy); cx.stroke();
    }
  }

  // Overlay: small compass indicating world directions (based on preview yaw)
  try { drawPaletteCompass(cx, rect, yaw); } catch(e) {}
}

// Draw a small compass in the top-right corner of the popover preview
function drawPaletteCompass(cx, rect, yaw) {
  var size = 56; // compass box size in px
  var padding = 10;
  var x = rect.width - size - padding;
  var y = padding;

  cx.save();
  cx.globalAlpha = 0.95;

  // Rounded background
  var r = 10;
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.lineTo(x + size - r, y);
  cx.quadraticCurveTo(x + size, y, x + size, y + r);
  cx.lineTo(x + size, y + size - r);
  cx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
  cx.lineTo(x + r, y + size);
  cx.quadraticCurveTo(x, y + size, x, y + size - r);
  cx.lineTo(x, y + r);
  cx.quadraticCurveTo(x, y, x + r, y);
  cx.closePath();
  cx.fillStyle = 'rgba(255,255,255,0.88)';
  cx.strokeStyle = '#cfcfcf';
  cx.lineWidth = 1;
  cx.fill();
  cx.stroke();

  // Static crosshair (does not spin)
  var cx0 = x + size/2;
  var cy0 = y + size/2;
  var rad = (size/2) - 9;
  function pt(a, rr){ return { x: cx0 + Math.cos(a)*rr, y: cy0 + Math.sin(a)*rr }; }

  cx.strokeStyle = '#6b7280';
  cx.lineWidth = 1.5;
  cx.beginPath();
  // Vertical line (up/down)
  cx.moveTo(cx0, cy0 - rad); cx.lineTo(cx0, cy0 + rad);
  // Horizontal line (left/right)
  cx.moveTo(cx0 - rad, cy0); cx.lineTo(cx0 + rad, cy0);
  cx.stroke();

  // Fixed labels N/E/S/W
  cx.fillStyle = '#374151';
  cx.font = 'bold 11px system-ui, sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  var lr = rad - 5;
  var LN = pt(-Math.PI/2, lr);   // Up
  var LE = pt(0, lr);            // Right
  var LS = pt(Math.PI/2, lr);    // Down
  var LW = pt(Math.PI, lr);      // Left
  cx.fillText('N', LN.x, LN.y);
  cx.fillText('E', LE.x, LE.y);
  cx.fillText('S', LS.x, LS.y);
  cx.fillText('W', LW.x, LW.y);

  // North needle rotates to indicate world +Z relative to screen
  var angleNeedle = -Math.PI/2 + yaw; // when yaw=0, points up
  var needle = pt(angleNeedle, rad - 1);
  cx.strokeStyle = '#ef4444';
  cx.lineWidth = 2;
  cx.beginPath(); cx.moveTo(cx0, cy0); cx.lineTo(needle.x, needle.y); cx.stroke();

  cx.restore();
}

function getPaletteScaleInfo(room, cv){
  if (!__paletteState.__scaleInfo) { renderRoomPreview(room); }
  return __paletteState.__scaleInfo;
}

function addPalettePreviewItem(def){
  var room = findObjectById(paletteOpenForId); if (!room) return;
  // Place near center with slight offset to avoid overlap
  var offset = (__paletteState.items.length % 5) * 0.3;
  var depth = def.kind === 'kitchen' ? 0.7 : def.depth;
  var it = { width: def.width, depth: depth, height: def.height, x: 0 + offset, z: 0 + offset, name: def.name, kind: def.kind, elevation: (def.kind==='tv'?0.8:0), isExisting: false };
  // Clamp within room immediately
  var maxX = room.width/2 - it.width/2; var maxZ = room.depth/2 - it.depth/2;
  it.x = Math.max(-maxX, Math.min(maxX, it.x));
  it.z = Math.max(-maxZ, Math.min(maxZ, it.z));
  __paletteState.items.push(it);
  renderRoomPreview(room);
}

function commitPaletteItems(){
  if (!paletteOpenForId || __paletteState.items.length === 0) return;
  var room = findObjectById(paletteOpenForId); if (!room) return;
  for (var i=0;i<__paletteState.items.length;i++){
    var it = __paletteState.items[i];
    if (it.isExisting) continue;
  var elevation = (it.kind === 'tv') ? 0.8 : 0.0;
  var depth = it.kind === 'kitchen' ? 0.7 : it.depth;
  var furn = { id: 'furn_'+Date.now()+Math.random().toString(36).slice(2), x: room.x + it.x, z: room.z + it.z, width: it.width, depth: depth, height: it.height, level: room.level, elevation: elevation, name: it.name, type: 'furniture', rotation: 0, kind: it.kind };
    furnitureItems.push(furn);
  }
  saveProjectSilently();
  var addedCount = __paletteState.items.filter(function(it){ return !it.isExisting; }).length;
  updateStatus('Added '+addedCount+' item(s) to '+(room.name||'Room'));
  // Keep existing previews, drop newly added ones
  __paletteState.items = __paletteState.items.filter(function(it){ return it.isExisting; });
  hideRoomPalette();
  renderLoop();
}

function clearPalettePreview(){
  // Remove only newly added preview items
  __paletteState.items = __paletteState.items.filter(function(it){ return it.isExisting; });
}

function hitTestPaletteItem(mx, my, room){
  if (!__paletteState || __paletteState.items.length === 0) return -1;
  // Test from top-most
  for (var i=__paletteState.items.length-1;i>=0;i--){
    var it = __paletteState.items[i];
    var pts = projectItemBase(it, room);
    if (pointInPolygon(mx, my, pts)) return i;
  }
  return -1;
}

function projectItemBase(it, room){
  var info = __paletteState.__scaleInfo; if (!info) { renderRoomPreview(room); info = __paletteState.__scaleInfo; }
  var cy = info.cy, sy = info.sy, cp = info.cp, sp = info.sp, scale = info.scale, centerU = info.centerU, centerV = info.centerV, rect = info.rect;
  function projUV(x,y,z){ var rx = cy*x + sy*z; var rz = -sy*x + cy*z; return { u: rx, v: -y*cp + rz*sp*0.5 }; }
  function toScreen(p){ return { x: rect.width/2 + (p.u - centerU)*scale, y: rect.height/2 + (p.v - centerV)*scale }; }
  var ihw = it.width/2, ihd = it.depth/2;
  var elev = Math.max(0, it.elevation || 0);
  return [
    projUV(it.x - ihw, elev, it.z - ihd),
    projUV(it.x + ihw, elev, it.z - ihd),
    projUV(it.x + ihw, elev, it.z + ihd),
    projUV(it.x - ihw, elev, it.z + ihd)
  ].map(toScreen);
}

function pointInPolygon(x, y, pts){
  var inside = false;
  for (var i=0, j=pts.length-1; i<pts.length; j=i++){
    var xi = pts[i].x, yi = pts[i].y; var xj = pts[j].x, yj = pts[j].y;
    var intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / Math.max(1e-6, (yj - yi)) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function loadExistingFurniturePreview(room){
  var list = [];
  for (var i=0;i<furnitureItems.length;i++){
    var f = furnitureItems[i];
    if (f.level !== room.level) continue;
    // Check if within room footprint
    var relX = f.x - room.x; var relZ = f.z - room.z;
    var inside = Math.abs(relX) <= (room.width/2) && Math.abs(relZ) <= (room.depth/2);
    if (!inside) continue;
    list.push({ width: f.width, depth: f.depth, height: f.height, x: relX, z: relZ, name: f.name, kind: f.kind, elevation: (f.elevation||0), isExisting: true });
  }
  return list;
}

function addPaletteItem(def) {
  if (!paletteOpenForId) return;
  var room = findObjectById(paletteOpenForId);
  if (!room) return;
  // Add furniture with catalog dimensions
  var elevation = (def.kind === 'tv') ? 0.8 : 0.0;
  var depth = def.kind === 'kitchen' ? 0.7 : def.depth;
  var furn = { id: 'furn_'+Date.now()+Math.random().toString(36).slice(2), x: room.x, z: room.z, width: def.width, depth: depth, height: def.height, level: room.level, elevation: elevation, name: def.name, type: 'furniture', rotation: 0, kind: def.kind };
  furnitureItems.push(furn);
  updateStatus('Added: '+def.name+' to '+(room.name||'Room'));
  hideRoomPalette();
  saveProjectSilently();
  renderLoop();
}

// Draw a simple scaled 3D wireframe box for the item on its thumbnail canvas
function renderItemThumb(canvas, def) {
  var cx = canvas.getContext('2d');
  cx.clearRect(0,0,canvas.width,canvas.height);
  // Fit item within canvas with padding, using X/Z footprint for scale, hint of height
  var pad = 12;
  var w = canvas.width - pad*2, h = canvas.height - pad*2;
  var sx = def.width, sz = def.depth, sy = Math.max(0.3, def.height || 0.7);
  var maxFoot = Math.max(sx, sz);
  var scale = (Math.min(w, h) * 0.9) / maxFoot;
  // Isometric-ish projection parameters
  var angle = Math.PI/6; // 30deg
  var cos = Math.cos(angle), sin = Math.sin(angle);
  function proj3(x,y,z){
    var u = (x - z) * cos;
    var v = -y + (x + z) * sin * 0.5;
    return { x: canvas.width/2 + u*scale, y: canvas.height/2 + v*scale };
  }
  var hw = sx/2, hd = sz/2, ht = sy;
  var pts = [
    proj3(-hw, 0, -hd), proj3(hw, 0, -hd), proj3(hw, 0, hd), proj3(-hw, 0, hd),
    proj3(-hw, ht, -hd), proj3(hw, ht, -hd), proj3(hw, ht, hd), proj3(-hw, ht, hd)
  ];
  var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  cx.strokeStyle = '#007acc'; cx.lineWidth = 1.2;
  cx.beginPath(); for (var i=0;i<edges.length;i++){ var e = edges[i]; cx.moveTo(pts[e[0]].x, pts[e[0]].y); cx.lineTo(pts[e[1]].x, pts[e[1]].y);} cx.stroke();

  // Kitchen hints on thumbnail
  if (def.kind === 'kitchen') {
    // Draw top indicators on the top face
    function to2(x,y,z){ var p = proj3(x,y,z); return p; }
    // compute rough top plane rectangle
    // sink position
    var isLargeK = (def.name && (/large|03/i).test(def.name)) || (def.depth >= 1.6 || def.width >= 3.4);
    var sinkW = isLargeK ? 0.9 : 0.55;
    var sinkD = 0.45;
    var sinkCx = -hw * 0.35;
    var sinkCz = 0;
    function drawRectTop(x0,z0,x1,z1){ var p0=to2(x0,ht,z0), p1=to2(x1,ht,z0), p2=to2(x1,ht,z1), p3=to2(x0,ht,z1); cx.fillStyle='rgba(200,210,220,0.55)'; cx.strokeStyle='#5b6773'; cx.lineWidth=1; cx.beginPath(); cx.moveTo(p0.x,p0.y); cx.lineTo(p1.x,p1.y); cx.lineTo(p2.x,p2.y); cx.lineTo(p3.x,p3.y); cx.closePath(); cx.fill(); cx.stroke(); }
    function drawCircleTop(cxw,czw,rw){ cx.strokeStyle='#111'; cx.lineWidth=1.2; cx.beginPath(); for (var k=0;k<=18;k++){ var a=(k/18)*Math.PI*2; var p=to2(cxw+Math.cos(a)*rw, ht, czw+Math.sin(a)*rw); if(k===0) cx.moveTo(p.x,p.y); else cx.lineTo(p.x,p.y);} cx.stroke(); }
    if (isLargeK) {
      var w2 = sinkW/2 - 0.02; drawRectTop(sinkCx - 0.02 - w2, sinkCz - sinkD/2, sinkCx - 0.02 + w2, sinkCz + sinkD/2); drawRectTop(sinkCx + 0.02 - w2, sinkCz - sinkD/2, sinkCx + 0.02 + w2, sinkCz + sinkD/2);
    } else {
      drawRectTop(sinkCx - sinkW/2, sinkCz - sinkD/2, sinkCx + sinkW/2, sinkCz + sinkD/2);
    }
    // hot plates
    var plateR = 0.12, plateGap = 0.28;
    var plateBaseX = hw * 0.25;
    var plateBaseZ = -plateGap/2;
    drawCircleTop(plateBaseX, plateBaseZ, plateR);
    drawCircleTop(plateBaseX + plateGap, plateBaseZ, plateR);
    drawCircleTop(plateBaseX, plateBaseZ + plateGap, plateR);
    drawCircleTop(plateBaseX + plateGap, plateBaseZ + plateGap, plateR);
  }
}

// ================= 2D FLOOR PLAN EDITOR (IMPLEMENTATION) =================
// Provides: openPlan2DModal, closePlan2DModal, drawing walls (300mm), windows (thin), erase, clear, export/import.

var __plan2d = {
  active:false,
  scale:50,          // px per meter
  wallThicknessM:0.3,
  // Stroke width (in canvas px) used when outlining walls. Keep dimension overlay in sync.
  wallStrokePx:1.2,
  wallHeightM:3.0,
  // Controls orientation: 2D Y = sign * world Z (1 => North up matches world +Z; -1 flips)
  yFromWorldZSign: 1,
  // Grid snapping step (meters)
  gridStep: 0.5,
  elements:[],       // { type:'wall'|'window'|'door', ... }
  tool:'wall',       // current tool: wall | window | door | erase | select
  start:null,        // world coords of drag start
  last:null,         // world coords of current mouse during drag
  mouse:null,        // {x,y} current mouse position in canvas pixels for overlay anchoring
  hoverIndex:-1,
  selectedIndex:-1,
  // Window editing state (for host-anchored windows)
  dragWindow:null,   // { index, end:'t0'|'t1' }
  // Standard sizes
  doorWidthM:0.87,
  doorHeightM:2.04,
  // Default preview width for windows before sizing
  windowDefaultWidthM:1.2,
  // Door editing state (for dragging endpoints)
  dragDoor:null,      // { index, end:'t0'|'t1'|'a'|'b' }
  // Whole-door drag state for sliding along wall
  dragDoorWhole:null, // { index, startMouseT, startT0, startT1, host }
  // Wall endpoint drag state
  dragWall:null,       // { index, end:'a'|'b', orient:'h'|'v', other:{x,y} }
  // Selected wall subsegment between junctions (for targeted deletion)
  selectedSubsegment:null // { wallIndex, t0, t1, ax, ay, bx, by }
};

// ===== 2D/3D LIVE SYNC HELPERS =====
__plan2d.syncInProgress = false;      // prevent feedback while applying
__plan2d._applyTimer = null;          // debounce timer id
__plan2d._syncTimer = null;           // polling timer for 3D->2D
__plan2d._last3Dsig = null;           // last ground-floor signature
__plan2d._last2Dsig = null;           // last 2D signature applied
__plan2d._lastWallsSig = null;        // last walls-only signature to detect opening-only edits

function plan2dSig3D(){
  try{
    var parts=[];
    for(var i=0;i<allRooms.length;i++){
      var r=allRooms[i];
      var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
      if((r.level||0)!==lvl) continue;
      var ops=(r.openings||[]).map(function(o){ return [o.type,o.edge, +(o.startM||0).toFixed(3), +(o.endM||0).toFixed(3), (typeof o.heightM==='number'? +o.heightM.toFixed(3): null) ]; });
      parts.push([ +r.x.toFixed(3), +r.z.toFixed(3), +r.width.toFixed(3), +r.depth.toFixed(3), ops ]);
    }
    return JSON.stringify(parts);
  }catch(e){ return ''; }
}
function plan2dSig2D(){
  try{
    var elems=__plan2d.elements||[]; var parts=[];
    for(var i=0;i<elems.length;i++){
      var e=elems[i]; if(!e) continue;
      if(e.type==='wall') parts.push(['w', +e.x0.toFixed(3), +e.y0.toFixed(3), +e.x1.toFixed(3), +e.y1.toFixed(3)]);
      else if(e.type==='window'||e.type==='door'){
        if(typeof e.host==='number') parts.push([e.type==='window'?'win':'door','h', e.host, +(e.t0||0).toFixed(4), +(e.t1||0).toFixed(4)]);
        else parts.push([e.type==='window'?'win':'door', +e.x0.toFixed(3), +e.y0.toFixed(3), +e.x1.toFixed(3), +e.y1.toFixed(3)]);
      }
    }
    return JSON.stringify(parts);
  }catch(e){ return ''; }
}
function plan2dSigWallsOnly(){
  try{
    var elems=__plan2d.elements||[]; var parts=[];
    for(var i=0;i<elems.length;i++){
      var e=elems[i]; if(!e || e.type!=='wall') continue;
      parts.push([ +e.x0.toFixed(3), +e.y0.toFixed(3), +e.x1.toFixed(3), +e.y1.toFixed(3), +(e.thickness||__plan2d.wallThicknessM||0.3).toFixed(3) ]);
    }
    return JSON.stringify(parts);
  }catch(e){ return ''; }
}
function plan2dGetElementsSnapshot(){
  var snap = (__plan2d.elements||[]).slice();
  // Include a synthetic preview wall while dragging so 3D updates live
  if(__plan2d.start && __plan2d.last && __plan2d.tool==='wall'){
    var a = __plan2d.start, b = __plan2d.last;
    var dx=b.x-a.x, dy=b.y-a.y; if(Math.abs(dx)>Math.abs(dy)) b={x:b.x,y:a.y}; else b={x:a.x,y:b.y};
    snap.push({type:'wall', x0:a.x, y0:a.y, x1:b.x, y1:b.y, thickness: __plan2d.wallThicknessM});
  }
  return snap;
}
function plan2dScheduleApply(now){
  if(__plan2d._applyTimer){ clearTimeout(__plan2d._applyTimer); __plan2d._applyTimer=null; }
  // Live updates: apply as wall strips only (no rooms) to avoid creating extra rooms while drawing
  var run=function(){
    try{
      __plan2d.syncInProgress=true;
      // Apply live edits level-aware
      var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
      // If walls are unchanged, we can safely rebuild rooms+openings to reflect door/window edits in 3D
      var wallsSigNow = plan2dSigWallsOnly();
      if(wallsSigNow && __plan2d._lastWallsSig && wallsSigNow === __plan2d._lastWallsSig){
        applyPlan2DTo3D(undefined, { allowRooms:true, quiet:true, level: lvl });
      } else {
        // Build strips only on ground floor; for first floor skip strips and just update signatures
        if (lvl === 0){
          applyPlan2DTo3D(plan2dGetElementsSnapshot(), { stripsOnly:true, quiet:true, level: 0 });
        }
      }
      __plan2d._lastWallsSig = wallsSigNow;
      __plan2d._last3Dsig = plan2dSig3D(); __plan2d._last2Dsig = plan2dSig2D();
    } finally { setTimeout(function(){ __plan2d.syncInProgress=false; }, 30); }
  };
  if(now){ run(); } else { __plan2d._applyTimer = setTimeout(run, 150); }
}
function plan2dStartSyncLoop(){
  if(__plan2d._syncTimer) return;
  __plan2d._last3Dsig = plan2dSig3D();
  __plan2d._last2Dsig = plan2dSig2D();
  __plan2d._lastWallsSig = plan2dSigWallsOnly();
  __plan2d._syncTimer = setInterval(function(){
    if(!__plan2d.active) return;
    if(__plan2d.syncInProgress) return;
    // don't overwrite while user is actively dragging in 2D
    if(__plan2d.start || __plan2d.dragWindow || __plan2d.dragDoor || __plan2d.dragDoorWhole) return;
    var sig = plan2dSig3D();
    if(sig && sig !== __plan2d._last3Dsig){
      try{ if(populatePlan2DFromDesign()){ plan2dDraw(); } }catch(e){}
      __plan2d._last3Dsig = sig; __plan2d._last2Dsig = plan2dSig2D();
    }
  }, 250);
}
function plan2dStopSyncLoop(){ if(__plan2d._syncTimer){ clearInterval(__plan2d._syncTimer); __plan2d._syncTimer=null; } }
function plan2dEdited(){ plan2dScheduleApply(false); }

function openPlan2DModal(){
  var m=document.getElementById('plan2d-modal'); if(!m) return;
  m.style.display='block';
  __plan2d.active=true;
  // Clear any 3D selection to avoid Delete key acting on 3D while in 2D editor
  try { selectedRoomId = null; } catch(e) {}
  // Sync floor toggle and native level selector to the current 3D floor
  try {
    var bG = document.getElementById('plan2d-floor-ground');
    var bF = document.getElementById('plan2d-floor-first');
    if (bG && bF){
      if ((typeof currentFloor==='number'? currentFloor : 0) === 0){ bG.classList.add('active'); bF.classList.remove('active'); }
      else { bF.classList.add('active'); bG.classList.remove('active'); }
    }
    var nativeSel = document.getElementById('levelSelect');
    if (nativeSel){ nativeSel.value = String(typeof currentFloor==='number' ? currentFloor : 0); }
  } catch(e) {}
  plan2dBind();
  plan2dResize();
  // Populate from the currently selected floor so 2D reflects the active level
  try { populatePlan2DFromDesign(); } catch(e) { console.warn('populatePlan2DFromDesign failed', e); }
  plan2dDraw();
  updatePlan2DInfo();
  // start live sync with 3D
  try{ plan2dStartSyncLoop(); }catch(e){}
}
function closePlan2DModal(){
  var m=document.getElementById('plan2d-modal'); if(m) m.style.display='none';
  __plan2d.active=false;
  plan2dUnbind();
  try{ plan2dStopSyncLoop(); }catch(e){}
}

// Screen mapping: X right = +X (world), Y up = +Y in plan space. World Z maps to plan Y with a configurable sign.
function worldToScreen2D(wx,wy){ var c=document.getElementById('plan2d-canvas'); if(!c)return {x:0,y:0}; return { x:c.width/2 + wx*__plan2d.scale, y:c.height/2 - wy*__plan2d.scale }; }
function screenToWorld2D(px,py){ var c=document.getElementById('plan2d-canvas'); if(!c)return {x:0,y:0}; return { x:(px - c.width/2)/__plan2d.scale, y:(c.height/2 - py)/__plan2d.scale }; }

function plan2dBind(){
  // Ensure key events reach the editor reliably
  try { var content=document.getElementById('plan2d-content'); if(content){ if(!content.hasAttribute('tabindex')) content.setAttribute('tabindex','0'); content.focus({preventScroll:true}); } } catch(e) {}
  var c=document.getElementById('plan2d-canvas'); var ov=document.getElementById('plan2d-overlay'); if(!c||!ov) return;
  if(!window.__plan2dResize){
    window.__plan2dResize=function(){ if(__plan2d.active){ plan2dResize(); plan2dDraw(); } };
    window.addEventListener('resize', window.__plan2dResize);
  }
  // Tool buttons
  var bWall=document.getElementById('plan2d-tool-wall'); if(bWall) bWall.onclick=function(){ __plan2d.tool='wall'; plan2dCursor(); };
  var bWin=document.getElementById('plan2d-tool-window'); if(bWin) bWin.onclick=function(){ __plan2d.tool='window'; plan2dCursor(); updateStatus('Window tool: click a wall to place a window, then drag the endpoints to size it.'); };
  var bDoor=document.getElementById('plan2d-tool-door'); if(bDoor) bDoor.onclick=function(){ __plan2d.tool='door'; plan2dCursor(); };
  var bSel=document.getElementById('plan2d-tool-select'); if(bSel) bSel.onclick=function(){ __plan2d.tool='select'; plan2dCursor(); };
  var bErase=document.getElementById('plan2d-tool-erase'); if(bErase) bErase.onclick=function(){ __plan2d.tool='erase'; plan2dCursor(); };
  var bClear=document.getElementById('plan2d-clear'); if(bClear) bClear.onclick=function(){ if(confirm('Clear all elements?')) { __plan2d.elements=[]; __plan2d.selectedIndex=-1; plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); } };
  var bClose=document.getElementById('plan2d-close'); if(bClose) bClose.onclick=closePlan2DModal;
  var bExp=document.getElementById('plan2d-export'); if(bExp) bExp.onclick=plan2dExport;
  var bImp=document.getElementById('plan2d-import'); if(bImp) bImp.onclick=function(){ var f=document.getElementById('plan2d-import-file'); if(f) f.click(); };
  var fi=document.getElementById('plan2d-import-file'); if(fi) fi.onchange=function(e){ var f=e.target.files&&e.target.files[0]; if(!f)return; var r=new FileReader(); r.onload=function(){ try{ var arr=JSON.parse(r.result); if(Array.isArray(arr)){ __plan2d.elements=arr; __plan2d.selectedIndex=-1; plan2dDraw(); updatePlan2DInfo(); updateStatus('2D plan imported'); plan2dEdited(); } }catch(err){ updateStatus('Import failed'); } }; r.readAsText(f); fi.value=''; };
  var bApply3D=document.getElementById('plan2d-apply-3d'); if(bApply3D) bApply3D.onclick=function(){ try{
    var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
    applyPlan2DTo3D(undefined, { allowRooms:true, quiet:false, level: lvl });
  }catch(e){} };
  // Central deletion used by both keyboard and button; supports subsegment, selection, or hovered element
  function plan2dDeleteSelection(){
    if(!__plan2d.active) return false;
    // 1) Prefer wall subsegment if selected
    if(__plan2d.selectedSubsegment){
      if(plan2dDeleteSelectedSubsegment()){
        __plan2d.selectedSubsegment=null; __plan2d.selectedIndex=-1;
        plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); return true;
      }
    }
    // 2) Next: delete current explicit selection (door/window/wall)
    if(__plan2d.selectedIndex>=0){
      __plan2d.elements.splice(__plan2d.selectedIndex,1);
      __plan2d.selectedIndex=-1; __plan2d.selectedSubsegment=null;
      plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); return true;
    }
    // Else: nothing selected; do nothing
    updateStatus && updateStatus('Select a door, window, or wall segment first');
    return false;
  }
  // Hook Delete Selected button to shared deletion
  var bDelSel=document.getElementById('plan2d-delete-selected'); if(bDelSel) bDelSel.onclick=function(){ plan2dDeleteSelection(); };
  if(!c.__plan2dBound){
    c.__plan2dBound=true;
    c.addEventListener('mousedown', function(e){
      if(!__plan2d.active) return;
      var rect=c.getBoundingClientRect();
      var p=screenToWorld2D((e.clientX-rect.left)*(c.width/rect.width),(e.clientY-rect.top)*(c.height/rect.height));
      // marker drag removed
      if(__plan2d.tool==='erase'){ plan2dEraseAt(p); return; }
      if(__plan2d.tool==='select'){
        // Track click position for click-vs-drag detection in plan units
        __plan2d.mouseDownPosPlan = { x: p.x, y: p.y };
        __plan2d.pendingSelectIndex = null;
        __plan2d.maybeDragDoorWhole = null;

        // If a window is selected, allow grabbing endpoints to drag (supports host-anchored windows)
        var hit = plan2dHitWindowEndpoint(p, 0.15);
        if(hit){ __plan2d.dragWindow = hit; return; }
        // If a door is near, allow grabbing door endpoints
        var hitD = plan2dHitDoorEndpoint(p, 0.15);
        if(hitD){ __plan2d.dragDoor = hitD; return; }
        // Walls: grab an endpoint for resizing
        var hitWEnd = plan2dHitWallEndpoint(p, 0.18);
        if(hitWEnd){
          var w = __plan2d.elements[hitWEnd.index];
          if(w && w.type==='wall'){
            var horiz = Math.abs(w.y1 - w.y0) <= 1e-6;
            __plan2d.dragWall = { index: hitWEnd.index, end: hitWEnd.end, orient: horiz ? 'h' : 'v', other: (hitWEnd.end==='a'? {x:w.x1,y:w.y1}:{x:w.x0,y:w.y0}) };
            return;
          }
        }
        // Prefer door/window segment selection before wall subsegment
        var selDoor = plan2dHitDoorSegment(p, 0.18);
        if(selDoor && typeof selDoor.index==='number'){
          // Set up click-to-select; escalate to drag on move
          var de0 = __plan2d.elements[selDoor.index];
          if(de0 && de0.type==='door' && typeof de0.host==='number'){
            // Clear any previously selected wall subsegment when selecting a door
            __plan2d.selectedSubsegment = null;
            __plan2d.pendingSelectIndex = selDoor.index;
            __plan2d.selectedIndex = selDoor.index; // reflect selection immediately
            plan2dDraw();
            __plan2d.maybeDragDoorWhole = {
              index: selDoor.index,
              startMouseT: plan2dProjectParamOnWall(p, __plan2d.elements[de0.host]),
              startT0: de0.t0 || 0,
              startT1: de0.t1 || 0,
              host: de0.host
            };
            return;
          }
        }
        var selWin = plan2dHitWindowSegment(p, 0.18);
        if(selWin && typeof selWin.index==='number'){
          // Clear any previously selected wall subsegment when selecting a window
          __plan2d.selectedSubsegment = null;
          __plan2d.pendingSelectIndex = selWin.index;
          __plan2d.selectedIndex = selWin.index; // reflect selection immediately
          plan2dDraw();
          return;
        }
        // If user clicks a wall centerline near an intersection, select subsegment
        var segHit = plan2dHitWallSubsegment(p, 0.15);
        if(segHit){
          // Select wall segment exclusively; clear element selection
          __plan2d.selectedIndex = -1;
          __plan2d.selectedSubsegment = segHit;
          plan2dDraw();
          return;
        }
        // Clear subsegment selection when selecting regular elements
        __plan2d.selectedSubsegment = null;
        plan2dSelectAt(p); return; }
      if(__plan2d.tool==='door'){
        // Place a standard door onto a selected wall or nearest wall under cursor
        var hostIdx = -1;
        if(__plan2d.selectedIndex>=0 && __plan2d.elements[__plan2d.selectedIndex] && __plan2d.elements[__plan2d.selectedIndex].type==='wall'){
          hostIdx = __plan2d.selectedIndex;
        } else {
          var nearest = plan2dFindNearestWall(p, 0.25);
          if(nearest && typeof nearest.index==='number') hostIdx = nearest.index;
        }
        if(hostIdx>=0){
          var wall = __plan2d.elements[hostIdx];
          var t = plan2dProjectParamOnWall(p, wall);
          var wdx = wall.x1 - wall.x0, wdy = wall.y1 - wall.y0; var wLen = Math.hypot(wdx, wdy) || 1;
          var halfT = (__plan2d.doorWidthM/2) / wLen;
          var t0 = t - halfT, t1 = t + halfT;
          // Shift to fit entirely on wall
          if(t0 < 0){ t1 -= t0; t0 = 0; }
          if(t1 > 1){ var over = t1 - 1; t0 -= over; t1 = 1; }
          t0 = Math.max(0, Math.min(1, t0));
          t1 = Math.max(0, Math.min(1, t1));
          // Ensure ordering
          if(t0 > t1){ var tmp=t0; t0=t1; t1=tmp; }
          var door = { type:'door', host:hostIdx, t0:t0, t1:t1, widthM: __plan2d.doorWidthM, heightM: __plan2d.doorHeightM, thickness: wall.thickness || __plan2d.wallThicknessM, meta:{ hinge:'t0', swing:'in' } };
          __plan2d.elements.push(door);
          __plan2d.selectedIndex = __plan2d.elements.length - 1;
          plan2dDraw(); updatePlan2DInfo(); plan2dEdited();
          return;
        } else {
          updateStatus('Click near a wall to place a door');
        }
      }
      if(__plan2d.tool==='window'){
        // Try to grab an existing window endpoint
        var hitW = plan2dHitWindowEndpoint(p, 0.15);
        if(hitW){ __plan2d.dragWindow = hitW; return; }
        // Prefer attaching to a wall: selected or nearest under cursor
        var sel = __plan2d.selectedIndex>=0 ? __plan2d.elements[__plan2d.selectedIndex] : null;
        var widx = -1;
        if(sel && sel.type==='wall') { widx = __plan2d.selectedIndex; }
        if(widx < 0){ var near = plan2dFindNearestWall(p, 0.25); if(near) widx = near.index; }
        if(widx >= 0){
          var hostW = __plan2d.elements[widx];
          var t = plan2dProjectParamOnWall(p, hostW);
          var win = { type:'window', host:widx, t0:t, t1:t, thickness: hostW.thickness || __plan2d.wallThicknessM };
          __plan2d.elements.push(win);
          __plan2d.selectedIndex = __plan2d.elements.length - 1;
          __plan2d.dragWindow = { index: __plan2d.selectedIndex, end:'t1' };
          plan2dDraw(); plan2dEdited();
          return;
        }
        // Fallback: legacy free-draw if no wall nearby
      }
      if(__plan2d.tool==='door'){
        // Try to grab an existing door endpoint
        var dHit = plan2dHitDoorEndpoint(p, 0.15);
        if(dHit){ __plan2d.dragDoor = dHit; return; }
        // Or slide an existing anchored door by grabbing its segment
        var dSeg = plan2dHitDoorSegment(p, 0.12);
        if(dSeg && typeof dSeg.index==='number'){
          var de2 = __plan2d.elements[dSeg.index];
          if(de2 && de2.type==='door' && typeof de2.host==='number'){
            var host2 = __plan2d.elements[de2.host]; if(host2 && host2.type==='wall'){
              __plan2d.dragDoorWhole = {
                index: dSeg.index,
                startMouseT: plan2dProjectParamOnWall(p, host2),
                startT0: de2.t0 || 0,
                startT1: de2.t1 || 0,
                host: de2.host
              };
              return;
            }
          }
        }
      }
      __plan2d.start=p; __plan2d.last=p; plan2dDraw();
    });
    c.addEventListener('mousemove', function(e){
      if(!__plan2d.active) return;
      var rect=c.getBoundingClientRect();
      var cx = (e.clientX-rect.left)*(c.width/rect.width);
      var cy = (e.clientY-rect.top)*(c.height/rect.height);
      __plan2d.mouse = { x: cx, y: cy };
      var p=screenToWorld2D(cx, cy);
      // Hover hints for select/erase
      __plan2d.hoverDoorIndex = -1; __plan2d.hoverWindowIndex = -1; __plan2d.hoverSubsegment = null;
      if(__plan2d.tool==='select' && !__plan2d.dragDoor && !__plan2d.dragDoorWhole && !__plan2d.dragWindow && !__plan2d.dragWall && !__plan2d.start){
        var hD = plan2dHitDoorSegment(p, 0.2); if(hD && typeof hD.index==='number') __plan2d.hoverDoorIndex = hD.index;
        var hW = plan2dHitWindowSegment(p, 0.2); if(hW && typeof hW.index==='number') __plan2d.hoverWindowIndex = hW.index;
        if(__plan2d.hoverDoorIndex<0 && __plan2d.hoverWindowIndex<0){ __plan2d.hoverSubsegment = plan2dHitWallSubsegment(p, 0.2); }
      }
      // If we had a pending door selection for click, but user moved beyond threshold, escalate to dragDoorWhole
      if(__plan2d.maybeDragDoorWhole && __plan2d.mouseDownPosPlan){
        var md = __plan2d.mouseDownPosPlan; var moveDist = Math.hypot((p.x - md.x), (p.y - md.y));
        if(moveDist > 0.02){ // ~2cm
          __plan2d.dragDoorWhole = __plan2d.maybeDragDoorWhole; __plan2d.maybeDragDoorWhole = null; __plan2d.pendingSelectIndex = null;
        }
      }
      // marker drag removed
  if(__plan2d.dragWindow){
        var dw = __plan2d.dragWindow; var we = __plan2d.elements[dw.index];
        if(we && we.type==='window' && typeof we.host==='number'){
          var host = __plan2d.elements[we.host];
          if(host && host.type==='wall'){
            var t = plan2dProjectParamOnWall(p, host);
            if(dw.end==='t0') we.t0 = t; else we.t1 = t;
            plan2dDraw();
            plan2dEdited();
          }
        }
  } else if(__plan2d.dragDoor){
        var dd = __plan2d.dragDoor; var de = __plan2d.elements[dd.index];
        if(de && de.type==='door'){
          if(typeof de.host==='number'){
            var dhost = __plan2d.elements[de.host];
            if(dhost && dhost.type==='wall'){
              var t = plan2dProjectParamOnWall(p, dhost);
              if(dd.end==='t0') de.t0 = t; else if(dd.end==='t1') de.t1 = t;
              plan2dDraw();
              plan2dEdited();
            }
          } else {
            // Free door: move endpoint directly
            if(dd.end==='a'){ de.x0 = p.x; de.y0 = p.y; }
            if(dd.end==='b'){ de.x1 = p.x; de.y1 = p.y; }
            plan2dDraw(); plan2dEdited();
          }
        }
  } else if(__plan2d.dragDoorWhole){
        var dh = __plan2d.dragDoorWhole; var deh = __plan2d.elements[dh.index];
        var hosth = __plan2d.elements[dh.host];
        if(deh && hosth && hosth.type==='wall'){
          var tNow = plan2dProjectParamOnWall(p, hosth);
          var delta = (tNow - dh.startMouseT) || 0;
          var t0new = (dh.startT0 || 0) + delta;
          var t1new = (dh.startT1 || 0) + delta;
          // Preserve span and clamp to [0,1]
          var tmin = Math.min(t0new, t1new), tmax = Math.max(t0new, t1new);
          var span = Math.max(0, tmax - tmin);
          if(tmin < 0){ tmin = 0; tmax = span; }
          if(tmax > 1){ tmax = 1; tmin = 1 - span; }
          // Assign back preserving original ordering
          if((dh.startT0||0) <= (dh.startT1||0)) { deh.t0 = tmin; deh.t1 = tmax; }
          else { deh.t0 = tmax; deh.t1 = tmin; }
          plan2dDraw();
          plan2dDraw(); plan2dEdited();
        }
      } else if(__plan2d.dragWall){
        var dwl = __plan2d.dragWall; var w = __plan2d.elements[dwl.index]; if(w && w.type==='wall'){
          // Keep orientation axis-locked and snap to grid; join will be handled on mouseup
          if(dwl.end==='a'){
            if(dwl.orient==='h'){ w.x0 = plan2dSnap(p.x); w.y0 = w.y1 = plan2dSnap(w.y0); }
            else { w.y0 = plan2dSnap(p.y); w.x0 = w.x1 = plan2dSnap(w.x0); }
          } else {
            if(dwl.orient==='h'){ w.x1 = plan2dSnap(p.x); w.y1 = w.y0 = plan2dSnap(w.y1); }
            else { w.y1 = plan2dSnap(p.y); w.x1 = w.x0 = plan2dSnap(w.x1); }
          }
          plan2dDraw(); plan2dEdited();
        }
      } else if(__plan2d.start){ __plan2d.last=p; plan2dDraw(); plan2dEdited(); }
      else if(__plan2d.tool==='erase'){ plan2dHoverErase(p); }
    });
    window.addEventListener('mouseup', function(){
      if(!__plan2d.active) return;
  // marker drag removed
  if(__plan2d.dragWindow){ __plan2d.dragWindow=null; updatePlan2DInfo(); plan2dEdited(); }
    if(__plan2d.dragDoor){ __plan2d.dragDoor=null; updatePlan2DInfo(); plan2dEdited(); }
    if(__plan2d.dragDoorWhole){ __plan2d.dragDoorWhole=null; updatePlan2DInfo(); plan2dEdited(); }
      // If click without drag on door/window segment was pending, select it
      if(__plan2d.maybeDragDoorWhole && typeof __plan2d.pendingSelectIndex==='number'){
        __plan2d.selectedIndex = __plan2d.pendingSelectIndex;
        __plan2d.pendingSelectIndex = null; __plan2d.maybeDragDoorWhole = null; plan2dDraw(); updatePlan2DInfo(); return;
      }
      if(typeof __plan2d.pendingSelectIndex==='number'){
        __plan2d.selectedIndex = __plan2d.pendingSelectIndex;
        __plan2d.pendingSelectIndex = null; plan2dDraw(); updatePlan2DInfo(); return;
      }
      if(__plan2d.dragWall){ __plan2d.dragWall=null; plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); }
      else if(__plan2d.start && __plan2d.last){
        // If it was a short click (no real drag), treat as selection even if not in 'select' tool
        var dx = __plan2d.last.x - __plan2d.start.x, dy = __plan2d.last.y - __plan2d.start.y;
        var moved = Math.hypot(dx, dy);
        if(moved < 0.02){ // ~2cm in plan units
          __plan2d.selectedSubsegment = null; plan2dSelectAt(__plan2d.last);
        } else {
          var a=__plan2d.start, b=__plan2d.last; __plan2d.selectedSubsegment = null; plan2dFinalize(a,b); plan2dAutoSnapAndJoin(); updatePlan2DInfo(); plan2dEdited();
        }
      }
      __plan2d.start=null; __plan2d.last=null; plan2dDraw();
    });
    // Delete selected via keyboard (capture-phase to prevent global handlers)
    if(!window.__plan2dKeydown){
      window.__plan2dKeydown = function(ev){
        if(!__plan2d.active) return;
        var key = ev.key;
        if(key==='Delete' || key==='Backspace'){
          // Only delete when an explicit selection exists
          if(__plan2d.selectedSubsegment){
            var ok = plan2dDeleteSelectedSubsegment();
            if(ok){ __plan2d.selectedSubsegment=null; plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return; }
          }
          if(__plan2d.selectedIndex>=0){
            __plan2d.elements.splice(__plan2d.selectedIndex,1);
            __plan2d.selectedIndex=-1; __plan2d.selectedSubsegment=null; plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return;
          }
          updateStatus && updateStatus('Select a door, window, or wall segment first');
          ev.preventDefault(); ev.stopPropagation(); return;
        }
        // Door hinge/swing toggles when a door is selected
        if(__plan2d.selectedIndex>=0){
          var selEl = __plan2d.elements[__plan2d.selectedIndex];
          if(selEl && selEl.type==='door'){
            selEl.meta = selEl.meta || { hinge:'t0', swing:'in' };
            if(key==='h' || key==='H'){
              selEl.meta.hinge = (selEl.meta.hinge==='t0' ? 't1' : 't0');
              plan2dDraw(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return;
            }
            if(key==='f' || key==='F'){
              selEl.meta.swing = (selEl.meta.swing==='in' ? 'out' : 'in');
              plan2dDraw(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return;
            }
          }
        }
        // Arrow keys nudge selected element(s) by gridStep
        var step = __plan2d.gridStep || 0.5;
        var dx=0, dy=0; if(key==='ArrowLeft') dx=-step; else if(key==='ArrowRight') dx=step; else if(key==='ArrowUp') dy=step; else if(key==='ArrowDown') dy=-step;
        if(dx!==0 || dy!==0){
          var moved=false; var els=__plan2d.elements||[];
          if(__plan2d.selectedIndex>=0){
            var e = els[__plan2d.selectedIndex];
            if(e){
              if(e.type==='wall'){
                e.x0=plan2dSnap(e.x0+dx); e.y0=plan2dSnap(e.y0+dy); e.x1=plan2dSnap(e.x1+dx); e.y1=plan2dSnap(e.y1+dy);
                moved=true;
              } else if(typeof e.host==='number'){
                // Nudge along wall direction
                var host=els[e.host]; if(host && host.type==='wall'){
                  var dirx=(host.x1-host.x0), diry=(host.y1-host.y0); var len=Math.hypot(dirx,diry)||1; dirx/=len; diry/=len;
                  // Project the dx,dy onto wall axis to get delta meters
                  var delta = (dx*dirx + dy*diry);
                  e.t0 = plan2dSnapTOnWall(host, (e.t0||0) + (delta/len));
                  e.t1 = plan2dSnapTOnWall(host, (e.t1||0) + (delta/len));
                  moved=true;
                }
              } else {
                e.x0=plan2dSnap((e.x0||0)+dx); e.y0=plan2dSnap((e.y0||0)+dy); e.x1=plan2dSnap((e.x1||0)+dx); e.y1=plan2dSnap((e.y1||0)+dy);
                moved=true;
              }
            }
          }
          if(moved){ plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); ev.preventDefault(); ev.stopPropagation(); return; }
        }
      };
      // Use capture=true so this runs before document-level handlers
      document.addEventListener('keydown', window.__plan2dKeydown, true);
    }
  }
  plan2dCursor();
}
function plan2dUnbind(){ try{ if(window.__plan2dResize) window.removeEventListener('resize', window.__plan2dResize); if(window.__plan2dKeydown) document.removeEventListener('keydown', window.__plan2dKeydown, true); }catch(e){} }

function plan2dResize(){ var c=document.getElementById('plan2d-canvas'); var ov=document.getElementById('plan2d-overlay'); if(!c||!ov) return; var rect=c.getBoundingClientRect(); var dpr=window.devicePixelRatio||1; var W=Math.floor(rect.width*dpr), H=Math.floor(rect.height*dpr); if(c.width!==W||c.height!==H){ c.width=W; c.height=H; ov.width=W; ov.height=H; } }
function plan2dCursor(){ var c=document.getElementById('plan2d-canvas'); if(!c) return; c.style.cursor = (__plan2d.tool==='erase') ? 'not-allowed' : (__plan2d.tool==='select' ? 'pointer' : 'crosshair'); }

function plan2dFinalize(a,b){ if(!a||!b) return; // snap to straight axis
  var dx=b.x-a.x, dy=b.y-a.y; if(Math.abs(dx)>Math.abs(dy)) b.y=a.y; else b.x=a.x; var len=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2); if(len<0.05) return; if(__plan2d.tool==='wall'){ __plan2d.elements.push({type:'wall', x0:a.x,y0:a.y,x1:b.x,y1:b.y, thickness:__plan2d.wallThicknessM}); } else if(__plan2d.tool==='window'){ __plan2d.elements.push({type:'window', x0:a.x,y0:a.y,x1:b.x,y1:b.y, thickness:__plan2d.wallThicknessM}); } else if(__plan2d.tool==='door'){ __plan2d.elements.push({type:'door', x0:a.x,y0:a.y,x1:b.x,y1:b.y, thickness:0.9, meta:{hinge:'left'}}); } plan2dEdited(); }

function plan2dDraw(){ var c=document.getElementById('plan2d-canvas'); var ov=document.getElementById('plan2d-overlay'); if(!c||!ov) return; var ctx=c.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,c.width,c.height);
  // Grid (1m)
  var step=__plan2d.scale, w=c.width, h=c.height; ctx.lineWidth=1; ctx.strokeStyle='rgba(255,255,255,0.04)';
  for(var x=w/2 % step; x<w; x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(var y=h/2 % step; y<h; y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  // Elements
  // Precompute connections at endpoints to extend walls and make corners flush
  var elems=__plan2d.elements;
  // Precompute wall intersections to enable sub-segment selection/deletion
  var __wallIntersections = plan2dComputeWallIntersections(elems);
  var startConn=new Array(elems.length).fill(false), endConn=new Array(elems.length).fill(false);
  (function(){
    function key(x,y){ return (Math.round(x*1000))+','+(Math.round(y*1000)); }
    var map={};
    for(var i=0;i<elems.length;i++){
      var e=elems[i]; if(e.type!=='wall') continue;
      var ks=key(e.x0,e.y0), ke=key(e.x1,e.y1);
      (map[ks]||(map[ks]=[])).push({i:i,end:'s'});
      (map[ke]||(map[ke]=[])).push({i:i,end:'e'});
    }
    Object.keys(map).forEach(function(k){ var arr=map[k]; if(arr.length>1){ for(var j=0;j<arr.length;j++){ if(arr[j].end==='s') startConn[arr[j].i]=true; else endConn[arr[j].i]=true; } } });
  })();
  for(var i=0;i<elems.length;i++){
    var el=elems[i];
    var ax=el.x0, ay=el.y0, bx=el.x1, by=el.y1;
    // Compute dynamic endpoints for host-anchored windows
    var isHostWindow = (el.type==='window' && typeof el.host==='number');
    if(isHostWindow){
      var host = elems[el.host];
      if(!host || host.type!=='wall'){ continue; }
      var hx0=host.x0, hy0=host.y0, hx1=host.x1, hy1=host.y1;
      var t0 = Math.max(0, Math.min(1, el.t0||0));
      var t1 = Math.max(0, Math.min(1, el.t1||0));
      ax = hx0 + (hx1-hx0)*t0; ay = hy0 + (hy1-hy0)*t0;
      bx = hx0 + (hx1-hx0)*t1; by = hy0 + (hy1-hy0)*t1;
    }
    if(el.type==='wall'){
      // Compute original endpoints and thickness
      var origAx = el.x0, origAy = el.y0, origBx = el.x1, origBy = el.y1;
      var wdx0 = origBx - origAx, wdy0 = origBy - origAy; var wLen0 = Math.hypot(wdx0, wdy0) || 1;
      var dirx = wdx0 / wLen0, diry = wdy0 / wLen0;
      var thick = (el.thickness||__plan2d.wallThicknessM);
      var halfW = thick/2;
      // Build void spans (windows and doors) in t-space [0,1]
      var spans = [];
      for(var wi=0; wi<elems.length; wi++){
        var oEl = elems[wi]; if(oEl.type!=='window' && oEl.type!=='door') continue;
        if(typeof oEl.host==='number' && oEl.host===i){
          var ot0 = Math.max(0, Math.min(1, oEl.t0||0));
          var ot1 = Math.max(0, Math.min(1, oEl.t1||0));
          if(ot1 < ot0){ var tmpo=ot0; ot0=ot1; ot1=tmpo; }
          spans.push([ot0, ot1]);
        } else {
          // Free opening: if it lies along this wall, treat as void
          var tA = plan2dProjectParamOnWall({x:oEl.x0, y:oEl.y0}, el);
          var tB = plan2dProjectParamOnWall({x:oEl.x1, y:oEl.y1}, el);
          // Check that both endpoints are near the wall centerline
          var nearTol = halfW + 0.05; // meters
          function pointWallDist(px,py){ var dx=origBx-origAx, dy=origBy-origAy; var denom=(dx*dx+dy*dy)||1; var t=((px-origAx)*dx+(py-origAy)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=origAx+t*dx, cy=origAy+t*dy; return Math.hypot(px-cx, py-cy); }
          var dA = pointWallDist(oEl.x0,oEl.y0), dB = pointWallDist(oEl.x1,oEl.y1);
          if(dA <= nearTol && dB <= nearTol){
            var s0 = Math.max(0, Math.min(1, Math.min(tA,tB)));
            var s1 = Math.max(0, Math.min(1, Math.max(tA,tB)));
            if(s1 > s0 + 1e-4) spans.push([s0,s1]);
          }
        }
      }
      // Live preview: carve a temporary gap where a door/window would be placed before element creation
      if(__plan2d.mouse && !__plan2d.dragWindow && !__plan2d.dragDoor && !__plan2d.dragDoorWhole && !__plan2d.start){
        var cPt = __plan2d.mouse; // screen-space
        var pWorld = screenToWorld2D(cPt.x, cPt.y);
        var near = plan2dFindNearestWall(pWorld, 0.3);
        if(near && typeof near.index==='number' && near.index===i){
          var tHover = plan2dProjectParamOnWall(pWorld, el);
          if(__plan2d.tool==='door'){
            var halfT = ((__plan2d.doorWidthM||0.87) / 2) / wLen0; var t0p=tHover-halfT, t1p=tHover+halfT;
            if(t1p>t0p){ t0p=Math.max(0,t0p); t1p=Math.min(1,t1p); if(t1p>t0p+1e-6) spans.push([t0p,t1p]); }
          } else if(__plan2d.tool==='window'){
            var wPreview = (__plan2d.windowDefaultWidthM||1.2);
            var halfTw = (wPreview/2)/wLen0; var t0w=tHover-halfTw, t1w=tHover+halfTw;
            if(t1w>t0w){ t0w=Math.max(0,t0w); t1w=Math.min(1,t1w); if(t1w>t0w+1e-6) spans.push([t0w,t1w]); }
          }
        }
      }
      // Merge spans
      spans.sort(function(A,B){ return A[0]-B[0]; });
      var merged=[]; for(var si=0; si<spans.length; si++){ var s=spans[si]; if(merged.length===0) merged.push(s); else { var last=merged[merged.length-1]; if(s[0] <= last[1] + 1e-4){ last[1] = Math.max(last[1], s[1]); } else { merged.push([s[0], s[1]]);} } }
      // Create solid segments as complement of merged spans
      var solids=[]; var cursorT=0; for(var mi=0; mi<merged.length; mi++){ var vs=merged[mi]; if(vs[0] > cursorT + 1e-4) solids.push([cursorT, vs[0]]); cursorT = Math.max(cursorT, vs[1]); }
      if(cursorT < 1 - 1e-4) solids.push([cursorT, 1]);
      // Convert each solid segment to world endpoints, applying flush extension only at outer ends
      for(var sj=0; sj<solids.length; sj++){
        var s0 = solids[sj][0], s1 = solids[sj][1];
        var sx0 = origAx + dirx * (s0 * wLen0), sy0 = origAy + diry * (s0 * wLen0);
        var sx1 = origAx + dirx * (s1 * wLen0), sy1 = origAy + diry * (s1 * wLen0);
        // Extend only if this touches the true ends
        var touchesStart = (s0 <= 1e-4) && startConn[i];
        var touchesEnd   = (s1 >= 1 - 1e-4) && endConn[i];
        if(touchesStart){ sx0 -= dirx * halfW; sy0 -= diry * halfW; }
        if(touchesEnd){   sx1 += dirx * halfW; sy1 += diry * halfW; }
        var aSeg = worldToScreen2D(sx0, sy0); var bSeg = worldToScreen2D(sx1, sy1);
        var dxs=bSeg.x-aSeg.x, dys=bSeg.y-aSeg.y; var Ls=Math.sqrt(dxs*dxs+dys*dys)||1; var nx=-dys/Ls, ny=dxs/Ls; var halfPx=(thick*__plan2d.scale)/2;
        ctx.beginPath(); ctx.fillStyle='#e5e7eb'; ctx.strokeStyle='#334155'; ctx.lineWidth=__plan2d.wallStrokePx;
        ctx.moveTo(aSeg.x+nx*halfPx,aSeg.y+ny*halfPx); ctx.lineTo(bSeg.x+nx*halfPx,bSeg.y+ny*halfPx); ctx.lineTo(bSeg.x-nx*halfPx,bSeg.y-ny*halfPx); ctx.lineTo(aSeg.x-nx*halfPx,aSeg.y-ny*halfPx); ctx.closePath(); ctx.fill(); ctx.stroke();

        // (Removed) Inline segment length label/pill inside wall polygon
  // Live preview: carve a temporary gap where a door/window would be placed before element creation
      }
      // Skip default solid wall draw since we've drawn segments
      continue;
    }
    var a=worldToScreen2D(ax,ay), b=worldToScreen2D(bx,by);
    if(el.type==='window'){
      // Draw window as outline-only rectangle (no fill) at wall thickness and a center blue line
      var dxw=b.x-a.x, dyw=b.y-a.y; var Lw=Math.sqrt(dxw*dxw+dyw*dyw)||1; var nxw=-dyw/Lw, nyw=dxw/Lw;
      // Thickness: inherit from host wall if present, else element thickness or default
      var thickM = isHostWindow ? ( (elems[el.host].thickness||__plan2d.wallThicknessM) ) : (el.thickness||__plan2d.wallThicknessM);
      var halfw=(thickM*__plan2d.scale)/2;
      // Outline rectangle only
      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.moveTo(a.x+nxw*halfw,a.y+nyw*halfw);
      ctx.lineTo(b.x+nxw*halfw,b.y+nyw*halfw);
      ctx.lineTo(b.x-nxw*halfw,b.y-nyw*halfw);
      ctx.lineTo(a.x-nxw*halfw,a.y-nyw*halfw);
      ctx.closePath();
      ctx.stroke();
      // Center blue line
      ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // Endpoint handles for editing when selected or in window tool
      if((__plan2d.tool==='window' || (__plan2d.tool==='select' && i===__plan2d.selectedIndex))){
        var handleR=5;
        ctx.fillStyle='#38bdf8';
        ctx.beginPath(); ctx.arc(a.x,a.y,handleR,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x,b.y,handleR,0,Math.PI*2); ctx.fill();
      }
    } else if(el.type==='door'){
      // Door rendering: compute endpoints (host-anchored or free)
      var isHostDoor = (typeof el.host==='number');
      var worldA = null, worldB = null;
      if(isHostDoor){
        var hostD = elems[el.host];
        if(hostD && hostD.type==='wall'){
          var t0d = Math.max(0, Math.min(1, el.t0||0));
          var t1d = Math.max(0, Math.min(1, el.t1||0));
          worldA = { x: hostD.x0 + (hostD.x1-hostD.x0)*t0d, y: hostD.y0 + (hostD.y1-hostD.y0)*t0d };
          worldB = { x: hostD.x0 + (hostD.x1-hostD.x0)*t1d, y: hostD.y0 + (hostD.y1-hostD.y0)*t1d };
          a = worldToScreen2D(worldA.x, worldA.y); b = worldToScreen2D(worldB.x, worldB.y);
        }
      } else {
        worldA = { x: el.x0, y: el.y0 }; worldB = { x: el.x1, y: el.y1 };
      }
      // Draw door as a jamb line plus a 90-degree swing arc based on hinge + swing
      ctx.save(); ctx.strokeStyle='#22c55e'; ctx.lineWidth=2;
      // Jamb line (opening)
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      // Determine hinge side and swing direction
      var hinge = (el.meta && el.meta.hinge) || 't0';
      var swing = (el.meta && el.meta.swing) || 'in'; // 'in' or 'out'
      var hPt = (hinge==='t0') ? a : b;
      var other = (hinge==='t0') ? b : a;
      var ang=Math.atan2(other.y-hPt.y, other.x-hPt.x);
      var r=Math.hypot(other.x-hPt.x, other.y-hPt.y);
      // Swing orientation: default arc 90° CCW; flip direction for swing='out'
      var startAng = ang;
      var endAng = ang + (swing==='out' ? -Math.PI/2 : Math.PI/2);
      ctx.beginPath();
      ctx.arc(hPt.x, hPt.y, r, startAng, endAng, (swing==='out'));
      ctx.stroke();
      // Endpoint handles when editing
      if((__plan2d.tool==='door' || (__plan2d.tool==='select' && i===__plan2d.selectedIndex))){
        var handleR=5; ctx.fillStyle='#22c55e';
        ctx.beginPath(); ctx.arc(a.x,a.y,handleR,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x,b.y,handleR,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }
  // Stairs are rendered on the overlay canvas only. Removed base-canvas stairs to avoid duplicates.

  // Color-coded overlays for pergola, garage, and balcony using world coords -> plan mapping
  try {
    if (__plan2d && __plan2d.active) {
      // Draw stairs footprint on the base canvas (authoritative rendering)
      try {
        if (stairsComponent) {
          var lvlNow = (typeof currentFloor==='number' ? currentFloor : 0);
          var stairsLvl = (typeof stairsComponent.level==='number' ? stairsComponent.level : 0);
          var sgnSt = (__plan2d.yFromWorldZSign || 1);
          var rotSt = ((stairsComponent.rotation || 0) * Math.PI) / 180;
          var hwSt = (stairsComponent.width || 0)/2;
          var hdSt = (stairsComponent.depth || 0)/2;
          function rotStW(px, pz){ var dx=px - stairsComponent.x, dz=pz - stairsComponent.z; return { x: stairsComponent.x + dx*Math.cos(rotSt) - dz*Math.sin(rotSt), z: stairsComponent.z + dx*Math.sin(rotSt) + dz*Math.cos(rotSt) }; }
          var s1 = rotStW(stairsComponent.x - hwSt, stairsComponent.z - hdSt);
          var s2 = rotStW(stairsComponent.x + hwSt, stairsComponent.z - hdSt);
          var s3 = rotStW(stairsComponent.x + hwSt, stairsComponent.z + hdSt);
          var s4 = rotStW(stairsComponent.x - hwSt, stairsComponent.z + hdSt);
          function mapPlanSt(p){ return { x: (p.x - __plan2d.centerX), y: sgnSt * (p.z - __plan2d.centerZ) }; }
          var sp1 = worldToScreen2D(mapPlanSt(s1).x, mapPlanSt(s1).y);
          var sp2 = worldToScreen2D(mapPlanSt(s2).x, mapPlanSt(s2).y);
          var sp3 = worldToScreen2D(mapPlanSt(s3).x, mapPlanSt(s3).y);
          var sp4 = worldToScreen2D(mapPlanSt(s4).x, mapPlanSt(s4).y);
          ctx.save();
          ctx.globalAlpha = (stairsLvl === lvlNow) ? 0.95 : 0.35;
          ctx.fillStyle = (stairsLvl === lvlNow) ? 'rgba(15,23,42,0.10)' : 'rgba(15,23,42,0.06)';
          ctx.strokeStyle = (stairsLvl === lvlNow) ? '#334155' : '#94a3b8';
          // Increase stairs keyline stroke by +5px over previous values
          ctx.lineWidth = (stairsLvl === lvlNow) ? 11 : 10;
          ctx.beginPath(); ctx.moveTo(sp1.x, sp1.y); ctx.lineTo(sp2.x, sp2.y); ctx.lineTo(sp3.x, sp3.y); ctx.lineTo(sp4.x, sp4.y); ctx.closePath(); ctx.fill(); ctx.stroke();
          // Draw a few treads for orientation
          try {
            var stepsSt = Math.max(1, Math.floor(stairsComponent.steps || 12));
            for (var siSt = 1; siSt < stepsSt; siSt++) {
              var tt = siSt / stepsSt; var zW = stairsComponent.z - hdSt + tt * (stairsComponent.depth || 0);
              var aW = rotStW(stairsComponent.x - hwSt, zW); var bW = rotStW(stairsComponent.x + hwSt, zW);
              var aS = worldToScreen2D(mapPlanSt(aW).x, mapPlanSt(aW).y);
              var bS = worldToScreen2D(mapPlanSt(bW).x, mapPlanSt(bW).y);
              ctx.beginPath(); ctx.strokeStyle = 'rgba(100,116,139,0.9)'; ctx.lineWidth = 1; ctx.moveTo(aS.x, aS.y); ctx.lineTo(bS.x, bS.y); ctx.stroke();
            }
          } catch(e) { /* ignore */ }
          ctx.restore();
        }
      } catch(e) { /* base stairs draw non-fatal */ }

      var lvlNowC = (typeof currentFloor==='number' ? currentFloor : 0);
      var sgnC = (__plan2d.yFromWorldZSign || 1);
      function mapPlanXY(wx, wz){ return worldToScreen2D((wx - __plan2d.centerX), sgnC * (wz - __plan2d.centerZ)); }
      function drawBox(x, z, w, d, rotDeg, stroke, fill, alpha) {
        var rot = ((rotDeg||0) * Math.PI) / 180; var hw=w/2, hd=d/2;
        function r(px,pz){ var dx=px-x, dz=pz-z; return { x: x + dx*Math.cos(rot) - dz*Math.sin(rot), z: z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
        var c1=r(x-hw,z-hd), c2=r(x+hw,z-hd), c3=r(x+hw,z+hd), c4=r(x-hw,z+hd);
        var p1=mapPlanXY(c1.x,c1.z), p2=mapPlanXY(c2.x,c2.z), p3=mapPlanXY(c3.x,c3.z), p4=mapPlanXY(c4.x,c4.z);
        ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = fill;
        ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y); ctx.closePath(); ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.restore();
      }
      // Ground floor: pergola + garage
      if (lvlNowC === 0) {
        for (var iPg=0;iPg<pergolaComponents.length;iPg++){
          var per=pergolaComponents[iPg];
          // Avoid duplicate outline: pergola walls already provide edges. Use fill only (no stroke).
          drawBox(per.x, per.z, per.width, per.depth, per.rotation||0, null, 'rgba(16,185,129,0.15)', 0.95);
        }
        for (var iGg=0;iGg<garageComponents.length;iGg++){
          var gar=garageComponents[iGg];
          drawBox(gar.x, gar.z, gar.width, gar.depth, gar.rotation||0, '#f59e0b', 'rgba(245,158,11,0.15)', 0.95);
        }
      }
      // First floor: balcony
      if (lvlNowC === 1) {
        for (var iBl=0;iBl<balconyComponents.length;iBl++){
          var bal=balconyComponents[iBl]; if((bal.level||1)!==1) continue;
          drawBox(bal.x, bal.z, bal.width, bal.depth, bal.rotation||0, '#6366f1', 'rgba(99,102,241,0.18)', 0.95);
        }
      }
    }
  } catch(e) { /* overlay draw for components is non-fatal */ }

  // Preview during drag
  if(__plan2d.start && __plan2d.last){
    var a=worldToScreen2D(__plan2d.start.x,__plan2d.start.y);
    var b=worldToScreen2D(__plan2d.last.x,__plan2d.last.y);
    var dx=b.x-a.x, dy=b.y-a.y;
    if(Math.abs(dx)>Math.abs(dy)) b.y=a.y; else b.x=a.x;
    if(__plan2d.tool==='wall'){
      var L2=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2)||1;
      var nx2=-(b.y-a.y)/L2, ny2=(b.x-a.x)/L2; var half2=(__plan2d.wallThicknessM*__plan2d.scale)/2;
      ctx.beginPath(); ctx.fillStyle='rgba(226,232,240,0.55)'; ctx.strokeStyle='#64748b'; ctx.setLineDash([6,4]);
      ctx.moveTo(a.x+nx2*half2,a.y+ny2*half2); ctx.lineTo(b.x+nx2*half2,b.y+ny2*half2); ctx.lineTo(b.x-nx2*half2,b.y-ny2*half2); ctx.lineTo(a.x-nx2*half2,a.y-ny2*half2); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  // (Removed) Live measurement label centered inside the preview wall
    } else if(__plan2d.tool==='window'){
      ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.setLineDash([4,3]); ctx.lineWidth=2; ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.setLineDash([]);
  // (Removed) Live window measurement label along the preview line
    }
  }

  // Live label while dragging a window endpoint (host-anchored)
  if(__plan2d.dragWindow){
  // (Removed) Live label while dragging a window endpoint (host-anchored)
  }
  // Hover erase highlight
  if(__plan2d.tool==='erase' && __plan2d.hoverIndex>=0){ var e=__plan2d.elements[__plan2d.hoverIndex]; var a2=worldToScreen2D(e.x0,e.y0), b2=worldToScreen2D(e.x1,e.y1); ctx.beginPath(); ctx.strokeStyle='#ef4444'; ctx.lineWidth=3; ctx.setLineDash([4,4]); ctx.moveTo(a2.x,a2.y); ctx.lineTo(b2.x,b2.y); ctx.stroke(); ctx.setLineDash([]); }
  // Hover highlights in Select tool for feedback
  if(__plan2d.tool==='select'){
    // Door/window segment hover
    if(typeof __plan2d.hoverDoorIndex==='number' && __plan2d.hoverDoorIndex>=0){
      var deh = __plan2d.elements[__plan2d.hoverDoorIndex];
      if(deh){
        var ax,ay,bx,by; if(typeof deh.host==='number'){ var host=__plan2d.elements[deh.host]; if(host){ var t0=Math.max(0,Math.min(1,deh.t0||0)), t1=Math.max(0,Math.min(1,deh.t1||0)); ax=host.x0+(host.x1-host.x0)*t0; ay=host.y0+(host.y1-host.y0)*t0; bx=host.x0+(host.x1-host.x0)*t1; by=host.y0+(host.y1-host.y0)*t1; } }
        if(ax===undefined){ ax=deh.x0; ay=deh.y0; bx=deh.x1; by=deh.y1; }
        var aS=worldToScreen2D(ax,ay), bS=worldToScreen2D(bx,by); ctx.beginPath(); ctx.strokeStyle='#10b981'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(aS.x,aS.y); ctx.lineTo(bS.x,bS.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if(typeof __plan2d.hoverWindowIndex==='number' && __plan2d.hoverWindowIndex>=0){
      var weH = __plan2d.elements[__plan2d.hoverWindowIndex]; if(weH){ var axw,ayw,bxw,byw; if(typeof weH.host==='number'){ var wh=__plan2d.elements[weH.host]; if(wh){ var t0w=Math.max(0,Math.min(1,weH.t0||0)), t1w=Math.max(0,Math.min(1,weH.t1||0)); axw=wh.x0+(wh.x1-wh.x0)*t0w; ayw=wh.y0+(wh.y1-wh.y0)*t0w; bxw=wh.x0+(wh.x1-wh.x0)*t1w; byw=wh.y0+(wh.y1-wh.y0)*t1w; } } if(axw===undefined){ axw=weH.x0; ayw=weH.y0; bxw=weH.x1; byw=weH.y1; } var aSw=worldToScreen2D(axw,ayw), bSw=worldToScreen2D(bxw,byw); ctx.beginPath(); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(aSw.x,aSw.y); ctx.lineTo(bSw.x,bSw.y); ctx.stroke(); ctx.setLineDash([]);} }
    // Wall subsegment hover
    if(__plan2d.hoverSubsegment && __plan2d.hoverDoorIndex<0 && __plan2d.hoverWindowIndex<0){ var hs=__plan2d.hoverSubsegment; var aH=worldToScreen2D(hs.ax,hs.ay), bH=worldToScreen2D(hs.bx,hs.by); ctx.beginPath(); ctx.strokeStyle='#f97316'; ctx.lineWidth=4; ctx.setLineDash([8,4]); ctx.moveTo(aH.x,aH.y); ctx.lineTo(bH.x,bH.y); ctx.stroke(); ctx.setLineDash([]); }
  }
  // Selection highlight
  if(__plan2d.selectedIndex>=0){
    var se=__plan2d.elements[__plan2d.selectedIndex];
    var sx0=se.x0, sy0=se.y0, sx1=se.x1, sy1=se.y1;
    if(se && (se.type==='window' || se.type==='door') && typeof se.host==='number'){
      var hostSel = __plan2d.elements[se.host];
      if(hostSel && hostSel.type==='wall'){
        var tt0=Math.max(0,Math.min(1,se.t0||0)), tt1=Math.max(0,Math.min(1,se.t1||0));
        sx0 = hostSel.x0 + (hostSel.x1-hostSel.x0)*tt0; sy0 = hostSel.y0 + (hostSel.y1-hostSel.y0)*tt0;
        sx1 = hostSel.x0 + (hostSel.x1-hostSel.x0)*tt1; sy1 = hostSel.y0 + (hostSel.y1-hostSel.y0)*tt1;
      }
    }
    var sa=worldToScreen2D(sx0,sy0), sb=worldToScreen2D(sx1,sy1);
    ctx.beginPath(); ctx.strokeStyle='#10b981'; ctx.lineWidth=3; ctx.setLineDash([6,4]); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke(); ctx.setLineDash([]);
  }
  // Draw selected subsegment highlight if present
  if(__plan2d.selectedSubsegment && typeof __plan2d.selectedSubsegment.wallIndex==='number'){
    var ss = __plan2d.selectedSubsegment;
    var aS = worldToScreen2D(ss.ax, ss.ay), bS = worldToScreen2D(ss.bx, ss.by);
    ctx.save();
    ctx.beginPath(); ctx.strokeStyle = '#f97316'; ctx.lineWidth = 4; ctx.setLineDash([8,4]);
    ctx.moveTo(aS.x, aS.y); ctx.lineTo(bS.x, bS.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }
  var ox=ov.getContext('2d'); ox.setTransform(1,0,0,1,0,0); ox.clearRect(0,0,ov.width,ov.height);

  // Overlays: Stairs indicator (both floors) + small labels
  (function(){
    try{
      var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
      var cxW = (typeof __plan2d.centerX==='number'? __plan2d.centerX : 0);
      var czW = (typeof __plan2d.centerZ==='number'? __plan2d.centerZ : 0);
      var sgn = (__plan2d.yFromWorldZSign||1);
      ox.save();
      ox.restore();
    }catch(e){}
  })();

  // Debug overlay header
  if(__plan2d.debug){
    try {
      var dpr = window.devicePixelRatio || 1;
      ox.save();
      ox.font = '11px monospace';
      ox.textAlign = 'left';
      ox.textBaseline = 'top';
      ox.fillStyle = 'rgba(0,0,0,0.55)';
      ox.fillRect(8,8, 280, 40);
      ox.fillStyle = '#fde68a'; // amber-300
      var msg1 = 'c: '+c.width+'x'+c.height+'  ov: '+ov.width+'x'+ov.height;
      var msg2 = 'scale: '+__plan2d.scale+'  dpr: '+dpr.toFixed(2);
      ox.fillText(msg1, 12, 12);
      ox.fillText(msg2, 12, 28);
      ox.restore();
      if (console && console.debug) console.debug('[2D] c', c.width, c.height, 'ov', ov.width, ov.height, 'scale', __plan2d.scale, 'dpr', dpr);
    } catch(e){}
  }
  // Overlay: Compass rose (screen-space orientation consistent with 3D). +X = East (right). North (world +Z)
  // is up if __plan2d.yFromWorldZSign === 1, and down if it's -1.
  (function(){
    var pad = 16; var cx = pad + 22, cy = pad + 22; var r = 18;
    ox.save();
    // Outer circle
    ox.beginPath(); ox.arc(cx, cy, r, 0, Math.PI*2); ox.fillStyle='rgba(15,23,42,0.55)'; ox.fill();
    ox.strokeStyle='rgba(148,163,184,0.8)'; ox.lineWidth=1; ox.stroke();
    // Axes lines
    ox.strokeStyle='rgba(203,213,225,0.9)';
    ox.beginPath(); ox.moveTo(cx, cy-r+4); ox.lineTo(cx, cy+r-4); ox.stroke(); // N-S
    ox.beginPath(); ox.moveTo(cx-r+4, cy); ox.lineTo(cx+r-4, cy); ox.stroke(); // W-E
    // Arrowhead and labels respect orientation sign
    var sgn = (__plan2d.yFromWorldZSign||1);
    var northUp = (sgn===1);
    // Arrowhead for North
    if(northUp){
      ox.beginPath(); ox.moveTo(cx, cy-r+4); ox.lineTo(cx-4, cy-r+10); ox.lineTo(cx+4, cy-r+10); ox.closePath(); ox.fillStyle='rgba(59,130,246,0.95)'; ox.fill();
    } else {
      // North points down
      ox.beginPath(); ox.moveTo(cx, cy+r-4); ox.lineTo(cx-4, cy+r-10); ox.lineTo(cx+4, cy+r-10); ox.closePath(); ox.fillStyle='rgba(59,130,246,0.95)'; ox.fill();
    }
    // Labels N/E/S/W (flip N/S positions when sign=-1)
    ox.fillStyle='rgba(226,232,240,0.95)'; ox.font='11px sans-serif'; ox.textAlign='center'; ox.textBaseline='middle';
    var nY = northUp ? (cy - r - 8) : (cy + r + 8);
    var sY = northUp ? (cy + r + 8) : (cy - r - 8);
    ox.fillText('N', cx, nY);
    ox.fillText('S', cx, sY);
    ox.fillText('E', cx + r + 10, cy);
    ox.fillText('W', cx - r - 10, cy);
    ox.restore();
  })();

  // Overlay: corner wall markers (yellow ticks at connected corners)
  (function(){
    var elems = __plan2d.elements || [];
    if(!elems.length) return;
    __plan2d.__cornerMarkers = [];
    ox.save();
    ox.strokeStyle = '#facc15'; // yellow-400
    ox.lineWidth = 2;
    for(var i=0;i<elems.length;i++){
      var el = elems[i]; if(!el || el.type !== 'wall') continue;
      // Mirror wall geometry calculations used in main wall render
      var origAx = el.x0, origAy = el.y0, origBx = el.x1, origBy = el.y1;
      var wdx0 = origBx - origAx, wdy0 = origBy - origAy; var wLen0 = Math.hypot(wdx0, wdy0) || 1;
      var dirx = wdx0 / wLen0, diry = wdy0 / wLen0;
      var thick = (el.thickness||__plan2d.wallThicknessM);
      var halfW = thick/2;
      // Build void spans (windows/doors) in t-space [0,1]
      var spans = [];
      for(var wi=0; wi<elems.length; wi++){
        var oEl = elems[wi]; if(!oEl || (oEl.type!=='window' && oEl.type!=='door')) continue;
        if(typeof oEl.host==='number' && oEl.host===i){
          var ot0 = Math.max(0, Math.min(1, oEl.t0||0));
          var ot1 = Math.max(0, Math.min(1, oEl.t1||0));
          if(ot1 < ot0){ var tmpo=ot0; ot0=ot1; ot1=tmpo; }
          spans.push([ot0, ot1]);
        } else {
          // Free opening: include if near wall centerline
          var tA = plan2dProjectParamOnWall({x:oEl.x0, y:oEl.y0}, el);
          var tB = plan2dProjectParamOnWall({x:oEl.x1, y:oEl.y1}, el);
          var nearTol = halfW + 0.05; // meters
          function pointWallDist(px,py){ var dx=origBx-origAx, dy=origBy-origAy; var denom=(dx*dx+dy*dy)||1; var t=((px-origAx)*dx+(py-origAy)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=origAx+t*dx, cy=origAy+t*dy; return Math.hypot(px-cx, py-cy); }
          var dA = pointWallDist(oEl.x0,oEl.y0), dB = pointWallDist(oEl.x1,oEl.y1);
          if(dA <= nearTol && dB <= nearTol){ var s0=Math.max(0,Math.min(1,Math.min(tA,tB))); var s1=Math.max(0,Math.min(1,Math.max(tA,tB))); if(s1 > s0 + 1e-4) spans.push([s0,s1]); }
        }
      }
      // Merge spans
      spans.sort(function(A,B){ return A[0]-B[0]; });
      var merged=[]; for(var si=0; si<spans.length; si++){ var s=spans[si]; if(merged.length===0) merged.push(s); else { var last=merged[merged.length-1]; if(s[0] <= last[1] + 1e-4){ last[1] = Math.max(last[1], s[1]); } else { merged.push([s[0], s[1]]);} } }
      // Solid segments are the complement of merged voids
      var solids=[]; var cursorT=0; for(var mi=0; mi<merged.length; mi++){ var vs=merged[mi]; if(vs[0] > cursorT + 1e-4) solids.push([cursorT, vs[0]]); cursorT = Math.max(cursorT, vs[1]); }
      if(cursorT < 1 - 1e-4) solids.push([cursorT, 1]);
      // For each solid, compute screen-space normal and draw ticks at true corners
      for(var sj=0; sj<solids.length; sj++){
        var s0 = solids[sj][0], s1 = solids[sj][1];
        var sx0 = origAx + dirx * (s0 * wLen0), sy0 = origAy + diry * (s0 * wLen0);
        var sx1 = origAx + dirx * (s1 * wLen0), sy1 = origAy + diry * (s1 * wLen0);
        var touchesStart = (s0 <= 1e-4) && startConn[i];
        var touchesEnd   = (s1 >= 1 - 1e-4) && endConn[i];
        if(touchesStart){ sx0 -= dirx * halfW; sy0 -= diry * halfW; }
        if(touchesEnd){   sx1 += dirx * halfW; sy1 += diry * halfW; }
        // Debug: also compute base endpoints before extension
        var baseAS = worldToScreen2D(origAx + dirx * (s0 * wLen0), origAy + diry * (s0 * wLen0));
        var baseBS = worldToScreen2D(origAx + dirx * (s1 * wLen0), origAy + diry * (s1 * wLen0));
        var aS = worldToScreen2D(sx0, sy0); var bS = worldToScreen2D(sx1, sy1);
        var dxs = bS.x - aS.x, dys = bS.y - aS.y; var Ls = Math.hypot(dxs, dys) || 1;
        var nx = -dys / Ls, ny = dxs / Ls; var halfPx = (thick * __plan2d.scale) / 2;
        if(touchesStart){
          var keyS = i+':s'; var offS = __plan2d.debugCornerOffset[keyS] || {dx:0,dy:0};
          var ax1=aS.x + nx*halfPx + offS.dx, ay1=aS.y + ny*halfPx + offS.dy, ax2=aS.x - nx*halfPx + offS.dx, ay2=aS.y - ny*halfPx + offS.dy;
          ox.beginPath(); ox.moveTo(ax1, ay1); ox.lineTo(ax2, ay2); ox.stroke();
          // small draggable handle
          ox.fillStyle = '#fde047'; ox.beginPath(); ox.arc(aS.x + offS.dx, aS.y + offS.dy, 4, 0, Math.PI*2); ox.fill(); ox.fillStyle = '#facc15';
          __plan2d.__cornerMarkers.push({ key: keyS, i: i, end: 's', x: aS.x + offS.dx, y: aS.y + offS.dy, nx: nx, ny: ny, halfPx: halfPx });
        }
        if(touchesEnd){
          var keyE = i+':e'; var offE = __plan2d.debugCornerOffset[keyE] || {dx:0,dy:0};
          var bx1=bS.x + nx*halfPx + offE.dx, by1=bS.y + ny*halfPx + offE.dy, bx2=bS.x - nx*halfPx + offE.dx, by2=bS.y - ny*halfPx + offE.dy;
          ox.beginPath(); ox.moveTo(bx1, by1); ox.lineTo(bx2, by2); ox.stroke();
          ox.fillStyle = '#fde047'; ox.beginPath(); ox.arc(bS.x + offE.dx, bS.y + offE.dy, 4, 0, Math.PI*2); ox.fill(); ox.fillStyle = '#facc15';
          __plan2d.__cornerMarkers.push({ key: keyE, i: i, end: 'e', x: bS.x + offE.dx, y: bS.y + offE.dy, nx: nx, ny: ny, halfPx: halfPx });
        }
        if(__plan2d.debug){
          // draw small markers for base vs extended endpoints
          ox.save();
          ox.fillStyle = '#f0abfc'; // fuchsia-300 base
          ox.beginPath(); ox.arc(baseAS.x, baseAS.y, 2.5, 0, Math.PI*2); ox.fill();
          ox.beginPath(); ox.arc(baseBS.x, baseBS.y, 2.5, 0, Math.PI*2); ox.fill();
          ox.fillStyle = '#22d3ee'; // cyan-400 extended
          ox.beginPath(); ox.arc(aS.x, aS.y, 2.5, 0, Math.PI*2); ox.fill();
          ox.beginPath(); ox.arc(bS.x, bS.y, 2.5, 0, Math.PI*2); ox.fill();
          ox.restore();
        }
      }
    }
    ox.restore();
  })();

  // (Removed) Overlay: Wall orientation hint during wall drawing
  // (Removed) Overlay: live window width dimension label during drag or when selected

  // (Removed) Overlay: live wall dimension during drag
  // (Removed) Overlay: dimension lines for every wall
}
function plan2dHoverErase(p){ var best=-1, bestDist=0.25; for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; } } __plan2d.hoverIndex=best; plan2dDraw(); }
function plan2dEraseAt(p){
  // Prefer subsegment deletion if a wall subsegment is under cursor
  var segHit = plan2dHitWallSubsegment(p, 0.15);
  if(segHit){
    __plan2d.selectedSubsegment = segHit;
    if(plan2dDeleteSelectedSubsegment()){
      __plan2d.selectedSubsegment = null; __plan2d.hoverIndex=-1; plan2dAutoSnapAndJoin(); plan2dDraw(); updatePlan2DInfo(); plan2dEdited();
      return;
    }
  }
  // Fallback to whole element erase
  plan2dHoverErase(p);
  if(__plan2d.hoverIndex>=0){ __plan2d.elements.splice(__plan2d.hoverIndex,1); __plan2d.hoverIndex=-1; plan2dDraw(); updatePlan2DInfo(); plan2dEdited(); }
}
// Selection prefers windows if window tool is active; else any nearest element
function plan2dSelectAt(p){ var best=-1, bestDist=0.2; for(var i=0;i<__plan2d.elements.length;i++){ var e=__plan2d.elements[i]; var d=plan2dPointSegDist(p.x,p.y,e); if(d<bestDist){ bestDist=d; best=i; } } __plan2d.selectedIndex=best; plan2dDraw(); }
function plan2dPointSegDist(px,py,e){
  var x0=e.x0,y0=e.y0,x1=e.x1,y1=e.y1;
  if(e && e.type==='window' && typeof e.host==='number'){
    var host = __plan2d.elements && __plan2d.elements[e.host];
    if(host && host.type==='wall'){
      var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
      x0 = host.x0 + (host.x1-host.x0)*t0; y0 = host.y0 + (host.y1-host.y0)*t0;
      x1 = host.x0 + (host.x1-host.x0)*t1; y1 = host.y0 + (host.y1-host.y0)*t1;
    }
  }
  if(e && e.type==='door' && typeof e.host==='number'){
    var hostD = __plan2d.elements && __plan2d.elements[e.host];
    if(hostD && hostD.type==='wall'){
      var td0=Math.max(0,Math.min(1,e.t0||0)), td1=Math.max(0,Math.min(1,e.t1||0));
      x0 = hostD.x0 + (hostD.x1-hostD.x0)*td0; y0 = hostD.y0 + (hostD.y1-hostD.y0)*td0;
      x1 = hostD.x0 + (hostD.x1-hostD.x0)*td1; y1 = hostD.y0 + (hostD.y1-hostD.y0)*td1;
    }
  }
  var dx=x1-x0, dy=y1-y0; var denom=(dx*dx+dy*dy)||1; var t=((px-x0)*dx+(py-y0)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=x0+t*dx, cy=y0+t*dy; var ddx=px-cx, ddy=py-cy; return Math.sqrt(ddx*ddx+ddy*ddy);
}
// Project arbitrary point onto a wall; returns param t in [0,1]
function plan2dProjectParamOnWall(p, wall){ var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var denom=dx*dx+dy*dy||1; var t=((p.x-x0)*dx+(p.y-y0)*dy)/denom; return Math.max(0,Math.min(1,t)); }

// ===== Wall subsegment modeling (intersections and openings) =====
function plan2dComputeWallIntersections(elems){
  var walls = [];
  for(var i=0;i<elems.length;i++){ var e=elems[i]; if(e && e.type==='wall') walls.push({i:i, e:e}); }
  // Precompute param positions along each wall where intersections occur
  var map = {}; // wallIndex -> array of t in (0,1)
  function addT(idx, t){ if(t<=1e-6 || t>=1-1e-6) return; (map[idx]||(map[idx]=[])).push(t); }
  // Segment intersection for axis-aligned walls
  function segIntersect(ax,ay,bx,by,cx,cy,dx,dy){
    // Return intersection point if exists
    var min = Math.min, max=Math.max;
    var aH = Math.abs(ay-by) < 1e-6, cH = Math.abs(cy-dy) < 1e-6;
    if(aH && !cH){
      var y = ay; var x = cx; // vertical at x=cx
      if(x>=min(ax,bx)-1e-6 && x<=max(ax,bx)+1e-6 && y>=min(cy,dy)-1e-6 && y<=max(cy,dy)+1e-6){ return {x:x,y:y}; }
    } else if(!aH && cH){
      var y2 = cy; var x2 = ax; // vertical first wall
      if(x2>=min(cx,dx)-1e-6 && x2<=max(cx,dx)+1e-6 && y2>=min(ay,by)-1e-6 && y2<=max(ay,by)+1e-6){ return {x:x2,y:y2}; }
    } else if(aH && cH){
      // colinear horizontals: treat as no single intersection param; skip
    } else {
      // both vertical: skip
    }
    return null;
  }
  for(var a=0;a<walls.length;a++){
    for(var b=a+1;b<walls.length;b++){
      var wa=walls[a], wb=walls[b];
      var A=wa.e, B=wb.e;
      var P = segIntersect(A.x0,A.y0,A.x1,A.y1, B.x0,B.y0,B.x1,B.y1);
      if(P){
        // Add param positions along each wall
        var tA = plan2dProjectParamOnWall(P, A);
        var tB = plan2dProjectParamOnWall(P, B);
        addT(wa.i, tA); addT(wb.i, tB);
      }
    }
  }
  // Include endpoints implicitly for subsegment building (but we won't store endpoints in map)
  return map;
}

function plan2dBuildWallSubsegments(elems, wallIndex){
  var wall = elems[wallIndex]; if(!wall || wall.type!=='wall') return [];
  var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var dirx=dx/len, diry=dy/len;
  // Collect split params: intersections + openings
  var ts=[0,1];
  var interMap = plan2dComputeWallIntersections(elems);
  var list = interMap[wallIndex]||[];
  for(var i=0;i<list.length;i++){ ts.push(list[i]); }
  // Openings host on this wall: push their endpoints in t
  for(var ei=0; ei<elems.length; ei++){
    var el = elems[ei]; if(!el) continue;
    if((el.type==='window' || el.type==='door') && typeof el.host==='number' && el.host===wallIndex){
      var t0=Math.max(0,Math.min(1,el.t0||0)), t1=Math.max(0,Math.min(1,el.t1||0)); if(t0>t1){var tmp=t0;t0=t1;t1=tmp;}
      ts.push(t0, t1);
    }
  }
  // Dedup and sort
  ts = ts.filter(function(v){ return v>=0 && v<=1; }).sort(function(a,b){return a-b;});
  var uniq=[]; for(var k=0;k<ts.length;k++){ if(!uniq.length || Math.abs(ts[k]-uniq[uniq.length-1])>1e-6) uniq.push(ts[k]); }
  ts = uniq;
  // Build subsegments between consecutive t's, skipping zero-length and pure opening gaps
  var subs=[];
  for(var s=0;s<ts.length-1;s++){
    var tA = ts[s], tB = ts[s+1]; if(tB <= tA + 1e-6) continue;
    // Determine if this interval is void (fully inside an opening)
    var mid = (tA+tB)/2; var isVoid=false;
    for(var ei2=0; ei2<elems.length; ei2++){
      var el2=elems[ei2]; if(!el2) continue;
      if((el2.type==='window' || el2.type==='door') && typeof el2.host==='number' && el2.host===wallIndex){
        var a0=Math.min(el2.t0||0, el2.t1||0), a1=Math.max(el2.t0||0, el2.t1||0);
        if(mid>=a0-1e-6 && mid<=a1+1e-6){ isVoid=true; break; }
      }
    }
    if(isVoid) continue;
    var ax = x0 + dirx*(tA*len), ay = y0 + diry*(tA*len);
    var bx = x1 - dirx*((1-tB)*len), by = y1 - diry*((1-tB)*len);
    subs.push({ wallIndex: wallIndex, t0: tA, t1: tB, ax: ax, ay: ay, bx: bx, by: by });
  }
  return subs;
}

function plan2dHitWallSubsegment(p, tol){
  var elems = __plan2d.elements||[]; var best=null; var bestD = (typeof tol==='number'? tol : 0.15);
  for(var wi=0; wi<elems.length; wi++){
    var w = elems[wi]; if(!w || w.type!=='wall') continue;
    var subs = plan2dBuildWallSubsegments(elems, wi);
    for(var si=0; si<subs.length; si++){
      var s = subs[si];
      // distance from point to segment s.ax,ay - s.bx,by
      var dx=s.bx-s.ax, dy=s.by-s.ay; var denom=(dx*dx+dy*dy)||1; var t=((p.x-s.ax)*dx+(p.y-s.ay)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=s.ax+t*dx, cy=s.ay+t*dy; var d=Math.hypot(p.x-cx, p.y-cy);
      if(d < bestD){ bestD = d; best = s; }
    }
  }
  return best;
}

function plan2dDeleteSelectedSubsegment(){
  var ss = __plan2d.selectedSubsegment; if(!ss) return false;
  var idx = ss.wallIndex; var wall = __plan2d.elements[idx]; if(!wall || wall.type!=='wall') return false;
  var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1; var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var thick=wall.thickness||__plan2d.wallThicknessM;
  var t0 = Math.max(0, Math.min(1, ss.t0)); var t1 = Math.max(0, Math.min(1, ss.t1)); if(t0>t1){ var tmp=t0;t0=t1;t1=tmp; }
  // Determine remaining spans: [0,t0] and [t1,1] (exclude the deleted middle), skip zero-length
  var remaining = [];
  if(t0 > 1e-6) remaining.push([0, t0]);
  if(t1 < 1-1e-6) remaining.push([t1, 1]);
  var newWalls = [];
  for(var r=0;r<remaining.length;r++){
    var a=remaining[r][0], b=remaining[r][1]; var ax=x0+dx*a, ay=y0+dy*a, bx=x0+dx*b, by=y0+dy*b;
    newWalls.push({ type:'wall', x0:ax, y0:ay, x1:bx, y1:by, thickness: thick });
  }
  var oldIndex = idx;
  var delta = newWalls.length - 1; // net change in wall count at this index
  // Update hosts for all elements referencing walls beyond oldIndex (they will shift by delta)
  var toRemove = []; // openings to remove (indices found later)
  for(var i=0;i<__plan2d.elements.length;i++){
    var e = __plan2d.elements[i]; if(!e) continue;
    if((e.type==='window'||e.type==='door') && typeof e.host==='number'){
      if(e.host === oldIndex){
        // Rehost onto one of the new walls if possible, else mark for removal
        var t0o=Math.max(0,Math.min(1,e.t0||0)), t1o=Math.max(0,Math.min(1,e.t1||0)); var mid=(t0o+t1o)/2; var placed=false;
        for(var s=0;s<remaining.length;s++){
          var aSpan=remaining[s][0], bSpan=remaining[s][1]; if(bSpan<=aSpan+1e-6) continue;
          if(mid>=aSpan-1e-6 && mid<=bSpan+1e-6){
            var spanLen=(bSpan-aSpan)||1; var nt0=(t0o-aSpan)/spanLen, nt1=(t1o-aSpan)/spanLen; nt0=Math.max(0,Math.min(1,nt0)); nt1=Math.max(0,Math.min(1,nt1));
            e.t0=nt0; e.t1=nt1; e.host = oldIndex + s; placed=true; break;
          }
        }
        if(!placed){ toRemove.push(e); }
      } else if(e.host > oldIndex){ e.host += delta; }
    }
  }
  // Replace the wall in-place with new walls
  __plan2d.elements.splice(oldIndex, 1, ...newWalls);
  // Remove any openings that fell into the deleted span
  if(toRemove.length){
    for(var rr=toRemove.length-1; rr>=0; rr--){ var el=toRemove[rr]; var idxNow = __plan2d.elements.indexOf(el); if(idxNow>=0){ __plan2d.elements.splice(idxNow,1); }
    }
  }
  return true;
}

// ===== Grid snapping and joining helpers =====
function plan2dSnap(v){ var step = (__plan2d.gridStep || 0.5); return Math.round(v/step)*step; }
function plan2dSnapPoint(p){ return { x: plan2dSnap(p.x), y: plan2dSnap(p.y) }; }
function plan2dSnapTOnWall(wall, t){
  t = Math.max(0, Math.min(1, t||0));
  var x0=wall.x0,y0=wall.y0,x1=wall.x1,y1=wall.y1;
  var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var dirx=dx/len, diry=dy/len;
  var wx = x0 + dirx * (t*len), wy = y0 + diry * (t*len);
  var sp = plan2dSnapPoint({x:wx,y:wy});
  var denom = dx*dx+dy*dy||1; var tt=((sp.x-x0)*dx+(sp.y-y0)*dy)/denom; return Math.max(0, Math.min(1, tt));
}
function plan2dEq(a,b,t){ return Math.abs(a-b) <= (t||0.02); }
function plan2dAutoSnapAndJoin(){
  var els = __plan2d.elements||[];
  // 1) Snap endpoints to grid and enforce axis alignment for walls
  for(var i=0;i<els.length;i++){
    var e=els[i]; if(!e) continue;
    if(e.type==='wall'){
      e.x0=plan2dSnap(e.x0); e.y0=plan2dSnap(e.y0); e.x1=plan2dSnap(e.x1); e.y1=plan2dSnap(e.y1);
      var dx=e.x1-e.x0, dy=e.y1-e.y0; if(Math.abs(dx)>=Math.abs(dy)){ e.y1=e.y0; } else { e.x1=e.x0; }
    } else if((e.type==='window'||e.type==='door')){
      if(typeof e.host==='number'){
        var host=els[e.host]; if(host && host.type==='wall'){
          e.t0 = plan2dSnapTOnWall(host, e.t0||0);
          e.t1 = plan2dSnapTOnWall(host, e.t1||0);
        }
      } else {
        e.x0=plan2dSnap(e.x0); e.y0=plan2dSnap(e.y0); e.x1=plan2dSnap(e.x1); e.y1=plan2dSnap(e.y1);
      }
    }
  }
  // 2) Join flush when walls cross or meet
  for(var a=0;a<els.length;a++){
    var wa=els[a]; if(!wa||wa.type!=='wall') continue;
    var aH = plan2dEq(wa.y0, wa.y1);
    for(var b=a+1;b<els.length;b++){
      var wb=els[b]; if(!wb||wb.type!=='wall') continue;
      var bH = plan2dEq(wb.y0, wb.y1);
      if(aH && !bH){
        // A horizontal, B vertical
        var y = wa.y0, x = wb.x0;
        var ax0=Math.min(wa.x0,wa.x1), ax1=Math.max(wa.x0,wa.x1);
        var by0=Math.min(wb.y0,wb.y1), by1=Math.max(wb.y0,wb.y1);
        if(x>=ax0-1e-6 && x<=ax1+1e-6 && y>=by0-1e-6 && y<=by1+1e-6){
          // Snap nearby endpoints to exact intersection
          if(Math.hypot(wa.x0-x, wa.y0-y) <= 0.08){ wa.x0=x; wa.y0=y; }
          if(Math.hypot(wa.x1-x, wa.y1-y) <= 0.08){ wa.x1=x; wa.y1=y; }
          if(Math.hypot(wb.x0-x, wb.y0-y) <= 0.08){ wb.x0=x; wb.y0=y; }
          if(Math.hypot(wb.x1-x, wb.y1-y) <= 0.08){ wb.x1=x; wb.y1=y; }
        }
      } else if(!aH && bH){
        // A vertical, B horizontal
        var y2 = wb.y0, x2 = wa.x0;
        var bx0=Math.min(wb.x0,wb.x1), bx1=Math.max(wb.x0,wb.x1);
        var ay0=Math.min(wa.y0,wa.y1), ay1=Math.max(wa.y0,wa.y1);
        if(x2>=bx0-1e-6 && x2<=bx1+1e-6 && y2>=ay0-1e-6 && y2<=ay1+1e-6){
          if(Math.hypot(wa.x0-x2, wa.y0-y2) <= 0.08){ wa.x0=x2; wa.y0=y2; }
          if(Math.hypot(wa.x1-x2, wa.y1-y2) <= 0.08){ wa.x1=x2; wa.y1=y2; }
          if(Math.hypot(wb.x0-x2, wb.y0-y2) <= 0.08){ wb.x0=x2; wb.y0=y2; }
          if(Math.hypot(wb.x1-x2, wb.y1-y2) <= 0.08){ wb.x1=x2; wb.y1=y2; }
        }
      } else if(aH && bH){
        // both horizontal same Y: snap Y and any near-equal X endpoints
        if(plan2dEq(wa.y0, wb.y0, 0.05)){
          var yH = plan2dSnap(wa.y0); wa.y0=wa.y1=yH; wb.y0=wb.y1=yH;
          var ptsA=[wa.x0,wa.x1], ptsB=[wb.x0,wb.x1];
          for(var i1=0;i1<2;i1++) for(var j1=0;j1<2;j1++) if(plan2dEq(ptsA[i1], ptsB[j1], 0.05)){ var nv=plan2dSnap((ptsA[i1]+ptsB[j1])/2); ptsA[i1]=ptsB[j1]=nv; }
          wa.x0=ptsA[0]; wa.x1=ptsA[1]; wb.x0=ptsB[0]; wb.x1=ptsB[1];
        }
      } else {
        // both vertical same X
        if(plan2dEq(wa.x0, wb.x0, 0.05)){
          var xV = plan2dSnap(wa.x0); wa.x0=wa.x1=xV; wb.x0=wb.x1=xV;
          var pa=[wa.y0,wa.y1], pb=[wb.y0,wb.y1];
          for(var i2=0;i2<2;i2++) for(var j2=0;j2<2;j2++) if(plan2dEq(pa[i2], pb[j2], 0.05)){ var nv2=plan2dSnap((pa[i2]+pb[j2])/2); pa[i2]=pb[j2]=nv2; }
          wa.y0=pa[0]; wa.y1=pa[1]; wb.y0=pb[0]; wb.y1=pb[1];
        }
      }
    }
  }
}

// Hit-test near wall endpoints for dragging
function plan2dHitWallEndpoint(p, tol){
  var best=null; var bestD=tol||0.18;
  var els=__plan2d.elements||[];
  for(var i=0;i<els.length;i++){
    var e=els[i]; if(!e||e.type!=='wall') continue;
    var d0=Math.hypot(p.x-e.x0, p.y-e.y0); if(d0<bestD){ bestD=d0; best={index:i, end:'a'}; }
    var d1=Math.hypot(p.x-e.x1, p.y-e.y1); if(d1<bestD){ bestD=d1; best={index:i, end:'b'}; }
  }
  return best;
}
// Hit-test near window endpoints for dragging
function plan2dHitWindowEndpoint(p, tol){
  var best=null; var bestD=tol||0.15;
  for(var i=0;i<__plan2d.elements.length;i++){
    var e=__plan2d.elements[i]; if(e.type!=='window' || typeof e.host!=='number') continue;
    var host=__plan2d.elements[e.host]; if(!host || host.type!=='wall') continue;
    var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
    var ax=host.x0+(host.x1-host.x0)*t0, ay=host.y0+(host.y1-host.y0)*t0;
    var bx=host.x0+(host.x1-host.x0)*t1, by=host.y0+(host.y1-host.y0)*t1;
    var d0=Math.hypot(p.x-ax, p.y-ay), d1=Math.hypot(p.x-bx, p.y-by);
    if(d0<bestD){ bestD=d0; best={index:i, end:'t0'}; }
    if(d1<bestD){ bestD=d1; best={index:i, end:'t1'}; }
  }
  return best;
}

// Hit-test near door endpoints for dragging
function plan2dHitDoorEndpoint(p, tol){
  var best=null; var bestD=tol||0.15;
  for(var i=0;i<__plan2d.elements.length;i++){
    var e=__plan2d.elements[i]; if(e.type!=='door') continue;
    var ax, ay, bx, by;
    if(typeof e.host==='number'){
      var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue;
      var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
      ax = host.x0+(host.x1-host.x0)*t0; ay = host.y0+(host.y1-host.y0)*t0;
      bx = host.x0+(host.x1-host.x0)*t1; by = host.y0+(host.y1-host.y0)*t1;
      var d0=Math.hypot(p.x-ax, p.y-ay), d1=Math.hypot(p.x-bx, p.y-by);
      if(d0<bestD){ bestD=d0; best={index:i, end:'t0'}; }
      if(d1<bestD){ bestD=d1; best={index:i, end:'t1'}; }
    } else {
      ax=e.x0; ay=e.y0; bx=e.x1; by=e.y1;
      var d0f=Math.hypot(p.x-ax, p.y-ay), d1f=Math.hypot(p.x-bx, p.y-by);
      if(d0f<bestD){ bestD=d0f; best={index:i, end:'a'}; }
      if(d1f<bestD){ bestD=d1f; best={index:i, end:'b'}; }
    }
  }
  return best;
}

// Hit-test near a door segment (for sliding along host wall)
function plan2dHitDoorSegment(p, tol){
  var best = null; var bestD = (typeof tol==='number'? tol : 0.12);
  for(var i=0;i<__plan2d.elements.length;i++){
    var e = __plan2d.elements[i]; if(e.type!=='door' || typeof e.host!=='number') continue;
    var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue;
    var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
    var ax=host.x0+(host.x1-host.x0)*t0, ay=host.y0+(host.y1-host.y0)*t0;
    var bx=host.x0+(host.x1-host.x0)*t1, by=host.y0+(host.y1-host.y0)*t1;
    // Distance from point to segment
    var dx=bx-ax, dy=by-ay; var denom=(dx*dx+dy*dy)||1; var tt=((p.x-ax)*dx+(p.y-ay)*dy)/denom; tt=Math.max(0,Math.min(1,tt)); var cx=ax+tt*dx, cy=ay+tt*dy; var d=Math.hypot(p.x-cx, p.y-cy);
    if(d < bestD){ bestD = d; best = { index:i, t:tt }; }
  }
  return best;
}
// Hit-test near a window segment (for click-to-select)
function plan2dHitWindowSegment(p, tol){
  var best = null; var bestD = (typeof tol==='number'? tol : 0.15);
  for(var i=0;i<__plan2d.elements.length;i++){
    var e = __plan2d.elements[i]; if(e.type!=='window') continue;
    var ax, ay, bx, by;
    if(typeof e.host==='number'){
      var host = __plan2d.elements[e.host]; if(!host || host.type!=='wall') continue;
      var t0=Math.max(0,Math.min(1,e.t0||0)), t1=Math.max(0,Math.min(1,e.t1||0));
      ax = host.x0+(host.x1-host.x0)*t0; ay = host.y0+(host.y1-host.y0)*t0;
      bx = host.x0+(host.x1-host.x0)*t1; by = host.y0+(host.y1-host.y0)*t1;
    } else {
      ax=e.x0; ay=e.y0; bx=e.x1; by=e.y1;
    }
    var dx=bx-ax, dy=by-ay; var denom=(dx*dx+dy*dy)||1; var tt=((p.x-ax)*dx+(p.y-ay)*dy)/denom; tt=Math.max(0,Math.min(1,tt)); var cx=ax+tt*dx, cy=ay+tt*dy; var d=Math.hypot(p.x-cx, p.y-cy);
    if(d < bestD){ bestD = d; best = { index:i, t:tt }; }
  }
  return best;
}
// Find nearest wall element to point p within tolerance (meters)
function plan2dFindNearestWall(p, tol){
  var bestIdx = -1; var bestD = (typeof tol==='number' ? tol : 0.25);
  for(var i=0;i<__plan2d.elements.length;i++){
    var e=__plan2d.elements[i]; if(e.type!=='wall') continue;
    var d = (function(px,py,w){ var dx=w.x1-w.x0, dy=w.y1-w.y0; var denom=(dx*dx+dy*dy)||1; var t=((px-w.x0)*dx+(py-w.y0)*dy)/denom; t=Math.max(0,Math.min(1,t)); var cx=w.x0+t*dx, cy=w.y0+t*dy; return Math.hypot(px-cx, py-cy); })(p.x,p.y,e);
    if(d < bestD){ bestD = d; bestIdx = i; }
  }
  if(bestIdx>=0) return { index: bestIdx, dist: bestD };
  return null;
}
function updatePlan2DInfo(){ var cnt=document.getElementById('plan2d-count'); if(cnt) cnt.textContent=__plan2d.elements.length; }
function plan2dExport(){ try{ var data=JSON.stringify(__plan2d.elements); var blob=new Blob([data],{type:'application/json'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='plan2d.json'; a.click(); URL.revokeObjectURL(a.href); updateStatus('2D plan exported'); }catch(e){ updateStatus('Export failed'); } }
// ================= END 2D FLOOR PLAN EDITOR =================

// Apply 2D plan edits back to 3D: rebuild ground floor rooms from closed rectangles
function applyPlan2DTo3D(elemsSnapshot, opts){
  try {
    opts = opts || {};
    var stripsOnly = !!opts.stripsOnly;
    var allowRooms = !!opts.allowRooms;
    var quiet = !!opts.quiet;
    // Which floor to apply to (0=ground, 1=first). Default to ground for backward compatibility.
    var targetLevel = (typeof opts.level === 'number') ? opts.level : 0;
    var elemsSrc = Array.isArray(elemsSnapshot) ? elemsSnapshot : __plan2d.elements;
    var walls=elemsSrc.filter(function(e){return e.type==='wall';});
    if(walls.length===0){
      // No walls -> clear rooms on target level in 3D so it reflects 2D state
      allRooms = allRooms.filter(function(r){ return (r.level||0)!==targetLevel; });
      // Also clear any standalone strips if editing ground floor
      if (targetLevel === 0) wallStrips = [];
      saveProjectSilently(); selectedRoomId=null; renderLoop();
      if(!quiet) updateStatus('Cleared ' + (targetLevel===0?'ground':'first') + ' floor 3D rooms (no walls in 2D)');
      return;
    }
    function approxEq(a,b,eps){ return Math.abs(a-b) < (eps||1e-2); } // ~1 cm tolerance
    var TOL=0.02; // 2 cm forgiving tolerance for detection
    function keyCoord(v){ return Math.round(v / TOL) * TOL; }
    // Build horizontal and vertical tracks by clustering coordinates; merge spans
    var H = {}; // yKey -> array of [x0,x1]
    var V = {}; // xKey -> array of [y0,y1]
    function addSpan(map, key, a0, a1){ if(a1<a0){ var t=a0;a0=a1;a1=t; } if(!map[key]) map[key]=[]; map[key].push([a0,a1]); }
    for(var wi=0; wi<elemsSrc.length; wi++){
      var w = elemsSrc[wi]; if(!w || w.type!=='wall') continue;
      var x0=w.x0,y0=w.y0,x1=w.x1,y1=w.y1;
      if(approxEq(y0,y1,1e-2)){ var yk=keyCoord((y0+y1)/2); addSpan(H, yk, Math.min(x0,x1), Math.max(x0,x1)); }
      else if(approxEq(x0,x1,1e-2)){ var xk=keyCoord((x0+x1)/2); addSpan(V, xk, Math.min(y0,y1), Math.max(y0,y1)); }
    }
    function mergeSpans(spans){ if(!spans||!spans.length) return []; spans.sort(function(A,B){return A[0]-B[0];}); var out=[]; for(var i=0;i<spans.length;i++){ var s=spans[i]; if(!out.length) out.push([s[0],s[1]]); else { var last=out[out.length-1]; if(s[0] <= last[1] + TOL){ last[1] = Math.max(last[1], s[1]); } else out.push([s[0],s[1]]); } } return out; }
    // Merge all tracks
    Object.keys(H).forEach(function(k){ H[k]=mergeSpans(H[k]); });
    Object.keys(V).forEach(function(k){ V[k]=mergeSpans(V[k]); });

    // Helper: does a set of spans cover [a,b] fully?
    function covers(spans, a,b){ if(!spans||!spans.length) return false; for(var i=0;i<spans.length;i++){ var s=spans[i]; if(s[0] <= a + TOL && s[1] >= b - TOL) return true; } return false; }
    // Find rectangles by pairing horizontal tracks (yTop,yBot) and vertical tracks (xLeft,xRight)
    var yKeys = Object.keys(H).map(parseFloat).sort(function(a,b){return a-b;});
    var xKeys = Object.keys(V).map(parseFloat).sort(function(a,b){return a-b;});
    var roomsFound=[];
    for(var yi=0; yi<yKeys.length; yi++){
      for(var yj=yi+1; yj<yKeys.length; yj++){
        var yTop=yKeys[yi], yBot=yKeys[yj];
        for(var xi=0; xi<xKeys.length; xi++){
          for(var xj=xi+1; xj<xKeys.length; xj++){
            var xLeft=xKeys[xi], xRight=xKeys[xj];
            if( covers(H[yTop], xLeft, xRight) && covers(H[yBot], xLeft, xRight) && covers(V[xLeft], yTop, yBot) && covers(V[xRight], yTop, yBot) ){
              roomsFound.push({minX:Math.min(xLeft,xRight), maxX:Math.max(xLeft,xRight), minY:Math.min(yTop,yBot), maxY:Math.max(yTop,yBot)});
            }
          }
        }
      }
    }
    // Deduplicate roomsFound (rectangles may be discovered multiple times)
    var dedup=[]; roomsFound.forEach(function(R){
      for(var n=0;n<dedup.length;n++){
        var D=dedup[n]; if(approxEq(D.minX,R.minX)&&approxEq(D.maxX,R.maxX)&&approxEq(D.minY,R.minY)&&approxEq(D.maxY,R.maxY)) return; }
      dedup.push(R);
    });
    roomsFound=dedup;

    if(roomsFound.length===0 || stripsOnly){
      // Walls present but no closed rectangles: extrude standalone wall strips from 2D
      // Clear rooms on target level
      allRooms = allRooms.filter(function(r){ return (r.level||0)!==targetLevel; });
      if (targetLevel === 0){
        var sgn = (__plan2d.yFromWorldZSign||1);
        var strips = [];
        // Build subsegments excluding openings/intersections using existing helper
        for(var wi=0; wi<elemsSrc.length; wi++){
          var e = elemsSrc[wi]; if(!e || e.type!=='wall') continue;
          var subs = plan2dBuildWallSubsegments(elemsSrc, wi) || [];
          for(var si=0; si<subs.length; si++){
            var sg = subs[si];
            strips.push({
              x0: (__plan2d.centerX||0) + sg.ax,
              z0: (__plan2d.centerZ||0) + sgn*sg.ay,
              x1: (__plan2d.centerX||0) + sg.bx,
              z1: (__plan2d.centerZ||0) + sgn*sg.by,
              thickness: (e.thickness||__plan2d.wallThicknessM||0.3),
              height: (__plan2d.wallHeightM||3.0)
            });
          }
        }
        wallStrips = strips;
        saveProjectSilently(); selectedRoomId=null; renderLoop();
        if(!quiet) updateStatus('Applied 2D plan to 3D (standalone walls)');
      } else {
        // For first floor there is no strips representation; just update the scene with rooms cleared for this level
        saveProjectSilently(); selectedRoomId=null; renderLoop();
        if(!quiet) updateStatus('Applied 2D plan to 3D (no closed rooms on first floor)');
      }
      return;
    }

  // If rooms are not allowed (live strips-only mode), stop here
  if(!allowRooms){ return; }

  // Replace only rooms on the target level; also clear standalone strips if ground floor
    allRooms = allRooms.filter(function(r){ return (r.level||0)!==targetLevel; });
  if (targetLevel === 0) wallStrips = [];
    // 2D y corresponds to world z; 2D x corresponds to world x; plan is centered at (0,0)
    for(var r=0;r<roomsFound.length;r++){
      var R=roomsFound[r];
      var s = (__plan2d.yFromWorldZSign||1);
  var wx=(__plan2d.centerX||0) + (R.minX+R.maxX)/2, wz=(__plan2d.centerZ||0) + s*((R.minY+R.maxY)/2); // map plan coords back to world using stored center
  var w=R.maxX-R.minX, d=R.maxY-R.minY;
    var room=createRoom(wx, wz, targetLevel);
  room.width=Math.max(0.5, quantizeMeters(w, 2));
  room.depth=Math.max(0.5, quantizeMeters(d, 2));
      room.height=3;
      room.name='Room';
      // Collect openings (windows/doors) along rectangle sides using geometry (no strict host mapping)
      try {
        var openings = [];
        var widthM = (R.maxX - R.minX), depthM = (R.maxY - R.minY);
        for(var ei=0; ei<elemsSrc.length; ei++){
          var el = elemsSrc[ei]; if(!el || (el.type!=='window' && el.type!=='door')) continue;
          if(typeof el.host!=='number') continue; // only host-anchored for now
          var host = elemsSrc[el.host]; if(!host || host.type!=='wall') continue;
          var t0=Math.max(0,Math.min(1,el.t0||0)), t1=Math.max(0,Math.min(1,el.t1||0));
          var ax = host.x0 + (host.x1-host.x0)*t0;
          var ay = host.y0 + (host.y1-host.y0)*t0;
          var bx = host.x0 + (host.x1-host.x0)*t1;
          var by = host.y0 + (host.y1-host.y0)*t1;
          // Classify against each side with tolerance
          var added=false;
          // Top side (world minZ). In plan, it's y=R.minY when s=1, else y=R.maxY when s=-1.
          var topY = (s===1 ? R.minY : R.maxY);
          var botY = (s===1 ? R.maxY : R.minY);
          // Horizontal spans along X
          if(Math.abs(ay - topY) <= TOL && Math.abs(by - topY) <= TOL){
            var sx = Math.max(R.minX, Math.min(R.maxX, Math.min(ax,bx)));
            var ex = Math.max(R.minX, Math.min(R.maxX, Math.max(ax,bx)));
            var q0 = quantizeMeters(sx - R.minX, 2);
            var q1 = quantizeMeters(ex - R.minX, 2);
            if(q1 > q0 + 1e-4){ var hM=(el.type==='door') ? (typeof el.heightM==='number'?el.heightM: (__plan2d&&__plan2d.doorHeightM||2.04)) : undefined; openings.push({type:el.type, edge:'minZ', startM:q0, endM:q1, heightM:hM, meta:(el.meta||null)}); added=true; }
          }
          // Bottom side (world maxZ) => plan y=botY
          if(!added && Math.abs(ay - botY) <= TOL && Math.abs(by - botY) <= TOL){
            var s2 = Math.max(R.minX, Math.min(R.maxX, Math.min(ax,bx)));
            var e2 = Math.max(R.minX, Math.min(R.maxX, Math.max(ax,bx)));
            var q02 = quantizeMeters(s2 - R.minX, 2);
            var q12 = quantizeMeters(e2 - R.minX, 2);
            if(q12 > q02 + 1e-4){ var hM2=(el.type==='door') ? (typeof el.heightM==='number'?el.heightM: (__plan2d&&__plan2d.doorHeightM||2.04)) : undefined; openings.push({type:el.type, edge:'maxZ', startM:q02, endM:q12, heightM:hM2, meta:(el.meta||null)}); added=true; }
          }
          // Left side (minX at x=R.minX), vertical span along Y
          if(!added && Math.abs(ax - R.minX) <= TOL && Math.abs(bx - R.minX) <= TOL){
            var sv = Math.max(R.minY, Math.min(R.maxY, Math.min(ay,by)));
            var ev = Math.max(R.minY, Math.min(R.maxY, Math.max(ay,by)));
            var q03 = quantizeMeters(sv - R.minY, 2);
            var q13 = quantizeMeters(ev - R.minY, 2);
            if(q13 > q03 + 1e-4){ var hM3=(el.type==='door') ? (typeof el.heightM==='number'?el.heightM: (__plan2d&&__plan2d.doorHeightM||2.04)) : undefined; openings.push({type:el.type, edge:'minX', startM:q03, endM:q13, heightM:hM3, meta:(el.meta||null)}); added=true; }
          }
          // Right side (maxX at x=R.maxX)
          if(!added && Math.abs(ax - R.maxX) <= TOL && Math.abs(bx - R.maxX) <= TOL){
            var sv2 = Math.max(R.minY, Math.min(R.maxY, Math.min(ay,by)));
            var ev2 = Math.max(R.minY, Math.min(R.maxY, Math.max(ay,by)));
            var q04 = quantizeMeters(sv2 - R.minY, 2);
            var q14 = quantizeMeters(ev2 - R.minY, 2);
            if(q14 > q04 + 1e-4){ var hM4=(el.type==='door') ? (typeof el.heightM==='number'?el.heightM: (__plan2d&&__plan2d.doorHeightM||2.04)) : undefined; openings.push({type:el.type, edge:'maxX', startM:q04, endM:q14, heightM:hM4, meta:(el.meta||null)}); added=true; }
          }
        }
        room.openings = openings;
      } catch(e){ room.openings = []; }
      allRooms.push(room);
    }

  saveProjectSilently(); if(!Array.isArray(elemsSnapshot)) { selectedRoomId=null; } renderLoop(); if(!quiet && !Array.isArray(elemsSnapshot)) updateStatus(roomsFound.length? 'Applied 2D plan to 3D (rooms + openings)' : 'No closed rooms found (auto-snap enabled)');
  } catch(e){ console.error('applyPlan2DTo3D failed', e); updateStatus('Apply to 3D failed'); }
}

// Populate the 2D Floor Plan from the current 3D model for the currently selected floor
function populatePlan2DFromDesign(){
  // Collect rectangles for rooms on the current floor; include garages on ground and balconies on first
  var rects = [];
  var lvl = (typeof currentFloor==='number' ? currentFloor : 0);
  for (var i=0;i<allRooms.length;i++) {
    var r = allRooms[i];
    if ((r.level||0) !== lvl) continue; // current floor only
    var hw = r.width/2, hd = r.depth/2;
    rects.push({
      name: r.name || 'Room',
      minX: r.x - hw, maxX: r.x + hw,
      minZ: r.z - hd, maxZ: r.z + hd,
      type: 'room',
      openings: (Array.isArray(r.openings) ? r.openings.slice() : [])
    });
  }
  if(lvl===0){
    for (var g=0; g<garageComponents.length; g++) {
      var gar = garageComponents[g];
      var hwg = gar.width/2, hdg = gar.depth/2;
      rects.push({
        name: gar.name || 'Garage',
        minX: gar.x - hwg, maxX: gar.x + hwg,
        minZ: gar.z - hdg, maxZ: gar.z + hdg,
        type: 'garage',
        cx: gar.x, cz: gar.z, w: gar.width, d: gar.depth, rotation: (gar.rotation||0)
      });
    }
    // Include pergolas as wall rectangles on ground floor
    for (var pg=0; pg<pergolaComponents.length; pg++) {
      var per = pergolaComponents[pg];
      var hwp = per.width/2, hdp = per.depth/2;
      rects.push({
        name: per.name || 'Pergola',
        minX: per.x - hwp, maxX: per.x + hwp,
        minZ: per.z - hdp, maxZ: per.z + hdp,
        type: 'pergola',
        cx: per.x, cz: per.z, w: per.width, d: per.depth, rotation: (per.rotation||0)
      });
    }
  }
  if(lvl===1){
    for (var b=0; b<balconyComponents.length; b++) {
      var bal = balconyComponents[b]; if((bal.level||1)!==1) continue;
      var hwb = bal.width/2, hdb = bal.depth/2;
      rects.push({
        name: bal.name || 'Balcony',
        minX: bal.x - hwb, maxX: bal.x + hwb,
        minZ: bal.z - hdb, maxZ: bal.z + hdb,
        type: 'balcony',
        cx: bal.x, cz: bal.z, w: bal.width, d: bal.depth, rotation: (bal.rotation||0)
      });
    }
  }
  // Include stairs footprint in bounds only on their level (avoid shifting first floor centering)
  if (stairsComponent && (stairsComponent.level||0) === lvl) {
    var s = stairsComponent; var hwS = (s.width||0)/2, hdS = (s.depth||0)/2;
    // Account for rotation when computing extents
    var rot = ((s.rotation||0) * Math.PI) / 180;
    function r(px, pz){ var dx=px-s.x, dz=pz-s.z; return { x: s.x + dx*Math.cos(rot) - dz*Math.sin(rot), z: s.z + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
    var p1=r(s.x-hwS, s.z-hdS), p2=r(s.x+hwS, s.z-hdS), p3=r(s.x+hwS, s.z+hdS), p4=r(s.x-hwS, s.z+hdS);
    rects.push({ name:'Stairs', minX: Math.min(p1.x,p2.x,p3.x,p4.x), maxX: Math.max(p1.x,p2.x,p3.x,p4.x), minZ: Math.min(p1.z,p2.z,p3.z,p4.z), maxZ: Math.max(p1.z,p2.z,p3.z,p4.z), type:'stairs' });
  }
  if (rects.length === 0) return false;

  // Compute overall bounds and center (use rotation-aware bounds where available)
  var minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
  // Track rooms-only bounds for scale so non-room elements don't change zoom level
  var rMinX=Infinity, rMaxX=-Infinity, rMinZ=Infinity, rMaxZ=-Infinity; var roomCount=0;
  // Also track rooms across all levels to use as a fallback scale when this floor has no rooms
  var rAllMinX=Infinity, rAllMaxX=-Infinity, rAllMinZ=Infinity, rAllMaxZ=-Infinity; var roomCountAll=0;
  for (var k=0;k<rects.length;k++){
    var b=rects[k];
    // Prefer rotation-aware bounds if this rect has center/size/rotation
    if (typeof b.cx==='number' && typeof b.cz==='number' && typeof b.w==='number' && typeof b.d==='number' && typeof b.rotation==='number'){
      var hwB=b.w/2, hdB=b.d/2, rotB=(b.rotation*Math.PI)/180;
      function rotPt(px,pz){ var dx=px-b.cx, dz=pz-b.cz; return { x: b.cx + dx*Math.cos(rotB) - dz*Math.sin(rotB), z: b.cz + dx*Math.sin(rotB) + dz*Math.cos(rotB) }; }
      var q1=rotPt(b.cx-hwB,b.cz-hdB), q2=rotPt(b.cx+hwB,b.cz-hdB), q3=rotPt(b.cx+hwB,b.cz+hdB), q4=rotPt(b.cx-hwB,b.cz+hdB);
      var bminX=Math.min(q1.x,q2.x,q3.x,q4.x), bmaxX=Math.max(q1.x,q2.x,q3.x,q4.x), bminZ=Math.min(q1.z,q2.z,q3.z,q4.z), bmaxZ=Math.max(q1.z,q2.z,q3.z,q4.z);
      if (bminX<minX) minX=bminX; if (bmaxX>maxX) maxX=bmaxX;
      if (bminZ<minZ) minZ=bminZ; if (bmaxZ>maxZ) maxZ=bmaxZ;
      if (b.type === 'room') { rMinX=Math.min(rMinX,bminX); rMaxX=Math.max(rMaxX,bmaxX); rMinZ=Math.min(rMinZ,bminZ); rMaxZ=Math.max(rMaxZ,bmaxZ); roomCount++; }
    } else {
      if (b.minX<minX) minX=b.minX; if (b.maxX>maxX) maxX=b.maxX;
      if (b.minZ<minZ) minZ=b.minZ; if (b.maxZ>maxZ) maxZ=b.maxZ;
      if (b.type === 'room') { rMinX=Math.min(rMinX,b.minX); rMaxX=Math.max(rMaxX,b.maxX); rMinZ=Math.min(rMinZ,b.minZ); rMaxZ=Math.max(rMaxZ,b.maxZ); roomCount++; }
    }
  }
  // Rooms across all levels (fallback if current floor has no rooms)
  for (var riAll=0; riAll<allRooms.length; riAll++){
    var rA = allRooms[riAll]; var hwA=rA.width/2, hdA=rA.depth/2;
    rAllMinX=Math.min(rAllMinX, rA.x-hwA); rAllMaxX=Math.max(rAllMaxX, rA.x+hwA);
    rAllMinZ=Math.min(rAllMinZ, rA.z-hdA); rAllMaxZ=Math.max(rAllMaxZ, rA.z+hdA);
    roomCountAll++;
  }
  // Also compute global bounds across both floors to keep a stable origin between floor views
  var gMinX=Infinity, gMaxX=-Infinity, gMinZ=Infinity, gMaxZ=-Infinity;
  // Rooms (all levels)
  for (var ri=0; ri<allRooms.length; ri++){
    var rr=allRooms[ri]; var hw=rr.width/2, hd=rr.depth/2;
    gMinX=Math.min(gMinX, rr.x-hw); gMaxX=Math.max(gMaxX, rr.x+hw);
    gMinZ=Math.min(gMinZ, rr.z-hd); gMaxZ=Math.max(gMaxZ, rr.z+hd);
  }
  // Garages & pergolas (ground) - rotation-aware global bounds
  for (var gi=0; gi<garageComponents.length; gi++){
    var gar=garageComponents[gi]; var hwg=gar.width/2, hdg=gar.depth/2; var rotG=((gar.rotation||0)*Math.PI)/180;
    function rG(px,pz){ var dx=px-gar.x, dz=pz-gar.z; return {x:gar.x+dx*Math.cos(rotG)-dz*Math.sin(rotG), z:gar.z+dx*Math.sin(rotG)+dz*Math.cos(rotG)}; }
    var g1=rG(gar.x-hwg, gar.z-hdg), g2=rG(gar.x+hwg, gar.z-hdg), g3=rG(gar.x+hwg, gar.z+hdg), g4=rG(gar.x-hwg, gar.z+hdg);
    gMinX=Math.min(gMinX, g1.x,g2.x,g3.x,g4.x); gMaxX=Math.max(gMaxX, g1.x,g2.x,g3.x,g4.x);
    gMinZ=Math.min(gMinZ, g1.z,g2.z,g3.z,g4.z); gMaxZ=Math.max(gMaxZ, g1.z,g2.z,g3.z,g4.z);
  }
  for (var pi=0; pi<pergolaComponents.length; pi++){
    var per=pergolaComponents[pi]; var hwp=per.width/2, hdp=per.depth/2; var rotP=((per.rotation||0)*Math.PI)/180;
    function rP(px,pz){ var dx=px-per.x, dz=pz-per.z; return {x:per.x+dx*Math.cos(rotP)-dz*Math.sin(rotP), z:per.z+dx*Math.sin(rotP)+dz*Math.cos(rotP)}; }
    var p1=rP(per.x-hwp, per.z-hdp), p2=rP(per.x+hwp, per.z-hdp), p3=rP(per.x+hwp, per.z+hdp), p4=rP(per.x-hwp, per.z+hdp);
    gMinX=Math.min(gMinX, p1.x,p2.x,p3.x,p4.x); gMaxX=Math.max(gMaxX, p1.x,p2.x,p3.x,p4.x);
    gMinZ=Math.min(gMinZ, p1.z,p2.z,p3.z,p4.z); gMaxZ=Math.max(gMaxZ, p1.z,p2.z,p3.z,p4.z);
  }
  // Balconies (first) - rotation-aware global bounds
  for (var bi=0; bi<balconyComponents.length; bi++){
    var bal=balconyComponents[bi]; var hwb=bal.width/2, hdb=bal.depth/2; var rotB=((bal.rotation||0)*Math.PI)/180;
    function rB(px,pz){ var dx=px-bal.x, dz=pz-bal.z; return {x:bal.x+dx*Math.cos(rotB)-dz*Math.sin(rotB), z:bal.z+dx*Math.sin(rotB)+dz*Math.cos(rotB)}; }
    var b1=rB(bal.x-hwb, bal.z-hdb), b2=rB(bal.x+hwb, bal.z-hdb), b3=rB(bal.x+hwb, bal.z+hdb), b4=rB(bal.x-hwb, bal.z+hdb);
    gMinX=Math.min(gMinX, b1.x,b2.x,b3.x,b4.x); gMaxX=Math.max(gMaxX, b1.x,b2.x,b3.x,b4.x);
    gMinZ=Math.min(gMinZ, b1.z,b2.z,b3.z,b4.z); gMaxZ=Math.max(gMaxZ, b1.z,b2.z,b3.z,b4.z);
  }
  // Stairs (single location)
  if (stairsComponent){ var s=stairsComponent; var hwS=s.width/2, hdS=s.depth/2; var rot=((s.rotation||0)*Math.PI)/180; function r(px,pz){ var dx=px-s.x, dz=pz-s.z; return {x:s.x+dx*Math.cos(rot)-dz*Math.sin(rot), z:s.z+dx*Math.sin(rot)+dz*Math.cos(rot)}; } var gp1=r(s.x-hwS, s.z-hdS), gp2=r(s.x+hwS, s.z-hdS), gp3=r(s.x+hwS, s.z+hdS), gp4=r(s.x-hwS, s.z+hdS); gMinX=Math.min(gMinX, gp1.x,gp2.x,gp3.x,gp4.x); gMaxX=Math.max(gMaxX, gp1.x,gp2.x,gp3.x,gp4.x); gMinZ=Math.min(gMinZ, gp1.z,gp2.z,gp3.z,gp4.z); gMaxZ=Math.max(gMaxZ, gp1.z,gp2.z,gp3.z,gp4.z); }
  var gcx = (isFinite(gMinX)&&isFinite(gMaxX)) ? (gMinX+gMaxX)/2 : (minX+maxX)/2;
  var gcz = (isFinite(gMinZ)&&isFinite(gMaxZ)) ? (gMinZ+gMaxZ)/2 : (minZ+maxZ)/2;
  // Use global center so both floors share the same origin
  var cx = gcx; var cz = gcz;
  // Use rooms-only span to compute scale:
  // - If this floor has rooms, use them
  // - Else if any rooms exist globally, use global rooms (keep scale consistent across floors)
  // - Else fall back to overall bounds (nothing else to scale by)
  var useMinX, useMaxX, useMinZ, useMaxZ;
  if (roomCount > 0) {
    useMinX = rMinX; useMaxX = rMaxX; useMinZ = rMinZ; useMaxZ = rMaxZ;
  } else if (roomCountAll > 0 && isFinite(rAllMinX) && isFinite(rAllMaxX)) {
    useMinX = rAllMinX; useMaxX = rAllMaxX; useMinZ = rAllMinZ; useMaxZ = rAllMaxZ;
  } else {
    useMinX = minX; useMaxX = maxX; useMinZ = minZ; useMaxZ = maxZ;
  }
  var spanX = Math.max(0.5, useMaxX - useMinX); var spanZ = Math.max(0.5, useMaxZ - useMinZ);
  // Persist center so overlays and helpers can map world->plan consistently
  __plan2d.centerX = cx; __plan2d.centerZ = cz;

  // Fit scale to canvas with margins
  var c=document.getElementById('plan2d-canvas');
  if (!c) return false;
  var pad = 0.15; // 15% margin
  var fitWm = spanX*(1+pad), fitHm = spanZ*(1+pad);
  var scaleX = (c.width>0) ? (c.width/(fitWm||1)) : __plan2d.scale;
  var scaleY = (c.height>0) ? (c.height/(fitHm||1)) : __plan2d.scale;
  var newScale = Math.max(10, Math.min(140, Math.floor(Math.min(scaleX, scaleY)))); // clamp sensible range
  if (isFinite(newScale) && newScale>0) __plan2d.scale = newScale;

  // Build wall segments around each rectangle, shifted so center is at (0,0)
  __plan2d.elements = [];
  function addRectWalls(minX,maxX,minZ,maxZ){
    var s = (__plan2d.yFromWorldZSign||1);
    var x0=minX - cx, x1=maxX - cx, y0=s*(minZ - cz), y1=s*(maxZ - cz); // map z->y with sign
    var idxTop = __plan2d.elements.length;     __plan2d.elements.push({type:'wall', x0:x0,y0:y0, x1:x1,y1:y0, thickness:__plan2d.wallThicknessM});
    var idxRight = __plan2d.elements.length;   __plan2d.elements.push({type:'wall', x0:x1,y0:y0, x1:x1,y1:y1, thickness:__plan2d.wallThicknessM});
    var idxBottom = __plan2d.elements.length;  __plan2d.elements.push({type:'wall', x0:x1,y0:y1, x1:x0,y1:y1, thickness:__plan2d.wallThicknessM});
    var idxLeft = __plan2d.elements.length;    __plan2d.elements.push({type:'wall', x0:x0,y0:y1, x1:x0,y1:y0, thickness:__plan2d.wallThicknessM});
    return { top: idxTop, right: idxRight, bottom: idxBottom, left: idxLeft, coords: {x0:x0,x1:x1,y0:y0,y1:y1} };
  }
  function addRotatedRectWalls(cxW, czW, w, d, rotationDeg){
    var s = (__plan2d.yFromWorldZSign||1);
    var hw=w/2, hd=d/2, rot=((rotationDeg||0)*Math.PI)/180;
    function rotW(px,pz){ var dx=px-cxW, dz=pz-czW; return { x: cxW + dx*Math.cos(rot) - dz*Math.sin(rot), z: czW + dx*Math.sin(rot) + dz*Math.cos(rot) }; }
    var c1=rotW(cxW-hw, czW-hd), c2=rotW(cxW+hw, czW-hd), c3=rotW(cxW+hw, czW+hd), c4=rotW(cxW-hw, czW+hd);
    function toPlan(p){ return { x: (p.x - cx), y: s * (p.z - cz) }; }
    var p1=toPlan(c1), p2=toPlan(c2), p3=toPlan(c3), p4=toPlan(c4);
    var i1 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p1.x,y0:p1.y, x1:p2.x,y1:p2.y, thickness:__plan2d.wallThicknessM});
    var i2 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p2.x,y0:p2.y, x1:p3.x,y1:p3.y, thickness:__plan2d.wallThicknessM});
    var i3 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p3.x,y0:p3.y, x1:p4.x,y1:p4.y, thickness:__plan2d.wallThicknessM});
    var i4 = __plan2d.elements.length; __plan2d.elements.push({type:'wall', x0:p4.x,y0:p4.y, x1:p1.x,y1:p1.y, thickness:__plan2d.wallThicknessM});
    return { top: i1, right: i2, bottom: i3, left: i4, coords: {p1:p1,p2:p2,p3:p3,p4:p4} };
  }
  for (var rci=0;rci<rects.length;rci++){
    var rb=rects[rci];
  // Build walls for rooms, garages, pergolas, and balconies
  if(rb.type!=='room' && rb.type!=='garage' && rb.type!=='pergola' && rb.type!=='balcony') continue;
    var wallIdx;
    var hasRotation = (typeof rb.rotation==='number' && Math.abs(rb.rotation)%360>1e-6);
    if (hasRotation) {
      wallIdx = addRotatedRectWalls(rb.cx, rb.cz, rb.w, rb.d, rb.rotation);
    } else {
      wallIdx = addRectWalls(rb.minX, rb.maxX, rb.minZ, rb.maxZ);
    }
    // Re-create openings (windows/doors) anchored to walls for rooms
    if(rb.type==='room' && Array.isArray(rb.openings) && rb.openings.length){
      var s = (__plan2d.yFromWorldZSign||1);
      var minX = rb.minX - cx, maxX = rb.maxX - cx, minY = s*(rb.minZ - cz), maxY = s*(rb.maxZ - cz); // shifted with sign
      for(var oi=0; oi<rb.openings.length; oi++){
        var op = rb.openings[oi]; if(!op || (op.type!=='window' && op.type!=='door')) continue;
        var hostIdx = -1; var p0={x:0,y:0}, p1={x:0,y:0};
        if(op.edge==='minZ'){ // world top (North)
          hostIdx = (s===1 ? wallIdx.top : wallIdx.bottom);
          p0.x = minX + (op.startM||0); p1.x = minX + (op.endM||0);
          p0.y = p1.y = (s===1 ? minY : maxY);
        } else if(op.edge==='maxZ'){ // world bottom (South)
          hostIdx = (s===1 ? wallIdx.bottom : wallIdx.top);
          p0.x = minX + (op.startM||0); p1.x = minX + (op.endM||0);
          p0.y = p1.y = (s===1 ? maxY : minY);
        } else if(op.edge==='minX'){ // left
          hostIdx = wallIdx.left;
          p0.y = minY + (op.startM||0); p1.y = minY + (op.endM||0);
          p0.x = p1.x = minX;
        } else if(op.edge==='maxX'){ // right
          hostIdx = wallIdx.right;
          p0.y = minY + (op.startM||0); p1.y = minY + (op.endM||0);
          p0.x = p1.x = maxX;
        }
        if(hostIdx>=0){
          var wallEl = __plan2d.elements[hostIdx];
          // Compute param t via projection to ensure correct orientation
          var t0 = plan2dProjectParamOnWall(p0, wallEl);
          var t1 = plan2dProjectParamOnWall(p1, wallEl);
          if(op.type==='window'){
            __plan2d.elements.push({ type:'window', host:hostIdx, t0:t0, t1:t1, thickness: (wallEl.thickness||__plan2d.wallThicknessM) });
          } else if(op.type==='door'){
            var widthM = Math.hypot(p1.x-p0.x, p1.y-p0.y);
            __plan2d.elements.push({ type:'door', host:hostIdx, t0:t0, t1:t1, widthM: widthM, heightM: (typeof op.heightM==='number'? op.heightM : (__plan2d.doorHeightM||2.04)), thickness: (wallEl.thickness||__plan2d.wallThicknessM), meta: (op.meta||{ hinge:'t0', swing:'in' }) });
          }
        }
      }
    }
  }
  return true;
}
