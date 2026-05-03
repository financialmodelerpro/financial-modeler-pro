# Financial Modeler Pro — Admin CMS Reference

> Snapshot of how FMP's admin CMS is wired, intended as a portable spec for mirroring the same patterns on a separate project. **Reference only — no behavioral contract.** Read this together with `CLAUDE-DB.md` (table schemas), `CLAUDE-ROUTES.md` (file map), and `CLAUDE.md` (auth + design rules).

**Snapshot date:** 2026-05-02
**Stack:** Next.js 16 App Router · TypeScript strict · Supabase (Postgres + Storage) · NextAuth (admin) · Tailwind 4 + CSS custom properties · `@hello-pangea/dnd` (drag-and-drop) · `@tiptap/react` (rich text)

---

## 1. Admin Sidebar Structure

The sidebar lives in `src/components/admin/CmsAdminNav.tsx` and is rendered as the left column of every `/admin/*` page (each admin page composes its own layout). Items are grouped by `divider` rows.

### Behavior summary

| Concern | How it works | Source |
|---|---|---|
| Width | 240px expanded · 64px collapsed (icons only) | `CmsAdminNav.tsx:95` |
| Collapse persistence | `localStorage['adminSidebarCollapsed']` | `CmsAdminNav.tsx:69-72,89-93` |
| Scroll persistence | `sessionStorage['admin_sidebar_scroll']` saved continuously, restored on `pathname` change | `CmsAdminNav.tsx:74-87` |
| Mobile (<768px) | Off-canvas drawer with hamburger button at top-left, backdrop click closes | `CmsAdminNav.tsx:99-139` |
| Active state | `pathname === href` OR `pathname` starts with any `matchPaths` entry — `#1B4F8A` bg + `3px solid #2EAA4A` left border |
| Backgrounds | Sidebar `#0D2E5A` · text `#fff @ 0.75 opacity` · active `#fff` · dividers `rgba(255,255,255,0.08)` |
| External links | Three buttons at the bottom (View Live Site / Training Site / Modeling Hub) open in a new tab |

### Nav items (all paths absolute under `/admin`)

| Group | Label | Route | Icon | Match-path aliases | Manages |
|---|---|---|---|---|---|
| — | Dashboard | `/admin/cms` | 🏠 | — | KPI tiles + quick actions + recent sign-ups |
| **Content** | Page Builder | `/admin/page-builder` | 🧱 | — | Block-based pages (`cms_pages` + `page_sections`) |
| | Header Settings | `/admin/header-settings` | 🔲 | `/admin/branding` | Brand colors + logo + tagline + favicon + header sizing |
| | Page Content | `/admin/content` | 📝 | — | Key-value content (`cms_content` rows): footer, section styles, articles-page copy, legal pages |
| | Pages & Nav | `/admin/pages` | 🗂️ | — | `site_pages` rows that drive the navbar |
| | Articles | `/admin/articles` | 📰 | — | `articles` table (rich-text blog posts) |
| | Testimonials | `/admin/testimonials` | ⭐ | — | `testimonials` table (hub-tagged) |
| | Media Library | `/admin/media` | 🖼️ | — | Supabase Storage bucket `cms-assets` |
| **Modeling Hub** | Modules | `/admin/modules` | 🧩 | — | Modeling platform catalog (`src/config/platforms.ts` mirror) |
| | Access Whitelist | `/admin/modeling-access` | 🔑 | — | Per-user platform access |
| | Users | `/admin/users` | 👥 | — | `users` table — role/email/created |
| | Pricing | `/admin/pricing` | 💰 | — | `pricing_plans` |
| | Projects | `/admin/projects` | 📁 | — | `refm_projects` (REFM saved projects) |
| **Training Hub** | Overview | `/admin/training-hub` | 📊 | — | Hub dashboard |
| | Platform Analytics | `/admin/analytics` | 📈 | — | Aggregate analytics |
| | Live Sessions | `/admin/training-hub/live-sessions` | 🔴 | — | `live_sessions` table |
| | Instructors | `/admin/training-hub/instructors` | 🎤 | — | `instructors` table |
| | Course Manager | `/admin/training` | 🎓 | — | `courses`, `lessons`, `quiz_questions` |
| | Students | `/admin/training-hub/students` | 👨‍🎓 | — | Roster from `training_registrations_meta` |
| | Certificates | `/admin/training-hub/certificates` | 🏆 | — | Issued certificates |
| | Certificate Designer | `/admin/certificate-designer` | 🎨 | `/admin/certificates`, `/admin/certificate-editor`, `/admin/badge-editor`, `/admin/transcript-editor` | Visual editors that write `cms_content` (`section='cert_layout'` etc.) |
| | Assessments | `/admin/training-hub/assessments` | 📋 | — | Per-course assessment config |
| | Model Submissions | `/admin/training-hub/model-submissions` | 📥 | — | Student model uploads |
| | Communications Hub | `/admin/communications-hub` | 📬 | `/admin/training-hub/communications`, `/admin/training-hub/live-sessions/email-settings`, `/admin/training-hub/share-templates`, `/admin/newsletter` | Email templates, share copy, newsletter |
| | Marketing Studio | `/admin/training-hub/marketing-studio` | 🎨 | — | Marketing assets |
| | Daily Roundup | `/admin/training-hub/daily-roundup` | 🎓 | — | Daily roundup composer |
| | Cohorts | `/admin/training-hub/cohorts` | 👥 | — | Cohort management |
| | Training Settings | `/admin/training-settings` | ⚙️ | — | `training_settings` table (Apps Script URL, timer bypass) |
| **System** | Audit Log | `/admin/audit` | 📋 | — | `admin_audit_log` |
| | System Health | `/admin/health` | ❤️ | — | DB / Storage / external service pings |
| | Settings | `/admin/settings` | ⚙️ | — | App-wide settings |

