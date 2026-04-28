# Architecture — Financial Modeler Pro

**Last updated: 2026-04-29.** Snapshot taken at the close of the 8-phase folder restructure (`RESTRUCTURE_PLAN.md`).

This file is the canonical reference for *why* the source tree is shaped the way it is. CLAUDE.md is the day-to-day rulebook; this is the rationale you reach for when adding a new platform, a new hub, or anything that crosses module boundaries.

---

## Goals

The codebase serves three independent web properties from a single Next.js deployment:

| Subdomain | What it is | Auth model |
|-----------|------------|------------|
| `financialmodelerpro.com` | Marketing site, admin panel, public verify, portal | Admin-only NextAuth (JWT) |
| `learn.financialmodelerpro.com` | Training Hub (3SFM, BVM, live sessions, certs) | Custom httpOnly cookie + localStorage |
| `app.financialmodelerpro.com` | Modeling Hub (REFM today, 9 platforms planned) | NextAuth (JWT, 1hr session) |

Everything that ships from `D:\FMP\financial-modeler-pro` runs in front of all three. The folder layout has to:

1. **Keep hubs from importing each other.** Training Hub features must not pull from Modeling Hub primitives, and vice versa. Each hub has its own auth model, its own public surface, and its own deploy cadence.
2. **Keep cross-cutting code in one place.** Email, share helpers, CMS readers, hCaptcha, device trust — used by all three properties. Duplicating these would hurt; coupling hubs through them would hurt more.
3. **Stay portable.** A future hub extraction (e.g. spinning Modeling Hub off into its own deployment) should mostly be `git mv src/hubs/modeling/ ../modeling-hub/src/` plus the shared/core dependencies it pulls in. No `src/lib/` grab-bag where everything imports everything.
4. **Be machine-checkable.** Boundaries enforced by humans drift in a week. ESLint with `eslint-plugin-boundaries` blocks cross-hub regressions at CI, so the rules survive contact with new contributors.

---

## Three-tier model: core → shared → hubs

```
core    ← pure business primitives (no I/O, no framework)
shared  ← cross-hub utilities (auth, email, CMS reader, share helpers, components)
hubs/   ← per-property code: main, training, modeling
features/  ← cross-cutting features that don't fit a hub (Marketing Studio)
integrations/  ← third-party SDK adapters (Teams, Resend, Anthropic, YouTube)
app/    ← Next.js routes — the only place cross-hub composition is allowed
```

Allowed import directions (top-down only, see "Boundary lint rules" below for the machine-readable graph):

