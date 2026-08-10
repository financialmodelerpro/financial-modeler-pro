/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * pdfTextExtract.ts
 *
 * Real text extraction from the REFM PDFs, for the export verifiers.
 *
 * pdf-lib embeds Inter through fontkit as a CID font, so drawn text lands in
 * the content stream as hex glyph IDs (<0180 02B1 ...> Tj), not literals. This
 * rebuilds the glyph-id -> unicode map from the SAME font bytes the generator
 * embeds and decodes the streams, so the diagnosis is evidence rather than a
 * code reading.
 */
import zlib from 'zlib';
import fontkit from '@pdf-lib/fontkit';
import INTER_REGULAR_B64 from '../src/hubs/modeling/platforms/refm/lib/pdf/fonts/interRegular';
import INTER_BOLD_B64 from '../src/hubs/modeling/platforms/refm/lib/pdf/fonts/interBold';

const b64 = (s: string): Buffer => Buffer.from(s, 'base64');

function glyphMap(bytes: Buffer): Map<number, string> {
  const font: any = (fontkit as any).create(bytes);
  const m = new Map<number, string>();
  for (const cp of font.characterSet as number[]) {
    try {
      const g = font.glyphForCodePoint(cp);
      if (g && !m.has(g.id)) m.set(g.id, String.fromCodePoint(cp));
    } catch { /* unmapped codepoint */ }
  }
  return m;
}

let REG: Map<number, string> | null = null;
let BLD: Map<number, string> | null = null;

export function pdfText(bytes: Uint8Array): string {
  if (!REG) REG = glyphMap(b64(INTER_REGULAR_B64));
  if (!BLD) BLD = glyphMap(b64(INTER_BOLD_B64));
  const buf = Buffer.from(bytes);
  const chunks: string[] = [];
  let i = 0;
  while (true) {
    const a0 = buf.indexOf('stream', i);
    if (a0 < 0) break;
    let a = a0 + 6;
    if (buf[a] === 0x0d) a++;
    if (buf[a] === 0x0a) a++;
    const e = buf.indexOf('endstream', a);
    if (e < 0) break;
    const raw = buf.subarray(a, e);
    let t: string | null = null;
    try { t = zlib.inflateSync(raw).toString('latin1'); } catch { t = null; }
    if (t === null) t = raw.toString('latin1');
    if (/Tj|TJ/.test(t)) chunks.push(t);
    i = e + 9;
  }
  const out: string[] = [];
  for (const chunk of chunks) {
    let map = REG;
    // /Inter-Bold-… Tf and /Inter-Regular-… Tf select the active font.
    const re = /\/(Inter-[A-Za-z]+)-\d+\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|\(((?:\\.|[^\\()])*)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk)) !== null) {
      if (m[1]) { map = /Bold/i.test(m[1]) ? BLD : REG; continue; }
      if (m[2]) {
        let s = '';
        for (let k = 0; k + 3 < m[2].length + 1; k += 4) {
          const gid = parseInt(m[2].slice(k, k + 4), 16);
          s += map!.get(gid) ?? '';
        }
        out.push(s);
        continue;
      }
      if (m[3] !== undefined) out.push(m[3]);
    }
  }
  return out.join('\n');
}
