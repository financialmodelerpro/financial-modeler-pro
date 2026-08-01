'use client';

/**
 * NarrativeAi.tsx (REFM Module 7, AI foundation Unit 8)
 *
 * The user-facing half of IC narrative generation: a Generate button on each
 * narrative block, a Generate all button, the remaining-allowance readout, and
 * the review step that stands between a draft and the deck.
 *
 * THREE RULES THIS FILE EXISTS TO KEEP:
 *
 *   1. NOTHING IS APPLIED WITHOUT A DECISION. A generated draft lands in the
 *      review modal, never straight onto the slide. Applying is a separate
 *      click, per field, and the block's current text is shown beside the draft
 *      so the user can see exactly what would be replaced.
 *   2. THE SERVER IS AUTHORITATIVE. Everything here is a MIRROR of the server's
 *      state: the quota shown comes from the status endpoint, and the buttons
 *      disable when it says so, but the refusal that matters happens in
 *      checkAndConsume. If this UI were bypassed entirely, nothing changes.
 *      The count displayed is refreshed from each generation's own response,
 *      which is the server's number, not one this component increments.
 *   3. THE COST IS STATED BEFORE IT IS SPENT. Generate all names how many
 *      fields it will generate and how many of the remaining allowance that
 *      uses, because each field is one counted call and a button that hides
 *      that would be misreporting the bill.
 *
 * Palette is DECK_THEME throughout, which is the locked report palette, so this
 * surface matches the deck it sits beside.
 *
 * No em dashes in this file.
 */

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';

import { DECK_THEME } from '../../../lib/reports/deck/theme';
import type { Deck } from '../../../lib/reports/deck/types';
import { findNarrativeTargets, type NarrativeTarget } from '../../../lib/reports/deck/narrativeTargets';
import { IC_NARRATIVE_FIELDS, type IcNarrativeFieldKey } from '../../../lib/ai/icNarrative';
import { generateIcNarrative } from '../../../lib/persistence/client';

export interface NarrativeAiStatus {
  available: boolean;
  blockedReason: string | null;
  enabled: boolean;
  configured: boolean;
  cap: number | null;
  used: number | null;
  remaining: number | null;
  planKey: string | null;
  periodStart: string;
}

/** One generated draft awaiting a decision. */
export interface NarrativeDraft {
  field: IcNarrativeFieldKey;
  label: string;
  target: NarrativeTarget;
  draft: string;
  risks?: Array<{ risk: string; mitigant: string }>;
  audit: { ok: boolean; checked: number; supported: number; rounded: number; unsupported: Array<{ raw: string; index: number }>; summary: string };
}

const panelBtn = (tone: 'primary' | 'ghost' = 'ghost', disabled = false): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 9px',
  borderRadius: 4,
  border: `1px solid ${tone === 'primary' ? DECK_THEME.navy : DECK_THEME.rule}`,
  background: tone === 'primary' ? DECK_THEME.navy : '#FFFFFF',
  color: tone === 'primary' ? '#FFFFFF' : DECK_THEME.ink,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});

/** The allowance line. Shows a real number or says why it cannot. */
export function QuotaLine({ status }: { status: NarrativeAiStatus | null }): React.JSX.Element {
  if (!status) {
    return <span style={{ fontSize: 10, color: DECK_THEME.slateLight }} data-testid="ai-quota">Checking your AI allowance...</span>;
  }
  if (status.cap === null || status.remaining === null) {
    // Deliberately NOT rendered as "0 left": an unknown allowance and a spent
    // one look identical to a user, and only one of them is true.
    return (
      <span style={{ fontSize: 10, color: DECK_THEME.slateLight }} data-testid="ai-quota">
        AI allowance not available{status.planKey ? ` for the ${status.planKey} plan` : ''}.
      </span>
    );
  }
  const low = status.remaining <= Math.max(1, Math.round(status.cap * 0.1));
  return (
    <span style={{ fontSize: 10, color: status.remaining === 0 ? DECK_THEME.red : low ? DECK_THEME.navy : DECK_THEME.slateLight }} data-testid="ai-quota">
      {status.remaining} of {status.cap} AI generations left this month
    </span>
  );
}