- `core` imports nothing else (pure)
- `shared` imports `core`, `shared`, `integrations`
- `<hub>` imports `core`, `shared`, `integrations`, *itself*
- `platforms/<x>` imports `core`, `shared`, `integrations`, `modeling`, *self*
- `features/<x>` imports `core`, `shared`, `integrations`, *self*
- `integrations` imports `core`, `shared`
- `app/` imports anything (it's the composition layer — `/portal` renders the platform list, `/sitemap` aggregates everything)

What this rules out:
- A Training Hub component importing from `src/hubs/modeling/`
- The CMS section renderer importing a Training-Hub-specific share helper
- A core formatter pulling in `next/server`

---

## Folder reference

### `src/core/` — pure primitives

No I/O. No `next/*`. No external SDKs. Only types, calculations, and pure functions.

```
src/core/
├── branding/index.ts       # Branding type + defaults
├── calculations/index.ts   # Pure financial calculations
├── db/supabase.ts          # Supabase client factories (only file in core that touches I/O — pragmatic exception)
├── env/                    # env-var loaders (currently empty, reserved)
├── formatters/index.ts     # Pure number / date / string formatters
├── state/index.ts          # Pure state shapes (Zustand store types)
└── types/                  # branding, deck, project, revenue, scenario, settings + next-auth.d.ts
```

`db/supabase.ts` is the lone exception — Supabase client construction is the seam every hub passes through, and pulling it down to the core lets `@shared/auth/nextauth.ts` consume it without crossing tiers.

### `src/shared/` — cross-hub utilities

Anything that needs to be available from more than one hub lives here.

```
src/shared/
├── audit/                  # Admin audit-log writer
├── auth/                   # nextauth.ts, password.ts, captcha.ts, deviceTrust.ts, emailConfirmation.ts
├── cms/                    # getAllPageSections / getPageSections / getTestimonialsForPage
├── comingSoon/             # bypassList.ts (mig 121) + guard.ts (DI primitive shouldGateComingSoon)
├── components/             # Cross-hub UI: Navbar, BrandingThemeApplier, FollowPopup, PreLaunchBanner, layout/, ui/
├── email/                  # sendEmail.ts + templates/ (11 transactional + newsletter)
├── hooks/                  # useInactivityLogout, useRequireAuth, useRequireAdmin, useProject
├── htmlUtils/              # isHtml() — used by every CMS renderer
├── newsletter/             # autoNotify, sender, segments, templates, linkWrap (mig 143)
├── ogFonts/                # Inter font loader for satori OG images
├── seo/                    # canonical.ts + StructuredData / Breadcrumbs components
├── share/                  # shareTo() utility, render engine, useShareTemplate hook, ShareModal
└── storage/                # Supabase storage helpers
```

Notable design choice: `shared/comingSoon/guard.ts` exposes a pure `shouldGateComingSoon({ state, isAllowedThrough, redirectTo })` primitive. Hub adapters at `@training/lib/ensureNotComingSoon` and `@modeling/lib/ensureNotComingSoon` compose it with their hub-specific bypass logic. This is the dependency-inversion pattern that lets shared/ never reach into hubs/.

### `src/hubs/` — per-property code

```
src/hubs/
├── main/         # Marketing site components (CMS section renderers, landing, booking, pricing, newsletter form)
├── training/     # Training Hub — components, lib (assessment, certificates, watch, progress, share, session, liveSessions, appsScript), config (courses)
└── modeling/     # Modeling Hub — components (currently empty), lib (access, comingSoon), config (platforms), platforms/
```

`hubs/modeling/platforms/` is the home for individual modeling platforms. Today only `refm/` (Real Estate) is live; `bvm/`, `cfm/`, `erm/`, `eum/`, `fpa/`, `lbo/`, `pfm/`, `svm/`, `bcm/` are coming-soon stubs gated by config.

### `src/features/` — domain-flat features

Cross-cutting features that don't naturally belong to a single hub OR are large enough that putting them inside a hub would obscure their structure.

```
src/features/
└── marketing-studio/       # Training Hub Marketing Studio (mig 142). Cross-cutting candidate (Modeling Hub may use it later) so it lives here, not under @training/
```

Today this is single-hub (admin-Training-only) but the long-term plan is to share Marketing Studio between hubs. Putting it in `features/` from the start is cheaper than moving it later.

### `src/integrations/` — third-party SDK adapters

```
src/integrations/
├── anthropic/    # (empty — direct SDK use, centralize when reused)
├── resend/       # (empty — direct SDK use, see @shared/email)
├── teams/        # Microsoft Graph client for Teams meeting auto-generation
└── youtube/      # (empty — direct fetch, centralize when reused)
```

The empty folders are reservations. They exist so that when the second consumer of (e.g.) the Anthropic API arrives, the right home is already there.

### `app/` — Next.js routes

The composition layer. Routes in `app/` may import from any internal element — this is the *only* place cross-hub composition is legitimate (e.g. `/portal` renders the platform list across both hubs; `/sitemap` aggregates URLs from training, modeling, and marketing).

Route files may also co-locate their own helper components (`page.tsx` + `Component.tsx` in the same directory). This is allowed by the boundary rules (`app → app`).

---

## Path aliases (`tsconfig.json`)

Use the alias for any new import. The legacy `@/*` resolves to repo-root and is retained because `app/` files use it heavily for `@/src/...` references; new code should prefer the named alias.

| Alias | Resolves to | When to use |
|-------|-------------|-------------|
| `@core/*` | `./src/core/*` | Pure business logic, types, DB client |
| `@shared/*` | `./src/shared/*` | Cross-hub primitives (auth, email, CMS, share, comingSoon guard, components) |
| `@training/*` | `./src/hubs/training/*` | Training Hub code |
| `@modeling/*` | `./src/hubs/modeling/*` | Modeling Hub code |
| `@platforms/*` | `./src/hubs/modeling/platforms/*` | Individual modeling platforms (REFM, BVM, etc) |
| `@main/*` | `./src/hubs/main/*` | Main-site (financialmodelerpro.com) components |
| `@features/*` | `./src/features/*` | Cross-cutting features (Marketing Studio) |
| `@integrations/*` | `./src/integrations/*` | Third-party SDK adapters |
| `@/*` | `./*` | Legacy escape hatch (`@/src/...` still works) |

---

## Boundary lint rules (`eslint.config.mjs`)

`eslint-plugin-boundaries` v6 enforces the three-tier model at lint time. The full ruleset lives in `eslint.config.mjs`; the allow-graph is:

```
core      → core
shared    → core, shared, integ
main      → core, shared, integ, main
training  → core, shared, integ, training
modeling  → core, shared, integ, modeling
platform  → core, shared, integ, modeling, platform
feature   → core, shared, integ, feature
integ     → core, shared
app       → app, core, shared, main, training, modeling, platform, feature, integ
```

The `app → app` self-loop is intentional: route files often co-locate helpers in the same directory (`page.tsx` + `SomeClient.tsx`). Without it the worktree code triggered thousands of false positives.

CI fails on any new cross-hub regression. **Do not relax allow-graph entries to silence a violation** — either fix the violation or add a tracked TODO `eslint-disable-next-line boundaries/dependencies` per `RESTRUCTURE_PLAN.md` Section J Path B. Today only one such suppression exists, in `src/shared/auth/nextauth.ts`, awaiting the deferred NextAuth `authorize()` dependency-inversion follow-up (NextAuth is genuinely cross-cutting because it gates both admin auth and modeling-hub auth).

---

## How to add a new modeling platform

Adding a new modeling platform (say, FP&A — `fpa`) is the most common hub-internal extension. The pattern:

1. **Define the platform.** Add an entry to `src/hubs/modeling/config/platforms.ts`:
   ```ts
   { slug: 'fpa', name: 'FP&A Modeling Platform', status: 'live', ... }
   ```
2. **Scaffold the platform folder.** Mirror REFM's shape under `src/hubs/modeling/platforms/fpa/`:
   ```
   src/hubs/modeling/platforms/fpa/
   ├── components/    # Dashboard, modules, modals
   └── lib/           # export/, modules/
   ```
   Imports inside `fpa/` may use `@core/`, `@shared/`, `@integrations/`, `@modeling/`, and `@platforms/fpa/` (self).
3. **Add a route.** Create `app/fpa/page.tsx` that renders the platform's main shell, wrapped in NextAuth + the Modeling Hub Coming Soon guard at `@modeling/lib/ensureNotComingSoon`.
4. **Wire the navbar.** The Modeling Hub portal at `app/portal/page.tsx` reads `PLATFORMS` from `@modeling/config/platforms` and renders cards for every entry. The new platform appears automatically once its `status` is `'live'`.
5. **CMS sub-page (optional).** Modeling platform sub-pages (e.g. `/modeling/fpa`) are CMS-driven via `modeling-{slug}` `cms_pages` rows. Seed via a migration mirroring `071_cms_modeling_real_estate.sql`.
6. **No shared/ or core/ changes needed** for a new platform. If you find yourself wanting to add cross-hub state for a platform, that's a smell — talk it through before touching shared/.

---

## How to add a new hub

Adding a new top-level hub (a new subdomain, new auth model, separate from training + modeling) is rare but planned for. The shape:

1. **Pick the slug.** E.g. `consulting` for `consulting.financialmodelerpro.com`.
2. **Scaffold the hub.** Create `src/hubs/consulting/` with `components/`, `lib/`, `config/` mirroring the existing two hubs.
3. **Subdomain rewrite.** Add a host-conditional rewrite in `next.config.ts` so `consulting.financialmodelerpro.com/` rewrites to `/consulting`. Existing `/training` + `/modeling` rewrites are the template.
4. **Register the alias.** Add `@consulting/*` → `./src/hubs/consulting/*` in `tsconfig.json`.
5. **Register the boundary element.** Add `{ type: "consulting", pattern: "src/hubs/consulting", mode: "folder" }` to `boundaries/elements` in `eslint.config.mjs`, and add a rule line `{ from: { type: "consulting" }, allow: { to: { type: ["core", "shared", "integ", "consulting"] } } }`. Update the `app` rule's `allow.to.type` array to include `"consulting"`.
6. **Auth model.** Pick one. Modeling Hub uses NextAuth (JWT, 1hr); Training Hub uses a custom httpOnly cookie + localStorage. New hub probably wants NextAuth — register a new provider in `@shared/auth/nextauth.ts` (and use this as a forcing function for the deferred dependency-inversion follow-up).
7. **Coming-Soon gate.** Mirror `@training/lib/ensureNotComingSoon` or `@modeling/lib/ensureNotComingSoon`: a hub-specific composition of the shared `shouldGateComingSoon` primitive with hub-specific bypass logic.
8. **CLAUDE.md scoping table.** Add a row so future Claude sessions know the new hub's task domain.

---

## Open follow-ups

These are tracked here so they survive context-window churn and individual-session amnesia:

- **NextAuth `authorize()` dependency inversion**. `src/shared/auth/nextauth.ts:7-8` imports modeling-hub primitives (Coming Soon state + whitelist gate) directly because the gating logic is hub-specific but NextAuth itself is shared. Slated fix: expose an `authorizeOptions: { extraGates: BypassCheck[] }` opt and have the modeling hub register its gate from `src/hubs/modeling/auth/`. The two `eslint-disable-next-line` lines + the inline TODO are the marker.
- **J.10 — Centralize admin auth into middleware**. Every `app/api/admin/*` route currently re-runs `getServerSession(authOptions)` + role check at the top. Could be hoisted into `src/middleware.ts` with a `/api/admin/:path*` matcher. Estimated 1 day; deferred from Phase 2.x because it changes auth posture and warrants its own phase.
- **CLAUDE.md size**. ~157 KB and dominates working-context budget. Splitting the multi-week session-summary preamble into a `HISTORY.md` is a known follow-up. Defer until the next time CLAUDE.md is opened for substantial editing.
- **Optional: narrow `@/*` to `./app/*`**. Would force every `@/src/...` import to migrate to a hub-scoped alias. Pure churn for cosmetic gain; not recommended unless an aggressive consistency push is otherwise needed.
