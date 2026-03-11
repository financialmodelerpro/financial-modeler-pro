// ════════════════════════════════════════════════════════════
//  TEMPLATES — Financial Modeler Pro / REFM Platform
//  Model template definitions for new project creation.
//
//  Each template supplies:
//    id             — unique key
//    name/label     — display name (both aliases)
//    icon           — emoji shown on the card header
//    badge          — optional pill text  (e.g. "Most Used")
//    badgeColor     — pill text/border color
//    accentColor    — header gradient stop & feature-check color
//    headerGrad     — CSS gradient string for the card header band
//    description    — short summary shown on the card
//    features       — bullet list shown as feature checklist on card
//    detail         — legacy alias for features (kept for compatibility)
//    modelStructure — ordered sections shown in Preview popup
//                     Each entry: { section, description?, type? }
//                     type: 'input' | 'calc' | 'output' | 'custom'
//    defaults       — partial snapshot consumed by applySnapshot()
//                     Any key omitted here keeps the platform default.
//
//  To add a new template:
//    1. Add an entry to MODEL_TEMPLATES below.
//    2. The template picker renders it automatically — no other changes.
//    3. Add any snapshot keys you need to defaults{}.
// ════════════════════════════════════════════════════════════

const MODEL_TEMPLATES = [

    // ── 1. Development Feasibility ───────────────────────────────
    {
        id:          'development_feasibility',
        name:        'Development Feasibility',
        label:       'Development Feasibility',
        icon:        '🏗️',
        badge:       'Most Used',
        badgeColor:  '#1E40AF',
        accentColor: '#1E3A8A',
        headerGrad:  'linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%)',
        description: 'Evaluate development feasibility including costs, financing, and projected returns.',
        features: [
            'Development cost schedule',
            'Construction financing',
            'Sales revenue projections',
            'Debt structuring & interest carry',
            'IRR & equity multiple analysis',
        ],
        detail: [
            'Development cost schedule',
            'Construction financing',
            'Sales revenue projections',
            'Debt structuring & interest carry',
            'IRR & equity multiple analysis',
        ],
        modelStructure: [
            { section: 'Assumptions',             type: 'input',  description: 'Land area, FAR, project timeline & key rates' },
            { section: 'Development Costs',        type: 'input',  description: 'Construction, infrastructure, professional & soft costs' },
            { section: 'Construction Timeline',    type: 'calc',   description: 'Period-by-period cost phasing across construction' },
            { section: 'Financing Structure',      type: 'input',  description: 'Debt ratio, interest rate & capitalisation policy' },
            { section: 'Sales Revenue',            type: 'input',  description: 'Unit pricing, absorption schedule & revenue timing' },
            { section: 'Cash Flow',                type: 'calc',   description: 'Combined inflows, outflows & cumulative position' },
            { section: 'Investor Returns',         type: 'output', description: 'IRR, equity multiple, NPV & profit-on-cost' },
        ],
        defaults: {
            projectType:          'mixed-use',
            modelType:            'annual',
            constructionPeriods:  4,
            operationsPeriods:    5,
            overlapPeriods:       0,
            projectStart:         '2025-01-01',
            projectRoadsPct:      10,
            projectFAR:           1.5,
            projectNonEnclosedPct:0,
            residentialPercent:   50,
            hospitalityPercent:   30,
            retailPercent:        20,
            residentialDeductPct: 10,
            residentialEfficiency:85,
            hospitalityDeductPct: 15,
            hospitalityEfficiency:80,
            retailDeductPct:      5,
            retailEfficiency:     90,
            interestRate:         7.5,
            financingMode:        'fixed',
            globalDebtPct:        60,
            capitalizeInterest:   true,
            repaymentPeriods:     5,
            repaymentMethod:      'fixed',
            costInputMode:        'separate',
            landParcels: [
                { id: 1, name: 'Land 1', area: 100000, rate: 500, cashPct: 60, inKindPct: 40 },
            ],
            residentialCosts: [
                { id:1,  name:'Land (Cash Portion)',          method:'fixed',          value:0,    baseType:'',                  startPeriod:0, endPeriod:0,  phasing:'100',          canDelete:false },
                { id:2,  name:'Construction Cost',            method:'rate_bua',        value:3200, baseType:'',                  startPeriod:2, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:3,  name:'Infrastructure Cost',          method:'rate_total_allocated', value:150, baseType:'',             startPeriod:1, endPeriod:3,  phasing:'30,40,30',      canDelete:true  },
                { id:4,  name:'Landscaping Cost',             method:'rate_total_allocated', value:80,  baseType:'',             startPeriod:2, endPeriod:4,  phasing:'30,40,30',      canDelete:true  },
                { id:5,  name:'Pre-Operating Expenses',       method:'percent_base',    value:2,    baseType:'infra_construction',startPeriod:1, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:6,  name:'Professional Fee',             method:'percent_base',    value:3,    baseType:'infra_construction',startPeriod:1, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:7,  name:'Contingency Cost',             method:'percent_base',    value:5,    baseType:'infra_construction',startPeriod:1, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:8,  name:'Developer Fee / Performance Fee', method:'percent_base', value:3,    baseType:'infra_construction',startPeriod:1, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:9,  name:'Electricity Station',          method:'fixed',           value:0,    baseType:'',                  startPeriod:2, endPeriod:3,  phasing:'even',          canDelete:true  },
                { id:10, name:'Bridges',                      method:'fixed',           value:0,    baseType:'',                  startPeriod:1, endPeriod:2,  phasing:'even',          canDelete:true  },
                { id:11, name:'Royal Commission Premium',     method:'percent_base',    value:0,    baseType:'land_cost',         startPeriod:0, endPeriod:0,  phasing:'100',           canDelete:true  },
                { id:12, name:'RETT',                         method:'percent_base',    value:5,    baseType:'land_cost',         startPeriod:0, endPeriod:0,  phasing:'100',           canDelete:true  },
            ],
            hospitalityCosts: [
                { id:1,  name:'Land (Cash Portion)',          method:'fixed',          value:0,    baseType:'',                  startPeriod:0, endPeriod:0,  phasing:'100',          canDelete:false },
                { id:2,  name:'Construction Cost',            method:'rate_bua',        value:4500, baseType:'',                  startPeriod:2, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:3,  name:'FF&E / OS&E',                  method:'rate_bua',        value:800,  baseType:'',                  startPeriod:3, endPeriod:4,  phasing:'50,50',         canDelete:true  },
                { id:4,  name:'Pre-Opening Costs',            method:'percent_base',    value:3,    baseType:'infra_construction',startPeriod:3, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:5,  name:'Professional Fee',             method:'percent_base',    value:3,    baseType:'infra_construction',startPeriod:1, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:6,  name:'Contingency Cost',             method:'percent_base',    value:5,    baseType:'infra_construction',startPeriod:1, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:7,  name:'RETT',                         method:'percent_base',    value:5,    baseType:'land_cost',         startPeriod:0, endPeriod:0,  phasing:'100',           canDelete:true  },
            ],
            retailCosts: [
                { id:1,  name:'Land (Cash Portion)',          method:'fixed',          value:0,    baseType:'',                  startPeriod:0, endPeriod:0,  phasing:'100',          canDelete:false },
                { id:2,  name:'Construction Cost',            method:'rate_bua',        value:2800, baseType:'',                  startPeriod:2, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:3,  name:'Fit-Out Cost',                 method:'rate_bua',        value:600,  baseType:'',                  startPeriod:3, endPeriod:4,  phasing:'50,50',         canDelete:true  },
                { id:4,  name:'Professional Fee',             method:'percent_base',    value:3,    baseType:'infra_construction',startPeriod:1, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:5,  name:'Contingency Cost',             method:'percent_base',    value:5,    baseType:'infra_construction',startPeriod:1, endPeriod:4,  phasing:'even',          canDelete:true  },
                { id:6,  name:'RETT',                         method:'percent_base',    value:5,    baseType:'land_cost',         startPeriod:0, endPeriod:0,  phasing:'100',           canDelete:true  },
            ],
            nextCostId: 13,
        },
    },

    // ── 2. Rental Investment ─────────────────────────────────────
    {
        id:          'rental_investment',
        name:        'Rental Investment',
        label:       'Rental Investment',
        icon:        '🏢',
        badge:       null,
        badgeColor:  null,
        accentColor: '#166534',
        headerGrad:  'linear-gradient(135deg, #14532D 0%, #16A34A 100%)',
        description: 'Analyze rental income, operating expenses, and long-term investment performance.',
        features: [
            'Rental income assumptions',
            'Operating expense structure',
            'Investment return analysis',
            'Stabilised yield & cap rate',
            'Long-term hold period (10–15 yrs)',
        ],
        detail: [
            'Rental income assumptions',
            'Operating expense structure',
            'Investment return analysis',
            'Stabilised yield & cap rate',
            'Long-term hold period (10–15 yrs)',
        ],
        modelStructure: [
            { section: 'Assumptions',          type: 'input',  description: 'GFA, occupancy rate, lease terms & escalation' },
            { section: 'Rental Income',        type: 'input',  description: 'Gross rent schedule by unit type & area' },
            { section: 'Operating Expenses',   type: 'input',  description: 'Management, maintenance, insurance & voids' },
            { section: 'Net Operating Income', type: 'calc',   description: 'NOI = Gross Income − Operating Expenses' },
            { section: 'Cash Flow',            type: 'calc',   description: 'NOI less debt service & capex reserves' },
            { section: 'Investment Returns',   type: 'output', description: 'Yield-on-cost, cap rate, IRR & equity multiple' },
        ],
        defaults: {
            projectType:          'residential',
            modelType:            'annual',
            constructionPeriods:  2,
            operationsPeriods:    10,
            overlapPeriods:       0,
            projectStart:         '2025-01-01',
            projectRoadsPct:      8,
            projectFAR:           2.0,
            projectNonEnclosedPct:0,
            residentialPercent:   100,
            hospitalityPercent:   0,
            retailPercent:        0,
            residentialDeductPct: 12,
            residentialEfficiency:88,
            hospitalityDeductPct: 15,
            hospitalityEfficiency:80,
            retailDeductPct:      5,
            retailEfficiency:     90,
            interestRate:         6.5,
            financingMode:        'fixed',
            globalDebtPct:        65,
            capitalizeInterest:   false,
            repaymentPeriods:     10,
            repaymentMethod:      'fixed',
            costInputMode:        'separate',
            landParcels: [
                { id: 1, name: 'Land 1', area: 50000, rate: 800, cashPct: 100, inKindPct: 0 },
            ],
            residentialCosts: [
                { id:1, name:'Land (Cash Portion)',   method:'fixed',      value:0,    baseType:'',                  startPeriod:0, endPeriod:0, phasing:'100',  canDelete:false },
                { id:2, name:'Construction Cost',     method:'rate_bua',   value:2800, baseType:'',                  startPeriod:1, endPeriod:2, phasing:'even', canDelete:true  },
                { id:3, name:'Professional Fee',      method:'percent_base',value:4,   baseType:'infra_construction',startPeriod:1, endPeriod:2, phasing:'even', canDelete:true  },
                { id:4, name:'Contingency Cost',      method:'percent_base',value:5,   baseType:'infra_construction',startPeriod:1, endPeriod:2, phasing:'even', canDelete:true  },
                { id:5, name:'RETT',                  method:'percent_base',value:5,   baseType:'land_cost',         startPeriod:0, endPeriod:0, phasing:'100',  canDelete:true  },
            ],
            hospitalityCosts: [],
            retailCosts:       [],
            nextCostId: 6,
        },
    },

    // ── 3. Mixed-Use Project ─────────────────────────────────────
    {
        id:          'mixed_use',
        name:        'Mixed-Use Project',
        label:       'Mixed-Use Project',
        icon:        '🏙️',
        badge:       null,
        badgeColor:  null,
        accentColor: '#5B21B6',
        headerGrad:  'linear-gradient(135deg, #4C1D95 0%, #7C3AED 100%)',
        description: 'Model projects combining residential, retail, and hospitality components.',
        features: [
            'Multiple asset classes',
            'Combined revenue streams',
            'Integrated project evaluation',
            'Per-asset cost stacks',
            'Blended financing structure',
        ],
        detail: [
            'Multiple asset classes',
            'Combined revenue streams',
            'Integrated project evaluation',
            'Per-asset cost stacks',
            'Blended financing structure',
        ],
        modelStructure: [
            { section: 'Assumptions',          type: 'input',  description: 'Site area, FAR, GFA allocation & project timeline' },
            { section: 'Residential Revenue',  type: 'input',  description: 'Unit mix, pricing & sales absorption schedule' },
            { section: 'Retail Revenue',       type: 'input',  description: 'Leasable area, rent psm & occupancy profile' },
            { section: 'Hospitality Revenue',  type: 'input',  description: 'Keys, ADR, occupancy & RevPAR assumptions' },
            { section: 'Development Costs',    type: 'input',  description: 'Per-asset cost stacks with phasing schedules' },
            { section: 'Financing',            type: 'input',  description: 'Blended debt structure across asset classes' },
            { section: 'Cash Flow',            type: 'calc',   description: 'Consolidated cash flow across all revenue streams' },
            { section: 'Project Returns',      type: 'output', description: 'Blended IRR, waterfall & sensitivity analysis' },
        ],
        defaults: {
            projectType:          'mixed-use',
            modelType:            'annual',
            constructionPeriods:  5,
            operationsPeriods:    7,
            overlapPeriods:       1,
            projectStart:         '2025-01-01',
            projectRoadsPct:      12,
            projectFAR:           2.0,
            projectNonEnclosedPct:5,
            residentialPercent:   45,
            hospitalityPercent:   35,
            retailPercent:        20,
            residentialDeductPct: 10,
            residentialEfficiency:85,
            hospitalityDeductPct: 15,
            hospitalityEfficiency:78,
            retailDeductPct:      5,
            retailEfficiency:     92,
            interestRate:         7.0,
            financingMode:        'fixed',
            globalDebtPct:        55,
            capitalizeInterest:   true,
            repaymentPeriods:     7,
            repaymentMethod:      'fixed',
            costInputMode:        'separate',
            landParcels: [
                { id: 1, name: 'Land 1', area: 200000, rate: 600, cashPct: 70, inKindPct: 30 },
            ],
            residentialCosts: [
                { id:1,  name:'Land (Cash Portion)',          method:'fixed',              value:0,    baseType:'',                  startPeriod:0, endPeriod:0, phasing:'100',      canDelete:false },
                { id:2,  name:'Construction Cost',            method:'rate_bua',            value:3200, baseType:'',                  startPeriod:2, endPeriod:5, phasing:'even',     canDelete:true  },
                { id:3,  name:'Infrastructure Cost',          method:'rate_total_allocated',value:160,  baseType:'',                  startPeriod:1, endPeriod:4, phasing:'30,30,25,15', canDelete:true },
                { id:4,  name:'Professional Fee',             method:'percent_base',        value:3,    baseType:'infra_construction',startPeriod:1, endPeriod:5, phasing:'even',     canDelete:true  },
                { id:5,  name:'Contingency Cost',             method:'percent_base',        value:5,    baseType:'infra_construction',startPeriod:1, endPeriod:5, phasing:'even',     canDelete:true  },
                { id:6,  name:'RETT',                         method:'percent_base',        value:5,    baseType:'land_cost',         startPeriod:0, endPeriod:0, phasing:'100',      canDelete:true  },
            ],
            hospitalityCosts: [
                { id:1,  name:'Land (Cash Portion)',  method:'fixed',              value:0,    baseType:'',                  startPeriod:0, endPeriod:0, phasing:'100',  canDelete:false },
                { id:2,  name:'Construction Cost',    method:'rate_bua',            value:4800, baseType:'',                  startPeriod:2, endPeriod:5, phasing:'even', canDelete:true  },
                { id:3,  name:'FF&E / OS&E',          method:'rate_bua',            value:900,  baseType:'',                  startPeriod:4, endPeriod:5, phasing:'50,50',canDelete:true  },
                { id:4,  name:'Professional Fee',     method:'percent_base',        value:3,    baseType:'infra_construction',startPeriod:1, endPeriod:5, phasing:'even', canDelete:true  },
                { id:5,  name:'Contingency Cost',     method:'percent_base',        value:5,    baseType:'infra_construction',startPeriod:1, endPeriod:5, phasing:'even', canDelete:true  },
                { id:6,  name:'RETT',                 method:'percent_base',        value:5,    baseType:'land_cost',         startPeriod:0, endPeriod:0, phasing:'100',  canDelete:true  },
            ],
            retailCosts: [
                { id:1,  name:'Land (Cash Portion)',  method:'fixed',              value:0,    baseType:'',                  startPeriod:0, endPeriod:0, phasing:'100',  canDelete:false },
                { id:2,  name:'Construction Cost',    method:'rate_bua',            value:2800, baseType:'',                  startPeriod:2, endPeriod:5, phasing:'even', canDelete:true  },
                { id:3,  name:'Fit-Out Cost',         method:'rate_bua',            value:650,  baseType:'',                  startPeriod:4, endPeriod:5, phasing:'50,50',canDelete:true  },
                { id:4,  name:'Professional Fee',     method:'percent_base',        value:3,    baseType:'infra_construction',startPeriod:1, endPeriod:5, phasing:'even', canDelete:true  },
                { id:5,  name:'Contingency Cost',     method:'percent_base',        value:5,    baseType:'infra_construction',startPeriod:1, endPeriod:5, phasing:'even', canDelete:true  },
                { id:6,  name:'RETT',                 method:'percent_base',        value:5,    baseType:'land_cost',         startPeriod:0, endPeriod:0, phasing:'100',  canDelete:true  },
            ],
            nextCostId: 7,
        },
    },

    // ── 4. Blank Model ───────────────────────────────────────────
    {
        id:          'blank',
        name:        'Blank Model',
        label:       'Blank Model',
        icon:        '📄',
        badge:       null,
        badgeColor:  null,
        accentColor: '#374151',
        headerGrad:  'linear-gradient(135deg, #1F2937 0%, #4B5563 100%)',
        description: 'Start with an empty financial model structure.',
        features: [
            'Custom assumptions',
            'Flexible structure',
            'Full customization',
            'Zero pre-filled values',
            'For advanced modellers',
        ],
        detail: [
            'Custom assumptions',
            'Flexible structure',
            'Full customization',
            'Zero pre-filled values',
            'For advanced modellers',
        ],
        modelStructure: [
            { section: 'Empty model',                 type: 'custom', description: 'No sections are pre-configured' },
            { section: 'Custom sections can be added',type: 'custom', description: 'Build your own structure from scratch' },
        ],
        defaults: {
            projectType:          'mixed-use',
            modelType:            'annual',
            constructionPeriods:  4,
            operationsPeriods:    5,
            overlapPeriods:       0,
            projectStart:         '2025-01-01',
            projectRoadsPct:      0,
            projectFAR:           1.0,
            projectNonEnclosedPct:0,
            residentialPercent:   50,
            hospitalityPercent:   30,
            retailPercent:        20,
            residentialDeductPct: 0,
            residentialEfficiency:100,
            hospitalityDeductPct: 0,
            hospitalityEfficiency:100,
            retailDeductPct:      0,
            retailEfficiency:     100,
            interestRate:         0,
            financingMode:        'fixed',
            globalDebtPct:        0,
            capitalizeInterest:   false,
            repaymentPeriods:     5,
            repaymentMethod:      'fixed',
            costInputMode:        'separate',
            landParcels: [
                { id: 1, name: 'Land 1', area: 0, rate: 0, cashPct: 100, inKindPct: 0 },
            ],
            residentialCosts: [
                { id:1, name:'Land (Cash Portion)', method:'fixed', value:0, baseType:'', startPeriod:0, endPeriod:0, phasing:'100', canDelete:false },
            ],
            hospitalityCosts: [
                { id:1, name:'Land (Cash Portion)', method:'fixed', value:0, baseType:'', startPeriod:0, endPeriod:0, phasing:'100', canDelete:false },
            ],
            retailCosts: [
                { id:1, name:'Land (Cash Portion)', method:'fixed', value:0, baseType:'', startPeriod:0, endPeriod:0, phasing:'100', canDelete:false },
            ],
            nextCostId: 2,
        },
    },
];

// ── Helper: get a template by id ─────────────────────────────
function getTemplate(id) {
    return MODEL_TEMPLATES.find(t => t.id === id) || null;
}

// ── Helper: build a snapshot object shaped for applySnapshot() ──
// Returns a minimal snapshot with template defaults merged in.
// The caller (refm-platform.js) calls applySnapshot(snap) so the
// workspace is pre-loaded before createProject() captures it.
function buildSnapshotFromTemplate(template, projectNameOverride) {
    if (!template) return null;
    return {
        version:     2,
        savedAt:     new Date().toISOString(),
        projectName: projectNameOverride || 'New Project',
        country:     'Saudi Arabia',
        currency:    'SAR',
        ...template.defaults,
    };
}
