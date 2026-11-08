'use client';

/** A course's status as a badge: Draft, Published (or "Enrolment closed"), Archived. */
export function StatusBadge({ status, enrolmentOpen = true }: { status: 'draft' | 'published' | 'archived'; enrolmentOpen?: boolean }) {
  const s = status === 'published'
    ? (enrolmentOpen ? { bg: '#E7F4EC', fg: '#2E7D52', text: 'Published' } : { bg: '#FFF4E5', fg: '#9A5B00', text: 'Published · Enrolment closed' })
    : status === 'archived' ? { bg: '#F1F3F5', fg: '#5A6675', text: 'Archived' }
    : { bg: '#EEF2FF', fg: '#3730A3', text: 'Draft' };
  return (
    <span data-testid="course-status-badge" style={{ background: s.bg, color: s.fg, padding: '3px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
      {s.text}
    </span>
  );
}
