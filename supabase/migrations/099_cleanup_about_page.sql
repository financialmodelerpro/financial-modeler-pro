-- ============================================================================
-- Migration 099 — Drop legacy /about page sections
-- ----------------------------------------------------------------------------
-- The standalone /about page has been removed in favour of /about/ahmad-din
-- (the founder profile). Its page_sections rows and cms_pages entry are no
-- longer read by any route. This migration cleans up the orphan data.
--
-- Also updates site_pages navigation entry (if present) to point at the
-- founder profile instead of the deleted /about path. Safe to re-run.
-- ============================================================================

-- Remove all content sections seeded for the about page
DELETE FROM page_sections WHERE page_slug = 'about';

-- Remove the page metadata row
DELETE FROM cms_pages WHERE slug = 'about';

-- Repoint any surviving "About" navigation entry at the founder profile
UPDATE site_pages
SET    href = '/about/ahmad-din'
WHERE  href = '/about';
