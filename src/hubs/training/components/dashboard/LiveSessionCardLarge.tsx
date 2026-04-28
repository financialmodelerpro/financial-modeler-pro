'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, Clock, User, Play, CheckCircle2, Radio, Share2, Download as DownloadIcon, Award, Lock, FileText } from 'lucide-react';
import { downloadIcs } from '@/src/hubs/training/lib/liveSessions/calendar';
import { ShareModal } from '@/src/components/training/share/ShareModal';
import { useShareTemplate } from '@/src/lib/training/useShareTemplate';
import { renderShareTemplate, formatShareDate } from '@/src/lib/training/shareTemplates';
import type { LiveSession, RegistrationStatus, WatchHistoryEntry } from '@/src/hubs/training/lib/liveSessions/liveSessionsForStudent';

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

/**
 * Human readout of how far away a session is. Static — refreshed on next
 * render. Good enough for card-level UX; precise time lives on the detail
 * page. Negative values ("started 3 min ago") surface as "Live now".
 */
function describeTimeUntil(iso?: string | null): string {
  if (!iso) return '';
  const mins = (new Date(iso).getTime() - Date.now()) / 60000;
  if (!Number.isFinite(mins)) return '';
  if (mins <= 0)     return 'Live now';
  if (mins < 60)     return `Starts in ${Math.max(1, Math.round(mins))} min`;
  const totalH = mins / 60;
  if (totalH < 24) {
    const h = Math.floor(totalH);
    const m = Math.round(mins - h * 60);
    return m > 0 ? `Starts in ${h}h ${m}m` : `Starts in ${h}h`;
  }
  const days = Math.floor(totalH / 24);
  const remH = Math.floor(totalH - days * 24);
  return remH > 0 ? `Starts in ${days}d ${remH}h` : `Starts in ${days}d`;
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
// I10 note: the banner further down now uses aspect-ratio instead of fixed
// height so it scales proportionally with card width on 375px phones.
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
  // Height reduced 120 → 90 (~25% shorter) per user request. Fixed
  // height instead of aspectRatio so the vertical footprint is
  // predictable regardless of card width. Still below the 120px
  // default-card-crowd threshold on narrow phones in the 1-col grid.
  height: 90,
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
  // Vertical padding tightened (14/16 → 10/12) to match the 25%
  // height-reduction target; horizontal padding unchanged so the
  // content doesn't visually re-flow at the text edges.
  padding: '10px 16px 12px',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
};

const titleStyle: React.CSSProperties = {
  // marginBottom 10 → 6 to tighten rhythm under shorter banner.
  fontSize: 15, fontWeight: 700, color: NAVY,
  marginBottom: 6, lineHeight: 1.3,
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
};

