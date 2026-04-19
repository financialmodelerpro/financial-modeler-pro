'use client';

import { useEffect, useState, useCallback } from 'react';
import { RichTextarea } from '@/src/components/admin/RichTextarea';
import type {
  LiveSessionAssessment,
  LiveSessionQuestion,
} from '@/src/lib/training/liveSessionAssessments';

const NAVY = '#1B3A6B';
const BLUE = '#1B4F8A';
const BORDER = '#E5E7EB';
const LIGHT_BG = '#F8FAFC';
const GREEN = '#2EAA4A';
const DANGER = '#DC2626';

interface Props {
  sessionId: string;
  onMessage?: (msg: string, type: 'success' | 'error') => void;
}

function uid(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyQuestion(order: number): LiveSessionQuestion {
  return {
    id: uid(),
    question: '',
    options: ['', '', '', ''],
    correct_index: 0,
    explanation: '',
    order,
  };
}

const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
  background: bg, color: fg, cursor: 'pointer',
});

const field: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: NAVY, background: '#fff', boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif",
};

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280',
  marginBottom: 4, letterSpacing: '0.04em',
};

export function LiveSessionAssessmentEditor({ sessionId, onMessage }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [passThreshold, setPassThreshold] = useState(70);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [timerMinutes, setTimerMinutes] = useState<string>('');
  const [requireWatch, setRequireWatch] = useState(true);
  const [watchThreshold, setWatchThreshold] = useState(70);
  const [questions, setQuestions] = useState<LiveSessionQuestion[]>([]);
  const [editingQId, setEditingQId] = useState<string | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkJson, setBulkJson] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/live-sessions/${sessionId}/assessment`);
      if (!res.ok) { setLoaded(true); return; }
      const j = (await res.json()) as { assessment: LiveSessionAssessment | null };
      if (j.assessment) {
        setEnabled(j.assessment.enabled);
        setPassThreshold(j.assessment.pass_threshold);
        setMaxAttempts(j.assessment.max_attempts);
        setTimerMinutes(j.assessment.timer_minutes != null ? String(j.assessment.timer_minutes) : '');
        setRequireWatch(j.assessment.require_watch_before_assessment);
        setWatchThreshold(j.assessment.watch_threshold);
        setQuestions((j.assessment.questions ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      }
    } catch { /* noop */ }
    setLoaded(true);
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  function addQuestion() {
    const next = emptyQuestion(questions.length);
    setQuestions(q => [...q, next]);
    setEditingQId(next.id);
  }

  function updateQ(id: string, patch: Partial<LiveSessionQuestion>) {
    setQuestions(q => q.map(it => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeQ(id: string) {
    if (!confirm('Delete this question?')) return;
    setQuestions(q => q.filter(it => it.id !== id).map((it, i) => ({ ...it, order: i })));
  }

  function moveQ(id: string, direction: -1 | 1) {
    setQuestions(prev => {
      const arr = [...prev];
      const idx = arr.findIndex(q => q.id === id);
      if (idx === -1) return prev;
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= arr.length) return prev;
      [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
      return arr.map((q, i) => ({ ...q, order: i }));
    });
  }

  async function save() {
    for (const q of questions) {
      if (!q.question.trim()) {
        onMessage?.('Every question must have text.', 'error');
        return;
      }
      if (q.options.length < 2 || q.options.some(o => !o.trim())) {
        onMessage?.(`Question "${q.question.slice(0, 30)}…" needs ≥2 non-empty options.`, 'error');
        return;
      }
      if (q.correct_index < 0 || q.correct_index >= q.options.length) {
        onMessage?.('Each question needs a correct answer selected.', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        enabled,
        pass_threshold: passThreshold,
        max_attempts: maxAttempts,
        timer_minutes: timerMinutes.trim() === '' ? null : Number(timerMinutes),
        require_watch_before_assessment: requireWatch,
        watch_threshold: watchThreshold,
        questions: questions.map((q, i) => ({ ...q, order: i })),
      };
      const res = await fetch(`/api/admin/live-sessions/${sessionId}/assessment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Save failed');
      }
      onMessage?.('Assessment saved', 'success');
    } catch (e) {
      onMessage?.((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Delete the assessment for this session? All student attempts remain but the quiz itself will be removed.')) return;
    try {
      const res = await fetch(`/api/admin/live-sessions/${sessionId}/assessment`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setEnabled(false);
      setQuestions([]);
      onMessage?.('Assessment deleted', 'success');
    } catch (e) {
      onMessage?.((e as Error).message, 'error');
    }
  }

  function importBulk() {
    try {
      const parsed = JSON.parse(bulkJson) as Array<Partial<LiveSessionQuestion>>;
      if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of questions.');
      const base = questions.length;
      const normalized = parsed.map((q, i): LiveSessionQuestion => ({
        id: q.id && typeof q.id === 'string' ? q.id : uid(),
        question: String(q.question ?? '').trim(),
        options: Array.isArray(q.options) ? q.options.map(String) : ['', '', '', ''],
        correct_index: Number.isFinite(q.correct_index) ? Number(q.correct_index) : 0,
        explanation: q.explanation ? String(q.explanation) : '',
        order: base + i,
      }));
      setQuestions(q => [...q, ...normalized]);
      setBulkJson('');
      setShowBulkImport(false);
      onMessage?.(`Imported ${normalized.length} question${normalized.length === 1 ? '' : 's'}`, 'success');
    } catch (e) {
      onMessage?.(`Invalid JSON: ${(e as Error).message}`, 'error');
    }
  }

  if (!loaded) return <div style={{ padding: 12, color: '#6B7280', fontSize: 12 }}>Loading assessment…</div>;

  return (
    <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 16, background: LIGHT_BG }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: NAVY }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Enable Assessment for this Session
        </label>
        <span style={{ fontSize: 11, color: '#6B7280' }}>
          Students can earn an achievement card by watching OR by passing this quiz.
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={label}>PASS THRESHOLD</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={50} max={100} step={5}
              value={passThreshold}
              onChange={e => setPassThreshold(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: NAVY, minWidth: 40 }}>{passThreshold}%</span>
          </div>
        </div>
        <div>
          <label style={label}>MAX ATTEMPTS</label>
          <input
            type="number" min={1} max={10}
            value={maxAttempts}
            onChange={e => setMaxAttempts(Math.max(1, Number(e.target.value) || 1))}
            style={field}
          />
        </div>
        <div>
          <label style={label}>TIMER (MIN, OPTIONAL)</label>
          <input
            type="number" min={0}
            placeholder="no timer"
            value={timerMinutes}
            onChange={e => setTimerMinutes(e.target.value)}
            style={field}
          />
        </div>
        <div>
          <label style={label}>WATCH THRESHOLD</label>
          <input
            type="number" min={0} max={100}
            value={watchThreshold}
            onChange={e => setWatchThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            style={field}
          />
        </div>
      </div>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: NAVY, marginBottom: 18 }}>
        <input type="checkbox" checked={requireWatch} onChange={e => setRequireWatch(e.target.checked)} />
        Require {watchThreshold}% watch before assessment
      </label>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>
          Questions ({questions.length})
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={addQuestion} style={btn(BLUE)}>+ Add Question</button>
          <button onClick={() => setShowBulkImport(s => !s)} style={btn('#fff', NAVY)} >
            {showBulkImport ? 'Hide Bulk Import' : 'Bulk Import JSON'}
          </button>
        </div>
      </div>

      {showBulkImport && (
        <div style={{ marginBottom: 16, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>
            Paste a JSON array. Each item: {`{ "question": "…", "options": ["a","b","c","d"], "correct_index": 1, "explanation": "…" }`}
          </div>
          <textarea
            value={bulkJson}
            onChange={e => setBulkJson(e.target.value)}
            rows={6}
            style={{ ...field, fontFamily: 'monospace', fontSize: 11 }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={importBulk} style={btn(GREEN)}>Append Questions</button>
            <button onClick={() => { setShowBulkImport(false); setBulkJson(''); }} style={btn('#fff', '#6B7280')}>Cancel</button>
          </div>
        </div>
      )}

      {questions.length === 0 ? (
        <div style={{ padding: 18, textAlign: 'center', color: '#9CA3AF', fontSize: 12, background: '#fff', border: `1px dashed ${BORDER}`, borderRadius: 6 }}>
          No questions yet. Click &quot;+ Add Question&quot; to create one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.map((q, idx) => {
            const isEditing = editingQId === q.id;
            const correctLetter = String.fromCharCode(65 + q.correct_index);
            return (
              <div key={q.id} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: isEditing ? 10 : 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.04em', marginBottom: 3 }}>QUESTION {idx + 1}</div>
                    <div style={{ fontSize: 13, color: NAVY, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                         dangerouslySetInnerHTML={{ __html: q.question || '<em style="color:#9CA3AF">Untitled question</em>' }} />
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                      {q.options.length} options · correct: {correctLetter}
                      {q.explanation ? ' · has explanation' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => moveQ(q.id, -1)} disabled={idx === 0}
                            style={{ ...btn('#fff', NAVY), padding: '6px 10px', opacity: idx === 0 ? 0.3 : 1, border: `1px solid ${BORDER}` }}>↑</button>
                    <button onClick={() => moveQ(q.id, 1)} disabled={idx === questions.length - 1}
                            style={{ ...btn('#fff', NAVY), padding: '6px 10px', opacity: idx === questions.length - 1 ? 0.3 : 1, border: `1px solid ${BORDER}` }}>↓</button>
                    <button onClick={() => setEditingQId(isEditing ? null : q.id)}
                            style={{ ...btn(isEditing ? NAVY : '#fff', isEditing ? '#fff' : NAVY), padding: '6px 12px', border: `1px solid ${NAVY}` }}>
                      {isEditing ? 'Close' : 'Edit'}
                    </button>
                    <button onClick={() => removeQ(q.id)} style={{ ...btn(DANGER), padding: '6px 10px' }}>🗑</button>
                  </div>
                </div>

                {isEditing && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px dashed ${BORDER}`, paddingTop: 10 }}>
                    <div>
                      <label style={label}>QUESTION TEXT</label>
                      <RichTextarea
                        value={q.question}
                        onChange={html => updateQ(q.id, { question: html })}
                        minHeight={70}
                        placeholder="What is the primary purpose of…"
                      />
                    </div>

                    <div>
                      <label style={label}>OPTIONS (click the radio to mark the correct answer)</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {q.options.map((opt, oi) => (
                          <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0, width: 26 }}>
                              <input
                                type="radio"
                                name={`correct_${q.id}`}
                                checked={q.correct_index === oi}
                                onChange={() => updateQ(q.id, { correct_index: oi })}
                              />
                            </label>
                            <span style={{ fontSize: 12, fontWeight: 700, color: q.correct_index === oi ? GREEN : '#6B7280', width: 16 }}>
                              {String.fromCharCode(65 + oi)}
                            </span>
                            <input
                              value={opt}
                              onChange={e => {
                                const next = [...q.options];
                                next[oi] = e.target.value;
                                updateQ(q.id, { options: next });
                              }}
                              placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                              style={{ ...field, background: q.correct_index === oi ? '#F0FFF4' : '#fff', borderColor: q.correct_index === oi ? GREEN : BORDER }}
                            />
                            {q.options.length > 2 && (
                              <button
                                onClick={() => {
                                  const next = q.options.filter((_, i) => i !== oi);
                                  const newCorrect = q.correct_index === oi ? 0 : q.correct_index > oi ? q.correct_index - 1 : q.correct_index;
                                  updateQ(q.id, { options: next, correct_index: newCorrect });
                                }}
                                style={{ ...btn('#fff', DANGER), padding: '4px 8px', border: `1px solid ${BORDER}` }}>
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                        {q.options.length < 6 && (
                          <button onClick={() => updateQ(q.id, { options: [...q.options, ''] })}
                                  style={{ ...btn('#fff', BLUE), border: `1px solid ${BORDER}`, alignSelf: 'flex-start' }}>
                            + Add Option
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label style={label}>EXPLANATION (shown to students after they pass)</label>
                      <RichTextarea
                        value={q.explanation ?? ''}
                        onChange={html => updateQ(q.id, { explanation: html })}
                        minHeight={60}
                        placeholder="Optional — explain why the correct answer is correct."
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
        <button onClick={save} disabled={saving} style={{ ...btn(GREEN), opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Assessment'}
        </button>
        <button onClick={remove} style={btn('#fff', DANGER)}>Delete Assessment</button>
      </div>
    </div>
  );
}
