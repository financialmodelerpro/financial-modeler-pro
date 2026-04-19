# Pending Work & Backlog

> Referenced from CLAUDE.md — features not yet started or in progress.

---

## Recently Completed — Share Templates + Verify Previews + OG canonicalization (2026-04-19 / 2026-04-20 session)

| Feature | Status |
|---------|--------|
| **Share templates — centralized system** (migrations 114-117) | Complete — `share_templates` table + four `training_settings` keys for global brand/founder mention strings + `@` prefix toggles. Render engine at `src/lib/training/shareTemplates.ts` with `renderShareTemplate`, `resolveCourseName`, `formatShareDate`. Client hook `useShareTemplate` with module cache + fallback. Admin page `/admin/training-hub/share-templates` with Global Mention Settings card + per-template editor. 5 seeded templates (certificate_earned, assessment_passed, achievement_card, live_session_watched, session_shared). Every share call site migrated (CertificateImageCard / VerifyActions / SessionCard / LiveSessionCard(Large) / assessment results / CourseTopBar). Commits `e155b54`, `a667c8d`, `fe8e6e3`, `0604db5`, `e691c92`. |
| **Daily certifications roundup** (migration 117) | Complete — `/admin/training-hub/daily-roundup` admin page + `GET /api/admin/certificates/by-date` endpoint. Template uses `{studentList}`, `{verifyLinks}`, `{count}`, `{date}`. One roll-up post per day instead of one post per student. Share Roundup button opens universal ShareModal. Nav entry 🎓 Daily Roundup under Training Hub. Commit `3c0f752`. |
| **Verify page — inline PDF + badge previews** | Complete — 2-column preview grid: Certificate PDF (4:3 iframe) + Badge PNG (1:1 img with soft-gold radial backdrop) on left, Transcript PDF (3:4 iframe, pre-cache-first) on right. Navy header strips + `Open Full ↗` + floating `⛶ View` mobile pill. Commits `5cb1c7e`, `608c4aa`. |
| **Dashboard cert share — ShareModal preview** | Complete — `CertificateImageCard` opens ShareModal with OG certificate image preview + editable text + platform buttons matching Achievement Card pattern. Commit `70f305a`. |
| **Subdomain-correct OG metadata + LinkedIn OG image** | Complete — `app/verify/layout.tsx` created with `metadataBase` / canonical / og:url pinned to LEARN_URL. Training + Modeling layouts gained explicit `alternates.canonical`. `robots.ts` adds `Allow: /api/og/` so LinkedInBot can fetch OG images. `URLS.verify` helper canonicalized to learn subdomain. Admin certificates fallback no longer routes legacy certifier_uuid certs to main. Sitemap lists `/verify` on learn. Commits `2097ddb`, `756cff9`. |
| **Share text — course name + date format fixes** | Complete — `resolveCourseName()` + `formatShareDate()` baked into render engine. `/api/training/certificate` no longer prefers `course_code` over `course` (was serving "3SFM" to dashboard). All call sites route dates through `formatShareDate()`. ShareModal now seeds draft with text + hashtags merged so students see exactly what's copied. Commits `fe8e6e3`, `0604db5`. |
| **Dashboard upcoming-only live sessions preview** | Complete — removed Recorded sub-section from dashboard block (full library stays on `/training/live-sessions`). Grid capped at 3 cards. Empty-state card replaces silent disappearance. Commit `bbc37be`. |
| **Google Search Console verification** | Complete — token added to `app/layout.tsx` metadata.verification. Commit `4d31229`. |
| **Bing Webmaster Tools verification** | Complete — `msvalidate.01` token added via `metadata.verification.other`. Both `<meta name="google-site-verification">` and `<meta name="msvalidate.01">` render sitewide. Commit `578eed7`. |

---

## Recently Completed — Marketing Studio + Watch Enforcement (2026-04-18 session, continued)

