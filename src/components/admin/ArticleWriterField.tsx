'use client';

/**
 * ArticleWriterField.tsx (admin, client)
 *
 * Writer control for the article form. Picks an instructor (InstructorPicker),
 * which auto-fills the byline snapshot (writer_name / writer_title). Those two
 * fields are then EDITABLE per article (a display override), while writer_id keeps
 * the durable link to the instructor. "Re-sync from instructor" pulls the current
 * instructor's name/title back into the snapshot. Shared by the new + edit pages.
 *
 * No em dashes in this file.
 */

import { useState } from 'react';
import { InstructorPicker, type PickerInstructor } from '@/src/components/admin/InstructorPicker';

export interface WriterValue { writerId: string; writerName: string; writerTitle: string }

interface Props {
  value: WriterValue;
  onChange: (patch: Partial<WriterValue>) => void;
  inputStyle: React.CSSProperties;
  notify?: (msg: string, type: 'success' | 'error') => void;
  error?: string;
}

export function ArticleWriterField({ value, onChange, inputStyle, notify, error }: Props): React.JSX.Element {
  const [resyncing, setResyncing] = useState(false);

  function onPick(id: string, ins: PickerInstructor | null) {
    onChange({ writerId: id, writerName: ins?.name ?? '', writerTitle: ins?.title ?? '' });
  }

  async function resync() {
    if (!value.writerId || resyncing) return;
    setResyncing(true);
    try {
      const j = await (await fetch('/api/admin/instructors')).json();
      const list: PickerInstructor[] = Array.isArray(j.instructors) ? j.instructors : [];
      const ins = list.find(i => i.id === value.writerId);
      if (!ins) { notify?.('That instructor no longer exists; edit the byline manually.', 'error'); return; }
      onChange({ writerName: ins.name, writerTitle: ins.title });
      notify?.('Byline re-synced from the instructor.', 'success');
    } catch {
      notify?.('Re-sync failed.', 'error');
    } finally { setResyncing(false); }
  }

  const smallLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 };

  return (
    <div>
      <InstructorPicker value={value.writerId} onChange={onPick} onMessage={notify} />

      {/* Editable per-article byline snapshot (overrides the instructor's values). */}
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <label style={smallLabel}>Byline name</label>
          <input value={value.writerName} onChange={e => onChange({ writerName: e.target.value })} placeholder="Shown as: Written by …" style={{ ...inputStyle, fontSize: 12 }} data-testid="writer-name-input" />
        </div>
        <div>
          <label style={smallLabel}>Byline title</label>
          <input value={value.writerTitle} onChange={e => onChange({ writerTitle: e.target.value })} placeholder="Shown under the name" style={{ ...inputStyle, fontSize: 12 }} data-testid="writer-title-input" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={resync} disabled={!value.writerId || resyncing}
            style={{ fontSize: 11, fontWeight: 600, color: value.writerId ? '#1B4F8A' : '#9CA3AF', background: 'none', border: 'none', padding: 0, cursor: value.writerId && !resyncing ? 'pointer' : 'default' }}
            data-testid="writer-resync">
            {resyncing ? 'Re-syncing…' : '↺ Re-sync from instructor'}
          </button>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>Edits override the instructor for this article only.</span>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 600, marginTop: 6 }} data-testid="writer-error">{error}</div>}
    </div>
  );
}
