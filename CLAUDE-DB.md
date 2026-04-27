# Database & Migrations Reference

> Referenced from CLAUDE.md — database tables, storage buckets, and migration log.

---

## Supabase Storage Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `certificates` | Certificate PDF templates + issued PDFs | Public |
| `badges` | Badge PNG templates + issued badges | Public |
| `course-materials` | Lesson/course file attachments (PDF, Word, PPT, Excel, images) | Public |
| `live-session-banners` | Live session banner images | Public |
| `cms-assets` | CMS uploaded media (images, logos) | Public |
| `marketing-assets` | Marketing Studio uploaded background images (PNG / JPEG / WebP, max 10 MB). Created by migration 142. Public-read SELECT policy so satori can fetch them when rendering. Files stored under `bg/<timestamp>-<rand>.<ext>`. Metadata indexed in `marketing_uploaded_assets`. | Public |

---

## Database Tables (Supabase)

### Modeling Hub
| Table | Purpose |
|-------|---------|
| `users` | Accounts: id, email, name, password_hash, role, subscription_plan, subscription_status, phone, city, country, email_confirmed, confirmed_at |
| `projects` | REFM saved projects (JSON blob) |
| `password_resets` | Tokens for forgot-password flow |
| `modeling_email_otps` | 6-digit device-verify OTPs (10-min TTL) |
| `modeling_access_whitelist` | Pre-launch access allowlist (migration 136): `id UUID PK`, `email TEXT UNIQUE`, `note TEXT NULL`, `added_by TEXT NULL`, `added_at TIMESTAMPTZ DEFAULT NOW()`. Partial index `idx_modeling_wl_email_lower` on `LOWER(email)`. Admin pre-seeded. Consulted by `canEmailSigninModeling` / `canEmailRegisterModeling` in `src/lib/shared/modelingAccess.ts` so whitelisted emails bypass the signin + register Coming Soon toggles. Admin UI at `/admin/modeling-access` (add + revoke). |

### Training Hub
| Table | Purpose |
|-------|---------|
| `training_registrations_meta` | Student records: registration_id, email, name, course, city, country, email_confirmed, confirmed_at, **tour_completed** (migration 120 — one-shot `driver.js` dashboard walkthrough flag) |
| `training_passwords` | Bcrypt password hashes keyed by registration_id |
| `training_pending_registrations` | Staging table before email confirmation |
| `training_email_otps` | 6-digit device-verify OTPs (10-min TTL) |
| `training_settings` | Admin config: apps_script_url, watch_enforcement_*, shuffle_*, modeling/training_hub_coming_soon, **share_brand_mention, share_founder_mention, share_brand_prefix_at, share_founder_prefix_at** (migrations 115-116), **training_hub_auto_launch, modeling_hub_auto_launch, {hub}_last_auto_launched_at** (migration 118), **training_hub_bypass_list** (migration 121 - case-insensitive comma-separated email/RegID allowlist for Coming Soon pre-launch testers), **whatsapp_group_url** (migration 123 - optional Training Hub sidebar CTA, empty value hides the button), **modeling_hub_signin_coming_soon, modeling_hub_signin_launch_date, modeling_hub_register_coming_soon, modeling_hub_register_launch_date** (migration 136 - replaces the single `modeling_hub_coming_soon` with two independent toggles + their own launch dates; migration 137 force-upserts both to `'true'`), **platform_walkthrough_url** (2026-04-22 - optional YouTube/Vimeo URL that lights up the gold "Watch Platform Walkthrough" button on the Training Hub dashboard hero; stored via the existing K/V table so no migration needed; empty value hides the button), etc. |
| `share_templates` | Centralized admin-editable share text templates (migration 114): `template_key` UNIQUE, `title`, `template_text`, `hashtags TEXT[]`, `mention_brand`, `mention_founder` (legacy, ignored at render), `active`, auto-updating `updated_at`. Seeded with 5 templates; migration 117 adds `daily_certifications_roundup` |
| `training_admin_actions` | Admin action history for students |

### Shared Auth
| Table | Purpose |
|-------|---------|
| `trusted_devices` | hub, identifier, device_token (UNIQUE), expires_at (30 days) |
| `email_confirmations` | hub, email, token (UNIQUE), expires_at (24hr), used_at |

### Content & CMS
| Table | Purpose |
|-------|---------|
| `site_pages` | Dynamic nav pages with href, label, ordering |
| `branding_config` | White-label colors, logos |
| `articles` | Blog/knowledge base articles |
| `announcements` | Site-wide announcements |
| `testimonials` | Student/user testimonials (hub-tagged) |
| `contact_submissions` | Contact form entries |
| `media` | Uploaded media asset references |

**Removed 2026-04-18 (migration 098):** `founder_profile` — legacy key-value table for the standalone `/admin/founder` editor. All founder data now lives in `page_sections` (`section_type='team'` on the home page), edited via Page Builder → Founder section.

### Training Platform
| Table | Purpose |
|-------|---------|
| `courses` | Course definitions (3SFM, BVM, etc.) |
| `sessions` | Course sessions (days/modules) |
| `lessons` | Individual lesson items |
| `cohorts` | Training cohort groups |
| `cohort_enrollments` | Student <> cohort membership |
| `student_progress` | Lesson/video completion tracking |
| `student_notes` | Per-lesson student notes |
| `student_feedback` | Course feedback submissions |
| `assessment_questions` | Quiz question bank |
| `assessment_attempts` | Student quiz attempt results |
| `certificates` | Issued certificate records |
| `certificate_layouts` | Admin-configurable certificate templates |
| `transcript_tokens` | Shareable transcript access tokens |

