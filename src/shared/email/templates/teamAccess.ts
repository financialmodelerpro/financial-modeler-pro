/*
 * html-safe: openUrl
 *
 * Built by this codebase from APP_URL; no user-supplied text reaches it. The
 * actor name, project name and role label ARE user-supplied and are escaped
 * here.
 */
import { baseLayoutBranded, h1, p, button, divider, escapeHtml } from './_base';

interface AccessGrantedOptions {
  actorName: string | null;
  projectName: string;
  roleLabel: string;
  openUrl: string;
}

export async function accessGrantedEmail({ actorName, projectName, roleLabel, openUrl }: AccessGrantedOptions): Promise<{
  subject: string;
  html: string;
}> {
  const who = actorName ? escapeHtml(actorName) : 'Your team';
  const proj = escapeHtml(projectName);
  const role = escapeHtml(roleLabel);

  const html = await baseLayoutBranded(`
    ${h1('You have been given project access')}
    ${p(`<strong>${who}</strong> gave you access to <strong>${proj}</strong> on the Financial Modeler Pro Modeling Hub.`)}
    ${p(`Your role on this project is <strong>${role}</strong>.`)}
    <div style="text-align:center;margin:28px 0;">
      ${button('Open the Modeling Hub →', openUrl)}
    </div>
    ${divider()}
    ${p('If you were not expecting this, contact the person named above or reply to this email.', 'font-size:13px;color:#6B7280;')}
  `);

  return { subject: `You now have access to ${projectName}`, html };
}

interface AccessRemovedOptions {
  actorName: string | null;
  projectName: string;
}

export async function accessRemovedEmail({ actorName, projectName }: AccessRemovedOptions): Promise<{
  subject: string;
  html: string;
}> {
  const who = actorName ? escapeHtml(actorName) : 'Your team';
  const proj = escapeHtml(projectName);

  const html = await baseLayoutBranded(`
    ${h1('Your project access was removed')}
    ${p(`<strong>${who}</strong> removed your access to <strong>${proj}</strong> on the Financial Modeler Pro Modeling Hub.`)}
    ${p('Your login and any other project access are unaffected.')}
    ${divider()}
    ${p('If you think this was a mistake, contact the person named above.', 'font-size:13px;color:#6B7280;')}
  `);

  return { subject: `Your access to ${projectName} was removed`, html };
}
