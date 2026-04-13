-- ============================================================
-- 052: Fix missing CMS sections across 5 pages
-- Adds comparison table marker, footer note, submit testimonial
-- CTAs, fixes training section order, removes duplicate hero
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- FIX 1 — /pricing: add comparison table + footer note markers
-- ═══════════════════════════════════════════════════════════════

-- Bump FAQ from 3→5 and CTA from 4→6 to make room
UPDATE page_sections SET display_order = 6
WHERE page_slug = 'pricing' AND section_type = 'cta' AND display_order = 4;

UPDATE page_sections SET display_order = 5
WHERE page_slug = 'pricing' AND section_type = 'faq' AND display_order = 3;

-- Insert comparison table marker at order 3
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('pricing', 'text', 3, true,
 '{"_dynamic":"pricing_comparison"}',
 '{"bgColor":"#F5F7FA","paddingY":"0 40px 80px"}');

-- Insert footer note at order 4
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('pricing', 'text', 4, true,
 '{"_dynamic":"footer_note","text":"All plans include free training access. No credit card required for Free plan."}',
 '{"bgColor":"#F5F7FA","paddingY":"0"}');

-- ═══════════════════════════════════════════════════════════════
-- FIX 2 — /training: fix section order + add submit testimonial
-- ═══════════════════════════════════════════════════════════════

-- Swap courses (was 3→2) and how-it-works (was 2→3)
-- First set courses to temp value to avoid collision
UPDATE page_sections SET display_order = 99
WHERE page_slug = 'training'
AND section_type = 'cards'
AND (content->>'_dynamic') = 'courses';

UPDATE page_sections SET display_order = 3
WHERE page_slug = 'training'
AND section_type = 'cards'
AND display_order = 2
AND (content->>'_dynamic') IS NULL
AND (content->>'badge') = 'The Process';

UPDATE page_sections SET display_order = 2
WHERE page_slug = 'training'
AND section_type = 'cards'
AND display_order = 99
AND (content->>'_dynamic') = 'courses';

-- Move upcoming_sessions from 7→6, testimonials from 6→7
UPDATE page_sections SET display_order = 60
WHERE page_slug = 'training'
AND section_type = 'cards'
AND (content->>'_dynamic') = 'upcoming_sessions';

UPDATE page_sections SET display_order = 7
WHERE page_slug = 'training'
AND section_type = 'cards'
AND (content->>'_dynamic') = 'testimonials';

UPDATE page_sections SET display_order = 6
WHERE page_slug = 'training'
AND display_order = 60
AND (content->>'_dynamic') = 'upcoming_sessions';

-- Bump bottom CTA from 8→9
UPDATE page_sections SET display_order = 9
WHERE page_slug = 'training'
AND section_type = 'cta'
AND display_order = 8;

-- Insert submit testimonial CTA at order 8
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training', 'cta', 8, true,
 '{"heading":"Completed a Course? Share Your Story","subtitle":"Help other learners by sharing your experience. Your testimonial could inspire the next finance professional.","buttonText":"⭐ Submit Your Testimonial","buttonUrl":"/training/submit-testimonial"}',
 '{"bgColor":"#F0F4FF","textColor":"#0D2E5A","paddingY":"clamp(32px,5vw,56px)"}');

-- ═══════════════════════════════════════════════════════════════
-- FIX 3 — /modeling: add submit testimonial CTA
-- ═══════════════════════════════════════════════════════════════

-- Bump bottom CTA from 6→7
UPDATE page_sections SET display_order = 7
WHERE page_slug = 'modeling'
AND section_type = 'cta'
AND display_order = 6;

-- Insert submit testimonial CTA at order 6
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cta', 6, true,
 '{"heading":"Using the Modeling Hub? Share Your Experience","subtitle":"Your feedback helps other finance professionals and helps us build a better platform.","buttonText":"⭐ Submit Your Testimonial","buttonUrl":"/modeling/submit-testimonial"}',
 '{"bgColor":"#EEF2FF","textColor":"#0D2E5A","paddingY":"clamp(28px,4vw,48px)"}');

-- ═══════════════════════════════════════════════════════════════
-- FIX 4 — / home: update Two Pillars with complete content
-- ═══════════════════════════════════════════════════════════════

