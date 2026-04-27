import { redirect } from 'next/navigation';

export default function ShareTemplatesRedirectPage() {
  redirect('/admin/communications-hub?tab=share-templates');
}
