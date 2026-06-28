import { describe, it, expect } from 'vitest';
import { buildPdfTableFromCsv } from '../exportPdf';

describe('buildPdfTableFromCsv', () => {
  // Mirrors a real AR-aging CSV: quoted text cells (some with commas/escaped
  // quotes), unquoted raw numbers, and a ragged trailing "Total" row.
  const arAgingCsv =
    'No Faktur,Pelanggan,Hari Lewat,Saldo,Current,90+\n' +
    '"INV-001","PT Maju, Jaya",12,1500000,0,1500000\n' +
    '"INV-002","CV ""Sentosa""",0,250000.5,250000.5,0\n' +
    'Total,,,1750000.5,250000.5,1500000';

  it('uses the first row as the header', () => {
    const t = buildPdfTableFromCsv(arAgingCsv)!;
    expect(t.head).toEqual([['No Faktur', 'Pelanggan', 'Hari Lewat', 'Saldo', 'Current', '90+']]);
  });

  it('keeps quoted cells as text, preserving commas and escaped quotes', () => {
    const { body } = buildPdfTableFromCsv(arAgingCsv)!;
    expect(body[0][0]).toBe('INV-001');
    expect(body[0][1]).toBe('PT Maju, Jaya');     // comma inside quotes not split
    expect(body[1][1]).toBe('CV "Sentosa"');      // "" unescaped to "
  });

  it('groups unquoted numbers with id-ID separators', () => {
    const { body } = buildPdfTableFromCsv(arAgingCsv)!;
    expect(body[0][3]).toBe('1.500.000');
    expect(body[1][3]).toBe('250.000,5');
  });

  it('right-aligns numeric columns only', () => {
    const { columnStyles } = buildPdfTableFromCsv(arAgingCsv)!;
    expect(columnStyles[3]).toEqual({ halign: 'right' }); // Saldo (numeric)
    expect(columnStyles[5]).toEqual({ halign: 'right' }); // 90+ (numeric)
    expect(columnStyles[1]).toBeUndefined();              // Pelanggan (text)
  });

  it('pads ragged rows to the header width', () => {
    const { head, body } = buildPdfTableFromCsv(arAgingCsv)!;
    expect(body[2]).toHaveLength(head[0].length);
    expect(body[2][1]).toBe(''); // empty cell in the Total row
    expect(body[2][3]).toBe('1.750.000,5');
  });

  it('returns null for an empty or blank CSV', () => {
    expect(buildPdfTableFromCsv('')).toBeNull();
    expect(buildPdfTableFromCsv('\n')).toBeNull();
  });
});
