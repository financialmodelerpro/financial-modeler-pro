-- ============================================================
-- 065: Seed Training Hub marketing page into CMS page_sections
-- Option B: text is editable via Admin CMS; layout stays hardcoded
-- Dynamic sections use _dynamic markers for component rendering
-- ============================================================

-- Ensure cms_pages entry exists
INSERT INTO cms_pages (slug, title, status, is_system)
VALUES ('training', 'Training Hub', 'published', true)
ON CONFLICT (slug) DO UPDATE
SET title = 'Training Hub', status = 'published';

-- Clear any existing training sections
DELETE FROM page_sections WHERE page_slug = 'training';

-- ── Section 1: Hero ─────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'hero', 1, true,
 '{
   "badge": "\ud83c\udf93 Free Certification Program",
   "headline": "Get Certified in Financial Modeling — Free",
   "subtitle": "Professional certification backed by real practitioner training. 100% free. Always.",
   "cta1Text": "Register Free →",
   "cta1Url": "/register",
   "cta2Text": "Login to Dashboard →",
   "cta2Url": "/signin",
   "login_hint": "Already registered?",
   "login_text": "Login →",
   "login_url": "/signin"
 }',
 '{
   "bgColor": "linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)",
   "textColor": "#ffffff",
   "badgeBg": "rgba(46,170,74,0.18)",
   "badgeBorder": "rgba(46,170,74,0.45)",
   "badgeColor": "#6EE589",
   "ctaBg": "#2EAA4A",
   "ctaShadow": "0 4px 20px rgba(46,170,74,0.4)"
 }');

-- ── Section 2: Courses (dynamic) ────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cards', 2, true,
 '{
   "_dynamic": "courses",
   "badge": "Available Courses",
   "heading": "Choose Your Certification Path"
 }',
 '{"bgColor": "#ffffff"}');

-- ── Section 3: How It Works ─────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'timeline', 3, true,
 '{
   "badge": "The Process",
   "heading": "How It Works",
   "steps": [
     {"icon": "\ud83d\udcdd", "label": "Register Free", "desc": "Create your free training account in seconds"},
     {"icon": "▶️", "label": "Watch on YouTube", "desc": "Stream all sessions free on YouTube"},
     {"icon": "✍️", "label": "Take Assessment", "desc": "Complete the quiz at the end of each session"},
     {"icon": "✅", "label": "Pass Sessions", "desc": "Score 70%+ to unlock the next session"},
     {"icon": "\ud83c\udfc6", "label": "Get Certified", "desc": "Pass the final exam and receive your certificate"}
   ]
 }',
 '{"bgColor": "#F5F7FA"}');

-- ── Section 4: Why Get Certified ────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cards', 4, true,
 '{
   "badge": "Why Certify",
   "heading": "Why Get Certified?",
   "benefits": [
     {"icon": "\ud83c\udf93", "title": "Verifiable Certificate", "desc": "Each certificate has a unique ID that employers can verify instantly online."},
     {"icon": "\ud83d\udcbc", "title": "LinkedIn Badge", "desc": "Add your certificate directly to your LinkedIn profile with one click."},
     {"icon": "\ud83d\udcca", "title": "Proof of Competence", "desc": "Demonstrate real, assessed financial modeling skills — not just course completion."},
     {"icon": "\ud83c\udd93", "title": "Always Free", "desc": "No fees, no subscriptions, no paywalls. Every course and certificate is 100% free."}
   ]
 }',
 '{"bgColor": "#ffffff"}');

-- ── Section 5: Certificate Verification Banner ─────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'banner', 5, true,
 '{
   "icon": "\ud83c\udfc5",
   "badge_text": "Verified Certificates",
   "heading": "Trusted Certificate Verification",
   "description": "All certificates are issued with a unique Certificate ID and QR code. Each certificate has a permanent verification link. Employers and institutions can verify your certification online at any time.",
   "cta_text": "Verify a Certificate →",
   "cta_url": "/verify"
 }',
 '{"bgColor": "#E8F7EC", "badgeBg": "#ffffff", "badgeBorder": "#BBF7D0", "headingColor": "#0D2E5A", "textColor": "#374151", "ctaColor": "#15803D", "ctaBorder": "#2EAA4A"}');

-- ── Section 6: Upcoming Sessions (dynamic) ──────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'embed', 6, true,
 '{"_dynamic": "upcoming_sessions"}',
 '{}');

-- ── Section 7: Testimonials (dynamic) ───────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'testimonials', 7, true,
 '{
   "_dynamic": "testimonials",
   "heading": "What Our Students Say",
   "subheading": "Verified feedback from FMP Training Hub students."
 }',
 '{}');

-- ── Section 8: Submit Testimonial CTA ───────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cta', 8, true,
 '{
   "badge": "Your Voice Matters",
   "heading": "Completed a Course? Share Your Story",
   "description": "Help other learners by sharing your experience. Your testimonial could inspire the next finance professional.",
   "cta_text": "⭐ Submit Your Testimonial",
   "cta_url": "/training/submit-testimonial"
 }',
 '{"bgColor": "#F0F4FF", "badgeColor": "#4F46E5", "headingColor": "#0D2E5A", "textColor": "#6B7280", "ctaBg": "#1B4F8A", "borderColor": "#E0E7F8"}');

-- ── Section 9: Bottom CTA ───────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cta', 9, true,
 '{
   "heading": "Ready to get certified?",
   "description": "Join hundreds of finance professionals building verified skills — completely free.",
   "cta_text": "Register Free →",
   "cta_url": "/register",
   "login_hint": "Already registered?",
   "login_text": "Login to Dashboard →",
   "login_url": "/signin"
 }',
 '{"bgColor": "#2EAA4A", "textColor": "#ffffff", "ctaBg": "#ffffff", "ctaColor": "#1A7A30"}');
