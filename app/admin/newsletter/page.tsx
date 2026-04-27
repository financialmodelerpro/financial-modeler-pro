import { redirect } from 'next/navigation';

export default function NewsletterRedirectPage() {
  redirect('/admin/communications-hub?tab=newsletter');
}
