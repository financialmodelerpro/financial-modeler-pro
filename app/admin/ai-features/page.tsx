'use client';

/**
 * /admin/ai-features - AI Control Panel (AI foundation Unit 5)
 *
 * The "turn AI features on from the dashboard" surface. Lists every feature in
 * the AI registry, grouped by platform, and lets an admin toggle it on or off
 * and set the per-plan monthly cap.
 *
 * NEW FEATURES APPEAR HERE AUTOMATICALLY. There is no feature list in this
 * file: it renders whatever the registry returns, so a feature that registers
 * itself shows up on the next load with no edit here.
 *
 * This screen edits CONFIG ONLY. Enforcement is server-side: the metering layer
 * reads the caps and the runtime reads `enabled`. Nothing here can grant access
 * or bypass a limit.
 *
 * USAGE is rendered from whatever the metering layer reports. Until that unit
 * ships, the panel says so explicitly rather than showing zeroes, because "0
 * calls" and "nothing is being measured" look identical and only one of them is
 * true.
 *
 * No em dashes in this file.
 */

import { useCallback, useEffect, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/shared/hooks/useRequireAdmin';

interface Feature {
  id: string;
  featureId: string;
  platformSlug: string;
  name: string;
  description: string | null;
  category: string;
  grounding: string[];
  enabled: boolean;
  displayOrder: number;
  caps: Record<string, number>;
}
interface Group { platformSlug: string; platformLabel: string; features: Feature[] }
interface UsageRow { featureId: string; platformSlug: string; calls: number; users: number | null }
type UsageReport = { available: true; periodLabel: string; rows: UsageRow[] } | { available: false; reason: string };

const CATEGORY_LABEL: Record<string, string> = {
  narrative: 'Narrative',
  validation: 'Validation',
  guidance: 'Guidance',
  generation: 'Generation',
};

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 20, marginBottom: 20,
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#5A6675',
  textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '2px solid #E5E7EB', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '10px', borderBottom: '1px solid #F1F3F5', fontSize: 13, verticalAlign: 'top' };