---

## 2. Each Admin Page in Detail

### 2.0 Layout & guard

| File | Role |
|---|---|
| `app/admin/layout.tsx` | Wraps all `/admin/*` children. `/admin` (login) bypasses the auth hook to avoid render-loop. All other paths render through `<AdminProtected>` which calls `useRequireAdmin()` (redirects non-admins to `/`). |
| `src/components/admin/CmsAdminNav.tsx` | Sidebar (every page renders it manually as `<CmsAdminNav active="/admin/foo" />`). |
| `src/lib/shared/auth.ts` | NextAuth `authorize()`. Admin role bypasses `EmailNotConfirmed` and `DEVICE_VERIFICATION_REQUIRED`. |
| `src/middleware.ts` | `/admin/:path*` requires session — `/admin/login` and `/admin` root explicitly excluded. |

Most admin pages follow this shape:

```
<div flex>
  <CmsAdminNav active="/admin/foo" />
  <main flex:1 padding:40 background:#F4F7FC>
    <h1>Page Title</h1>
    <p>One-line description</p>
    {/* form / table / split view */}
    {toast && <floating-toast />}
  </main>
</div>
```

### 2.1 `/admin/cms` — Dashboard

| Aspect | Detail |
|---|---|
| File | `app/admin/cms/page.tsx` (server component) |
| Reads | `users`, `articles` (where `status='published'`), `courses` (where `status='published'`), `projects` |
| UI | 4 KPI cards (auto-fit grid 200px+) → Quick Actions row → Recent Sign-ups table |
| Save behavior | Read-only |
| Note | Stats failures degrade to `0` — never throws |

### 2.2 `/admin/page-builder` — Page List

| Aspect | Detail |
|---|---|
| File | `app/admin/page-builder/page.tsx` |
| Reads / writes | `cms_pages` via `GET /api/admin/page-sections` (no `slug` query) and `POST` with `action:'create_page'` |
| UI | Table of pages (slug · title · status · system flag · created) + "New Page" modal with 5 templates (`blank`, `landing`, `about`, `services`, `contact`). Each template seeds a list of starter sections. |
| Save behavior | Per-action POST (template insert is one transaction-equivalent batch) |
| Validation | Slug must match `/^[a-z0-9-]+$/`; system pages cannot be deleted |

### 2.3 `/admin/page-builder/[slug]` — Section Editor

