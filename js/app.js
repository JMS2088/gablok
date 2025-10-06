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
var allRooms = [];
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
var roofComponents = [];
var currentSnapGuides = [];
var furnitureItems = [];

var HANDLE_RADIUS = 12;
var GRID_SPACING = 0.5;
var SNAP_GRID_TOLERANCE = 1.0;
var SNAP_CENTER_TOLERANCE = 0.6;
var HANDLE_SNAP_TOLERANCE = 0.25;

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
  roof: 120,
  balcony: 800
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
  console.log('Adding new balcony...');
  var newBalcony = createBalcony();
  console.log('Created balcony:', newBalcony);
  
  var spot = findFreeSpot(newBalcony);
  newBalcony.x = spot.x;
  newBalcony.z = spot.z;
  console.log('Found spot for balcony:', spot);
  
  balconyComponents.push(newBalcony);
  console.log('Balcony components now:', balconyComponents);
  
  currentFloor = 1;  // Switch to first floor
  selectedRoomId = newBalcony.id;
  console.log('Set current floor to:', currentFloor, 'Selected ID:', selectedRoomId);
  
  var selector = document.getElementById('levelSelect');
  if (selector) {
    selector.value = '1';
    console.log('Updated selector value to:', selector.value);
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
}

function project3D(worldX, worldY, worldZ) {
  try {
    var dx = worldX - camera.targetX;
    var dy = worldY;
    var dz = worldZ - camera.targetZ;
    
    var cosYaw = Math.cos(camera.yaw);
    var sinYaw = Math.sin(camera.yaw);
    var rotX = cosYaw * dx + sinYaw * dz;
    var rotZ = -sinYaw * dx + cosYaw * dz;
    
    var cosPitch = Math.cos(camera.pitch);
    var sinPitch = Math.sin(camera.pitch);
    var finalY = cosPitch * dy - sinPitch * rotZ;
    var finalZ = sinPitch * dy + cosPitch * rotZ + camera.distance;
    
    if (finalZ <= 0.1) return null;
    
    var fov = 800;
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
  ctx.strokeStyle = '#e0e0e0'; // darker grey for better visibility
  ctx.lineWidth = 1;
  
  var gridRange = Math.max(20, camera.distance * 1.5);
  var minX = camera.targetX - gridRange;
  var maxX = camera.targetX + gridRange;
  var minZ = camera.targetZ - gridRange;
  var maxZ = camera.targetZ + gridRange;
  
  minX = Math.floor(minX / GRID_SPACING) * GRID_SPACING;
  maxX = Math.ceil(maxX / GRID_SPACING) * GRID_SPACING;
  minZ = Math.floor(minZ / GRID_SPACING) * GRID_SPACING;
  maxZ = Math.ceil(maxZ / GRID_SPACING) * GRID_SPACING;
  
  for (var z = minZ; z <= maxZ; z += GRID_SPACING) {
    var h1 = project3D(minX, 0, z);
    var h2 = project3D(maxX, 0, z);
    if (h1 && h2) {
      ctx.beginPath();
      ctx.moveTo(h1.x, h1.y);
      ctx.lineTo(h2.x, h2.y);
      ctx.stroke();
    }
  }
  
  for (var x = minX; x <= maxX; x += GRID_SPACING) {
    var v1 = project3D(x, 0, minZ);
    var v2 = project3D(x, 0, maxZ);
    if (v1 && v2) {
      ctx.beginPath();
      ctx.moveTo(v1.x, v1.y);
      ctx.lineTo(v2.x, v2.y);
      ctx.stroke();
    }
  }
  
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ff4444';
  var xStart = project3D(-gridRange, 0, 0);
  var xEnd = project3D(gridRange, 0, 0);
  if (xStart && xEnd) {
    ctx.beginPath();
    ctx.moveTo(xStart.x, xStart.y);
    ctx.lineTo(xEnd.x, xEnd.y);
    ctx.stroke();
  }
  
  ctx.strokeStyle = '#4444ff';
  var zStart = project3D(0, 0, -gridRange);
  var zEnd = project3D(0, 0, gridRange);
  if (zStart && zEnd) {
    ctx.beginPath();
    ctx.moveTo(zStart.x, zStart.y);
    ctx.lineTo(zEnd.x, zEnd.y);
    ctx.stroke();
  }

  // Draw a small ground-level North arrow near the camera target to indicate +Z
  try {
    var nBaseW = { x: camera.targetX, y: 0.02, z: camera.targetZ + Math.min(4, gridRange * 0.2) };
    var nTipW  = { x: camera.targetX, y: 0.02, z: camera.targetZ + Math.min(5.5, gridRange * 0.27) };
    var nBase = project3D(nBaseW.x, nBaseW.y, nBaseW.z);
    var nTip  = project3D(nTipW.x,  nTipW.y,  nTipW.z);
    if (nBase && nTip) {
      ctx.strokeStyle = '#e74c3c';
      ctx.fillStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nBase.x, nBase.y);
      ctx.lineTo(nTip.x, nTip.y);
      ctx.stroke();

      // Arrowhead
      var ang = Math.atan2(nTip.y - nBase.y, nTip.x - nBase.x);
      var headLen = 10;
      var leftX = nTip.x - headLen * Math.cos(ang - Math.PI / 6);
      var leftY = nTip.y - headLen * Math.sin(ang - Math.PI / 6);
      var rightX = nTip.x - headLen * Math.cos(ang + Math.PI / 6);
      var rightY = nTip.y - headLen * Math.sin(ang + Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(nTip.x, nTip.y);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fill();

      // Label 'N'
      ctx.fillStyle = '#333';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('N', nTip.x, nTip.y - 4);
    }
  } catch (e) {
    // non-fatal
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
    console.warn('Compass draw skipped:', e);
  }
}

function drawRoom(room) {
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
    
    ctx.beginPath();
    for (var i = 0; i < edges.length; i++) {
      var edge = edges[i];
      ctx.moveTo(projected[edge[0]].x, projected[edge[0]].y);
      ctx.lineTo(projected[edge[1]].x, projected[edge[1]].y);
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
  widthInput.value = selectedObject.width.toFixed(1);
  depthInput.value = selectedObject.depth.toFixed(1);
  heightInput.value = selectedObject.height.toFixed(1);
  posXInput.value = selectedObject.x.toFixed(1);
  posZInput.value = selectedObject.z.toFixed(1);
  widthInput.disabled = false;
  depthInput.disabled = false;
  heightInput.disabled = false;
  posXInput.disabled = false;
  posZInput.disabled = false;

  // Update object immediately on input change or arrow key
  widthInput.oninput = function() { if (!isNaN(this.value) && this.value !== '') { selectedObject.width = Math.max(1, Math.min(20, parseFloat(this.value))); } };
  depthInput.oninput = function() { if (!isNaN(this.value) && this.value !== '') { selectedObject.depth = Math.max(1, Math.min(20, parseFloat(this.value))); } };
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
  
  var componentPricingDiv = document.getElementById('component-pricing');
  if (componentPricingDiv) {
    componentPricingDiv.innerHTML = '';
    
    if (breakdown.components.length === 0) {
      componentPricingDiv.innerHTML = '<div class="pricing-item"><span class="pricing-item-name">No additional components</span><span class="pricing-item-cost">$0</span></div>';
    } else {
      for (var i = 0; i < breakdown.components.length; i++) {
        var component = breakdown.components[i];
        var itemDiv = document.createElement('div');
        itemDiv.className = 'pricing-item';
        itemDiv.innerHTML = 
          '<span class="pricing-item-name">' + component.name + ' (' + component.area.toFixed(1) + 'm²)</span>' +
          '<span class="pricing-item-cost">' + formatCurrency(component.cost) + '</span>';
        componentPricingDiv.appendChild(itemDiv);
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
  
  modal.style.display = 'block';
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
          var rotationAngle = target.type === 'garage' ? 90 : 22.5;
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
        var maxSize = 20;

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
          target.height = clamp(target.height + heightChange, 0.5, 10);
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
  } else if (value === 'balcony') {
    console.log('Balcony option selected in switchLevel');
    addBalcony();
    currentFloor = 1;  // Ensure we're on first floor
    selector.value = '1';
    console.log('Current floor after balcony added:', currentFloor);
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
    objects = objects.concat(roofComponents);
  }
  if (currentFloor === 1) {
    objects = objects.concat(balconyComponents);
  }
  
  if (objects.length === 0) return;
  
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
  stairsComponent = null;
  pergolaComponents = [];
  garageComponents = [];
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
  console.log('Drawing balcony:', balcony);
  if (!balcony) {
    console.log('No balcony provided to draw');
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

function drawFurniture(f) {
  try {
    var selected = selectedRoomId === f.id;
    var levelY = (f.level || 0) * 3.5;
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
      {x: corners[0].x, y: levelY, z: corners[0].z},
      {x: corners[1].x, y: levelY, z: corners[1].z},
      {x: corners[2].x, y: levelY, z: corners[2].z},
      {x: corners[3].x, y: levelY, z: corners[3].z},
      {x: corners[0].x, y: levelY + h, z: corners[0].z},
      {x: corners[1].x, y: levelY + h, z: corners[1].z},
      {x: corners[2].x, y: levelY + h, z: corners[2].z},
      {x: corners[3].x, y: levelY + h, z: corners[3].z}
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
    console.log('Drawing garage:', garage.id, 'Selected:', selectedRoomId);
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
    console.log('Drawing garage handles');
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
    
    console.log('Drawing handles:', garageHandles.length);
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
      
      console.log('Registered handle:', handle.type, 'for garage:', garage.id);
    });
  } catch (error) {
    console.error('Garage handle error:', error);
  }
}

function renderLoop() {
  try {
    resizeHandles = [];
    
    clearCanvas();
    drawGrid();
    drawSnapGuides();
    
    // Sort all objects by distance for proper rendering
    var allObjects = [];
    
    // Add rooms
    for (var i = 0; i < allRooms.length; i++) {
      var room = allRooms[i];
      allObjects.push({
        object: room,
        type: 'room',
        distance: getDistanceFromCamera(room)
      });
    }
    
    // Add all components
    if (stairsComponent) {
      allObjects.push({
        object: stairsComponent,
        type: 'stairs',
        distance: getDistanceFromCamera(stairsComponent)
      });
    }
    
    garageComponents.forEach(function(garage) {
      allObjects.push({
        object: garage,
        type: 'garage',
        distance: getDistanceFromCamera(garage)
      });
    });
    
    // Sort objects by distance (furthest first)
    allObjects.sort(function(a, b) {
      return b.distance - a.distance;
    });
    
    // Draw all objects in order
    allObjects.forEach(function(obj) {
      if (obj.type === 'room') {
        drawRoom(obj.object);
      } else if (obj.type === 'stairs') {
        drawStairs(obj.object);
      } else if (obj.type === 'garage') {
        drawGarage(obj.object);
      }
    });
    
    // Draw any selected garage first
    if (selectedRoomId) {
      var selectedGarage = garageComponents.find(g => g.id === selectedRoomId);
      if (selectedGarage) {
        drawGarage(selectedGarage);
      }
    }
    
    var allObjects = [];
    
    for (var i = 0; i < allRooms.length; i++) {
      var room = allRooms[i];
      var roomCenterY = room.level * 3.5 + room.height / 2;
      var distFromCamera = Math.sqrt(
        (room.x - camera.targetX) * (room.x - camera.targetX) + 
        (roomCenterY) * (roomCenterY) +
        (room.z - camera.targetZ) * (room.z - camera.targetZ)
      );
      allObjects.push({
        object: room,
        type: 'room',
        distance: distFromCamera,
        maxHeight: room.level * 3.5 + room.height
      });
    }
    
    if (stairsComponent) {
      var stairsCenterY = stairsComponent.height / 2;
      var stairsDistance = Math.sqrt(
        (stairsComponent.x - camera.targetX) * (stairsComponent.x - camera.targetX) + 
        (stairsCenterY) * (stairsCenterY) +
        (stairsComponent.z - camera.targetZ) * (stairsComponent.z - camera.targetZ)
      );
      allObjects.push({
        object: stairsComponent,
        type: 'stairs',
        distance: stairsDistance,
        maxHeight: stairsComponent.height
      });
    }
    
    console.log('Rendering balconies. Count:', balconyComponents.length);
    for (var i = 0; i < balconyComponents.length; i++) {
      var balcony = balconyComponents[i];
      console.log('Processing balcony:', balcony);
      var balconyCenterY = balcony.level * 3.5 + balcony.height / 2;
      var balconyDistance = Math.sqrt(
        (balcony.x - camera.targetX) * (balcony.x - camera.targetX) + 
        (balconyCenterY) * (balconyCenterY) +
        (balcony.z - camera.targetZ) * (balcony.z - camera.targetZ)
      );
      allObjects.push({
        object: balcony,
        type: 'balcony',
        distance: balconyDistance,
        maxHeight: balcony.level * 3.5 + balcony.height
      });
    }
    
    for (var i = 0; i < pergolaComponents.length; i++) {
      var pergola = pergolaComponents[i];
      var pergolaCenterY = pergola.totalHeight / 2;
      var pergolaDistance = Math.sqrt(
        (pergola.x - camera.targetX) * (pergola.x - camera.targetX) + 
        (pergolaCenterY) * (pergolaCenterY) +
        (pergola.z - camera.targetZ) * (pergola.z - camera.targetZ)
      );
      allObjects.push({
        object: pergola,
        type: 'pergola',
        distance: pergolaDistance,
        maxHeight: pergola.totalHeight
      });
    }
    
    for (var i = 0; i < garageComponents.length; i++) {
      var garage = garageComponents[i];
      var garageCenterY = garage.height / 2;
      var garageDistance = Math.sqrt(
        (garage.x - camera.targetX) * (garage.x - camera.targetX) + 
        (garageCenterY) * (garageCenterY) +
        (garage.z - camera.targetZ) * (garage.z - camera.targetZ)
      );
      allObjects.push({
        object: garage,
        type: 'garage',
        distance: garageDistance,
        maxHeight: garage.height
      });
    }
    
    for (var i = 0; i < roofComponents.length; i++) {
      var roof = roofComponents[i];
      var roofCenterY = roof.baseHeight + roof.height / 2;
      var roofDistance = Math.sqrt(
        (roof.x - camera.targetX) * (roof.x - camera.targetX) + 
        (roofCenterY) * (roofCenterY) +
        (roof.z - camera.targetZ) * (roof.z - camera.targetZ)
      );
      allObjects.push({
        object: roof,
        type: 'roof',
        distance: roofDistance,
        maxHeight: roof.baseHeight + roof.height
      });
    }
    
    for (var i = 0; i < furnitureItems.length; i++) {
      var furn = furnitureItems[i];
      var fCenterY = (furn.level || 0) * 3.5 + (furn.height || 0.7) / 2;
      var fDist = Math.sqrt(
        (furn.x - camera.targetX) * (furn.x - camera.targetX) + 
        (fCenterY) * (fCenterY) +
        (furn.z - camera.targetZ) * (furn.z - camera.targetZ)
      );
      allObjects.push({ object: furn, type: 'furniture', distance: fDist, maxHeight: (furn.level || 0) * 3.5 + (furn.height || 0.7) });
    }
    
    console.log('All objects before sorting:', allObjects.map(obj => ({ type: obj.type, id: obj.object.id })));
    
    allObjects.sort(function(a, b) {
      var distDiff = b.distance - a.distance;
      if (Math.abs(distDiff) > 1.0) {
        return distDiff;
      }
      return a.maxHeight - b.maxHeight;
    });
    
    console.log('Current floor:', currentFloor);
    console.log('All objects after sorting:', allObjects.map(obj => ({ type: obj.type, id: obj.object.id })));
    
    for (var i = 0; i < allObjects.length; i++) {
      var item = allObjects[i];
      switch (item.type) {
        case 'room':
          drawRoom(item.object);
          break;
        case 'stairs':
          drawStairs(item.object);
          break;
        case 'furniture':
          drawFurniture(item.object);
          break;
        case 'balcony':
          console.log('Found balcony to draw:', item.object);
          drawBalcony(item.object);
          break;
        case 'pergola':
          drawPergola(item.object);
          break;
        case 'garage':
          drawGarage(item.object);
          break;
        case 'roof':
          drawRoof(item.object);
          break;
      }
    }
    
  updateLabels();
  drawCompass();
    updateMeasurements();
    
  } catch (error) {
    console.error('Render error:', error);
    updateStatus('Render error');
  }
  
  animationId = requestAnimationFrame(renderLoop);
}

function startRender() {
  if (animationId) cancelAnimationFrame(animationId);
  renderLoop();
}

document.addEventListener('DOMContentLoaded', startApp);

// ---------- Save/Load and Export ----------
function serializeProject() {
  return JSON.stringify({
    version: 1,
    camera: camera,
    rooms: allRooms,
    stairs: stairsComponent,
    pergolas: pergolaComponents,
    garages: garageComponents,
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
    stairsComponent = data.stairs || null;
    pergolaComponents = Array.isArray(data.pergolas) ? data.pergolas : [];
    garageComponents = Array.isArray(data.garages) ? data.garages : [];
    roofComponents = Array.isArray(data.roofs) ? data.roofs : [];
    balconyComponents = Array.isArray(data.balconies) ? data.balconies : [];
  furnitureItems = Array.isArray(data.furniture) ? data.furniture : [];
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
  if (stairsComponent) pushBox(stairsComponent, 0, stairsComponent.height, 'stairs');
  pergolaComponents.forEach(function(p){ pushBox(p,0,p.totalHeight,'pergola'); });
  garageComponents.forEach(function(g){ pushBox(g,0,g.height,'garage'); });
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
    var { jsPDF } = window.jspdf || {};
    if (!jsPDF) { updateStatus('PDF library not loaded'); return; }
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

  var actionsMenu = document.getElementById('actionsMenu');
  if (actionsMenu) actionsMenu.onchange = function() {
    switch (this.value) {
      case 'obj':
        exportOBJ();
        break;
      case 'pdf':
        exportPDF();
        break;
      case 'obj-upload': {
        var foi = document.getElementById('upload-obj-file'); if (foi) foi.click();
        break;
      }
      case 'json-download': {
        var blob = new Blob([serializeProject()], {type:'application/json'});
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gablok-project.json'; a.click(); URL.revokeObjectURL(a.href);
        break;
      }
      case 'json-upload': {
        var fi = document.getElementById('upload-file'); if (fi) fi.click();
        break;
      }
    }
    this.value = '';
  };

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

  // Populate palette items
  setupPalette();
});

// ---------- Room Palette ----------
// Catalog with rough real-world dimensions (meters) and a simple type tag for thumbnail rendering
// Width (X), Depth (Z), Height (Y) are approximate; adjust as needed.
var PALETTE_ITEMS = [
  { name: 'Single Bed',           width: 1.0, depth: 2.0, height: 0.6, kind: 'bed' },
  { name: 'Double Bed',           width: 1.4, depth: 2.0, height: 0.6, kind: 'bed' },
  { name: 'Queen Bed',            width: 1.6, depth: 2.0, height: 0.6, kind: 'bed' },
  { name: 'King Bed',             width: 1.8, depth: 2.0, height: 0.6, kind: 'bed' },
  { name: 'Bath',                 width: 0.8, depth: 1.7, height: 0.6, kind: 'bath' },
  { name: 'Shower',               width: 0.9, depth: 0.9, height: 2.1, kind: 'shower' },
  { name: 'Double Shower',        width: 1.6, depth: 0.9, height: 2.1, kind: 'shower' },
  { name: 'Sink',                 width: 0.6, depth: 0.5, height: 0.9, kind: 'sink' },
  { name: 'Double Sink',          width: 1.2, depth: 0.5, height: 0.9, kind: 'sink' },
  { name: 'Bedside Table',        width: 0.5, depth: 0.4, height: 0.5, kind: 'table' },
  { name: 'Kitchen Design 01',    width: 3.0, depth: 0.7, height: 0.9, kind: 'kitchen' },
  { name: 'Kitchen Design 02',    width: 2.4, depth: 1.6, height: 0.9, kind: 'kitchen' },
  { name: 'Kitchen Design 03',    width: 3.6, depth: 1.8, height: 0.9, kind: 'kitchen' },
  { name: 'Kitchen Design 04',    width: 2.8, depth: 0.7, height: 0.9, kind: 'kitchen' },
  { name: 'Kitchen Design 05',    width: 3.2, depth: 0.7, height: 0.9, kind: 'kitchen' },
  { name: 'Single Fridge',        width: 0.7, depth: 0.7, height: 1.8, kind: 'fridge' },
  { name: 'Double Fridge',        width: 0.9, depth: 0.8, height: 1.8, kind: 'fridge' },
  { name: '42" TV',               width: 0.95, depth: 0.1, height: 0.6, kind: 'tv' },
  { name: '72" TV',               width: 1.6,  depth: 0.1, height: 1.0, kind: 'tv' },
  { name: '84" TV',               width: 1.9,  depth: 0.1, height: 1.1, kind: 'tv' },
  { name: '108" TV',              width: 2.4,  depth: 0.1, height: 1.4, kind: 'tv' },
  { name: 'Sofa 3 seats',         width: 2.0, depth: 0.9, height: 0.9, kind: 'sofa' },
  { name: 'Sofa 4 seats',         width: 2.4, depth: 0.9, height: 0.9, kind: 'sofa' },
  { name: 'Sofa 5 seats',         width: 2.8, depth: 0.9, height: 0.9, kind: 'sofa' },
  { name: 'Sofa 6 seats L',       width: 2.8, depth: 2.0, height: 0.9, kind: 'sofaL' },
  { name: 'Sofa 7 seats L',       width: 3.2, depth: 2.2, height: 0.9, kind: 'sofaL' },
  { name: 'Armchair',             width: 0.9, depth: 0.9, height: 0.9, kind: 'armchair' },
  { name: 'Dishwasher',           width: 0.6, depth: 0.6, height: 0.85, kind: 'appliance' },
  { name: '4 Seat kitchen table', width: 1.2, depth: 0.8, height: 0.75, kind: 'table' },
  { name: '6 Seat kitchen table', width: 1.6, depth: 0.9, height: 0.75, kind: 'table' },
  { name: '8 seat kitchen table', width: 2.0, depth: 0.9, height: 0.75, kind: 'table' },
  { name: '10 Seat Kitchen table',width: 2.4, depth: 1.0, height: 0.75, kind: 'table' },
  { name: '4 Seat Dinning table', width: 1.2, depth: 0.8, height: 0.75, kind: 'table' },
  { name: '6 Seat Dinning table', width: 1.6, depth: 0.9, height: 0.75, kind: 'table' },
  { name: '8 seat Dinning table', width: 2.0, depth: 0.9, height: 0.75, kind: 'table' },
  { name: '10 Seat Dinning table',width: 2.4, depth: 1.0, height: 0.75, kind: 'table' },
  { name: 'Bar stool 1-8',        width: 0.45, depth: 0.45, height: 0.75, kind: 'stool' }
];

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
    var nameDiv = document.createElement('div'); nameDiv.className = 'palette-name'; nameDiv.textContent = it.name; item.appendChild(nameDiv);
    // draw simple 3D-ish wireframe thumbnail to scale
    renderItemThumb(c, it);
    (function(def){ item.onclick = function(){ addPaletteItem(def); }; })(it);
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
  renderRoomPreview(room);
  // Keep preview responsive while open
  try {
    if (window.__paletteResizeHandler) window.removeEventListener('resize', window.__paletteResizeHandler);
    window.__paletteResizeHandler = function(){ var r = findObjectById(paletteOpenForId); if (r) renderRoomPreview(r); };
    window.addEventListener('resize', window.__paletteResizeHandler);
  } catch(e){}
}

function hideRoomPalette() {
  var modal = document.getElementById('room-palette-modal');
  if (modal) modal.style.display = 'none';
  paletteOpenForId = null;
  var dd = document.getElementById('roof-type-dropdown'); if (dd) dd.style.display = 'block';
  try { if (window.__paletteResizeHandler) { window.removeEventListener('resize', window.__paletteResizeHandler); window.__paletteResizeHandler = null; } } catch(e){}
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
  // Subtle grid (very light)
  var padG = 20; var step = 30; cx.save(); cx.globalAlpha = 0.45; cx.strokeStyle = '#f5f7fa'; cx.lineWidth = 1;
  for (var gx = padG; gx <= cv.width - padG; gx += step) { cx.beginPath(); cx.moveTo(gx, padG); cx.lineTo(gx, cv.height - padG); cx.stroke(); }
  for (var gy = padG; gy <= cv.height - padG; gy += step) { cx.beginPath(); cx.moveTo(padG, gy); cx.lineTo(cv.width - padG, gy); cx.stroke(); }
  cx.restore();
  // 3D-ish room wireframe box
  var pad = 30; var w = rect.width - pad*2; var h = rect.height - pad*2;
  var rw = room.width, rd = room.depth, ry = room.height;
  var maxFoot = Math.max(rw, rd);
  var scale = Math.min(w, h) * 0.8 / Math.max(maxFoot, 0.001);
  var angle = Math.PI/6; var cos = Math.cos(angle), sin = Math.sin(angle);
  function proj3(x,y,z){ var u=(x - z)*cos; var v=-y + (x + z)*sin*0.5; return { x: rect.width/2 + u*scale, y: rect.height/2 + v*scale }; }
  var hw = rw/2, hd = rd/2, ht = ry;
  var pts = [
    proj3(-hw, 0, -hd), proj3(hw, 0, -hd), proj3(hw, 0, hd), proj3(-hw, 0, hd),
    proj3(-hw, ht, -hd), proj3(hw, ht, -hd), proj3(hw, ht, hd), proj3(-hw, ht, hd)
  ];
  var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  cx.strokeStyle = '#2d6cdf'; cx.lineWidth = 1.0; cx.fillStyle = 'rgba(45,108,223,0.08)';
  // Top face fill
  cx.beginPath(); cx.moveTo(pts[4].x, pts[4].y); cx.lineTo(pts[5].x, pts[5].y); cx.lineTo(pts[6].x, pts[6].y); cx.lineTo(pts[7].x, pts[7].y); cx.closePath(); cx.fill();
  // Edges
  cx.beginPath(); for (var i=0;i<edges.length;i++){ var e=edges[i]; cx.moveTo(pts[e[0]].x, pts[e[0]].y); cx.lineTo(pts[e[1]].x, pts[e[1]].y);} cx.stroke();
  // Dimensions label
  cx.fillStyle = '#2d6cdf'; cx.font = '12px system-ui'; cx.textAlign = 'left'; cx.textBaseline = 'top';
  cx.fillText(room.width.toFixed(1)+' x '+room.depth.toFixed(1)+' x '+room.height.toFixed(1)+' m', 10, 10);
}

function addPaletteItem(def) {
  if (!paletteOpenForId) return;
  var room = findObjectById(paletteOpenForId);
  if (!room) return;
  // Add furniture with catalog dimensions
  var furn = { id: 'furn_'+Date.now()+Math.random().toString(36).slice(2), x: room.x, z: room.z, width: def.width, depth: def.depth, height: def.height, level: room.level, name: def.name, type: 'furniture', rotation: 0, kind: def.kind };
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
}
