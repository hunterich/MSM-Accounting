import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const prisma = {
    customer: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    customerCategory: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    item: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    itemCategory: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    vendor: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    vendorCategory: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
    },
    organization: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    $executeRaw: vi.fn(async () => undefined),
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  return { prisma };
});

vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    logAudit: vi.fn(),
    softDelete: vi.fn(),
  };
});

import { prisma } from '@/lib/prisma';
import { POST as createCustomerCategory } from '../customer-categories/route';
import { POST as createCustomer } from '../customers/route';
import { POST as createItem } from '../items/route';
import { POST as createItemCategory } from '../item-categories/route';
import { POST as createVendorCategory } from '../vendor-categories/route';
import { POST as createVendor } from '../vendors/route';
import { PUT as updateCustomer } from '../customers/[id]/route';
import { PUT as updateItem } from '../items/[id]/route';
import { PUT as updateVendor } from '../vendors/[id]/route';
import { PUT as updateOrganizationSettings } from '../organization/settings/route';

function makeReq(path: string, method = 'PUT', body?: unknown) {
  const init = { method, headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1' } } as any;
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost${path}`, init);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('master-data detail route validation', () => {
  it('normalizes customer category create payloads and coerces defaults', async () => {
    vi.mocked(prisma.customerCategory.create).mockResolvedValue({ id: 'cust-cat-1', name: 'Retail' } as never);

    const res = await createCustomerCategory(makeReq('/api/v1/customer-categories', 'POST', {
      name: 'Retail',
      prefix: 'rtl',
      defaultCreditLimit: '5000000',
      defaultPaymentTerms: '30',
      defaultDiscount: '2.5',
      description: 'Priority retail customers',
    }));

    expect(res.status).toBe(201);
    expect(prisma.customerCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        name: 'Retail',
        prefix: 'RTL',
        defaultCreditLimit: 5000000,
        defaultPaymentTerms: 30,
        defaultDiscount: 2.5,
        description: 'Priority retail customers',
      }),
    });
  });

  it('normalizes customer create payloads from the form shape', async () => {
    vi.mocked(prisma.customerCategory.findFirst).mockResolvedValue({ id: 'cat-1' } as never);
    vi.mocked(prisma.customer.create).mockResolvedValue({ id: 'cust-1' } as never);

    const res = await createCustomer(makeReq('/api/v1/customers', 'POST', {
      id: 'RTL-0001',
      name: 'Acme Corp',
      category: 'Retail',
      address1: 'Jl. Sudirman No. 1',
      paymentTerms: 30,
      initialBalance: 150000,
      status: 'Active',
    }), {});

    expect(res.status).toBe(201);
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        code: 'RTL-0001',
        name: 'Acme Corp',
        categoryId: 'cat-1',
        billingAddress: 'Jl. Sudirman No. 1',
        paymentTermsDays: 30,
        openingBalance: 150000,
        status: 'ACTIVE',
      }),
    });
  });

  it('normalizes customer form fields into persisted columns', async () => {
    vi.mocked(prisma.customerCategory.findFirst).mockResolvedValue({ id: 'cat-1' } as never);
    vi.mocked(prisma.customer.update).mockResolvedValue({ id: 'cust-1' } as never);

    const res = await updateCustomer(
      makeReq('/api/v1/customers/cust-1', 'PUT', {
        name: 'Acme Corp',
        category: 'Retail',
        address1: 'Jl. Sudirman No. 1',
        paymentTerms: 30,
        initialBalance: 150000,
        status: 'Active',
      }),
      params('cust-1'),
    );

    expect(res.status).toBe(200);
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1', organizationId: 'org-a' },
      data: expect.objectContaining({
        name: 'Acme Corp',
        categoryId: 'cat-1',
        billingAddress: 'Jl. Sudirman No. 1',
        paymentTermsDays: 30,
        openingBalance: 150000,
        status: 'ACTIVE',
        updatedAt: expect.any(Date),
      }),
    });
  });

  it('rejects item updates when the inventory account is outside the organization', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);

    const res = await updateItem(
      makeReq('/api/v1/items/item-1', 'PUT', {
        inventoryAccountId: 'missing-account',
      }),
      params('item-1'),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Inventory account not found in organization' });
    expect(prisma.item.update).not.toHaveBeenCalled();
  });

  it('normalizes item create payloads and validates foreign keys', async () => {
    vi.mocked(prisma.itemCategory.findFirst).mockResolvedValue({ id: 'cat-1' } as never);
    vi.mocked(prisma.account.findFirst).mockResolvedValue({ id: 'acc-1' } as never);
    vi.mocked(prisma.item.create).mockResolvedValue({ id: 'item-1', name: 'Widget' } as never);

    const res = await createItem(makeReq('/api/v1/items', 'POST', {
      sku: 'SKU-001',
      name: 'Widget',
      categoryId: 'cat-1',
      inventoryAccountId: 'acc-1',
      revenueAccountId: 'acc-1',
      cogsAccountId: 'acc-1',
      cost: 10000,
      price: 15000,
      status: 'Active',
    }));

    expect(res.status).toBe(201);
    expect(prisma.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        sku: 'SKU-001',
        name: 'Widget',
        categoryId: 'cat-1',
        inventoryAccountId: 'acc-1',
        revenueAccountId: 'acc-1',
        cogsAccountId: 'acc-1',
        costPrice: 10000,
        sellingPrice: 15000,
        isActive: true,
      }),
      include: { category: { select: { id: true, name: true, code: true } } },
    });
  });

  it('normalizes item category create payloads', async () => {
    vi.mocked(prisma.itemCategory.create).mockResolvedValue({ id: 'item-cat-1', name: 'Electronics' } as never);

    const res = await createItemCategory(makeReq('/api/v1/item-categories', 'POST', {
      name: 'Electronics',
      code: 'ele',
      description: 'Devices and accessories',
      isActive: true,
    }));

    expect(res.status).toBe(201);
    expect(prisma.itemCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        name: 'Electronics',
        code: 'ELE',
        description: 'Devices and accessories',
        isActive: true,
      }),
    });
  });

  it('normalizes vendor create payloads and applies category defaults', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({ id: 'ap-1' } as never);
    vi.mocked(prisma.vendorCategory.findFirst).mockResolvedValue({
      id: 'cat-1',
      name: 'Local Supplier',
      defaultPaymentTerms: 'Net 45',
      defaultApAccountId: 'ap-2',
    } as never);
    vi.mocked(prisma.vendor.create).mockResolvedValue({ id: 'vendor-1' } as never);

    const res = await createVendor(makeReq('/api/v1/vendors', 'POST', {
      code: 'VND-0001',
      name: 'PT Sumber Makmur',
      categoryId: 'cat-1',
      defaultApAccountId: 'ap-1',
      status: 'Active',
    }), {});

    expect(res.status).toBe(201);
    expect(prisma.vendor.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        code: 'VND-0001',
        name: 'PT Sumber Makmur',
        categoryId: 'cat-1',
        category: 'Local Supplier',
        paymentTerms: 'Net 45',
        defaultApAccountId: 'ap-1',
        status: 'ACTIVE',
      }),
      include: {
        vendorCategory: {
          select: { id: true, name: true, code: true, defaultPaymentTerms: true, defaultApAccountId: true },
        },
      },
    });
  });

  it('validates vendor category create A/P accounts within the organization', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({ id: 'ap-1' } as never);
    vi.mocked(prisma.vendorCategory.create).mockResolvedValue({ id: 'vendor-cat-1', code: 'PACK' } as never);

    const res = await createVendorCategory(makeReq('/api/v1/vendor-categories', 'POST', {
      name: 'Packaging',
      code: 'pack',
      defaultApAccountId: 'ap-1',
      defaultPaymentTerms: 'Net 30',
    }));

    expect(res.status).toBe(201);
    expect(prisma.vendorCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        name: 'Packaging',
        code: 'PACK',
        defaultApAccountId: 'ap-1',
        defaultPaymentTerms: 'Net 30',
      }),
    });
  });

  it('rejects vendor creates when the A/P account is outside the organization', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);

    const res = await createVendor(makeReq('/api/v1/vendors', 'POST', {
      code: 'VND-0001',
      name: 'PT Sumber Makmur',
      defaultApAccountId: 'missing-account',
    }), {});

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'A/P account not found in organization' });
    expect(prisma.vendor.create).not.toHaveBeenCalled();
  });

  it('rejects invalid vendor emails before writing', async () => {
    const res = await updateVendor(
      makeReq('/api/v1/vendors/vendor-1', 'PUT', {
        email: 'not-an-email',
      }),
      params('vendor-1'),
    );

    expect(res.status).toBe(400);
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });

  it('requires a finance email when notifications are enabled', async () => {
    const res = await updateOrganizationSettings(
      makeReq('/api/v1/organization/settings', 'PUT', {
        invoiceReminders: true,
        financeEmail: '',
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Finance notification email is required when notifications are enabled',
    });
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});
