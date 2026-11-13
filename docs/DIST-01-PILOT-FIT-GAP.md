# DIST-01 — Distributor pilot workflow fit-gap

> Issue: [#178](https://github.com/hunterich/MSM-Accounting/issues/178). Code reviewed on `main` at `a8637b7` (13 November 2026).
> This document covers the checklist item **"Map each workflow step to existing screens and identify actual gaps."**
> It is based on code reading only. Nothing here was run in a browser or against a pilot database, and none of it shows pilot readiness.

## Summary

The purchasing documents closely match the pilot workflow: purchase order, approval, partial receipt, a bill for the received quantity only, and manual close. The main problem is **warehouse location**. Goods receipts, direct bills, opening stock and sales invoices all post stock with **no warehouse** (`warehouseId = null`). Only adjustments, stock counts, returns and POS batches can record a warehouse.

So the five-warehouse pilot cannot be run as agreed. Stock received at Bogor and sold from Jakarta ends up in one shared pool with no location. The warehouse filter on Stock Valuation cannot show these movements under a named warehouse.

Other gaps: stock transfers, warehouse-scoped access, invoicing only delivered quantities, and carton/piece conversion in documents. PO auto-close from the PO date and approver reopen have since been built on this branch (P5, P6), pending acceptance.

## Workflow mapping

Status: **Fits** = supported as agreed · **Partial** = a screen exists but behaviour differs · **Gap** = not present.

| # | Agreed workflow step | Existing screen / API | Status | Evidence and gap |
|---|---|---|---|---|
| W1 | Five warehouses (Bogor, Jakarta, Surabaya, Tegal, Banten) plus a defect warehouse | `Warehouse` model; `GET/POST /api/v1/warehouses` | Partial | Warehouses can be created through the API only. No screen to create or edit them was found; existing screens only read the list (`useWarehouses`). There is no way to mark a warehouse as the defect warehouse. |
| W2 | Pieces and cartons, with a different carton size per product | Item form: base `unit`, `purchaseUnit` + `purchaseConversionFactor`, `sellUnit` + `sellConversionFactor` | Partial | The factors are saved and shown on the item form, but no posting, PO, receipt, bill, invoice or return code reads them. Document lines store a free-text `unit` and post their quantity to stock unchanged. Entering 10 cartons posts 10 base units, not 240 pcs. Feeds DIST-03. |
| P1 | Each warehouse raises its own PO | Purchase Orders (`POFormV2`, `/purchase-orders`) | Partial | Any user with `AP_POS` permission can create a PO. There is no user-to-warehouse permission, so one warehouse cannot be limited to its own POs. |
| P2 | One destination warehouse per PO | `PurchaseOrder` | **Gap** | `PurchaseOrder`, `PurchaseOrderLine` and `Bill` have no warehouse field. |
| P3 | Partial deliveries | `POST /purchase-orders/[id]/receive` | Partial | Partial receipts work: `receivedQty` per line, `PARTIAL_RECEIVED` status, over-receipt refused, serialized by an advisory lock. But `postGoodsReceiptToLedger` calls `addCostLayer(..., null, ...)`, so received stock has no warehouse. |
| P4 | Supplier invoice covers only received goods | Receipt creates a draft Bill from received lines | Fits | Each receipt creates a draft bill for the received quantity at the PO price and discount. Inventory is debited and GR/IR credited at receipt; the bill clears GR/IR. Finance still needs to accept the values (DIST-02). |
| P5 | Auto-close the undelivered balance N days after the **PO date**; default 7 days set at app setup | Purchase settings `purchasePolicy`; scheduler `closeDuePurchaseOrders` (every 15 minutes) | Fits (branch, pending acceptance) | **Update:** the deadline now counts from the PO date (or the reopen date), so POs without an expected date also close. Decision: the 7-day default stays a company setting (Purchase settings → on, 7 days for the pilot company). The app-wide default stays off, 30 days, and app setup still does not prompt for it. |
| P6 | Authorized staff can reopen; others cannot | `POST /purchase-orders/[id]/reopen`; Reopen button on closed POs | Fits (branch, pending acceptance) | **Update:** staff with the Purchase Orders **approve** right can reopen a closed PO that still has an undelivered balance. Others get 403 and see no button. Decision: auto-close restarts N days after the reopen date. Audit-logged. |
| S1 | Each sales order fulfilled from one warehouse | Sales Orders (`SOFormV2`); Delivery Notes (`DeliveryNoteForm`) | Partial | `SalesOrder` and `SalesInvoice` have no warehouse. A Delivery Note can record an optional `warehouseId`, but stock does not move at delivery. |
| S2 | Invoice after delivery | Delivery Note → `deliveredQty`; `POST /sales-orders/[id]/convert` | Partial | Conversion invoices the **full ordered quantity** of every line, not the delivered quantity, and ignores `invoicedQty`. Stock is relieved when the invoice is posted (`postInvoiceSend`). The warehouse comes from `opts.warehouseId`. Only POS sales pass it; invoice, approval, recurring and marketplace posting do not, so their stock is always relieved from `null`. |
| S3 | (Delivery note completion) | `POST /api/v1/delivery-notes` with `status: DELIVERED` | **Likely defect** | When the last line is fully delivered, the route sets `SalesOrder.status = 'DELIVERED'`. `SoStatus` has no `DELIVERED` value (it has `DRAFT, CONFIRMED, INVOICED, CANCELLED, PENDING_APPROVAL`). That update is not wrapped in the try/catch used for `PARTIAL_DELIVERY`, so completing a delivery should fail and roll back. Not yet confirmed by a test. |
| T1 | Transfer stock between locations | — | **Gap** | `InventoryDocumentType.TRANSFER` exists in the enum but nothing creates it. There is no transfer document, screen or API. A paired decrease/increase adjustment is the only workaround, and it posts journals and loses the cost link. |
| T2 | Receiving warehouse confirms quantity received | — | **Gap** | Requires T1 with a ship step and a separate receive step (an in-transit state). |
| T3 | Keep transfer differences visible for stock audit | Stock Counts (`StockCountForm`) can record a later count per warehouse | **Gap** | No record links a shipped-versus-received difference to the transfer. Valuation and accounting for the difference are still undecided (open discovery item). |
| D1 | Move defective goods to the defect warehouse | — | **Gap** | Depends on T1 and on warehouse-located stock (P3/S2). |
| D2 | Return defective goods to supplier, or dispose | Purchase Return (`PurchaseReturnForm`, has `warehouseId`); Stock Adjustment decrease (has `warehouseId`) | Partial | Both screens accept a warehouse. Because receipts post stock with no warehouse, a return from the defect warehouse finds no stock in that warehouse. Purchase returns also require a source bill. |

## Representative examples against current behaviour

**PO, 10 cartons × 24 pcs to Bogor, receive 6 cartons.**
- The PO cannot name Bogor (P2).
- Unless the line is entered as 240 PCS, the receipt posts 6 base units instead of 144 pcs (W2).
- The draft bill covers only the received quantity (P4 fits).
- The remaining 96 pcs auto-close 7 days after the PO date (P5, with the company set to on, 7 days).
- A PO approver can reopen it, and auto-close restarts from the reopen date; staff without approve rights are refused (P6). Covered by unit and route tests; not yet run in a browser.

**Transfer 100 pcs Bogor → Jakarta, Jakarta confirms 98 pcs.** Not possible: no transfer document (T1–T3).

## Gaps grouped for follow-up issues

These are proposed scope candidates, not approved work. Build only what the business owner confirms (see DIST-02/03/04).

1. **Warehouse-located stock (blocker).** Add a destination warehouse to POs and receipts. Add a source warehouse to sales orders and invoices, or post stock at delivery from the Delivery Note's warehouse. Decide how existing `null`-warehouse stock is assigned. This must respect the approved separate-per-warehouse Weighted Average policy and the INV-02 guards (#170).
2. **Warehouse management screen and defect-warehouse flag.**
3. **Stock transfer document** with ship/receive steps and a recorded difference (T1–T3, D1). The accounting treatment of the difference needs finance agreement first.
4. ~~**PO auto-close from PO date, and reopen**~~ (P5, P6) — done on this branch, pending acceptance. An app-setup prompt for the default days was not added.
5. **Invoice delivered quantities only** and fix the Delivery Note completion status (S2, S3). S3 looks like a standalone defect that can be fixed independently.
6. **Unit conversion in documents** (W2, DIST-03).
7. **Warehouse-scoped access** for users (P1), if the business owner confirms each warehouse must be limited to its own documents.

## Still open in #178 (needs business owner / finance)

- Opening balances, pricing tiers and the carton size for each sample product.
- Sanitized purchase, sale, return, correction and settlement examples with expected quantities and accounting results.
- Stock-audit resolution of transfer differences, including valuation and journals.
- Business-owner scope approval and finance acceptance expectations.
