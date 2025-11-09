/**
 * @file camera.js
 * @description Orbit camera state and projection helpers extracted from engine3d.
 * Defines global camera/pan objects and exposes updateProjectionCache, project3D,
 * and focusCameraOnObject. Designed to load before engine3d.js so the engine can
 * reuse these without redefining them.
 */
(function(){
  'use strict';

  // Camera and pan defaults (idempotent)
  if (typeof window.camera === 'undefined') {
    window.camera = {
      yaw: 0.0,
      pitch: -0.5,
      distance: 12,
      targetX: 0,
      targetY: 2.5,
      targetZ: 0,
      // Constraints used by input handlers
      minPitch: -1.2,
      maxPitch: 0.3,
      minDistance: 4,
      maxDistance: 80,
      // Prevent camera from dipping below a small height when looking down
      minCamY: 0.3
    };
  } else {
    // Ensure constraint fields exist on preexisting camera objects
    if (typeof camera.minPitch !== 'number') camera.minPitch = -1.2;
    if (typeof camera.maxPitch !== 'number') camera.maxPitch = 0.3;
    if (typeof camera.minDistance !== 'number') camera.minDistance = 4;
    if (typeof camera.maxDistance !== 'number') camera.maxDistance = 80;
    if (typeof camera.minCamY !== 'number') camera.minCamY = 0.3;
    if (typeof camera.targetY !== 'number') camera.targetY = 2.5;
  }
  if (typeof window.pan === 'undefined') {
    window.pan = { x: 0, y: 0 };
  }

  // Shared projection cache object. IMPORTANT: never replace the object reference;
  // always mutate window.__proj so other modules holding a reference stay in sync.
  if (typeof window.__proj === 'undefined') {
    window.__proj = { right:[1,0,0], up:[0,1,0], fwd:[0,0,1], cam:[0,0,10], scale: 600 };
  }

  // Perspective blend strength (1.0 = full perspective, 0.0 = orthographic-like)
  if (typeof window.PERSPECTIVE_STRENGTH === 'undefined') window.PERSPECTIVE_STRENGTH = 0.88;

  // Recompute camera basis and screen scale; mutate window.__proj in place
  if (typeof window.updateProjectionCache === 'undefined') {
    window.updateProjectionCache = function updateProjectionCache(){
      var cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
      var cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
      var fwd = [ sy*cp, sp, cy*cp ];
      var right = [ Math.max(-1, Math.min(1, cy)), 0, Math.max(-1, Math.min(1, -sy)) ];
      // up = cross(fwd, right)
      var up = [
        fwd[1]*right[2] - fwd[2]*right[1],
        fwd[2]*right[0] - fwd[0]*right[2],
        fwd[0]*right[1] - fwd[1]*right[0]
      ];
      function norm(v){ var L=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/L,v[1]/L,v[2]/L]; }
      right = norm(right); up = norm(up); fwd = norm(fwd);

      // Vertical bias keeps the camera a bit lower when pitching down
      var verticalScale = (fwd[1] < 0 ? 0.6 : 1.0);
      var camY = (camera.targetY||0) - fwd[1]*camera.distance*verticalScale;
      if (typeof camera.minCamY === 'number') camY = Math.max(camera.minCamY, camY);
      var cam = [ camera.targetX - fwd[0]*camera.distance, camY, camera.targetZ - fwd[2]*camera.distance ];

      // Mutate the shared cache (do not reassign)
      var proj = window.__proj || (window.__proj = { right:[1,0,0], up:[0,1,0], fwd:[0,0,1], cam:[0,0,10], scale:600 });
      proj.right = right; proj.up = up; proj.fwd = fwd; proj.cam = cam;
      var dpr = (typeof window.devicePixelRatio==='number' && isFinite(window.devicePixelRatio)) ? window.devicePixelRatio : 1;
      var hPx = (window.canvas ? canvas.height : 800);
      var wPx = (window.canvas ? canvas.width  : 1200);
      proj.scale = Math.max(300, Math.min(hPx, wPx) * 0.6) / dpr;
    };
  }

  // Focus camera on an object's center with distance scaled by its size
  if (typeof window.focusCameraOnObject === 'undefined') {
    window.focusCameraOnObject = function focusCameraOnObject(obj){
      try {
        if (!obj) return;
        var w = Math.max(0.5, obj.width || 2);
        var d = Math.max(0.5, obj.depth || 2);
        camera.targetX = obj.x || 0;
        camera.targetZ = obj.z || 0;
        camera.distance = Math.max(8, Math.max(w, d) * 2 + 5);
        pan.x = 0; pan.y = 0;
        window._camLastMoveTime = (performance && performance.now) ? performance.now() : Date.now();
      } catch(_e) {}
    };
  }

  // Project world coordinates to screen pixel coordinates
  if (typeof window.project3D === 'undefined') {
    window.project3D = function project3D(x,y,z){
      if (!window.canvas) return null;
      var proj = window.__proj || { right:[1,0,0], up:[0,1,0], fwd:[0,0,1], cam:[0,0,10], scale:600 };
      var rx = x - proj.cam[0], ry = y - proj.cam[1], rz = z - proj.cam[2];
      var cx = rx*proj.right[0] + ry*proj.right[1] + rz*proj.right[2];
      var cy = rx*proj.up[0]    + ry*proj.up[1]    + rz*proj.up[2];
      var cz = rx*proj.fwd[0]   + ry*proj.fwd[1]   + rz*proj.fwd[2];
      // Clip/near handling (prevents mirrored scene and preserves near geometry)
      if (cz < -0.25) return null;
      if (cz < 0.02) cz = 0.02;
      var k = Math.max(0, Math.min(1, window.PERSPECTIVE_STRENGTH));
      var refZ = Math.max(0.5, camera.distance || 12);
      var czEff = cz * k + refZ * (1 - k);
      var s = proj.scale / czEff;
      var sx = (canvas.width/2) + (cx * s) + (pan && pan.x || 0);
      var sy = (canvas.height/2) - (cy * s) + (pan && pan.y || 0);
      return { x:sx, y:sy, _cz:czEff };
    };
  }
})();
