# Financial Modeler Pro — Claude Code Project Brief
**Last updated: 2026-04-27.** This session: (**Marketing Studio logo render fix (satori width:auto bug); LinkedIn banner gradient fix; Communications Hub consolidation; Marketing Studio flexibility upgrade earlier in the day**)

## 2026-04-27 session summary

**Marketing Studio logo render fix - satori `width: auto` bug (all 4 templates; no schema change)**: Despite the earlier 2026-04-27 LinkedIn fix that addressed the gradient issue, the logo image still did not render in any template. End-to-end satori 0.26 test reproduced the failure: with `<img style={{ height: '100%', width: 'auto', objectFit: 'contain' }} />` satori emits `<image x="NaN" y="65" width="0" height="0" href="data:image/png;base64,...">` - the image is in the SVG but with **zero width and height, NaN x-coordinate** so it is invisible. Root cause: satori cannot resolve `width: auto` on an `<img>` because it does not decode the base64 data URI to read the image's intrinsic dimensions; it falls back to `width=0, x=NaN` which silently renders a blank space. The flex parent's `height: 100%` also resolves against a height satori cannot infer in the absolute-positioned context. The brand pack returns the correct logoUrl (verified via REST probe - returns the 692KB Supabase storage PNG, 2011x787 native size) and `fetchAsBase64()` succeeds (verified by inspecting the SVG `href` attribute - the data URI is fully present and intact). The bug was purely in the satori-side dimension resolution. Fix: pass the layout zone's `w` and `h` to the img as **explicit pixel values** for both the `width`/`height` HTML attributes AND the inline style, paired with `objectFit: 'contain'` to preserve the logo's native aspect ratio inside the box. Verified end-to-end: satori now emits `<image x="80.56" y="30" width="178.86" height="70" href="data:...">` (the 178.86 width is the contain-fit calculation against the 2.55-aspect logo inside the 220x70 default zone). Applied to all 4 template files: `linkedin-banner.tsx` (Profile logo + Post logo + Quote bottom logo), `article-banner.tsx`, `live-session.tsx`, `youtube-thumbnail.tsx`. The wrapper `<div>` lost its `alignItems`/`justifyContent` props since `objectFit: contain` already handles the centering inside the explicit-pixel img box.

