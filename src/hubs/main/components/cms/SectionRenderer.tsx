import type { PageSection } from '@/src/shared/cms';
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
import { TestimonialsSection } from './sections/TestimonialsSection';
import { PricingTableSection } from './sections/PricingTableSection';
import { VideoSection } from './sections/VideoSection';
import { BannerSection } from './sections/BannerSection';
import { SpacerSection } from './sections/SpacerSection';
import { EmbedSection } from './sections/EmbedSection';
import { TeamSection } from './sections/TeamSection';
import { TimelineSection } from './sections/TimelineSection';
import { LogoGridSection } from './sections/LogoGridSection';
import { CountdownSection } from './sections/CountdownSection';

const SECTION_MAP: Record<string, React.ComponentType<{ content: Record<string, unknown>; styles: Record<string, unknown> }>> = {
  hero:          HeroSection,
  text:          TextSection,
  rich_text:     RichTextSection,
  image:         ImageSection,
  text_image:    TextImageSection,
  columns:       ColumnsSection,
  cards:         CardsSection,
  cta:           CtaSection,
  faq:           FaqSection,
  stats:         StatsSection,
  list:          ListSection,
  testimonials:  TestimonialsSection,
  pricing_table: PricingTableSection,
  video:         VideoSection,
  banner:        BannerSection,
  spacer:        SpacerSection,
  embed:         EmbedSection,
  team:          TeamSection,
  timeline:      TimelineSection,
  logo_grid:     LogoGridSection,
  countdown:     CountdownSection,
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
