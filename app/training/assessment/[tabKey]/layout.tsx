import type { Metadata } from 'next';
import { COURSES } from '@/src/config/courses';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

function resolveSessionName(tabKey: string): string {
  const sep = tabKey.indexOf('_');
  if (sep === -1) return tabKey;
  const shortTitle = tabKey.slice(0, sep).toUpperCase();
  const sessionId  = tabKey.slice(sep + 1);
  const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === shortTitle);
  return course?.sessions.find(s => s.id === sessionId)?.title ?? tabKey;
}

function resolveCourseName(tabKey: string): string {
  if (tabKey.toUpperCase().startsWith('BVM')) return 'Business Valuation Modeling';
  return '3-Statement Financial Modeling';
}

export async function generateMetadata(
  props: { params: Promise<{ tabKey: string }> },
): Promise<Metadata> {
  const { tabKey } = await props.params;
  const decoded = decodeURIComponent(tabKey);
  const session = resolveSessionName(decoded);
  const course  = resolveCourseName(decoded);

  const imageUrl = `${LEARN_URL}/api/training/achievement-image?` +
    `session=${encodeURIComponent(session)}&course=${encodeURIComponent(course)}`;

  return {
    title: `${session} — Assessment | Financial Modeler Pro`,
    description: `${session} assessment — ${course} | Financial Modeler Pro`,
    openGraph: {
      title: `${session} — Financial Modeler Pro 🏆`,
      description: `${course} | Professional Financial Modeling Certification`,
      images: [{ url: imageUrl, width: 1200, height: 630 }],
      url: `${LEARN_URL}/training/assessment/${tabKey}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${session} — Financial Modeler Pro 🏆`,
      description: `${course} | Financial Modeler Pro`,
      images: [imageUrl],
    },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
