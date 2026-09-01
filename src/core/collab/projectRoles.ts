/**
 * projectRoles.ts
 *
 * THE collaboration role vocabulary and permission matrix. ONE definition,
 * shared by every platform: REFM today, ERM and BVM when their project tables
 * join `PROJECT_SOURCES`. A platform inherits all of it; it never restates a
 * role name or a permission.
 *
 * Pure and client-safe: no supabase import, no IO, no React.
 *
 * LIVES IN core/, NOT shared/. The eslint boundaries rule allows core to import
 * only from core, and both `core/types/settings.types.ts` and
 * `core/state/index.ts` re-export from here, so a shared/ home would invert the
 * dependency direction. It is foundational vocabulary, like settings.types.ts
 * beside it. shared/, modeling/, platform/ and app/ may all import core, so
 * every consumer still reaches it.
 *
 * ── OWNER IS NOT ADMIN ────────────────────────────────────────────────────
 *
 * The four values were `admin | analyst | reviewer | viewer` until 2026-09-01.
 * `admin` was the problem: `users.role === 'admin'` is the PLATFORM
 * administrator (the person who runs Financial Modeler Pro), and it is
 * compared as a bare string in the auth layer, the account-deletion engine and
 * every admin route. One word meant two things, exactly as 'Archived' did on
 * the project status enum, and that one cost a migration to unpick.
 *
 *   OWNER    a role ON ONE PROJECT. The person who created it, or whoever the
 *            account admin has made owner. Scoped to that project.
 *   admin    a property of the USER, platform-wide, on `users.role`. Not in
 *            this file, not in this type, and never assignable per project.
 *
 * `EDITOR` replaces `analyst` for the same reason in reverse: the old name
 * described a job title, and the permission it actually carries is "may edit".
 *
 * ── THESE ARE NOT ENFORCED YET ────────────────────────────────────────────
 *
 * As of step 0 this is still a vocabulary and a matrix, not a gate. Nothing
 * server-side reads a role: `currentUserRole` is client state pinned to the
 * top role, so `can()` returns true for everything. Enforcement arrives in
 * step 4, after membership (step 2) gives a role somewhere to be READ FROM.
 * Do not mistake the presence of this table for a permission system.
 *
 * No em dashes in this file.
 */

/** The four collaboration roles, MOST privileged first. The order is the
 *  privilege order and `roleRank` depends on it. */
export const PROJECT_ROLES = ['owner', 'editor', 'reviewer', 'viewer'] as const;

export type ProjectRole = typeof PROJECT_ROLES[number];

/** The role a project's creator gets, and the only role that can be granted by
 *  creating rather than by being assigned. */
export const DEFAULT_PROJECT_ROLE: ProjectRole = 'owner';

export interface ProjectRoleMeta {
  label: string;
  icon: string;
  color: string;
  bg: string;
  dotColor: string;
  desc: string;
}

export const PROJECT_ROLE_META: Record<ProjectRole, ProjectRoleMeta> = {
  owner:    { label: 'Owner',    icon: '👑', color: '#ef4444', bg: 'rgba(220,38,38,0.18)',    dotColor: '#ef4444', desc: 'Full access to this project: manage members, edit every input, save versions, and export' },
  editor:   { label: 'Editor',   icon: '📊', color: '#3b82f6', bg: 'rgba(59,130,246,0.18)',   dotColor: '#60a5fa', desc: 'Edit all model inputs and save new versions. Cannot manage members or delete the project' },
  reviewer: { label: 'Reviewer', icon: '🔍', color: '#f59e0b', bg: 'rgba(245,158,11,0.18)',   dotColor: '#fbbf24', desc: 'View the model and reports and leave comments for the editor. Cannot change any input' },
  viewer:   { label: 'Viewer',   icon: '👁️', color: '#6b7280', bg: 'rgba(107,114,128,0.18)', dotColor: '#9ca3af', desc: 'Read-only access to the dashboard and reports. Cannot edit or comment' },
};

export type Permission =
  | 'canCreateProject' | 'canEditProject' | 'canDeleteProject'
  | 'canManageVersions' | 'canEditInputs' | 'canSave'
  | 'canChangeBranding' | 'canViewReports' | 'canAddComments'
  | 'canExport' | 'canImport';

export type PermissionMap = Record<Permission, boolean>;

/**
 * The permission matrix. CARRIED OVER UNCHANGED from the pre-rename table
 * (`admin` became `owner`, `analyst` became `editor`, and not one boolean
 * moved), because step 0 is a rename and must not smuggle a behaviour change
 * in beside it. Where a value looks wrong, it is written down for step 4
 * rather than quietly corrected here.
 */
export const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, PermissionMap> = {
  owner: {
    canCreateProject:  true,
    canEditProject:    true,
    canDeleteProject:  true,
    canManageVersions: true,
    canEditInputs:     true,
    canSave:           true,
    canChangeBranding: true,
    canViewReports:    true,
    canAddComments:    true,
    canExport:         true,
    canImport:         true,
  },
  editor: {
    canCreateProject:  true,
    canEditProject:    true,
    canDeleteProject:  false,
    canManageVersions: true,
    canEditInputs:     true,
    canSave:           true,
    canChangeBranding: false,
    canViewReports:    true,
    canAddComments:    true,
    canExport:         true,
    canImport:         true,
  },
  reviewer: {
    canCreateProject:  false,
    canEditProject:    false,
    canDeleteProject:  false,
    canManageVersions: false,
    canEditInputs:     false,
    canSave:           false,
    canChangeBranding: false,
    canViewReports:    true,
    canAddComments:    true,
    canExport:         true,
    canImport:         false,
  },
  viewer: {
    canCreateProject:  false,
    canEditProject:    false,
    canDeleteProject:  false,
    canManageVersions: false,
    canEditInputs:     false,
    canSave:           false,
    canChangeBranding: false,
    canViewReports:    true,
    canAddComments:    false,
    canExport:         false,
    canImport:         false,
  },
};

/** Privilege rank, 0 = most privileged. An unknown role ranks LAST (least
 *  privileged), which is the safe direction: a role this build does not
 *  recognise must not be treated as an owner. */
export function roleRank(role: string | null | undefined): number {
  const i = PROJECT_ROLES.indexOf(role as ProjectRole);
  return i >= 0 ? i : PROJECT_ROLES.length;
}

export function isProjectRole(v: unknown): v is ProjectRole {
  return typeof v === 'string' && (PROJECT_ROLES as readonly string[]).includes(v);
}

/**
 * Whether `role` carries `permission`.
 *
 * An unrecognised role gets NOTHING, rather than falling back to a default
 * role's permissions. A missing or malformed role is the case where the answer
 * matters most, and "deny" is the only safe answer to give without knowing who
 * is asking.
 */
export function roleCan(role: string | null | undefined, permission: Permission): boolean {
  if (!isProjectRole(role)) return false;
  return PROJECT_ROLE_PERMISSIONS[role][permission] === true;
}
