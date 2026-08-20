import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/src/core/db/supabase';
import { hashPassword } from '@/src/shared/auth/password';
import { verifyCaptcha } from '@/src/shared/auth/captcha';
import { createConfirmationToken } from '@/src/shared/auth/emailConfirmation';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { confirmEmailTemplate } from '@/src/shared/email/templates/confirmEmail';
import { sendNewRegistrationAlert } from '@/src/shared/email/newRegistrationAlert';
import { canEmailRegisterModeling } from '@/src/hubs/modeling/lib/access';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    email?: string;
    name?: string;
    password?: string;
    company?: string;
    job_title?: string;
    phone?: string;
    city?: string;
    country?: string;
    captchaToken?: string;
    works_in_real_estate?: boolean | null;
    real_estate_role_note?: string;
  } | null;

  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  /**
   * EVERY FIELD THE FORM MARKS REQUIRED IS ENFORCED HERE (2026-08-20).
   *
   * Before this, `name` was the only one checked. Company and job title were
   * validated in the browser only; phone, city and country carried the HTML
   * `required` attribute and were checked NOWHERE, on either side. All five
   * were then coerced with `?.trim() || null` and inserted, so a request that
   * omitted them succeeded silently and the row landed with nulls. One live
   * user reached the database with a blank company and job title.
   *
   * The client keeps its own copies of these checks for fast feedback. THIS is
   * the authority: a client check is a courtesy, not a constraint.
   *
   * Whitespace counts as blank. A name of "   " is not a name.
   */
  const REQUIRED_TEXT: ReadonlyArray<readonly [keyof typeof body & string, string]> = [
    ['name', 'Full name is required'],
    ['company', 'Company / organization is required'],
    ['job_title', 'Job title is required'],
    ['phone', 'Phone number is required'],
    ['city', 'City is required'],
    ['country', 'Country is required'],
    ['real_estate_role_note', 'Please tell us briefly what you do'],
  ];
  // Collect the trimmed values as we validate, rather than validating here and
  // reaching for `body.x!` later: the assertion would be correct today and
  // silently wrong the first time a field leaves this list.
  const clean: Record<string, string> = {};
  for (const [field, message] of REQUIRED_TEXT) {
    const v = body[field];
    if (typeof v !== 'string' || v.trim() === '') {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    clean[field] = v.trim();
  }
  // The yes/no is a BOOLEAN, so a blank check is the wrong test: `false` is a
  // real answer and must pass, while null / undefined / a string must not.
  if (typeof body.works_in_real_estate !== 'boolean') {
    return NextResponse.json(
      { error: 'Please tell us whether you work in the real estate industry' },
      { status: 400 },
    );
  }
  if (!body.captchaToken) {
    return NextResponse.json({ error: 'Captcha verification required' }, { status: 400 });
  }

  // Verify captcha
  const captchaValid = await verifyCaptcha(body.captchaToken);
  if (!captchaValid) {
    return NextResponse.json({ error: 'Captcha verification failed. Please try again.' }, { status: 400 });
  }

  const email = (body.email as string).toLowerCase().trim();

  // Pre-launch gate (migration 136): when the register toggle is on, only
  // admins + whitelisted emails can create an account. Ordering matters -
  // we check access BEFORE the existing-email lookup so an unauthorized
  // retry never reveals whether the email is already taken.
  const access = await canEmailRegisterModeling(email);
  if (!access.allowed) {
    return NextResponse.json(
      { error: 'Registration is invite-only right now. Contact us if you were expecting access.' },
      { status: 403 },
    );
  }

  // Check duplicate
  const { data: existing } = await serverClient
    .from('users')
    .select('id, email_confirmed')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    if (!existing.email_confirmed) {
      // Resend confirmation email
      const token      = await createConfirmationToken(email, 'modeling');
      const confirmUrl = `${APP_URL}/modeling/confirm-email?token=${token}`;
      const { subject, html } = await confirmEmailTemplate({ confirmUrl, hub: 'modeling' });
      await sendEmail({ to: email, subject, html, from: FROM.noreply }).catch(() => null);
      return NextResponse.json({
        message: 'Account pending confirmation. We\'ve resent the confirmation email - please check your inbox.',
      }, { status: 200 });
    }
    return NextResponse.json({ error: 'An account with that email already exists' }, { status: 409 });
  }

  const password_hash = await hashPassword(body.password as string);

  // Base row. No-access by default: a new registration gets the 'none' plan
  // (zero entitlements). Access comes only from an approved trial or a purchase
  // (a plan change via setUserPlan). subscription_status uses an allowed value
  // ('expired' = no active subscription); gating is plan-driven, so the status
  // is cosmetic for a none user. Not 'trial' (trial is gated), not 'free'
  // (which would hit the access-preserving safety net and wrongly grant access).
  const baseRow = {
    email,
    name:                clean.name,
    password_hash,
    phone:               clean.phone,
    city:                clean.city,
    country:             clean.country,
    role:                'user',
    subscription_plan:   'none',
    subscription_status: 'expired',
    projects_limit:      0,
    email_confirmed:     false,
  };
  // Company / Job Title (mig 172) and the qualification answers (mig 216).
  // Schema-tolerant: if the columns are not yet applied, retry without them so
  // registration never breaks on a deploy that lands before the migration.
  //
  // The retry is a LAST RESORT, not a silent data drop: these fields are now
  // validated above, so a request that reaches here has them, and the only way
  // to lose them is a genuinely missing column. Ordered widest first so the
  // most complete row is attempted before anything is given up.
  const withProfile = {
    ...baseRow,
    company:   clean.company,
    job_title: clean.job_title,
  };
  const withQualification = {
    ...withProfile,
    works_in_real_estate:  body.works_in_real_estate,
    real_estate_role_note: clean.real_estate_role_note,
  };

  let insertErr = (await serverClient.from('users').insert(withQualification)).error;
  if (insertErr && /works_in_real_estate|real_estate_role_note/.test(insertErr.message)) {
    insertErr = (await serverClient.from('users').insert(withProfile)).error;
  }
  if (insertErr && /company|job_title/.test(insertErr.message)) {
    insertErr = (await serverClient.from('users').insert(baseRow)).error;
  }

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // NOTIFY SUPPORT (2026-08-20). Fire-and-forget, deliberately not awaited:
  // the account exists at this point, so the signup response must not wait on
  // Brevo, and a send that fails must not turn a successful registration into
  // an error the user sees. `sendNewRegistrationAlert` never throws; it logs
  // under `[reg-alert]`.
  //
  // The user id is read back rather than assumed, because the insert above may
  // have taken one of the schema-tolerant fallbacks and we want the row that
  // actually landed. A miss here costs the admin link, not the email.
  void (async () => {
    const { data: created } = await serverClient
      .from('users').select('id, created_at').eq('email', email).maybeSingle();
    await sendNewRegistrationAlert({
      userId: created?.id ?? '',
      name: clean.name,
      email,
      phone: clean.phone,
      city: clean.city,
      country: clean.country,
      company: clean.company,
      jobTitle: clean.job_title,
      worksInRealEstate: body.works_in_real_estate,
      roleNote: clean.real_estate_role_note,
      registeredAt: created?.created_at ?? new Date().toISOString(),
      hub: 'modeling',
    });
  })();

  // Send confirmation email
  const token      = await createConfirmationToken(email, 'modeling');
  const confirmUrl = `${APP_URL}/modeling/confirm-email?token=${token}`;
  const { subject, html } = await confirmEmailTemplate({ confirmUrl, hub: 'modeling' });
  await sendEmail({ to: email, subject, html, from: FROM.noreply });

  return NextResponse.json({
    message: 'Account created! Please check your email and click the confirmation link to activate your account.',
  }, { status: 201 });
}
