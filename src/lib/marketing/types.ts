import type React from 'react';

export interface BrandKit {
  logo_url: string | null;
  logo_light_url: string | null;
  founder_photo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  text_color_dark: string;
  text_color_light: string;
  font_family: string;
}

export const DEFAULT_BRAND_KIT: BrandKit = {
  logo_url: null,
  logo_light_url: null,
  founder_photo_url: null,
  primary_color: '#1B4F72',
  secondary_color: '#2DD4BF',
  accent_color: '#F59E0B',
  text_color_dark: '#1F2937',
  text_color_light: '#FFFFFF',
  font_family: 'Inter',
};

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'image' | 'color' | 'select';
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  options?: { value: string; label: string }[];
  helpText?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: 'youtube' | 'linkedin' | 'instagram';
  dimensions: { width: number; height: number };
  aspectRatio: string;
  fields: TemplateField[];
  defaults: Record<string, string>;
  render: (data: Record<string, string>, brandKit: BrandKit, logoDataUri?: string, photoDataUri?: string) => React.ReactElement;
}

export interface MarketingDesign {
  id: string;
  name: string;
  template_type: string;
  content: Record<string, string>;
  ai_captions: Record<string, string>;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}
