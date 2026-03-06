import { Card } from '../components/Card.js';
import { Table } from '../components/Table.js';
import { Button } from '../components/Button.js';
import { StatusTag } from '../components/StatusTag.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container banking-module';

    // 1. Header & Bank Accounts
    const header = document.createElement('h1');
    header.textContent = 'Banking & Reconciliation';
    header.style.marginBottom = 'var(--spacing-6)';
    container.appendChild(header);

    const bankGrid = document.createElement('div');
    bankGrid.className = 'grid-12';
    bankGrid.style.marginBottom = 'var(--spacing-8)';

    // Bank Account Cards
    const accounts = [
        { name: 'Business Checking', bank: 'Chase', last4: '4589', balance: '$80,000.00', status: 'Connected' },
        { name: 'Savings', bank: 'Chase', last4: '9921', balance: '$44,500.00', status: 'Connected' }
    ];

    accounts.forEach(acc => {
        const card = Card({
            title: acc.name,
            content: `<div style="font-size: 1.5rem; font-weight: bold; margin-bottom: 5px;">${acc.balance}</div>
                    <div style="font-size: 0.875rem; color: #666;">${acc.bank} •••• ${acc.last4}</div>
                    <div style="margin-top: 10px; font-size: 0.75rem; color: var(--color-success-500); display: flex; align-items: center; gap: 5px;">
                      <span style="width: 8px; height: 8px; background: var(--color-success-500); border-radius: 50%; display: inline-block;"></span> 
                      ${acc.status}
                    </div>`,
            padding: true,
            className: 'col-span-6'
        });
        card.style.gridColumn = 'span 6';
        bankGrid.appendChild(card);
    });
    container.appendChild(bankGrid);

    // 2. Reconciliation UI (Split Screen)
    const reconTitle = document.createElement('h2');
    reconTitle.textContent = 'Transaction Feed';
    container.appendChild(reconTitle);

    const splitScreen = document.createElement('div');
    splitScreen.style.display = 'grid';
    splitScreen.style.gridTemplateColumns = '1fr 1fr';
    splitScreen.style.gap = 'var(--spacing-6)';
    splitScreen.style.height = '600px';

    // Left Panel: Bank Transactions
    const transactions = [
        { date: '2023-10-25', desc: 'Deposit from Acme Corp', amount: '+$1,200.00' },
        { date: '2023-10-24', desc: 'Payment to AWS', amount: '-$1,200.00' },
        { date: '2023-10-22', desc: 'Starbucks Coffee', amount: '-$15.50' }
    ];

    const leftPanel = Card({
        title: 'Unreconciled Transactions',
        content: Table({
            columns: [
                { key: 'date', label: 'Date' },
                { key: 'desc', label: 'Description' },
                { key: 'amount', label: 'Amount', align: 'right' },
                { key: 'action', label: '', render: () => Button({ text: 'Match', size: 'small', variant: 'secondary' }) }
            ],
            data: transactions,
            onRowClick: (row) => highlightMatch(row)
        }),
        padding: false,
        className: 'full-height-card'
    });
    splitScreen.appendChild(leftPanel);

    // Right Panel: Matches
    const rightPanelContent = document.createElement('div');
    rightPanelContent.innerHTML = `
    <div style="padding: 20px; text-align: center; color: var(--color-neutral-600);">
      <p>Select a transaction to see potential matches.</p>
    </div>
  `;

    const rightPanel = Card({
        title: 'Suggested Matches',
        content: rightPanelContent,
        className: 'full-height-card'
    });
    splitScreen.appendChild(rightPanel);

    container.appendChild(splitScreen);
    return container;
}

function highlightMatch(row) {
    // Logic to update right panel would go here
    // For prototype, we can just alert or log
    console.log('Selected transaction:', row);
}
