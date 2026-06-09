import { NextResponse } from 'next/server';

// Force dynamic so the deployed commit SHA is read at request time, not baked
// into a static prerender.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    platform: 'financial-modeler-pro',
    version: '3.0',
    // The deployed git commit (Vercel injects VERCEL_GIT_COMMIT_SHA at build),
    // so the live revision is verifiable from this endpoint.
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    timestamp: new Date().toISOString(),
  });
}
