import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublishedCourses } from '@/src/lib/cms';
import { CourseCard } from '@/src/components/landing/CourseCard';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Free Training Library — Financial Modeler Pro',
  description: 'Free video courses on real estate financial modeling. Learn deal structuring, development finance, and professional modeling from first principles.',
};

export default async function TrainingPage() {
  const courses = await getPublishedCourses();

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>

      {/* Navbar */}
      <nav style={{ display: 'flex', alignItems: 'center', padding: '0 40px', height: 64, background: 'rgba(13,46,90,0.97)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ fontSize: 22 }}>📐</span>
          <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Financial Modeler Pro</span>
        </Link>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/articles" style={{ padding: '6px 14px', fontSize: 13, color: 'rgba(255,255,255,0.65)', textDecoration: 'none' }}>Articles</Link>
          <Link href="/about"    style={{ padding: '6px 14px', fontSize: 13, color: 'rgba(255,255,255,0.65)', textDecoration: 'none' }}>About</Link>
          <Link href="/login"    style={{ padding: '6px 16px', background: '#1B4F8A', borderRadius: 7, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none' }}>Launch Platform →</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ padding: '72px 40px 56px', borderBottom: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'rgba(26,122,48,0.2)', border: '1px solid rgba(26,122,48,0.4)',
            borderRadius: 20, padding: '5px 16px', fontSize: 12,
            color: '#86EFAC', fontWeight: 700, marginBottom: 20, letterSpacing: '0.03em',
          }}>
            🎓 Always 100% Free — No Sign-Up Required
          </div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: '#fff', marginBottom: 16 }}>
            Free Training Library
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65 }}>
            Video courses on real estate financial modeling taught by practitioners. From first principles to advanced deal structuring.
          </p>
        </div>
      </section>

      {/* Courses Grid */}
      <section style={{ padding: '64px 40px', maxWidth: 1100, margin: '0 auto' }}>
        {courses.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <div style={{ fontSize: 56, marginBottom: 20 }}>🎓</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Courses Coming Soon</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 32, maxWidth: 480, margin: '0 auto 32px' }}>
              Free video training on real estate financial modeling is in production. The first course will cover Module 1 end-to-end — from project setup to debt/equity scheduling.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20, maxWidth: 880 }}>
              {PLACEHOLDER_COURSES.map((c) => (
                <div key={c.title} style={{ background: 'rgba(26,122,48,0.07)', border: '1px dashed rgba(26,122,48,0.25)', borderRadius: 12, padding: 24 }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>{c.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{c.lessons} lessons · Coming Soon</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* CTA */}
      <section style={{ padding: '64px 40px', textAlign: 'center', background: 'rgba(0,0,0,0.15)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 12 }}>Ready to Practice What You Learn?</h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 28 }}>
          Apply every concept directly in Financial Modeler Pro — the platform built for the methodology taught in these courses.
        </p>
        <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '12px 32px', borderRadius: 8, textDecoration: 'none' }}>
          Launch Platform Free →
        </Link>
      </section>

      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '24px 40px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© {new Date().getFullYear()} Financial Modeler Pro</span>
        <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>← Home</Link>
      </footer>
    </div>
  );
}

const PLACEHOLDER_COURSES = [
  { icon: '🏗️', title: 'Module 1: Project Setup & Development Finance', lessons: 12 },
  { icon: '💰', title: 'Revenue Modeling for Real Estate', lessons: 8 },
  { icon: '📈', title: 'Returns Analysis: IRR, NPV & Equity Multiple', lessons: 10 },
];
