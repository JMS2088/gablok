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
 * - `stairsComponent` - Stairs object (nullable, legacy alias of the most-recent stair)
 * - `stairsComponents` - Array of stairs objects (multi-stairs)
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
  // Multi-stairs persistence (backward compatible)
  stairsList: (Array.isArray(window.stairsComponents) ? window.stairsComponents : (stairsComponent ? [stairsComponent] : [])),
        pergolas: pergolaComponents || [],
        garages: garageComponents || [],
        pools: poolComponents || [],
        roofs: roofComponents || [],
        balconies: balconyComponents || [],
        furniture: furnitureItems || [],
        currentFloor: typeof currentFloor === 'number' ? currentFloor : 0,
        // AI-generated images from visualize panel
        aiImages: Array.isArray(window.__projectAiImages) ? window.__projectAiImages : [],
        // Persist 2D drafts (per floor) including guides and view so measurements/rulers restore identically
        plan2d: (function(){
          try{
            var drafts = {};
            // Prefer existing drafts; if missing, synthesize from current in-memory state for the active floor
            var src = (typeof window.__plan2dDrafts==='object' && window.__plan2dDrafts) ? window.__plan2dDrafts : {};
            var floors = [0,1];
            for(var i=0;i<floors.length;i++){
              var f = floors[i];
              var d = src[f];
              if(d && typeof d==='object'){
                drafts[f] = JSON.parse(JSON.stringify(d));
              } else if (window.__plan2d && (typeof currentFloor==='number' ? currentFloor : 0) === f) {
                // Minimal snapshot from current editor state
                drafts[f] = {
                  elements: JSON.parse(JSON.stringify(__plan2d.elements||[])),
                  guidesV: JSON.parse(JSON.stringify(__plan2d.guidesV||[])),
                  guidesH: JSON.parse(JSON.stringify(__plan2d.guidesH||[])),
                  userEdited: !!__plan2d.__userEdited,
                  view: {
                    scale: __plan2d.scale,
                    panX: __plan2d.panX,
                    panY: __plan2d.panY,
                    centerX: __plan2d.centerX,
                    centerZ: __plan2d.centerZ,
                    yFromWorldZSign: __plan2d.yFromWorldZSign
                  }
                };
              }
            }
            return { drafts: drafts };
          }catch(_p2d){ return undefined; }
        })()
      };
      return JSON.stringify(data);
    } catch (e) {
      console.error('serializeProject failed', e);
      return '{}';
    }
  }

  /**
   * Restore project state from a JSON string.
   * Handles both full project format and 2D plan export format.
   * @param {string} json - JSON representation of the project
   */
  function restoreProject(json) {
    try {
      var data = JSON.parse(json);
      if (!data) return;
      
      // Case 1: Raw array of 2D elements (from plan2dExport)
      // Detected by: array with objects having 'type' like 'wall', 'room', 'door', 'window'
      if (Array.isArray(data) && data.length > 0) {
        var firstItem = data[0];
        if (firstItem && (firstItem.type === 'wall' || firstItem.type === 'room' || 
            firstItem.type === 'door' || firstItem.type === 'window' || firstItem.type === 'rect')) {
          // This is a 2D elements array - delegate to plan2dImport
          console.log('[restoreProject] Detected 2D elements array, delegating to plan2dImport');
          if (typeof window.plan2dImport === 'function') {
            window.plan2dImport(data);
            updateStatus && updateStatus('2D plan imported - Apply to create 3D');
            return;
          } else {
            updateStatus && updateStatus('2D import not loaded - open 2D editor first');
            return;
          }
        }
      }
      
      // Case 2: Object with elements array (alternative 2D format)
      if (data && typeof data === 'object' && Array.isArray(data.elements) && !data.rooms) {
        var firstEl = data.elements[0];
        if (firstEl && (firstEl.type === 'wall' || firstEl.type === 'room' || 
            firstEl.type === 'door' || firstEl.type === 'window' || firstEl.type === 'rect')) {
          console.log('[restoreProject] Detected 2D elements object, delegating to plan2dImport');
          if (typeof window.plan2dImport === 'function') {
            window.plan2dImport(data.elements);
            updateStatus && updateStatus('2D plan imported - Apply to create 3D');
            return;
          }
        }
      }
      
      // Case 3: Full project format (has rooms, wallStrips, etc.)
      camera = Object.assign(camera, data.camera || {});
      allRooms = Array.isArray(data.rooms) ? data.rooms : [];
      wallStrips = Array.isArray(data.wallStrips) ? data.wallStrips : [];
      
      // Fix: Deduplicate wall strips by geometry to prevent crash on load from bloated files
      if (wallStrips.length > 0) {
        wallStrips = dedupeWallStrips(wallStrips);
      }

      // Restore stairs (multi first, fallback to single)
      try {
        window.stairsComponents = Array.isArray(data.stairsList) ? data.stairsList : [];
      } catch(_sl) { window.stairsComponents = []; }
      stairsComponent = data.stairs || null;
      // If only singleton present, mirror into array; if array present, set alias to last for compatibility
      try {
        if ((!Array.isArray(window.stairsComponents) || window.stairsComponents.length===0) && stairsComponent) {
          window.stairsComponents = [stairsComponent];
        }
        if (Array.isArray(window.stairsComponents) && window.stairsComponents.length) {
          stairsComponent = window.stairsComponents[window.stairsComponents.length-1];
        }
      } catch(_sa){}
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
      // Restore AI-generated images
      window.__projectAiImages = Array.isArray(data.aiImages) ? data.aiImages : [];
      // Restore 2D drafts (per floor), including guides and view info
      try{
        if (data.plan2d && data.plan2d.drafts && typeof data.plan2d.drafts === 'object'){
          window.__plan2dDrafts = JSON.parse(JSON.stringify(data.plan2d.drafts));
          // Persist to localStorage so reopening the 2D editor picks them up
          try { if (typeof window.savePlan2dDraftsToStorage === 'function') window.savePlan2dDraftsToStorage(); } catch(_sv) {}
          // If 2D editor is active, reload the current floor's draft immediately
          try {
            if (window.__plan2d && __plan2d.active && typeof window.plan2dLoadDraft==='function'){
              window.plan2dLoadDraft(typeof window.currentFloor==='number'? window.currentFloor:0);
              if (typeof window.plan2dDraw==='function') window.plan2dDraw();
            }
          } catch(_p2dNow) {}
        }
      } catch(_rp2d) {}
      selectedRoomId = null;
      // Run a global dedupe pass after restore
      dedupeAllEntities();
      renderLoop();
      // Refresh Level menu states (e.g., disable '+ Stairs' if present)
      try { if (typeof window.updateLevelMenuStates === 'function') window.updateLevelMenuStates(); } catch(_u){}
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
      console.log('[resetAll] Starting complete reset...');
      
      // Clear ALL persisted data (including profile, traces, drafts)
      try {
        const keysToRemove = [
          'gablok_project',
          'gablok_plan2dDrafts_v1',
          'gablok_rtTrace_v1',
          'gablokProfile',
          'gablokUserId'
        ];
        keysToRemove.forEach(function(key) {
          try {
            localStorage.removeItem(key);
            console.log('[resetAll] Removed:', key);
          } catch (e) {
            console.warn('[resetAll] Failed to remove:', key, e);
          }
        });
        
        // Also remove any keys starting with 'gablok'
        try {
          const allKeys = Object.keys(localStorage);
          allKeys.forEach(function(key) {
            if (key.toLowerCase().indexOf('gablok') !== -1) {
              localStorage.removeItem(key);
              console.log('[resetAll] Removed extra key:', key);
            }
          });
        } catch(e) {}
        
      } catch (e) {
        console.warn('[resetAll] localStorage clear failed:', e);
      }
      
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
  try { window.stairsComponents = []; } catch(_rs){}
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

      // Reset render mode to default
      try {
        window.__wallRenderMode = 'line';
        window.__windowGlassColor = null;
        window.__windowGlassThickness = null;
      } catch (e) {}

      // Hide any open modals
      [
        'plan2d-page',
        'plan2d-modal',
        'floorplan-modal',
        'pricing-modal',
        'room-palette-modal',
        'share-modal',
        'info-modal',
        'account-modal'
      ].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

  // Re-render and notify
  renderLoop && renderLoop();
  // Refresh Level menu states (re-enable '+ Stairs')
  try { if (typeof window.updateLevelMenuStates === 'function') window.updateLevelMenuStates(); } catch(_u2){}
      updateStatus && updateStatus('Reset complete');
      console.log('[resetAll] Reset complete');
    } catch (e) {
      console.error('[resetAll] Reset failed:', e);
    }
  }

  /**
   * Reset only in-memory scene state (3D + 2D) before importing a file.
   * Does NOT touch localStorage or camera; leaves UI controls as-is.
   * Ensures old content and drafts do not bleed into the newly imported data.
   */
  function resetSceneForImport() {
    try {
      // 3D entities
      allRooms = [];
      wallStrips = [];
      stairsComponent = null;
      try { window.stairsComponents = []; } catch(_rs){}
      pergolaComponents = [];
      garageComponents = [];
      poolComponents = [];
      roofComponents = [];
      balconyComponents = [];
      furnitureItems = [];
      selectedRoomId = null;
      selectedWallStripIndex = -1;
      // Keep currentFloor and camera/pan so user context remains intact

      // 2D editor state (clear current in-memory plan and guides)
      try {
        if (window.__plan2d) {
          __plan2d.elements = [];
          __plan2d.guidesV = [];
          __plan2d.guidesH = [];
          __plan2d.selectedIndex = -1;
          __plan2d.selectedIndices = [];
          __plan2d.selectedSubsegment = null;
          __plan2d.chainActive = false;
          __plan2d.chainPoints = [];
          if (typeof window.plan2dResetDirty === 'function') plan2dResetDirty();
          if (typeof window.plan2dDraw === 'function') plan2dDraw();
        }
      } catch(_p2d) {}

      // Clear any render caches that could re-draw stale outlines
      try { window.__roomOutlineCache = {}; } catch(_oc) {}
      try { window.__extCornerSnap = {}; } catch(_sn) {}

      // Re-render scene after purge
      try { if (typeof renderLoop === 'function') renderLoop(); } catch(_r) {}
      try { if (typeof updateStatus === 'function') updateStatus('Cleared scene for import'); } catch(_s) {}
    } catch (e) {
      console.warn('resetSceneForImport failed', e);
    }
  }

  /**
   * Deduplicate wall strips by geometry (start/end points) to prevent performance issues.
   * Merges properties where possible.
   */
  function dedupeWallStrips(strips) {
    if (!Array.isArray(strips) || strips.length === 0) return [];
    try {
      var map = {};
      var out = [];
      // Helper to quantize coordinates to 1mm
      function kf(v) { return Math.round((+v || 0) * 1000) / 1000; }
      
      for (var i = 0; i < strips.length; i++) {
        var s = strips[i];
        if (!s) continue;
        // Create a sorted key from endpoints (x0,z0) and (x1,z1)
        var x0 = kf(s.x0), z0 = kf(s.z0);
        var x1 = kf(s.x1), z1 = kf(s.z1);
        var p1 = x0 + ',' + z0;
        var p2 = x1 + ',' + z1;
        var key = (p1 < p2) ? (p1 + '|' + p2) : (p2 + '|' + p1);
        
        // Include level in key to avoid merging strips from different floors
        key += '|L' + (s.level || 0);

        if (!map[key]) {
          map[key] = s;
          out.push(s);
        } else {
          // Merge logic: keep the one with openings if the other doesn't have them
          var existing = map[key];
          if ((!existing.openings || existing.openings.length === 0) && (s.openings && s.openings.length > 0)) {
            existing.openings = s.openings;
          }
          // If both have openings, we assume they are similar enough or just keep the first one
          // to avoid complexity. The goal is to stop the crash.
        }
      }
      if (strips.length !== out.length) {
        console.log('[restoreProject] Deduped wallStrips from ' + strips.length + ' to ' + out.length);
      }
      return out;
    } catch (e) {
      console.warn('dedupeWallStrips failed', e);
      return strips;
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
  // Stairs (multi) then others
  try { if (Array.isArray(window.stairsComponents)) window.stairsComponents = dedupeById(window.stairsComponents); } catch(_ddS){}
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
  window.resetSceneForImport = resetSceneForImport;
  window.dedupeAllEntities = dedupeAllEntities;

})();
