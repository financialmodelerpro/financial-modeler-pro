import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { AdminLoginForm } from './LoginForm';

export const revalidate = 0;

export default function AdminLoginPage() {
  return <><NavbarServer /><AdminLoginForm /></>;
}
