-- ============================================================
-- 110: Normalize student_certificates.cert_status
--
-- A prior commit (force-issue) wrote cert_status='Forced' for admin-
-- overridden issuances. Downstream code (app/verify/[uuid]/page.tsx,
-- legacy dashboards) only recognises cert_status='Issued', so those
-- certs were invisible despite the row existing with all URLs populated.
--
-- Provenance is now tracked exclusively via `issued_via` + `issued_by_admin`
-- (columns added in migration 109). This migration rewrites legacy
-- 'Forced' rows to 'Issued' so they surface on the verify page + dashboard.
-- ============================================================

UPDATE student_certificates
SET cert_status = 'Issued',
    issued_via  = COALESCE(issued_via, 'forced')
WHERE cert_status = 'Forced';
