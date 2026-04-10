import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type VendorLike = {
  id: string;
  name: string;
  npwp?: string | null;
  defaultApAccountId?: string | null;
};

export type ItemLike = {
  id: string;
  sku: string;
  name: string;
  unit?: string | null;
  inventoryAccountId?: string | null;
};

export type AccountLike = {
  id: string;
  code: string;
  name: string;
};

export type VendorDocumentMappingLike = {
  vendorId: string;
  supplierLabel: string;
  normalizedSupplierLabel: string;
  itemId?: string | null;
  accountId?: string | null;
};

export type BillImportSuggestion = {
  id: string;
  label: string;
  confidence: number;
  reason: string;
};

export type BillImportLineDraft = {
  lineNo: number;
  rawText: string;
  supplierLabel: string;
  supplierSku?: string | null;
  description: string;
  quantity: number;
  unit: string;
  price: number;
  lineTotal: number;
  itemId?: string | null;
  accountId?: string | null;
  itemSuggestion?: BillImportSuggestion | null;
  reviewStatus: 'matched' | 'needs_review';
};

export type BillImportReviewData = {
  vendorId?: string | null;
  vendorSuggestion?: BillImportSuggestion | null;
  issueDate: string;
  dueDate: string;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  totalAmount: number;
  notes: string;
  lines: BillImportLineDraft[];
  needsReviewCount: number;
  readyToImport: boolean;
};

const FILE_STORAGE_ROOT = path.join(process.cwd(), '.data', 'bill-imports');
const DATE_LABELS = {
  issue: ['tanggal invoice', 'invoice date', 'tanggal', 'date'],
  due: ['jatuh tempo', 'due date', 'tempo'],
};
const TOTAL_LABELS = {
  subtotal: ['subtotal', 'sub total', 'dpp'],
  tax: ['ppn', 'vat', 'tax'],
  total: ['grand total', 'total invoice', 'total'],
};
const LINE_SKIP_PREFIXES = [
  'invoice',
  'faktur',
  'tagihan',
  'bill',
  'npwp',
  'vendor',
  'supplier',
  'tanggal',
  'date',
  'jatuh tempo',
  'due',
  'subtotal',
  'total',
  'grand total',
  'ppn',
  'tax',
  'balance',
  'amount due',
  'page',
];

import { roundMoney } from '@/lib/money';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const normalizeSupplierLabel = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const parseMoneyToken = (value: string): number => {
  const cleaned = value.replace(/rp/gi, '').replace(/\s+/g, '').trim();
  if (!cleaned) return 0;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    return Number.parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }

  if (cleaned.includes(',')) {
    const parts = cleaned.split(',');
    if (parts[1] && parts[1].length <= 2) {
      return Number.parseFloat(`${parts[0].replace(/\./g, '')}.${parts[1]}`) || 0;
    }
    return Number.parseFloat(cleaned.replace(/,/g, '')) || 0;
  }

  return Number.parseFloat(cleaned.replace(/\./g, '')) || 0;
};

const parseDateToken = (value: string): string | null => {
  const trimmed = value.trim();
  const iso = trimmed.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = trimmed.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (dmy) {
    return `${dmy[3]}-${String(Number(dmy[2])).padStart(2, '0')}-${String(Number(dmy[1])).padStart(2, '0')}`;
  }

  return null;
};

const findDateByLabels = (text: string, labels: string[]): string => {
  const lower = text.toLowerCase();
  for (const label of labels) {
    const index = lower.indexOf(label);
    if (index >= 0) {
      const snippet = text.slice(index, index + 80);
      const parsed = parseDateToken(snippet);
      if (parsed) return parsed;
    }
  }
  return '';
};

