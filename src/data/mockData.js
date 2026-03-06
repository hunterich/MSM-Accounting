export const customers = [
    {
        id: 'CUST-001',
        name: 'Acme Corp',
        email: 'billing@acme.com',
        balance: 1200000,
        status: 'Active',
        category: 'Wholesale',
        defaultDiscount: 15,
        paymentTerms: 30,
        billingAddress: '123 Coyote Way, Desert Valley, AZ 85001',
        shippingAddress: '123 Coyote Way, Desert Valley, AZ 85001'
    },
    {
        id: 'CUST-002',
        name: 'Globex Inc',
        email: 'accounts@globex.com',
        balance: 0,
        status: 'Active',
        category: 'Retail',
        defaultDiscount: 0,
        paymentTerms: 0,
        billingAddress: '42 Wallaby Way, Sydney, NSW 2000',
        shippingAddress: '42 Wallaby Way, Sydney, NSW 2000'
    },
    {
        id: 'CUST-003',
        name: 'Initech',
        email: 'info@initech.com',
        balance: 500000,
        status: 'Inactive',
        category: 'Distributor',
        defaultDiscount: 10,
        paymentTerms: 15,
        billingAddress: '4120 Freidrich Ln, Austin, TX 78744',
        shippingAddress: 'PO Box 191, Austin, TX 78744'
    },
    {
        id: 'CUST-004',
        name: 'Umbrella Corp',
        email: 'fin@umbrella.com',
        balance: 10000000,
        status: 'Active',
        category: 'VIP',
        defaultDiscount: 20,
        paymentTerms: 45,
        billingAddress: '543 Biology Ln, Raccoon City, MO 63042',
    }
];

export const initialCustomerCategories = [
    {
        id: 'CAT-001',
        name: 'Wholesale',
        prefix: 'WHO',
        defaultCreditLimit: 50000000,
        defaultPaymentTerms: 30,
        defaultDiscount: 15,
        description: 'Large volume buyers'
    },
    {
        id: 'CAT-002',
        name: 'Retail',
        prefix: 'RET',
        defaultCreditLimit: 0,
        defaultPaymentTerms: 0,
        defaultDiscount: 0,
        description: 'End consumers'
    },
    {
        id: 'CAT-003',
        name: 'Distributor',
        prefix: 'DIS',
        defaultCreditLimit: 100000000,
        defaultPaymentTerms: 45,
        defaultDiscount: 20,
        description: 'Regional distributors'
    },
    {
        id: 'CAT-004',
        name: 'VIP',
        prefix: 'VIP',
        defaultCreditLimit: 200000000,
        defaultPaymentTerms: 60,
        defaultDiscount: 25,
        description: 'Special accounts'
    }
];

export const products = [
    { id: 'PROD-001', name: 'Web Hosting (Annual)', price: 120000, type: 'Service' },
    { id: 'PROD-002', name: 'Domain Registration', price: 15000, type: 'Service' },
    { id: 'PROD-003', name: 'Consulting Hours', price: 150000, type: 'Service' },
    { id: 'PROD-004', name: 'Dedicated Server Setup', price: 500000, type: 'Service' },
    { id: 'PROD-005', name: 'SSL Certificate', price: 75000, type: 'Service' }
];

export const invoices = [
    { id: 'INV-1001', customerId: 'CUST-001', customerName: 'Acme Corp', date: '2023-10-01', dueDate: '2023-10-31', amount: 1200000, status: 'Unpaid' },
    { id: 'INV-1002', customerId: 'CUST-002', customerName: 'Globex Inc', date: '2023-10-05', dueDate: '2023-10-05', amount: 500000, status: 'Paid' },
    { id: 'INV-1003', customerId: 'CUST-001', customerName: 'Acme Corp', date: '2023-10-15', dueDate: '2023-11-14', amount: 3000000, status: 'Unpaid' },
    { id: 'INV-1004', customerId: 'CUST-004', customerName: 'Umbrella Corp', date: '2023-10-20', dueDate: '2023-12-04', amount: 10000000, status: 'Unpaid' }
];

