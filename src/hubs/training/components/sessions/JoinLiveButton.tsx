'use client';

/**
 * THE Join live button, used by the session detail page, the dashboard card
 * and the course page. The server decides access and the window
 * (sessionAccess.ts); this re-checks the window every 20 seconds so the button
 * opens on time without a reload, and always links the logged join route,
 * which opens Teams in a new tab.
 */
import { useEffect, useState } from 'react';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import { joinStateAt } from '@/src/hubs/training/lib/liveCourse/joinWindow';

export interface JoinLiveButtonProps {
  /** The logged join route; null when the student has no access or there is no link. */
  joinUrl: string | null;
  joinOpensAt: string | null;
  joinClosesAt: string | null;
  size?: 'sm' | 'md';
  label?: string;
}

export function JoinLiveButton({ joinUrl, joinOpensAt, joinClosesAt, size = 'md', label = 'Join live' }: JoinLiveButtonProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  if (!joinUrl) return null;
  const state = joinStateAt(now, joinOpensAt && joinClosesAt ? { opensAt: joinOpensAt, closesAt: joinClosesAt, startsAt: joinOpensAt } : null);
  const pad = size === 'sm' ? '8px 16px' : '10px 22px';
  const font = size === 'sm' ? 13 : 14;

  if (state === 'open') {
    return (
      <a
        data-testid="join-live"
        href={joinUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: pad, borderRadius: 8, background: '#DC2626', color: '#fff', fontSize: font, fontWeight: 800, textDecoration: 'none', boxShadow: '0 2px 8px rgba(220,38,38,0.3)' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 4, background: '#fff', display: 'inline-block' }} /> {label} →
      </a>
    );
  }
  const text = state === 'before'
    ? `Join opens ${formatSessionTime(joinOpensAt)}`
    : state === 'ended' ? 'Session ended' : 'Time to be announced';
  return (
    <span data-testid="join-live-closed" data-state={state} style={{ display: 'inline-block', padding: pad, borderRadius: 8, background: '#F1F3F5', color: '#5A6675', fontSize: font - 1, fontWeight: 600 }}>
      {text}
    </span>
  );
}
