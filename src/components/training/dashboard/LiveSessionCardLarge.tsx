'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, Clock, User, Play, CheckCircle2, Radio, Share2, Download as DownloadIcon, Award, Lock, FileText } from 'lucide-react';
import { downloadIcs } from '@/src/lib/training/calendar';
import { ShareModal } from '@/src/components/training/share/ShareModal';
import type { LiveSession, RegistrationStatus, WatchHistoryEntry } from '@/src/lib/training/liveSessionsForStudent';

const NAVY = '#0D2E5A';
const TEAL = '#14B8A6';
const TEAL_DARK = '#0F766E';
const GREEN = '#2EAA4A';
const RED = '#DC2626';
const ORANGE = '#EA580C';
const GOLD = '#F5B942';
const AMBER_BG = '#FFFBEB';
const GREEN_BG = '#F0FFF4';

interface AttemptSummary {
  attempts: number;
  maxAttempts: number;
  passed: boolean;
  bestScore: number;
}

interface CommonProps {
  session: LiveSession & { has_assessment?: boolean };
  href: string;
  studentName?: string;
  studentEmail: string;
  registrationId?: string;
}

interface UpcomingProps extends CommonProps {
  variant: 'upcoming';
  reg?: RegistrationStatus;
}

interface RecordedProps extends CommonProps {
  variant: 'recorded';
  watch?: WatchHistoryEntry;
  attemptSummary?: AttemptSummary | null;
  watchThreshold?: number;
}

type Props = UpcomingProps | RecordedProps;

function formatDateTime(iso?: string | null): string {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Date TBD';
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${weekday}, ${datePart} at ${timePart}`;
}

function formatDateShort(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function minutesUntil(iso?: string | null): number {
  if (!iso) return Infinity;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return Infinity;
  return Math.round((d.getTime() - Date.now()) / 60000);
}

// Matches 3SFM SessionCard tokens: 8px radius, 4px border-left, 14-18px padding,
// soft shadow, tinted background for state (white / green-bg if passed / amber
// if in-progress).
const wrapperBase: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid #E5E7EB',
  background: '#fff',
  padding: 0,
  marginBottom: 12,
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  overflow: 'hidden',
  position: 'relative',
  transition: 'box-shadow 0.2s, transform 0.2s',
  display: 'flex',
  flexDirection: 'column',
};

const bannerStyle = (url?: string | null): React.CSSProperties => ({
  height: 120,
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: url
    ? `url(${url}) center/cover no-repeat`
    : `linear-gradient(135deg, ${NAVY}, #1B4F8A)`,
});

const badge = (bg: string, color: string): React.CSSProperties => ({
  position: 'absolute', top: 10, left: 10,
  fontSize: 10, fontWeight: 800,
  padding: '4px 10px', borderRadius: 6,
  background: bg, color,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  display: 'inline-flex', alignItems: 'center', gap: 5,
});

const bodyStyle: React.CSSProperties = {
  padding: '14px 16px 16px',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
};

const titleStyle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: NAVY,
  marginBottom: 10, lineHeight: 1.35,
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
};

const metaRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 12, color: '#4B5563',
  marginBottom: 6, lineHeight: 1.4,
};

const primaryBtn = (bg: string, color = '#fff'): React.CSSProperties => ({
  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '9px 14px', borderRadius: 8,
  background: bg, color,
  fontWeight: 700, fontSize: 12.5, textDecoration: 'none',
  border: 'none', cursor: 'pointer',
});

const iconBtn = (accent: string): React.CSSProperties => ({
  width: 34, height: 34, borderRadius: 8,
  border: `1px solid ${accent}`,
  background: '#fff', color: accent,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', flexShrink: 0,
});

const chip = (bg: string, color: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '4px 10px', borderRadius: 999,
  fontSize: 11, fontWeight: 700,
  background: bg, color,
  letterSpacing: '0.02em',
});

