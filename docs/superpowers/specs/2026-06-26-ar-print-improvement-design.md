# AR Print Improvement — Design Spec

- **Date:** 2026-06-26
- **Status:** Approved (pending spec review)
- **Scope:** Accounts Receivable documents first (Invoice, Sales Order, AR Payment/Receipt, Credit Note, Sales Return, Delivery Note). AP and other modules inherit shared benefits but are not redesigned here.

## 1. Background — current state

The app already has a modern print foundation:

- `PrintPreviewModal` (`src/components/UI/PrintPreviewModal.tsx`) — wraps `react-to-print`, offers A4/A5, remembers paper choice in `localStorage`, injects `@page`.
- Reusable templates in `src/components/print/` and shared blocks in `printShared.tsx` (`CompanyBlock`, `Letterhead`, `DocumentFooter`, `SignatureBlock`), all styled with **inline `React.CSSProperties`** (hex/rgb colors, not Tailwind classes).
- `PrintOptions` stored per book in `Organization.printSettings` (a `Json?` column); company identity stored in `Organization` columns (`displayName`, `address`, `npwp`, `phone`, `companyEmail`, `logoUrl`). Both load/save via `GET/PUT /api/v1/organization/settings`, scoped to the active book by the `x-org-id` header. React Query layer: `useOrganizationSettings()` / `useUpdateOrganizationSettings()`.
- Settings page (`src/views/settings/Settings.tsx`) already has a **Company Info** tab (name, address, NPWP, phone, email, logo URL, timezone, locale, tax) and a **Print Settings** tab (accent color, density, paper, logo/letterhead/unit/discount/signature toggles, terms, footer, live preview).

**Maturity is inconsistent across AR:**

| Document | Today | Verdict |
|---|---|---|
| Invoice | raw `window.print()`, no preview/paper/branding | weakest |
| Sales Order | raw `window.print()` A4/A5 menu items, no preview | basic |
| Credit Note / Sales Return | full `PrintPreviewModal` + settings | mature |
| Delivery Note | full flow, **list view only** | partial |
| AR Payment / Receipt | full flow, **list view only** (no print from the form) | partial |
| PDF export / share | none (`jspdf` installed but unused) | missing |

## 2. Goals

1. **Consistency** — every AR document prints through the same `PrintPreviewModal` flow (live preview, paper size, density, branding). Fix Invoice and Sales Order; add print to the AR Payment form.
2. **One-click PDF** — a "Download PDF" action available on every AR document, producing a file ready to email / send over WhatsApp.
3. **Invoice as a proper Indonesian *faktur*** — letterhead + NPWP, Satuan column, DP/Sisa Tagihan, Terbilang, bank/payment block, signature/stamp.
4. **Per-book branding settings** — a single Settings tab holding all document-look controls (logo upload, bank/payment, toggles, accent, density, paper, terms, footer, signature), remembered separately for each book.

## 3. Decisions locked (from brainstorming)

- **PDF generation:** client-side **image** PDF (`html-to-image` → `jsPDF`). Rationale: zero backend/infra, works offline, output matches the on-screen preview exactly, fine for WhatsApp/email. Trade-off accepted: text is not selectable and files are larger. (Selectable-text / server-rendered PDF is explicitly deferred.)
- **Logo:** in-app **image upload**, stored as a base64 data URL in the existing `logoUrl` field (no new file-storage service). Embedding also avoids cross-origin "tainted canvas" failures during capture.
- **Book switcher:** **out of scope.** Switching books still happens via log out / log in. Branding resolves correctly per book regardless.
- **Settings layout:** **one consolidated tab** for all document-look controls (the existing "Print Settings" tab, relabeled **"Print & Branding"**). Company identity stays in the Company Info tab.
- **No Prisma migration:** new settings ride the existing `printSettings` JSON bag and `logoUrl` string. No schema change, no `prisma db push` at merge.

## 4. Detailed design

### 4.1 Shared one-click PDF (biggest reuse win)

