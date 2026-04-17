'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface AuditEntry {
  id: string;
  action: string;
  before_value: Record<string, unknown> | null;
  after_value:  Record<string, unknown> | null;
  reason:       string | null;
  created_at:   string;
  admin:  { email: string; name: string | null } | null;
  target: { email: string; name: string | null } | null;
}

const ACTION_COLOR: Record<string, string> = {
  update_user:      'var(--color-navy-mid)',
  delete_project:   'var(--color-negative)',
  archive_project:  '#f59e0b',
  update_user_plan: '#7c3aed',
  plan_permission:  '#0891b2',
  user_override:    '#0891b2',
};

const ACTION_ICON: Record<string, string> = {
  update_user:      '✏️',
  delete_project:   '🗑️',
  archive_project:  '📦',
  update_user_plan: '💳',
  plan_permission:  '🔐',
  user_override:    '👤',
};

export default function AuditLogViewer() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset,  setOffset]  = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const LIMIT = 50;

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    const res = await fetch(`/api/admin/audit-log?limit=${LIMIT}&offset=${off}`);
    if (res.ok) {
      const json = await res.json();
      setEntries(json.entries ?? []);
      setTotal(json.total ?? 0);
      setOffset(off);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(0); }, [load]);

  function formatDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
    if (!after) return null;
    return Object.entries(after).map(([k, v]) => {
      const prev = before?.[k];
      return (
        <div key={k} style={{ fontSize: 11, marginTop: 2 }}>
          <span style={{ color: 'var(--color-meta)', fontWeight: 600 }}>{k}: </span>
          {prev !== undefined && (
            <span style={{ color: 'var(--color-negative)', textDecoration: 'line-through', marginRight: 6 }}>
              {String(prev)}
            </span>
          )}
          <span style={{ color: 'var(--color-green-dark)', fontWeight: 600 }}>{String(v)}</span>
        </div>
      );
    });
  }

  return (
    <div style={{ fontFamily: 'Inter,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--color-meta)' }}>
          {total} total entries - showing {offset + 1}-{Math.min(offset + LIMIT, total)}
        </span>
        <button onClick={() => load(0)} style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-meta)' }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-meta)', background: '#fafafa', borderRadius: 8, border: '2px dashed var(--color-border)' }}>
          No audit log entries yet. Admin actions will appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((e) => {
            const color = ACTION_COLOR[e.action] ?? 'var(--color-grey-mid)';
            const icon  = ACTION_ICON[e.action]  ?? '📝';
            const isOpen = expanded === e.id;
            return (
              <div key={e.id} style={{ border: '1px solid var(--color-border)', borderLeft: `4px solid ${color}`, borderRadius: 6, background: 'var(--color-grey-white)', overflow: 'hidden' }}>
                <button
                  onClick={() => setExpanded(isOpen ? null : e.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'Inter,sans-serif' }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        {e.action.replace(/_/g, ' ')}
                      </span>
                      {e.target && (
                        <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>
                          → {e.target.name ?? e.target.email}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 1 }}>
                      By <strong>{e.admin?.name ?? e.admin?.email ?? 'system'}</strong>
                      {' · '}
                      {new Date(e.created_at).toLocaleString()}
                      {e.reason && <> · <em>{e.reason}</em></>}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <div style={{ padding: '0 14px 12px 44px', borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
                    {formatDiff(e.before_value, e.after_value)}
                    {!e.before_value && !e.after_value && (
                      <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>No detail recorded</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button disabled={offset === 0} onClick={() => load(offset - LIMIT)} style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'white', cursor: offset === 0 ? 'default' : 'pointer', opacity: offset === 0 ? 0.4 : 1, fontFamily: 'Inter,sans-serif' }}>
            ← Previous
          </button>
          <span style={{ fontSize: 12, color: 'var(--color-meta)', alignSelf: 'center' }}>
            Page {Math.floor(offset / LIMIT) + 1} of {Math.ceil(total / LIMIT)}
          </span>
          <button disabled={offset + LIMIT >= total} onClick={() => load(offset + LIMIT)} style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'white', cursor: offset + LIMIT >= total ? 'default' : 'pointer', opacity: offset + LIMIT >= total ? 0.4 : 1, fontFamily: 'Inter,sans-serif' }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
