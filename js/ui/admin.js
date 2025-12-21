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
    function getProfileData(){
      try { return JSON.parse(localStorage.getItem('gablokProfile')||'{}'); }
      catch(_e){ return {}; }
    }
    function countProfileFields(profile){
      var keys = ['firstName','lastName','email','office','mobile','company'];
      return keys.reduce(function(total, key){
        var value = profile && profile[key];
        return total + (value && String(value).trim() ? 1 : 0);
      }, 0);
    }
    function loadProfile(){
      try {
        var data = getProfileData();
        if(qs('acc-first')) qs('acc-first').value = data.firstName||'';
        if(qs('acc-last')) qs('acc-last').value = data.lastName||'';
        if(qs('acc-email')) qs('acc-email').value = data.email||'';
        if(qs('acc-office')) qs('acc-office').value = data.office||'';
        if(qs('acc-mobile')) qs('acc-mobile').value = data.mobile||'';
        if(qs('acc-company')) qs('acc-company').value = data.company||'';
        return data;
      } catch(e){ return {}; }
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
        refreshAccountStats();
        return data;
      } catch(e){ return null; }
    }
  function showAccount(initialView){
    var m = qs('account-modal'); if(!m) return;
    // If the modal is already open and stable, avoid restarting open animations.
    if (m.classList.contains('visible') && m.classList.contains('showing') && !m.classList.contains('closing')) {
      loadProfile();
      updateDashboard();
      try { if (initialView) switchView(String(initialView)); } catch(_eView0) {}
      return;
    }

    // Helper: stage the 'showing' class on the next frame (smoother than forced reflow)
    function scheduleShow(){
      try {
        if (m.__opening) return;
        m.__opening = true;
        var token = (Date.now().toString(36) + Math.random().toString(36).slice(2));
        m.__openToken = token;
        requestAnimationFrame(function(){
          try {
            if (m.__openToken !== token) return;
            m.classList.add('showing');
          } finally {
            m.__opening = false;
          }
        });
      } catch (_e) {
        // Fallback: best-effort
        try { m.classList.add('showing'); } catch(_e2) {}
        m.__opening = false;
      }
    }

    // Invalidate any pending close completion (animationend/timeout).
    // This prevents a stale close finishing *after* we reopen, which looks like a jump/double-open.
    try { m.__closeToken = null; } catch(_eTok0) {}
    // If the modal was mid-close (closing animation), cancel the pending hide.
    // Otherwise the old animationend/timeout will still fire and hide the modal
    // right after we show it (looks like an unwanted redirect back to 3D).
    try {
      if (m.__hideTimer) {
        clearTimeout(m.__hideTimer);
        m.__hideTimer = null;
      }
      if (m.__hideSplash && m.__hideDone) {
        try { m.__hideSplash.removeEventListener('animationend', m.__hideDone); } catch(_e0) {}
        m.__hideSplash = null;
        m.__hideDone = null;
      }
      m.__animating = false;
      m.classList.remove('closing');
    } catch(_eCancel) {}

    // If already visible (and not closing), ensure we end up in 'showing' without restarting.
    if (m.classList.contains('visible') && !m.classList.contains('closing')) {
      loadProfile();
      updateDashboard();
      try { if (initialView) switchView(String(initialView)); } catch(_eView1) {}
      scheduleShow();
      return;
    }
    loadProfile();
    updateDashboard(); // Update dashboard stats
    // Preselect target view BEFORE showing modal to avoid dashboard flash.
    try { if (initialView) switchView(String(initialView)); } catch(_eView2) {}
    m.classList.remove('closing');
    m.classList.add('visible');
    scheduleShow();
  }
  
  function updateDashboard(){
    // Update time
    function updateTime(){
      var timeEl = qs('dashboard-time');
      if(timeEl){
        var now = new Date();
        var hours = now.getHours();
        var mins = now.getMinutes();
        var ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        mins = mins < 10 ? '0' + mins : mins;
        timeEl.textContent = hours + ':' + mins + ' ' + ampm;
      }
    }
    updateTime();
    // Update time every minute
    if(!window.__dashboardTimeInterval){
      window.__dashboardTimeInterval = setInterval(updateTime, 60000);
    }
      refreshAccountStats();
  }
  function hideAccount(){
    var m = qs('account-modal'); if(!m) return;
    if(m.__animating) return;
    // Never leave the doc reader open when the Account modal closes.
    try { if (typeof window.hideDoc === 'function') window.hideDoc(); } catch(_eDoc1) {}
    // Cancel any pending open animation so it can't fight the close.
    try { m.__openToken = null; m.__opening = false; } catch(_eOpenTok) {}
    // Stop any admin auto-refresh when closing
    try { if (__accountAdminRefreshTimer) { clearInterval(__accountAdminRefreshTimer); __accountAdminRefreshTimer = null; } } catch(_e){}
    // Stop dashboard clock updates when modal is hidden (prevents background CPU churn)
    try { if (window.__dashboardTimeInterval) { clearInterval(window.__dashboardTimeInterval); window.__dashboardTimeInterval = null; } } catch(_e2){}
    // Always reset to dashboard view before closing so multiple panels never stay open
    try { returnToDashboard(); } catch(_e3){}
    m.__animating = true;
    m.classList.remove('showing');
    m.classList.add('closing');

    // Tokenize this close attempt so a stale completion can't apply after a reopen.
    var closeToken = (Date.now().toString(36) + Math.random().toString(36).slice(2));
    try { m.__closeToken = closeToken; } catch(_eTok1) {}
    // End after the closing transition completes.
    var main = document.getElementById('account-main');
    var splash = document.getElementById('account-splash');
    // Clear any previous pending handler/timer to avoid stacking.
    try {
      if (m.__hideTimer) { clearTimeout(m.__hideTimer); m.__hideTimer = null; }
      if (m.__hideSplash && m.__hideDone) {
        try { m.__hideSplash.removeEventListener('animationend', m.__hideDone); } catch(_e1) {}
      }
    } catch(_eClearPrev) {}

    var done = function(){
      try {
        if (m.__closeToken !== closeToken) {
          // Modal has been reopened; ignore stale close completion.
          return;
        }
      } catch(_eTok2) {}
      m.classList.remove('visible','closing');
      m.__animating = false;
      try {
        if (m.__hideTimer) { clearTimeout(m.__hideTimer); m.__hideTimer = null; }
        if (m.__hideSplash && m.__hideDone) {
          try { m.__hideSplash.removeEventListener('animationend', m.__hideDone); } catch(_e2) {}
        }
        m.__hideSplash = null;
        m.__hideDone = null;
        try { m.__closeToken = null; } catch(_eTok3) {}
      } catch(_e3) {}
      try {
        if (main) main.removeEventListener('transitionend', onEnd);
        if (splash) splash.removeEventListener('transitionend', onEnd);
      } catch(_eRmEnd) {}
    };

    // Only complete once (either transition end or timeout).
    var ended = false;
    var onEnd = function(ev){
      if (ended) return;
      // Only react to opacity/transform transitions (ignore nested transitions).
      try {
        if (ev && ev.target && ev.target !== main && ev.target !== splash) return;
        var prop = ev && ev.propertyName;
        if (prop && prop !== 'opacity' && prop !== 'transform') return;
      } catch(_eProp) {}
      ended = true;
      done();
    };
    // Track the pending hide so showAccount() can cancel it.
    try {
      m.__hideDone = done;
      m.__hideSplash = splash || null;
    } catch(_eTrack) {}
    // Transition end (preferred) + fallback timeout
    try {
      if (main) main.addEventListener('transitionend', onEnd);
      if (splash) splash.addEventListener('transitionend', onEnd);
    } catch(_eAddEnd) {}
    m.__hideTimer = setTimeout(function(){ if (!ended) { ended = true; done(); } }, 700);
  }
  function switchView(target){
    // Keep doc reader scoped to the Account UI.
    try { if (typeof window.hideDoc === 'function') window.hideDoc(); } catch(_eDoc0) {}
    // Hide dashboard, show target view
    var dashboard = qs('account-dashboard');
    if(dashboard) dashboard.classList.add('is-hidden');
    
    var views = ['profile','projects','settings','payments','info','share','admin'];
    views.forEach(function(v){ 
      var sec = qs('account-view-' + v); 
      if(sec) {
        if(v === target) {
          sec.classList.remove('is-hidden');
        } else {
          sec.classList.add('is-hidden');
        }
      }
    });
    
    // Update card active states
    var cards = document.querySelectorAll('.account-card');
    cards.forEach(function(c){ 
      if(c.getAttribute('data-view')===target) c.classList.add('active'); 
      else c.classList.remove('active'); 
    });
    
    // Add back button to return to dashboard
    addBackButton(target);
    
    // Lazy-populate content for embedded views
    try {
        if (target === 'projects' && typeof window.loadProjectsView === 'function') {
          window.loadProjectsView();
          if (__accountAdminRefreshTimer) { clearInterval(__accountAdminRefreshTimer); __accountAdminRefreshTimer = null; }
        } else if (target === 'settings' && typeof window.loadLLMSettingsUI === 'function') {
          window.loadLLMSettingsUI();
          if (__accountAdminRefreshTimer) { clearInterval(__accountAdminRefreshTimer); __accountAdminRefreshTimer = null; }
        } else if (target === 'info' && typeof window.populateInfoControls === 'function') {
          window.populateInfoControls('account-info-body');
          setTimeout(refreshAccountStats, 250);
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
          setTimeout(refreshAccountStats, 250);
        } else if (target === 'admin' && typeof window.loadAdminData === 'function') {
          window.loadAdminData('account-admin-users','account-admin-errors','account-admin-spinner');
          try { if (__accountAdminRefreshTimer) clearInterval(__accountAdminRefreshTimer); } catch(_e){}
          __accountAdminRefreshTimer = setInterval(function(){
            try { window.loadAdminData('account-admin-users','account-admin-errors','account-admin-spinner'); } catch(_e){}
          }, 20000);
          var refBtn = qs('account-admin-refresh');
          if (refBtn && !refBtn.__wired) {
            refBtn.__wired = true;
            refBtn.addEventListener('click', function(){ window.loadAdminData('account-admin-users','account-admin-errors','account-admin-spinner'); });
          }
          setTimeout(refreshAccountStats, 250);
        }
    } catch(e) {}
  }
  
  function addBackButton(viewName){
    // Check if back button already exists in main
    var main = qs('account-main');
    if(!main) return;
    
    var existing = main.querySelector('.view-back-btn');
    if(existing) {
      existing.style.display = 'inline-flex';
      return;
    }
    
    var backBtn = document.createElement('button');
    backBtn.className = 'view-back-btn secondary';
    backBtn.title = 'Back to Dashboard';
    backBtn.innerHTML = '<svg class="sf-icon" width="20" height="20"><use href="#sf-speedometer"/></svg><span>Dashboard</span>';
    backBtn.addEventListener('click', function(){
      returnToDashboard();
    });
    
    // Insert into main, positioned by CSS
    main.appendChild(backBtn);
  }
  
  function returnToDashboard(){
    // Ensure any nested overlays are closed when leaving a panel.
    try { if (typeof window.hideDoc === 'function') window.hideDoc(); } catch(_eDoc2) {}
    var dashboard = qs('account-dashboard');
    if(dashboard) dashboard.classList.remove('is-hidden');
    
    var views = ['profile','projects','settings','payments','info','share','admin'];
    views.forEach(function(v){ 
      var sec = qs('account-view-' + v); 
      if(sec) sec.classList.add('is-hidden');
    });
    
    // Hide back button when on dashboard
    var backBtn = document.querySelector('.view-back-btn');
    if(backBtn) backBtn.style.display = 'none';
    
    // Clear active states
    var cards = document.querySelectorAll('.account-card');
    cards.forEach(function(c){ c.classList.remove('active'); });
  }

    function getProjectsSnapshot(){
      if(window.ProjectStorage && typeof window.ProjectStorage.getProjects === 'function'){
        try { return window.ProjectStorage.getProjects() || []; }
        catch(_e) { return []; }
      }
      var uid = window.__appUserId;
      if(!uid) return [];
      try {
        var raw = localStorage.getItem('gablok_projects_' + uid);
        return raw ? JSON.parse(raw) : [];
      } catch(_err){
        return [];
      }
    }

    function getLLMSettingsSnapshot(){
      try { return JSON.parse(localStorage.getItem('gablokLLMSettings') || '{}'); }
      catch(_e) { return {}; }
    }

    function getHelpDocsCount(){
      if(typeof window.__accountHelpDocsCount === 'number'){
        return window.__accountHelpDocsCount;
      }
      var body = qs('account-info-body');
      if(!body) return 0;
      var richNodes = body.querySelectorAll('p, li, article, section');
      if(richNodes.length) return richNodes.length;
      var text = body.textContent || '';
      return text.trim() ? 1 : 0;
    }

    function getShareLinkCount(){
      var input = qs('account-share-url');
      if(input && input.value && input.value.trim()) return 1;
      return 0;
    }

    function formatEstimate(projectTotal, renderTotal){
      var sum = (projectTotal * 25000) + (renderTotal * 250);
      if(!sum) return '$0';
      try {
        return '$' + sum.toLocaleString(undefined, { maximumFractionDigits: 0 });
      } catch(_e) {
        return '$' + sum;
      }
    }

    function computeAccountStats(){
      var profile = getProfileData();
      var projects = getProjectsSnapshot();
      var llm = getLLMSettingsSnapshot();
      var stats = {
        profileFields: countProfileFields(profile),
        projects: Array.isArray(projects) ? projects.length : 0,
        designs: 0,
        aiImages: 0,
        aiProviders: (llm && llm.provider) ? 1 : 0,
        payments: window.__accountPaymentMethods || 0,
        helpDocs: getHelpDocsCount(),
        shareLinks: getShareLinkCount(),
        adminPending: window.__daPendingApprovals || 0,
        profile: profile,
        estimate: '$0'
      };
      if(Array.isArray(projects) && projects.length){
        stats.designs = projects.filter(function(project){
          return project && (project.hasDesign || project.designData);
        }).length;
        stats.aiImages = projects.reduce(function(total, project){
          var count = Array.isArray(project && project.aiImages) ? project.aiImages.length : 0;
          return total + count;
        }, 0);
      }
      stats.estimate = formatEstimate(stats.projects || 0, stats.aiImages || 0);
      return stats;
    }

    function refreshAccountStats(){
      var stats = computeAccountStats();
      var projectValueEl = document.querySelector('[data-dashboard-stat="projects"]');
      if(projectValueEl) projectValueEl.textContent = stats.projects || 0;
      var renderValueEl = document.querySelector('[data-dashboard-stat="renders"]');
      if(renderValueEl) renderValueEl.textContent = stats.aiImages || 0;
      var estimateEl = document.querySelector('[data-dashboard-stat="estimate"]');
      if(estimateEl) estimateEl.textContent = stats.estimate || '$0';
      document.querySelectorAll('[data-account-count]').forEach(function(el){
        var key = el.getAttribute('data-account-count');
        if(!key) return;
        var label = el.getAttribute('data-count-label') || '';
        var value = (stats && stats.hasOwnProperty(key)) ? (stats[key] || 0) : 0;
        el.textContent = label ? (value + ' ' + label) : value;
      });
      return stats;
    }
  
  function wire(){
    var btn = qs('account-button');
    if(btn && !btn.__wired){
      btn.__wired=true;
      btn.addEventListener('click', function(e){
        try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch(_e1) {}
        showAccount();
      });
    }
    var close = qs('account-close'); if(close) close.addEventListener('click', hideAccount);
    
    // Wire account cards instead of nav buttons
    var cards = document.querySelectorAll('.account-card');
    cards.forEach(function(card){
      if(!card.__wired){
        card.__wired = true;
        card.addEventListener('click', function(){
          var view = this.getAttribute('data-view');
          if(view) switchView(view);
        });
      }
    });
    
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

  function toggleAccountModal(force, view){
    var modal = qs('account-modal');
    if(!modal) return;
    var isVisible = modal.classList.contains('visible') && !modal.classList.contains('closing');
    if(force === 'show') {
      showAccount(view);
      return;
    }
    if(force === 'hide') {
      hideAccount();
      return;
    }
    if(isVisible) hideAccount();
    else showAccount(view);
  }

    window.addEventListener('projects:updated', refreshAccountStats);
    window.addEventListener('storage', function(ev){
      if(!ev || !ev.key) return;
      if(ev.key.indexOf('gablok_projects_') === 0 || ev.key === 'gablokProfile' || ev.key === 'gablokLLMSettings'){
        refreshAccountStats();
      }
    });
    refreshAccountStats();

    // Expose for external triggers
    window.showAccount = showAccount;
    window.hideAccount = hideAccount;
    window.toggleAccountModal = toggleAccountModal;
    window.refreshAccountStats = refreshAccountStats;
    window.returnToDashboard = returnToDashboard;

    // ---------------------------------------------------------------------------
    // Active project meta (shown under the 3D/2D navigation compasses)
    // ---------------------------------------------------------------------------
    function formatMetaDate(ts, includeTime){
      if (!ts) return '';
      try {
        var d = new Date(ts);
        var date = d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'2-digit' });
        if (!includeTime) return date;
        var time = d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
        return date + ' ' + time;
      } catch(_e) {
        return '';
      }
    }

    function escapeHtmlLocal(text) {
      try {
        return String(text == null ? '' : text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      } catch(_e) {
        return '';
      }
    }

    function renderActiveProjectMeta(meta){
      try {
        var el3d = document.getElementById('active-project-meta-3d');
        var el2d = document.getElementById('active-project-meta-2d');
        var has = !!(meta && meta.id && meta.name);
        var html = '';
        if (has) {
          var created = formatMetaDate(meta.createdAt, false);
          var saved = formatMetaDate(meta.updatedAt || meta.lastSavedAt, true);
          var name = String(meta.name || 'Project');
          html =
            '<div class="active-project-meta-title">ACTIVE PROJECT</div>' +
            '<div class="active-project-meta-name">' + escapeHtmlLocal(name) + '</div>' +
            '<div class="active-project-meta-dates">CREATED ' + escapeHtmlLocal(created || '—') + ' \u00B7 LAST SAVED ' + escapeHtmlLocal(saved || '—') + '</div>';
        }
        [el3d, el2d].forEach(function(el){
          if(!el) return;
          if(!has){
            el.innerHTML = '';
            el.classList.add('is-hidden');
            el.removeAttribute('title');
            return;
          }
          el.innerHTML = html;
          el.classList.remove('is-hidden');
          el.title = String(meta.name || 'Project');
        });
      } catch(_e) {}
    }

    function resolveProjectById(projectId){
      try {
        if (!projectId) return null;
        if (window.ProjectStorage && typeof window.ProjectStorage.getProjects === 'function') {
          var projects = window.ProjectStorage.getProjects() || [];
          return projects.find(function(p){ return p && p.id === projectId; }) || null;
        }
      } catch(_e) {}
      return null;
    }

    // Public API: call with a project object or project id
    window.setActiveProject = function(projectOrId){
      try {
        var project = null;
        if (projectOrId && typeof projectOrId === 'object') project = projectOrId;
        else project = resolveProjectById(projectOrId);
        if (!project) {
          window.__activeProjectMeta = null;
          window.__activeProjectId = null;
          renderActiveProjectMeta(null);
          return;
        }
        window.__activeProjectId = project.id;
        window.__activeProjectMeta = {
          id: project.id,
          name: project.name || 'Project',
          createdAt: project.createdAt || null,
          updatedAt: project.updatedAt || null,
          lastSavedAt: project.updatedAt || null
        };
        renderActiveProjectMeta(window.__activeProjectMeta);
      } catch(_e) {}
    };

    window.refreshActiveProjectMeta = function(){
      try {
        if (!window.__activeProjectId) {
          renderActiveProjectMeta(null);
          return;
        }
        var p = resolveProjectById(window.__activeProjectId);
        if (p) window.setActiveProject(p);
        else renderActiveProjectMeta(null);
      } catch(_e) {}
    };

    // Render on load if we already have an active project id
    setTimeout(function(){ try{ if (window.refreshActiveProjectMeta) window.refreshActiveProjectMeta(); }catch(_e){} }, 0);
})();

