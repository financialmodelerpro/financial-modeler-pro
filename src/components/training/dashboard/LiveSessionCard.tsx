'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, Clock, User, Play, CheckCircle2, Radio, Share2, Download as DownloadIcon } from 'lucide-react';
import { downloadIcs } from '@/src/lib/training/calendar';
import { ShareModal } from '@/src/components/training/share/ShareModal';
import { useShareTemplate } from '@/src/lib/training/useShareTemplate';
import { renderShareTemplate, formatShareDate } from '@/src/lib/training/shareTemplates';
import type { LiveSession, RegistrationStatus, WatchHistoryEntry } from '@/src/lib/training/liveSessionsForStudent';

const NAVY = '#0D2E5A';
const TEAL = '#14B8A6';
const TEAL_DARK = '#0F766E';
const GREEN = '#2EAA4A';
const RED = '#DC2626';
const ORANGE = '#EA580C';
const GOLD = '#F5B942';

interface BaseProps {
  session: LiveSession;
  href: string;
}

interface UpcomingProps extends BaseProps {
  variant: 'upcoming';
  reg?: RegistrationStatus;
  /** Optional - when provided, the Register button calls the API
   *  inline. Without these, the button falls back to a navigation
   *  Link (legacy behaviour). The dashboard preview now passes these
   *  through so the click actually creates a session_registrations
   *  row + sends the confirmation email instead of just bouncing the
   *  user to the detail page (which had no Register button of its
   *  own pre-fix). */
  studentEmail?:    string;
  studentName?:     string;
  registrationId?:  string;
}

interface RecordedProps extends BaseProps {
  variant: 'recorded';
  watch?: WatchHistoryEntry;
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

const cardWrapper: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #E5E7EB',
  overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  position: 'relative',
  transition: 'box-shadow 0.15s, transform 0.15s',
};

