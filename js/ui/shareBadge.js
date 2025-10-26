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
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '6px';
      wrap.style.marginLeft = '8px';
      wrap.style.padding = '4px 8px';
      wrap.style.border = '1px solid #e5e7eb';
      wrap.style.borderRadius = '8px';
      wrap.style.background = '#ffffff';
      wrap.style.font = '12px system-ui, sans-serif';
      var icon = document.createElement('span');
      icon.textContent = '🔗';
      icon.setAttribute('aria-hidden','true');
      var link = document.createElement('a');
      link.id = 'share-badge-link';
      link.href = '#';
      link.textContent = 'Share';
      link.style.color = '#1f2937';
      link.style.textDecoration = 'none';
      link.target = '_blank'; link.rel = 'noopener';
      var copy = document.createElement('button');
      copy.id = 'share-badge-copy';
      copy.className = 'secondary';
      copy.textContent = 'Copy';
      copy.style.padding = '4px 8px';
      copy.addEventListener('click', function(){
        var url = link.getAttribute('data-url') || link.href || window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function(){ try{ var s=document.getElementById('status'); if(s) s.textContent='URL copied'; }catch(e){}; });
        } else {
          try { var ta=document.createElement('textarea'); ta.value=url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch(e) {}
        }
      });
      wrap.appendChild(icon);
      wrap.appendChild(link);
      wrap.appendChild(copy);
      controls.appendChild(wrap);
    }
    return wrap;
  }
  function hostLabel(u){
    try { var url = new URL(u); return url.hostname; } catch(e){ return u; }
  }
  function refresh(){
    var wrap = ensureBadge();
    fetch('/__forwarded', { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(info){
        var best = bestUrlFrom(info, window.location.href);
        var link = document.getElementById('share-badge-link');
        if (link) { link.href = best; link.setAttribute('data-url', best); link.textContent = hostLabel(best); }
      })
      .catch(function(){
        var link = document.getElementById('share-badge-link');
        if (link) { link.href = window.location.href; link.setAttribute('data-url', window.location.href); link.textContent = hostLabel(window.location.href); }
      });
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', refresh); } else { refresh(); }
  // Periodically refresh so it stays correct after port/public changes
  setInterval(refresh, 5000);
})();
