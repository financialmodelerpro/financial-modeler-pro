'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target, Eye, CheckCircle2, Award } from 'lucide-react';
import { LiveSessionCardLarge } from './LiveSessionCardLarge';
import { RecordedLiveSessionRow } from './RecordedLiveSessionRow';
import type {
  LiveSession,
  RegistrationStatus,
  WatchHistoryEntry,
} from '@/src/lib/training/liveSessionsForStudent';

const NAVY = '#0D2E5A';
const TEAL = '#14B8A6';
const ORANGE = '#EA580C';
const GREEN = '#2EAA4A';
const GOLD = '#F5B942';

interface AttemptSummaryMap {
  [sessionId: string]: { attempts: number; maxAttempts: number; passed: boolean; bestScore: number };
}

interface AttemptRow {
  session_id: string;
  score: number;
  passed: boolean;
}

interface Props {
  studentEmail: string;
  studentName?: string;
  registrationId?: string;
  /** When true, renders the full page header (eyebrow + h1 + subtitle). When
   *  false, the caller provides its own heading (e.g. the dashboard tab already
   *  renders its own title elsewhere). Defaults to true. */
  showHeader?: boolean;
  /** Max width of the content block. Defaults to 1240px. */
  maxWidth?: number;
}

const kpiCard = (icon: React.ReactNode, label: string, value: number | string, accent: string): React.ReactElement => (
  <div style={{
    background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB',
    padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  }}>
    <div style={{
      width: 38, height: 38, borderRadius: 10,
      background: `${accent}15`, color: accent,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{icon}</div>
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, lineHeight: 1 }}>{value}</div>
    </div>
  </div>
);