const metaRow: React.CSSProperties = {
  // marginBottom 6 → 4, lineHeight 1.4 → 1.3 — saves ~10-14px across
  // the date / duration / instructor rows combined.
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 12, color: '#4B5563',
  marginBottom: 4, lineHeight: 1.3,
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
  const hasAssessment = !!session.has_assessment;
  const params = new URLSearchParams({
    session: session.title,
    date: dateIso ? new Date(dateIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    course: 'FMP Real-World Financial Modeling',
    name: studentName ?? '',
    regId: regId ?? '',
    has_assessment: hasAssessment ? 'true' : 'false',
  });
  if (hasAssessment && score != null) {
    params.set('score', String(score));
  }
  if (session.duration_minutes != null && session.duration_minutes > 0) {
    params.set('duration', String(session.duration_minutes));
  }
  return `/api/training/achievement-image?${params.toString()}`;
}

export function LiveSessionCardLarge(props: Props) {
  const { session, href } = props;
  const [hover, setHover] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  // Inline register state. Flips to true after a confirmed-server-side
  // POST (the route now SELECTs the row back from the upsert and refuses
  // to claim success unless the row exists - see API docstring). The
  // parent-provided `reg.registered` is the source of truth on next
  // remount; localRegistered carries us through the optimistic period
  // between click and refetch.
  const [localRegistered, setLocalRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerNotice, setRegisterNotice] = useState<string | null>(null);

  async function doRegister() {
    if (registering) return;
    setRegisterError(null);
    setRegisterNotice(null);

    // Pre-validate locally so we never POST junk that the server has to
    // reject (and so the user gets a clearer message about the cause).
    const regId = (props.registrationId ?? '').trim();
    const email = (props.studentEmail   ?? '').trim();
    if (!regId) {
      setRegisterError('Your Registration ID is missing from this session. Please sign out and back in, then try again.');
      return;
    }
    if (!email) {
      setRegisterError('Your email is missing from this session. Please sign out and back in, then try again.');
      return;
    }

    setRegistering(true);
    try {
      const res = await fetch(`/api/training/live-sessions/${session.id}/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          regId,
          name:  props.studentName ?? '',
          email,
        }),
      });
      const json = await res.json().catch(() => ({})) as {
        error?:        string;
        registered?:   boolean;
        emailSent?:    boolean;
        emailError?:   string | null;
      };
      if (!res.ok || !json.registered) {
        setRegisterError(json.error ?? 'Could not register. Please try again.');
        console.error('[live-session-card] register failed', { status: res.status, json });
      } else {
        setLocalRegistered(true);
        setRegisterNotice(
          json.emailSent === false
            ? 'Registered. Confirmation email did not send - check your dashboard for the join link.'
            : 'Registered. Confirmation email sent.'
        );
      }
    } catch (e) {
      setRegisterError('Network error - please retry.');
      console.error('[live-session-card] register network error', e);
    } finally {
      setRegistering(false);
    }
  }

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

  const watchedTemplate     = useShareTemplate('live_session_watched');
  const achievementTemplate = useShareTemplate('achievement_card');
  const watchedShare = renderShareTemplate(watchedTemplate, {
    studentName: props.studentName ?? '',
    sessionName: session.title,
    course:      'FMP Real-World Financial Modeling',
    date:        formatShareDate(session.scheduled_datetime ?? new Date()),
  });

  if (props.variant === 'upcoming') {
    const reg = props.reg;
    const mins = minutesUntil(session.scheduled_datetime);
    // Effective registration state: parent-provided + any inline register
    // click the student just made. Prevents the card from flipping back
    // to "Register" while the parent refetches.
    const registered = localRegistered || !!reg?.registered;
    const startingSoon = registered && mins <= 15 && mins >= -180;
    const canJoin = reg?.joinLinkAvailable;
    const isLiveNow = session.session_type === 'live';
    const badgeLabel = isLiveNow ? 'LIVE NOW' : registered ? 'REGISTERED' : 'UPCOMING';
    const badgeBg = isLiveNow ? RED : registered ? GREEN : ORANGE;
    const countdown = describeTimeUntil(session.scheduled_datetime);

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

          {/* Registered pill + countdown. Only shown once the student is
              actually registered — before that, the Register button below
              is the whole CTA row. */}
          {registered && !canJoin && !startingSoon && countdown && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              marginBottom: 10, fontSize: 12, color: '#374151',
            }}>
              <span style={chip('#DCFCE7', '#166534')}>
                <CheckCircle2 size={11} /> Registered
              </span>
              <span style={{ color: NAVY, fontWeight: 600 }}>{countdown}</span>
            </div>
          )}

          {registerError && (
            <div style={{
              marginBottom: 10, fontSize: 12, color: '#B91C1C',
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 6, padding: '6px 10px',
            }}>
              {registerError}
            </div>
          )}
          {registerNotice && !registerError && (
            <div style={{
              marginBottom: 10, fontSize: 12, color: '#166534',
              background: '#F0FDF4', border: '1px solid #BBF7D0',
              borderRadius: 6, padding: '6px 10px',
            }}>
              {registerNotice}
            </div>
          )}

          {/* CTA row. Precedence:
                live + registered   → Join Live (primary red)
                ≤15 min + reg       → "Starting soon" (navigates to detail so
                                        the student can get the join link)
                registered, far out → View Details (secondary)
                not registered      → Register button (inline, no redirect) */}
          <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            {canJoin && registered ? (
              <Link href={href} style={primaryBtn(RED)}>
                <Radio size={14} /> Join Live →
              </Link>
            ) : startingSoon ? (
              <Link href={href} style={primaryBtn(TEAL)}>
                Starting soon →
              </Link>
            ) : registered ? (
              <Link href={href} style={primaryBtn(NAVY)}>View Details</Link>
            ) : (
              <button
                type="button"
                onClick={doRegister}
                disabled={registering}
                style={{
                  ...primaryBtn(GREEN),
                  opacity: registering ? 0.65 : 1,
                  cursor:  registering ? 'not-allowed' : 'pointer',
                }}
              >
                {registering ? 'Registering…' : 'Register'}
              </button>
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

          {/* Watch-progress bar intentionally not rendered for students — the
              threshold + watched % gate assessment unlock server-side but are
              hidden from the UI so the rule can't be gamed. Status chips
              above ("Has Assessment" / "Assessment Passed" / "Max Attempts
              Reached") and the locked CTA below ("Keep watching to unlock")
              are the only public signals. */}

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
                  <Lock size={13} /> Keep watching to unlock
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
        text={watchedShare.text}
        hashtags={watchedShare.hashtags}
      />

      {cardOpen && cardEligible && (() => {
        const dateLabel = formatShareDate(session.scheduled_datetime ?? new Date());
        const rendered = renderShareTemplate(achievementTemplate, {
          studentName: props.studentName ?? '',
          sessionName: session.title,
          score:       attempt?.bestScore ?? 'Completed',
          course:      'FMP Real-World Financial Modeling',
          date:        dateLabel,
          regId:       props.registrationId ?? '',
        });
        return (
          <ShareModal
            isOpen={cardOpen}
            onClose={() => setCardOpen(false)}
            title="🎉 Your Achievement Card"
            text={rendered.text}
            hashtags={rendered.hashtags}
            cardImageUrl={achievementCardUrl(session, props.studentName, props.registrationId, attempt?.bestScore, session.scheduled_datetime)}
            cardDownloadName={`FMP-${session.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}.png`}
          />
        );
      })()}
    </>
  );
}
