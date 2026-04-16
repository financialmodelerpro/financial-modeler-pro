'use client';

import type { SessionProgress } from './types';

export function StatusBadge({ locked, prog, isWatched, isInProgress }: { locked: boolean; prog: SessionProgress | undefined; isWatched?: boolean; isInProgress?: boolean }) {
  if (locked) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', whiteSpace: 'nowrap' }}>
      🔒 Locked
    </span>
  );
  // Check passed first — a passed session must always show Passed regardless of attempts count
  if (prog?.passed) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0', whiteSpace: 'nowrap' }}>
      ✓ Passed — {prog.score}%
    </span>
  );
  if (prog && prog.attempts > 0) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA', whiteSpace: 'nowrap' }}>
      Attempted — {prog.score}%
    </span>
  );
  if (isWatched || isInProgress) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', whiteSpace: 'nowrap' }}>
      ▶ In Progress
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB', whiteSpace: 'nowrap' }}>
      Not Started
    </span>
  );
}
