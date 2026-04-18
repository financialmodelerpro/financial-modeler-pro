import type { TemplateDefinition } from '../types';
import { youtubeThumbnailTemplate } from './youtube-thumbnail';
import { linkedinPostTemplate } from './linkedin-post';
import { instagramPostTemplate } from './instagram-post';

export const TEMPLATES: TemplateDefinition[] = [
  youtubeThumbnailTemplate,
  linkedinPostTemplate,
  instagramPostTemplate,
];

export function getTemplate(id: string): TemplateDefinition | null {
  return TEMPLATES.find(t => t.id === id) ?? null;
}
