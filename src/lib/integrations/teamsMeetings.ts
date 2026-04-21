/**
 * Microsoft Teams online-meeting integration via the Graph API.
 *
 * Uses the Azure AD client-credentials OAuth flow (application permissions)
 * to act on behalf of a configured host user. The host user must have a
 * Teams-enabled license and must have granted the registered app the
 * `OnlineMeetings.ReadWrite.All` application permission via admin consent.
 *
 * Env vars (all optional — route code calls `isTeamsConfigured()` first
 * and degrades to manual URL input when credentials are absent):
 *   AZURE_TENANT_ID          Azure AD tenant (GUID)
 *   AZURE_CLIENT_ID          App registration client id (GUID)
 *   AZURE_CLIENT_SECRET      App registration client secret value
 *   TEAMS_HOST_USER_EMAIL    User principal name (email) that owns meetings
 */

interface TokenCache {
  token: string;
  expiresAt: number;
}

let _tokenCache: TokenCache | null = null;

export function isTeamsConfigured(): boolean {
  return (
    !!process.env.AZURE_TENANT_ID &&
    !!process.env.AZURE_CLIENT_ID &&
    !!process.env.AZURE_CLIENT_SECRET &&
    !!process.env.TEAMS_HOST_USER_EMAIL
  );
}

export interface TeamsDialIn {
  conferenceId?: string;
  tollNumber?:   string;
  tollFreeNumber?: string;
  dialInUrl?:    string;
}

export interface TeamsMeeting {
  meetingId:     string;
  joinUrl:       string;
  subject:       string;
  startDateTime: string;
  endDateTime:   string;
  dialIn:        TeamsDialIn;
}

