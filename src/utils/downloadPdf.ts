import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';

export type PaperSize = 'A4' | 'A5';

/**
 * Y-offsets (in mm) for placing one tall image across multiple PDF pages.
 * First page sits at 0; each subsequent page shifts the image up by one page height.
 */
export function pdfPageOffsets(totalMm: number, pageMm: number): number[] {
    if (!(totalMm > 0) || !(pageMm > 0)) return [0];
    const pages = Math.max(1, Math.ceil(totalMm / pageMm));
    return Array.from({ length: pages }, (_, i) => i === 0 ? 0 : -(i * pageMm));
}

/** Turn a document title into a safe `.pdf` filename. */
export function sanitizePdfName(title?: string): string {
    const base = (title || 'document')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/\.pdf$/i, '');
    return `${base || 'document'}.pdf`;
}

/**
 * Rasterize a DOM element and save it as an A4/A5 PDF (image-based, multi-page).
 * Renders via the browser (html-to-image), so it matches the on-screen preview
 * and tolerates modern CSS (Tailwind v4 oklch) that html2canvas cannot parse.
 */
export async function downloadElementAsPdf(
    el: HTMLElement,
    opts: { documentTitle?: string; paperSize?: PaperSize },
): Promise<void> {
    const format = opts.paperSize === 'A5' ? 'a5' : 'a4';
    const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
    const pdf = new jsPDF({ unit: 'mm', format, orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;
    const imgData = canvas.toDataURL('image/png');
    pdfPageOffsets(imgH, pageH).forEach((y, i) => {
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, y, pageW, imgH);
    });
    pdf.save(sanitizePdfName(opts.documentTitle));
}
