# PaceMakers Business Consultants — Admin Dashboard & CMS Build Spec

**About PaceMakers:** PaceMakers Business Consultants is a human-driven advisory firm and the holding company of Financial Modeler Pro (FMP). Where FMP is a self-serve software platform, PaceMakers is a **professional services / advisory firm** offering: Financial Modeling, Business Valuation, M&A Advisory, and Real Estate Financial Modeling. The website is a marketing + lead-generation site (services, team, case studies, insights, contact), **not** a SaaS app. There are no self-serve user accounts or paid plans to manage — the conversion goal is an inbound **inquiry / consultation request**.

**Purpose of this build:** The public pages are already designed. What's missing is a good **Admin Dashboard + CMS** so the owner can update every page (services, team, case studies, insights/articles, testimonials, navigation, branding, SEO) and manage incoming **leads** — all without touching code. This spec mirrors a proven admin already running in production on a sibling Next.js + Supabase site, re-tailored for an advisory firm.

**Hand this whole file to Claude Code on the PaceMakers repo.** It contains the architecture, every admin section, the API contracts, the database schema, and the public pages each section feeds. The existing public page designs should be kept; this work makes them CMS-driven and adds the admin to manage them.

---

## 1. Goal & Principles

- **Non-technical editing.** The owner edits content through a web UI, never the codebase.
- **Everything on a public page is CMS-driven**: hero text, sections, images, footer, nav menu, **services**, **team members**, **case studies**, articles/insights, testimonials, logo, brand colors, SEO meta.
- **Lead capture is first-class.** The site's conversion is the contact / consultation form. Every submission lands in an admin **Leads** inbox (with status tracking + email notification), not just an email.
- **Advisory-firm content model**, not SaaS: structured Services, People (team/advisors), and Case Studies / Engagements are dedicated managed collections — not just free-form pages.
- **Changes go live fast.** Public pages use Next.js ISR (revalidate ~60s) or on-demand revalidation so edits appear within ~1 minute.
- **One admin, many pages.** A single protected `/admin` area controls every public page.
- **Drafts before publish.** Pages, services, case studies, and articles have draft/published states so nothing goes live by accident.
- **No self-serve accounts / no pricing plans.** Skip user management and pricing-plan admin entirely — the only privileged user is the owner/admin.

---

## 2. Tech Stack (match this)

| Layer | Choice |
|-------|--------|
| Framework | Next.js (App Router) + TypeScript |
| Styling | Tailwind / design tokens (admin can use inline styles or Tailwind — keep it simple) |
| Database | Supabase (Postgres) |
| Auth | NextAuth (JWT, Credentials provider) with a `role` claim; admin = `role === 'admin'` |
| File/Media storage | Supabase Storage buckets |
| Rich text editor | TipTap (headings, bold/italic, lists, links, inline images, text color, alignment) |
| Data fetching | Server Components for public read; client `fetch` to `/api/admin/*` for edits |

If PaceMakers already uses a different DB/auth, keep the same **section structure, API contracts, and table shapes** and swap the implementation underneath.

---

## 3. Authentication & Route Protection

**Admin login:** single entry at `/admin`. Authenticated admins land on the dashboard (`/admin/cms` or `/admin`). No separate `/login` page needed.

**Middleware (`src/middleware.ts`) rules for all `/admin/*`:**
1. `/login` and `/admin/login` → 307 redirect to `/admin` (strip query params).
2. `/admin` + valid admin token → pass through.
3. `/admin/:path*` unauthenticated → 307 to `/admin`.
4. `/admin/:path*` authenticated but `role !== 'admin'` → 307 to `/` (home).
5. Send `Cache-Control: no-store` on all redirect responses to avoid stale-cache redirect loops.

**Token:** NextAuth JWT containing at least `{ email, role }`. Store the admin user in a `users` table with a hashed password (scrypt or bcrypt) and `role = 'admin'`.

---

## 4. Admin Layout & Sidebar

**Files:** `app/admin/layout.tsx` + `src/components/admin/AdminNav.tsx`

A collapsible left sidebar (icon-only collapse, mobile hamburger, persisted scroll position). Ship these sections tailored for an advisory firm:

