'use client';

/**
 * THE Join live button, used by the session detail page, the dashboard card
 * and the course page. The server decides access and the window
 * (sessionAccess.ts); this re-checks the window every 20 seconds so the button
 * opens on time without a reload, and always links the logged join route,
 * which opens Teams in a new tab.
 *
 * Before Teams opens (2026-11-10) it shows a short note with the student's
 * full name as registered: a student without a Microsoft account joins as a
 * guest, and the attendance report then carries only the name they type, which
 * the sync matches against the students who clicked Join (nameMatch.ts).
 * Continue opens Teams; the name comes from `studentName` when the page has it,
 * else from /api/training/registered-name.
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
  /** The student's full name as registered, when the page already has it. */
  studentName?: string | null;
}

/** The note's wording, one place (the verifier reads it). */
export function joinNameNote(name: string): string {
  return name
    ? `When Teams asks for your name, type your full name as registered: ${name}`
    : 'When Teams asks for your name, type your full name as registered on your account.';
}

export function JoinLiveButton({ joinUrl, joinOpensAt, joinClosesAt, size = 'md', label = 'Join live', studentName }: JoinLiveButtonProps) {
  const [now, setNow] = useState(() => Date.now());
  const [noteOpen, setNoteOpen] = useState(false);
  const [fetchedName, setFetchedName] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  // The name is fetched once, only when the note opens and the page did not pass it.
  useEffect(() => {
    if (!noteOpen || studentName != null || fetchedName != null) return;
    let cancelled = false;
    fetch('/api/training/registered-name').then((r) => (r.ok ? r.json() : { name: '' })).then((j: { name?: string }) => { if (!cancelled) setFetchedName(j.name ?? ''); }).catch(() => { if (!cancelled) setFetchedName(''); });
    return () => { cancelled = true; };
  }, [noteOpen, studentName, fetchedName]);

  if (!joinUrl) return null;
  const state = joinStateAt(now, joinOpensAt && joinClosesAt ? { opensAt: joinOpensAt, closesAt: joinClosesAt, startsAt: joinOpensAt } : null);
  const pad = size === 'sm' ? '8px 16px' : '10px 22px';
  const font = size === 'sm' ? 13 : 14;
  const name = (studentName ?? fetchedName ?? '').trim();
  const nameLoading = studentName == null && fetchedName == null;

  if (state === 'open') {
    return (
      <span style={{ display: 'inline-block', position: 'relative' }}>
        <button
          type="button"
          data-testid="join-live"
          onClick={() => setNoteOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: pad, borderRadius: 8, background: '#DC2626', color: '#fff', fontSize: font, fontWeight: 800, border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(220,38,38,0.3)' }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#fff', display: 'inline-block' }} /> {label} →
        </button>
        {noteOpen && (
          <div role="dialog" aria-modal="true" aria-label="Before you join" data-testid="join-name-note" onClick={() => setNoteOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(13,46,90,0.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '22px 22px 18px', maxWidth: 440, width: '100%', boxShadow: '0 16px 40px rgba(13,46,90,0.25)', color: '#2A3440' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0D2E5A', marginBottom: 8 }}>Before you join</div>
              <p data-testid="join-name-text" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6 }}>
                {nameLoading ? 'Loading your registered name…' : name
                  ? <>When Teams asks for your name, type your full name as registered: <strong data-testid="join-name-value" style={{ color: '#0D2E5A' }}>{name}</strong></>
                  : joinNameNote('')}
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#5A6675', lineHeight: 1.5 }}>This is how your attendance is matched to your account.</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setNoteOpen(false)} style={{ background: '#fff', border: '1px solid #DDE7F3', color: '#5A6675', borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>Cancel</button>
                <a data-testid="join-name-continue" href={joinUrl} target="_blank" rel="noopener noreferrer" onClick={() => setNoteOpen(false)}
                  style={{ background: '#DC2626', color: '#fff', borderRadius: 8, padding: '9px 18px', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' }}>Continue to Teams →</a>
              </div>
            </div>
          </div>
        )}
      </span>
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
