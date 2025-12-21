// UI Modals (Info and Share)
// Kept as global functions for compatibility with existing inline onclick handlers.
(function(){
  function setStatus(message){
    try { var el=document.getElementById('status'); if(el) el.textContent = message; } catch(e) {}
  }

  // Info modal controls
  window.showInfo = function(){
    var modal = document.getElementById('info-modal'); if (!modal) return;
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
      fetchShareUrl({ inputId: 'share-url', openId: 'share-open', hintId: 'share-hint', focus: true, select: true })
        .then(function(){ modal.classList.add('visible'); })
        .catch(function(){ modal.classList.add('visible'); });
    }catch(e){ console.warn('showShare failed', e); }
  };
  window.hideShare = function(){
    var modal = document.getElementById('share-modal'); if(modal) modal.classList.remove('visible');
    var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.classList.remove('is-hidden');
  };
  window.copyShareUrl = function(id){
    var input = document.getElementById(id || 'share-url'); if(!input) return;
    input.select(); input.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); setStatus('URL copied'); }
    catch(e){ if(navigator.clipboard){ navigator.clipboard.writeText(input.value).then(function(){ setStatus('URL copied'); }).catch(function(){ setStatus('Copy failed'); }); } }
  };

  // Admin modal controls
  window.showAdmin = async function(){
    try{
      var modal = document.getElementById('admin-modal'); if(!modal) return;
      // Fetch latest admin data
      var resp = await fetch('/__admin-data', { cache: 'no-store' });
      if(!resp.ok){ console.warn('admin data fetch failed', resp.status); }
      var data = resp.ok ? (await resp.json()) : { users: [], errors: [] };
      var usersUl = document.getElementById('admin-users');
      var errsUl = document.getElementById('admin-errors');
      if(usersUl){
        var users = Array.isArray(data.users) ? data.users : [];
        usersUl.innerHTML = users.length ? users.map(function(u){
          var last = new Date(u.lastSeen || Date.now()).toLocaleString();
          var ua = (u.ua || '').replace(/</g,'&lt;');
          return '<li>'+
            '<div class="admin-user-id">'+ (u.id||'(unknown)') +'</div>'+
            '<div class="admin-meta">seen: '+ last + ' · count: '+ (u.count||1) +'</div>'+
            (ua?('<div class="admin-meta">ua: '+ ua +'</div>'):'')+
          '</li>';
        }).join('') : '<li class="admin-meta">No users logged yet.</li>';
      }
      if(errsUl){
        var errs = Array.isArray(data.errors) ? data.errors : [];
        errsUl.innerHTML = errs.length ? errs.map(function(e){
          var ts = new Date(e.ts || Date.now()).toLocaleString();
          var msg = (e.message||'').replace(/</g,'&lt;');
          var stack = (e.stack||'').replace(/</g,'&lt;');
          var uid = (e.userId || '');
          return '<li>'+
            '<div class="admin-meta">'+ ts + (uid?(' · user: '+uid):'') +'</div>'+
            '<div class="admin-error"><strong>'+ msg +'</strong>' + (stack?('<br>'+ stack):'') + '</div>'+
          '</li>';
        }).join('') : '<li class="admin-meta">No errors logged.</li>';
      }
      modal.classList.add('visible');
    }catch(e){ console.warn('showAdmin failed', e); }
  };
  window.hideAdmin = function(){ var m=document.getElementById('admin-modal'); if(m) m.classList.remove('visible'); };

  // Doc reader modal (renders Markdown as an Apple-styled page)
  window.hideDoc = function(){
    var modal = document.getElementById('doc-modal');
    if (modal) modal.classList.remove('visible');
  };

  function escapeHtml(text){
    try {
      var div = document.createElement('div');
      div.textContent = String(text == null ? '' : text);
      return div.innerHTML;
    } catch (_e) {
      return '';
    }
  }

  function escapeAttr(text){
    return escapeHtml(String(text == null ? '' : text)).replace(/"/g, '&quot;');
  }

  function renderMarkdownInline(text){
    var s = escapeHtml(text);

    // Inline code
    s = s.replace(/`([^`]+)`/g, function(_m, code){
      return '<code class="doc-inline-code">' + escapeHtml(code) + '</code>';
    });

    // Links
    s = s.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, function(_m, label, href){
      var safeHref = String(href || '').trim();
      return '<a class="doc-link" href="' + escapeAttr(safeHref) + '">' + escapeHtml(label) + '</a>';
    });

    // Bold / italic
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    return s;
  }

  function renderMarkdownToHtml(markdownText){
    var md = String(markdownText == null ? '' : markdownText);
    md = md.replace(/\r\n/g, '\n');
    md = md.replace(/\t/g, '    ');

    var lines = md.split('\n');
    var i = 0;
    var html = '';

    function isBlank(line){
      return !line || !String(line).trim();
    }

    function readUntilBlank(startIdx){
      var out = [];
      var idx = startIdx;
      while (idx < lines.length && !isBlank(lines[idx])) {
        out.push(lines[idx]);
        idx++;
      }
      return { lines: out, next: idx };
    }

    function parseTableAt(idx){
      // Minimal GitHub-style table:
      // Header row with pipes, second row separator with ---
      if (idx + 1 >= lines.length) return null;
      var headerLine = lines[idx];
      var sepLine = lines[idx + 1];
      if (!/\|/.test(headerLine)) return null;
      if (!/^\s*\|?\s*:?[-]{3,}:?\s*(\|\s*:?[-]{3,}:?\s*)+\|?\s*$/.test(sepLine)) return null;

      function splitRow(row){
        var r = String(row).trim();
        if (r.startsWith('|')) r = r.slice(1);
        if (r.endsWith('|')) r = r.slice(0, -1);
        return r.split('|').map(function(c){ return String(c).trim(); });
      }

      var headerCells = splitRow(headerLine);
      var rowIdx = idx + 2;
      var bodyRows = [];
      while (rowIdx < lines.length && /\|/.test(lines[rowIdx]) && !isBlank(lines[rowIdx])) {
        bodyRows.push(splitRow(lines[rowIdx]));
        rowIdx++;
      }

      if (!headerCells.length) return null;
      var t = '<table class="doc-table"><thead><tr>' +
        headerCells.map(function(c){ return '<th>' + renderMarkdownInline(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        bodyRows.map(function(r){
          return '<tr>' + headerCells.map(function(_c, j){
            return '<td>' + renderMarkdownInline(r[j] == null ? '' : r[j]) + '</td>';
          }).join('') + '</tr>';
        }).join('') +
        '</tbody></table>';

      return { html: t, next: rowIdx };
    }

    while (i < lines.length) {
      var line = lines[i];

      // Fenced code block
      var fenceMatch = /^\s*```\s*([^\s]*)\s*$/.exec(line);
      if (fenceMatch) {
        var lang = (fenceMatch[1] || '').trim();
        i++;
        var codeLines = [];
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        html += '<pre class="doc-code"><code' + (lang ? (' data-lang="' + escapeAttr(lang) + '"') : '') + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>';
        continue;
      }

      // Skip blanks
      if (isBlank(line)) { i++; continue; }

      // Headings
      var h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) {
        var level = h[1].length;
        var title = String(h[2] || '').trim();
        var id = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
        html += '<h' + level + (id ? (' id="' + escapeAttr(id) + '"') : '') + '>' + renderMarkdownInline(title) + '</h' + level + '>';
        i++;
        continue;
      }

      // Table
      var tRes = parseTableAt(i);
      if (tRes) {
        html += tRes.html;
        i = tRes.next;
        continue;
      }

      // Blockquote
      if (/^\s*>\s?/.test(line)) {
        var qLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          qLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html += '<blockquote class="doc-quote">' + renderMarkdownToHtml(qLines.join('\n')) + '</blockquote>';
        continue;
      }

      // Unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        html += '<ul class="doc-list">' + items.map(function(it){ return '<li>' + renderMarkdownInline(it) + '</li>'; }).join('') + '</ul>';
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        var oItems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          oItems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        html += '<ol class="doc-olist">' + oItems.map(function(it){ return '<li>' + renderMarkdownInline(it) + '</li>'; }).join('') + '</ol>';
        continue;
      }

      // Paragraph
      var paraRes = readUntilBlank(i);
      var paraText = paraRes.lines.join(' ').replace(/\s+/g, ' ').trim();
      html += '<p class="doc-paragraph">' + renderMarkdownInline(paraText) + '</p>';
      i = paraRes.next;
    }

    return html;
  }

  async function openDocReader(opts){
    try {
      if (typeof opts === 'string') opts = { href: opts, title: arguments[1] };
      opts = opts || {};
      var href = String(opts.href || '').trim();
      if (!href) return;

      var modal = document.getElementById('doc-modal');
      var titleEl = document.getElementById('doc-title');
      var bodyEl = document.getElementById('doc-body');
      if (!modal || !titleEl || !bodyEl) {
        console.warn('doc modal missing in DOM');
        return;
      }

      titleEl.textContent = String(opts.title || 'Document');
      bodyEl.innerHTML = '<div class="doc-loading">Loading…</div>';
      modal.classList.add('visible');

      var resp = await fetch(href, { cache: 'no-store' });
      if (!resp.ok) {
        bodyEl.innerHTML = '<div class="doc-error"><strong>Could not load this document.</strong><div class="doc-error-meta">HTTP ' + escapeHtml(resp.status) + '</div></div>';
        return;
      }

      var md = await resp.text();
      var contentHtml = renderMarkdownToHtml(md);
      bodyEl.innerHTML = '<article class="doc-page">' + contentHtml + '</article>';
      bodyEl.scrollTop = 0;

      // Intercept clicks on markdown links so .md stays in-app.
      if (!bodyEl.__docLinkBound) {
        bodyEl.addEventListener('click', function(ev){
          try {
            var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
            if (!a) return;
            var url = a.getAttribute('href') || '';
            if (!url) return;

            // Only handle local markdown links.
            if (/\.md(#[^\s]*)?$/i.test(url) && !/^(https?:)?\/\//i.test(url)) {
              ev.preventDefault();
              var parts = url.split('#');
              openDocReader({ href: parts[0], title: parts[0] });
              // Allow anchor jump after load (best-effort)
              var hash = parts[1];
              if (hash) {
                setTimeout(function(){
                  var el = document.getElementById(hash);
                  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
                }, 50);
              }
              return;
            }

            // External links should open in a new tab.
            if (/^https?:\/\//i.test(url)) {
              a.setAttribute('target', '_blank');
              a.setAttribute('rel', 'noopener');
            }
          } catch (_e) {}
        });
        bodyEl.__docLinkBound = true;
      }
    } catch (e) {
      console.warn('openDocReader failed', e);
    }
  }

  window.openDocReader = openDocReader;

  // Dynamically populate the Info modal with current control + shortcut documentation.
  function populateInfoControls(targetId){
    var body = document.getElementById(targetId || 'info-body'); if(!body) return;
    if (body.__populatedOnce) return;

    // Account > Information panel uses a richer Help & Docs layout.
    if ((targetId || '') === 'account-info-body') {
      try {
        populateAccountHelpDocs(body);
        body.__populatedOnce = true;
      } catch (e) {
        console.warn('[Account] Help & Docs render failed:', e);
      }
      return;
    }

    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac OS/.test(navigator.userAgent || '');
    var MOD = isMac ? 'Cmd' : 'Ctrl';
    var redoKeys = isMac ? 'Shift+'+MOD+'+Z' : MOD+'+Y / Shift+'+MOD+'+Z';
    var html = '';
    function section(title, listHtml){
      html += '<section><h3 class="info-section-title">'+title+'</h3><ul class="info-list">'+listHtml+'</ul></section>';
    }
    function li(txt){ return '<li>'+txt+'</li>'; }
    // High-level quickstart so users see it first when opening the Account > Information page
    section('How the App Works',
      li('<strong>Add Room</strong>: Click “+ Add Room”, then drag colored handles (X/Z/Y) to size and shape your space.')+
      li('<strong>Add Components</strong>: Use the Level menu for + Stairs, + Pergola, + Garage, + Roof, + Pool, + Balcony.')+
      li('<strong>Edit Furniture</strong>: Select a room and click <em>Edit</em> on its label to open the Room Palette.')+
      li('<strong>Precision Panel</strong>: Use Object Measurements (right) to set name, width, depth, height, and position; click Save.')+
      li('<strong>Floor Plan Editor</strong>: Click “Floor Plan” to calibrate a PDF or draw walls/doors/windows; Commit applies to 3D.')+
      li('<strong>Reset / Price</strong>: Use Main Menu for Reset (with confirmation) and Price to see a breakdown.')+
      li('<strong>Share / Export / Import</strong>: Share a link, export OBJ/PDF/JSON/DXF/DWG, or import JSON/plan files.')+
      li('<strong>Undo/Redo</strong>: Extensive history with snapshot coalescing for smooth iteration.')
    );
    // Compact keyboard cheat sheet near top
    section('Keyboard Quick Commands',
      li('<strong>'+MOD+'+Z</strong>: Undo')+
      li('<strong>'+redoKeys+'</strong>: Redo')+
      li('<strong>Delete</strong>: Delete selection')+
      li('<strong>Escape</strong>: Clear selection')+
      li('<strong>Arrow Keys</strong>: Nudge selection (3D: 0.1m; <em>Shift</em> = 1.0m; 2D: grid; <em>Alt</em> = finer)')+
      li('<strong>Space + Drag</strong>: Pan (2D editor)')+
      li('<strong>Enter</strong>: Finish wall chain (2D)')
    );
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
    // Rulers & Guides
    section('Rulers & Guides',
      li('<strong>Rulers</strong>: White with black ticks/text; 0.0 at the top-left; labels are meters and scale with zoom')+
      li('<strong>Create Guides</strong>: Drag from the top ruler for vertical guides, or from the left ruler for horizontal guides')+
      li('<strong>Snap to Guides</strong>: Drawing snaps within ~8px (screen) to nearby guides and grid for precision')+
      li('<strong>Move/Delete</strong>: Click a guide to select, drag to reposition, press Delete to remove')+
      li('<strong>Per Floor</strong>: Guides are saved per floor and persist across sessions, exports, and imports')+
      li('<strong>Measurements</strong>: 2D segment lengths render automatically; exports preserve the plan + view so measurements match when reopened')
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

  function populateAccountHelpDocs(body){
    try { body.classList.add('helpdocs-ready'); } catch(_eClass) {}
    var docs = [
      {
        title: 'DA Workflow Quick Start',
        description: 'A fast overview of the end-to-end DA Workflow and how to use it inside Gablok.',
        href: 'DA_WORKFLOW_QUICK_START.md',
        icon: 'sf-list-bullet',
        tint: 'blue',
        bullets: ['Stages, steps, and progress tracking', 'Where documents & contacts live', 'How to resume a saved workflow']
      },
      {
        title: 'DA Workflow Readme',
        description: 'Deeper reference for the workflow structure, state, and UI behaviors.',
        href: 'DA_WORKFLOW_README.md',
        icon: 'sf-doc-text',
        tint: 'indigo',
        bullets: ['Workflow data model', 'Persistence & project linkage', 'UI/UX conventions']
      },
      {
        title: 'Project Design Guide',
        description: 'Practical guidance for creating, editing, and iterating designs in 3D and 2D.',
        href: 'PROJECT_DESIGN_GUIDE.md',
        icon: 'sf-ruler',
        tint: 'green',
        bullets: ['3D room + component workflow', 'Floor plan editor basics', 'Best practices for clean outputs']
      },
      {
        title: 'Apple Design System',
        description: 'Implementation notes for the Apple-style UI (tokens, components, and modal behavior).',
        href: 'APPLE_DESIGN_SYSTEM_IMPLEMENTATION.md',
        icon: 'sf-macwindow',
        tint: 'blue',
        bullets: ['Token usage & typography', 'Buttons, cards, and overlays', 'Dark mode conventions']
      },
      {
        title: 'Photorealistic Rendering Guide',
        description: 'How to generate and manage photorealistic renders, including pipelines and outputs.',
        href: 'PHOTOREALISTIC_RENDERING_GUIDE.md',
        icon: 'sf-photo',
        tint: 'indigo',
        bullets: ['Render pipeline overview', 'Saving and reviewing outputs', 'Common troubleshooting']
      },
      {
        title: 'Testing & Debug',
        description: 'Notes and workflows for testing, debugging, and validating changes safely.',
        href: 'TESTING.md',
        icon: 'sf-wrench-and-screwdriver',
        tint: 'orange',
        bullets: ['Local testing checklist', 'Debug windows tips', 'Known pitfalls & recovery']
      }
    ];

    function escape(text){
      try {
        var div = document.createElement('div');
        div.textContent = String(text == null ? '' : text);
        return div.innerHTML;
      } catch (_e) {
        return '';
      }
    }

    var cardsHtml = docs.map(function(doc){
      var bullets = Array.isArray(doc.bullets) ? doc.bullets : [];
      return (
        '<article class="helpdoc-card" data-tint="' + escape(doc.tint || 'blue') + '">'+
          '<div class="helpdoc-thumb" aria-hidden="true">'+
            '<svg viewBox="0 0 160 96" class="helpdoc-thumb-svg" focusable="false">'+
              '<rect x="10" y="10" width="140" height="76" rx="18" fill="currentColor" opacity="0.10" />'+
              '<rect x="24" y="26" width="84" height="10" rx="5" fill="currentColor" opacity="0.16" />'+
              '<rect x="24" y="44" width="68" height="10" rx="5" fill="currentColor" opacity="0.14" />'+
              '<rect x="24" y="62" width="52" height="10" rx="5" fill="currentColor" opacity="0.12" />'+
              '<use href="#' + escape(doc.icon || 'sf-doc') + '" x="118" y="22" width="28" height="28" />'+
            '</svg>'+
          '</div>'+
          '<div class="helpdoc-header">'+
            '<div class="helpdoc-title">'+
              '<svg class="sf-icon" width="18" height="18" aria-hidden="true"><use href="#' + escape(doc.icon || 'sf-doc') + '" /></svg>'+
              '<span>' + escape(doc.title) + '</span>'+
            '</div>'+
            '<p class="helpdoc-desc">' + escape(doc.description) + '</p>'+
          '</div>'+
          '<ul class="helpdoc-bullets">'+
            bullets.map(function(b){ return '<li>' + escape(b) + '</li>'; }).join('')+
          '</ul>'+
          '<div class="helpdoc-actions">'+
            '<a class="apple-button apple-button-gray helpdoc-action" href="' + escape(doc.href) + '" data-doc-href="' + escape(doc.href) + '" data-doc-title="' + escape(doc.title) + '">Open</a>'+
          '</div>'+
        '</article>'
      );
    }).join('');

    body.innerHTML =
      '<div class="helpdocs-layout">'+
        '<div class="helpdocs-grid">' + cardsHtml + '</div>'+
      '</div>';

    // Make Help & Docs open inside the doc reader (no raw .md navigation)
    if (!body.__helpDocsClickBound) {
      body.addEventListener('click', function(ev){
        try {
          var a = ev.target && ev.target.closest ? ev.target.closest('a.helpdoc-action') : null;
          if (!a) return;
          var href = a.getAttribute('data-doc-href') || a.getAttribute('href') || '';
          var title = a.getAttribute('data-doc-title') || a.textContent || 'Document';
          ev.preventDefault();
          openDocReader({ href: href, title: title });
        } catch (_e) {}
      });
      body.__helpDocsClickBound = true;
    }

    try { window.__accountHelpDocsCount = docs.length; } catch (_eCount) {}
  }
  // Expose for embedded account view usage
  window.populateInfoControls = populateInfoControls;

  // Reusable forwarded URL logic for both modal and account view
  async function fetchShareUrl(opts){
    opts = opts || {};
    var fallUrl = window.location.href;
    function normalizeForwardedUrl(urlStr){
      try{
        var u = new URL(urlStr);
        var host = u.hostname;
        var isFwdHost = /app\.github\.dev$|githubpreview\.dev$|gitpod\.io$/.test(host);
        if (!isFwdHost) return urlStr;
        var parts = host.split('.');
        if (!parts.length) return urlStr;
        var sub = parts[0] || '';
        var rest = parts.slice(1).join('.');
        var portLabel = '8000';
        var newSub = sub;
        if (sub.startsWith(portLabel + '-')) {
          newSub = sub;
        } else if (sub.endsWith('-' + portLabel)) {
          newSub = portLabel + '-' + sub.slice(0, -(portLabel.length + 1));
        } else if (/^\d+-.+/.test(sub)) {
          var subParts = sub.split('-'); subParts.shift();
          newSub = portLabel + '-' + subParts.join('-');
        } else {
          newSub = portLabel + '-' + sub;
        }
        u.hostname = newSub + (rest ? ('.' + rest) : '');
        u.protocol = 'https:';
        return u.toString();
      } catch(e){ return urlStr; }
    }
    var input = opts.inputId ? document.getElementById(opts.inputId) : null;
    var openA = opts.openId ? document.getElementById(opts.openId) : null;
    var hint = opts.hintId ? document.getElementById(opts.hintId) : null;
    try {
      var r = await fetch('/__forwarded', { cache: 'no-store' });
      var info = r.ok ? await r.json() : null;
      var best = fallUrl;
      if (info && info.url) {
        var isLocal = /localhost|127\.0\.0\.1/.test(info.url);
        var pageIsRemote = !/localhost|127\.0\.0\.1/.test(window.location.host);
        if (!isLocal || !pageIsRemote) best = info.url;
      }
      best = normalizeForwardedUrl(best);
      if (input) { input.value = best; if(opts.focus) input.focus(); if(opts.select) { input.select(); } }
      if (openA) { openA.href = best; }
      var isForwarded = /app\.github\.dev|githubpreview\.dev|gitpod\.io|codespaces|gitpod/.test(best);
      if (hint) {
        if (isForwarded) {
          var extra = '';
          try { var u = new URL(best); if (/app\.github\.dev$/.test(u.hostname)) extra = ' If others see 404/403, make port 8000 Public.'; } catch(e) {}
          hint.textContent = 'Forwarded URL detected.' + extra;
        } else {
          hint.textContent = 'If in Codespaces/Gitpod share the forwarded URL.';
        }
      }
      return best;
    } catch(e){
      if(input){ input.value = fallUrl; if(opts.focus) input.focus(); if(opts.select) input.select(); }
      if(openA) openA.href = fallUrl;
      if(hint) hint.textContent = 'If in Codespaces/Gitpod share the forwarded URL.';
      return fallUrl;
    }
  }
  window.fetchShareUrl = fetchShareUrl;

  // Admin data loader for account embedded view
  async function loadAdminData(usersId, errorsId, spinnerId){
    var spinner = spinnerId ? document.getElementById(spinnerId) : null;
    try {
      if (spinner) spinner.style.display = 'inline-block';
      var resp = await fetch('/__admin-data', { cache: 'no-store' });
      var data = resp.ok ? await resp.json() : { users: [], errors: [] };
      var usersUl = document.getElementById(usersId); var errsUl = document.getElementById(errorsId);
      if (usersUl) {
        var users = Array.isArray(data.users) ? data.users : [];
        usersUl.innerHTML = users.length ? users.map(function(u){
          var last = new Date(u.lastSeen || Date.now()).toLocaleString();
          var ua = (u.ua || '').replace(/</g,'&lt;');
          return '<li>'+
            '<div class="admin-user-id">'+ (u.id||'(unknown)') +'</div>'+
            '<div class="admin-meta">seen: '+ last + ' · count: '+ (u.count||1) +'</div>'+
            (ua?('<div class="admin-meta">ua: '+ ua +'</div>'):'')+
          '</li>';
        }).join('') : '<li class="admin-meta">No users logged yet.</li>';
      }
      if (errsUl) {
        var errs = Array.isArray(data.errors) ? data.errors : [];
        errsUl.innerHTML = errs.length ? errs.map(function(e){
          var ts = new Date(e.ts || Date.now()).toLocaleString();
          var msg = (e.message||'').replace(/</g,'&lt;');
          var stack = (e.stack||'').replace(/</g,'&lt;');
          var uid = (e.userId || '');
          return '<li>'+
            '<div class="admin-meta">'+ ts + (uid?(' · user: '+uid):'') +'</div>'+
            '<div class="admin-error"><strong>'+ msg +'</strong>' + (stack?('<br>'+ stack):'') + '</div>'+
          '</li>';
        }).join('') : '<li class="admin-meta">No errors logged.</li>';
      }
    } catch(e){ console.warn('loadAdminData failed', e); }
    finally { if (spinner) spinner.style.display = 'none'; }
  }
  window.loadAdminData = loadAdminData;
})();
