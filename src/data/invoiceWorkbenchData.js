export const invoiceWorkbenchData = [
    {
        id: 'INV-1001',
        number: 'INV/2026/02/001001',
        customerId: 'CUST-001',
        customerName: 'Acme Corp',
        issueDate: '2026-02-01',
        dueDate: '2026-03-02',
        currency: 'IDR',
        amount: 1200000,
        status: 'Sent',
        poNumber: 'PO-ACM-2026-0021',
        billingAddress: '123 Coyote Way, Desert Valley, AZ 85001',
        shippingAddress: '123 Coyote Way, Desert Valley, AZ 85001',
        shippingDate: '2026-02-02',
        notes: 'Partial shipment delivered.',
        attachments: [{ id: 'ATT-1001', name: 'SO-1001.pdf', size: '122 KB' }],
        items: [
            { id: 'L1', description: 'Web Hosting (Annual)', quantity: 1, unit: 'PCS', price: 1200000, discount: 0 }
        ],
        audit: [
            { id: 'A1', date: '2026-02-01 09:02', action: 'Created', user: 'Admin' },
            { id: 'A2', date: '2026-02-01 09:05', action: 'Approved', user: 'Admin' },
            { id: 'A3', date: '2026-02-01 09:10', action: 'Sent by email', user: 'Admin' }
        ],
        journal: [
            { id: 'J1', account: 'Accounts Receivable', dr: 1200000, cr: 0 },
            { id: 'J2', account: 'Sales Revenue', dr: 0, cr: 1200000 }
        ]
    },
    {
        id: 'INV-1002',
        number: 'INV/2026/02/001002',
        customerId: 'CUST-002',
        customerName: 'Globex Inc',
        issueDate: '2026-02-05',
        dueDate: '2026-02-05',
        currency: 'IDR',
        amount: 3500000,
        status: 'Paid',
        poNumber: 'PO-GLO-2026-0038',
        billingAddress: '42 Wallaby Way, Sydney, NSW 2000',
        shippingAddress: '42 Wallaby Way, Sydney, NSW 2000',
        shippingDate: '2026-02-05',
        notes: 'Same-day payment.',
        attachments: [],
        items: [
            { id: 'L1', description: 'Consulting Hours', quantity: 10, unit: 'HOUR', price: 350000, discount: 0 }
        ],
        audit: [
            { id: 'A1', date: '2026-02-05 08:45', action: 'Created', user: 'Admin' },
            { id: 'A2', date: '2026-02-05 09:10', action: 'Marked paid', user: 'Admin' }
        ],
        journal: [
            { id: 'J1', account: 'Accounts Receivable', dr: 3500000, cr: 0 },
            { id: 'J2', account: 'Sales Revenue', dr: 0, cr: 3500000 },
            { id: 'J3', account: 'Bank - BCA', dr: 3500000, cr: 0 },
            { id: 'J4', account: 'Accounts Receivable', dr: 0, cr: 3500000 }
        ]
    },
    {
        id: 'INV-1003',
        number: 'INV/2026/02/001003',
        customerId: 'CUST-003',
        customerName: 'Soylent Corp',
        issueDate: '2026-02-06',
        dueDate: '2026-03-08',
        currency: 'IDR',
        amount: 850000,
        status: 'Sent',
        poNumber: 'PO-SOY-2026-0014',
        billingAddress: '89 North Ave, Austin, TX 78701',
        shippingAddress: '89 North Ave, Austin, TX 78701',
        shippingDate: '2026-02-06',
        notes: '',
        attachments: [{ id: 'ATT-1003', name: 'Delivery-note.jpg', size: '560 KB' }],
        items: [
            { id: 'L1', description: 'Domain Registration', quantity: 5, unit: 'PCS', price: 170000, discount: 0 }
        ],
        audit: [
            { id: 'A1', date: '2026-02-06 11:01', action: 'Created', user: 'Admin' },
            { id: 'A2', date: '2026-02-06 11:06', action: 'Sent by email', user: 'Admin' }
        ],
        journal: [
            { id: 'J1', account: 'Accounts Receivable', dr: 850000, cr: 0 },
            { id: 'J2', account: 'Sales Revenue', dr: 0, cr: 850000 }
        ]
    },
    {
        id: 'INV-1004',
        number: 'INV/2026/02/001004',
        customerId: 'CUST-001',
        customerName: 'Acme Corp',
        issueDate: '2026-02-08',
        dueDate: '2026-03-10',
        currency: 'IDR',
        amount: 2100000,
        status: 'Draft',
        poNumber: '',
        billingAddress: '123 Coyote Way, Desert Valley, AZ 85001',
        shippingAddress: 'PO Box 12, Desert Valley, AZ 85001',
        shippingDate: '2026-02-08',
        notes: 'Draft, waiting customer confirmation.',
        attachments: [],
        items: [
            { id: 'L1', description: 'Dedicated Server Setup', quantity: 1, unit: 'JOB', price: 1800000, discount: 0 },
            { id: 'L2', description: 'SSL Certificate', quantity: 4, unit: 'PCS', price: 75000, discount: 0 }
        ],
        audit: [{ id: 'A1', date: '2026-02-08 14:20', action: 'Created (Draft)', user: 'Admin' }],
        journal: []
    },
    {
        id: 'INV-1005',
        number: 'INV/2026/02/001005',
        customerId: 'CUST-004',
        customerName: 'Massive Dynamic',
        issueDate: '2026-02-09',
        dueDate: '2026-03-11',
        currency: 'IDR',
        amount: 5000000,
        status: 'Sent',
        poNumber: 'PO-MAS-2026-0020',
        billingAddress: '101 Main St, New York, NY 10001',
        shippingAddress: '101 Main St, New York, NY 10001',
        shippingDate: '2026-02-10',
        notes: '',
        attachments: [{ id: 'ATT-1005', name: 'PO-MAS.pdf', size: '210 KB' }],
        items: [
            { id: 'L1', description: 'Consulting Hours', quantity: 20, unit: 'HOUR', price: 250000, discount: 0 }
        ],
        audit: [
            { id: 'A1', date: '2026-02-09 10:01', action: 'Created', user: 'Admin' },
            { id: 'A2', date: '2026-02-10 09:15', action: 'Sent by email', user: 'Admin' }
        ],
        journal: [
            { id: 'J1', account: 'Accounts Receivable', dr: 5000000, cr: 0 },
            { id: 'J2', account: 'Sales Revenue', dr: 0, cr: 5000000 }
        ]
    },
    {
        id: 'INV-1006',
        number: 'INV/2026/02/001006',
        customerId: 'CUST-006',
        customerName: 'Cyberdyne',
        issueDate: '2026-02-10',
        dueDate: '2026-03-12',
        currency: 'IDR',
        amount: 12000000,
        status: 'Overdue',
        poNumber: 'PO-CYB-2026-0006',
        billingAddress: '400 Silicon Blvd, Palo Alto, CA 94301',
        shippingAddress: '400 Silicon Blvd, Palo Alto, CA 94301',
        shippingDate: '2026-02-10',
        notes: 'Payment reminder already sent.',
        attachments: [],
        items: [
            { id: 'L1', description: 'Consulting Hours', quantity: 12, unit: 'HOUR', price: 1000000, discount: 0 }
        ],
        audit: [
            { id: 'A1', date: '2026-02-10 16:00', action: 'Created', user: 'Admin' },
            { id: 'A2', date: '2026-02-13 09:05', action: 'Payment reminder sent', user: 'Admin' }
        ],
        journal: [
            { id: 'J1', account: 'Accounts Receivable', dr: 12000000, cr: 0 },
            { id: 'J2', account: 'Sales Revenue', dr: 0, cr: 12000000 }
        ]
    }
];
