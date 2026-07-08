'use client';

/**
 * DeleteArticleButton.tsx (admin, client)
 *
 * Per-row delete for the admin articles list. Calls the existing admin-guarded
 * DELETE /api/admin/articles?id= route after a confirm step, then refreshes the
 * server-rendered list so the deleted row disappears. Hard delete (no soft-delete
 * column exists); the confirm is the guard against accidental loss.
 *
 * No em dashes in this file.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteArticleButton({ id, title }: { id: string; title: string }): React.JSX.Element {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    if (!confirm(`Delete "${title}" permanently? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/articles?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      router.refresh();
    } catch {
      alert('Delete failed. Please try again.');
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={deleting}
      style={{
        fontSize: 12, color: '#DC2626', fontWeight: 600, background: 'none',
        border: 'none', padding: 0, cursor: deleting ? 'default' : 'pointer',
        opacity: deleting ? 0.5 : 1, fontFamily: 'Inter, sans-serif',
      }}
      data-testid="article-delete"
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  );
}