- New util `src/utils/downloadPdf.ts`: `downloadElementAsPdf(el, { filename, paperSize })`.
  - Uses `html-to-image` (`toCanvas`/`toPng`) to rasterize the print container, then `jsPDF` to place the image on an A4 or A5 page.
  - **Multi-page:** if the captured image is taller than one page, slice it into page-height bands and add pages so long documents don't get cut off.
  - Filename comes from a new `docName` prop (e.g. `INV-2026-0184.pdf`).
- Extend `PrintPreviewModal` with a **"Download PDF"** button next to Print and a `docName?: string` prop. The modal already owns the `printRef` container and paper size, so this is the single integration point.
- **Free benefit:** every document already using `PrintPreviewModal` (Credit Note, Sales Return, Delivery Note, AR Payment, plus AP Bill/PO/Debit Note) gains Download-PDF with no per-document work.

### 4.2 Consistency migration

- **Invoice** (`src/views/ar/InvoiceForm.tsx`): remove raw `window.print()`; add `isPrintOpen` state and wrap `InvoicePrintTemplate` in `PrintPreviewModal` (reading `printSettings` + company identity). Wire the existing Print button (detail tab / action bar) to open the modal.
- **Sales Order** (`src/views/ar/SOFormV2.tsx`): replace the two `window.print()` A4/A5 menu items with a single Print action that opens `PrintPreviewModal` wrapping `SalesOrderPrintTemplate` (paper size lives in the modal).
- **AR Payment** (`src/views/ar/PaymentForm.tsx`): add a Print button + `PrintPreviewModal` wrapping `PaymentReceiptPrintTemplate direction="in"`, mirroring the existing `Payments.tsx` list-view pattern.
- Outcome: all six AR documents share one print path, one preview, and the Print + Download PDF buttons.

### 4.3 Invoice faktur template (`src/components/print/InvoicePrintTemplate.tsx`)

Rebuilt using existing `printShared.tsx` blocks; each new element is toggle- or data-gated:

- **Letterhead** — `Letterhead` + `CompanyBlock`: logo, company name, address, phone, **NPWP**, accent band. (Identity sourced from Company Info; see §4.5.)
- **Satuan (unit) column** — gated by existing `showUnitColumn`.
- **Totals** — Subtotal, DPP, PPN 11%, Total; plus **DP / Uang Muka** and **Sisa Tagihan** rows shown **only when** the invoice has a down-payment / partial payment recorded (conditional on data — fully-paid or no-DP invoices omit these rows).
- **Terbilang** — total spelled out in Bahasa via `src/utils/terbilang.ts`; gated by new `showTerbilang`.
- **Bank / payment block** — bank, account no., account name, optional note; gated by new `showBankDetails` AND non-empty bank fields.
- **Signature + stamp** — existing `SignatureBlock` ("Hormat kami"), gated by existing `showSignature`.

Shared sub-components `BankBlock` and `TerbilangLine` are added to `printShared.tsx` so SO/receipt/notes can reuse them later.

### 4.4 Per-book branding settings (data + UI)

**Data (no migration):** extend the `PrintOptions` type (persisted inside `printSettings` JSON) with:

```
bankName: string
bankAccountNo: string
bankAccountName: string
paymentNote: string
showBankDetails: boolean   // default true
showTerbilang: boolean     // default true
```

Update `DEFAULT_PRINT_OPTIONS` and the normalizers in `useOrganizationSettings.ts` (`normalizePrintSettings`) to include the new keys with defaults so older records stay valid.

**UI (`src/views/settings/Settings.tsx`):** relabel the "Print Settings" tab to **"Print & Branding"** and add:

- **Logo uploader** — file input (PNG/JPG), reads the file to a base64 data URL, previews it, saves to `logoUrl`. The paste-a-URL field remains as a fallback. Validation: image MIME type + ~500 KB size cap (since it is embedded in the settings record); warn if larger.
- **Bank / Payment subsection** — four inputs (bank, account no., account name, payment note).
- **Two toggles** — show bank block, show terbilang.
- The tab's existing **live preview** extends to render the bank block and terbilang.

