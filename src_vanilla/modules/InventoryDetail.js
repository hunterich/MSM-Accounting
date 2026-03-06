import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container item-detail';

    // Parse ID from URL
    const params = new URLSearchParams(window.location.search);
    const itemId = params.get('id') || 'Unknown Item';

    // Header
    const header = document.createElement('div');
    header.style.marginBottom = 'var(--spacing-6)';

    const backBtn = document.createElement('a');
    backBtn.textContent = '← Back to Inventory';
    backBtn.href = '/inventory';
    backBtn.className = 'text-small';
    backBtn.setAttribute('data-link', '');
    header.appendChild(backBtn);

    const title = document.createElement('h1');
    title.textContent = `Item: ${itemId}`; // In real app, fetch item by ID
    title.style.marginTop = 'var(--spacing-2)';
    header.appendChild(title);

    container.appendChild(header);

    // Tabs
    const tabsContainer = document.createElement('div');
    tabsContainer.style.marginBottom = 'var(--spacing-4)';
    tabsContainer.style.borderBottom = '1px solid var(--color-neutral-300)';
    tabsContainer.style.display = 'flex';
    tabsContainer.style.gap = 'var(--spacing-6)';

    const tabs = ['Overview', 'Pricing & Costing', 'History'];
    let activeTab = 'Overview';

    tabs.forEach(tab => {
        const tabBtn = document.createElement('button');
        tabBtn.textContent = tab;
        tabBtn.style.padding = 'var(--spacing-2) 0';
        tabBtn.style.background = 'none';
        tabBtn.style.border = 'none';
        tabBtn.style.borderBottom = activeTab === tab ? '2px solid var(--color-primary-500)' : '2px solid transparent';
        tabBtn.style.color = activeTab === tab ? 'var(--color-primary-700)' : 'var(--color-neutral-600)';
        tabBtn.style.fontWeight = activeTab === tab ? '600' : '400';
        tabBtn.style.cursor = 'pointer';

        tabBtn.addEventListener('click', () => {
            // Switch tab logic (simplified re-render for now, ideally just swap content)
            console.log('Switch to tab:', tab);
        });
        tabsContainer.appendChild(tabBtn);
    });

    container.appendChild(tabsContainer);

    // Tab Content (Placeholder)
    const contentCard = Card({
        title: activeTab,
        content: `<div style="padding: 20px;">
        <p>Details for ${itemId}...</p>
        <p><strong>Stock on Hand:</strong> 15</p>
        <p><strong>Committed:</strong> 2</p>
        <p><strong>Available:</strong> 13</p>
      </div>`
    });

    container.appendChild(contentCard);

    return container;
}