### Live Sessions
| Table | Purpose |
|-------|---------|
| `live_playlists` | Session grouping: name, description, thumbnail, display_order, is_published |
| `live_sessions` | Sessions: title, description, youtube_url, youtube_embed, show_like_button, live_url, session_type, scheduled_datetime, timezone, category, playlist_id, banner_url, duration_minutes, max_attendees, difficulty_level, prerequisites, instructor_name, instructor_title, tags[], is_featured, live_password, registration_url, notification/reminder tracking |
| `announcement_recipient_log` | Per-recipient audit log for every `announcement_send_log` row (migration 138): `send_log_id UUID FK ON DELETE CASCADE`, `email`, `name`, `registration_id`, `status` (`pending`/`sent`/`failed`/`bounced`/`complained` CHECK), `resend_message_id`, `error_message`, `sent_at`, `created_at`, `UNIQUE(send_log_id, email)`. Partial index `idx_announcement_recipient_log_failed ON (send_log_id) WHERE status IN ('failed','bounced')` for fast retry queries. Seeded as `pending` before the Resend batch fires, UPDATEd to `sent`/`failed` from the response. Powers the per-recipient status table + "Retry N Failed" button in the admin picker modal. Parent aggregate counts on `announcement_send_log` are recomputed from these rows so retries reflect reality. |
| `session_registrations` | Student RSVP: session_id, student_reg_id, student_name, student_email, registered_at, attended, **reminder_24h_sent, reminder_1h_sent** (migration 122 — per-registration reminder tracking so late registrants still receive the right window's email; partial indexes on `FALSE` rows) |
| `session_watch_history` | Recording watch tracking: session_id, student_email, student_reg_id, watched_at, points_awarded (50), status (default 'completed'), watch_percentage (default 100); UNIQUE(session_id, student_email) |
| `youtube_comments_cache` | Cached YouTube comments: video_id (UNIQUE), comments (JSONB), fetched_at, comment_count; 24h TTL |
| `course_attachments` | Reused for session files with tab_key='LIVE_'+session_id |

### Dynamic CMS
| Table | Purpose |
|-------|---------|
| `cms_pages` | Page metadata: slug, title, seo_title, seo_description, status (draft/published), is_system |
| `page_sections` | Modular content blocks: page_slug, section_type, content (JSONB), display_order, visible, styles (JSONB) |

### Admin & Misc
| Table | Purpose |
|-------|---------|
| `audit_log` | Admin action audit trail |
| `permissions` | Role -> permission flags |
| `pricing_plans` | Subscription plan definitions |
| `pricing_features` | Feature flags per plan |
| `pricing_modules` | Module access per plan |
| `platform_pricing` | Per-platform pricing plans: slug, plan_name, price, features JSONB, trial_days, max_projects, badge, CTA |
| `coupon_codes` | Discount codes: percentage/fixed, applicable plans/platforms, max uses, expiry |
| `platform_features` | Per-platform features: key, text, category (modules/projects/exports/support/team), display_order |
| `plan_feature_access` | Admin toggles: plan_id + feature_id → is_included, override_text |
| `newsletter_subscribers` | Hub-segmented: email+hub UNIQUE, status (active/unsubscribed/bounced), unsubscribe_token UUID, source. Bounced/complained statuses set automatically by the Resend webhook on hard-bounce + spam complaint. |
| `newsletter_campaigns` | Email campaigns: subject, body, target_hub, **segment** (migration 143), status (draft/scheduled/sending/sent/failed/cancelled), sent_count, failed_count, **scheduled_at** (migration 143 — when set, status='scheduled' and the cron picks it up), campaign_type (manual/auto), source_type, source_id |
| `newsletter_recipient_log` | **Migration 143**. Per-recipient delivery + engagement log: `id`, `campaign_id` (FK CASCADE), `email`, `status` (pending/sent/failed/bounced/complained/opened/clicked), `resend_message_id`, `error_message`, `sent_at`, `opened_at`, `clicked_at`. Composite UNIQUE on `(campaign_id, email)`. Drives the Campaigns analytics modal (open/click rates, retry-failed). Webhook handler at `/api/webhooks/resend` is the canonical engagement updater. |
| `newsletter_templates` | **Migration 143**. Editable templates that power both Compose and auto-notify. Columns: `template_key` UNIQUE, `name`, `subject_template`, `body_html`, `event_type` (nullable; matched by auto-notify), `active`. Seeded with 6 default templates mirroring the previously-hardcoded `generateContent`/`generateEmail` functions. Edited at `/admin/communications-hub?tab=newsletter` → Templates sub-tab. |
| `newsletter_auto_settings` | Auto-notification toggles: event_type UNIQUE, enabled, target_hub |
| `newsletter_subscribers_legacy` | Renamed old table (migration 091 preserved data) |

### Certification Watch & Assessment Results
| Table | Purpose |
|-------|---------|
| `certification_watch_history` | Video watch status (in_progress/completed) + interval-merged tracking (`watch_seconds`, `total_seconds`, `watch_percentage`, `last_position`, `updated_at` — added migration 103). Gates "Take Assessment" on dashboard + Mark Complete on watch page. `student_email + tab_key` UNIQUE |
| `training_assessment_results` | Per-session assessment scores for Training Hub. Supabase as primary source (instant reads). email + tab_key UNIQUE. Dual-write with Apps Script |

### Email System
| Table | Purpose |
|-------|---------|
| `email_branding` | Universal email logo, signature, footer, primary color (single row) |
| `email_templates` | Editable templates per email type (announcement, 24h reminder, 1h reminder, recording available) |
| `site_settings` | Global site settings (header, footer, colors, SEO) — JSONB per key |

### Marketing Studio (migration 142 — rebuild; supersedes 100-102)
| Table | Purpose |
|-------|---------|
| `marketing_uploaded_assets` | Reusable background images uploaded by admins for the Training Hub Marketing Studio. Columns: `id UUID PK`, `name TEXT`, `storage_path TEXT UNIQUE`, `url TEXT`, `mime_type TEXT`, `file_size INT`, `width INT`, `height INT`, `uploaded_by TEXT` (admin email), `created_at`, `updated_at`. Index on `created_at DESC`. Files live in the `marketing-assets` storage bucket; this table is the metadata index. Brand pack (logo, primary color, default trainer photo+name+credentials) is sourced live from `email_branding` + `cms_content.header_settings` + the default row of `instructors` — no separate brand-kit table to drift. |
| ~~`marketing_designs`~~ | **DROPPED in migration 142.** Was the Phase 1.5 canvas-state persistence table — superseded by template-driven server-rendering (no canvas state to save). |
| ~~`marketing_brand_kit`~~ | **DROPPED in migration 142.** Was a singleton brand-kit row plus image libraries — superseded by live resolution from `email_branding` + `cms_content` + `instructors`. |

---

## Database Migrations Log

| File | Description |
|------|-------------|
| `002_phase1_cms.sql` | Phase 1 CMS tables |
| `003_branding_config.sql` | Branding config table |
| `004_site_pages.sql` | Dynamic nav pages |
| `005_training_assessments.sql` | Assessment questions + attempts |
| `006_permissions.sql` | RBAC permissions table |
| `007_audit_log.sql` | Admin audit trail |
| `008_password_resets.sql` | Password reset tokens |
| `009_testimonials_contact.sql` | Testimonials + contact submissions |
| `010_rename_training_hub.sql` | Table renames |
| `011_contact_nav.sql` | Contact + nav updates |
| `012_training_settings.sql` | Training settings (Apps Script URL) |
| `013_training_admin_actions.sql` | Admin action history |
| `014_pricing.sql` | Plans, features, modules tables |
| `015_contact_nav_email.sql` | Email field on contact |
| `016_fix_nav_urls.sql` | Nav URL fixes |
| `017_seed_courses_curriculum.sql` | Course + session seed data |
| `018_pricing_initial_plans.sql` | Seed pricing plans |
| `019_rename_modeling_hub.sql` | Modeling hub renames |
| `020_course_descriptions.sql` | Course description fields |
| `021_student_testimonials.sql` | Student testimonial visibility |
| `022_student_dashboard_features.sql` | Dashboard feature fields |
| `023_training_intelligence.sql` | Analytics/progress features |
| `024_profile_extensions.sql` | Extended profile fields |
| `025_testimonial_hub_visibility.sql` | Hub-specific testimonial flags |
| `026_session_config.sql` | Session configuration |
| `027_auth_enhancements.sql` | hCaptcha cols, device trust, email confirm, OTP tables |
| `028_certificate_system.sql` | certificate_id, cert_pdf_url, badge_url, grade, issued_at cols on student_certificates |
| `029_fix_email_confirmed.sql` | Backfill email_confirmed=true for NULL rows; clean up stale tokens |
| `030_page_sections.sql` | Dynamic CMS: page_sections + cms_pages tables; seeds 7 system pages |
| `031_seed_page_sections.sql` | Seeds page_sections for about/contact/training/modeling |
| `032_shuffle_settings.sql` | Assessment shuffle settings per course in training_settings |
| `033_course_attachments.sql` | Course attachments table |
| `034_live_sessions.sql` | Live playlists + live sessions tables |
| `035_live_sessions_enhancements.sql` | banner_url, duration, max_attendees, difficulty, prerequisites, instructor, tags, is_featured, live_password |
| `036_live_session_registration.sql` | registration_url field on live_sessions |
| `037_session_registrations.sql` | session_registrations table + registration_required + show_join_link_minutes_before |
| `038_testimonials_linkedin.sql` | linkedin_url, profile_photo_url, hub, video_url on testimonials |
| `039_nav_training_sessions.sql` | "Training Sessions" link in site_pages nav |
| `040_youtube_embed_toggle.sql` | youtube_embed BOOLEAN on live_sessions |
| `041_watch_history_instructor_title.sql` | session_watch_history table + instructor_title on live_sessions |
| `042_site_settings.sql` | site_settings table (header, footer, colors, SEO JSONB) |
| `043_email_system.sql` | email_branding + email_templates tables, 5 new columns on live_sessions (announcement_sent, announcement_send_mode, reminder_24h_sent, reminder_1h_sent, recording_email_sent) |
| `044_cms_about_page.sql` | Seed page_sections for /about (hero, columns, cards, team, cta) |
| `045_cms_contact_page.sql` | Seed page_sections for /contact (hero, contact_body dynamic) |
| `046_cms_pricing_page.sql` | Seed page_sections for /pricing (hero, pricing_plans dynamic, FAQ dynamic, cta) |
| `047_cms_training_page.sql` | Seed page_sections for /training (hero, steps, courses dynamic, benefits, banner, testimonials dynamic, upcoming_sessions dynamic, cta) |
| `048_cms_modeling_page.sql` | Seed page_sections for /modeling (hero, audience cards, modules dynamic, why cards, testimonials dynamic, cta) |
| `049_cms_home_page.sql` | Seed page_sections for / home (hero, mission, vision, stats, what-is-fmp, pillars, founder dynamic, pacemakers, articles dynamic, testimonials dynamic, pricing_preview dynamic, cta) |
| `050_cms_articles_page.sql` | Seed page_sections for /articles (hero, articles dynamic) |
| `051_cms_training_sessions_page.sql` | Seed page_sections for /training-sessions (hero, live_sessions dynamic) |
| `052_cms_fix_missing_sections.sql` | Fix missing CMS sections: pricing comparison/footer note markers, training section order + submit CTA, modeling submit CTA, home pillars complete content, training-sessions hero removal |
| `053_cms_home_hero.sql` | Seed home page hero into page_sections (badge, headline, subtitle, powerStatement, softCta, trustLine, tags, CTA buttons, visibility flags) |
| `054_cms_home_stats.sql` | Seed home page stats bar into page_sections (4 stat items with value+label) |
| `055_cms_home_mission_vision.sql` | Seed home page Mission & Vision as text_image sections with image upload support |
| `056_cleanup_duplicates.sql` | Remove duplicate text-type Mission/Vision, add What is FMP text_image section, fix display_order for all 12 home sections |
| `057_fix_whatisfmp_content.sql` | Restore full What is FMP body text + 6 checklist items verbatim |
| `058_cms_home_two_platforms.sql` | Seed Two Platforms columns section with full content (SVG icons, features, CTAs, border colors) |
| `059_cms_home_founder.sql` | Seed Founder team section (badge, name, title, bio, credentials, long_bio, philosophy, experience, photo, CTAs, booking) |
| `060_founder_fixes.sql` | Add qualifications field, change photo to auto height + contain fit |
| `061_founder_content.sql` | Add background_paragraphs, projects array, booking_expectations to founder |
| `062_cms_home_pacemakers.sql` | Seed PaceMakers columns section (badge, heading, description, CTA, services list) |
| `063_founder_consolidate.sql` | Consolidate founder experience list, remove old duplicate keys |
| `064_testimonials_linkedin.sql` | Add linkedin_url column to testimonials table (manual submissions) |
| `065_cms_training_page.sql` | Seed Training Hub marketing page into CMS: 9 sections (hero, courses, how-it-works, why-certify, cert-verification, upcoming-sessions, testimonials, submit-testimonial CTA, bottom CTA) |
| `066_training_page_content.sql` | Full verbatim content for all training sections, remove hero login hint, normalize CTA field names |
| `067_reset_founder.sql` | Delete and reseed founder (team) section with correct field names and full verbatim content |
| `068_merge_credentials.sql` | Remove experience[] field — credentials[] is now single source of truth for both home card and about page |
| `070_cms_modeling_page.sql` | Seed Modeling Hub marketing page into CMS: 7 sections (hero, audience, platforms grid, why-modeling, testimonials, submit-testimonial CTA, bottom CTA) |
| `071_cms_modeling_real_estate.sql` | Seed Real Estate platform sub-page: 6 sections (hero, what-covers, who-is-it-for, what-you-get, module-guide dynamic, bottom CTA) |
| `072_modeling_platform_enhancements.sql` | Add stats bar after hero, upgrade text→text_image with image support, add image fields to list sections |
| `074_modeling_coming_soon.sql` | Add modeling_hub_coming_soon setting to training_settings (default: true) |
| `075_contact_page_items.sql` | Add contact_items[] to contact page sections, update footer founder line |
| `076_pricing_restructure.sql` | Create platform_pricing + coupon_codes tables, seed 4 Real Estate plans + LAUNCH20 coupon |
| `077_pricing_platform_features.sql` | Create platform_features + plan_feature_access tables, seed 16 RE features + access rows, update plan prices |
| `078_articles_newsletter.sql` | Create newsletter_subscribers table |
| `079_training_sessions_hero.sql` | Update training-sessions hero with full CMS content (heading, subtitle, badge, CTAs) |
| `080_header_settings.sql` | Seed header_settings into cms_content (logo, brand name, tagline, icon, header sizing) |
| `081_tagline_richtext.sql` | No schema change — tagline stored as HTML in cms_content, favicon moved to root layout metadata |
| `082_watch_progress_status.sql` | Add status (TEXT, default 'completed') and watch_percentage (INTEGER, default 100) to session_watch_history |
| `083_youtube_comments_cache.sql` | Create youtube_comments_cache table (video_id UNIQUE, comments JSONB, fetched_at, comment_count) |
| `084_show_like_button.sql` | Add show_like_button (BOOLEAN, default true) to live_sessions |
| `085_nav_training_sessions_learn.sql` | Update site_pages href for training-sessions to learn subdomain absolute URL |
| `086_session_notes.sql` | Create session_notes table (session_id FK, student_email, notes TEXT, UNIQUE constraint) |
| `087_training_hub_settings.sql` | Seed cms_content training_hub/live_sessions_label = 'Live Sessions' |
| `088_certification_watch_history.sql` | Create certification_watch_history table (student_email + tab_key UNIQUE, status in_progress/completed, started_at, completed_at) |
| `089_sync_email_logo.sql` | Sync email_branding.logo_url from CMS header_settings logo_url |
| `090_training_assessment_results.sql` | Create training_assessment_results table (email + tab_key UNIQUE, score, passed, attempts, is_final, completed_at). Supabase as primary source for instant dashboard progress |
| `091_newsletter_system.sql` | Newsletter: drop+recreate newsletter_subscribers with hub segmentation (email+hub UNIQUE), create newsletter_campaigns, migrate legacy subscribers to training hub |
| `092_newsletter_auto_notify.sql` | Auto-notifications: newsletter_auto_settings table (6 event types), campaign_type/source_type/source_id on campaigns, unique index for duplicate prevention |
| `093_legal_pages.sql` | Legal pages: 4 cms_pages (privacy-policy, terms-of-service, confidentiality, refund-policy) + page_sections with full legal content (rich_text type) |
| `094_founder_profile_update.sql` | Update founder team section: new bio, 10 credentials, full career long_bio, why_fmp, expertise[], industry_focus[], market_focus, personal |
| `095_home_text_sections_update.sql` | Update home text_image sections: What is FMP (new body + items, maxWidth 1200px), Our Mission, Our Vision |
| `096_cleanup_text_image_html.sql` | Remove stale html field from text_image sections that also have body (prevents duplicate rendering) |
| `097_two_platforms_vf_backfill.sql` | Move legacy top-level `col{i}_*_{align|width|visible}` keys into nested `columns[i].{field}_{suffix}` on TwoPlatforms sections so per-column VF controls actually correlate with the frontend CmsField reads. Safe to re-run. |
| `098_drop_founder_profile.sql` | `DROP TABLE IF EXISTS founder_profile CASCADE` — legacy key-value founder table removed. All founder data lives in `page_sections.team` (single source of truth). |
| `099_cleanup_about_page.sql` | DELETE rows for the removed `/about` page (`page_sections` + `cms_pages`), and update any `site_pages` entry with `href = '/about'` to point at `/about/ahmad-din`. |
| `100_marketing_studio.sql` | Marketing Studio foundation: `marketing_designs` (saved design drafts, indexed by template_type + created_at) and `marketing_brand_kit` (single-row brand kit with logos, colors, fonts). Seeds default brand kit row (id=1). |
| `101_marketing_studio_canvas.sql` | Marketing Studio Phase 1.5 canvas editor: add `dimensions jsonb`, `background jsonb`, `elements jsonb` to `marketing_designs`. Add `additional_logos jsonb`, `additional_photos jsonb`, `uploaded_images jsonb` to `marketing_brand_kit`. |
| `102_marketing_studio_backgrounds.sql` | Marketing Studio background library: add `background_library jsonb` to `marketing_brand_kit`, seed one `{id: "fmp-navy-default", type: "brand"}` placeholder entry. |
| `103_watch_enforcement.sql` | Video watch enforcement: add `watch_seconds`, `total_seconds`, `watch_percentage`, `last_position`, `updated_at` to `certification_watch_history`. Seed `watch_enforcement_enabled='true'` and `watch_enforcement_threshold='70'` in `training_settings`. Per-session bypass entries (`watch_enforcement_bypass_{TABKEY}`) are created on demand via the admin UI — no seed rows. |
| `104_live_sessions_rebrand.sql` | Rebrand `/training-sessions` public page: update `page_sections` hero (`heading` → "FMP Real-World Financial Modeling", `subtitle` → "Live sessions and recorded content. Practitioner-led. Built on real deal work.", `badge` → "LIVE & RECORDED SESSIONS"). Rename `site_pages` nav row `/training-sessions` label from "Training Sessions" to "Live Sessions". |
| `105_live_session_assessments.sql` | Native live-session quiz system: `live_session_assessments` (one per session: `enabled`, `questions jsonb`, `pass_threshold`, `max_attempts`, `timer_minutes`, `require_watch_before_assessment`, `watch_threshold`), `live_session_attempts` (per submission: `attempt_number`, `score`, `passed`, `answers`, `question_results`, `time_taken_seconds`), plus `has_assessment boolean` flag on `live_sessions` kept in sync by the server helper. |
| `106_instructors.sql` | Instructor roster for live sessions: `instructors` (name, title, bio, photo_url, email, linkedin_url, credentials, display_order, is_default, active) with partial unique index enforcing at most one default, seeded with "Ahmad Din — Corporate Finance & Transaction Advisory Specialist" as the default. Adds `instructor_id UUID REFERENCES instructors(id) ON DELETE SET NULL` to `live_sessions` and back-fills existing rows that match the default instructor's name. Legacy `instructor_name`/`instructor_title` columns are kept in parallel and auto-synced by the admin API when `instructor_id` is set. |
| `107_live_session_watch_seconds.sql` | Adds `watch_seconds`, `total_seconds`, `last_position`, `updated_at` to `session_watch_history` (mirrors migration 103 on `certification_watch_history`) so live-session Mark Complete can enforce a 70% watch gate via interval-merged seconds that survive reloads. |
| `108_training_settings_consolidation.sql` | Collapses per-course shuffle keys (`shuffle_questions_3sfm`/`_bvm`, `shuffle_options_3sfm`/`_bvm`) into two global keys: `shuffle_questions_enabled` (default `'true'`) and `shuffle_options_enabled` (default `'false'`). Migrates existing values (global OR'd across courses), then deletes the old per-course rows plus the obsolete `timer_bypass_enabled` key (watch-enforcement supersedes time-based locking). |
| `109_certificate_eligibility_view.sql` | Native Supabase certificate eligibility. Creates view `certificate_eligibility_raw` that groups `training_assessment_results` by (email, course_code) and surfaces `passed_count`, `attempted_count`, `final_passed`, `final_score`, `avg_score`. Consumed by `findAllEligibleFromSupabase()` so the cron issues certs without needing Apps Script's pending flag. Adds `issued_via` + `issued_by_admin` columns to `student_certificates` for audit provenance on admin force-issues. |
| `110_normalize_cert_status.sql` | Rewrites legacy `student_certificates.cert_status='Forced'` → `'Issued'`. A prior engine change wrote the literal 'Forced' for admin force-issues, but every downstream reader (`/verify/[uuid]`, dashboard API, admin list) gates on `cert_status='Issued'` — the force-issued rows were invisible despite being fully populated. Provenance is now tracked exclusively via `issued_via='forced'` + `issued_by_admin`. Safe to re-run: only affects rows with the stale literal. |
| `111_student_certificates_constraints.sql` | Adds the unique indexes `student_certificates` needed but never had: `uniq_student_certificates_email_course` on `(LOWER(email), course_code)` + `uniq_student_certificates_certificate_id` on `certificate_id`. Root cause of the "zero rows ever" bug: engine called `.upsert({…}, { onConflict: 'registration_id' })` but the table had no matching unique constraint → Postgres rejected every upsert and the code wasn't checking `.error`. Engine has since been switched to explicit SELECT → UPDATE\|INSERT so it's constraint-agnostic, but these indexes are the correct version-controlled shape going forward. Dedupes existing rows by `(email, course_code)` before the unique index is created. |
| `112_drop_legacy_not_null_constraints.sql` | Drops NOT NULL on legacy `student_certificates` columns the native engine doesn't populate (`certifier_uuid`, `certifier_url`, `certifier_name`, `certifier_id`, `certifier_token`, `legacy_id`, `apps_script_id`, `sheet_row_id`). Each ALTER is guarded by an `information_schema` check so running against a DB missing any given column is a silent no-op. Fixes "DB write failed: null value in column 'certifier_uuid' violates not-null constraint" that surfaced once migration 111's error-checked engine started reporting real Postgres errors instead of swallowing them. |
| `113_verify_url_to_learn_subdomain.sql` | Rewrites `student_certificates.verification_url` from `https://financialmodelerpro.com/verify/…` → `https://learn.financialmodelerpro.com/verify/…` (also handles `http://` legacy variant). `/verify/:id` is rewritten to the same Next page on both subdomains, but `learn.*` is the canonical host for Training Hub shares + QR codes. New certs get the correct URL from the engine (`MAIN_URL` → `LEARN_URL` for verificationUrl); this migration backfills existing rows. |
| `114_share_templates.sql` | Creates `share_templates` table (`template_key` UNIQUE, `title`, `template_text`, `hashtags TEXT[]`, `mention_brand`, `mention_founder`, `active`, timestamps + `updated_at` trigger). Seeds 5 default templates: `certificate_earned`, `assessment_passed`, `achievement_card`, `live_session_watched`, `session_shared`. Powers every Training Hub share button via the centralized render engine in `src/lib/training/shareTemplates.ts`. `ON CONFLICT DO NOTHING` preserves admin edits on re-run. |
| `115_share_mention_settings.sql` | Seeds `training_settings` keys `share_brand_mention` (default `'FinancialModelerPro'`) and `share_founder_mention` (default `'Ahmad Din, ACCA, FMVA®'`). Admin-editable text that `{@brand}` / `{@founder}` placeholders resolve to at render time. Previously hardcoded as `BRAND_HANDLE` / `FOUNDER_HANDLE` constants in `shareTemplates.ts`. |
| `116_share_prefix_at_settings.sql` | Seeds `training_settings` keys `share_brand_prefix_at` and `share_founder_prefix_at` (both default `'false'` — plain text). Two global toggles control whether `{@brand}` / `{@founder}` render with a leading `@` (for LinkedIn tagging) or as plain text. Moves the control from per-template `mention_brand`/`mention_founder` columns (now ignored at render) to a single global setting. |
| `117_daily_roundup_template.sql` | Adds `daily_certifications_roundup` row to `share_templates`. Template uses placeholders `{studentList}`, `{verifyLinks}`, `{count}`, `{date}`, `{@brand}`, `{@founder}` to assemble a single roll-up post featuring every student who earned a cert on a given day. Consumed by `/admin/training-hub/daily-roundup` page + `GET /api/admin/certificates/by-date`. `ON CONFLICT DO NOTHING` preserves admin edits on re-run. |
| `118_auto_launch.sql` | Per-hub auto-launch keys in `training_settings`: `training_hub_auto_launch`, `training_hub_last_auto_launched_at`, `modeling_hub_auto_launch`, `modeling_hub_last_auto_launched_at` (all seeded `'false'` / `''`). Powers the `/api/cron/auto-launch-check` route that flips Coming Soon → LIVE at a scheduled `launch_date`. Currently disabled at the UI level (`AUTO_LAUNCH_UI_ENABLED=false` in `LaunchStatusCard`) because Vercel Hobby only supports daily crons — ship when we upgrade to Pro. `ON CONFLICT DO NOTHING` so re-run is safe. |
| `119_share_templates_hub_url.sql` | Soft-upgrades 5 share templates (`assessment_passed`, `achievement_card`, `live_session_watched`, `session_shared`, `daily_certifications_roundup`) by appending `\n\nLearn more at {hubUrl}` — but only when the existing `template_text` doesn't already reference the learn subdomain OR the `{hubUrl}` variable. Preserves admin customization; re-running is a no-op because updated rows then match the skip predicate. `certificate_earned` is intentionally excluded (already embeds `{verifyUrl}`). |
| `120_tour_completed.sql` | `ALTER TABLE training_registrations_meta ADD COLUMN tour_completed BOOLEAN DEFAULT FALSE` — one-shot onboarding tour flag. The `driver.js` walkthrough fires the first time a student lands on `/training/dashboard`; completion is persisted here. Flipped back to `FALSE` via the profile dropdown's "Restart Tour" action. `POST /api/training/tour-status` toggles it. |
| `121_hub_bypass_list.sql` | Seeds `training_settings.training_hub_bypass_list` with a comma-separated list of emails OR registration IDs (case-insensitive) allowed to sign in while Training Hub is in Coming Soon mode. Fills the gap where Modeling Hub's NextAuth admin role skips the CS gate but Training Hub's cookie-based session has no role field. Matched by `src/lib/shared/hubBypassList.ts` + `comingSoonGuard.ts`. Seed: owner email + RegID; admin UI to manage this list TBD — edit the row directly for now. |
| `122_session_registration_reminders.sql` | Moves reminder lifecycle tracking from per-session (`live_sessions` from migration 043) to per-registration. Adds `reminder_24h_sent` + `reminder_1h_sent` (BOOLEAN NOT NULL DEFAULT FALSE) to `session_registrations` + two partial indexes on `false` rows. Fixes the "late registrant never gets 24h reminder" bug where the session-level flag was already set by the first registrant. `announcement_sent` stays on `live_sessions` (session-level gate: "don't remind about an unpublished session"). |
| `123_whatsapp_group_url.sql` | Seeds `training_settings.whatsapp_group_url` (default `''`) — admin-editable WhatsApp group invite URL. When set to a `https://chat.whatsapp.com/` link, the Training Hub dashboard sidebar renders a green "Join WhatsApp Group" button alongside the existing LinkedIn + YouTube CTAs; empty value hides the button (no broken or disabled state). Admin UI at `/admin/training-settings` validates the URL shape. Public read via `GET /api/training/community-links`. `ON CONFLICT DO NOTHING` so re-run preserves admin edits. |
| `124_cert_email_sent_at.sql` | Adds `email_sent_at TIMESTAMPTZ NULL` to `student_certificates` + partial index `idx_student_certificates_email_unsent` on `(email, certificate_id)` where `email_sent_at IS NULL AND cert_status = 'Issued'` (constant-time "needs resend" lookup). `certificateEngine.issueCertificateForPending` stamps the timestamp after the issuance email resolves; a null stamp means "cert generated but email never went out" and surfaces as a yellow "Unsent" pill plus `✉ Resend` button on `/admin/training-hub/certificates`. Closes the email-delivery observability gap called out in the pre-launch diagnosis alongside the move to inline-trigger issuance. |
| `136_modeling_hub_lockdown.sql` | Modeling Hub pre-launch lockdown - three things in one atomic migration so a partial apply can never leave the hub half-locked: (1) splits the single `modeling_hub_coming_soon` toggle into `modeling_hub_signin_coming_soon` + `modeling_hub_register_coming_soon` (+ launch_date per side), both default `'true'`. (2) creates `modeling_access_whitelist` table (`email UNIQUE`, `note`, `added_by`, `added_at`) with `idx_modeling_wl_email_lower` partial index; pre-seeds the admin row. (3) purges six unauthorized users that slipped in through the previously-unguarded `/modeling/register` page - audit trail captured FIRST in `admin_audit_log` via subquery that resolves `admin_id` to the admin user's UUID (live schema has admin_id NOT NULL, originally committed without the lookup and failed with 23502 - fixed in commit `4de63b5`). Cleanup of email-keyed `trusted_devices` rows included since those don't cascade from `users.id`. `role <> 'admin'` safety bumper on the DELETE. Idempotent: `ON CONFLICT DO NOTHING` on inserts, email-equality WHERE on the delete, `IF NOT EXISTS` on the table. |
| `137_force_modeling_toggles_coming_soon.sql` | Force-upserts `modeling_hub_signin_coming_soon` + `modeling_hub_register_coming_soon` to `'true'` via `ON CONFLICT DO UPDATE SET value = EXCLUDED.value`. Migration 136 uses `ON CONFLICT DO NOTHING` which preserves any prior admin edits; this migration is the explicit "both default ON per spec" correction in case an environment had one flipped to LIVE from a partial earlier run. Launch dates are intentionally left alone. Idempotent: re-running writes `'true'` over `'true'`. Admins can still flip either toggle back via `/admin/modules`; subsequent migrations will not touch them. |
| `138_announcement_recipient_log.sql` | Per-recipient audit child table for `announcement_send_log`. Creates `announcement_recipient_log` (FK `send_log_id UUID REFERENCES announcement_send_log(id) ON DELETE CASCADE`, `email`, `name`, `registration_id`, `status` CHECK pending/sent/failed/bounced/complained, `resend_message_id`, `error_message`, `sent_at`, `created_at`, `UNIQUE(send_log_id, email)`). Two indexes: `idx_announcement_recipient_log_send` on the FK + partial `idx_announcement_recipient_log_failed` on `(send_log_id) WHERE status IN ('failed','bounced')` for the retry-failed hot path. Before this table, the parent `announcement_send_log` stored only aggregate counts + the FIRST failure's `error_message` - so a 4-of-9 partial failure left 3 errors on the floor and the admin had no way to know which students missed the email. Future Resend webhook can write `bounced`/`complained` to the same rows without schema changes. Safe to re-run (IF NOT EXISTS on table + indexes). |
| `139_phone_required.sql` | Defensive `ADD COLUMN IF NOT EXISTS phone TEXT` on `training_registrations_meta` + `training_pending_registrations`. The column already exists in production (added alongside city/country in an earlier era) but the schema is not fully reproducible from the migration log alone, so this guarantees a rebuild from scratch lands in the same state. Stays NULLable so ~9 pre-collection legacy rows keep working; the "required" rule is enforced at the application layer (RegisterForm + `/api/training/register` both validate against `^\+[1-9]\d{6,14}$`). |
| `140_purge_test_account.sql` | One-off cleanup. Deletes the pre-launch test account `FMP-2026-0037` / `pacemakersglobal@gmail.com` from every table that referenced it (training_registrations_meta + 5 children + activity tables defensively). Production was purged via service-role script on 2026-04-23 with an `admin_audit_log` trail (action=`training_account_purge`, audit row id `e45c3a81-da3e-46af-8430-31671244eac6`) capturing the snapshot of the meta row before deletion. This file is FK-safe (children before parent) and idempotent so any other environment (staging, fresh rebuild) lands in the same state. |
| `141_fix_misplaced_bvm_attachments.sql` | Re-tags three production rows in `course_attachments` that the admin training editor wrote with the wrong tab_key. Bug: the page checked `courseId?.toLowerCase() === 'bvm'` against the URL slug, but the page is reached via `/admin/training/<UUID>` (the course list links to `c.id`), so the comparison was always false and every BVM upload landed on `3SFM_S{display_order}` / `course='3sfm'`, colliding with real 3SFM session attachments. Migration moves the three known misplaced rows (FMP_BVM_DCF / Comps_Training / Comps_Template) from `3SFM_S{1,4,5}` to `BVM_L{1,4,5}` and updates `course='bvm'`. Rows pinned by id so re-running is a no-op. Production was repaired via service-role script the same day with an `admin_audit_log` trail (action=`course_attachments_repair`, audit row id `13c9ec41-ea74-44d2-a253-eae00901c553`). The code fix in the same commit derives the prefix from the loaded `course.category` so this cannot recur. |
| `142_marketing_studio_rebuild.sql` | Marketing Studio rebuild for the Training Hub edition. **Drops** `marketing_designs` and `marketing_brand_kit` (Phase 1.5 canvas-state tables, superseded by deterministic template-rendering — see `app/admin/training-hub/marketing-studio/`). **Creates** `marketing_uploaded_assets` (id UUID PK, name, storage_path UNIQUE, url, mime_type, file_size, width, height, uploaded_by, created_at, updated_at) with a `created_at DESC` index. **Creates** the `marketing-assets` storage bucket (public-read) via `INSERT INTO storage.buckets ... ON CONFLICT DO NOTHING` and adds a permissive SELECT policy so satori can fetch background images during render. Brand pack (logo / primary color / default trainer photo+name+credentials) is now sourced live from `email_branding` + `cms_content.header_settings.logo_url` + the `is_default=true` row of `instructors` — no separate brand-kit row to drift. Idempotent. **Follow-up (2026-04-24, no migration)**: Marketing Studio multi-instructor + photo upload + drag-resize work re-uses existing tables — `instructors` (the existing `photo_url` column now feeds the new circular preview thumbnail + admin upload flow on `/admin/training-hub/instructors`, files land in `cms-assets` bucket via `/api/admin/media`) and `live_sessions.instructor_id` (the Live Session Banner editor's session-pick now auto-populates `instructorIds: [session.instructor_id]` instead of using the legacy `instructor_name`/`instructor_title` text columns). |
| `143_newsletter_rebuild.sql` | Newsletter system rebuild. Three additions, all idempotent: (1) **`newsletter_templates`** — editable templates that power both Compose and auto-notify (eliminates the manual-vs-auto template drift bug). Columns: `template_key` UNIQUE, `name`, `subject_template`, `body_html`, `event_type` (nullable, used by auto-notify lookup), `active`, timestamps. Seeded with 6 templates mirroring the previously-hardcoded `generateContent`/`generateEmail` functions: `article_published`, `live_session_scheduled`, `live_session_recording`, `new_course_session`, `platform_launch`, `new_modeling_module`. (2) **`newsletter_recipient_log`** — per-recipient delivery + engagement log (mirrors migration 138's `announcement_recipient_log`). Columns: `id`, `campaign_id` FK CASCADE, `email`, `status` CHECK (pending/sent/failed/bounced/complained/opened/clicked), `resend_message_id`, `error_message`, `sent_at`, `opened_at`, `clicked_at`, `created_at`, UNIQUE(campaign_id, email). Indexes on FK + partial on failed/bounced for the retry hot path. (3) **`scheduled_at` + `segment`** columns on `newsletter_campaigns`; status CHECK extended to include 'scheduled' and 'cancelled'. `ON CONFLICT DO NOTHING` on template seeds, `IF NOT EXISTS` everywhere. **Important**: this migration must be applied manually via the Supabase dashboard before the new code paths execute reliably (templates table queries return empty until seeded). |
