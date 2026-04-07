-- ============================================================
-- 031: Seed page_sections with content from existing pages
-- Migrates hardcoded arrays/text into CMS-editable sections
-- ============================================================

-- ── About Page ───────────────────────────────────────────────────────────────

INSERT INTO page_sections (page_slug, section_type, display_order, content, styles) VALUES
-- Hero
('about', 'hero', 0,
 '{"badge":"About Us","headline":"Building the Future of Financial Modeling","subtitle":"Financial Modeler Pro is a multi-discipline modeling, training, and certification platform designed for finance professionals worldwide.","cta1Text":"Explore Platforms →","cta1Url":"/modeling","cta2Text":"Start Free Training →","cta2Url":"/training"}',
 '{}'),

-- Mission
('about', 'rich_text', 1,
 '{"badge":"Our Mission","heading":"What is Financial Modeler Pro?","html":"<p>Financial Modeler Pro (FMP) is a comprehensive platform that combines <strong>interactive financial modeling tools</strong>, <strong>free professional training</strong>, and <strong>verifiable certifications</strong> — all in one ecosystem.</p><p>Whether you are a student learning the fundamentals or a seasoned analyst building complex models, FMP provides the tools, education, and credentials you need to advance your career in finance.</p>"}',
 '{"bgColor":"#F5F7FA"}'),

-- Who We Serve
('about', 'cards', 2,
 '{"badge":"Who We Serve","heading":"Built for Finance Professionals","cards":[{"icon":"🎓","title":"Students & Graduates","description":"Learn financial modeling from scratch with structured, free courses and earn professional certifications."},{"icon":"💼","title":"Working Professionals","description":"Enhance your modeling skills with real-world tools used across investment banking, FP&A, and corporate finance."},{"icon":"🏢","title":"Organizations","description":"Equip your team with standardized modeling platforms and track progress through our training hub."},{"icon":"📊","title":"Analysts & Associates","description":"Build, audit, and present financial models using professional-grade interactive tools."},{"icon":"🌍","title":"Global Learners","description":"Access all courses and tools from anywhere — no fees, no barriers, no limitations."},{"icon":"🔬","title":"Researchers & Academics","description":"Use our modeling frameworks for academic research, case studies, and financial analysis."}]}',
 '{}'),

-- CTA
('about', 'cta', 3,
 '{"heading":"Ready to Get Started?","subtitle":"Join thousands of finance professionals using Financial Modeler Pro.","buttonText":"Start Free Training →","buttonUrl":"/training","button2Text":"Explore Modeling Hub →","button2Url":"/modeling"}',
 '{}')
ON CONFLICT DO NOTHING;

-- ── Contact Page ─────────────────────────────────────────────────────────────

INSERT INTO page_sections (page_slug, section_type, display_order, content, styles) VALUES
('contact', 'hero', 0,
 '{"badge":"Reach Out","headline":"Get in Touch","subtitle":"Have a question, partnership inquiry, or feedback? We would love to hear from you.","cta1Text":"","cta1Url":""}',
 '{}')
ON CONFLICT DO NOTHING;

-- ── Training Landing Page ────────────────────────────────────────────────────

INSERT INTO page_sections (page_slug, section_type, display_order, content, styles) VALUES
-- How It Works steps
('training', 'list', 0,
 '{"badge":"The Process","heading":"How It Works","layout":"horizontal","items":[{"icon":"📝","title":"Register Free","description":"Create your free training account in seconds"},{"icon":"▶️","title":"Watch on YouTube","description":"Stream all sessions free on YouTube"},{"icon":"✍️","title":"Take Assessment","description":"Complete the quiz at the end of each session"},{"icon":"✅","title":"Pass Sessions","description":"Score 70%+ to unlock the next session"},{"icon":"🏆","title":"Get Certified","description":"Pass the final exam and receive your certificate"}]}',
 '{"bgColor":"#F5F7FA"}'),

-- Why Get Certified
('training', 'cards', 1,
 '{"badge":"Why Certify","heading":"Why Get Certified?","cards":[{"icon":"🎓","title":"Verifiable Certificate","description":"Each certificate has a unique ID that employers can verify instantly online."},{"icon":"💼","title":"LinkedIn Badge","description":"Add your certificate directly to your LinkedIn profile with one click."},{"icon":"📊","title":"Proof of Competence","description":"Demonstrate real, assessed financial modeling skills — not just course completion."},{"icon":"🆓","title":"Always Free","description":"No fees, no subscriptions, no paywalls. Every course and certificate is 100% free."}]}',
 '{}')
ON CONFLICT DO NOTHING;

-- ── Modeling Landing Page ────────────────────────────────────────────────────

INSERT INTO page_sections (page_slug, section_type, display_order, content, styles) VALUES
-- Who Uses FMP
('modeling', 'cards', 0,
 '{"badge":"The Audience","heading":"Who Uses Financial Modeler Pro?","cards":[{"icon":"🏦","title":"Investment Banking","description":"Build LBO, DCF, and merger models with institutional-grade tools."},{"icon":"📊","title":"FP&A Teams","description":"Forecast revenue, model scenarios, and present to leadership."},{"icon":"🏗️","title":"Real Estate","description":"Develop pro formas, sensitivity tables, and return analyses."},{"icon":"🎓","title":"Students","description":"Learn modeling fundamentals with guided, structured tools."},{"icon":"🔬","title":"Equity Research","description":"Build comparable company analyses and valuation models."},{"icon":"💰","title":"Private Equity","description":"Model fund returns, carry waterfalls, and portfolio analytics."}]}',
 '{}'),

-- Why FMP
('modeling', 'columns', 1,
 '{"badge":"Why FMP","heading":"Why Financial Modeler Pro?","columns":[{"icon":"🚀","heading":"Built for Speed","html":"Go from blank model to full output in minutes with guided, structured modules."},{"icon":"🔒","heading":"Institutional Grade","html":"The same rigor and methodology used in top-tier financial institutions."},{"icon":"📱","heading":"Accessible Anywhere","html":"Browser-based platform — no installations, no compatibility issues."},{"icon":"🆓","heading":"Free Forever","html":"Core platform and training are always free. No hidden costs."}],"count":4}',
 '{"bgColor":"#F5F7FA"}')
ON CONFLICT DO NOTHING;