// Account project storage + view rendering ----------------------------------------------------
(function(){
  if(window.__projectStorageInit) return; window.__projectStorageInit = true;
  var STORAGE_PREFIX = 'gablok_projects_';

  function getUserId(){
    return window.__appUserId || localStorage.getItem('gablokUserId');
  }

  function getStorageKey(){
    var uid = getUserId();
    return uid ? (STORAGE_PREFIX + uid) : null;
  }

  function normalizeProjects(list){
    return (Array.isArray(list) ? list : []).map(function(project){
      if(!project || typeof project !== 'object') return {};
      var clone = Object.assign({}, project);
      if(!clone.id) {
        clone.id = 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
      }
      clone.name = (clone.name || 'Untitled Project').trim();
      clone.createdAt = clone.createdAt || Date.now();
      clone.updatedAt = clone.updatedAt || clone.createdAt;
      if(!Array.isArray(clone.aiImages)) clone.aiImages = [];
      return clone;
    }).sort(function(a,b){
      var aTime = (a && a.updatedAt) || 0;
      var bTime = (b && b.updatedAt) || 0;
      return bTime - aTime;
    });
  }

  function loadProjects(){
    var key = getStorageKey();
    if(!key) return [];
    try {
      var raw = localStorage.getItem(key);
      if(!raw) return [];
      var data = JSON.parse(raw);
      return normalizeProjects(data);
    } catch(err){
      console.error('[AccountProjects] Failed to load projects', err);
      return [];
    }
  }

  function persistProjects(projects){
    var key = getStorageKey();
    if(!key) return;
    try {
      var normalized = normalizeProjects(projects);
      localStorage.setItem(key, JSON.stringify(normalized));
      window.dispatchEvent(new CustomEvent('projects:updated'));
    } catch(err){
      console.error('[AccountProjects] Failed to save projects', err);
      showAppleAlert('Storage Error', 'Unable to save projects. Storage may be full.');
    }
  }

  function saveProjects(projects){
    persistProjects(Array.isArray(projects) ? projects : []);
  }

  function createProject(name, extra){
    var projects = loadProjects();
    var now = Date.now();
    var project = Object.assign({
      id: 'proj_' + now + '_' + Math.random().toString(36).slice(2,7),
      name: (name && name.trim()) ? name.trim() : 'Untitled Project',
      createdAt: now,
      updatedAt: now,
      hasDesign: false,
      aiImages: [],
      thumbnail: null,
      designData: null
    }, extra || {});
    if(!Array.isArray(project.aiImages)) project.aiImages = [];
    if(!project.createdAt) project.createdAt = now;
    if(!project.updatedAt) project.updatedAt = now;
    projects.push(project);
    persistProjects(projects);
    return project;
  }

  function updateProject(projectId, updates){
    if(!projectId) return null;
    var projects = loadProjects();
    var updated = null;
    var next = projects.map(function(project){
      if(project.id !== projectId) return project;
      var base = Object.assign({}, project);
      var candidate = typeof updates === 'function' ? updates(base) : Object.assign(base, updates || {});
      if(!candidate) candidate = base;
      candidate.updatedAt = Date.now();
      if(!Array.isArray(candidate.aiImages)) candidate.aiImages = [];
      updated = candidate;
      return candidate;
    });
    if(updated) persistProjects(next);
    return updated;
  }

  function deleteProject(projectId){
    if(!projectId) return false;
    var projects = loadProjects();
    var filtered = projects.filter(function(project){ return project.id !== projectId; });
    if(filtered.length === projects.length) return false;
    persistProjects(filtered);
    return true;
  }

  window.ProjectStorage = {
    getProjects: loadProjects,
    saveProjects: saveProjects,
    createProject: createProject,
    updateProject: updateProject,
    deleteProject: deleteProject
  };
})();