/** The hard stop, with the upgrade route. Shown only when the cap is spent. */
export function CapReachedNotice({ status }: { status: NarrativeAiStatus }): React.JSX.Element {
  return (
    <div
      data-testid="ai-cap-reached"
      style={{
        border: `1px solid ${DECK_THEME.red}`, borderRadius: 5, padding: 10,
        background: '#FBF2F2', fontSize: 11, color: DECK_THEME.ink, lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, color: DECK_THEME.red, marginBottom: 3 }}>Monthly AI limit reached</div>
      You have used all {status.cap} generations included in the {status.planKey ?? 'current'} plan this month. The allowance resets at the start of next month.
      <div style={{ marginTop: 7 }}>
        <Link href="/pricing/refm" style={{ color: DECK_THEME.navy, fontWeight: 700, textDecoration: 'underline' }} data-testid="ai-upgrade-link">
          Compare plans for a higher allowance
        </Link>
      </div>
    </div>
  );
}

interface PanelProps {
  projectId: string;
  deck: Deck;
  model: unknown;
  /** Project currency. Lives on the project, not on deck settings, and is sent
   *  so the grounded figures read in the same units as the slides. */
  currency: string;
  status: NarrativeAiStatus | null;
  /** The block currently selected on the canvas, if any. */
  selectedObjectId: string | null;
  onStatusRefresh: (next: Partial<NarrativeAiStatus>) => void;
  onDrafts: (drafts: NarrativeDraft[]) => void;
  onNotice: (msg: string) => void;
}

/**
 * The properties-panel section. Renders one row per narrative block the deck
 * actually exposes, so a deck whose scenario slide was auto-omitted simply has
 * no scenario row rather than a button that cannot work.
 */
