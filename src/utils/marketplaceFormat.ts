import { normalizeHeader } from './headerUtils';

export interface PlatformSignature {
  platform: string;
  sheet?: string;      // preferred sheet name
  required: string[];  // header columns that must ALL be present (normalized match)
}

export const PLATFORM_SIGNATURES: PlatformSignature[] = [
  { platform: 'Shopee', sheet: 'Matched Orders', required: ['No. Pesanan', 'SKU Induk', 'Nama Produk'] },
  { platform: 'TikTok', sheet: 'Filtered Adjusted', required: ['Order ID', 'Seller SKU', 'Product Name'] },
];

export function detectPlatformFromHeaders(headers: string[], _sheetName?: string): string | null {
  const norm = new Set(headers.map(normalizeHeader));
  for (const sig of PLATFORM_SIGNATURES) {
    if (sig.required.every((h) => norm.has(normalizeHeader(h)))) return sig.platform;
  }
  return null;
}

export function preferredSheetFor(platform: string): string | undefined {
  return PLATFORM_SIGNATURES.find((s) => s.platform === platform)?.sheet;
}