(function(){
  if(window.__accountProjectsUiInit) return; window.__accountProjectsUiInit = true;
  var listEl = null;
  var emptyEl = null;
  var newBtn = null;
  var refreshBtn = null;

  function ensureElements(){
    if(!listEl) listEl = document.getElementById('projects-list');
    if(!emptyEl) emptyEl = document.getElementById('projects-empty');
    if(!newBtn) newBtn = document.getElementById('projects-new-btn');
    if(!refreshBtn) refreshBtn = document.getElementById('projects-refresh-btn');
    return !!(listEl && emptyEl);
  }

  function formatDate(timestamp){
    if(!timestamp) return 'Just now';
    try {
      var date = new Date(timestamp);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' • ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch(_e) {
      return 'Recently';
    }
  }

  function renderProjectsView(){
    if(!ensureElements()) return;
    var storage = window.ProjectStorage;
    if(!storage){
      listEl.innerHTML = '<p class="text-secondary">Project storage is unavailable.</p>';
      emptyEl.classList.add('is-hidden');
      return;
    }
    var projects = storage.getProjects();
    listEl.innerHTML = '';
    if(!projects.length){
      emptyEl.classList.remove('is-hidden');
      return;
    }
    emptyEl.classList.add('is-hidden');
    projects.forEach(function(project){
      listEl.appendChild(buildProjectCard(project));
    });
  }

  function buildProjectCard(project){
    var card = document.createElement('div');
    card.className = 'project-card';
    card.setAttribute('data-project-id', project.id);

    // Create thumbnail area (replaces icon)
    var thumbWrapper = document.createElement('div');
    thumbWrapper.className = 'project-card-thumb-wrapper';
    
    if(project.thumbnail){
      var thumb = document.createElement('img');
      thumb.className = 'project-card-main-thumb';
      thumb.src = project.thumbnail;
      thumb.alt = 'Project preview';
      thumb.loading = 'lazy';
      thumbWrapper.appendChild(thumb);
    } else {
      // Fallback icon if no thumbnail
      var icon = document.createElement('div');
      icon.className = 'project-card-icon-fallback';
      icon.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="/css/sf-symbols.svg#' + (project.hasDesign ? 'sf-doc-text' : 'sf-folder') + '" /></svg>';
      thumbWrapper.appendChild(icon);
    }
    card.appendChild(thumbWrapper);

    var info = document.createElement('div');
    info.className = 'project-card-info';
    var name = document.createElement('div');
    name.className = 'project-card-name';
    name.textContent = project.name || 'Untitled Project';
    info.appendChild(name);
    var meta = document.createElement('div');
    meta.className = 'project-card-meta';
    meta.textContent = 'Updated ' + formatDate(project.updatedAt);
    info.appendChild(meta);

    var badges = document.createElement('div');
    badges.className = 'project-badges';
    if(project.hasDesign || project.designData){
      var designBadge = document.createElement('span');
      designBadge.className = 'project-badge design';
      designBadge.textContent = 'Design saved';
      badges.appendChild(designBadge);
    }
    var aiCount = Array.isArray(project.aiImages) ? project.aiImages.length : 0;
    if(aiCount > 0){
      var aiBadge = document.createElement('span');
      aiBadge.className = 'project-badge ai';
      aiBadge.textContent = aiCount + ' AI renders';
      badges.appendChild(aiBadge);
    }
    if(badges.children.length > 0){
      info.appendChild(badges);
    }

    // Remove images strip - now using main thumbnail instead

    card.appendChild(info);

    var actions = document.createElement('div');
    actions.className = 'project-card-actions';
    // Primary action: load the saved design back into the editor.
    var hasDesign = !!(project && (project.designData || project.hasDesign));
    actions.appendChild(createActionButton('Continue Work', 'open-design', project.id, hasDesign ? 'primary' : 'secondary', { disabled: !hasDesign }));
    var hasDAState = false;
    try {
      if (window.DAWorkflow && typeof window.DAWorkflow.hasWorkflowState === 'function') {
        hasDAState = window.DAWorkflow.hasWorkflowState(project.id);
      } else {
        hasDAState = !!localStorage.getItem('gablok_da_workflow_' + project.id);
      }
    } catch (_eDAState) {}
    actions.appendChild(createActionButton(hasDAState ? 'Continue DA Workflow' : 'Start DA Workflow', 'open-workflow', project.id, 'secondary'));
    actions.appendChild(createActionButton('Rename', 'rename-project', project.id, 'secondary'));
    actions.appendChild(createActionButton('Delete', 'delete-project', project.id, 'secondary danger'));
    card.appendChild(actions);

    return card;
  }

  function createImagesStrip(project){
    var sources = [];
    if(project.thumbnail){
      sources.push({ src: project.thumbnail, design: true });
    }
    if(Array.isArray(project.aiImages)){
      project.aiImages.slice(0,3).forEach(function(img){
        var src = typeof img === 'string' ? img : (img && (img.url || img.image));
        if(src) sources.push({ src: src });
      });
    }
    if(!sources.length) return null;
    var wrap = document.createElement('div');
    wrap.className = 'project-card-images';
    sources.forEach(function(entry){
      var img = document.createElement('img');
      img.className = 'project-card-thumb' + (entry.design ? ' project-design-thumb' : '');
      img.src = entry.src;
      img.alt = 'Project preview';
      img.loading = 'lazy';
      wrap.appendChild(img);
    });
    return wrap;
  }

  function createActionButton(label, action, projectId, classes, opts){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('data-action', action);
    btn.setAttribute('data-project-id', projectId);
    if(classes) btn.className = classes;
    if (opts && opts.disabled) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    }
    return btn;
  }

  function openDesign(projectId){
    if(!projectId) return;
    var storage = window.ProjectStorage;
    if(!storage || typeof storage.getProjects !== 'function'){
      showAppleAlert('Error', 'Project storage is not ready yet.');
      return;
    }
    if(typeof window.restoreProject !== 'function'){
      showAppleAlert('Error', 'Design system not loaded. Please refresh the page.');
      return;
    }
    var projects = [];
    try { projects = storage.getProjects() || []; } catch(_e) { projects = []; }
    var project = projects.find(function(p){ return p && p.id === projectId; }) || null;
    if(!project){
      showAppleAlert('Error', 'Project not found.');
      return;
    }
    if(!project.designData){
      showAppleAlert('No Design Saved', 'This project does not have a saved 3D design yet.');
      return;
    }

    // Update the tiny project badge near the navigation compasses.
    try {
      if (typeof window.setActiveProject === 'function') window.setActiveProject(project);
    } catch(_eMeta) {}

    // Hide Account before restoring to avoid stacked UIs.
    try {
      if(window.toggleAccountModal) window.toggleAccountModal('hide');
      var acc = document.getElementById('account-modal');
      if(acc){
        acc.classList.remove('showing', 'closing', 'visible');
        acc.__animating = false;
      }
    } catch(_eHideAcc) {}

    try {
      window.restoreProject(project.designData);
      if(typeof window.updateStatus === 'function') window.updateStatus('Loaded project: ' + (project.name || 'Project'));
      if(typeof window.renderLoop === 'function') window.renderLoop();
    } catch(e) {
      console.error('[AccountProjects] Failed to restore project:', e);
      showAppleAlert('Error', 'Failed to load the project design.');
    }
  }

  function handleCreateProject(){
    var storage = window.ProjectStorage;
    if(!storage){
      showAppleAlert('Error', 'Project storage is not ready yet.');
      return;
    }
    showApplePrompt('New Project', 'Project ' + new Date().toLocaleDateString(), function(name) {
      if(!name) return;
      storage.createProject(name);
      renderProjectsView();
    });
  }

  function handleRename(projectId){
    var storage = window.ProjectStorage;
    if(!storage) return;
    var projects = storage.getProjects();
    var current = projects.find(function(p){ return p.id === projectId; });
    showApplePrompt('Rename Project', current ? current.name : 'Project', function(name) {
      if(!name) return;
      storage.updateProject(projectId, function(existing){
        existing.name = name.trim();
        return existing;
      });
      renderProjectsView();
    });
  }

  function handleDelete(projectId){
    var storage = window.ProjectStorage;
    if(!storage) return;
    showAppleConfirm(
      'Delete Project', 
      'This action cannot be undone. Are you sure you want to delete this project?',
      function() {
        storage.deleteProject(projectId);
        renderProjectsView();
      }
    );
  }

  function openWorkflow(projectId){
    if(window.DAWorkflowUI && typeof window.DAWorkflowUI.open === 'function'){
      // If projectId provided, open fullscreen DA workflow and hide Account to avoid stacked UIs.
      // If no projectId, show the selector OVER the current Account view (e.g., Settings) so the
      // backdrop is the Account UI rather than the 3D canvas.
      if (projectId) {
        try {
          if(window.toggleAccountModal) window.toggleAccountModal('hide');
          var acc = document.getElementById('account-modal');
          if(acc){
            acc.classList.remove('showing', 'closing', 'visible');
            acc.__animating = false;
          }
        } catch(_eHide) {}
        window.DAWorkflowUI.open(projectId);
      } else {
        window.DAWorkflowUI.open();
      }
    } else {
      showAppleAlert('Loading', 'DA Workflow is still loading. Please try again in a moment.');
    }
  }

  function handleProjectListClick(event){
    var btn = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
    var action = btn && btn.getAttribute('data-action');
    if(!action) return;
    event.preventDefault();
    var projectId = btn.getAttribute('data-project-id');
    if(!projectId) return;
    if(action === 'open-design') openDesign(projectId);
    else if(action === 'open-workflow') openWorkflow(projectId);
    else if(action === 'rename-project') handleRename(projectId);
    else if(action === 'delete-project') handleDelete(projectId);
  }

  function wireEvents(){
    if(!ensureElements()) return;
    if(newBtn && !newBtn.__wired){
      newBtn.__wired = true;
      newBtn.addEventListener('click', handleCreateProject);
    }
    if(refreshBtn && !refreshBtn.__wired){
      refreshBtn.__wired = true;
      refreshBtn.addEventListener('click', renderProjectsView);
    }
    if(listEl && !listEl.__wired){
      listEl.__wired = true;
      listEl.addEventListener('click', handleProjectListClick);
    }
  }

  function init(){
    wireEvents();
    renderProjectsView();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  window.addEventListener('projects:updated', function(){
    renderProjectsView();
  });

  window.loadProjectsView = renderProjectsView;
})();

