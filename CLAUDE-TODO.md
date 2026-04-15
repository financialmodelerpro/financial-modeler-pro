# Pending Work & Backlog

> Referenced from CLAUDE.md — features not yet started or in progress.

---

## Recently Completed (This Session)

| Feature | Status |
|---------|--------|
| **CFI-style Course Player** | Complete — CoursePlayerLayout, CourseTopBar, ShareModal, sidebar, three-column layout |
| **Certification Watch Page** | Complete — `/training/watch/[courseId]/[sessionKey]`, embedded player, timer, Mark Complete → Assessment flow |
| **Student Notes** | Complete — per-session notes with toolbar, auto-save, API route, migration 086 |
| **Subscribe Modal** | Complete — replaced g-ytsubscribe widget with reliable YouTube link |
| **Welcome Modal** | Complete — first-visit modal with YouTube+LinkedIn on Training Hub + public pages |
| **Follow Popups** | Complete — LinkedIn+YouTube in footer, sidebar, post-complete, 60s video, site-wide |
| **Live Sessions Dashboard Tab** | Complete — `?tab=live-sessions`, search filter, redirect from old page |
| **Training Hub Logo** | Complete — CMS logo on TrainingShell + dashboard, minHeight fix |
| **Sidebar Consistency** | Complete — Course player sidebar matches dashboard (navy bg, same styles) |
| **Live Sessions Accordion** | Complete — sidebar dropdown with Upcoming/Recordings groups + counts |
| **Training Sessions Subdomain** | Complete — rewrites, redirects, all links point to learn. subdomain |
| **Video Timer Improvements** | Complete — onNearEnd 20s before end, timer bypass race fix, dashboard timer removed |
| **Live Sessions Label CMS** | Complete — admin-controllable via `training_hub/live_sessions_label` (migration 087) |

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
