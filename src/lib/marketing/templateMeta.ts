// Client-safe metadata mirror of src/lib/marketing/templates/*.
// Kept flat (no render functions) so the admin page can import it without
// pulling React server-side code into the client bundle.

import type { TemplateField } from './types';

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  category: 'youtube' | 'linkedin' | 'instagram';
  dimensions: { width: number; height: number };
  aspectRatio: string;
  fields: TemplateField[];
  defaults: Record<string, string>;
}

export const TEMPLATE_META: TemplateMeta[] = [
  {
    id: 'youtube-thumbnail',
    name: 'YouTube Thumbnail',
    description: 'Bold 1280x720 thumbnail for YouTube videos — large headline + accent bar + logo.',
    category: 'youtube',
    dimensions: { width: 1280, height: 720 },
    aspectRatio: '16:9',
    fields: [
      { key: 'headline',  label: 'Headline',     type: 'text',     placeholder: 'DCF Valuation EXPLAINED',   maxLength: 60, required: true, helpText: 'Big attention-grabbing title (under 60 chars).' },
      { key: 'subtitle',  label: 'Subtitle',     type: 'text',     placeholder: 'Step-by-step walkthrough',   maxLength: 80,                    helpText: 'Optional supporting line.' },
      { key: 'badge',     label: 'Badge',        type: 'text',     placeholder: 'TUTORIAL',                   maxLength: 20,                    helpText: 'Small top-left label.' },
      { key: 'module',    label: 'Course',       type: 'text',     placeholder: 'Financial Modeling · Ep 4', maxLength: 60,                    helpText: 'Shown bottom-right above logo.' },
      { key: 'variant',   label: 'Style',        type: 'select',   options: [{ value: 'dark', label: 'Dark Navy' }, { value: 'accent', label: 'Accent Gradient' }, { value: 'light', label: 'Light' }] },
    ],
    defaults: {
      headline: 'DCF Valuation EXPLAINED',
      subtitle: 'Step-by-step Excel walkthrough',
      badge: 'TUTORIAL',
      module: 'Financial Modeling · Episode 4',
      variant: 'dark',
    },
  },
  {
    id: 'linkedin-post',
    name: 'LinkedIn Post',
    description: 'Professional 1200x627 share image for LinkedIn posts — headline, body, branding.',
    category: 'linkedin',
    dimensions: { width: 1200, height: 627 },
    aspectRatio: '1.91:1',
    fields: [
      { key: 'label',    label: 'Eyebrow',     type: 'text',     placeholder: 'FINANCIAL MODELING TIP', maxLength: 40, helpText: 'Small caps label at top.' },
      { key: 'headline', label: 'Headline',    type: 'text',     placeholder: '3 DCF mistakes that kill valuations', maxLength: 100, required: true },
      { key: 'body',     label: 'Body',        type: 'textarea', placeholder: 'A short sentence that teases the insight.', maxLength: 200, helpText: 'One or two lines that invite the click.' },
      { key: 'author',   label: 'Author',      type: 'text',     placeholder: 'Ahmad Din · FMP',        maxLength: 60 },
      { key: 'variant',  label: 'Style',       type: 'select',   options: [{ value: 'navy', label: 'Navy Professional' }, { value: 'light', label: 'Light Minimal' }, { value: 'split', label: 'Split with Photo' }] },
    ],
    defaults: {
      label: 'FINANCIAL MODELING TIP',
      headline: '3 DCF mistakes that kill valuations',
      body: 'A short insight that makes people stop scrolling — then teaches them something useful.',
      author: 'Ahmad Din · Financial Modeler Pro',
      variant: 'navy',
    },
  },
  {
    id: 'instagram-post',
    name: 'Instagram Post',
    description: 'Square 1080x1080 image for Instagram feed — big title + tagline + hashtag line.',
    category: 'instagram',
    dimensions: { width: 1080, height: 1080 },
    aspectRatio: '1:1',
    fields: [
      { key: 'headline',  label: 'Headline',    type: 'text',     placeholder: 'NPV vs IRR',           maxLength: 40, required: true },
      { key: 'subtitle',  label: 'Subtitle',    type: 'text',     placeholder: 'Which one actually matters?', maxLength: 80 },
      { key: 'body',      label: 'Body',        type: 'textarea', placeholder: 'Swipe to see the full breakdown.', maxLength: 160 },
      { key: 'hashtag',   label: 'Hashtag Line', type: 'text',    placeholder: '#FinancialModeling #Finance', maxLength: 80 },
      { key: 'variant',   label: 'Style',       type: 'select',   options: [{ value: 'gradient', label: 'Gradient' }, { value: 'navy', label: 'Navy Solid' }, { value: 'light', label: 'Light Card' }] },
    ],
    defaults: {
      headline: 'NPV vs IRR',
      subtitle: 'Which one actually matters?',
      body: 'Most analysts default to IRR — here is why NPV wins in almost every serious decision.',
      hashtag: '#FinancialModeling #Valuation #Finance',
      variant: 'gradient',
    },
  },
];

export function getTemplateMeta(id: string): TemplateMeta | null {
  return TEMPLATE_META.find(t => t.id === id) ?? null;
}
