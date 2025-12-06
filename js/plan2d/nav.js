// 2D Floor Plan Navigation Dropdowns
// Handles floor selector, tools menu, and file menu dropdowns

(function() {
  'use strict';

  // Initialize dropdowns when DOM is ready
  function initPlan2DNav() {
    // Floor Dropdown
    initFloorDropdown();
    
    // Tools Dropdown
    initToolsDropdown();
    
    // File Dropdown
    initFileDropdown();
    
    // Wire up compass canvas rendering (matches main nav compass)
    initPlan2DCompass();
  }

  function initFloorDropdown() {
    const dropdown = document.getElementById('plan2d-floor-dropdown');
    const button = document.getElementById('plan2d-floor-button');
    const list = document.getElementById('plan2d-floor-list');
    const text = document.getElementById('plan2d-floor-text');
    
    if (!dropdown || !button || !list) return;
    
    // Toggle dropdown
    button.addEventListener('click', function(e) {
      e.stopPropagation();
      const isOpen = list.classList.contains('show');
      closeAllPlan2DDropdowns();
      if (!isOpen) {
        list.classList.add('show');
      }
    });
    
    // Handle floor selection
    list.addEventListener('click', function(e) {
      const item = e.target.closest('.dropdown-item');
      if (!item) return;
      
      const value = item.dataset.value;
      if (value === 'ground') {
        text.textContent = 'Ground';
        if (typeof window.plan2dSwitchFloorInEditor === 'function') {
          window.plan2dSwitchFloorInEditor(0);
        }
      } else if (value === 'first') {
        text.textContent = 'First';
        if (typeof window.plan2dSwitchFloorInEditor === 'function') {
          window.plan2dSwitchFloorInEditor(1);
        }
      }
      
      list.classList.remove('show');
    });
  }

  function initToolsDropdown() {
    const dropdown = document.getElementById('plan2d-tools-dropdown');
    const button = document.getElementById('plan2d-tools-button');
    const list = document.getElementById('plan2d-tools-list');
    
    if (!dropdown || !button || !list) return;
    
    // Toggle dropdown
    button.addEventListener('click', function(e) {
      e.stopPropagation();
      const isOpen = list.classList.contains('show');
      closeAllPlan2DDropdowns();
      if (!isOpen) {
        list.classList.add('show');
      }
    });
    
    // Handle tool actions
    list.addEventListener('click', function(e) {
      const item = e.target.closest('.dropdown-item');
      if (!item || item.classList.contains('dropdown-title') || item.classList.contains('separator')) return;
      
      const action = item.dataset.action;
      
      switch(action) {
        case 'fit':
          if (window.__plan2d) window.__plan2d.autoFitEnabled = true;
          if (typeof window.plan2dFitViewToContent === 'function') {
            window.plan2dFitViewToContent(40, {force: true});
          }
          break;
        case 'flip-y':
          if (typeof window.plan2dFlipVertical === 'function') {
            window.plan2dFlipVertical();
          }
          break;
        case 'window-standard':
          const winTypeStd = document.getElementById('plan2d-window-type');
          if (winTypeStd) winTypeStd.value = 'standard';
          break;
        case 'window-full':
          const winTypeFull = document.getElementById('plan2d-window-type');
          if (winTypeFull) winTypeFull.value = 'full';
          break;
        case 'door-swing-in':
          const swingIn = document.getElementById('plan2d-door-swing');
          if (swingIn) swingIn.value = 'in';
          break;
        case 'door-swing-out':
          const swingOut = document.getElementById('plan2d-door-swing');
          if (swingOut) swingOut.value = 'out';
          break;
        case 'door-hinge-left':
          const hingeLeft = document.getElementById('plan2d-door-hinge');
          if (hingeLeft) hingeLeft.value = 't0';
          break;
        case 'door-hinge-right':
          const hingeRight = document.getElementById('plan2d-door-hinge');
          if (hingeRight) hingeRight.value = 't1';
          break;
      }
      
      list.classList.remove('show');
    });
  }

  function initFileDropdown() {
    const dropdown = document.getElementById('plan2d-file-dropdown');
    const button = document.getElementById('plan2d-file-button');
    const list = document.getElementById('plan2d-file-list');
    
    if (!dropdown || !button || !list) return;
    
    // Toggle dropdown
    button.addEventListener('click', function(e) {
      e.stopPropagation();
      const isOpen = list.classList.contains('show');
      closeAllPlan2DDropdowns();
      if (!isOpen) {
        list.classList.add('show');
      }
    });
    
    // Handle file actions
    list.addEventListener('click', function(e) {
      const item = e.target.closest('.dropdown-item');
      if (!item || item.classList.contains('dropdown-title') || item.classList.contains('separator')) return;
      
      const action = item.dataset.action;
      
      switch(action) {
        case 'apply-3d':
          if (typeof window.plan2dApplyToDesign === 'function') {
            window.plan2dApplyToDesign();
          }
          break;
        case 'export':
          if (typeof window.plan2dExport === 'function') {
            window.plan2dExport();
          }
          break;
        case 'import':
          const fileInput = document.getElementById('plan2d-import-file');
          if (fileInput) fileInput.click();
          break;
        case 'clear':
          if (typeof window.plan2dClear === 'function') {
            window.plan2dClear();
          }
          break;
      }
      
      list.classList.remove('show');
    });
  }

  function closeAllPlan2DDropdowns() {
    const dropdowns = document.querySelectorAll('#plan2d-controls .dropdown-list');
    dropdowns.forEach(list => list.classList.remove('show'));
  }

  // Close dropdowns when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#plan2d-controls .dropdown')) {
      closeAllPlan2DDropdowns();
    }
  });

  function initPlan2DCompass() {
    const canvas = document.getElementById('plan2d-compass-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const size = 44;
    const center = size / 2;
    const radius = 16;
    
    function drawCompass() {
      ctx.clearRect(0, 0, size, size);
      
      // Background circle
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();
      
      // Border
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // North indicator (triangle)
      ctx.fillStyle = '#007AFF';
      ctx.beginPath();
      ctx.moveTo(center, center - radius + 6);
      ctx.lineTo(center - 5, center - radius + 14);
      ctx.lineTo(center + 5, center - radius + 14);
      ctx.closePath();
      ctx.fill();
      
      // 'N' letter
      ctx.fillStyle = '#666';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', center, center + radius - 8);
    }
    
    drawCompass();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlan2DNav);
  } else {
    initPlan2DNav();
  }
  
  // Export for external use
  window.initPlan2DNav = initPlan2DNav;

})();