| Aspect | Detail |
|---|---|
| File | `app/admin/page-builder/[slug]/page.tsx` (~1850 LoC, 21 section editors + 1 style editor) |
| Reads / writes | `cms_pages` (page metadata) + `page_sections` (block list) via `/api/admin/page-sections?slug=...` |
| UI | **Three-pane layout**: header bar (back · title · SEO toggle · "Preview ↗" link) → left rail (320px draggable section list) → right pane (active section editor + style editor). |
| Save behavior | **Per-section explicit Save button.** Reorder is **auto-saved** as soon as the user releases a drag. SEO has its own Save button. Visibility toggle on a list row is local-only until the user opens that section and clicks Save. |
| Validation | None at the form layer — all values are strings/JSON; the public renderer is responsible for falling back when fields are blank/visible-false. |
| Unique UX | DnD reorder via `@hello-pangea/dnd`, per-field visibility checkbox + alignment + width selectors (`VF` / `ItemVF` / `ItemBar` wrappers), per-array-item delete buttons, type picker as inline list (no modal), "SEO" yellow-banner panel toggled inline, "Preview ↗" opens the public route in a new tab. |

#### 2.3a `StyleEditor` (always rendered under each section)

Edits the `styles` JSONB on the active section: background color, background image (with overlay), text color, padding (T/R/B/L), max-width, border radius, animation (`none` / `fade-in` / `slide-up`), custom CSS class.

### 2.4 `/admin/header-settings` — Branding & Header

| Aspect | Detail |
|---|---|
| File | `app/admin/header-settings/page.tsx` |
| Reads / writes | `cms_content` rows where `section='header_settings'` (17 keys) **plus** `branding_config.config.{primaryColor,secondaryColor}` via `/api/branding?scope=global` |
| UI | Single column, max-width 680px, white cards (24px padding) for each group: Brand Colors · Logo · Branding Text · Header Icon · Header Layout |
| Save behavior | **Single "Save All" button** at the top. Issues `Promise.all([…17 PATCH /api/admin/content, 1 PATCH /api/branding])`. |
| Validation | Hex color regex `/^#[0-9A-Fa-f]{0,6}$/` while typing; the `<input type="color">` swatch falls back to `#000000` if invalid |
| Unique UX | `<MediaPickerButton>` next to URL inputs, live logo preview on dark background, RichTextEditor for the tagline, color-picker swatch + hex text input pair, instant primary/secondary swatch preview bars |

### 2.5 `/admin/content` — Page Content (key-value)

| Aspect | Detail |
|---|---|
| File | `app/admin/content/page.tsx` |
| Reads / writes | `cms_content` (no other tables) via `/api/admin/content` |
| UI | **Tabbed**, tabs grouped by page (`Global (All Pages)`, `Landing Page`, `Training`, `Other Pages`). Tabs themselves are color-coded per group. Each tab renders its own form. |
| Save behavior | **Per-tab "Save Changes" button**. The button takes a list of `{section, key}` rows and fires `Promise.all(rows.map(PATCH /api/admin/content))`. Stats bar saves as one JSON-array row (`section='stats', key='stats_bar_items'`). Section styles save as one JSON-object row per section id (`section='section_styles', key=<sectionId>`). |
| Validation | Free-text; ISR cache picks up edits within 60s |
| Unique UX | Stats use `_style_` synthetic section names internally to map flat form fields → JSON; toast at bottom-right; logo upload uses `/api/admin/media` with 2 MB cap and writes the URL back into `cms_content.branding/logo_url` |

### 2.6 `/admin/pages` — Site Pages & Nav

| Aspect | Detail |
|---|---|
| File | `app/admin/pages/page.tsx` |
| Reads / writes | `site_pages` table (rows that show in the navbar) |
| UI | Table list with inline edit |
| Note | Distinct from `cms_pages` — `site_pages` is the **navigation menu**, `cms_pages` is the **content store** |

### 2.7 `/admin/articles` — Articles

| Aspect | Detail |
|---|---|
| Files | `app/admin/articles/page.tsx` (list), `app/admin/articles/new/page.tsx` (create), `app/admin/articles/[id]/page.tsx` (edit) |
| Reads / writes | `articles` |
| UI | List with status badge → form (title, slug, excerpt, body via `RichTextEditor`, cover image via `MediaPickerButton`, tags, status, featured flag) |
| Save behavior | Explicit Save per article |

### 2.8 `/admin/testimonials` — Testimonials

| Reads / writes | `testimonials` (with `linkedin_url`, `profile_photo_url`, `hub`, `video_url` columns) |
| UI | Table + per-row edit form |

### 2.9 `/admin/media` — Media Library

| Reads / writes | Supabase Storage bucket `cms-assets` |
| UI | Tile grid of uploaded files; upload via `/api/admin/media` (multipart) |
| Used by | `MediaPicker` modal across many editors |

