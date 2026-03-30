'use client';

import { useState, useEffect, useRef } from 'react';
import { getTimerStatus, formatCountdown } from '@/src/lib/videoTimer';

interface Props {
  regId: string;
  tabKey: string;
  durationMinutes: number;
  onExpired: () => void;
}

export function CountdownTimer({ regId, tabKey, durationMinutes, onExpired }: Props) {
  const [minutesLeft, setMinutesLeft] = useState(durationMinutes);

  // Keep onExpired stable so the interval effect never re-runs due to a new fn ref
  const onExpiredRef = useRef(onExpired);
  useEffect(() => { onExpiredRef.current = onExpired; });

  useEffect(() => {
    function check() {
      const status = getTimerStatus(regId, tabKey, durationMinutes);
      if (!status.locked) {
        onExpiredRef.current();
        return;
      }
      setMinutesLeft(status.minutesRemaining);
    }

    check(); // sync immediately on mount / prop change
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [regId, tabKey, durationMinutes]);

  return (
    <span
      title="Assessment unlocks after watching the full video"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
        background: '#FEF3C7', color: '#B45309', whiteSpace: 'nowrap',
        cursor: 'default', border: '1px solid #FDE68A',
      }}
    >
      ⏱ {formatCountdown(minutesLeft)}
    </span>
  );
}
