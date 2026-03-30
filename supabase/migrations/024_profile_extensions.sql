-- 024 Profile extensions: display_name, avatar_url on student_profiles
-- + CMS key for "Share Your Achievement" text (FIX 7)

-- ── student_profiles extra columns ───────────────────────────────────────────
alter table student_profiles
  add column if not exists display_name text,
  add column if not exists avatar_url   text;

-- ── CMS content key: share_achievement_text ───────────────────────────────────
insert into cms_content (section, key, value) values
  ('training', 'share_achievement_text', 'Share Your Achievement')
on conflict (section, key) do nothing;
