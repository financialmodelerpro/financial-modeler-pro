# Pending Work & Backlog

> Referenced from CLAUDE.md — features not yet started or in progress.

---

## Recently Completed (This Session)

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