const bannerBase: React.CSSProperties = {
  // Height reduced 120 → 90 (~25% shorter) per user request — card
  // width stays fluid (1/3 column), only the vertical footprint shrinks.
  height: 90,
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const badge = (bg: string, color: string): React.CSSProperties => ({
  position: 'absolute', top: 10, left: 10,
  fontSize: 10, fontWeight: 800,
  padding: '4px 10px', borderRadius: 6,
  background: bg, color,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
});

const metaRow: React.CSSProperties = {
  // Vertical rhythm tightened to fit the shorter card height —
  // marginBottom 6 → 4, lineHeight 1.4 → 1.3 trims ~20px total.
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 12, color: '#4B5563',
  marginBottom: 4, lineHeight: 1.3,
};

const iconBtn = (accent: string): React.CSSProperties => ({
  width: 32, height: 32, borderRadius: 8,
  border: `1px solid ${accent}`,
  background: '#fff', color: accent,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', flexShrink: 0,
});

export function LiveSessionCard(props: Props) {
  const { session, href } = props;
  const [hover, setHover] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Inline-register state. Hoisted out of the variant branch so the
  // hook count is stable across renders (rules-of-hooks).
  const [localRegistered, setLocalRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerNotice, setRegisterNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Share template is fetched for every variant — hooks must be called in
  // the same order every render, so it lives above the variant branch.
  const shareTemplate = useShareTemplate('live_session_watched');
  const shareRendered = renderShareTemplate(shareTemplate, {
    sessionName: session.title,
    course:      'FMP Real-World Financial Modeling',
    date:        formatShareDate(session.scheduled_datetime ?? new Date()),
  });

  const banner = session.banner_url
    ? { ...bannerBase, backgroundImage: `url(${session.banner_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { ...bannerBase, background: `linear-gradient(135deg, ${NAVY}, #1B4F8A)` };

  if (props.variant === 'upcoming') {
    const reg = props.reg;
    const minsUntil = minutesUntil(session.scheduled_datetime);
    // Inline registration: the previous Register element here was a
    // navigation Link to the detail page, which had no Register button
    // of its own - the click did nothing and (when the session had
    // live_url set) the detail page surfaced "Join Session" via a
    // different code path, giving the impression that one click had
    // both registered and unlocked the join link. Now the click POSTs
    // to /register and only flips the badge to REGISTERED on a
    // confirmed-server-side response.
    const registered = localRegistered || !!reg?.registered;
    const startingSoon = registered && minsUntil <= 15 && minsUntil >= -180;
    const canJoin = reg?.joinLinkAvailable;
    const badgeLabel = session.session_type === 'live' ? 'LIVE NOW' : registered ? 'REGISTERED' : 'UPCOMING';
    const badgeBg = session.session_type === 'live' ? RED : registered ? GREEN : ORANGE;
    // Capture into locals so the `doRegister` closure (called later)
    // doesn't lose the discriminated-union narrowing on `props`.
    const studentEmailProp   = props.studentEmail;
    const studentNameProp    = props.studentName;
    const registrationIdProp = props.registrationId;
    const canInlineRegister  = !!studentEmailProp && !!registrationIdProp;

    async function doRegister() {
      if (registering) return;
      setRegisterNotice(null);
      const regId = (studentEmailProp && registrationIdProp) ? registrationIdProp : '';
      const email = (studentEmailProp ?? '').trim();
      if (!regId || !email) {
        setRegisterNotice({ kind: 'err', msg: 'Sign in again to register.' });
        return;
      }
      setRegistering(true);
      try {
        const res = await fetch(`/api/training/live-sessions/${session.id}/register`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ regId, email, name: studentNameProp ?? '' }),
        });
        const json = await res.json().catch(() => ({})) as { registered?: boolean; emailSent?: boolean; error?: string };
        if (!res.ok || !json.registered) {
          setRegisterNotice({ kind: 'err', msg: json.error ?? 'Registration failed. Please retry.' });
          console.error('[live-session-card sm] register failed', { status: res.status, json });
        } else {
          setLocalRegistered(true);
          setRegisterNotice({
            kind: 'ok',
            msg: json.emailSent === false ? 'Registered. Email did not send.' : 'Registered. Check your email.',
          });
        }
      } catch (e) {
        setRegisterNotice({ kind: 'err', msg: 'Network error. Please retry.' });
        console.error('[live-session-card sm] register network error', e);
      } finally {
        setRegistering(false);
      }
    }

    return (
      <div
        style={{ ...cardWrapper, boxShadow: hover ? '0 6px 20px rgba(13,46,90,0.12)' : cardWrapper.boxShadow, transform: hover ? 'translateY(-2px)' : 'none' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <Link href={href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div style={banner}>
            <span style={badge(badgeBg, '#fff')}>
              <Radio size={10} style={{ marginRight: 4, marginBottom: -1, display: 'inline-block', verticalAlign: 'middle' }} />
              {badgeLabel}
            </span>
            {!session.banner_url && (
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textAlign: 'center', padding: '0 12px' }}>
                {session.title}
              </span>
            )}
          </div>
        </Link>

        <div style={{ padding: '10px 14px 12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: NAVY,
              marginBottom: 10, lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
            }}>
              {session.title}
            </div>
          </Link>

          <div style={metaRow}>
            <Calendar size={13} strokeWidth={2} />
            <span>{formatDateTime(session.scheduled_datetime)}</span>
          </div>
          {session.duration_minutes && (
            <div style={metaRow}>
              <Clock size={13} strokeWidth={2} />
              <span>{session.duration_minutes} min</span>
            </div>
          )}
          {session.instructor_name && (
            <div style={{ ...metaRow, marginBottom: 14 }}>
              <User size={13} strokeWidth={2} />
              <span>{session.instructor_name}{session.instructor_title ? ` — ${session.instructor_title}` : ''}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            {canJoin ? (
              <Link href={href} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 8, background: RED, color: '#fff',
                fontWeight: 700, fontSize: 12.5, textDecoration: 'none',
                boxShadow: '0 2px 8px rgba(220,38,38,0.3)',
              }}>
                <Radio size={14} /> Join Live →
              </Link>
            ) : startingSoon ? (
              <Link href={href} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 8, background: TEAL, color: '#fff',
                fontWeight: 700, fontSize: 12.5, textDecoration: 'none',
              }}>
                Starting soon →
              </Link>
            ) : registered ? (
              <Link href={href} style={{
                flex: 1, display: 'block', textAlign: 'center',
                padding: '9px 14px', borderRadius: 8, background: NAVY, color: '#fff',
                fontWeight: 700, fontSize: 12.5, textDecoration: 'none',
              }}>
                View Details
              </Link>
            ) : canInlineRegister ? (
              <button
                type="button"
                onClick={doRegister}
                disabled={registering}
                style={{
                  flex: 1, display: 'block', textAlign: 'center',
                  padding: '9px 14px', borderRadius: 8, background: GREEN, color: '#fff',
                  fontWeight: 700, fontSize: 12.5, border: 'none',
                  cursor: registering ? 'not-allowed' : 'pointer',
                  opacity: registering ? 0.65 : 1,
                }}
              >
                {registering ? 'Registering…' : 'Register'}
              </button>
            ) : (
              <Link href={href} style={{
                flex: 1, display: 'block', textAlign: 'center',
                padding: '9px 14px', borderRadius: 8, background: GREEN, color: '#fff',
                fontWeight: 700, fontSize: 12.5, textDecoration: 'none',
              }}>
                Register
              </Link>
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
          {registerNotice && (
            <div style={{
              marginTop: 8, fontSize: 11, lineHeight: 1.4,
              padding: '5px 8px', borderRadius: 5,
              background: registerNotice.kind === 'ok' ? '#F0FDF4' : '#FEF2F2',
              border: `1px solid ${registerNotice.kind === 'ok' ? '#BBF7D0' : '#FECACA'}`,
              color: registerNotice.kind === 'ok' ? '#166534' : '#B91C1C',
            }}>
              {registerNotice.msg}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Recorded variant ──────────────────────────────────────────────────────
  const watch = props.watch;
  const pct = watch ? Math.min(100, Math.max(0, Number(watch.watch_percentage ?? 0))) : 0;
  const watched = watch?.status === 'completed' || pct >= 100;
  const inProgress = !watched && pct > 0;

  const ctaLabel = watched ? 'Watch Again' : inProgress ? 'Continue Watching' : 'Watch Recording';
  const ctaBg = watched ? NAVY : inProgress ? ORANGE : TEAL;

  return (
    <>
      <div
        style={{ ...cardWrapper, boxShadow: hover ? '0 6px 20px rgba(13,46,90,0.12)' : cardWrapper.boxShadow, transform: hover ? 'translateY(-2px)' : 'none' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <Link href={href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div style={banner}>
            <span style={badge(TEAL_DARK, '#fff')}>
              <Play size={10} style={{ marginRight: 4, marginBottom: -1, display: 'inline-block', verticalAlign: 'middle' }} fill="currentColor" />
              Recorded
            </span>
            {watched && (
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
                backdropFilter: 'blur(2px)',
              }}>
                <Play size={22} color="#fff" fill="#fff" />
              </div>
            )}
          </div>
        </Link>

        <div style={{ padding: '10px 14px 12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: NAVY,
              marginBottom: 10, lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
            }}>
              {session.title}
            </div>
          </Link>

          {session.scheduled_datetime && (
            <div style={metaRow}>
              <Calendar size={13} strokeWidth={2} />
              <span>Recorded {formatDateShort(session.scheduled_datetime)}</span>
            </div>
          )}
          {session.duration_minutes && (
            <div style={metaRow}>
              <Clock size={13} strokeWidth={2} />
              <span>{session.duration_minutes} min</span>
            </div>
          )}
          {session.instructor_name && (
            <div style={{ ...metaRow, marginBottom: 10 }}>
              <User size={13} strokeWidth={2} />
              <span>{session.instructor_name}</span>
            </div>
          )}

          {/* Watch-progress bar + percentage intentionally omitted — the
              threshold-based assessment unlock rule is not surfaced to
              students (see WatchProgressBar note). `inProgress` still
              drives the CTA label ("Continue Watching") below, so the
              student still knows where they left off. */}

          <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            <Link href={href} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px 14px', borderRadius: 8, background: ctaBg, color: '#fff',
              fontWeight: 700, fontSize: 12.5, textDecoration: 'none',
            }}>
              <Play size={13} fill="currentColor" /> {ctaLabel}
            </Link>

            <button
              type="button"
              title="Share this session"
              onClick={(e) => { e.preventDefault(); setShareOpen(true); }}
              style={iconBtn(TEAL_DARK)}
            >
              <Share2 size={15} />
            </button>
          </div>
        </div>
      </div>

      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share this session"
        text={shareRendered.text}
        hashtags={shareRendered.hashtags}
      />
    </>
  );
}
