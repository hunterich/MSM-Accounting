import { Card } from '../components/Card.js';
import { Table } from '../components/Table.js';
import { Button } from '../components/Button.js';
import { StatusTag } from '../components/StatusTag.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container ap-module';

    // Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = 'var(--spacing-6)';

    const title = document.createElement('h1');
    title.textContent = 'Accounts Payable';
    title.style.marginBottom = '0';
    header.appendChild(title);

    const newBtn = Button({
        text: 'New Bill',
        variant: 'primary',
        onClick: () => {
            history.pushState(null, null, '/ap/new');
            window.dispatchEvent(new PopStateEvent('popstate'));
        }
    });
    header.appendChild(newBtn);
    container.appendChild(header);

    // Bills List
    // Mock Data
    const bills = [
        { id: 'BILL-5001', vendor: 'Office Depot', date: '2023-10-02', due: '2023-10-15', amount: '$450.00', status: 'Peid' },
        { id: 'BILL-5002', vendor: 'AWS', date: '2023-10-01', due: '2023-10-31', amount: '$1,200.00', status: 'Unpaid' },
        { id: 'BILL-5003', vendor: 'WeWork', date: '2023-10-01', due: '2023-10-05', amount: '$3,500.00', status: 'Overdue' },
        { id: 'BILL-5004', vendor: 'Slack', date: '2023-10-15', due: '2023-11-15', amount: '$25.00', status: 'Pending' }
    ];

    const columns = [
        { key: 'id', label: 'Bill #', sortable: true },
        { key: 'vendor', label: 'Vendor', sortable: true },
        { key: 'date', label: 'Issue Date', sortable: true },
        { key: 'due', label: 'Due Date', sortable: true },
        { key: 'amount', label: 'Amount', align: 'right' },
        { key: 'status', label: 'Status', render: (val) => StatusTag({ status: val === 'Peid' ? 'Paid' : val }) }, // Fix typo in mock data
        { key: 'actions', label: '', render: (val, row) => Button({ text: 'View', size: 'small', variant: 'tertiary' }) }
    ];

    const tableCard = Card({
        content: Table({ columns, data: bills }),
        padding: false
    });

    container.appendChild(tableCard);
    return container;
}