export const arPayments = [
    {
        id: 'PAY/BCA/2026/02/000001',
        invoiceId: 'INV-1001',
        customerId: 'CUST-001',
        customerName: 'Acme Corp',
        date: '2026-02-10',
        method: 'Bank Transfer',
        bankId: 'BANK-001',
        amount: 1200000,
        status: 'Completed',
        arAccountId: 'COA-1210',
        depositAccountId: 'COA-1120',
        discountAccountId: 'COA-5300',
        penaltyAccountId: 'COA-4200'
    },
    {
        id: 'PAY/MANDIRI/2026/02/000001',
        invoiceId: 'INV-1003',
        customerId: 'CUST-001',
        customerName: 'Acme Corp',
        date: '2026-02-16',
        method: 'Bank Transfer',
        bankId: 'BANK-002',
        amount: 2850000,
        status: 'Processing',
        arAccountId: 'COA-1210',
        depositAccountId: 'COA-1130',
        discountAccountId: 'COA-5300',
        penaltyAccountId: 'COA-4200'
    }
];

export const invoiceItemTemplates = {
    'INV-1001': [
        { id: 'PROD-001', itemName: 'Web Hosting (Annual)', qty: 2, unit: 'PCS', price: 600000 },
        { id: 'PROD-005', itemName: 'SSL Certificate', qty: 4, unit: 'PCS', price: 75000 },
        { id: 'PROD-002', itemName: 'Domain Registration', qty: 2, unit: 'PCS', price: 15000 },
    ],
    'INV-1002': [
        { id: 'PROD-002', itemName: 'Domain Registration', qty: 10, unit: 'PCS', price: 50000 },
    ],
    'INV-1003': [
        { id: 'PROD-003', itemName: 'Consulting Hours', qty: 20, unit: 'HOUR', price: 150000 },
    ],
    'INV-1004': [
        { id: 'PROD-004', itemName: 'Dedicated Server Setup', qty: 10, unit: 'JOB', price: 1000000 },
    ]
};

export const bills = [
    {
        id: 'BILL-5001',
        vendorId: 'VEND-001',
        vendor: 'Office Depot',
        date: '2023-10-02',
        due: '2023-10-15',
        amount: 450000,
        status: 'Paid',
        poNumber: 'PO-2023-102',
        notes: 'Office supplies replenishment.',
        apAccountId: 'COA-2100'
    },
    {
        id: 'BILL-5002',
        vendorId: 'VEND-002',
        vendor: 'AWS',
        date: '2023-10-01',
        due: '2023-10-31',
        amount: 1200000,
        status: 'Unpaid',
        poNumber: '',
        notes: 'Cloud services monthly billing.',
        apAccountId: 'COA-2100'
    },
    {
        id: 'BILL-5003',
        vendorId: 'VEND-003',
        vendor: 'WeWork',
        date: '2023-10-01',
        due: '2023-10-05',
        amount: 3500000,
        status: 'Overdue',
        poNumber: 'PO-2023-089',
        notes: 'Office rental.',
        apAccountId: 'COA-2100'
    },
    {
        id: 'BILL-5004',
        vendorId: 'VEND-004',
        vendor: 'Slack',
        date: '2023-10-15',
        due: '2023-11-15',
        amount: 250000,
        status: 'Pending',
        poNumber: '',
        notes: 'Team productivity subscription.',
        apAccountId: 'COA-2100'
    }
];

export const vendors = [
    {
        id: 'VEND-001',
        name: 'Office Depot',
        category: 'Supplies',
        email: 'ap@officedepot.com',
        phone: '+62-21-5551001',
        paymentTerms: 'Net 30',
        npwp: '01.234.567.8-901.000',
        defaultApAccountId: 'COA-2100',
        status: 'Active',
        balance: 450000
    },
    {
        id: 'VEND-002',
        name: 'AWS',
        category: 'Hosting',
        email: 'billing@aws.com',
        phone: '+62-21-5551002',
        paymentTerms: 'Net 30',
        npwp: '02.345.678.9-012.000',
        defaultApAccountId: 'COA-2100',
        status: 'Active',
        balance: 1200000
    },
    {
        id: 'VEND-003',
        name: 'WeWork',
        category: 'Rent',
        email: 'invoice@wework.com',
        phone: '+62-21-5551003',
        paymentTerms: 'Due on Receipt',
        npwp: '03.456.789.0-123.000',
        defaultApAccountId: 'COA-2100',
        status: 'Active',
        balance: 3500000
    },
    {
        id: 'VEND-004',
        name: 'Slack',
        category: 'Software',
        email: 'billing@slack.com',
        phone: '+62-21-5551004',
        paymentTerms: 'Net 30',
        npwp: '04.567.890.1-234.000',
        defaultApAccountId: 'COA-2100',
        status: 'Inactive',
        balance: 250000
    }
];