export class TeamsIntegrationError extends Error {
  status?: number;
  detail?: string;
  constructor(message: string, opts: { status?: number; detail?: string } = {}) {
    super(message);
    this.name   = 'TeamsIntegrationError';
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

async function getToken(): Promise<string> {
  if (!isTeamsConfigured()) {
    throw new TeamsIntegrationError('Teams integration not configured. Missing AZURE_* / TEAMS_HOST_USER_EMAIL env vars.');
  }

  // 60s safety margin so a token that's about to expire mid-request still
  // gets rotated before the outbound Graph call.
  if (_tokenCache && _tokenCache.expiresAt - 60_000 > Date.now()) {
    return _tokenCache.token;
  }

  const tenantId     = process.env.AZURE_TENANT_ID!;
  const clientId     = process.env.AZURE_CLIENT_ID!;
  const clientSecret = process.env.AZURE_CLIENT_SECRET!;

  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  });

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new TeamsIntegrationError('Azure AD token request failed', { status: res.status, detail });
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    token:     json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

function extractDialIn(mtg: Record<string, unknown>): TeamsDialIn {
  const audio = mtg.audioConferencing as Record<string, unknown> | undefined;
  if (!audio) return {};
  return {
    conferenceId:   (audio.conferenceId as string | undefined) ?? undefined,
    tollNumber:     (audio.tollNumber as string | undefined) ?? undefined,
    tollFreeNumber: (audio.tollFreeNumber as string | undefined) ?? undefined,
    dialInUrl:      (audio.dialinUrl as string | undefined) ?? undefined,
  };
}

function normalizeMeeting(raw: Record<string, unknown>): TeamsMeeting {
  return {
    meetingId:     (raw.id as string) ?? '',
    joinUrl:       (raw.joinWebUrl as string) ?? (raw.joinUrl as string) ?? '',
    subject:       (raw.subject as string) ?? '',
    startDateTime: (raw.startDateTime as string) ?? '',
    endDateTime:   (raw.endDateTime as string) ?? '',
    dialIn:        extractDialIn(raw),
  };
}

async function graphFetch(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path:   string,
  body?:  unknown,
): Promise<Response> {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

/**
 * Build a structured detail string for a failed Graph response. Captures
 * everything Microsoft's support team needs to triage:
 *   HTTP status, error.code, error.message, innerError.code, request-id
 *   (and client-request-id), plus the raw body as a fallback.
 *
 * The Graph error shape is `{ error: { code, message, innerError: { code,
 * date, request-id, client-request-id } } }`. Some failures (notably the
 * known UnknownError-with-empty-body case on `POST /users/{upn}/onlineMeetings`)
 * carry a useful innerError even when the outer message is blank.
 */
async function buildGraphErrorDetail(res: Response): Promise<string> {
  const status            = res.status;
  const requestId         = res.headers.get('request-id')        ?? '';
  const clientRequestId   = res.headers.get('client-request-id') ?? '';
  const bodyText          = await res.text().catch(() => '');

  let parsedCode    = '';
  let parsedMessage = '';
  let innerCode     = '';
  let innerReqId    = '';
  if (bodyText) {
    try {
      const j = JSON.parse(bodyText) as {
        error?: {
          code?: string;
          message?: string;
          innerError?: { code?: string; 'request-id'?: string };
        };
      };
      parsedCode    = j.error?.code    ?? '';
      parsedMessage = j.error?.message ?? '';
      innerCode     = j.error?.innerError?.code           ?? '';
      innerReqId    = j.error?.innerError?.['request-id'] ?? '';
    } catch { /* body wasn't JSON */ }
  }

  // Single-line detail keeps the existing route-side formatter readable in
  // toast strings; full parts available in Vercel logs.
  const parts: string[] = [`HTTP ${status}`];
  if (parsedCode)    parts.push(`code=${parsedCode}`);
  if (parsedMessage) parts.push(`msg="${parsedMessage}"`);
  if (innerCode)     parts.push(`innerCode=${innerCode}`);
  if (requestId)     parts.push(`request-id=${requestId}`);
  if (clientRequestId) parts.push(`client-request-id=${clientRequestId}`);
  if (innerReqId && innerReqId !== requestId) parts.push(`inner-request-id=${innerReqId}`);
  if (!parsedCode && !parsedMessage && bodyText) {
    parts.push(`body=${bodyText.length > 240 ? bodyText.slice(0, 240) + '...' : bodyText}`);
  }
  return parts.join(' ');
}

export async function createTeamsMeeting(params: {
  subject:       string;
  startDateTime: string;
  endDateTime:   string;
}): Promise<TeamsMeeting> {
  const host = process.env.TEAMS_HOST_USER_EMAIL!;
  const path = `/users/${encodeURIComponent(host)}/onlineMeetings`;
  const res  = await graphFetch('POST', path, {
    subject:       params.subject,
    startDateTime: params.startDateTime,
    endDateTime:   params.endDateTime,
  });

  if (!res.ok) {
    const detail = await buildGraphErrorDetail(res);
    // Mirror to Vercel logs explicitly: route-side formatters truncate
    // long detail strings, and Microsoft request-ids are essential for
    // support tickets when the outer error code is generic (e.g.
    // UnknownError with empty message body).
    console.error('[teamsMeetings] createTeamsMeeting failed', {
      path,
      payload: { subject: params.subject, startDateTime: params.startDateTime, endDateTime: params.endDateTime },
      detail,
    });
    throw new TeamsIntegrationError('Graph API: createTeamsMeeting failed', { status: res.status, detail });
  }

  return normalizeMeeting((await res.json()) as Record<string, unknown>);
}

export async function updateTeamsMeeting(
  meetingId: string,
  updates:   { subject?: string; startDateTime?: string; endDateTime?: string },
): Promise<TeamsMeeting> {
  const host = process.env.TEAMS_HOST_USER_EMAIL!;
  const payload: Record<string, unknown> = {};
  if (updates.subject        !== undefined) payload.subject        = updates.subject;
  if (updates.startDateTime  !== undefined) payload.startDateTime  = updates.startDateTime;
  if (updates.endDateTime    !== undefined) payload.endDateTime    = updates.endDateTime;

  const res = await graphFetch('PATCH', `/users/${encodeURIComponent(host)}/onlineMeetings/${encodeURIComponent(meetingId)}`, payload);
  if (!res.ok) {
    const detail = await buildGraphErrorDetail(res);
    console.error('[teamsMeetings] updateTeamsMeeting failed', { meetingId, detail });
    throw new TeamsIntegrationError('Graph API: updateTeamsMeeting failed', { status: res.status, detail });
  }
  return normalizeMeeting((await res.json()) as Record<string, unknown>);
}

export async function deleteTeamsMeeting(meetingId: string): Promise<void> {
  const host = process.env.TEAMS_HOST_USER_EMAIL!;
  const res  = await graphFetch('DELETE', `/users/${encodeURIComponent(host)}/onlineMeetings/${encodeURIComponent(meetingId)}`);
  // 204 No Content on success; 404 is treated as already-deleted (idempotent)
  if (!res.ok && res.status !== 404) {
    const detail = await buildGraphErrorDetail(res);
    console.error('[teamsMeetings] deleteTeamsMeeting failed', { meetingId, detail });
    throw new TeamsIntegrationError('Graph API: deleteTeamsMeeting failed', { status: res.status, detail });
  }
}

export async function testTeamsConnection(): Promise<{ ok: true; host: string } | { ok: false; error: string; detail?: string }> {
  if (!isTeamsConfigured()) {
    return { ok: false, error: 'Missing one or more env vars: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, TEAMS_HOST_USER_EMAIL' };
  }
  try {
    await getToken();
    const host = process.env.TEAMS_HOST_USER_EMAIL!;
    const res  = await graphFetch('GET', `/users/${encodeURIComponent(host)}?$select=id,userPrincipalName,displayName`);
    if (!res.ok) {
      const detail = await buildGraphErrorDetail(res);
      return { ok: false, error: `Host user lookup failed (HTTP ${res.status})`, detail };
    }
    return { ok: true, host };
  } catch (e) {
    if (e instanceof TeamsIntegrationError) {
      return { ok: false, error: e.message, detail: e.detail };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
