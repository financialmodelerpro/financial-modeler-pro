/**
 * DeckVersionsModal.tsx (REFM Module 7: named presentation versions)
 *
 * The deck equivalent of the platform's project VersionModal. Until migration
 * 207 there was exactly ONE deck per project (refm_report_decks.project_id is
 * the primary key) and every Save overwrote it, so a user could not keep a
 * "Pre-IC draft" beside a "Board pack v2". This lists the saved versions, saves
 * the current deck as a new named one, loads one back, and deletes one.
 *
 * Two deliberate properties:
 *
 *   * Loading is an ordinary undoable edit. The parent applies the loaded deck
 *     through `commit`, so Ctrl+Z brings back what was on screen and the load
 *     still has to be Saved to reach the working row. Nothing is destroyed by
 *     looking at an old version.
 *   * Saving a version also saves the working deck (server-side, one call), so
 *     the named version and the live deck can never disagree about what was
 *     captured.
 *
 * Because slides hold BINDING KEYS rather than figures, a saved version records
 * layout and narrative; its numbers still resolve against the current model when
 * loaded. That is stated in the UI so nobody reads an old version as a frozen
 * set of results.
 *
 * No em dashes in this file.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { DECK_THEME } from '../../../lib/reports/deck/theme';
import {
  listReportDeckVersions, saveReportDeckVersion, getReportDeckVersion, deleteReportDeckVersion,
  type DeckVersionListItem,
} from '../../../lib/persistence/client';
import type { Deck } from '../../../lib/reports/deck/types';

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(13,46,90,0.36)', zIndex: 60,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
};
const panel: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 8, border: `1px solid ${DECK_THEME.rule}`,
  boxShadow: '0 18px 50px rgba(13,46,90,0.28)', width: 'min(620px, 100%)',
  maxHeight: '86vh', display: 'flex', flexDirection: 'column', minHeight: 0,
};
const inp: React.CSSProperties = {
  border: `1px solid ${DECK_THEME.rule}`, borderRadius: 4, padding: '6px 8px', fontSize: 12, width: '100%',
};
const btn = (primary = false, danger = false): React.CSSProperties => ({
  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
  border: `1px solid ${primary ? DECK_THEME.navy : DECK_THEME.rule}`,
  background: primary ? DECK_THEME.navy : '#FFFFFF',
  color: primary ? '#FFFFFF' : danger ? DECK_THEME.red : DECK_THEME.ink,
  whiteSpace: 'nowrap',
});

export interface DeckVersionsModalProps {
  projectId: string;
  deck: Deck;
  /** True when the working deck has edits not yet saved, so a load can warn. */
  dirty: boolean;
  onClose: () => void;
  /** Apply a loaded version over the working deck (parent routes it through
   *  `commit`, so it is one undo step and still needs Save). */
  onLoad: (deck: Deck, label: string) => void;
  onNotice: (msg: string) => void;
}

