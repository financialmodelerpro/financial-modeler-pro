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
| `live_sessions` | Sessions: title, description, youtube_url, youtube_embed, live_url, session_type, scheduled_datetime, timezone, category, playlist_id, banner_url, duration_minutes, max_attendees, difficulty_level, prerequisites, instructor_name, instructor_title, tags[], is_featured, live_password, registration_url, notification/reminder tracking |
| `session_registrations` | Student RSVP: session_id, student_reg_id, student_name, student_email, registered_at, attended |
| `session_watch_history` | Recording watch tracking: session_id, student_email, student_reg_id, watched_at, points_awarded (50); UNIQUE(session_id, student_email) |
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