### 2.10 `/admin/audit` — Audit Log

| File | `app/admin/audit/page.tsx` (uses shared `AuditLogViewer`) |
| Reads | `admin_audit_log` via `/api/admin/audit-log` (paginated, 100/req, max 500) |
| UI | Time-sorted list with action · admin · target · reason · before/after JSON diff |

### 2.11 `/admin/health` — System Health

| Reads | DB ping, Storage ping, Resend ping, Anthropic ping |
| UI | Single card per service (green / red dot) |

### 2.12 `/admin/training-settings`

| Reads / writes | `training_settings` table (key-value) |
| UI | Form for Apps Script URL + Timer Bypass + various Training Hub flags |

### 2.13 Other admin pages (one-liner each)

| Page | Notable behavior |
|---|---|
| `/admin/users` | List, role edit, suspend, reset password (writes to `admin_audit_log`) |
| `/admin/pricing` | Edits `pricing_plans` table |
| `/admin/projects` | View/inspect/delete `refm_projects` |
| `/admin/modules` | Toggles platform `live`/`coming_soon` |
| `/admin/modeling-access` | Whitelist users for specific modeling platforms |
| `/admin/training` | Course manager — courses, lessons, quizzes, drag-reorder lessons |
| `/admin/training-hub/live-sessions` | CRUD for `live_sessions` |
| `/admin/training-hub/instructors` | Instructor profiles + photo upload |
| `/admin/training-hub/students` | Roster from `training_registrations_meta` joined to progress |
| `/admin/training-hub/certificates` | Issued cert browser + revoke |
| `/admin/certificate-designer` | Visual editor (drag fields on a 1240×877 canvas) → writes `cms_content.cert_layout` JSON |
| `/admin/communications-hub` | Email template editor + Resend test send |
| `/admin/training-hub/marketing-studio` | Asset library, social-card composer |
| `/admin/training-hub/daily-roundup` | Composer for daily summary email |
| `/admin/training-hub/cohorts` | Cohort grouping |
| `/admin/settings` | Misc flags (`site_settings` rows) |

---

## 3. Page Builder Specifics

### 3.1 Architecture in one sentence

Each page (`cms_pages` row) owns an ordered list of blocks (`page_sections` rows); each block has a `section_type` discriminator and a free-form `content` JSONB blob shaped per type, plus a `styles` JSONB blob and a `visible` flag.

### 3.2 Section types

All defined in `app/admin/page-builder/[slug]/page.tsx:34-83`. Default content shapes are in the `DEFAULT_CONTENT` map (`page.tsx:61-83`).

| `section_type` | Editor component | `content` schema (JSONB) |
|---|---|---|
| `hero` | `HeroEditor` | `{ badge, headline, subtitle, powerStatement, softCta, softCtaUrl, trustLine, tags, cta1Text, cta1Url, cta2Text, cta2Url, textAlign, customFields: [{id,label,value,visible,insertAfter}], <key>_visible, <key>_width, <key>_align }` |
| `text` | `TextEditor` | `{ heading, body }` |
| `rich_text` | `RichTextEditor2` | `{ badge, heading, html }` |
| `image` | `ImageEditor` | `{ src, alt, caption }` |
| `text_image` | `TextImageEditor` | `{ heading, badge, body, imageSrc, imageAlt, imagePosition, imageWidth, bgImageUrl, overlay }` |
| `columns` | `ColumnsEditor` / `SmartColumnsEditor` (auto-routes to `ContactItemsEditor`, `TwoPlatformsEditor`, `PaceMakersEditor` based on shape) | `{ heading, columns: [{heading, html, icon}], count }` |
| `cards` | `CardsEditor` | `{ heading, cards: [{icon, title, description}] }` |
| `cta` | `CtaEditor` | `{ heading, subtitle, buttonText, buttonUrl }` |
| `faq` | `FaqEditor` | `{ heading, items: [{question, answer, visible?, answer_align?}] }` |
| `stats` | `StatsBarEditor` | `{ items: [{id, value, label, visible?}] }` (drag-reorderable) |
| `list` | `ListEditor` | `{ heading, layout: 'vertical'|'horizontal', items: [{icon, title, description, visible?, description_align?}] }` |
| `testimonials` | `TestimonialsEditor` | `{ heading, badge, items: [{photo, name, role, quote, visible?, quote_align?}] }` |
| `pricing_table` | `PricingTableEditor` | `{ heading, badge, tiers: [{name, price, period, description, features:[], cta_text, cta_url, highlighted, visible?}] }` |
| `video` | `VideoEditor` | `{ url, caption }` |
| `banner` | `BannerEditor` | `{ text, url }` |
| `spacer` | `SpacerEditor` | `{ height }` |
| `embed` | `EmbedEditor` | `{ heading, html }` |
| `team` | `TeamEditor` (or `FounderEditor` when `content.name` is set, e.g. on home page founder block) | `{ heading, badge, members: [{photo, name, role, bio, visible?, bio_align?}] }` |
| `timeline` | `TimelineEditor` | `{ heading, badge, items: [{date, title, description, visible?}] }` |
| `logo_grid` | `LogoGridEditor` | `{ heading, badge, logos: [{src, alt, url}], logoHeight }` |
| `countdown` | `CountdownEditor` | `{ heading, subtitle, targetDate, ctaText, ctaUrl, expiredText }` |