export const apPayments = [
    {
        id: 'APP/BCA/2023/10/000001',
        billId: 'BILL-5001',
        vendorId: 'VEND-001',
        vendorName: 'Office Depot',
        date: '2023-10-04',
        method: 'Bank Transfer',
        bankId: 'BANK-001',
        amount: 450000,
        status: 'Completed',
        apAccountId: 'COA-2100',
        depositAccountId: 'COA-1120',
        discountAccountId: 'COA-4200',
        penaltyAccountId: 'COA-5300'
    },
    {
        id: 'APP/MANDIRI/2023/10/000001',
        billId: 'BILL-5003',
        vendorId: 'VEND-003',
        vendorName: 'WeWork',
        date: '2023-10-07',
        method: 'Bank Transfer',
        bankId: 'BANK-002',
        amount: 3500000,
        status: 'Processing',
        apAccountId: 'COA-2100',
        depositAccountId: 'COA-1130',
        discountAccountId: 'COA-4200',
        penaltyAccountId: 'COA-5220'
    }
];

export const purchaseReturns = [
    {
        id: 'PRN/2026/02/00001',
        vendorId: 'VEND-001',
        vendorName: 'Office Depot',
        billId: 'BILL-5001',
        returnDate: '2026-02-08',
        warehouseId: 'WH-001',
        apAccountId: 'COA-2100',
        returnAccountId: 'COA-5300',
        taxAccountId: 'COA-1210',
        applyTax: true,
        taxIncluded: false,
        taxRate: 11,
        lines: [
            { lineKey: 'BILL-5001-1', description: 'Paper and stationery', qtyPurchased: 3, qtyReturn: 1, unit: 'BOX', price: 150000 }
        ],
        reason: 'Damaged goods returned to vendor.',
        status: 'Approved'
    }
];

export const debitNotes = [
    {
        id: 'DBN/2026/02/00001',
        returnId: 'PRN/2026/02/00001',
        vendorId: 'VEND-001',
        vendorName: 'Office Depot',
        sourceBillId: 'BILL-5001',
        date: '2026-02-09',
        amount: 166500,
        apAccountId: 'COA-2100',
        returnAccountId: 'COA-5300',
        taxAccountId: 'COA-1210',
        settlementType: 'Apply to Bill',
        settlementRef: 'BILL-5002',
        settlementAccountId: 'COA-1120',
        applyTax: true,
        status: 'Applied'
    }
];

export const billItemTemplates = {
    'BILL-5001': [
        { description: 'Paper and stationery', accountId: 'COA-5300', qty: 3, unit: 'BOX', price: 150000 }
    ],
    'BILL-5002': [
        { description: 'EC2 usage', accountId: 'COA-5300', qty: 1, unit: 'MONTH', price: 1200000 }
    ],
    'BILL-5003': [
        { description: 'Office rent', accountId: 'COA-5220', qty: 1, unit: 'MONTH', price: 3500000 }
    ],
    'BILL-5004': [
        { description: 'Slack annual plan', accountId: 'COA-5300', qty: 1, unit: 'YEAR', price: 250000 }
    ]
};

export const bankAccounts = [
    { id: 'BANK-001', code: 'BCA', name: 'Business Checking (BCA ...4589)', balance: 80000000 },
    { id: 'BANK-002', code: 'MANDIRI', name: 'Savings (Mandiri ...9921)', balance: 44500000 },
    { id: 'BANK-003', code: 'CASH', name: 'Petty Cash', balance: 500000 }
];

export const warehouses = [
    { id: 'WH-001', code: 'PST', name: 'Kantor Pusat' },
    { id: 'WH-002', code: 'SBY', name: 'Gudang Surabaya' },
    { id: 'WH-003', code: 'BDG', name: 'Gudang Bandung' }
];

export const salesReturns = [
    {
        id: 'SRN/2026/02/00001',
        customerId: 'CUST-001',
        customerName: 'Acme Corp',
        invoiceId: 'INV-1001',
        returnDate: '2026-02-08',
        warehouseId: 'WH-001',
        arAccountId: 'COA-1210',
        returnAccountId: 'COA-5220',
        taxAccountId: 'COA-2200',
        applyTax: true,
        taxIncluded: false,
        taxRate: 11,
        lines: [
            { itemId: 'PROD-001', itemName: 'Web Hosting (Annual)', qtySold: 2, qtyReturn: 1, unit: 'PCS', price: 600000 }
        ],
        reason: 'Partial service reversal for overbilling.',
        status: 'Approved'
    }
];

