# Pricing and Entitlement System Diagnosis

Status: documentation only. No code was changed. Every claim below was read from the actual source on 2026-06-18. File paths are relative to the repo root `D:\FMP\financial-modeler-pro`. No em dashes are used in this document.

## Executive summary

There are three systems that all touch "plans and features", and they are NOT connected to each other:

1. **Public pricing page system** (live). Tables `platform_pricing`, `platform_features`, `plan_feature_access` (migrations 076 and 077). Drives the marketing `/pricing` page and an admin editor at `/admin/pricing`. It is presentation only. It never grants or denies in-app access. Its feature vocabulary (for example `active_projects`, `module_revenue`, `excel_export`) is its own and does not match the gate.

2. **The in-app gate** (live, but stubbed). `canAccess(featureKey)` in the REFM workspace reads the static `MODULES` registry and returns true only when `requiredPlan === 'free'`. It ignores the signed-in user, their `subscription_plan`, and both database systems. It is a hardcoded, plan-shaped stub.

3. **A dynamic entitlement trio** (DROPPED in production, definitions left behind). `features_registry`, `plan_permissions`, `user_permissions`. Per migration `144_admin_cleanup.sql`, these were created by migration 006, powered a real admin checkbox plan builder plus per-user overrides, and were then dropped along with their admin pages, API routes, lib, hook, and the 486 line `PermissionsManager.tsx`. The CREATE TABLE statements still sit in `src/lib/schema.sql` and `supabase/seed-permissions.sql`, but no live TypeScript references them and they do not exist in production.

The most important consequence for this task: the admin checkbox plan builder with per-user overrides is not a greenfield build. A working version existed and was removed. The dropped schema (the trio plus `user_permissions.override_value` and `reason`) is a ready blueprint, and the static `MODULES.featureKey` values already match the dropped `features_registry` keys (`module_1` through `module_11`).

Also note a schema-source split: the canonical Modeling Hub user and entitlement tables live in `src/lib/schema.sql` (a "run this in the Supabase SQL editor" bootstrap), not under `supabase/migrations/`. `subscription_plan`, `subscription_status`, `trial_ends_at`, and the dropped trio are all defined there. Treat `src/lib/schema.sql` as partly stale: it still contains CREATE TABLE for the trio that migration 144 dropped in production.

---

## 1. Pricing page

### What exists

- **Route and component**: `/pricing`, served by `app/pricing/page.tsx` (async server component, `export const revalidate = 0`). A client child `app/pricing/CouponInput.tsx` handles coupon entry.
- **Rendering**: hero (from CMS `page_sections`), a Training Hub free banner, plan cards grouped per platform, a feature comparison table, coupon input, FAQ accordion, bottom CTA, footer. Plan cards show `plan_label`, a price (`price_label` or fallback `${price_monthly} / month`), description, a feature checklist, and a CTA. There is no monthly/annual billing toggle. Price is rendered monthly only.
- **Comparison table**: rows are `platform_features`, columns are the platform's plans, cells are a check, a cross, or `override_text` (for example "1 project", "Unlimited"). Built from an in-memory `accessMap` keyed by `plan_id` then `feature_id`.
- **Content source (verbatim queries in `app/pricing/page.tsx`)**:
  - `sb.from('platform_pricing').select('*').eq('is_active', true).order('display_order')`
  - `sb.from('platform_features').select('*').in('platform_slug', ...).eq('is_active', true).order('display_order')`
  - `sb.from('plan_feature_access').select('*').in('plan_id', ...)`
  - Plus `getCmsContent()` (table `cms_content`), `getAllPageSections('pricing')` (table `page_sections`), and `getModules()` to know which platforms are live.
- **API routes that serve pricing data**:
  - `app/api/pricing/validate-coupon/route.ts` (POST, reads `coupon_codes`).
  - Admin CRUD (see section 2): `app/api/admin/pricing/platform/route.ts`, `app/api/admin/pricing/features/route.ts`, `app/api/admin/pricing/coupons/route.ts`.

