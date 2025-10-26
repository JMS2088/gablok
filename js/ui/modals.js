// UI Modals (Info and Share)
// Kept as global functions for compatibility with existing inline onclick handlers.
(function(){
  function setStatus(message){
    try { var el=document.getElementById('status'); if(el) el.textContent = message; } catch(e) {}
  }

  // Info modal controls
  window.showInfo = function(){
    var modal = document.getElementById('info-modal'); if (!modal) return;
    // Hide roof dropdown while modal is open
  var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.style.display = 'none';
  var roofControls = document.getElementById('roof-controls'); if (roofControls) roofControls.style.display = 'none';
    modal.style.display = 'block';
  };
  window.hideInfo = function(){
    var modal = document.getElementById('info-modal'); if (modal) modal.style.display = 'none';
    // Restore roof dropdown visibility after closing
  var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.style.display = 'block';
  var roofControls = document.getElementById('roof-controls'); if (roofControls) { var hasRoof = Array.isArray(window.roofComponents) && roofComponents.length>0; roofControls.style.display = hasRoof ? 'inline-flex' : 'none'; }
  };

  // Share modal controls
  window.showShare = function(){
    try{
      var modal = document.getElementById('share-modal'); if(!modal) return;
      var input = document.getElementById('share-url');
      var openA = document.getElementById('share-open');
      var hint = document.getElementById('share-hint');
      var fallUrl = window.location.href;
      // Try to fetch forwarded URL from server helper
      fetch('/__forwarded', { cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(info){
          var best = fallUrl;
          if (info && info.url) {
            // Prefer server-reported URL unless it points to localhost and our current page is remote
            var isLocal = /localhost|127\.0\.0\.1/.test(info.url);
            var pageIsRemote = !/localhost|127\.0\.0\.1/.test(window.location.host);
            if (!isLocal || !pageIsRemote) {
              best = info.url;
            }
          }
          // Ensure https for known forwarded hosts and normalize to port 8000 in subdomain
          try {
            var u = new URL(best);
            var isFwdHost = /app\.github\.dev|githubpreview\.dev|gitpod\.io/.test(u.hostname);
            if (isFwdHost) {
              if (u.protocol !== 'https:') { u.protocol = 'https:'; }
              var host = u.hostname;
              var parts = host.split('.');
              var sub = parts[0] || '';
              if (sub && sub.indexOf('-') !== -1) {
                var subRest = sub.split('-', 1)[1] || '';
                parts[0] = '8000-' + subRest;
                u.hostname = parts.join('.');
              }
              best = u.toString();
            }
          } catch(e) {}
          if (input) { input.value = best; input.focus(); input.select(); }
          if (openA) { openA.href = best; }
          var isForwarded = /app\.github\.dev|githubpreview\.dev|gitpod\.io|codespaces|gitpod/.test(best);
          if (hint) {
            if (isForwarded) {
              var extra = '';
              try {
                var u = new URL(best);
                var looksCodespaces = /app\.github\.dev$/.test(u.hostname);
                if (looksCodespaces) {
                  extra = ' If this link returns 404/403 for others, set port 8000 to Public in the Ports panel.';
                }
              } catch(e) {}
              hint.textContent = 'Forwarded URL detected.' + extra;
            } else {
              hint.textContent = 'If using Codespaces/Gitpod, share the forwarded URL from your browser address bar.';
            }
          }
          modal.style.display = 'flex';
        })
        .catch(function(){
          if(input) { input.value = fallUrl; input.focus(); input.select(); }
          if(openA) { openA.href = fallUrl; }
          if(hint) hint.textContent = 'If using Codespaces/Gitpod, share the forwarded URL from your browser address bar.';
          modal.style.display = 'flex';
        });
    }catch(e){ console.warn('showShare failed', e); }
  };
  window.hideShare = function(){ var modal = document.getElementById('share-modal'); if(modal) modal.style.display='none'; };
  window.copyShareUrl = function(){
    var input = document.getElementById('share-url'); if(!input) return;
    input.select(); input.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); setStatus('URL copied'); }
    catch(e){ if(navigator.clipboard){ navigator.clipboard.writeText(input.value).then(function(){ setStatus('URL copied'); }).catch(function(){ setStatus('Copy failed'); }); } }
  };
})();
