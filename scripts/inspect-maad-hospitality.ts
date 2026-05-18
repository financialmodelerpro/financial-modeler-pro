/**
 * One-off MAAD inspector. Lists sheets + dumps the "Assumptions" tab
 * (and any hospitality-related sheets) to stdout so we can audit what
 * the user's MAAD reference models cover vs our Pass 8 engine.
 *
 * Inputs:
 *   - "Maad Model (KPMG Sc7) - v19 (2025.12.01) v1.1 Cleaned Version.xlsm"
 *   - "MAAD Financial Model_Feasibility - Scenario 7.0.xlsb"
 *
 * Run: npx tsx scripts/inspect-maad-hospitality.ts
 */
import ExcelJS from 'exceljs';
import path from 'node:path';

async function dumpSheet(ws: ExcelJS.Worksheet, label: string, maxRows = 600): Promise<void> {
  console.log(`\n===== Sheet: ${label} (rows=${ws.actualRowCount}, cols=${ws.actualColumnCount}) =====`);
  let printed = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (printed >= maxRows) return;
    const cells: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      let display = '';
      if (v == null) display = '';
      else if (typeof v === 'object' && 'richText' in v && Array.isArray((v as { richText: unknown[] }).richText)) {
        display = ((v as { richText: Array<{ text: string }> }).richText).map((r) => r.text).join('');
      } else if (typeof v === 'object' && 'result' in v) {
        display = String((v as { result: unknown }).result);
      } else if (typeof v === 'object' && 'text' in v) {
        display = String((v as { text: unknown }).text);
      } else {
        display = String(v);
      }
      if (display.trim() !== '') cells.push(`${cell.address}=${display.slice(0, 80)}`);
    });
    if (cells.length > 0) {
      console.log(`  r${rowNumber}: ${cells.slice(0, 12).join(' | ')}${cells.length > 12 ? ` ... +${cells.length - 12} more` : ''}`);
      printed++;
    }
  });
  if (printed >= maxRows) console.log(`  ... (truncated at ${maxRows} non-empty rows)`);
}

async function inspect(file: string, sheetPatterns: RegExp[]): Promise<void> {
  console.log(`\n\n##############################################`);
  console.log(`# ${file}`);
  console.log(`##############################################`);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(path.resolve(file));
  } catch (e) {
    console.log(`  Failed to read with .xlsx reader: ${(e as Error).message}`);
    return;
  }
  console.log(`Sheets (${wb.worksheets.length}):`);
  for (const ws of wb.worksheets) {
    console.log(`  - "${ws.name}" (rows=${ws.actualRowCount}, cols=${ws.actualColumnCount})`);
  }
  for (const ws of wb.worksheets) {
    if (sheetPatterns.some((re) => re.test(ws.name))) {
      await dumpSheet(ws, ws.name);
    }
  }
}

async function main(): Promise<void> {
  await inspect(
    'Maad Model (KPMG Sc7) - v19 (2025.12.01) v1.1 Cleaned Version.xlsm',
    [/^FS$/i, /assumption/i, /hospitality/i, /hotel/i, /room/i, /revenue/i, /opex/i, /cost/i],
  );
  // .xlsb is binary; exceljs cannot parse. User would need to Save As
  // .xlsx in Excel for inspection here. Skip silently.
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
