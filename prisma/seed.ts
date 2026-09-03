import { PrismaClient, ModuleKey } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  ROLE_TEMPLATES,
  STANDARD_CHILD_ACCOUNTS,
  STANDARD_ROOT_ACCOUNTS,
  buildFiscalYearPeriods,
} from '../lib/organization/bootstrap';
import { postOpeningStockIfNeeded } from '../lib/inventory-opening';
import { postBankOpeningBalance, postBankTransactionIfNeeded } from '../lib/bank-transaction-posting';
import { postBillToLedger } from '../lib/bill-posting';
import { postInvoiceSend } from '../lib/invoice-send-posting';
import { postApPaymentIfNeeded, postArPaymentIfNeeded } from '../lib/payment-posting';
import { postStockAdjustmentIfNeeded } from '../lib/stock-adjustment-posting';
import { syncApPaymentSettlement, syncArPaymentSettlement } from '../lib/settlement-status';

// Every document below is posted to the ledger through the same helpers the
// API uses, but ONLY when this run created it (each block checks first). The
// seed is idempotent and runs against real organizations, so a re-run must
// never post, restate or duplicate anything that already exists.
const OPENING_DATE = new Date('2026-01-01');

const prisma = new PrismaClient();

// Template data (module keys, standard COA, role permission matrices) lives in
// lib/organization/bootstrap.ts, shared with the in-app "New Company" wizard so
// the seed and the wizard can never drift. The seed keeps its own idempotent
// upsert loops below.
const adminTemplate = ROLE_TEMPLATES.find((t) => t.name === 'Administrator')!;
const posTemplate = ROLE_TEMPLATES.find((t) => t.name === 'POS Operator')!;
const cashierTemplate = ROLE_TEMPLATES.find((t) => t.name === 'Cashier')!;

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
      address: 'Jl. Demo Raya No. 1, Jakarta Selatan 12190',
      phone: '021-555-0100',
      companyEmail: 'hello@demo.com',
    },
    create: {
      id: 'org-demo',
      // The demo company must be ready to use the moment it is seeded. The
      // costing method is deliberately NOT defaulted in
      // lib/organization/bootstrap.ts — a real company has to choose FIFO vs
      // weighted-average consciously, and the app blocks the workspace until it
      // does. But that gate makes a freshly seeded database unusable: you log in
      // and land on Company Setup instead of the app, which is exactly what
      // stopped the e2e suite from reaching any screen.
      costingMethod: 'FIFO',
      costingMethodEffectiveDate: new Date('2026-01-01'),
      legalName: 'PT. Demo Accounting',
      displayName: 'PT. Demo Accounting',
      npwp: '01.234.567.8-901.000',
      isPkp: true,
      timezone: 'Asia/Jakarta',
      locale: 'id-ID',
      baseCurrency: 'IDR',
      address: 'Jl. Demo Raya No. 1, Jakarta Selatan 12190',
      phone: '021-555-0100',
      companyEmail: 'hello@demo.com',
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

  // Monthly accounting periods. The seed builds the demo org by hand rather
  // than through bootstrapOrganization, so it had been skipping these entirely
  // — leaving month-end close with nothing to operate on in dev and in e2e.
  // Same definition the bootstrap uses, so the two can never drift.
  await prisma.accountingPeriod.createMany({
    data: buildFiscalYearPeriods(new Date('2026-01-01')).map((p) => ({
      organizationId: org.id,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      status: 'OPEN' as const,
    })),
    skipDuplicates: true,
  });

  const role = await prisma.role.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: adminTemplate.name,
      },
    },
    update: {
      roleType: adminTemplate.roleType,
      invoiceAccessScope: adminTemplate.invoiceAccessScope,
      isActive: true,
    },
    create: {
      organizationId: org.id,
      name: adminTemplate.name,
      roleType: adminTemplate.roleType,
      invoiceAccessScope: adminTemplate.invoiceAccessScope,
      isActive: true,
      allowedDays: adminTemplate.allowedDays,
      startTime: adminTemplate.startTime,
      endTime: adminTemplate.endTime,
    },
  });

  await prisma.rolePermission.createMany({
    data: adminTemplate.permissions.map((p) => ({ roleId: role.id, ...p })),
    skipDuplicates: true,
  });

  await prisma.rolePermission.updateMany({
    where: { roleId: role.id },
    data: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canApprove: true,
    },
  });

  // ── POS: operator role, walk-in customer, one register ──────────────────────
  const posRole = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: org.id, name: posTemplate.name } },
    update: {},
    create: {
      organizationId: org.id,
      name: posTemplate.name,
      roleType: posTemplate.roleType,
      invoiceAccessScope: posTemplate.invoiceAccessScope,
      isActive: true,
      allowedDays: posTemplate.allowedDays,
      startTime: posTemplate.startTime,
      endTime: posTemplate.endTime,
    },
  });
  await prisma.rolePermission.createMany({
    data: posTemplate.permissions.map((p) => ({ roleId: posRole.id, ...p })),
    skipDuplicates: true,
  });

  await prisma.customer.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'WALK-IN' } },
    update: {},
    create: { organizationId: org.id, code: 'WALK-IN', name: 'Walk-in Customer', status: 'ACTIVE' },
  });

  const firstWarehouse = await prisma.warehouse.findFirst({ where: { organizationId: org.id }, select: { id: true } });
  const posWarehouseId = firstWarehouse?.id ?? (await prisma.warehouse.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'WH-MAIN' } },
    update: {},
    create: { organizationId: org.id, code: 'WH-MAIN', name: 'Apotek Utama' },
    select: { id: true },
  })).id;
  await prisma.posRegister.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'REG-1' } },
    update: {},
    create: { organizationId: org.id, code: 'REG-1', name: 'Register 1', warehouseId: posWarehouseId, isActive: true },
  });

  // ── POS: starter sales types (Toko Offline / Online) + register default ────
  const offlineSalesType = await prisma.salesType.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'Toko Offline' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Toko Offline',
      channel: 'OFFLINE',
      serviceChargePct: 0,
      taxable: true,
    },
  });

  await prisma.salesType.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'Online' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Online',
      channel: 'ONLINE',
      serviceChargePct: 0,
      taxable: true,
    },
  });

  await prisma.posRegister.update({
    where: { organizationId_code: { organizationId: org.id, code: 'REG-1' } },
    data: { defaultSalesTypeId: offlineSalesType.id },
  });

  const cashierRole = await prisma.role.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: cashierTemplate.name,
      },
    },
    update: {
      roleType: cashierTemplate.roleType,
      invoiceAccessScope: cashierTemplate.invoiceAccessScope,
      isActive: true,
    },
    create: {
      organizationId: org.id,
      name: cashierTemplate.name,
      roleType: cashierTemplate.roleType,
      invoiceAccessScope: cashierTemplate.invoiceAccessScope,
      isActive: true,
      allowedDays: cashierTemplate.allowedDays,
      startTime: cashierTemplate.startTime,
      endTime: cashierTemplate.endTime,
    },
  });

  await prisma.rolePermission.createMany({
    data: cashierTemplate.permissions.map((p) => ({ roleId: cashierRole.id, ...p })),
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
  // 1. Chart of Accounts (standard template from lib/organization/bootstrap.ts)
  // ============================================================
  const accountMap: Record<string, string> = {};

  for (const a of STANDARD_ROOT_ACCOUNTS) {
    const acc = await prisma.account.upsert({
      where: { organizationId_code: { organizationId: org.id, code: a.code } },
      update: {},
      create: { organizationId: org.id, code: a.code, name: a.name, type: a.type as any, normalSide: a.normalSide as any, isActive: true, isPostable: false },
    });
    accountMap[a.code] = acc.id;
  }

  // Child accounts (pass 1 — non-grandchildren)
  for (const a of STANDARD_CHILD_ACCOUNTS) {
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
  const existingBankNames = new Set(
    (await prisma.bankAccount.findMany({ where: { organizationId: org.id }, select: { name: true } })).map((b) => b.name),
  );
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
  // Dr Bank / Cr Opening Balance Equity for the balances above, so the GL
  // carries the same cash the Banking register shows.
  for (const bank of bankAccounts) {
    if (existingBankNames.has(bank.name)) continue;
    await prisma.$transaction((tx) => postBankOpeningBalance(tx, org.id, bank.id, bank.openingBalance, OPENING_DATE));
  }

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
    const existingItem = await prisma.item.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: i.sku } },
      select: { id: true },
    });
    const item = await prisma.item.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: i.sku } },
      update: {},
      create: { organizationId: org.id, ...i, isActive: true },
    });
    items.push(item);
    // Opening stock as real cost layers (Dr Inventory / Cr Opening Balance
    // Equity), otherwise "Widget A: 100 on hand" sells as "Only 0 available".
    if (!existingItem && i.openingStock > 0) {
      await prisma.$transaction((tx) => postOpeningStockIfNeeded(tx, org.id, item.id, OPENING_DATE));
    }
  }

  // ============================================================
  // 7. Sales Invoices (4 with lines)
  // SalesInvoice: number, totalAmount; Line: quantity, price, lineSubtotal, lineNo
  // ============================================================
  // Lines drive the header totals. Previously every invoice got the same fixed
  // pair of lines (1_000_000) regardless of its hardcoded header, so three of
  // the four disagreed with their own line items — INV-0004 stored 555_000
  // against 1_000_000 of lines, which reads as a broken invoice in the UI.
  const INVOICE_TAX_RATE = 0.11;
  const invoiceSeeds = [
    {
      number: 'INV-0001', customerId: customers[0].id, status: 'SENT',
      issueDate: new Date('2026-01-10'), dueDate: new Date('2026-02-10'),
      lines: [
        { description: 'Widget A x5', quantity: 5, price: 100_000 },
        { description: 'Service Alpha', quantity: 1, price: 500_000 },
      ],
    },
    {
      number: 'INV-0002', customerId: customers[1].id, status: 'PAID',
      issueDate: new Date('2026-01-15'), dueDate: new Date('2026-02-15'),
      lines: [
        { description: 'Widget A x10', quantity: 10, price: 100_000 },
        { description: 'Service Alpha', quantity: 2, price: 500_000 },
      ],
    },
    {
      number: 'INV-0003', customerId: customers[2].id, status: 'OVERDUE',
      issueDate: new Date('2025-12-01'), dueDate: new Date('2026-01-01'),
      lines: [
        { description: 'Widget A x15', quantity: 15, price: 100_000 },
        { description: 'Service Alpha', quantity: 3, price: 500_000 },
      ],
    },
    {
      number: 'INV-0004', customerId: customers[0].id, status: 'DRAFT',
      issueDate: new Date('2026-02-01'), dueDate: new Date('2026-03-01'),
      lines: [
        { description: 'Widget A x5', quantity: 5, price: 100_000 },
      ],
    },
  ] as const;
  for (const { lines, ...inv } of invoiceSeeds) {
    const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.price, 0);
    const taxAmount = Math.round(subtotal * INVOICE_TAX_RATE);
    const totalAmount = subtotal + taxAmount;
    const existing = await prisma.salesInvoice.findUnique({
      where: { organizationId_number: { organizationId: org.id, number: inv.number } },
      select: { id: true, createdById: true },
    });
    if (!existing) {
      const created = await prisma.salesInvoice.create({
        data: {
          organizationId: org.id,
          createdById: user.id,
          ...inv,
          subtotal,
          taxAmount,
          totalAmount,
          currency: 'IDR',
        },
      });
      await prisma.salesInvoiceLine.createMany({
        data: lines.map((l, i) => ({
          invoiceId: created.id,
          lineNo: i + 1,
          description: l.description,
          quantity: l.quantity,
          price: l.price,
          lineSubtotal: l.quantity * l.price,
        })),
      });
      // An issued invoice has hit the ledger (Dr A/R / Cr Revenue / Cr PPN);
      // only DRAFT stays unposted. Lines carry no item, so no COGS.
      if (inv.status !== 'DRAFT') {
        await prisma.$transaction((tx) => postInvoiceSend(tx, org.id, created.id));
      }
    } else if (!existing.createdById) {
      // Deliberately does NOT rewrite totals on rows that already exist — this
      // seed runs against real organizations, and silently restating an
      // invoice's financials would be far worse than stale demo data.
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
      // OPEN and PAID bills are approved documents: Dr Expense / Cr A/P.
      // PENDING is still awaiting approval and stays off the ledger.
      if (b.status === 'OPEN' || b.status === 'PAID') {
        const postable = await prisma.bill.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true, charges: true } });
        await prisma.$transaction((tx) => postBillToLedger(tx, org.id, postable));
      }
      // The PAID bill is paid by a real, posted AP payment (Dr A/P / Cr Bank),
      // so the status is earned rather than asserted.
      if (b.status === 'PAID') {
        const payment = await prisma.aPPayment.create({
          data: {
            organizationId: org.id,
            number: 'APP-0001',
            vendorId: b.vendorId,
            date: new Date('2026-01-30'),
            method: 'BANK_TRANSFER',
            reference: 'PAY-002',
            status: 'COMPLETED',
            totalAmount: b.totalAmount,
            allocations: { create: [{ billId: created.id, amountApplied: b.totalAmount }] },
          },
          select: { id: true },
        });
        await prisma.$transaction(async (tx) => {
          await postApPaymentIfNeeded(tx, org.id, payment.id);
          await syncApPaymentSettlement(tx, org.id, payment.id);
        });
      }
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
  // ARP-0001 half-settles INV-0001 (Acme, stays SENT); ARP-0002 settles
  // INV-0002 in full (Globex, PAID). Each is allocated and posted
  // (Dr Bank / Cr A/R), so the aging report and the statuses agree.
  const arpSeeds = [
    { number: 'ARP-0001', customerId: customers[0].id, invoiceNumber: 'INV-0001', status: 'COMPLETED', date: new Date('2026-01-20'), totalAmount: 555_000,   method: 'BANK_TRANSFER', reference: 'TRF-001' },
    { number: 'ARP-0002', customerId: customers[1].id, invoiceNumber: 'INV-0002', status: 'COMPLETED', date: new Date('2026-01-25'), totalAmount: 2_220_000, method: 'BANK_TRANSFER', reference: 'TRF-002' },
  ] as const;
  for (const { invoiceNumber, ...p } of arpSeeds) {
    const existingPayment = await prisma.aRPayment.findUnique({
      where: { organizationId_number: { organizationId: org.id, number: p.number } },
      select: { id: true },
    });
    if (existingPayment) continue;
    const invoice = await prisma.salesInvoice.findUnique({
      where: { organizationId_number: { organizationId: org.id, number: invoiceNumber } },
      select: { id: true },
    });
    const payment = await prisma.aRPayment.create({
      data: {
        organizationId: org.id,
        ...p,
        allocations: invoice ? { create: [{ invoiceId: invoice.id, amountApplied: p.totalAmount }] } : undefined,
      },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      await postArPaymentIfNeeded(tx, org.id, payment.id);
      await syncArPaymentSettlement(tx, org.id, payment.id);
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
  // 12. Bank Transactions (2)
  // BankTransaction: date, type (BankTxnType: INCOME|EXPENSE|TRANSFER), description required
  // ============================================================
  // The Banking register's own movements — money that is NOT an invoice or
  // bill settlement (those post through their payments above). Each is
  // posted (Dr Bank / Cr Income, Dr Expense / Cr Bank) and the cached bank
  // balance moves with it, as the bank-transaction routes do.
  const btSeeds = [
    { bankAccountId: bankAccounts[1].id, type: 'INCOME',   amount: 5_000_000, description: 'Capital injection',     reference: 'CAP-001', date: new Date('2026-01-05') },
    { bankAccountId: bankAccounts[0].id, type: 'EXPENSE',  amount: 800_000,   description: 'Office rent - January', reference: 'RENT-001', date: new Date('2026-01-28') },
  ] as const;
  for (const bt of btSeeds) {
    const existing = await prisma.bankTransaction.findFirst({
      where: { organizationId: org.id, reference: bt.reference },
    });
    if (!existing) {
      const created = await prisma.bankTransaction.create({
        data: { organizationId: org.id, ...bt },
      });
      const posted = await prisma.$transaction((tx) => postBankTransactionIfNeeded(tx, org.id, created.id));
      for (const move of posted.moves) {
        await prisma.bankAccount.update({ where: { id: move.bankAccountId }, data: { currentBalance: { increment: move.delta } } });
      }
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
      // Created awaiting approval, posted (5 units written off: Dr Inventory
      // Variance / Cr Inventory), then approved — the order the approval
      // finalizer uses, so the lots and the ledger carry the write-off.
      const adj = await prisma.stockAdjustment.create({
        data: {
          organizationId: org.id,
          number: 'ADJ-0001',
          date: new Date('2026-01-31'),
          type: 'QUANTITY',
          reason: 'Initial audit count',
          notes: 'Found 5 damaged units',
          status: 'PENDING_APPROVAL',
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
      await prisma.$transaction(async (tx) => {
        await postStockAdjustmentIfNeeded(tx, org.id, adj.id);
        await tx.stockAdjustment.update({ where: { id: adj.id }, data: { status: 'APPROVED' } });
      });
    }
  }

  await applyRawIndexes();

  console.log('Seed complete. Login: admin@demo.com / admin123 or cashier@demo.com / cashier123');
}

// Indexes Prisma's schema cannot express (partial / filtered uniques). `prisma db push`
// will NEVER create these, so they must be applied out-of-band on every fresh DB.
// Running them here (idempotent via IF NOT EXISTS) means a `db push` + reseed always
// leaves the DB fully indexed. Keep in sync with scripts/apply-db-indexes.mjs.
async function applyRawIndexes() {
  // Bug-A backstop: at most one OPEN (PENDING) ApprovalRequest per (org, docType, doc).
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalRequest_open_pending_unique"
     ON "ApprovalRequest" ("organizationId", "documentType", "documentId")
     WHERE status = 'PENDING';`
  );
  console.log('Applied raw indexes (ApprovalRequest_open_pending_unique).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