function achievementCardUrl(session: Props['session'], studentName?: string, regId?: string, score?: number, dateIso?: string | null): string {
  const params = new URLSearchParams({
    session: session.title,
    score: score != null ? String(score) : 'Completed',
    date: dateIso ? new Date(dateIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    course: 'FMP Real-World Financial Modeling',
    name: studentName ?? '',
    regId: regId ?? '',
  });
  return `/api/training/achievement-image?${params.toString()}`;
}

export function LiveSessionCardLarge(props: Props) {
  const { session, href } = props;
  const [hover, setHover] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  // Status color accent on the left border
  let accentColor = '#E5E7EB';
  let accentBg = '#fff';

  if (props.variant === 'upcoming') {
    if (session.session_type === 'live') { accentColor = RED; }
    else if (props.reg?.joinLinkAvailable) { accentColor = RED; }
    else if (props.reg?.registered) { accentColor = GREEN; accentBg = GREEN_BG; }
    else { accentColor = ORANGE; }
  } else {
    const attempt = props.attemptSummary;
    const pct = props.watch?.watch_percentage ?? 0;
    const watched = props.watch?.status === 'completed' || pct >= 100;
    if (attempt?.passed) { accentColor = GREEN; accentBg = GREEN_BG; }
    else if (attempt && !attempt.passed && attempt.attempts >= attempt.maxAttempts) { accentColor = RED; }
    else if (pct > 0 && !watched) { accentColor = GOLD; accentBg = AMBER_BG; }
    else if (watched) { accentColor = TEAL; }
    else { accentColor = '#E5E7EB'; }
  }

  const wrapper: React.CSSProperties = {
    ...wrapperBase,
    background: accentBg,
    borderLeft: `4px solid ${accentColor}`,
    boxShadow: hover ? '0 8px 24px rgba(13,46,90,0.12)' : wrapperBase.boxShadow,
    transform: hover ? 'translateY(-2px)' : 'none',
  };

  const shareText = `I just watched "${session.title}" — part of FMP Real-World Financial Modeling. Practitioner-led, built on real deal work.`;

  if (props.variant === 'upcoming') {
    const reg = props.reg;
    const mins = minutesUntil(session.scheduled_datetime);
    const startingSoon = reg?.registered && mins <= 15 && mins >= -180;
    const canJoin = reg?.joinLinkAvailable;
    const isLiveNow = session.session_type === 'live';
    const badgeLabel = isLiveNow ? 'LIVE NOW' : reg?.registered ? 'REGISTERED' : 'UPCOMING';
    const badgeBg = isLiveNow ? RED : reg?.registered ? GREEN : ORANGE;

    return (
      <div style={wrapper} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <Link href={href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div style={bannerStyle(session.banner_url)}>
            <span style={badge(badgeBg, '#fff')}>
              <Radio size={10} /> {badgeLabel}
            </span>
            {!session.banner_url && (
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textAlign: 'center', padding: '0 12px' }}>
                {session.title}
              </span>
            )}
          </div>
        </Link>

        <div style={bodyStyle}>
          <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={titleStyle}>{session.title}</div>
          </Link>

          <div style={metaRow}>
            <Calendar size={13} strokeWidth={2} />
            <span style={{ fontWeight: 600, color: NAVY }}>{formatDateTime(session.scheduled_datetime)}</span>
          </div>
          {session.duration_minutes && (
            <div style={metaRow}>
              <Clock size={13} strokeWidth={2} /> <span>{session.duration_minutes} min</span>
            </div>
          )}
          {session.instructor_name && (
            <div style={{ ...metaRow, marginBottom: 12 }}>
              <User size={13} strokeWidth={2} />
              <span>{session.instructor_name}{session.instructor_title ? ` — ${session.instructor_title}` : ''}</span>
            </div>
          )}

          {session.has_assessment && (
            <div style={{ marginBottom: 12 }}>
              <span style={chip('#EFF6FF', '#1B4F8A')}><FileText size={11} /> Assessment Available</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            {canJoin ? (
              <Link href={href} style={primaryBtn(RED)}>
                <Radio size={14} /> Join Live →
              </Link>
            ) : startingSoon ? (
              <Link href={href} style={primaryBtn(TEAL)}>
                Starting soon →
              </Link>
            ) : reg?.registered ? (
              <Link href={href} style={primaryBtn(NAVY)}>View Details</Link>
            ) : (
              <Link href={href} style={primaryBtn(GREEN)}>Register</Link>
            )}
            <button
              type="button"
              title="Add to calendar (.ics)"
              onClick={() => downloadIcs(session)}
              style={iconBtn(NAVY)}
            >
              <DownloadIcon size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Recorded ─────────────────────────────────────────────────────────────
  const watch = props.watch;
  const pct = watch ? Math.min(100, Math.max(0, Number(watch.watch_percentage ?? 0))) : 0;
  const watched = watch?.status === 'completed' || pct >= 100;
  const inProgress = !watched && pct > 0;
  const attempt = props.attemptSummary;
  const watchThreshold = props.watchThreshold ?? 70;
  const watchMet = pct >= watchThreshold;
  const hasAssessment = !!session.has_assessment;
  const assessmentPassed = attempt?.passed === true;
  const assessmentLocked = attempt ? (!attempt.passed && attempt.attempts >= attempt.maxAttempts) : false;

  const ctaLabel = watched ? 'Watch Again' : inProgress ? 'Continue Watching' : 'Watch Recording';
  const ctaBg = watched ? NAVY : inProgress ? ORANGE : TEAL;

  // Achievement card eligibility:
  //   - With assessment   → must pass
  //   - Without assessment → watch ≥ threshold
  const cardEligible = hasAssessment ? assessmentPassed : watchMet;

  return (
    <>
      <div style={wrapper} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <Link href={href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div style={bannerStyle(session.banner_url)}>
            <span style={badge(TEAL_DARK, '#fff')}>
              <Play size={10} fill="currentColor" /> RECORDED
            </span>
            {assessmentPassed && (
              <span style={{ ...badge(GREEN, '#fff'), left: 'auto', right: 10, top: 10 } as React.CSSProperties}>
                <CheckCircle2 size={10} /> PASSED
              </span>
            )}
            {!assessmentPassed && watched && !hasAssessment && (
              <span style={{
                position: 'absolute', top: 10, right: 10,
                width: 26, height: 26, borderRadius: 999,
                background: GREEN, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}>
                <CheckCircle2 size={16} />
              </span>
            )}
            {!session.banner_url && (
              <div style={{
                width: 54, height: 54, borderRadius: 999,
                background: 'rgba(255,255,255,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Play size={22} color="#fff" fill="#fff" />
              </div>
            )}
          </div>
        </Link>

        <div style={bodyStyle}>
          <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={titleStyle}>{session.title}</div>
          </Link>

          {session.scheduled_datetime && (
            <div style={metaRow}>
              <Calendar size={13} strokeWidth={2} />
              <span>Recorded {formatDateShort(session.scheduled_datetime)}</span>
            </div>
          )}
          {session.duration_minutes && (
            <div style={metaRow}>
              <Clock size={13} strokeWidth={2} /> <span>{session.duration_minutes} min</span>
            </div>
          )}
          {session.instructor_name && (
            <div style={{ ...metaRow, marginBottom: 10 }}>
              <User size={13} strokeWidth={2} /> <span>{session.instructor_name}</span>
            </div>
          )}

          {/* Status chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {hasAssessment && !assessmentPassed && !assessmentLocked && (
              <span style={chip('#EFF6FF', '#1B4F8A')}><FileText size={11} /> Has Assessment</span>
            )}
            {assessmentPassed && (
              <span style={chip('#DCFCE7', '#166534')}><Award size={11} /> Assessment Passed · {attempt!.bestScore}%</span>
            )}
            {assessmentLocked && (
              <span style={chip('#FEE2E2', '#991B1B')}><Lock size={11} /> Max Attempts Reached</span>
            )}
          </div>

          {/* Watch progress */}
          {(inProgress || (!watched && hasAssessment && !assessmentPassed)) && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 6, background: '#F3F4F6', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct >= watchThreshold ? GREEN : GOLD, transition: 'width 0.3s' }} />
                {hasAssessment && (
                  <div style={{ position: 'absolute', top: -2, left: `${watchThreshold}%`, width: 1, height: 10, background: '#9CA3AF' }} />
                )}
              </div>
              <div style={{ fontSize: 10.5, color: '#9CA3AF', marginTop: 4, fontWeight: 600 }}>
                {pct}% watched{hasAssessment ? ` · ${watchThreshold}% unlocks assessment` : ''}
              </div>
            </div>
          )}

          {/* CTAs */}
          <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
            <Link href={href} style={{ ...primaryBtn(ctaBg), flex: '1 1 140px' }}>
              <Play size={13} fill="currentColor" /> {ctaLabel}
            </Link>

            {hasAssessment && !assessmentPassed && !assessmentLocked && (
              watchMet ? (
                <Link href={`/training/live-sessions/${session.id}/assessment`}
                  style={{ ...primaryBtn('#1B4F8A'), flex: '1 1 140px' }}>
                  <FileText size={13} /> {attempt && attempt.attempts > 0 ? 'Retake Assessment →' : 'Take Assessment →'}
                </Link>
              ) : (
                <span style={{ ...primaryBtn('#F3F4F6', '#9CA3AF'), cursor: 'default', flex: '1 1 140px' }}>
                  <Lock size={13} /> Watch {watchThreshold}% to unlock
                </span>
              )
            )}

            <button
              type="button"
              title="Share this session"
              onClick={() => setShareOpen(true)}
              style={iconBtn(TEAL_DARK)}
            >
              <Share2 size={15} />
            </button>

            {cardEligible && (
              <button
                type="button"
                title="Achievement card"
                onClick={() => setCardOpen(true)}
                style={iconBtn(GOLD)}
              >
                <Award size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share this session"
        text={shareText}
      />

      {cardOpen && cardEligible && (
        <ShareModal
          isOpen={cardOpen}
          onClose={() => setCardOpen(false)}
          title="🎉 Your Achievement Card"
          text={assessmentPassed
            ? `Just passed "${session.title}" — part of FMP Real-World Financial Modeling. Scored ${attempt?.bestScore}%.`
            : `Just completed "${session.title}" — part of FMP Real-World Financial Modeling.`}
          cardImageUrl={achievementCardUrl(session, props.studentName, props.registrationId, attempt?.bestScore, session.scheduled_datetime)}
          cardDownloadName={`FMP-${session.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}.png`}
        />
      )}
    </>
  );
}
