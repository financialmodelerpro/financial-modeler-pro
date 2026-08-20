# Modeling Hub, Claude Code Project Brief
**Last updated: 2026-05-12**

Modeling Hub (`app.financialmodelerpro.com`) is the interactive financial modeling workspace. Each modeling discipline lives as a platform with one or more modules. The Hub itself is the wrapper around the platform catalog, admin sync, and shared shell; platform-specific behavior lives in per-platform MDs.
## 2026-08-20h: a signup notification to support, on one sending path

**Every new Modeling Hub registration now emails support. Migration 216 is APPLIED.**

**ONE SENDING PATH.** `src/shared/email/newRegistrationAlert.ts` is the only place this is sent from:
it owns the sender (`FROM.noreply`), the recipient (`support@financialmodelerpro.com`, overridable
via `EMAIL_SIGNUP_ALERT_TO` so a staging deploy can point it somewhere harmless), the failure
behaviour and the logging. It uses the existing `sendEmail` and the shared `baseLayoutBranded`; no
second transport, no second template base.

**A FAILED EMAIL CANNOT FAIL A REGISTRATION.** The dispatcher catches everything and never rethrows,
and the route fires it with `void (async () => {...})()` AFTER the insert has succeeded, so the
signup response never waits on Brevo. Logged under `[reg-alert] sent` with the Brevo message id, or
`[reg-alert] FAILED`, matching the `[sub-email]` convention. The user id is read back rather than
assumed, because the insert may have taken a schema-tolerant fallback; a miss there costs the admin
link, not the email.

**Carries everything asked for:** name, email, phone, city, country, company, job title, the yes/no
in words, the free text IN FULL with its line breaks preserved, the timestamp as UTC (explicitly
labelled, because a bare local time in an inbox read from two countries is a time nobody can act on),
and a button to that user in the admin panel. The subject leads with the qualification
(`[real estate]` / `[not real estate]`), which is the one thing that decides whether a signup is
worth chasing today.

**A DEFECT FOUND AND FIXED DURING THE PASS, worth recording.** Every field here is typed by whoever
is registering and the email goes to an inbox we act from. The first version escaped the table cells
and interpolated the name **RAW** into the intro paragraph and the subject, so a registrant named
`<script>alert(1)</script>` put a live script tag in support's mailbox. Found because a verifier
check of mine was WRONG in a way that exposed it: the check asserted "no raw `<script>` anywhere",
which I assumed was failing because the base layout carried one. It does not (`grep -c` = 0). The tag
was mine. Now every user value goes through `esc()`, and the subject collapses newlines and caps at
80 characters for the name.

**The existing `modelSubmissionAdminAlert` template interpolates its free-text student note WITHOUT
escaping** (`studentNotes.replace(/\n/g, '<br/>')`). Same class, same inbox. NOT fixed here because
it is a different feature and this pass was scoped to signup; logged in
[CLAUDE-TODO.md](CLAUDE-TODO.md).

`verify-signup-alert` **42 NEW**. It RENDERS the template and inspects the output rather than
grepping the source for field names: a grep proves a variable is mentioned, not that its value
reaches the page. Teeth proven by three sabotages, each confirmed to have landed inside the intended
function: dropping the intro escape (1 failure, the real defect), emitting the admin button with no
user record (2), and letting a send failure escape (1).

**TRAINING HUB: recommended, same template, not wired.** See the session report. The template already
handles it (absent fields read "not given", the qualification reads "not asked", the free-text block
is omitted, and the admin button is replaced by a sentence saying why there is none), and it takes a
`hub` discriminator. What stops it being a one-line change is that Training registrations write to
`training_pending_registrations`, NOT to `users`, so there is no admin page to link to and no user id
to carry. That is a decision about where a training signup should be reviewed, not a template
problem.

## 2026-08-20g: registration and platform access. FOUR ITEMS, ONE PASS

**The live blocker was NOT the entitlement gate. It was a routing loop, and it affected every
non-admin, non-whitelisted user regardless of plan.**

### 1. The trial user who could not open the platform

