// Admin client helpers: user identification & error logging
(function(){
  if(window.__adminClientInit) return; window.__adminClientInit = true;
  function genId(){
    var rand = Math.random().toString(36).slice(2,10);
    var t = Date.now().toString(36);
    return 'u-' + t + '-' + rand;
  }
  var uidKey = 'gablokUserId';
  var userId = localStorage.getItem(uidKey);
  if(!userId){
    userId = genId();
    try { localStorage.setItem(uidKey, userId); } catch(e){}
  }
  // Expose for debugging
  window.__adminUserId = userId;
  // Also expose generic user id for account/profile feature
  window.__appUserId = userId;

  async function postJSON(path, body){
    try {
      await fetch(path, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body||{}) });
    } catch(e){ /* ignore */ }
  }
  // Log user visit
  postJSON('/__log-user', { id: userId, ua: navigator.userAgent });

  // Error handlers
  window.addEventListener('error', function(ev){
    try {
      var msg = ev.message || 'Error';
      var stack = ev.error && ev.error.stack || '';
      postJSON('/__log-error', { id: userId, message: msg, stack: stack, meta: { src: ev.filename, line: ev.lineno, col: ev.colno } });
    } catch(e){ }
  });
  window.addEventListener('unhandledrejection', function(ev){
    try {
      var reason = ev.reason || {};
      var msg = (typeof reason === 'string') ? reason : (reason.message || 'unhandledrejection');
      var stack = reason && reason.stack || '';
      postJSON('/__log-error', { id: userId, message: msg, stack: stack, meta: { type: 'promise' } });
    } catch(e){ }
  });
})();

