-- 025: Testimonial hub routing + landing page selection + CTA visibility CMS keys

-- ── testimonials table ────────────────────────────────────────────────────────
alter table testimonials
  add column if not exists hub           text    not null default 'modeling',
  add column if not exists show_on_landing boolean not null default true;

-- ── student_testimonials table ────────────────────────────────────────────────
alter table student_testimonials
  add column if not exists hub           text    not null default 'training',
  add column if not exists show_on_landing boolean not null default false;

-- ── CMS visibility toggles ───────────────────────────────────────────────────
insert into cms_content (section, key, value) values
  ('hero',         'cta_visible',     'true'),
  ('cta',          'section_visible', 'true')
on conflict (section, key) do nothing;

-- ── Section style overrides (stored as JSON per section) ─────────────────────
-- headingSize, headingColor, subheadingSize, subheadingColor, paddingY
insert into cms_content (section, key, value) values
  ('section_styles', 'hero',          '{}'),
  ('section_styles', 'stats',         '{}'),
  ('section_styles', 'about',         '{}'),
  ('section_styles', 'pillars',       '{}'),
  ('section_styles', 'founder',       '{}'),
  ('section_styles', 'articles',      '{}'),
  ('section_styles', 'testimonials',  '{}'),
  ('section_styles', 'pricing',       '{}'),
  ('section_styles', 'cta',           '{}')
on conflict (section, key) do nothing;