| Feature | Status |
|---------|--------|
| **Marketing Studio — Phase 1** (migration 100) | Complete — `marketing_designs` + `marketing_brand_kit` tables. 3 templates (YouTube Thumbnail / LinkedIn Post / Instagram Post) via satori `ImageResponse`. Admin page at `/admin/marketing-studio`, Brand Kit editor at `/admin/marketing-studio/brand-kit`. Anthropic single-platform caption generator. Saved designs list. Admin nav entry under Content. Commit `a21d1c5`. |
| **Marketing Studio — Phase 1.5 (canvas editor)** (migration 101, `react-rnd@^10.5.3`) | Complete — drag-and-drop canvas replaces fixed templates. Element-based design (text / image / shape) with absolute positioning. `react-rnd` drag + resize, auto-fit zoom, undo/redo stack (50), keyboard shortcuts (Delete / Ctrl+Z/Y / Ctrl+D / Ctrl+C/V / Arrow nudge). `src/components/marketing/canvas/{CanvasEditor,ElementRenderer,PropertiesPanel}.tsx`. 5 starting presets + Blank Custom. Migration 101 adds `dimensions`/`background`/`elements` jsonb to `marketing_designs` + `additional_logos`/`additional_photos`/`uploaded_images` to `marketing_brand_kit`. Commit `2e8f624`. |
| **Marketing Studio — Custom backgrounds + aspect-ratio lock + FMP YouTube preset** (migration 102) | Complete — `background_library` jsonb added to `marketing_brand_kit`. Background panel: upload → save to library → reuse; brand-typed entries non-deletable; optional dark overlay. `lockAspectRatio` toggle per image/shape element (images default ON). Image elements support border ring (color + width). Text element italic toggle. `fmpYoutubeThumbnailPreset` with session badge, teal ring founder photo, gold dividers. Commit `025563a`. |
| **Marketing Studio — Phase 2 (multi-platform + auto-populate + multi-caption)** (`jszip@^3.10.1`) | Complete — FMP LinkedIn Post + FMP Instagram Post presets. Quick Fill panel auto-populates text from articles / live sessions / training sessions via id-prefix matching. Multi-platform caption generator (LinkedIn / Instagram / Facebook / WhatsApp / Twitter / YouTube) with parallel `Promise.all` + tone selector (Professional / Casual / Thought Leader / Educational). Export to All Platforms ZIP. Saved designs sidebar with lazy-rendered thumbnails + template filter. Commit `9dfaeb3`. |
| **Marketing Studio — Phase 3A (9 FMP presets + 5 variants)** | Complete — 6 new FMP platform presets: YouTube Banner 2560×1440, LinkedIn Banner 1584×396, Instagram Story 1080×1920, Facebook Post 1200×630, Twitter/X 1600×900, WhatsApp Status 1080×1920. 5 template variants scaled proportionally to any dimensions: Session Announcement, Quote/Insight, Platform Launch, Achievement Spotlight, Article Promo. Preset picker grouped by platform (YOUTUBE / LINKEDIN / INSTAGRAM / FACEBOOK / OTHER / CUSTOM). `variant_id` persisted in existing `content` jsonb — no migration. Commit `283e9b4`. |
| **Video Watch Enforcement (70% rule)** (migration 103) | Complete — client-side interval-merging tracker (`src/lib/training/watchTracker.ts`) so seeking can't inflate counts. YouTubePlayer reports `onProgress(sec, total, pos)` every ~10s. Watch page posts to `/api/training/certification-watch` with MAX server-side merge. Mark Complete gated until `watch_percentage ≥ threshold`. `WatchProgressBar` component above Mark Complete + thin bar on dashboard session cards (red <30% / amber <threshold / green ≥threshold + dashed threshold marker). Migration 103 adds `watch_seconds`/`total_seconds`/`watch_percentage`/`last_position`/`updated_at` to `certification_watch_history` + seeds `watch_enforcement_enabled`/`_threshold` in `training_settings`. Commit `1db1430`. |
| **Watch Enforcement — default for all future sessions** | Complete — missing bypass row = enforcing (no seeding needed). Admin UI session list is union of `COURSES` + distinct tab_keys in `certification_watch_history`. Status badges show "Enforcing (default)" vs "Bypassed" vs "Global OFF". Summary card shows enforcing/bypassed counts at a glance. `verifyWatchThresholdMet()` in `src/lib/training/watchThresholdVerifier.ts` gates cert issuance in `processPendingCertificates` — grandfathers pre-migration-103 rows (no watch data) so historical certs aren't blocked. New endpoint `/api/admin/watch-enforcement-stats`. Commit `0950ac7`. |

