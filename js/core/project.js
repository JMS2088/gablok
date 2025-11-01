/**
 * @file project.js
 * @description Project persistence and lifecycle management for Gablok 3D configurator.
 * 
 * **Responsibilities:**
 * - Serialize/deserialize entire project state to/from JSON
 * - Save/load projects via localStorage
 * - Reset project to blank state
 * - Deduplicate entities to prevent ID/state corruption
 * 
 * **Dependencies:**
 * - `js/core/engine3d.js` - Provides: camera, allRooms, wallStrips, renderLoop, updateStatus
 * - Assumes global state objects are available
 * 
 * **Global Objects Used (from engine3d.js):**
 * - `camera` - Camera position/orientation
 * - `allRooms` - Array of room objects
 * - `wallStrips` - Array of standalone wall segments
 * - `stairsComponent` - Stairs object (nullable)
 * - `pergolaComponents` - Array of pergola objects
 * - `garageComponents` - Array of garage objects
 * - `poolComponents` - Array of pool objects
 * - `roofComponents` - Array of roof objects
 * - `balconyComponents` - Array of balcony objects
 * - `furnitureItems` - Array of furniture objects (beds, kitchens, etc.)
 * - `currentFloor` - Active floor index (0 or 1)
 * - `selectedRoomId` - Currently selected room ID (nullable)
 * - `selectedWallStripIndex` - Currently selected wall strip index
 * - `pan` - 2D panning offset {x, y}
 * - `renderLoop()` - Function to trigger re-render
 * - `updateStatus(msg)` - Function to show status message
 * 
 * **Global Objects Used (from plan2d/editor.js):**
 * - `__plan2dDrafts` - Object storing draft floor plans {0: draft, 1: draft}
 * 
 * **Exports to window:**
 * - `window.serializeProject()` - Serializes current project state to JSON string
 * - `window.restoreProject(json)` - Restores project state from JSON string
 * - `window.saveProject()` - Saves project to localStorage with status feedback
 * - `window.saveProjectSilently()` - Saves project to localStorage silently
 * - `window.loadProject()` - Loads project from localStorage with status feedback
 * - `window.resetAll()` - Resets entire project to blank state
 * - `window.dedupeAllEntities()` - Removes duplicate entities by ID
 * 
 * @version 2.0 (Phase-2-Extraction)
 * @since 2024
 */

