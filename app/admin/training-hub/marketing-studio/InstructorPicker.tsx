'use client';

import React, { useEffect, useState } from 'react';

export interface InstructorRow {
  id: string;
  name: string;
  title: string;
  photo_url?: string | null;
  is_default: boolean;
  display_order: number;
}

interface Props {
  /** Selected instructor IDs in pick-order (drives banner render order). */
  value: string[];
  /** Called when admin checks/unchecks an instructor. Pick-order preserved. */
  onChange: (ids: string[]) => void;
  /** Optional label override. Defaults to "Instructors". */
  label?: string;
  /** Optional hint shown under the list. */
  hint?: string;
}

/**
 * Multi-select picker for active instructors. Pulls from
 * /api/admin/training-hub/marketing-studio/instructors (active=true ordered
 * by display_order). Pick-order is the order the admin clicked them in.
 */
export function InstructorPicker({ value, onChange, label = 'Instructors', hint }: Props) {
  const [rows, setRows] = useState<InstructorRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/training-hub/marketing-studio/instructors')
      .then(r => r.json())
      .then((j: { instructors?: InstructorRow[] }) => setRows(j.instructors ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter(v => v !== id));
    else onChange([...value, id]);
  }

  function clear() { onChange([]); }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
        {value.length > 0 && (
          <button type="button" onClick={clear}
            style={{ fontSize: 10, color: '#6B7280', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Clear
          </button>
        )}
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: '#9CA3AF', padding: 8 }}>Loading instructors…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: '#9CA3AF', padding: 8 }}>No active instructors. Add them in the Instructors tab.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 6, padding: 6, background: '#FAFAFA' }}>
          {rows.map(ins => {
            const idx = value.indexOf(ins.id);
            const checked = idx >= 0;
            return (
              <label key={ins.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 5,
                  background: checked ? '#EFF6FF' : 'transparent', cursor: 'pointer',
                  border: checked ? '1px solid #BFDBFE' : '1px solid transparent',
                }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(ins.id)} style={{ cursor: 'pointer' }} />
                {ins.photo_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={ins.photo_url} alt={ins.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#6B7280', fontWeight: 700, flexShrink: 0 }}>
                    {ins.name.charAt(0)}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#0D2E5A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ins.name}
                    {ins.is_default && <span style={{ marginLeft: 6, fontSize: 9, color: '#6B7280', fontWeight: 500 }}>(default)</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ins.title}</div>
                </div>
                {checked && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#1B4F8A', minWidth: 16, textAlign: 'right' }}>#{idx + 1}</span>
                )}
              </label>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
        {hint ?? `${value.length} selected · pick-order = render-order. Empty = default instructor from brand pack.`}
      </div>
    </div>
  );
}
