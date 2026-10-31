import { describe, it, expect } from 'vitest';
import { buildPdfAttachment, safePdfFilename, PdfAttachmentError, MAX_PDF_ATTACHMENT_BYTES } from '../pdf-attachment';

const pdfB64 = (body = 'hello') => Buffer.from(`%PDF-1.4\n${body}`).toString('base64');

describe('buildPdfAttachment', () => {
  it('accepts a real PDF and names it safely', () => {
    const a = buildPdfAttachment(pdfB64(), 'Invoice INV/2026/09/1', 'invoice');
    expect(a.filename).toBe('Invoice_INV_2026_09_1.pdf');
    expect(a.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('falls back to a default name', () => {
    expect(buildPdfAttachment(pdfB64(), undefined, 'invoice').filename).toBe('invoice.pdf');
    expect(buildPdfAttachment(pdfB64(), '///', 'invoice').filename).toBe('invoice.pdf');
  });

  it('rejects empty and non-string input', () => {
    expect(() => buildPdfAttachment('', 'x', 'f')).toThrow(PdfAttachmentError);
    expect(() => buildPdfAttachment(undefined, 'x', 'f')).toThrow(PdfAttachmentError);
    expect(() => buildPdfAttachment(123, 'x', 'f')).toThrow(PdfAttachmentError);
  });

  it('rejects data that is not base64', () => {
    expect(() => buildPdfAttachment('not base64!!', 'x', 'f')).toThrow(/base64/);
    expect(() => buildPdfAttachment('data:application/pdf;base64,AAAA', 'x', 'f')).toThrow(/base64/);
  });

  it('rejects content that is not a PDF', () => {
    const html = Buffer.from('<html>not a pdf</html>').toString('base64');
    expect(() => buildPdfAttachment(html, 'x', 'f')).toThrow(/not a PDF/);
  });

  it('rejects oversized attachments before decoding', () => {
    const big = Buffer.alloc(MAX_PDF_ATTACHMENT_BYTES + 1024, 65).toString('base64');
    expect(() => buildPdfAttachment(big, 'x', 'f')).toThrow(/too large/);
  });
});

describe('safePdfFilename', () => {
  it('strips path separators and unsafe characters', () => {
    expect(safePdfFilename('../../etc/passwd', 'f')).toBe('etc_passwd.pdf');
    expect(safePdfFilename('a b"c.pdf', 'f')).toBe('a_b_c.pdf');
  });
});
