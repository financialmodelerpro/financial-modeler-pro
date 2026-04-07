import { NextRequest, NextResponse } from 'next/server';
import { submitAssessmentToAppsScript } from '@/src/lib/training/sheets';

/**
 * POST /api/training/submit-assessment
 *
 * Accepts a PRE-SCORED result from the client and records it in Apps Script.
 * Scoring is done entirely client-side — this endpoint does NOT re-fetch
 * questions or re-score. It only forwards the score to Apps Script for storage.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      tabKey?: string;
      email?: string;
      regId?: string;
      score?: number;
      passed?: boolean;
      isFinal?: boolean;
      attemptNo?: number;
      // Legacy: accept answers array but ignore it (client scores now)
      answers?: number[];
    };

    const { tabKey, email, regId, score, passed, isFinal, attemptNo } = body;

    if (!tabKey || !email || !regId || typeof score !== 'number') {
      return NextResponse.json({ success: false, error: 'Missing required fields (tabKey, email, regId, score)' }, { status: 400 });
    }

    console.log('[submit-assessment] Recording score:', { tabKey, email, score, passed, attemptNo });

    // Record scored result in Apps Script (V8: website scores, Apps Script stores)
    const recordRes = await submitAssessmentToAppsScript({
      tabKey,
      regId,
      email,
      score,
      passed:    passed ?? score >= 70,
      isFinal:   isFinal ?? false,
      attemptNo: attemptNo ?? 1,
    });

    if (!recordRes.success) {
      console.error('[submit-assessment] Apps Script record failed:', recordRes.error, { tabKey, email });
      // Return success anyway — the score was calculated correctly client-side
      // The student should see their result even if the write-back fails
      return NextResponse.json({
        success: true,
        recorded: false,
        warning: 'Score calculated but failed to save to server. It will sync on next attempt.',
      });
    }

    console.log('[submit-assessment] Recorded successfully:', { tabKey, email, score, passed, attemptNo });

    return NextResponse.json({ success: true, recorded: true });
  } catch (err) {
    console.error('[submit-assessment] Error:', err);
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
}