// LLM/AI API Settings Manager
(function(){
  if(window.__llmSettingsInit) return; window.__llmSettingsInit = true;
  
  var LLM_STORAGE_KEY = 'gablokLLMSettings';
  
  // Model options per provider
  var PROVIDER_MODELS = {
    openai: [
      { value: 'dall-e-3', label: 'DALL-E 3 (Image Generation)' },
      { value: 'dall-e-2', label: 'DALL-E 2 (Image Generation)' },
      { value: 'gpt-4-vision-preview', label: 'GPT-4 Vision (Analysis)' },
      { value: 'gpt-4o', label: 'GPT-4o (Multimodal)' }
    ],
    anthropic: [
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
      { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' }
    ],
    google: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { value: 'imagen-3', label: 'Imagen 3 (Image Generation)' }
    ],
    xai: [
      { value: 'grok-2-vision', label: 'Grok 2 Vision' },
      { value: 'grok-2', label: 'Grok 2' }
    ],
    stability: [
      { value: 'stable-diffusion-xl-1024-v1-0', label: 'Stable Diffusion XL 1.0' },
      { value: 'stable-diffusion-v1-6', label: 'Stable Diffusion 1.6' },
      { value: 'stable-diffusion-3', label: 'Stable Diffusion 3' }
    ],
    midjourney: [
      { value: 'midjourney-v6', label: 'Midjourney v6' },
      { value: 'midjourney-v5', label: 'Midjourney v5' }
    ],
    freepik: [
      { value: 'mystic-v2', label: 'Mystic v2 (Photorealistic)' },
      { value: 'mystic-v1', label: 'Mystic v1' },
      { value: 'flux-schnell', label: 'Flux Schnell (Fast)' },
      { value: 'flux-dev', label: 'Flux Dev' },
      { value: 'flux-pro', label: 'Flux Pro (High Quality)' },
      { value: 'magnific-upscaler', label: 'Magnific Upscaler' }
    ],
    replicate: [
      { value: 'black-forest-labs/flux-1.1-pro', label: 'Flux 1.1 Pro (Best Quality)' },
      { value: 'black-forest-labs/flux-schnell', label: 'Flux Schnell (Fast)' },
      { value: 'black-forest-labs/flux-dev', label: 'Flux Dev' },
      { value: 'stability-ai/sdxl', label: 'Stable Diffusion XL' },
      { value: 'ideogram-ai/ideogram-v2', label: 'Ideogram v2' },
      { value: 'recraft-ai/recraft-v3', label: 'Recraft v3' },
      { value: 'lucataco/realistic-vision-v5', label: 'Realistic Vision v5' },
      { value: 'adirik/realvisxl-v4', label: 'RealVisXL v4' },
      { value: 'bytedance/sdxl-lightning-4step', label: 'SDXL Lightning (4 Step)' },
      { value: 'playgroundai/playground-v2.5-1024px-aesthetic', label: 'Playground v2.5' },
      { value: 'tencentarc/photomaker', label: 'PhotoMaker' },
      { value: 'lucataco/ssd-1b', label: 'SSD-1B (Fast)' }
    ],
    leonardo: [
      { value: 'leonardo-diffusion-xl', label: 'Leonardo Diffusion XL' },
      { value: 'leonardo-vision-xl', label: 'Leonardo Vision XL' },
      { value: 'phoenix', label: 'Phoenix (Latest)' },
      { value: 'kino-xl', label: 'Kino XL (Cinematic)' },
      { value: 'photoreal-v2', label: 'PhotoReal v2' }
    ],
    ideogram: [
      { value: 'ideogram-v2', label: 'Ideogram v2' },
      { value: 'ideogram-v1-turbo', label: 'Ideogram v1 Turbo' },
      { value: 'ideogram-v1', label: 'Ideogram v1' }
    ],
    runway: [
      { value: 'gen-3-alpha', label: 'Gen-3 Alpha' },
      { value: 'gen-2', label: 'Gen-2' }
    ],
    fal: [
      { value: 'fal-ai/flux-pro', label: 'Flux Pro (Best)' },
      { value: 'fal-ai/flux-dev', label: 'Flux Dev' },
      { value: 'fal-ai/flux/schnell', label: 'Flux Schnell (Fastest)' },
      { value: 'fal-ai/flux-lora', label: 'Flux LoRA' },
      { value: 'fal-ai/aura-flow', label: 'AuraFlow' },
      { value: 'fal-ai/stable-cascade', label: 'Stable Cascade' },
      { value: 'fal-ai/fast-sdxl', label: 'Fast SDXL' },
      { value: 'fal-ai/realistic-vision', label: 'Realistic Vision' },
      { value: 'fal-ai/lightning-models', label: 'Lightning Models' },
      { value: 'fal-ai/stable-diffusion-v3-medium', label: 'SD3 Medium' }
    ],
    together: [
      { value: 'black-forest-labs/FLUX.1-schnell-Free', label: 'Flux.1 Schnell (Free)' },
      { value: 'black-forest-labs/FLUX.1-schnell', label: 'Flux.1 Schnell' },
      { value: 'black-forest-labs/FLUX.1-dev', label: 'Flux.1 Dev' },
      { value: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL Base' },
      { value: 'SG161222/RealVisXL_V4.0', label: 'RealVisXL v4' },
      { value: 'prompthero/openjourney-v4', label: 'OpenJourney v4' },
      { value: 'wavymulder/Analog-Diffusion', label: 'Analog Diffusion' }
    ],
    fireworks: [
      { value: 'accounts/fireworks/models/flux-1-dev-fp8', label: 'Flux.1 Dev' },
      { value: 'accounts/fireworks/models/flux-1-schnell-fp8', label: 'Flux.1 Schnell (Fast)' },
      { value: 'accounts/fireworks/models/stable-diffusion-xl-1024-v1-0', label: 'SDXL 1.0' },
      { value: 'accounts/fireworks/models/playground-v2-1024px-aesthetic', label: 'Playground v2' },
      { value: 'accounts/fireworks/models/SSD-1B', label: 'SSD-1B (Ultra Fast)' },
      { value: 'accounts/fireworks/models/japanese-stable-diffusion-xl', label: 'Japanese SDXL' }
    ]
  };
  
  // Default API endpoints
  var PROVIDER_ENDPOINTS = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1',
    xai: 'https://api.x.ai/v1',
    stability: 'https://api.stability.ai/v1',
    midjourney: '', // Requires custom endpoint
    freepik: 'https://api.freepik.com',
    replicate: 'https://api.replicate.com/v1',
    leonardo: 'https://cloud.leonardo.ai/api/rest/v1',
    ideogram: 'https://api.ideogram.ai',
    runway: 'https://api.runwayml.com/v1',
    fal: 'https://fal.run',
    together: 'https://api.together.xyz/v1',
    fireworks: 'https://api.fireworks.ai/inference/v1'
  };
  
  function qs(id) { return document.getElementById(id); }
  
  // Load saved settings
  function loadLLMSettings() {
    try {
      var data = JSON.parse(localStorage.getItem(LLM_STORAGE_KEY) || '{}');
      if (qs('llm-provider')) qs('llm-provider').value = data.provider || '';
      if (qs('llm-api-key')) qs('llm-api-key').value = data.apiKey || '';
      if (qs('llm-endpoint')) qs('llm-endpoint').value = data.endpoint || '';
      if (qs('llm-org-id')) qs('llm-org-id').value = data.orgId || '';
      
      // Update model dropdown based on provider
      if (data.provider) {
        updateModelDropdown(data.provider, data.model);
      }
      return data;
    } catch(e) { 
      console.warn('Failed to load LLM settings:', e);
      return {}; 
    }
  }
  
  // Save settings
  function saveLLMSettings() {
    try {
      var data = {
        provider: (qs('llm-provider') || {}).value || '',
        apiKey: (qs('llm-api-key') || {}).value || '',
        model: (qs('llm-model') || {}).value || '',
        endpoint: (qs('llm-endpoint') || {}).value || '',
        orgId: (qs('llm-org-id') || {}).value || ''
      };
      localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(data));
      showStatus('success', 'API settings saved successfully!');
        if(typeof window.refreshAccountStats === 'function') window.refreshAccountStats();
      return data;
    } catch(e) {
      showStatus('error', 'Failed to save settings: ' + e.message);
      return null;
    }
  }
  
  // Update model dropdown based on provider
  function updateModelDropdown(provider, selectedModel) {
    var modelSelect = qs('llm-model');
    if (!modelSelect) return;
    
    // Clear existing options
    modelSelect.innerHTML = '<option value="">-- Select Model --</option>';
    
    var models = PROVIDER_MODELS[provider] || [];
    models.forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      if (m.value === selectedModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    
    // Show/hide custom endpoint field for certain providers
    var endpointRow = qs('llm-endpoint-row');
    if (endpointRow) {
      endpointRow.style.display = (provider === 'midjourney' || provider === '') ? 'flex' : 'none';
    }
  }
  
  // Show status message
  function showStatus(type, message) {
    var status = qs('llm-status');
    if (!status) return;
    status.className = 'settings-status ' + type;
    status.textContent = message;
    status.style.display = 'block';
    
    // Auto-hide after 5 seconds for success
    if (type === 'success') {
      setTimeout(function() {
        status.style.display = 'none';
      }, 5000);
    }
  }
  
  // Test API connection
  async function testConnection() {
    var provider = (qs('llm-provider') || {}).value;
    var apiKey = (qs('llm-api-key') || {}).value;
    var endpoint = (qs('llm-endpoint') || {}).value;
    
    if (!provider) {
      showStatus('error', 'Please select a provider first.');
      return;
    }
    if (!apiKey) {
      showStatus('error', 'Please enter an API key.');
      return;
    }
    
    showStatus('info', 'Testing connection...');
    
    var testEndpoint = endpoint || PROVIDER_ENDPOINTS[provider];
    if (!testEndpoint) {
      showStatus('error', 'No endpoint configured for this provider.');
      return;
    }
    
    try {
      // Simple connection test - varies by provider
      var testUrl, headers = {};
      
      switch(provider) {
        case 'openai':
          testUrl = testEndpoint + '/models';
          headers = { 'Authorization': 'Bearer ' + apiKey };
          break;
        case 'anthropic':
          // Anthropic doesn't have a simple test endpoint, we'll just validate format
          if (apiKey.startsWith('sk-ant-')) {
            showStatus('success', 'API key format looks valid! Save to use.');
            return;
          } else {
            showStatus('error', 'Invalid Anthropic API key format (should start with sk-ant-)');
            return;
          }
        case 'google':
          testUrl = testEndpoint + '/models?key=' + apiKey;
          break;
        case 'xai':
          testUrl = testEndpoint + '/models';
          headers = { 'Authorization': 'Bearer ' + apiKey };
          break;
        case 'stability':
          testUrl = testEndpoint + '/engines/list';
          headers = { 'Authorization': 'Bearer ' + apiKey };
          break;
        case 'freepik':
          testUrl = testEndpoint + '/ai/text-to-image';
          headers = { 
            'x-freepik-api-key': apiKey,
            'Content-Type': 'application/json'
          };
          // Freepik requires POST, so we'll just validate the key format
          if (apiKey && apiKey.length > 20) {
            showStatus('success', 'API key format looks valid! Save to use.');
            return;
          } else {
            showStatus('error', 'Invalid Freepik API key format.');
            return;
          }
        default:
          showStatus('info', 'Manual verification needed for this provider. Save to use.');
          return;
      }
      
      var response = await fetch(testUrl, { method: 'GET', headers: headers });
      
      if (response.ok) {
        showStatus('success', 'Connection successful! API key is valid.');
      } else if (response.status === 401 || response.status === 403) {
        showStatus('error', 'Authentication failed. Please check your API key.');
      } else {
        showStatus('error', 'Connection failed: ' + response.status + ' ' + response.statusText);
      }
    } catch(e) {
      // CORS errors are expected for some providers
      if (e.message.includes('CORS') || e.message.includes('NetworkError')) {
        showStatus('info', 'Cannot verify directly due to CORS. Save settings and test in-app.');
      } else {
        showStatus('error', 'Connection error: ' + e.message);
      }
    }
  }
  
  // Toggle password visibility
  function toggleKeyVisibility() {
    var input = qs('llm-api-key');
    var btn = qs('llm-key-toggle');
    if (!input) return;
    
    if (input.type === 'password') {
      input.type = 'text';
      if (btn) btn.textContent = '🙈';
    } else {
      input.type = 'password';
      if (btn) btn.textContent = '👁';
    }
  }
  
  // Wire up events
  function wire() {
    // Provider change updates model dropdown
    var providerSelect = qs('llm-provider');
    if (providerSelect && !providerSelect.__wired) {
      providerSelect.__wired = true;
      providerSelect.addEventListener('change', function() {
        updateModelDropdown(this.value);
      });
    }
    
    // Save button
    var saveBtn = qs('llm-save-settings');
    if (saveBtn && !saveBtn.__wired) {
      saveBtn.__wired = true;
      saveBtn.addEventListener('click', saveLLMSettings);
    }
    
    // Test connection button
    var testBtn = qs('llm-test-connection');
    if (testBtn && !testBtn.__wired) {
      testBtn.__wired = true;
      testBtn.addEventListener('click', testConnection);
    }
    
    // Toggle key visibility
    var toggleBtn = qs('llm-key-toggle');
    if (toggleBtn && !toggleBtn.__wired) {
      toggleBtn.__wired = true;
      toggleBtn.addEventListener('click', toggleKeyVisibility);
    }
    
    // Load settings when settings view is shown
    loadLLMSettings();
  }
  
  // Get current LLM settings (exposed for other modules)
  function getLLMSettings() {
    try {
      return JSON.parse(localStorage.getItem(LLM_STORAGE_KEY) || '{}');
    } catch(e) {
      return {};
    }
  }
  
  // Wire on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    setTimeout(wire, 0);
  }
  
  // Expose for external use
  window.getLLMSettings = getLLMSettings;
  window.loadLLMSettingsUI = loadLLMSettings;
})();

