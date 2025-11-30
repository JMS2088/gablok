// Tiny shared helpers for the 2D plan editor. Keep side-effect free and DOM-agnostic.
(function(){
  function isOpening(e){ return !!(e && (e.type === 'window' || e.type === 'door')); }
  function isHostedOpening(e){ return !!(isOpening(e) && typeof e.host === 'number'); }
  function isWall(e){ return !!(e && e.type === 'wall'); }
  try {
    window.plan2dUtils = window.plan2dUtils || { isOpening: isOpening, isHostedOpening: isHostedOpening, isWall: isWall };
  } catch(_e) {}
})();
