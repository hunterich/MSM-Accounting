import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatDateID } from './formatters';

export interface PdfColumn {
    label: string;
    key: string;
    align?: 'left' | 'center' | 'right';
}

export interface PdfCompanyInfo {
    name?: string;
    address?: string;
    npwp?: string;
}

export interface PdfDataRow {
    isSubtotal?: boolean;
    subGroup?: string;
    [key: string]: unknown;
}

// Extend jsPDF with autoTable plugin type
type JsPDFWithAutoTable = jsPDF & {
    autoTable: (options: Record<string, unknown>) => void;
};

export const exportToPdf = (
    filename: string,
    title: string,
    columns: PdfColumn[],
    data: PdfDataRow[],
    companyInfo: PdfCompanyInfo | null = null,
): void => {
    const doc = new jsPDF('p', 'pt', 'a4') as JsPDFWithAutoTable; // Portrait, points, A4

    const pageWidth = doc.internal.pageSize.getWidth();
    let currentY = 40;

    // Optional company header
    if (companyInfo) {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(companyInfo.name || 'Company Name', 40, currentY);
        currentY += 15;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        if (companyInfo.address) {
            const splitAddress = doc.splitTextToSize(companyInfo.address, 250);
            doc.text(splitAddress, 40, currentY);
            currentY += (splitAddress.length * 12) + 5;
        }
        if (companyInfo.npwp) {
            doc.text(`NPWP: ${companyInfo.npwp}`, 40, currentY);
            currentY += 15;
        }
    }

    // Title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    currentY += 10;
    doc.text(title || 'Report', 40, currentY);

    // Date generated
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const dateStr = `Generated on: ${formatDateID(new Date().toISOString().split('T')[0])}`;
    doc.text(dateStr, pageWidth - 40 - doc.getTextWidth(dateStr), currentY);

    currentY += 15;

    // Define columns for autotable
    const tableCols = columns.map((col) => ({ header: col.label, dataKey: col.key }));

    // Format data - handle react elements / subtotal rows if possible
    const tableData = data.map((row) => {
        const rowData: Record<string, unknown> = {};
        columns.forEach((col) => {
            let val: unknown = row[col.key];
            if (val === undefined || val === null) val = '';

            // If it's a subtotal row or has a custom string render, we could try to extract it from a render func or just use value directly.
            // Usually we format it if it needs to, but we'll try to rely on the raw value for now.
            if (row.isSubtotal) {
                if (col.key === 'amount' || col.key === 'amountValue' || col.key === 'bVal' || col.key === 'diff') {
                    // The Reports component formats amounts in some tabs, leaves as numbers in others.
                    if (val !== '') rowData[col.key] = val;
                } else if (col.key === 'account' || col.key === 'description') {
                    rowData[col.key] = `Subtotal ${row.subGroup || ''}`;
                }
            } else {
                rowData[col.key] = String(val);
            }
        });

        // Add a flag for styling
        if (row.isSubtotal) {
            rowData._isSubtotal = true;
        }
        return rowData;
    });

    const alignMap: Record<string, string> = {
        'left': 'left',
        'center': 'center',
        'right': 'right',
    };

    const columnStyles: Record<string, { halign: string }> = {};
    columns.forEach((col) => {
        if (col.align) {
            columnStyles[col.key] = { halign: alignMap[col.align] || 'left' };
        }
    });

    doc.autoTable({
        startY: currentY,
        columns: tableCols,
        body: tableData,
        theme: 'striped',
        headStyles: {
            fillColor: [15, 23, 42], // neutral-900
            textColor: 255,
            fontSize: 9,
            fontStyle: 'bold',
        },
        styles: {
            fontSize: 8,
            cellPadding: 4,
        },
        columnStyles: columnStyles,
        didParseCell: function (data: { row: { raw: Record<string, unknown>; index: number }; cell: { styles: Record<string, unknown> } }) {
            if (data.row.raw && data.row.raw._isSubtotal) {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.textColor = [15, 23, 42]; // dark text for subtotal
                if (data.row.index % 2 === 0) {
                    data.cell.styles.fillColor = [241, 245, 249]; // neutral-100
                }
            }
        },
    });

    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
};

