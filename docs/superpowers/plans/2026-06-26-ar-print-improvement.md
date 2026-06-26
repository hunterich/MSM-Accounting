# AR Print Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every AR document a one-click "Download PDF", upgrade the invoice to a proper Indonesian faktur (NPWP, DP/Sisa, Terbilang, bank block), and add the per-book branding fields (bank, logo upload, toggles) that feed it.

**Architecture:** All AR documents already render through a shared `PrintPreviewModal` + per-document print templates, with branding read from the active book's `printSettings` (a JSON bag) and `companyInfo`. We extend that shared modal with client-side PDF export (`html-to-image` → `jsPDF`), add new keys to the `printSettings` bag (no DB migration), reuse the existing `terbilang` formatter, and surface the new controls in the existing Settings "Print Settings" tab (relabeled "Print & Branding").

**Tech Stack:** React 19 + TypeScript + Vite, Zustand (`useSettingsStore`), React Query (`useOrganizationSettings`), `react-to-print` v3, `jspdf` v4, `html-to-image` (new), Vitest.

---

## Reality notes (verified against the codebase)

- **`terbilang` already exists** at `src/utils/formatters` (used by `PaymentReceiptPrintTemplate`). We reuse it — no new util.
- **Invoice & Sales Order workbenches already use `PrintPreviewModal`** (`InvoiceWorkbench.tsx:267`, `SalesOrderWorkbench.tsx:263`), as do AR `Payments.tsx:377`, `CreditNoteForm.tsx:625`, `SalesReturnForm.tsx`. So "consistency" is mostly already true; the remaining raw `window.print()` is in `InvoiceForm.tsx:522` (Task 7).
- **No Prisma migration:** `Organization.printSettings` is `Json?`; the normalizer at `useOrganizationSettings.ts:56` merges `{ ...DEFAULT_PRINT_OPTIONS, ...raw.printSettings }`, so new keys appear automatically once added to `DEFAULT_PRINT_OPTIONS`.
- **Out of scope / deferred (documented, not placeholders):** `PaymentForm.tsx` form-level print (the AR `Payments` list/detail already prints receipts via the modal); book switcher; selectable-text/server PDF; email/WhatsApp send.

---

## Task 1: PDF export utility (`html-to-image` + `jsPDF`)

**Files:**
- Create: `src/utils/downloadPdf.ts`
- Test: `src/utils/__tests__/downloadPdf.test.ts`
- Modify: `package.json` (adds `html-to-image` dependency)

- [ ] **Step 1: Install the dependency**

Run: `npm install html-to-image`
Expected: `package.json` gains `"html-to-image"` under `dependencies`; install completes without errors.

- [ ] **Step 2: Write the failing test for the two pure helpers**

Create `src/utils/__tests__/downloadPdf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pdfPageOffsets, sanitizePdfName } from '../downloadPdf';

describe('pdfPageOffsets', () => {
  it('returns a single offset when content fits one page', () => {
    expect(pdfPageOffsets(100, 297)).toEqual([0]);
  });
  it('treats an exact page height as one page', () => {
    expect(pdfPageOffsets(297, 297)).toEqual([0]);
  });
  it('adds a second page when content is just over one page', () => {
    expect(pdfPageOffsets(298, 297)).toEqual([0, -297]);
  });
  it('splits tall content into N negative offsets', () => {
    expect(pdfPageOffsets(600, 297)).toEqual([0, -297, -594]);
  });
  it('never returns an empty list for zero/negative input', () => {
    expect(pdfPageOffsets(0, 297)).toEqual([0]);
    expect(pdfPageOffsets(-5, 297)).toEqual([0]);
  });
});

describe('sanitizePdfName', () => {
  it('appends .pdf to a clean title', () => {
    expect(sanitizePdfName('Invoice_INV-2026-00001')).toBe('Invoice_INV-2026-00001.pdf');
  });
  it('replaces filesystem-unsafe characters', () => {
    expect(sanitizePdfName('a/b:c?')).toBe('a_b_c_.pdf');
  });
  it('collapses whitespace to underscores', () => {
    expect(sanitizePdfName('  hello world ')).toBe('hello_world.pdf');
  });
  it('falls back to "document" when empty or missing', () => {
    expect(sanitizePdfName('')).toBe('document.pdf');
    expect(sanitizePdfName(undefined)).toBe('document.pdf');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/utils/__tests__/downloadPdf.test.ts`
