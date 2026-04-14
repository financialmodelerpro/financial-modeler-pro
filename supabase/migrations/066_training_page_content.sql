-- ============================================================
-- 066: Training Hub page — full verbatim content for all sections
-- Removes login_hint from hero, normalizes field names,
-- ensures all hardcoded text is editable from page builder
-- ============================================================

-- ── Hero: remove login fields, normalize CTA field names ────────────────────
UPDATE page_sections
SET content = '{
  "badge": "\ud83c\udf93 Free Certification Program",
  "headline": "Get Certified in Financial Modeling — Free",
  "subtitle": "Professional certification backed by real practitioner training. 100% free. Always.",
  "cta_primary_text": "Register Free →",
  "cta_primary_url": "/register",
  "cta_secondary_text": "Login to Dashboard →",
  "cta_secondary_url": "/signin"
}'::jsonb
WHERE page_slug = 'training'
  AND section_type = 'hero';

-- ── How It Works: full verbatim steps ───────────────────────────────────────
UPDATE page_sections
SET content = '{
  "badge": "The Process",
  "heading": "How It Works",
  "steps": [
    {"icon": "\ud83d\udcdd", "label": "Register Free", "desc": "Create your free training account in seconds"},
    {"icon": "▶️", "label": "Watch on YouTube", "desc": "Stream all sessions free on YouTube"},
    {"icon": "✍️", "label": "Take Assessment", "desc": "Complete the quiz at the end of each session"},
    {"icon": "✅", "label": "Pass Sessions", "desc": "Score 70%+ to unlock the next session"},
    {"icon": "\ud83c\udfc6", "label": "Get Certified", "desc": "Pass the final exam and receive your certificate"}
  ]
}'::jsonb
WHERE page_slug = 'training'
  AND section_type = 'timeline';

-- ── Why Get Certified: full verbatim benefits ───────────────────────────────
UPDATE page_sections
SET content = '{
  "badge": "Why Certify",
  "heading": "Why Get Certified?",
  "benefits": [
    {"icon": "\ud83c\udf93", "title": "Verifiable Certificate", "desc": "Each certificate has a unique ID that employers can verify instantly online."},
    {"icon": "\ud83d\udcbc", "title": "LinkedIn Badge", "desc": "Add your certificate directly to your LinkedIn profile with one click."},
    {"icon": "\ud83d\udcca", "title": "Proof of Competence", "desc": "Demonstrate real, assessed financial modeling skills — not just course completion."},
    {"icon": "\ud83c\udd93", "title": "Always Free", "desc": "No fees, no subscriptions, no paywalls. Every course and certificate is 100% free."}
  ]
}'::jsonb
WHERE page_slug = 'training'
  AND section_type = 'cards'
  AND (content->>'_dynamic') IS NULL;

-- ── Certificate Verification Banner: full verbatim ─────────────────────────
UPDATE page_sections
SET content = '{
  "icon": "\ud83c\udfc5",
  "badge_text": "Verified Certificates",
  "heading": "Trusted Certificate Verification",
  "description": "All certificates are issued with a unique Certificate ID and QR code. Each certificate has a permanent verification link. Employers and institutions can verify your certification online at any time.",
  "cta_text": "Verify a Certificate →",
  "cta_url": "/verify"
}'::jsonb,
styles = '{"bgColor": "#E8F7EC", "badgeBg": "#ffffff", "badgeBorder": "#BBF7D0", "headingColor": "#0D2E5A", "textColor": "#374151", "ctaColor": "#15803D", "ctaBorder": "#2EAA4A"}'::jsonb
WHERE page_slug = 'training'
  AND section_type = 'banner';

-- ── Submit Testimonial CTA: full verbatim ───────────────────────────────────
UPDATE page_sections
SET content = '{
  "badge": "Your Voice Matters",
  "heading": "Completed a Course? Share Your Story",
  "description": "Help other learners by sharing your experience. Your testimonial could inspire the next finance professional.",
  "cta_text": "⭐ Submit Your Testimonial",
  "cta_url": "/training/submit-testimonial"
}'::jsonb,
styles = '{"bgColor": "#F0F4FF", "badgeColor": "#4F46E5", "headingColor": "#0D2E5A", "textColor": "#6B7280", "ctaBg": "#1B4F8A", "borderColor": "#E0E7F8"}'::jsonb
WHERE page_slug = 'training'
  AND section_type = 'cta'
  AND display_order < 9;

-- ── Bottom CTA: full verbatim ───────────────────────────────────────────────
UPDATE page_sections
SET content = '{
  "heading": "Ready to get certified?",
  "description": "Join hundreds of finance professionals building verified skills — completely free.",
  "cta_text": "Register Free →",
  "cta_url": "/register",
  "login_hint": "Already registered?",
  "login_text": "Login to Dashboard →",
  "login_url": "/signin"
}'::jsonb,
styles = '{"bgColor": "#2EAA4A", "textColor": "#ffffff", "ctaBg": "#ffffff", "ctaColor": "#1A7A30"}'::jsonb
WHERE page_slug = 'training'
  AND section_type = 'cta'
  AND display_order >= 9;

-- ── Testimonials: full verbatim headings ────────────────────────────────────
UPDATE page_sections
SET content = '{
  "_dynamic": "testimonials",
  "heading": "What Our Students Say",
  "subheading": "Verified feedback from FMP Training Hub students."
}'::jsonb
WHERE page_slug = 'training'
  AND section_type = 'testimonials';

-- ── Courses: full verbatim headings ─────────────────────────────────────────
UPDATE page_sections
SET content = '{
  "_dynamic": "courses",
  "badge": "Available Courses",
  "heading": "Choose Your Certification Path"
}'::jsonb
WHERE page_slug = 'training'
  AND section_type = 'cards'
  AND content->>'_dynamic' = 'courses';
