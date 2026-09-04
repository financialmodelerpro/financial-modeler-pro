/*
 * html-safe: openUrl
 *
 * Built by this codebase from APP_URL; no user-supplied text reaches it. The
 * actor name, project name and role label ARE user-supplied and are escaped
 * here.
 */
import { fmpLayout, h1, p, button, divider, escapeHtml } from './_base';

interface AccessGrantedOptions {
  actorName: string | null;
  projectName: string;
  roleLabel: string;
  /** The PLATFORM the project lives on, from the PROJECT_SOURCES registry
   *  (e.g. Real Estate Financial Modeling), carried through by the notifier
   *  and never assumed: the hub holds several platforms, and naming the hub
   *  here would be wrong the day ERFM or BVM ships. */
  platformLabel: string;
  openUrl: string;
}

export async function accessGrantedEmail({ actorName, projectName, roleLabel, platformLabel, openUrl }: AccessGrantedOptions): Promise<{
  subject: string;
  html: string;
}> {
  const who = actorName ? escapeHtml(actorName) : 'Your team';
  const proj = escapeHtml(projectName);
  const role = escapeHtml(roleLabel);
  const plat = escapeHtml(platformLabel);

  const html = await fmpLayout(`
    ${h1('You have been given project access')}
    ${p(`<strong>${who}</strong> gave you access to <strong>${proj}</strong> on <strong>${plat}</strong>.`)}
    ${p(`Your role on this project is <strong>${role}</strong>.`)}
    <div style="text-align:center;margin:28px 0;">
      ${button('Open the Modeling Hub →', openUrl)}
    </div>
    ${divider()}
    ${p('If you were not expecting this, contact the person named above or reply to this email.', 'font-size:13px;color:#6B7280;')}
  `, `You are receiving this because you were given access to a project on ${plat}.`);

  return { subject: `You now have access to ${projectName}`, html };
}

interface AccessRemovedOptions {
  actorName: string | null;
  projectName: string;
  /** See AccessGrantedOptions.platformLabel. */
  platformLabel: string;
}

export async function accessRemovedEmail({ actorName, projectName, platformLabel }: AccessRemovedOptions): Promise<{
  subject: string;
  html: string;
}> {
  const who = actorName ? escapeHtml(actorName) : 'Your team';
  const proj = escapeHtml(projectName);
  const plat = escapeHtml(platformLabel);

  const html = await fmpLayout(`
    ${h1('Your project access was removed')}
    ${p(`<strong>${who}</strong> removed your access to <strong>${proj}</strong> on <strong>${plat}</strong>.`)}
    ${p('Your login and any other project access are unaffected.')}
    ${divider()}
    ${p('If you think this was a mistake, contact the person named above.', 'font-size:13px;color:#6B7280;')}
  `, `You are receiving this because your project access on ${plat} changed.`);

  return { subject: `Your access to ${projectName} was removed`, html };
}
