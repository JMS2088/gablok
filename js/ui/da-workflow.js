/**
 * @file da-workflow.js
 * @description Development Application (DA) Approval Workflow System
 * 
 * Comprehensive step-by-step guide for submitting DA to Australian councils
 * for building approval. Designed to be simple enough for anyone to follow.
 * 
 * Features:
 * - 7 major stages with detailed substeps
 * - Auto-save progress to localStorage
 * - Secure link sharing with professionals
 * - Document checklist and tracking
 * - Contact management for all stakeholders
 */

(function() {
  'use strict';
  
  if (window.__daWorkflowInit) return;
  window.__daWorkflowInit = true;

  // ============================================================================
  // DA WORKFLOW STRUCTURE - 7 Major Stages
  // ============================================================================
  
  var DA_WORKFLOW = {
    stages: [
      {
        id: 'stage0',
        code: '0',
        title: 'Planning & Finance (Pre-DA)',
        description: 'Set foundation for your project, budget, and legal right to build',
        estimatedDays: '14-30 days',
        icon: '💰',
        steps: [
          {
            id: 'p1',
            title: 'Vision, Budgeting & Finance Pre-Approval',
            description: 'Secure your financial capacity before purchasing land or drawing plans',
            documents: ['Finance Pre-Approval Letter', 'Budget Spreadsheet'],
            contacts: ['Finance Broker', 'Lender', 'Mortgage Broker'],
            checklist: [
              'Define vision: size, style, location requirements (bedrooms, suburb)',
              'Set detailed budget with 10-15% contingency buffer',
              'Engage finance broker or lender',
              'Discuss construction loans (progress payment structure)',
              'Obtain written finance pre-approval'
            ],
            tips: 'Construction loans release funds in stages (progress payments). Secure pre-approval before committing to land purchase.',
            links: []
          },
          {
            id: 'p2',
            title: 'Provide Finance Documents',
            description: 'Submit required documentation for finance pre-approval',
            documents: [
              'Passport or Driver\'s License',
              'Proof of Income (Payslips, Tax Returns)',
              'Bank Statements (3-6 months)',
              'Summary of Assets and Liabilities'
            ],
            contacts: ['Finance Broker', 'Lender'],
            checklist: [
              'Gather personal identification documents',
              'Collect recent payslips or tax returns',
              'Prepare bank statements (3-6 months)',
              'List all assets (property, savings, super)',
              'List all liabilities (loans, credit cards)',
              'Submit application to lender'
            ],
            tips: 'Having documents ready speeds up approval. Digital copies are usually acceptable.',
            links: []
          },
          {
            id: 'p3',
            title: 'Land Acquisition',
            description: 'Purchase suitable land and engage conveyancer',
            documents: ['Contract of Sale', 'Title Deed', 'Vendor Statement'],
            contacts: ['Real Estate Agent', 'Land Vendor', 'Conveyancer', 'Solicitor'],
            checklist: [
              'Ensure land is zoned for residential building',
              'Check for restrictive covenants or easements',
              'Engage conveyancer/solicitor to review contract',
              'Review title and Section 32/Vendor statement',
              'Complete land purchase settlement'
            ],
            tips: 'Always engage a conveyancer or solicitor to review the contract of sale and title before purchasing.',
            links: []
          },
          {
            id: 'p4',
            title: 'Site Analysis Reports',
            description: 'Commission essential site reports for design and costing',
            documents: [
              'Geotechnical (Soil) Report',
              'Registered Survey Plan',
              'Section 10.7 Planning Certificate'
            ],
            contacts: [
              'Geotechnical Engineer',
              'Soil Testing Company',
              'Registered Land Surveyor',
              'Council Property Information Team'
            ],
            checklist: [
              'Engage geotechnical engineer for soil report',
              'Commission registered survey (boundaries, levels, contours)',
              'Request Section 10.7 Planning Certificate from council',
              'Review all reports for site constraints',
              'Identify significant trees or neighboring buildings'
            ],
            tips: 'Soil report determines foundation type and costs ($800-2000). Survey maps exact boundaries and levels ($600-1500). Planning certificate confirms zoning ($100-200).',
            links: []
          }
        ]
      },
      {
        id: 'stage1',
        code: 'A',
        title: 'Research & Prepare Concept',
        description: 'Understand what you can build on your land',
        estimatedDays: '7-14 days',
        icon: '🔍',
        steps: [
          {
            id: 'a1',
            title: 'Understand Planning Controls',
            description: 'Check your local council\'s LEP and DCP',
            documents: ['Local Environmental Plan (LEP)', 'Development Control Plan (DCP)'],
            contacts: ['Council Duty Planner'],
            checklist: [
              'Review zoning rules for your land',
              'Check height limits and setback requirements',
              'Understand floor space ratio (FSR) limits',
              'Note any heritage or environmental overlays'
            ],
            tips: 'Visit your council\'s website or planning office. Most councils have online planning portals.',
            links: ['https://www.planningportal.nsw.gov.au/', 'Your local council website']
          },
          {
            id: 'a2',
            title: 'Determine Approval Pathway',
            description: 'Check if you need full DA or can use CDC',
            documents: [],
            contacts: ['Council Duty Planner', 'Town Planning Consultant'],
            checklist: [
              'Check if your project qualifies for Complying Development Certificate (CDC)',
              'Understand the difference between CDC and DA',
              'Confirm which pathway applies to your project',
              'Note any exemptions or fast-track options'
            ],
            tips: 'CDC is faster (typically 20 days) but has strict requirements. DA is more flexible but takes longer (40+ days).',
            links: []
          },
          {
            id: 'a3',
            title: 'Get Section 10.7 Planning Certificate',
            description: 'Obtain formal council document about your land',
            documents: ['Section 10.7 Planning Certificate'],
            contacts: ['Council Property Information Team'],
            checklist: [
              'Request Section 10.7 certificate from council',
              'Pay certificate fee (typically $100-200)',
              'Review all planning rules and restrictions',
              'Check for any development contributions'
            ],
            tips: 'This certificate is essential and costs around $100-200. It takes 2-5 days to receive.',
            links: []
          },
          {
            id: 'a4',
            title: 'Consult with Professionals',
            description: 'Get expert advice before proceeding',
            documents: [],
            contacts: ['Town Planning Consultant', 'Architect', 'Building Designer'],
            checklist: [
              'Schedule initial consultation with town planner',
              'Discuss project feasibility and potential issues',
              'Get preliminary cost estimates',
              'Identify any fatal flaws early'
            ],
            tips: 'Spending $500-1500 on early professional advice can save you tens of thousands later.',
            links: []
          }
        ]
      },
      {
        id: 'stage2',
        code: 'B',
        title: 'Engage Team & Prepare Documentation',
        description: 'Hire professionals and create all required plans',
        estimatedDays: '30-90 days',
        icon: '📋',
        steps: [
          {
            id: 'b1',
            title: 'Engage Architect/Building Designer',
            description: 'Hire professional to create detailed plans',
            documents: ['Letter of Engagement', 'Architectural Brief'],
            contacts: ['Architect', 'Building Designer'],
            checklist: [
              'Get quotes from 3+ architects/designers',
              'Check qualifications and previous DA approvals',
              'Sign letter of engagement',
              'Provide detailed project brief',
              'Agree on timeline and fee structure'
            ],
            tips: 'Costs typically range from $5,000-$50,000+ depending on project complexity. Registered architects are required for certain projects.',
            links: []
          },
          {
            id: 'b2',
            title: 'Create Architectural Plans',
            description: 'Develop complete set of architectural drawings',
            documents: [
              'Site Plan (1:100 or 1:200 scale)',
              'Floor Plans - All Levels',
              'Elevations - All Sides',
              'Section Drawings',
              'Shadow Diagrams',
              'Stormwater Plan',
              'Landscape Plan'
            ],
            contacts: ['Architect', 'Surveyor', 'Landscape Architect'],
            checklist: [
              'Site plan showing lot boundaries and existing features',
              'Detailed floor plans of all levels',
              'All four elevations (north, south, east, west)',
              'At least two section drawings',
              'Shadow diagrams (9am, 12pm, 3pm for winter solstice)',
              'Stormwater/drainage details',
              'Landscaping plan with planting schedule'
            ],
            tips: 'Plans must be to scale and include dimensions. Digital PDF format is usually required.',
            links: []
          },
          {
            id: 'b3',
            title: 'Prepare Statement of Environmental Effects (SEE)',
            description: 'Document explaining how your proposal meets planning rules',
            documents: ['Statement of Environmental Effects'],
            contacts: ['Town Planning Consultant', 'Architect'],
            checklist: [
              'Address all relevant planning controls',
              'Explain how design responds to site constraints',
              'Discuss environmental impacts and mitigation',
              'Include photos of existing site and surrounding area',
              'Justify any variations to planning controls'
            ],
            tips: 'The SEE is critical - it\'s your chance to explain why your project should be approved. Town planners often write these.',
            links: []
          },
          {
            id: 'b4',
            title: 'Obtain BASIX Certificate',
            description: 'Energy and water efficiency assessment (NSW)',
            documents: ['BASIX Certificate'],
            contacts: ['BASIX Assessor', 'Architect'],
            checklist: [
              'Engage BASIX accredited assessor',
              'Provide building plans and specifications',
              'Meet required energy/water efficiency targets',
              'Receive BASIX certificate number',
              'Include BASIX commitments in plans'
            ],
            tips: 'BASIX applies to most NSW residential projects. Certificate costs $200-800 and takes 1-2 weeks. Required before DA lodgement.',
            links: ['https://www.basix.nsw.gov.au/']
          },
          {
            id: 'b5',
            title: 'Commission Geotechnical Report',
            description: 'Soil analysis and foundation recommendations',
            documents: ['Geotechnical/Soil Report'],
            contacts: ['Geotechnical Engineer', 'Soil Testing Company'],
            checklist: [
              'Engage geotechnical engineer',
              'Schedule site soil testing',
              'Receive soil classification report',
              'Get foundation design recommendations',
              'Address any contamination or instability issues'
            ],
            tips: 'Costs $1,500-$5,000. Essential for sites with reactive clay, slope, or fill. Council may require this for all developments.',
            links: []
          },
          {
            id: 'b6',
            title: 'Prepare Engineering Plans',
            description: 'Structural, civil, and hydraulic engineering details',
            documents: [
              'Structural Engineering Plans',
              'Stormwater/Drainage Engineering Plans',
              'Retaining Wall Details (if applicable)',
              'Waste Management Plan'
            ],
            contacts: ['Structural Engineer', 'Civil Engineer', 'Hydraulic Consultant'],
            checklist: [
              'Structural engineering for footings, slabs, frames',
              'Stormwater management and on-site detention (OSD)',
              'Retaining wall design (if required)',
              'Waste management plan for construction',
              'Traffic impact assessment (if required)'
            ],
            tips: 'Engineering costs vary widely ($2,000-$15,000+). Not always required at DA stage, but often needed for Construction Certificate.',
            links: []
          },
          {
            id: 'b7',
            title: 'Bushfire Assessment (if applicable)',
            description: 'Required for bushfire prone land',
            documents: ['Bushfire Attack Level (BAL) Assessment', 'Bushfire Management Plan'],
            contacts: ['Bushfire Consultant', 'Accredited Bushfire Assessor'],
            checklist: [
              'Check if land is bushfire prone (council maps)',
              'Engage accredited bushfire consultant',
              'Receive BAL rating (BAL-Low to BAL-FZ)',
              'Incorporate bushfire protection measures',
              'Prepare asset protection zones plan'
            ],
            tips: 'Costs $1,500-$4,000. Mandatory for bushfire prone land. Can significantly impact design and costs.',
            links: ['https://www.rfs.nsw.gov.au/plan-and-prepare/building-in-a-bush-fire-area']
          },
          {
            id: 'b8',
            title: 'Additional Specialist Reports',
            description: 'Other reports that may be required',
            documents: [
              'Arborist Report (tree assessment)',
              'Heritage Impact Statement',
              'Acoustic Assessment',
              'Traffic Impact Assessment',
              'Contamination Assessment',
              'Flood Study',
              'Ecology/Biodiversity Assessment'
            ],
            contacts: ['Arborist', 'Heritage Consultant', 'Acoustic Engineer', 'Traffic Engineer', 'Environmental Consultant'],
            checklist: [
              'Arborist report for significant trees',
              'Heritage assessment for heritage items/areas',
              'Acoustic report for noise-sensitive areas',
              'Traffic study for larger developments',
              'Contamination report for industrial/commercial sites',
              'Flood study for flood-prone land',
              'Ecology report for environmentally sensitive areas'
            ],
            tips: 'Check council\'s requirements early. Each report costs $1,500-$10,000+. Not all will apply to your project.',
            links: []
          }
        ]
      },
      {
        id: 'stage3',
        code: 'C',
        title: 'Lodge Development Application',
        description: 'Submit complete DA package to council',
        estimatedDays: '1-3 days',
        icon: '📤',
        steps: [
          {
            id: 'c1',
            title: 'Complete DA Application Form',
            description: 'Fill out official DA form with all details',
            documents: ['DA Application Form', 'Applicant/Owner Consent Forms'],
            contacts: ['Town Planning Consultant', 'Council DA Team'],
            checklist: [
              'Complete online DA form (or paper form)',
              'Provide applicant and owner details',
              'Include property details and lot description',
              'Describe development in detail',
              'Get owner\'s consent if you\'re not the owner',
              'Sign statutory declarations'
            ],
            tips: 'Most councils use the NSW Planning Portal for online lodgement. Double-check all details - errors cause delays.',
            links: ['https://www.planningportal.nsw.gov.au/']
          },
          {
            id: 'c2',
            title: 'Compile Document Package',
            description: 'Organize all plans and reports for submission',
            documents: [],
            contacts: [],
            checklist: [
              'Create cover letter summarizing application',
              'Compile all architectural plans (PDF)',
              'Include Statement of Environmental Effects',
              'Add BASIX certificate',
              'Include all specialist reports',
              'Check all documents are signed and dated',
              'Ensure plans show north point and scale',
              'Number all pages and create index'
            ],
            tips: 'Use clear file naming (e.g., "01_SitePlan.pdf", "02_FloorPlans.pdf"). Keep file sizes reasonable (<10MB per file).',
            links: []
          },
          {
            id: 'c3',
            title: 'Calculate and Pay DA Fees',
            description: 'Determine costs and pay council fees',
            documents: ['Fee Calculation', 'Payment Receipt'],
            contacts: ['Council Revenue Team'],
            checklist: [
              'Calculate DA fee based on cost of development',
              'Check if any additional fees apply (advertising, etc.)',
              'Pay via credit card or bank transfer',
              'Keep payment receipt',
              'Note: Fees are typically 0.5% of development cost'
            ],
            tips: 'DA fees typically range from $1,000 to $10,000+ for residential. Calculate using council\'s online fee calculator.',
            links: []
          },
          {
            id: 'c4',
            title: 'Submit Application',
            description: 'Lodge DA through official portal or in person',
            documents: [],
            contacts: ['Council Customer Service'],
            checklist: [
              'Upload all documents to planning portal',
              'Verify all required documents are included',
              'Submit application',
              'Receive acknowledgment and DA number',
              'Note lodgement date (starts 40-day clock)',
              'Save confirmation email/receipt'
            ],
            tips: 'Lodge early in the week to avoid weekend delays. Print and keep all confirmation documents.',
            links: []
          }
        ]
      },
      {
        id: 'stage4',
        code: 'D',
        title: 'Assessment & Notification',
        description: 'Council reviews and community is notified',
        estimatedDays: '14-40 days',
        icon: '⏳',
        steps: [
          {
            id: 'd1',
            title: 'Completeness Check',
            description: 'Council verifies all required documents',
            documents: [],
            contacts: ['Council Assessment Officer'],
            checklist: [
              'Wait for council to review submission',
              'Respond to any requests for missing information',
              'Provide additional documents if requested',
              'Track application status on planning portal'
            ],
            tips: 'Council has 7 days to request additional info. If documents are missing, the clock stops until you provide them.',
            links: []
          },
          {
            id: 'd2',
            title: 'Public Notification (if required)',
            description: 'Neighbours notified and can comment',
            documents: ['Notification Letters to Neighbours', 'Site Notice'],
            contacts: [],
            checklist: [
              'Check if your DA requires public notification',
              'Council sends letters to adjoining neighbours',
              'Site notice may be displayed on property',
              'Public has 14 days to comment/object',
              'Review any submissions received'
            ],
            tips: 'Not all DAs require notification - check council policy. Notification adds 14 days to assessment period.',
            links: []
          },
          {
            id: 'd3',
            title: 'Council Assessment',
            description: 'Planner reviews against planning controls',
            documents: ['Assessment Report (internal)'],
            contacts: ['Council Assessment Officer', 'Council Engineers', 'Heritage Team', 'Environmental Team'],
            checklist: [
              'Council officer assesses against LEP/DCP',
              'Internal referrals to engineering, heritage, etc.',
              'Review of public submissions',
              'Site inspection by council officer',
              'Preparation of assessment report'
            ],
            tips: 'This is the longest phase. Complex applications may take 60-90+ days despite 40-day statutory timeframe.',
            links: []
          },
          {
            id: 'd4',
            title: 'Requests for Information (RFI)',
            description: 'Council may request changes or clarifications',
            documents: ['RFI Letter from Council', 'Amended Plans', 'Additional Information'],
            contacts: ['Council Assessment Officer', 'Architect', 'Town Planner'],
            checklist: [
              'Receive RFI from council (via email/portal)',
              'Review requested changes/information',
              'Engage professionals to prepare response',
              'Submit amended plans or additional reports',
              'Track revised timeframes (clock stops during RFI)'
            ],
            tips: 'RFIs are common - don\'t panic. Respond within 21 days to avoid refusal. Use this as opportunity to improve application.',
            links: []
          },
          {
            id: 'd5',
            title: 'Negotiation and Amendments',
            description: 'Work with council to resolve issues',
            documents: ['Amended Plans', 'Revised SEE'],
            contacts: ['Council Assessment Officer', 'Town Planning Consultant'],
            checklist: [
              'Review council\'s concerns',
              'Discuss solutions with assessment officer',
              'Prepare amended plans if required',
              'Update Statement of Environmental Effects',
              'Re-submit modified documents'
            ],
            tips: 'Good communication with the assessment officer is key. Be flexible where possible but stand firm on critical design elements.',
            links: []
          }
        ]
      },
      {
        id: 'stage5',
        code: 'E',
        title: 'Determination (Decision)',
        description: 'Council approves, refuses, or defers',
        estimatedDays: '1-7 days after assessment',
        icon: '⚖️',
        steps: [
          {
            id: 'e1',
            title: 'Receive Notice of Determination',
            description: 'Official decision from council',
            documents: ['Notice of Determination', 'Consent Conditions'],
            contacts: ['Council Assessment Officer'],
            checklist: [
              'Receive determination notice (email/mail)',
              'Check decision: Approved, Refused, or Deferred',
              'Review consent conditions (if approved)',
              'Note approval expiry date (usually 5 years)',
              'Download stamped/approved plans'
            ],
            tips: 'Approval rate is typically 80-90%. If refused, you can appeal to Land and Environment Court or modify and resubmit.',
            links: []
          },
          {
            id: 'e2',
            title: 'Review Conditions of Consent',
            description: 'Understand all requirements and obligations',
            documents: ['Conditions Schedule'],
            contacts: ['Council Assessment Officer', 'Town Planning Consultant', 'Lawyer (if complex)'],
            checklist: [
              'Read ALL conditions carefully',
              'Separate pre-construction vs. during-construction conditions',
              'Note any "deferred commencement" conditions',
              'Check for s7.11/s7.12 contribution requirements',
              'Identify any bond or bank guarantee requirements',
              'Flag conditions requiring further documentation'
            ],
            tips: 'Conditions are legally binding. Non-compliance can result in stop-work orders or prosecution. Budget for contribution fees.',
            links: []
          },
          {
            id: 'e3',
            title: 'Pay Development Contributions',
            description: 'Pay required s7.11/s7.12 contributions',
            documents: ['Contribution Notice', 'Payment Receipt'],
            contacts: ['Council Revenue Team'],
            checklist: [
              'Calculate total contributions required',
              'Check if contributions can be paid at CC stage instead',
              'Pay via council portal or in person',
              'Request indexed contribution amount if delaying',
              'Keep payment receipts for CC application'
            ],
            tips: 'Contributions can range from $0 to $50,000+ depending on location and project size. These fund local infrastructure.',
            links: []
          },
          {
            id: 'e4',
            title: 'Satisfy Deferred Commencement Conditions',
            description: 'Complete any pre-commencement requirements',
            documents: ['Additional Reports/Plans as required'],
            contacts: ['Relevant Consultants', 'Council'],
            checklist: [
              'Identify any deferred commencement conditions',
              'Engage professionals to prepare required documents',
              'Submit documents to council',
              'Wait for council to issue commencement notice',
              'Consent becomes active only after this step'
            ],
            tips: 'Deferred conditions must be satisfied before consent is "active". This can add 2-8 weeks.',
            links: []
          },
          {
            id: 'e5',
            title: 'If Refused: Consider Options',
            description: 'Next steps if DA is refused',
            documents: ['Refusal Notice', 'Appeal Documents (if pursuing)'],
            contacts: ['Town Planning Consultant', 'Planning Lawyer', 'Architect'],
            checklist: [
              'Review reasons for refusal in detail',
              'Assess if issues can be addressed',
              'Option 1: Modify and resubmit (common)',
              'Option 2: Appeal to Land & Environment Court (costly)',
              'Option 3: Request review of determination (some councils)',
              'Get professional advice before proceeding'
            ],
            tips: 'Refusal is not the end. Many successful projects were initially refused. Understand WHY and address issues systematically.',
            links: []
          }
        ]
      },
      {
        id: 'stage6',
        code: 'F',
        title: 'Construction Certificate & Certifier',
        description: 'Get building approval before starting work',
        estimatedDays: '14-30 days',
        icon: '🏗️',
        steps: [
          {
            id: 'f1',
            title: 'Choose Principal Certifier (PCA)',
            description: 'Appoint council or private certifier',
            documents: ['PCA Appointment Letter'],
            contacts: ['Private Certifier', 'Council Building Certification Team'],
            checklist: [
              'Decide: Council certifier vs. Private certifier',
              'Get quotes from 3+ private certifiers (if private)',
              'Check certifier accreditation and insurance',
              'Sign appointment agreement',
              'Notify council of PCA appointment'
            ],
            tips: 'Private certifiers are often faster (2-3 weeks vs 4-6 weeks). Costs $3,000-$8,000+. They handle all inspections.',
            links: []
          },
          {
            id: 'f2',
            title: 'Prepare Construction Plans',
            description: 'Detailed working drawings for builder',
            documents: [
              'Construction Plans (all trades)',
              'Engineering Details',
              'Specifications Document',
              'Energy Efficiency Details (BASIX compliance)'
            ],
            contacts: ['Architect', 'Structural Engineer', 'Hydraulic Engineer', 'Electrical Engineer'],
            checklist: [
              'Architectural construction drawings',
              'Structural engineering plans and calculations',
              'Hydraulic/plumbing plans',
              'Electrical plans',
              'HVAC plans (if applicable)',
              'Specifications for materials and finishes',
              'BASIX compliance documentation'
            ],
            tips: 'CC plans are much more detailed than DA plans. Include all structural calculations and NCC compliance details.',
            links: []
          },
          {
            id: 'f3',
            title: 'Satisfy Pre-CC Conditions',
            description: 'Complete required conditions before CC',
            documents: ['Documents as per DA conditions'],
            contacts: ['Various consultants as required'],
            checklist: [
              'Review DA conditions - identify pre-CC requirements',
              'Prepare required plans/documents/reports',
              'Arrange required inspections',
              'Submit to council/PCA for approval',
              'Wait for clearance letter'
            ],
            tips: 'Common pre-CC conditions: Long Service Levy payment, erosion control plan, waste management plan.',
            links: []
          },
          {
            id: 'f4',
            title: 'Lodge CC Application',
            description: 'Submit application to PCA for building approval',
            documents: ['CC Application Form', 'All Construction Plans', 'Home Warranty Insurance', 'Insurance Certificates'],
            contacts: ['Principal Certifier'],
            checklist: [
              'Complete CC application form',
              'Submit all construction drawings',
              'Obtain Home Warranty Insurance (builder must provide)',
              'Provide proof of insurance (builders, owners)',
              'Pay CC application fee',
              'Arrange appointment of builder (if required)',
              'Submit to PCA'
            ],
            tips: 'Home Warranty Insurance is mandatory for residential building work over $20,000. PCA will check compliance with NCC (National Construction Code) and DA conditions.',
            links: []
          },
          {
            id: 'f5',
            title: 'Receive Construction Certificate',
            description: 'Get CC approval to commence building',
            documents: ['Construction Certificate', 'Stamped CC Plans'],
            contacts: ['Principal Certifier'],
            checklist: [
              'Receive Construction Certificate from PCA',
              'Check all details are correct',
              'Receive stamped construction plans',
              'Note CC number for records',
              'Ensure builder has copies'
            ],
            tips: 'CC is valid for the life of the project. Keep multiple copies - you\'ll need them for inspections and final occupation.',
            links: []
          },
          {
            id: 'f6',
            title: 'Pay Remaining Contributions & Bonds',
            description: 'Final payments before work starts',
            documents: ['Payment Receipts', 'Bank Guarantee (if required)'],
            contacts: ['Council Revenue Team', 'Bank'],
            checklist: [
              'Pay any outstanding s7.11/s7.12 contributions',
              'Pay Long Service Levy to Building & Construction Industry',
              'Arrange security bond or bank guarantee (if required)',
              'Pay water/sewer connection fees (if applicable)',
              'Keep all receipts for PCA'
            ],
            tips: 'Long Service Levy is 0.35% of building cost (mandatory). Bonds typically $5,000-$20,000 - refunded after work completes.',
            links: ['https://www.longservice.nsw.gov.au/']
          }
        ]
      },
      {
        id: 'stage7',
        code: 'G',
        title: 'Construction & Occupation',
        description: 'Build and get final occupation approval',
        estimatedDays: '180-365+ days',
        icon: '🏠',
        steps: [
          {
            id: 'g1',
            title: 'Give Notice of Commencement',
            description: 'Notify council and PCA before starting work',
            documents: ['Notice of Commencement Form', 'Appointment of Builder Form'],
            contacts: ['Principal Certifier', 'Council', 'Builder'],
            checklist: [
              'Complete Notice of Commencement form',
              'Provide at least 2 days notice before work starts',
              'Submit to PCA and council',
              'Confirm builder is licensed and insured',
              'Arrange site signage with PCA details'
            ],
            tips: 'Starting work without notice can result in $1,000+ fine. PCA and council must be notified.',
            links: []
          },
          {
            id: 'g1a',
            title: 'Site Prep & Base Stage (Progress Payment 1)',
            description: 'Clear site, excavate, and pour concrete slab/footings',
            documents: ['Site Preparation Plan', 'Erosion Control Plan', 'Plumbing Rough-in Certificate'],
            contacts: ['Builder', 'Site Supervisor', 'Excavator', 'Plumber'],
            checklist: [
              'Clear land and remove vegetation',
              'Set up site shed, fencing, and temporary services',
              'Earthworks and site leveling',
              'Install underground plumbing (rough-in)',
              'Set up formwork for footings/slab',
              'PCA inspection: pier holes and footings',
              'Pour concrete slab/footings',
              'PCA inspection: slab base',
              'Make Progress Payment 1 to builder'
            ],
            tips: 'Base stage typically 10-20% of total contract. Don\'t pay until PCA inspections are complete and signed off.',
            links: []
          },
          {
            id: 'g1b',
            title: 'Frame Stage (Progress Payment 2)',
            description: 'Erect wall frames and roof trusses',
            documents: ['Frame Inspection Certificate', 'Engineering Certificates'],
            contacts: ['Builder', 'Carpenters', 'Principal Certifier'],
            checklist: [
              'Erect wall frames (timber or steel)',
              'Install floor joists (if multi-story)',
              'Install roof trusses or rafters',
              'Temporary bracing for stability',
              'Request mandatory PCA frame inspection',
              'PCA inspection: frame stage (CRITICAL)',
              'Address any frame defects immediately',
              'Make Progress Payment 2 to builder'
            ],
            tips: 'Frame inspection is mandatory and critical. Typical payment: 15-25% of contract. Frame must be complete before covering.',
            links: []
          },
          {
            id: 'g1c',
            title: 'Lock-up/Enclosed Stage (Progress Payment 3)',
            description: 'Building becomes weather-tight and secure',
            documents: ['Lock-up Inspection Report', 'Window/Door Compliance'],
            contacts: ['Builder', 'Bricklayers', 'Roofers', 'Window Installers'],
            checklist: [
              'Install roofing (tiles, metal, or membrane)',
              'Install external walls (brickwork, cladding)',
              'Install windows and external doors',
              'Flashing and weatherproofing complete',
              'Building is now weatherproof and secure',
              'PCA inspection: enclosed frame',
              'Make Progress Payment 3 to builder'
            ],
            tips: 'Lock-up means house is protected from weather. Typical payment: 35-45% of contract value. Major milestone!',
            links: []
          },
          {
            id: 'g1d',
            title: 'First Fix Stage',
            description: 'Install services before walls are lined',
            documents: ['Electrical Rough-in Certificate', 'Plumbing Rough-in Certificate', 'Insulation Certificate'],
            contacts: ['Electrician', 'Plumber', 'HVAC Installer', 'Insulation Contractor'],
            checklist: [
              'Electrical rough-in (cables, conduits, boxes)',
              'Plumbing rough-in (pipes for fixtures)',
              'Install insulation (walls, ceiling)',
              'HVAC ductwork installation',
              'Install pre-wall backing for fixtures',
              'PCA inspection: waterproofing (wet areas)',
              'PCA inspection: services before covering'
            ],
            tips: 'First fix happens before plasterboard. This is your last chance to change electrical/plumbing locations easily.',
            links: []
          },
          {
            id: 'g1e',
            title: 'Fixing Stage (Progress Payment 4)',
            description: 'Internal wall lining and wet area finishes',
            documents: ['Plasterboard Certificate', 'Waterproofing Certificate', 'Tiling Certificate'],
            contacts: ['Plasterers', 'Waterproofer', 'Tilers'],
            checklist: [
              'Install plasterboard/drywall on walls and ceilings',
              'Tape and set plasterboard joints',
              'Wet area waterproofing (bathroom, laundry)',
              'PCA inspection: waterproofing (MANDATORY)',
              'Install wall and floor tiles in wet areas',
              'Install architraves and skirting boards',
              'Install built-in wardrobes/cabinets',
              'Make Progress Payment 4 to builder'
            ],
            tips: 'Waterproofing inspection is mandatory before tiling. Typical payment: 55-70% of contract. House starts to look real!',
            links: []
          },
          {
            id: 'g1f',
            title: 'Second Fix/Fit-off Stage',
            description: 'Final fixtures, painting, and finishing touches',
            documents: ['Painting Contract', 'Kitchen Certificate', 'Flooring Certificate'],
            contacts: ['Painters', 'Kitchen Installer', 'Flooring Contractor', 'Electrician', 'Plumber'],
            checklist: [
              'Painting (walls, ceilings, trim) - multiple coats',
              'Install kitchen benchtops and splashbacks',
              'Install bathroom/kitchen plumbing fixtures',
              'Install electrical outlets, switches, light fixtures',
              'Install internal doors and door hardware',
              'Install flooring (timber, carpet, tiles)',
              'Install garage door and internal access',
              'Final clean and touch-ups'
            ],
            tips: 'Second fix is where everything comes together. Budget 4-8 weeks. Hold final payment until practical completion.',
            links: []
          },
          {
            id: 'g1g',
            title: 'Practical Completion Inspection (PCI)',
            description: 'Joint walkthrough to identify defects before final payment',
            documents: ['Practical Completion Certificate', 'Defects List (Snagging List)'],
            contacts: ['Builder', 'Site Supervisor', 'PCA', 'You (Owner)'],
            checklist: [
              'Schedule practical completion inspection with builder',
              'Walk through entire property systematically',
              'Create defects list (snagging list)',
              'Note incomplete work or poor workmanship',
              'Photograph all defects for records',
              'Builder commits to rectification timeline',
              'Do NOT make final payment until defects fixed',
              'Re-inspect after defect rectification'
            ],
            tips: 'Be thorough! This is your leverage point. Typical defects: paint touch-ups, door adjustments, scratched fixtures. Hold 5-10% until fixed.',
            links: []
          },
          {
            id: 'g2',
            title: 'Stage Inspections During Construction',
            description: 'Mandatory inspections at key stages',
            documents: ['Inspection Request Forms', 'Inspection Certificates'],
            contacts: ['Principal Certifier', 'Builder'],
            checklist: [
              'Pier holes (before pouring concrete)',
              'Footings (before pouring slab)',
              'Slab base (before pouring)',
              'Frame inspection',
              'Wet area waterproofing',
              'Enclosed frame (before covering)',
              'Drainage (before covering)',
              'Final inspection',
              'Request each inspection 48hrs in advance'
            ],
            tips: 'Never cover work before inspection - this causes delays and may require demolition. PCA must inspect each stage.',
            links: []
          },
          {
            id: 'g3',
            title: 'Manage Construction Compliance',
            description: 'Ensure all DA conditions are met during build',
            documents: ['DA Conditions Checklist', 'Compliance Certificates'],
            contacts: ['Builder', 'Site Supervisor', 'PCA'],
            checklist: [
              'Track compliance with all DA conditions',
              'Manage noise, dust, and hours restrictions',
              'Implement erosion and sediment controls',
              'Manage waste disposal and recycling',
              'Maintain safe site access and fencing',
              'Schedule any required council inspections',
              'Address neighbour complaints promptly'
            ],
            tips: 'Keep a DA conditions checklist on site. Non-compliance can result in stop-work orders or fines up to $1.1 million.',
            links: []
          },
          {
            id: 'g4',
            title: 'Obtain Compliance Certificates',
            description: 'Get required certificates from tradespeople',
            documents: [
              'Electrical Compliance Certificate',
              'Plumbing Compliance Certificate',
              'Waterproofing Certificate',
              'Air Conditioning Certificate',
              'Pool Safety Certificate (if applicable)'
            ],
            contacts: ['Licensed Electrician', 'Licensed Plumber', 'Waterproofer', 'Pool Inspector'],
            checklist: [
              'Electrical work certificate from licensed electrician',
              'Plumbing and drainage certificate',
              'Waterproofing certificate for wet areas',
              'Air conditioning compliance (if installed)',
              'Pool barrier certificate (if pool installed)',
              'Fire safety certificate (if required)',
              'Keep all certificates for OC application'
            ],
            tips: 'Builder should arrange these, but you\'re responsible for ensuring they\'re obtained. No OC without them.',
            links: []
          },
          {
            id: 'g5',
            title: 'Final Inspection',
            description: 'PCA conducts final inspection for OC',
            documents: ['Final Inspection Report'],
            contacts: ['Principal Certifier'],
            checklist: [
              'Ensure all work is 100% complete',
              'Request final inspection from PCA',
              'PCA checks compliance with CC and DA',
              'Address any defects or non-compliances',
              'Re-inspect if required',
              'Get clearance for Occupation Certificate'
            ],
            tips: 'Allow 1-2 weeks for defect rectification. PCA must be satisfied everything matches approved plans.',
            links: []
          },
          {
            id: 'g6',
            title: 'Apply for Occupation Certificate',
            description: 'Get legal permission to occupy building',
            documents: ['OC Application Form', 'All Compliance Certificates', 'BASIX Compliance Report'],
            contacts: ['Principal Certifier'],
            checklist: [
              'Complete OC application form',
              'Submit all trade compliance certificates',
              'Provide BASIX compliance evidence',
              'Include final inspection report',
              'Pay OC application fee',
              'Submit to PCA'
            ],
            tips: 'OC application typically takes 2-7 days if all documents are in order. You cannot legally occupy without an OC.',
            links: []
          },
          {
            id: 'g7',
            title: 'Receive Occupation Certificate',
            description: 'Final approval - you can now move in!',
            documents: ['Occupation Certificate', 'Stamped As-Built Plans'],
            contacts: ['Principal Certifier'],
            checklist: [
              'Receive Occupation Certificate from PCA',
              'Check OC type: Interim or Final',
              'Receive as-built plans',
              'Notify council (PCA usually does this)',
              'Arrange insurance switchover (construction to home)',
              'Coordinate utilities connection/transfer',
              'Move in and enjoy your new home!'
            ],
            tips: 'Congratulations! Keep OC and as-built plans safe - you\'ll need them for insurance, future renovations, and property sales.',
            links: []
          },
          {
            id: 'g8',
            title: 'Post-Occupation Obligations',
            description: 'Final tasks after moving in',
            documents: ['Defects List', 'Warranty Documents'],
            contacts: ['Builder', 'Council'],
            checklist: [
              'Request release of security bond/bank guarantee',
              'Complete landscaping (if DA condition)',
              'Install required fencing',
              'Maintain erosion controls until site stabilized',
              'Keep defects list for builder warranty period',
              'Notify council of completion (if required)',
              'Archive all project documents'
            ],
            tips: 'Builder warranty is typically 6 years for structural, 2 years for non-structural. Document any defects immediately.',
            links: []
          }
        ]
      }
    ]
  };

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================
  
  /**
   * Get project-specific workflow state from localStorage
   */
  function getWorkflowState(projectId) {
    try {
      var key = 'gablok_da_workflow_' + projectId;
      var raw = localStorage.getItem(key);
      if (!raw) return createFreshWorkflowState();
      var state = JSON.parse(raw);
      return state;
    } catch (e) {
      console.error('[DA Workflow] Failed to load state:', e);
      return createFreshWorkflowState();
    }
  }
  
  /**
   * Save workflow state to localStorage
   */
  function saveWorkflowState(projectId, state) {
    try {
      var key = 'gablok_da_workflow_' + projectId;
      state.lastUpdated = Date.now();
      localStorage.setItem(key, JSON.stringify(state));
      console.log('[DA Workflow] State saved for project:', projectId);
      return true;
    } catch (e) {
      console.error('[DA Workflow] Failed to save state:', e);
      return false;
    }
  }
  
  /**
   * Create fresh workflow state for new project
   */
  function createFreshWorkflowState() {
    return {
      currentStage: 'stage1',
      currentStep: 'a1',
      completedSteps: [],
      documents: {},
      contacts: {},
      notes: {},
      sharedLinks: {},
      lastUpdated: Date.now(),
      createdAt: Date.now()
    };
  }

  // ============================================================================
  // CONTACT MANAGEMENT
  // ============================================================================
  
  /**
   * Add or update contact for project
   */
  function addContact(projectId, role, details) {
    var state = getWorkflowState(projectId);
    if (!state.contacts) state.contacts = {};
    
    state.contacts[role] = {
      role: role,
      name: details.name || '',
      company: details.company || '',
      phone: details.phone || '',
      email: details.email || '',
      license: details.license || '',
      notes: details.notes || '',
      addedAt: Date.now()
    };
    
    saveWorkflowState(projectId, state);
  }
  
  /**
   * Generate secure share link for professional
   */
  function generateShareLink(projectId, role, permissions) {
    var linkId = 'link_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    var state = getWorkflowState(projectId);
    if (!state.sharedLinks) state.sharedLinks = {};
    
    state.sharedLinks[linkId] = {
      role: role,
      permissions: permissions || ['view'],
      createdAt: Date.now(),
      expiresAt: Date.now() + (90 * 24 * 60 * 60 * 1000), // 90 days
      accessed: 0
    };
    
    saveWorkflowState(projectId, state);
    
    // Return shareable URL
    var baseUrl = window.location.origin;
    return baseUrl + '/da-share?id=' + linkId + '&project=' + projectId;
  }

  // ============================================================================
  // DOCUMENT TRACKING
  // ============================================================================
  
  /**
   * Mark document as uploaded/completed
   */
  function markDocumentComplete(projectId, documentName, fileInfo) {
    var state = getWorkflowState(projectId);
    if (!state.documents) state.documents = {};
    
    state.documents[documentName] = {
      name: documentName,
      status: 'complete',
      uploadedAt: Date.now(),
      fileSize: fileInfo.size || 0,
      fileName: fileInfo.fileName || documentName,
      notes: fileInfo.notes || ''
    };
    
    saveWorkflowState(projectId, state);
  }

  // ============================================================================
  // STEP COMPLETION TRACKING
  // ============================================================================
  
  /**
   * Mark step as complete
   */
  function markStepComplete(projectId, stepId) {
    var state = getWorkflowState(projectId);
    if (!state.completedSteps) state.completedSteps = [];
    
    if (state.completedSteps.indexOf(stepId) === -1) {
      state.completedSteps.push(stepId);
    }
    
    saveWorkflowState(projectId, state);
  }
  
  /**
   * Check if step is complete
   */
  function isStepComplete(projectId, stepId) {
    var state = getWorkflowState(projectId);
    return state.completedSteps && state.completedSteps.indexOf(stepId) !== -1;
  }

  // ============================================================================
  // EXPORTS
  // ============================================================================
  
  window.DAWorkflow = {
    workflow: DA_WORKFLOW,
    getWorkflowState: getWorkflowState,
    saveWorkflowState: saveWorkflowState,
    createFreshWorkflowState: createFreshWorkflowState,
    addContact: addContact,
    generateShareLink: generateShareLink,
    markDocumentComplete: markDocumentComplete,
    markStepComplete: markStepComplete,
    isStepComplete: isStepComplete
  };
  
  console.log('[DA Workflow] System initialized with', DA_WORKFLOW.stages.length, 'stages');
  
})();
