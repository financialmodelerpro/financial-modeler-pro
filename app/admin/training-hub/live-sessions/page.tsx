import { redirect } from 'next/navigation';

/** Moved into Live Training (2026-11-08): single sessions are its second tab. */
export default function LiveSessionsRedirect() {
  redirect('/admin/training-hub/live-training?tab=sessions');
}
