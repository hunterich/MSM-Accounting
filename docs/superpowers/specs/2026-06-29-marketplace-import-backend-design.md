# Marketplace Import → Backend Persistence (Phases ②.1–②.3)

**Date:** 2026-06-29
**Status:** Design — pending user review
**Part of roadmap:** ① E-commerce Integration setup (already built) → **② Import → backend persistence (this spec)** → ③ Best-Selling-Products dashboard widget (later).

## Problem

The marketplace import wizard (`src/components/ar/invoices/ImportInvoicesModal.tsx`) parses Shopee/TikTok Excel exports and generates invoices + payments, but **writes them to `localStorage`** (`useInvoiceStore`, `usePaymentStore`) instead of the backend database. It already *reads* backend integration config via `useEcommerceConnections`, but the persisted sales never reach Postgres. As a result, the real AR invoice list (`InvoiceWorkbench` → `useInvoices()`), the GL, and every backend report **do not reflect marketplace sales** — the books and reports are unreliable, and the planned best-selling-products widget (③) would see nothing.

## Goal

On **Confirm**, the import creates real, GL-posted sales in the database:
- Auto-finalized `SalesInvoice` + lines (each tied to a master `Item` via `itemId`) + a settlement receipt.
- **Idempotent** by marketplace order number (re-importing the same file skips already-posted orders).
- **Format-detected** so a file can't be uploaded into the wrong-platform store.
- **SKU cross-checked** so every line maps to a master item; unmatched SKUs create new master items.

Out of scope for this build: fee/shipping postings (②.4, deferred), refund/return handling, and the system-wide duplicate-button cleanup (separate task).

## Decisions (from brainstorming)

- **Bulk, not per-order:** all 100+ orders post from a single **Confirm** — the user never reviews or posts orders individually. The only manual step is **SKU mapping**, which is per *unique product* (a few dozen, since many orders share products), not per order.
- **Posting status:** auto-finalize — invoices post revenue + COGS to the GL immediately (these are completed, settled marketplace orders).
- **Payment:** record a receipt into the store's **Settlement/clearing account** (from the integration), marking the invoice PAID; a later payout (settlement → real bank) is a separate manual bank transfer. The payment treatment follows the integration's configured `paymentMode` / settlement account.
- **Invoice + settlement date:** each invoice uses **its own order date from the file** (order created/paid time); the settlement receipt uses the **same** date as its invoice.
- **Unmatched SKU:** **bulk-create** new master items in one action (not one-by-one). New items are created with `costPrice = 0`, `openingStock = 0`, inheriting the org's default revenue/COGS/inventory accounts; the user corrects cost/stock later via a stock/cost adjustment. **Confirm is blocked until every unique SKU is mapped or created.**
- **Oversell:** the import **allows negative stock for its own postings** — inventory may go negative and COGS uses the item's `costPrice` (0 for newly-created items). This is **scoped to the import path**; manual sales keep the org's `allowNegativeStock` guard. Implemented by passing an explicit allow-negative override into the finalize/COGS posting (see `lib/inventory-costing.ts`, which otherwise reads `org.allowNegativeStock`).
- **Ranking/identity:** sales aggregate by the master product (`itemId`), so the import must guarantee every line has an `itemId`.

## Architecture

### Approach: one transactional backend import endpoint

Parsing/preview/mapping stay **client-side** (reuse `src/utils/shopeeImport.ts`) for a responsive wizard UX. On **Confirm**, the wizard POSTs the validated, item-mapped order rows to a **new endpoint**:

```
POST /api/v1/integrations/[id]/import
```