export const creditNotes = [
    {
        id: 'CRN/2026/02/00001',
        returnId: 'SRN/2026/02/00001',
        customerId: 'CUST-001',
        customerName: 'Acme Corp',
        sourceInvoiceId: 'INV-1001',
        date: '2026-02-09',
        amount: 666000,
        arAccountId: 'COA-1210',
        returnAccountId: 'COA-5220',
        taxAccountId: 'COA-2200',
        settlementAccountId: 'COA-1120',
        applyTax: true,
        settlementType: 'Apply to Invoice',
        settlementRef: 'INV-1003',
        status: 'Applied'
    }
];

const NORMAL_SIDE_BY_TYPE = {
    Asset: 'Debit',
    Liability: 'Credit',
    Equity: 'Credit',
    Revenue: 'Credit',
    Expense: 'Debit'
};

const withNormalSide = (account) => ({
    ...account,
    normalSide: NORMAL_SIDE_BY_TYPE[account.type]
});

export const chartOfAccounts = [
    withNormalSide({
        id: 'COA-1000',
        code: '1',
        name: 'Aset',
        type: 'Asset',
        parentId: null,
        level: 0,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Neraca',
        reportSubGroup: 'Aset'
    }),
    withNormalSide({
        id: 'COA-1100',
        code: '11',
        name: 'Kas dan Bank',
        type: 'Asset',
        parentId: 'COA-1000',
        level: 1,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Aset Lancar',
        reportSubGroup: 'Kas dan Bank'
    }),
    withNormalSide({
        id: 'COA-1110',
        code: '111',
        name: 'Kas Kecil',
        type: 'Asset',
        parentId: 'COA-1100',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Aset Lancar',
        reportSubGroup: 'Kas dan Bank'
    }),
    withNormalSide({
        id: 'COA-1120',
        code: '112',
        name: 'Bank BCA',
        type: 'Asset',
        parentId: 'COA-1100',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Aset Lancar',
        reportSubGroup: 'Kas dan Bank'
    }),
    withNormalSide({
        id: 'COA-1130',
        code: '113',
        name: 'Bank Mandiri',
        type: 'Asset',
        parentId: 'COA-1100',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Aset Lancar',
        reportSubGroup: 'Kas dan Bank'
    }),
    withNormalSide({
        id: 'COA-1200',
        code: '12',
        name: 'Piutang',
        type: 'Asset',
        parentId: 'COA-1000',
        level: 1,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Aset Lancar',
        reportSubGroup: 'Piutang'
    }),
    withNormalSide({
        id: 'COA-1210',
        code: '121',
        name: 'Piutang Usaha',
        type: 'Asset',
        parentId: 'COA-1200',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Aset Lancar',
        reportSubGroup: 'Piutang'
    }),
    withNormalSide({
        id: 'COA-1300',
        code: '13',
        name: 'Persediaan',
        type: 'Asset',
        parentId: 'COA-1000',
        level: 1,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Aset Lancar',
        reportSubGroup: 'Persediaan'
    }),
    withNormalSide({
        id: 'COA-1310',
        code: '131',
        name: 'Persediaan Barang Dagang',
        type: 'Asset',
        parentId: 'COA-1300',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Aset Lancar',
        reportSubGroup: 'Persediaan'
    }),
    withNormalSide({
        id: 'COA-1400',
        code: '14',
        name: 'Aset Tetap',
        type: 'Asset',
        parentId: 'COA-1000',
        level: 1,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Aset Tidak Lancar',
        reportSubGroup: 'Aset Tetap'
    }),
    withNormalSide({
        id: 'COA-1410',
        code: '141',
        name: 'Peralatan Kantor',
        type: 'Asset',
        parentId: 'COA-1400',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Aset Tidak Lancar',
        reportSubGroup: 'Aset Tetap'
    }),
    withNormalSide({
        id: 'COA-1490',
        code: '149',
        name: 'Akumulasi Penyusutan',
        type: 'Asset',
        parentId: 'COA-1400',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Aset Tidak Lancar',
        reportSubGroup: 'Aset Tetap'
    }),
    withNormalSide({
        id: 'COA-2000',
        code: '2',
        name: 'Kewajiban',
        type: 'Liability',
        parentId: null,
        level: 0,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Neraca',
        reportSubGroup: 'Kewajiban'
    }),
    withNormalSide({
        id: 'COA-2100',
        code: '21',
        name: 'Hutang Usaha',
        type: 'Liability',
        parentId: 'COA-2000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Kewajiban Jangka Pendek',
        reportSubGroup: 'Hutang Usaha'
    }),
    withNormalSide({
        id: 'COA-2200',
        code: '22',
        name: 'Hutang Pajak',
        type: 'Liability',
        parentId: 'COA-2000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Kewajiban Jangka Pendek',
        reportSubGroup: 'Pajak'
    }),
    withNormalSide({
        id: 'COA-2300',
        code: '23',
        name: 'Kewajiban Jangka Pendek Lainnya',
        type: 'Liability',
        parentId: 'COA-2000',
        level: 1,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Kewajiban Jangka Pendek',
        reportSubGroup: 'Lainnya'
    }),
    withNormalSide({
        id: 'COA-2310',
        code: '231',
        name: 'Pinjaman Bank Jangka Pendek',
        type: 'Liability',
        parentId: 'COA-2300',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Kewajiban Jangka Pendek',
        reportSubGroup: 'Pinjaman'
    }),
    withNormalSide({
        id: 'COA-3000',
        code: '3',
        name: 'Ekuitas',
        type: 'Equity',
        parentId: null,
        level: 0,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Neraca',
        reportSubGroup: 'Ekuitas'
    }),
    withNormalSide({
        id: 'COA-3100',
        code: '31',
        name: 'Modal Disetor',
        type: 'Equity',
        parentId: 'COA-3000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Ekuitas',
        reportSubGroup: 'Modal'
    }),
    withNormalSide({
        id: 'COA-3200',
        code: '32',
        name: 'Laba Ditahan',
        type: 'Equity',
        parentId: 'COA-3000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Ekuitas',
        reportSubGroup: 'Saldo Laba'
    }),
    withNormalSide({
        id: 'COA-4000',
        code: '4',
        name: 'Pendapatan',
        type: 'Revenue',
        parentId: null,
        level: 0,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Laba Rugi',
        reportSubGroup: 'Pendapatan'
    }),
    withNormalSide({
        id: 'COA-4100',
        code: '41',
        name: 'Penjualan',
        type: 'Revenue',
        parentId: 'COA-4000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Pendapatan Usaha',
        reportSubGroup: 'Penjualan'
    }),
    withNormalSide({
        id: 'COA-4200',
        code: '42',
        name: 'Pendapatan Lain-lain',
        type: 'Revenue',
        parentId: 'COA-4000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Pendapatan Lain',
        reportSubGroup: 'Pendapatan Lain-lain'
    }),
    withNormalSide({
        id: 'COA-5000',
        code: '5',
        name: 'Beban',
        type: 'Expense',
        parentId: null,
        level: 0,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Laba Rugi',
        reportSubGroup: 'Beban'
    }),
    withNormalSide({
        id: 'COA-5100',
        code: '51',
        name: 'Harga Pokok Penjualan',
        type: 'Expense',
        parentId: 'COA-5000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'HPP',
        reportSubGroup: 'HPP'
    }),
    withNormalSide({
        id: 'COA-5200',
        code: '52',
        name: 'Beban Operasional',
        type: 'Expense',
        parentId: 'COA-5000',
        level: 1,
        isPostable: false,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Beban Operasional',
        reportSubGroup: 'Operasional'
    }),
    withNormalSide({
        id: 'COA-5210',
        code: '521',
        name: 'Beban Gaji',
        type: 'Expense',
        parentId: 'COA-5200',
        level: 2,
        isPostable: true,
        isActive: true,
        hasPostings: true,
        reportGroup: 'Beban Operasional',
        reportSubGroup: 'Gaji'
    }),
    withNormalSide({
        id: 'COA-5220',
        code: '522',
        name: 'Beban Sewa',
        type: 'Expense',
        parentId: 'COA-5200',
        level: 2,
        isPostable: true,
        isActive: false,
        hasPostings: true,
        reportGroup: 'Beban Operasional',
        reportSubGroup: 'Sewa'
    }),
    withNormalSide({
        id: 'COA-5300',
        code: '53',
        name: 'Beban Administrasi',
        type: 'Expense',
        parentId: 'COA-5000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Beban Administrasi',
        reportSubGroup: 'Administrasi'
    }),
    withNormalSide({
        id: 'COA-5400',
        code: '54',
        name: 'Beban Keuangan',
        type: 'Expense',
        parentId: 'COA-5000',
        level: 1,
        isPostable: true,
        isActive: true,
        hasPostings: false,
        reportGroup: 'Beban Keuangan',
        reportSubGroup: 'Keuangan'
    })
];

