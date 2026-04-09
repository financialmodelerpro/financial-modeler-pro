-- Migration 039: Add "Training Sessions" link to main navigation
-- Positioned after "Training Hub" (display_order 3) and before "Articles" (display_order 4)
-- Uses display_order 3.5 to slot between existing items without re-ordering

INSERT INTO site_pages (label, href, visible, display_order, can_toggle)
VALUES ('Training Sessions', '/training-sessions', true, 3.5, true)
ON CONFLICT DO NOTHING;
