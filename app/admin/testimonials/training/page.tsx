'use client';

// Training Hub testimonials — pre-filtered to hub='training'
// Shares the same component as /admin/testimonials but with hub locked to 'training'

import TestimonialsAdminPage from '../TestimonialsAdminShared';

export default function TrainingTestimonialsPage() {
  return <TestimonialsAdminPage defaultHub="training" />;
}