#### 3.2a Per-field visibility / layout convention

All editors use one of these wrappers to add a checkbox + width + align controls next to each field:

| Wrapper | Stores keys on… | When to use |
|---|---|---|
| `VF` | the section's top-level `content` object as `{fieldKey}_visible`, `{fieldKey}_width`, `{fieldKey}_align` | scalar fields (e.g. hero `badge`) |
| `ItemVF` | the array-item object | a field inside an array item |
| `ItemBar` | the array-item as `visible` (boolean) plus `{alignField}_align`, `{widthField}_width` | the row controlling a whole array item (delete + show/hide + per-item alignment) |

#### 3.2b "Smart" routing (`SmartColumnsEditor`)

Some types are reused with very different content shapes by checking the data:
- `columns` with `contact_items` array → renders `ContactItemsEditor` (Contact page)
- `columns` where `columns[0].id === 'modeling'` → renders `TwoPlatformsEditor` (Modeling Hub teaser)
- `columns` where heading/cta_url contains `pacemakers` → renders `PaceMakersEditor`

This means the **admin UI** can swap shape based on data without changing `section_type`. The public renderer must do the same dispatch.

### 3.3 Ordering

`display_order` (integer, gap-free 0..n-1). Reorder DnD calls `PATCH /api/admin/page-sections` with `action:'reorder'` and `items: [{id, display_order}, ...]`. New sections are appended via `MAX(display_order)+1` server-side (`app/api/admin/page-sections/route.ts`).

### 3.4 Visibility / draft

- Per **section**: `page_sections.visible` boolean — toggle on the row in the left rail (saved on next Save Section).
- Per **page**: `cms_pages.status` enum (`draft` | `published`).
- Per **field**: `<fieldKey>_visible` boolean inside the section's `content` JSONB (see VF wrapper).
- Per **array item**: `visible` boolean inside the item object.

### 3.5 Preview mechanism

**No iframe**, no split view. The header has a `Preview ↗` link that opens the public route (`/${slug === 'home' ? '' : slug}`) in a new tab. The public site re-renders against Postgres directly; ISR cache picks up changes within ~60s.

---

## 4. CMS Data Model

### 4.1 Two-layer pattern