Expected: FAIL — cannot resolve `../downloadPdf` / functions not defined.

- [ ] **Step 4: Implement `src/utils/downloadPdf.ts`**

```ts
import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';

export type PaperSize = 'A4' | 'A5';

/**
 * Y-offsets (in mm) for placing one tall image across multiple PDF pages.
 * First page sits at 0; each subsequent page shifts the image up by one page height.
 */
export function pdfPageOffsets(totalMm: number, pageMm: number): number[] {
    if (!(totalMm > 0) || !(pageMm > 0)) return [0];
    const pages = Math.max(1, Math.ceil(totalMm / pageMm));
    return Array.from({ length: pages }, (_, i) => -(i * pageMm));
}

/** Turn a document title into a safe `.pdf` filename. */
export function sanitizePdfName(title?: string): string {
    const base = (title || 'document')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_');
    return `${base || 'document'}.pdf`;
}

/**
 * Rasterize a DOM element and save it as an A4/A5 PDF (image-based, multi-page).
 * Renders via the browser (html-to-image), so it matches the on-screen preview
 * and tolerates modern CSS (Tailwind v4 oklch) that html2canvas cannot parse.
 */
export async function downloadElementAsPdf(
    el: HTMLElement,
    opts: { documentTitle?: string; paperSize?: PaperSize },
): Promise<void> {
    const format = opts.paperSize === 'A5' ? 'a5' : 'a4';
    const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
    const pdf = new jsPDF({ unit: 'mm', format, orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;
    const imgData = canvas.toDataURL('image/png');
    pdfPageOffsets(imgH, pageH).forEach((y, i) => {
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, y, pageW, imgH);
    });
    pdf.save(sanitizePdfName(opts.documentTitle));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/utils/__tests__/downloadPdf.test.ts`
