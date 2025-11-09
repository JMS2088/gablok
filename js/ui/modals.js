// UI Modals (Info and Share)
// Kept as global functions for compatibility with existing inline onclick handlers.
(function(){
  function setStatus(message){
    try { var el=document.getElementById('status'); if(el) el.textContent = message; } catch(e) {}
  }

  // Info modal controls
  window.showInfo = function(){
    var modal = document.getElementById('info-modal'); if (!modal) return;
    // Hide roof dropdown/controls while modal is open
    var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.classList.add('is-hidden');
    var roofControls = document.getElementById('roof-controls'); if (roofControls) roofControls.classList.remove('visible');
    modal.classList.add('visible');
  };
  window.hideInfo = function(){
    var modal = document.getElementById('info-modal'); if (modal) modal.classList.remove('visible');
    // Restore roof dropdown/controls visibility after closing
    var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.classList.remove('is-hidden');
    var roofControls = document.getElementById('roof-controls'); if (roofControls) {
      var hasRoof = Array.isArray(window.roofComponents) && roofComponents.length>0;
      if (hasRoof) roofControls.classList.add('visible'); else roofControls.classList.remove('visible');
    }
  };

  // Share modal controls
  window.showShare = function(){
    try{
  var modal = document.getElementById('share-modal'); if(!modal) return;
  var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.classList.add('is-hidden');
      var input = document.getElementById('share-url');
      var openA = document.getElementById('share-open');
      var hint = document.getElementById('share-hint');
      var fallUrl = window.location.href;
      function normalizeForwardedUrl(urlStr){
        try{
          var u = new URL(urlStr);
          var host = u.hostname;
          // Detect common forwarded domains
          var isFwdHost = /app\.github\.dev$|githubpreview\.dev$|gitpod\.io$/.test(host);
          if (!isFwdHost) return urlStr; // nothing to do
          var parts = host.split('.');
          if (parts.length === 0) return urlStr;
          var sub = parts[0] || '';
          var rest = parts.slice(1).join('.');
          var portLabel = '8000';
          var newSub = sub;
          if (sub.startsWith(portLabel + '-')) {
            // already canonical
            newSub = sub;
          } else if (sub.endsWith('-' + portLabel)) {
            // reversed form: <codespace>-8000 -> 8000-<codespace>
            newSub = portLabel + '-' + sub.slice(0, -(portLabel.length + 1));
          } else if (/^\d+-.+/.test(sub)) {
            // starts with some other port: <port>-<codespace> -> 8000-<codespace>
            var subParts = sub.split('-'); subParts.shift();
            newSub = portLabel + '-' + subParts.join('-');
          } else {
            // plain codespace name -> 8000-<codespace>
            newSub = portLabel + '-' + sub;
          }
          u.hostname = newSub + (rest ? ('.' + rest) : '');
          // Prefer https for forwarded hosts
          u.protocol = 'https:';
          return u.toString();
        } catch(e){ return urlStr; }
      }
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
          // Normalize forwarded host to canonical 8000- form, keep https
          best = normalizeForwardedUrl(best);
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
          modal.classList.add('visible');
        })
        .catch(function(){
          if(input) { input.value = fallUrl; input.focus(); input.select(); }
          if(openA) { openA.href = fallUrl; }
          if(hint) hint.textContent = 'If using Codespaces/Gitpod, share the forwarded URL from your browser address bar.';
          modal.classList.add('visible');
        });
    }catch(e){ console.warn('showShare failed', e); }
  };
  window.hideShare = function(){
    var modal = document.getElementById('share-modal'); if(modal) modal.classList.remove('visible');
    var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.classList.remove('is-hidden');
  };
  window.copyShareUrl = function(){
    var input = document.getElementById('share-url'); if(!input) return;
    input.select(); input.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); setStatus('URL copied'); }
    catch(e){ if(navigator.clipboard){ navigator.clipboard.writeText(input.value).then(function(){ setStatus('URL copied'); }).catch(function(){ setStatus('Copy failed'); }); } }
  };
})();
