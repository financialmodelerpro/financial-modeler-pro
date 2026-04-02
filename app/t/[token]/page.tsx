import { redirect } from 'next/navigation';

// Permanently redirect old /t/[token] links to the new canonical URL
export default async function OldTranscriptRedirect(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  redirect(`/training/transcript/${token}`);
}