// ── Generic CSV-string → PDF ─────────────────────────────────────────────────
// Lets any report that already produces a CSV string get a formatted PDF export
// for free, without a hand-written column map. Quoted CSV cells are treated as
// text (preserved verbatim); unquoted numeric cells are grouped/right-aligned.

interface ParsedCell {
    value: string;
    quoted: boolean;
}

// Minimal RFC-4180-ish parser: handles "" escaping and commas/newlines inside
// quoted fields. Tracks whether each field was quoted so we can tell a numeric
// value (unquoted) apart from a numeric-looking code like an invoice number.
const parseCsv = (text: string): ParsedCell[][] => {
    const rows: ParsedCell[][] = [];
    let row: ParsedCell[] = [];
    let field = '';
    let inQuotes = false;
    let fieldQuoted = false;

    const pushField = () => {
        row.push({ value: field, quoted: fieldQuoted });
        field = '';
        fieldQuoted = false;
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === '"') { inQuotes = true; fieldQuoted = true; }
        else if (ch === ',') pushField();
        else if (ch === '\n') { pushField(); rows.push(row); row = []; }
        else if (ch !== '\r') field += ch;
    }
    pushField();
    rows.push(row);
    return rows;
};

const idGroup = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

const isNumericCell = (cell: ParsedCell): boolean =>
    !cell.quoted && cell.value.trim() !== '' && Number.isFinite(Number(cell.value));

export interface PdfTableModel {
    head: string[][];
    body: string[][];
    columnStyles: Record<number, { halign: string }>;
}

// Pure transform: CSV string → autotable-ready model. Quoted cells stay text;
// unquoted numbers are grouped (id-ID) and their column right-aligned; ragged
// rows are padded to the header width. Returns null when there is no data.
export const buildPdfTableFromCsv = (csv: string): PdfTableModel | null => {
    const parsed = parseCsv(csv).filter((r) => r.length > 0 && !(r.length === 1 && r[0].value === ''));
    if (parsed.length === 0) return null;

    const headerRow = parsed[0];
    const bodyRows = parsed.slice(1);
    const colCount = headerRow.length;

    const head = [headerRow.map((c) => c.value)];
    const body = bodyRows.map((r) =>
        Array.from({ length: colCount }, (_, colIdx) => {
            const cell = r[colIdx];
            if (!cell) return '';
            return isNumericCell(cell) ? idGroup.format(Number(cell.value)) : cell.value;
        })
    );

    // A column is right-aligned when any of its body cells is an unquoted number.
    const columnStyles: Record<number, { halign: string }> = {};
    headerRow.forEach((_, colIdx) => {
        if (bodyRows.some((r) => r[colIdx] && isNumericCell(r[colIdx]))) {
            columnStyles[colIdx] = { halign: 'right' };
        }
    });

    return { head, body, columnStyles };
};

export const exportCsvToPdf = (
    filename: string,
    title: string,
    csv: string,
    companyInfo: PdfCompanyInfo | null = null,
    subtitle?: string,
): void => {
    const table = buildPdfTableFromCsv(csv);
    if (!table) return;

    const doc = new jsPDF('p', 'pt', 'a4') as JsPDFWithAutoTable;
    const pageWidth = doc.internal.pageSize.getWidth();
    let currentY = 40;

    if (companyInfo) {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(companyInfo.name || 'Company Name', 40, currentY);
        currentY += 15;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        if (companyInfo.address) {
            const splitAddress = doc.splitTextToSize(companyInfo.address, 250);
            doc.text(splitAddress, 40, currentY);
            currentY += (splitAddress.length * 12) + 5;
        }
        if (companyInfo.npwp) {
            doc.text(`NPWP: ${companyInfo.npwp}`, 40, currentY);
            currentY += 15;
        }
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    currentY += 10;
    doc.text(title || 'Report', 40, currentY);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const dateStr = `Generated on: ${formatDateID(new Date().toISOString().split('T')[0])}`;
    doc.text(dateStr, pageWidth - 40 - doc.getTextWidth(dateStr), currentY);

    if (subtitle) {
        currentY += 14;
        doc.setFontSize(9);
        doc.text(subtitle, 40, currentY);
    }
    currentY += 15;

    doc.autoTable({
        startY: currentY,
        head: table.head,
        body: table.body,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 4 },
        columnStyles: table.columnStyles,
    });

    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
};
