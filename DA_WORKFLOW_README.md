# Development Application (DA) Approval Workflow System

## Overview

The DA Approval Workflow System is a comprehensive, step-by-step guide integrated into Gablok's admin panel. It helps users navigate the entire Development Application process for building approval in Australia.

## Key Features

### 🎯 **7 Major Stages (A-G)**

1. **Stage A: Research & Prepare Concept** (7-14 days)
   - Understand planning controls (LEP/DCP)
   - Determine approval pathway (DA vs CDC)
   - Get Section 10.7 Planning Certificate
   - Consult with professionals

2. **Stage B: Engage Team & Prepare Documentation** (30-90 days)
   - Engage architect/building designer
   - Create architectural plans
   - Prepare Statement of Environmental Effects (SEE)
   - Obtain BASIX Certificate
   - Commission specialist reports

3. **Stage C: Lodge Development Application** (1-3 days)
   - Complete DA application form
   - Compile document package
   - Calculate and pay DA fees
   - Submit application

4. **Stage D: Assessment & Notification** (14-40 days)
   - Completeness check
   - Public notification (if required)
   - Council assessment
   - Respond to Requests for Information (RFI)

5. **Stage E: Determination (Decision)** (1-7 days)
   - Receive Notice of Determination
   - Review conditions of consent
   - Pay development contributions
   - Handle refusal options (if applicable)

6. **Stage F: Construction Certificate & Certifier** (14-30 days)
   - Choose Principal Certifier (PCA)
   - Prepare construction plans
   - Lodge CC application
   - Pay remaining contributions

7. **Stage G: Construction & Occupation** (180-365+ days)
   - Give notice of commencement
   - Stage inspections during construction
   - Obtain compliance certificates
   - Apply for Occupation Certificate

### ✨ **Smart Features**

#### Auto-Save Progress
- All progress saved to localStorage automatically
- Resume exactly where you left off
- Per-project workflow state tracking

#### Comprehensive Checklists
- Every step includes detailed action items
- Check off tasks as you complete them
- Visual progress indicators

#### Document Tracking
- Track all required documents per step
- Upload and mark documents as complete
- Document status indicators

#### Contact Management
- Add and manage all professional contacts
- Store details: name, company, phone, email, license
- Quick access to contact information

#### Secure Link Sharing
- Generate secure links for professionals
- Share project access with:
  - Town planners
  - Builders
  - Soil testers
  - Architects
  - Engineers
  - Council officials
- Links expire after 90 days
- Permission-based access control

#### Notes & Tips
- Add personal notes to each step
- Professional tips and advice included
- Useful links and resources

#### Progress Visualization
- Overall workflow progress percentage
- Per-stage progress indicators
- Completed steps badge system

## How to Use

### Accessing the DA Workflow

1. **Open Admin Panel**
   - Click the account icon in the top-right corner
   - Navigate to "Projects" tab

2. **Select a Project**
   - Click the **"🏗️ DA Approval"** button on any project card
   - The workflow opens in fullscreen mode

### Navigating the Interface

#### Sidebar (Left)
- **Progress Overview**: Shows overall completion percentage
- **Stage List**: All 7 stages with mini progress bars
- **Click any stage** to jump to it

#### Main Content Area
- **Breadcrumb**: Shows current location (Stage > Step)
- **Step Content**: 
  - Title and description
  - Checklist items
  - Required documents
  - Key contacts
  - Tips & advice
  - Useful links
  - Notes area

#### Navigation
- **Previous** button: Go to previous step
- **Next** button: Go to next step
- **Mark Complete** button: Mark current step as done

### Working Through Steps

1. **Read the Step Details**
   - Understand what's required
   - Check estimated timeframes
   - Review professional tips

2. **Complete Checklist Items**
   - Click each checkbox as you complete tasks
   - Items turn green when checked

3. **Add Contacts**
   - Click **"+ Add"** next to required professionals
   - Enter: Name, Company, Phone, Email, License Number
   - Click **"✎ Edit"** to update existing contacts
   - Click **"🔗 Share"** to generate secure access link

4. **Upload Documents**
   - Click **"↑ Upload"** next to required documents
   - Track upload status and dates

5. **Add Notes**
   - Use the notes area for reminders
   - Record important information
   - Track decisions and changes

6. **Mark Step Complete**
   - Click **"Mark Complete"** when all tasks done
   - Button turns green with checkmark
   - Progress updates automatically

7. **Move to Next Step**
   - Click **"Next →"** to proceed
   - Or use sidebar to jump to any stage

## Technical Details

### File Structure

```
js/ui/
├── da-workflow.js      # Core workflow data and state management
├── da-ui.js            # User interface rendering and interactions
└── visualize-photoreal.js  # Project integration

css/
└── styles.css          # DA workflow styling (appended at end)
```

### Data Storage

#### LocalStorage Keys
- `gablok_da_workflow_<projectId>` - Workflow state per project
- `gablok_projects_<userId>` - User's projects list