The server creates everything in a **transaction per order** (one bad order doesn't roll back the whole batch) and returns a per-order result summary. This beats having the client loop over `/invoices` + `/ar-payments` (many round-trips, messy partial failures, no atomicity, idempotency re-implemented client-side).

**Endpoint contract**

- **Auth:** `withPermission({ module: 'AR_INVOICES', action: 'create' })`, org-scoped via `requireOrg`/`requireAuth`. The `[id]` is the `EcommerceConnection` id; load it and use its `customerId`, `holdingAccountId` (settlement), `platform`, `taxInclusive`, etc.
- **Request body:**
  ```ts
  {
    orders: Array<{
      orderNo: string;              // marketplace order id → SalesInvoice.poNumber
      issueDate: string;            // chosen date field (order created / payment time)
      lines: Array<{
        itemId: string;             // REQUIRED — resolved master item (no nulls)
        description: string;        // snapshot
        sku: string;
        quantity: number;
        unitPrice: number;          // price after discount
      }>;
    }>;
    options: {
      customerId?: string;          // defaults to connection.customerId; confirmable override
      recordPayment: boolean;       // from integration paymentMode (settlement receipt)
    };
  }
  ```
- **Per order:**
  1. **Idempotency:** look up a non-void `SalesInvoice` with the same `poNumber` for this org. If found → record as `skipped`, do not mutate.
  2. **Create + finalize:** create the `SalesInvoice` (customer from options/connection, `poNumber = orderNo`, `issueDate` = the order's date from the file, `taxInclusive` from connection) with lines (each carrying `itemId`), then **finalize to `SENT`** so revenue + COGS post to the GL. Pass an explicit **`allowNegativeStock: true`** into the COGS posting (import-scoped oversell tolerance; COGS uses item `costPrice`). Reuse the existing invoice-finalize/posting helper used by the `PUT /api/v1/invoices/[id]` DRAFT→SENT path — extract it to a shared lib function if not already callable (confirm exact location during planning; the POST route notes "COGS is posted when invoice transitions DRAFT → SENT (in PUT handler)").
  3. **Settlement receipt (if `recordPayment`):** create an AR payment into the connection's `holdingAccountId`, allocated to the invoice, marking it PAID — posts Dr Settlement / Cr AR. Reuse the existing AR-payment creation + GL path (`/api/v1/ar-payments`).
- **Response:** `{ created: number, skipped: number, errors: Array<{ orderNo, message }> }`.

**GL postings produced** (reusing existing helpers — do not reinvent):
- Invoice finalize: Dr AR / Cr Revenue (+ Cr Output Tax if PPN), Dr COGS / Cr Inventory.
- Settlement receipt: Dr Settlement (bank/clearing) / Cr AR.
- Fees/shipping: **not posted** in this build.

### ②.2 Format detection

Define a per-platform fingerprint (sheet name + signature header columns), derived from the real exports:

| Platform | Sheet | Signature headers | Order key |
|---|---|---|---|
| Shopee | `Matched Orders` | `No. Pesanan`, `SKU Induk`, `Nama Produk`, `Nomor Referensi SKU`, `Jumlah` | `No. Pesanan` |
| TikTok | `Filtered Adjusted` (or `Sheet1`) | `Order ID`, `Seller SKU`, `Product Name`, `Quantity` | `Order ID` |

- On upload, read the workbook's sheet names + header row and detect the platform.
- If the detected platform ≠ the selected store's `platform` → **block** with a clear message ("This looks like a TikTok export, but the selected store is Shopee").
- Harden `shopeeImport.ts`: select the correct sheet (the real Shopee export's first sheet is `Matched Orders`, not `Sheet1`) and confirm the COLUMN_MAP aliases cover both real header sets. Keep the existing TikTok description-row skip.
- Extensible: signatures live in a small table so Tokopedia/Lazada/Blibli can be added later (the Accurate platform list).

### ②.3 SKU cross-check + create-new master item

In the wizard's **mapping** step (per *unique product*, not per order):
- For each unique product, match by SKU against DB `Item.sku` (Shopee `SKU Induk` / `Nomor Referensi SKU`; TikTok `Seller SKU`). Auto-map exact matches.
- **Unmatched SKUs:** listed together with a single **"Create all as new items"** bulk action (not one-by-one). Each new `Item` is created with `sku` + `name` from the file, `sellingPrice` from the order price, default `unit`, `type = PRODUCT`, and **`costPrice = 0`, `openingStock = 0`**, inheriting the org's default revenue/COGS/inventory accounts (user corrects cost/stock later via adjustment) — via the existing item-create hook (`useCreateItem`). Created rows auto-map to the new items.
- **Block Confirm** until every unique SKU is mapped or created — guarantees no unlinked lines (consistent with ③'s master-only aggregation).
- **Whole-order integrity:** an order is never partially posted. Mapping is per *unique SKU*, and Confirm is blocked until **all** are resolved, so by post time every line of every order has an `itemId`. A 3-line order whose 1 SKU was unmatched posts **intact (all 3 lines)** once that SKU is mapped or created — a line is never dropped (dropping it would understate the invoice total and break reconciliation with the order's settlement amount).

### Wizard rewrite (`ImportInvoicesModal.tsx`)

Keep the 6-step shape (upload → preview → mapping → configure → importing → done), but:
- **upload:** add format detection + wrong-platform block (②.2).
- **mapping:** SKU auto-match + create-new-item for unmatched; required to proceed (②.3).
- **configure:** status is auto-finalize (posted); customer defaults from the connection (confirmable); live summary.
- **importing:** call `POST /api/v1/integrations/[id]/import`; show progress.
- **done:** show `created / skipped / errors` summary.
- Remove `useInvoiceStore` / `usePaymentStore` batch writes. Switch reads off the localStorage stores (`useInventoryStore`, `useCustomerStore`) to backend hooks (`useItems` already used; add `useCustomers`).
- **Import button placement:** beside the "+ New Invoice" document tab (workspace `TwoLevelTabBar` / `InvoiceListPane` area), per the user's layout request.

## Data model

No schema change required for the core:
- `SalesInvoice.poNumber` stores the marketplace order number (idempotency key; matched within org).
- Unmatched SKUs create rows in the existing `Item` model.

Optional (note, not committing): a `source`/`channel` marker or connection link on `SalesInvoice` for cleaner per-store dedup and reporting. `poNumber` within-org suffices for v1; the (rare) cross-platform order-number collision is an accepted edge case for now.

## Testing

- **Unit:** format-detection fingerprint (Shopee vs TikTok; wrong-file rejection); SKU matcher; parser sheet selection. Use the real header sets above as fixtures.
- **Integration (real-Postgres harness, `npm run test:int`):**
  - Import creates posted invoices + settlement receipts with correct GL; trial balance stays balanced (reuse the GL invariant harness).
  - Idempotent re-import skips already-posted orders (no duplicates, no GL change).
  - Unmatched-SKU flow creates a new `Item` and links the line.
- Existing 675 unit / int suites stay green; typecheck clean.

## RBAC

Import endpoint guarded by `AR_INVOICES:create` (it creates invoices/payments). Inline item-create uses existing `inv_items:create`.

## Resolved / remaining questions

- **Invoice + settlement date** — RESOLVED: each invoice uses its own order date from the file; settlement receipt matches that date.
- **New-item defaults** — RESOLVED: `costPrice = 0`, `openingStock = 0`, inherit org default revenue/COGS/inventory accounts; user adjusts later.
- **Oversell** — RESOLVED: import-scoped negative-stock allowance (manual sales stay guarded).
- **Remaining (implementation detail, for planning):** exact location/shape of the reusable invoice-finalize + GL-posting helper, and how to thread the `allowNegativeStock` override into the COGS path — extract a shared function if the PUT handler's logic isn't already callable from a service layer.

## Not in this build

- ②.4 fee/shipping postings (the *Ongkir dan Fee* config consumption).
- Refund/return handling (the exports carry returned-quantity columns).
- System-wide duplicate-button cleanup (separate task — `task_e3b115c8`).
- ③ best-selling-products widget.
