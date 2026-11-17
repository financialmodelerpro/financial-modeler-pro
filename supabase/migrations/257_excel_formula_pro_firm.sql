-- ═══════════════════════════════════════════════════════════════════════════════
-- 257: the live (formula-linked) Excel workbook opens to Pro and Firm as a Beta
-- (founder, 2026-11-17)
-- ═══════════════════════════════════════════════════════════════════════════════
-- The live workbook download is gated by featureAllowed(gate, 'excel_formula')
-- (lib/excel/formulaExportAccess.ts); the one-account preview list is deleted.
-- excel_formula has been included: false on every plan since mig 161 (it was
-- never sold), so this opens it on pro and firm and nowhere else:
--   - trial: stays excluded (founder: "Trial excluded");
--   - solo:  stays excluded (founder: "Pro and Firm only").
-- The values workbook (excel_snapshot) is untouched for every plan.
--
-- Measured before writing (2026-11-17, service role read): plan_permissions
-- holds an excel_formula row for trial, solo, pro and firm, each included false.
-- An UPDATE of the two rows is therefore enough; the INSERT guard covers a
-- database where a row is missing.
--
-- Idempotent: safe to run twice.

UPDATE public.plan_permissions
   SET included = true, updated_at = now()
 WHERE feature_key = 'excel_formula'
   AND plan_key IN ('pro', 'firm')
   AND included IS DISTINCT FROM true;

INSERT INTO public.plan_permissions (plan_key, feature_key, included)
SELECT p.plan_key, 'excel_formula', true
  FROM (VALUES ('pro'), ('firm')) AS p(plan_key)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.plan_permissions pp
    WHERE pp.plan_key = p.plan_key AND pp.feature_key = 'excel_formula'
 );