Data flow: `/pricing` page (server) reads `platform_pricing` + `platform_features` + `plan_feature_access` (+ CMS tables) directly via the Supabase server client, builds an access map, and renders cards and the comparison matrix. The coupon box posts to `/api/pricing/validate-coupon`.

### What is missing for an admin checkbox plan builder with per-user overrides

- The page describes plans for humans. It has no concept of "this signed-in user can use feature X". Nothing here feeds the gate.
- The comparison `is_included` checkboxes are marketing copy. They are not read by `canAccess`.
- No billing-interval data is surfaced even though some price columns may exist in schema.

---

## 2. Plan and feature tables

### What exists

Real schema, from migrations (verified against the SQL, not docs):

- **`platform_pricing`** (`supabase/migrations/076_pricing_restructure.sql`). Columns: `id uuid pk`, `platform_slug text`, `plan_name text`, `plan_label text`, `price_monthly decimal(10,2)`, `price_label text`, `description text`, `is_featured bool`, `is_custom bool`, `badge_text text`, `badge_color text`, `cta_text text`, `cta_url text`, `features jsonb`, `display_order int`, `is_active bool`, `trial_days int`, `max_projects int`, timestamps. RLS enabled with an admin-full-access policy.
- **`platform_features`** (`supabase/migrations/077_pricing_platform_features.sql`). Columns: `id uuid pk`, `platform_slug text`, `feature_key text`, `feature_text text`, `feature_category text`, `display_order int`, `is_active bool`, `created_at`. Unique on `(platform_slug, feature_key)`. RLS enabled.
- **`plan_feature_access`** (`supabase/migrations/077_...`). Columns: `id uuid pk`, `plan_id uuid references platform_pricing(id) on delete cascade`, `feature_id uuid references platform_features(id) on delete cascade`, `is_included bool`, `override_text text`. Unique on `(plan_id, feature_id)`. RLS enabled.
- **`coupon_codes`** (migration 076). Used by the validate-coupon route and the admin coupons editor.

These three are the canonical pricing model. CLAUDE-DB.md documents them accurately (verified, no mismatch).

### `pricing_plans` confirmation

Dropped and not referenced live.
- `supabase/migrations/145_drop_pricing_plans.sql`: `DROP TABLE IF EXISTS pricing_plans CASCADE;`
- Grep of `app/` and `src/` for `pricing_plans` returns no matches. Remaining mentions are only in migration files (014, 018, 145) and docs.
- Migration 144 separately dropped the related `pricing_features` and `pricing_modules` legacy tables.

### Admin pricing editor that already exists

- **Page**: `app/admin/pricing/page.tsx`. Can edit, per Real Estate plan: `plan_label`, `price_monthly`, `price_label`, `description`, `trial_days`, `max_projects`, `cta_text`, `cta_url`, `badge_text`, `badge_color`, `is_featured`, `is_active`, `is_custom`. It also edits feature access per plan: a checkbox for `is_included` plus an `override_text` field per feature, grouped by `feature_category`. It manages coupon codes (create, toggle, delete).
- **API**:
  - `app/api/admin/pricing/platform/route.ts`: GET list, PATCH plan plus bulk upsert of `plan_feature_access`, POST create plan.
  - `app/api/admin/pricing/features/route.ts`: GET features plus access rows, POST create feature (auto-creates access rows for existing plans), PATCH bulk update access for a plan.
  - `app/api/admin/pricing/coupons/route.ts`: GET, POST, PATCH, DELETE.

Read and write sites:
- Reads of the three tables: `app/pricing/page.tsx` (public), `app/admin/pricing/page.tsx` (via the admin API).
- Writes: the three admin pricing API routes above.

### What is missing for an admin checkbox plan builder with per-user overrides

- This editor already is a per-plan, per-feature checkbox builder, but only for the marketing comparison table. Its toggles are not entitlements.
- No per-user override anywhere in this system. `plan_feature_access` is keyed by plan only.
- The `platform_features.feature_key` vocabulary (for example `active_projects`, `module_revenue`, `excel_export`, `pdf_export`) does not match the gate's `featureKey` vocabulary (`module_1` through `module_11`). A builder that drives access needs one shared feature catalog.