**Diagnosed, then fixed.** `abuzarsadiq.002@gmail.com` had a correct entitlement throughout:
`users.subscription_plan = 'trial'`, `trial_ends_at` a month out, and the `trial` plan grants
modules 1 to 4 plus pdf_export. `isNoPlanLockedOut('trial', false, 'active')` is false, so the gate
would have let them in. `user_platform_subscriptions` is empty and that is CORRECT: `setUserPlan`'s
partial sync is UPDATE-only and never fabricates a row for a trial, and nothing reads store B for
access.

**The loop:** `app/refm/layout.tsx` runs `ensureNotComingSoon()` BEFORE the gate.
`modeling_hub_coming_soon` was `"true"`, the user was not on the two-entry
`modeling_access_whitelist`, so `/refm` redirected to `/signin?bypass=true`. `/signin` sees a valid
session and reads a DIFFERENT key (`modeling_hub_signin_coming_soon`, unset, so false) and redirects
to `/dashboard`, which is the platform selector. **The entitlement gate never ran.**

**Why it surfaced today:** `modeling_hub_launch_date` was 2026-08-20T07:00 and passed, but
`modeling_hub_auto_launch` is `"false"`, so the cron never flipped the gate. The launch date arrived,
the banner switched to its launched message, and the hub stayed shut.

**Fixed two ways.** `modeling_hub_coming_soon` set to `"false"` (the live unblock), and the shared
`shouldGateComingSoon` gained an optional `hasSession` + `signedInRedirectTo` pair so a SIGNED-IN
user is never sent to the sign-in page. Modeling sends them to `/dashboard?hub=coming-soon`. Optional
on purpose: a caller that supplies neither keeps today's single-target behaviour.

### 2. Company and job title were not enforced

**The server validated `name` and nothing else.** Company and job title were checked in the browser
only; **phone, city and country were marked `required` in HTML and checked NOWHERE, on either side**,
then all five were coerced with `?.trim() || null` and inserted. Measured: 4 of 5 users carry a blank
company and job title, three predating the fields and one from today.

**Worth stating plainly: I could not determine how the client was bypassed.** The reported user has
phone, city and country populated, so they used the real form, and the client check for the other two
runs before the fetch. `/api/auth/register` is the only route that inserts into `users`, and its
schema-tolerant retry cannot have fired (another user saved a company through the same path an hour
earlier). The server gap is real and now closed; the client bypass is unexplained and I am not
inventing a mechanism for it.

All seven text fields plus the yes/no are now enforced server-side, whitespace-only rejected, with
the values captured as they are validated rather than asserted with `!` afterwards.

### 3. KSA-first defaults

Phone `+966`, city placeholder `Riyadh`, country defaulting to `SA` and now a **selected value with
a type-to-filter list** rather than free text. **Backed by the existing `src/core/countries.ts`**, the
same 249-entry list the project country field uses: one country list in the codebase, not two.
Existing free-text rows (`"Pakistan"`, `"Saudi Arabia"`) keep working because `countryLabel` and
`resolveCountryCode` resolve a stored NAME as readily as a code. Defaults, not restrictions: nothing
is filtered out, and the verifier asserts that.

### 4. Signup qualification (migration 216, NOT YET APPLIED)

Two required questions: **are you actively working in real estate** (yes/no) and **what do you do**
(two or three lines). Both show on the **admin user record** and on the **pending trial request
card**, where the note renders IN FULL because it is the reason to approve or decline. The yes/no is
**filterable and sortable** in the admin user list.

**`works_in_real_estate` is a NULLABLE boolean, deliberately.** Three states, not two: yes, no, and
"registered before this question existed". A `not null default false` would record an answer nobody
gave on every existing row, and the admin list filters on this column, so it would be filtering on a
fiction. The list shows a dash for that third state, never a blank that reads as "no".

**ONE COPY.** `trial_requests` already snapshots company and job_title, which is one answer stored
twice; this does not extend that. The card reads both answers from the USER row through the existing
join, so the card and the user record cannot disagree.

