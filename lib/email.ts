import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY ?? 're_unset')
  }
  return _resend
}
const resend = new Proxy({} as Resend, {
  get(_, prop) {
    return (getResend() as unknown as Record<string | symbol, unknown>)[prop as string]
  },
})

const FROM = process.env.EMAIL_FROM_ADDRESS ?? 'noreply@msm-accounting.app'

function formatFrom(name?: string | null): string {
  return name ? `${name} <${FROM}>` : FROM
}

/**
 * Replace {{variable}} Mustache-style placeholders in a string.
 */
function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`)
}

/**
 * Look up org's email template by type. Falls back to null if none found.
 */
async function getOrgTemplate(
  orgId: string,
  type: string,
): Promise<{ subject: string; bodyHtml: string; bodyText: string } | null> {
  try {
    const template = await (prisma as any).emailTemplate.findFirst({
      where: { organizationId: orgId, type, isActive: true },
      orderBy: { isDefault: 'desc' },
    })
    if (!template) return null
    return {
      subject: template.subject,
      bodyHtml: template.bodyHtml || '',
      bodyText: template.bodyText || '',
    }
  } catch {
    // If EmailTemplate table doesn't exist yet, return null (use fallback)
    return null
  }
}

// ─── Invoice email ────────────────────────────────────────────────────────────

export interface SendInvoiceEmailOpts {
  to: string
  cc?: string
  invoiceNumber: string
  customerName: string
  amount: number
  currency?: string
  dueDate: string
  orgName: string
  emailFromName?: string | null
  message?: string
  invoiceUrl?: string
}

export async function sendInvoiceEmail(opts: SendInvoiceEmailOpts & { orgId?: string }): Promise<void> {
  const currency = opts.currency ?? 'IDR'
  const amountFormatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency, minimumFractionDigits: 0 }).format(opts.amount)

  // Try template-based rendering first
  if (opts.orgId) {
    const template = await getOrgTemplate(opts.orgId, 'INVOICE')
    if (template) {
      const vars: Record<string, string> = {
        invoiceNumber: opts.invoiceNumber,
        companyName: opts.orgName,
        customerName: opts.customerName,
        amount: amountFormatted,
        dueDate: opts.dueDate,
        companyEmail: '',
        companyPhone: '',
      }
      const subject = renderTemplate(template.subject, vars)
      const html = renderTemplate(template.bodyHtml, vars)

      const result = await resend.emails.send({
        from: formatFrom(opts.emailFromName),
        to: opts.to,
        ...(opts.cc ? { cc: opts.cc } : {}),
        subject,
        html,
      })
      if (result.error) throw new Error(`Resend error: ${result.error.message}`)
      return
    }
  }

  // Fallback to hardcoded HTML
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px}
    .container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e0e0e0;overflow:hidden}
    .header{background:#1e40af;color:#fff;padding:24px 32px}
    .header h1{margin:0;font-size:20px;font-weight:600}
    .body{padding:32px}
    .info-table{width:100%;border-collapse:collapse;margin:16px 0}
    .info-table td{padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
    .info-table td:first-child{color:#6b7280;width:40%}
    .info-table td:last-child{font-weight:600;color:#111}
    .amount-row td{font-size:18px;border-bottom:2px solid #1e40af!important;padding-bottom:12px!important}
    .cta{display:inline-block;background:#1e40af;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:20px 0;font-size:14px}
    .footer{padding:16px 32px;background:#f9fafb;font-size:12px;color:#9ca3af;border-top:1px solid #f0f0f0}
    p{color:#374151;font-size:14px;line-height:1.6}
  </style></head><body>
  <div class="container">
    <div class="header"><h1>${opts.orgName}</h1><div style="font-size:13px;opacity:0.8;margin-top:4px">Invoice Notification</div></div>
    <div class="body">
      <p>Dear ${opts.customerName},</p>
      ${opts.message ? `<p>${opts.message}</p>` : `<p>Please find below the details of your invoice. Kindly arrange payment before the due date.</p>`}
      <table class="info-table">
        <tr><td>Invoice Number</td><td>${opts.invoiceNumber}</td></tr>
        <tr><td>Due Date</td><td>${opts.dueDate}</td></tr>
        <tr class="amount-row"><td>Amount Due</td><td>${amountFormatted}</td></tr>
      </table>
      ${opts.invoiceUrl ? `<a class="cta" href="${opts.invoiceUrl}">View Invoice</a>` : ''}
      <p>If you have any questions, please contact us.</p>
      <p>Thank you for your business.</p>
    </div>
    <div class="footer">${opts.orgName} · This is an automated email, please do not reply.</div>
  </div></body></html>`

  const result = await resend.emails.send({
    from: formatFrom(opts.emailFromName),
    to: opts.to,
    ...(opts.cc ? { cc: opts.cc } : {}),
    subject: `Invoice ${opts.invoiceNumber} from ${opts.orgName} — Due ${opts.dueDate}`,
    html,
  })
  if (result.error) throw new Error(`Resend error: ${result.error.message}`)
}

