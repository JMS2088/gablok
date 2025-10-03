function drawHandlesForPergola(pergola) {
  try {
    var handleY = pergola.height + 0.2;
    var handleData = [
      {x: pergola.x + pergola.width/2, y: handleY, z: pergola.z, type: 'width+', label: 'X+', color: '#007acc'},
      {x: pergola.x - pergola.width/2, y: handleY, z: pergola.z, type: 'width-', label: 'X-', color: '#007acc'},
      {x: pergola.x, y: handleY, z: pergola.z + pergola.depth/2, type: 'depth+', label: 'Z+', color: '#0099ff'},
      {x: pergola.x, y: handleY, z: pergola.z - pergola.depth/2, type: 'depth-', label: 'Z-', color: '#0099ff'}
    ];

    for (var i = 0; i < handleData.length; i++) {
      var handle = handleData[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;

      ctx.fillStyle = handle.color;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(handle.label, screen.x, screen.y);

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
var currentFloor = 0;
var resizeHandles = [];
var animationId = null;
var stairsComponent = null;
var pergolaComponents = [];
var balconyComponents = [];
var garageComponents = [];
var roofComponents = [];
var currentSnapGuides = [];

var HANDLE_RADIUS = 12;
var GRID_SPACING = 0.5;
var SNAP_GRID_TOLERANCE = 1.0;
var SNAP_CENTER_TOLERANCE = 0.6;
var HANDLE_SNAP_TOLERANCE = 0.25;

var camera = {
  yaw: 0.5,
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
    var handleY = room.level * 3.5 + room.height + 0.2;
    
    var handleData = [
      {x: room.x + room.width/2, y: handleY, z: room.z, type: 'width+', label: 'X+', color: '#007acc'},
      {x: room.x - room.width/2, y: handleY, z: room.z, type: 'width-', label: 'X-', color: '#007acc'},
      {x: room.x, y: handleY, z: room.z + room.depth/2, type: 'depth+', label: 'Z+', color: '#0099ff'},
      {x: room.x, y: handleY, z: room.z - room.depth/2, type: 'depth-', label: 'Z-', color: '#0099ff'}
    ];
    
    for (var i = 0; i < handleData.length; i++) {
      var handle = handleData[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;
      
      ctx.fillStyle = handle.color;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(handle.label, screen.x, screen.y);
      
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
      (function() { var p = rotateHandle(roof.width/2, 0); return {x: p.x, y: p.y, z: p.z, type: 'width+', label: 'X+', color: '#007acc'}; })(),
      // X- (width-)
      (function() { var p = rotateHandle(-roof.width/2, 0); return {x: p.x, y: p.y, z: p.z, type: 'width-', label: 'X-', color: '#007acc'}; })(),
      // Z+ (depth+)
      (function() { var p = rotateHandle(0, roof.depth/2); return {x: p.x, y: p.y, z: p.z, type: 'depth+', label: 'Z+', color: '#0099ff'}; })(),
      // Z- (depth-)
      (function() { var p = rotateHandle(0, -roof.depth/2); return {x: p.x, y: p.y, z: p.z, type: 'depth-', label: 'Z-', color: '#0099ff'}; })(),
      // Y handle
      (function() { var p = rotateHandle(0, 0, 0.5); return {x: p.x, y: p.y, z: p.z, type: 'height', label: 'Y', color: '#00cc66'}; })(),
      // 360 handle, moved to the left of Y handle
      (function() { var p = rotateHandle(-0.5, 0, 0.5); return {x: p.x, y: p.y, z: p.z, type: 'rotate', label: '360', color: '#ff9900'}; })()
    ];
    
    for (var i = 0; i < roofHandles.length; i++) {
      var handle = roofHandles[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;
      
      ctx.fillStyle = handle.color;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = 'white';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(handle.label, screen.x, screen.y);
      
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
  
  allLabels.sort(function(a, b) {
    return b.depth - a.depth;
  });
  
  for (var i = 0; i < allLabels.length; i++) {
    var labelData = allLabels[i];
    var obj = labelData.object;
    var screen = labelData.screen;
    
    var label = document.createElement('div');
    label.className = 'room-label';
    if (selectedRoomId === obj.id) label.className += ' selected';
    label.textContent = obj.name;
    label.style.left = Math.round(screen.x) + 'px';
    label.style.top = Math.round(screen.y) + 'px';
    
    label.style.backgroundColor = selectedRoomId === obj.id ? '#007acc' : 'white';
    label.style.color = selectedRoomId === obj.id ? 'white' : '#333';
    
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
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
        
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
    })(obj, labelData.type);
    
    container.appendChild(label);
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
          originalRoomZ: target.z
        };
        mouse.down = true;
        selectedRoomId = handle.roomId;
        canvas.style.cursor = 'grabbing';
        updateStatus('Resizing...');
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
          // Project motion onto local +X
          var proj = move.x * axisXx + move.z * axisXz;
          // For X+: moving along +X grows; for X-: moving along -X grows
          sizeDelta = (type === 'width+') ? proj : -proj;

          var newW = clamp(mouse.dragInfo.originalWidth + sizeDelta, minSize, maxSize);
          var applied = newW - mouse.dragInfo.originalWidth; // actual applied delta after clamp
          target.width = newW;

          // Move center by half the applied delta along the dragged side axis
          // Note: for width- handle, center should shift toward local -X
          var dirX = (type === 'width-') ? -1 : 1;
          target.x = mouse.dragInfo.originalRoomX + (applied / 2) * dirX * axisXx;
          target.z = mouse.dragInfo.originalRoomZ + (applied / 2) * dirX * axisXz;
          updateStatus('Resizing width...');
        } else if (type === 'depth+' || type === 'depth-') {
          // Project motion onto local +Z
          var projZ = move.x * axisZx + move.z * axisZz;
          // For Z+: moving along +Z grows; for Z-: moving along -Z grows
          sizeDelta = (type === 'depth+') ? projZ : -projZ;

          var newD = clamp(mouse.dragInfo.originalDepth + sizeDelta, minSize, maxSize);
          var appliedD = newD - mouse.dragInfo.originalDepth;
          target.depth = newD;

          // Move center by half the applied delta along the dragged side axis (local Z)
          // Note: for depth- handle, center should shift toward local -Z
          var dirZ = (type === 'depth-') ? -1 : 1;
          target.x = mouse.dragInfo.originalRoomX + (appliedD / 2) * dirZ * axisZx;
          target.z = mouse.dragInfo.originalRoomZ + (appliedD / 2) * dirZ * axisZz;
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
      selectedRoomId = null;
      updateStatus('Selection cleared');
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
  
  // Clear selections, handles, and snap guides
  selectedRoomId = null;
  resizeHandles = [];
  currentSnapGuides = [];
  mouse.down = false;
  mouse.dragType = null;
  mouse.dragInfo = null;

  // Hide info/pricing modals if open
  var infoModal = document.getElementById('info-modal');
  if (infoModal) infoModal.style.display = 'none';
  var pricingModal = document.getElementById('pricing-modal');
  if (pricingModal) pricingModal.style.display = 'none';

  updateStatus('Reset');
  startRender();
}

document.addEventListener('click', function(e) {
  var infoModal = document.getElementById('info-modal');
  var pricingModal = document.getElementById('pricing-modal');
  
  if (infoModal && e.target === infoModal) {
    hideInfo();
  }
  
  if (pricingModal && e.target === pricingModal) {
    hidePricing();
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
      (function() { var p = rotateHandle(stairs.width/2, 0); return {x: p.x, y: handleY, z: p.z, type: 'width+', label: 'X+', color: '#007acc'}; })(),
      // X- (width-)
      (function() { var p = rotateHandle(-stairs.width/2, 0); return {x: p.x, y: handleY, z: p.z, type: 'width-', label: 'X-', color: '#007acc'}; })(),
      // Z+ (depth+)
      (function() { var p = rotateHandle(0, stairs.depth/2); return {x: p.x, y: handleY, z: p.z, type: 'depth+', label: 'Z+', color: '#0099ff'}; })(),
      // Z- (depth-)
      (function() { var p = rotateHandle(0, -stairs.depth/2); return {x:p.x, y:handleY, z:p.z, type: 'depth-', label: 'Z-', color: '#0099ff'}; })(),
      // 360 handle remains centered
      {x: stairs.x, y: handleY + 0.3, z: stairs.z, type: 'rotate', label: '360', color: '#ff9900'}
    ];
    
    for (var i = 0; i < stairHandles.length; i++) {
      var handle = stairHandles[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;
      
      ctx.fillStyle = handle.color;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = 'white';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(handle.label, screen.x, screen.y);
      
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

function drawHandlesForBalcony(balcony) {
  try {
    var handleY = balcony.level * 3.5 + balcony.height + 0.2;
    
    var balconyHandles = [
      {x: balcony.x + balcony.width/2, y: handleY, z: balcony.z, type: 'width+', label: 'X+', color: '#007acc'},
      {x: balcony.x - balcony.width/2, y: handleY, z: balcony.z, type: 'width-', label: 'X-', color: '#007acc'},
      {x: balcony.x, y: handleY, z: balcony.z + balcony.depth/2, type: 'depth+', label: 'Z+', color: '#0099ff'},
      {x: balcony.x, y: handleY, z: balcony.z - balcony.depth/2, type: 'depth-', label: 'Z-', color: '#0099ff'}
    ];
    
    for (var i = 0; i < balconyHandles.length; i++) {
      var handle = balconyHandles[i];
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) continue;
      
      ctx.fillStyle = handle.color;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = 'white';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(handle.label, screen.x, screen.y);
      
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
    console.log('Drawing garage handles');
    // Set constants
    var REGULAR_HANDLE_RADIUS = 8;
    var ROTATION_HANDLE_RADIUS = 12;
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
      label: '360°',
      color: '#ff9900',
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
        color: data.type.includes('width') ? '#007acc' : '#0099ff',
        radius: REGULAR_HANDLE_RADIUS
      });
    });
    
    console.log('Drawing handles:', garageHandles.length);
    // Draw each handle
    garageHandles.forEach(function(handle) {
      var screen = project3D(handle.x, handle.y, handle.z);
      if (!screen) return;
      
      // Draw handle circle
      ctx.fillStyle = handle.color;
      ctx.strokeStyle = handle.type === 'rotate' ? '#ffcc00' : 'white';
      ctx.lineWidth = handle.type === 'rotate' ? 3 : 2;
      
      // Draw glow for rotation handle
      if (handle.type === 'rotate') {
        ctx.save();
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 10;
      }
      
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, handle.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      if (handle.type === 'rotate') {
        ctx.restore();
      }
      
      // Draw handle label
      ctx.fillStyle = 'white';
      ctx.font = handle.type === 'rotate' ? 'bold 14px sans-serif' : 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(handle.label, screen.x, screen.y);
      
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
