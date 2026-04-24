import { redirect } from 'next/navigation';

// Transcript Editor moved into the Certificate Designer hub (Transcript Layout tab).
export default function Page() {
  redirect('/admin/certificate-designer?tab=transcript');
}