export function LiveSessionsPanel({ studentEmail, studentName = '', registrationId = '', showHeader = true, maxWidth = 1240 }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [upcoming, setUpcoming] = useState<LiveSession[]>([]);
  const [recorded, setRecorded] = useState<LiveSession[]>([]);
  const [regStatus, setRegStatus] = useState<Record<string, RegistrationStatus>>({});
  const [watchMap, setWatchMap] = useState<Record<string, WatchHistoryEntry>>({});
  const [attemptMap, setAttemptMap] = useState<AttemptSummaryMap>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [upRes, recRes, watchRes] = await Promise.all([
          fetch('/api/training/live-sessions?type=upcoming').then(r => r.json() as Promise<{ sessions?: LiveSession[] }>),
          fetch('/api/training/live-sessions?type=recorded').then(r => r.json() as Promise<{ sessions?: LiveSession[] }>),
          fetch(`/api/training/watch-history?email=${encodeURIComponent(studentEmail)}`).then(r => r.json() as Promise<{ history?: WatchHistoryEntry[] }>),
        ]);

        // Upcoming: soonest first; Recorded: oldest-recording first (release order).
        const upList = (upRes.sessions ?? []).slice().sort((a, b) => {
          const da = a.scheduled_datetime ? new Date(a.scheduled_datetime).getTime() : Infinity;
          const db = b.scheduled_datetime ? new Date(b.scheduled_datetime).getTime() : Infinity;
          return da - db;
        });
        const recList = (recRes.sessions ?? []).slice().sort((a, b) => {
          const da = a.scheduled_datetime ? new Date(a.scheduled_datetime).getTime() : 0;
          const db = b.scheduled_datetime ? new Date(b.scheduled_datetime).getTime() : 0;
          return da - db;
        });

        const ids = [...upList.map(s => s.id), ...recList.map(s => s.id)];
        let regs: Record<string, RegistrationStatus> = {};
        if (ids.length > 0) {
          try {
            const r = await fetch('/api/training/live-sessions/registration-status-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionIds: ids, email: studentEmail }),
            });
            const d = await r.json() as { registrations?: Record<string, RegistrationStatus> };
            regs = d.registrations ?? {};
          } catch { /* ignore */ }
        }

        const watch: Record<string, WatchHistoryEntry> = {};
        for (const w of watchRes.history ?? []) watch[w.session_id] = w;

        // Assessment summary — only for recorded sessions that have one.
        const assessmentSessions = recList.filter(s => (s as LiveSession & { has_assessment?: boolean }).has_assessment);
        const summary: AttemptSummaryMap = {};
        await Promise.all(assessmentSessions.map(async s => {
          try {
            const [ar, cr] = await Promise.all([
              fetch(`/api/training/live-sessions/${s.id}/attempts`).then(r => r.json() as Promise<{ attempts?: AttemptRow[] }>),
              fetch(`/api/training/live-sessions/${s.id}/assessment`).then(r => r.json() as Promise<{ assessment?: { max_attempts?: number } | null }>),
            ]);
            const attempts = ar.attempts ?? [];
            const maxAttempts = cr.assessment?.max_attempts ?? 3;
            const bestScore = attempts.reduce((m, a) => Math.max(m, a.score), 0);
            summary[s.id] = {
              attempts: attempts.length,
              maxAttempts,
              passed: attempts.some(a => a.passed),
              bestScore,
            };
          } catch { /* per-session */ }
        }));

        if (cancelled) return;
        setUpcoming(upList);
        setRecorded(recList);
        setRegStatus(regs);
        setWatchMap(watch);
        setAttemptMap(summary);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [studentEmail]);

  const stats = useMemo(() => {
    const started = Object.values(watchMap).length;
    const watched = Object.values(watchMap).filter(w => w.status === 'completed' || (w.watch_percentage ?? 0) >= 70).length;
    const achievements = Object.values(attemptMap).filter(a => a.passed).length + watched;
    return { upcoming: upcoming.length, started, watched, achievements };
  }, [watchMap, attemptMap, upcoming.length]);

  return (
    <div style={{ maxWidth, margin: '0 auto', fontFamily: "'Inter', sans-serif" }}>
      {showHeader && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TEAL, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
            Live Sessions
          </div>
          <h1 style={{ fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 800, color: NAVY, margin: 0, letterSpacing: '-0.01em' }}>
            FMP Real-World Financial Modeling
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', margin: '6px 0 0' }}>
            Live sessions and recorded content
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
        {kpiCard(<Target size={18} />, 'Upcoming', stats.upcoming, ORANGE)}
        {kpiCard(<Eye size={18} />, 'Started', stats.started, TEAL)}
        {kpiCard(<CheckCircle2 size={18} />, 'Watched', stats.watched, GREEN)}
        {kpiCard(<Award size={18} />, 'Achievement Cards', stats.achievements, GOLD)}
      </div>

      {!loaded && (
        <div style={{ padding: 60, textAlign: 'center', color: '#6B7280' }}>Loading sessions…</div>
      )}

      {loaded && upcoming.length === 0 && recorded.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center', color: '#6B7280', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>
          No sessions published yet. Check back soon.
        </div>
      )}

      {loaded && upcoming.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: NAVY, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            Upcoming Sessions
            <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>({upcoming.length})</span>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {upcoming.map(s => (
              <LiveSessionCardLarge
                key={s.id}
                variant="upcoming"
                session={s}
                reg={regStatus[s.id]}
                href={`/training/live-sessions/${s.id}`}
                studentEmail={studentEmail}
                studentName={studentName}
                registrationId={registrationId}
              />
            ))}
          </div>
        </section>
      )}

      {loaded && recorded.length > 0 && (
        <section>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: NAVY, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            Recorded Sessions
            <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>({recorded.length})</span>
          </h2>
          <div>
            {recorded.map((s, i) => (
              <RecordedLiveSessionRow
                key={s.id}
                idx={i}
                session={s}
                studentEmail={studentEmail}
                studentName={studentName}
                registrationId={registrationId}
                watch={watchMap[s.id]}
                attempt={attemptMap[s.id] ?? null}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
