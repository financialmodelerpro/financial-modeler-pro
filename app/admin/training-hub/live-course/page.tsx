import { redirect } from 'next/navigation';

/** Moved into Live Training (2026-11-08): each course has its own page there. */
export default function LiveCourseRedirect() {
  redirect('/admin/training-hub/live-training');
}
