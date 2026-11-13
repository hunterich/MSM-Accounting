# Warehouse stock, transfers and defect handling

**Date:** 2026-11-13 (revised the same day with business-owner feedback)
**Status:** Draft for review. Business-owner decisions recorded 13 November 2026 (section 10); finance review (D4, section 8) and engineering review still pending. Nothing is built.
**Issues:** DIST-01 [#178](https://github.com/hunterich/MSM-Accounting/issues/178) (gaps W1, P2, P3, S1, S2, T1–T3, D1, D2 in `docs/DIST-01-PILOT-FIT-GAP.md`); feeds DIST-02 #179 and DIST-04 #181.
**Reference behaviour:** Accurate Online, as shown by the business owner on 13 November 2026: *Preferences → Features → Inventory → Multiple Warehouses*, *Gudang* on sales and purchase lines with the stock of that warehouse, *Pemindahan Barang* (Transfer Out / Transfer In through a system Transit warehouse), *Gudang Barang Rusak*, and *Penyesuaian Persediaan* with *Get From → Item Transfer* and an *Akun Penyesuaian*.

## 1. Purpose

The distributor pilot runs five warehouses (Bogor, Jakarta, Surabaya, Tegal, Banten) plus a defect warehouse. Staff must see stock per warehouse, choose the warehouse on purchases and sales, move goods between warehouses with the receiving side confirming the quantity, and move damaged goods out of sellable stock for write-off or supplier return.

Today the app cannot do this (section 2). This spec proposes how to add it without breaking the approved costing rules, in three phases. Section 9 lists the decisions still needed.

### Business-owner direction (13 November 2026)

1. Every company has a **default warehouse**. Stock is never drawn from "any warehouse".
2. A **Multiple Warehouses** switch in Settings → Features. Only when it is on can users add warehouses, and only then do invoices and purchases offer a choice of warehouse.
3. Write-offs, including transfer shortfalls and damaged goods, are done with a **Stock Adjustment**, as in Accurate.

### Who should review what

| Reviewer | Focus |
|---|---|
| Business owner | Decisions recorded 13 November 2026 (section 10) |
| Finance | Section 8 (journal examples), open decision D4, and review of D5 |
| Engineering / second-opinion reviewer | Sections 3, 4.3 and 6.2 (costing constraints, default-warehouse migration, Transit costing) |

## 2. Current behaviour (code on `main`, 13 November 2026)

| Area | Today | Code |
|---|---|---|
| Warehouses | `Warehouse` has only `code` and `name`. API to create/list exists; no management screen; no type flag; no default. | `prisma/schema.prisma` `Warehouse`, `src/app/api/v1/warehouses` |
| Feature switches | Settings → Features turns modules on/off, saved on the company (`Organization.features`); disabled modules disappear from the sidebar. | `src/views/settings/Settings.tsx`, `src/components/Layout/Sidebar.tsx` |
| Purchase receipts, direct bills, opening stock | Stock is added with **no warehouse** (`warehouseId = null`). | `lib/goods-receipt-posting.ts`, `lib/bill-posting.ts`, `lib/inventory-opening.ts` |
| Sales invoices | No warehouse on the invoice. Stock is drawn **oldest-first from any warehouse, including the no-warehouse pool**. Only POS passes a warehouse. | `lib/inventory-costing.ts` `relieveCostLayers` (SALES branch), `lib/invoice-send-posting.ts` |
| Adjustments, stock counts, customer and supplier returns | Accept an optional warehouse. Adjustment lines already carry an account. | `StockAdjustment`, `StockAdjustmentLine.accountId`, `StockCount`, `SalesReturn`, `PurchaseReturn` |
| Transfers | None. `InventoryDocumentType.TRANSFER` exists but nothing writes it. | — |
| Costing | One company method (FIFO or Weighted Average). Weighted Average keeps a **separate pool per item and warehouse** (no warehouse is its own pool). Only a sale may run short (approved negative-stock policy); the next receipt into the **same pool** settles it. | `getWeightedAveragePool`, `docs/INV-02-NEGATIVE-STOCK.md` |
| Posting accounts | Each lot and movement records the item's inventory posting account (#224). | `inventoryPostingAccountId`, `lib/item-posting-accounts.ts` |

Consequence: stock received for Bogor sits in the no-warehouse pool, and a Jakarta sale can draw it.

## 3. Constraints the design must respect

1. **Do not change the approved separate-per-warehouse Weighted Average policy** (DIST-04 #181). A transfer moves value out of one pool and into another at the **source cost**; the destination's average then changes.
2. **Shortfall settlement is per warehouse pool**, so every stock movement must name exactly one warehouse. This is why the "any warehouse" sales fallback is removed (business-owner direction 1).
3. **INV-02 reversal guards stay in force.** Voiding an inbound movement is refused when a later stock issue exists for that item and warehouse (`assertNoLaterStockIssue`, `reversedAt`). Transfer voids follow the same rule on both sides.
4. **No change of value without a document.** The one-time move of existing no-warehouse stock into the default warehouse (4.3) relabels a whole pool; quantities and values stay identical and are checked before and after.
5. **Inventory subledger = GL.** Per-warehouse totals must still add up to the Inventory GL balance.
6. **Period locks, numbering, audit log and approvals** use the existing helpers (`assertPeriodOpen`, `nextNumber`, `logAuditTx`, approval engine).

## 4. Warehouses

### 4.1 Default warehouse and the Multiple Warehouses switch

- **Every company has one default warehouse**, created automatically (named "Gudang Utama" (D9), renamable). It cannot be deleted or deactivated.
- **Multiple Warehouses off (default):** all stock documents post to the default warehouse. No warehouse field is shown anywhere; the Warehouses screen is hidden. Single-warehouse companies see no change.
- **Multiple Warehouses on:** users can add warehouses, and purchases, sales, returns, adjustments, stock counts and transfers show a warehouse field, pre-filled with the user's own warehouse (D1), or the default warehouse for users with access to all.
- **Turning it off** is refused while any warehouse other than the default holds stock, or while any transfer is open. The server enforces this; the switch is not just a screen setting.

### 4.2 Where the screens go

| Screen | Location | Shown when |
|---|---|---|
| **Multiple Warehouses** switch | Settings → Features → *Inventory & Other* (next to Item Categories), like Accurate's *Inventory Features* | Always |
| **Warehouses** list and form (code, name, type, address, active, default) | Sidebar → Inventory → **Warehouses**, below Stock Adjustments. Same hide-when-off rule the sidebar already uses for features. | Switch on |
| **Stock Transfers** | Sidebar → Inventory → **Stock Transfers** | Switch on |
| **Item per Warehouse** (quantity per warehouse, including Transit) | Sidebar → Inventory, and a tab on the item form | Switch on |

Before the switch is turned on, the default warehouse can be renamed from the same Settings section.

### 4.3 Existing no-warehouse stock (one-time migration)

- The migration creates each company's default warehouse **new and empty**, then moves every no-warehouse lot and stock movement into it. Because the warehouse had no history, its pool is exactly the old no-warehouse pool: same quantity, same value, same Weighted Average.
- Stock already held in named warehouses (from adjustments, returns, POS) stays where it is. Companies that have such stock get Multiple Warehouses switched **on** by the migration, so nothing is hidden.
- A read-only audit script compares quantity and value per item and pool before and after, and per-warehouse totals against Inventory GL.
- After the migration, every new stock movement must name a warehouse (database check or application guard).

### 4.4 Warehouse types

Add to `Warehouse`: `kind` (`STANDARD` | `DEFECT` | `TRANSIT`), `isDefault`, `isActive`, optional `address`.

- `DEFECT` = Accurate's "Ya, merupakan gudang penyimpanan Barang Rusak".
- `TRANSIT` = one system warehouse per company, created when Multiple Warehouses is first turned on; not editable and never chosen on a document.

| | STANDARD | DEFECT | TRANSIT |
|---|---|---|---|
| Receive from PO / bill | Yes | No (D3) | No |
| Sell from (invoice, POS, delivery) | Yes | **No**; not counted as available to sell | No |
| Customer return into | Yes | Yes (damaged returns) | No |
| Transfer from / to | Yes | Yes | System only |
| Supplier return from | Yes | Yes | No |
| Stock adjustment / stock count | Yes | Yes | Only a reduction created from a transfer (6.4) |

## 5. Warehouse on purchase and sales documents (Phase 1)

### Purchasing
- `PurchaseOrder.warehouseId` (destination). The pilot rule is one destination warehouse per PO; it defaults to the default warehouse.
- PO receipts add stock to the PO's warehouse (`postGoodsReceiptToLedger` passes it to `addCostLayer`). Direct bills get `Bill.warehouseId`.
- Shortfall settlement then happens in the right pool automatically, because it already runs inside `addCostLayer`.

### Sales
- `SalesOrder.warehouseId`, copied to delivery notes and to the invoice (`SalesInvoice.warehouseId`).
- Invoice posting passes the invoice warehouse to `calculateAndPostCOGS`, so stock is drawn **only from that warehouse**. The "any warehouse" fallback in `relieveCostLayers` is removed.
- When adding a line, the item picker shows the stock and "can be sold" quantity **of the chosen warehouse**, as Accurate does.
- Available-to-sell excludes `DEFECT` and `TRANSIT` warehouses.
- **Timing:** stock keeps leaving at invoice posting, as today (D2, decided).
- Related pilot fixes tracked separately: invoice only delivered quantities (S2) and the delivery-note completion status defect (S3).

### Header or line warehouse
Accurate puts *Gudang* on each line. The pilot rule is one warehouse per order, so this spec puts the warehouse on the **document header** and copies it to every line. Decided (D10): one warehouse per document, pre-filled with the user's own warehouse. Per-line warehouses could be added later without changing the stock model.

### Other stock sources
- Opening balances are entered per warehouse (stock adjustment additions, or the migration import).
- Marketplace imports take stock from the warehouse chosen on each shop connection in the e-commerce settings (D7). POS already has one per register.

## 6. Stock transfers (Phase 2)

### Documents
One `StockTransfer` per shipment, with lines; the receiving side records one or more receipts against it (Accurate: Transfer Out, then Transfer In with **Get From**).

- `StockTransfer`: number (`TRF-…`), from warehouse, to warehouse, ship date, status, notes, created by.
- `StockTransferLine`: item, `qtyShipped`, `valueShipped`, `qtyReceived`, `qtyWrittenOff`; quantities in the base unit (carton entry comes with DIST-03).
- `StockTransferReceipt` + lines: receipt date, receiving user, quantity received per line, notes.

### 6.1 Ship (Transfer Out)
1. Check the source has the stock. **Transfers may never run short**, even when negative stock is allowed (that policy covers only sales).
2. For each line, relieve stock from the source at its cost (FIFO layers or the warehouse's Weighted Average pool) with the existing relief code, `documentType = TRANSFER`.
3. Add the same quantity and **exact value** to the company's `TRANSIT` warehouse, one lot per source draw, tagged with the transfer id and carrying the source lots' inventory posting account.
4. Status **Sending**.

### 6.2 Receive (Transfer In)
1. The receiving warehouse picks the transfer and enters the quantity that actually arrived per line (may be less than shipped, never more).
2. Draw those units from **this transfer's** Transit lots only, at their recorded values (specific identification, never a Transit average), and add them to the destination at that value. The destination's Weighted Average then blends normally.
3. Status **Partially received** or **Fully received**. Several receipts are allowed until nothing is outstanding.

Transit is costed by specific identification, so it must be excluded from the Weighted Average pool calculation and from `refreshWarehouseCarryingValues`, which would otherwise spread one transfer's value onto another's lots. **Reviewers should check this carefully.**

### 6.3 Keeping the difference visible
After receiving 98 of 100, the 2 pcs stay in Transit **on that transfer**:
- The transfer shows *Partially received, 2 pcs outstanding*.
- Item per Warehouse shows 2 pcs in Transit.
- An **Open transfer differences** report lists every outstanding line with its age, value and warehouses, for the stock audit.

### 6.4 Resolving a difference
After the stock audit, an outstanding quantity is settled in one of two ways:

| Outcome | How |
|---|---|
| Goods found or arrive later | Another Transfer In on the same transfer (6.2). |
| Lost, damaged in transit, or charged to the driver | A **Stock Adjustment** using **Get From → Stock Transfer** (as in Accurate). It fills in the transfer's outstanding lines as reductions from Transit, at those lots' recorded values. Each line's adjustment account (*Akun Penyesuaian*) is pre-filled from the company defaults below and can be changed (decision D4). Posting the adjustment updates `qtyWrittenOff` on the transfer. |

The transfer becomes **Closed with difference** once nothing is outstanding. The adjustment keeps its usual approval, audit and void rules; voiding it returns the units to this transfer's Transit stock and reopens the line.

#### Adjustment accounts (D4)
Recommended accounts. These are pending confirmation by the head accountant. There is no seeded chart of accounts, so each company maps them to its own accounts:

| Situation | Account (type) | Notes |
|---|---|---|
| Lost or damaged in transit, company bears it | *Beban Barang Rusak / Hilang* (Expense) | The same account as the defect-warehouse write-off (section 7), so total damage and loss shows on one line. |
| Charged to the company's own driver | *Piutang Karyawan* (current Asset) | Settled later by salary deduction or cash. |
| Charged to an outside courier or expedition | *Piutang Lain-lain* (current Asset) | Settled when the courier pays or the amount is deducted from its invoice. Not the trade receivable control account; the adjustment screen already refuses control accounts. |
| Count difference with no known cause (stock counts, ordinary adjustments) | Existing *Inventory Adjustment / Variance* default (*Selisih Persediaan*) | Unchanged. |

How the choice works:
- **Company defaults:** two new account defaults, *Transit loss expense* and *Transit charge receivable*, in the account defaults settings. Only users who can edit company settings (the head accountant or administrator) change them. Changing a default affects new documents only.
- **Per document:** Get From → Stock Transfer pre-fills each line with *Transit loss expense*. The user can switch a line to the receivable, or to any other permitted account, as with Accurate's *Akun Penyesuaian*.
- **Review:** the adjustment approval rules (D6) let the approver (for example, the head accountant) see and reject the chosen accounts before anything posts. After posting, a wrong account is corrected by voiding and re-entering the adjustment.
- **Prerequisite (existing limitation):** today an adjustment line's account is saved but not used for posting. The net difference always goes to the variance default (see `docs/DOCUMENT-OFFSET-ACCOUNTS.md`). Phase 2 must change stock-adjustment posting to credit or debit each line's own account, falling back to the default when a line has none. This also affects ordinary adjustments, so finance must accept it.

### 6.5 Edits and voids
- A shipped transfer is not edited; it is voided and re-created.
- **Void a receipt:** only if the destination has no later stock issue of that item (INV-02 rule); units return to this transfer's Transit lots at the same value.
- **Void a transfer:** only when no receipt or linked adjustment is active; units return from Transit to the source at their original value, subject to the same later-issue guard.
- Reversed movements are marked `reversedAt` like other voids.

### 6.6 Permissions
- New module key `INV_TRANSFERS` (D8, decided): create = ship, edit = receive, approve = void.
- Writing off a difference uses the existing Stock Adjustments permission and approval rules.
- Optional `STOCK_TRANSFER` approval type for transfers above a value threshold.
- Warehouse-scoped access (D1, decided): users act only on their assigned warehouses. Shipping requires access to the source warehouse; receiving requires access to the destination.
- Separation of duties (D1a, decided): the server refuses a Transfer In recorded by the same user who recorded that transfer's Transfer Out, unless an administrator has allowed that user to do both.

## 7. Defect warehouse (Phase 3)

1. Damaged goods are moved to the defect warehouse with a transfer, or received there directly as a damaged customer return.
2. **Write off** (Accurate Option A): a **Stock Adjustment** reduction with warehouse = defect warehouse and the adjustment account set to an expense such as *Beban Barang Rusak*. This uses the existing adjustment screen; no new document.
3. **Return to supplier** (Option B): a purchase return with warehouse = defect warehouse.

## 8. Journal examples (for finance)

Assume one company Inventory account, Weighted Average, Bogor average Rp 10,000/pcs.

| Step | Stock ledger | Journal entry |
|---|---|---|
| Ship 100 pcs Bogor → Jakarta | Bogor −100 / −1,000,000; Transit +100 / +1,000,000 | **None**: both sides use the same Inventory account. (D5 decided: transit stays inside Inventory. A separate in-transit account would instead post Dr In-transit 1,000,000 / Cr Inventory 1,000,000.) |
| Jakarta receives 98 | Transit −98 / −980,000; Jakarta +98 / +980,000 | None. |
| Write off 2 lost pcs (adjustment from transfer) | Transit −2 / −20,000 | Dr Beban Barang Rusak / Hilang 20,000 / Cr Inventory 20,000 |
| Charge 2 pcs to driver (adjustment from transfer) | Transit −2 / −20,000 | Dr Piutang Karyawan (own driver) or Piutang Lain-lain (outside courier) 20,000 / Cr Inventory 20,000 |
| Move 5 damaged pcs Jakarta → Defect | Same pattern as the first two rows | None |
| Write off damaged stock (adjustment in defect warehouse) | Defect −5 at defect pool cost | Dr Beban Barang Rusak / Cr Inventory |
| Return damaged stock to supplier | Defect −5 at defect pool cost | Existing purchase-return posting with warehouse = Defect: Dr AP-return clearing / Cr Inventory at cost. The debit note then posts Dr AP / Cr AP-return clearing at the agreed return price, which settles any price-cost difference. |

If an item's lots carry different historical inventory accounts, the transfer moves value between those accounts with an explicit journal entry, so the subledger and GL stay equal.

## 9. Phases and acceptance

| Phase | Scope | Done when |
|---|---|---|
| 0 | Business owner decisions recorded (D1–D3, D5–D10, 13 Nov). D4 recommended accounts awaiting the head accountant; finance review of section 8 | Finance sign-off |
| 1 | Default warehouse and migration (4.3); Multiple Warehouses switch; Warehouses screen; warehouse on PO, receipt, bill, SO, delivery note, invoice; remove the "any warehouse" fallback; per-warehouse stock on item entry; Item per Warehouse | PostgreSQL tests: migration keeps every pool's quantity and value; with the switch off everything posts to the default warehouse; a Jakarta invoice cannot draw Bogor stock; a WA shortage is settled only by a receipt into the same warehouse; turning the switch off is refused while other warehouses hold stock; per-warehouse totals equal Inventory GL |
| 2 | Transfers: ship, receive (partial/multiple), Transit costing, differences report, adjustment Get From transfer, voids; per-line adjustment account posting and the two transit account defaults (6.4, D4) | Pilot example: 100 pcs Bogor → Jakarta, receive 98, 2 visible in Transit, then written off by an adjustment; FIFO and WA exact to the cent; voids refused after a later issue; browser journey |
| 3 | Defect warehouse flows; warehouse-scoped access if D1 = yes | Defect stock never offered for sale; write-off and supplier return match section 8; finance review |

## 10. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Must each warehouse's staff be limited to their own warehouse's documents? | **Decided (business owner, 13 Nov): yes.** The administrator assigns users to warehouses; a user sees and acts only on their assigned warehouses (for example, a Surabaya admin cannot see other warehouses). Phase 3; does not block Phases 1–2. |
| D1a | Can the same user ship and receive one transfer? | **Decided (business owner, 13 Nov): no**, unless an administrator allows it for that user. The Transfer In must be recorded by a different user from the Transfer Out. |
| D2 | Is it acceptable that stock leaves at invoice posting (not at delivery), given the pilot invoices right after delivery? | **Decided (business owner, 13 Nov): yes**, at invoice posting for the pilot. |
| D3 | Can a PO be received directly into the defect warehouse (damaged on arrival)? | **Decided (business owner, 13 Nov): no.** Receive into a standard warehouse, then transfer the damaged units, so the receipt matches the supplier invoice. |
| D4 | Accounts for transit losses and for amounts charged to drivers or carriers. | **Recommended, awaiting the head accountant:** *Beban Barang Rusak / Hilang* for company-borne losses; *Piutang Karyawan* (own driver) or *Piutang Lain-lain* (outside courier) for charged amounts. These are company defaults the head accountant can change, and users can override them per line, subject to approval (6.4). |
| D5 | Separate "inventory in transit" GL account, or keep transit inside Inventory? | **Decided (business owner, 13 Nov): keep inside Inventory.** Transfers post no journal entry; Transit is visible in stock reports. Finance may still review. |
| D6 | Who may write off a transfer difference? | **Decided (business owner, 13 Nov):** staff with Stock Adjustment rights, after the stock audit, following the adjustment approval rules. |
| D7 | Which warehouse do marketplace orders ship from? | **Decided (business owner, 13 Nov): one warehouse per shop**, chosen in the e-commerce (shop connection) settings. |
| D8 | Separate Stock Transfer permission, or reuse Stock Adjustments? | **Decided (business owner, 13 Nov): separate**, so warehouse staff can ship and receive without adjustment rights. |
| D9 | Name of the default warehouse created by the migration. | **Decided (business owner, 13 Nov): "Gudang Utama"**, renamable. |
| D10 | Warehouse on the document header (pilot rule) or on each line (Accurate)? | **Decided (business owner, 13 Nov): one per document**, pre-filled with the user's own warehouse and copied to every line. |

## 11. Out of scope

- Moving stock and COGS at delivery instead of invoice.
- Bin/rack locations inside a warehouse.
- Branches (Accurate *Multiple Branches*) and inter-company transfers.
- Automatic reorder or replenishment between warehouses.
