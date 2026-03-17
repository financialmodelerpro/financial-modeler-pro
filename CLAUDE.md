# REFM Pro — Claude Code Project Brief

## Project Overview
Real Estate Financial Modeling Platform (REFM Pro)
Multi-tenant SaaS shell with white-label branding + financial modeling engine.
**Stack: Next.js 15 (App Router) + TypeScript + Tailwind CSS 4 + Zustand**

---

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 — App Router (`app/` directory) |
| Language | TypeScript — strict mode |
| Styling | Tailwind CSS 4 (`@import "tailwindcss"`) + CSS custom properties |
| State | Zustand for client state |
| Charts | Recharts |
| Database | Supabase (`@supabase/supabase-js`) |
| Auth | NextAuth.js |
| Forms | react-hook-form + zod + @hookform/resolvers |
| Icons | lucide-react |
| Utilities | clsx, tailwind-merge |
| AI | @anthropic-ai/sdk |
| Export | exceljs + @react-pdf/renderer |

---

## File Structure (Next.js)
```
financial-modeler-pro/
├── app/
│   ├── (portal)/page.tsx        # Portal hub — pixel-identical to legacy
│   ├── refm/page.tsx            # REFM financial modeling platform
│   ├── admin/page.tsx           # Admin panel
│   ├── settings/page.tsx        # User settings
│   ├── login/page.tsx           # Auth / login
│   ├── globals.css              # Full design system (Tailwind + all tokens)
│   ├── layout.tsx               # Root layout — Inter font
│   └── api/
│       ├── agents/market-rates/route.ts
│       ├── agents/research/route.ts
│       ├── projects/route.ts
│       ├── export/excel/route.ts
│       ├── export/pdf/route.ts
│       ├── health/route.ts
│       └── auth/[...nextauth]/route.ts
├── src/
│   ├── modules/
│   │   ├── module1-setup.ts     # ✅ Project Setup & Financial Structure
│   │   ├── module2-revenue.ts   # ⬜ Revenue Analysis (stub)
│   │   ├── module3-opex.ts      # ⬜ Operating Expenses (stub)
│   │   ├── module4-returns.ts   # ⬜ Returns & Valuation (stub)
│   │   ├── module5-statements.ts# ⬜ Financial Statements (stub)
│   │   ├── module6-reports.ts   # ⬜ Reports & Visualizations (stub)
│   │   └── module7-11-*.ts      # ⬜ Future modules (stubs)
│   ├── core/
│   │   ├── core-state.ts        # ROLES, PERMISSIONS, MODULE_VISIBILITY
│   │   ├── core-calculations.ts # Pure calculation functions (no React)
│   │   ├── core-formatters.ts   # formatNumber, formatCurrency, etc.
│   │   ├── core-validators.ts   # Validation utilities
│   │   └── branding.ts          # White-label engine, PLATFORM_REGISTRY
│   ├── agents/
│   │   ├── agent-contextual.ts  # Claude contextual help agent
│   │   ├── agent-research.ts    # Research agent
│   │   └── agent-market-data.ts # Market data fetch agent
│   ├── export/
│   │   ├── export-pdf.ts        # PDF export via @react-pdf/renderer
│   │   ├── export-excel-static.ts  # Static Excel via exceljs
│   │   └── export-excel-formula.ts # Formula-based Excel
│   ├── hooks/
│   │   ├── useSubscription.ts   # Subscription/plan hook
│   │   ├── useWhiteLabel.ts     # White-label branding hook
│   │   └── useProject.ts        # Project load/save hook
│   ├── types/
│   │   ├── project.types.ts     # Module 1 data model types
│   │   ├── revenue.types.ts     # Module 2 types
│   │   ├── branding.types.ts    # BrandingConfig, PlatformEntry
│   │   ├── subscription.types.ts# UserSubscription
│   │   ├── settings.types.ts    # Role, Permission types
│   │   ├── scenario.types.ts    # Scenario analysis types
│   │   └── deck.types.ts        # Presentation deck types
│   └── lib/
│       └── supabase.ts          # Supabase client
└── _legacy_backup/              # Original CDN-based source (reference only)
    ├── index.html
    ├── styles.css
    └── js/ (app.js, branding.js, portal.js, projects.js, refm-platform.js, settings.js)
```

---

## Module Status
- Module 1 — Project Setup & Financial Structure: ✅ COMPLETE (in legacy; being migrated)
  - Tabs: Timeline, Land & Area, Development Costs, Financing
  - Exports: Excel (xlsx), PDF (jsPDF), JSON save/load
  - Financing: Debt/equity schedules, interest capitalization, cash sweep
- Module 2 — Revenue Analysis: ⬜ NOT STARTED
- Module 3 — Operating Expenses: ⬜ NOT STARTED
- Module 4 — Returns & Valuation: ⬜ NOT STARTED
- Module 5 — Financial Statements: ⬜ NOT STARTED
- Module 6 — Reports & Visualizations: ⬜ NOT STARTED

