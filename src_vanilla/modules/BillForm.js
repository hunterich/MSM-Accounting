import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container bill-form';

    // Header
    const header = document.createElement('div');
    header.style.marginBottom = 'var(--spacing-6)';

    const backBtn = document.createElement('a');
    backBtn.textContent = '← Back to Bills';
    backBtn.href = '/ap';
    backBtn.className = 'text-small';
    backBtn.setAttribute('data-link', '');
    header.appendChild(backBtn);

    const title = document.createElement('h1');
    title.textContent = 'New Bill';
    title.style.marginTop = 'var(--spacing-2)';
    header.appendChild(title);

    container.appendChild(header);

    // Form Wrapper
    const form = document.createElement('div');
    form.className = 'grid-12';

    // Vendor Details
    const vendorCard = Card({
        title: 'Vendor Details',
        content: (() => {
            const div = document.createElement('div');
            div.appendChild(Input({ label: 'Vendor', placeholder: 'Search vendor...' }));
            div.appendChild(Input({ label: 'Purchase Order (Optional)', placeholder: 'e.g. PO-2023-001' }));
            return div;
        })(),
        className: 'col-span-12'
    });
    vendorCard.style.marginBottom = 'var(--spacing-6)';
    form.appendChild(vendorCard);

    // Bill Details
    const detailsCard = Card({
        title: 'Bill Details',
        content: (() => {
            const div = document.createElement('div');
            div.style.display = 'grid';
            div.style.gridTemplateColumns = '1fr 1fr';
            div.style.gap = 'var(--spacing-4)';

            div.appendChild(Input({ label: 'Issue Date', type: 'date' }));
            div.appendChild(Input({ label: 'Due Date', type: 'date' }));
            div.appendChild(Input({ label: 'Bill Number', placeholder: 'Enter vendor bill #' }));
            return div;
        })()
    });
    detailsCard.style.marginBottom = 'var(--spacing-6)';
    form.appendChild(detailsCard);

    // Line Items (Simplified)
    const itemsCard = Card({
        title: 'Items',
        content: '<div>Items table placeholder...</div>'
    });
    itemsCard.style.marginBottom = 'var(--spacing-6)';
    form.appendChild(itemsCard);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.justifyContent = 'flex-end';
    actionsDiv.style.gap = 'var(--spacing-3)';

    actionsDiv.appendChild(Button({ text: 'Cancel', variant: 'secondary', onClick: () => history.back() }));
    actionsDiv.appendChild(Button({ text: 'Save Bill', variant: 'primary' }));

    form.appendChild(actionsDiv);
    container.appendChild(form);

    return container;
}
