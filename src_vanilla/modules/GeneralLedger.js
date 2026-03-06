import { Card } from '../components/Card.js';
import { Table } from '../components/Table.js';
import { Button } from '../components/Button.js';
import { Modal } from '../components/Modal.js';
import { Input } from '../components/Input.js';
import { getCoA } from '../api/mock.js';

export async function render() {
    const container = document.createElement('div');
    container.className = 'container gl-module';

    // Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = 'var(--spacing-6)';

    const title = document.createElement('h1');
    title.textContent = 'Chart of Accounts';
    title.style.marginBottom = '0';
    header.appendChild(title);

    const actionsDiv = document.createElement('div');

    const importBtn = Button({
        text: 'Import CoA',
        variant: 'secondary',
        onClick: () => {
            alert('Import workflow not implemented yet');
        }
    });
    importBtn.style.marginRight = 'var(--spacing-3)';

    const addBtn = Button({
        text: 'Add Account',
        variant: 'primary',
        onClick: () => showAddAccountModal()
    });

    actionsDiv.appendChild(importBtn);
    actionsDiv.appendChild(addBtn);
    header.appendChild(actionsDiv);
    container.appendChild(header);

    // CoA Table
    const data = await getCoA(); // Fetch data

    const columns = [
        { key: 'code', label: 'Code', sortable: true },
        { key: 'name', label: 'Account Name', sortable: true },
        { key: 'type', label: 'Type', sortable: true },
        { key: 'balance', label: 'Balance', align: 'right' },
        {
            key: 'actions', label: 'Actions', align: 'center', render: (val, row) => {
                return Button({
                    text: 'Edit',
                    variant: 'tertiary',
                    size: 'small',
                    onClick: (e) => {
                        e.stopPropagation();
                        console.log('Edit', row);
                    }
                });
            }
        }
    ];

    const tableComponent = Table({
        columns,
        data,
        onRowClick: (row) => console.log('View Account', row)
    });

    const tableCard = Card({
        content: tableComponent,
        padding: false
    });

    container.appendChild(tableCard);

    return container;
}

function showAddAccountModal() {
    const form = document.createElement('form');

    // Account Code
    form.appendChild(Input({
        label: 'Account Code',
        id: 'accData-code',
        placeholder: 'e.g. 1050',
        required: true
    }));

    // Account Name
    form.appendChild(Input({
        label: 'Account Name',
        id: 'accData-name',
        placeholder: 'e.g. Petty Cash',
        required: true
    }));

    // Account Type (Select logic simplified for now)
    form.appendChild(Input({
        label: 'Account Type',
        id: 'accData-type',
        placeholder: 'Asset, Liability, etc.'
    }));

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = 'var(--spacing-3)';

    const cancelBtn = Button({
        text: 'Cancel',
        variant: 'secondary',
        onClick: () => document.querySelector('.modal-close').click()
    });

    const saveBtn = Button({
        text: 'Save Account',
        variant: 'primary',
        onClick: (e) => {
            e.preventDefault();
            console.log('Save Account');
            document.querySelector('.modal-close').click();
        }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    const modal = Modal({
        title: 'Add New Account',
        content: form,
        footer: footer,
        size: 'medium'
    });

    document.body.appendChild(modal);
}