export const accountBalancesById = {
    'COA-1110': 12500000,
    'COA-1120': 80000000,
    'COA-1130': 44500000,
    'COA-1210': 18500000,
    'COA-1310': 12200000,
    'COA-1410': 60000000,
    'COA-1490': -14000000,
    'COA-2100': 22500000,
    'COA-2200': 6500000,
    'COA-2310': 10000000,
    'COA-3100': 120000000,
    'COA-3200': 33200000,
    'COA-4100': 145000000,
    'COA-4200': 5000000,
    'COA-5100': 58000000,
    'COA-5210': 20000000,
    'COA-5220': 3000000,
    'COA-5300': 12000000,
    'COA-5400': 3000000
};

export const journalEntries = [
    {
        entryNo: 'JE-2026-0001',
        date: '2026-01-15',
        period: '2026-01',
        memo: 'Opening balances',
        status: 'Posted',
        totalDebit: 50000000,
        totalCredit: 50000000,
        lines: [
            { id: 1, accountId: 'COA-1110', description: 'Cash opening', debit: 12500000, credit: 0 },
            { id: 2, accountId: 'COA-1120', description: 'Bank BCA opening', debit: 37500000, credit: 0 },
            { id: 3, accountId: 'COA-3100', description: 'Owner equity', debit: 0, credit: 50000000 }
        ]
    },
    {
        entryNo: 'JE-2026-0002',
        date: '2026-02-02',
        period: '2026-02',
        memo: 'Office rent payment',
        status: 'Posted',
        totalDebit: 3000000,
        totalCredit: 3000000,
        lines: [
            { id: 1, accountId: 'COA-5220', description: 'Rent expense Feb', debit: 3000000, credit: 0 },
            { id: 2, accountId: 'COA-1120', description: 'Bank settlement', debit: 0, credit: 3000000 }
        ]
    },
    {
        entryNo: 'JE-2026-0003',
        date: '2026-02-05',
        period: '2026-02',
        memo: 'AR opening balance',
        status: 'Posted',
        totalDebit: 12500000,
        totalCredit: 12500000,
        lines: [
            { id: 1, accountId: 'COA-1210', description: 'AR setup', debit: 12500000, credit: 0 },
            { id: 2, accountId: 'COA-3200', description: 'Retained earnings adj', debit: 0, credit: 12500000 }
        ]
    },
    {
        entryNo: 'JE-2026-0004',
        date: '2026-02-10',
        period: '2026-02',
        memo: 'Sales revenue recording',
        status: 'Posted',
        totalDebit: 15000000,
        totalCredit: 15000000,
        lines: [
            { id: 1, accountId: 'COA-1210', description: 'Customer invoice', debit: 15000000, credit: 0 },
            { id: 2, accountId: 'COA-4100', description: 'Sales revenue', debit: 0, credit: 15000000 }
        ]
    },
    {
        entryNo: 'JE-2026-0005',
        date: '2026-02-15',
        period: '2026-02',
        memo: 'Salary payment',
        status: 'Posted',
        totalDebit: 20000000,
        totalCredit: 20000000,
        lines: [
            { id: 1, accountId: 'COA-5210', description: 'Feb salary', debit: 20000000, credit: 0 },
            { id: 2, accountId: 'COA-1120', description: 'Bank salary payout', debit: 0, credit: 20000000 }
        ]
    }
];

