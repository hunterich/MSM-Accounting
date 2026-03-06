import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container invoice-form';

    // Header
    const header = document.createElement('div');
    header.style.marginBottom = 'var(--spacing-6)';

    const backBtn = document.createElement('a');
    backBtn.textContent = '← Back to Invoices';
    backBtn.href = '/ar';
    backBtn.className = 'text-small';
    backBtn.setAttribute('data-link', '');
    header.appendChild(backBtn);

    const title = document.createElement('h1');
    title.textContent = 'New Invoice';
    title.style.marginTop = 'var(--spacing-2)';
    header.appendChild(title);

    container.appendChild(header);

    // Form Wrapper
    const form = document.createElement('div');
    form.className = 'grid-12';

    // Customer Details
    const customerCard = Card({
        title: 'Customer Details',
        content: (() => {
            const div = document.createElement('div');
            div.appendChild(Input({ label: 'Customer', placeholder: 'Search customer...' }));
            div.appendChild(Input({ label: 'Email', type: 'email', placeholder: 'customer@example.com' }));
            return div;
        })(),
        className: 'col-span-12' // Using utility class if available, or just block
    });
    customerCard.style.marginBottom = 'var(--spacing-6)';
    form.appendChild(customerCard);

    // Invoice Details
    const detailsCard = Card({
        title: 'Invoice Details',
        content: (() => {
            const div = document.createElement('div');
            div.style.display = 'grid';
            div.style.gridTemplateColumns = '1fr 1fr';
            div.style.gap = 'var(--spacing-4)';

            div.appendChild(Input({ label: 'Issue Date', type: 'date' }));
            div.appendChild(Input({ label: 'Due Date', type: 'date' }));
            div.appendChild(Input({ label: 'Invoice Number', value: 'INV-1006', disabled: true }));
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
    actionsDiv.appendChild(Button({ text: 'Save & Send', variant: 'primary' }));

    form.appendChild(actionsDiv);
    container.appendChild(form);

    return container;
}