**Schema-tolerant at every read site**, widest-select first with a fallback: the register route, the
admin user list, the user detail panel and the trial-request queue. That last one matters most, since
it returns an EMPTY QUEUE on any error, so without the fallback a database lacking mig 216 would show
"no pending requests" while requests piled up.

**Training Hub deliberately untouched:** it does not share the component and has no company or job
title fields. A verifier section pins that so a later pass does not "fix" the asymmetry by accident.

`verify-registration-qualification` **56 NEW**, teeth proven by four sabotages, each confirmed to have
landed inside the intended function: signed-in users routed back to `/signin` (1 failure), company
dropped from the server list (1), the phone default reverted to US (2), and the yes/no made
`not null default false` (1). `verify-entitlement-gate` **92**, unchanged.

**STILL OPEN, reported and not built:** making the launch date and the coming-soon gate ONE intention
rather than two settings that can disagree. Proposal in the session report.


> **See also:**
> - [CLAUDE.md](CLAUDE.md), Root project brief, session rules, stack, both-hub auth, envs
> - [CLAUDE-REFM.md](CLAUDE-REFM.md), Real Estate Financial Modeling (live platform)
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Archived feature narratives + phase histories
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, migrations log
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), Routes + components + lib structure

---

## Modeling Platforms (`src/config/platforms.ts`)

| Slug | Name | Status | Brief |
|------|------|--------|-------|
| `real-estate` | Real Estate Financial Modeling (REFM) | Live | [CLAUDE-REFM.md](CLAUDE-REFM.md) |
| `bvm` | Business Valuation Modeling | Coming Soon | (none yet) |
| `fpa` | FP&A Modeling Platform | Coming Soon | (none yet) |
| `erm` | Equity Research Modeling | Coming Soon | (none yet) |
| `pfm` | Project Finance Modeling | Coming Soon | (none yet) |
| `lbo` | LBO Modeling Platform | Coming Soon | (none yet) |
| `cfm` | Corporate Finance Modeling | Coming Soon | (none yet) |
| `eum` | Energy & Utilities Modeling | Coming Soon | (none yet) |
| `svm` | Startup & Venture Modeling | Coming Soon | (none yet) |
| `bcm` | Banking & Credit Modeling | Coming Soon | (none yet) |

Per-platform MDs are created when that platform starts active development. The root scoping table in CLAUDE.md routes platform-specific tasks to the corresponding `CLAUDE-{platform}.md` file.

---

## Platform & Module Admin Sync (P-Sync, 2026-05-07)

**P-Sync (ships):** Closes the loop between three previously disjoint module/platform listings (the static `MODULES` constant in REFM, the legacy `modules` table in admin, the hardcoded marketing `PLATFORMS` config) by adding:
- Two new Supabase tables (`platform_modules` + `platform_module_pages`)
- 9 API endpoints under `/api/platforms/[platformSlug]/modules/...` + `/api/admin/platform-module-pages/...`
- Admin 2-level UI at `/admin/platform-modules`
- Dynamic REFM sidebar fetch (`usePlatformModules` hook with static fallback)
- 3 marketing routes (`/modeling-hub`, `/modeling-hub/[platformSlug]`, `/modeling-hub/[platformSlug]/[moduleSlug]`)

RLS public-read filters `status='hidden'` / `visible=false`; service-role bypasses for admin writes. 60s ISR. 7 commits.

Full commit-by-commit narrative archived in **CLAUDE-FEATURES.md** if needed.

### P-Sync conventions (applies to all downstream platform/module work)

- **Source of truth lives in Supabase, not in TypeScript constants.** M2.1 Revenue and downstream module additions go through `platform_modules` (admin UI) instead of editing `MODULES` in `modules-config.ts`. Static constants stay as bootstrap fallback only.
- **Three-way sync is intentional.** Admin edit → workspace sidebar (`/api/platforms/.../modules`) + marketing site (`/modeling-hub/...`) within 60s ISR. One row update, three surfaces.
- **Page-sections are jsonb, not normalized.** Each marketing section's `content_blocks` holds its own typed shape (`HeroContent` / `FeaturesContent` / `HowItWorksContent` / `CtaContent` / `TestimonialsContent`). Admin edits via JSON textarea.
- **Legacy `modules` table stays** as platforms-storage despite name predating the platform/module distinction. Rename cost > benefit.
- **RLS:** anon role never reads `status='hidden'` modules or `visible=false` page sections. Service-role bypasses for admin writes. No write policies needed for anon.

