/**
 * @file da-ui.js
 * @description User Interface for DA Workflow System
 * 
 * Renders full-screen step-by-step interface for Development Application process
 */

(function() {
  'use strict';
  
  if (window.__daUIInit) return;
  window.__daUIInit = true;

  var currentProjectId = null;
  var currentState = null;

  // ============================================================================
  // OPEN WORKFLOW INTERFACE
  // ============================================================================
  
  /**
   * Open DA workflow in fullscreen mode for a project
   */
  function openDAWorkflow(projectId) {
    currentProjectId = projectId;
    currentState = window.DAWorkflow.getWorkflowState(projectId);
    
    // Create fullscreen overlay
    var overlay = document.createElement('div');
    overlay.id = 'da-workflow-overlay';
    overlay.className = 'da-workflow-fullscreen';
    overlay.setAttribute('data-theme', 'light'); // Apple theme attribute
    
    overlay.innerHTML = `
      <div class="da-workflow-container">
        <!-- Modern Header -->
        <div class="da-workflow-header">
          <div class="da-header-content">
            <div class="da-header-left">
              <div class="da-header-icon-wrapper">
                <svg class="da-header-icon" width="32" height="32" viewBox="0 0 32 32">
                  <use xlink:href="/css/sf-symbols.svg#sf-building-2" />
                </svg>
                <div class="da-header-text">
                  <h1>Building Workflow</h1>
                  <p class="da-subtitle">Step-by-step guidance from planning to occupation</p>
                </div>
              </div>
            </div>
            <div class="da-header-right">
              <button class="da-btn-mode" onclick="window.DAWorkflowUI.toggleDarkMode()" title="Toggle Dark Mode">
                <svg class="dark-mode-icon" width="20" height="20" viewBox="0 0 20 20">
                  <use class="dark-mode-symbol" xlink:href="/css/sf-symbols.svg#sf-moon" />
                </svg>
                <span class="dark-mode-label">Dark View</span>
              </button>
              <button class="da-btn-icon" onclick="window.DAWorkflowUI.showHelp()" title="Help">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="da-icon-svg">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M10 14v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <path d="M10 11c0-1.5 2-1.5 2-3 0-1.1-.9-2-2-2s-2 .9-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
              <button class="da-btn-close" onclick="window.DAWorkflowUI.close()">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="da-icon-svg">
                  <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        
        <!-- Main Content -->
        <div class="da-workflow-body">
          <!-- Compact Sidebar: Stage Progress -->
          <div class="da-sidebar">
            <div class="da-sidebar-header">
              <h3>Overall Progress</h3>
              <div class="da-overall-progress">
                <div class="da-progress-ring">
                  <svg width="80" height="80">
                    <defs>
                      <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#007aff;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#5e5ce6;stop-opacity:1" />
                      </linearGradient>
                    </defs>
                    <circle cx="40" cy="40" r="34" class="da-progress-ring-bg" stroke-width="6"></circle>
                    <circle cx="40" cy="40" r="34" class="da-progress-ring-fill" id="da-progress-ring" stroke-width="6"></circle>
                  </svg>
                  <span class="da-progress-percent" id="da-overall-progress-text">0%</span>
                </div>
              </div>
            </div>
            <div class="da-stages-list" id="da-stages-list">
              <!-- Populated dynamically -->
            </div>
            
            <!-- Quick Actions -->
            <div class="da-quick-actions">
              <button class="da-quick-btn" onclick="window.DAWorkflowUI.showContacts()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="da-quick-icon-svg">
                  <circle cx="12" cy="8" r="3" stroke="currentColor" stroke-width="2"/>
                  <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span class="da-quick-label">Contacts</span>
              </button>
              <button class="da-quick-btn" onclick="window.DAWorkflowUI.showDocuments()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="da-quick-icon-svg">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span class="da-quick-label">Documents</span>
              </button>
            </div>
          </div>
          
          <!-- Centered Main Content Area -->
          <div class="da-main-content">
            <!-- Current Step Header -->
            <div class="da-step-header-card" id="da-step-header">
              <!-- Populated dynamically -->
            </div>
            
            <!-- Next Steps Preview -->
            <div class="da-next-steps-preview" id="da-next-steps-preview">
              <!-- Populated dynamically -->
            </div>
            
            <!-- Step Content -->
            <div class="da-step-content" id="da-step-content">
              <!-- Populated dynamically -->
            </div>
            
            <!-- Navigation -->
            <div class="da-navigation">
              <button class="da-nav-btn da-nav-prev" id="da-prev-btn" onclick="window.DAWorkflowUI.previousStep()">
                <span class="da-nav-icon">←</span>
                <span class="da-nav-label">Previous</span>
              </button>
              <div class="da-step-indicator" id="da-step-indicator">
                <!-- Step dots -->
              </div>
              <button class="da-nav-btn da-nav-next" id="da-next-btn" onclick="window.DAWorkflowUI.nextStep()">
                <span class="da-nav-label">Next</span>
                <span class="da-nav-icon">→</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Load dark mode preference
    loadDarkModePreference();
    
    // Render initial state
    renderStagesList();
    renderCurrentStep();
    updateProgress();
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }
  
  /**
   * Close DA workflow interface and return to admin section
   */
  function closeDAWorkflow() {
    var overlay = document.getElementById('da-workflow-overlay');
    if (overlay) {
      overlay.remove();
    }
    document.body.style.overflow = '';
    currentProjectId = null;
    currentState = null;
    
    // Open admin section to return to projects
    if (window.toggleAccountModal) {
      window.toggleAccountModal();
    }
  }

  // ============================================================================
  // RENDER FUNCTIONS
  // ============================================================================
  
  /**
   * Render stages sidebar
   */
  function renderStagesList() {
    var container = document.getElementById('da-stages-list');
    if (!container) return;
    
    var html = '';
    window.DAWorkflow.workflow.stages.forEach(function(stage, idx) {
      var stageProgress = calculateStageProgress(stage.id);
      var isActive = stage.id === currentState.currentStage;
      var isComplete = stageProgress === 100;
      
      html += `
        <div class="da-stage-item ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}" 
             onclick="window.DAWorkflowUI.goToStage('${stage.id}')">
          <div class="da-stage-icon">${stage.icon}</div>
          <div class="da-stage-info">
            <div class="da-stage-code">${stage.code}</div>
            <div class="da-stage-title">${stage.title}</div>
            <div class="da-stage-progress-mini">
              <div class="da-progress-bar-mini">
                <div class="da-progress-fill-mini" style="width: ${stageProgress}%"></div>
              </div>
              <span>${stageProgress}%</span>
            </div>
          </div>
          ${isComplete ? '<div class="da-complete-badge"><svg width="16" height="16" viewBox="0 0 16 16"><use xlink:href="/css/sf-symbols.svg#sf-checkmark-circle" /></svg></div>' : ''}
        </div>
      `;
    });
    
    container.innerHTML = html;
  }
  
  /**
   * Render current step content
   */
  function renderCurrentStep() {
    var container = document.getElementById('da-step-content');
    var headerCard = document.getElementById('da-step-header');
    var nextStepsPreview = document.getElementById('da-next-steps-preview');
    
    if (!container) return;
    
    var stage = findStage(currentState.currentStage);
    var step = findStep(currentState.currentStage, currentState.currentStep);
    
    if (!stage || !step) {
      container.innerHTML = '<p>Step not found</p>';
      return;
    }
    
    var isComplete = window.DAWorkflow.isStepComplete(currentProjectId, step.id);
    
    // Render step header card
    if (headerCard) {
      var stepIndex = stage.steps.findIndex(function(s) { return s.id === step.id; }) + 1;
      var stepCode = stage.code + stepIndex;
      headerCard.innerHTML = `
        <div class="da-step-badge-graphic">${stepCode}</div>
        <div class="da-step-header-content">
          <div class="da-step-stage-label">Stage ${stage.code} • Step ${stepIndex} of ${stage.steps.length}</div>
          <h2 class="da-step-title">${step.title}</h2>
          <p class="da-step-description">${step.description}</p>
          <div class="da-step-actions">
            <button class="da-btn-complete ${isComplete ? 'completed' : ''}" 
                    onclick="window.DAWorkflowUI.toggleStepComplete('${step.id}')">
              <svg class="complete-icon" width="18" height="18" viewBox="0 0 18 18">
                <use href="#${isComplete ? 'sf-checkmark-circle' : 'sf-circle'}" />
              </svg>
              <span>${isComplete ? 'Completed' : 'Mark Complete'}</span>
            </button>
            ${stage.estimatedDays ? '<span class="da-time-estimate"><svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align: middle; margin-right: 4px;"><use href="#sf-clock" /></svg>' + stage.estimatedDays + '</span>' : ''}
          </div>
        </div>
      `;
    }
    
    // Render next steps preview
    renderNextStepsPreview(nextStepsPreview, stage, step);
    
    // Main content with modern card layout
    var html = `
      <!-- Checklist Card -->
      <div class="da-card da-checklist-card">
        <div class="da-card-header">
          <h3><svg class="da-icon" width="20" height="20" viewBox="0 0 24 24"><use href="#sf-checkmark-circle" /></svg> Action Items</h3>
          <span class="da-card-badge">${getChecklistProgress(step)} of ${step.checklist.length}</span>
        </div>
        <div class="da-card-body">
          ${renderChecklist(step)}
        </div>
      </div>
      
      <!-- Required Documents Card -->
      ${step.documents.length > 0 ? `
        <div class="da-card da-documents-card">
          <div class="da-card-header">
            <h3><svg class="da-icon" width="20" height="20" viewBox="0 0 24 24"><use href="#sf-folder" /></svg> Required Documents</h3>
            <span class="da-card-badge">${getDocumentsProgress(step)} of ${step.documents.length}</span>
          </div>
          <div class="da-card-body">
            ${renderDocuments(step)}
          </div>
        </div>
      ` : ''}
      
      <!-- Key Contacts Card -->
      ${step.contacts.length > 0 ? `
        <div class="da-card da-contacts-card">
          <div class="da-card-header">
            <h3><svg class="da-icon" width="20" height="20" viewBox="0 0 24 24"><use href="#sf-person-2" /></svg> Key Contacts</h3>
            <span class="da-card-badge">${getContactsProgress(step)} of ${step.contacts.length}</span>
          </div>
          <div class="da-card-body">
            ${renderContacts(step)}
          </div>
        </div>
      ` : ''}
      
      <!-- Tips & Resources -->
      <div class="da-info-section">
        ${step.tips ? `
          <div class="da-tip-card">
            <div class="da-tip-icon">💡</div>
            <div class="da-tip-content">
              <strong>Pro Tip</strong>
              <p>${step.tips}</p>
            </div>
          </div>
        ` : ''}
        
        ${step.links && step.links.length > 0 ? `
          <div class="da-links-card">
            <h4>🔗 Helpful Resources</h4>
            ${step.links.map(function(link) {
              return '<a href="' + link + '" target="_blank" class="da-resource-link">' + getDomainName(link) + ' →</a>';
            }).join('')}
          </div>
        ` : ''}
      </div>
      
      <!-- Notes Card -->
      <div class="da-card da-notes-card">
        <div class="da-card-header">
          <h3><span class="da-icon">📝</span> Your Notes</h3>
        </div>
        <div class="da-card-body">
          <textarea class="da-notes-input" 
                    placeholder="Add notes, reminders, or important information for this step..."
                    onchange="window.DAWorkflowUI.saveNote('${step.id}', this.value)">${getNoteForStep(step.id)}</textarea>
        </div>
      </div>
    `;
    
    container.innerHTML = html;
    updateStepIndicator();
  }
  
  /**
   * Render next steps preview
   */
  function renderNextStepsPreview(container, currentStage, currentStep) {
    if (!container) return;
    
    var allSteps = getAllStepsInStage(currentStage);
    var currentIndex = allSteps.findIndex(function(s) { return s.id === currentStep.id; });
    var nextSteps = allSteps.slice(currentIndex + 1, currentIndex + 4); // Show next 3 steps
    
    if (nextSteps.length === 0) {
      // Check next stage
      var stages = window.DAWorkflow.getWorkflow().stages;
      var stageIndex = stages.findIndex(function(s) { return s.id === currentStage.id; });
      if (stageIndex < stages.length - 1) {
        var nextStage = stages[stageIndex + 1];
        nextSteps = nextStage.steps.slice(0, 3);
        
        container.innerHTML = `
          <div class="da-next-stage-banner">
            <div class="da-next-stage-label">Up Next</div>
            <div class="da-next-stage-title">${nextStage.icon} ${nextStage.title}</div>
            <div class="da-next-stage-steps">
              ${nextSteps.map(function(s) { 
                return '<div class="da-next-step-mini">' + s.title + '</div>'; 
              }).join('')}
            </div>
          </div>
        `;
      } else {
        container.innerHTML = '<div class="da-completion-banner">🎉 Final stage! Almost done!</div>';
      }
      return;
    }
    
    container.innerHTML = `
      <div class="da-next-steps-container">
        <div class="da-next-steps-label">Coming Up</div>
        <div class="da-next-steps-list">
          ${nextSteps.map(function(s, idx) {
            return `
              <div class="da-next-step">
                <span class="da-next-step-number">${idx + 1}</span>
                <span class="da-next-step-title">${s.title}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  
  /**
   * Get all steps in a stage
   */
  function getAllStepsInStage(stage) {
    return stage.steps || [];
  }
  
  /**
   * Get checklist progress count
   */
  function getChecklistProgress(step) {
    if (!step.checklist) return 0;
    var count = 0;
    step.checklist.forEach(function(item, idx) {
      if (isChecklistItemChecked(step.id, idx)) count++;
    });
    return count;
  }
  
  /**
   * Get documents progress count
   */
  function getDocumentsProgress(step) {
    if (!step.documents) return 0;
    var count = 0;
    step.documents.forEach(function(doc) {
      var state = getDocumentState(doc);
      if (state && state.status === 'complete') count++;
    });
    return count;
  }
  
  /**
   * Get contacts progress count
   */
  function getContactsProgress(step) {
    if (!step.contacts) return 0;
    var count = 0;
    step.contacts.forEach(function(role) {
      var contact = getContactByRole(role);
      if (contact && contact.name) count++;
    });
    return count;
  }
  
  /**
   * Get domain name from URL
   */
  function getDomainName(url) {
    try {
      var hostname = new URL(url).hostname;
      return hostname.replace('www.', '');
    } catch (e) {
      return url;
    }
  }
  
  /**
   * Update step indicator dots
   */
  function updateStepIndicator() {
    var container = document.getElementById('da-step-indicator');
    if (!container) return;
    
    var stage = findStage(currentState.currentStage);
    if (!stage) return;
    
    var steps = stage.steps || [];
    var currentIndex = steps.findIndex(function(s) { return s.id === currentState.currentStep; });
    
    container.innerHTML = steps.map(function(s, idx) {
      var isComplete = window.DAWorkflow.isStepComplete(currentProjectId, s.id);
      var isCurrent = idx === currentIndex;
      return '<span class="da-step-dot ' + 
             (isCurrent ? 'current' : '') + ' ' + 
             (isComplete ? 'complete' : '') + 
             '"></span>';
    }).join('');
  }
  
  /**
   * Render checklist items
   */
  function renderChecklist(step) {
    if (!step.checklist || step.checklist.length === 0) {
      return '<p class="da-empty">No checklist items</p>';
    }
    
    return step.checklist.map(function(item, idx) {
      var checkId = step.id + '_check_' + idx;
      var isChecked = isChecklistItemChecked(step.id, idx);
      
      return `
        <label class="da-checklist-item ${isChecked ? 'checked' : ''}">
          <input type="checkbox" 
                 ${isChecked ? 'checked' : ''}
                 onchange="window.DAWorkflowUI.toggleChecklistItem('${step.id}', ${idx})">
          <span>${item}</span>
        </label>
      `;
    }).join('');
  }
  
  /**
   * Render documents list
   */
  function renderDocuments(step) {
    return step.documents.map(function(doc) {
      var docState = getDocumentState(doc);
      var isComplete = docState && docState.status === 'complete';
      
      return `
        <div class="da-document-item ${isComplete ? 'complete' : ''}">
          <svg class="da-doc-icon" width="24" height="24" viewBox="0 0 24 24">
            <use xlink:href="/css/sf-symbols.svg#${isComplete ? 'sf-checkmark-circle' : 'sf-doc-text'}" />
          </svg>
          <div class="da-doc-info">
            <div class="da-doc-name">${doc}</div>
            ${isComplete ? '<div class="da-doc-status">Uploaded ' + formatDate(docState.uploadedAt) + '</div>' : ''}
          </div>
          <button class="da-btn da-btn-small ${isComplete ? 'da-btn-outline' : 'da-btn-primary'}" 
                  onclick="window.DAWorkflowUI.uploadDocument('${doc}')">
            ${isComplete ? '<svg width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><use xlink:href="/css/sf-symbols.svg#sf-arrow-down-doc" /></svg> Replace' : '<svg width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><use xlink:href="/css/sf-symbols.svg#sf-arrow-down-doc" /></svg> Upload'}
          </button>
        </div>
      `;
    }).join('');
  }
  
  /**
   * Render contacts list
   */
  function renderContacts(step) {
    return step.contacts.map(function(role) {
      var contact = getContactByRole(role);
      var hasContact = contact && contact.name;
      
      return `
        <div class="da-contact-item ${hasContact ? 'complete' : ''}">
          <svg class="da-contact-icon" width="24" height="24" viewBox="0 0 24 24">
            <use xlink:href="/css/sf-symbols.svg#${hasContact ? 'sf-checkmark-circle' : 'sf-person'}" />
          </svg>
          <div class="da-contact-info">
            <div class="da-contact-role">${role}</div>
            ${hasContact ? `
              <div class="da-contact-details">
                <div><strong>${contact.name}</strong> ${contact.company ? '- ' + contact.company : ''}</div>
                ${contact.phone ? '<div><svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align: middle;"><use xlink:href="/css/sf-symbols.svg#sf-phone" /></svg> ' + contact.phone + '</div>' : ''}
                ${contact.email ? '<div><svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align: middle;"><use xlink:href="/css/sf-symbols.svg#sf-envelope" /></svg> ' + contact.email + '</div>' : ''}
              </div>
            ` : '<div class="da-contact-placeholder">Not added yet</div>'}
          </div>
          <div class="da-contact-actions">
            <button class="da-btn da-btn-small da-btn-outline" 
                    onclick="window.DAWorkflowUI.addEditContact('${role}')">
              ${hasContact ? '<svg width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><use xlink:href="/css/sf-symbols.svg#sf-pencil" /></svg> Edit' : '<svg width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><use xlink:href="/css/sf-symbols.svg#sf-plus" /></svg> Add'}
            </button>
            ${hasContact ? `
              <button class="da-btn da-btn-small da-btn-secondary" 
                      onclick="window.DAWorkflowUI.shareWithContact('${role}')">
                🔗 Share
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
  
  /**
   * Update breadcrumb navigation
   */
  function updateBreadcrumb(stage, step) {
    var container = document.getElementById('da-breadcrumb');
    if (!container) return;
    
    container.innerHTML = `
      <span class="da-breadcrumb-item">${stage.code}. ${stage.title}</span>
      <span class="da-breadcrumb-separator">›</span>
      <span class="da-breadcrumb-item active">${stage.code}${step.id.substring(1)} - ${step.title}</span>
    `;
  }
  
  /**
   * Update overall progress
   */
  function updateProgress() {
    var totalSteps = 0;
    var completedSteps = 0;
    
    window.DAWorkflow.workflow.stages.forEach(function(stage) {
      stage.steps.forEach(function(step) {
        totalSteps++;
        if (window.DAWorkflow.isStepComplete(currentProjectId, step.id)) {
          completedSteps++;
        }
      });
    });
    
    var percentage = Math.round((completedSteps / totalSteps) * 100);
    
    var fill = document.getElementById('da-overall-progress-fill');
    var text = document.getElementById('da-overall-progress-text');
    
    if (fill) fill.style.width = percentage + '%';
    if (text) text.textContent = percentage + '%';
  }

  // ============================================================================
  // NAVIGATION
  // ============================================================================
  
  /**
   * Go to next step
   */
  function nextStep() {
    var stage = findStage(currentState.currentStage);
    var currentStepIdx = stage.steps.findIndex(function(s) { return s.id === currentState.currentStep; });
    
    // Next step in current stage
    if (currentStepIdx < stage.steps.length - 1) {
      currentState.currentStep = stage.steps[currentStepIdx + 1].id;
    } else {
      // Next stage
      var stageIdx = window.DAWorkflow.workflow.stages.findIndex(function(s) { return s.id === stage.id; });
      if (stageIdx < window.DAWorkflow.workflow.stages.length - 1) {
        var nextStage = window.DAWorkflow.workflow.stages[stageIdx + 1];
        currentState.currentStage = nextStage.id;
        currentState.currentStep = nextStage.steps[0].id;
      }
    }
    
    window.DAWorkflow.saveWorkflowState(currentProjectId, currentState);
    renderStagesList();
    renderCurrentStep();
    updateProgress();
  }
  
  /**
   * Go to previous step
   */
  function previousStep() {
    var stage = findStage(currentState.currentStage);
    var currentStepIdx = stage.steps.findIndex(function(s) { return s.id === currentState.currentStep; });
    
    // Previous step in current stage
    if (currentStepIdx > 0) {
      currentState.currentStep = stage.steps[currentStepIdx - 1].id;
    } else {
      // Previous stage
      var stageIdx = window.DAWorkflow.workflow.stages.findIndex(function(s) { return s.id === stage.id; });
      if (stageIdx > 0) {
        var prevStage = window.DAWorkflow.workflow.stages[stageIdx - 1];
        currentState.currentStage = prevStage.id;
        currentState.currentStep = prevStage.steps[prevStage.steps.length - 1].id;
      }
    }
    
    window.DAWorkflow.saveWorkflowState(currentProjectId, currentState);
    renderStagesList();
    renderCurrentStep();
    updateProgress();
  }
  
  /**
   * Go to specific stage
   */
  function goToStage(stageId) {
    var stage = findStage(stageId);
    if (!stage) return;
    
    currentState.currentStage = stageId;
    currentState.currentStep = stage.steps[0].id;
    
    window.DAWorkflow.saveWorkflowState(currentProjectId, currentState);
    renderStagesList();
    renderCurrentStep();
  }

  // ============================================================================
  // ACTIONS
  // ============================================================================
  
  /**
   * Toggle step completion
   */
  function toggleStepComplete(stepId) {
    var isComplete = window.DAWorkflow.isStepComplete(currentProjectId, stepId);
    
    if (isComplete) {
      // Remove from completed
      var idx = currentState.completedSteps.indexOf(stepId);
      if (idx > -1) {
        currentState.completedSteps.splice(idx, 1);
      }
    } else {
      // Add to completed
      window.DAWorkflow.markStepComplete(currentProjectId, stepId);
      currentState = window.DAWorkflow.getWorkflowState(currentProjectId);
    }
    
    renderStagesList();
    renderCurrentStep();
    updateProgress();
  }
  
  /**
   * Toggle checklist item
   */
  function toggleChecklistItem(stepId, itemIdx) {
    if (!currentState.checklist) currentState.checklist = {};
    if (!currentState.checklist[stepId]) currentState.checklist[stepId] = [];
    
    var idx = currentState.checklist[stepId].indexOf(itemIdx);
    if (idx > -1) {
      currentState.checklist[stepId].splice(idx, 1);
    } else {
      currentState.checklist[stepId].push(itemIdx);
    }
    
    window.DAWorkflow.saveWorkflowState(currentProjectId, currentState);
  }
  
  /**
   * Save note for step
   */
  function saveNote(stepId, note) {
    if (!currentState.notes) currentState.notes = {};
    currentState.notes[stepId] = note;
    window.DAWorkflow.saveWorkflowState(currentProjectId, currentState);
  }
  
  /**
   * Upload document (placeholder - implement file upload)
   */
  function uploadDocument(docName) {
    showAppleAlert('Document Upload', 'This would open a file picker to upload ' + docName + '.');
    // TODO: Implement actual file upload
  }
  
  /**
   * Add or edit contact
   */
  function addEditContact(role) {
    var contact = getContactByRole(role) || {};
    
    showAppleContactForm('Edit ' + role, contact, function(data) {
      if (!data) return;
      
      window.DAWorkflow.addContact(currentProjectId, role, data);
      currentState = window.DAWorkflow.getWorkflowState(currentProjectId);
      renderCurrentStep();
    });
  }
  
  /**
   * Share project with contact
   */
  function shareWithContact(role) {
    var link = window.DAWorkflow.generateShareLink(currentProjectId, role, ['view', 'comment']);
    
    showApplePrompt('Share with ' + role, link, function(value) {
      // User can copy the link from the input field
    });
  }
  
  /**
   * Show contacts modal
   */
  function showContacts() {
    showAppleAlert('Contacts Manager', 'This would show all contacts for this project in a modal.');
    // TODO: Implement contacts modal
  }
  
  /**
   * Show documents modal
   */
  function showDocuments() {
    showAppleAlert('Documents Manager', 'This would show all documents for this project in a modal.');
    // TODO: Implement documents modal
  }
  
  /**
   * Show help modal
   */
  function showHelp() {
    showAppleAlert('Complete Building Workflow', 'This step-by-step guide walks you through the entire home building process in Australia - from planning to occupation. Features include 8 major phases, 50+ detailed steps, progress tracking, document management, and contact management. Your progress is automatically saved.');
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================
  
  function findStage(stageId) {
    return window.DAWorkflow.workflow.stages.find(function(s) { return s.id === stageId; });
  }
  
  function findStep(stageId, stepId) {
    var stage = findStage(stageId);
    if (!stage) return null;
    return stage.steps.find(function(s) { return s.id === stepId; });
  }
  
  function calculateStageProgress(stageId) {
    var stage = findStage(stageId);
    if (!stage) return 0;
    
    var total = stage.steps.length;
    var completed = 0;
    
    stage.steps.forEach(function(step) {
      if (window.DAWorkflow.isStepComplete(currentProjectId, step.id)) {
        completed++;
      }
    });
    
    return Math.round((completed / total) * 100);
  }
  
  function isChecklistItemChecked(stepId, itemIdx) {
    if (!currentState.checklist || !currentState.checklist[stepId]) return false;
    return currentState.checklist[stepId].indexOf(itemIdx) > -1;
  }
  
  function getNoteForStep(stepId) {
    if (!currentState.notes) return '';
    return currentState.notes[stepId] || '';
  }
  
  function getDocumentState(docName) {
    if (!currentState.documents) return null;
    return currentState.documents[docName] || null;
  }
  
  function getContactByRole(role) {
    if (!currentState.contacts) return null;
    return currentState.contacts[role] || null;
  }
  
  function formatDate(timestamp) {
    var d = new Date(timestamp);
    return d.toLocaleDateString();
  }
  
  // ============================================================================
  // DARK MODE
  // ============================================================================
  
  function toggleDarkMode() {
    var overlay = document.getElementById('da-workflow-overlay');
    if (!overlay) return;
    
    // Toggle between light and dark themes using data-theme attribute
    var currentTheme = overlay.getAttribute('data-theme') || 'light';
    var newTheme = currentTheme === 'light' ? 'dark' : 'light';
    overlay.setAttribute('data-theme', newTheme);
    
    var isDark = newTheme === 'dark';
    
    // Update icon and label
    var iconSymbol = overlay.querySelector('.dark-mode-symbol');
    var label = overlay.querySelector('.dark-mode-label');
    if (iconSymbol) {
      iconSymbol.setAttribute('xlink:href', '/css/sf-symbols.svg#' + (isDark ? 'sf-sun-max' : 'sf-moon'));
    }
    if (label) {
      label.textContent = isDark ? 'Light View' : 'Dark View';
    }
    
    // Save preference
    try {
      localStorage.setItem('da_theme', newTheme);
    } catch (e) {}
  }
  
  function loadDarkModePreference() {
    try {
      var pref = localStorage.getItem('da_theme') || 'light';
      var overlay = document.getElementById('da-workflow-overlay');
      if (overlay) {
        overlay.setAttribute('data-theme', pref);
        var isDark = pref === 'dark';
        var iconSymbol = overlay.querySelector('.dark-mode-symbol');
        var label = overlay.querySelector('.dark-mode-label');
        if (iconSymbol) iconSymbol.setAttribute('xlink:href', '/css/sf-symbols.svg#' + (isDark ? 'sf-sun-max' : 'sf-moon'));
        if (label) label.textContent = isDark ? 'Light View' : 'Dark View';
      }
    } catch (e) {}
  }

  // ============================================================================
  // EXPORTS
  // ============================================================================
  
  window.DAWorkflowUI = {
    open: openDAWorkflow,
    close: closeDAWorkflow,
    nextStep: nextStep,
    previousStep: previousStep,
    goToStage: goToStage,
    toggleStepComplete: toggleStepComplete,
    toggleChecklistItem: toggleChecklistItem,
    saveNote: saveNote,
    uploadDocument: uploadDocument,
    addEditContact: addEditContact,
    shareWithContact: shareWithContact,
    showContacts: showContacts,
    showDocuments: showDocuments,
    showHelp: showHelp,
    toggleDarkMode: toggleDarkMode
  };
  
  console.log('[DA Workflow UI] Interface ready');
  
})();
