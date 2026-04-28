'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface Props {
  categories: string[];
  active: string;
}

export function CategoryFilter({ categories, active }: Props) {
  const router      = useRouter();
  const searchParams = useSearchParams();

  function setCategory(cat: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (cat === 'All') {
      params.delete('category');
    } else {
      params.set('category', cat);
    }
    router.push(`/articles?${params.toString()}`);
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {['All', ...categories].map((cat) => {
        const isActive = cat === active || (cat === 'All' && active === 'All');
        return (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            style={{
              padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', border: 'none', transition: 'all 0.15s',
              background: isActive ? '#1B4F8A' : 'rgba(255,255,255,0.07)',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
              outline: isActive ? '1px solid rgba(27,79,138,0.6)' : '1px solid rgba(255,255,255,0.12)',
            }}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