---

## Recently Completed — CMS Universalization + Training Hub fixes (2026-04-18 session)

| Feature | Status |
|---------|--------|
| **CmsField — Universal Rendering (Phase 1)** | Complete — `src/components/cms/CmsField.tsx` is the only way CMS text reaches the frontend. All 21 section renderers + all Option B pages use it. Handles visibility / alignment / width / HTML detection / paragraph splitting. Enforcement docstring + CLAUDE.md rules. |
| **RichTextarea → Tiptap (Phase 2A)** | Complete — rewrote `src/components/admin/RichTextarea.tsx` as a Tiptap editor with StarterKit + Underline + Link + Color + TextStyle + custom FontSize. Installed `@tiptap/extension-underline@2.27.2`. Replaced 10 plain textareas with RichTextarea. Removed legacy `ParagraphsEditor` + `AlignPicker` (orphan `content.paragraphs[]` harmless). |
| **Array Item VF + TwoPlatforms fix (Phase 2B)** | Complete — `ItemVF` / `ItemBar` helpers in page-builder. Per-item VF on 9 array editors. TwoPlatforms VF keys now stored inside `columns[i]`. 8 frontend renderers filter `item.visible !== false`. Migration 097 backfill. |
| **Attempts counter (server-authoritative)** | Complete — `/api/training/submit-assessment` increments `attempts` from existing Supabase row, ignoring stale client `attemptNo`. `/api/training/attempt-status` overlays Supabase over Apps Script. |
| **Timer persistence + auto-submit** | Complete — localStorage `assessment_timer_${tabKey}_${attemptNo}` records start epoch. Page remount resumes clock; expiry auto-submits saved answers; counts as the attempt. `beforeunload` guard during 'taking'. |
| **Retake flow fix** | Complete — `/api/training/certification-watch` guards against `'completed' → 'in_progress'` downgrade. 'completed' is terminal. Fixes "had to re-mark complete after failed attempt" bug. |
| **Universal Share Utility** | Complete — `src/lib/training/share.ts` `shareTo()` + `src/components/training/share/ShareModal.tsx`. Copy-first-then-open pattern. Dashboard + watch-page + SessionCard + assessment results all use the utility. |
| **Calendly inline embed** | Complete — `src/components/booking/CalendlyEmbed.tsx` dynamically loads widget.js on mount. `/book-a-meeting` embeds inline (no redirect). Reads URL from `page_sections.team.content.booking_url`. Fallback to contact options when URL empty. |
| **founder_profile table dropped** | Complete — Migration 098. Deleted `/admin/founder/` + `/api/admin/founder/` + `getFounderProfile()` from `src/lib/shared/cms.ts`. All founder data lives in `page_sections.team`. |
| **/about page removed** | Complete — Deleted `app/about/page.tsx`. Redirect `/about → /about/ahmad-din` in next.config.ts. Footer + nav entries repointed. Migration 099 cleans up orphan DB rows. |
| **Founder contact fields** | Complete — Email + WhatsApp added to FounderEditor Booking Page tab. "Get in Touch" section at bottom of `/about/ahmad-din` shows email/WhatsApp/LinkedIn/booking as readable clickable text. Hero buttons kept LinkedIn + Book a Meeting only. |
| **Hero universal VF** | Complete — Home, Training, Modeling, Modeling [slug], Founder page heroes all respect `cmsVisible` + `fw()` + `CmsField`. Missing fields (powerStatement/softCta/trustLine/tags) added to Modeling Hub hero. Width pattern `min(1200px, 90vw)` + subtitle maxWidth 960 standardized across heroes. |
| **CTA field-name dual-read** | Complete — Modeling + Training pages read admin's `buttonText`/`buttonUrl`/`subtitle` first, fall back to legacy `cta_text`/`cta_url`/`description`. Fixes "bottom CTA edits not reflecting". |

---

## Previous Session (earlier)