export default function DeckVersionsModal({ projectId, deck, dirty, onClose, onLoad, onNotice }: DeckVersionsModalProps): React.JSX.Element {
  const [versions, setVersions] = useState<DeckVersionListItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [comment, setComment] = useState('');

  // One loader, in the effect, with a cancel guard, matching VersionModal and
  // ExportModal. A reload after a save or a delete bumps `reloadKey` rather
  // than calling a state-setting function from the effect, which keeps the
  // fetch as a single subscription instead of a cascading render.
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listReportDeckVersions(projectId);
      if (cancelled) return;
      setLoading(false);
      if (res.error) { setErr(res.error); return; }
      setVersions(res.data?.versions ?? []);
      setCurrentId(res.data?.currentVersionId ?? null);
      setAvailable(res.data?.available !== false);
    })();
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  const doSave = async () => {
    const name = label.trim();
    if (!name) { setErr('Give this version a name.'); return; }
    setBusy(true); setErr(null);
    const res = await saveReportDeckVersion(projectId, deck, name, comment.trim() || null);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    setLabel(''); setComment('');
    onNotice(`Saved presentation version "${name}".`);
    refresh();
  };

  const doLoad = async (v: DeckVersionListItem) => {
    const name = v.label ?? `Version ${v.versionNumber}`;
    if (dirty && !window.confirm(`Load "${name}" over your current presentation? Your unsaved changes will be replaced (Ctrl+Z undoes this).`)) return;
    setBusy(true); setErr(null);
    const res = await getReportDeckVersion(projectId, v.id);
    setBusy(false);
    if (res.error || !res.data?.deck) { setErr(res.error ?? 'That version could not be loaded.'); return; }
    onLoad(res.data.deck, name);
    onClose();
  };

  const doDelete = async (v: DeckVersionListItem) => {
    const name = v.label ?? `Version ${v.versionNumber}`;
    if (!window.confirm(`Delete the saved version "${name}"? This cannot be undone. Your current presentation is not affected.`)) return;
    setBusy(true); setErr(null);
    const res = await deleteReportDeckVersion(projectId, v.id);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onNotice(`Deleted version "${name}".`);
    refresh();
  };

  return (
    <div style={overlay} onClick={onClose} data-testid="deck-versions-modal">
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${DECK_THEME.rule}` }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: DECK_THEME.navy }}>Presentation versions</div>
            <div style={{ fontSize: 11, color: DECK_THEME.slate, marginTop: 2 }}>
              Save this presentation under a name and keep several side by side.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: DECK_THEME.slate }} title="Close">✕</button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!available ? (
            <div style={{ background: '#FFF8E8', border: '1px solid #E4C271', color: '#7A5B12', borderRadius: 4, padding: '10px 12px', fontSize: 12, lineHeight: 1.5 }}>
              Saved versions are not available on this database yet (migration 207 has not been applied).
              Your presentation still saves normally as a single working deck.
            </div>
          ) : null}

          {err ? (
            <div style={{ background: '#FFF5F5', border: `1px solid ${DECK_THEME.red}`, color: DECK_THEME.red, borderRadius: 4, padding: '9px 12px', fontSize: 12 }}>{err}</div>
          ) : null}

          {available ? (
            <div style={{ border: `1px solid ${DECK_THEME.rule}`, borderRadius: 6, padding: 12, background: DECK_THEME.offWhite }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: DECK_THEME.slate, marginBottom: 8 }}>
                Save as a new version
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  style={inp} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120}
                  placeholder="Version name, for example: Pre-IC draft" data-testid="deck-version-name"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void doSave(); }}
                />
                <input
                  style={inp} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300}
                  placeholder="Note (optional)"
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button style={btn(true)} onClick={() => void doSave()} disabled={busy || !label.trim()} data-testid="deck-version-save">
                    {busy ? 'Saving...' : 'Save as new version'}
                  </button>
                  <span style={{ fontSize: 10.5, color: DECK_THEME.slateLight, lineHeight: 1.4 }}>
                    This also saves your current presentation.
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: DECK_THEME.slate, marginBottom: 8 }}>
              Saved versions {versions.length ? `(${versions.length})` : ''}
            </div>
            {loading ? (
              <div style={{ fontSize: 12, color: DECK_THEME.slate }}>Loading...</div>
            ) : !versions.length ? (
              <div style={{ fontSize: 12, color: DECK_THEME.slate, lineHeight: 1.5 }}>
                No saved versions yet. Your presentation is still saved as one working deck; naming a version keeps a copy you can come back to.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {versions.map((v) => {
                  const isCurrent = v.id === currentId;
                  return (
                    <div
                      key={v.id} data-testid="deck-version-row"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 5,
                        border: `1px solid ${isCurrent ? DECK_THEME.navy : DECK_THEME.rule}`,
                        background: isCurrent ? DECK_THEME.paleWash : '#FFFFFF',
                      }}
                    >
                      <span style={{
                        minWidth: 26, textAlign: 'center', fontSize: 10, fontWeight: 700, borderRadius: 3, padding: '2px 5px',
                        background: isCurrent ? DECK_THEME.navy : '#FFFFFF', color: isCurrent ? '#FFFFFF' : DECK_THEME.slate,
                        border: `1px solid ${isCurrent ? DECK_THEME.navy : DECK_THEME.rule}`,
                      }}>v{v.versionNumber}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: DECK_THEME.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.label ?? `Version ${v.versionNumber}`}
                          {isCurrent ? <span style={{ fontSize: 9.5, fontWeight: 700, color: DECK_THEME.navy, marginLeft: 6 }}>CURRENT</span> : null}
                        </div>
                        <div style={{ fontSize: 10.5, color: DECK_THEME.slateLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.createdAt ? new Date(v.createdAt).toLocaleString() : 'Saved'}{v.comment ? ` · ${v.comment}` : ''}
                        </div>
                      </div>
                      <button style={btn()} onClick={() => void doLoad(v)} disabled={busy} data-testid="deck-version-load">Load</button>
                      <button style={btn(false, true)} onClick={() => void doDelete(v)} disabled={busy} title="Delete this saved version">Delete</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ fontSize: 10.5, color: DECK_THEME.slateLight, lineHeight: 1.5, borderTop: `1px solid ${DECK_THEME.rule}`, paddingTop: 10 }}>
            A saved version stores the slides, layout and narrative. Because every data object stays linked to your model,
            loading an older version still shows today&apos;s figures rather than the ones on screen when it was saved.
          </div>
        </div>
      </div>
    </div>
  );
}