---

## 3. Module registry and ordering

### What exists

- **Static registry**: `src/hubs/modeling/platforms/refm/lib/modules-config.ts`. Exports `MODULES: readonly ModuleConfig[]` (11 entries). Shape:
  - `num`, `key` (`module1`..`module11`), `icon`, `shortLabel`, `longLabel`, `featureKey` (`module_1`..`module_11`), `requiredPlan: 'free' | 'professional' | 'enterprise'`, `status: 'done' | 'wip' | 'soon' | 'pro' | 'enterprise'`, `disabled`, `disabledReason`, `plannedContent`.
  - Modules 1 to 9 are `requiredPlan: 'free'`, module 10 is `professional`, module 11 is `enterprise`.
- **Sidebar sub-tabs**: `MODULE_TABS` in `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx` maps each module key to its sub-tabs.
- **Sidebar component**: `src/hubs/modeling/platforms/refm/components/Sidebar.tsx` renders the module list, lock icons, plan badges, and sub-tab dropdowns. It consumes either the static `sidebarModules` or a dynamic list.
- **Dynamic source plus admin control**: table `platform_modules` (`supabase/migrations/150_p_sync_platform_modules.sql`). Columns include `platform_slug`, `slug` (stable routing key), `number` (mutable display number), `name`, `short_name`, `status CHECK in ('live','coming_soon','hidden','pro','enterprise')`, `gating_tier CHECK in ('free','pro','enterprise')`, `display_order`, plus marketing fields. Unique on `(platform_slug, slug)` and `(platform_slug, number)`. RLS public read filters out `status = 'hidden'`.
  - Types and helpers: `src/shared/cms/platform-modules.ts` (`PlatformModule`, `getPlatformModules`, admin upsert/delete).
  - Admin UI: `app/admin/platform-modules/page.tsx`. Supports reorder (up/down buttons rewrite `display_order`), status cycling (`live` to `coming_soon` to `pro` to `enterprise` to `hidden`), gating_tier edit, create, edit, delete.
  - API: `app/api/platforms/[platformSlug]/modules/route.ts` (GET cached, POST), `app/api/platforms/[platformSlug]/modules/[moduleSlug]/route.ts` (PATCH, DELETE), `app/api/admin/platform-module-pages/route.ts` (marketing sections).
  - Client merge: `usePlatformModules(REFM_PLATFORM_SLUG)` fetches the dynamic list and maps DB `gating_tier` to the sidebar nav `requiredPlan`. It falls back to the static `MODULES` list while loading or on error.

### How reorder, hide, show, and "Coming soon" work today

- Reorder: admin buttons rewrite `display_order` for changed rows. `slug` keeps routing stable while `number` can change.
- Hide and show: `status = 'hidden'` is filtered by RLS and the public API, so the module disappears from the sidebar. Any non-hidden status shows it.
- Coming soon: `status = 'coming_soon'` (DB) and `status: 'soon'` plus `disabled: true` (static config) render a SOON pill and a disabled, non-clickable row.

### requiredPlan: where defined and read

- Defined statically per module in `modules-config.ts` (`requiredPlan`). The DB analog is `platform_modules.gating_tier`.
- Read sites: `usePlatformModules.ts` (maps `gating_tier` to `requiredPlan`, and copies it for static items), `Sidebar.tsx` (lock icon trigger, `onLockedModuleClick`, the "Requires {plan} plan" tooltip, and the `PlanBadge`), `RealEstatePlatform.tsx` (the upgrade-prompt state), and `PlanBadge.tsx` (badge rendering).

### What is missing for an admin checkbox plan builder with per-user overrides

- `requiredPlan` / `gating_tier` is a single tier per module. It cannot express "plan X includes module 6 but not module 7" as freely checkable cells, and it cannot express per-user grants.
- The plan vocabularies disagree: the static module config uses `professional`, while `platform_modules.gating_tier` and the public pricing use `pro`. A builder needs one canonical plan set.
- Module gating is the only thing tiered here. Non-module features (exports, white label, AI, project limits) have no registry-driven gate (the dropped `features_registry` had them; see section 9).

