// ════════════════════════════════════════════════════════════
//  ROLE-BASED ACCESS CONTROL — Configuration
// ════════════════════════════════════════════════════════════
const ROLES = {
    ADMIN:    'admin',
    ANALYST:  'analyst',
    REVIEWER: 'reviewer',
    VIEWER:   'viewer',
};

const ROLE_META = {
    admin:    { label: 'Admin',    icon: '👑', color: '#ef4444', bg: 'rgba(220,38,38,0.18)',    dotColor: '#ef4444',  desc: 'Full platform access — manage projects, versions, branding, and all inputs' },
    analyst:  { label: 'Analyst',  icon: '📊', color: '#3b82f6', bg: 'rgba(59,130,246,0.18)',   dotColor: '#60a5fa',  desc: 'Create projects, edit all model inputs, and save new versions' },
    reviewer: { label: 'Reviewer', icon: '🔍', color: '#f59e0b', bg: 'rgba(245,158,11,0.18)',   dotColor: '#fbbf24',  desc: 'View models and reports, add comments — cannot edit inputs or settings' },
    viewer:   { label: 'Viewer',   icon: '👁️', color: '#6b7280', bg: 'rgba(107,114,128,0.18)', dotColor: '#9ca3af',  desc: 'Read-only access to dashboard and reports only — no editing' },
};

// ── Module visibility per role ────────────────────────────────
// Defines which sidebar modules each role can SEE and navigate to.
//   ADMIN    → all modules
//   ANALYST  → Dashboard, Projects, Overview, Module 1 (Setup/Land/Costs/Financing),
//              Module 2 (Revenue), Module 3 (OpEx), Module 4 (Returns), Module 6 (Reports)
//   REVIEWER → Dashboard, Projects, Module 6 (Reports)
//   VIEWER   → Dashboard, Module 6 (Reports only)
const MODULE_VISIBILITY = {
    admin:    ['dashboard','projects','overview','module1','module2','module3','module4','module5','module6'],
    analyst:  ['dashboard','projects','overview','module1','module2','module3','module4','module6'],
    reviewer: ['dashboard','projects','module6'],
    viewer:   ['dashboard','module6'],
};

const PERMISSIONS = {
    admin: {
        canCreateProject:    true,
        canEditProject:      true,
        canDeleteProject:    true,
        canManageVersions:   true,
        canEditInputs:       true,
        canSave:             true,
        canChangeBranding:   true,
        canViewReports:      true,
        canAddComments:      true,
        canExport:           true,
        canImport:           true,
    },
    analyst: {
        canCreateProject:    true,
        canEditProject:      true,
        canDeleteProject:    false,
        canManageVersions:   true,
        canEditInputs:       true,
        canSave:             true,
        canChangeBranding:   false,
        canViewReports:      true,
        canAddComments:      true,
        canExport:           true,
        canImport:           true,
    },
    reviewer: {
        canCreateProject:    false,
        canEditProject:      false,
        canDeleteProject:    false,
        canManageVersions:   false,
        canEditInputs:       false,
        canSave:             false,
        canChangeBranding:   false,
        canViewReports:      true,
        canAddComments:      true,
        canExport:           true,
        canImport:           false,
    },
    viewer: {
        canCreateProject:    false,
        canEditProject:      false,
        canDeleteProject:    false,
        canManageVersions:   false,
        canEditInputs:       false,
        canSave:             false,
        canChangeBranding:   false,
        canViewReports:      true,
        canAddComments:      false,
        canExport:           false,
        canImport:           false,
    },
};