export default function AdminAiFeaturesPage() {
  const { loading: authLoading } = useRequireAdmin();
  const [loading, setLoading] = useState(true);
  const [migrationApplied, setMigrationApplied] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [planKeys, setPlanKeys] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageReport>({ available: false, reason: '' });
  const [capEdits, setCapEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const rowKey = (f: Feature) => `${f.platformSlug}::${f.featureId}`;
  const capKey = (f: Feature, plan: string) => `${rowKey(f)}::${plan}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/ai-features', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Failed to load.'); return; }
      setMigrationApplied(json.migrationApplied !== false);
      setError(json.migrationApplied === false ? (json.error ?? null) : null);
      setGroups(json.groups ?? []);
      setPlanKeys(json.planKeys ?? []);
      setUsage(json.usage ?? { available: false, reason: '' });
      setCapEdits({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load]);

  const flash = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const patch = async (f: Feature, payload: Record<string, unknown>, okMsg: string) => {
    setSavingKey(rowKey(f));
    try {
      const res = await fetch('/api/admin/ai-features', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureId: f.featureId, platformSlug: f.platformSlug, ...payload }),
      });
      const json = await res.json();
      if (!res.ok) { flash(json.error ?? 'Save failed.', 'error'); return; }
      // Re-render from the STORED row the server read back, never from the
      // value we hoped we wrote.
      const saved: Feature = json.feature;
      setGroups((gs) => gs.map((g) => ({
        ...g,
        features: g.features.map((x) => (rowKey(x) === rowKey(f) ? saved : x)),
      })));
      flash(okMsg, 'success');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Save failed.', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const toggle = (f: Feature) =>
    patch(f, { enabled: !f.enabled }, `${f.name} ${!f.enabled ? 'enabled' : 'disabled'}.`);

  const saveCaps = (f: Feature) => {
    const caps: Record<string, number> = {};
    for (const plan of planKeys) {
      const raw = capEdits[capKey(f, plan)];
      if (raw === undefined) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) { flash(`Cap for ${plan} must be a whole number of 0 or more.`, 'error'); return; }
      caps[plan] = n;
    }
    if (Object.keys(caps).length === 0) { flash('No cap changes to save.', 'error'); return; }
    void patch(f, { caps }, `Caps saved for ${f.name}.`);
  };

  const dirty = (f: Feature) => planKeys.some((p) => capEdits[capKey(f, p)] !== undefined);
  const totalFeatures = groups.reduce((n, g) => n + g.features.length, 0);

  if (authLoading || loading) {
    return (<><CmsAdminNav /><div style={{ padding: 40, color: '#5A6675' }}>Loading AI features...</div></>);
  }

  return (
    <>
      <CmsAdminNav />
      <div style={{ padding: '28px 32px', maxWidth: 1200 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B3A6B', margin: '0 0 6px' }}>AI Control Panel</h1>
        <p style={{ fontSize: 13, color: '#5A6675', margin: '0 0 22px', maxWidth: 780 }}>
          Every registered AI feature, grouped by platform. Toggling a feature off stops it running.
          Caps are the monthly generation limit per plan, enforced server-side. New features appear
          here automatically when their code registers them.
        </p>

        {toast && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600,
            background: toast.type === 'success' ? '#E7F5EC' : '#FDECEC',
            color: toast.type === 'success' ? '#2E7D52' : '#B23A3A',
            border: `1px solid ${toast.type === 'success' ? '#2E7D52' : '#B23A3A'}33`,
          }}>{toast.msg}</div>
        )}

        {!migrationApplied && (
          <div style={{ ...card, borderColor: '#B23A3A', background: '#FDECEC' }}>
            <strong style={{ color: '#B23A3A' }}>The AI registry tables are not present.</strong>
            <p style={{ fontSize: 13, color: '#5A6675', margin: '6px 0 0' }}>
              Apply migration 203 (and 204) in Supabase, then reload. {error}
            </p>
          </div>
        )}

        {/* Usage. Rendered from the metering layer's own report so it can never
            imply a count that nobody measured. */}
        <div style={{ ...card, background: usage.available ? '#fff' : '#FFF9E6', borderColor: usage.available ? '#E5E7EB' : '#E0C97A' }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', margin: '0 0 8px' }}>
            Usage {usage.available ? `(${usage.periodLabel})` : ''}
          </h2>
          {usage.available ? (
            <p style={{ fontSize: 13, color: '#5A6675', margin: 0 }}>
              {usage.rows.length} feature{usage.rows.length === 1 ? '' : 's'} with recorded activity this period.
            </p>
          ) : (
            <p data-testid="usage-unavailable" style={{ fontSize: 13, color: '#7A6320', margin: 0 }}>
              {usage.reason}
            </p>
          )}
        </div>

        {migrationApplied && totalFeatures === 0 && (
          <div style={card}>
            <strong style={{ color: '#1B3A6B' }}>No AI features are registered yet.</strong>
            <p style={{ fontSize: 13, color: '#5A6675', margin: '6px 0 0' }}>
              Features appear here automatically once their code registers them. Nothing to configure until then.
            </p>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.platformSlug} style={card}>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: '#1B3A6B', margin: '0 0 4px' }}>{g.platformLabel}</h2>
            <p style={{ fontSize: 12, color: '#5A6675', margin: '0 0 14px' }}>
              {g.features.length} feature{g.features.length === 1 ? '' : 's'}
            </p>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Feature</th>
                    <th style={th}>Category</th>
                    <th style={th}>Grounding</th>
                    <th style={{ ...th, textAlign: 'center' }}>Status</th>
                    {planKeys.map((p) => (
                      <th key={p} style={{ ...th, textAlign: 'right' }}>{p} cap</th>
                    ))}
                    <th style={{ ...th, textAlign: 'right' }}>Usage</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {g.features.map((f) => {
                    const busy = savingKey === rowKey(f);
                    const u = usage.available
                      ? usage.rows.find((r) => r.featureId === f.featureId && r.platformSlug === f.platformSlug)
                      : null;
                    return (
                      <tr key={rowKey(f)}>
                        <td style={td}>
                          <div style={{ fontWeight: 700, color: '#2A3440' }}>{f.name}</div>
                          <div style={{ fontSize: 11, color: '#5A6675', fontFamily: 'monospace' }}>{f.featureId}</div>
                          {f.description && (
                            <div style={{ fontSize: 12, color: '#5A6675', marginTop: 4, maxWidth: 320 }}>{f.description}</div>
                          )}
                        </td>
                        <td style={td}>{CATEGORY_LABEL[f.category] ?? f.category}</td>
                        <td style={{ ...td, fontSize: 12, color: '#5A6675' }}>{f.grounding.join(', ')}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <button
                            onClick={() => void toggle(f)}
                            disabled={busy}
                            data-testid={`toggle-${f.featureId}`}
                            style={{
                              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
                              border: `1px solid ${f.enabled ? '#2E7D52' : '#C7CDD4'}`,
                              background: f.enabled ? '#E7F5EC' : '#F1F3F5',
                              color: f.enabled ? '#2E7D52' : '#5A6675', opacity: busy ? 0.6 : 1, minWidth: 74,
                            }}
                          >
                            {f.enabled ? 'On' : 'Off'}
                          </button>
                        </td>

                        {planKeys.map((p) => {
                          const stored = f.caps[p];
                          const edited = capEdits[capKey(f, p)];
                          const value = edited !== undefined ? edited : (stored === undefined ? '' : String(stored));
                          return (
                            <td key={p} style={{ ...td, textAlign: 'right' }}>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={value}
                                placeholder={stored === undefined ? 'not set' : ''}
                                data-testid={`cap-${f.featureId}-${p}`}
                                onChange={(e) => setCapEdits((m) => ({ ...m, [capKey(f, p)]: e.target.value }))}
                                style={{
                                  width: 78, padding: '5px 7px', fontSize: 13, textAlign: 'right',
                                  border: `1px solid ${edited !== undefined ? '#1B4F8A' : '#C7CDD4'}`,
                                  borderRadius: 5, background: edited !== undefined ? '#E2EAF4' : '#fff',
                                }}
                              />
                            </td>
                          );
                        })}

                        <td style={{ ...td, textAlign: 'right', color: usage.available ? '#2A3440' : '#9AA3AD' }}>
                          {usage.available ? (u ? u.calls.toLocaleString() : '0') : 'not tracked'}
                        </td>

                        <td style={{ ...td, textAlign: 'right' }}>
                          <button
                            onClick={() => saveCaps(f)}
                            disabled={busy || !dirty(f)}
                            style={{
                              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                              border: '1px solid #1B4F8A', background: dirty(f) ? '#1B4F8A' : '#F1F3F5',
                              color: dirty(f) ? '#fff' : '#9AA3AD',
                              cursor: busy || !dirty(f) ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Save caps
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <p style={{ fontSize: 12, color: '#5A6675', marginTop: 4 }}>
          A cap of 0 denies the feature to that plan without disabling it for everyone. A blank cap means
          no cap has been configured for that plan yet. Enforcement is server-side; this screen only edits
          the configuration it reads from.
        </p>
      </div>
    </>
  );
}
