import * as XLSX from 'xlsx';
import type { Decimal } from '@prisma/client/runtime/index-browser.js';
import { roundMoneyDecimal } from '@/lib/money-decimal';
import { normalizeHeader } from './headerUtils';
import { isTikTokSettlement } from './marketplaceFormat';
import { readMarketplaceDecimal } from './marketplaceMoney';
import { TIKTOK_COLUMN_TO_KEY } from './settlementMapping';
import { settlementPostingCharges, totalSettlementPayout, type SettlementCharges } from './settlementMoney';
import type { SettlementParseResult } from './shopeeSettlement';

export async function parseTikTokSettlement(file: File): Promise<SettlementParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  if (!isTikTokSettlement(wb.SheetNames)) {
    throw new Error('This does not look like a TikTok settlement statement (expected a "Detail pesanan" sheet).');
  }
  const ws = wb.Sheets['Detail pesanan'];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const rawHeader = (rows[0] ?? []).map(c => String(c ?? ''));
  const header = rawHeader.map(normalizeHeader);
  const orderCol = header.indexOf('idpesananpenyesuaian');
  const typeCol = header.indexOf('jenistransaksi');
  const netCol = header.indexOf('jumlahpenyelesaianpembayaran');
  if (orderCol < 0 || typeCol < 0 || netCol < 0) throw new Error('TikTok Detail pesanan sheet is missing expected columns.');

  const orders: SettlementParseResult['orders'] = [];
  const nonOrderRows: SettlementParseResult['nonOrderRows'] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const orderId = String(row[orderCol] ?? '').trim();
    if (!orderId) continue;
    const type = String(row[typeCol] ?? '').trim();
    const net = readMarketplaceDecimal(row[netCol], `released amount for ${orderId}`);
    if (type !== 'Pesanan') { nonOrderRows.push({ orderId, type, amount: net?.toNumber() ?? 0 }); continue; }
    if (!net) throw new Error(`Invalid released amount for ${orderId}.`);
    const charges: SettlementCharges<Decimal> = {};
    header.forEach((h, col) => {
      const key = TIKTOK_COLUMN_TO_KEY[h];
      if (!key) return;
      const v = readMarketplaceDecimal(row[col], `${rawHeader[col]} amount for ${orderId}`);
      if (!v || v.isZero()) return;
      charges[key] = v.abs().plus(charges[key] ?? 0);
    });
    orders.push({
      orderId,
      netReleased: roundMoneyDecimal(net).toFixed(2),
      charges: settlementPostingCharges(charges),
      requireMappedCharges: true,
    });
  }
  return { orders, totalNetReleased: totalSettlementPayout(orders), nonOrderRows };
}
