import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('resend', () => ({
  Resend: class { emails = { send: (...a: unknown[]) => send(...a) }; },
}));

const findTemplate = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { emailTemplate: { findFirst: (...a: unknown[]) => findTemplate(...a) } },
}));

import { sendInvoiceEmail } from '../email';

const base = {
  to: 'cust@example.com',
  invoiceNumber: 'INV/2026/09/1',
  customerName: 'Shopee Cultusia',
  amount: 109890,
  dueDate: '2026-09-18',
  orgName: 'PT Demo',
};

const pdf = { filename: 'Invoice_1.pdf', content: Buffer.from('%PDF-1.4 test') };

beforeEach(() => {
  send.mockReset();
  findTemplate.mockReset();
  send.mockResolvedValue({ data: { id: 'e1' }, error: null });
  findTemplate.mockResolvedValue(null);
});

describe('sendInvoiceEmail', () => {
  it('attaches the PDF to the built-in message', async () => {
    await sendInvoiceEmail({ ...base, attachments: [pdf] });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].attachments).toEqual([pdf]);
  });

  it('omits the attachments key when there is no PDF', async () => {
    await sendInvoiceEmail(base);
    expect(send.mock.calls[0][0]).not.toHaveProperty('attachments');
  });

  it('escapes the sender note so it cannot inject markup', async () => {
    await sendInvoiceEmail({ ...base, message: '<script>alert(1)</script>\nthanks & regards' });
    const html: string = send.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>thanks &amp; regards');
  });

  it('uses the organisation template when orgId is given, with the note and PDF', async () => {
    findTemplate.mockResolvedValue({
      subject: 'Invoice {{invoiceNumber}} from {{companyName}}',
      bodyHtml: '<p>Hi {{customerName}}, total {{amount}}</p>',
      bodyText: '',
    });
    await sendInvoiceEmail({ ...base, orgId: 'org1', message: 'Please pay <soon>', attachments: [pdf] });
    const sent = send.mock.calls[0][0];
    expect(sent.subject).toBe('Invoice INV/2026/09/1 from PT Demo');
    expect(sent.html).toContain('Hi Shopee Cultusia');
    expect(sent.html.startsWith('<p>Please pay &lt;soon&gt;</p>')).toBe(true);
    expect(sent.attachments).toEqual([pdf]);
  });

  it('falls back to the built-in message when the org has no template', async () => {
    await sendInvoiceEmail({ ...base, orgId: 'org1' });
    expect(send.mock.calls[0][0].subject).toContain('Invoice INV/2026/09/1 from PT Demo');
  });

  it('throws when the provider reports an error', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'bad key' } });
    await expect(sendInvoiceEmail(base)).rejects.toThrow('Resend error: bad key');
  });
});
