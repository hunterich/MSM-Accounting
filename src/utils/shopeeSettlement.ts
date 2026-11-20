import * as XLSX from 'xlsx';
import { normalizeHeader } from './headerUtils';
import { isShopeeSettlement } from './marketplaceFormat';
import { SHOPEE_COLUMN_TO_KEY, SettlementFeeKey } from './settlementMapping';

export interface SettlementOrder {
  orderId: string;
  netReleased: number;
  charges: Partial<Record<SettlementFeeKey, number>>; // positive magnitudes
  settlementDate?: string;
  requireMappedCharges?: boolean;
}
export interface SettlementParseResult {
  orders: SettlementOrder[];
  totalNetReleased: number;
  nonOrderRows: Array<{ orderId: string; type: string; amount: number }>;
}

export async function parseShopeeSettlement(file: File): Promise<SettlementParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  if (!isShopeeSettlement(wb.SheetNames)) {
    throw new Error('This does not look like a Shopee settlement statement (expected Summary, Income and Adjustment sheets).');
  }
  const orders: SettlementOrder[] = [];
  const nonOrderRows: SettlementParseResult['nonOrderRows'] = [];
  const seen = new Set<string>();
  const incomeSheets = wb.SheetNames.filter(n => /^Income(?: - \d+)?$/.test(n));
  for (const name of incomeSheets) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false });
    const headerIdx = rows.findIndex(r => r.some(c => normalizeHeader(String(c ?? '')) === 'orderid'));
    if (headerIdx < 0) throw new Error(`${name} has no Order ID column.`);
    const rawHeader = rows[headerIdx].map(c => String(c ?? ''));
    const header = rawHeader.map(normalizeHeader);
    const orderCol = header.indexOf('orderid');
    const netCol = header.indexOf('totalreleasedamountrp');
    const viewCol = header.indexOf('viewby');
    const dateCol = header.indexOf('payoutcompleteddate');
    const productCol = header.indexOf('productprice');
    const endCol = header.indexOf('wht22');
    if (netCol < 0) throw new Error(`${name} has no Total Released Amount column.`);
    if (incomeSheets.length > 1 && viewCol < 0) throw new Error(`${name} has no View By column; order and SKU rows cannot be separated safely.`);
    const strict = viewCol >= 0;
    if (strict && (dateCol < 0 || productCol < 0 || endCol <= productCol)) throw new Error(`${name} is missing payout date or the expected financial columns; review the changed format.`);
    for (const row of rows.slice(headerIdx + 1)) {
      const orderId = String(row[orderCol] ?? '').trim();
      if (!orderId || !/\d/.test(orderId)) continue;
      if (strict) {
        const view = String(row[viewCol] ?? '').trim().toLowerCase();
        if (view === 'sku') continue;
        if (view !== 'order') throw new Error(`${name} has an unrecognised View By value for ${orderId}; review the file.`);
      }
      if (seen.has(orderId)) throw new Error(`Order ${orderId} appears more than once as an order-level income row. Review before importing.`);
      seen.add(orderId);
      const rawNet = row[netCol];
      if (rawNet === '' || rawNet == null || !Number.isFinite(Number(rawNet))) throw new Error(`Invalid released amount for ${orderId}.`);
      const charges: Partial<Record<SettlementFeeKey, number>> = {};
      for (let col = 0; col < header.length; col++) {
        const key = SHOPEE_COLUMN_TO_KEY[header[col]];
        const value = row[col];
        if (value === '' || value == null) continue;
        if (strict && col > productCol && col <= endCol && !key && Number(value) !== 0) throw new Error(`Unmapped financial column ${rawHeader[col]} has a value for ${orderId}; review the report format.`);
        if (!key) continue;
        const v = Number(value);
        if (!Number.isFinite(v)) throw new Error(`Invalid ${rawHeader[col]} amount for ${orderId}.`);
        if (!v) continue;
        const income = ['buyerShipping', 'shippingRebate', 'platformRebate'].includes(key);
        if (strict && ((income && v < 0) || (!income && v > 0))) throw new Error(`Unexpected sign for ${rawHeader[col]} on ${orderId}; review the transaction.`);
        charges[key] = (charges[key] ?? 0) + Math.abs(v);
      }
      let settlementDate: string | undefined;
      if (strict) {
        const rawDate = row[dateCol];
        if (typeof rawDate === 'number') {
          const d = XLSX.SSF.parse_date_code(rawDate);
          if (d) settlementDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
        } else settlementDate = String(rawDate ?? '').trim().slice(0, 10);
        const d = new Date(`${settlementDate}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate ?? '') || !Number.isFinite(d.valueOf()) || d.toISOString().slice(0, 10) !== settlementDate) throw new Error(`Invalid payout date for ${orderId}.`);
      }
      orders.push({ orderId, netReleased: Number(rawNet), charges, ...(strict ? { settlementDate, requireMappedCharges: true } : {}) });
    }
  }
  const adjustment = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Adjustment, { header: 1, blankrows: false });
  const adjustmentHeader = adjustment.findIndex(r => r.includes('Adjustment Amount'));
  if (adjustmentHeader >= 0) {
    const h = adjustment[adjustmentHeader].map(c => String(c ?? ''));
    for (const row of adjustment.slice(adjustmentHeader + 1)) {
      const raw = row[h.indexOf('Adjustment Amount')];
      if (raw === '' || raw == null) continue;
      if (String(row[0] ?? '').trim().toLowerCase() === 'total amount') continue;
      const amount = Number(raw);
      if (!Number.isFinite(amount)) throw new Error('Invalid Shopee adjustment amount.');
      const type = String(row[h.indexOf('Adjustment Type | Description')] ?? '').trim();
      if (amount && !type) throw new Error('An adjustment has no description; review the Shopee report.');
      if (amount) nonOrderRows.push({ orderId: String(row[h.indexOf('Linked Order No.')] ?? ''), type, amount });
    }
  }
  return { orders, totalNetReleased: orders.reduce((s, o) => s + o.netReleased, 0), nonOrderRows };
}
