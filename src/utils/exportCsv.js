const escapeCsvValue = (value) => {
    const str = value == null ? '' : String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
};

export function exportToCsv(filename, rows, columns) {
    const header = columns.map((column) => escapeCsvValue(column.label)).join(',');
    const body = rows
        .map((row) => columns.map((column) => escapeCsvValue(row[column.key])).join(','))
        .join('\n');

    const csv = `${header}${body ? `\n${body}` : ''}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
}
