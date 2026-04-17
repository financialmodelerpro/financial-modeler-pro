// deck.types.ts - Presentation deck / Module 11 types

export type SlideType =
  | 'cover' | 'summary' | 'assumptions' | 'land-area'
  | 'development-costs' | 'financing' | 'revenue' | 'opex'
  | 'returns' | 'waterfall' | 'sensitivity' | 'appendix';

export interface DeckSlide {
  id: string;
  type: SlideType;
  title: string;
  visible: boolean;
  order: number;
}

export interface DeckConfig {
  id: string;
  projectId: string;
  name: string;
  slides: DeckSlide[];
  brandingOverride?: {
    primaryColor?: string;
    logoUrl?: string;
    companyName?: string;
  };
  createdAt: string;
  updatedAt: string;
}
