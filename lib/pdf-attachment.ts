// Validation for a PDF the browser renders and posts for emailing. The server
// never trusts the client: it checks the encoding, size and PDF signature, and
// builds a safe attachment filename.

export const MAX_PDF_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB decoded

export interface PdfAttachment {
  filename: string;
  content: Buffer;
}

export class PdfAttachmentError extends Error {}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function safePdfFilename(name: string | undefined, fallback: string): string {
  const base = (name || fallback)
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80);
  return `${base || fallback}.pdf`;
}

export function buildPdfAttachment(base64: unknown, name: string | undefined, fallbackName: string): PdfAttachment {
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new PdfAttachmentError('PDF attachment is empty');
  }
  // Reject before decoding: base64 inflates by 4/3, so this bounds the work done.
  if (base64.length > Math.ceil((MAX_PDF_ATTACHMENT_BYTES * 4) / 3) + 4) {
    throw new PdfAttachmentError('PDF attachment is too large (max 5 MB)');
  }
  if (base64.length % 4 !== 0 || !BASE64_RE.test(base64)) {
    throw new PdfAttachmentError('PDF attachment is not valid base64');
  }
  const content = Buffer.from(base64, 'base64');
  if (content.length > MAX_PDF_ATTACHMENT_BYTES) {
    throw new PdfAttachmentError('PDF attachment is too large (max 5 MB)');
  }
  if (content.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new PdfAttachmentError('Attachment is not a PDF');
  }
  return { filename: safePdfFilename(name, fallbackName), content };
}
