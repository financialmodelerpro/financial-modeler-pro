'use client';

/**
 * /admin/revenue - Revenue summary across ALL users.
 *
 * Totals from the local ledger (payment_transactions): Paddle vs manual split
 * (Paddle marked RECONCILABLE against the Paddle dashboard), by period (this
 * month / this year / custom range), and by plan. Aggregated server-side from
 * the DB (no per-user Paddle calls). Structured to add a per-platform split
 * later without rework (the API already accepts a platform param).
 *
 * No em dashes in this file.
 */
import { useState, useEffect, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/shared/hooks/useRequireAdmin';

const NAVY = '#0D2E5A';

interface ByPlan { plan_key: string; source: 'paddle' | 'manual'; amountMinor: number }
interface Summary { totalMinor: number; paddleMinor: number; manualMinor: number; currency: string | null; byPlan: ByPlan[]; rowCount: number }

type PeriodKey = 'month' | 'year' | 'custom';

const fmt = (minor: number, currency: string | null): string => {
  const cur = currency ?? 'USD';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(minor / 100); }
  catch { return `${(minor / 100).toFixed(2)} ${cur}`; }
};
const iso = (d: Date): string => d.toISOString();
const dayInput = (d: Date): string => d.toISOString().slice(0, 10);

function rangeFor(period: PeriodKey, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  const now = new Date();
  if (period === 'month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)) };
  }
  if (period === 'year') {
    return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(new Date(now.getFullYear(), 11, 31, 23, 59, 59)) };
  }
  return {
    from: customFrom ? iso(new Date(`${customFrom}T00:00:00`)) : null,
    to: customTo ? iso(new Date(`${customTo}T23:59:59`)) : null,
  };
}

export default function AdminRevenuePage() {
  const { loading: authLoading } = useRequireAdmin();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const now = new Date();
  const [customFrom, setCustomFrom] = useState(dayInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [customTo, setCustomTo] = useState(dayInput(now));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const { from, to } = rangeFor(period, customFrom, customTo);
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    fetch(`/api/admin/revenue?${qs.toString()}`)
      .then((r) => r.json())
      .then((j) => setSummary(j.summary ?? null))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [period, customFrom, customTo]);

  useEffect(() => { void load(); }, [load]);

  if (authLoading) return null;
  const cur = summary?.currency ?? null;

  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 };
  const periodBtn = (k: PeriodKey, label: string) => (
    <button
      key={k}
      type="button"
      data-testid={`period-${k}`}
      onClick={() => setPeriod(k)}
      style={{ padding: '7px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${period === k ? NAVY : '#cbd5e1'}`, background: period === k ? NAVY : '#fff', color: period === k ? '#fff' : '#334155' }}
    >{label}</button>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/revenue" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }} data-testid="admin-revenue-page">
        <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: '0 0 4px' }}>Revenue</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>
          Total revenue across all users from the payment ledger. The Paddle portion is reconcilable against the Paddle dashboard (one ledger row per Paddle transaction).
        </p>

        {/* Period selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {periodBtn('month', 'This month')}
          {periodBtn('year', 'This year')}
          {periodBtn('custom', 'Custom range')}
          {period === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-testid="custom-range">
              <input type="date" data-testid="custom-from" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6 }} />
              <span style={{ color: '#94a3b8' }}>to</span>
              <input type="date" data-testid="custom-to" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6 }} />
            </div>
          )}
        </div>

        {loading || !summary ? (
          <div style={{ color: '#64748b', fontSize: 14 }}>Loading...</div>
        ) : (
          <>
            {/* Totals: total + Paddle vs manual */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
              <div style={card} data-testid="revenue-total">
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total revenue</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: NAVY, marginTop: 6 }}>{fmt(summary.totalMinor, cur)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{summary.rowCount} transactions</div>
              </div>
              <div style={card} data-testid="revenue-paddle">
                <div style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Paddle (reconcilable)</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#1d4ed8', marginTop: 6 }}>{fmt(summary.paddleMinor, cur)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Matches Paddle transaction totals</div>
              </div>
              <div style={card} data-testid="revenue-manual">
                <div style={{ fontSize: 11, color: '#92400e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Manual (offline)</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#92400e', marginTop: 6 }}>{fmt(summary.manualMinor, cur)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Admin-logged bank / offline payments</div>
              </div>
            </div>

            {/* By plan */}
            <div style={{ ...card, padding: 0, overflow: 'hidden' }} data-testid="revenue-by-plan">
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', fontSize: 13, fontWeight: 800, color: NAVY }}>By plan</div>
              {summary.byPlan.length === 0 ? (
                <div style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No revenue in this period.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Plan', 'Source', 'Revenue'].map((h) => (
                        <th key={h} style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, color: '#475569', textAlign: h === 'Revenue' ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byPlan.map((p) => (
                      <tr key={`${p.source}-${p.plan_key}`} data-testid={`plan-row-${p.source}-${p.plan_key}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{p.plan_key}</td>
                        <td style={{ padding: '9px 16px', fontSize: 12 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: p.source === 'paddle' ? '#dbeafe' : '#fef3c7', color: p.source === 'paddle' ? '#1d4ed8' : '#92400e', textTransform: 'uppercase' }}>{p.source}</span>
                        </td>
                        <td style={{ padding: '9px 16px', fontSize: 13, fontWeight: 700, color: '#0f172a', textAlign: 'right' }}>{fmt(p.amountMinor, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
