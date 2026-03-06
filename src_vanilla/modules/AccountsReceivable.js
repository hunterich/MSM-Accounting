import { Card } from '../components/Card.js';
import { Table } from '../components/Table.js';
import { Button } from '../components/Button.js';
import { StatusTag } from '../components/StatusTag.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container ar-module';

    // Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = 'var(--spacing-6)';

    const title = document.createElement('h1');
    title.textContent = 'Accounts Receivable';
    title.style.marginBottom = '0';
    header.appendChild(title);

    const newBtn = Button({
        text: 'New Invoice',
        variant: 'primary',
        onClick: () => {
            // Navigate to /ar/new (assuming router handles pushState via data-link or we call it manually)
            // Since my router intercepts data-link, I can just use history.pushState or a manual link
            history.pushState(null, null, '/ar/new');
            // Manually trigger popstate to make router pick it up? 
            // My router listens to popstate but pushState doesn't trigger it.
            // I should use a helper or dispatch event.
            window.dispatchEvent(new PopStateEvent('popstate'));
        }
    });
    header.appendChild(newBtn);
    container.appendChild(header);

    // Invoices List
    // Mock Data
    const invoices = [
        { id: 'INV-1001', client: 'Acme Corp', date: '2023-10-01', due: '2023-10-31', amount: '$1,200.00', status: 'Paid' },
        { id: 'INV-1002', client: 'Globex Inc', date: '2023-10-05', due: '2023-11-05', amount: '$3,500.00', status: 'Overdue' },
        { id: 'INV-1003', client: 'Soylent Corp', date: '2023-10-12', due: '2023-11-12', amount: '$850.00', status: 'Sent' },
        { id: 'INV-1004', client: 'Initech', date: '2023-10-15', due: '2023-11-15', amount: '$2,100.00', status: 'Draft' }
    ];

    const columns = [
        { key: 'id', label: 'Invoice #', sortable: true },
        { key: 'client', label: 'Customer', sortable: true },
        { key: 'date', label: 'Issue Date', sortable: true },
        { key: 'due', label: 'Due Date', sortable: true },
        { key: 'amount', label: 'Amount', align: 'right' },
        { key: 'status', label: 'Status', render: (val) => StatusTag({ status: val }) },
        { key: 'actions', label: '', render: (val, row) => Button({ text: 'View', size: 'small', variant: 'tertiary' }) }
    ];

    const tableCard = Card({
        content: Table({ columns, data: invoices }),
        padding: false
    });

    container.appendChild(tableCard);
    return container;
}
