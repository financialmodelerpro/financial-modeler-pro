import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    platform: 'financial-modeler-pro',
    version: '3.0',
    timestamp: new Date().toISOString(),
  });
}
