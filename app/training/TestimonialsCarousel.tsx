'use client';

import type { Testimonial } from '@/src/lib/shared/cms';

interface Props {
  testimonials: Testimonial[];
  heading: string;
  subheading: string;
}

export function TestimonialsCarousel({ testimonials, heading, subheading }: Props) {
  if (!testimonials.length) return null;

  // Duplicate cards so the scroll loops seamlessly
  const cards = [...testimonials, ...testimonials];

  return (
    <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 0', overflow: 'hidden' }}>
      {/* Heading - full width centred */}
      <div style={{ textAlign: 'center', marginBottom: 44, padding: '0 40px' }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: '#2EAA4A',
          letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10,
        }}>
          Student Stories
        </div>
        <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: '0 0 10px' }}>
          {heading}
        </h2>
        <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>{subheading}</p>
      </div>

      {/* Scrolling track */}
      <div
        style={{ overflow: 'hidden', position: 'relative' }}
        /* Fade edges */
      >
        {/* Left fade */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 80,
          background: 'linear-gradient(to right, #F5F7FA, transparent)',
          zIndex: 2, pointerEvents: 'none',
        }} />
        {/* Right fade */}
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 80,
          background: 'linear-gradient(to left, #F5F7FA, transparent)',
          zIndex: 2, pointerEvents: 'none',
        }} />

        <div
          className="testimonials-track"
          style={{
            display: 'flex',
            gap: 24,
            width: 'max-content',
            padding: '8px 24px 16px',
            animation: 'testimonialScroll 40s linear infinite',
            willChange: 'transform',
          }}
        >
          {cards.map((t, i) => (
            <Card key={`${t.id}-${i}`} t={t} />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes testimonialScroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .testimonials-track:hover {
          animation-play-state: paused;
        }
      `}</style>
    </section>
  );
}

function parseCourse(t: Testimonial): string | null {
  // course_name comes from student_testimonials; for manual rows it's in the role field
  const haystack = [t.course_name, t.role, t.company].filter(Boolean).join(' ').toUpperCase();
  if (haystack.includes('3SFM') || haystack.includes('SFM')) return '3SFM';
  if (haystack.includes('BVM')) return 'BVM';
  return null;
}

function courseBadge(t: Testimonial) {
  const course = parseCourse(t);
  if (!course) return null;
  return (
    <span style={{
      display: 'inline-block',
      background: '#1B4F8A', color: '#fff',
      fontSize: 10, fontWeight: 700,
      padding: '2px 8px', borderRadius: 20,
      letterSpacing: '0.04em',
    }}>
      {course}
    </span>
  );
}

function Card({ t }: { t: Testimonial }) {
  const initials = t.name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?';
  // Strip "· 3SFM" / "· BVM" suffix from role - shown separately as badge
  const cleanRole = (t.role ?? '').replace(/[\s·]+(?:3SFM|BVM|SFM)[\s·]*/gi, '').trim().replace(/[·\s]+$/, '').trim();
  const subtitle = [cleanRole, t.company].filter(Boolean).join(' · ');

  return (
    <div style={{
      width: 320, flexShrink: 0,
      background: '#fff',
      border: `1px solid ${t.is_featured ? '#C9A84C' : '#E5E7EB'}`,
      borderRadius: 14,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      padding: 24,
      display: 'flex', flexDirection: 'column', gap: 14,
      cursor: 'default',
    }}>
      {/* Stars */}
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} style={{ fontSize: 14, color: i < (t.rating ?? 5) ? '#F59E0B' : '#E5E7EB' }}>★</span>
        ))}
      </div>

      {/* Quote */}
      <p style={{
        fontSize: 13.5, color: '#374151', lineHeight: 1.7,
        fontStyle: 'italic', margin: 0, flex: 1,
      }}>
        &ldquo;{t.text}&rdquo;
      </p>

      {/* Author row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'linear-gradient(135deg,#1B4F8A,#0D2E5A)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t.name}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitle}
            </div>
          )}
          {t.linkedin_url && (
            <a href={t.linkedin_url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4, padding: '3px 8px', background: '#0A66C2', color: '#fff', borderRadius: 4, textDecoration: 'none', fontSize: 11, fontWeight: 600 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffffff">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              LinkedIn
            </a>
          )}
        </div>
        {/* Course badge pushed to right */}
        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
          {courseBadge(t)}
        </div>
      </div>
    </div>
  );
}
