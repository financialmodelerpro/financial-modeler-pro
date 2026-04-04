import Link from 'next/link';
import Image from 'next/image';
import type { Course } from '@/src/lib/shared/cms';

export function CourseCard({ course }: { course: Course }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #E8F7EC', boxShadow: '0 2px 8px rgba(26,122,48,0.07)', display: 'flex', flexDirection: 'column' }}>
      {course.thumbnail_url ? (
        <div style={{ position: 'relative', width: '100%', height: 160, background: '#F4F7FC' }}>
          <Image src={course.thumbnail_url} alt={course.title} fill style={{ objectFit: 'cover' }} />
        </div>
      ) : (
        <div style={{ height: 160, background: 'linear-gradient(135deg, #1A7A30, #2EAA4A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>🎓</div>
      )}
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ background: '#E8F7EC', color: '#1A7A30', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
            Always Free
          </span>
          <span style={{ fontSize: 11, color: '#6B7280' }}>{course._lesson_count ?? 0} lessons</span>
        </div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1B3A6B', lineHeight: 1.4, flex: 1 }}>{course.title}</h3>
        <Link
          href={`/training/${course.id}`}
          style={{ marginTop: 12, display: 'block', textAlign: 'center', padding: '8px', background: '#1A7A30', color: 'white', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
        >
          Watch Free →
        </Link>
      </div>
    </div>
  );
}
