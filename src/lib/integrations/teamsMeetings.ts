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

// Host-user Azure AD object ID, resolved once per process from the configured
// UPN. Required because `POST /users/{upn}/onlineMeetings` returns HTTP 404
// UnknownError under application permissions even when the Application
// Access Policy is correctly granted; `POST /users/{objectId}/onlineMeetings`
// against the same user + same token + same policy succeeds. GET paths
// accept either form, which is why testTeamsConnection passed while meeting
// creation failed. 1h TTL matches the typical token lifetime.
interface HostIdCache {
  id:         string;
  resolvedAt: number;
}
let _hostIdCache: HostIdCache | null = null;
const HOST_ID_TTL_MS = 60 * 60 * 1000;

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

/**
 * Resolve TEAMS_HOST_USER_EMAIL (a UPN) to the user's Azure AD object ID
 * and cache it in-memory. Every mutation path (create/update/delete) uses
 * the GUID because the UPN form of `/users/{id}/onlineMeetings` fails with
 * HTTP 404 UnknownError on the POST surface.
 */
async function getHostUserId(): Promise<string> {
  if (_hostIdCache && Date.now() - _hostIdCache.resolvedAt < HOST_ID_TTL_MS) {
    return _hostIdCache.id;
  }
  const upn = process.env.TEAMS_HOST_USER_EMAIL!;
  const res = await graphFetch('GET', `/users/${encodeURIComponent(upn)}?$select=id`);
  if (!res.ok) {
    const detail = await buildGraphErrorDetail(res);
    console.error('[teamsMeetings] getHostUserId failed', { upn, detail });
    throw new TeamsIntegrationError('Could not resolve Teams host user id', { status: res.status, detail });
  }
  const j = (await res.json()) as { id?: string };
  if (!j.id) {
    throw new TeamsIntegrationError('Teams host user resolved but id field was empty');
  }
  _hostIdCache = { id: j.id, resolvedAt: Date.now() };
  return j.id;
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
  const hostId = await getHostUserId();
  const path   = `/users/${encodeURIComponent(hostId)}/onlineMeetings`;
  const res    = await graphFetch('POST', path, {
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

// ────────────────────────────────────────────────────────────────────────────
// Calendar-event flow (preferred): Outlook event + Teams meeting in one call
//
// `POST /users/{id}/onlineMeetings` only returns a join URL; nothing lands
// on anyone's calendar and Outlook never emails the host. To get a calendar
// entry on Ahmad's Outlook + the automatic "Microsoft Teams meeting" invite
// email, we instead POST to `/users/{id}/events` with `isOnlineMeeting:true`
// and `onlineMeetingProvider:"teamsForBusiness"`. Outlook then:
//   - writes the event to the host's calendar
//   - generates the Teams join URL (response body: `onlineMeeting.joinUrl`)
//   - emails the organizer (and any attendees) the standard meeting invite
//
// We keep the same return shape as createTeamsMeeting so the route layer
// barely changes; `meetingId` carries the Outlook event id from now on.
// Old rows still hold an onlineMeetings id; the try-then-fallback
// wrappers below keep PATCH/DELETE working for them transparently.
//
// Requires `Calendars.ReadWrite` (Application) on the Azure app + admin
// consent. Without it Graph returns 403 ErrorAccessDenied. See route layer
// for the user-facing degradation message.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEZONE = 'Asia/Karachi';

/**
 * Convert a UTC ISO string into the `dateTimeTimeZone` shape Graph events
 * expect: a wall-clock time string in the target timezone, plus the IANA
 * timezone name. Using `sv-SE` locale yields the "YYYY-MM-DD HH:mm:ss"
 * format which we then turn into "YYYY-MM-DDTHH:mm:ss", exactly what
 * Graph wants for `start.dateTime` / `end.dateTime`.
 */
function toGraphDateTime(isoUtc: string, timeZone: string): { dateTime: string; timeZone: string } {
  const d = new Date(isoUtc);
  const localStr = d.toLocaleString('sv-SE', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  return { dateTime: localStr.replace(' ', 'T'), timeZone };
}

function buildEventBody(title: string, description: string): { contentType: 'HTML'; content: string } {
  const safeTitle = title || 'Live Session';
  const desc = (description || '').trim();
  const descBlock = desc
    ? `<p style="font-size: 14px; line-height: 1.6; color: #374151;">${desc}</p>`
    : '';
  return {
    contentType: 'HTML',
    content: `
<div style="font-family: Inter, Arial, sans-serif; color: #0D2E5A;">
  <h2 style="color: #0D2E5A; margin: 0 0 16px;">${safeTitle}</h2>
  ${descBlock}
  <p style="color: #6B7280; font-size: 12px; margin-top: 24px;">
    Hosted by Financial Modeler Pro
  </p>
</div>`.trim(),
  };
}

function normalizeEvent(raw: Record<string, unknown>): TeamsMeeting {
  const onlineMeeting = (raw.onlineMeeting as Record<string, unknown> | undefined) ?? {};
  const start         = (raw.start         as { dateTime?: string } | undefined) ?? {};
  const end           = (raw.end           as { dateTime?: string } | undefined) ?? {};
  return {
    meetingId:     (raw.id as string) ?? '',
    joinUrl:       (onlineMeeting.joinUrl as string) ?? '',
    subject:       (raw.subject as string) ?? '',
    startDateTime: start.dateTime ?? '',
    endDateTime:   end.dateTime   ?? '',
    dialIn:        extractDialIn(onlineMeeting),
  };
}

export async function createCalendarEventWithMeeting(params: {
  subject:       string;
  startDateTime: string;       // UTC ISO
  endDateTime:   string;       // UTC ISO
  timezone?:     string;
  description?:  string;
}): Promise<TeamsMeeting> {
  const hostId   = await getHostUserId();
  const tz       = (params.timezone || '').trim() || DEFAULT_TIMEZONE;
  const path     = `/users/${encodeURIComponent(hostId)}/events`;
  const payload  = {
    subject:               params.subject,
    body:                  buildEventBody(params.subject, params.description ?? ''),
    start:                 toGraphDateTime(params.startDateTime, tz),
    end:                   toGraphDateTime(params.endDateTime,   tz),
    isOnlineMeeting:       true,
    onlineMeetingProvider: 'teamsForBusiness',
    // Empty attendees: the organizer (Ahmad) gets the event automatically
    // and the existing Resend-based "Send Announcement" flow still owns
    // the student fan-out. Adding students here would generate ICS invites
    // from Outlook, which is a separate UX decision.
    attendees:             [] as Array<unknown>,
  };

  const res = await graphFetch('POST', path, payload);
  if (!res.ok) {
    const detail = await buildGraphErrorDetail(res);
    console.error('[teamsMeetings] createCalendarEventWithMeeting failed', {
      path,
      payload: { subject: payload.subject, start: payload.start, end: payload.end },
      detail,
    });
    throw new TeamsIntegrationError('Graph API: createCalendarEventWithMeeting failed', { status: res.status, detail });
  }
  return normalizeEvent((await res.json()) as Record<string, unknown>);
}

export async function updateCalendarEvent(
  eventId: string,
  updates: { subject?: string; startDateTime?: string; endDateTime?: string; timezone?: string; description?: string },
): Promise<TeamsMeeting> {
  const hostId = await getHostUserId();
  const tz     = (updates.timezone || '').trim() || DEFAULT_TIMEZONE;
  const payload: Record<string, unknown> = {};
  if (updates.subject !== undefined) payload.subject = updates.subject;
  if (updates.startDateTime !== undefined) payload.start = toGraphDateTime(updates.startDateTime, tz);
  if (updates.endDateTime   !== undefined) payload.end   = toGraphDateTime(updates.endDateTime,   tz);
  if (updates.subject !== undefined || updates.description !== undefined) {
    payload.body = buildEventBody(updates.subject ?? '', updates.description ?? '');
  }

  const res = await graphFetch(
    'PATCH',
    `/users/${encodeURIComponent(hostId)}/events/${encodeURIComponent(eventId)}`,
    payload,
  );
  if (!res.ok) {
    const detail = await buildGraphErrorDetail(res);
    console.error('[teamsMeetings] updateCalendarEvent failed', { eventId, detail });
    throw new TeamsIntegrationError('Graph API: updateCalendarEvent failed', { status: res.status, detail });
  }
  return normalizeEvent((await res.json()) as Record<string, unknown>);
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const hostId = await getHostUserId();
  const res    = await graphFetch(
    'DELETE',
    `/users/${encodeURIComponent(hostId)}/events/${encodeURIComponent(eventId)}`,
  );
  // 204 No Content on success; 404 treated as already-deleted (idempotent).
  if (!res.ok && res.status !== 404) {
    const detail = await buildGraphErrorDetail(res);
    console.error('[teamsMeetings] deleteCalendarEvent failed', { eventId, detail });
    throw new TeamsIntegrationError('Graph API: deleteCalendarEvent failed', { status: res.status, detail });
  }
}

/**
 * Try the new event endpoint first; if Graph returns 404 the stored id is
 * almost certainly an old onlineMeeting id (created before the calendar
 * switch), so fall back to the legacy onlineMeetings PATCH. This keeps
 * pre-migration sessions editable without a DB migration. Same pattern
 * for delete below.
 */
export async function updateMeetingOrEvent(
  id: string,
  updates: { subject?: string; startDateTime?: string; endDateTime?: string; timezone?: string; description?: string },
): Promise<void> {
  try {
    await updateCalendarEvent(id, updates);
  } catch (e) {
    if (e instanceof TeamsIntegrationError && e.status === 404) {
      await updateTeamsMeeting(id, {
        subject:       updates.subject,
        startDateTime: updates.startDateTime,
        endDateTime:   updates.endDateTime,
      });
      return;
    }
    throw e;
  }
}

export async function deleteMeetingOrEvent(id: string): Promise<void> {
  try {
    await deleteCalendarEvent(id);
  } catch (e) {
    if (e instanceof TeamsIntegrationError && e.status === 404) {
      await deleteTeamsMeeting(id);
      return;
    }
    throw e;
  }
}

export async function updateTeamsMeeting(
  meetingId: string,
  updates:   { subject?: string; startDateTime?: string; endDateTime?: string },
): Promise<TeamsMeeting> {
  const hostId = await getHostUserId();
  const payload: Record<string, unknown> = {};
  if (updates.subject        !== undefined) payload.subject        = updates.subject;
  if (updates.startDateTime  !== undefined) payload.startDateTime  = updates.startDateTime;
  if (updates.endDateTime    !== undefined) payload.endDateTime    = updates.endDateTime;

  const res = await graphFetch('PATCH', `/users/${encodeURIComponent(hostId)}/onlineMeetings/${encodeURIComponent(meetingId)}`, payload);
  if (!res.ok) {
    const detail = await buildGraphErrorDetail(res);
    console.error('[teamsMeetings] updateTeamsMeeting failed', { meetingId, detail });
    throw new TeamsIntegrationError('Graph API: updateTeamsMeeting failed', { status: res.status, detail });
  }
  return normalizeMeeting((await res.json()) as Record<string, unknown>);
}

export async function deleteTeamsMeeting(meetingId: string): Promise<void> {
  const hostId = await getHostUserId();
  const res  = await graphFetch('DELETE', `/users/${encodeURIComponent(hostId)}/onlineMeetings/${encodeURIComponent(meetingId)}`);
  // 204 No Content on success; 404 is treated as already-deleted (idempotent)
  if (!res.ok && res.status !== 404) {
    const detail = await buildGraphErrorDetail(res);
    console.error('[teamsMeetings] deleteTeamsMeeting failed', { meetingId, detail });
    throw new TeamsIntegrationError('Graph API: deleteTeamsMeeting failed', { status: res.status, detail });
  }
}

export async function testTeamsConnection(): Promise<{ ok: true; host: string; hostId?: string } | { ok: false; error: string; detail?: string }> {
  if (!isTeamsConfigured()) {
    return { ok: false, error: 'Missing one or more env vars: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, TEAMS_HOST_USER_EMAIL' };
  }
  try {
    await getToken();
    const host = process.env.TEAMS_HOST_USER_EMAIL!;
    // Prime / refresh the host-id cache. If the UPN resolves here but
    // meeting creation still fails later, the remaining suspects are the
    // Application Access Policy assignment, the Teams-enabled license, or
    // an audio-conferencing add-on requirement - none of which this GET
    // endpoint exercises, but all of which produce a distinct error.
    const hostId = await getHostUserId();
    return { ok: true, host, hostId };
  } catch (e) {
    if (e instanceof TeamsIntegrationError) {
      return { ok: false, error: e.message, detail: e.detail };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
