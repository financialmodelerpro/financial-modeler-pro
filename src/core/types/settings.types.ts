// ── Collaboration roles ────────────────────────────────────────────────────
//
// RE-EXPORTED, NOT DECLARED (2026-09-01, Module 10 step 0). The vocabulary and
// the permission matrix live in `src/core/collab/projectRoles.ts` so every
// platform shares one definition; these aliases stay so existing importers do
// not have to move.
//
// The values changed: `admin` became `owner` and `analyst` became `editor`.
// `admin` was the problem, because `users.role === 'admin'` is the PLATFORM
// administrator and is compared as a bare string all over the auth layer. One
// word meant two things. OWNER is a role on ONE PROJECT; admin is a property of
// the user, platform-wide, and is not in this type.
export type {
  ProjectRole as Role,
  ProjectRoleMeta as RoleMeta,
  Permission,
  PermissionMap,
} from '@/src/core/collab/projectRoles';

export type ModuleKey =
  | 'dashboard' | 'projects' | 'overview'
  | 'module1' | 'module2' | 'module3'
  | 'module4' | 'module5' | 'module6' | 'module7';
