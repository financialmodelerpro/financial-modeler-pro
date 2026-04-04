'use client';

import { useState } from 'react';
import type { Lesson } from '@/src/lib/shared/cms';
import { extractYouTubeId } from '@/src/lib/shared/cms';

interface Props {
  lessons: Lesson[];
  courseTitle: string;
}

export function VideoPlayer({ lessons, courseTitle }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active     = lessons[activeIndex];
  const youtubeId  = active ? extractYouTubeId(active.youtube_url) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24, alignItems: 'flex-start' }}>
      {/* Video */}
      <div>
        {youtubeId ? (
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <iframe
              src={`https://www.youtube.com/embed/${youtubeId}?autoplay=0&rel=0`}
              title={active?.title ?? courseTitle}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
            />
          </div>
        ) : (
          <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 48 }}>▶️</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>No video available for this lesson</div>
          </div>
        )}

        {active && (
          <div style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{active.title}</h2>
            {active.description && (
              <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65 }}>{active.description}</p>
            )}
            {active.file_url && (
              <a
                href={active.file_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 12, fontWeight: 600, color: '#4A90D9', textDecoration: 'none', padding: '6px 12px', background: 'rgba(27,79,138,0.2)', borderRadius: 6, border: '1px solid rgba(27,79,138,0.4)' }}
              >
                📎 Download Lesson Files
              </a>
            )}
          </div>
        )}
      </div>

      {/* Lesson Sidebar */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {lessons.length} Lessons
        </div>
        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
          {lessons.map((lesson, i) => (
            <button
              key={lesson.id}
              onClick={() => setActiveIndex(i)}
              style={{
                width: '100%', textAlign: 'left', padding: '14px 18px',
                background: i === activeIndex ? 'rgba(27,79,138,0.25)' : 'transparent',
                borderLeft: i === activeIndex ? '3px solid #1B4F8A' : '3px solid transparent',
                border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer', color: i === activeIndex ? '#fff' : 'rgba(255,255,255,0.6)',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: i === activeIndex ? '#4A90D9' : 'rgba(255,255,255,0.3)', flexShrink: 0, marginTop: 2 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: i === activeIndex ? 600 : 400, lineHeight: 1.4 }}>{lesson.title}</div>
                  {lesson.duration_minutes > 0 && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>{lesson.duration_minutes} min</div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
