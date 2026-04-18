'use client';

interface Props {
  watchPct: number;
  threshold: number;
  enforcing: boolean;
  adminBypass: boolean;
  sessionBypass: boolean;
}

/**
 * Watch progress bar shown above the Mark Complete button on the watch page.
 * Displays current watched % + threshold marker, with color coded on progress.
 *
 * Colors: <30% red, 30-70% amber, ≥70% green. Threshold marker is a dashed
 * vertical line at the target %. Messaging adapts when admin or bypass applies.
 */
export function WatchProgressBar({ watchPct, threshold, enforcing, adminBypass, sessionBypass }: Props) {
  const pct = Math.min(100, Math.max(0, Math.round(watchPct)));
  const met = pct >= threshold;

  const barColor =
    pct < 30       ? '#DC2626'
  : pct < threshold ? '#F59E0B'
                    : '#059669';

  const bypassed = adminBypass || sessionBypass || !enforcing;
  const statusLabel = bypassed
    ? (adminBypass ? '🛡️  Admin bypass — Mark Complete always available' :
       sessionBypass ? '🔓 Session bypass — Mark Complete always available' :
       '🔓 Enforcement disabled — Mark Complete always available')
    : met
      ? `✓ Threshold met — you can Mark Complete`
      : `Watch at least ${threshold}% to unlock Mark Complete · ${Math.max(0, threshold - pct)}% to go`;

  return (
    <div style={{ marginBottom: 16, padding: '12px 14px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Watch progress
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: bypassed ? '#6B7280' : barColor, fontVariantNumeric: 'tabular-nums' }}>
          {pct}% <span style={{ fontSize: 11, fontWeight: 500, color: '#9CA3AF' }}>/ {bypassed ? '—' : `${threshold}%`}</span>
        </span>
      </div>

      <div style={{ position: 'relative', height: 8, background: '#F3F4F6', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${pct}%`, background: bypassed ? '#9CA3AF' : barColor,
          transition: 'width 0.3s ease, background 0.3s ease',
        }} />
        {!bypassed && (
          <div
            title={`Threshold ${threshold}%`}
            style={{
              position: 'absolute', top: -2, bottom: -2,
              left: `${threshold}%`, width: 0,
              borderLeft: '2px dashed rgba(13,46,90,0.7)',
            }}
          />
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: bypassed ? '#6B7280' : (met ? '#059669' : '#6B7280'), fontWeight: met || bypassed ? 600 : 500 }}>
        {statusLabel}
      </div>
    </div>
  );
}
