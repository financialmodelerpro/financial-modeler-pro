import { NextRequest, NextResponse } from 'next/server';
import { submitAssessment } from '@/src/lib/sheets';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { tabKey?: string; email?: string; regId?: string; answers?: number[] };
    const { tabKey, email, regId, answers } = body;

    if (!tabKey || !email || !regId || !Array.isArray(answers)) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const result = await submitAssessment(tabKey, email, regId, answers);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
}