Expected: PASS — all 9 assertions green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/utils/downloadPdf.ts src/utils/__tests__/downloadPdf.test.ts
git commit -m "feat(print): add client-side PDF export utility"
```

---

## Task 2: "Download PDF" button in `PrintPreviewModal`

**Files:**
- Modify: `src/components/UI/PrintPreviewModal.tsx`

- [ ] **Step 1: Add imports**

Replace the import block at the top (lines 1-4):

```tsx
import React, { useRef, useEffect, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { X, Printer } from 'lucide-react';
import Button from './Button';
```

with:

```tsx
import React, { useRef, useEffect, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { X, Printer, Download } from 'lucide-react';
import Button from './Button';
import { downloadElementAsPdf } from '../../utils/downloadPdf';
```

- [ ] **Step 2: Add export state + handler**

Immediately after the `changePaperSize` function (after line 54), add:

```tsx
    const [isExporting, setIsExporting] = useState(false);

    const handleDownloadPdf = async () => {
        if (!printRef.current) return;
        setIsExporting(true);
        try {
            await downloadElementAsPdf(printRef.current, { documentTitle, paperSize });
        } catch (err) {
            console.error('PDF export failed', err);
            window.alert('Could not generate the PDF. Opening the print dialog instead — choose "Save as PDF" there.');
            handlePrint();
        } finally {
            setIsExporting(false);
        }
    };
```

- [ ] **Step 3: Add the button to the header**

Find the Cancel button (lines 93-97):

```tsx
                        <Button
                            text="Cancel"
                            variant="secondary"
                            onClick={onClose}
                        />
```

Insert directly **after** it (before the "Print Document" button):

```tsx
                        <Button
                            text={isExporting ? 'Preparing…' : 'Download PDF'}
                            variant="secondary"
                            icon={<Download size={16} />}
                            onClick={handleDownloadPdf}
                            disabled={isExporting}
                        />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors in `PrintPreviewModal.tsx` (pre-existing unrelated errors elsewhere, if any, are not introduced by this change).

- [ ] **Step 5: Commit**

```bash
git add src/components/UI/PrintPreviewModal.tsx
git commit -m "feat(print): add Download PDF action to print preview modal"
```

---

## Task 3: Extend `PrintOptions` with bank + new toggles

**Files:**
- Modify: `src/types/index.ts:222-250`

- [ ] **Step 1: Add fields to the `PrintOptions` interface**

Find (lines 232-234):

```ts
  showSignature: boolean;
  signatureLabel: string;
  signerName: string;
}
```

Replace with:

```ts
  showSignature: boolean;
  signatureLabel: string;
  signerName: string;
  showTerbilang: boolean;
  showBankDetails: boolean;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  paymentNote: string;
}
```

- [ ] **Step 2: Add matching defaults**

Find (lines 247-250):

```ts
  showSignature: false,
  signatureLabel: '',
  signerName: '',
};
```

Replace with:

```ts
  showSignature: false,
  signatureLabel: '',
  signerName: '',
  showTerbilang: true,
  showBankDetails: true,
  bankName: '',
  bankAccountNo: '',
  bankAccountName: '',
  paymentNote: '',
};
```

- [ ] **Step 3: Verify the normalizer needs no change**

Open `src/hooks/useOrganizationSettings.ts:56` and confirm the line reads:

```ts
    printSettings: { ...DEFAULT_PRINT_OPTIONS, ...(raw.printSettings || {}) },
```

No edit needed — new keys default in automatically. (This step is a read-only verification.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — note the next tasks will consume these fields; no consumer is broken by adding optional-defaulted keys.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(print): add bank + terbilang fields to PrintOptions"
```

---

## Task 4: `BankBlock` + `TerbilangLine` in `printShared`

**Files:**
- Modify: `src/components/print/printShared.tsx`

- [ ] **Step 1: Add the `terbilang` import**

Find the top imports (lines 1-2):

```tsx
import React from 'react';
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from '../../types';
```

Replace with:

```tsx
import React from 'react';
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from '../../types';
import { terbilang } from '../../utils/formatters';
```

- [ ] **Step 2: Append the two new components at the end of the file**

After the closing of `SignatureBlock` (after line 141), add:

```tsx

/** Amount-in-words line (Bahasa Indonesia), shown when enabled. */
export const TerbilangLine: React.FC<{ amount: number; options?: PrintOptions }> = ({ amount, options = DEFAULT_PRINT_OPTIONS }) => {
    if (!options.showTerbilang) return null;
    return (
        <div style={{ margin: '10px 0', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '8px 10px', fontStyle: 'italic', color: '#374151' }}>
            <strong style={{ fontStyle: 'normal' }}>Terbilang:</strong> {terbilang(amount)}
        </div>
    );
};

/** Bank / payment-instruction block. Hides itself when no bank is configured. */
export const BankBlock: React.FC<{ options?: PrintOptions }> = ({ options = DEFAULT_PRINT_OPTIONS }) => {
    if (!options.showBankDetails || !options.bankName) return null;
    return (
        <div style={{ marginTop: '12px' }}>
            <div style={{ textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.05em', color: '#9ca3af', marginBottom: '2px' }}>Pembayaran ke</div>
            <div>{[options.bankName, options.bankAccountNo].filter(Boolean).join(' · ')}</div>
            {options.bankAccountName ? <div>a.n. {options.bankAccountName}</div> : null}
            {options.paymentNote ? <div style={{ color: '#6b7280', marginTop: '4px' }}>{options.paymentNote}</div> : null}
        </div>
    );
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/print/printShared.tsx
git commit -m "feat(print): add BankBlock and TerbilangLine shared components"
```

---

## Task 5: Upgrade `InvoicePrintTemplate` to a faktur

**Files:**
- Modify: `src/components/print/InvoicePrintTemplate.tsx`

- [ ] **Step 1: Import the new shared blocks**

Find (lines 3-7):

```tsx
import {
    CompanyBlock, Letterhead, DocumentFooter, SignatureBlock,
    pageStyle, cellStyle, cellRightStyle, titleStyle, tableHeadCellStyle, totalAccent,
    DEFAULT_PRINT_OPTIONS, type PrintOptions,
} from './printShared';
```

Replace with:

```tsx
import {
    CompanyBlock, Letterhead, DocumentFooter, SignatureBlock, BankBlock, TerbilangLine,
    pageStyle, cellStyle, cellRightStyle, titleStyle, tableHeadCellStyle, totalAccent,
    DEFAULT_PRINT_OPTIONS, type PrintOptions,
} from './printShared';
```

- [ ] **Step 2: Compute down-payment / remaining after the totals math**

Find (lines 112-114):

```tsx
    const safeTaxRate = toNumber(taxRate);
    const taxAmount = subtotal * (safeTaxRate / 100);
    const totalAmount = subtotal + taxAmount;
```

Replace with:

```tsx
    const safeTaxRate = toNumber(taxRate);
    const taxAmount = subtotal * (safeTaxRate / 100);
    const totalAmount = subtotal + taxAmount;

    // Down-payment / partial settlement, read defensively (field name varies by record).
    const paid = toNumber(invoice.amountPaid ?? invoice.paidAmount ?? invoice.paid ?? invoice.downPayment ?? invoice.dp);
    const showDp = paid > 0 && paid < totalAmount;
    const remaining = totalAmount - paid;
```

- [ ] **Step 3: Replace the totals block with DPP + DP/Sisa rows**

Find the totals block (lines 178-191):

```tsx
            <div style={{ marginLeft: 'auto', width: '320px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>Subtotal</span>
                    <strong>{formatIDR(subtotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>PPN {safeTaxRate}%</span>
                    <strong>{formatIDR(taxAmount)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: `2px solid ${totalAccent(options)}`, fontSize: '14px', color: totalAccent(options) }}>
                    <span>TOTAL</span>
                    <strong>{formatIDR(totalAmount)}</strong>
                </div>
            </div>
```

Replace with:

```tsx
            <div style={{ marginLeft: 'auto', width: '320px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>Subtotal</span>
                    <strong>{formatIDR(subtotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>DPP</span>
                    <strong>{formatIDR(subtotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>PPN {safeTaxRate}%</span>
                    <strong>{formatIDR(taxAmount)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: `2px solid ${totalAccent(options)}`, fontSize: '14px', color: totalAccent(options) }}>
                    <span>TOTAL</span>
                    <strong>{formatIDR(totalAmount)}</strong>
                </div>
                {showDp ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                            <span>DP / Uang Muka</span>
                            <strong>- {formatIDR(paid)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: 700, color: totalAccent(options) }}>
                            <span>Sisa Tagihan</span>
                            <strong>{formatIDR(remaining)}</strong>
                        </div>
                    </>
                ) : null}
            </div>

            <TerbilangLine amount={showDp ? remaining : totalAmount} options={options} />
```

- [ ] **Step 4: Add the bank block before the footer**

Find (lines 193-198):

```tsx
            <div style={{ borderTop: '1px solid #d1d5db', paddingTop: '10px' }}>
                <strong>Notes:</strong> {invoice.notes || '-'}
            </div>

            <DocumentFooter options={options} />
            <SignatureBlock options={options} />
```

Replace with:

```tsx
            <div style={{ borderTop: '1px solid #d1d5db', paddingTop: '10px' }}>
                <strong>Notes:</strong> {invoice.notes || '-'}
            </div>

            <BankBlock options={options} />
            <DocumentFooter options={options} />
            <SignatureBlock options={options} />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (The `invoice.amountPaid ?? ...` reads are valid because `InvoiceRecord` has an index signature `[key: string]: unknown`, and `toNumber` accepts `unknown`.)

- [ ] **Step 6: Visual verification**

Run the dev servers per `scripts/dev-setup.sh` (frontend 5173, backend 3000), open Settings → Print Settings, and confirm the live preview now shows DPP and (once a bank is set in Task 6) the bank block + Terbilang. Capture a screenshot.

- [ ] **Step 7: Commit**

```bash
git add src/components/print/InvoicePrintTemplate.tsx
git commit -m "feat(print): faktur invoice layout (DPP, DP/Sisa, terbilang, bank)"
```

---

## Task 6: Settings → "Print & Branding" (bank fields, toggles, logo upload)

**Files:**
- Modify: `src/views/settings/Settings.tsx`

- [ ] **Step 1: Relabel the tab in the menu**

Find (line 156):

```tsx
        { id: 'print', label: 'Print Settings', icon: Printer },
```

Replace with:

```tsx
        { id: 'print', label: 'Print & Branding', icon: Printer },
```

- [ ] **Step 2: Add logo-preview state next to `printForm`**

Find (line 117):

```tsx
    const [printForm, setPrintForm] = useState(storePrintSettings);
```

Replace with:

```tsx
    const [printForm, setPrintForm] = useState(storePrintSettings);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { window.alert('Please choose an image file (PNG or JPG).'); return; }
        if (file.size > 500 * 1024) { window.alert('Logo is larger than 500 KB. Please use a smaller image.'); return; }
        const reader = new FileReader();
        reader.onload = () => setLogoPreview(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(file);
    };
```

- [ ] **Step 3: Persist the uploaded logo on save**

Find the print save block (lines 268-278):

```tsx
        if (sectionId === 'print') {
            // Print settings live on the org (DB is source of truth, shared across
            // devices), then mirror into the local store for instant rendering.
            try {
                await updateOrgSettings.mutateAsync({ printSettings: printForm } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
                updatePrintSettings(printForm);
            } catch (e) {
                window.alert(`Failed to save print settings: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
        }
```

Replace with:

```tsx
        if (sectionId === 'print') {
            // Print settings live on the org (DB is source of truth, shared across
            // devices), then mirror into the local store for instant rendering.
            try {
                const body = { printSettings: printForm, ...(logoPreview ? { logoUrl: logoPreview } : {}) };
                await updateOrgSettings.mutateAsync(body as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
                updatePrintSettings(printForm);
                if (logoPreview) { updateCompanyInfo({ logoUrl: logoPreview }); setLogoPreview(null); }
            } catch (e) {
                window.alert(`Failed to save print settings: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
        }
```

- [ ] **Step 4: Add the logo uploader at the top of the print controls**

Find the accent-color control (lines 736-742):

```tsx
                                <div>
                                    <label className="form-label">Brand accent color</label>
                                    <div className="flex items-center gap-3">
                                        <input type="color" value={printForm.accentColor} onChange={(e) => setPrintForm((p) => ({ ...p, accentColor: e.target.value }))} className="h-10 w-14 rounded border border-neutral-300 bg-neutral-0 p-1" />
                                        <Input value={printForm.accentColor} onChange={(e) => setPrintForm((p) => ({ ...p, accentColor: e.target.value }))} />
                                    </div>
                                </div>
```

Insert directly **before** it:

```tsx
                                <div>
                                    <label className="form-label">Company logo</label>
                                    <div className="flex items-center gap-3">
                                        <div className="h-12 w-12 rounded border border-neutral-300 bg-neutral-50 flex items-center justify-center overflow-hidden">
                                            {(logoPreview ?? storeCompanyInfo.logoUrl)
                                                ? <img src={logoPreview ?? storeCompanyInfo.logoUrl} alt="Logo" className="max-h-12 max-w-12 object-contain" />
                                                : <span className="text-neutral-400 text-xs">None</span>}
                                        </div>
                                        <label className="inline-flex items-center px-3 h-10 rounded-md border border-neutral-300 bg-neutral-0 text-sm font-medium cursor-pointer hover:bg-neutral-100">
                                            Upload logo…
                                            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoUpload} />
                                        </label>
                                    </div>
                                    <p className="settings-muted mt-1">PNG or JPG, up to 500&nbsp;KB. Saved with this book.</p>
                                </div>
```

- [ ] **Step 5: Add the bank/payment fields and the two toggles**

Find the footer-line control (lines 787-790) — the last control before the closing `</div>` of the controls column:

```tsx
                                <div>
                                    <label className="form-label">Footer line</label>
                                    <Input value={printForm.footerText} placeholder="e.g. Terima kasih atas kepercayaan Anda." onChange={(e) => setPrintForm((p) => ({ ...p, footerText: e.target.value }))} />
                                </div>
```

Insert directly **after** it:

```tsx
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showTerbilang} onChange={(e) => setPrintForm((p) => ({ ...p, showTerbilang: e.target.checked }))} /><span className="settings-label-strong">Terbilang</span></label>
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showBankDetails} onChange={(e) => setPrintForm((p) => ({ ...p, showBankDetails: e.target.checked }))} /><span className="settings-label-strong">Bank / payment block</span></label>
                                </div>

                                {printForm.showBankDetails && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="form-label">Bank</label>
                                            <Input value={printForm.bankName} placeholder="e.g. BCA" onChange={(e) => setPrintForm((p) => ({ ...p, bankName: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="form-label">Account no.</label>
                                            <Input value={printForm.bankAccountNo} placeholder="e.g. 1234567890" onChange={(e) => setPrintForm((p) => ({ ...p, bankAccountNo: e.target.value }))} />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="form-label">Account name</label>
                                            <Input value={printForm.bankAccountName} placeholder="e.g. PT. Murni Sukses Mandiri" onChange={(e) => setPrintForm((p) => ({ ...p, bankAccountName: e.target.value }))} />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="form-label">Payment note (optional)</label>
                                            <Input value={printForm.paymentNote} placeholder="e.g. Mohon transfer sesuai Sisa Tagihan." onChange={(e) => setPrintForm((p) => ({ ...p, paymentNote: e.target.value }))} />
                                        </div>
                                    </div>
                                )}
```

- [ ] **Step 6: Make the live preview reflect the uploaded logo**

Find (line 804):

```tsx
                                            company={storeCompanyInfo as unknown as Record<string, unknown>}
```

Replace with:

```tsx
                                            company={{ ...storeCompanyInfo, logoUrl: logoPreview ?? storeCompanyInfo.logoUrl } as unknown as Record<string, unknown>}
```

- [ ] **Step 7: Update the Card title**

Find (line 731):

```tsx
                    <Card title="Print Settings">
```

Replace with:

```tsx
                    <Card title="Print & Branding">
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Visual verification**

Open Settings → Print & Branding. Upload a small logo, fill the bank fields, tick the toggles — confirm the live preview updates (logo, bank block, terbilang). Save, reload, confirm values persist. Capture a screenshot.

- [ ] **Step 10: Commit**

```bash
git add src/views/settings/Settings.tsx
git commit -m "feat(settings): Print & Branding tab — logo upload, bank fields, toggles"
```

---

## Task 7: Route `InvoiceForm`'s Print through the shared modal

Replaces the raw `window.print()` (which prints a blank page — the form renders no `.print-template`) with the same `PrintPreviewModal` + `InvoicePrintTemplate` used everywhere else, so the editable form's Print button gives a real preview + Download PDF.

**Files:**
- Modify: `src/views/ar/InvoiceForm.tsx`

- [ ] **Step 1: Add imports**

After the existing `DocumentActionBar` import (line 78), add:

```tsx
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import InvoicePrintTemplate from '../../components/print/InvoicePrintTemplate';
```

- [ ] **Step 2: Add the store selectors and modal state**

Find (line 127):

```tsx
    const salesPolicy = useSettingsStore((s) => s.salesPolicy);
```

Insert directly **after** it:

```tsx
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [isPrintOpen, setIsPrintOpen] = useState(false);
```

(`useState` is already imported in this file.)

- [ ] **Step 3: Point `handlePrint` at the modal**

Find (lines 522-524):

```tsx
    const handlePrint = () => {
        window.print();
    };
```

Replace with:

```tsx
    const handlePrint = () => {
        setIsPrintOpen(true);
    };

    const printInvoice = {
        number: formData.number || autoNumberPreview,
        customerName: customerList.find((c) => c.id === formData.customerId)?.name || '',
        issueDate: formData.issueDate,
        dueDate: formData.dueDate,
        status: 'Draft',
        notes: formData.notes,
        amount: calculateSubtotal(),
    };
```

- [ ] **Step 4: Wrap the return in a fragment and render the modal**

Find the start of the return (lines 589-590):

```tsx
    return (
        <FormPage
```

Replace with:

```tsx
    return (
      <>
        <FormPage
```

Then find the closing of `FormPage` (lines 652-653):

```tsx
        </FormPage>
    );
};
```

Replace with:

```tsx
        </FormPage>
        <PrintPreviewModal
            isOpen={isPrintOpen}
            onClose={() => setIsPrintOpen(false)}
            title="Invoice Print Preview"
            documentTitle={`Invoice_${printInvoice.number || ''}`}
            defaultPaperSize={printSettings.defaultPaperSize}
        >
            <InvoicePrintTemplate
                invoice={printInvoice as unknown as Record<string, unknown>}
                lineItems={formData.items as unknown as Record<string, unknown>[]}
                company={company as unknown as Record<string, unknown>}
                options={printSettings}
                taxRate={globalTaxSettings.defaultRate}
            />
        </PrintPreviewModal>
      </>
    );
};
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `globalTaxSettings` is not the correct in-scope tax selector name, use the file's existing tax-rate source (`globalTaxSettings` is declared at line 149 as `useSettingsStore(s => s.taxSettings)`, and `taxSettings.defaultRate` is the rate — confirm and match).

- [ ] **Step 6: Visual verification**

Open an invoice in the editable form, click Print — confirm the preview opens with the faktur layout, Print and Download PDF both work, and the PDF filename is `Invoice_<number>.pdf`. Capture a screenshot.

- [ ] **Step 7: Commit**

```bash
git add src/views/ar/InvoiceForm.tsx
git commit -m "fix(ar): invoice form Print uses shared preview modal, not window.print"
```

---

## Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `npm test`
Expected: all tests pass, including the new `downloadPdf.test.ts` (9 assertions) and the existing suite.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no new type errors introduced by this work.

- [ ] **Step 3: Manual end-to-end (dev servers running)**

For each AR surface, open the print preview and click **Download PDF**; confirm a correctly-named PDF downloads and visually matches the preview:
- Invoice workbench detail (`/ar/invoices/workbench`)
- Invoice editable form Print button
- Sales Order workbench
- AR Payments list/detail receipt
- Credit Note / Sales Return forms

Confirm the invoice shows: letterhead + NPWP, Satuan column, DPP/PPN/Total, Terbilang, and (when a bank is configured) the bank block; DP/Sisa rows appear only when the invoice has a recorded partial payment.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(print): verification fixes for AR print improvements"
```

---

## Self-review notes

- **Spec coverage:** PDF download (Tasks 1-2) · consistency / fix invoice (Tasks 5, 7; workbenches already consistent) · faktur layout — NPWP via existing `CompanyBlock`, Satuan via existing `showUnitColumn`, DP/Sisa + Terbilang + bank (Tasks 4-5) · per-book branding settings (Task 6). Branding is per-book automatically via `x-org-id`.
- **Reuse wins discovered during planning:** `terbilang` already exists (no new util); the settings normalizer already merges defaults (no change); invoice/SO workbenches already use the modal (consistency scope shrank). These deviate from the spec in the direction of *less* work — noted here intentionally.
- **Deferred (documented):** `PaymentForm`/`InvoiceForm`-style form prints for payments (list already covers it), book switcher, server/selectable-text PDF, email send.
- **Risk:** Task 7 edits a large form's `return` (fragment wrap) — lowest value, sequenced last so all other value lands first.
