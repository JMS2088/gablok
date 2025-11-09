// placement.js
// Shared non-touching placement helper.
// Exports: findNonTouchingSpot(baseRect, existingRects, gridSize)
// - baseRect: { x, z, w, d } proposed center + dimensions (width=w, depth=d)
// - existingRects: array of { x, z, w, d } footprints already placed on same level
// - gridSize: snapping increment (defaults to 1 if invalid)
// Behavior:
//   Returns a new { x, z } that does not overlap OR touch any existing rect via inclusive AABB.
//   Uses spiral (square ring) search expanding outwards from base center.
//   Stops after max rings and returns original if none free.
// Inclusive AABB means edges contacting counts as collision.
(function(){
  if (typeof window === 'undefined' || window.findNonTouchingSpot) return;
  function norm(v, def){ return (typeof v === 'number' && isFinite(v)) ? v : def; }
  function aabbTouchOrOverlap(ax0,ax1,az0,az1,bx0,bx1,bz0,bz1){
    return (ax0 <= bx1 && ax1 >= bx0 && az0 <= bz1 && az1 >= bz0); // inclusive => touching counts
  }
  function collides(cx, cz, w, d, existing){
    var hw = w/2, hd = d/2; var ax0 = cx - hw, ax1 = cx + hw, az0 = cz - hd, az1 = cz + hd;
    for (var i=0;i<existing.length;i++){
      var e = existing[i]; if(!e || !isFinite(e.x)||!isFinite(e.z)) continue;
      var hw2 = e.w/2, hd2 = e.d/2; var bx0 = e.x - hw2, bx1 = e.x + hw2, bz0 = e.z - hd2, bz1 = e.z + hd2;
      if (aabbTouchOrOverlap(ax0,ax1,az0,az1,bx0,bx1,bz0,bz1)) return true;
    }
    return false;
  }
  window.findNonTouchingSpot = function(baseRect, existingRects, gridSize){
    existingRects = Array.isArray(existingRects)? existingRects : [];
    var x = norm(baseRect && baseRect.x, 0), z = norm(baseRect && baseRect.z, 0);
    var w = Math.max(0.1, norm(baseRect && baseRect.w, 1));
    var d = Math.max(0.1, norm(baseRect && baseRect.d, 1));
    var grid = norm(gridSize, 1); if (grid <= 0) grid = 1;
    if (!collides(x,z,w,d,existingRects)) return { x:x, z:z };
    var maxRing = 50;
    for (var ring=1; ring<=maxRing; ring++){
      for (var dx=-ring; dx<=ring; dx++){
        for (var dz=-ring; dz<=ring; dz++){
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue; // perimeter only
          var cx = x + dx*grid, cz = z + dz*grid;
          if (!collides(cx,cz,w,d,existingRects)) return { x:cx, z:cz };
        }
      }
    }
    return { x:x, z:z }; // fallback (may overlap if no free spot)
  };
})();
