-- Rename "Training Academy" → "Training Hub" in site_pages nav
UPDATE site_pages
SET label = 'Training Hub'
WHERE label = 'Training Academy';
