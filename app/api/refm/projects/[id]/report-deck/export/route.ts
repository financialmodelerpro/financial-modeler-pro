/**
 * /api/refm/projects/[id]/report-deck/export (Module 7, IC Presentation Builder)
 *
 * POST -> render the slide deck to an editable .pptx or a shareable .pdf and
 * stream it back. `format` selects the exporter.
 *
 * Generated SERVER-SIDE because both builders import node-only libraries
 * (pptxgenjs imports node:fs/https; pdf-lib is fine in the browser but is kept
 * here so one route owns every deck export). The client POSTs the deck document
 * plus the ALREADY-ASSEMBLED ICReportModel and the money scale (NO recompute:
 * the model is exactly what the canvas rendered), and this route rebuilds the
 * same formatter and hands both to the shared exporter, so the file mirrors the
 * on-screen deck exactly. The deck is re-validated through coerceDeck, never
 * trusted as posted jsonb.
 *
 * Auth: NextAuth session + project ownership (getProject). Export is denied to a
 * read-only grace / lapsed user via the shared assertExportAllowed guard, the
 * same gate the PDF / Excel export routes use.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { coerceDeck } from '@/src/hubs/modeling/platforms/refm/lib/persistence/deck-server';
import { assertExportAllowed } from '@/src/shared/entitlements/exportGuard';
import { buildDeckPptx } from '@/src/hubs/modeling/platforms/refm/lib/reports/deck/deckPptx';
import { buildDeckPdf } from '@/src/hubs/modeling/platforms/refm/lib/reports/deck/deckPdf';
import { makeDeckFmt } from '@/src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { icMoneyScaleSpec } from '@/src/hubs/modeling/platforms/refm/lib/reportInputs';
import type { ICReportModel } from '@/src/hubs/modeling/platforms/refm/lib/reports/icReport';
import type { DeckMoneyScale } from '@/src/hubs/modeling/platforms/refm/lib/reports/deck/types';

export const runtime = 'nodejs';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PDF_MIME = 'application/pdf';

const today = (): string => new Date().toISOString().slice(0, 10);
const safeName = (s: string): string => (s || 'Presentation').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Presentation';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const blocked = await assertExportAllowed();
  if (blocked) return blocked;

  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { row, error } = await getProject(userId, id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => null) as
    | { deck?: unknown; model?: unknown; scale?: string; currency?: string; format?: string; fileName?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const format = body.format === 'pdf' ? 'pdf' : body.format === 'pptx' ? 'pptx' : null;
  if (!format) return NextResponse.json({ error: 'format must be "pptx" or "pdf"' }, { status: 400 });

  const deck = coerceDeck(body.deck, id, today());
  if (!deck) return NextResponse.json({ error: 'A deck with at least one slide is required.' }, { status: 400 });

  const model = body.model as ICReportModel | undefined;
  if (!model || typeof model !== 'object') return NextResponse.json({ error: 'A resolved report model is required.' }, { status: 400 });

  const scale = (body.scale === 'thousands' ? 'thousands' : 'millions') as DeckMoneyScale;
  const currency = typeof body.currency === 'string' && body.currency ? body.currency : 'SAR';
  const fmt = makeDeckFmt(icMoneyScaleSpec(scale, currency));

  const base = safeName(typeof body.fileName === 'string' && body.fileName ? body.fileName : deck.title);

  try {
    if (format === 'pptx') {
      const pptx = buildDeckPptx({ deck, model, fmt });
      const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': PPTX_MIME,
          'Content-Disposition': `attachment; filename="${base}.pptx"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    const bytes = await buildDeckPdf({ deck, model, fmt });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': PDF_MIME,
        'Content-Disposition': `attachment; filename="${base}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
