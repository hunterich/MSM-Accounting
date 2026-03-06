export function Table({ columns, data, onRowClick, className = '' }) {
    const tableWrapper = document.createElement('div');
    tableWrapper.className = `table-responsive ${className}`;

    const table = document.createElement('table');
    table.className = 'table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    columns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label;
        if (col.sortable) {
            th.classList.add('sortable');
            // Add sort icon placeholder or logic here
            th.style.cursor = 'pointer';
        }
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');

    if (data.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = columns.length;
        td.className = 'text-center p-4 text-neutral-500';
        td.textContent = 'No data available';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        data.forEach(row => {
            const tr = document.createElement('tr');
            if (onRowClick) {
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => onRowClick(row));
            }

            columns.forEach(col => {
                const td = document.createElement('td');
                if (col.render) {
                    const content = col.render(row[col.key], row);
                    if (content instanceof Node) {
                        td.appendChild(content);
                    } else {
                        td.innerHTML = content;
                    }
                } else {
                    td.textContent = row[col.key] || '';
                }
                if (col.align) {
                    td.style.textAlign = col.align;
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    table.appendChild(tbody);
    tableWrapper.appendChild(table);

    return tableWrapper;
}
