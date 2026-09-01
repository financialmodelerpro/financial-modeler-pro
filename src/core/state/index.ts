import { create } from 'zustand';
import type { BrandingConfig } from '../types/branding.types';
import { DEFAULT_BRANDING, loadBranding, saveBranding, fetchRemoteBranding } from '../branding';

// ── Collaboration roles: RE-EXPORTED, not declared (2026-09-01, step 0) ────
//
// The vocabulary, the metadata and the permission matrix all live in
// `src/core/collab/projectRoles.ts` so ERM and BVM inherit them. These names
// stay so existing importers keep working.
//
// MODULE_VISIBILITY IS GONE FROM THIS FILE. Its keys were `module1`..`module7`,
// which is REFM's module list and nobody else's, so a per-platform fact was
// sitting in the one file every platform shares. It now lives at
// `src/hubs/modeling/platforms/refm/lib/moduleVisibility.ts`.
export {
  PROJECT_ROLES,
  PROJECT_ROLE_META as ROLE_META,
  PROJECT_ROLE_PERMISSIONS as PERMISSIONS,
  DEFAULT_PROJECT_ROLE,
  roleRank,
  roleCan,
  isProjectRole,
  type ProjectRole,
} from '@/src/core/collab/projectRoles';
import type { ProjectRole } from '@/src/core/collab/projectRoles';

/** Legacy accessor kept for existing call sites. OWNER replaced ADMIN and
 *  EDITOR replaced ANALYST; see projectRoles.ts for why. */
export const ROLES = {
  OWNER:    'owner'    as ProjectRole,
  EDITOR:   'editor'   as ProjectRole,
  REVIEWER: 'reviewer' as ProjectRole,
  VIEWER:   'viewer'   as ProjectRole,
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
