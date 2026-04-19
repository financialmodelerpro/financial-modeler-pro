'use client';

interface Props {
  watchPct: number;
  threshold: number;
  enforcing: boolean;
  adminBypass: boolean;
  sessionBypass: boolean;
}

/**
 * Watch progress bar shown above the Mark Complete button.
 *
 * Only renders when enforcement is actually active — i.e. the global switch
 * is on, this session isn't bypassed, and the viewer isn't an admin. If any
 * of those let the student skip the threshold, the bar is irrelevant and
 * we hide it entirely (no debug chatter in the student UI).
 *
 * When shown: displays current watched % / threshold + a colored bar with a
 * dashed threshold marker. Color ramps red → amber → green as progress
 * approaches the threshold.
 */
export function WatchProgressBar({ watchPct, threshold, enforcing, adminBypass, sessionBypass }: Props) {
  // Bypass = nothing to enforce. Don't render — student sees just the video.
  if (!enforcing || adminBypass || sessionBypass) return null;

  const pct = Math.min(100, Math.max(0, Math.round(watchPct)));
  const met = pct >= threshold;
  const barColor =
    pct < 30        ? '#DC2626'
  : pct < threshold ? '#F59E0B'
                    : '#059669';

  return (
    <div style={{ marginBottom: 16, padding: '12px 14px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Watch progress
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: barColor, fontVariantNumeric: 'tabular-nums' }}>
          {pct}% <span style={{ fontSize: 11, fontWeight: 500, color: '#9CA3AF' }}>/ {threshold}%</span>
        </span>
      </div>

      <div style={{ position: 'relative', height: 8, background: '#F3F4F6', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${pct}%`, background: barColor,
          transition: 'width 0.3s ease, background 0.3s ease',
        }} />
        <div
          title={`Threshold ${threshold}%`}
          style={{
            position: 'absolute', top: -2, bottom: -2,
            left: `${threshold}%`, width: 0,
            borderLeft: '2px dashed rgba(13,46,90,0.7)',
          }}
        />
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: met ? '#059669' : '#6B7280', fontWeight: met ? 600 : 500 }}>
        {met
          ? `Threshold met — you can Mark Complete.`
          : `Watch at least ${threshold}% to unlock Mark Complete · ${Math.max(0, threshold - pct)}% to go`}
      </div>
    </div>
  );
}
