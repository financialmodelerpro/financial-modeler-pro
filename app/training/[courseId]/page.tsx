import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCourseWithLessons } from '@/src/lib/cms';
import { VideoPlayer } from '@/src/components/landing/VideoPlayer';

export const revalidate = 60;

export async function generateStaticParams() {
  return [];
}

interface Props {
  params: Promise<{ courseId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { courseId } = await params;
  const result = await getCourseWithLessons(courseId);
  if (!result) return { title: 'Course Not Found' };
  return {
    title: `${result.course.title} — Financial Modeler Pro Training`,
    description: result.course.description,
  };
}

export default async function CourseDetailPage({ params }: Props) {
  const { courseId } = await params;
  const result = await getCourseWithLessons(courseId);
  if (!result) notFound();

  const { course, lessons } = result;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>

      {/* Navbar */}
      <nav style={{ display: 'flex', alignItems: 'center', padding: '0 40px', height: 64, background: 'rgba(13,46,90,0.97)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ fontSize: 22 }}>📐</span>
          <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Financial Modeler Pro</span>
        </Link>
        <div style={{ flex: 1 }} />
        <Link href="/training" style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', textDecoration: 'none', marginRight: 16 }}>← Training Library</Link>
        <Link href="/login" style={{ padding: '6px 16px', background: '#1B4F8A', borderRadius: 7, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none' }}>Launch Platform</Link>
      </nav>

      {/* Course Header */}
      <section style={{ padding: '48px 40px 36px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.15)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ background: 'rgba(26,122,48,0.2)', color: '#86EFAC', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(26,122,48,0.35)', letterSpacing: '0.05em' }}>
              🎓 ALWAYS FREE
            </span>
            <span style={{ background: 'rgba(27,79,138,0.2)', color: '#4A90D9', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(27,79,138,0.35)', letterSpacing: '0.05em' }}>
              {course.category}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{lessons.length} lessons</span>
          </div>
          <h1 style={{ fontSize: 'clamp(22px, 3vw, 36px)', fontWeight: 800, color: '#fff', marginBottom: 12, lineHeight: 1.2 }}>
            {course.title}
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65, maxWidth: 720 }}>
            {course.description}
          </p>
        </div>
      </section>

      {/* Video Player */}
      <section style={{ padding: '40px', maxWidth: 1100, margin: '0 auto' }}>
        {lessons.length > 0 ? (
          <VideoPlayer lessons={lessons} courseTitle={course.title} />
        ) : (
          <div style={{ textAlign: 'center', padding: '80px 24px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Lessons Coming Soon</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>This course is being produced. Check back shortly.</p>
          </div>
        )}
      </section>

      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '24px 40px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 40 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© {new Date().getFullYear()} Financial Modeler Pro</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Structured Modeling. Real-World Finance.</span>
      </footer>
    </div>
  );
}
