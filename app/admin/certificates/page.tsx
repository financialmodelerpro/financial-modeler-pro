import { redirect } from 'next/navigation';

// Templates upload moved into the Certificate Designer hub (Templates tab).
// The "Issued Certificates" list section that previously lived on this page
// was a duplicate of /admin/training-hub/certificates and was removed.
export default function Page() {
  redirect('/admin/certificate-designer');
}