/**
 * Theme Settings Manager - Per-Section Dark/Light Mode
 */
(function() {
  console.log('[Theme Settings] Module loading...');
  
  if (window.__themeSettingsInit) {
    console.log('[Theme Settings] Already initialized, skipping');
    return;
  }
  window.__themeSettingsInit = true;
  
  console.log('[Theme Settings] Initializing theme settings manager');
  
  var THEME_STORAGE_KEY = 'gablokThemeSettings';
  
  var sectionSelectors = {
    'main': 'body',
    'plan2d': '#plan2d-page, #floorplan-modal',
    'visualize': '#visualize-modal',
    'da-workflow': '#da-workflow-overlay, #da-project-selector-overlay',
    'account': '#account-modal, #account-dashboard, .account-panel'
  };
  
  // Load saved theme preferences
  function loadThemeSettings() {
    try {
      var saved = localStorage.getItem(THEME_STORAGE_KEY);
      var settings = saved ? JSON.parse(saved) : {};
      
      console.log('[Theme Settings] Loading saved settings:', settings);
      
      // Map of checkbox IDs to section keys
      var checkboxToSection = {
        'theme-main-editor': 'main',
        'theme-plan2d': 'plan2d',
        'theme-visualize': 'visualize',
        'theme-da-workflow': 'da-workflow',
        'theme-account': 'account'
      };
      
      // Apply saved themes to sections
      Object.keys(checkboxToSection).forEach(function(checkboxId) {
        var section = checkboxToSection[checkboxId];
        var theme = settings[section] || 'light';
        
        console.log('[Theme Settings] Applying saved theme for', section, ':', theme);
        applyThemeToSection(section, theme);
        
        // Update checkbox state
        var checkbox = document.getElementById(checkboxId);
        if (checkbox) {
          checkbox.checked = theme === 'dark';
          console.log('[Theme Settings] Updated checkbox', checkboxId, 'to', theme);
        }
      });
      
      return settings;
    } catch (e) {
      console.error('Failed to load theme settings:', e);
      return {};
    }
  }
  
  // Save theme preferences
  function saveThemeSettings(settings) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save theme settings:', e);
    }
  }
  
  // Apply theme to a specific section
  function applyThemeToSection(section, theme) {
    var selector = sectionSelectors[section];
    if (!selector) {
      console.warn('[Theme Settings] No selector for section:', section);
      return;
    }
    
    console.log('[Theme Settings] Applying', theme, 'theme to section:', section, 'selector:', selector);
    
    // Apply to ALL matching elements (not just first)
    var elements = document.querySelectorAll(selector);
    console.log('[Theme Settings] Found', elements.length, 'elements for selector:', selector);
    
    elements.forEach(function(element) {
      element.setAttribute('data-theme', theme);
      console.log('[Theme Settings] Applied theme to:', element.id || element.className);
    });
    
    // Special handling for body (main section) - also needs to propagate
    if (section === 'main' && elements.length > 0) {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }
  
  // Initialize theme toggles
  function initThemeToggles() {
    var settings = loadThemeSettings();
    
    // Map of checkbox IDs to section keys
    var checkboxMap = {
      'theme-main-editor': 'main',
      'theme-plan2d': 'plan2d',
      'theme-visualize': 'visualize',
      'theme-da-workflow': 'da-workflow',
      'theme-account': 'account'
    };
    
    console.log('[Theme Settings] Initializing toggles...', checkboxMap);
    
    // Add event listeners to all theme checkboxes
    Object.keys(checkboxMap).forEach(function(checkboxId) {
      var section = checkboxMap[checkboxId];
      var checkbox = document.getElementById(checkboxId);
      
      if (!checkbox) {
        console.warn('[Theme Settings] Checkbox not found:', checkboxId);
        return;
      }
      
      console.log('[Theme Settings] Attaching listener to:', checkboxId, 'for section:', section);
      
      checkbox.addEventListener('change', function() {
        var theme = this.checked ? 'dark' : 'light';
        console.log('[Theme Settings] Toggle changed:', section, 'to', theme);
        settings[section] = theme;
        saveThemeSettings(settings);
        applyThemeToSection(section, theme);
        
        // Show feedback
        showThemeFeedback(section, theme);
      });
    });
    
    console.log('[Theme Settings] Toggles initialized successfully');
  }
  
  // Show visual feedback when theme changes
  function showThemeFeedback(section, theme) {
    var sectionNames = {
      'main': 'Main Editor',
      'main-editor': 'Main Editor',
      'plan2d': '2D Floor Plan',
      'visualize': '3D Visualize',
      'da-workflow': 'DA Workflow',
      'account': 'Dashboard'
    };
    
    var message = sectionNames[section] + ' switched to ' + (theme === 'dark' ? 'Dark' : 'Light') + ' mode';
    
    // Create temporary toast notification
    var toast = document.createElement('div');
    toast.className = 'theme-toast';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.9);color:white;padding:12px 20px;border-radius:12px;font-size:13px;z-index:100001;animation:toastIn 0.3s ease;';
    document.body.appendChild(toast);
    
    setTimeout(function() {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(function() {
        toast.remove();
      }, 300);
    }, 2000);
  }
  
  // Initialize when settings panel is loaded
  function onSettingsPanelLoad() {
    setTimeout(function() {
      var settingsPanel = document.getElementById('account-view-settings');
      if (settingsPanel && !settingsPanel.classList.contains('is-hidden')) {
        initThemeToggles();
      }
    }, 100);
  }
  
  // Watch for settings panel visibility
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.attributeName === 'class') {
        var settingsPanel = document.getElementById('account-view-settings');
        if (settingsPanel && !settingsPanel.classList.contains('is-hidden')) {
          console.log('[Theme Settings] Settings panel became visible, initializing...');
          initThemeToggles();
          // Event delegation handles navigation automatically - no need to re-attach
        }
      }
    });
  });
  
  // Start observing when DOM is ready
  function initializeThemeSystem() {
    var settingsPanel = document.getElementById('account-view-settings');
    if (settingsPanel && !observer.__observing) {
      observer.observe(settingsPanel, { attributes: true });
      observer.__observing = true;
    }
    
    // Load initial themes
    loadThemeSettings();
    
    // Initialize theme label navigation (event delegation)
    initThemeLabelNavigation();
    
    // Watch for modal visibility changes and reapply themes
    watchModalVisibility();
  }
  
  // Watch for modals becoming visible and reapply themes
  function watchModalVisibility() {
    var modalsToWatch = [
      { id: 'floorplan-modal', section: 'plan2d' },
      { id: 'visualize-modal', section: 'visualize' },
      { id: 'da-workflow-overlay', section: 'da-workflow' },
      { id: 'account-modal', section: 'account' },
      { id: 'da-project-selector-overlay', section: 'da-workflow' }
    ];
    
    // Watch existing modals
    modalsToWatch.forEach(function(modalInfo) {
      var modal = document.getElementById(modalInfo.id);
      if (modal) {
        var modalObserver = new MutationObserver(function(mutations) {
          mutations.forEach(function(mutation) {
            if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
              var isVisible = modal.classList.contains('visible') || 
                             modal.style.display === 'block' || 
                             modal.style.display === 'flex';
              
              if (isVisible) {
                // Reapply theme when modal becomes visible
                var settings = loadThemeSettings();
                var theme = settings[modalInfo.section] || 'light';
                setTimeout(function() {
                  applyThemeToSection(modalInfo.section, theme);
                }, 50);
              }
            }
          });
        });
        
        modalObserver.observe(modal, { 
          attributes: true, 
          attributeFilter: ['class', 'style'] 
        });
      }
    });
    
    // Also watch for new elements being added (like dynamically created project selector)
    var bodyObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) { // Element node
            modalsToWatch.forEach(function(modalInfo) {
              if (node.id === modalInfo.id || (node.querySelector && node.querySelector('#' + modalInfo.id))) {
                var settings = loadThemeSettings();
                var theme = settings[modalInfo.section] || 'light';
                setTimeout(function() {
                  applyThemeToSection(modalInfo.section, theme);
                  console.log('[Theme Settings] Applied theme to newly created element:', modalInfo.id);
                }, 10);
              }
            });
          }
        });
      });
    });
    
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  // Call immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeThemeSystem);
  } else {
    initializeThemeSystem();
  }
  
  // Add navigation for theme labels using event delegation
  var themeLabelsInitialized = false;
  function initThemeLabelNavigation() {
    if (themeLabelsInitialized) {
      console.log('[Theme Navigation] Already initialized, skipping...');
      return;
    }
    
    console.log('[Theme Navigation] Initializing navigation...');
    
    // Use ONLY event delegation - do not attach direct onclick handlers
    // This prevents handlers from overwriting each other
    var clickHandler = function(e) {
      var target = e.target;
      
      // Check if clicked on a theme label title
      if (target && target.classList && target.classList.contains('theme-label-title') && target.hasAttribute('data-navigate')) {
        e.preventDefault();
        e.stopPropagation();
        var section = target.getAttribute('data-navigate');
        console.log('[Theme Navigation] Click detected on:', section);
        navigateToSection(section);
        return false;
      }
    };
    
    // Attach to document.body using capture phase to catch events early
    document.body.addEventListener('click', clickHandler, true);
    
    // Also attach to window as backup
    window.addEventListener('click', clickHandler, true);
    
    // Store reference for potential cleanup
    window.__themeNavigationHandler = clickHandler;
    
    // Set cursor style for visual feedback
    if (!document.getElementById('theme-nav-styles')) {
      var style = document.createElement('style');
      style.id = 'theme-nav-styles';
      style.textContent = '.theme-label-title[data-navigate] { cursor: pointer; }';
      document.head.appendChild(style);
    }
    
    themeLabelsInitialized = true;
    console.log('[Theme Navigation] Initialization complete - using event delegation only');
  }
  
  // Expose for debugging
  window.reinitThemeNavigation = function() {
    themeLabelsInitialized = false;
    initThemeLabelNavigation();
  };
  
  // Watchdog: Ensure navigation handler stays active
  // Re-check every time account modal becomes visible
  var lastModalCheck = 0;
  setInterval(function() {
    var modal = document.getElementById('account-modal');
    if (modal && modal.classList.contains('visible')) {
      var now = Date.now();
      if (now - lastModalCheck > 5000) { // Check every 5 seconds when modal is open
        lastModalCheck = now;
        var labels = document.querySelectorAll('.theme-label-title[data-navigate]');
        if (labels.length > 0 && !themeLabelsInitialized) {
          console.warn('[Theme Navigation] Handler lost, reinitializing...');
          themeLabelsInitialized = false;
          initThemeLabelNavigation();
        }
      }
    }
  }, 2000);
  
  function navigateToSection(section) {
    console.log('[Theme Navigation] Navigating to:', section);

    function hideAccountForNavigation() {
      try {
        if (typeof window.hideAccount === 'function') {
          window.hideAccount();
        } else if (window.toggleAccountModal) {
          window.toggleAccountModal('hide');
        }
        // Ensure it can't sit on top and intercept clicks.
        var acc = document.getElementById('account-modal');
        if (acc) {
          acc.classList.remove('showing', 'closing', 'visible');
          acc.__animating = false;
        }
      } catch (_eNavHide) {}
    }
    
    // Navigate to the appropriate section
    switch(section) {
      case 'main':
        // Main editor is always visible - hide Account if it is open
        console.log('[Theme Navigation] Main editor');
        hideAccountForNavigation();
        break;
        
      case 'plan2d':
        // Show 2D floor plan
        console.log('[Theme Navigation] Opening Plan2D modal');
        hideAccountForNavigation();
        setTimeout(function() {
          if (typeof window.openPlan2DModal === 'function') {
            console.log('[Theme Navigation] Using window.openPlan2DModal');
            window.openPlan2DModal();
          } else if (typeof openPlan2DModal === 'function') {
            console.log('[Theme Navigation] Using openPlan2DModal');
            openPlan2DModal();
          } else {
            // Trigger the button click as fallback
            console.log('[Theme Navigation] Using button fallback');
            var btn = document.getElementById('btn-floorplan');
            if (btn) btn.click();
          }
        }, 300);
        break;
        
      case 'visualize':
        // Show 3D visualize
        console.log('[Theme Navigation] Opening Visualize modal');
        hideAccountForNavigation();
        setTimeout(function() {
          if (typeof showVisualize === 'function') {
            console.log('[Theme Navigation] Using showVisualize');
            showVisualize();
          } else {
            // Trigger via dropdown action as fallback
            console.log('[Theme Navigation] Using dropdown fallback');
            var dropdown = document.querySelector('.dropdown-item[data-action="visualize-photoreal"]');
            if (dropdown) dropdown.click();
          }
        }, 300);
        break;
        
      case 'da-workflow':
        // Open DA Workflow - let it show project selector
        console.log('[Theme Navigation] Opening DA Workflow');
        setTimeout(function() {
          if (window.DAWorkflowUI && window.DAWorkflowUI.open) {
            console.log('[Theme Navigation] Opening DA Workflow with selector');
            window.DAWorkflowUI.open(); // No projectId = show selector
          } else {
            console.log('[Theme Navigation] DAWorkflowUI not available');
          }
        }, 120);
        break;
        
      case 'dashboard':
      case 'account':
        // Open account modal and ensure dashboard home is visible
        console.log('[Theme Navigation] Opening Dashboard Home');
        setTimeout(function() {
          if (window.toggleAccountModal) {
            window.toggleAccountModal('show');
            // Ensure we're on dashboard home, not a sub-view
            setTimeout(function() {
              if (typeof window.returnToDashboard === 'function') {
                window.returnToDashboard();
              }
            }, 100);
          }
        }, 300);
        break;
        
      default:
        console.log('[Theme Navigation] Unknown section:', section);
    }
  }
  
  // Export functions
  window.loadThemeSettings = loadThemeSettings;
  window.applyThemeToSection = applyThemeToSection;
  
  // Global theme refresh - reapplies all saved themes
  window.refreshAllThemes = function() {
    console.log('[Theme Settings] Refreshing all themes globally...');
    var settings = loadThemeSettings();
    
    Object.keys(sectionSelectors).forEach(function(section) {
      var theme = settings[section] || 'light';
      applyThemeToSection(section, theme);
    });
    
    console.log('[Theme Settings] All themes refreshed');
  };
  
  // Force apply a theme to a section
  window.forceTheme = function(section, theme) {
    console.log('[Theme Settings] Force applying', theme, 'to', section);
    applyThemeToSection(section, theme);
    
    var settings = loadThemeSettings();
    settings[section] = theme;
    saveThemeSettings(settings);
    
    // Update checkbox if exists
    var checkboxMap = {
      'main': 'theme-main-editor',
      'plan2d': 'theme-plan2d',
      'visualize': 'theme-visualize',
      'da-workflow': 'theme-da-workflow',
      'account': 'theme-account'
    };
    
    var checkboxId = checkboxMap[section];
    if (checkboxId) {
      var checkbox = document.getElementById(checkboxId);
      if (checkbox) {
        checkbox.checked = theme === 'dark';
      }
    }
  };
})();

