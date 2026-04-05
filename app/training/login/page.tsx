import { redirect } from 'next/navigation';

export default function TrainingLoginRedirect() {
  redirect('/signin');
}
