import { redirect } from 'next/navigation';

// Badge Editor moved into the Certificate Designer hub (Badge Layout tab).
export default function Page() {
  redirect('/admin/certificate-designer?tab=badge');
}
