'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CourseConfig } from '@/src/config/courses';

interface Props {
  course: CourseConfig;
  accentColor: string;
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
  sessionLabel: string;   // e.g. "18 Sessions" or "6 Lessons"
}

export function CurriculumCard({
  course,
  accentColor,
  badgeBg,
  badgeColor,
  badgeBorder,
  sessionLabel,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid #E5E7EB', borderLeft: `4px solid ${accentColor}`,
      padding: '32px 28px',
      boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: accentColor, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            {course.shortTitle}
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0D2E5A', margin: 0, lineHeight: 1.3 }}>
            {course.title}
          </h3>
        </div>
        <span style={{
          flexShrink: 0, marginLeft: 12,
          fontSize: 11, fontWeight: 700, padding: '4px 10px',
          borderRadius: 20, background: badgeBg, color: badgeColor,
          border: `1px solid ${badgeBorder}`, whiteSpace: 'nowrap',
        }}>
          {sessionLabel}
        </span>
      </div>

      <p style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.65, marginBottom: 20 }}>
        {course.description}
      </p>

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: '#F0FFF4', border: '1px solid #BBF7D0',
        borderRadius: 6, padding: '5px 12px', marginBottom: 20,
      }}>
        <span style={{ fontSize: 14 }}>✅</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#15803D' }}>
          Certificate issued via Certifier.io
        </span>
      </div>

      {/* View Curriculum toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '11px 16px', borderRadius: 7,
          background: open ? accentColor : 'transparent',
          border: `1.5px solid ${accentColor}`,
          color: open ? '#fff' : accentColor,
          fontWeight: 700, fontSize: 13, cursor: 'pointer',
          marginBottom: open ? 0 : undefined,
        }}
      >
        <span>{open ? 'Hide Curriculum' : 'View Curriculum'}</span>
        <span style={{ fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Curriculum list */}
      {open && (
        <div style={{ marginTop: 12, borderRadius: 8, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
          {course.sessions.map((session, idx) => (
            <div
              key={session.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '11px 16px',
                borderTop: idx === 0 ? 'none' : '1px solid #F3F4F6',
                background: session.isFinal ? '#FFFBEB' : idx % 2 === 0 ? '#fff' : '#F9FAFB',
              }}
            >
              {/* Number / final marker */}
              <span style={{
                flexShrink: 0,
                width: 24, height: 24, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 800,
                background: session.isFinal ? '#FEF3C7' : accentColor + '18',
                color: session.isFinal ? '#B45309' : accentColor,
                border: `1px solid ${session.isFinal ? '#FDE68A' : accentColor + '40'}`,
                marginTop: 1,
              }}>
                {session.isFinal ? '★' : idx + 1}
              </span>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: session.isFinal ? 700 : 500, color: '#1B3A6B', lineHeight: 1.4 }}>
                  {session.title}
                </div>
                {session.isFinal && (
                  <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>
                    Final Exam · {session.questionCount} questions · {session.passingScore}% to pass
                  </div>
                )}
              </div>

              {/* Live indicator if YouTube URL set */}
              {session.youtubeUrl && !session.isFinal && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#15803D', background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 4, padding: '2px 7px', flexShrink: 0 }}>
                  ▶ Live
                </span>
              )}
            </div>
          ))}

          {/* Enrol CTA at bottom */}
          <div style={{ padding: '14px 16px', background: accentColor + '08', borderTop: `1px solid ${accentColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#6B7280' }}>
              Free to enrol · Certificates issued on completion
            </span>
            <Link
              href="/training/register"
              style={{
                fontSize: 12, fontWeight: 700, padding: '8px 20px',
                borderRadius: 6, background: accentColor, color: '#fff',
                textDecoration: 'none',
              }}
            >
              Enrol Free →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
