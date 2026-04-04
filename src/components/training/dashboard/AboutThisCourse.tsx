'use client';

import { useState } from 'react';
import type { CourseDescription } from './types';

interface AboutThisCourseProps {
  desc: CourseDescription;
  course: { title: string; shortTitle: string };
}

export function AboutThisCourse({ desc, course }: AboutThisCourseProps) {
  const [open, setOpen] = useState(false);
  const metaItems: { icon: string; label: string }[] = [];
  if (desc.durationHours) metaItems.push({ icon: '⏱', label: `${desc.durationHours} Hours` });
  if (desc.skillLevel)    metaItems.push({ icon: '📊', label: desc.skillLevel });
  if (desc.language)      metaItems.push({ icon: '🌐', label: desc.language });

  return (
    <div style={{ marginBottom: 20, borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: open ? '#F5F7FA' : '#F9FAFB',
          border: 'none', cursor: 'pointer', borderBottom: open ? '1px solid #E5E7EB' : 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#1B3A6B' }}>
          <span style={{ fontSize: 15 }}>ℹ️</span> About This Course
        </span>
        <span style={{ fontSize: 11, color: '#9CA3AF' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '18px 18px 20px' }}>
          {/* Title + meta */}
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>{course.title}</div>
          {metaItems.length > 0 && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              {metaItems.map(m => (
                <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151', fontWeight: 600 }}>
                  <span style={{ fontSize: 13 }}>{m.icon}</span>{m.label}
                </div>
              ))}
            </div>
          )}

          {/* Full description */}
          {desc.fullDescription && (
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.65, margin: '0 0 14px' }}>
              {desc.fullDescription}
            </p>
          )}

          {/* What You Will Learn */}
          {desc.whatYouLearn && desc.whatYouLearn.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                What You Will Learn
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {desc.whatYouLearn.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: '#2EAA4A', fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