// Account modal interactions (separate IIFE to ensure DOM existence later)
(function(){
  if(window.__accountUiInit) return; window.__accountUiInit = true;
  function qs(id){ return document.getElementById(id); }
  var __accountAdminRefreshTimer = null;
  function loadProfile(){
    try {
      var data = JSON.parse(localStorage.getItem('gablokProfile')||'{}');
      ['first','last','email','office','mobile','company'].forEach(function(k){
        var el = qs('acc-' + (k==='first'?'first':k==='last'?'last':k));
      });
      if(qs('acc-first')) qs('acc-first').value = data.firstName||'';
      if(qs('acc-last')) qs('acc-last').value = data.lastName||'';
      if(qs('acc-email')) qs('acc-email').value = data.email||'';
      if(qs('acc-office')) qs('acc-office').value = data.office||'';
      if(qs('acc-mobile')) qs('acc-mobile').value = data.mobile||'';
      if(qs('acc-company')) qs('acc-company').value = data.company||'';
    } catch(e){}
  }
  function saveProfile(){
    try {
      var data = {
        firstName: qs('acc-first') && qs('acc-first').value.trim(),
        lastName: qs('acc-last') && qs('acc-last').value.trim(),
        email: qs('acc-email') && qs('acc-email').value.trim(),
        office: qs('acc-office') && qs('acc-office').value.trim(),
        mobile: qs('acc-mobile') && qs('acc-mobile').value.trim(),
        company: qs('acc-company') && qs('acc-company').value.trim()
      };
      localStorage.setItem('gablokProfile', JSON.stringify(data));
      return data;
    } catch(e){ return null; }
  }
  function showAccount(){
    var m = qs('account-modal'); if(!m) return;
    if(m.__animating) return; // avoid re-entry during animation
    loadProfile();
    m.classList.remove('closing');
    m.classList.add('visible');
    // Force reflow then add showing to trigger staged animations
    void m.offsetWidth; // reflow
    m.classList.add('showing');
  }
  function hideAccount(){
    var m = qs('account-modal'); if(!m) return;
    if(m.__animating) return;
    // Stop any admin auto-refresh when closing
    try { if (__accountAdminRefreshTimer) { clearInterval(__accountAdminRefreshTimer); __accountAdminRefreshTimer = null; } } catch(_e){}
    m.__animating = true;
    m.classList.remove('showing');
    m.classList.add('closing');
    // End after splash circle out animation ends
    var splash = document.getElementById('account-splash');
    var done = function(){
      m.classList.remove('visible','closing');
      m.__animating = false;
      splash && splash.removeEventListener('animationend', done);
    };
    // If no splash, fallback timeout
    if(splash){ splash.addEventListener('animationend', done); }
    else { setTimeout(done, 520); }
  }
  function switchView(target){
    var views = ['profile','projects','settings','payments','info','share','admin'];
    views.forEach(function(v){ var sec = qs('account-view-' + v); if(sec) sec.style.display = (v===target?'block':'none'); });
    var btns = document.querySelectorAll('.account-nav-btn');
    btns.forEach(function(b){ if(b.getAttribute('data-view')===target) b.classList.add('active'); else b.classList.remove('active'); });
    // Lazy-populate content for embedded views
    try {
      if (target === 'info' && typeof window.populateInfoControls === 'function') {
        window.populateInfoControls('account-info-body');
        // Stop admin polling if leaving admin
        if (__accountAdminRefreshTimer) { clearInterval(__accountAdminRefreshTimer); __accountAdminRefreshTimer = null; }
      } else if (target === 'share' && typeof window.fetchShareUrl === 'function') {
        window.fetchShareUrl({ inputId: 'account-share-url', openId: 'account-share-open', hintId: 'account-share-hint' });
        var openBtn = qs('account-share-open');
        if (openBtn && !openBtn.__wired){
          openBtn.__wired = true;
          openBtn.addEventListener('click', function(){
            var url = (qs('account-share-url')||{}).value || window.location.href;
            try { window.open(url, '_blank', 'noopener'); } catch(e) { location.href = url; }
          });
        }
        var copyBtn = qs('account-share-copy');
        if (copyBtn && !copyBtn.__wired){
          copyBtn.__wired = true;
          copyBtn.addEventListener('click', function(){ if (typeof window.copyShareUrl==='function') window.copyShareUrl('account-share-url'); });
        }
        if (__accountAdminRefreshTimer) { clearInterval(__accountAdminRefreshTimer); __accountAdminRefreshTimer = null; }
      } else if (target === 'admin' && typeof window.loadAdminData === 'function') {
        window.loadAdminData('account-admin-users','account-admin-errors','account-admin-spinner');
        // Auto-refresh every 20s
        try { if (__accountAdminRefreshTimer) clearInterval(__accountAdminRefreshTimer); } catch(_e){}
        __accountAdminRefreshTimer = setInterval(function(){
          try { window.loadAdminData('account-admin-users','account-admin-errors','account-admin-spinner'); } catch(_e){}
        }, 20000);
        // Wire refresh button once
        var refBtn = qs('account-admin-refresh');
        if (refBtn && !refBtn.__wired) {
          refBtn.__wired = true;
          refBtn.addEventListener('click', function(){ window.loadAdminData('account-admin-users','account-admin-errors','account-admin-spinner'); });
        }
      }
    } catch(e) {}
  }
  function wire(){
    var btn = qs('account-button'); if(btn && !btn.__wired){ btn.__wired=true; btn.addEventListener('click', showAccount); }
    var close = qs('account-close'); if(close) close.addEventListener('click', hideAccount);
    var nav = document.getElementById('account-nav');
    if(nav && !nav.__wired){
      nav.__wired=true;
      nav.addEventListener('click', function(e){
        var b = e.target.closest('.account-nav-btn'); if(!b) return;
        var view = b.getAttribute('data-view'); if (view) switchView(view);
      });
    }
  var save = qs('account-save'); if(save) save.addEventListener('click', function(){ saveProfile(); hideAccount(); });
  var cancel = qs('account-cancel'); if(cancel) cancel.addEventListener('click', function(){ hideAccount(); });
    // Allow clicking backdrop to close (optional)
    var backdrop = qs('account-splash'); if(backdrop){ backdrop.addEventListener('click', function(e){ if(e.target===backdrop) hideAccount(); }); }
  }
  // Wire immediately if DOM already loaded, else on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    setTimeout(wire, 0);
  }
  // Expose for external triggers
  window.showAccount = showAccount;
  window.hideAccount = hideAccount;
})();