UPDATE page_sections
SET content = '{"heading":"Two Platforms. One Destination.","subtitle":"Modeling + Training — everything a financial professional needs in one place.","count":2,"columns":[{"heading":"Modeling Platform","html":"<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" style=\"margin-bottom:16px;display:block\"><rect x=\"4\" y=\"26\" width=\"10\" height=\"18\" rx=\"3\" fill=\"#1B4F8A\"/><rect x=\"19\" y=\"16\" width=\"10\" height=\"28\" rx=\"3\" fill=\"#1B4F8A\" fill-opacity=\"0.65\"/><rect x=\"34\" y=\"6\" width=\"10\" height=\"38\" rx=\"3\" fill=\"#1B4F8A\" fill-opacity=\"0.35\"/><line x1=\"2\" y1=\"46\" x2=\"46\" y2=\"46\" stroke=\"#1B4F8A\" stroke-width=\"2.5\" stroke-linecap=\"round\"/></svg><p style=\"font-size:14px;color:#4B5563;line-height:1.7;margin-bottom:24px\">Structured workflows that take you from project setup to investor-ready reports. All outputs link — change one assumption, everything updates.</p><ul style=\"list-style:none;padding:0;margin:0 0 28px;display:flex;flex-direction:column;gap:8px\"><li style=\"font-size:13px;color:#4B5563;display:flex;gap:8px;align-items:center\"><span style=\"color:#1B4F8A;font-weight:700\">→</span> Multi-discipline project structure</li><li style=\"font-size:13px;color:#4B5563;display:flex;gap:8px;align-items:center\"><span style=\"color:#1B4F8A;font-weight:700\">→</span> Debt & equity scheduling</li><li style=\"font-size:13px;color:#4B5563;display:flex;gap:8px;align-items:center\"><span style=\"color:#1B4F8A;font-weight:700\">→</span> IRR, NPV, and equity multiple</li><li style=\"font-size:13px;color:#4B5563;display:flex;gap:8px;align-items:center\"><span style=\"color:#1B4F8A;font-weight:700\">→</span> Excel & PDF export</li></ul>","buttonText":"Explore Modeling Hub →","buttonUrl":"/modeling","borderTopColor":"#1B4F8A","borderColor":"#C7D9F2"},{"heading":"Training Hub","html":"<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" style=\"margin-bottom:16px;display:block\"><path d=\"M24 10L6 20L24 30L42 20L24 10Z\" fill=\"#1A7A30\"/><path d=\"M13 25.5V35C13 35 17.5 40 24 40C30.5 40 35 35 35 35V25.5\" stroke=\"#1A7A30\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><line x1=\"42\" y1=\"20\" x2=\"42\" y2=\"32\" stroke=\"#1A7A30\" stroke-width=\"3\" stroke-linecap=\"round\"/><circle cx=\"42\" cy=\"33.5\" r=\"2.5\" fill=\"#1A7A30\"/></svg><p style=\"font-size:14px;color:#4B5563;line-height:1.7;margin-bottom:24px\">Free video courses taught by finance professionals. Learn the methodology behind the model — from first principles to advanced deal structuring.</p><ul style=\"list-style:none;padding:0;margin:0 0 28px;display:flex;flex-direction:column;gap:8px\"><li style=\"font-size:13px;color:#4B5563;display:flex;gap:8px;align-items:center\"><span style=\"color:#1A7A30;font-weight:700\">→</span> Always 100% free</li><li style=\"font-size:13px;color:#4B5563;display:flex;gap:8px;align-items:center\"><span style=\"color:#1A7A30;font-weight:700\">→</span> Real-world case studies</li><li style=\"font-size:13px;color:#4B5563;display:flex;gap:8px;align-items:center\"><span style=\"color:#1A7A30;font-weight:700\">→</span> GCC & international markets</li><li style=\"font-size:13px;color:#4B5563;display:flex;gap:8px;align-items:center\"><span style=\"color:#1A7A30;font-weight:700\">→</span> Certificate on completion</li></ul>","buttonText":"Browse Free Courses →","buttonUrl":"/training","borderTopColor":"#1A7A30","borderColor":"#C3E9CE"}]}'
WHERE page_slug = 'home'
AND section_type = 'columns'
AND display_order = 6;

-- ═══════════════════════════════════════════════════════════════
-- FIX 5 — /training-sessions: remove duplicate hero
-- SessionsClient already renders its own hero internally
-- ═══════════════════════════════════════════════════════════════

DELETE FROM page_sections
WHERE page_slug = 'training-sessions'
AND section_type = 'hero';