---

## Design System (DO NOT CHANGE)
- **Single source of truth**: `app/globals.css` — contains ALL CSS tokens and components
- All colors via CSS custom properties: `--color-primary`, `--color-primary-dark`, etc.
- Spacing on 8px grid: `--sp-1` (8px) through `--sp-5` (48px)
- Typography scale: `--font-h1` through `--font-micro`
- Component classes: `.card`, `.kpi-card`, `.btn-primary`, `.table-standard`
- Yellow background `--color-warning-bg` on all assumption/input fields
- **Do NOT use Tailwind for layout tokens** — use CSS custom properties instead

---

## Import Conventions
```typescript
// Types
import type { Module1State, CostItem } from '@/src/types/project.types';
import type { BrandingConfig } from '@/src/types/branding.types';

// Core logic
import { calculateItemTotal } from '@/src/core/core-calculations';
import { formatNumber, formatCurrency } from '@/src/core/core-formatters';
import { ROLES, PERMISSIONS } from '@/src/core/core-state';
import { loadBranding, PLATFORM_REGISTRY } from '@/src/core/branding';

// Module exports
import { getDefaultCosts } from '@/src/modules/module1-setup';
```

---

## API Key Rule
- **Never hardcode** API keys or secrets in source files
- Use `.env.local` for all secrets: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXTAUTH_SECRET`
- Access in API routes via `process.env.ANTHROPIC_API_KEY`
- Client-side env vars must be prefixed `NEXT_PUBLIC_`

---

## Key Conventions
- Financial inputs: `.input-assumption` class (yellow bg)
- Construction phase = blue, Operations phase = green
- `modelType`: `'monthly' | 'annual'` — drives all period calculations
- Assets: residential, hospitality, retail (toggled by projectType)
- Currency + number formatting via `src/core/core-formatters.ts`
- All calculation functions in `src/core/core-calculations.ts` are **pure functions** (no side effects)

---

## Sidebar Architecture
- Collapsible: 240px expanded → 52px collapsed
- Active state: border-left 3px solid `#3B82F6` + subtle bg + `font-weight: 600`
- Tooltips on hover when collapsed
- Fixed layout — only `.main-content` scrolls
- Sidebar bg: `#13344F`

---

## RBAC — Role-Based Access Control
- Roles: `admin` | `analyst` | `reviewer` | `viewer`
- Defined in: `src/core/core-state.ts`
- `MODULE_VISIBILITY` — which modules each role can see
- `PERMISSIONS` — granular capability flags per role

---

## Warning — Legacy refm-platform.js is 7,599 lines
The legacy `_legacy_backup/js/refm-platform.js` contains the full Module 1 implementation.
When migrating logic from it:
- Read it fully before making edits
- Make targeted edits only — extract as pure functions
- Prefer surgical extraction over full rewrites
- The file contains: AppRoot (lines 1-70), RealEstatePlatform state (72-200), calculations (200-900), Excel export (900-1900), Project Manager UI (1900-3800), Main render (3800-5700), Module 1 UI (5700-7520), Module stubs (7520-7598)

---

## Build Notes (Windows / OneDrive path)
- The project path is deep (OneDrive) — webpack is used instead of Turbopack to avoid MAX_PATH issues
- Build script: `npm run build` uses `--webpack` flag (see package.json)
- A junction `C:\fmp` may be used for short-path builds if needed


---

## Deployment — Vercel

### Environment Variables (set in Vercel dashboard)
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude AI API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `NEXTAUTH_SECRET` | Random secret for NextAuth session signing |
| `NEXTAUTH_URL` | Canonical deployment URL (e.g. https://refm.vercel.app) |
| `NEXT_PUBLIC_APP_URL` | Public app URL (client-safe) |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase URL (client-safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase anon key (client-safe) |

### Files
- `vercel.json` — framework config, build/install commands, CORS headers for `/api/*`
- `.env.local` — local secrets (never commit — in .gitignore)
- `.env.example` — template with all required keys (safe to commit)

### Scripts
```bash
npm run type-check   # tsc --noEmit — zero TypeScript errors
npm run verify       # type-check + lint + build (run before every deploy)
npm run build        # next build --webpack (webpack avoids MAX_PATH on Windows)
```

### Health Check
- Endpoint: `GET /api/health`
- Returns: `{ status: 'ok', platform: 'financial-modeler-pro', version: '3.0', timestamp }`
- Use as Vercel deployment health check URL

### Deploy Steps
1. Push to `main` branch (Vercel auto-deploys on push)
2. Or run `vercel --prod` from project root for manual deploy
3. Confirm health check: `curl https://<your-domain>/api/health`
