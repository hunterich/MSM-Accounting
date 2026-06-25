import { describe, it, expect } from 'vitest';
import { pdfPageOffsets, sanitizePdfName } from '../downloadPdf';

describe('pdfPageOffsets', () => {
  it('returns a single offset when content fits one page', () => {
    expect(pdfPageOffsets(100, 297)).toEqual([0]);
  });
  it('treats an exact page height as one page', () => {
    expect(pdfPageOffsets(297, 297)).toEqual([0]);
  });
  it('adds a second page when content is just over one page', () => {
    expect(pdfPageOffsets(298, 297)).toEqual([0, -297]);
  });
  it('splits tall content into N negative offsets', () => {
    expect(pdfPageOffsets(600, 297)).toEqual([0, -297, -594]);
  });
  it('never returns an empty list for zero/negative input', () => {
    expect(pdfPageOffsets(0, 297)).toEqual([0]);
    expect(pdfPageOffsets(-5, 297)).toEqual([0]);
  });
});

describe('sanitizePdfName', () => {
  it('appends .pdf to a clean title', () => {
    expect(sanitizePdfName('Invoice_INV-2026-00001')).toBe('Invoice_INV-2026-00001.pdf');
  });
  it('replaces filesystem-unsafe characters', () => {
    expect(sanitizePdfName('a/b:c?')).toBe('a_b_c_.pdf');
  });
  it('collapses whitespace to underscores', () => {
    expect(sanitizePdfName('  hello world ')).toBe('hello_world.pdf');
  });
  it('falls back to "document" when empty or missing', () => {
    expect(sanitizePdfName('')).toBe('document.pdf');
    expect(sanitizePdfName(undefined)).toBe('document.pdf');
  });
});
