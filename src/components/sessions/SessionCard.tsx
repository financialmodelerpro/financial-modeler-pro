'use client';

import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LiveSessionData {
  id: string;
  title: string;
  description?: string;
  session_type: 'upcoming' | 'live' | 'recorded' | string;
  scheduled_datetime?: string;
  timezone?: string;
  duration_minutes?: number | null;
  category?: string;
  banner_url?: string | null;
  instructor_name?: string;
  is_featured?: boolean;
  registration_count?: number;
  youtube_url?: string | null;
  tags?: string[];
  difficulty_level?: string;
  max_attendees?: number | null;
}

export interface SessionCardProps {
  session: LiveSessionData;
  variant: 'student' | 'public';
  compact?: boolean;
  isRegistered?: boolean;
  joinLinkAvailable?: boolean;
  watched?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';

function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; }
}
function fmtDateShort(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
}
function fmtTimeShort(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

export function getEffectiveType(s: { session_type: string; scheduled_datetime?: string }): string {
  if (s.session_type === 'recorded') return 'recorded';
  if (s.session_type === 'live') {
    if (!s.scheduled_datetime) return 'live';
    const endTime = new Date(s.scheduled_datetime);
    endTime.setHours(endTime.getHours() + 3);
    return new Date() > endTime ? 'recorded' : 'live';
  }
  if (s.session_type === 'upcoming' && s.scheduled_datetime) {
    return new Date() > new Date(s.scheduled_datetime) ? 'recorded' : 'upcoming';
  }
  return s.session_type;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SessionCard({ session: s, variant, compact, isRegistered, joinLinkAvailable, watched }: SessionCardProps) {
  const effType = getEffectiveType(s);
  const isLive = effType === 'live';
  const isRec  = effType === 'recorded';

  const ytId     = extractYouTubeId(s.youtube_url);
  const thumbUrl = s.banner_url || (isRec && ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : null);

  // Link targets differ by variant
  const detailUrl = variant === 'student'
    ? `/training/live-sessions/${s.id}`
    : `${LEARN_URL}/training-sessions/${s.id}`;

  const placeholderH = compact ? 80 : 160;

  return (
    <div className="session-card" style={{
      background: '#fff', borderRadius: 12, overflow: 'hidden',
      border: '1px solid #E5E7EB',
      borderTop: isLive ? '3px solid #DC2626' : !isRec ? '3px solid #2E75B6' : undefined,
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      display: 'flex', flexDirection: 'column', position: 'relative',
    }}>
      {/* ── Banner / Thumbnail ─────────────────────────────────────────────── */}
      <Link href={detailUrl} style={{ display: 'block', position: 'relative', background: NAVY }}>
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt={s.title} style={{
            width: '100%', height: 'auto', maxHeight: compact ? 160 : 280, objectFit: 'contain', display: 'block', background: NAVY,
          }} />
        ) : (
          <div style={{
            width: '100%', height: placeholderH,
            background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 60%, #2563EB 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: compact ? 8 : 20,
          }}>
            <span style={{ fontSize: compact ? 12 : 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
              {s.title}
            </span>
          </div>
        )}

        {/* Play overlay for recordings */}
        {isRec && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.15)' }}>
            <div style={{ width: compact ? 36 : 48, height: compact ? 36 : 48, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={compact ? 16 : 20} height={compact ? 16 : 20} viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        )}

        {/* LIVE pulsing badge */}
        {isLive && (
          <div style={{ position: 'absolute', top: compact ? 6 : 10, left: compact ? 6 : 10, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(220,38,38,0.95)', padding: '4px 10px', borderRadius: 20, zIndex: 2 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'live-pulse 1.5s ease infinite' }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: '0.05em' }}>LIVE</span>
          </div>
        )}

        {/* RECORDED badge */}
        {isRec && !isLive && (
          <span style={{ position: 'absolute', top: compact ? 6 : 10, left: compact ? 6 : 10, fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 10, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
            RECORDED
          </span>
        )}
      </Link>

      {/* ── Card Body ──────────────────────────────────────────────────────── */}
      <div style={{ padding: compact ? '10px 12px' : '16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Badges row (upcoming, difficulty, featured, category) */}
        {!isRec && !isLive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: compact ? 4 : 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: '#EFF6FF', color: '#1D4ED8' }}>UPCOMING</span>
            {!compact && s.difficulty_level && s.difficulty_level !== 'All Levels' && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#F3F4F6', color: '#6B7280' }}>{s.difficulty_level}</span>
            )}
            {!compact && s.category && (
              <span style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF' }}>{s.category}</span>
            )}
            {s.is_featured && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 10, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
          </div>
        )}

        {/* Category for recordings (compact omits) */}
        {isRec && !compact && (s.category || (s.difficulty_level && s.difficulty_level !== 'All Levels')) && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {s.category && <span style={{ fontSize: 9, fontWeight: 700, color: '#1B4F8A' }}>{s.category}</span>}
            {s.difficulty_level && s.difficulty_level !== 'All Levels' && (
              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: '#F3F4F6', color: '#6B7280' }}>{s.difficulty_level}</span>
            )}
          </div>
        )}

        {/* Title */}
        <h3 style={{
          fontSize: compact ? 14 : 16, fontWeight: compact ? 700 : 800,
          color: NAVY, margin: '0 0 4px', lineHeight: 1.3,
          ...(compact ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' } : {}),
        }}>
          {s.title}
        </h3>

        {/* Date / Time */}
        {s.scheduled_datetime && (
          compact ? (
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 2 }}>
              {fmtDateShort(s.scheduled_datetime)} &middot; {fmtTimeShort(s.scheduled_datetime)}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
              {fmtDate(s.scheduled_datetime)} &middot; {fmtTime(s.scheduled_datetime)}
              {s.timezone ? ` (${s.timezone})` : ''}
            </div>
          )
        )}

        {/* Duration */}
        {s.duration_minutes && (
          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: compact ? 4 : 6 }}>{s.duration_minutes} min</div>
        )}

        {/* Max attendees (non-compact, non-recorded only) */}
        {!compact && !isRec && s.max_attendees && (
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>Limited to {s.max_attendees} seats</div>
        )}

        {/* Registration count (both variants, non-recording) */}
        {!isRec && !compact && typeof s.registration_count === 'number' && s.registration_count > 0 && (
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>{s.registration_count} registered</div>
        )}

        {/* Registered status (student variant only) */}
        {variant === 'student' && isRegistered && !compact && (
          <div style={{ fontSize: 11, color: '#166534', fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#16A34A' }}>{'\u2705'}</span> Registered
            {joinLinkAvailable && <span style={{ color: '#DC2626', fontWeight: 700 }}> &middot; Join link active!</span>}
          </div>
        )}

        {/* Watched badge (recorded sessions only) */}
        {watched && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px',
            background: '#dcfce7',
            color: '#16a34a',
            borderRadius: 99,
            fontSize: 12,
            fontWeight: 600,
            marginBottom: compact ? 4 : 6,
            alignSelf: 'flex-start',
          }}>
            ✓ Watched
          </span>
        )}

        {/* Description (skip in compact) */}
        {!compact && s.description && (
          <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', flex: 1 }}>
            {s.description}
          </p>
        )}
        {!compact && !s.description && <div style={{ flex: 1 }} />}
        {compact && <div style={{ flex: 1, minHeight: 4 }} />}

        {/* ── CTA Button ───────────────────────────────────────────────────── */}
        <div style={{ marginTop: 'auto', paddingTop: compact ? 4 : 0 }}>
          {/* Student variant: registered + join link active → red button */}
          {variant === 'student' && joinLinkAvailable ? (
            <Link href={detailUrl}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: compact ? '7px 12px' : '9px 16px', borderRadius: 7, background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: compact ? 11 : 12, textDecoration: 'none', width: '100%' }}>
              Join Session Now &#8594;
            </Link>
          ) : (
            <Link href={detailUrl}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: compact ? '7px 12px' : '9px 16px', borderRadius: 7, background: isRec ? NAVY : GREEN, color: '#fff', fontWeight: 700, fontSize: compact ? 11 : 12, textDecoration: 'none', width: '100%' }}>
              {isRec
                ? (compact ? 'View Recording \u2192' : '\u25B6 Watch Recording \u2192')
                : 'View Session \u2192'
              }
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
