import { redirect } from 'next/navigation';

export default function CommunicationsRedirectPage() {
  redirect('/admin/communications-hub?tab=campaigns');
}
