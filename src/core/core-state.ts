import { create } from 'zustand';
import { Role, RoleMeta, PermissionMap, ModuleKey } from '../types/settings.types';
import type { BrandingConfig } from '../types/branding.types';
import { DEFAULT_BRANDING, loadBranding, saveBranding, fetchRemoteBranding } from './branding';

export const ROLES = {
  ADMIN:    'admin'    as Role,
  ANALYST:  'analyst'  as Role,
  REVIEWER: 'reviewer' as Role,
  VIEWER:   'viewer'   as Role,
};

export const ROLE_META: Record<Role, RoleMeta> = {
  admin:    { label: 'Admin',    icon: '👑', color: '#ef4444', bg: 'rgba(220,38,38,0.18)',    dotColor: '#ef4444',  desc: 'Full platform access — manage projects, versions, branding, and all inputs' },
  analyst:  { label: 'Analyst',  icon: '📊', color: '#3b82f6', bg: 'rgba(59,130,246,0.18)',   dotColor: '#60a5fa',  desc: 'Create projects, edit all model inputs, and save new versions' },
  reviewer: { label: 'Reviewer', icon: '🔍', color: '#f59e0b', bg: 'rgba(245,158,11,0.18)',   dotColor: '#fbbf24',  desc: 'View models and reports, add comments — cannot edit inputs or settings' },
  viewer:   { label: 'Viewer',   icon: '👁️', color: '#6b7280', bg: 'rgba(107,114,128,0.18)', dotColor: '#9ca3af',  desc: 'Read-only access to dashboard and reports only — no editing' },
};

export const MODULE_VISIBILITY: Record<Role, ModuleKey[]> = {
  admin:    ['dashboard', 'projects', 'overview', 'module1', 'module2', 'module3', 'module4', 'module5', 'module6'],
  analyst:  ['dashboard', 'projects', 'overview', 'module1', 'module2', 'module3', 'module4', 'module6'],
  reviewer: ['dashboard', 'projects', 'module6'],
  viewer:   ['dashboard', 'module6'],
};

export const PERMISSIONS: Record<Role, PermissionMap> = {
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

// ── Branding store ────────────────────────────────────────────────────────────
interface BrandingStore {
  branding: BrandingConfig;
  currentPlatform: string | null;
  setBranding: (b: BrandingConfig) => void;
  resetBranding: () => void;
  updateField: <K extends keyof BrandingConfig>(key: K, val: BrandingConfig[K]) => void;
  fetchRemote: () => Promise<void>;
  setCurrentPlatform: (id: string | null) => void;
}

export const useBrandingStore = create<BrandingStore>((set) => ({
  // Always start from DEFAULT_BRANDING to avoid SSR/client hydration mismatch.
  // Client-side localStorage hydration happens in BrandingThemeApplier (useEffect).
  branding: { ...DEFAULT_BRANDING },
  currentPlatform: null,

  setBranding: (b) => {
    saveBranding(b);
    set({ branding: b });
  },

  resetBranding: () => {
    const defaults = { ...DEFAULT_BRANDING };
    saveBranding(defaults);
    set({ branding: defaults });
  },

  updateField: (key, val) =>
    set((state) => {
      const updated = { ...state.branding, [key]: val };
      saveBranding(updated);
      return { branding: updated };
    }),

  fetchRemote: async () => {
    const remote = await fetchRemoteBranding();
    if (remote) set({ branding: remote });
  },

  setCurrentPlatform: (id) => set({ currentPlatform: id }),
}));