All controls save through the existing `useUpdateOrganizationSettings()` mutation, which is already org-scoped — so everything is automatically per book.

### 4.5 Data sourcing (which tab feeds the printout)

- **Company Info tab** → identity: company name, address, NPWP, phone, email. Used app-wide; printout reads it for the letterhead.
- **Print & Branding tab** → document-look: logo, bank/payment, accent, density, paper, block toggles, terms, footer, signature label/name.
- The printed document stitches both together at render time.

### 4.6 Terbilang util (`src/utils/terbilang.ts`)

- `terbilang(amount: number): string` → Indonesian words + `"rupiah"` (e.g. `1.743.920 → "satu juta tujuh ratus empat puluh tiga ribu sembilan ratus dua puluh rupiah"`).
- Handles satuan / belasan / puluhan / ratusan / ribuan / jutaan / miliaran / triliunan, the "seribu" vs "satu ribu" special case, and rounds to whole rupiah.
- Built test-first (see §6).

## 5. Error handling

- **PDF capture failure** (e.g. rasterization error): catch, show a toast, and fall back to the browser print dialog so the user is never blocked.
- **Logo upload:** reject non-image types; warn when file exceeds the size cap before embedding.
- **Terbilang:** guard non-finite / negative input (use absolute value, or empty string for invalid) so the template never throws.
- **Missing bank fields:** the bank block hides itself even when `showBankDetails` is true, to avoid an empty box.

## 6. Testing

- **Unit (test-first):**
  - `terbilang.ts` — wide coverage across every magnitude band, the seribu special case, zero, and rounding.
  - `downloadPdf.ts` — the page-slicing math helper (how many pages, band heights) as a pure function, unit-tested independently of canvas.
- **Manual / preview verification:** for each AR document, confirm the preview shows correct per-book branding and that Download PDF produces a correct file; confirm settings round-trip and that two different books show different branding.

## 7. Files touched

**New**
- `src/utils/downloadPdf.ts` (+ test)
- `src/utils/terbilang.ts` (+ test)

**Modified**
- `src/components/UI/PrintPreviewModal.tsx` — Download PDF button + `docName` prop
- `src/components/print/InvoicePrintTemplate.tsx` — faktur upgrade
- `src/components/print/printShared.tsx` — add `BankBlock`, `TerbilangLine`
- `src/views/ar/InvoiceForm.tsx`, `SOFormV2.tsx`, `PaymentForm.tsx` — modal wiring
- `src/types/index.ts` — extend `PrintOptions` + `DEFAULT_PRINT_OPTIONS`
- `src/views/settings/Settings.tsx` — relabel tab, logo uploader, bank fields, toggles, preview
- `src/hooks/useOrganizationSettings.ts` — normalize new fields

## 8. Dependencies

- Add **`html-to-image`** (modern-CSS-safe rasterization for Tailwind v4; matches preview via browser rendering).
- Reuse existing `jspdf` and `react-to-print`. `html2canvas` is intentionally **not** added (cannot parse `oklch()` colors emitted by Tailwind v4).

## 9. Out of scope

- In-app book switcher (separate, touches auth/session).
- Selectable-text / server-rendered (headless-Chrome) PDF.
- Email / WhatsApp **send** integration (download only; a "Share" action can come later).
- AP template redesign (AP still gains Download-PDF + branding for free via the shared modal/settings).
- Any new Settings tab beyond relabeling "Print Settings" → "Print & Branding".

## 10. Rollout & risk

- **Low risk:** no schema migration; changes are additive; every new invoice element is toggle- or data-gated, so existing prints are unaffected until a book opts in.
- New settings keys default to sensible values; the bank block and DP/Sisa rows stay hidden until there is data to show.
- Implementation order: (1) shared PDF in `PrintPreviewModal`, (2) consistency migration, (3) settings data + UI, (4) invoice faktur template + terbilang. This front-loads the broadest-benefit change and lets each step be verified before the next.