---

## 4. The gate

### What exists

- **Function** (`src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx`, verbatim):
  ```ts
  const canAccess = (featureKey: string): boolean => {
    const mod = MODULES.find((m) => m.featureKey === featureKey);
    return mod?.requiredPlan === 'free';
  };
  ```
  Its comment states plan enforcement has not shipped: "pro / enterprise modules stay locked behind the upgrade prompt until plan enforcement ships". An earlier version returned `false` for everything (confirmed by migration 144's note "REFM canAccess() now stubs to false").
- **It ignores subscription.** `canAccess` reads only the static `MODULES` array. It never reads the session, `users.subscription_plan`, `users.subscription_status`, or any DB table. There is no other entitlement function in the codebase (grep for `canAccess`, `entitlement`, `hasAccess` returns only this gate plus prop plumbing).

### Every point where access is gated today

- **Module entry (sidebar)**: `Sidebar.tsx` line 131, `const isFeatureLocked = subLoaded && !!mod.featureKey && !canAccess(mod.featureKey);`. On click of a locked pro/enterprise module it calls `onLockedModuleClick(featureKey, requiredPlan)` which opens the upgrade prompt instead of entering.
- **Export**: `ExportModal.tsx` accepts an optional `canAccess` prop and `RealEstatePlatform.tsx` passes `canAccess={canAccess}`, but the modal does not currently use it to block any export. Export is effectively ungated.
- **Save and versioning**: not gated by `canAccess`. Gated only by the RBAC permission `canSave` in the UI (see section 5), which itself defaults to admin.
- **Branding**: not gated by `canAccess`. Gated only by the RBAC permission `canChangeBranding` in the UI, which defaults to admin.

So the only real effect of the gate today is the sidebar lock on modules 10 and 11, driven entirely by static config.

### What is missing for an admin checkbox plan builder with per-user overrides

- The gate has no input from the user. It must learn the current user's plan (from the session or DB) and then resolve plan features plus per-user overrides.
- The gate is client-only. There is no server-side entitlement check for modeling actions (export, save). A builder that controls paid features needs server enforcement, not just a sidebar lock.
- Only module feature keys are wired. Export, branding, save, and limits need real feature keys and real checks.

---

## 5. RBAC

### What exists

- **Roles (workspace RBAC)**: `src/core/types/settings.types.ts`: `type Role = 'admin' | 'analyst' | 'reviewer' | 'viewer'`. Metadata and the permission map are in `src/core/state/index.ts`: `ROLES`, `ROLE_META`, and `PERMISSIONS: Record<Role, PermissionMap>` with 11 boolean capabilities (`canCreateProject`, `canEditProject`, `canDeleteProject`, `canManageVersions`, `canEditInputs`, `canSave`, `canChangeBranding`, `canViewReports`, `canAddComments`, `canExport`, `canImport`).
- **Account role (separate, two values)**: `users.role CHECK in ('user','admin')` in `src/lib/schema.sql`. This is the admin-vs-user account role, distinct from the four workspace roles above.
- **Enforcement, server side (real)**:
  - `src/middleware.ts`: any `/admin/*` path requires a NextAuth token with `role === 'admin'`, else redirect.
  - Admin API routes use a `checkAdmin()` pattern (for example `app/api/admin/modules/route.ts`, `app/api/admin/env-check/route.ts`) returning 401 or 403 for non-admins.
- **Enforcement, UI only (cosmetic)**:
  - `RealEstatePlatform.tsx` gates buttons with `can(permission)`, but `currentUserRole` is local state initialized to `ROLES.ADMIN` and toggled via an RBAC test modal. The four-role workspace permissions are not enforced on any server route for modeling actions.
- **Role binding**: the account `role` IS bound to the authenticated user. `src/shared/auth/nextauth.ts` selects `role`, `subscription_plan`, `subscription_status` from `users` at sign in, puts them on the JWT, and copies them onto the session (`session.user.role`, `session.user.subscription_plan`, `session.user.subscription_status`). However the modeling workspace UI ignores the session role and defaults the four-role workspace RBAC to `admin`.
- **Admin bypass** (`nextauth.ts`): admins bypass the pre-launch coming-soon gate and the email-confirmed gate. Device-trust applies to all roles, but is itself gated by an admin-controlled "device verification required" switch.

### What is missing for an admin checkbox plan builder with per-user overrides

- Two role concepts coexist (the 4 workspace roles and the 2-value account role). The builder should not conflate role with plan. Plan and overrides are about feature entitlement, role is about capability within a project.
- The workspace role defaults to admin in the UI and is never read from the session, so any role-shaped gating today is cosmetic. If the plan builder reuses any UI gating pattern, it must read real identity, not local state.
- Server-side enforcement exists only for `/admin/*` and admin APIs. Modeling feature enforcement (the thing a plan builder sells) has no server guard yet.

---

## 6. Subscription and user plan

### What exists

- **Storage on the user record** (`src/lib/schema.sql`, table `users`):
  - `subscription_plan text not null default 'free' check (subscription_plan in ('free','professional','enterprise'))`
  - `subscription_status text not null default 'trial' check (subscription_status in ('active','trial','expired','cancelled'))`
  - `projects_limit integer not null default 3` (comment: -1 = unlimited)
  - `trial_ends_at timestamptz`, `admin_notes text`, `last_login_at timestamptz`
  - Note: these columns are defined in `src/lib/schema.sql`, not in `supabase/migrations/`. A grep of `supabase/migrations` for `subscription_plan` returns nothing.
- **Admin can edit plan and status**: `app/api/admin/users/route.ts` selects and updates `subscription_plan` and `subscription_status`; `app/admin/users/page.tsx` shows them with a status badge.
- **Session carries the plan**: `nextauth.ts` puts `subscription_plan` and `subscription_status` on the JWT and session.

### Any link between a purchased plan and in-app access

None. Confirmed.
- `canAccess` never reads `subscription_plan` (section 4).
- The admin users endpoint reads and writes the columns, but nothing consumes them for gating.
- The session exposes `subscription_plan`, but no code path uses `session.user.subscription_plan` to grant or deny a feature.

### What is missing for an admin checkbox plan builder with per-user overrides

- The plumbing to read the plan already reaches the client via the session. What is missing is a resolver that turns `subscription_plan` plus a plan-feature matrix plus per-user overrides into a boolean per feature, and a gate that calls it.
- Plan value mismatch to reconcile: `users.subscription_plan` uses `professional`, while `platform_modules.gating_tier` and public pricing use `pro`. Pick one canonical set.
- There is no payment or checkout integration linking a purchase to `subscription_plan`. Coupons exist for the marketing page only.

---

## 7. Trial

### What exists

- Schema only. `users.subscription_status` includes `'trial'` and `'expired'`, and `users.trial_ends_at timestamptz` exists (`src/lib/schema.sql`). The admin users page renders the status badge.

### What is missing

- No enforcement. Nothing reads `trial_ends_at`. There is no expiry job, no middleware check, no feature lock on `expired` or `cancelled`. A user can sit on `trial` indefinitely with no effect.
- No approval or pending flow. Grep for `approval` and `pending` finds the Training Hub model-submission review flow and registration flows, none of which relate to modeling plan trials.

---

## 8. The dropped entitlement system (the existing blueprint)

This is the single most relevant prior art for the task, and it is easy to miss because the tables are dropped in production while their definitions linger.

### What it was (per `supabase/migrations/144_admin_cleanup.sql` and CLAUDE-DB.md line 273)

A real, admin-controlled, checkbox-based plan builder with per-user overrides, created by migration 006 and later dropped. The cleanup note states the trio `user_permissions`, `plan_permissions`, `features_registry` backed:
- admin pages `/admin/permissions`, `/admin/overrides`, `/admin/plans`
- API `/api/permissions`, `/api/admin/permissions`
- `src/lib/shared/permissions.ts` (deleted)
- `src/hooks/useSubscription.ts` (deleted)
- `PermissionsManager.tsx`, 486 lines (deleted)
and that "REFM canAccess() now stubs to false ... a real plan-based gating system gets reintroduced when paid tiers go live".

### The leftover definitions (still in the repo, dropped in prod, not referenced by any live TypeScript)

`src/lib/schema.sql` and `supabase/seed-permissions.sql`:
- **`features_registry`**: `id`, `feature_key text unique`, `display_name`, `description`, `category`. Seeded with about 24 features across categories `modules` (`module_1`..`module_11`), `module_quality`, `ai`, `export` (`pdf_basic`, `pdf_full`, `pdf_whitelabel`, `excel_static`, `excel_formula`), `admin` (`white_label`, `admin_panel`), `limits` (`projects_10`, `projects_unlimited`).
- **`plan_permissions`**: `plan check in ('free','professional','enterprise')`, `feature_key references features_registry`, `enabled bool`, `updated_at`, `updated_by`, unique `(plan, feature_key)`. This is exactly the plan-by-feature checkbox matrix.
- **`user_permissions`**: `user_id`, `feature_key references features_registry`, `override_value bool`, `reason text`, `created_at`, `created_by`, unique `(user_id, feature_key)`. This is exactly the per-user override with an audit reason.
- Supporting tables also present: `branding_config`, `admin_audit_log` (admin action trail with before and after values and reason).

Staleness signals: `supabase/seed-permissions.sql` still contains em dashes (predates the em-dash sweep), and `src/lib/schema.sql` still has CREATE TABLE for the trio that migration 144 dropped. Do not assume either reflects production.

### Why it matters

- The dropped `features_registry` keys (`module_1`..`module_11`) already match the static `MODULES.featureKey` values the gate uses today. The gate vocabulary and the dropped catalog align.
- The dropped design is precisely "admin checkbox plan builder (`plan_permissions`) plus per-user overrides (`user_permissions`) over a feature catalog (`features_registry`)". Rebuilding it, and finally wiring the gate to read it plus `users.subscription_plan`, is the shortest path to the goal.

---

## Gaps to build

1. **A live feature catalog**: reinstate a single `features_registry` style table (the dropped one is the template), with categories for modules, exports, branding, AI, and limits. Reconcile the two existing vocabularies (`platform_features.feature_key` marketing keys versus `MODULES.featureKey` gate keys).
2. **A plan-by-feature matrix**: reinstate `plan_permissions` style table (admin checkbox grid: plan times feature equals enabled). Decide the canonical plan set and fix the `professional` versus `pro` mismatch across `users.subscription_plan`, `platform_modules.gating_tier`, and pricing.
3. **Per-user overrides**: reinstate `user_permissions` style table (`override_value`, `reason`, `created_by`), keyed `(user_id, feature_key)`.
4. **An entitlement resolver**: a function that computes, for a user, effective access per feature as override if present, else plan matrix, else default deny. Today no such function exists.
5. **Wire the gate to the resolver**: replace the static `canAccess` stub so it reads the session plan plus the matrix plus overrides, instead of `MODULES.requiredPlan === 'free'`.
6. **Server-side enforcement**: add real checks on the paid surfaces (module data APIs, export endpoints, save and versioning) so entitlement cannot be bypassed from the client. Today only `/admin/*` is server-enforced.
7. **Subscription to access link**: nothing maps `users.subscription_plan` to features. Build that mapping (it flows to the session already, so the client can read it once the resolver exists).
8. **Trial enforcement**: read `trial_ends_at` and `subscription_status` somewhere real (resolver or middleware) so `trial`, `expired`, and `cancelled` actually change access. None of this is enforced today.
9. **Admin builder UI**: a new admin page for the matrix and overrides (the deleted `PermissionsManager.tsx`, `/admin/permissions`, `/admin/overrides`, `/admin/plans` are gone). The existing `/admin/pricing` editor is marketing only and should stay separate or be unified deliberately.
10. **Apply path for the new tables**: the dropped trio was created by a migration but dropped by 144, and the leftover definitions live in `src/lib/schema.sql` which is not the migration path. New tables must come in as new `supabase/migrations/*.sql` applied manually via the Supabase dashboard (the project convention), not via `schema.sql`.

## Safe to build on

1. **Static `MODULES` registry** (`modules-config.ts`): stable, already carries `featureKey` (`module_1`..`module_11`) and `requiredPlan`. The feature keys match the dropped `features_registry`. Good source for the modules portion of a new catalog.
2. **`platform_modules` plus its admin UI and API** (migration 150, `app/admin/platform-modules`, `app/api/platforms/[slug]/modules`): a working pattern for admin reorder, hide, show, status, and `gating_tier`. Reuse its admin and RLS patterns for the new builder.
3. **NextAuth session carries plan and role** (`src/shared/auth/nextauth.ts`): `session.user.subscription_plan`, `subscription_status`, and `role` are already populated from `users`. The resolver can read them with no auth changes.
4. **`users` plan and trial columns** (`src/lib/schema.sql`): `subscription_plan`, `subscription_status`, `projects_limit`, `trial_ends_at` already exist and are admin-editable via `/admin/users`. They are the right home for plan and trial state.
5. **Admin enforcement primitives**: `src/middleware.ts` admin gate and the `checkAdmin()` pattern in admin APIs are real and reusable for protecting the new builder endpoints.
6. **Public pricing system** (migrations 076, 077; `/pricing`; `/admin/pricing`): keep as the marketing surface. It is stable and can later read the same canonical feature catalog so marketing copy and entitlements stop drifting.
7. **`admin_audit_log` and the `user_permissions.reason` pattern**: an audit trail with before and after values and a reason field already exists in the schema, which fits per-user override accountability.
8. **The dropped trio as a blueprint**: `features_registry`, `plan_permissions`, `user_permissions` in `src/lib/schema.sql` and `supabase/seed-permissions.sql` are a complete, coherent design for exactly this feature. Reuse the shapes (after scrubbing em dashes and re-confirming against production), do not assume they are applied.

---

## Appendix: key file paths

- Pricing page: `app/pricing/page.tsx`, `app/pricing/CouponInput.tsx`
- Pricing admin: `app/admin/pricing/page.tsx`, `app/api/admin/pricing/{platform,features,coupons}/route.ts`
- Coupons: `app/api/pricing/validate-coupon/route.ts`
- Pricing schema: `supabase/migrations/076_pricing_restructure.sql`, `supabase/migrations/077_pricing_platform_features.sql`, `supabase/migrations/145_drop_pricing_plans.sql`
- Module registry: `src/hubs/modeling/platforms/refm/lib/modules-config.ts`, `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx` (`MODULE_TABS`), `src/hubs/modeling/platforms/refm/components/Sidebar.tsx`, `src/hubs/modeling/platforms/refm/hooks/usePlatformModules.ts` (dynamic merge), `src/shared/cms/platform-modules.ts`
- Dynamic modules schema and admin: `supabase/migrations/150_p_sync_platform_modules.sql`, `app/admin/platform-modules/page.tsx`, `app/api/platforms/[platformSlug]/modules/route.ts`, `app/api/platforms/[platformSlug]/modules/[moduleSlug]/route.ts`
- The gate: `canAccess` in `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx`
- RBAC: `src/core/types/settings.types.ts`, `src/core/state/index.ts`, `src/middleware.ts`, `src/shared/auth/nextauth.ts`
- Users, plan, trial, and the dropped entitlement trio: `src/lib/schema.sql`, `supabase/seed-permissions.sql`, `app/api/admin/users/route.ts`, `app/admin/users/page.tsx`
- Cleanup history (proof the trio was a real, dropped feature): `supabase/migrations/144_admin_cleanup.sql`, CLAUDE-DB.md line 273