export function NarrativeAiPanel({
  projectId, deck, model, currency, status, selectedObjectId, onStatusRefresh, onDrafts, onNotice,
}: PanelProps): React.JSX.Element | null {
  const [busy, setBusy] = useState<IcNarrativeFieldKey | 'all' | null>(null);
  const targets = useMemo(() => findNarrativeTargets(deck), [deck]);

  const remaining = status?.remaining ?? null;
  const blocked = !status?.available;

  const runOne = useCallback(async (target: NarrativeTarget): Promise<NarrativeDraft | null> => {
    const res = await generateIcNarrative(projectId, {
      field: target.field,
      model,
      scale: deck.settings.moneyScale,
      currency,
    });
    if (res.error || !res.data) {
      onNotice(res.error ?? 'The draft could not be generated.');
      return null;
    }
    // The meter reading comes back from the SERVER on every generation, so the
    // displayed allowance tracks the authoritative counter rather than a local
    // guess that could drift across tabs.
    onStatusRefresh({ used: res.data.meter.used, cap: res.data.meter.cap, remaining: res.data.meter.remaining });
    return {
      field: target.field,
      label: res.data.label,
      target,
      draft: res.data.draft,
      risks: res.data.risks,
      audit: res.data.audit,
    };
  }, [projectId, model, deck.settings.moneyScale, currency, onNotice, onStatusRefresh]);

  const generateOne = useCallback(async (target: NarrativeTarget) => {
    setBusy(target.field);
    const d = await runOne(target);
    setBusy(null);
    if (d) onDrafts([d]);
  }, [runOne, onDrafts]);

  const generateAll = useCallback(async () => {
    setBusy('all');
    const out: NarrativeDraft[] = [];
    // Sequential, not parallel: each call is one counted credit, and running
    // them in parallel would race past the cap and burn credits the server then
    // refuses. Stopping at the first refusal is what makes "3 of 5" honest.
    for (const t of targets) {
      const d = await runOne(t);
      if (!d) break;
      out.push(d);
    }
    setBusy(null);
    if (out.length) onDrafts(out);
    if (out.length && out.length < targets.length) {
      onNotice(`Generated ${out.length} of ${targets.length}. The rest were not generated.`);
    }
  }, [targets, runOne, onDrafts, onNotice]);

  // The feature being off is not an error state to explain at length; the
  // section simply does not appear, which is what "should not appear or be
  // disabled with a clear reason" asks for.
  if (status && !status.enabled) return null;

  if (targets.length === 0) {
    return (
      <div style={{ fontSize: 11, color: DECK_THEME.slate, lineHeight: 1.5 }} data-testid="ai-no-targets">
        No narrative blocks were found in this deck. Rebuild from the library to restore the standard IC slides.
      </div>
    );
  }

  const allCost = targets.length;
  const canAll = !blocked && remaining !== null && remaining > 0 && busy === null;

  return (
    <div data-testid="ai-narrative-panel">
      {status && remaining === 0 && status.cap !== null ? <CapReachedNotice status={status} /> : null}

      {blocked && status?.blockedReason && remaining !== 0 ? (
        <div style={{ fontSize: 11, color: DECK_THEME.slate, lineHeight: 1.5, marginBottom: 8 }} data-testid="ai-blocked-reason">
          {status.blockedReason}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0' }}>
        <button
          style={panelBtn('primary', !canAll)}
          disabled={!canAll}
          onClick={() => void generateAll()}
          data-testid="ai-generate-all"
          title={remaining === null ? undefined : `Uses ${allCost} of your ${remaining} remaining generations`}
        >
          {busy === 'all' ? 'Generating...' : `Generate all (${allCost})`}
        </button>
        <QuotaLine status={status} />
      </div>

      {remaining !== null && remaining > 0 && remaining < allCost ? (
        <div style={{ fontSize: 10, color: DECK_THEME.navy, marginBottom: 8, lineHeight: 1.4 }} data-testid="ai-partial-warning">
          Generate all would use {allCost} generations and you have {remaining} left, so it will stop when the allowance runs out.
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 4 }}>
        {targets.map((t) => {
          const spec = IC_NARRATIVE_FIELDS[t.field];
          const isSelected = selectedObjectId === t.objectId;
          const disabled = blocked || busy !== null || remaining === 0;
          return (
            <div
              key={t.field}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 4,
                border: `1px solid ${isSelected ? DECK_THEME.navy : DECK_THEME.rule}`,
                background: isSelected ? DECK_THEME.paleWash : '#FFFFFF',
              }}
              data-testid={`ai-field-row-${t.field}`}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: DECK_THEME.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {spec.label}
                </div>
                <div style={{ fontSize: 9, color: DECK_THEME.slateLight }}>
                  Slide {t.slideIndex + 1}, {t.slideTitle}
                  {t.isPlaceholder ? ' (empty)' : ' (written)'}
                </div>
              </div>
              <button
                style={panelBtn('ghost', disabled)}
                disabled={disabled}
                onClick={() => void generateOne(t)}
                data-testid={`ai-generate-${t.field}`}
                title={t.isPlaceholder ? 'Draft this block from your model figures' : 'Draft a replacement. You review it before anything changes.'}
              >
                {busy === t.field ? '...' : 'Generate'}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 9, color: DECK_THEME.slateLight, marginTop: 8, lineHeight: 1.5 }}>
        Drafts are written from your model figures and land in a review step. Nothing changes on a slide until you apply it.
      </div>
    </div>
  );
}

interface ReviewProps {
  drafts: NarrativeDraft[];
  onApply: (drafts: NarrativeDraft[]) => void;
  onClose: () => void;
}

/**
 * The review step. This is the "editable draft, never auto-saved" rule made
 * physical: the draft is shown beside what it would replace, it is editable in
 * place, and it reaches the slide only when Apply is pressed.
 */
export function NarrativeReviewModal({ drafts, onApply, onClose }: ReviewProps): React.JSX.Element | null {
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const live = drafts.filter((d) => !dismissed[d.field]);
  if (drafts.length === 0) return null;

  const withEdits = (d: NarrativeDraft): NarrativeDraft => ({ ...d, draft: edited[d.field] ?? d.draft });

  return (
    <div
      data-testid="ai-review-modal"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(13,46,90,0.42)', zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF', borderRadius: 8, width: 'min(940px, 96vw)', maxHeight: '88vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 18px 48px rgba(13,46,90,0.3)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${DECK_THEME.rule}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: DECK_THEME.navyDeep }}>
            Review {live.length === 1 ? 'the draft' : `${live.length} drafts`}
          </div>
          <div style={{ fontSize: 11, color: DECK_THEME.slate }}>Edit anything before it goes on the slide. Nothing has changed yet.</div>
          <div style={{ flex: 1 }} />
          <button style={panelBtn('ghost')} onClick={onClose} data-testid="ai-review-close">Close</button>
        </div>

        <div style={{ overflowY: 'auto', padding: 16, display: 'grid', gap: 14 }}>
          {live.map((d) => {
            const value = edited[d.field] ?? d.draft;
            return (
              <div key={d.field} style={{ border: `1px solid ${DECK_THEME.rule}`, borderRadius: 6 }} data-testid={`ai-review-${d.field}`}>
                <div style={{ padding: '8px 10px', background: DECK_THEME.paleWash, borderBottom: `1px solid ${DECK_THEME.rule}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: DECK_THEME.navyDeep }}>{d.label}</div>
                  <div style={{ fontSize: 10, color: DECK_THEME.slate }}>
                    Slide {d.target.slideIndex + 1}, {d.target.slideTitle}
                  </div>
                  <div style={{ flex: 1 }} />
                  {!d.audit.ok ? (
                    <span
                      style={{ fontSize: 10, fontWeight: 700, color: DECK_THEME.red, border: `1px solid ${DECK_THEME.red}`, borderRadius: 3, padding: '1px 6px' }}
                      title={`These figures do not appear in the model data supplied to the draft: ${d.audit.unsupported.map((u) => u.raw).join(', ')}`}
                      data-testid={`ai-audit-flag-${d.field}`}
                    >
                      {d.audit.unsupported.length} figure{d.audit.unsupported.length === 1 ? '' : 's'} to check
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, color: DECK_THEME.green, fontWeight: 700 }} data-testid={`ai-audit-ok-${d.field}`}>
                      Figures check out
                    </span>
                  )}
                </div>

                {!d.audit.ok ? (
                  <div style={{ padding: '6px 10px', fontSize: 10, color: DECK_THEME.red, background: '#FBF2F2', lineHeight: 1.5 }}>
                    {d.audit.unsupported.map((u) => u.raw).join(', ')} could not be matched to a figure in your model. Check these before using the text.
                  </div>
                ) : null}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                  <div style={{ padding: 10, borderRight: `1px solid ${DECK_THEME.rule}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: DECK_THEME.slate, marginBottom: 4 }}>
                      ON THE SLIDE NOW {d.target.isPlaceholder ? '(empty)' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: DECK_THEME.slate, whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto' }}>
                      {d.target.current || '(nothing)'}
                    </div>
                  </div>
                  <div style={{ padding: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: DECK_THEME.navy, marginBottom: 4 }}>DRAFT, EDITABLE</div>
                    <textarea
                      value={value}
                      onChange={(e) => setEdited((m) => ({ ...m, [d.field]: e.target.value }))}
                      data-testid={`ai-draft-text-${d.field}`}
                      style={{
                        width: '100%', minHeight: 150, fontSize: 11, lineHeight: 1.5, color: DECK_THEME.ink,
                        border: `1px solid ${DECK_THEME.rule}`, borderRadius: 4, padding: 8, fontFamily: 'inherit', resize: 'vertical',
                      }}
                    />
                  </div>
                </div>

                <div style={{ padding: '8px 10px', borderTop: `1px solid ${DECK_THEME.rule}`, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button style={panelBtn('ghost')} onClick={() => setDismissed((m) => ({ ...m, [d.field]: true }))} data-testid={`ai-discard-${d.field}`}>
                    Discard
                  </button>
                  <button style={panelBtn('primary')} onClick={() => { onApply([withEdits(d)]); setDismissed((m) => ({ ...m, [d.field]: true })); }} data-testid={`ai-apply-${d.field}`}>
                    Apply to slide
                  </button>
                </div>
              </div>
            );
          })}
          {live.length === 0 ? (
            <div style={{ fontSize: 12, color: DECK_THEME.slate, textAlign: 'center', padding: 20 }}>Every draft has been handled.</div>
          ) : null}
        </div>

        {live.length > 1 ? (
          <div style={{ padding: '10px 16px', borderTop: `1px solid ${DECK_THEME.rule}`, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button style={panelBtn('ghost')} onClick={onClose} data-testid="ai-review-discard-all">Discard the rest</button>
            <button
              style={panelBtn('primary')}
              onClick={() => { onApply(live.map(withEdits)); onClose(); }}
              data-testid="ai-review-apply-all"
            >
              Apply all {live.length} to their slides
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
