import type { PageSection } from '@/src/lib/shared/cms';
import { HeroSection } from './sections/HeroSection';
import { TextSection } from './sections/TextSection';
import { RichTextSection } from './sections/RichTextSection';
import { ImageSection } from './sections/ImageSection';
import { TextImageSection } from './sections/TextImageSection';
import { ColumnsSection } from './sections/ColumnsSection';
import { CardsSection } from './sections/CardsSection';
import { CtaSection } from './sections/CtaSection';
import { FaqSection } from './sections/FaqSection';
import { StatsSection } from './sections/StatsSection';
import { ListSection } from './sections/ListSection';

const SECTION_MAP: Record<string, React.ComponentType<{ content: Record<string, unknown>; styles: Record<string, unknown> }>> = {
  hero:       HeroSection,
  text:       TextSection,
  rich_text:  RichTextSection,
  image:      ImageSection,
  text_image: TextImageSection,
  columns:    ColumnsSection,
  cards:      CardsSection,
  cta:        CtaSection,
  faq:        FaqSection,
  stats:      StatsSection,
  list:       ListSection,
};

interface Props {
  sections: PageSection[];
}

export function SectionRenderer({ sections }: Props) {
  return (
    <>
      {sections.map(section => {
        const Component = SECTION_MAP[section.section_type];
        if (!Component) return null;
        return (
          <Component
            key={section.id}
            content={section.content}
            styles={section.styles}
          />
        );
      })}
    </>
  );
}