// ─── Payment reminder email ───────────────────────────────────────────────────

export interface SendPaymentReminderEmailOpts {
  to: string
  invoiceNumber: string
  customerName: string
  amount: number
  currency?: string
  daysOverdue: number
  orgName: string
  emailFromName?: string | null
}

export async function sendPaymentReminderEmail(opts: SendPaymentReminderEmailOpts & { orgId?: string }): Promise<void> {
  const currency = opts.currency ?? 'IDR'
  const amountFormatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency, minimumFractionDigits: 0 }).format(opts.amount)

  // Try template-based rendering
  if (opts.orgId) {
    const template = await getOrgTemplate(opts.orgId, 'PAYMENT_REMINDER')
    if (template) {
      const vars: Record<string, string> = {
        invoiceNumber: opts.invoiceNumber,
        companyName: opts.orgName,
        customerName: opts.customerName,
        amount: amountFormatted,
        daysOverdue: String(opts.daysOverdue),
        dueDate: '',
      }
      const subject = renderTemplate(template.subject, vars)
      const html = renderTemplate(template.bodyHtml, vars)

      const result = await resend.emails.send({
        from: formatFrom(opts.emailFromName),
        to: opts.to,
        subject,
        html,
      })
      if (result.error) throw new Error(`Resend error: ${result.error.message}`)
      return
    }
  }

  // Fallback to hardcoded HTML
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px}
    .container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e0e0e0;overflow:hidden}
    .header{background:#dc2626;color:#fff;padding:24px 32px}
    .header h1{margin:0;font-size:20px;font-weight:600}
    .body{padding:32px}
    .overdue-badge{display:inline-block;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:16px}
    .info-table{width:100%;border-collapse:collapse;margin:16px 0}
    .info-table td{padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
    .info-table td:first-child{color:#6b7280;width:40%}
    .info-table td:last-child{font-weight:600;color:#111}
    .footer{padding:16px 32px;background:#f9fafb;font-size:12px;color:#9ca3af;border-top:1px solid #f0f0f0}
    p{color:#374151;font-size:14px;line-height:1.6}
  </style></head><body>
  <div class="container">
    <div class="header"><h1>${opts.orgName}</h1><div style="font-size:13px;opacity:0.8;margin-top:4px">Payment Reminder</div></div>
    <div class="body">
      <div class="overdue-badge">⚠ ${opts.daysOverdue} Day${opts.daysOverdue !== 1 ? 's' : ''} Overdue</div>
      <p>Dear ${opts.customerName},</p>
      <p>This is a friendly reminder that the following invoice is overdue. Please arrange payment as soon as possible to avoid any late fees.</p>
      <table class="info-table">
        <tr><td>Invoice Number</td><td>${opts.invoiceNumber}</td></tr>
        <tr><td>Days Overdue</td><td style="color:#dc2626">${opts.daysOverdue} days</td></tr>
        <tr><td>Amount Outstanding</td><td style="color:#dc2626;font-size:18px">${amountFormatted}</td></tr>
      </table>
      <p>If payment has already been made, please disregard this notice. If you have any questions, please contact us immediately.</p>
    </div>
    <div class="footer">${opts.orgName} · This is an automated reminder.</div>
  </div></body></html>`

  const result = await resend.emails.send({
    from: formatFrom(opts.emailFromName),
    to: opts.to,
    subject: `REMINDER: Invoice ${opts.invoiceNumber} — ${opts.daysOverdue} days overdue`,
    html,
  })
  if (result.error) throw new Error(`Resend error: ${result.error.message}`)
}

// ─── Purchase Order email ─────────────────────────────────────────────────────

export interface SendPurchaseOrderEmailOpts {
  to: string
  poNumber: string
  vendorName: string
  amount: number
  currency?: string
  orgName: string
  emailFromName?: string | null
  message?: string
  expectedDate?: string
}

export async function sendPurchaseOrderEmail(opts: SendPurchaseOrderEmailOpts & { orgId?: string }): Promise<void> {
  const currency = opts.currency ?? 'IDR'
  const amountFormatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency, minimumFractionDigits: 0 }).format(opts.amount)

  // Try template-based rendering
  if (opts.orgId) {
    const template = await getOrgTemplate(opts.orgId, 'PURCHASE_ORDER')
    if (template) {
      const vars: Record<string, string> = {
        poNumber: opts.poNumber,
        companyName: opts.orgName,
        vendorName: opts.vendorName,
        amount: amountFormatted,
        expectedDate: opts.expectedDate || '',
      }
      const subject = renderTemplate(template.subject, vars)
      const html = renderTemplate(template.bodyHtml, vars)

      const result = await resend.emails.send({
        from: formatFrom(opts.emailFromName),
        to: opts.to,
        subject,
        html,
      })
      if (result.error) throw new Error(`Resend error: ${result.error.message}`)
      return
    }
  }

  // Fallback to hardcoded HTML
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px}
    .container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e0e0e0;overflow:hidden}
    .header{background:#065f46;color:#fff;padding:24px 32px}
    .header h1{margin:0;font-size:20px;font-weight:600}
    .body{padding:32px}
    .info-table{width:100%;border-collapse:collapse;margin:16px 0}
    .info-table td{padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
    .info-table td:first-child{color:#6b7280;width:40%}
    .info-table td:last-child{font-weight:600;color:#111}
    .footer{padding:16px 32px;background:#f9fafb;font-size:12px;color:#9ca3af;border-top:1px solid #f0f0f0}
    p{color:#374151;font-size:14px;line-height:1.6}
  </style></head><body>
  <div class="container">
    <div class="header"><h1>${opts.orgName}</h1><div style="font-size:13px;opacity:0.8;margin-top:4px">Purchase Order</div></div>
    <div class="body">
      <p>Dear ${opts.vendorName},</p>
      ${opts.message ? `<p>${opts.message}</p>` : `<p>Please find below our purchase order details. Kindly confirm receipt and expected delivery date.</p>`}
      <table class="info-table">
        <tr><td>PO Number</td><td>${opts.poNumber}</td></tr>
        ${opts.expectedDate ? `<tr><td>Expected Delivery</td><td>${opts.expectedDate}</td></tr>` : ''}
        <tr><td>Order Value</td><td>${amountFormatted}</td></tr>
      </table>
      <p>Please confirm this order and advise if there are any issues with fulfillment.</p>
      <p>Thank you for your continued partnership.</p>
    </div>
    <div class="footer">${opts.orgName} · This is an automated notification.</div>
  </div></body></html>`

  const result = await resend.emails.send({
    from: formatFrom(opts.emailFromName),
    to: opts.to,
    subject: `Purchase Order ${opts.poNumber} from ${opts.orgName}`,
    html,
  })
  if (result.error) throw new Error(`Resend error: ${result.error.message}`)
}
