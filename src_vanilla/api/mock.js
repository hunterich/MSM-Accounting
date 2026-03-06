export const coaData = [
    { code: '1000', name: 'Assets', type: 'Asset', balance: '$150,000.00', parent: null },
    { code: '1010', name: 'Current Assets', type: 'Asset', balance: '$124,500.00', parent: '1000' },
    { code: '1011', name: 'Checking Account', type: 'Asset', balance: '$80,000.00', parent: '1010' },
    { code: '1012', name: 'Savings Account', type: 'Asset', balance: '$44,500.00', parent: '1010' },
    { code: '1200', name: 'Accounts Receivable', type: 'Asset', balance: '$12,340.00', parent: '1010' },
    { code: '2000', name: 'Liabilities', type: 'Liability', balance: '$45,000.00', parent: null },
    { code: '2010', name: 'Accounts Payable', type: 'Liability', balance: '$15,000.00', parent: '2000' },
    { code: '4000', name: 'Revenue', type: 'Revenue', balance: '$250,000.00', parent: null },
    { code: '4010', name: 'Sales - Hardware', type: 'Revenue', balance: '$150,000.00', parent: '4000' },
    { code: '4020', name: 'Sales - Services', type: 'Revenue', balance: '$100,000.00', parent: '4000' },
    { code: '5000', name: 'Expenses', type: 'Expense', balance: '$85,000.00', parent: null },
    { code: '5010', name: 'Rent Expense', type: 'Expense', balance: '$24,000.00', parent: '5000' },
    { code: '5020', name: 'Salaries Expense', type: 'Expense', balance: '$50,000.00', parent: '5000' }
];

export const getCoA = () => {
    return new Promise(resolve => {
        setTimeout(() => resolve(coaData), 300);
    });
};
