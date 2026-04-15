import { redirect } from 'next/navigation';

export default function LiveSessionsRedirect() {
  redirect('/training/dashboard?tab=live-sessions');
}
