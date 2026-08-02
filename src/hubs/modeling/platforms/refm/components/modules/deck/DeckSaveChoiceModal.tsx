/**
 * DeckSaveChoiceModal.tsx (REFM Module 7: what a Save should do)
 *
 * Saving the deck used to overwrite the working document silently: one row per
 * project (refm_report_decks.project_id is the PRIMARY KEY) upserted with no
 * prompt. Named versions existed (migration 207) but the Save button never
 * touched them, so a user who saved a version, kept editing and pressed Save
 * had quietly changed the working deck while the version pointer still claimed
 * they matched.
 *
 * This is the deck's equivalent of the platform's EditChoiceModal, with two
 * deliberate differences:
 *
 *   * It asks on EVERY save, not once when an edit session starts. The deck has
 *     no edit-session gate to hang the question off, and never auto-saves, so
 *     the save click is the only honest moment to ask.
 *   * It offers two options, not three. "Edit a different version" belongs to
 *     the load flow, which the versions modal already owns.
 *
 * The current version's name is resolved live when the modal opens, the same
 * way EditChoiceModal shows the version you are about to overwrite, so nobody
 * confirms an in-place save without seeing what it replaces. When the working
 * deck is linked to no saved version, the in-place option stays available but
 * says plainly that it updates the working presentation only, mirroring how
 * EditChoiceModal degrades when `canEditInPlace` is false.
 *
 * No em dashes in this file.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DECK_THEME } from '../../../lib/reports/deck/theme';
import { listReportDeckVersions, type DeckVersionListItem } from '../../../lib/persistence/client';

export type DeckSaveChoice = 'in-place' | 'new-version';

export interface DeckSaveChoiceModalProps {
  projectId: string;
  onChoose: (choice: DeckSaveChoice, linked: DeckVersionListItem | null) => void;
  onCancel: () => void;
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(13,46,90,0.36)', zIndex: 70,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
};

export default function DeckSaveChoiceModal({ projectId, onChoose, onCancel }: DeckSaveChoiceModalProps): React.JSX.Element | null {
  const [choice, setChoice] = useState<DeckSaveChoice>('in-place');
  const [linked, setLinked] = useState<DeckVersionListItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve which saved version (if any) this deck was last saved as, so the
  // in-place option can name what it is about to overwrite.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listReportDeckVersions(projectId);
      if (cancelled) return;
      setLoading(false);
      const cur = res.data?.currentVersionId ?? null;
      setLinked(cur ? (res.data?.versions ?? []).find((v) => v.id === cur) ?? null : null);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (typeof document === 'undefined') return null;

  const linkedName = linked ? (linked.label ?? `Version ${linked.versionNumber}`) : null;

  const options: Array<{ value: DeckSaveChoice; title: string; desc: string }> = [
    {
      value: 'in-place',
      title: linkedName ? `Update "${linkedName}"` : 'Update this presentation',
      desc: linkedName
        ? `Overwrites the saved version "${linkedName}" with what is on screen, keeping its name, number and date. No new version is created.`
        : 'Saves your working presentation. It is not linked to a saved version yet, so nothing else is overwritten.',
    },
    {
      value: 'new-version',
      title: 'Save as a new version',
      desc: 'Keeps a named copy of the presentation as it stands now. You carry on editing where you are; the copy is there to come back to.',
    },
  ];

  return createPortal(
    <div style={overlay} onClick={onCancel} data-testid="deck-save-choice">
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF', borderRadius: 8, border: `1px solid ${DECK_THEME.rule}`,
          boxShadow: '0 18px 50px rgba(13,46,90,0.28)', width: 'min(520px, 100%)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${DECK_THEME.rule}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: DECK_THEME.navy }}>Save presentation</div>
          <div style={{ fontSize: 11, color: DECK_THEME.slate, marginTop: 2 }}>
            {loading ? 'Checking saved versions...' : 'Choose how this save should be kept.'}
          </div>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((o) => {
            const on = choice === o.value;
            return (
              <button
                key={o.value}
                data-testid={`deck-save-choice-${o.value}`}
                onClick={() => setChoice(o.value)}
                style={{
                  textAlign: 'left', width: '100%', cursor: 'pointer', borderRadius: 6, padding: '10px 12px',
                  border: `1px solid ${on ? DECK_THEME.navy : DECK_THEME.rule}`,
                  background: on ? DECK_THEME.paleWash : '#FFFFFF',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}
              >
                <span style={{
                  marginTop: 2, width: 13, height: 13, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${on ? DECK_THEME.navy : DECK_THEME.pale}`,
                  background: on ? DECK_THEME.navy : '#FFFFFF',
                  boxShadow: on ? 'inset 0 0 0 2px #FFFFFF' : undefined,
                }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: on ? DECK_THEME.navy : DECK_THEME.ink }}>{o.title}</span>
                  <span style={{ display: 'block', fontSize: 11, color: DECK_THEME.slate, lineHeight: 1.45, marginTop: 2 }}>{o.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: `1px solid ${DECK_THEME.rule}`, background: DECK_THEME.offWhite }}>
          <button
            onClick={onCancel} data-testid="deck-save-choice-cancel"
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 4, cursor: 'pointer', border: `1px solid ${DECK_THEME.rule}`, background: '#FFFFFF', color: DECK_THEME.ink }}
          >Cancel</button>
          <button
            onClick={() => onChoose(choice, linked)} disabled={loading} data-testid="deck-save-choice-confirm"
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 4, cursor: loading ? 'default' : 'pointer', border: `1px solid ${DECK_THEME.navy}`, background: DECK_THEME.navy, color: '#FFFFFF', opacity: loading ? 0.6 : 1 }}
          >Continue</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
