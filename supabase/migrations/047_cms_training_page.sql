-- ============================================================
-- 047: Migrate /training marketing page to CMS-driven rendering
-- Replaces hardcoded JSX with page_sections rows
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'training';

-- ── 1. Hero ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'hero', 1, true,
 '{"badge":"Free Certification Program","headline":"Get Certified in Financial Modeling — Free","subtitle":"Professional certification backed by real practitioner training. 100% free. Always.","buttons":[{"label":"Register Free →","url":"/register","style":"primary"},{"label":"Login to Dashboard →","url":"/signin","style":"outline"}]}',
 '{"bgColor":"linear-gradient(135deg,#0A1F3D 0%,#0D2E5A 50%,#0F3D6E 100%)","textColor":"#ffffff","paddingY":"clamp(56px,8vw,96px) 40px clamp(64px,9vw,104px)"}');

-- ── 2. How It Works (steps) ─────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cards', 2, true,
 '{"badge":"The Process","heading":"How It Works","cards":[{"icon":"📝","title":"Register Free","description":"Create your free training account in seconds"},{"icon":"▶️","title":"Watch on YouTube","description":"Stream all sessions free on YouTube"},{"icon":"✍️","title":"Take Assessment","description":"Complete the quiz at the end of each session"},{"icon":"✅","title":"Pass Sessions","description":"Score 70%+ to unlock the next session"},{"icon":"🏆","title":"Get Certified","description":"Pass the final exam and receive your certificate"}]}',
 '{"bgColor":"#F5F7FA","paddingY":"clamp(48px,7vw,80px)"}');

-- ── 3. Courses (dynamic — rendered by custom component using COURSES config) ─
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cards', 3, true,
 '{"_dynamic":"courses","badge":"Available Courses","heading":"Choose Your Certification Path","cards":[]}',
 '{"bgColor":"#ffffff","paddingY":"clamp(48px,7vw,80px)"}');

-- ── 4. Benefits ─────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cards', 4, true,
 '{"badge":"Why Certify","heading":"Why Get Certified?","cards":[{"icon":"🎓","title":"Verifiable Certificate","description":"Each certificate has a unique ID that employers can verify instantly online."},{"icon":"💼","title":"LinkedIn Badge","description":"Add your certificate directly to your LinkedIn profile with one click."},{"icon":"📊","title":"Proof of Competence","description":"Demonstrate real, assessed financial modeling skills — not just course completion."},{"icon":"🆓","title":"Always Free","description":"No fees, no subscriptions, no paywalls. Every course and certificate is 100% free."}]}',
 '{"bgColor":"#ffffff","paddingY":"clamp(48px,7vw,80px)"}');

-- ── 5. Certificate verification banner ──────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'banner', 5, true,
 '{"heading":"Trusted Certificate Verification","body":"All certificates are issued with a unique Certificate ID and QR code. Each certificate has a permanent verification link. Employers and institutions can verify your certification online at any time.","buttonText":"Verify a Certificate →","buttonUrl":"/verify","badge":"Verified Certificates"}',
 '{"bgColor":"#E8F7EC","textColor":"#0D2E5A","paddingY":"clamp(40px,6vw,64px)"}');

-- ── 6. Testimonials (dynamic) ───────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cards', 6, true,
 '{"_dynamic":"testimonials","heading":"What Our Students Say","subtitle":"Verified feedback from FMP Training Hub students.","cards":[]}',
 '{"bgColor":"#ffffff","paddingY":"clamp(48px,7vw,80px)"}');

-- ── 7. Upcoming sessions (dynamic) ──────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cards', 7, true,
 '{"_dynamic":"upcoming_sessions","heading":"","cards":[]}',
 '{"bgColor":"#ffffff","paddingY":"0"}');

-- ── 8. CTA ──────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cta', 8, true,
 '{"heading":"Ready to get certified?","subtitle":"Join hundreds of finance professionals building verified skills — completely free.","buttonText":"Register Free →","buttonUrl":"/register"}',
 '{"bgColor":"#2EAA4A","textColor":"#ffffff","paddingY":"clamp(48px,7vw,80px)"}');
