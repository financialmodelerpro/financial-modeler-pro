-- 085: Update training-sessions nav link to point to learn subdomain
UPDATE site_pages
SET href = 'https://learn.financialmodelerpro.com/training-sessions'
WHERE href = '/training-sessions'
   OR href LIKE '%/training-sessions';
