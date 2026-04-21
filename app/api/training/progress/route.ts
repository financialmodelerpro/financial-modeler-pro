import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServerClient } from '@/src/lib/shared/supabase';

/**
 * GET /api/training/progress
 *
 * Supabase-native. Reads:
 *   - training_registrations_meta for student identity
 *   - training_enrollments for course(s) the student is in
 *   - training_assessment_results for per-session scores
 *   - student_certificates for issued-cert state
 *
 * Returns the same ProgressData shape the dashboard already expects so
 * the client side is unchanged. Apps Script is no longer consulted.
 */

const _cache = new Map<string, { data: unknown; at: number }>();
const TTL_MS = 2 * 60 * 1000;

interface SessionProgress {
  sessionId:   string;
  passed:      boolean;
  score:       number;
  attempts:    number;
  completedAt: string | null;
}

interface ProgressData {
  student: {
    name: string;
    email: string;
    registrationId: string;
    course: string;       // 'both' | 'bvm' | '3sfm' - derived from enrollments
    registeredAt: string;
  };
  sessions: SessionProgress[];
  finalPassed: boolean;
  certificateIssued: boolean;
}

function emptyProgress(email: string, registrationId: string): ProgressData {
  return {
    student: {
      name: '',
      email,
      registrationId,
      course: '3sfm',
      registeredAt: '',
    },
    sessions: [],
    finalPassed: false,
    certificateIssued: false,
  };
}

export async function GET(req: NextRequest) {
  let email = '';
  let registrationId = '';

  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('training_session')?.value;
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string; registrationId?: string };
      email = parsed.email ?? '';
      registrationId = parsed.registrationId ?? '';
    }
  } catch { /* ignore */ }

  if (!email || !registrationId) {
    email          = req.nextUrl.searchParams.get('email')          ?? '';
    registrationId = req.nextUrl.searchParams.get('registrationId') ?? '';
  }

  if (!email || !registrationId) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanRegId = registrationId.trim();
  const refresh    = req.nextUrl.searchParams.get('refresh') === '1';
  const cacheKey   = `${cleanEmail}:${cleanRegId}`;

  if (!refresh) {
    const hit = _cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return NextResponse.json({ success: true, data: hit.data, cached: true });
    }
  }

  try {
    const sb = getServerClient();

    const [metaRes, enrollRes, resultsRes, certsRes] = await Promise.all([
      sb.from('training_registrations_meta')
        .select('registration_id, email, name, created_at')
        .eq('registration_id', cleanRegId)
        .maybeSingle(),
      sb.from('training_enrollments')
        .select('course_code')
        .eq('registration_id', cleanRegId),
      sb.from('training_assessment_results')
        .select('tab_key, score, passed, attempts, is_final, completed_at')
        .eq('email', cleanEmail),
      sb.from('student_certificates')
        .select('course_code, cert_status')
        .eq('email', cleanEmail),
    ]);

    const meta         = metaRes.data;
    const enrollments  = enrollRes.data ?? [];
    const results      = resultsRes.data ?? [];
    const certs        = certsRes.data ?? [];

    // Derive enrolled-course signal for legacy callers. Dashboard uses
    // this to decide which course to show; /verify UI doesn't care.
    const enrolledCodes = new Set(enrollments.map(e => (e.course_code ?? '').toUpperCase()));
    const course = enrolledCodes.has('3SFM') && enrolledCodes.has('BVM') ? 'both'
      : enrolledCodes.has('BVM') ? 'bvm'
      : '3sfm';

    // Normalize each training_assessment_results row into SessionProgress.
    // tab_key shape: "3SFM_S1" | "3SFM_Final" | "BVM_L2" | "BVM_Final".
    //   3SFM_Final -> sessionId "S18", BVM_Final -> "L7".
    const sessions: SessionProgress[] = results.map(r => {
      const sep = r.tab_key.indexOf('_');
      const rawId = sep >= 0 ? r.tab_key.slice(sep + 1) : r.tab_key;
      const isBvm = r.tab_key.toUpperCase().startsWith('BVM');
      const sessionId = rawId === 'Final' ? (isBvm ? 'L7' : 'S18') : rawId;
      return {
        sessionId,
        passed:      Boolean(r.passed),
        score:       Number(r.score ?? 0),
        attempts:    Number(r.attempts ?? 0),
        completedAt: (r.completed_at as string | null) ?? null,
      };
    });

    const finalPassed       = results.some(r => r.is_final && r.passed);
    const certificateIssued = certs.some(c => c.cert_status === 'Issued');

    const data: ProgressData = {
      student: {
        name:           meta?.name ?? '',
        email:          cleanEmail,
        registrationId: cleanRegId,
        course,
        registeredAt:   (meta?.created_at as string | null) ?? '',
      },
      sessions,
      finalPassed,
      certificateIssued,
    };

    _cache.set(cacheKey, { data, at: Date.now() });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[training/progress] Unexpected error:', err);
    return NextResponse.json({
      success: true,
      fallback: true,
      data: emptyProgress(cleanEmail, cleanRegId),
    });
  }
}
