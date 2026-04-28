import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SetPasswordFormPage } from './SetPasswordForm';

export const revalidate = 0;

export default function SetPasswordPage() {
  return <><NavbarServer /><SetPasswordFormPage /></>;
}