| Layer | Purpose | Edited from | When to use |
|---|---|---|---|
| **`cms_content`** (key-value) | Flat `(section, key, value)` rows. Value is always TEXT (JSON-stringified when needed). | `/admin/content`, `/admin/header-settings`, `/admin/certificate-designer`, etc. | **Singletons & global config**: footer text, header logo, legal copy, certificate layouts, articles-page header — anything that is *one* of, not a list of blocks. |
| **`page_sections`** (block-based) | Ordered list of typed blocks with JSONB `content` + JSONB `styles`. | `/admin/page-builder/[slug]` | **Long, heterogeneous page bodies**: home, /about/*, /pricing, /modeling, /training, /articles, legal pages. |

### 4.2 Tables

| Table | Purpose | Key columns |
|---|---|---|
| `cms_content` | Singleton key-value content | `id`, `section` TEXT, `key` TEXT, `value` TEXT, `updated_at` — UNIQUE`(section, key)` |
| `cms_pages` | Page metadata | `id`, `slug` UNIQUE, `title`, `seo_title`, `seo_description`, `status` (`draft`/`published`), `is_system` BOOL, `created_at` |
| `page_sections` | Page blocks | `id`, `page_slug` (FK by slug), `section_type` TEXT, `content` JSONB, `display_order` INT, `visible` BOOL, `styles` JSONB |
| `branding_config` | Brand colors only (slimmed in commit `ee959ad`) | `id`, `scope` (`global`|...), `config` JSONB — `{primaryColor, secondaryColor}` |
| `site_pages` | Navbar-driven page list | `slug`, `label`, `href`, `display_order`, `visible` |
| `site_settings` | Misc global settings | `key`, `value` JSONB |
| `articles` | Blog posts | `slug`, `title`, `excerpt`, `body_html`, `cover_image_url`, `tags[]`, `status`, `featured`, `published_at` |
| `testimonials` | Testimonials | `name`, `role`, `quote`, `photo_url`, `linkedin_url`, `profile_photo_url`, `hub`, `video_url`, `visible` |
| `cert_layouts` *(JSON in `cms_content`)* | Certificate / badge / transcript visual layouts | `cms_content` rows: `(section='cert_layout', key=...)` |
| `email_templates` / `email_branding` | Transactional email config | `key`, `subject`, `body_html`, `branding` JSONB |
| `instructors` | Instructor profiles | `slug`, `name`, `photo_url`, `bio`, `social_links` |
| `admin_audit_log` | Admin action log | `admin_id`, `target_user_id`, `action`, `before_value`, `after_value`, `reason`, `created_at` |

### 4.3 Why split

- `cms_content` is **append-cheap** — every new singleton is one row. No migration, no schema change. `branding/logo_url`, `header_settings/header_height_px`, `articles_page/title`, `privacy_policy/content` all live here.
- `page_sections` carries **structure** — order, visibility, per-block style overrides, polymorphic content shape. A migration in 2026-04 (`098_drop_founder_profile.sql`) consolidated the ad-hoc `founder_profile` table into a single `team`-typed `page_sections` row, proving the pattern: **prefer page_sections for anything you'd want to drag-reorder or duplicate.**

### 4.4 Storage

| Bucket | Used for |
|---|---|
| `cms-assets` | Logos, header icons, page imagery uploaded via `/admin/media` and `MediaPickerButton` |
| `instructor-photos` | Instructor portraits |
| `student-models` | Submitted spreadsheets |

---

## 5. API Route Conventions

### 5.1 URL pattern

- `/api/admin/*` — admin-only (NextAuth session + role check)
- `/api/cms/*` — public read access for site rendering
- `/api/branding` — `GET` public, `PATCH` admin-only

### 5.2 Auth gate (every admin route)

```ts
const session = await getServerSession(authOptions);
if (!session?.user)                       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
if (session.user.role !== 'admin')        return NextResponse.json({ error: 'Forbidden'   }, { status: 403 });
```

`authOptions` lives at `src/shared/auth/nextauth.ts` (re-exported from `src/lib/shared/auth.ts`).

### 5.3 Verb conventions

| Verb | Convention |
|---|---|
| `GET` | List or fetch single. Optional `?slug=` / `?section=` filters. |
| `POST` | Create. For complex routes, the body uses an `action` discriminator (e.g. `action:'create_page'`) instead of carving up sub-routes. |
| `PATCH` | Update. Same `action`-discriminator pattern (e.g. `action:'reorder' | 'update_page'`). For `cms_content`, PATCH is **upsert** — it tries UPDATE then INSERT if no row matched. |
| `DELETE` | Body-based id. For pages, deletes child rows first to honor FK cascade order. |

### 5.4 Response shapes

| Shape | Used by | Example |
|---|---|---|
| `{ rows: [...] }` | List endpoints | `GET /api/admin/content` |
| `{ row: {...} }` | Single-row mutations | `PATCH /api/admin/content` |
| `{ page, sections }` | Page-builder editor load | `GET /api/admin/page-sections?slug=home` |
| `{ section: {...} }` | Section create / update | `POST /api/admin/page-sections` |
| `{ entries, total }` | Paginated lists | `GET /api/admin/audit-log?limit=100&offset=0` |
| `{ url }` | Media upload | `POST /api/admin/media` |
| `{ config }` | Branding read | `GET /api/branding?scope=global` |
| `{ error: string }` + non-2xx | All failure paths | — |

### 5.5 Audit logging

Mutations to user records (role change, password reset, suspension) write a row to `admin_audit_log` capturing `before_value` + `after_value` + `reason` + `admin_id` + `target_user_id`. Content edits (`cms_content`, `page_sections`) **do not currently audit-log** — they're treated as low-stakes / overwritten frequently.

`GET /api/admin/audit-log` supports `?limit=` (capped 500) + `?offset=` and joins `admin:admin_id(email,name)` + `target:target_user_id(email,name)`.

---

## 6. Shared Admin UI Components

Located under `src/components/admin/`. None are generic "design-system" components — they are domain components used across multiple admin pages.

| Component | Purpose | File |
|---|---|---|
| `CmsAdminNav` | The sidebar described in §1. Accepts `active` (route string) and `badges` (`{href: count}`). | `src/components/admin/CmsAdminNav.tsx` |
| `MediaPicker` / `MediaPickerButton` | Modal that browses the `cms-assets` Storage bucket and lets the user upload + pick. `MediaPickerButton` is the inline "→" button next to URL inputs. | `src/components/admin/MediaPicker.tsx` |
| `RichTextEditor` | Full Tiptap editor (heading levels, bold/italic, color, font size, image, link, alignment). Used for long-form HTML (article body, tagline, founder bio). | `src/components/admin/RichTextEditor.tsx` |
| `RichTextarea` | Compact rich-text input (no toolbar — bold/italic/link only). Used for short fields (subtitle, quote, item description) inside Page Builder. | `src/components/admin/RichTextarea.tsx` |
| `AuditLogViewer` | Renders the `/admin/audit` table with pagination and JSON-diff popovers. | `src/components/admin/AuditLogViewer.tsx` |
| `ProjectsBrowser` | Lists `refm_projects` with delete/inspect actions. | `src/components/admin/ProjectsBrowser.tsx` |
| `InstructorPicker` | Combobox that fetches `instructors` and returns the selected id (used in Live Sessions form). | `src/components/admin/InstructorPicker.tsx` |
| `LaunchStatusCard` | Small card on dashboards summarizing platform/site live state. | `src/components/admin/LaunchStatusCard.tsx` |
| `SystemHealth` | Renders one row per external service with green/red dot. Used by `/admin/health`. | `src/components/admin/SystemHealth.tsx` |
| `LiveSessionAssessmentEditor` | Specialized editor for tying assessments to live sessions. | `src/components/admin/LiveSessionAssessmentEditor.tsx` |

> Notable absences: there is **no shared** `SaveStatus`, `ConfirmDialog`, `AdminPageHeader`, or `AdminCard` component. Each page renders its own header / save button / toast / `confirm(...)` natively. If you mirror this onto a new project, this is the first thing worth extracting.

---

## 7. Admin Design Language

Admin pages **do not use** the public site's design tokens (`app/globals.css` `--color-*`). They are intentionally hardcoded with inline styles so admin-side changes never affect public-site theming.

### 7.1 Colors

| Token | Hex | Usage |
|---|---|---|
| Primary navy | `#1B4F8A` | Buttons, active states, CTA, primary text accents |
| Deep navy | `#1B3A6B` | Page titles (`<h1>`), section headings |
| Sidebar navy | `#0D2E5A` | Sidebar background, dashboard logo preview cards |
| Accent green | `#2EAA4A` | Save buttons, "saved" toasts, active sidebar left border |
| Soft blue tint | `#E8F0FB` | Card borders, secondary backgrounds |
| Page background | `#F4F7FC` | Body of `<main>` |
| Card background | `#FFFFFF` | All form cards |
| Text body | `#374151` (Gray 700) | Form inputs, body copy |
| Text muted | `#6B7280` (Gray 500) | Subtitles, descriptions |
| Text micro | `#9CA3AF` (Gray 400) | Field hints |
| Border default | `#D1D5DB` | Input borders |
| Border light | `#E5E7EB` / `#E8F0FB` / `#F3F4F6` | Card borders, table dividers |
| Input yellow tint | `#FFFBEB` (Amber 50) | Editable text inputs (matches public-site `--color-warning-bg` convention so admins recognise inputs at a glance) |
| Danger | `#DC2626` (text) on `#FEE2E2` (bg) | Delete buttons, destructive states |
| Warning | `#92400E` (text) on `#FEF3C7` (bg) | Cautionary panels, SEO panel header |

### 7.2 Typography

- Font family: `'Inter', sans-serif` (one declaration per page, not via globals)
- Page title (h1): 24px / 800
- Section heading (h2): 14–16px / 700–800
- Card label (uppercase): 11px / 700 / `letter-spacing: 0.05em` / `#6B7280` or `#374151`
- Body input text: 13px
- Hint text: 10–11px / `#9CA3AF`

### 7.3 Layout conventions

| Pattern | Spec |
|---|---|
| Page padding | `padding: 40` on `<main>` |
| Form max-width | 680–960px (form-heavy pages cap at 680, table pages 960, page builder full-bleed) |
| Card | `background: #fff; border: 1px solid #E5E7EB or #E8F0FB; border-radius: 12; padding: 24` |
| Input | `padding: 8px 12px; border: 1px solid #D1D5DB; border-radius: 6-7; font-size: 13` |
| Button (primary) | `padding: 9-10px 20-24px; background: #1B4F8A; color: #fff; border-radius: 7-8; font-weight: 700; font-size: 13` |
| Button (save success variant) | Same dimensions, `background: #2EAA4A` (used by Page Builder per-section save) |
| Toast | Fixed bottom-right (24/24), `padding: 12px 24px; border-radius: 8; box-shadow: 0 4px 16px rgba(0,0,0,0.2); z-index: 9999`. Green `#1A7A30` for success, red `#DC2626` for error. |
| KPI card | `padding: 20px 24px; border-radius: 12; border: 1px solid #E8F0FB`; icon tile 36×36 with `border-radius: 10`; value 32px / 800 |
| Table | `width: 100%; border-collapse: collapse`; thead `background: #F9FAFB`; th uppercase 11px/700/`#6B7280`; tbody td 12-13px |

### 7.4 Mobile responsiveness

- Sidebar collapses to off-canvas drawer at `<768px` (CSS in `<style>` block inside `CmsAdminNav.tsx`).
- Forms are mostly built with `display: grid; grid-template-columns: 1fr 1fr` (or 3-col) and **do not** auto-stack on narrow viewports — admin is desktop-first by design.
- The Page Builder three-pane layout is **not** responsive below ~1024px; the left rail's fixed 320px width can squash content.

### 7.5 Stylistic conventions worth carrying over

- **Inline styles** rather than Tailwind utility classes throughout admin. The reasoning is portability and isolation from the public design system; a mass refactor to Tailwind would break the dashboard's visual independence.
- **Per-section explicit Save** rather than auto-save. Reorder is auto-saved (low risk); content edits need a click. This avoids "I clicked away and lost my edit" feedback loops.
- **`cms_content` for everything that isn't a block list.** The temptation to spin up new tables for each new feature is strong; this codebase pushes back firmly.
- **Slash-namespacing in `cms_content` keys** (`section='header_settings'`, `section='articles_page'`, `section='privacy_policy'`) — gives free organization without table sprawl.
- **Match-paths on sidebar items** so renamed/redirected pages still highlight the right nav entry.

---

## Quick navigation map (file paths to `Cmd+P`)

```
app/admin/
  layout.tsx                                 # AdminGuard
  cms/page.tsx                                # Dashboard
  page-builder/page.tsx                       # Page list
  page-builder/[slug]/page.tsx                # Section editor (the big one)
  header-settings/page.tsx                    # Branding + header
  content/page.tsx                            # Key-value content tabs
  pages/page.tsx                              # Site nav
  articles/page.tsx                           # Article list
  articles/new/page.tsx
  articles/[id]/page.tsx
  testimonials/page.tsx
  media/page.tsx
  audit/page.tsx
  health/page.tsx
  ...

app/api/admin/
  content/route.ts                            # GET / PATCH cms_content
  page-sections/route.ts                      # GET / POST / PATCH / DELETE pages + sections
  audit-log/route.ts                          # GET admin_audit_log (paginated)
  media/route.ts                              # POST upload to cms-assets bucket
  ...

app/api/branding/route.ts                     # GET (public) / PATCH (admin) branding_config

src/components/admin/
  CmsAdminNav.tsx                             # Sidebar
  MediaPicker.tsx
  RichTextEditor.tsx
  RichTextarea.tsx
  AuditLogViewer.tsx
  ...
```
