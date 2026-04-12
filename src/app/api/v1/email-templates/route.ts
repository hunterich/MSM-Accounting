import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, listResponse, parsePaginationParams, requireOrg, withHandler, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const DEFAULT_TEMPLATES = [
  {
    name: 'Default Invoice Email',
    type: 'INVOICE',
    subject: 'Invoice {{invoiceNumber}} from {{companyName}}',
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1e40af">{{companyName}}</h2>
      <p>Dear {{customerName}},</p>
      <p>Please find below the details of your invoice.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Invoice Number</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">{{invoiceNumber}}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Amount Due</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">{{amount}}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Due Date</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">{{dueDate}}</td></tr>
      </table>
      <p>Please arrange payment before the due date.</p>
      <p>Thank you for your business.</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:32px">{{companyName}} - {{companyEmail}}</p>
    </div>`,
    bodyText: 'Dear {{customerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}}.\n\nPlease arrange payment before the due date.\n\nThank you,\n{{companyName}}',
    variables: ['invoiceNumber', 'companyName', 'customerName', 'amount', 'dueDate', 'companyEmail', 'companyPhone'],
    isDefault: true,
  },
  {
    name: 'Default Payment Reminder',
    type: 'PAYMENT_REMINDER',
    subject: 'Payment Reminder: Invoice {{invoiceNumber}} is overdue',
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#dc2626">{{companyName}} - Payment Reminder</h2>
      <div style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:8px 16px;border-radius:8px;display:inline-block;margin-bottom:16px;font-weight:600">Overdue: {{daysOverdue}} days</div>
      <p>Dear {{customerName}},</p>
      <p>This is a reminder that the following invoice is <strong>overdue</strong>. Please arrange payment as soon as possible.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Invoice Number</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">{{invoiceNumber}}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Amount Outstanding</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#dc2626">{{amount}}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Days Overdue</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#dc2626">{{daysOverdue}}</td></tr>
      </table>
      <p>If payment has already been made, please disregard this notice.</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:32px">{{companyName}}</p>
    </div>`,
    bodyText: 'Dear {{customerName}},\n\nThis is a reminder that Invoice {{invoiceNumber}} for {{amount}} is {{daysOverdue}} days overdue.\n\nPlease arrange payment immediately.\n\n{{companyName}}',
    variables: ['invoiceNumber', 'companyName', 'customerName', 'amount', 'daysOverdue', 'dueDate'],
    isDefault: true,
  },
  {
    name: 'Default Purchase Order Email',
    type: 'PURCHASE_ORDER',
    subject: 'Purchase Order {{poNumber}} from {{companyName}}',
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#065f46">{{companyName}} - Purchase Order</h2>
      <p>Dear {{vendorName}},</p>
      <p>Please find below our purchase order details. Kindly confirm receipt and expected delivery date.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">PO Number</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">{{poNumber}}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Order Value</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">{{amount}}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Expected Delivery</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">{{expectedDate}}</td></tr>
      </table>
      <p>Please confirm this order and advise if there are any issues with fulfillment.</p>
      <p>Thank you for your continued partnership.</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:32px">{{companyName}}</p>
    </div>`,
    bodyText: 'Dear {{vendorName}},\n\nPurchase Order {{poNumber}} for {{amount}}.\nExpected delivery: {{expectedDate}}\n\nPlease confirm receipt.\n\n{{companyName}}',
    variables: ['poNumber', 'companyName', 'vendorName', 'amount', 'expectedDate'],
    isDefault: true,
  },
];

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req);
  const type = searchParams.get('type');

  const where: any = { organizationId: orgId };
  if (type) where.type = type;

  const [data, total] = await Promise.all([
    (prisma as any).emailTemplate.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    }),
    (prisma as any).emailTemplate.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  // If seedDefaults flag is set, create all default templates
  if (body.seedDefaults) {
    const existing = await (prisma as any).emailTemplate.count({
      where: { organizationId: orgId, isDefault: true },
    });
    if (existing > 0) {
      return err('Default templates already exist for this organization', 409);
    }

    const created = await (prisma as any).emailTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({
        ...t,
        organizationId: orgId,
        variables: JSON.stringify(t.variables),
        isActive: true,
      })),
    });

    return ok({ count: created.count, message: 'Default templates seeded' }, 201);
  }

  // Normal create
  if (!body.name || !body.type || !body.subject) {
    return err('name, type, and subject are required', 400);
  }

  const template = await (prisma as any).emailTemplate.create({
    data: {
      organizationId: orgId,
      name: body.name,
      type: body.type,
      subject: body.subject,
      bodyHtml: body.bodyHtml || '',
      bodyText: body.bodyText || '',
      variables: body.variables ? JSON.stringify(body.variables) : '[]',
      isDefault: body.isDefault ?? false,
      isActive: body.isActive ?? true,
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'EmailTemplate',
    entityId: template.id,
    action: 'CREATE',
    payload: { name: template.name, type: template.type },
  });

  return ok(template, 201);
});
