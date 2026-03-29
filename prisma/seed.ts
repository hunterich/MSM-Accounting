import { PrismaClient, ModuleKey, RoleType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ALL_MODULE_KEYS: ModuleKey[] = [
  ModuleKey.DASHBOARD,
  ModuleKey.GL_COA,
  ModuleKey.GL_JOURNAL,
  ModuleKey.AR_INVOICES,
  ModuleKey.AR_SALES_ORDERS,
  ModuleKey.AR_PAYMENTS,
  ModuleKey.AR_CREDITS,
  ModuleKey.AR_CUSTOMERS,
  ModuleKey.AP_POS,
  ModuleKey.AP_BILLS,
  ModuleKey.AP_PAYMENTS,
  ModuleKey.AP_DEBITS,
  ModuleKey.AP_VENDORS,
  ModuleKey.INV_ITEMS,
  ModuleKey.INV_CATEGORIES,
  ModuleKey.INV_ADJ,
  ModuleKey.HR_EMPLOYEES,
  ModuleKey.HR_ATTENDANCE,
  ModuleKey.HR_PAYROLL,
  ModuleKey.BANKING,
  ModuleKey.INTEGRATIONS,
  ModuleKey.REPORTS,
  ModuleKey.COMPANY,
  ModuleKey.SETTINGS,
];

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: 'org-demo' },
    update: {
      legalName: 'PT. Demo Accounting',
      displayName: 'PT. Demo Accounting',
      npwp: '01.234.567.8-901.000',
      timezone: 'Asia/Jakarta',
      locale: 'id-ID',
      baseCurrency: 'IDR',
    },
    create: {
      id: 'org-demo',
      legalName: 'PT. Demo Accounting',
      displayName: 'PT. Demo Accounting',
      npwp: '01.234.567.8-901.000',
      isPkp: true,
      timezone: 'Asia/Jakarta',
      locale: 'id-ID',
      baseCurrency: 'IDR',
      taxEnabled: true,
      taxDefaultRate: 11,
      taxInclusiveByDefault: false,
      defaultCreditLimit: 0,
      enforceCreditLimit: true,
      invoiceReminders: true,
      paymentAlerts: true,
      dailySummary: false,
      financeEmail: 'finance@demo.com',
      fiscalYearStart: new Date('2026-01-01'),
    },
  });

  const role = await prisma.role.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: 'Administrator',
      },
    },
    update: {
      roleType: RoleType.ADMIN,
      invoiceAccessScope: 'ALL',
      isActive: true,
    },
    create: {
      organizationId: org.id,
      name: 'Administrator',
      roleType: RoleType.ADMIN,
      invoiceAccessScope: 'ALL',
      isActive: true,
      allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      startTime: '00:00',
      endTime: '23:59',
    },
  });

  await prisma.rolePermission.createMany({
    data: ALL_MODULE_KEYS.map((moduleKey) => ({
      roleId: role.id,
      moduleKey,
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
    })),
    skipDuplicates: true,
  });

  await prisma.rolePermission.updateMany({
    where: { roleId: role.id },
    data: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
    },
  });

  const cashierRole = await prisma.role.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: 'Cashier',
      },
    },
    update: {
      roleType: RoleType.CUSTOM,
      invoiceAccessScope: 'OWN',
      isActive: true,
    },
    create: {
      organizationId: org.id,
      name: 'Cashier',
      roleType: RoleType.CUSTOM,
      invoiceAccessScope: 'OWN',
      isActive: true,
      allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      startTime: '08:00',
      endTime: '18:00',
    },
  });

  await prisma.rolePermission.createMany({
    data: [
      { roleId: cashierRole.id, moduleKey: ModuleKey.DASHBOARD, canView: true, canCreate: false, canEdit: false, canDelete: false },
      { roleId: cashierRole.id, moduleKey: ModuleKey.AR_INVOICES, canView: true, canCreate: true, canEdit: true, canDelete: false },
      { roleId: cashierRole.id, moduleKey: ModuleKey.AR_CUSTOMERS, canView: true, canCreate: false, canEdit: false, canDelete: false },
      { roleId: cashierRole.id, moduleKey: ModuleKey.AR_PAYMENTS, canView: true, canCreate: true, canEdit: false, canDelete: false },
    ],
    skipDuplicates: true,
  });

  await prisma.rolePermission.updateMany({
    where: {
      roleId: cashierRole.id,
      moduleKey: ModuleKey.DASHBOARD,
    },
    data: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    },
  });

  await prisma.rolePermission.updateMany({
    where: {
      roleId: cashierRole.id,
      moduleKey: ModuleKey.AR_INVOICES,
    },
    data: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
    },
  });

  await prisma.rolePermission.updateMany({
    where: {
      roleId: cashierRole.id,
      moduleKey: ModuleKey.AR_CUSTOMERS,
    },
    data: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    },
  });

  await prisma.rolePermission.updateMany({
    where: {
      roleId: cashierRole.id,
      moduleKey: ModuleKey.AR_PAYMENTS,
    },
    data: {
      canView: true,
      canCreate: true,
      canEdit: false,
      canDelete: false,
    },
  });

  const passwordHash = await bcrypt.hash('admin123', 12);
  const cashierPasswordHash = await bcrypt.hash('cashier123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {
      fullName: 'Admin User',
      passwordHash,
      status: 'ACTIVE',
    },
    create: {
      email: 'admin@demo.com',
      fullName: 'Admin User',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const cashierUser = await prisma.user.upsert({
    where: { email: 'cashier@demo.com' },
    update: {
      fullName: 'Cashier User',
      passwordHash: cashierPasswordHash,
      status: 'ACTIVE',
    },
    create: {
      email: 'cashier@demo.com',
      fullName: 'Cashier User',
      passwordHash: cashierPasswordHash,
      status: 'ACTIVE',
    },
  });

  await prisma.userOrganization.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: org.id,
      },
    },
    update: {
      roleId: role.id,
      isActive: true,
    },
    create: {
      userId: user.id,
      organizationId: org.id,
      roleId: role.id,
      isActive: true,
    },
  });

  await prisma.userOrganization.upsert({
    where: {
      userId_organizationId: {
        userId: cashierUser.id,
        organizationId: org.id,
      },
    },
    update: {
      roleId: cashierRole.id,
      isActive: true,
    },
    create: {
      userId: cashierUser.id,
      organizationId: org.id,
      roleId: cashierRole.id,
      isActive: true,
    },
  });


  // ============================================================
  // 1. Chart of Accounts
  // ============================================================
  // normalSide: DEBIT for ASSET/EXPENSE, CREDIT for LIABILITY/EQUITY/REVENUE
  const rootAccountsData = [
    { code: '1-0000', name: 'Current Assets',      type: 'ASSET',     normalSide: 'DEBIT'  },
    { code: '2-0000', name: 'Current Liabilities',  type: 'LIABILITY', normalSide: 'CREDIT' },
    { code: '3-0000', name: 'Equity',              type: 'EQUITY',    normalSide: 'CREDIT' },
    { code: '4-0000', name: 'Revenue',             type: 'REVENUE',   normalSide: 'CREDIT' },
    { code: '5-0000', name: 'Operating Expenses',  type: 'EXPENSE',   normalSide: 'DEBIT'  },
  ] as const;

  const accountMap: Record<string, string> = {};

  for (const a of rootAccountsData) {
    const acc = await prisma.account.upsert({
      where: { organizationId_code: { organizationId: org.id, code: a.code } },
      update: {},
      create: { organizationId: org.id, code: a.code, name: a.name, type: a.type as any, normalSide: a.normalSide as any, isActive: true, isPostable: false },
    });
    accountMap[a.code] = acc.id;
  }

  // Child accounts (pass 1 — non-grandchildren)
  const childAccountsData = [
    { code: '1-1000', name: 'Cash and Bank',        type: 'ASSET',     normalSide: 'DEBIT',  parentCode: '1-0000' },
    { code: '1-1200', name: 'Accounts Receivable',   type: 'ASSET',     normalSide: 'DEBIT',  parentCode: '1-0000' },
    { code: '1-1300', name: 'Inventory',             type: 'ASSET',     normalSide: 'DEBIT',  parentCode: '1-0000' },
    { code: '2-1000', name: 'Accounts Payable',      type: 'LIABILITY', normalSide: 'CREDIT', parentCode: '2-0000' },
    { code: '2-1100', name: 'Tax Payable (PPN)',     type: 'LIABILITY', normalSide: 'CREDIT', parentCode: '2-0000' },
    { code: '3-1000', name: 'Retained Earnings',     type: 'EQUITY',    normalSide: 'CREDIT', parentCode: '3-0000' },
    { code: '4-1000', name: 'Sales Revenue',         type: 'REVENUE',   normalSide: 'CREDIT', parentCode: '4-0000' },
    { code: '5-1000', name: 'Cost of Goods Sold',    type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },
    { code: '5-1100', name: 'Salaries Expense',      type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },
  ] as const;

  for (const a of childAccountsData) {
    const acc = await prisma.account.upsert({
      where: { organizationId_code: { organizationId: org.id, code: a.code } },
      update: {},
      create: {
        organizationId: org.id,
        code: a.code, name: a.name,
        type: a.type as any,
        normalSide: a.normalSide as any,
        parentId: accountMap[a.parentCode],
        isActive: true,
        isPostable: true,
      },
    });
    accountMap[a.code] = acc.id;
  }

  // Grandchild: 1-1100 (child of 1-1000)
  const bankBcaAcc = await prisma.account.upsert({
    where: { organizationId_code: { organizationId: org.id, code: '1-1100' } },
    update: {},
    create: {
      organizationId: org.id,
      code: '1-1100', name: 'Bank BCA IDR',
      type: 'ASSET' as any,
      normalSide: 'DEBIT' as any,
      parentId: accountMap['1-1000'],
      isActive: true,
      isPostable: true,
    },
  });
  accountMap['1-1100'] = bankBcaAcc.id;

  // ============================================================
  // 2. Bank Accounts (unique on organizationId + name)
  // ============================================================
  const bankAccounts = await Promise.all([
    prisma.bankAccount.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'Bank BCA IDR' } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'Bank BCA IDR',
        bankName: 'BCA',
        currency: 'IDR',
        currentBalance: 50_000_000,
        openingBalance: 50_000_000,
        isActive: true,
      },
    }),
    prisma.bankAccount.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'Bank Mandiri IDR' } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'Bank Mandiri IDR',
        bankName: 'Mandiri',
        currency: 'IDR',
        currentBalance: 25_000_000,
        openingBalance: 25_000_000,
        isActive: true,
      },
    }),
  ]);

  // ============================================================
  // 3. Customers (unique on organizationId + code)
  // ============================================================
  const customerData = [
    { code: 'CST-0001', name: 'Acme Corp',        email: 'ar@acme.com',     phone: '021-1111-0001', billingAddress: 'Jakarta' },
    { code: 'CST-0002', name: 'Globex Inc',        email: 'ar@globex.com',   phone: '021-1111-0002', billingAddress: 'Surabaya' },
    { code: 'CST-0003', name: 'Initech',           email: 'ar@initech.com',  phone: '021-1111-0003', billingAddress: 'Bandung' },
    { code: 'CST-0004', name: 'Umbrella Corp',     email: 'ar@umbrella.com', phone: '021-1111-0004', billingAddress: 'Medan' },
    { code: 'CST-0005', name: 'Stark Industries',  email: 'ar@stark.com',    phone: '021-1111-0005', billingAddress: 'Bali' },
  ];
  const customers: any[] = [];
  for (const c of customerData) {
    const customer = await prisma.customer.upsert({
      where: { organizationId_code: { organizationId: org.id, code: c.code } },
      update: {},
      create: { organizationId: org.id, ...c, status: 'ACTIVE' },
    });
    customers.push(customer);
  }

  // ============================================================
  // 4. Vendor Categories + Vendors (unique on organizationId + code)
  // ============================================================
  const vendorCategoryData = [
    { code: 'INV', name: 'Inventory Suppliers', defaultPaymentTerms: 'Net 30' },
    { code: 'SRV', name: 'Service Vendors', defaultPaymentTerms: 'Net 15' },
    { code: 'OPS', name: 'Operational Suppliers', defaultPaymentTerms: 'Due on Receipt' },
  ] as const;
  const vendorCategoriesByCode: Record<string, any> = {};
  for (const category of vendorCategoryData) {
    const record = await prisma.vendorCategory.upsert({
      where: { organizationId_code: { organizationId: org.id, code: category.code } },
      update: {},
      create: {
        organizationId: org.id,
        code: category.code,
        name: category.name,
        defaultPaymentTerms: category.defaultPaymentTerms,
        defaultApAccountId: accountMap['2-1000'],
        isActive: true,
      },
    });
    vendorCategoriesByCode[category.code] = record;
  }

  const vendorData = [
    { code: 'VND-0001', name: 'Supplier Alpha', email: 'ap@alpha.com', phone: '021-2222-0001', categoryCode: 'INV' },
    { code: 'VND-0002', name: 'Supplier Beta', email: 'ap@beta.com', phone: '021-2222-0002', categoryCode: 'SRV' },
    { code: 'VND-0003', name: 'Supplier Gamma', email: 'ap@gamma.com', phone: '021-2222-0003', categoryCode: 'INV' },
    { code: 'VND-0004', name: 'Supplier Delta', email: 'ap@delta.com', phone: '021-2222-0004', categoryCode: 'OPS' },
  ] as const;
  const vendors: any[] = [];
  for (const v of vendorData) {
    const category = vendorCategoriesByCode[v.categoryCode];
    const vendor = await prisma.vendor.upsert({
      where: { organizationId_code: { organizationId: org.id, code: v.code } },
      update: {},
      create: {
        organizationId: org.id,
        code: v.code,
        name: v.name,
        email: v.email,
        phone: v.phone,
        category: category?.name ?? null,
        categoryId: category?.id ?? null,
        paymentTerms: category?.defaultPaymentTerms ?? 'Net 30',
        defaultApAccountId: accountMap['2-1000'],
        status: 'ACTIVE',
      },
    });
    vendors.push(vendor);
  }

  // ============================================================
  // 5. Employees (FULL_TIME | CONTRACT only)
  // No unique email constraint — unique on organizationId_employeeNo
  // ============================================================
  const employeeData = [
    { employeeNo: 'EMP-0001', name: 'Admin User',    email: 'empladmin@demo.com',   joinDate: new Date('2023-01-01'), type: 'FULL_TIME', basicSalary: 15_000_000 },
    { employeeNo: 'EMP-0002', name: 'Alice Finance',  email: 'alice@demo.com',        joinDate: new Date('2023-03-15'), type: 'FULL_TIME', basicSalary: 12_000_000 },
    { employeeNo: 'EMP-0003', name: 'Bob Ops',        email: 'bob@demo.com',          joinDate: new Date('2024-01-01'), type: 'CONTRACT',  basicSalary: 10_000_000 },
  ] as const;
  for (const e of employeeData) {
    await prisma.employee.upsert({
      where: { organizationId_employeeNo: { organizationId: org.id, employeeNo: e.employeeNo } },
      update: {},
      create: { organizationId: org.id, ...e, status: 'ACTIVE' },
    });
  }

  // ============================================================
  // 6. Items (unique on organizationId + sku)
  // Item has openingStock not stockQty
  // ============================================================
  const itemData = [
    { sku: 'WGT-A', name: 'Widget A',      type: 'PRODUCT', unit: 'PCS', costPrice: 50_000,  sellingPrice: 100_000, openingStock: 100 },
    { sku: 'WGT-B', name: 'Widget B',      type: 'PRODUCT', unit: 'PCS', costPrice: 75_000,  sellingPrice: 150_000, openingStock: 50  },
    { sku: 'SVC-A', name: 'Service Alpha', type: 'SERVICE', unit: 'HR',  costPrice: 0,        sellingPrice: 500_000, openingStock: 0   },
    { sku: 'SVC-B', name: 'Service Beta',  type: 'SERVICE', unit: 'HR',  costPrice: 0,        sellingPrice: 750_000, openingStock: 0   },
    { sku: 'CMP-X', name: 'Component X',   type: 'PRODUCT', unit: 'PCS', costPrice: 25_000,  sellingPrice: 60_000,  openingStock: 200 },
  ] as const;
  const items: any[] = [];
  for (const i of itemData) {
    const item = await prisma.item.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: i.sku } },
      update: {},
      create: { organizationId: org.id, ...i, isActive: true },
    });
    items.push(item);
  }

  // ============================================================
  // 7. Sales Invoices (4 with lines)
  // SalesInvoice: number, totalAmount; Line: quantity, price, lineSubtotal, lineNo
  // ============================================================
  const invoiceSeeds = [
    { number: 'INV-0001', customerId: customers[0].id, status: 'SENT',    issueDate: new Date('2026-01-10'), dueDate: new Date('2026-02-10'), subtotal: 1_000_000, taxAmount: 110_000, totalAmount: 1_110_000 },
    { number: 'INV-0002', customerId: customers[1].id, status: 'PAID',    issueDate: new Date('2026-01-15'), dueDate: new Date('2026-02-15'), subtotal: 2_000_000, taxAmount: 220_000, totalAmount: 2_220_000 },
    { number: 'INV-0003', customerId: customers[2].id, status: 'OVERDUE', issueDate: new Date('2025-12-01'), dueDate: new Date('2026-01-01'), subtotal: 3_000_000, taxAmount: 330_000, totalAmount: 3_330_000 },
    { number: 'INV-0004', customerId: customers[0].id, status: 'DRAFT',   issueDate: new Date('2026-02-01'), dueDate: new Date('2026-03-01'), subtotal: 500_000,   taxAmount: 55_000,  totalAmount: 555_000  },
  ] as const;
  for (const inv of invoiceSeeds) {
    const existing = await prisma.salesInvoice.findUnique({
      where: { organizationId_number: { organizationId: org.id, number: inv.number } },
      select: { id: true, createdById: true },
    });
    if (!existing) {
      const created = await prisma.salesInvoice.create({
        data: { organizationId: org.id, createdById: user.id, ...inv, currency: 'IDR' },
      });
      await prisma.salesInvoiceLine.createMany({
        data: [
          { invoiceId: created.id, lineNo: 1, description: 'Widget A x5',  quantity: 5, price: 100_000, lineSubtotal: 500_000 },
          { invoiceId: created.id, lineNo: 2, description: 'Service Alpha', quantity: 1, price: 500_000, lineSubtotal: 500_000 },
        ],
      });
    } else if (!existing.createdById) {
      await prisma.salesInvoice.update({
        where: { id: existing.id },
        data: { createdById: user.id },
      });
    }
  }

  // ============================================================
  // 8. Bills (3 with lines)
  // Bill: number, totalAmount; Line: quantity, price, lineTotal, lineNo
  // ============================================================
  const billSeeds = [
    { number: 'BILL-0001', vendorId: vendors[0].id, status: 'OPEN',    issueDate: new Date('2026-01-05'), dueDate: new Date('2026-02-05'), subtotal: 800_000,   taxAmount: 0, totalAmount: 800_000   },
    { number: 'BILL-0002', vendorId: vendors[1].id, status: 'PAID',    issueDate: new Date('2026-01-10'), dueDate: new Date('2026-02-10'), subtotal: 1_500_000, taxAmount: 0, totalAmount: 1_500_000 },
    { number: 'BILL-0003', vendorId: vendors[2].id, status: 'PENDING', issueDate: new Date('2026-01-20'), dueDate: new Date('2026-02-20'), subtotal: 600_000,   taxAmount: 0, totalAmount: 600_000   },
  ] as const;
  for (const b of billSeeds) {
    const existing = await prisma.bill.findUnique({
      where: { organizationId_number: { organizationId: org.id, number: b.number } },
    });
    if (!existing) {
      const created = await prisma.bill.create({ data: { organizationId: org.id, ...b } });
      await prisma.billLine.createMany({
        data: [
          { billId: created.id, lineNo: 1, description: 'Supplies purchase', quantity: 1, price: b.subtotal, lineTotal: b.subtotal },
        ],
      });
    }
  }

  // ============================================================
  // 9. Purchase Orders (2 with lines)
  // PurchaseOrder: number, date, totalAmount
  // ============================================================
  const poSeeds = [
    { number: 'PO-0001', vendorId: vendors[0].id, status: 'DRAFT',    date: new Date('2026-01-08'),  expectedDate: new Date('2026-01-22'), subtotal: 500_000,   taxAmount: 0, totalAmount: 500_000   },
    { number: 'PO-0002', vendorId: vendors[1].id, status: 'APPROVED', date: new Date('2026-01-12'), expectedDate: new Date('2026-01-26'), subtotal: 1_000_000, taxAmount: 0, totalAmount: 1_000_000 },
  ] as const;
  for (const po of poSeeds) {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { organizationId_number: { organizationId: org.id, number: po.number } },
    });
    if (!existing) {
      const created = await prisma.purchaseOrder.create({ data: { organizationId: org.id, ...po } });
      await prisma.purchaseOrderLine.createMany({
        data: [
          { purchaseOrderId: created.id, lineNo: 1, description: 'Widget A x10', quantity: 10, price: po.subtotal / 10, lineTotal: po.subtotal },
        ],
      });
    }
  }

  // ============================================================
  // 10. AR Payments (2)
  // ARPayment: number, date, totalAmount
  // ============================================================
  const arpSeeds = [
    { number: 'ARP-0001', customerId: customers[0].id, status: 'COMPLETED', date: new Date('2026-01-20'), totalAmount: 2_220_000, method: 'BANK_TRANSFER', reference: 'TRF-001' },
    { number: 'ARP-0002', customerId: customers[1].id, status: 'COMPLETED', date: new Date('2026-01-25'), totalAmount: 1_110_000, method: 'BANK_TRANSFER', reference: 'TRF-002' },
  ] as const;
  for (const p of arpSeeds) {
    await prisma.aRPayment.upsert({
      where: { organizationId_number: { organizationId: org.id, number: p.number } },
      update: {},
      create: { organizationId: org.id, ...p },
    });
  }

  // ============================================================
  // 11. Journal Entries (3) with Lines
  // JournalEntry: entryNo, memo; JournalLine: entryId, lineNo
  // ============================================================
  const revenueAcc = await prisma.account.findFirst({ where: { organizationId: org.id, code: '4-1000' } });
  const arAcc      = await prisma.account.findFirst({ where: { organizationId: org.id, code: '1-1200' } });

  if (revenueAcc && arAcc) {
    const jeSeeds = [
      { entryNo: 'JE-0001', status: 'POSTED', date: new Date('2026-01-15'), memo: 'Revenue recognition Jan', totalDebit: 1_000_000, totalCredit: 1_000_000 },
      { entryNo: 'JE-0002', status: 'DRAFT',  date: new Date('2026-02-01'), memo: 'Accrual entry',           totalDebit: 500_000,   totalCredit: 500_000   },
      { entryNo: 'JE-0003', status: 'DRAFT',  date: new Date('2026-02-05'), memo: 'Adjustment entry',        totalDebit: 250_000,   totalCredit: 250_000   },
    ] as const;
    for (const je of jeSeeds) {
      const existing = await prisma.journalEntry.findUnique({
        where: { organizationId_entryNo: { organizationId: org.id, entryNo: je.entryNo } },
      });
      if (!existing) {
        const created = await prisma.journalEntry.create({
          data: { organizationId: org.id, ...je, source: 'MANUAL' },
        });
        await prisma.journalLine.createMany({
          data: [
            { entryId: created.id, lineNo: 1, accountId: arAcc.id,      debit: je.totalDebit,  credit: 0,               description: 'AR debit'      },
            { entryId: created.id, lineNo: 2, accountId: revenueAcc.id, debit: 0,              credit: je.totalCredit,  description: 'Revenue credit' },
          ],
        });
      }
    }
  }

  // ============================================================
  // 12. Bank Transactions (5)
  // BankTransaction: date, type (BankTxnType: INCOME|EXPENSE|TRANSFER), description required
  // ============================================================
  const btSeeds = [
    { bankAccountId: bankAccounts[0].id, type: 'INCOME',   amount: 2_220_000, description: 'Payment from Acme Corp',    reference: 'TRF-001', date: new Date('2026-01-20') },
    { bankAccountId: bankAccounts[0].id, type: 'INCOME',   amount: 1_110_000, description: 'Payment from Globex Inc',   reference: 'TRF-002', date: new Date('2026-01-25') },
    { bankAccountId: bankAccounts[0].id, type: 'EXPENSE',  amount: 800_000,   description: 'Payment to Supplier Alpha', reference: 'PAY-001', date: new Date('2026-01-28') },
    { bankAccountId: bankAccounts[1].id, type: 'INCOME',   amount: 5_000_000, description: 'Capital injection',          reference: 'CAP-001', date: new Date('2026-01-05') },
    { bankAccountId: bankAccounts[1].id, type: 'EXPENSE',  amount: 1_500_000, description: 'Payment to Supplier Beta',  reference: 'PAY-002', date: new Date('2026-01-30') },
  ] as const;
  for (const bt of btSeeds) {
    const existing = await prisma.bankTransaction.findFirst({
      where: { organizationId: org.id, reference: bt.reference },
    });
    if (!existing) {
      await prisma.bankTransaction.create({
        data: { organizationId: org.id, ...bt },
      });
    }
  }

  // ============================================================
  // 13. Stock Adjustment (1) — using header+lines pattern
  // StockAdjustment: number, date, type (QUANTITY|VALUE), reason, notes, status
  // StockAdjustmentLine: stockAdjustmentId, lineNo, itemId, oldQty, newQty, qtyDiff, unitCost, totalValue
  // ============================================================
  const widgetA = items.find((i: any) => i.sku === 'WGT-A');
  if (widgetA) {
    const existingAdj = await prisma.stockAdjustment.findFirst({
      where: { organizationId: org.id, reason: 'Initial audit count' },
    });
    if (!existingAdj) {
      const adj = await prisma.stockAdjustment.create({
        data: {
          organizationId: org.id,
          number: 'ADJ-0001',
          date: new Date('2026-01-31'),
          type: 'QUANTITY',
          reason: 'Initial audit count',
          notes: 'Found 5 damaged units',
          status: 'APPROVED',
        },
      });
      await prisma.stockAdjustmentLine.create({
        data: {
          stockAdjustmentId: adj.id,
          lineNo: 1,
          itemId: widgetA.id,
          oldQty: 100,
          newQty: 95,
          qtyDiff: -5,
          unitCost: widgetA.costPrice,
          totalValue: Number(widgetA.costPrice) * 5,
        },
      });
    }
  }

  console.log('Seed complete. Login: admin@demo.com / admin123 or cashier@demo.com / cashier123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
