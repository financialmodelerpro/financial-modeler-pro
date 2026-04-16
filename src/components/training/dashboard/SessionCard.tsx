'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import type { SessionProgress } from './types';
import { StatusBadge } from './StatusBadge';
import { FilePreviewModal } from './FilePreviewModal';

export interface SessionCardProps {
  sessionTitle: string;
  sessionId: string;
  maxAttempts: number;
  questionCount: number;
  passingScore: number;
  idx: number;
  prog: SessionProgress | undefined;
  locked: boolean;
  ytUrl: string;
  /** @deprecated — assessment uses internal /training/assessment route now */
  formUrl?: string;
  isFinal: boolean;
  passedCount: number;
  regularCount: number;
  tabKey: string;
  videoDuration: number;
  regId: string;
  noteContent: string;
  onNoteSave: (sessionKey: string, content: string) => void;
  feedbackGiven: boolean;
  onFeedbackRequest: (sessionKey: string, sessionTitle: string) => void;
  /** When true the entire BVM course is locked — show course content but lock Watch + Assessment buttons */
  bvmLocked?: boolean;
  /** Watch Video is locked until the previous session assessment is passed (independent of assessment lock) */
  watchLocked?: boolean;
  /** Server-side timer bypass — admin toggled in course manager, stored in training_settings DB */
  timerBypassed?: boolean;
  /** Course ID for internal watch page link */
  courseId?: string;
  /** Video has been marked complete (from certification_watch_history) */
  isWatched?: boolean;
  /** Video is in progress (from certification_watch_history) */
  isInProgress?: boolean;
}

