/**
 * Migration wizard spreadsheet ingest + column-mapping utilities.
 *
 * Turns an uploaded xlsx/csv `File` into `{ headers, rows }`, auto-maps its
 * columns to the target fields declared in `migrationFields.ts`, and applies a
 * mapping to produce clean object rows ready to POST to the migration API.
 *
 * Number parsing follows the Indonesian convention (`1.500.000` = 1500000) and
 * dates are normalised to `YYYY-MM-DD`. Both are delegated to the battle-tested
 * `parseNum` / `parseDateCell` helpers in `shopeeImport.ts` (exported there so
 * we reuse rather than reinvent the coercion logic).
 */

import * as XLSX from 'xlsx';
import { ENTITY_FIELDS, type MigrationEntity } from './migrationFields';
import { normalizeHeader } from './headerUtils';
import { parseNum, parseDateCell } from './shopeeImport';

/** Fields whose values must be coerced to a number. */
const NUMERIC_FIELDS = new Set([
  'debit',
  'credit',
  'amount',
  'salePrice',
  'purchasePrice',
  'openingStock',
  'openingValue',
]);

/** Fields whose values must be normalised to a `YYYY-MM-DD` date string. */
const DATE_FIELDS = new Set(['issueDate', 'dueDate']);

/**
 * Minimal CSV parser with quoted-cell handling (mirrors CsvImportPanel's
 * `parseCsvText`): supports `""` escaped quotes and commas inside quotes.
 */
function parseCsvText(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/);
  return lines.map((line) => {
    const row: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    row.push(cur.trim());
    return row;
  });
}

/**
 * Parse an uploaded spreadsheet (`.csv` or `.xlsx`/`.xls`) into a header row
 * plus data rows. CSVs are parsed in-process; other formats go through xlsx.
 */
export async function parseSpreadsheet(
  file: File,
): Promise<{ headers: string[]; rows: (string | number)[][] }> {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    const matrix = parseCsvText(text);
    const headers = (matrix[0] ?? []).map(String);
    const rows = matrix.slice(1);
    return { headers, rows };
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  }) as (string | number)[][];
  const headers = (aoa[0] ?? []).map(String);
  const rows = aoa.slice(1);
  return { headers, rows };
}

/**
 * Auto-map uploaded headers to an entity's target fields by alias, matching
 * case/space/punctuation-insensitively via `normalizeHeader`. Returns a record
 * keyed by target field; unmatched fields map to `null`.
 */
export function autoMapColumns(
  headers: string[],
  entity: MigrationEntity,
): Record<string, string | null> {
  const normalizedHeaders = headers.map((h) => ({ original: h, norm: normalizeHeader(h) }));
  const result: Record<string, string | null> = {};

  for (const spec of ENTITY_FIELDS[entity]) {
    const aliasNorms = spec.aliases.map(normalizeHeader);
    const match = normalizedHeaders.find((h) => aliasNorms.includes(h.norm));
    result[spec.field] = match ? match.original : null;
  }

  return result;
}

/** Is the cell effectively empty (null/undefined/blank string)? */
function isBlank(cell: unknown): boolean {
  return cell == null || String(cell).trim() === '';
}

/**
 * Apply a field→header mapping to raw spreadsheet rows, producing clean object
 * rows. Numeric fields are coerced via `parseNum` (Indonesian format aware),
 * date fields normalised to `YYYY-MM-DD` via `parseDateCell`, everything else
 * trimmed to a string. Rows where every mapped cell is blank are skipped.
 */
export function applyMapping(
  rows: (string | number)[][],
  headers: string[],
  mapping: Record<string, string | null>,
  _entity: MigrationEntity,
): Record<string, unknown>[] {
  const headerIndex = new Map<string, number>();
  headers.forEach((h, i) => headerIndex.set(h, i));

  const mapped = Object.entries(mapping).filter(
    (entry): entry is [string, string] => entry[1] != null,
  );

  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    // Skip rows where every mapped source cell is blank.
    const allBlank = mapped.every(([, header]) => {
      const idx = headerIndex.get(header);
      return idx === undefined || isBlank(row[idx]);
    });
    if (allBlank) continue;

    const obj: Record<string, unknown> = {};
    for (const [field, header] of mapped) {
      const idx = headerIndex.get(header);
      const cell = idx === undefined ? '' : row[idx];

      if (NUMERIC_FIELDS.has(field)) {
        obj[field] = parseNum(cell);
      } else if (DATE_FIELDS.has(field)) {
        // parseDateCell already returns a `YYYY-MM-DD` string (or null);
        // omit the field for blank/unparseable dates.
        const ymd = parseDateCell(cell);
        if (ymd) obj[field] = ymd;
      } else {
        obj[field] = isBlank(cell) ? '' : String(cell).trim();
      }
    }
    out.push(obj);
  }

  return out;
}