/**
 * Save current design (and any visualizations) to a Project
 * Called from 3D view "Save Project" button
 */
(function() {
  function ensureProjectStorage() {
    if (window.ProjectStorage && typeof window.ProjectStorage.getProjects === 'function') {
      return window.ProjectStorage;
    }
    showAppleAlert('Error', 'Project storage is not ready yet. Please reload and try again.');
    console.error('[SaveProject] ProjectStorage unavailable');
    return null;
  }

  function hasMeaningfulDesign(designJSON) {
    try {
      var parsed = JSON.parse(designJSON);
      return (
        (parsed.rooms && parsed.rooms.length) ||
        (parsed.wallStrips && parsed.wallStrips.length) ||
        (parsed.furniture && parsed.furniture.length) ||
        (parsed.pergolas && parsed.pergolas.length) ||
        (parsed.garages && parsed.garages.length) ||
        (parsed.pools && parsed.pools.length) ||
        (parsed.roofs && parsed.roofs.length) ||
        (parsed.balconies && parsed.balconies.length) ||
        (parsed.stairsList && parsed.stairsList.length)
      );
    } catch (err) {
      console.error('Failed to inspect design payload', err);
      return false;
    }
  }

  function saveProjectFrom3D() {
    var currentUser = window.__appUserId;
    if (!currentUser) {
      showAppleAlert('Login Required', 'Please log in via the Account panel before saving a project.');
      if (window.toggleAccountModal) window.toggleAccountModal('show');
      return;
    }

    if (!window.serializeProject) {
      showAppleAlert('Error', 'Design system not loaded. Please refresh the page.');
      return;
    }

    var designData = window.serializeProject();
    if (!hasMeaningfulDesign(designData)) {
      showAppleAlert('No Design', 'Please create or update a design before saving a project.');
      return;
    }

    var storage = ensureProjectStorage();
    if (!storage) return;

    captureDesignSnapshot(function(snapshot) {
      var projects = storage.getProjects();
      showProjectSelectionForSave(storage, projects, designData, snapshot);
    });
  }

  // New API (used by the 3D toolbar)
  window.saveProjectFrom3D = saveProjectFrom3D;
  // Back-compat (older markup / callers)
  window.saveDesignForDA = saveProjectFrom3D;

  function captureDesignSnapshot(callback) {
    try {
      var canvas = document.getElementById('canvas');
      if (!canvas) {
        callback(null);
        return;
      }
      var tempCanvas = document.createElement('canvas');
      tempCanvas.width = 400;
      tempCanvas.height = 300;
      var ctx = tempCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
      callback(tempCanvas.toDataURL('image/jpeg', 0.8));
    } catch (err) {
      console.error('Failed to capture snapshot:', err);
      callback(null);
    }
  }

  function showProjectSelectionForSave(storage, projects, designData, snapshot) {
    var modal = document.createElement('div');
    modal.className = 'modal-overlay da-project-selector';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:100000;display:flex;align-items:center;justify-content:center;';

    var content = document.createElement('div');
    content.className = 'da-modal-content';
    content.innerHTML = `
      <h2 class="da-modal-title"><svg class="sf-icon" width="22" height="22"><use href="#sf-arrow-down-doc"/></svg> Save Project</h2>
      <p class="da-modal-subtitle">Select an existing project, or create a new one:</p>
      <div id="da-project-list" class="da-project-list"></div>
      <div id="da-new-project-form" class="da-new-project-form" style="display: none;">
        <div class="da-form-header">
          <h3 class="da-form-title">Create New Project</h3>
          <p class="da-form-subtitle">Enter a name for your new project</p>
        </div>
        <input type="text" id="da-project-name-input" class="apple-input da-project-input" placeholder="Project name..." />
        <div class="da-form-actions">
          <button id="da-form-cancel-btn" class="secondary">Cancel</button>
          <button id="da-form-create-btn" class="primary">Create Project</button>
        </div>
      </div>
      <div class="da-modal-actions">
        <button class="da-cancel-btn secondary">Cancel</button>
        <button id="da-new-project-btn" class="da-new-btn">+ New Project</button>
      </div>`;

    modal.appendChild(content);
    document.body.appendChild(modal);

    var projectList = content.querySelector('#da-project-list');
    if (projects.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'da-project-empty';
      emptyMsg.innerHTML = '<div class="da-empty-icon"><svg class="sf-icon" width="40" height="40"><use href="#sf-folder"/></svg></div><div>No projects yet. Create your first project below.</div>';
      projectList.appendChild(emptyMsg);
    } else {
      projects.forEach(function(project) {
        var projectDiv = document.createElement('div');
        projectDiv.className = 'da-project-item';
        var thumbnail = project.thumbnail || snapshot;
        var thumbMarkup = thumbnail
          ? '<img src="' + thumbnail + '" class="da-project-thumbnail" />'
          : '<div class="da-project-thumbnail-empty"><svg class="sf-icon" width="30" height="30"><use href="#sf-house"/></svg></div>';
        var badgeMarkup = project.hasDesign
          ? '<div class="da-project-badge-wrap"><span class="da-project-badge"><svg class="sf-icon" width="11" height="11"><use href="#sf-square-and-pencil"/></svg> Design</span></div>'
          : '';
        var updatedLabel = new Date(project.updatedAt).toLocaleDateString();
        projectDiv.innerHTML = `
          ${thumbMarkup}
          <div class="da-project-info">
            <div class="da-project-name"><svg class="sf-icon" width="16" height="16"><use href="#sf-folder"/></svg> ${escapeHtml(project.name)}</div>
            <div class="da-project-date">Updated: ${updatedLabel}</div>
            ${badgeMarkup}
          </div>`;

        projectDiv.onclick = function() {
          saveToExistingProject(storage, project.id, designData, snapshot);
          modal.remove();
        };

        projectList.appendChild(projectDiv);
      });
    }

    content.querySelector('.da-cancel-btn').onclick = function() {
      modal.remove();
    };

    var newProjectForm = content.querySelector('#da-new-project-form');
    var projectListEl = content.querySelector('#da-project-list');
    var newProjectBtn = content.querySelector('#da-new-project-btn');
    var modalSubtitle = content.querySelector('.da-modal-subtitle');
    var projectInput = content.querySelector('#da-project-name-input');

    newProjectBtn.onclick = function() {
      // Animate transition to new project form
      projectListEl.style.opacity = '0';
      projectListEl.style.transform = 'translateY(-10px)';
      modalSubtitle.style.opacity = '0';
      
      setTimeout(function() {
        projectListEl.style.display = 'none';
        modalSubtitle.textContent = 'Create a new project for this design:';
        modalSubtitle.style.opacity = '1';
        newProjectForm.style.display = 'block';
        newProjectBtn.style.display = 'none';
        
        // Animate form in
        setTimeout(function() {
          newProjectForm.style.opacity = '1';
          newProjectForm.style.transform = 'translateY(0)';
          projectInput.focus();
          projectInput.value = 'Project ' + new Date().toLocaleDateString();
          projectInput.select();
        }, 50);
      }, 200);
    };

    content.querySelector('#da-form-cancel-btn').onclick = function() {
      // Animate back to project list
      newProjectForm.style.opacity = '0';
      newProjectForm.style.transform = 'translateY(-10px)';
      
      setTimeout(function() {
        newProjectForm.style.display = 'none';
        modalSubtitle.textContent = 'Select a project or create a new one:';
        projectListEl.style.display = 'flex';
        newProjectBtn.style.display = 'block';
        
        setTimeout(function() {
          projectListEl.style.opacity = '1';
          projectListEl.style.transform = 'translateY(0)';
        }, 50);
      }, 200);
    };

    content.querySelector('#da-form-create-btn').onclick = function() {
      var projectName = projectInput.value.trim();
      if (!projectName) {
        projectInput.focus();
        return;
      }
      
      var created = storage.createProject(projectName, {
        aiImages: window.aiImages || [],
        thumbnail: snapshot,
        designData: designData,
        hasDesign: true
      });
      
      modal.remove();
      if (created) {
        showAppleAlert('Success', 'Saved to "' + created.name + '". You can share it, continue work, or start DA Workflow later.');
        if (window.toggleAccountModal) window.toggleAccountModal('show');
      }
    };

    // Handle Enter key in input
    projectInput.onkeydown = function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        content.querySelector('#da-form-create-btn').click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        content.querySelector('#da-form-cancel-btn').click();
      }
    };
  }

  function saveToExistingProject(storage, projectId, designData, snapshot) {
    var updated = storage.updateProject(projectId, function(project) {
      project.designData = designData;
      project.hasDesign = true;
      project.aiImages = window.aiImages || project.aiImages || [];
      if (snapshot) project.thumbnail = snapshot;
      return project;
    });

    if (!updated) {
      showAppleAlert('Error', 'Project not found.');
      return;
    }

    showAppleAlert('Success', 'Saved to "' + updated.name + '". You can share it, continue work, or start DA Workflow later.');

    // If the user is working on this project, reflect the new save timestamp in the UI.
    try {
      if (typeof window.setActiveProject === 'function') window.setActiveProject(updated);
    } catch(_eMeta) {}

    if (window.toggleAccountModal) window.toggleAccountModal('show');
  }

  function escapeHtml(text) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return (text || '').replace(/[&<>"']/g, function(m) { return map[m]; });
  }
})();