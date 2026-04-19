-- ============================================================
-- 113: Move verification URLs from main domain → learn. subdomain
--
-- /verify/:id is served by the same Next page on both subdomains, but the
-- canonical URL for student-facing shares + QR codes is learn.*. Rewrite
-- every stored verification_url so new shares + the OG image endpoint
-- (which reads verification_url) carry the correct host.
-- ============================================================

UPDATE student_certificates
SET verification_url = REPLACE(
  verification_url,
  'https://financialmodelerpro.com/verify/',
  'https://learn.financialmodelerpro.com/verify/'
)
WHERE verification_url LIKE 'https://financialmodelerpro.com/verify/%';

-- Http variants (defensive — rare, but possible in old envs).
UPDATE student_certificates
SET verification_url = REPLACE(
  verification_url,
  'http://financialmodelerpro.com/verify/',
  'https://learn.financialmodelerpro.com/verify/'
)
WHERE verification_url LIKE 'http://financialmodelerpro.com/verify/%';
