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

---

## Database Tables (Supabase)

### Modeling Hub
| Table | Purpose |
|-------|---------|
| `users` | Accounts: id, email, name, password_hash, role, subscription_plan, subscription_status, phone, city, country, email_confirmed, confirmed_at |
| `projects` | REFM saved projects (JSON blob) |
| `password_resets` | Tokens for forgot-password flow |
| `modeling_email_otps` | 6-digit device-verify OTPs (10-min TTL) |

### Training Hub
| Table | Purpose |
|-------|---------|
| `training_registrations_meta` | Student records: registration_id, email, name, course, city, country, email_confirmed, confirmed_at |
| `training_passwords` | Bcrypt password hashes keyed by registration_id |
| `training_pending_registrations` | Staging table before email confirmation |
| `training_email_otps` | 6-digit device-verify OTPs (10-min TTL) |
| `training_settings` | Admin config: apps_script_url, etc. |
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
| `session_registrations` | Student RSVP: session_id, student_reg_id, student_name, student_email, registered_at, attended |
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
| `newsletter_subscribers` | Hub-segmented: email+hub UNIQUE, status (active/unsubscribed), unsubscribe_token UUID, source |
| `newsletter_campaigns` | Email campaigns: subject, body, target_hub, status, sent_count, failed_count, campaign_type (manual/auto), source_type, source_id |
| `newsletter_auto_settings` | Auto-notification toggles: event_type UNIQUE, enabled, target_hub |
| `newsletter_subscribers_legacy` | Renamed old table (migration 091 preserved data) |

### Certification Watch & Assessment Results
| Table | Purpose |
|-------|---------|
| `certification_watch_history` | Video watch status (in_progress/completed) for cert course sessions. Gates "Take Assessment" button on dashboard. student_email + tab_key UNIQUE |
| `training_assessment_results` | Per-session assessment scores for Training Hub. Supabase as primary source (instant reads). email + tab_key UNIQUE. Dual-write with Apps Script |

### Email System
| Table | Purpose |
|-------|---------|
| `email_branding` | Universal email logo, signature, footer, primary color (single row) |
| `email_templates` | Editable templates per email type (announcement, 24h reminder, 1h reminder, recording available) |
| `site_settings` | Global site settings (header, footer, colors, SEO) — JSONB per key |

### Marketing Studio (migrations 100 + 101 + 102)
| Table | Purpose |
|-------|---------|
| `marketing_designs` | Saved designs: id, name, template_type, `dimensions jsonb`, `background jsonb`, `elements jsonb` (Phase 1.5 canvas data), `content jsonb` (legacy Phase 1, unused), ai_captions jsonb, preview_url, created_by, timestamps |
| `marketing_brand_kit` | Singleton row (id=1): logo_url, logo_light_url, founder_photo_url, primary/secondary/accent/text colors, font_family, `additional_logos jsonb[]`, `additional_photos jsonb[]`, `uploaded_images jsonb[]` (Phase 1.5 libraries of `[{url, name}]`), `background_library jsonb[]` (Phase 1.5+ reusable backgrounds `[{id, name, url, thumbnail, type: brand\|custom}]`) |

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
