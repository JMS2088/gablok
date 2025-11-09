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
    try { populateInfoControls(); } catch(e) { console.warn('populateInfoControls failed', e); }
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

  // Dynamically populate the Info modal with current control + shortcut documentation.
  function populateInfoControls(){
    var body = document.getElementById('info-body'); if(!body) return;
    // Avoid rebuilding if already populated during this open cycle (optional)
    if (body.__populatedOnce) return; // comment out this line to always rebuild
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac OS/.test(navigator.userAgent || '');
    var MOD = isMac ? 'Cmd' : 'Ctrl';
    var redoKeys = isMac ? 'Shift+'+MOD+'+Z' : MOD+'+Y / Shift+'+MOD+'+Z';
    var html = '';
    function section(title, listHtml){
      html += '<section><h3 class="info-section-title">'+title+'</h3><ul class="info-list">'+listHtml+'</ul></section>';
    }
    function li(txt){ return '<li>'+txt+'</li>'; }
    // Camera / Navigation
    section('Camera & Navigation',
      li('<strong>Drag (empty space)</strong>: Orbit camera')+
      li('<strong>Shift + Drag</strong>: Pan camera')+
      li('<strong>Mouse Wheel</strong>: Zoom in/out')+
      li('<strong>Compass</strong>: Shows North; click & drag (if enabled) to re-orient')
    );
    // Main Toolbar & Menus
    section('Toolbar & Menus',
      li('<strong>+ Add Room</strong>: Insert new rectangular room (resize by dragging colored handles)')+
      li('<strong>Render: Lines/Solid</strong>: Toggle free-standing walls between outline and 300mm thickness')+
      li('<strong>Level Menu</strong>: Switch floors or add components (+ Stairs, + Pergola, + Garage, + Roof, + Pool, + Balcony)')+
      li('<strong>Main Menu › Information</strong>: Open this help panel')+
      li('<strong>Main Menu › Reset</strong>: Reset entire project (confirmation)')+
      li('<strong>Main Menu › Price</strong>: Open pricing breakdown')+
      li('<strong>Export</strong>: OBJ (3D), PDF (views), JSON (project), DXF/DWG (floorplan)')+
      li('<strong>Import</strong>: OBJ, PDF/SVG/DXF/DWG floorplans, JSON (project)')
    );
    // 3D Editing
    section('3D Object Editing',
      li('<strong>Select</strong>: Click any room/component/furniture to select; label shows Edit / 360° buttons when applicable')+
      li('<strong>Edit</strong>: Opens the Room Palette for furniture management (rooms only)')+
      li('<strong>360° Button</strong>: Rotates selected roof, stairs, garage, balcony, pergola, furniture by 45° each click')+
      li('<strong>Resize Handles</strong>: Drag X (width), Z (depth), Y (height where present)')+
      li('<strong>Measurements Panel</strong>: Precise edits (name, size, position); click Save to apply')+
      li('<strong>Arrow Keys (selected object)</strong>: Nudge by 0.1m; hold Shift for 1.0m steps; automatic history coalescing for rapid nudges')
    );
    // Components specifics
    section('Components',
      li('<strong>Stairs</strong>: Added once; rotate with 360°; positioned like other components')+
      li('<strong>Roof</strong>: Add via Level Menu; rotate with 360°; style via Roof Type dropdown (if present)')+
      li('<strong>Garage / Pergola / Pool / Balcony</strong>: Added from Level Menu; place & resize similar to rooms (subject to constraints)')
    );
    // Room Palette (Furniture)
    section('Room Palette (Furniture)',
      li('<strong>Preview Canvas</strong>: Orbit with drag; items show scaled representation')+
      li('<strong>Add to Room</strong>: Commits preview items to selected room')+
      li('<strong>Clear</strong>: Removes preview items only (keeps existing room furniture)')+
      li('<strong>Rotation</strong>: Use 360° after placement for supported furniture types')
    );
    // 2D Floor Plan Editor
    section('2D Floor Plan Editor',
      li('<strong>Open</strong>: Floor Plan button in main toolbar')+
      li('<strong>Select Tool</strong>: Click elements (walls / doors / windows); Delete removes; Arrow keys nudge (Shift faster, Alt finer)')+
      li('<strong>Wall Tool</strong>: Click-drag to draw axis-aligned segments; Shift-click to chain; Enter / double-click to finish loop')+
      li('<strong>Window / Door Tools</strong>: Click a wall to place; drag endpoints to size; dropdowns set type / swing / hinge')+
      li('<strong>Erase Tool</strong>: Click to remove element under cursor')+
      li('<strong>Fit</strong>: Auto-fit current drawing to viewport')+
      li('<strong>Flip Y</strong>: Mirror vertical axis to match 3D orientation')+
      li('<strong>Clear</strong>: Remove all elements (confirmation)')+
      li('<strong>Apply to 3D</strong>: Commit plan, close editor, update 3D scene')+
      li('<strong>Floor Toggle</strong>: Switch Ground/First while editing')+
      li('<strong>Pan</strong>: Hold Space + Drag')
    );
    // Keyboard shortcuts
    section('Keyboard Shortcuts',
      li('<strong>'+MOD+'+Z</strong>: Undo (up to ~60 steps)')+
      li('<strong>'+redoKeys+'</strong>: Redo')+
      li('<strong>Delete</strong>: Delete selected (3D object or 2D element)')+
      li('<strong>Escape</strong>: Clear current selection')+
      li('<strong>Arrow Keys</strong>: Nudge selection (3D: 0.1m / Shift 1.0m; 2D: grid units; Alt = finer in 2D)')+
      li('<strong>Space + Drag</strong>: Pan (2D editor)')+
      li('<strong>Enter</strong>: Finish current wall chain (2D)')
    );
    // History system
    section('Undo / Redo History',
      li('Automatic snapshot on: 3D drag end, arrow-key movement (coalesced), deletions, 2D edits, wall-strip moves')+
      li('Rapid micro-movements are merged to keep history concise')+
      li('Maximum stored steps: about 60 (older steps drop off)')
    );
    // Tips
    section('Tips',
      li('Use Solid wall render only when needed; Lines mode is faster for large scenes')+
      li('Rotate roof early to align orientation before adding other components')+
      li('Apply 2D plan frequently to sync and unlock precise 3D measurement edits')
    );
    body.innerHTML = html;
    body.__populatedOnce = true;
  }
})();
