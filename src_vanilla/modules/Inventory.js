import { Card } from '../components/Card.js';
import { Table } from '../components/Table.js';
import { Button } from '../components/Button.js';
import { StatusTag } from '../components/StatusTag.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container inventory-module';

    // Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = 'var(--spacing-6)';

    const title = document.createElement('h1');
    title.textContent = 'Inventory Management';
    title.style.marginBottom = '0';
    header.appendChild(title);

    const newBtn = Button({
        text: 'Add Item',
        variant: 'primary',
        onClick: () => console.log('Add Item')
    });
    header.appendChild(newBtn);
    container.appendChild(header);

    // Inventory List
    const items = [
        { id: 'SKU-001', name: 'MacBook Pro 16"', category: 'Hardware', stock: 15, cost: '$2,200.00', price: '$2,500.00', status: 'In Stock' },
        { id: 'SKU-002', name: 'Dell XPS 13', category: 'Hardware', stock: 4, cost: '$900.00', price: '$1,200.00', status: 'Low Stock' },
        { id: 'SKU-003', name: 'USB-C Cable', category: 'Accessories', stock: 150, cost: '$5.00', price: '$15.00', status: 'In Stock' },
        { id: 'SKU-004', name: 'Monitor Stand', category: 'Accessories', stock: 0, cost: '$25.00', price: '$45.00', status: 'Out of Stock' }
    ];

    const columns = [
        { key: 'id', label: 'SKU', sortable: true },
        { key: 'name', label: 'Item Name', sortable: true },
        { key: 'category', label: 'Category', sortable: true },
        {
            key: 'stock', label: 'Stock', align: 'right', render: (val, row) => {
                const color = val === 0 ? 'var(--color-danger-500)' : (val < 5 ? 'var(--color-warning-500)' : 'inherit');
                return `<span style="color: ${color}; font-weight: bold;">${val}</span>`;
            }
        },
        { key: 'price', label: 'Price', align: 'right' },
        {
            key: 'status', label: 'Status', render: (val) => {
                let statusType = 'neutral';
                if (val === 'In Stock') statusType = 'success';
                if (val === 'Low Stock') statusType = 'warning';
                if (val === 'Out of Stock') statusType = 'danger';
                return StatusTag({ status: statusType, label: val });
            }
        },
        {
            key: 'actions', label: '', render: (val, row) => Button({
                text: 'View',
                size: 'small',
                variant: 'tertiary',
                onClick: () => {
                    // Navigate to detail with query param
                    history.pushState(null, null, `/inventory/detail?id=${row.id}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }
            })
        }
    ];

    const tableCard = Card({
        content: Table({
            columns, data: items, onRowClick: (row) => {
                history.pushState(null, null, `/inventory/detail?id=${row.id}`);
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        }),
        padding: false
    });

    container.appendChild(tableCard);
    return container;
}
