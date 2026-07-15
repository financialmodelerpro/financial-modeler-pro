'use client';

/**
 * AnnounceArticleButton.tsx (admin, client)
 *
 * Per-article "Announce" action: emails the article to every student and every
 * active subscriber, with modeling-hub users as an opt-in toggle. Mirrors the
 * live-session announcement button, over the wider audience resolved by
 * src/shared/newsletter/announceAudience.ts.
 *
 * The dialog exists to make the blast reviewable BEFORE it fires: it shows who
 * is actually reached (and who is excluded for opting out) rather than sending
 * to an unseen list. Opening it is side-effect free; the GET runs a dry run.
 *
 * Only a published article can be announced: the public page renders published
 * rows only, so announcing a draft would email everyone a link to a 404. The
 * button stays visible but disabled on non-published rows, so the reason is
 * discoverable instead of the action silently missing.
 *
 * No em dashes in this file.
 */

import { useCallback, useEffect, useState } from 'react';

interface Counts {
  students: number;
  subscribers: number;
  modelingUsers: number;
  optedOut: number;
  enrolled: number;
  total: number;
}

interface HistoryRow {
  id: string;
  status: string;
  sent_count: number | null;
  failed_count: number | null;
  sent_at: string | null;
  created_by: string | null;
  source_type: string | null;
}

interface Preview {
  counts: Counts;
  history: HistoryRow[];
  canSend: boolean;
}

interface SendResult { sent: number; failed: number; total: number }

const NAVY = '#1B4F8A';

export function AnnounceArticleButton({
  id, title, status,
}: { id: string; title: string; status: string }): React.JSX.Element {
  const published = status === 'published';

  const [open, setOpen]                 = useState(false);
  const [loading, setLoading]           = useState(false);
  const [sending, setSending]           = useState(false);
  const [preview, setPreview]           = useState<Preview | null>(null);
  const [includeModeling, setIncludeModeling] = useState(false);
  const [error, setError]               = useState('');
  const [confirmResend, setConfirmResend] = useState('');
  const [result, setResult]             = useState<SendResult | null>(null);

  const loadPreview = useCallback(async (withModeling: boolean) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/articles/${id}/announce?includeModelingUsers=${withModeling}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load the audience');
      setPreview(data as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audience');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (open) void loadPreview(includeModeling);
  }, [open, includeModeling, loadPreview]);

  async function send(force: boolean) {
    setSending(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/articles/${id}/announce`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ includeModelingUsers: includeModeling, force }),
      });
      const data = await res.json();
      if (res.status === 409) { setConfirmResend(data.message ?? 'Already announced.'); return; }
      if (!res.ok) throw new Error(data.error ?? 'Send failed');
      setResult({ sent: data.sent, failed: data.failed, total: data.total });
      setConfirmResend('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  function close() {
    setOpen(false);
    setPreview(null);
    setResult(null);
    setError('');
    setConfirmResend('');
  }

  const c = preview?.counts;
  const alreadySent = (preview?.history ?? []).filter(h => h.status !== 'failed');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!published}
        title={published
          ? 'Email this article to students and subscribers'
          : `Only a published article can be announced (this one is ${status}). Publish it first.`}
        style={{
          fontSize: 12, color: published ? NAVY : '#9CA3AF', fontWeight: 600,
          background: 'none', border: 'none', padding: 0,
          cursor: published ? 'pointer' : 'not-allowed',
          fontFamily: 'Inter, sans-serif',
        }}
        data-testid="article-announce"
      >
        Announce
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520,
              padding: 28, fontFamily: 'Inter, sans-serif', maxHeight: '90vh', overflowY: 'auto',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
              Announce article
            </h2>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>{title}</p>

            {result ? (
              <div data-testid="announce-result">
                <div style={{ background: '#E8F7EC', border: '1px solid #A7E3B8', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1A7A30', marginBottom: 4 }}>
                    Sent to {result.sent} {result.sent === 1 ? 'person' : 'people'}
                  </div>
                  {result.failed > 0 && (
                    <div style={{ fontSize: 13, color: '#92400E' }}>
                      {result.failed} failed. Check the campaign in Newsletter for the per-recipient log.
                    </div>
                  )}
                </div>
                <button type="button" onClick={close} style={btn(NAVY)}>Done</button>
              </div>
            ) : (
              <>
                {loading && <p style={{ fontSize: 13, color: '#6B7280' }}>Working out who this reaches...</p>}

                {c && (
                  <>
                    <div style={{ background: '#F4F7FC', border: '1px solid #E8F0FB', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: NAVY }} data-testid="announce-total">
                        {c.total}
                      </div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
                        unique recipients, each emailed once
                      </div>
                      <Row label="Students on the training roster" value={c.students} />
                      <Row label="Active newsletter subscribers" value={c.subscribers} />
                      {includeModeling && <Row label="Modeling hub users" value={c.modelingUsers} />}
                      {c.optedOut > 0 && (
                        <Row label="Excluded (they unsubscribed)" value={c.optedOut} muted />
                      )}
                    </div>

                    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={includeModeling}
                        onChange={e => setIncludeModeling(e.target.checked)}
                        data-testid="announce-include-modeling"
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ fontSize: 13, color: '#374151' }}>
                        Also send to modeling hub users
                        <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF' }}>
                          Students and subscribers are always included.
                        </span>
                      </span>
                    </label>

                    {c.enrolled > 0 && (
                      <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 16, lineHeight: 1.5 }}>
                        {c.enrolled} of these have never been on the newsletter list. They will be
                        added to it so this email carries a working unsubscribe link, and they can
                        opt out of future sends.
                      </p>
                    )}

                    {alreadySent.length > 0 && !confirmResend && (
                      <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: '#92400E' }}>
                        Already announced to {alreadySent[0].sent_count ?? 0} recipients
                        {alreadySent[0].sent_at ? ` on ${new Date(alreadySent[0].sent_at).toLocaleString()}` : ''}.
                      </div>
                    )}
                  </>
                )}

                {confirmResend && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: '#991B1B' }} data-testid="announce-resend-warning">
                    {confirmResend}
                  </div>
                )}

                {error && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: '#991B1B' }} data-testid="announce-error">
                    {error}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" onClick={close} disabled={sending} style={btn('#fff', '#374151')}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void send(Boolean(confirmResend))}
                    disabled={sending || loading || !c || c.total === 0 || preview?.canSend === false}
                    style={btn(confirmResend ? '#B91C1C' : NAVY)}
                    data-testid="announce-send"
                  >
                    {sending
                      ? 'Sending...'
                      : confirmResend
                        ? `Yes, send again to ${c?.total ?? 0}`
                        : `Send to ${c?.total ?? 0}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: muted ? '#9CA3AF' : '#374151' }}>
      <span>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function btn(bg: string, color = '#fff'): React.CSSProperties {
  return {
    flex: 1, padding: '10px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700,
    background: bg, color, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
    border: bg === '#fff' ? '1px solid #D1D5DB' : 'none',
  };
}
