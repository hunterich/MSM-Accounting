import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatDateID } from './formatters';

export const exportToPdf = (filename, title, columns, data, companyInfo = null) => {
    const doc = new jsPDF('p', 'pt', 'a4'); // Portrait, points, A4

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
    const tableCols = columns.map(col => ({ header: col.label, dataKey: col.key }));

    // Format data - handle react elements / subtotal rows if possible
    const tempElement = document.createElement('div');
    const tableData = data.map(row => {
        const rowData = {};
        columns.forEach(col => {
            let val = row[col.key];
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

    const alignMap = {
        'left': 'left',
        'center': 'center',
        'right': 'right'
    };

    const columnStyles = {};
    columns.forEach((col, index) => {
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
        didParseCell: function (data) {
            if (data.row.raw && data.row.raw._isSubtotal) {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.textColor = [15, 23, 42]; // dark text for subtotal
                if (data.row.index % 2 === 0) {
                    data.cell.styles.fillColor = [241, 245, 249]; // neutral-100
                }
            }
        }
    });

    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
};
