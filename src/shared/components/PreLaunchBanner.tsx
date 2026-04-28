'use client';

/**
 * Banner rendered above the registration form while a hub is in Coming
 * Soon mode. Tells the student registration is open, login opens at
 * launch, and (when a launch date is set) when to expect that.
 *
 * Rendered only when `enabled === true` — component returns null otherwise
 * so callers can wire it in unconditionally.
 */

interface Props {
  enabled:     boolean;
  launchDate:  string | null | undefined;
  hubLabel:    string;
}

function formatLaunchWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    hour:    'numeric',
    minute:  '2-digit',
  });
}

export function PreLaunchBanner({ enabled, launchDate, hubLabel }: Props) {
  if (!enabled) return null;
  const when = formatLaunchWhen(launchDate);
  return (
    <div style={{
      background:    'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
      border:        '1px solid #BFDBFE',
      borderRadius:  10,
      padding:       '12px 16px',
      marginBottom:  20,
      fontSize:      13,
      color:         '#1E3A8A',
      lineHeight:    1.55,
    }}>
      {/* C9: removed whiteSpace:nowrap — a long formatted date
          ("Thursday, 15 May 2026 at 2:30 PM") was clipping at 320px.
          flexWrap lets the date breathe onto a second line when needed. */}
      <div style={{ fontWeight: 800, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        🚀 {hubLabel} is launching {when ? <>on <span>{when}</span></> : 'soon'}
      </div>
      <div style={{ color: '#1E40AF' }}>
        Register now to be ready — your account will be waiting. Sign-in opens at launch.
      </div>
    </div>
  );
}
