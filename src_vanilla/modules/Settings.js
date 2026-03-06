import { Card } from '../components/Card.js';
import { Table } from '../components/Table.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

export function render() {
    const container = document.createElement('div');
    container.className = 'container settings-module';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '250px 1fr';
    container.style.gap = 'var(--spacing-8)';
    container.style.alignItems = 'start';

    // 1. Settings Sidebar
    const sidebar = document.createElement('div');
    const menuItems = ['Company Info', 'Users & Roles', 'Operational Rules', 'Integrations', 'Billing'];
    let activeItem = 'Users & Roles';

    const title = document.createElement('h2');
    title.textContent = 'Settings';
    title.style.marginBottom = 'var(--spacing-4)';
    sidebar.appendChild(title);

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';

    menuItems.forEach(item => {
        const btn = document.createElement('button');
        btn.textContent = item;
        btn.style.textAlign = 'left';
        btn.style.padding = 'var(--spacing-3)';
        btn.style.background = activeItem === item ? 'var(--color-neutral-200)' : 'transparent';
        btn.style.border = 'none';
        btn.style.borderRadius = 'var(--radius-md)';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = activeItem === item ? '600' : '400';
        list.appendChild(btn);
    });
    sidebar.appendChild(list);
    container.appendChild(sidebar);

    // 2. Content Area (Simulating Users & Roles view)
    const content = document.createElement('div');

    const contentHeader = document.createElement('div');
    contentHeader.style.display = 'flex';
    contentHeader.style.justifyContent = 'space-between';
    contentHeader.style.marginBottom = 'var(--spacing-6)';

    const contentTitle = document.createElement('h1');
    contentTitle.textContent = activeItem;
    contentTitle.style.margin = '0';
    contentHeader.appendChild(contentTitle);

    contentHeader.appendChild(Button({ text: 'Add Role', variant: 'primary' }));
    content.appendChild(contentHeader);

    // Roles Matrix
    const rolesData = [
        { resource: 'Accounts Receivable', view: true, create: true, edit: true, delete: false, approve: true },
        { resource: 'Accounts Payable', view: true, create: true, edit: true, delete: false, approve: true },
        { resource: 'Inventory', view: true, create: true, edit: true, delete: false, approve: false },
        { resource: 'Reporting', view: true, create: false, edit: false, delete: false, approve: false },
        { resource: 'Settings', view: false, create: false, edit: false, delete: false, approve: false }
    ];

    const checkIcon = '✓'; // Simple text icon

    const columns = [
        { key: 'resource', label: 'Feature Area', sortable: false },
        { key: 'view', label: 'View', align: 'center', render: (val) => val ? checkIcon : '' },
        { key: 'create', label: 'Create', align: 'center', render: (val) => val ? checkIcon : '' },
        { key: 'edit', label: 'Edit', align: 'center', render: (val) => val ? checkIcon : '' },
        { key: 'delete', label: 'Delete', align: 'center', render: (val) => val ? checkIcon : '' },
        { key: 'approve', label: 'Approve', align: 'center', render: (val) => val ? checkIcon : '' }
    ];

    const matrixCard = Card({
        title: 'Administrator Permissions',
        content: Table({ columns, data: rolesData }),
        padding: false,
        actions: Button({ text: 'Edit Permissions', variant: 'secondary', size: 'small' })
    });

    content.appendChild(matrixCard);
    container.appendChild(content);

    return container;
}
