import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublishedCourses } from '@/src/lib/cms';
import { CourseCard } from '@/src/components/landing/CourseCard';
import { Navbar } from '@/src/components/layout/Navbar';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Free Training Library — Financial Modeler Pro',
  description: 'Free video courses on real estate financial modeling. Learn deal structuring, development finance, and professional modeling from first principles.',
};

export default async function TrainingPage() {
  const courses = await getPublishedCourses();

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>

      <Navbar />
      <div style={{ height: 64 }} />

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
            Financial modeling courses across real estate, valuation, FP&amp;A, and more — taught by practitioners.
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
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
              {PLACEHOLDER_COURSES.map((c) => (
                <div key={c.title} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(26,122,48,0.2)', border: '1px solid rgba(26,122,48,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🎓</div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'rgba(251,191,36,0.15)', color: '#FCD34D', border: '1px solid rgba(252,211,77,0.25)', letterSpacing: '0.06em' }}>COMING SOON</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 8, lineHeight: 1.4 }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 24 }}>{c.lessons} lessons · Free</div>
                  <button style={{ marginTop: 'auto', padding: '9px 0', borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                    Notify Me
                  </button>
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
  { title: 'Real Estate Financial Modeling — Module 1', lessons: 12 },
  { title: 'Business Valuation & DCF Analysis', lessons: 8 },
  { title: 'Returns Analysis: IRR, NPV & Equity Multiple', lessons: 10 },
];
