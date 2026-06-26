# Email Invoice (with PDF attachment) — Design Spec

- **Date:** 2026-06-26
- **Status:** Approved (pending spec review)
- **Scope:** Sales Invoices only. Follow-up to the AR print improvement (PR #67).

## 1. Background — what already exists

- **Backend email sending is live** via **Resend** (`lib/email.ts`): `sendInvoiceEmail()` renders an HTML email (org `EmailTemplate` of type `INVOICE`, or a hardcoded fallback) and sends through `resend.emails.send(...)`.
- **Endpoint exists:** `POST /api/v1/invoices/[id]/send-email` accepts `{ to, cc?, message? }`, requires `AR_INVOICES.edit`, finalizes `DRAFT → SENT` (or `PENDING_APPROVAL`) through the approval engine, and writes an `EMAIL_SENT` audit log.
- **Frontend hook exists but is unused:** `useSendInvoiceEmail()` (`src/hooks/useAR.ts`) POSTs `{ invoiceId, to, cc, message }`. **No UI calls it** (`onEmail` is never wired).
- **Gaps this spec closes:** (1) no UI to trigger the send; (2) the email has **no PDF attachment** (HTML only); (3) the route does **not pass `orgId`**, so the org's custom `EmailTemplate` is never used (always the fallback); (4) `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS` are not configured or documented.
- **Client-side PDF exists:** `src/utils/downloadPdf.ts` (`downloadElementAsPdf`) rasterizes a DOM element via `html-to-image` → `jsPDF`. The `InvoicePrintTemplate` is the faktur layout.

## 2. Decision (locked)

**The app sends the email itself, server-side via Resend, with the faktur PDF attached automatically — one click, no email-client login.** A web `mailto:`/Gmail-compose approach was rejected because browsers cannot pre-attach a file, which defeats the goal. Email goes out from the configured Resend sender; this needs `RESEND_API_KEY` (+ optional verified domain) set up once. Until then the feature degrades gracefully with a clear "email not configured" message.

## 3. Goals

1. A **"Send via Email"** action on the invoice surfaces that opens a modal to send the invoice to the customer.
2. The **faktur PDF is attached automatically** (generated client-side from `InvoicePrintTemplate`).
3. Reuse the existing Resend send path; **fix it to use the org's email template** (pass `orgId`).
4. Graceful, clear behavior when `RESEND_API_KEY` is not configured.

## 4. Detailed design

### 4.1 Shared PDF helper (DRY)
Refactor `src/utils/downloadPdf.ts` so the rasterization core is shared:
- Extract `renderElementToPdf(el, paperSize): Promise<jsPDF>` (current logic of `downloadElementAsPdf`).
- `downloadElementAsPdf(...)` calls it then `.save(...)` (unchanged behavior/signature).
- Add `elementToPdfBase64(el, paperSize): Promise<string>` → returns the **raw base64** (strip the `data:application/pdf;...;base64,` prefix from `pdf.output('datauristring')`). Used by the email modal.

### 4.2 `SendInvoiceEmailModal` (new component)
`src/components/ar/invoices/SendInvoiceEmailModal.tsx`. Props: `isOpen`, `onClose`, `invoice`, `lineItems`, `company`, `printSettings`, `taxRate`, `customerEmail`.
- Renders `InvoicePrintTemplate` in a **hidden offscreen container** (`position:absolute; left:-99999px; width:210mm`) via a ref, so it can be rasterized.
- Form fields: **To** (prefilled from `customerEmail`, required, must contain `@`), **Cc** (optional), **Message** (optional, maps to the template `{{message}}`/fallback paragraph), **Attach faktur PDF** checkbox (default **on**).
- A muted note: "Sending will mark this invoice as Sent."
- **Send:** if attach is on, `elementToPdfBase64(hiddenRef.current, printSettings.defaultPaperSize)`; call `useSendInvoiceEmail` with `{ invoiceId, to, cc, message, attachmentBase64?, attachmentName? }` where `attachmentName = \`Invoice_${invoice.number}.pdf\``. On success → toast + `invalidateQueries` for invoices (status may have changed) + close. On error → show the server message inline; if it indicates the key is missing, show "Email isn't configured yet — set RESEND_API_KEY." If PDF rasterization throws, send HTML-only and warn.
- Disable Send while in flight.

### 4.3 Frontend hook
Extend `useSendInvoiceEmail()` (`src/hooks/useAR.ts`) to accept and forward `attachmentBase64?` and `attachmentName?` in the POST body.

### 4.4 Backend — route
`src/app/api/v1/invoices/[id]/send-email/route.ts`:
- Read `attachmentBase64?` and `attachmentName?` from the body (alongside `to`, `cc`, `message`).
- Validate: if `attachmentBase64` is present, enforce a size cap (decoded ≤ ~5 MB) → `400` if exceeded.
- **Pass `orgId`** to `sendInvoiceEmail(...)` so the org template is used.
- Pass `attachment: { filename: attachmentName ?? \`Invoice_${invoice.number}.pdf\`, contentBase64: attachmentBase64 }` when present.
- Existing draft-finalization + `EMAIL_SENT` audit log unchanged.

### 4.5 Backend — sender
`lib/email.ts`:
- Extend `SendInvoiceEmailOpts` with `attachment?: { filename: string; contentBase64: string }`.
- In **both** the template path and the fallback path, when `opts.attachment` is set, add to the Resend call: `attachments: [{ filename: opts.attachment.filename, content: Buffer.from(opts.attachment.contentBase64, 'base64') }]`.

### 4.6 Entry points
Add a **"Send via Email"** button (icon: `Send`) that opens `SendInvoiceEmailModal`, on:
- **Invoice workbench detail** (`InvoiceDetailTabs` / `InvoiceWorkbench`), next to Print, gated by `AR_INVOICES.edit` (the endpoint's permission). Pass the active invoice + its lines + company/printSettings/taxRate + `customer.email`.
- **Invoice form** (`InvoiceForm`) action bar, reusing the `printInvoice`/`formData.items` it already builds for the print modal, with the recipient prefilled from the selected customer's email. **Gated to saved invoices only:** the send endpoint requires an existing invoice id, so the button is enabled only when `editingInvoiceId` is set; on a brand-new unsaved invoice it is disabled with a "Save the invoice first" hint.

### 4.7 Config
Add to `.env.example` with comments:
```
# Email sending (Resend) — required for "Send via Email"
RESEND_API_KEY="re_your_key_here"
EMAIL_FROM_ADDRESS="invoice@yourdomain.com"
```
No code reads new env beyond what `lib/email.ts` already uses. Document the one-time setup in the PR description.

## 5. Error handling

- Empty/invalid `to` → blocked client-side and `400` server-side.
- Oversize attachment → `400` with a clear message.
- Resend failure (incl. missing/invalid key) → `502` with the provider message; modal shows a friendly variant for the unconfigured case.
- PDF rasterization failure → fall back to sending **without** the attachment, and warn the user the PDF couldn't be attached.

## 6. Testing

- **Unit:** `elementToPdfBase64` returns a non-empty base64 string with no data-URI prefix (mock `html-to-image`/`jsPDF` output); the route's attachment size-guard + `to` validation (decode + threshold logic as a pure helper).
- **Manual e2e:** with `RESEND_API_KEY` set, send a test invoice to a real inbox; confirm the faktur PDF arrives attached and the invoice flips to `Sent`. Without the key, confirm the friendly "not configured" message.

## 7. Files touched

**New**
- `src/components/ar/invoices/SendInvoiceEmailModal.tsx`

**Modified**
- `src/utils/downloadPdf.ts` — extract `renderElementToPdf`, add `elementToPdfBase64`
- `src/hooks/useAR.ts` — `useSendInvoiceEmail` accepts attachment fields
- `src/app/api/v1/invoices/[id]/send-email/route.ts` — accept attachment, pass `orgId`, size guard
- `lib/email.ts` — `SendInvoiceEmailOpts.attachment` + Resend `attachments`
- `src/views/ar/InvoiceWorkbench.tsx` (+ `InvoiceDetailTabs`) — Send via Email button + modal
- `src/views/ar/InvoiceForm.tsx` — Send via Email button + modal
- `.env.example` — document `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS`

## 8. Out of scope

WhatsApp share; SO/PO email; bulk or scheduled sending; in-app Resend key management UI (key stays in server env); changing the email template content (uses the existing `EmailTemplate`/fallback).

## 9. Rollout & risk

- **No schema migration.** No Prisma changes.
- Sending **finalizes a draft invoice** (existing endpoint behavior) — surfaced in the modal so it isn't a surprise.
- Attachment travels as base64 JSON (~hundreds of KB typical, capped ~5 MB) — well within limits.
- Dormant-safe: with no `RESEND_API_KEY`, the button is present but reports it's not configured; nothing else changes.
