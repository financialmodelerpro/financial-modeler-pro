import { baseLayoutBranded, h1, p, button, divider } from './_base';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export interface NewRegistrationAlertData {
  /**
   * The `users` row id, when there is one.
   *
   * EMPTY IS A REAL CASE ON THIS HUB, and the guard below is kept for it. The
   * register route reads the id back after inserting
   * (`created?.id ?? ''`), because the insert may have taken a schema-tolerant
   * fallback and we want the row that actually landed. If that read-back fails
   * or returns nothing, the id is empty while the account exists perfectly
   * well. The button is then omitted rather than pointing at `/admin/users/`
   * with nothing after it, which would be a dead link in an inbox somebody is
   * trying to act from.
   *
   * (The guard was originally written for Training Hub signups, which have no
   * `users` row at all. Training is deliberately NOT wired to this alert, but
   * the guard stays because the case above is reachable here.)
   */
  userId: string;
  name: string;
  email: string;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  /** null when the question was never asked, which is every user who
   *  registered before the qualification section existed. */
  worksInRealEstate?: boolean | null;
  roleNote?: string | null;
  /** ISO timestamp of the registration. */
  registeredAt: string;

}

/**
 * ESCAPE EVERY USER-SUPPLIED VALUE.
 *
 * Every field in this email is typed by whoever is registering, and the email
 * goes to support. Interpolating it raw into HTML would let a registrant put
 * markup, a fake "click here" link, or a broken tag that swallows the rest of
 * the message into an inbox we read and act on. The existing
 * modelSubmissionAdminAlert template interpolates its free-text note without
 * escaping; that is worth fixing separately and is NOT copied here.
 *
 * Ampersand first, or it would double-escape the entities added after it.
 */
function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A value, or a visible marker that there isn't one. Never a blank cell: an
 *  empty row reads as a rendering fault rather than as missing data. */
function orNone(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  return s === '' ? '<span style="color:#94A3B8;">not given</span>' : esc(s);
}

function row(label: string, value: string): string {
  return `
        <tr>
          <td style="padding:5px 0;color:#64748B;width:150px;vertical-align:top;">${esc(label)}</td>
          <td style="padding:5px 0;color:#1F3864;">${value}</td>
        </tr>`;
}

/**
 * Sent to support on every new registration, so a signup can be qualified as
 * it arrives rather than being discovered later in the admin list.
 *
 * Fire-and-forget at the call site: a failure here must never fail the
 * registration. The person has an account either way, and losing a
 * notification is not a reason to tell them their signup did not work.
 *
 * MODELING HUB ONLY, by instruction. The absent-field handling below is kept
 * because a Modeling registration can legitimately omit nothing but can still
 * arrive with a failed user-id read-back; it is not there to serve a second
 * hub.
 *
 * No em dashes in this file.
 */
export async function newRegistrationAlertTemplate(d: NewRegistrationAlertData) {
  // MODELING HUB ONLY. A `hub` discriminator existed here solely to render
  // 'Training Hub' in the subject; Training is deliberately not wired to this
  // alert, so the branch was removed rather than left as a setting nobody
  // sets. If a second hub is ever wired, reintroduce it here and nowhere else.
  const hubLabel = 'Modeling Hub';
  const adminUrl = `${MAIN_URL}/admin/users/${encodeURIComponent(d.userId)}`;

  // The qualification answer leads the subject when we have it: it is the one
  // thing that decides whether this signup is worth chasing today.
  const qualifier = d.worksInRealEstate === true ? ' [real estate]'
    : d.worksInRealEstate === false ? ' [not real estate]'
      : '';
  // The subject is NOT html, so it is not escaped, but it is still attacker
  // controlled: collapse any newline or run of whitespace so a crafted name
  // cannot break the line, and cap the length so it cannot push the useful
  // part of the subject out of an inbox preview.
  const subjectName = (d.name || d.email).replace(/\s+/g, ' ').trim().slice(0, 80);
  const subject = `New ${hubLabel} signup${qualifier}: ${subjectName}`;

  const registered = (() => {
    const t = Date.parse(d.registeredAt);
    if (Number.isNaN(t)) return esc(d.registeredAt);
    // UTC and explicit about it. A bare local time in an inbox read from two
    // countries is a time nobody can act on.
    return `${new Date(t).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  })();

  const reAnswer = d.worksInRealEstate === true
    ? '<span style="font-weight:700;color:#166534;">Yes, actively working in real estate</span>'
    : d.worksInRealEstate === false
      ? '<span style="font-weight:700;color:#92400E;">No</span>'
      : '<span style="color:#94A3B8;">not asked</span>';

  const html = await baseLayoutBranded(`
    ${h1(`New ${hubLabel} registration`)}
    ${p(`${esc(d.name || d.email)} created an account. Their details are below so the signup can be qualified before any trial is approved.`)}

    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:18px 22px;margin:18px 0;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:13px;color:#374151;">
        ${row('Name', orNone(d.name))}
        ${row('Email', `<a href="mailto:${esc(d.email)}" style="color:#2E75B6;">${esc(d.email)}</a>`)}
        ${row('Phone', orNone(d.phone))}
        ${row('City', orNone(d.city))}
        ${row('Country', orNone(d.country))}
        ${row('Company', orNone(d.company))}
        ${row('Job title', orNone(d.jobTitle))}
        ${row('Works in real estate', reAnswer)}
        ${row('Registered', esc(registered))}
      </table>
    </div>

    ${(d.roleNote ?? '').trim() !== ''
      ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 14px;margin:14px 0;">
           <div style="font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">What they do</div>
           <div style="font-size:13px;color:#78350F;line-height:1.55;">${esc((d.roleNote ?? '').trim()).replace(/\n/g, '<br/>')}</div>
         </div>`
      : ''}

    ${d.userId.trim() !== ''
      ? `<div style="text-align:center;margin:24px 0;">
      ${button('Open this user in admin', adminUrl)}
    </div>`
      : p('The user record could not be read back, so there is no admin link. Find them by email in the admin user list.', 'font-size:12px;color:#94A3B8;text-align:center;')}

    ${divider()}
    ${p('Sent automatically on every new registration. No action is required unless this person requests a trial.', 'font-size:12px;color:#94A3B8;')}
  `);

  return { subject, html };
}