**LinkedIn banner render fix (`linkedin-banner.tsx` + `style-utils.ts`; no schema change)**: The 3 LinkedIn templates (Profile / Post / Quote) shipped 2026-04-24 with two visible bugs: the gradient background showed as solid dark, and the logo image did not render inside the layout box. Root cause: the LinkedIn templates used a `backgroundLayer()` helper that put the gradient on a NESTED `position: absolute, inset: 0` div instead of the OUTER container (the pattern used by Live Session, YouTube, and Article templates). Satori reliably renders gradients on a `display: flex, position: relative` container with explicit `width/height` and `background: <gradient>`, but is brittle when those styles live on an absolute-positioned child. Compounding the issue, the `LogoBox` function-component wrapper added an extra layer of indirection vs the inline `<div><img/></div>` pattern used by the working templates. Fix: refactored all three LinkedIn templates to inline the bg-on-outer-div pattern (matching article-banner / live-session / youtube-thumbnail) and inline the logo render. Also simplified `richBrandBackground()` to a 2-stop linear-gradient (was 3 stops; satori's 3-stop parser is less reliable) and `richBrandHighlight()` to `radial-gradient(ellipse at top right, ..., transparent 60%)` (was `ellipse 60% 70% at 82% 0%`; the explicit-size + explicit-position combo is a known satori failure mode that silently drops the layer). Verified via standalone satori 0.26 render harness that both gradient forms now produce `linearGradient` + `radialGradient` SVG elements. No structural change to the other 3 templates - they already used the working pattern.

**Communications Hub consolidation (`/admin/communications-hub`; no schema change, no migration)**: Four scattered admin tools that all dealt with sending or templating outbound communications were merged into one unified hub following the Certificate Designer pattern (commit `5d81e06`). The four merged surfaces — `/admin/training-hub/communications` (campaigns + history + share-modal copy), `/admin/training-hub/live-sessions/email-settings` (email branding + live-session email templates), `/admin/training-hub/share-templates` (centralized share-button copy + global mention settings), and `/admin/newsletter` (subscribers + compose + campaigns + auto-notifications) — are now four internal tabs on a single page. **Tabs**: `campaigns` (default), `email-settings`, `share-templates`, `newsletter`. URL drives selection via `?tab=<key>`. Each tab is its own component file (`CampaignsTab.tsx`, `EmailSettingsTab.tsx`, `ShareTemplatesTab.tsx`, `NewsletterTab.tsx`) with all logic intact — no behavior changes for users. Auth + `CmsAdminNav` + page header + tab strip live on the parent shell. The four old URLs are now 5-line server `redirect()` pages that 308 to the matching `?tab=...` so any bookmark or external link keeps working. Sidebar lost three entries (Communications, Share Templates, Newsletter) and gained one (Communications Hub, 📬) with `matchPaths: ['/admin/training-hub/communications', '/admin/training-hub/live-sessions/email-settings', '/admin/training-hub/share-templates', '/admin/newsletter']` so it stays highlighted even when a stale link lands the browser on a redirected URL. `/admin/training-hub/live-sessions` page header's "Email Settings" pill now links to `/admin/communications-hub?tab=email-settings`. Newsletter's own internal sub-tabs (Subscribers / Compose / Campaigns / Auto Notifications) stay intact inside the Newsletter tab — kept verbatim per the "load existing functionality unchanged" mandate, even though it produces tabs-within-tabs. The `/admin/training-hub/daily-roundup` page link to the share-templates editor was repointed at the new hub URL. Marketing Studio is intentionally NOT in the hub — it stays at `/admin/training-hub/marketing-studio` because it's a design tool, not a communications tool.

**Marketing Studio flexibility (templates + LayoutEditor + ZoneVisibilityPanel; no schema change)**: Brand-locked stance loosened. Every visible element across the 6 banner templates (LinkedIn Profile, LinkedIn Post, LinkedIn Quote, Live Session, YouTube Thumbnail, Article Banner) is now a named zone in the layout system - admins can drag, resize, AND hide each one. Brand colors and Inter typography remain locked; logo source stays the FMP logo from the brand pack; trainer photos still come from `instructors`.

- **types.ts**: `BannerBase` gains `hiddenZones?: string[]` so per-zone visibility persists alongside `layout` overrides in `content`.
- **style-utils.ts**: new `richBrandBackground(primaryColor, kind)` returns a multi-stop diagonal linear-gradient (single-background, satori-safe); paired with new `richBrandHighlight(kind)` which returns a single-background radial-gradient string. Templates render the highlight as a separate inset div on top of the base gradient when no custom background URL is set, giving the depth-of-field look without depending on satori's multi-layer background parser. Two flavours: `'banner'` (used by 5 templates) and `'thumbnail'` (used by YouTube 16:9). Custom-uploaded backgrounds keep their existing scrim overlay behaviour.
- **All 6 templates rewritten**:
  - Logo is now a sized zone with default `~200x64` to `240x80` (was `28-44px height` fixed - "logo too small in previews" was the third user-reported issue, now ~2x previous height by default + admin can resize further).
  - Every previously-fixed element (logo, brand URL strips, LIVE pill, decorative quote mark, category pill, brand byline, bottom logo, etc.) is converted to a zone with `resizable: true`. Pure decorations - background, accent strips, corner orbs - stay anchored as part of the brand identity.
  - Each template's render skips zones whose key is in `content.hiddenZones`, so unchecking a zone in the sidebar removes it from the PNG.
  - `LogoBox` shared subcomponent in linkedin-banner.tsx anchors logo image to `objectFit: contain, height: 100%, width: auto` so it scales naturally with admin-resized box.
  - Final zone counts: LinkedIn Profile 5, LinkedIn Post 6, LinkedIn Quote 4, Live Session 6, YouTube Thumbnail 6, Article Banner 5. All zones `resizable: true` (CTA badges were the only previously non-resizable ones).
- **`<ZoneVisibilityPanel>`** (new in `studio-shared.tsx`): checklist in every studio editor's controls sidebar showing one row per template descriptor with a checkbox. Unchecking adds the zone key to `hiddenZones`. Hidden rows show with red background + line-through label + `HIDDEN` badge. "Show all" link clears the list. Wired into LinkedInBannerStudio + LiveSessionBannerStudio + YouTubeThumbnailStudio + ArticleBannerStudio (all 4 client tabs).
- **LayoutEditor**: gains a `hiddenZones?: string[]` prop; renders hidden zones with a dotted gray border + low-opacity gray fill + `HIDDEN` prefix on the label chip. Hidden zones stay clickable + draggable so admin can reposition them while invisible, then un-hide via the sidebar.
- **No new packages, no schema change, no migration**. All flexibility lives in the existing `content.layout` (LayoutOverrides) + new `content.hiddenZones` (string[]) - both stored in the existing `content` JSON field on the in-memory state of each studio editor (the studio doesn't persist designs; PNGs download immediately). Brand restrictions kept: colors, typography, logo source, trainer photo source. Brand restrictions removed: position locking, size locking, element visibility.

## Historical (prior sessions)

### 2026-04-27 SEO fix (earlier in same day)

**SEO redirect-error fix (next.config.ts only, no schema change)**: Google Search Console reported "Redirect error" against `https://financialmodelerpro.com/training-sessions`, `/training`, and `/contact`. Root cause was a host-match bug, not a redirect bug per se. Vercel's project domain config sets `www.financialmodelerpro.com` as the primary domain, so apex `financialmodelerpro.com` auto-redirects to www at the edge BEFORE next.config.ts runs. The redirect rules used `has: [{ type: 'host', value: 'financialmodelerpro.com' }]` (apex literal), which never matched the canonical www host. Symptoms (verified via curl with the Googlebot UA against production):

- `/training-sessions`: apex 307 → www **200 OK** (page rendered on www instead of forwarding to learn). The page's canonical tag pointed at learn while the URL stayed on www, which Google read as a canonical-vs-served-content conflict.
- `/training`: apex 307 → www 307 → learn — a 2-hop chain, both 307 (temporary), so Google never settled on a canonical.
- `/contact`: apex 307 → www 200 (correct destination, served on main). The "redirect error" here is downstream: the canonical tag is `https://financialmodelerpro.com/contact` (apex), which itself 307s to www. A canonical that immediately redirects is the textbook trigger for that error.

Fix in `next.config.ts`: introduced `MAIN_HOST_RE = '(www\\.)?financialmodelerpro\\.com'` and switched every `has: [{ type: 'host', value: 'financialmodelerpro.com' }]` rule to use that regex so the rule fires on both apex and www. Also flipped `permanent: false` (307) to `permanent: true` (308) on every main→subdomain canonical move (`/training-sessions`, `/training-sessions/:id`, `/training/:path*`, `/verify/:id`, `/refm/:path*`, `/modeling/:path*`) so Google understands the canonical host is the subdomain. The `/training/:path*` rule's old `missing: [{ host: 'learn.financialmodelerpro.com' }]` form was replaced with the same explicit `has: MAIN_HOST_RE` so the rule reads consistently with the others. Sitemap was already clean from the 2026-04-24 fixes (`learn.*` for training/training-sessions/cert pages, `MAIN_URL` only for genuinely-main pages, and `home`/`about`/`modeling-hub` excluded from the cms_pages branch). After re-deploy, the redirect chains become:

- `/training-sessions`: apex 307 (Vercel) → www 308 → learn 200
- `/training`:          apex 307 (Vercel) → www 308 → learn 200
- `/training-sessions/<id>`, `/verify/<id>`, `/refm/*`, `/modeling/*`: same pattern

The `/contact` "redirect error" is **not** fixable in next.config.ts because the canonical tag is built from `NEXT_PUBLIC_MAIN_URL` (currently `https://financialmodelerpro.com`, the apex form). To clear it, either flip Vercel's primary domain to apex (so the redirect goes the other way: www → apex, and apex serves directly with a self-canonical), OR update the `NEXT_PUBLIC_MAIN_URL` env var to `https://www.financialmodelerpro.com` so the canonical tag matches the actually-served URL. Both are Vercel dashboard actions outside this commit. Recommended Vercel-side follow-up after re-deploy: re-submit affected URLs in Search Console (Live Test → Index Now) so the new 308s are picked up within 24-48h instead of waiting for the next natural crawl.

## Historical (prior sessions)

### 2026-04-24 session summary

**Admin auth — unified /admin entry (migrations: none; files deleted: `app/admin/login/page.tsx`, `app/admin/login/LoginForm.tsx`, `app/login/page.tsx`, `src/lib/shared/safeAdminCallback.ts`, **`proxy.ts`** (commit `8f43b89` — real root cause of the persistent loop, see below); files created: `app/admin/AdminLoginClient.tsx`)**: collapsed the 4-page welcome/intermediate chain (`/admin` welcome -> `/admin/login` welcome -> `/admin/login` form -> `/login` callbackUrl form) into a single server-component entry at `/admin` that renders the credentials + OTP form inline for unauthed and 307s authed admins to `/admin/dashboard`. Admins now go through the SAME trusted-device OTP flow as students (the `authorize()` bypass that skipped device-verify for `role='admin'` was removed; email-confirmation skip kept because admin rows are pre-confirmed). NextAuth `pages.signIn` + `pages.error` both `/admin`; new `callbacks.redirect` coerces auth-cycle paths to `/admin/dashboard`. 17 admin pages + `useRequireAuth` + `useRequireAdmin` hard-coded `router.replace('/login')` were all updated to `/admin` (loop hazard eliminated). **Nine progressive redirect-loop fix attempts** (`edb5772`, `a2ffd62`, `36b0fb1`, `4818896`, `697d018`, `5ee5648`, `66fb42e`, `c5a24f4`, `8f43b89`) were needed because the symptom kept mutating: first `next.config.redirects({ permanent: true })` was emitting 308 without `Cache-Control: no-store` (browsers cached the 308s from older broken deployments even in incognito), then once that was fixed the loop persisted as `/login?callbackUrl=%2Fadmin` in production despite no code path in `src/middleware.ts` or `next.config.ts` being able to produce it. **Real root cause (commit `8f43b89`)**: stale `proxy.ts` at the project root, added 2026-03-17 in commit `e315c3f` and never removed. It was a NextAuth `withAuth` wrapper with `pages.signIn: '/login'` + `loginUrl.searchParams.set('callbackUrl', pathname)` + matcher `/admin/:path*` — bit-for-bit the response shape we were chasing. Even though Next.js shouldn't auto-pick `proxy.ts` (only `middleware.ts` at root or `src/middleware.ts`), the production response matched its output exactly; deleting it removed the only file in the codebase that imported `next-auth/middleware` or used `withAuth` (verified by grep). Belt-and-suspenders defensive stack on top: middleware (`src/middleware.ts`) owns `/login`, `/admin/login`, `/admin`, and `/admin/:path+` with 307 + `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache` + `Expires: 0` + query params dropped on forward (commits `697d018`, `66fb42e`); `vercel.json` adds `CDN-Cache-Control: no-store` + `Vercel-CDN-Cache-Control: no-store` on `/admin`, `/admin/:path*`, `/login` so Vercel's edge layer specifically (which ignores standard `Cache-Control` for some 3xx responses) cannot cache a stale redirect (commit `c5a24f4`); friendly branded `app/not-found.tsx` replaces Next.js's default "This page could not be found" so typos like `/admi` land somewhere useful (commit `5ee5648`). Required Vercel dashboard action after this push: redeploy with **build cache disabled** so no cached artifact reintroduces the deleted file.

**Platform Analytics dashboard (new)**: `GET /api/admin/analytics?range=7|30|90|all` fans out 8 parallel Supabase queries (meta, enrollments, assessments, watch history, certs, live_sessions, session_registrations, session_watch_history) and aggregates server-side. `/admin/analytics/page.tsx` renders all 7 metrics: total students + daily signup growth (area chart w/ cumulative overlay), active 7d/30d tiles, per-session funnel (enrolled -> watched -> attempted -> passed distinct emails), biggest drop-off callout, certification rate, head-to-head course comparison (3SFM vs BVM stat cards + grouped bar chart), live-session attendance (registered / admin-marked attended / watched / completed). `range` filters only the growth-trend window; funnel / course / cert / live-session sections are cumulative. Responsive auto-fit grids + scrollable tables on narrow viewports. Sidebar `Analytics` nav entry repointed to `/admin/analytics`; `/admin/training-hub/analytics` is now a redirect.

**Live session UX rebuild (2026-04-23)**: (a) dashboard `LiveSessionCard` dropped its inline Register button - all registration happens on the detail page now, card is click-through only (one canonical commit surface). Post-register shows "View & Join Session" label. (b) Detail page Register card moved to the TOP via new `CoursePlayerLayout.topContent` slot (previously at the END). (c) Join Session button appears IMMEDIATELY after registration - removed the 30-min-before-start gate from `joinLinkAvailable` server-side so students can paste the Teams URL into their calendar / pre-test their mic; yellow warning band under Join explains `Session starts {date} at {time}`. (d) Multi-provider Add-to-Calendar component (`src/components/training/CalendarDropdown.tsx`): Google / Outlook / Apple (.ics) / Yahoo + .ics-fallback; organizer baked into event description as "Hosted by ..." since no provider carries an organizer URL field. Replaces the single `.ics` icon download on dashboard card AND detail page. (e) `handleRegister` now refetches `/register?email=` immediately after POST success so the Join button surfaces without waiting for the 30s poll. (f) `redirect` parameter preserved end-to-end through signin + register: `/signin?redirect=X` honoured by `SignInForm`, `RegisterForm`, `/api/training/register` (encodes into confirmation link as `&redirect=`), `/training/confirm-email` (forwards), `/api/training/confirm-email` (appends to `/signin?confirmed=true`). Public `/training-sessions/[id]` page for unauthed visitors gains a prominent "Sign In to Register" + "Create Account to Register" card replacing the thin "Sign in to earn points" banner. Hero CTAs rewritten so unauthed visitors scroll to the upcoming-sessions section before committing.

**Watch-page cleanup (2026-04-23)**: (a) `CoursePlayerLayout` per-page session sidebar was REMOVED - the full 240px navy rail + mobile off-canvas drawer + "Sessions (N)" pill are gone. Replaced with a single `← Back to {course}` button in `CourseTopBar` driven by existing `backUrl` + `backLabel` props. (b) Video wrapper `max-width: min(100%, calc((100vh - 200px) * 16/9))` keeps the 16:9 frame inside the viewport on standard desktops (post-sidebar removal the video was growing to the full content width). (c) Sub-header switched from `position: sticky` to `position: fixed` with runtime `ResizeObserver` measurement of the main `TrainingShell` nav so the bar sits cleanly below it regardless of nav size; z-index 140 overrides main nav (150) in the edge case of overlap. Main nav restored to `minHeight: 56` (was briefly locked to `height: 56`) so it reads consistently with the rest of the platform. (d) Mark Complete gate simplified to `canMarkComplete = bypassActive || thresholdMet` (the redundant `nearEnd` requirement was hiding the button from returning students who had already cleared threshold but hadn't scrubbed to the end of the video).

**Training Hub registration (2026-04-23)**: OTP-step removed from `RegisterForm` - single confirmation-link email replaces the prior dual-email flow. Phone number is now REQUIRED for new signups: `PhoneInput` renders with `required`, client + server both validate concatenated `phoneCode + phoneLocal` against `^\+[1-9]\d{6,14}$` (E.164), value lands in `training_pending_registrations.phone` -> `training_registrations_meta.phone` on confirm. **Migration 139** declares the column with `ADD COLUMN IF NOT EXISTS` for rebuild reproducibility. NULL stays valid for ~9 pre-collection legacy rows. Admin students page now displays phone (click-to-call `tel:` link) and the search bar matches phone too.

**Test account purge (2026-04-23, migration 140)**: pre-launch test account `FMP-2026-0037` / `pacemakersglobal@gmail.com` removed from all 7 tables via service-role script with `admin_audit_log` trail (`action='training_account_purge'`, audit id `e45c3a81-da3e-46af-8430-31671244eac6`). Migration 140 mirrors the cleanup with FK-safe idempotent deletes so staging + local rebuilds land in the same state.

**BVM attachments scoping (2026-04-23, migration 141)**: `/admin/training/[courseId]/page.tsx` decided the tab_key prefix by checking `courseId?.toLowerCase() === 'bvm'`, but the page is reached via `/admin/training/<UUID>` (the course list links to `c.id`), so the comparison was always false and every BVM upload landed on `3SFM_S{display_order}` / `course='3sfm'`, colliding with real 3SFM session attachments. Code fix: derive prefix from the loaded `course.category` instead. Migration 141 re-tags three production rows (FMP_BVM_DCF / Comps_Training / Comps_Template) from `3SFM_S{1,4,5}` to `BVM_L{1,4,5}` and updates `course='bvm'`; audit trail captured (`action='course_attachments_repair'`, audit id `13c9ec41-ea74-44d2-a253-eae00901c553`). Defense-in-depth: `POST /api/admin/attachments` now validates that `course` matches the `tab_key` prefix (`BVM_` -> `'bvm'`, `3SFM_` -> `'3sfm'`, `LIVE_` -> `'live'`) and rejects mismatches with 400.

**Admin Communications rewrite (2026-04-23)**: `POST /api/admin/training-hub/communications` rebuilt from scratch. Previously delegated to Apps Script `sendAnnouncement` which sent raw text with no brand wrapper, no logo, no signature, and silently logged a fake `'sent'` status when Apps Script was unreachable. Now: Resend `batch.send` chunked at 100 with 200ms stagger, each message wrapped in `baseLayoutBranded()` so the FMP logo header + `signature_html` + `footer_text` + `primary_color` from `email_branding` apply uniformly. Standalone URL lines render as gold CTA buttons (Outlook-safe table layout), inline URLs become teal underlined links, paragraph spacing tightened. Tokens `{name} / {full_name} / {reg_id} / {email}` resolved server-side per recipient from `training_registrations_meta` (one `IN` query for the whole batch). Custom-list sentinels (`name=email`, `registrationId=email`) detected and dropped so unknown recipients don't echo their email as their name. `training_email_log.status` now captures real per-recipient sent/failed outcome. Three pre-built re-engagement templates (Never Started, Stalled, Almost Done) auto-fill subject + message on group select with Ahmad's voice; `{name} ({reg_id})` greeting; trailing hardcoded "Ahmad" sign-off removed (branded signature from `email_branding.signature_html` is the single source of truth). Dropout-group filtering uses a single eligible set (`emailConfirmed && !certificateIssued`) and partitions by last_activity + passed-session counts from `studentRoster` (new fields: `emailConfirmed`, `lastActivityAt`, `totalCourseSessions`). Fixed 65% Almost Done threshold (was 80% with wrong denominator).

**Sidebar nav iteration (2026-04-24, commits `df3d321` + `d58adfc`)**: Platform Analytics nav entry was first promoted to a top-level slot under Dashboard with a 📈 icon (`df3d321`) because it had been buried in the middle of the long Training Hub section with a 📊 icon that duplicated the "Overview" row. Per follow-up, the entry was moved back into the Training Hub section, immediately after Overview and before Live Sessions (`d58adfc`). Final position: `Training Hub > Overview > Platform Analytics > Live Sessions > ...`.

**Certificate Designer hub (2026-04-24, commits `11fa8c0` + `5d81e06`)**: Four sibling sidebar items in the Training Hub section that all belonged to the certificate workflow (Certificates list, Cert Verification, Badge Editor, Transcript Editor) plus the unlinked `/admin/certificate-editor` were collapsed into a single new page at `/admin/certificate-designer` with four internal tabs: **Templates** (uploads for 3SFM/BVM cert PDFs + 3SFM/BVM badge PNGs), **Certificate Layout** (drag-position text fields on the cert PDF), **Badge Layout** (Cert ID + Issue Date overlay on badge PNG), **Transcript Layout** (header drag-positioner + body/footer settings). `?tab=<key>` drives selection (default `templates`). Auth + `CmsAdminNav` + page header live on the parent shell; each tab is a self-contained component. The four old URLs (`/admin/certificates`, `/admin/certificate-editor`, `/admin/badge-editor`, `/admin/transcript-editor`) are now 5-line server components that `redirect()` to the new page with the matching `?tab` so any bookmarks keep working. The first attempt (`11fa8c0`) added a surface-only `<CertificatesHubTabs />` strip across the five host pages and kept them standalone; the rebuild (`5d81e06`) replaced that with the real merge into one page. **FIX 2 in same commit**: removed the duplicate "Issued Certificates" / "Sync from Apps Script" table that lived at the bottom of the templates page since that data is the canonical view of `/admin/training-hub/certificates`. Templates tab is now upload-only. The issued-list page (`/admin/training-hub/certificates`) keeps its own "Certificates" sidebar entry and its own page (revoke / force-issue / eligible-but-not-issued safety net) - unchanged. Sidebar gains a new "Certificate Designer" entry directly under "Certificates" with `matchPaths: ['/admin/certificates', '/admin/certificate-editor', '/admin/badge-editor', '/admin/transcript-editor']` so it stays highlighted even when a stale link lands the browser on one of the redirected URLs (the new `matchPaths?: string[]` field on `NavItem` was added in `11fa8c0` to support this; the highlight matcher checks it after the exact-href match).

**SEO redirect / canonical fixes (2026-04-24, commit `f6e5bdc`)**: Google Search Console reported "Page with redirect" against one URL and "Discovered - currently not indexed" against 14 pages on `financialmodelerpro.com`. Two real bugs underneath: (1) `/training-sessions` (list) and `/training-sessions/[id]` (detail) set `alternates.canonical = MAIN_URL/training-sessions...` but `next.config.ts` redirect rules 307 main-domain hits to LEARN, so the canonical Google was told to index was itself a redirect — which is exactly the "Page with redirect" pattern. Fix: canonical + `og:url` now resolve to `LEARN_URL/training-sessions...` matching where the page is actually served, and the sitemap entries for the list page and every `/training-sessions/<id>` row also moved from MAIN to LEARN. (2) Legal pages (privacy-policy / terms-of-service / confidentiality) only landed in the sitemap via the `cms_pages WHERE status='published'` branch — fragile if a row drifts. Added explicit fallback entries (low priority, yearly cadence) and a final dedup-by-URL pass so the cms_pages branch still wins on `lastModified` when the row exists. Also wired `CourseJsonLd` for 3SFM and BVM on the `/training` landing page (the helper existed but wasn't being called); `EventJsonLd` was already wired on `/training-sessions/<id>`, `ArticleJsonLd` on `/articles/<slug>`, `OrganizationJsonLd` + `WebSiteJsonLd` in the root layout. `robots.txt` + Search Console / Bing verification meta tags were already in place. Audit also surfaced that the `/about` 308 redirect to `/about/ahmad-din` is intentional and that no internal links point to bare `/about` (only `next.config.ts` references it).

**Marketing Studio rebuild from scratch (2026-04-24, commit `0e65d54`, migration 142)**: The Phase 1.5 freeform canvas editor (migrations 100-102) was deleted entirely and replaced with a focused template-driven Training Hub admin tool at **`/admin/training-hub/marketing-studio`** (was `/admin/marketing-studio`). The canvas was a misfit: too much rope for admins, no brand enforcement, easy to ship off-brand assets. The new tool is the opposite — 4 fixed asset types (LinkedIn Banners with 3 variants, Live Session Banner, YouTube Thumbnail, Article Banner), brand pack baked in, fill the fields and download. **Asset types**: LinkedIn Banners (Profile 1584×396 / Post 1200×627 / Quote 1200×627), Live Session Banner (1200×627, auto-fills from `live_sessions` row: title, datetime, timezone, duration, instructor; badge defaults to "LIVE SESSION" or "NEW RECORDING" based on `session_type`), YouTube Thumbnail (1280×720, auto-fills title from a session pick or accepts custom), Article Banner (1200×630, auto-fills title + category from `articles` row). **Shared rules (enforced, not optional)**: trainer photo + name + title pulled from `instructors WHERE is_default=true` (Ahmad Din), not editable in any template; FMP logo pulled from `cms_content.header_settings.logo_url`, fixed position per template; primary color from `email_branding.primary_color` drives every gradient and accent via `lighten()`/`darken()` helpers in `image-utils.ts` — single-color palette enforced across all 4 asset types. **Asset library**: upload PNG/JPEG/WebP backgrounds (max 10 MB) into the new `marketing-assets` storage bucket; backgrounds appear as picker thumbnails in every editor; selection overlays a 55-70% navy scrim so text readability is guaranteed; rename + delete supported; storage object cleanup on delete. **Render**: single dispatcher route `POST /api/admin/training-hub/marketing-studio/render` that takes `{ type, content }` and returns `next/og` `ImageResponse` PNG at the template's fixed dimensions — server-side, deterministic, same output across machines and browsers; uses Inter via the existing `loadOgFonts()` helper for font consistency with the rest of the OG image pipeline. **Migration 142**: `DROP TABLE marketing_designs CASCADE`, `DROP TABLE marketing_brand_kit CASCADE`, `CREATE TABLE marketing_uploaded_assets (id UUID PK, name TEXT, storage_path TEXT UNIQUE, url TEXT, mime_type TEXT, file_size INT, width INT, height INT, uploaded_by TEXT, timestamps)`, `INSERT INTO storage.buckets ('marketing-assets', public) ON CONFLICT DO NOTHING` + public-read SELECT policy. **Net code: -4464 / +2053 lines**. New code lives in `src/lib/marketing-studio/` (types, brand fetcher, image-utils, 4 template renderers under `templates/`), `app/admin/training-hub/marketing-studio/` (page shell + 5 tab components), `app/api/admin/training-hub/marketing-studio/` (render, brand, live-sessions, articles, uploads). **Sidebar**: removed "Marketing Studio" from the Content section; added under Training Hub between Communications and Share Templates. **Modeling Hub will get its own separate Marketing Studio later** at a different path — this build is admin/Training-Hub-only, role-gated on every API + page, NOT accessible to students.

**Marketing Studio multi-instructor + photo upload + drag-resize (2026-04-24, commit `b0823b9`, no schema change)**: Three connected upgrades on top of the rebuild that flexed the brand-locked-only stance back toward "still on-brand but movable". (1) **Instructor photo upload** — `/admin/training-hub/instructors` Photo URL row gained a circular preview swatch + "Upload Photo" button + Remove button. POSTs to existing `/api/admin/media` (cms-assets bucket), accepts PNG / JPEG / WebP up to 10 MB, auto-fills the URL on success. URL paste-input still works. (2) **Multi-instructor selection** — every banner content type gained `instructorIds: string[]`. New `<InstructorPicker>` shared component is a scrollable checklist of active instructors with photo thumbnails, names, titles, `(default)` badge, and selection-rank chips (`#1`, `#2`, `#3`) that show render order. New API `GET /api/admin/training-hub/marketing-studio/instructors` returns `active=true` rows ordered by `display_order`. The Live Session editor's session-pick now also auto-fills `instructorIds` from `live_sessions.instructor_id` (was using legacy `instructor_name`/`instructor_title` text columns). Templates render a single big trainer card when length=1, a horizontal row of up to 4 cards when length≥2 (LinkedIn Post + Live Session). YouTube Thumbnail + Article Banner use the FIRST picked instructor only (template real-estate constraint; picker hint calls this out). Empty list = falls back to default trainer from brand pack via `resolveInstructors()`. New `loadInstructorsByIds(ids[])` in `brand.ts` preserves admin pick order. Render route fetches each instructor's photo as base64 in parallel and passes a `Record<id, dataUri>` to every template. (3) **Drag + resize layout editor** — every template now exports a `TemplateLayout` (canvas + `LAYOUT_DEFAULTS` rect per zone + descriptors with `resizable: bool`). Templates were refactored to absolute-position their movable zones over a fixed background/header/footer scaffold. Same `mergeLayout(defaults, content.layout)` runs server-side (satori) and client-side (drag overlay) — single source of truth, no DRY violation. New `<LayoutEditor>` shared component overlays drag-and-resize boxes on the server PNG: move = drag anywhere on the box, resize = drag right edge / bottom edge / SE corner (resizable zones only). Mouse delta in screen-px is divided by displayed scale to get canvas-px delta; `clampRect()` keeps zones inside the canvas. Auto-render hook `useAutoRender` (350ms debounce) replaces the explicit "Generate Preview" button: any state change re-fetches the PNG; optimistic ghost rect during drag means motion feels instant. **Per-template movable zones** (logo + brand strips intentionally stay anchored): LinkedIn Profile (headline / subtitle / cta / trainerCard), LinkedIn Post (headline / subtitle / cta / trainerStrip), LinkedIn Quote (quoteBlock / trainerBadge), Live Session (headline / metaRow / cta / instructorStrip), YouTube Thumbnail (badge / title / subtitle / trainerCircle), Article Banner (eyebrow / title / authorBadge). Reset Layout button per editor wipes overrides back to defaults; only the diff vs defaults is persisted in `content.layout` (compact JSON). **No new packages** — drag handles use plain `mousedown`/`mousemove` listeners, no `react-rnd` dependency reintroduced. **No schema change** — uses the existing `instructors` table (with the existing `photo_url` column) and `live_sessions.instructor_id`. Net code: +1228 / -430 lines across `LayoutEditor.tsx`, `InstructorPicker.tsx`, `layout.ts`, the four refactored templates, the four refactored studio editors, brand loader, and render route.

**Vercel build fix - sharp out of client bundle (2026-04-24, commit `0e2129a`, no schema change, new file `src/lib/marketing-studio/style-utils.ts`)**: The `b0823b9` push broke the Vercel build with `Module not found: Can't resolve 'child_process'` plus `node:crypto` / `node:events` / `fs` UnhandledScheme errors. Trace: `sharp -> image-utils.ts -> templates/youtube-thumbnail.tsx -> YouTubeThumbnailStudio.tsx (use client) -> page.tsx`. Root cause: client studio editors needed to import `LAYOUT_DEFAULTS` constants from each template file so `<LayoutEditor>` could draw drag boxes at the right starting positions. Webpack tree-shakes individual exports but still walks every top-level `import` in any file it bundles into a client component. The template files imported `lighten` / `darken` / `formatSessionDateTime` from `image-utils.ts`. That file's first line was `import sharp from 'sharp'` — a Node-native module that uses `node:child_process`, `node:crypto`, `node:events`, plus `child_process` / `fs` from `detect-libc`. Webpack tried to bundle those for the browser and exploded. **Fix**: split `image-utils.ts` along its dependency boundary — new file `src/lib/marketing-studio/style-utils.ts` holds the three pure helpers (`lighten`, `darken`, `formatSessionDateTime`) with zero Node deps and is safe to import from `'use client'` modules; `image-utils.ts` keeps only `fetchAsBase64`, the SVG→PNG conversion that requires `sharp`, and is imported by the server render route only. All four templates updated to import the helpers from `style-utils.ts`. Both files now have a comment block at the top explaining what belongs where so this doesn't get re-introduced. Verified locally: `npm run type-check` clean, `npm run build` produces all 80+ routes with no compile errors and no `sharp` in the import trace for any client component.

**Sitemap /home deny-list (2026-04-24, commit `d27b7f9`, no schema change)**: Search Console reported `/home` as a "Page with redirect" issue. Trace: `app/sitemap.ts` line 96-103 (the cms_pages branch) blindly emitted `${MAIN_URL}/${slug}` for every published `cms_pages` row. The `cms_pages` table has a row with `slug='home'` (where the home page CMS content is managed for the page-builder admin), so `/home` was appearing in the sitemap. The home page is canonically served at `/` (via `app/(portal)/page.tsx`); `/home` either duplicates that content or 3xx's somewhere (no code-level redirect found in `next.config.ts` or `src/middleware.ts` — likely a Vercel dashboard rule, or Google flagging the duplicate-content as a redirect-style issue). Either way, `/home` shouldn't be in the sitemap. The page-builder admin already special-cases `slug==='home'` to link to `/` instead of `/home` (line 1700 of `app/admin/page-builder/[slug]/page.tsx`); the sitemap just didn't get the memo. **Fix**: added `SKIP_SLUGS = new Set(['home', 'about', 'modeling-hub'])` to the cms_pages loop. Two other slugs land on redirects when emitted as `${MAIN_URL}/${slug}`: `about` (308 → `/about/ahmad-din` via `next.config.ts` line 135) and `modeling-hub` (308 → `/modeling` via line 132). Both excluded for the same reason. Comment block at the cms_pages branch documents which slugs are excluded and why so a future contributor adding a new redirect in `next.config.ts` knows to update the list. After re-deploy + re-submit in Search Console, `/sitemap.xml` will no longer contain `/home`, `/about`, or `/modeling-hub`; the "Page with redirect" warning should clear on the next crawl (typically 1-2 weeks).

---

## Historical (prior sessions)

**2026-04-22**: Teams calendar integration rebuild + announcement reliability Modeling Hub admin post-login bypass fixed (`ensureNotComingSoon('modeling')` + `/modeling/signin` + `/modeling/register` all now honour NextAuth admin role / whitelist; `/modeling/dashboard` bounce-back uses `/signin?bypass=true` so stale sessions can re-auth instead of landing on "Launching Soon"). Course player sidebar on `/training/watch/*` made collapsible: desktop toggle (240px ↔ 64px) persisted to `localStorage['fmp_player_sidebar_collapsed']`, mobile off-canvas drawer opened via "Sessions (N)" pill; auto-closes on session navigate. Platform Walkthrough Video feature: admin pastes URL in `/admin/training-settings` (new `platform_walkthrough_url` key, stored in existing `training_settings`), gold-gradient "Watch Platform Walkthrough" button lands on the dashboard hero right column with a fullscreen embedded modal (youtube-nocookie autoplay for YT, generic iframe fallback with "Open in new tab" rescue for other hosts). **Mobile video player was missing** on `/training/watch/*` because the Screen-2 wrapper set `aspectRatio: 16/9` on top of YouTubePlayer's own padding-bottom trick, collapsing to 0 dimensions on narrow viewports - fixed by replacing the wrapper with `width: 100%, background: #000` and auto-opening videoOpen on mobile so the video is the first content the student sees; CourseTopBar action row now `flexWrap: wrap` to stop horizontal overflow on 375px. **Teams calendar integration rebuild (two rounds)**: first commit 698f991 switched `createTeamsMeeting` → `createCalendarEventWithMeeting` (POST `/users/{id}/events` with `isOnlineMeeting:true` + `onlineMeetingProvider:"teamsForBusiness"`), added `updateCalendarEvent` + `deleteCalendarEvent` + try-then-fallback wrappers `updateMeetingOrEvent` / `deleteMeetingOrEvent` that recover old `/onlineMeetings` IDs on 404, new `toGraphDateTime` helper converts UTC ISO → Graph `dateTimeTimeZone` using `sv-SE` locale formatting with `Asia/Karachi` default. Requires Azure `Calendars.ReadWrite` (Application) with admin consent - added to the tenant app by Ahmad. Second commit 8db26e8 fixed two follow-up bugs: (a) calendar entry had NO visible Join button because sending a custom `body.content` replaced Outlook's auto-generated Teams join block (underlying `onlineMeeting.joinUrl` existed, just not rendered) - removed `body` from POST + PATCH so Outlook builds its canonical event body and retains the Join button even on edits, (b) host received NO invitation email because `attendees: []` made Outlook treat the event as a private appointment - now sends `attendees: [{ emailAddress: { address: TEAMS_HOST_USER_EMAIL, name: 'Ahmad Din' }, type: 'required' }]` which fires the standard "Microsoft Teams meeting" invite from Outlook (self-invite pattern under application credentials; no calendar-entry duplicate). Dead `buildEventBody` helper deleted. **Live session announcement reliability** (migration 138): `announcement_send_log` stored aggregate counts + only the first failure's message, and the route fired 10 parallel `emails.send` calls per batch via `Promise.allSettled` which burst past Resend's per-second rate limit (5-of-9 partial-failure pattern). Now `sendEmailBatch()` in `src/lib/email/sendEmail.ts` wraps `resend.batch.send([...])` (one rate-limit slot per 100 emails). New child table `announcement_recipient_log` (FK to `announcement_send_log.id` with cascade delete, `status` CHECK: pending/sent/failed/bounced/complained, `resend_message_id`, per-row `error_message`, partial index on failed rows for fast retry queries). Notify route POST seeds recipient rows as 'pending' before the batch fires, UPDATEs each to sent/failed from the response, recomputes aggregate counts from the recipient rows so retries reflect reality. New POST modes: `recipientEmails: string[]` (explicit picker allowlist), `retrySendLogId: string` (re-attempt only failed/bounced rows of a prior dispatch in place, reuses the same send_log row). Course filter `target: '3sfm'|'bvm'|'all'` now actually wires through `training_enrollments` JOIN (migration 132) - the "decorative filter" caveat in the route is gone. GET extended with `?sendLogId=X` mode to fetch per-recipient rows. Admin modal fully rebuilt: recipient picker with search + course pills + per-row checkboxes + "Send to myself" + "Select all (filtered)" + "Clear selection" + "Preview to my inbox", after-send switches to a per-recipient status table with pills + CSV export + "Retry N Failed" button that targets only failed/bounced rows. **Announcement email leaked Teams join URL** to every recipient (the "Direct join link: <url>" footnote) - removed from `liveSessionNotificationTemplate`, replaced with neutral copy "Register to get the join link, calendar invite and session materials"; registered students still receive the link via `registrationConfirmationTemplate` + reminder templates which are unchanged.) **Prior session stays documented for historical context (2026-04-21)**: **Modeling Hub lockdown** (migrations 136 + 137): six unauthorized users purged with full `admin_audit_log` trail (`admin_id` resolved via subquery so the NOT NULL constraint is satisfied), `modeling_access_whitelist` table created + admin pre-seeded, single `modeling_hub_coming_soon` toggle split into independent **signin + register toggles** with their own admin LaunchStatusCards on `/admin/modules`, whitelist admin UI at `/admin/modeling-access` with add-email form + per-row Revoke, migration 137 force-upserts both toggles back to `'true'`. **Register page UX fix**: `/modeling/register` now server-gates with a real Coming Soon UI when the register toggle is ON, preserving `?bypass=true` for QA and adding `?email=whitelisted@address` as a per-invitee shareable link (server verifies whitelist membership + renders the form pre-filled with a locked email input). **Gating chain**: `/api/auth/register`, `/api/auth/confirm-email`, NextAuth `authorize()` all route through `canEmailRegisterModeling` / `canEmailSigninModeling` in `src/lib/shared/modelingAccess.ts`. **Dashboard UI cleanup**: sidebar 3SFM/BVM Transcript items removed, inline `CertificateImageCard` below `CourseContent` in course view removed, the fully-styled "Certificate Earned" card inside `CourseContent` removed, achievements-section Transcript buttons removed (`transcriptToast` retired, errors flow through the shared `dashToast`). **CourseContent banner waterfall reordered** so `courseCert` is the first branch and pre-migration students (no Final session progress row) see "Share Your Certificate" as soon as a cert exists. **Not-Yet-Earned placeholder fix**: `/api/training/certificate` now exposes `course_code` in `DashboardCert`, `Certificate` type gains optional `courseCode`, `CourseContent` matches on it so 3SFM and BVM placeholders hide correctly for cert-holders. **Certificate card two-column layout**: `CertificateImageCard` body is now a responsive CSS grid (`auto-fit, minmax(240px, 1fr)`), left column holds meta + QR, right column stacks Download PDF / Download Badge / Download Transcript / Share / Verify buttons, collapses to 1 column under ~500px without a media query. **Critical cert-card data-binding fix**: `CertificateImageCard` now fetches by `certId` (globally unique) instead of `email`; previously both 3SFM + BVM cards on the same dashboard overwrote their props with the newest single row `/api/training/certificate-image` returned, so every card rendered BVM regardless. `/api/training/certificate-image` also gained an optional `courseCode` filter for email-path fallbacks. Dashboard now sorts via `sortedCertificates` (`3SFM` ranks 0, `BVM` ranks 1, others 99) so 3SFM renders first in both the cards and the Certificate Badges grid, and the tile `courseLabel` now uses `courseCode` instead of matching the free-form `cert.course` prose. **Footer double-©**: `SharedFooter` defensively strips any leading `©` / `&copy;` / `&#169;` from the copyright value before rendering so a CMS row or caller prop that already includes the symbol doesn't render "© © 2026". Prior launch-readiness work still applies: inline cert issuance, admin safety-net panel, WhatsApp group link, context-aware achievement card, Resume/Continue, video-swap auto-detection, Onboarding Tour, session reminders, bypass list, auto-launch cron wired-but-disabled.)

> **See also:**
> - [CLAUDE-DB.md](CLAUDE-DB.md) — Database tables, storage buckets, migrations log
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md) — Feature status, detailed feature specs & flows
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md) — All page routes, API routes, components, lib structure
> - [CLAUDE-TODO.md](CLAUDE-TODO.md) — Pending work, backlog, legacy reference

---

## STRICT SESSION RULES — READ FIRST

### Scoping: Read ONLY the files for your task domain

| Task | Read ONLY these paths |
|------|-----------------------|
| Training auth (login / register / confirm) | `app/training/signin/` `app/training/register/` `app/training/confirm-email/` `app/training/forgot/` `app/api/training/validate/` `app/api/training/register/` `app/api/training/confirm-email/` `app/api/training/device-verify/` `app/api/training/resend-confirmation/` `src/lib/training/training-session.ts` `src/lib/shared/` |
| Training dashboard / course content | `app/training/dashboard/` `app/training/[courseId]/` `src/components/training/dashboard/` `app/api/training/` |
| Training assessment / quiz | `app/training/assessment/` `app/training/[courseId]/assessment/` `app/api/training/[courseId]/assessment/` `app/api/training/submit-assessment/` |
| Certificate / transcript | `app/training/certificate/` `app/training/certificates/` `app/training/transcript/` `src/components/training/dashboard/CertificateImageCard.tsx` `src/lib/training/certifier.ts` `src/lib/training/certificateLayout.ts` `app/api/training/certificate/` `app/api/training/certificate-image/` `app/api/t/[token]/pdf/` |
| Modeling Hub auth | `app/modeling/signin/` `app/modeling/confirm-email/` `app/api/auth/` `src/lib/shared/auth.ts` `src/lib/shared/deviceTrust.ts` `src/lib/shared/emailConfirmation.ts` `src/lib/shared/captcha.ts` |
| Modeling Hub platform (REFM) | `app/refm/` `app/modeling/` `src/components/refm/` `src/lib/modeling/` |
| Admin panel | `app/admin/` `src/components/admin/` `app/api/admin/` |
| Email system | `src/lib/email/` |
| Shared utilities | `src/lib/shared/` `src/core/` |
| Navbar / layout | `src/components/layout/` |
| Landing pages / CMS | `app/(portal)/` `app/about/` `app/articles/` `app/pricing/` `src/components/landing/` `app/api/cms/` |

**Never** read files outside the task domain.
**When a task spans two domains**, read only those two folders — nothing else.

### End-of-session rule
**ALWAYS update CLAUDE.md files at the end of every session** to reflect:
- Any new files created (add to the correct folder list in CLAUDE-ROUTES.md)
- Any feature status changes (update the Feature Status table in CLAUDE-FEATURES.md)
- Any new environment variables added
- Any new database tables or migrations (add to CLAUDE-DB.md)

### Do NOT touch list
- `next.config.ts` — subdomain routing is live and correct; clean auth URL rewrites + redirects added; app. `/register` rewrite goes to `/modeling/register` (dedicated page, NOT `/modeling/signin?tab=register`)
- `src/middleware.ts` — `/admin/:path*` protection is live; `/admin/login` AND `/admin` root excluded
- `app/globals.css` — design system tokens, do not restructure
- `vercel.json` — deployment config is live; the `/admin`, `/admin/:path*`, `/login` cache-header rules added 2026-04-24 (commit `c5a24f4`) MUST stay in place so Vercel's edge layer never caches a redirect on the admin auth surface
- `supabase/migrations/` — never edit existing migrations; create new ones only
- Any feature marked Complete unless explicitly asked by the user
- Cross-feature shared files (`src/lib/shared/`, `src/lib/email/`) without explicit instruction

---

## Project Overview

**Financial Modeler Pro** — Multi-hub SaaS platform with three web properties:

| Property | Domain | Purpose |
|----------|--------|---------|
| Main site | `financialmodelerpro.com` | Marketing, admin, portal, auth |
| Training Hub | `learn.financialmodelerpro.com` | Financial modeling courses |
| Modeling Hub | `app.financialmodelerpro.com` | Interactive financial modeling tools |

**Stack: Next.js 15 (App Router) + TypeScript strict + Tailwind CSS 4 + Supabase**

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | ^16.2.1 |
| Language | TypeScript strict mode | ^5 |
| Styling | Tailwind CSS 4 + CSS custom properties | ^4 |
| State | Zustand | ^5.0.11 |
| Charts | Recharts | ^3.8.0 |
| Database | Supabase (`@supabase/supabase-js`) | ^2.99.1 |
| Auth — Modeling Hub | NextAuth.js (JWT, 1hr session) | ^4.24.13 |
| Auth — Training Hub | Custom (httpOnly cookie + localStorage) | — |
| Forms | react-hook-form + zod + @hookform/resolvers | ^7 / ^4 / ^5 |
| Icons | lucide-react | ^0.577.0 |
| Utilities | clsx, tailwind-merge | — |
| AI | @anthropic-ai/sdk | ^0.78.0 |
| Email | Resend | ^6.10.0 |
| Export | exceljs + @react-pdf/renderer | ^4.4.0 / ^4.3.2 |
| Captcha | @hcaptcha/react-hcaptcha | ^2.0.2 |
| QR Codes | qrcode | ^1.5.4 |
| PDF Generation | pdf-lib | ^1.17.1 |
| Image Processing | sharp | ^0.33.5 |
| Rich Text | @tiptap/react + starter-kit + image + text-align + link + color + text-style + underline | 2.27.2 |
| Drag & Drop (CMS lists) | @hello-pangea/dnd | ^18.0.1 |
| Canvas Drag/Resize (Marketing Studio) | react-rnd | ^10.5.3 |
| ZIP Export | jszip | ^3.10.1 |
| Onboarding Tour | driver.js | ^1.4.0 |
| SVG Text Rendering | satori | latest |
| Passwords | bcryptjs (Training Hub) / scrypt via Node (Modeling Hub) | ^3.0.3 |
| Toast | react-hot-toast | ^2.6.0 |
| Sanitization | isomorphic-dompurify | ^3.3.0 |
| Image Crop | react-easy-crop | latest |

---

## External Services

| Service | Purpose | Config |
|---------|---------|--------|
| **Supabase** | Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **Resend** | Transactional email | `RESEND_API_KEY`, `EMAIL_FROM_TRAINING`, `EMAIL_FROM_NOREPLY` |
| **Google Apps Script** | Training registration + attendance source of truth | URL in `training_settings` table |
| **hCaptcha** | Spam protection on signup forms (both hubs) | `HCAPTCHA_SECRET_KEY`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` |
| **Anthropic Claude API** | AI market research + contextual help agents | `ANTHROPIC_API_KEY` |
| **YouTube Data API v3** | Fetch video comments (cached 24h in DB) | `YOUTUBE_API_KEY` |
| **Microsoft Graph (Teams)** | Auto-generate Teams meeting links for upcoming live sessions | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TEAMS_HOST_USER_EMAIL` (full setup in **External Integrations**) |
| **Vercel** | Hosting + edge middleware | Auto-deploy on `main` push |
| **Vercel Web Analytics** | Page views, unique visitors, referrers, device/browser, geography | Zero-config via `@vercel/analytics` in `app/layout.tsx` |
| **Vercel Speed Insights** | Core Web Vitals (LCP, FID, CLS) for SEO | Zero-config via `@vercel/speed-insights` in `app/layout.tsx` |

---

## Certificate Issuance (Supabase-native, inline-triggered)

Certificates are issued natively from Supabase eligibility data the instant a student passes their final exam. The old daily `/api/cron/certificates` route was retired — the cron was a holdover from Apps Script polling and is no longer the primary trigger.

- **Eligibility view**: `certificate_eligibility_raw` (from `training_assessment_results`) — one row per (email, course_code) with pass counters + `final_passed` flag. Migration 109.
- **Eligibility lib**: `src/lib/training/certificateEligibility.ts` — `checkEligibility(email, courseId)` runs the full course-config check (all regular + final sessions passed, watch threshold met with grandfathering + per-session bypass). `findAllEligibleFromSupabase()` returns every eligible student that doesn't already have an Issued row in `student_certificates`.
- **Engine**: `src/lib/training/certificateEngine.ts`:
  - `issueCertificateForPending(cert, options)` — the low-level per-student issuance primitive (PDF render + badge render + storage upload + DB write + email + `email_sent_at` stamp on success).
  - `issueCertificateForStudent(email, courseCode, options)` — the high-level single-student entry point. Does a cheap "already Issued?" pre-check, runs `checkEligibility`, builds the `PendingCertificate`, and hands off to `issueCertificateForPending`. Called by the inline trigger and by the admin safety-net. Idempotent: the DB unique index on `(LOWER(email), course_code)` from migration 111 is the hard guard; the pre-check is just the early-out.
- **Primary trigger (inline)**: `/api/training/submit-assessment` fires `issueCertificateForStudent(email, courseCode)` as fire-and-forget the moment a final-exam submission arrives with `didPass === true && isFinal === true`. Student's HTTP response returns immediately; cert generation runs in the background and the email lands within seconds. Errors are logged — the student still sees the pass screen and the safety-net panel surfaces the miss.
- **Safety net (manual)**:
  - `/admin/training-hub/certificates` top panel "🛟 Eligible but not issued" lists every (email, course_code) with `final_passed=true` and no `Issued` row in `student_certificates`. Per-row `⚡ Issue Now` + bulk `Issue All Pending`. Powered by `GET /api/admin/certificates/pending` + `POST /api/admin/certificates/issue-pending`.
  - `/admin/training-hub/certificates` main table now has an `Email` column. When `email_sent_at` is null (migration 124), the row shows an "Unsent" pill + a `✉ Resend` button that calls `POST /api/admin/certificates/resend-email { certificateId }` and stamps `email_sent_at` on success.
  - `POST /api/admin/certificates/force-issue { email, courseCode }` still exists as the explicit bypass-watch-threshold override. Audited via `issued_via='forced'` + `issued_by_admin`.
  - `POST /api/admin/certificates/check-eligibility { email, courseCode }` returns the full `EligibilityResult` for ad-hoc debugging.
- **No cron**: `vercel.json` no longer schedules `/api/cron/certificates`; the route file was deleted. `CRON_SECRET` is retained for the remaining crons (`/api/cron/session-reminders`, `/api/cron/auto-launch-check`).

## SEO

Full SEO implemented across all public pages.

- **Root defaults** (`app/layout.tsx`): metadataBase + title template (`%s | Financial Modeler Pro`) + keyword-rich description + OG/Twitter + robots + viewport. `<OrganizationJsonLd>` + `<WebSiteJsonLd>` rendered once in the root body for sitewide rich results.
- **Per-page metadata**: every public page has its own title + description + canonical + OG/Twitter. Dynamic pages (`/articles/[slug]`, `/modeling/[slug]`, `/training-sessions/[id]`) use `generateMetadata`.
- **Sitemap**: `app/sitemap.ts` — auto-generated from `articles`, `live_sessions`, `cms_pages`, plus the static main-domain + `learn.` + `app.` landing pages + every `PLATFORMS` config slug. Regenerates hourly. Accessible at `/sitemap.xml`.
- **Robots**: `app/robots.ts` — disallows admin/api/dashboard/auth/token routes, blocks LLM-training bots (GPTBot, ChatGPT-User, CCBot, anthropic-ai, Claude-Web, Google-Extended), points to `/sitemap.xml`. Accessible at `/robots.txt`.
- **Structured data library** (`src/components/seo/StructuredData.tsx`): `OrganizationJsonLd`, `WebSiteJsonLd`, `PersonJsonLd` (Ahmad Din's about page), `CourseJsonLd` (training modules), `ArticleJsonLd` (articles), `EventJsonLd` (live sessions — both scheduled + recorded), `BreadcrumbJsonLd`, `FAQJsonLd`. All auto-escape `</script>` to keep the JSON-LD tamper-safe.
- **Breadcrumbs**: `src/components/seo/Breadcrumbs.tsx` — visual breadcrumb + matching BreadcrumbList JSON-LD. Article + live-session detail pages already emit the JSON-LD.
- **Canonical helper**: `src/lib/seo/canonical.ts` — `canonicalUrl(path, 'main' | 'learn' | 'app')`. Used by every page that builds a canonical URL.
- **Keywords** targeted in defaults: financial modeling training, 3-Statement Financial Modeling, business valuation, real estate modeling, corporate finance training, financial modeling KSA / Saudi Arabia / GCC / Pakistan, FMVA prep, ACCA financial modeling, LBO, project finance, FP&A, transaction advisory. Weaved naturally into page descriptions — no keyword stuffing.

**Next steps (manual, ~15 min):**
1. Register on Google Search Console → verify ownership (meta tag or DNS) → submit `https://financialmodelerpro.com/sitemap.xml`.
2. Same for Bing Webmaster Tools (optional).
3. Once verified, add verification codes to `app/layout.tsx` under `metadata.verification`.

## Analytics

Site analytics via **Vercel Web Analytics + Speed Insights** — both free on the Hobby plan, currently sufficient for pre-launch traffic.

- `<Analytics />` + `<SpeedInsights />` mounted in `app/layout.tsx` (after `SessionProviderWrapper`, inside `<body>`). Both components auto-detect `production` vs `preview` / `development` — no manual gating needed.
- Tracks: page views, unique visitors, top pages, referrers (LinkedIn/Google/direct/etc), device + browser breakdown, geographic data, real-time active users.
- Speed Insights reports Core Web Vitals (LCP/FID/CLS) per-route — useful for SEO health.
- **All three subdomains** (`financialmodelerpro.com`, `learn.`, `app.`) share the same dashboard because they're served by the same Next.js deployment.
- Cookieless + GDPR-compliant by default; no consent banner required.
- **Dashboard**: Vercel project → Analytics tab (and Speed Insights tab).
- Plan to upgrade to Vercel Pro when Modeling Hub launches for higher event quotas + longer retention.

---

## Authentication Systems

### Training Hub (learn.financialmodelerpro.com)
- **Source of truth**: Google Apps Script (student roster + Registration IDs)
- **Password storage**: `training_passwords` table (bcrypt hashed)
- **Session**: httpOnly cookie `training_session` (1-hour TTL) + localStorage mirror
- **Sign-in flow**: email+password -> `POST /api/training/validate` -> check pending/unconfirmed -> check device trust -> set session cookie
- **Registration flow**: form -> hCaptcha -> insert `training_pending_registrations` -> confirm email -> Apps Script -> `training_registrations_meta` confirmed
- **Device trust**: `fmp-trusted-device` cookie -> `trusted_devices` table (30-day TTL)
- **New device OTP**: `training_email_otps` table, 6-digit code, 10-min expiry
- **Inactivity logout**: 1-hour `useInactivityLogout` hook -> `POST /api/training/logout`
- **email_confirmed null handling**: Pre-migration-027 students have `email_confirmed = null`. `validate/route.ts` treats `null` as confirmed (`!== false`). Do NOT use `=== true` or these users will be blocked
- **Resend confirmation**: `resend-confirmation/route.ts` sends for `email_confirmed !== true` (covers both `false` and `null`)
- **Key files**: `src/lib/training/training-session.ts`, `app/api/training/validate/route.ts`, `app/api/training/register/route.ts`

### Modeling Hub (app.financialmodelerpro.com)
- **Auth provider**: NextAuth.js Credentials (JWT strategy, 1-hour maxAge)
- **Password storage**: `users.password_hash` (scrypt via Node `crypto.scrypt`)
- **Session**: NextAuth JWT cookie
- **Sign-in flow**: email+password -> NextAuth `authorize()` -> check `email_confirmed` -> check device trust -> JWT issued
- **Registration flow**: form -> hCaptcha -> insert `users` (email_confirmed=false) -> confirm email -> `email_confirmed=true` -> signin
- **Device trust**: `fmp-trusted-device` cookie -> `trusted_devices` table (30-day TTL)
- **New device OTP**: `modeling_email_otps` table, 6-digit code, 10-min expiry
- **Device trust identifier**: `trusted_devices.identifier` stores `email` (not user UUID). Do NOT change to `user.id`
- **Admin bypass**: In `auth.ts` `authorize()`, admin role skips ONLY `EmailNotConfirmed` (admin emails are pre-confirmed in the DB). Device verification applies to admins too as of 2026-04-23 - Ahmad got locked out on a new device during launch and there was no OTP path; admins now go through the same OTP + 30-day-trust flow as students via `/api/auth/device-verify`.
- **Admin login flow**: `/admin` (single unified entry) renders the credential form for unauthed visitors and redirects authed admins straight to `/admin/dashboard`. The previous chain (`/admin` welcome -> `/admin/login` welcome -> form -> `/login` callback form) was collapsed 2026-04-23. The legacy `/admin/login` + `/login` page files were DELETED 2026-04-24; their URLs now 307 to `/admin` in middleware with `Cache-Control: no-store` headers to invalidate any 308s cached by browsers from older deployments. Query params (including `callbackUrl`) are dropped on forward so no recursive-encoding loop can form. NextAuth `pages.signIn` + `pages.error` both `/admin`. `callbacks.redirect` coerces auth-cycle paths to `/admin/dashboard`. Post-signin destination is hard-coded to `/admin/dashboard` (no deep-link preservation; users who want one can bookmark after signin).
- **Admin layout guard**: `AdminGuard` uses child `AdminProtected` to isolate `useRequireAdmin` hook. Skips the hook only on `/admin` itself (the legacy `/admin/login` exception is gone because the file is gone).
- **Non-admin redirect**: `useRequireAdmin` redirects non-admins to `/` (not `/refm`)
- **Key files**: `src/lib/shared/auth.ts`, `app/api/auth/register/route.ts`, `app/api/auth/confirm-email/route.ts`

---

## Subdomain Routing (`next.config.ts`)

- `learn.financialmodelerpro.com/` -> rewrites to `/training` (URL unchanged)
- `app.financialmodelerpro.com/` -> rewrites to `/modeling` (URL unchanged)
- Main-site paths on learn. or app. -> redirect to `financialmodelerpro.com`
- `/training/*` on main domain -> redirect to `learn.financialmodelerpro.com`
- `/modeling/*` or `/refm/*` on main domain -> redirect to `app.financialmodelerpro.com`

### Clean Auth URLs
| Subdomain | Clean URL | Served from |
|-----------|-----------|-------------|
| learn. | `/signin` | `/training/signin` |
| learn. | `/register` | `/training/register` |
| learn. | `/forgot` | `/training/forgot` |
| app. | `/signin` | `/modeling/signin` |
| app. | `/register` | `/modeling/register` |

Use `/signin`, `/register`, `/forgot` for all training/modeling auth links.

**Critical**: Navbar uses plain `<a>` tags with absolute URLs. NavbarServer `absolutizeHref()` converts DB hrefs.

**Navbar auth links**: Use file-level constants `APP_URL` and `LEARN_URL` with `??` fallbacks — never raw `process.env` without fallback.

---

## Design System (DO NOT CHANGE)

- **Single source of truth**: `app/globals.css`
- Colors: `--color-primary`, `--color-primary-dark`, etc.
- Spacing: 8px grid — `--sp-1` (8px) through `--sp-5` (48px)
- Typography: `--font-h1` through `--font-micro`
- Component classes: `.card`, `.kpi-card`, `.btn-primary`, `.table-standard`
- Financial inputs: `.input-assumption` class (yellow bg `--color-warning-bg`)
- **Do NOT use Tailwind utility classes for layout tokens**

---

## Deployment — Vercel

### Environment Variables
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude AI API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key (server alias) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server only) |
| `NEXTAUTH_SECRET` | NextAuth JWT signing secret |
| `NEXTAUTH_URL` | `https://app.financialmodelerpro.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app.financialmodelerpro.com` |
| `NEXT_PUBLIC_MAIN_URL` | `https://financialmodelerpro.com` |
| `NEXT_PUBLIC_LEARN_URL` | `https://learn.financialmodelerpro.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (client-safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client-safe) |
| `RESEND_API_KEY` | Resend email service key |
| `EMAIL_FROM_TRAINING` | Training sender address |
| `EMAIL_FROM_NOREPLY` | No-reply sender address |
| `HCAPTCHA_SECRET_KEY` | hCaptcha server-side secret |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | hCaptcha client-side site key |
| `CRON_SECRET` | Bearer token for Vercel cron job auth (`/api/cron/session-reminders`, `/api/cron/auto-launch-check`). Certificate cron retired — certificates issue inline on final-exam submit. |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (server-only, for comments fetch) |
| `NEXT_PUBLIC_YOUTUBE_CHANNEL_ID` | YouTube channel ID for subscribe button (client-safe) |
| `AZURE_TENANT_ID` | Azure AD directory tenant ID (GUID). Used by Teams meeting auto-generation via Microsoft Graph. See **External Integrations → Microsoft Teams** for setup. |
| `AZURE_CLIENT_ID` | Azure AD app registration client ID (GUID) for the FMP Training Hub app. |
| `AZURE_CLIENT_SECRET` | Client secret VALUE (not the secret ID) from the Azure AD app registration. 24-month expiry; rotate before expiration. |
| `TEAMS_HOST_USER_EMAIL` | UPN of the Microsoft 365 user who owns auto-generated Teams meetings. Casing must match the user's Azure AD record exactly (e.g. `Ahmad.din@pacemakersglobal.com`). |

### Scripts
```bash
npm run type-check   # tsc --noEmit — must be zero errors
npm run build        # next build --webpack (avoids MAX_PATH on Windows/OneDrive)
npm run verify       # type-check + lint + build
```

### Health Check
`GET /api/health` -> `{ status: 'ok', platform: 'financial-modeler-pro', version: '3.0', timestamp }`

---

## Modeling Platforms (`src/config/platforms.ts`)

| Slug | Name | Status |
|------|------|--------|
| `real-estate` | Real Estate Financial Modeling (REFM) | Live |
| `bvm` | Business Valuation Modeling | Coming Soon |
| `fpa` | FP&A Modeling Platform | Coming Soon |
| `erm` | Equity Research Modeling | Coming Soon |
| `pfm` | Project Finance Modeling | Coming Soon |
| `lbo` | LBO Modeling Platform | Coming Soon |
| `cfm` | Corporate Finance Modeling | Coming Soon |
| `eum` | Energy & Utilities Modeling | Coming Soon |
| `svm` | Startup & Venture Modeling | Coming Soon |
| `bcm` | Banking & Credit Modeling | Coming Soon |

---

## External Integrations

### Microsoft Teams (Live Sessions Auto-Generation)

The platform auto-generates Microsoft Teams meeting links when an admin creates an upcoming live session with the auto-generate toggle ON. Implementation lives in `src/lib/integrations/teamsMeetings.ts` and uses the Microsoft Graph API with the client-credentials OAuth flow (application permissions, no user sign-in at runtime). Wired into `POST /api/admin/live-sessions` (create), `PATCH /api/admin/live-sessions/[id]` (sync title/schedule/duration changes), and `DELETE /api/admin/live-sessions/[id]` (idempotent meeting delete). A `GET /api/admin/teams/test-connection` route powers the **Test Teams Connection** button on the admin live-sessions page.

#### Tenant-Level Configuration (one-time, already done)

These steps live in Microsoft 365 cloud configuration. They persist across deploys, laptop swaps, and Vercel redeploys. Do NOT need to be redone unless one of the trigger conditions in **When PowerShell setup needs to be redone** below applies.

**Azure AD App Registration**
- Tenant: PaceMakers Business Consultants
- Tenant ID: `f18ccb05-e3c6-460e-afdf-12340018301a`
- App Name: `FMP Training Hub`
- App (Client) ID: `ab228da6-74b7-4267-ba08-4b1b953ad700`
- API Permissions (all **Application** type, admin consent granted):
  - Microsoft Graph → `OnlineMeetings.ReadWrite.All`
  - Microsoft Graph → `User.Read.All`
  - Microsoft Graph → `Calendars.ReadWrite` (added 2026-04-22, required for the event-based flow that creates real Outlook calendar entries and fires the standard Teams meeting invitation email. `~30 min` propagation before first use.)
- Client Secret value: stored in Vercel as `AZURE_CLIENT_SECRET`. 24-month expiry from creation, set a calendar reminder to rotate before expiry.

**Microsoft Teams Application Access Policy**
- Policy Name: `FMP-teams-policy`
- App ID linked: `ab228da6-74b7-4267-ba08-4b1b953ad700`
- Granted to user: `Ahmad.din@pacemakersglobal.com` (the meeting host)
- Created via PowerShell on 2026-04-21
- Required because `OnlineMeetings.ReadWrite.All` alone is not enough. Without this Teams-side policy the Graph API returns the famous `UnknownError` with empty message body when creating meetings.

#### Required Vercel Environment Variables

- `AZURE_TENANT_ID` (Directory tenant ID)
- `AZURE_CLIENT_ID` (Application client ID)
- `AZURE_CLIENT_SECRET` (Client secret VALUE, not the secret ID)
- `TEAMS_HOST_USER_EMAIL` (must match casing exactly: `Ahmad.din@pacemakersglobal.com`)

The service degrades gracefully if any of these are missing: `isTeamsConfigured()` returns false, the admin UI surfaces a warning toast, and the session saves with a manual-URL fallback.

#### When PowerShell Setup Needs to Be Redone

Only in these cases:
- Switching the host user (e.g., to a colleague's account or a service account)
- Adding additional host users (each user needs their own grant)
- Rotating the Azure Client ID (only if the app registration is deleted and recreated; rotating the secret alone does NOT require redoing the policy)
- Cleaning up or removing the integration entirely

#### PowerShell Commands Reference

Run the PowerShell commands below from a Windows machine signed in with a Teams admin (or Global admin) account. The Teams PowerShell module is the only supported way to manage `CsApplicationAccessPolicy`; the Azure Portal does not expose it.

**Install Teams PowerShell module on a new admin machine:**
```powershell
Install-Module -Name MicrosoftTeams -Force -AllowClobber -Scope CurrentUser
Import-Module MicrosoftTeams
Connect-MicrosoftTeams
```

**Verify the policy exists (read-only, safe to re-run):**
```powershell
Get-CsApplicationAccessPolicy -Identity "FMP-teams-policy"
```

**Verify the host user has the policy granted:**
```powershell
Get-CsOnlineUser -Identity "Ahmad.din@pacemakersglobal.com" | Format-List *AccessPolicy*
```

**Recreate the policy from scratch** (only if accidentally deleted, or if the Azure app registration was rotated and got a new Client ID):
```powershell
New-CsApplicationAccessPolicy -Identity "FMP-teams-policy" `
  -AppIds "ab228da6-74b7-4267-ba08-4b1b953ad700" `
  -Description "FMP Training Hub Teams meeting auto-generation"
```

**Grant the policy to a new or replacement host user:**
```powershell
Grant-CsApplicationAccessPolicy -PolicyName "FMP-teams-policy" `
  -Identity "<new-host-user@pacemakersglobal.com>"
```
After running, also update `TEAMS_HOST_USER_EMAIL` in Vercel to match. Casing must be exact.

**Remove the policy from a user (cleanup or revocation):**
```powershell
Grant-CsApplicationAccessPolicy -PolicyName $null -Identity "<user-email>"
```

**Delete the policy entirely (full integration teardown):**
```powershell
Remove-CsApplicationAccessPolicy -Identity "FMP-teams-policy"
```

#### Operational Notes

- **Propagation delay:** policy grants and revocations can take up to 30 minutes to take effect across the Teams service. The Test Teams Connection button reads the user record (which is instant), so it can return OK while meeting creation still 401s. If a fresh grant is failing, wait 30 minutes before re-testing.
- **Test scope:** `GET /api/admin/teams/test-connection` only confirms the token is valid and the host user record is reachable. It does NOT exercise meeting creation. To prove end-to-end works, create a draft upcoming session with the auto-generate toggle on; the resulting meeting can be deleted from the editor and Teams cleans up via the DELETE-on-session-delete hook.
- **Diagnostic logging:** every Graph API failure logs a structured `[live-sessions POST] Teams create failed:` line to Vercel with the response body and HTTP status. The admin UI surfaces a truncated version in the toast.
- **Token cache:** `teamsMeetings.ts` caches the bearer token in memory with a 60-second safety margin before expiry. Cold serverless invocations re-fetch a fresh token. No persistence in Supabase.

---

## Key Architectural Notes

### Booking System — Calendly Inline Embed

`/book-a-meeting` embeds Calendly inline (no redirect). The widget URL comes from `page_sections.team.content.booking_url` (admin editable in Page Builder → Founder → Booking Page tab). Default event: 60-minute Modeling Hub Advisory Meeting. Calendly account is on the free tier with Outlook + Teams integration.

- **Component:** `src/components/booking/CalendlyEmbed.tsx` — client component, dynamically injects `assets.calendly.com/assets/external/widget.js` once per page load.
- **Fallback:** when `booking_url` is empty, the page shows a "Booking Calendar Coming Soon" notice and falls through to email / WhatsApp contact options.
- **Buttons on other pages** (home founder card, `/about/ahmad-din`) continue to navigate to `/book-a-meeting` where the embed lives — no deep link to Calendly anywhere else.

### CMS Content Rendering — Rules

**All CMS text content MUST be rendered via `<CmsField>` (`src/components/cms/CmsField.tsx`).**

- Never use `{content.field}` directly in JSX for a CMS text field.
- Never call `dangerouslySetInnerHTML` manually (except intentional raw passthrough like EmbedSection iframes or SVG `cols[].icon`).
- Never hand-roll `isHtml()` detection or `.split(/\n\n/)` paragraph splitting. CmsField does all of it.
- Use `cmsVisible(content, 'field')` when you need only a visibility gate around a heavily-styled wrapper (e.g. pill badges, h1 containers).

**CmsField handles:** visibility (`{field}_visible`), alignment (`{field}_align`), width (`{field}_width`), HTML-vs-plain detection, `.fmp-rich-text` styling, paragraph splitting.

Adding a new CMS section or page → every text field uses `<CmsField>`. No exceptions. Breaking this rule reintroduces the raw-tags / ghost-UI bugs the universal renderer was built to eliminate.

### CMS Option B Pages
All three marketing pages use **Option B**: each section fetched from `page_sections` via `getAllPageSections(slug)` and fed into custom hardcoded JSX (NOT SectionRenderer). `getAllPageSections()` returns ALL sections including `visible=false`. Pattern: `section.visible === false ? null : section ? <CMS render> : <hardcoded fallback>`. All pages use `revalidate = 0` (no ISR caching).

**Home page** (`app/(portal)/page.tsx`): hero (053), stats (054), text_image x3 (055-057), two-platforms (058), founder (059-063, 067-068), pacemakers (062). Home founder card shows `credentials.slice(0, 5)` max.

**Training page** (`app/training/page.tsx`, migration 065-066): 9 sections — hero, courses (dynamic), how-it-works (steps), why-certify (benefits), cert-verification, upcoming-sessions (dynamic), testimonials (dynamic), submit-testimonial CTA, bottom CTA. Testimonial cards show LinkedIn button via `TestimonialsCarousel.tsx`.

**Modeling page** (`app/modeling/page.tsx`, migration 070): 7 sections — hero, audience/what-is (text_image with audience[] cards), platforms grid (dynamic modules), why-modeling (benefits[]), testimonials (dynamic), submit-testimonial CTA, bottom CTA.

**Modeling platform sub-pages** (`app/modeling/[slug]/page.tsx`, migration 071-072): CMS-first with config fallbacks. Slug pattern: `modeling-{platform-slug}`. Real Estate has 7 sections: hero, stats bar, what-covers (text_image), who-is-it-for (list), what-you-get (list), module guide (dynamic from config), CTA.

### CMS Editors
- SmartColumnsEditor (TwoPlatforms/PaceMakers/generic), SmartTeamEditor (Founder/generic)
- FounderEditor (6 sections: home card, credentials, photo, buttons, full profile, booking page)
- CardsEditor: smart detection for benefits[]/cards[], normalizes desc/description, shows description field for dynamic sections
- TextImageEditor: body textarea, audience cards editor, side image + background image always visible, paragraphs support
- ProcessStepsEditor: auto-detected for timeline sections with content.steps[]
- **Universal ParagraphsEditor**: renders between ActiveEditor and StyleEditor for every section type, with per-paragraph alignment (L/C/R/J)
- Per-field visibility: `content.fieldName_visible !== false` pattern across all section renderers

### Founder Section Data Structure
- `content.credentials[]` — unified list: home card shows as ✓ checklist (max 5 via `.slice(0, 5)`), about page + expanded view show as numbered teal circles. Single source of truth (experience[] removed in migration 068)
- `content.long_bio` — full background story (split by `\n\n` or `\n`). About page + expanded view
- `content.philosophy` — modeling philosophy quote
- `content.projects[]` — { id, title, description, sector, value }
- `content.booking_url` — Microsoft Bookings URL. `/book-a-meeting` page reads this
- `content.booking_expectations[]` — "What to expect" list on booking page

### Training Settings (Unified admin page)
All global training controls live at **`/admin/training-settings`**:
- **Apps Script URL** — the Google Apps Script Web App URL (still needed by 3SFM/BVM question fetch + legacy progress).
- **Transcript Editor** shortcut card.
- **Watch Enforcement** — global toggle + threshold + per-session bypass table (union of COURSES + every `live_sessions` row + unmapped cert-course history) with search, type filter, status filter, sort, bulk actions.
- **Assessment Settings** *(new, migration 108)* — global **Shuffle Questions** + **Shuffle Options** toggles. Applied client-side after questions load so one setting drives 3SFM, BVM (Apps Script-backed), and live sessions (Supabase-backed) uniformly. Helper `src/lib/training/shuffle.ts` provides `applyShufflesLive`/`applyShufflesLegacy` for Fisher-Yates with `correct_index`/`correctIndex` remapping. Live session submit endpoint additionally returns `correct_answer_texts` so the result view works regardless of option shuffle state.
- **Training Hub Launch Status** *(moved from Course Manager)* — `<LaunchStatusCard>` for the Training Hub coming-soon toggle + launch date.

**Course Manager pages** (`/admin/training` + `/admin/training/[courseId]`) are now focused purely on course structure + content. The old Timer Bypass, per-course Shuffle, and Launch Status toggles have been removed — an info banner at the top of the Course Manager links to Training Settings. The `timer_bypass_enabled` key is dropped by migration 108 since watch-enforcement supersedes it; remaining readers (`course-details` route, `videoTimer.ts`, etc.) gracefully default to `false`.

### Hub Coming Soon Mode (Modeling + Training)

Both hubs share the same pattern: a server-side gate on signin/register pages plus a reusable admin card. The toggle and an optional launch date are stored in `training_settings` per hub. When the launch date is set the public page renders a live Days/Hrs/Min/Sec countdown; when it's empty only the coming-soon message is shown.

**Shared pieces:**
- `CountdownTimer` (`src/components/shared/CountdownTimer.tsx`): reusable Days/Hrs/Min/Sec grid, updates every 1s, fires optional `onComplete`, swaps in "We're Live!" banner at zero. Accepts `accentColor` / `cardBackground` / `cardBorder` for per-hub theming.
- `LaunchStatusCard` (`src/components/admin/LaunchStatusCard.tsx`): reusable admin card. Props `{ label, icon, endpoint, previewUrl, onMessage }`. Renders the status pill + toggle + Preview ↗, and when enabled an optional `datetime-local` picker with Save / Clear. Posts to the given `endpoint` with `{ enabled }` or `{ launchDate }` partial PATCH.

**Modeling Hub:**
- Settings: `modeling_hub_coming_soon` (`'true'`/`'false'`) + `modeling_hub_launch_date` (ISO 8601, optional).
- Helper: `src/lib/shared/modelingComingSoon.ts` → `getModelingComingSoonState()` returns `{ enabled, launchDate }`; `isModelingComingSoon()` shortcut kept for back-compat.
- API: `GET/PATCH /api/admin/modeling-coming-soon` — partial upsert on either field, admin-gated.
- Public pages: `app/modeling/signin/page.tsx` + `app/modeling/register/page.tsx` server-gate and pass `launchDate` through. Signin uses `ComingSoonWrapper` with `?bypass=true` escape hatch. `ModelingComingSoon` renders blue-tinted `CountdownTimer` only when `launchDate` is set.
- Admin: `LaunchStatusCard` mounted at top of `/admin/modules`.

**Training Hub:**
- Settings: `training_hub_coming_soon` + `training_hub_launch_date`.
- Helper: `src/lib/shared/trainingComingSoon.ts` → `getTrainingComingSoonState()` / `isTrainingComingSoon()`.
- API: `GET/PATCH /api/admin/training-coming-soon`.
- Public pages: `app/training/signin/page.tsx` + `app/training/register/page.tsx` server-gate. `TrainingRegisterForm` extracted from the old page to allow the split. `TrainingComingSoon` (`app/training/ComingSoon.tsx`) adds a newsletter waitlist (hubs=['training']) + LinkedIn/YouTube links + standalone `/training/coming-soon` preview route. Countdown only renders when `launchDate` is set.
- Admin: `LaunchStatusCard` mounted at top of `/admin/training` (Course Manager page — NOT `/admin/modules`, which is for Modeling Hub only).
- Dashboard redirect chain: unauthenticated `/training/dashboard` already sends to `/signin`, which is gated — no middleware change needed.

### certificateEngine.ts
- PDF generation uses scaleX/scaleY (editor 1240x877 -> PDF points) and per-font ascent correction
- Badge generation reads BadgeLayout from cms_content (section: badge_layout)
- Exports: BadgeLayout, BadgeTextField, DEFAULT_BADGE_LAYOUT, loadBadgeLayout()

### videoTimer.ts
- `getTimerStatus()` accepts optional `timerBypassed` param (from training_settings DB key: `timer_bypass_enabled`)

### sheets.ts
- `normalizeProgressObject()` handles both bestScore/score field names and passed/status detection with score >= 70 fallback

### Email Templates — Branding System
- All 11 hardcoded email templates use `baseLayoutBranded()` from `_base.ts` (async, fetches `email_branding` table)
- `baseLayoutBranded()` provides: dynamic logo (with text fallback), `signature_html`, `footer_text`, `primary_color`
- Legacy `baseLayout()` still exists in `_base.ts` but is no longer used by any template
- `liveSessionNotification.ts` has its own `emailShell()` that also fetches `getEmailBranding()` directly
- All template functions are async — callers must `await` them
- No personal names in any email template signatures — company name only

### YouTube Integration (Live Sessions)
- **YouTubePlayer**: `src/components/training/YouTubePlayer.tsx` — YT IFrame API, tracks completion via `/api/training/live-sessions/[id]/watched`, `onNearEnd` fires 20s before end
- **SubscribeButton**: `src/components/training/SubscribeButton.tsx` — legacy, unused (replaced by SubscribeModal)
- **SubscribeModal**: `src/components/training/SubscribeModal.tsx` — clean modal with YouTube subscribe link
- **LikeButton**: `src/components/training/LikeButton.tsx` — links to YouTube for likes
- **YouTubeComments**: `src/components/training/YouTubeComments.tsx` — fetches from `/api/training/youtube-comments` (24h DB cache)
- **Admin toggle**: `show_like_button` on `live_sessions` table (default true), toggled in admin session edit form
- **Watch progress**: `session_watch_history` table, 50 points on first completion, badges on live sessions listing page

### Live Sessions — Instructor Roster (migration 106)
- **Table**: `instructors` (name, title, bio, photo_url, email, linkedin_url, credentials, display_order, is_default, active). Partial unique index `uniq_instructors_single_default` enforces at most one default. Seeded with Ahmad Din.
- **Link**: `live_sessions.instructor_id UUID REFERENCES instructors(id) ON DELETE SET NULL`. Legacy `instructor_name`/`instructor_title` columns are kept and auto-synced — every read path (cards, emails, detail pages) keeps working unchanged.
- **Admin APIs**: `GET/POST /api/admin/instructors`, `GET/PATCH/DELETE /api/admin/instructors/[id]`. PATCH demotes the previous default when promoting a new one, and fan-outs name/title changes to every linked `live_sessions` row. DELETE returns 409 + `inUse: true` + `sessionCount` if the instructor is still linked.
- **Admin page**: `/admin/training-hub/instructors` — list cards (photo avatar or initials fallback), DEFAULT / INACTIVE badges, ↑/↓ reorder, Make Default, Activate/Deactivate, Edit (modal with RichTextarea for bio), Delete (with usage-check error).
- **Picker**: `src/components/admin/InstructorPicker.tsx` — mounted in the live-session editor in place of the old two-text-input row. Dropdown of active instructors (default shows "(default)"), "+ New" inline quick-add form (name/title/credentials → auto-select on save), live preview of the selected instructor, "Manage ↗" link to the full admin page.
- **Save flow**: admin editor now posts `instructor_id`. POST `/api/admin/live-sessions` falls back to the default instructor when `instructor_id` is empty; PATCH denormalizes name/title from the instructor row when `instructor_id` is set. Existing sessions without an `instructor_id` keep their legacy text values.
- **Sidebar**: `Instructors` link added under Training Hub in `CmsAdminNav.tsx` (🎤 icon), between Live Sessions and Course Manager.

### Live Sessions — Native Assessment System (migration 105)
- **Tables**: `live_session_assessments` (one per session, stores `questions jsonb`, `pass_threshold`, `max_attempts`, `timer_minutes`, `require_watch_before_assessment`, `watch_threshold`) and `live_session_attempts` (per submission, unique on `(session_id, email, attempt_number)`). Denormalized `has_assessment` flag on `live_sessions` is kept in sync by `saveAssessment()` / `deleteAssessment()`.
- **Helper**: `src/lib/training/liveSessionAssessments.ts` — `getAssessment`, `saveAssessment`, `deleteAssessment`, `submitAttempt` (server-side scoring — compares against stored `correct_index` so clients can't cheat), `getStudentAttempts`, `getLatestAttempt`, `hasPassed`, `getWatchPercentage`, `isWatchRequirementMet`, `stripAnswersForStudent` (removes `correct_index` + `explanation` before shipping to clients).
- **Cookie helper**: `src/lib/training/trainingSessionCookie.ts` → `getTrainingCookieSession()` reads the httpOnly `training_session` cookie; used by all new student APIs.
- **Admin APIs**: `GET/PUT/POST/DELETE /api/admin/live-sessions/[id]/assessment` (admin role check via NextAuth), `GET /api/admin/live-sessions/[id]/attempts` (list every student attempt).
- **Student APIs**: `GET /api/training/live-sessions/[id]/assessment` (returns questions without answers), `POST /api/training/live-sessions/[id]/assessment/submit` (scores server-side, returns score + per-question correctness; correct answers + explanations only returned when the student passes), `GET /api/training/live-sessions/[id]/attempts` (student's own history, no answers leaked).
- **Admin UI**: `src/components/admin/LiveSessionAssessmentEditor.tsx` mounted inside `app/admin/training-hub/live-sessions/page.tsx` between the Attachments and Notifications sections. Enable toggle, pass-threshold slider (50–100%, step 5), max-attempts input, optional timer, watch-gate toggle + threshold, question list with up/down reorder + edit/delete, Tiptap-backed `RichTextarea` for question text + explanation, per-question 2–6 options with radio-to-mark-correct, Bulk Import JSON pane, self-contained Save/Delete buttons (does NOT merge into the existing `saveSession()` unified save).
- **Student page**: `/training/live-sessions` replaced its redirect with `app/training/live-sessions/page.tsx` (server) + `LiveSessionsClient.tsx` (client). Header: "LIVE SESSIONS" eyebrow + "FMP Real-World Financial Modeling" h1 + "Live sessions and recorded content" subtitle. 4-stat KPI row (Upcoming / Started / Watched / Achievement Cards). Two sections: **Upcoming** (sorted by `scheduled_datetime` ASC = soonest first) and **Recorded** (sorted ASC = oldest recording first, matching release order). Wrapped in `TrainingShell` with `activeNav="live-sessions"`.
- **LiveSessionCardLarge** (`src/components/training/dashboard/LiveSessionCardLarge.tsx`): matches the 3SFM SessionCard tokens (10px radius, 4px left-border state accent, tinted bg when passed/in-progress, 14–18px padding, 0 1px 4px rgba shadow, lift on hover). Upcoming variant: `UPCOMING` / `REGISTERED` / `LIVE NOW` badge + adaptive primary CTA (`Register` → `View Details` → `Starting soon →` → `Join Live →`) + `.ics` icon button. Recorded variant: `RECORDED` badge + `PASSED` corner badge when the student has passed, status chips (`Has Assessment` / `Assessment Passed · XX%` / `Max Attempts Reached`), watch-progress bar with a dashed threshold marker when an assessment gate exists, adaptive primary CTA (`Watch Recording` / `Continue Watching` / `Watch Again`), conditional `Take Assessment →` / `Retake Assessment →` / `🔒 Watch {threshold}% to unlock` secondary CTA, Share icon (uses universal `ShareModal`), and a gold `Award` icon that opens `ShareModal` prefilled with the existing `/api/training/achievement-image` URL (type inferred — uses live session title + score + date + student name + regId).
- **Achievement card eligibility**: with an assessment → must pass; without an assessment → watched ≥ threshold (default 70%). The card's Award button is only rendered in the eligible state.
- **Assessment taking page**: `/training/live-sessions/[id]/assessment` with server component fetching auth + session + assessment + prior attempts + watch%. `AssessmentClient` has three phases: **intro** (stats, prior attempts, watch-gate lock or attempts-exhausted lock, Start button), **quiz** (optional sticky countdown header, one-page all-questions layout with radio options, submit disabled until all answered), **result** (pass/fail icon, big score, per-question correctness with correct answer revealed only if passed, explanations if passed, Retake when attempts remain, View Achievement Card when passed).
- **Sidebar unchanged** (per spec): `TrainingShell` still shows the "Live Sessions" accordion; the new `/training/live-sessions` page is accessible via direct URL and via `activeNav` highlight.
- **Public `/training-sessions` unchanged** (per spec).

### Dashboard Live Sessions Cards
- `src/components/training/dashboard/LiveSessionCard.tsx` — two variants. **Upcoming** shows a banner with `UPCOMING` / `REGISTERED` / `LIVE NOW` badge, date/time/duration/instructor meta, and an adaptive CTA: `Register` → `View Details` (registered) → `Starting soon →` (≤15 min before, registered) → `Join Live →` (when `joinLinkAvailable`). Secondary icon is Add-to-Calendar (.ics). **Recorded** shows a teal `Recorded` badge, a green check corner when watched, date/duration/instructor meta, an amber watch-progress bar when `status=in_progress` with pct, an adaptive CTA `Watch Recording` / `Continue Watching` / `Watch Again`, and a Share icon that opens the universal `ShareModal`.
- `src/components/training/dashboard/LiveSessionsSection.tsx` — dashboard block with single "Live Sessions" header + two sub-grids (Upcoming and Recorded). Self-fetching via `getLiveSessionsForStudent(email)`. Renders nothing when neither subsection has data. Upcoming sub-grid shows registered sessions first. Layout: `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))`, matches Achievement/SessionCard visual scale (12px radius, 1px border, soft shadow, navy titles).
- Data helper: `src/lib/training/liveSessionsForStudent.ts` → `getLiveSessionsForStudent(email, courseId?, limit=3)` returns `{ upcoming, upcomingRegistered, recorded, regStatus, watchHistory }`. Wraps existing APIs (`/api/training/live-sessions?type=upcoming|recorded`, `/registration-status-batch`, `/watch-history`). `courseId` filter is a best-effort string match against `category` / `playlist.name` / `tags` (the schema has no course_id column).
- ICS helper: `src/lib/training/calendar.ts` → `downloadIcs(session)` — 90-min default when `duration_minutes` missing; no-op SSR-safe.
- Dashboard integration: `app/training/dashboard/page.tsx` replaced the old inline 3-col upcoming preview with `<LiveSessionsSection studentEmail={localSession.email} />`. The dashboard's own `upcomingSessions` state is retained solely to drive the sidebar live-now dot + quick-actions bar.

### Course Player System
- **CoursePlayerLayout**: `src/components/training/player/CoursePlayerLayout.tsx` — CFI-style: left sidebar, video, right comments panel
- **CourseTopBar**: `src/components/training/player/CourseTopBar.tsx` — dark sticky bar with actions, Mark Complete, Assessment, Continue
- **ShareModal**: `src/components/training/player/ShareModal.tsx` — Copy Link, LinkedIn, WhatsApp share
- **StudentNotes**: `src/components/training/StudentNotes.tsx` — per-session private notes with auto-save
- **WelcomeModal**: `src/components/training/WelcomeModal.tsx` — first-visit modal with YouTube+LinkedIn
- **FollowPopup**: `src/components/shared/FollowPopup.tsx` — reusable follow popup with LinkedIn+YouTube
- **Cert Watch Page**: `app/training/watch/[courseId]/[sessionKey]/page.tsx` — embedded player for certification courses
- **Live Sessions Tab**: Dashboard `?tab=live-sessions` renders `LiveSessionsContent.tsx` inline
- **Session Notes API**: `app/api/training/session-notes/route.ts` — GET+POST with upsert

### Training Hub Dashboard
- Dashboard has its OWN built-in header/sidebar (NOT TrainingShell)
- CMS logo fetched from `/api/cms?section=header_settings&keys=logo_url,logo_height_px`
- Live Sessions is a dashboard tab (`?tab=live-sessions`), not a separate page
- `/training/live-sessions` redirects to `/training/dashboard?tab=live-sessions`
- Sidebar accordion shows Upcoming/Recordings with counts
- Live Sessions label configurable via CMS key `training_hub/live_sessions_label`

### `/api/branding`
- GET is public (no auth) — PATCH requires admin

### Certification Watch Tracking
- **Table**: `certification_watch_history` (migration 088 base, migration 103 adds `watch_seconds`, `total_seconds`, `watch_percentage`, `last_position`, `updated_at`)
- **API**: `GET/POST /api/training/certification-watch` — POST accepts optional `watch_seconds`/`total_seconds`/`last_position` and uses MAX(existing, incoming) for seconds so stale updates never shrink progress
- **Watch page**: writes `in_progress` on video play, `completed` on Mark Complete
- **Dashboard**: fetches watch history, passes `completedWatchKeys`/`inProgressWatchKeys` + `watchPctMap` + `watchThreshold` to SessionCard
- **SessionCard**: "Take Assessment →" only when `isWatched=true`; StatusBadge shows "In Progress" amber badge; thin watch progress bar appears below the score row when a percentage exists and the session isn't yet passed

### Watch Enforcement — Default Behavior

All training sessions — current and future — enforce the watch threshold by default. No per-session seeding is required: a session has no `watch_enforcement_bypass_{TABKEY}` row → enforcement applies.

**Override precedence** (evaluated top-down, first match wins):
1. **NextAuth admin role** → always bypassed (lets admins test without watching)
2. **Global toggle OFF** (`watch_enforcement_enabled='false'`) → all sessions bypassed
3. **Per-session bypass** (`watch_enforcement_bypass_{TABKEY}='true'`) → that session bypassed
4. **Default** → enforce `watch_percentage ≥ watch_enforcement_threshold`

New sessions added to `src/config/courses.ts` automatically inherit global enforcement. They also appear in the admin Watch Enforcement per-session table on next page load (the table is a union of `COURSES` tab_keys + any tab_key observed in `certification_watch_history`).

**Certificate issuance gate** (`src/lib/training/watchThresholdVerifier.ts`): before `issueCertificateForPending` generates a cert, it calls `verifyWatchThresholdMet(email, courseCode)`. If any required session has `watch_percentage < threshold` and isn't bypassed, the cert is skipped (logged as `watch_threshold_not_met:` error). Rows that predate migration 103 (no watch data captured) are grandfathered so historical cert issuance isn't broken.

Admin actions at `/admin/training-settings`:
- Toggle global enforcement on/off
- Change threshold (50–100%, step 5)
- Add/remove per-session bypass exceptions
- Summary shows global status + threshold + enforcing/bypassed counts at a glance

### Mark Complete Gate

Uniform across the live-session watch page and the 3SFM/BVM certification watch page:

```
canMarkComplete = bypassActive || thresholdMet
```

- **`thresholdMet`** uses the interval-merged `watch_seconds / total_seconds`, which seeking forward can't inflate. `bypassActive` covers admin / global-off / per-session bypass.
- The earlier two-step gate also required `nearEnd = (currentPos >= totalSec - 20) || videoEnded` (commit 2026-04-23). It was dropped because returning students who had already crossed threshold but resumed mid-video had no way to surface the button without scrubbing back to the end. The interval-merging tracker already prevents skip-to-end abuse (skipping does not grow `watch_seconds`), so the `nearEnd` condition was redundant in the safe path and the only thing it actually did was hide the button from legitimately-finished students. Audit before the fix found 3 stuck students on `3SFM_S1`: one at 70% (under threshold), one at 76%, one at 93%.
- When `canMarkComplete` is false and the student has logged playback, CourseTopBar swaps Mark Complete for a ghost hint (`Watching… X%`) so the toolbar isn't empty.
- Server-side `/watched` + `/certification-watch` still re-check the stored `watch_percentage` against threshold before accepting `status='completed'`; a tampered client POST returns 403 with `{ current, required }`.

### Watch Resume / Continue (2026-04-21)

Resume from `last_position` works across logout/login and different devices for both watch pages. Chain:

1. **DB persistence** — every progress POST stores `watch_seconds`, `total_seconds`, `last_position`, `watch_percentage`, `status`. Wall-clock clamp prevents tampered inflation; MAX-merge prevents stale-client shrinkage.
2. **Page mount** — both watch pages fetch the stored row and seed `baselineWatchedSec` + `liveWatchSec` + `liveTotalSec` + `resumeAtSec`.
3. **YT start param** — `YouTubePlayer` accepts `startSeconds` and injects it into `playerVars.start` on `new YT.Player(…)`. YouTube honors the param reliably and survives buffering.
4. **Tracker floor** — `makeWatchTracker(baselineWatchedSeconds)` uses the baseline as a permanent floor so `watchedSeconds()` never drops below it; both pages wrap live emissions with `Math.max(prev, baselineWatchedSec, watchedSec)`.
5. **Cross-session** — DB keyed by `(email, session_id)` / `(email, tab_key)`, so any device with the same email sees the same resume state.

**Clamps applied before passing `resumeAtSec` to the player:**
- `status === 'completed'` → resume at 0 (rewatch from beginning, standard YouTube UX).
- `last_position ≤ 10s` → skip seek (treat as a fresh start).
- `last_position ≥ total − 30s` → skip seek (YT's `start` param loops back to 0 past-end).
- `last_position` null/missing → 0.

`resumePositionSeconds` is a new prop on `CoursePlayerLayout` that threads through to `YouTubePlayer.startSeconds`.

### Video Swap Auto-Detection (2026-04-21)

When an admin replaces a session's YouTube URL, the stored `total_seconds` will disagree with what the new player reports. Without intervention, the stored `watch_percentage` would be nonsense on the new video — possibly showing 100% completed against a video the student has never watched.

- **Helper**: `src/lib/training/detectVideoChange.ts` → `detectVideoChange(existingTotal, incomingTotal)` returns `{ changed: true, reason }` when `|existing − incoming| > 30s` **and** the relative diff exceeds 10%. Both a 0 on either side → `{ changed: false }` (unknown, don't trigger).
- **Applied to both endpoints**: `POST /api/training/certification-watch` + `POST /api/training/live-sessions/[id]/watched`. On verdict `changed=true`: reset `watch_seconds`/`total_seconds` to incoming, demote `status` to `in_progress`, clear `completed_at`/`watched_at`/`points_awarded`/`last_position`. Threshold guard then re-runs against the new video.
- **Admin nuclear reset**: `POST /api/admin/sessions/[tabKey]/reset-watch-progress` (admin-gated via NextAuth). Routes by prefix — `LIVE_<uuid>` → `DELETE FROM session_watch_history WHERE session_id=<uuid>`; everything else (e.g. `3SFM_S1`, `BVM_L3`, `3SFM_Final`) → `DELETE FROM certification_watch_history WHERE tab_key=<tabKey>`. Wipes every student's row so bypasses don't cover stale "completed" rows that wouldn't receive another tick from their owner.
- **Admin UI**: red "Reset Watch Progress" button inside both session editors — `/admin/training-hub/live-sessions` (uses `window.confirm` because the page shadows `confirm` with state) + `/admin/training/[courseId]`. Confirms before firing.

### Interactive Onboarding Tour (migration 120)

First-visit guided walkthrough of the Training Hub dashboard, powered by `driver.js@^1.4.0` (react-joyride rejected React 19 peer dep).

- **Component**: `src/components/training/DashboardTour.tsx` — runs once per student; highlights sidebar nav, courses, live sessions, profile menu, share button. Uses `data-tour="…"` attributes sprinkled on the real UI (no fake overlays).
- **State**: `training_registrations_meta.tour_completed BOOLEAN DEFAULT FALSE` (migration 120). One-shot: sets `true` on finish/skip.
- **API**: `POST /api/training/tour-status` — toggles the flag. Restart via profile dropdown's "Restart Tour" action (flips back to false).
- **Copy**: student-facing tour copy avoids mentioning the watch threshold percentage — the rule exists to gate progression, not to be advertised.

### Auto-Launch Cron (migration 118 — currently disabled)

Admins can schedule a Coming Soon → LIVE flip at a specific `launch_date`. Wiring is complete but **disabled** because Vercel Hobby only supports daily crons, and launch-flip needs 5-min granularity to be useful.

- **Settings seeded** (migration 118): `{training_hub,modeling_hub}_auto_launch` (`'false'`), `{training_hub,modeling_hub}_last_auto_launched_at` (`''`). Admins opt-in per hub.
- **Route**: `GET /api/cron/auto-launch-check` — polls `training_settings`, flips `coming_soon='false'` + `auto_launch='false'` (one-shot) + `last_auto_launched_at=ISO` when `enabled && auto_launch && launch_date <= now()`. `CRON_SECRET` bearer required.
- **UI gate**: `AUTO_LAUNCH_UI_ENABLED = false` in `LaunchStatusCard` hides the auto-launch opt-in until we upgrade to Pro. Manual toggles in `/admin/training-settings` + `/admin/modules` remain authoritative.
- **vercel.json**: the `*/5 * * * *` cron entry was rolled back. The route stays callable by hand for testing.

### Session Reminder Crons — per-registration flags (migration 122)

The 24h + 1h reminder crons previously used per-session flags on `live_sessions` (migration 043), which meant a student who registered inside the 24h window never got their reminder because the session-level flag was already set by the first registrant.

- **Migration 122**: adds `reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE` + `reminder_1h_sent BOOLEAN NOT NULL DEFAULT FALSE` to `session_registrations`. Partial indexes on `false` rows keep the lookup cheap.
- **Cron**: `GET /api/cron/session-reminders` — iterates rows where the appropriate flag is false and the session is within the corresponding window, fires `liveSessionNotificationTemplate('reminder_24h' | 'reminder_1h')`, flips the flag.
- **Session-level `announcement_sent`** stays on `live_sessions` — that gates whether reminders fire at all ("don't remind about an unpublished session").
- **Helper**: `src/lib/training/sessionAnnouncement.ts` centralizes the announce-on-publish / manual-announce email build so the cron, the admin `/notify` route, and the register endpoint don't drift.

### Training Hub Coming-Soon Bypass List (migration 121)

Modeling Hub's NextAuth admin role skips the Coming-Soon gate in `authorize()`. Training Hub uses a custom cookie-based session with no role field, so migration 121 adds a per-identifier allowlist in `training_settings`:

- **Key**: `training_hub_bypass_list` — comma-separated emails OR registration IDs (case-insensitive). Seeded with the owner's email + their RegID.
- **Helper**: `src/lib/shared/hubBypassList.ts` → `isIdentifierAllowed(identifier)` reads the list, splits, trims, lowercases, matches either field.
- **Guard**: `src/lib/shared/comingSoonGuard.ts` centralizes the signin/register CS gate — checks hub state, then the bypass list, then `?bypass=true`. Both `/training/signin` + `/training/register` call it server-side.
- **Banner**: `src/components/shared/PreLaunchBanner.tsx` shows a slim pre-launch banner on the authed dashboard for bypass-listed testers so they know they're viewing a live build while the hub is still Coming Soon to the public.
- **UI**: admin editor for the list isn't built yet — edit the `training_settings` row directly for now.

### Share Template `{hubUrl}` Variable (migration 119)

Centralized share templates gain a `{hubUrl}` variable that resolves to the learn subdomain. Migration 119 soft-upgrades 5 templates (`assessment_passed`, `achievement_card`, `live_session_watched`, `session_shared`, `daily_certifications_roundup`) by appending `\n\nLearn more at {hubUrl}` — but only when `template_text` doesn't already mention the learn subdomain OR the `{hubUrl}` placeholder. Admin edits are preserved. `certificate_earned` is intentionally excluded because it already embeds `{verifyUrl}`. Migration is idempotent: re-running is a no-op because the updated rows then match the skip predicate.

### Watch Enforcement (70% rule — migration 103)
- **Interval-merging tracker**: `src/lib/training/watchTracker.ts` — records `[start, end]` intervals from PLAYING → PAUSED/ENDED transitions, merges overlaps on every commit. Seeking forward, replaying, or skipping cannot inflate the count. A `baselineWatchedSeconds` seed ensures a reload with a higher DB value never makes the live counter go backwards.
- **YouTubePlayer**: now accepts `baselineWatchedSeconds` + `onProgress(watchedSec, totalSec, pos)`. Polls getCurrentTime every 1s during PLAYING, reports roughly every 10s (plus on pause/end/unmount). Seek detection: if `|pos - (lastPos + 1)| > 2s` we close the previous segment and open a new one at the current position.
- **Watch page** (`app/training/watch/[courseId]/[sessionKey]/page.tsx`): fetches `/api/training/watch-enforcement?tabKeys=...` for `{ enabled, threshold, sessionBypass[tk], isAdmin }`. Posts progress every ~10s (throttled: needs ≥10s elapsed AND ≥5s delta). Renders `<WatchProgressBar>` above the Mark Complete button (`belowVideoContent` prop on CoursePlayerLayout). Mark Complete callback only set when `!enforcing || threshold met`; when `undefined` the button is hidden by CourseTopBar.
- **Enforcement API**: `GET /api/training/watch-enforcement?tabKeys=3SFM_S1,3SFM_S2` returns global flag + threshold (default 70) + per-tab bypass map + `isAdmin` (checked via NextAuth session — Training Hub students always `false`).
- **Admin UI**: `/admin/training-settings` → Watch Enforcement card. Global toggle (stored `watch_enforcement_enabled`), threshold slider 50–100% step 5 (`watch_enforcement_threshold`), per-session bypass table iterating all `COURSES[*].sessions` with tab_key-keyed checkboxes (`watch_enforcement_bypass_{TABKEY}`).
- **Bypass precedence**: admin role → always bypass; global disabled → always bypass; per-session bypass → bypass for that session; else enforce at threshold.
- **Progress bar component**: `src/components/training/WatchProgressBar.tsx` — color scheme red <30% / amber <threshold / green ≥threshold, dashed vertical threshold marker, `X% to go` messaging, bypass-aware labels.

### Training Assessment Results (Supabase Primary)
- **Table**: `training_assessment_results` (migration 090) — `email + tab_key` UNIQUE
- **Dual-write**: `submit-assessment` route writes to both Apps Script AND Supabase
- **Progress merge**: `progress` route fetches Apps Script, then overlays Supabase data (Supabase wins)
- **Tab key mapping**: `3SFM_S1` → sessionId `S1`; `3SFM_Final` → `S18`; `BVM_Final` → `L7`
- **Emails**: submit-assessment sends quizResultTemplate + lockedOutTemplate directly from Next.js

### Achievement Card & OG Previews
- **Achievement image**: `GET /api/training/achievement-image` — satori ImageResponse, runtime=nodejs, sharp SVG→PNG
- **Logo**: fetches from `cms_content.header_settings.logo_url` with branding/platform fallback, converts SVG→PNG via sharp
- **Admin control**: `achievement_card_logo_height` setting in Admin → Header Settings
- **OG banners**: `/api/og` (learn), `/api/og/modeling` (app), `/api/og/main` (main) — CMS hero text fetched live
- **Per-domain layouts**: `training/layout.tsx`, `modeling/layout.tsx` with domain-specific metadata + `metadataBase`
- **Assessment OG**: `assessment/[tabKey]/layout.tsx` generates metadata with session name + course from `COURSES` config

### Share System (centralized templates, migrations 114-117)

Every share button across the Training Hub resolves its text from a single admin-editable source: the `share_templates` table plus four `training_settings` keys for global brand/founder mention strings and `@`-prefix toggles. Edit copy once at `/admin/training-hub/share-templates` → every surface (certificate verify page, dashboard cert card, achievement cards, assessment passes, live session shares, watch-page generic share) picks up the change.

- **Tables / settings**: `share_templates` (`template_key` UNIQUE, `title`, `template_text`, `hashtags[]`, `mention_brand`, `mention_founder`, `active`), seeded with 5 templates (certificate_earned, assessment_passed, achievement_card, live_session_watched, session_shared) + migration 117 adds `daily_certifications_roundup`. `training_settings` holds `share_brand_mention`, `share_founder_mention`, `share_brand_prefix_at`, `share_founder_prefix_at`. Legacy per-template `mention_brand`/`mention_founder` columns are retained for schema compat but ignored at render time — all `@`-prefix decisions are global.
- **Render engine** (`src/lib/training/shareTemplates.ts`): pure `renderShareTemplate(template, vars)` with placeholder syntax `{var}` + `{@brand}` + `{@founder}`. Auto-normalizes `{course}` via `resolveCourseName()` (maps COURSES short codes like `3SFM` to full titles like `3-Statement Financial Modeling`) and exposes `formatShareDate()` as the canonical `en-GB` long-form formatter (`20 March 2026`). Every share call site routes dates through `formatShareDate()` so the output is identical across components. `DEFAULT_TEMPLATES` mirrors the migration seed for offline fallback; `SAMPLE_VARS` powers the admin preview pane with realistic multi-line cohort data.
- **Client hook** (`src/lib/training/useShareTemplate.ts`): module-level cache + in-flight dedup — one fetch per key per session regardless of how many cards mount the same template. Returns the DB template merged with settings; falls back to `DEFAULT_TEMPLATES` on fetch failure.
- **LinkedIn flow** (`src/lib/training/share.ts` + `ShareModal.tsx`): LinkedIn always opens the plain feed composer (`/feed/?shareActive=true`) — never `share-offsite`. The full text with hashtags merged in lives in the clipboard, so paste-to-post is clean and `@`-mentions the user re-types trigger LinkedIn's native tag suggestions. ShareModal seeds the editable textarea with `text + "\n\n" + #hashtag #hashtag` so students see exactly what ends up on LinkedIn before clicking share.
- **Admin page** `/admin/training-hub/share-templates`: Global Mention Settings card (brand/founder handle inputs + `Prefix @` toggles + live preview), then per-template cards with title, template-text textarea, variable-picker chips, hashtag chip editor with reorder/remove, active toggle, live preview rendered with `SAMPLE_VARS`, and a Save button. Per-template `mention_brand`/`mention_founder` checkboxes removed — control is global.
- **Daily Certifications Roundup** (`/admin/training-hub/daily-roundup`, migration 117): date picker (defaults today, capped at today) + `GET /api/admin/certificates/by-date?date=YYYY-MM-DD` returning every `cert_status='Issued'` row for the UTC calendar day. Per-student checklist with Select all / Clear shortcuts; live preview rebuilds on every toggle using `renderShareTemplate(template, { studentList, verifyLinks, count, date })`. `studentList` rendered as `✅ Name — Full Course Title` lines; `verifyLinks` as bulleted verify URLs. Share Roundup button opens the universal ShareModal. Page auto-loads the latest admin-edited template from the public API on mount so copy edits on the Share Templates page flow through instantly. Nav entry: 🎓 Daily Roundup under Training Hub.
- **Migrated call sites** (zero structural churn — API merges settings into template response): `CertificateImageCard` (dashboard) + `VerifyActions` (verify page) → `certificate_earned`; `SessionCard` → `achievement_card`; assessment results page → `assessment_passed`; `LiveSessionCardLarge` watched share → `live_session_watched`; achievement card → `achievement_card`; `LiveSessionCard` recorded share → `live_session_watched`; watch-page `CourseTopBar` ShareModal forwarder → `session_shared`.

### Verify Page (learn.\*/verify/[uuid])

Public certificate verification page served on the learn subdomain as the canonical host — QR codes, share previews, and every user-facing verify URL resolves here.

- **Hero + main card**: dark gradient backdrop (navy 071530 → 0F3D6E), `NavbarServer`, `Credential Verified` pill, branded card with student name, course, grade pill, issue date, certificate ID (monospace), QR code, and a client `VerifyActions` component that owns the share flow.
- **Inline document previews**: 2-column grid — left column stacks Certificate (4:3 PDF iframe with browser-native viewer + `#toolbar=0&navpanes=0&scrollbar=0&view=FitH`) on top and Badge (1:1 `<img>` with soft-gold radial backdrop so transparent badges stay grounded) below; right column is the taller Transcript (3:4 PDF iframe, prefers pre-cached storage URL when `transcript_url` is set to keep the hash params intact, else routes through `/api/training/transcript-cached/[id]`). Each card has a navy header strip with gold/blue accent label, `Open Full ↗` link, and a floating `⛶ View` pill as mobile fallback. Downloads (PDF, Badge, Transcript) and Share Certificate buttons sit below the QR.
- **Metadata integrity**: `app/verify/layout.tsx` pins `metadataBase = LEARN_URL`, `alternates.canonical = LEARN_URL`, and default `openGraph.url = LEARN_URL` so nothing inherits the root layout's MAIN_URL. `generateMetadata` in the page further refines with the absolute `/verify/<id>` URL on learn for og:url + canonical + og:image (`/api/og/certificate/<id>`) + twitter:image. Share previews on LinkedIn/WhatsApp/Twitter display `learn.financialmodelerpro.com` in the card footer regardless of which subdomain the user shared from.

### Subdomain-Correct OG Metadata + robots.txt

- Root `app/layout.tsx` sets site-wide defaults at MAIN_URL. Per-subdomain layouts (`app/training/layout.tsx`, `app/modeling/layout.tsx`, `app/verify/layout.tsx`) each override `metadataBase`, `alternates.canonical`, and `openGraph.url` so pages under `/training/*`, `/modeling/*`, `/verify/*` default to their subdomain root instead of inheriting main. Specific pages (e.g. `/verify/[uuid]`) further refine with their full per-URL canonical.
- `app/robots.ts` — `/api/` is disallowed for SEO hygiene, but `/api/og/` is explicitly allowed (longest-match wins in robots.txt) so LinkedInBot / Twitterbot / WhatsApp can fetch the dynamic OG images embedded in share previews. Without this carve-out the bots fall back to generic main-site imagery.
- **Universal rule**: every page's `og:url` and `alternates.canonical` must match its actual URL. Share links preview themselves — never redirect preview to the parent page.

### Dashboard Live-Sessions Preview

Dashboard block (`src/components/training/dashboard/LiveSessionsSection.tsx`) shows **upcoming-only** — recordings live on the full `/training/live-sessions` page. Single "Upcoming Live Sessions" header with `View all →` link, grid capped at 3 cards (`auto-fit, minmax(260px, 1fr)` + `slice(0, 3)` on the data), `auto-fit` collapses gracefully to 2/1 columns on narrow viewports. Empty state: dashed-border placeholder with `CalendarClock` icon, "No upcoming live sessions scheduled" message, and a `Browse recordings →` link. Previously the whole block disappeared when nothing was upcoming.

### SEO — Search Engine Webmaster Verification

`app/layout.tsx` metadata.verification carries both search-engine ownership tokens:
- `google: 'jfT1RuMQksYExlTJUB_dB5Jisp_BBw6XCHEihIb-0pc'` — renders as `<meta name="google-site-verification">` for Google Search Console.
- `other: { 'msvalidate.01': '914C3726459EF363BC996DD79F3CF8E7' }` — renders as `<meta name="msvalidate.01">` for Bing Webmaster Tools.

Both verify automatically once Vercel redeploys; confirm via **Verify** button in each respective console.

### Newsletter System (migrations 091-092)
- **Tables**: `newsletter_subscribers` (email+hub UNIQUE, per-hub unsubscribe_token), `newsletter_campaigns` (subject, body, target_hub, status, sent/failed counts, campaign_type auto/manual, source_type/source_id)
- **Auto settings**: `newsletter_auto_settings` (event_type UNIQUE, enabled, target_hub) — 6 event types seeded disabled
- **Subscribe form**: `src/components/newsletter/NewsletterSubscribeForm.tsx` — hub checkboxes (Training/Modeling), shown in SharedFooter 4th column
- **Unsubscribe**: `GET /api/newsletter/unsubscribe?token=` — per-hub, HTML response page
- **Admin**: `/admin/newsletter` — 4 tabs (Subscribers, Compose, Campaigns, Auto Notifications)
- **Compose**: type selector (live session, recording, article, certification, custom), auto-populate from DB, AI Enhance via Anthropic API, Tiptap editor
- **Auto-notify**: `src/lib/newsletter/autoNotify.ts` — `sendAutoNewsletter()` fire-and-forget, duplicate prevention via unique index, triggered from article publish + live session publish/recording
- **Email template**: `src/lib/email/templates/newsletter.ts` — custom `baseLayoutNewsletter()` with "Structured Modeling. Real-World Finance." signature
- **Deduplication**: when sending to "all", deduplicates by email (one email per person)

### Legal Pages (migration 093)
- **Pages**: privacy-policy, terms-of-service, confidentiality, refund-policy (draft)
- **CMS**: all 4 as `cms_pages` + `page_sections` (rich_text type), editable in Page Builder
- **Rendering**: served by `app/(cms)/[slug]/page.tsx` dynamic route (old hardcoded routes deleted)
- **Footer**: Privacy Policy, Terms of Service, Confidentiality & Terms links in bottom row

### Founder Profile (migration 094)
- **New fields**: `why_fmp` (mission story), `expertise[]` (10 items), `industry_focus[]` (6 items), `market_focus`, `personal`
- **Updated fields**: `bio`, `credentials[]` (10 items), `long_bio` (full career narrative), `philosophy`
- **About page**: renders all new sections (Why FMP, Expertise as tag pills, Industry as grid cards, Market Focus, Personal)

### YouTube Engagement (watch page)
- **CourseTopBar**: lucide-react icons (Bell, ThumbsUp, MessageCircle, Share2), Subscribe has red accent
- **YouTubeComments**: comment count in header, "Join the Discussion" CTA, "Leave a Comment" link, "View all on YouTube" when 10+ comments
- **SupportBanner**: warm amber card above comments, Subscribe/Like/Comment/Share pills, dismissible via sessionStorage
- **Comment deep links**: use `?lc=` parameter instead of `#comments` for reliable YouTube scroll

### Badge Visual Upgrade
- **Progress badges**: emoji replaced with styled lucide-react icons in 48px colored circles (Footprints, Flame, Zap, Target, Rocket, Trophy, Sparkles, Timer)
- **Certificate badges**: Preview (Eye icon) modal + Download button on dashboard
- **Locked badges**: grayscale icon circles at 32px

### OG Image Font Loading
- **Fonts**: `src/assets/fonts/` — Inter-Regular.ttf, Inter-Bold.ttf, Inter-ExtraBold.ttf
- **Loader**: `src/lib/shared/ogFonts.ts` — `loadOgFonts()` with in-memory cache
- **Applied to**: `/api/og`, `/api/og/main`, `/api/og/modeling`, `/api/training/achievement-image`

### CMS Rich Text Rendering
- **RichTextarea**: `src/components/admin/RichTextarea.tsx` — contenteditable div with floating selection toolbar (B, I, U, Size, Color)
- **HTML detection**: `src/lib/shared/htmlUtils.ts` — shared `isHtml()` regex used by all renderers
- **renderCmsText.tsx**: shared `CmsText` component + `isHtml` re-export for section renderers
- **Global CSS**: `.fmp-rich-text` class in `globals.css` — headings, paragraphs, lists, links, blockquotes, b/i/u/s tags
- **All section renderers**: HTML detection → `dangerouslySetInnerHTML` with `fmp-rich-text` class
- **Portal page**: PaceMakers, Two Platforms, Founder card, FounderExpand all use isHtml() detection
- **VF component**: `showLayout` defaults to `true` — all Page Builder fields get Width % + Alignment dropdowns

### Marketing Studio (Phase 1.5 — migrations 100 + 101 + 102)
**Drag-and-drop canvas editor** (replaced Phase 1 fixed templates). Element-based design: text, image, shape elements positioned with absolute coords. Backed by `react-rnd` for drag + resize.

- **Admin page**: `/admin/marketing-studio` — top bar (preset picker, dimension inputs, save/download), canvas editor below. The canvas IS the WYSIWYG preview — no separate preview panel.
- **Canvas editor**: `src/components/marketing/canvas/CanvasEditor.tsx` — 3-column: left (Add Text/Image/Shape + Layers + Undo/Redo), center (canvas with auto-fit zoom via ResizeObserver), right (properties panel). Supports multi-element designs, history stack (50 entries), keyboard shortcuts (Delete/Backspace, Ctrl+Z/Y, Ctrl+D duplicate, Ctrl+C/V copy-paste, Arrow nudge ±1 / Shift+Arrow ±10, Escape deselect).
- **Element renderer**: `src/components/marketing/canvas/ElementRenderer.tsx` — pure React visual for text/image/shape. Shared logic with server render route (same prop shape, slightly different JSX because satori is strict).
- **Properties panel**: `src/components/marketing/canvas/PropertiesPanel.tsx` — switches based on selected element. Text (font, size, weight, color, alignment, line height, letter spacing, **italic toggle**, inline content textarea), Image (URL/upload/Brand Kit picker, object fit, border radius, opacity, brightness, filter, **border ring with color**, **lock aspect ratio toggle**), Shape (bg color, border radius, border width/color, opacity, **lock aspect ratio toggle**). When nothing selected → Background panel (solid color / gradient / image). Image-type backgrounds show a 3-col library grid with upload-and-save, delete (custom only), BRAND-type badge, and an optional dark overlay with color+opacity. Aspect ratio lock wires through to `react-rnd`'s `lockAspectRatio` prop — corner handles maintain W:H; images default to locked to prevent distortion.
- **Presets** (Phase 3A — 9 FMP + Blank, grouped by platform): `src/lib/marketing/presets.ts` — element-based starting points. `PRESETS` array grouped via `PRESET_GROUPS`: **YOUTUBE** (FMP YouTube Thumbnail 1280×720, FMP YouTube Banner 2560×1440), **LINKEDIN** (FMP LinkedIn Post 1200×627, FMP LinkedIn Banner 1584×396), **INSTAGRAM** (FMP Instagram Post 1080×1080, FMP Instagram Story 1080×1920), **FACEBOOK** (FMP Facebook Post 1200×630), **OTHER** (FMP Twitter/X Post 1600×900, FMP WhatsApp Status 1080×1920), **CUSTOM** (Blank Custom). Each exports `buildPreset(brandKit) → { background, elements }`. Legacy generic presets (YouTube / LinkedIn / Instagram / Story without FMP prefix) kept in `LEGACY_PRESETS` for backward compat with old saved designs but hidden from picker. FMP presets use element-id prefixes (`title-`, `subtitle-`, `insight-`, `headline-`, `session-`, `title2-`, `tag-`, `series-`) so Quick Fill + ZIP export can remap text content across formats. `FMP_EXPORT_PRESET_IDS` drives the ZIP export target list. `fmpBackground()` helper resolves brand-uploaded library image or gradient fallback consistently.
- **Template variants** (Phase 3A — 5 variants): `src/lib/marketing/variants.ts` — one-click layout swap on any preset, scaled to current dimensions. `VARIANTS`: **Session Announcement** (NEW SESSION badge + session#), **Quote / Insight** (giant teal quote marks + italic insight), **Platform Launch** (LAUNCHING tag + 3 feature bullets + CTA button), **Achievement Spotlight** (CONGRATS strip + student name + giant score stat), **Article Promo** (NEW ARTICLE tag + headline + excerpt + READ MORE button). Each variant's `build(kit, dims)` returns `{ background, elements }` computed from proportional scalars (padding = 5.5% of min dim, font sizes = 2.2%–14% of min dim, positions as % of W/H). `orientation(dims)` picks landscape / square / portrait / banner behavior. Variants use the same id-prefix convention so Quick Fill works on any variant. Default option restores the preset's native layout. `design.variant_id` stored in the existing `content` jsonb column — no new migration needed.
- **Auto-populate (Quick Fill)**: `src/components/marketing/QuickFillPanel.tsx` — pick data source (Training / Live Session / Article) + item → click Apply → `autoFillElements()` in `src/lib/marketing/autoFill.ts` rewrites text element content by id-prefix bucket matching. Data source API: `GET /api/admin/marketing-studio/data-sources` returns `{ articles, liveSessions, trainingSessions }` (articles from `articles` table where status=published, live sessions from `live_sessions`, training from `src/config/courses.ts` `COURSES` constant, flattened into `{CourseKey}:{SessionId}` ids).
- **Multi-platform captions**: `src/components/marketing/CaptionsPanel.tsx` — LinkedIn / Instagram / Facebook / WhatsApp / Twitter / YouTube checkboxes, tone selector (Professional / Casual / Thought Leader / Educational), single "Generate All" button. API `POST /api/admin/marketing-studio/generate-captions` takes `{ template_type, elements, platforms[], tone }` and parallelises `Promise.all(platforms.map(...))` — one Claude call per platform with tailored prompt + tone modifier. Returns `{ captions: Record<platform, string> }`. Results shown in per-platform tabs with editable textarea, char count, copy button. Captions stored in `design.ai_captions` jsonb and persist via existing designs PATCH.
- **Saved designs sidebar**: `src/components/marketing/DesignsSidebar.tsx` — thumbnail grid (lazy-renders one design at a time via `/render`, caches blob URLs in component state, revokes on unmount), template-type filter dropdown, click to load, × to delete. Shows category icon + name + updated date.
- **Export to All Platforms (ZIP)**: `📦 Export All` button — lifts current design's text content (title/subtitle/session via reading-order heuristic), rebuilds each FMP preset with that content via `autoFillElements()`, renders all three to PNGs, zips them with `jszip`, triggers download. Output filenames `{slug}_youtube_1280x720.png`, `{slug}_linkedin_1200x627.png`, `{slug}_instagram_1080x1080.png`.
- **Render API**: `POST /api/admin/marketing-studio/render` — accepts `{ dimensions, background, elements }` payload. Pre-resolves all image URLs to base64 data URIs (sharp handles SVG→PNG), builds satori-compatible JSX with absolute-positioned divs, returns `ImageResponse` PNG at target dimensions.
- **Brand Kit**: `marketing_brand_kit` table (single row id=1) + migration 101 arrays `additional_logos`, `additional_photos`, `uploaded_images` (each `[{url, name}]`) + migration 102 `background_library` (`[{id, name, url, thumbnail, type: 'brand'|'custom'}]`). Editor at `/admin/marketing-studio/brand-kit` — upload libraries of logos/photos/images that the canvas image element can pull from via a grid picker. Background library managed inline from the canvas Background panel: upload a background → saves to library + applies immediately. Brand-typed backgrounds can't be deleted.
- **Designs**: `marketing_designs` table + migration 101 columns `dimensions jsonb`, `background jsonb`, `elements jsonb`. `content` column retained for backward compat (unused by canvas-mode). List/create `/api/admin/marketing-studio/designs`, update/delete `/api/admin/marketing-studio/designs/[id]`.
- **AI captions**: `POST /api/admin/marketing-studio/generate-caption` — Anthropic Claude (`claude-sonnet-4-20250514`), extracts text content from canvas elements (sorted by y then x reading order), generates platform-specific copy for LinkedIn / YouTube / Instagram / Twitter. Caption embedded in same page below canvas.
- **Types**: `src/lib/marketing/types.ts` — `CanvasElement` (text/image/shape), `CanvasBackground` (color/gradient/image), `Design` (dimensions + background + elements + ai_captions), `BrandKit` (with array fields).
- **Helpers**: `src/lib/marketing/canvasDefaults.ts` — `makeTextElement`/`makeImageElement`/`makeShapeElement` factories, `backgroundToCss()` shared by editor + server render, `uid()` id generator.
- **Admin nav**: Marketing Studio link under Content section in `CmsAdminNav.tsx`.
