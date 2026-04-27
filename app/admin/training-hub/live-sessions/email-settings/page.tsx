import { redirect } from 'next/navigation';

export default function EmailSettingsRedirectPage() {
  redirect('/admin/communications-hub?tab=email-settings');
}