| Feature | Status |
|---------|--------|
| **Assessment Internal Route** | Complete — assessment uses `/training/assessment/[tabKey]` instead of Apps Script formUrl (always empty). Dashboard shows "Take Assessment →" button |
| **Dashboard Header Match** | Complete — dashboard header matches main Navbar: rgba bg, blur, 64px height, 40px padding, border-bottom |
| **Certification Watch Tracking** | Complete — `certification_watch_history` table (migration 088). Watch page writes in_progress on play, completed on Mark Complete. Dashboard gates assessment behind completion |
| **Email Migration to Next.js** | Complete — quizResult, registrationConfirmation, lockedOut emails now sent from Next.js. `/api/email/send` bridge kept for backwards compat. Migration 089 syncs email logo |
| **Supabase Assessment Results** | Complete — `training_assessment_results` table (migration 090). Dual-write: Apps Script + Supabase. Progress route merges Supabase over Apps Script for instant reads |
| **In Progress Status Badge** | Complete — StatusBadge shows amber "In Progress" when video started/completed but assessment not taken |
| **Achievement Card System** | Complete — dynamic OG image (`/api/training/achievement-image`), satori ImageResponse, sharp SVG→PNG logo, student name + reg ID + score + course + date. Admin-controlled logo height |
| **Share System** | Complete — SessionCard: Share modal (textarea, LinkedIn auto-copy + compose, Copy Text) + Card modal (preview + download). Assessment result page: same pattern. LinkedIn opens compose with auto-copied text |
| **OG Social Previews** | Complete — Per-domain OG banners: `/api/og` (learn), `/api/og/modeling` (app), `/api/og/main` (main). CMS-driven hero text, logo from header_settings (sharp SVG→PNG). Assessment layout.tsx with dynamic OG tags. metadataBase on all layouts |
| **LinkedIn + YouTube Sidebar** | Complete — Follow Us section in dashboard sidebar with LinkedIn + YouTube buttons (expanded + collapsed states) |
| **Back to Course Navigation** | Complete — assessment page "Back to Dashboard" includes `?course=` param for correct course context |
| **Watch Page Passed State** | Complete — shows "Assessment Done" instead of "Take Assessment" when session already passed. assessmentPassed prop through CoursePlayerLayout → CourseTopBar |
| **Assessment Blocks Passed** | Complete — assessment page checks progress API (Supabase-merged) on mount, immediately shows "Already Passed" screen if session passed |
| **Dashboard Share Banner** | Complete — "Enjoying your progress?" banner opens modal (same pattern as session share) with textarea + LinkedIn + Copy Text |

---

## In Progress

| Feature | Current State | What Remains |
|---------|--------------|--------------|
| **AI Agents** | Market rates + research agents wired | Contextual help agent (stub only) |
| **Pricing / Subscriptions** | Plans + features in DB | Enforcement partial — needs gating logic |
| **White-label / Branding** | DB-driven config, BrandingThemeApplier wired | Full theming coverage |

---

## Not Started — REFM Modules

| Module | Name | Status |
|--------|------|--------|
| Module 2 | Revenue Analysis | Stub only |
| Module 3 | Operating Expenses | Stub only |
| Module 4 | Returns & Valuation | Stub only |
| Module 5 | Financial Statements | Stub only |
| Module 6 | Reports & Visualizations | Stub only |
| Modules 7–11 | (various) | Placeholder stubs |

---

## Not Started — Modeling Platforms

| Platform | Slug |
|----------|------|
| Business Valuation Modeling | `bvm` |
| FP&A Modeling Platform | `fpa` |
| Equity Research Modeling | `erm` |
| Project Finance Modeling | `pfm` |
| LBO Modeling Platform | `lbo` |
| Corporate Finance Modeling | `cfm` |
| Energy & Utilities Modeling | `eum` |
| Startup & Venture Modeling | `svm` |
| Banking & Credit Modeling | `bcm` |

All have config in `src/config/platforms.ts` but no platform content.

---

## Legacy Reference

`_legacy_backup/js/refm-platform.js` — 7,599-line original CDN implementation.
- AppRoot: lines 1-70 | State: 72-200 | Calculations: 200-900
- Excel export: 900-1,900 | Project Manager UI: 1,900-3,800
- Main render: 3,800-5,700 | Module 1 UI: 5,700-7,520 | Stubs: 7,520-7,598
