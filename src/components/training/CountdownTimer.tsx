'use client';

import { useState, useEffect, useRef } from 'react';
import { getTimerStatus, formatCountdown } from '@/src/lib/training/videoTimer';

interface Props {
  regId: string;
  tabKey: string;
  durationMinutes: number;
  onExpired: () => void;
  timerBypassed?: boolean;
}

export function CountdownTimer({ regId, tabKey, durationMinutes, onExpired, timerBypassed }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(durationMinutes * 60);

  const onExpiredRef = useRef(onExpired);
  useEffect(() => { onExpiredRef.current = onExpired; });

  useEffect(() => {
    function check() {
      const status = getTimerStatus(regId, tabKey, durationMinutes, timerBypassed);
      if (!status.locked) {
        onExpiredRef.current();
        return;
      }
      setSecondsLeft(status.secondsRemaining);
    }

    check(); // sync immediately on mount / prop change
    const id = setInterval(check, 1_000); // tick every second
    return () => clearInterval(id);
  }, [regId, tabKey, durationMinutes, timerBypassed]);

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
      ⏱ {formatCountdown(secondsLeft)}
    </span>
  );
}