export function SessionCard({
  sessionTitle, sessionId, maxAttempts, questionCount, passingScore,
  idx, prog, locked, ytUrl, isFinal, passedCount, regularCount,
  tabKey, videoDuration, regId, noteContent, onNoteSave, feedbackGiven, onFeedbackRequest,
  bvmLocked, watchLocked, timerBypassed, courseId, isWatched, isInProgress,
}: SessionCardProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteText, setNoteText] = useState(noteContent);
  const [sessionAttachments, setSessionAttachments] = useState<{ id: string; file_name: string; file_url: string; file_type: string; file_size: number }[]>([]);
  const [attachLoaded, setAttachLoaded] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ file_name: string; file_url: string; file_type: string; file_size: number } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync incoming noteContent (loaded async)
  useEffect(() => { setNoteText(noteContent); }, [noteContent]);

  // Load attachments for this session
  useEffect(() => {
    if (locked || attachLoaded) return;
    fetch(`/api/training/attachments?tabKey=${encodeURIComponent(tabKey)}`)
      .then(r => r.json())
      .then((d: { attachments?: typeof sessionAttachments }) => {
        setSessionAttachments(d.attachments ?? []);
        setAttachLoaded(true);
      })
      .catch(() => setAttachLoaded(true));
  }, [tabKey, locked, attachLoaded]);

  let borderColor = '#E5E7EB';
  let bgColor = '#ffffff';
  if (!locked) {
    if (prog?.passed) { borderColor = '#2EAA4A'; bgColor = '#F0FFF4'; }
    else if (prog && prog.attempts > 0) { borderColor = '#F59E0B'; bgColor = '#FFFBEB'; }
    else { borderColor = '#D1D5DB'; bgColor = '#ffffff'; }
  }

  const attemptsUsed = prog?.attempts ?? 0;
  const attemptsLeft = maxAttempts - attemptsUsed;
  const label = isFinal ? '🏆' : `S${idx + 1}`;

  return (
    <div style={{
      borderRadius: 8, border: '1px solid #E5E7EB',
      borderLeft: `4px solid ${borderColor}`,
      background: bgColor, padding: '14px 18px', marginBottom: 8,
      boxShadow: locked ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
      opacity: locked ? 0.65 : 1,
    }}>
      {/* Row 1: number + title + badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: '#9CA3AF', fontSize: 12, minWidth: 28, paddingTop: 2, flexShrink: 0, fontFamily: 'monospace' }}>
            {locked && !isFinal ? '🔒' : label}
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: isFinal ? 700 : 600, color: '#0D2E5A', fontSize: 14, lineHeight: 1.4 }}>
                {sessionTitle}
              </span>
              {videoDuration > 0 && (
                <span style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                  {`⏱ ${videoDuration >= 60 ? `${Math.floor(videoDuration / 60)} hr${Math.floor(videoDuration / 60) > 1 ? 's' : ''}${videoDuration % 60 > 0 ? ` ${videoDuration % 60} min` : ''}` : `${videoDuration} min`}`}
                </span>
              )}
              {attachLoaded && sessionAttachments.length > 0 && (
                <span style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }} title={`${sessionAttachments.length} attachment${sessionAttachments.length > 1 ? 's' : ''}`}>
                  &#128206; ({sessionAttachments.length})
                </span>
              )}
            </div>
            {isFinal && locked && (
              <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3, fontWeight: 600 }}>
                {passedCount} of {regularCount} sessions passed — complete all to unlock
              </div>
            )}
            {isFinal && !locked && (
              <div style={{ fontSize: 11, color: '#15803D', marginTop: 3, fontWeight: 600 }}>
                {questionCount} questions · 1 attempt only · {passingScore}% to pass
              </div>
            )}
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <StatusBadge locked={locked} prog={prog} />
        </div>
      </div>

      {/* Row 2: score + attempts */}
      {!locked && (
        <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#6B7280', marginBottom: 10, paddingLeft: 38, flexWrap: 'wrap' }}>
          <span>Score: <strong style={{ color: '#374151' }}>{attemptsUsed > 0 ? `${prog!.score}%` : '—'}</strong></span>
          <span>Attempts: <strong style={{ color: '#374151' }}>{attemptsUsed} / {maxAttempts}</strong></span>
          {attemptsLeft < maxAttempts && attemptsLeft > 0 && !prog?.passed && (
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>{attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left</span>
          )}
        </div>
      )}

      {/* Feedback prompt for recently-passed sessions */}
      {prog?.passed && !feedbackGiven && !locked && !isFinal && (
        <div style={{ paddingLeft: 38, marginBottom: 8 }}>
          <button onClick={() => onFeedbackRequest(tabKey, sessionTitle)}
            style={{ fontSize: 10, fontWeight: 700, color: '#C9A84C', background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}>
            ⭐ Rate this session
          </button>
        </div>
      )}

      {/* Row 3: action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: locked ? 0 : 38 }}>
        {/* Watch Video */}
        {bvmLocked ? (
          <span title="Complete 3-Statement Financial Modeling first to unlock"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FEF2F2', color: '#FCA5A5', whiteSpace: 'nowrap', cursor: 'default' }}>
            🔒 Watch Video
          </span>
        ) : watchLocked ? (
          <span title={`Complete Session ${idx} assessment first`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#9CA3AF', whiteSpace: 'nowrap', cursor: 'default' }}>
            🔒 Watch Video
          </span>
        ) : ytUrl ? (
          courseId ? (
            <Link href={`/training/watch/${courseId}/${sessionId}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#FF0000', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ▶ Watch Video
            </Link>
          ) : (
            <a href={ytUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#FF0000', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ▶ Watch Video
            </a>
          )
        ) : !isFinal ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
            📹 Coming Soon
          </span>
        ) : null}

        {/* Assessment status (assessment itself is on watch page) */}
        {bvmLocked ? (
          <span title="Complete 3-Statement Financial Modeling first to unlock"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FEF2F2', color: '#FCA5A5', whiteSpace: 'nowrap', cursor: 'default' }}>
            🔒 {isFinal ? 'Final Exam Locked' : 'Assessment Locked'}
          </span>
        ) : locked ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FEF2F2', color: '#FCA5A5', whiteSpace: 'nowrap' }}>
            🔒 {isFinal ? 'Final Exam Locked' : 'Locked'}
          </span>
        ) : prog?.passed ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0', whiteSpace: 'nowrap' }}>
            ✓ {isFinal ? 'Exam Passed' : 'Assessment Done'}
          </span>
        ) : attemptsUsed >= maxAttempts ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FEF2F2', color: '#DC2626', whiteSpace: 'nowrap' }}>
            No Attempts Left
          </span>
        ) : isWatched && attemptsLeft > 0 ? (
          <Link href={`/training/assessment/${encodeURIComponent(tabKey)}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#2563EB', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            📝 Take Assessment →
          </Link>
        ) : isInProgress ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', whiteSpace: 'nowrap' }}>
            ▶ In Progress
          </span>
        ) : null}
      </div>

      {/* Attachments */}
      {!locked && sessionAttachments.length > 0 && (
        <div style={{ marginTop: 8, paddingLeft: 38, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sessionAttachments.map(att => {
            const icon = att.file_type === 'pdf' ? '📄' : att.file_type === 'docx' ? '📝' : att.file_type === 'pptx' ? '📊' : att.file_type === 'xlsx' ? '📗' : '🖼️';
            const size = att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : '';
            return (
              <button key={att.id} onClick={() => setPreviewFile(att)}
                title="View file"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 11, color: '#374151', cursor: 'pointer' }}>
                <span>{icon}</span>
                <span style={{ fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.file_name}</span>
                {size && <span style={{ color: '#9CA3AF', fontSize: 10 }}>{size}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* File preview modal */}
      {previewFile && (
        <FilePreviewModal
          fileName={previewFile.file_name}
          fileUrl={previewFile.file_url}
          fileType={previewFile.file_type}
          fileSize={previewFile.file_size}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* Notes toggle */}
      {!locked && !isFinal && (
        <div style={{ marginTop: 8, paddingLeft: 38 }}>
          <button onClick={() => setNotesOpen(v => !v)}
            style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            📝 {notesOpen ? 'Hide Notes' : `Study Notes${noteText ? ' ●' : ''}`}
          </button>
          {notesOpen && (
            <div style={{ marginTop: 6 }}>
              <textarea
                value={noteText}
                onChange={e => {
                  const val = e.target.value.slice(0, 2000);
                  setNoteText(val);
                  if (noteTimer.current) clearTimeout(noteTimer.current);
                  noteTimer.current = setTimeout(() => onNoteSave(tabKey, val), 1500);
                }}
                rows={3}
                maxLength={2000}
                placeholder="Add your study notes here… (auto-saved)"
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, fontFamily: 'Inter,sans-serif', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box', color: '#374151', background: '#FEFCE8' }}
              />
              <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 2 }}>{noteText.length}/2000 · auto-saved</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
