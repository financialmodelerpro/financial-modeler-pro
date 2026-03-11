# REFM Pro — Claude Code Project Brief

## Project Overview
Real Estate Financial Modeling Platform (REFM Pro)  
Multi-tenant SaaS shell with white-label branding + financial modeling engine.  
Stack: React 18 (CDN) + Tailwind (CDN) + Babel standalone. No build tool — runs directly in browser.

## File Structure
```
refm-platform/
├── index.html              # App shell, CDN imports, root div (4 KB)
├── styles.css              # Full design system — tokens, sidebar, all components (47 KB)
└── js/
    ├── app.js              # Entry point — mounts root component, routing (2 KB)
    ├── branding.js         # White-label branding engine, theme controls (52 KB) ← IN PROGRESS
    ├── portal.js           # Portal/tenant layer, multi-project navigation (14 KB)
    ├── projects.js         # Project manager — save/load/version (1 KB)
    ├── refm-platform.js    # Core financial modeling engine — Module 1 complete (1,672 KB)
    └── settings.js         # App settings, user preferences (4 KB)
```

## Work In Progress — Current Focus
**Branding, White-Label & Controls** (`branding.js`)
- Mid-implementation — do NOT refactor or restructure without asking
- White-label theming engine
- Branding controls UI
- Tenant-level customization

## Design System (DO NOT CHANGE)
- All colors via CSS custom properties: `--color-primary`, `--color-primary-dark`, etc.
- Spacing on 8px grid: `--sp-1` (8px) through `--sp-5` (48px)  
- Typography scale: `--font-h1` through `--font-micro`
- Component classes: `.card`, `.kpi-card`, `.btn-primary`, `.table-standard`
- Yellow background `--color-warning-bg` on all assumption/input fields

## Module Status (inside refm-platform.js)
- Module 1 — Project Setup & Financial Structure: ✅ COMPLETE
  - Tabs: Timeline, Land & Area, Development Costs, Financing
  - Exports: Excel (xlsx), PDF (jsPDF), JSON save/load
  - Financing: Debt/equity schedules, interest capitalization, cash sweep
- Module 2 — Revenue Analysis: ⬜ NOT STARTED
- Module 3 — Operating Expenses: ⬜ NOT STARTED
- Module 4 — Returns & Valuation: ⬜ NOT STARTED
- Module 5 — Financial Statements: ⬜ NOT STARTED
- Module 6 — Reports & Visualizations: ⬜ NOT STARTED

## Sidebar Architecture (styles.css + branding.js)
- Collapsible: 240px expanded → 52px collapsed
- Active state: border-left 4px solid var(--color-primary) + subtle bg + font-weight 600
- Tooltips on hover when collapsed
- Fixed layout — only .main-content scrolls

## Key Conventions
- Financial inputs: `.input-assumption` class (yellow bg)
- Construction phase = blue, Operations phase = green
- `modelType`: 'monthly' | 'annual' — drives all period calculations
- Assets: residential, hospitality, retail (toggled by projectType)
- Currency + number formatting via shared utils

## Pending Sidebar Refinements (9 items from brief)
Apply to styles.css:
1. Sidebar bg → #112F4F (softer navy)
2. Active item: 4px primary border-left + subtle bg + font-weight 600 + 0.2s ease
3. Collapsed icons centered, transition 0.2s, no jitter
4. Fixed layout: html/body overflow:hidden, only .main-content overflow-y:auto
5. Topbar + sidebar-header both 40px height
6. Content padding via var(--sp-4), no inline overrides
7. Module transitions: opacity 0.15s ease only
8. Footer border-top + divider above Tools section
9. Remove margin-left hacks — pure flexbox throughout

## Warning — refm-platform.js is 1,672 KB
This file is very large. When working on it:
- Always ask Claude to read it fully before making edits
- Make targeted edits only — do not rewrite entire sections unnecessarily
- Prefer surgical str_replace edits over full rewrites
