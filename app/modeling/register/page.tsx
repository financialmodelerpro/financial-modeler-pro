import { isModelingComingSoon } from '@/src/lib/shared/modelingComingSoon';
import { RegisterForm } from './RegisterForm';
import { ModelingComingSoon } from '../ComingSoon';

export const revalidate = 0;

export default async function ModelingRegisterPage() {
  const comingSoon = await isModelingComingSoon();
  if (comingSoon) {
    return <ModelingComingSoon variant="register" />;
  }
  return <RegisterForm />;
}
