import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { TrainingSignInForm } from './SignInForm';

export const revalidate = 0;

export default function TrainingSignInPage() {
  return <><NavbarServer /><TrainingSignInForm /></>;
}