// ─── Sales line items for Sales Reports ────────────────────────────────────
// Each record represents one line item from a posted invoice.
// Fields: invoiceId, date, customerId, customerName, itemId, itemName,
//         category, qty, unitPrice, discount, total
export const salesLines = [
    { invoiceId: 'INV-1001', date: '2026-01-05', customerId: 'CUST-001', customerName: 'Acme Corp', itemId: 'PROD-001', itemName: 'Web Hosting (Annual)', category: 'Service', qty: 2, unitPrice: 600000, discount: 0, total: 1200000 },
    { invoiceId: 'INV-1001', date: '2026-01-05', customerId: 'CUST-001', customerName: 'Acme Corp', itemId: 'PROD-005', itemName: 'SSL Certificate', category: 'Service', qty: 4, unitPrice: 75000, discount: 0, total: 300000 },
    { invoiceId: 'INV-1001', date: '2026-01-05', customerId: 'CUST-001', customerName: 'Acme Corp', itemId: 'PROD-002', itemName: 'Domain Registration', category: 'Service', qty: 2, unitPrice: 15000, discount: 0, total: 30000 },
    { invoiceId: 'INV-1002', date: '2026-01-12', customerId: 'CUST-002', customerName: 'Globex Inc', itemId: 'PROD-002', itemName: 'Domain Registration', category: 'Service', qty: 10, unitPrice: 50000, discount: 0, total: 500000 },
    { invoiceId: 'INV-1003', date: '2026-01-20', customerId: 'CUST-001', customerName: 'Acme Corp', itemId: 'PROD-003', itemName: 'Consulting Hours', category: 'Service', qty: 20, unitPrice: 150000, discount: 10, total: 2700000 },
    { invoiceId: 'INV-1004', date: '2026-02-03', customerId: 'CUST-004', customerName: 'Umbrella Corp', itemId: 'PROD-004', itemName: 'Dedicated Server Setup', category: 'Service', qty: 10, unitPrice: 1000000, discount: 0, total: 10000000 },
    { invoiceId: 'INV-1005', date: '2026-02-10', customerId: 'CUST-003', customerName: 'Initech', itemId: 'PROD-001', itemName: 'Web Hosting (Annual)', category: 'Service', qty: 5, unitPrice: 120000, discount: 0, total: 600000 },
    { invoiceId: 'INV-1005', date: '2026-02-10', customerId: 'CUST-003', customerName: 'Initech', itemId: 'PROD-005', itemName: 'SSL Certificate', category: 'Service', qty: 5, unitPrice: 75000, discount: 0, total: 375000 },
    { invoiceId: 'INV-1006', date: '2026-02-14', customerId: 'CUST-002', customerName: 'Globex Inc', itemId: 'PROD-003', itemName: 'Consulting Hours', category: 'Service', qty: 8, unitPrice: 150000, discount: 0, total: 1200000 },
    { invoiceId: 'INV-1007', date: '2026-02-18', customerId: 'CUST-004', customerName: 'Umbrella Corp', itemId: 'PROD-003', itemName: 'Consulting Hours', category: 'Service', qty: 15, unitPrice: 150000, discount: 5, total: 2137500 },
];

