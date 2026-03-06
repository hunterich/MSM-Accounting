import { Card } from '../components/Card.js';
import { Table } from '../components/Table.js';
import { Button } from '../components/Button.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container report-detail';

    const params = new URLSearchParams(window.location.search);
    const reportId = params.get('id');
    const reportTitle = reportId ? reportId.replace(/-/g, ' ').toUpperCase() : 'Report'; // Simple cleanup

    // Header
    const header = document.createElement('div');
    header.style.marginBottom = 'var(--spacing-6)';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const leftHeader = document.createElement('div');
    const backBtn = document.createElement('a');
    backBtn.textContent = '← Back to Reports';
    backBtn.href = '/reports';
    backBtn.className = 'text-small';
    backBtn.setAttribute('data-link', '');
    leftHeader.appendChild(backBtn);

    const title = document.createElement('h1');
    title.textContent = reportTitle;
    title.style.marginTop = 'var(--spacing-2)';
    leftHeader.appendChild(title);

    header.appendChild(leftHeader);

    // Actions
    const actions = document.createElement('div');
    actions.appendChild(Button({ text: 'Export PDF', variant: 'secondary' }));
    actions.appendChild(Button({ text: 'Export CSV', variant: 'secondary', className: 'ml-2' }));
    header.appendChild(actions);

    container.appendChild(header);

    // Filter Bar
    const filterCard = Card({
        content: (() => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.gap = 'var(--spacing-4)';
            div.style.alignItems = 'center';

            div.innerHTML = `
            <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Date Range</label>
                <select class="form-control">
                    <option>This Month</option>
                    <option>Last Month</option>
                    <option>This Quarter</option>
                    <option>This Year</option>
                </select>
            </div>
            <button class="btn btn-primary" style="margin-top: 24px;">Run Report</button>
          `;
            return div;
        })()
    });
    filterCard.style.marginBottom = 'var(--spacing-6)';
    container.appendChild(filterCard);

    // Report Content (Mocked generic table)
    const reportData = [
        { col1: 'Data A', col2: '$1,000.00', col3: '10%' },
        { col1: 'Data B', col2: '$2,500.00', col3: '25%' },
        { col1: 'Data C', col2: '$500.00', col3: '5%' },
        { col1: 'Total', col2: '$4,000.00', col3: '100%' }
    ];

    const columns = [
        { key: 'col1', label: 'Item / Category' },
        { key: 'col2', label: 'Amount', align: 'right' },
        { key: 'col3', label: 'Percentage', align: 'right' }
    ];

    const contentCard = Card({
        title: 'Report Results',
        content: Table({ columns, data: reportData }),
        padding: false
    });

    container.appendChild(contentCard);

    return container;
}
