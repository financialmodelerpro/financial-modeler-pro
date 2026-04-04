import { NextRequest, NextResponse } from 'next/server';
import { getCertifierCredential } from '@/src/lib/training/certifier';

export async function GET(req: NextRequest) {
  const uuid = req.nextUrl.searchParams.get('uuid');
  if (!uuid) {
    return NextResponse.json({ imageUrl: null }, { status: 400 });
  }

  const credential = await getCertifierCredential(uuid);

  if (!credential) {
    return NextResponse.json(
      { imageUrl: null },
      {
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=300' },
      },
    );
  }

  return NextResponse.json(
    {
      imageUrl:    credential.imageUrl || null,
      certUrl:     credential.certUrl || null,
      courseTitle: credential.courseTitle || null,
      issuedOn:    credential.issuedOn || null,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'public, max-age=3600' },
    },
  );
}
