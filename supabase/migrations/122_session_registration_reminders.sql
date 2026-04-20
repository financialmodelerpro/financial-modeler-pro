# Fix Upcoming Session Card Width on Dashboard

Read CLAUDE.md before starting.

AUTONOMY: Complete end to end.

On student dashboard, upcoming session cards stretch to full width when only 1 session, split in half when 2, correct size only when 3. All cards should be fixed width regardless of count.

Fix the grid layout: use fixed-width columns (3 slots) instead of auto-fit/auto-fill. Empty slots can stay empty or show placeholder. Cards stay consistent 1/3 width on wide screens, 1/2 on tablet, full on mobile.

Example CSS:
- Desktop: grid-template-columns: repeat(3, 1fr)
- Tablet: grid-template-columns: repeat(2, 1fr)
- Mobile: grid-template-columns: 1fr

Or use max-width on cards instead of stretching.

Apply to the Upcoming Sessions section on dashboard (not the standalone Live Sessions page).