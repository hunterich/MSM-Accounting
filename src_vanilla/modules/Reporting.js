import { Card } from '../components/Card.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container reporting-module';

    const header = document.createElement('h1');
    header.textContent = 'Reports & Analytics';
    header.style.marginBottom = 'var(--spacing-8)';
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid-12';

    const reports = [
        { id: 'profit-loss', title: 'Profit & Loss', desc: 'Income, expenses, and net profit over time.' },
        { id: 'balance-sheet', title: 'Balance Sheet', desc: 'Assets, liabilities, and equity snapshot.' },
        { id: 'ar-aging', title: 'A/R Aging', desc: 'Unpaid invoices categorized by days overdue.' },
        { id: 'ap-aging', title: 'A/P Aging', desc: 'Unpaid bills categorized by days overdue.' },
        { id: 'sales-by-customer', title: 'Sales by Customer', desc: 'Breakdown of sales revenue per customer.' },
        { id: 'inventory-status', title: 'Inventory Valuation', desc: 'Current value and status of stock on hand.' }
    ];

    reports.forEach(report => {
        const card = Card({
            title: report.title,
            content: `<p style="color: var(--color-neutral-600); margin-bottom: 20px;">${report.desc}</p>
                    <a href="/reports/view?id=${report.id}" data-link class="btn btn-secondary btn-small">View Report</a>`,
            className: 'col-span-4'
        });
        card.style.gridColumn = 'span 4';
        grid.appendChild(card);

        // Because the button is inside HTML string, we need to handle its click if we want SPA nav
        // But since we use Router listener on document for data-link, it should work automatically.
    });

    container.appendChild(grid);
    return container;
}