```
Dashboard            → /admin              (KPIs + new-lead count + quick actions)

LEADS
  Inquiries          → /admin/leads        (contact / consultation submissions inbox)

CONTENT
  Page Builder       → /admin/page-builder (modular section editor per page)
  Services           → /admin/services     (the 4 advisory service lines)
  Case Studies       → /admin/case-studies (engagements / proof of work)
  Team & Advisors    → /admin/team         (people: bios, photos, roles)
  Insights/Articles  → /admin/articles     (thought-leadership blog)
  Testimonials       → /admin/testimonials (client quotes)
  Page Content       → /admin/content      (global text: footer, section styles, legal)
  Pages & Nav        → /admin/pages        (navigation menu items)
  Header & Branding  → /admin/branding     (logo, colors, favicon, tagline)
  Media Library      → /admin/media        (image/file uploads)

SYSTEM
  Site Settings      → /admin/settings     (SEO, analytics, global config)
  Audit Log          → /admin/audit        (who changed what — optional)
```

Each nav item is `{ label, href, icon }`. Group dividers are non-clickable headings. **Note for PaceMakers: there is no Pricing section and no Users section** (no self-serve plans or accounts).

---

## 5. Admin Sections (build each of these)

### 5.1 Dashboard — `/admin`
KPI cards pulled live from the DB + quick-action buttons.
- Cards: **New Leads (unread)**, Total Leads this month, Published Services, Published Case Studies, Published Insights, Approved Testimonials, Team Members.
- **Recent Inquiries** table (last 5 leads with name, service interest, date, status) — links to `/admin/leads`.
- Quick actions: "View Leads" → `/admin/leads`, "New Insight" → `/admin/articles/new`, "Edit Home Page" → `/admin/page-builder/home`, "Add Case Study" → `/admin/case-studies/new`.
- Data: server-side Supabase count queries.

---

### 5.2 Page Builder — `/admin/page-builder`
The core of the CMS. Build any marketing page from reorderable, typed sections.

**List view (`/admin/page-builder`):** all pages with status (draft/published) + "New Page" (templates: blank, landing, about, services, contact).

**Editor (`/admin/page-builder/[slug]`):** add / reorder (drag) / toggle-visibility / delete sections. Each section has a typed content form and optional style overrides. Live preview link.

**Section types (implement at least these 14; add the rest as time allows):**
`hero`, `text`, `rich_text`, `image`, `text_image`, `columns`, `cards`, `cta`, `faq`, `stats`, `list`, `testimonials`, `video`, `banner`. (Stretch: `pricing_table`, `team`, `timeline`, `logo_grid`, `spacer`, `embed`, `countdown`.)

**Each section's `content` is a JSON blob** shaped per type. Example shapes:
- `hero`: `{ heading, subheading, ctaText, ctaUrl, backgroundImage }`
- `text_image`: `{ heading, body (rich html), imageUrl, imageSide: 'left'|'right' }`
- `cards`: `{ heading, items: [{ title, body, icon, link }] }`
- `cta`: `{ heading, body, buttonText, buttonUrl }`
- `faq`: `{ heading, items: [{ question, answer }] }`
- `stats`: `{ items: [{ value, label }] }`

**API:** `GET/POST/PATCH/DELETE /api/admin/page-sections`
- `GET ?slug=home` → page meta + ordered sections.
- `POST` → create page or section.
- `PATCH` → update section content/order/visibility, or page meta/status.
- `DELETE ?id=` → remove a section.

**DB:**
- `cms_pages(id, slug UNIQUE, title, seo_title, seo_description, status, is_system, created_at, updated_at)`
- `page_sections(id, page_slug FK, section_type, content JSONB, display_order, visible, styles JSONB, created_at, updated_at)`

**Public render:** each public route (`/`, `/about`, etc.) fetches `page_sections` by slug ordered by `display_order` where `visible = true`, and renders a component per `section_type`. Use ISR `revalidate = 60`.

