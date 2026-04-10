/**
 * Faktur (purchase invoice) image OCR extraction.
 *
 * Accepts JPEG/PNG/TIFF images of Indonesian supplier invoices (faktur pajak,
 * faktur pembelian, or general purchase invoices) and extracts structured data
 * using Tesseract.js OCR with Indonesian language support.
 *
 * The extracted text is then fed into the existing `analyzeBillImportText()`
 * pipeline for vendor/item matching and bill creation.
 */

import { roundMoney } from '@/lib/money';

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'image/bmp',
]);

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function isSupportedImageType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.has(mimeType.toLowerCase());
}

export function isSupportedImportFile(mimeType: string): boolean {
  return mimeType === 'application/pdf' || isSupportedImageType(mimeType);
}

export function validateImageUpload(file: File): string | null {
  const mime = file.type?.toLowerCase() || '';
  if (!isSupportedImageType(mime)) {
    const exts = [...SUPPORTED_IMAGE_TYPES].map((t) => t.split('/')[1]).join(', ');
    return `Unsupported image type. Supported: ${exts}`;
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `Image exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB`;
  }
  return null;
}

/**
 * Pre-process an image buffer for better OCR results:
 * - Convert to greyscale
 * - Normalize contrast
 * - Sharpen edges
 *
 * Uses sharp (libvips) which is much faster than pure-JS alternatives.
 */
export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(buffer)
    .greyscale()
    .normalize()
    .sharpen()
    .png() // Tesseract works best with PNG
    .toBuffer();
}

/**
 * Run Tesseract.js OCR on an image buffer.
 * Uses Indonesian + English language data for best results on faktur documents.
 */
export async function extractImageText(buffer: Buffer): Promise<string> {
  const processedBuffer = await preprocessImage(buffer);

  const Tesseract = await import('tesseract.js');
  const worker = await Tesseract.createWorker('ind+eng', undefined, {
    // Suppress Tesseract logger noise in production
    logger: process.env.NODE_ENV === 'development' ? undefined : () => {},
  });

  try {
    const result = await worker.recognize(processedBuffer);
    return sanitizeOcrText(result.data.text);
  } finally {
    await worker.terminate();
  }
}

/**
 * Clean up raw OCR output:
 * - Fix common OCR errors in Indonesian faktur documents
 * - Normalize whitespace
 * - Fix number formatting issues
 */
function sanitizeOcrText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r/g, '\n')
    // Common OCR substitutions in Indonesian tax docs
    .replace(/[|l]nvoice/gi, 'Invoice')
    .replace(/Rp\s*\./g, 'Rp.')
    // Normalize whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse Indonesian faktur pajak specific fields from OCR text.
 * These are fields unique to the Indonesian tax invoice format.
 */
export function parseFakturPajakFields(text: string): {
  nomorFaktur: string | null;
  npwpPenjual: string | null;
  npwpPembeli: string | null;
  dpp: number;
  ppn: number;
  tanggalFaktur: string | null;
} {
  const lines = text.split('\n').map((l) => l.trim());
  const lower = text.toLowerCase();

  // Nomor Faktur Pajak — format: XXX-XXX.XX.XXXXXXXX or similar patterns
  const fakturNoMatch = text.match(
    /(?:nomor\s+(?:faktur|seri)|no\.?\s*faktur)[^:]*[:\s]*([0-9]{3}[-.][0-9]{3}[-.][0-9]{2}[-.][0-9]{8})/i,
  );
  const nomorFaktur = fakturNoMatch?.[1]?.replace(/\s/g, '') ?? null;

  // NPWP patterns — XX.XXX.XXX.X-XXX.XXX
  const npwpPattern = /(\d{2}[.\s]?\d{3}[.\s]?\d{3}[.\s]?\d[.\s]?[-]?\d{3}[.\s]?\d{3})/g;
  const npwpMatches = [...text.matchAll(npwpPattern)].map((m) => m[1].replace(/\s/g, ''));

  // First NPWP is typically the seller, second is the buyer
  const npwpPenjual = npwpMatches[0] ?? null;
  const npwpPembeli = npwpMatches.length > 1 ? npwpMatches[1] : null;

  // DPP (Dasar Pengenaan Pajak / tax base)
  const dppMatch = text.match(/(?:dpp|dasar\s+pengenaan)[^0-9]*((?:rp\.?\s*)?[\d.,\s]+)/i);
  const dpp = dppMatch ? parseIndonesianMoney(dppMatch[1]) : 0;

  // PPN (Pajak Pertambahan Nilai / VAT)
  const ppnMatch = text.match(/(?:ppn|pajak\s+pertambahan\s+nilai)[^0-9]*((?:rp\.?\s*)?[\d.,\s]+)/i);
  const ppn = ppnMatch ? parseIndonesianMoney(ppnMatch[1]) : 0;

  // Tanggal (date)
  const dateLabels = ['tanggal', 'tgl', 'date'];
  let tanggalFaktur: string | null = null;
  for (const label of dateLabels) {
    const idx = lower.indexOf(label);
    if (idx >= 0) {
      const snippet = text.slice(idx, idx + 60);
      const isoMatch = snippet.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
      if (isoMatch) {
        tanggalFaktur = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        break;
      }
      const dmyMatch = snippet.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (dmyMatch) {
        tanggalFaktur = `${dmyMatch[3]}-${String(Number(dmyMatch[2])).padStart(2, '0')}-${String(Number(dmyMatch[1])).padStart(2, '0')}`;
        break;
      }
    }
  }

  return {
    nomorFaktur,
    npwpPenjual,
    npwpPembeli,
    dpp: roundMoney(dpp),
    ppn: roundMoney(ppn),
    tanggalFaktur,
  };
}

function parseIndonesianMoney(value: string): number {
  const cleaned = value.replace(/rp/gi, '').replace(/\s+/g, '').trim();
  if (!cleaned) return 0;

  // Handle Indonesian format: 1.234.567,89
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
}