### P-Sync verifier
```bash
npx tsx scripts/verify-psync.ts                 # P-Sync platform/module admin sync (108 pass / 0 fail / 3 skip)
npx playwright test tests/e2e/psync-flow.spec.ts   # 4 specs
```

---

## Modeling Hub Auth (Modeling Hub-specific bits)

Full auth shape (NextAuth provider, device trust, OTP flow, scrypt password storage, admin bypass) lives in **CLAUDE.md** under "Authentication Systems → Modeling Hub". Key Hub-specific touch points:

- **Subdomain rewrite**: `app.financialmodelerpro.com/` rewrites to `/modeling` (URL unchanged). See `next.config.ts`. Do NOT touch.
- **Clean auth URLs**: `/signin` → `/modeling/signin`, `/register` → `/modeling/register`.
- **Sidebar shell**: every platform consumes the shared shell layout at `src/components/refm/` (folder name retained from REFM origin). Module 1 status pill colors + Inputs/Results sub-tab pattern + FAST blue input style are documented per-platform.

---

## Module display numbering: position, NOT `platform_modules.number` (2026-07-30)

`platform_modules` carries TWO different numbers and they are not interchangeable:

- **`number` is a stable ROUTING id.** `SLUG_TO_COMPONENT_NUMBER` in `src/shared/entitlements/moduleCatalog.ts` maps `slug -> component number -> module_N` feature key. It deliberately never renumbers when an admin reorders or hides a module, which is exactly what makes it safe for routing and WRONG for display.
- **The 1-based position in `display_order` is what users see.** Admin (`/admin/platform-modules` renders `i + 1`, real number only in the row tooltip), the workspace sidebar and Plan Builder all number this way.

**`orderModulesForDisplay()` in `moduleCatalog.ts` is the single source of truth** (drop hidden, sort by `display_order` with `number` as tiebreak, assign 1-based position). `toSidebarNavList`, `deriveModuleFeatureRows` and the public marketing page (`app/modeling/[slug]/page.tsx`) all route through it. Do not re-derive this rule anywhere.

The bug it fixes: the marketing page rendered the raw `number`, so with Portfolio (8) and Market Data (9) hidden it showed "Module 10: Collaborate" and "Module 11: API Access" where admin and the sidebar both showed 8 and 9. Modules 1 to 7 matched only by coincidence, because their routing id happened to equal their position. `verify-psync` pins this with a fixture where position differs from routing number, asserts sidebar and marketing produce identical numbering, and asserts the marketing page no longer contains `number: m.number`.

The marketing page reads `platform_modules` live and falls back to the hardcoded list in `src/hubs/modeling/config/platforms.ts` ONLY when the table is empty. That fallback had drifted to the PRE-SWAP ordering (M6 "Reports & Visualizations", M7 "Scenarios & Sensitivity"); it is now pinned to `modules-config.ts` by a `verify-psync` parity check.

---

## Modeling Hub task scoping

Use this when a task touches the Hub wrapper (sidebar, platform list, admin sync) without diving into a specific platform's calc engine:

| Task | Read ONLY these paths |
|------|-----------------------|
| Platform / module admin sync | `app/admin/platform-modules/` `app/api/platforms/[platformSlug]/modules/` `app/api/admin/platform-module-pages/` `src/lib/modeling/platform-modules/` |
| Hub sidebar / shell | `src/components/refm/` (shared shell) `src/hubs/modeling/` |
| Marketing routes | `app/modeling-hub/` `app/(portal)/modeling-hub/` |
| Hub auth | See CLAUDE.md scoping table → "Modeling Hub auth" |
| Platform-specific (REFM, ...) | See per-platform MD (CLAUDE-REFM.md, ...) |
