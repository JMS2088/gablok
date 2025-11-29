/**
 * @file camera.js
 * @description Orbit camera state and projection helpers extracted from engine3d.
 * Defines global camera/pan objects and exposes updateProjectionCache, project3D,
 * and focusCameraOnObject. Designed to load before engine3d.js so the engine can
 * reuse these without redefining them.
 */
(function(){
  'use strict';

  (function(){
    // Guard: avoid redefining if already extracted
    if(window.updateProjectionCache && window.project3D && window.focusCameraOnObject && window.camera) return;

    // Establish baseline globals to prevent early undefined access by other legacy modules.
    // These were previously implicitly created in engine3d.js or other modules through first writes.
    if(typeof window.allRooms === 'undefined') window.allRooms = [];
    if(typeof window.wallStrips === 'undefined') window.wallStrips = [];
    if(typeof window.allOpenings === 'undefined') window.allOpenings = [];
    if(typeof window.allComponents === 'undefined') window.allComponents = [];
    if(typeof window.mouse === 'undefined') window.mouse = { x:0, y:0, down:false };

    // Perspective strength constant (was inline in original engine3d.js)
    const PERSPECTIVE_STRENGTH = 0.88;
    window.PERSPECTIVE_STRENGTH = PERSPECTIVE_STRENGTH;

    // Initialize camera & pan objects if absent (replicates previous implicit globals)
    window.camera = window.camera || {
      yaw: 0.65,
      pitch: -0.55,
      distance: 32,
      targetX: 0,
      targetZ: 0,
      cachedBasis: null,
      cachedMatrix: null
    };
  // Screen-space pan used across modules (x,y in pixels). Avoid 'z' here — some callers add to pan.y.
  window.pan = window.pan || { x:0, y:0 };

  // Constraints expected on the camera object by events.js and engine3d.js
  if (typeof window.camera.minPitch !== 'number') window.camera.minPitch = -1.2;
  if (typeof window.camera.maxPitch !== 'number') window.camera.maxPitch = 0.3;
  if (typeof window.camera.minDistance !== 'number') window.camera.minDistance = 4;
  if (typeof window.camera.maxDistance !== 'number') window.camera.maxDistance = 80;
  if (typeof window.camera.minCamY !== 'number') window.camera.minCamY = 0.3;

    // Cache update: use the original engine3d basis and camera placement to match rendering math
    window.updateProjectionCache = function(){
      // Precompute yaw/pitch sines/cosines
      const cy = Math.cos(window.camera.yaw), sy = Math.sin(window.camera.yaw);
      const cp = Math.cos(window.camera.pitch), sp = Math.sin(window.camera.pitch);
      // Forward points from camera toward target
      let fwd = [ sy*cp, sp, cy*cp ];
      // Right vector around world Y axis (yaw-only)
      let right = [ cy, 0, -sy ];
      // Up = cross(fwd, right)
      let up = [
        fwd[1]*right[2] - fwd[2]*right[1],
        fwd[2]*right[0] - fwd[0]*right[2],
        fwd[0]*right[1] - fwd[1]*right[0]
      ];
      function norm(v){ const L = Math.hypot(v[0],v[1],v[2]) || 1; return [ v[0]/L, v[1]/L, v[2]/L ]; }
      right = norm(right); up = norm(up); fwd = norm(fwd);

      // Camera position: target minus forward*distance, with slight vertical bias when looking down
      const targetX = window.camera.targetX || 0;
      const targetY = window.camera.targetY || 0;
      const targetZ = window.camera.targetZ || 0;
      const desiredDistance = Math.max(0.01, window.camera.distance || 12);
      const verticalScale = (fwd[1] < 0 ? 0.6 : 1.0);
      var cam = [
        targetX - fwd[0] * desiredDistance,
        targetY - fwd[1] * desiredDistance * verticalScale,
        targetZ - fwd[2] * desiredDistance
      ];
      if (typeof window.camera.minCamY === 'number') cam[1] = Math.max(window.camera.minCamY, cam[1]);
      var vecX = cam[0] - targetX;
      var vecY = cam[1] - targetY;
      var vecZ = cam[2] - targetZ;
      var actualDist = Math.hypot(vecX, vecY, vecZ) || desiredDistance;
      if (Math.abs(actualDist - desiredDistance) > 1e-5) {
        var scale = desiredDistance / actualDist;
        vecX *= scale;
        vecY *= scale;
        vecZ *= scale;
        cam = [targetX + vecX, targetY + vecY, targetZ + vecZ];
        if (typeof window.camera.minCamY === 'number') cam[1] = Math.max(window.camera.minCamY, cam[1]);
      }


        function buildHybridProjectionMatrix(scale, cssWidth, cssHeight, referenceDistance){
          if (!scale || !cssWidth || !cssHeight) return null;
          var near = (window.camera && typeof window.camera.near === 'number') ? Math.max(0.001, window.camera.near) : 0.1;
          var far = (window.camera && typeof window.camera.far === 'number') ? Math.max(near + 1, window.camera.far) : 600;
          var refZ = Math.max(0.5, referenceDistance || (window.camera && window.camera.distance) || 12);
          var k = window.PERSPECTIVE_STRENGTH || 0.88;
          var scaleX =  2 * scale / cssWidth;
          var scaleY = -2 * scale / cssHeight;
          var m = new Float32Array(16);
          m[0] = scaleX; m[4] = 0;       m[8]  = 0;                        m[12] = 0;
          m[1] = 0;      m[5] = scaleY; m[9]  = 0;                        m[13] = 0;
          m[2] = 0;      m[6] = 0;      m[10] = -(far + near) / (far - near); m[14] = -(2 * far * near) / (far - near);
          m[3] = 0;      m[7] = 0;      m[11] = -k;                       m[15] = (1 - k) * refZ;
          return Array.from(m);
        }
      // Update global projection cache used by drawRoom/grid/inputs
      try {
        if (!window.__proj) window.__proj = { right:[1,0,0], up:[0,1,0], fwd:[0,0,1], cam:[0,0,10], scale:600 };
        window.__proj.right = right;
        window.__proj.up = up;
        window.__proj.fwd = fwd;
        window.__proj.cam = cam;
        window.__proj.target = [targetX, targetY, targetZ];
        const dpr = window.devicePixelRatio || 1;
        const W = window.canvas ? window.canvas.width : 1200;
        const H = window.canvas ? window.canvas.height : 800;
        const cssW = W / dpr;
        const cssH = H / dpr;
        window.__proj.scale = Math.max(300, Math.min(H, W) * 0.6) / dpr;
        window.__proj.cssWidth = cssW;
        window.__proj.cssHeight = cssH;
        window.__proj.perspectiveStrength = PERSPECTIVE_STRENGTH;
        window.__proj.referenceDistance = desiredDistance;
        window.__proj.matrix = buildHybridProjectionMatrix(window.__proj.scale, cssW, cssH, desiredDistance);
      } catch(_eProj) {}

      // Cache essentials for camera.js consumers
      const aspect = (window.canvas ? (window.canvas.width / Math.max(1, window.canvas.height)) : (16/9));
      const near = Math.max(0.05, desiredDistance * 0.01);
      const far = Math.max(near + 50, desiredDistance + 200);
      window.camera.near = near;
      window.camera.far = far;
      window.camera.cachedBasis = { camX: cam[0], camY: cam[1], camZ: cam[2], aspect: aspect };
      window.camera.cachedMatrix = { perspective: PERSPECTIVE_STRENGTH, invPerspective: 1 - PERSPECTIVE_STRENGTH };
    };

    // Project a 3D world point to screen space (returns null if canvas not ready yet)
    window.project3D = function(x,y,z){
      if (!window.canvas) return null;
      if (!window.__proj) window.updateProjectionCache();
      const rx = x - window.__proj.cam[0], ry = y - window.__proj.cam[1], rz = z - window.__proj.cam[2];
      const cx = rx*window.__proj.right[0] + ry*window.__proj.right[1] + rz*window.__proj.right[2];
      const cy = rx*window.__proj.up[0]    + ry*window.__proj.up[1]    + rz*window.__proj.up[2];
      let   cz = rx*window.__proj.fwd[0]   + ry*window.__proj.fwd[1]   + rz*window.__proj.fwd[2];
      if (cz < -0.25) return null;
      if (cz < 0.02) cz = 0.02;
      const k = Math.max(0, Math.min(1, window.PERSPECTIVE_STRENGTH));
      const refZ = Math.max(0.5, window.camera.distance || 12);
      const czEff = cz * k + refZ * (1 - k);
      const s = window.__proj.scale / czEff;
      const px = (window.pan && typeof window.pan.x === 'number') ? window.pan.x : 0;
      const py = (window.pan && typeof window.pan.y === 'number') ? window.pan.y : 0;
      const sx = (window.canvas.width/2) + (cx * s) + px;
      const sy = (window.canvas.height/2) - (cy * s) + py;
      return { x: sx, y: sy, _cz: czEff };
    };

    // Focus camera on an object with smoothish immediate retarget
    window.focusCameraOnObject = function(obj){
      if(!obj) return;
      if(typeof obj.x === 'number') window.camera.targetX = obj.x;
      if(typeof obj.z === 'number') window.camera.targetZ = obj.z;
      window.updateProjectionCache();
    };

  })();
})();