Seed system pages: `home`, `about`, `services`, `contact` (mark `is_system = true` so they can't be deleted).

---

### 5.3 Page Content — `/admin/content`
Flat key-value editor for global text that is not section-based. Tabbed UI.
- **Footer:** company line, tagline, copyright, social links, show/hide toggles.
- **Section styles:** per-section font size / color / padding overrides (stored as JSON).
- **Legal pages:** Privacy Policy + Terms (title, "last updated" date, rich body).

**API:** `GET/PATCH /api/admin/content` (read/write by `section` + `key`).
**DB:** `cms_content(id, section, key, value TEXT, updated_at)` — flat store. Convention: address a field as `section='footer', key='copyright'`. JSON values (e.g. `section='footer', key='social_links'`) are stored as stringified JSON.

---

### 5.4 Header & Branding — `/admin/branding`
- Logo upload (→ `cms-assets` bucket), alt text, size (w/h), position (left/center/right).
- Favicon / icon upload.
- Brand name + tagline (optional rich tagline).
- Header height / padding.
- Primary & secondary brand colors (hex pickers).

**API:** `GET/PATCH /api/admin/content` (section `header_settings`) + `GET/PATCH /api/branding?scope=global` for colors.
**DB:** `cms_content` (section `header_settings`) + `branding_config(id, scope, config JSONB)` where config = `{ primaryColor, secondaryColor, fontFamily }`.
**Public:** server navbar + footer read these; brand colors injected as CSS variables.

---

### 5.5 Pages & Nav — `/admin/pages`
Manage the public navigation menu.
- Fields per item: `label`, `href`, `visible`, `display_order`, `can_toggle`.
- Reorder + show/hide + add/remove.

**API:** `GET/POST/PATCH/DELETE /api/admin/pages`.
**DB:** `site_pages(id, label, href, visible, display_order, can_toggle, created_at)`.
**Public:** navbar renders visible items ordered by `display_order`.

---

### 5.6 Insights / Articles (thought-leadership blog) — `/admin/articles`
List + create/edit (`/admin/articles/new`, `/admin/articles/[id]`).

**Fields:** `title`, `slug` (auto from title, editable), `body` (TipTap rich HTML), `cover_url` (→ `article-covers` bucket), `category`, `status` (draft|published|scheduled), `featured` (bool), `seo_title`, `seo_description`, `author_id` (auto), `published_at` (auto-set on publish).

**API:** `GET/POST/PATCH/DELETE /api/admin/articles`.
- `POST` on publish may trigger optional newsletter / notification hook.

**DB:** `articles(id, title, slug UNIQUE, body, cover_url, category, author_id, status, seo_title, seo_description, featured, published_at, created_at, updated_at)`.

**Public:** `/articles` lists `status='published'` ordered by `published_at` (featured pinned). `/articles/[slug]` renders one. ISR revalidate.

---

### 5.7 Testimonials — `/admin/testimonials`
Approve/curate testimonials shown on public pages.

**Fields:** `name`, `role`, `company`, `text`, `rating` (1–5, nullable), `status` (pending|approved|rejected), `testimonial_type` (written|video), `is_featured`, `video_url`, `show_on_landing`.

**API:** `GET /api/admin/testimonials`, `PATCH /api/admin/testimonials` (status, is_featured, show_on_landing).
**DB:** `testimonials(id, name, role, company, text, rating, status, testimonial_type, video_url, is_featured, show_on_landing, created_at, approved_at)`.
**Public:** home/about pull `status='approved'` (and `show_on_landing=true` for the homepage block).

*(The source site also auto-collects testimonials from a training portal into a second table; PaceMakers can skip that and keep the single `testimonials` table.)*

---

### 5.8 Media Library — `/admin/media`
Browse + upload + delete files across Supabase Storage buckets.

**Buckets:** `cms-assets` (logos, general images), `article-covers`. Add more as needed.
**Actions:** browse by bucket, drag-and-drop upload (single/multi), delete, copy public URL, see size + date.
**Constraints:** max 10 MB; allow `image/jpeg, image/png, image/gif, image/webp, image/svg+xml, application/pdf`; store as `${timestamp}_${sanitizedName}`.

**API:** `GET /api/admin/media?bucket=`, `POST /api/admin/media` (multipart), `DELETE /api/admin/media` (`{bucket, name}`).
**URLs:** Supabase `getPublicUrl()`; the returned URL is pasted into any CMS image field (or chosen via a MediaPicker component).

---

### 5.9 Leads / Inquiries — `/admin/leads`  *(the most important PaceMakers-specific section)*
The contact / "request a consultation" form on the public site writes here. This is the firm's sales inbox.

**Fields captured:** `name`, `email`, `phone`, `company`, `service_interest` (which of the 4 services), `message`, `source` (page/UTM), `created_at`.
**Admin-managed fields:** `status` (new | contacted | qualified | won | lost | archived), `assigned_to`, `internal_notes`.

**UI:** inbox table with status filter + unread badge; click a row to view full detail, change status, add notes. Optional CSV export.

**API:**
- `POST /api/leads` — **public** endpoint the contact form posts to (validate + spam-protect with hCaptcha/honeypot; send the firm a notification email on submit).
- `GET /api/admin/leads` (list/filter), `PATCH /api/admin/leads` (status/notes/assignment).
**DB:** `leads(id, name, email, phone, company, service_interest, message, source, status, assigned_to, internal_notes, created_at, updated_at)`.
**RLS:** public can `INSERT` only; admin full read/write. Never expose lead reads publicly.

---

### 5.10 Services — `/admin/services`
The four advisory service lines (Financial Modeling, Business Valuation, M&A Advisory, Real Estate Financial Modeling) as a managed collection, plus room to add more.

**Fields per service:** `title`, `slug`, `summary` (short), `icon`/`hero_image`, `body` (rich HTML: what it is, process, deliverables), `bullets` (JSON list of sub-offerings), `cta_text`, `display_order`, `status` (draft|published), `seo_title`, `seo_description`.

**API:** `GET/POST/PATCH/DELETE /api/admin/services`.
**DB:** `services(id, title, slug UNIQUE, summary, icon, hero_image, body, bullets JSONB, cta_text, display_order, status, seo_title, seo_description, created_at, updated_at)`.
**Public:** `/services` (grid of published services ordered by `display_order`) + `/services/[slug]` (detail page). Home page can pull the top services too.

---

### 5.11 Case Studies / Engagements — `/admin/case-studies`
Proof-of-work to build credibility (anonymized where client confidentiality requires).

**Fields:** `title`, `slug`, `client_name` (optional / "Confidential"), `industry`, `service_id` (which service line), `summary`, `cover_image`, `body` (rich: challenge / approach / outcome), `metrics` (JSON: e.g. `[{label:'Deal size', value:'$120M'}]`), `featured`, `display_order`, `status`, `seo_*`.

**API:** `GET/POST/PATCH/DELETE /api/admin/case-studies`.
**DB:** `case_studies(id, title, slug UNIQUE, client_name, industry, service_id FK, summary, cover_image, body, metrics JSONB, featured, display_order, status, seo_title, seo_description, published_at, created_at, updated_at)`.
**Public:** `/case-studies` + `/case-studies/[slug]`; featured ones surface on home/services pages.

---

### 5.12 Team & Advisors — `/admin/team`
A human advisory firm sells its people. Manage profiles.

**Fields:** `name`, `role`/`title`, `photo` (→ `team-photos` bucket), `bio` (rich HTML), `credentials` (e.g. CFA, MBA), `linkedin_url`, `email` (optional), `display_order`, `visible`.

**API:** `GET/POST/PATCH/DELETE /api/admin/team`.
**DB:** `team_members(id, name, role, photo, bio, credentials, linkedin_url, email, display_order, visible, created_at, updated_at)`.
**Public:** `/about` or `/team` renders visible members ordered by `display_order`.

---

### 5.13 Site Settings — `/admin/settings`
Tabbed global config: **SEO & Analytics** (GA/GTM id, default meta, sitemap), **Footer**, **Colors & Typography**. Stored as JSON per tab.

**API:** `GET/PATCH /api/admin/site-settings`.
**DB:** `site_settings(key, value JSONB)` where `key ∈ {header, footer, colors, seo}`.

---

### 5.14 Audit Log — `/admin/audit` *(optional but recommended)*
Record every admin write `{ admin_email, action, target, timestamp, before/after }` for accountability.
**DB:** `audit_log(id, actor_email, action, entity, entity_id, meta JSONB, created_at)`.

---

## 6. Shared Admin Components (`src/components/admin/`)

- **AdminNav.tsx** — collapsible sidebar (the structure in §4).
- **RichTextEditor.tsx** — TipTap: headings, bold/italic, lists, links, inline images, text color, alignment. Outputs sanitized HTML.
- **MediaPicker.tsx / MediaPickerButton.tsx** — modal to pick an existing media URL or upload a new one; returns the public URL into a form field.
- **SectionForm components** — one small form per `section_type` in the page builder.
- **(optional) AuditLogViewer.tsx**.

---

## 7. Database Schema Summary (Supabase migrations)

Create one migration per table. Core marketing-site tables:

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `users` | id, email, password_hash, role | Admin auth (owner only) |
| `leads` | name, email, phone, company, service_interest, message, status, internal_notes | Contact / consultation inbox |
| `services` | title, slug, summary, body, bullets JSONB, display_order, status | The 4 advisory service lines |
| `case_studies` | title, slug, client_name, industry, service_id, body, metrics JSONB, featured, status | Engagements / proof of work |
| `team_members` | name, role, photo, bio, credentials, linkedin_url, display_order, visible | People profiles |
| `cms_pages` | slug, title, seo_*, status, is_system | Page builder page meta |
| `page_sections` | page_slug, section_type, content JSONB, display_order, visible, styles JSONB | Modular page sections |
| `cms_content` | section, key, value | Global key-value text (footer, header_settings, legal) |
| `branding_config` | scope, config JSONB | Brand colors/fonts |
| `site_pages` | label, href, visible, display_order | Nav menu |
| `articles` | title, slug, body, cover_url, status, featured, published_at | Insights / blog |
| `testimonials` | name, role, company, text, rating, status, is_featured, show_on_landing | Client testimonials |
| `site_settings` | key, value JSONB | SEO / footer / colors |
| `audit_log` | actor_email, action, entity, meta | Audit (optional) |

**No `pricing_*` and no end-user accounts** — PaceMakers has no self-serve plans; `users` holds only the admin(s).

**Row-Level Security:** public can `SELECT` only published/approved rows and can `INSERT` into `leads` (form submit). Only `role='admin'` can read `leads` or `INSERT/UPDATE/DELETE` other tables. Service-role key used by `/api/admin/*` server routes.

**Storage buckets:** `cms-assets`, `article-covers`, `case-study-images`, `team-photos` (public read).

---

## 8. Public Pages the CMS Feeds

| Public route | Sourced from |
|--------------|--------------|
| `/` (home) | `page_sections` slug=`home` + featured services + featured case studies + approved testimonials |
| `/about` (+ `/team`) | `page_sections` slug=`about` + `team_members` |
| `/services`, `/services/[slug]` | `services` (published) |
| `/case-studies`, `/case-studies/[slug]` | `case_studies` (published) |
| `/insights` (or `/articles`), `/[slug]` | `articles` (published) |
| `/contact` | `page_sections` slug=`contact` + form posts to `POST /api/leads` |
| every page | footer + nav (`site_pages`) + branding colors/logo |

All use Next.js ISR (`revalidate = 60`) or on-demand revalidation triggered after an admin save. The contact form is the primary conversion → writes to `leads`.

---

## 9. Build Order (suggested)

1. **Foundation:** Supabase project, `users` table + NextAuth admin login, `/admin` layout + sidebar, middleware protection.
2. **Leads** first — wire the existing contact form to `POST /api/leads` + the admin inbox + notification email. This is the firm's lifeblood; do it before content polish.
3. **Media Library** (everything else uploads images through it).
4. **Branding + Header + Site Settings** (logo/colors/SEO so public pages look right).
5. **Services** + **Team** + **Case Studies** (the advisory-firm content the existing pages need).
6. **Page Builder** (core) + public section renderer + **Pages & Nav** + **Page Content** (footer/legal).
7. **Insights/Articles** + **Testimonials**.
8. **Audit Log** (optional).
9. **Dashboard** KPIs last (it just reads everything above, incl. lead counts).

---

## 10. Acceptance Checklist

- [ ] Non-admin cannot reach any `/admin/*` route, and `leads` are never publicly readable.
- [ ] Submitting the public contact form creates a `leads` row, emails the firm, and appears in `/admin/leads` as "new".
- [ ] Owner can change a lead's status, add internal notes, and filter the inbox.
- [ ] Owner can add/edit/reorder a Service, a Team member, and a Case Study, then see them live within ~60s.
- [ ] Owner can create a page, add/reorder sections, publish, and see it live.
- [ ] Owner can write an Insight with rich text + cover image and publish it.
- [ ] Owner can upload an image once and reuse its URL anywhere.
- [ ] Owner can change the logo, brand colors, nav menu, and footer with no code.
- [ ] Approving a testimonial makes it appear on the homepage.
- [ ] All SEO meta (title/description) editable per page, service, case study, and article.
- [ ] Drafts never appear publicly; only `published`/`approved` rows render.

---

*This spec describes the proven admin/CMS architecture from a sibling Next.js + Supabase project (Financial Modeler Pro), re-tailored for PaceMakers as a human-driven advisory firm. The big differences from a SaaS marketing admin: a first-class **Leads inbox**, structured **Services / Team / Case Studies** collections, and **no pricing-plan or end-user-account management**. Keep the section structure, API contracts, and table shapes; adapt copy to PaceMakers' brand.*