(function() {
  'use strict';

  /**
   * Serialize the entire project state to a JSON string.
   * @returns {string} JSON representation of the project
   */
  function serializeProject() {
    try {
      var data = {
        camera: {
          yaw: camera.yaw,
          pitch: camera.pitch,
          distance: camera.distance,
          targetX: camera.targetX,
          targetY: camera.targetY,
          targetZ: camera.targetZ
        },
        rooms: allRooms || [],
        wallStrips: wallStrips || [],
        stairs: stairsComponent || null,
        pergolas: pergolaComponents || [],
        garages: garageComponents || [],
        pools: poolComponents || [],
        roofs: roofComponents || [],
        balconies: balconyComponents || [],
        furniture: furnitureItems || [],
        currentFloor: typeof currentFloor === 'number' ? currentFloor : 0
      };
      return JSON.stringify(data);
    } catch (e) {
      console.error('serializeProject failed', e);
      return '{}';
    }
  }

  /**
   * Restore project state from a JSON string.
   * @param {string} json - JSON representation of the project
   */
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
      for (var i = 0; i < furnitureItems.length; i++) {
        if (furnitureItems[i] && furnitureItems[i].kind === 'kitchen') {
          furnitureItems[i].depth = 0.7;
        }
      }
      currentFloor = typeof data.currentFloor === 'number' ? data.currentFloor : currentFloor;
      selectedRoomId = null;
      // Run a global dedupe pass after restore
      dedupeAllEntities();
      renderLoop();
    } catch (e) {
      console.error('Restore failed', e);
    }
  }

  /**
   * Save project to localStorage silently (no status message).
   */
  function saveProjectSilently() {
    try {
      localStorage.setItem('gablok_project', serializeProject());
    } catch (e) {
      console.error('Silent save failed', e);
    }
  }

  /**
   * Save project to localStorage with status feedback.
   */
  function saveProject() {
    try {
      localStorage.setItem('gablok_project', serializeProject());
      updateStatus('Project saved');
    } catch (e) {
      console.error(e);
      updateStatus('Save failed');
    }
  }

  /**
   * Load project from localStorage with status feedback.
   */
  function loadProject() {
    try {
      var json = localStorage.getItem('gablok_project');
      if (!json) {
        updateStatus('No saved project');
        return;
      }
      restoreProject(json);
      updateStatus('Project loaded');
    } catch (e) {
      console.error(e);
      updateStatus('Load failed');
    }
  }

  /**
   * Reset the entire project to a blank state.
   * Clears localStorage, in-memory data, and resets camera/UI.
   */
  function resetAll() {
    try {
      // Clear persisted project and 2D drafts
      try {
        localStorage.removeItem('gablok_project');
      } catch (e) {}
      try {
        localStorage.removeItem('gablok_plan2dDrafts_v1');
      } catch (e) {}
      // Clear in-memory 2D drafts if present
      try {
        if (typeof __plan2dDrafts !== 'undefined') {
          __plan2dDrafts = { 0: null, 1: null };
        }
      } catch (e) {}

      // Reset scene data
      allRooms = [];
      wallStrips = [];
      stairsComponent = null;
      pergolaComponents = [];
      garageComponents = [];
      poolComponents = [];
      roofComponents = [];
      balconyComponents = [];
      furnitureItems = [];
      selectedRoomId = null;
      selectedWallStripIndex = -1;
      currentFloor = 0;

      // Optionally reset camera/pan
      try {
        camera.yaw = 0.0;
        camera.pitch = -0.5;
        camera.distance = 12;
        camera.targetX = 0;
        camera.targetY = 2.5;
        camera.targetZ = 0;
        pan.x = 0;
        pan.y = 0;
      } catch (e) {}

      // Hide any open modals
      [
        'plan2d-page',
        'plan2d-modal',
        'floorplan-modal',
        'pricing-modal',
        'room-palette-modal',
        'share-modal',
        'info-modal'
      ].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      // Re-render and notify
      renderLoop && renderLoop();
      updateStatus && updateStatus('Reset project');
    } catch (e) {
      console.warn('resetAll failed', e);
    }
  }

  /**
   * Remove duplicate entities by ID across all entity arrays.
   * Prevents ID collisions and state corruption after imports/merges.
   */
  function dedupeAllEntities() {
    try {
      // Helper: dedupe array by 'id' field, keeping first occurrence
      function dedupeById(arr) {
        if (!Array.isArray(arr)) return arr;
        var seen = {};
        return arr.filter(function(item) {
          if (!item || typeof item.id === 'undefined') return true; // keep items without ID
          if (seen[item.id]) return false; // duplicate
          seen[item.id] = true;
          return true;
        });
      }

      allRooms = dedupeById(allRooms);
      pergolaComponents = dedupeById(pergolaComponents);
      garageComponents = dedupeById(garageComponents);
      poolComponents = dedupeById(poolComponents);
      roofComponents = dedupeById(roofComponents);
      balconyComponents = dedupeById(balconyComponents);
      furnitureItems = dedupeById(furnitureItems);
      // wallStrips typically don't have IDs, but apply anyway in case they do
      wallStrips = dedupeById(wallStrips);
    } catch (e) {
      console.warn('dedupeAllEntities failed', e);
    }
  }

  // Export to global scope
  window.serializeProject = serializeProject;
  window.restoreProject = restoreProject;
  window.saveProject = saveProject;
  window.saveProjectSilently = saveProjectSilently;
  window.loadProject = loadProject;
  window.resetAll = resetAll;
  window.dedupeAllEntities = dedupeAllEntities;

})();
