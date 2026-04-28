'use client';

interface Props {
  watchPct:       number;
  threshold:      number;
  enforcing:      boolean;
  adminBypass:    boolean;
  sessionBypass:  boolean;
}

/**
 * Student-facing watch progress bar.
 *
 * Phase 4 / 2026-04-28: re-enabled after the watch-tracker rebuild. The
 * pre-146 tracker had race conditions that made the displayed % unreliable
 * (frozen at the largest single contiguous run, dropped buffering gaps,
 * lost the final 5-10s on unmount), so showing a number to students would
 * have been a worse experience than hiding it. With the tracker now
 * accurate AND a manual override path at 50% available for legitimate
 * undershoots, exposing the live % gives students a clear sense of what
 * "Mark Complete" needs without being misleading.
 *
 * Visual rules:
 *  - red bar < 30%  : early in the watch
 *  - amber 30 to threshold-1 : closing in
 *  - green at threshold      : auto-unlock available
 *  - dashed vertical marker at the threshold position
 *  - bypass-aware label so admin / global-off / per-session bypass
 *    don't surface a misleading "X% to go" message
 */
export function WatchProgressBar({ watchPct, threshold, enforcing, adminBypass, sessionBypass }: Props) {
  const bypassed = !enforcing || adminBypass || sessionBypass;
  if (bypassed) {
    return (
      <div style={{
        margin: '12px 0', padding: '8px 12px',
        background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8,
        fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>✓</span>
        <span>
          Watch threshold bypassed for this session. You can mark complete at any time.
        </span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, Math.round(watchPct)));
  const thresholdClamped = Math.max(0, Math.min(100, Math.round(threshold)));
  const fillColor = clamped >= thresholdClamped
    ? '#16a34a'
    : clamped >= 30
    ? '#F59E0B'
    : '#DC2626';

  // Status copy underneath the bar. Three buckets:
  //  - 0-49: keep watching
  //  - 50 to threshold-1: override available, clear messaging
  //  - threshold+: ready
  let label: string;
  let labelColor: string;
  if (clamped >= thresholdClamped) {
    label = `${clamped}% watched. Ready to mark complete.`;
    labelColor = '#166534';
  } else if (clamped >= 50) {
    label = `${clamped}% watched. Auto-unlock at ${thresholdClamped}%, or confirm manually below.`;
    labelColor = '#92400E';
  } else {
    label = `${clamped}% watched. Keep watching to ${thresholdClamped}% to unlock Mark Complete.`;
    labelColor = '#6B7280';
  }

  return (
    <div style={{ margin: '12px 0' }}>
      <div style={{
        position: 'relative', height: 8,
        background: '#F3F4F6', borderRadius: 4, overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: `${clamped}%`,
          background: fillColor,
          transition: 'width 0.4s ease',
        }} />
        {/* Dashed threshold marker */}
        <div style={{
          position: 'absolute', top: -2, bottom: -2,
          left: `${thresholdClamped}%`,
          width: 0,
          borderLeft: '2px dashed #1B3A6B',
          opacity: 0.65,
          pointerEvents: 'none',
        }} />
      </div>
      <div style={{
        marginTop: 6, fontSize: 11.5, color: labelColor,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <span>{label}</span>
        <span style={{ fontSize: 10, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
          Threshold: {thresholdClamped}%
        </span>
      </div>
    </div>
  );
}
