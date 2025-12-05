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
      if (target === 'projects' && typeof window.loadProjectsView === 'function') {
        window.loadProjectsView();
        if (__accountAdminRefreshTimer) { clearInterval(__accountAdminRefreshTimer); __accountAdminRefreshTimer = null; }
      } else if (target === 'settings' && typeof window.loadLLMSettingsUI === 'function') {
        window.loadLLMSettingsUI();
        // Stop admin polling if leaving admin
        if (__accountAdminRefreshTimer) { clearInterval(__accountAdminRefreshTimer); __accountAdminRefreshTimer = null; }
      } else if (target === 'info' && typeof window.populateInfoControls === 'function') {
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