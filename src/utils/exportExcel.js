import * as XLSX from 'xlsx';

export const exportToExcel = (filename, sheetName, columns, data) => {
    // Transform data to match columns
    const formattedData = data.map((row) => {
        const rowData = {};
        columns.forEach((col) => {
            let value = row[col.key];

            // Basic formatting for numbers if possible, but keep string if meant to be text.
            // Usually, currency fields have been formatted in the UI to string, 
            // so if we want proper excel numbers, we might need a raw value map.
            // For now, just use what we have in the row or evaluate render if simple.
            if (col.render && typeof col.render === 'function') {
                // Warning: col.render might return JSX. If so, fallback to raw value.
                const rendered = col.render(value, row);
                if (typeof rendered === 'string' || typeof rendered === 'number') {
                    value = rendered;
                }
            }

            // Clean up potentially string-formatted JSX issues.
            // Just use the row value.
            if (typeof value === 'object' && value !== null) {
                value = row[col.key] || '';
            }

            rowData[col.label] = value;
        });
        return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName || 'Data');

    // Auto-size columns reasonably
    const colWidths = columns.map(col => ({ wpx: Math.max(100, col.label.length * 10) }));
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
};
