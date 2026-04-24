import { redirect } from 'next/navigation';

// Certificate Editor moved into the Certificate Designer hub (Certificate Layout tab).
export default function Page() {
  redirect('/admin/certificate-designer?tab=certificate');
}
