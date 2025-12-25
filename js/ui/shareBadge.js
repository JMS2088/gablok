// ui/shareBadge.js
// Always-visible share badge in the top controls showing the current (forwarded) URL and a copy action.
(function(){
  function bestUrlFrom(info, fallback){
    var best = fallback || window.location.href;
    try {
      if (info && info.url) {
        var isLocal = /localhost|127\.0\.0\.1/.test(info.url);
        var pageIsRemote = !/localhost|127\.0\.0\.1/.test(window.location.host);
        if (!isLocal || !pageIsRemote) best = info.url;
      }
      var u = new URL(best);
      var isFwdHost = /app\.github\.dev|githubpreview\.dev|gitpod\.io/.test(u.hostname);
      if (isFwdHost) { u.protocol = 'https:'; best = u.toString(); }
    } catch(e) {}
    return best;
  }
  function ensureBadge(){
    var controls = document.getElementById('controls') || document.body;
    var wrap = document.getElementById('share-badge');
    if (!wrap){
      wrap = document.createElement('div');
      wrap.id = 'share-badge';
      var icon = document.createElement('span');
      icon.textContent = '🔗';
      icon.setAttribute('aria-hidden','true');
      var link = document.createElement('a');
      link.id = 'share-badge-link';
      link.href = '#';
      link.textContent = 'Share';
      link.target = '_blank'; link.rel = 'noopener';
      wrap.appendChild(icon);
      wrap.appendChild(link);
      controls.appendChild(wrap);
    }
    return wrap;
  }
  function displayText(u){ try { return String(u||''); } catch(e){ return String(u||''); } }
  function refresh(){
    var wrap = ensureBadge();
    fetch('/__forwarded', { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(info){
        var best = bestUrlFrom(info, window.location.href);
        var link = document.getElementById('share-badge-link');
        if (link) { link.href = best; link.setAttribute('data-url', best); link.textContent = displayText(best); link.title = best; }
      })
      .catch(function(){
        var link = document.getElementById('share-badge-link');
        if (link) { link.href = window.location.href; link.setAttribute('data-url', window.location.href); link.textContent = displayText(window.location.href); link.title = window.location.href; }
      });
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', refresh); } else { refresh(); }
  // Periodically refresh so it stays correct after port/public changes
  setInterval(refresh, 5000);
})();