// ─── Accounts Receivable Aging (open invoices for aging report) ─────────────
// daysOverdue = days past the due date (0 means not yet due or paid today).
export const agingInvoices = [
    { invoiceId: 'INV-1001', customerId: 'CUST-001', customerName: 'Acme Corp', invoiceDate: '2026-01-05', dueDate: '2026-02-04', amount: 1530000, paid: 0, balance: 1530000, daysOverdue: 16 },
    { invoiceId: 'INV-1003', customerId: 'CUST-001', customerName: 'Acme Corp', invoiceDate: '2026-01-20', dueDate: '2026-02-19', amount: 2700000, paid: 0, balance: 2700000, daysOverdue: 1 },
    { invoiceId: 'INV-1004', customerId: 'CUST-004', customerName: 'Umbrella Corp', invoiceDate: '2026-02-03', dueDate: '2026-03-04', amount: 10000000, paid: 0, balance: 10000000, daysOverdue: 0 },
    { invoiceId: 'INV-1005', customerId: 'CUST-003', customerName: 'Initech', invoiceDate: '2026-02-10', dueDate: '2026-02-25', amount: 975000, paid: 0, balance: 975000, daysOverdue: 0 },
    { invoiceId: 'INV-1006', customerId: 'CUST-002', customerName: 'Globex Inc', invoiceDate: '2026-02-14', dueDate: '2026-02-14', amount: 1200000, paid: 0, balance: 1200000, daysOverdue: 6 },
    { invoiceId: 'INV-1007', customerId: 'CUST-004', customerName: 'Umbrella Corp', invoiceDate: '2026-02-18', dueDate: '2026-03-19', amount: 2137500, paid: 1000000, balance: 1137500, daysOverdue: 0 },
];
