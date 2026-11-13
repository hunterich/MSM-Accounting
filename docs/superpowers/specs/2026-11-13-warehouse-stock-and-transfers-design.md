# Warehouse stock, transfers and defect handling

**Date:** 2026-11-13
**Status:** Draft for review. Nothing here is built or approved.
**Issues:** DIST-01 [#178](https://github.com/hunterich/MSM-Accounting/issues/178) (gaps W1, P2, P3, S1, S2, T1–T3, D1, D2 in `docs/DIST-01-PILOT-FIT-GAP.md`); feeds DIST-02 #179 and DIST-04 #181.
**Reference behaviour:** Accurate Online *Pemindahan Barang* (Transfer Out / Transfer In through a system Transit warehouse) and *Gudang Barang Rusak*, as shown by the business owner on 13 November 2026.

## 1. Purpose

The distributor pilot runs five warehouses (Bogor, Jakarta, Surabaya, Tegal, Banten) plus a defect warehouse. Staff must see stock per warehouse, move goods between warehouses with the receiving side confirming the quantity, and move damaged goods out of sellable stock for write-off or supplier return.

Today the app cannot do this (section 2). This spec proposes how to add it without breaking the approved costing rules, in three phases. Section 9 lists the decisions that need the business owner or finance before building.

### Who should review what

| Reviewer | Focus |
|---|---|
| Business owner | Sections 4–6 (workflow), decisions D1–D3, D6–D8 |
| Finance | Section 7 (journal examples), decisions D4, D5, D9 |
| Engineering / second-opinion reviewer | Sections 3 and 8 (costing constraints, data model, reversal rules) |

## 2. Current behaviour (code on `main`, 13 November 2026)

| Area | Today | Code |
|---|---|---|
| Warehouses | `Warehouse` has only `code` and `name`. API to create/list exists; no management screen; no type flag. | `prisma/schema.prisma` `Warehouse`, `src/app/api/v1/warehouses` |
| Purchase receipts, direct bills, opening stock | Stock is added with **no warehouse** (`warehouseId = null`). | `lib/goods-receipt-posting.ts`, `lib/bill-posting.ts`, `lib/inventory-opening.ts` call `addCostLayer(..., null, ...)` |
| Sales invoices | No warehouse on the invoice. Stock is drawn **oldest-first from any warehouse, including the no-warehouse pool**; each ledger row records the warehouse it actually came from. Only POS passes a warehouse. | `lib/inventory-costing.ts` `relieveCostLayers` (SALES branch), `lib/invoice-send-posting.ts` |
| Adjustments, stock counts, customer and supplier returns | Accept an optional warehouse. | `StockAdjustment`, `StockCount`, `SalesReturn`, `PurchaseReturn` |
| Transfers | None. `InventoryDocumentType.TRANSFER` exists but nothing writes it. | — |
| Costing | One company method (FIFO or Weighted Average). Weighted Average keeps a **separate pool per item and warehouse** (no warehouse is its own pool). A sale may run short only under the approved negative-stock policy; the next receipt into the **same warehouse pool** settles it. | `getWeightedAveragePool`, `docs/INV-02-NEGATIVE-STOCK.md` |
| Posting accounts | Each lot and movement records the item's inventory posting account (#224). The item's inventory account cannot change while it has stock. | `inventoryPostingAccountId`, `lib/item-posting-accounts.ts` |

Consequence: stock received for Bogor sits in the no-warehouse pool, and a Jakarta sale can draw it. Per-warehouse stock reports cannot show the truth.

## 3. Constraints the design must respect

1. **Do not change the approved separate-per-warehouse Weighted Average policy** (DIST-04 #181). A transfer moves value out of one pool and into another at the **source cost**; the destination's average then changes. It does not create a company-wide average.
2. **Shortfall settlement is per warehouse pool.** If sales keep drawing from "any warehouse" while receipts land in named warehouses, a shortage recorded on one pool may never be settled by the receipt that covers it. Once a company uses warehouses, every stock document must name one.
3. **INV-02 reversal guards stay in force.** Voiding an inbound movement is refused when a later stock issue exists for that item and warehouse (`assertNoLaterStockIssue`, `reversedAt` marking). Transfer voids must follow the same rule on both sides.
4. **No silent history rewrite.** Existing no-warehouse stock is not relabelled automatically; it is moved by documents that leave an audit trail.
5. **Inventory subledger = GL.** Every movement still records its inventory posting account; per-warehouse totals must still add up to the Inventory GL balance.
6. **Period locks, numbering, audit log and approvals** use the existing helpers (`assertPeriodOpen`, `nextNumber`, `logAuditTx`, approval engine).

## 4. Warehouses

Add to `Warehouse`:

| Field | Purpose |
|---|---|
| `kind` enum `STANDARD` \| `DEFECT` \| `TRANSIT` | `DEFECT` = Accurate's "Ya, merupakan gudang penyimpanan Barang Rusak". `TRANSIT` = one system warehouse per company, created automatically, not editable, never chosen on a document. |
| `isActive` | Hide a warehouse from new documents without deleting history. |
| `address` (optional) | Shown on transfers and delivery notes. |

Company settings:

- **Warehouse mode** (off by default). When on, every new stock document must name a warehouse (constraint 2), and a **default warehouse** pre-fills forms.
- Turning it on requires that no draft stock documents are pending without a warehouse.

Rules by kind:

| | STANDARD | DEFECT | TRANSIT |
|---|---|---|---|
| Receive from PO / bill | Yes | No (decision D3) | No |
| Sell from (invoice, POS, delivery) | Yes | **No**; not counted as available to sell | No |
| Customer return into | Yes | Yes (damaged returns) | No |
| Transfer from / to | Yes | Yes | System only |
| Supplier return from | Yes | Yes | No |
| Stock adjustment / stock count | Yes | Yes | No (differences are resolved on the transfer) |

Screens: a Warehouses list and form (Inventory → Warehouses). An "Item per Warehouse" view showing quantity per warehouse, including **Transit** and **Unassigned** (no-warehouse) rows, matching Accurate's view.

## 5. Warehouse on purchase and sales documents (Phase 1)

### Purchasing
- `PurchaseOrder.warehouseId` (destination), required in warehouse mode. The pilot rule is one destination warehouse per PO.
- PO receipts add stock to the PO's warehouse (`postGoodsReceiptToLedger` passes it to `addCostLayer`).
- Direct bills (no PO) get `Bill.warehouseId`.
- Shortfall settlement then happens in the right pool automatically, because it already runs inside `addCostLayer` for that warehouse.

### Sales
- `SalesOrder.warehouseId` (the one fulfilling warehouse), copied to delivery notes and to the invoice (`SalesInvoice.warehouseId`).
- Invoice posting passes the invoice warehouse to `calculateAndPostCOGS`, so stock is drawn **only from that warehouse**. The "any warehouse" fallback stays only for companies with warehouse mode off.
- Available-to-sell checks exclude `DEFECT` and `TRANSIT` warehouses.
- **Timing:** stock keeps leaving at invoice posting, as today; the pilot invoices right after delivery (decision D2). Moving stock at delivery would need a "delivered not invoiced" posting and is out of scope.
- Related fixes needed for the pilot but tracked separately: invoice only delivered quantities (S2) and the delivery-note completion status defect (S3).

### Other stock sources
- Opening balances are entered **per warehouse** (stock adjustment additions, or the migration import) rather than the item's single `openingStock`.
- Marketplace imports need a warehouse per shop connection (decision D7). POS already has one per register.

### Existing no-warehouse stock
It stays visible as an **Unassigned** location. Staff move it with ordinary transfers (Unassigned → Bogor and so on), which carry its exact book value and leave an audit trail. No automatic relabelling. A new pilot company that starts with per-warehouse opening balances has no Unassigned stock.

## 6. Stock transfers (Phase 2)

### Documents
One `StockTransfer` record per shipment, with lines; the receiving side records one or more receipts against it (Accurate: Transfer Out, then Transfer In with **Get From**).

`StockTransfer`: number (`TRF-…`), from warehouse, to warehouse, ship date, status, notes, created/approved by.
`StockTransferLine`: item, `qtyShipped`, `valueShipped`, `qtyReceived`, `qtyResolved`, unit (base unit; carton entry comes with DIST-03).
`StockTransferReceipt` + lines: receipt date, receiving user, quantity received per line, notes.
`StockTransferResolution` + lines: how an unreceived quantity was settled (section 6.4).

### 6.1 Ship (Transfer Out)
1. Check the source has the stock: **transfers may never run short**, even when negative stock is allowed (the negative-stock policy covers only sales).
2. For each line, relieve stock from the source at its cost (FIFO layers or the warehouse's Weighted Average pool) using the existing relief code, recording `documentType = TRANSFER`.
3. Add the same quantity and **exact value** to the company's `TRANSIT` warehouse, one lot per source draw, tagged with the transfer id and carrying the source lots' inventory posting account.
4. Status **Sending**.

### 6.2 Receive (Transfer In)
1. The receiving warehouse picks the transfer and enters the quantity that actually arrived per line (may be less than shipped; never more).
2. Draw those units from **this transfer's** Transit lots only, at their recorded values (specific identification, never the Transit pool average), and add them to the destination at that value. The destination's Weighted Average then blends normally.
3. Status **Partially received** or **Fully received**. Several receipts are allowed until the remaining quantity is zero.

Transit is costed by specific identification, so it must be excluded from Weighted Average pool calculation and from `refreshWarehouseCarryingValues`, which would otherwise spread one transfer's value onto another's lots. **Reviewers should check this carefully.**

### 6.3 Keeping the difference visible
After receiving 98 of 100, the 2 pcs stay in Transit **on that transfer**:
- The transfer shows *Partially received, 2 pcs outstanding*.
- Item per Warehouse shows 2 pcs in Transit.
- An **Open transfer differences** report lists every outstanding line with its age, value and warehouses, for the stock audit.

### 6.4 Resolving a difference
After the stock audit, an authorized user (decision D6) resolves each outstanding quantity on the transfer:

| Outcome | What it does |
|---|---|
| Found later | Record another receipt (6.2). |
| Lost or damaged in transit | Write off from Transit to an expense account (decision D4). |
| Charged to driver or carrier | Move the value from Transit to a receivable account (decision D4). |
| Never left the source | Return to the source warehouse at the recorded value. |

Status becomes **Closed with difference** when nothing remains outstanding. Every resolution records who, when, why, and an optional attachment.

### 6.5 Edits and voids
- A shipped transfer is not edited; it is voided and re-created.
- **Void a receipt:** allowed only if the destination has no later stock issue of that item (INV-02 rule); units return to this transfer's Transit lots at the same value.
- **Void a transfer:** only when no receipt or resolution is active; units return from Transit to the source. Under Weighted Average the source pool takes them back at their original value, subject to the same later-issue guard.
- Reversed movements are marked `reversedAt` like other voids.

### 6.6 Approvals and permissions
- New module key (or reuse `INV_ADJ`; decision D8) with create (ship), edit (receive), approve (resolve and void).
- Optional `STOCK_TRANSFER` approval type in the existing engine for transfers above a value threshold.
- Warehouse-scoped access (staff see and act only on their warehouse) is decision D1; without it any user with the permission can ship or receive for any warehouse.

## 7. Journal examples (for finance)

Assume one company Inventory account, Weighted Average, Bogor average Rp 10,000/pcs.

| Step | Stock ledger | Journal entry |
|---|---|---|
| Ship 100 pcs Bogor → Jakarta | Bogor −100 / −1,000,000; Transit +100 / +1,000,000 | **None**: both sides use the same Inventory account. If finance wants a separate "Persediaan dalam perjalanan" account (D5): Dr In-transit 1,000,000 / Cr Inventory 1,000,000. |
| Jakarta receives 98 | Transit −98 / −980,000; Jakarta +98 / +980,000 | None (or Dr Inventory 980,000 / Cr In-transit 980,000 under D5). |
| Write off 2 lost pcs | Transit −2 / −20,000 | Dr Beban selisih persediaan 20,000 / Cr Inventory (or In-transit) 20,000 |
| Charge 2 pcs to driver | Transit −2 / −20,000 | Dr Piutang karyawan/ekspedisi 20,000 / Cr Inventory (or In-transit) 20,000 |
| Move 5 damaged pcs Jakarta → Defect | Same pattern as above | None (or the D5 pair) |
| Write off damaged stock (Accurate Option A) | Defect −5 at defect pool cost | Dr Beban Barang Rusak / Cr Inventory, as a stock adjustment Reduction in the defect warehouse |
| Return damaged stock to supplier (Option B) | Defect −5 at defect pool cost | The existing purchase-return posting with warehouse = Defect: Dr AP-return clearing / Cr Inventory at cost. The debit note then posts Dr AP / Cr AP-return clearing at the agreed return price, which settles any price-cost difference. |

If an item's lots carry different historical inventory accounts, the transfer moves value between those accounts with an explicit journal entry, so the subledger and GL stay equal.

## 8. Phases and acceptance

| Phase | Scope | Done when |
|---|---|---|
| 0 | Decisions D1–D9 recorded on #178 | Business owner and finance sign-off |
| 1 | Warehouse kind/screen/setting; warehouse on PO, receipt, bill, SO, delivery note, invoice; sell only from the named warehouse; per-warehouse opening; Item per Warehouse view | PostgreSQL tests: receipt lands in the PO warehouse; a Jakarta invoice cannot draw Bogor stock; a WA shortage in one warehouse is settled only by a receipt into that warehouse; per-warehouse totals equal Inventory GL |
| 2 | Transfers: ship, receive (partial/multiple), Transit costing, differences report, resolution, voids | Pilot example: 100 pcs Bogor → Jakarta, receive 98, 2 visible in Transit, then resolved; FIFO and WA both exact to the cent; voids refused after a later issue; browser journey |
| 3 | Defect warehouse flows: transfer into defect, write-off, supplier return from defect; warehouse-scoped access if D1 = yes | Defect stock never offered for sale; write-off and supplier return match section 7; finance review |

Carton/piece entry on transfer lines follows DIST-03; until then lines are entered in the base unit.

## 9. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Must each warehouse's staff be limited to their own warehouse's documents? | Yes for the pilot (gap P1), as a Phase 3 item; it does not block Phases 1–2. |
| D2 | Is it acceptable that stock leaves at invoice posting (not at delivery), given the pilot invoices right after delivery? | Yes for the pilot. |
| D3 | Can a PO be received directly into the defect warehouse (goods damaged on arrival)? | No: receive into the standard warehouse, then transfer the damaged units, so the receipt matches the supplier invoice. |
| D4 | Accounts for transit losses and for amounts charged to drivers or carriers. | Finance to name the accounts; set them as company defaults. |
| D5 | Separate "inventory in transit" GL account, or keep transit inside Inventory? | Keep inside Inventory (simpler; Transit is still visible in stock reports). |
| D6 | Who may resolve a transfer difference? | Staff with transfer approve rights, after the stock audit. |
| D7 | Which warehouse do marketplace orders ship from? | One warehouse per shop connection. |
| D8 | Separate Transfer permission, or reuse Inventory Adjustments? | Separate module key, so warehouse staff can ship/receive without adjustment rights. |
| D9 | Does any existing company need its Unassigned stock moved into named warehouses before go-live? | Pilot starts with per-warehouse opening balances; others transfer Unassigned stock when they turn on warehouse mode. |

## 10. Out of scope

- Moving stock and COGS at delivery instead of invoice.
- Bin/rack locations inside a warehouse.
- Inter-company transfers.
- Automatic reorder or replenishment between warehouses.