#### State Structure
```javascript
{
  currentStage: 'stage1',     // Current active stage
  currentStep: 'a1',          // Current active step
  completedSteps: ['a1', 'a2'],  // Array of completed step IDs
  documents: {                // Document tracking
    'BASIX Certificate': {
      status: 'complete',
      uploadedAt: 1234567890,
      fileName: 'basix.pdf'
    }
  },
  contacts: {                 // Contact management
    'Architect': {
      name: 'John Smith',
      company: 'Smith Design',
      phone: '0400 123 456',
      email: 'john@smithdesign.com.au',
      license: 'AR123456'
    }
  },
  notes: {                    // Notes per step
    'a1': 'Council website: councilname.nsw.gov.au/planning'
  },
  checklist: {                // Checklist item tracking
    'a1': [0, 2, 3]          // Indices of checked items
  },
  sharedLinks: {              // Secure sharing
    'link_abc123': {
      role: 'Architect',
      permissions: ['view', 'comment'],
      createdAt: 1234567890,
      expiresAt: 1242343890,
      accessed: 5
    }
  },
  lastUpdated: 1234567890,
  createdAt: 1234567890
}
```

### API Functions

#### Window.DAWorkflow
```javascript
// Get workflow state for project
var state = window.DAWorkflow.getWorkflowState(projectId);

// Save workflow state
window.DAWorkflow.saveWorkflowState(projectId, state);

// Mark step complete
window.DAWorkflow.markStepComplete(projectId, stepId);

// Check if step complete
var isComplete = window.DAWorkflow.isStepComplete(projectId, stepId);

// Add contact
window.DAWorkflow.addContact(projectId, role, {
  name: 'John Smith',
  company: 'Smith Design',
  phone: '0400 123 456',
  email: 'john@smithdesign.com.au'
});

// Generate share link
var link = window.DAWorkflow.generateShareLink(projectId, role, ['view']);

// Mark document complete
window.DAWorkflow.markDocumentComplete(projectId, docName, {
  size: 123456,
  fileName: 'document.pdf'
});
```

#### Window.DAWorkflowUI
```javascript
// Open workflow for project
window.DAWorkflowUI.open(projectId);

// Close workflow
window.DAWorkflowUI.close();

// Navigate
window.DAWorkflowUI.nextStep();
window.DAWorkflowUI.previousStep();
window.DAWorkflowUI.goToStage(stageId);

// Actions
window.DAWorkflowUI.toggleStepComplete(stepId);
window.DAWorkflowUI.addEditContact(role);
window.DAWorkflowUI.uploadDocument(docName);
window.DAWorkflowUI.shareWithContact(role);
```

## Workflow Content

### Total Steps: 42
- Stage A: 4 steps
- Stage B: 8 steps  
- Stage C: 4 steps
- Stage D: 5 steps
- Stage E: 5 steps
- Stage F: 6 steps
- Stage G: 8 steps
- Final step: 2 steps

### Key Documents (Total: 40+)
- Planning certificates and permits
- Architectural plans (7 types)
- Engineering reports (3 types)
- Environmental assessments
- Specialist reports (7 types)
- Compliance certificates (6 types)
- Application forms and consents

### Key Professionals (Total: 30+)
- Council officers (4 roles)
- Design professionals (4 roles)
- Engineers (4 roles)
- Consultants (9 roles)
- Builders and tradespeople (6 roles)
- Certifiers and inspectors (3 roles)

## Estimated Costs

Based on typical residential projects in NSW/Australia:

| Stage | Estimated Cost | Timeframe |
|-------|---------------|-----------|
| A: Research | $500 - $2,000 | 1-2 weeks |
| B: Documentation | $15,000 - $80,000 | 1-3 months |
| C: Lodgement | $1,000 - $10,000 | 1-3 days |
| D: Assessment | $0 - $5,000 | 2-6 weeks |
| E: Determination | $5,000 - $50,000 | 1 week |
| F: CC & Certifier | $3,000 - $15,000 | 2-4 weeks |
| G: Construction | $200,000 - $2,000,000+ | 6-12+ months |
| **TOTAL** | **$225,000 - $2,162,000+** | **8-18+ months** |

*Costs vary significantly based on project size, complexity, and location.*

## Responsive Design

The interface adapts to different screen sizes:

- **Desktop (>1024px)**: Full sidebar + main content
- **Tablet (768-1024px)**: Narrower sidebar, optimized spacing
- **Mobile (<768px)**: Sidebar hidden, streamlined vertical layout

## Future Enhancements

### Planned Features
1. **File Upload System**
   - Direct document uploads
   - Cloud storage integration
   - File preview and versioning

2. **Calendar Integration**
   - Deadline tracking
   - Milestone notifications
   - Automated reminders

3. **Cost Tracking**
   - Budget vs actual expenses
   - Invoice management
   - Payment scheduling

4. **Collaboration Tools**
   - Real-time chat with professionals
   - Comment threads on documents
   - Activity timeline

5. **Council Integration**
   - Direct DA submission to council portals
   - Status tracking via council APIs
   - Automated form filling

6. **Template Library**
   - Pre-filled forms
   - Sample documents
   - Boilerplate text

7. **AI Assistant**
   - Planning rule interpretation
   - Document review
   - Compliance checking

## Support

### Resources
- NSW Planning Portal: https://www.planningportal.nsw.gov.au/
- BASIX: https://www.basix.nsw.gov.au/
- Building & Construction: https://www.longservice.nsw.gov.au/

### Getting Help
- Professional town planning consultants recommended for complex projects
- Council duty planners available for preliminary advice
- Legal advice may be required for appeals or complex matters

## License

This workflow system is part of the Gablok platform.  
© 2024 Gablok. All rights reserved.

---

**Last Updated**: December 2024  
**Version**: 1.0.0  
**Author**: Gablok Development Team
