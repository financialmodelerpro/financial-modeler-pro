import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  try {
    const png = await QRCode.toBuffer(url, {
      type: 'png',
      width: 200,
      margin: 1,
      color: { dark: '#0D2E5A', light: '#FFFFFF' },
    });
    return new NextResponse(png as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
