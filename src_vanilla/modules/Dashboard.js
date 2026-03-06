import { Card } from '../components/Card.js';
import { Table } from '../components/Table.js';
import { Button } from '../components/Button.js';
import { StatusTag } from '../components/StatusTag.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'dashboard container';

    // 1. Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = 'var(--spacing-6)';

    const title = document.createElement('h1');
    title.textContent = 'Dashboard';
    title.style.marginBottom = '0';
    header.appendChild(title);

    const newBtn = Button({
        text: 'Create New',
        variant: 'primary',
        onClick: () => console.log('Create New Clicked')
    });

    const editBtn = Button({
        text: 'Customize',
        variant: 'secondary',
        onClick: () => {
            container.classList.toggle('edit-mode');
            const isEdit = container.classList.contains('edit-mode');
            editBtn.textContent = isEdit ? 'Done' : 'Customize';
        }
    });
    editBtn.style.marginRight = 'var(--spacing-3)';

    const actionsDiv = document.createElement('div');
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(newBtn);
    header.appendChild(actionsDiv);
    container.appendChild(header);

    // 2. Grid for Widgets
    const grid = document.createElement('div');
    grid.className = 'grid-12';

    // KPI 1: Cash on Hand
    const kpi1 = Card({
        title: 'Cash on Hand',
        content: '<div style="font-size: 2rem; font-weight: bold; color: var(--color-neutral-900);">$124,500.00</div><div style="color: var(--color-success-500); font-size: 0.875rem;">↑ 5% from last month</div>',
        className: 'col-span-4'
    });
    kpi1.style.gridColumn = 'span 4'; // Fallback / explicit
    grid.appendChild(kpi1);

    // KPI 2: Overdue Invoices
    const kpi2 = Card({
        title: 'Overdue Invoices',
        content: '<div style="font-size: 2rem; font-weight: bold; color: var(--color-danger-500);">$12,340.00</div><div style="color: var(--color-neutral-600); font-size: 0.875rem;">8 invoices overdue</div>',
        className: 'col-span-4'
    });
    kpi2.style.gridColumn = 'span 4';
    grid.appendChild(kpi2);

    // KPI 3: Net Profit (YTD)
    const kpi3 = Card({
        title: 'Net Profit (YTD)',
        content: '<div style="font-size: 2rem; font-weight: bold; color: var(--color-primary-700);">$86,200.00</div><div style="color: var(--color-success-500); font-size: 0.875rem;">↑ 12% vs last year</div>',
        className: 'col-span-4'
    });
    kpi3.style.gridColumn = 'span 4';
    grid.appendChild(kpi3);

    // Recent Activity Table (Full Width)
    const recentInvoices = [
        { id: 'INV-1001', client: 'Acme Corp', date: '2023-10-01', amount: '$1,200.00', status: 'Paid' },
        { id: 'INV-1002', client: 'Globex Inc', date: '2023-10-05', amount: '$3,500.00', status: 'Overdue' },
        { id: 'INV-1003', client: 'Soylent Corp', date: '2023-10-12', amount: '$850.00', status: 'Sent' },
        { id: 'INV-1004', client: 'Initech', date: '2023-10-15', amount: '$2,100.00', status: 'Draft' },
        { id: 'INV-1005', client: 'Umbrella Corp', date: '2023-10-18', amount: '$5,000.00', status: 'Paid' },
    ];

    const columns = [
        { key: 'id', label: 'Invoice #', sortable: true },
        { key: 'client', label: 'Client', sortable: true },
        { key: 'date', label: 'Date', sortable: true },
        { key: 'amount', label: 'Amount', sortable: true, align: 'right' },
        { key: 'status', label: 'Status', render: (val) => StatusTag({ status: val }) }
    ];

    const tableComponent = Table({
        columns,
        data: recentInvoices,
        onRowClick: (row) => console.log('Clicked', row)
    });

    const tableCard = Card({
        title: 'Recent Invoices',
        content: tableComponent,
        actions: Button({ text: 'View All', variant: 'tertiary', size: 'small' }),
        padding: false
    });
    tableCard.style.gridColumn = 'span 12';
    tableCard.style.marginTop = 'var(--spacing-6)'; // specific spacing

    grid.appendChild(tableCard);

    container.appendChild(grid);
    return container;
}
