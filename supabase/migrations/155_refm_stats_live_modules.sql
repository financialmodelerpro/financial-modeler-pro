-- 155_refm_stats_live_modules.sql
--
-- The public REFM page (page_slug 'modeling-real-estate') has a CMS 'stats'
-- section whose module stat reads "6 Modules". Five modules are now live, so the
-- stat should read "5 Live Modules". This surgically rewrites ONLY the module
-- stat item (matched by its label containing "module"): value -> '5',
-- label -> 'Live Modules'. Every other stat item (10+ Asset Classes, 100% Free,
-- Excel + PDF) is left exactly as is.
--
-- The stats section was authored in the admin Page Builder (it is not in the
-- 071 seed), so this UPDATEs whatever rows exist in page_sections. No-op if the
-- section is absent. Idempotent: the relabelled item still matches "module", so
-- a re-run lands on the same value.

UPDATE public.page_sections
   SET content = jsonb_set(
       content,
       '{items}',
       (
         SELECT jsonb_agg(
           CASE
             WHEN (elem->>'label') ILIKE '%module%'
               THEN jsonb_set(jsonb_set(elem, '{value}', '"5"'::jsonb), '{label}', '"Live Modules"'::jsonb)
             ELSE elem
           END
         )
         FROM jsonb_array_elements(content->'items') AS elem
       )
   )
 WHERE page_slug = 'modeling-real-estate'
   AND section_type = 'stats'
   AND content ? 'items'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(content->'items') AS e
     WHERE (e->>'label') ILIKE '%module%'
   );
