-- 226_campaign_seed_button.sql
--
-- Fixes the seeded walkthrough template's call to action, after the first real
-- campaign shipped with "Book your walkthrough" as unclickable plain text.
--
-- WHAT HAPPENED: the seed carried a hand-written anchor,
--   <a href="{{meeting_link}}">Book your walkthrough</a>
-- and the meeting link was left blank, so it merged to href="" which mail
-- clients render as ordinary text. The link markup was fine; the URL was
-- missing, and nothing stopped an empty one being sent.
--
-- TWO FIXES, and this migration is only the second of them:
--   1. In code (src/shared/email/campaigns.ts): the meeting link now falls
--      back to DEFAULT_MEETING_LINK (the /book-a-meeting page), so a blank
--      field can never produce an empty href again.
--   2. Here: the seed's hand-written anchor becomes {{meeting_button}}, a new
--      merge field that renders through the SHARED button() helper, so the CTA
--      is a real styled button and its styling lives in one place rather than
--      in template HTML.
--
-- GUARDED so an admin's own edit is never overwritten: it rewrites the row
-- ONLY where the body still contains the exact original anchor. A template
-- somebody has already changed is left completely alone, and re-running is a
-- no-op. Content only; no schema change.

UPDATE admin_campaign_templates
SET body_html = replace(
      body_html,
      '<p><a href="{{meeting_link}}">Book your walkthrough</a></p>',
      '{{meeting_button}}'
    ),
    description = 'Offers a guided platform walkthrough. Uses {{name}}, {{company_clause}} and {{meeting_button}}, which renders the booking link as a button.',
    updated_at = now()
WHERE is_seed = true
  AND body_html LIKE '%<p><a href="{{meeting_link}}">Book your walkthrough</a></p>%';