const findAmountByLabels = (text: string, labels: string[]): number => {
  const lower = text.toLowerCase();
  for (const label of labels) {
    const regex = new RegExp(`${escapeRegex(label)}[^\\d]*(rp\\.?\\s*)?([\\d., ]+)`, 'i');
    const match = text.match(regex);
    if (match?.[2]) {
      const amount = parseMoneyToken(match[2]);
      if (amount > 0) return amount;
    }

    const index = lower.indexOf(label);
    if (index >= 0) {
      const snippet = text.slice(index, index + 120);
      const values = Array.from(snippet.matchAll(/(?:rp\.?\s*)?[\d., ]+/gi))
        .map((candidate) => parseMoneyToken(candidate[0]))
        .filter((value) => value > 0);
      if (values.length > 0) return values[values.length - 1];
    }
  }

  return 0;
};

const sanitizePdfText = (text: string) =>
  text
    .replace(/\u0000/g, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const splitPdfLines = (text: string) =>
  sanitizePdfText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const isLikelyLineItem = (line: string) => {
  const lower = line.toLowerCase();
  if (line.length < 6 || line.length > 180) return false;
  if (!/\d/.test(line)) return false;
  if (LINE_SKIP_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  return /(rp\.?\s*)?[\d., ]+$/.test(lower) || /\d+\s*[a-z]{0,4}\s+\d/.test(lower);
};

const buildDescriptionFromLine = (line: string, supplierSku: string | null) => {
  let description = line;
  description = description.replace(/(?:rp\.?\s*)?[\d., ]+$/gi, '').trim();
  if (supplierSku) {
    description = description.replace(new RegExp(`\\b${escapeRegex(supplierSku)}\\b`, 'i'), '').trim();
  }
  description = description.replace(/\b\d+(?:[.,]\d+)?\s*(pcs|pc|unit|box|pack|kg|gr|set|roll|sheet)\b/i, '').trim();
  description = description.replace(/\s{2,}/g, ' ').trim();
  return description || line.trim();
};

const parseLineQuantity = (line: string, price: number, total: number) => {
  const qtyWithUnit = line.match(/\b(\d+(?:[.,]\d+)?)\s*(pcs|pc|unit|box|pack|kg|gr|set|roll|sheet)\b/i);
  if (qtyWithUnit) {
    return Number.parseFloat(qtyWithUnit[1].replace(',', '.')) || 1;
  }

  if (price > 0 && total > 0) {
    const ratio = total / price;
    if (Number.isFinite(ratio) && ratio > 0.99 && Math.abs(ratio - Math.round(ratio)) < 0.05) {
      return Math.max(1, Math.round(ratio));
    }
  }

  return 1;
};

const extractSku = (line: string) => {
  const match = line.match(/\b([A-Z0-9]{2,}(?:[-/][A-Z0-9]{2,})+)\b/);
  return match?.[1] ?? null;
};

const extractLineDrafts = (text: string): BillImportLineDraft[] => {
  const candidates = splitPdfLines(text).filter(isLikelyLineItem);
  const drafts = candidates
    .map((line, index) => {
      const monetaryValues = Array.from(line.matchAll(/(?:rp\.?\s*)?[\d., ]+/gi))
        .map((match) => parseMoneyToken(match[0]))
        .filter((value) => value > 0);

      if (monetaryValues.length === 0) return null;

      const lineTotal = roundMoney(monetaryValues[monetaryValues.length - 1]);
      const price = roundMoney(monetaryValues.length > 1 ? monetaryValues[monetaryValues.length - 2] : lineTotal);
      const supplierSku = extractSku(line);
      const description = buildDescriptionFromLine(line, supplierSku);
      const quantity = parseLineQuantity(line, price, lineTotal);
      const supplierLabel = supplierSku || description;

      return {
        lineNo: index + 1,
        rawText: line,
        supplierLabel,
        supplierSku,
        description,
        quantity,
        unit: 'PCS',
        price,
        lineTotal,
        itemId: null,
        accountId: null,
        itemSuggestion: null,
        reviewStatus: 'needs_review' as const,
      };
    })
    .filter(Boolean) as BillImportLineDraft[];

  return drafts.slice(0, 100);
};

const findVendorSuggestion = (
  text: string,
  vendors: VendorLike[],
): BillImportSuggestion | null => {
  const lower = text.toLowerCase();

  for (const vendor of vendors) {
    if (vendor.npwp) {
      const normalizedNpwp = vendor.npwp.replace(/\D/g, '');
      if (normalizedNpwp && lower.replace(/\D/g, '').includes(normalizedNpwp)) {
        return {
          id: vendor.id,
          label: vendor.name,
          confidence: 0.99,
          reason: 'Matched vendor NPWP from the document',
        };
      }
    }
  }

  const scored = vendors
    .map((vendor) => {
      const vendorName = normalizeSupplierLabel(vendor.name);
      const exact = vendorName && lower.includes(vendorName);
      const vendorWords = new Set(vendorName.split(' ').filter((token) => token.length > 2));
      const overlap = [...vendorWords].filter((token) => lower.includes(token)).length;
      const confidence = exact ? 0.94 : vendorWords.size > 0 ? overlap / vendorWords.size : 0;
      return {
        vendor,
        confidence,
      };
    })
    .filter((entry) => entry.confidence >= 0.5)
    .sort((left, right) => right.confidence - left.confidence);

  if (scored.length === 0) return null;

  const top = scored[0];
  return {
    id: top.vendor.id,
    label: top.vendor.name,
    confidence: roundMoney(top.confidence),
    reason: top.confidence >= 0.9 ? 'Exact vendor name found in PDF text' : 'Partial vendor name match found in PDF text',
  };
};

const scoreLabelMatch = (needle: string, haystack: string) => {
  if (!needle || !haystack) return 0;
  if (needle === haystack) return 1;
  if (haystack.includes(needle) || needle.includes(haystack)) return 0.86;

  const needleWords = new Set(needle.split(' ').filter((token) => token.length > 1));
  const hayWords = new Set(haystack.split(' ').filter((token) => token.length > 1));
  if (needleWords.size === 0 || hayWords.size === 0) return 0;
  const overlap = [...needleWords].filter((token) => hayWords.has(token)).length;
  return overlap / Math.max(needleWords.size, hayWords.size);
};

const matchLineItem = (
  line: BillImportLineDraft,
  vendorId: string | null,
  items: ItemLike[],
  mappings: VendorDocumentMappingLike[],
): Pick<BillImportLineDraft, 'itemId' | 'accountId' | 'itemSuggestion' | 'reviewStatus'> => {
  const normalizedLabel = normalizeSupplierLabel(line.supplierLabel || line.description);

  if (vendorId) {
    const mapping = mappings.find((entry) =>
      entry.vendorId === vendorId &&
      entry.normalizedSupplierLabel === normalizedLabel,
    );

    if (mapping) {
      return {
        itemId: mapping.itemId ?? null,
        accountId: mapping.accountId ?? null,
        itemSuggestion: {
          id: mapping.itemId || mapping.accountId || normalizedLabel,
          label: mapping.supplierLabel,
          confidence: 0.99,
          reason: 'Matched previously approved supplier mapping',
        },
        reviewStatus: mapping.itemId || mapping.accountId ? 'matched' : 'needs_review',
      };
    }
  }

  const candidates = items
    .map((item) => {
      const normalizedSku = normalizeSupplierLabel(item.sku);
      const normalizedName = normalizeSupplierLabel(item.name);
      const skuScore = line.supplierSku ? scoreLabelMatch(normalizeSupplierLabel(line.supplierSku), normalizedSku) : 0;
      const nameScore = Math.max(
        scoreLabelMatch(normalizedLabel, normalizedName),
        scoreLabelMatch(normalizeSupplierLabel(line.description), normalizedName),
      );
      const score = Math.max(skuScore, nameScore);
      return { item, score, matchedBy: skuScore >= nameScore ? 'SKU' : 'description' };
    })
    .filter((entry) => entry.score >= 0.6)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return {
      itemId: null,
      accountId: null,
      itemSuggestion: null,
      reviewStatus: 'needs_review',
    };
  }

  const best = candidates[0];
  const runnerUp = candidates[1];
  const ambiguous = runnerUp && Math.abs(best.score - runnerUp.score) < 0.08;
  const confidence = ambiguous ? Math.max(0.6, roundMoney(best.score - 0.1)) : roundMoney(best.score);
  const accountId = best.item.inventoryAccountId ?? null;
  const matched = confidence >= 0.8 && Boolean(best.item.id) && Boolean(accountId);

  return {
    itemId: matched ? best.item.id : null,
    accountId: matched ? accountId : null,
    itemSuggestion: {
      id: best.item.id,
      label: `${best.item.sku} - ${best.item.name}`,
      confidence,
      reason: ambiguous
        ? 'Potential item match found, but another close candidate exists'
        : `Matched by ${best.matchedBy}`,
    },
    reviewStatus: matched ? 'matched' : 'needs_review',
  };
};

export const summarizeBillImportReview = (reviewData: BillImportReviewData) => {
  const missingHeader = !reviewData.vendorId || !reviewData.issueDate;
  const invalidLines = reviewData.lines.filter((line) => !line.description || (!line.itemId && !line.accountId));

  return {
    needsReviewCount: invalidLines.length + (missingHeader ? 1 : 0),
    readyToImport: !missingHeader && reviewData.lines.length > 0 && invalidLines.length === 0,
  };
};

export function analyzeBillImportText(input: {
  text: string;
  fileName: string;
  vendors: VendorLike[];
  items: ItemLike[];
  mappings: VendorDocumentMappingLike[];
}) {
  const sanitizedText = sanitizePdfText(input.text);
  const vendorSuggestion = findVendorSuggestion(sanitizedText, input.vendors);
  const baseLines = extractLineDrafts(sanitizedText);

  const lines = baseLines.map((line) => ({
    ...line,
    ...matchLineItem(line, vendorSuggestion?.id ?? null, input.items, input.mappings),
  }));

  const subtotal = findAmountByLabels(sanitizedText, TOTAL_LABELS.subtotal)
    || roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const taxAmount = findAmountByLabels(sanitizedText, TOTAL_LABELS.tax);
  const totalAmount = findAmountByLabels(sanitizedText, TOTAL_LABELS.total) || roundMoney(subtotal + taxAmount);
  const taxRate = subtotal > 0 && taxAmount > 0 ? roundMoney((taxAmount / subtotal) * 100) : 0;

  const reviewData: BillImportReviewData = {
    vendorId: vendorSuggestion?.id ?? null,
    vendorSuggestion,
    issueDate: findDateByLabels(sanitizedText, DATE_LABELS.issue),
    dueDate: findDateByLabels(sanitizedText, DATE_LABELS.due),
    taxRate,
    taxAmount,
    subtotal,
    totalAmount,
    notes: `Imported from supplier PDF: ${input.fileName}`,
    lines,
    needsReviewCount: 0,
    readyToImport: false,
  };

  const summary = summarizeBillImportReview(reviewData);
  reviewData.needsReviewCount = summary.needsReviewCount;
  reviewData.readyToImport = summary.readyToImport;

  return {
    text: sanitizedText,
    extractedData: {
      fileName: input.fileName,
      issueDate: reviewData.issueDate,
      dueDate: reviewData.dueDate,
      subtotal,
      taxAmount,
      totalAmount,
      lineCount: lines.length,
    },
    reviewData,
  };
}

export async function extractPdfText(buffer: Buffer) {
  const module = await import('pdf-parse');
  const pdfParse = (module as { default?: (input: Buffer) => Promise<{ text?: string }> }).default
    ?? (module as unknown as (input: Buffer) => Promise<{ text?: string }>);
  const result = await pdfParse(buffer);
  return sanitizePdfText(result.text || '');
}

export async function persistBillImportFile(params: {
  organizationId: string;
  fileName: string;
  buffer: Buffer;
}) {
  const fileExtension = path.extname(params.fileName) || '.pdf';
  const safeName = `${randomUUID()}${fileExtension.toLowerCase()}`;
  const directory = path.join(FILE_STORAGE_ROOT, params.organizationId);
  await mkdir(directory, { recursive: true });
  const absolutePath = path.join(directory, safeName);
  await writeFile(absolutePath, params.buffer);
  return {
    storageKey: path.relative(process.cwd(), absolutePath),
    fileSizeKb: roundMoney(params.buffer.byteLength / 1024),
  };
}
