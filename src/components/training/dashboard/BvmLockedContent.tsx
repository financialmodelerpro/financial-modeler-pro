'use client';

interface BvmLockedContentProps {
  sfmProgress: number;
  sfmTotal: number;
  onContinue: () => void;
}

export function BvmLockedContent({ sfmProgress, sfmTotal, onContinue }: BvmLockedContentProps) {
  const pct = sfmTotal > 0 ? Math.round((sfmProgress / sfmTotal) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '80px 24px', minHeight: 400 }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>🔒</div>
      <h2 style={{ fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 12 }}>
        Business Valuation Modeling — Locked
      </h2>
      <p style={{ fontSize: 14, color: '#6B7280', maxWidth: 420, lineHeight: 1.6, marginBottom: 28 }}>
        Complete the 3-Statement Financial Modeling course to unlock Business Valuation Methods.
      </p>
      <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: '16px 28px', marginBottom: 28, minWidth: 260 }}>
        <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your 3SFM Progress</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#1B4F8A', marginBottom: 10 }}>{sfmProgress} / {sfmTotal} sessions completed</div>
        <div style={{ height: 6, borderRadius: 3, background: '#E5E7EB', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, background: '#2EAA4A', width: `${pct}%`, transition: 'width 0.6s' }} />
        </div>
      </div>
      <button onClick={onContinue}
        style={{ padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 700, background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer' }}>
        Continue 3SFM →
      </button>
    </div>
  );
}
