# Feature Flow Spec: Costing Method Setup and Partial Fulfillment

> Scope: Phase 1.3 Sales Order partial fulfillment and Phase 1.4 inventory valuation setup/switching.
> Anchored to current codebase behavior as of 2026-04-01.

## 1. Current Baseline

### Auth and first app entry
- Login completes through `src/pages/Login.jsx`.
- Session bootstrap runs through `src/components/auth/ProtectedRoute.jsx` and `src/stores/useAuthStore.ts`.
- Session payload currently returns only `user`, `org`, and `role` from `src/app/api/v1/auth/me/route.ts`.

### Company/settings
- Company profile currently exists in `src/pages/company/CompanySetup.jsx`.
- General settings currently persist only to local Zustand state in `src/stores/useSettingsStore.ts`.
- Organization-level accounting preferences are not yet persisted server-side.

### Sales order flow
- Sales orders currently support `DRAFT`, `CONFIRMED`, `INVOICED`, and `CANCELLED` in `prisma/schema.prisma`.
- Sales order lines only store ordered quantity and price in `SalesOrderItem`.
- SO to invoice conversion currently invoices the full order in one step from `src/app/api/v1/sales-orders/[id]/convert/route.ts`.
- Delivery Note and partial-fulfillment records do not exist yet.

## 2. Product Goals

### Inventory valuation
- Every organization must have one active costing method for inventory valuation.
- The first time an organization starts using inventory/accounting features, an authorized user must choose the costing method.
- The organization can switch methods later, but only through an explicit controlled flow with recalculation and audit logging.

### Sales order fulfillment
- Users can deliver only part of a sales order.
- Delivered quantity, invoiced quantity, and remaining quantity must be visible per line.
- Invoice conversion must support invoicing only delivered quantities, not always the entire order.

## 3. Costing Method Setup Flow

### 3.1 Trigger
- After successful login and session bootstrap, fetch organization accounting settings from the backend.
- If `costingMethod` is missing:
  - If the user has company/settings access, show a blocking onboarding step before entering the main workspace.
  - If the user does not have access, show a blocking notice that inventory valuation setup is pending and requires an administrator.

### 3.2 Placement
- Reuse the existing company configuration surface instead of creating a separate wizard.
- Recommended route: `Company Setup` with a focused first-run step or modal.
- Recommended section title: `Inventory Valuation Method`.

### 3.3 UI
- Show two cards:
  - `FIFO`
    - Uses oldest stock costs first.
    - Better when purchase prices move often and stock layers matter.
  - `Weighted Average`
    - Recomputes one rolling average cost after each receipt.
    - Simpler daily operation and easier for teams that do not want layer management.
- Require the user to choose one option before continuing.
- Show a short note:
  - This setting controls COGS and stock valuation for future transactions.

### 3.4 Save behavior
- Persist to the organization record, not local browser state.
- Save these fields at minimum:
  - `costingMethod`
  - `costingMethodSetAt`
  - `costingMethodSetById`
  - `costingMethodEffectiveDate`
- Default effective date:
  - Use organization go-live date if available.
  - Otherwise use fiscal year start.
  - If neither exists, use current date and force confirmation.

### 3.5 First-run completion
- Once saved:
  - allow entry to the app
  - store the value in session/bootstrap data
  - show the active method in Settings and Company Setup

## 4. Costing Method Switch Flow

### 4.1 Entry point
- Add a new section under Settings or Company Setup:
  - `Inventory Valuation`
- Show:
  - current method
  - effective date
  - last changed by
  - last changed at
  - button: `Change Method`

### 4.2 Permission rule
- Only users with settings/company administration access can change the method.
- Everyone else can view the current method read-only.

### 4.3 Confirmation flow
- Clicking `Change Method` opens a confirmation dialog with:
  - current method
  - new method
  - effective date input
  - warning that historical valuation and COGS may be recalculated from the effective date forward
  - warning that reports may change after recalculation
- Require a typed confirmation such as:
  - `SWITCH COSTING METHOD`

### 4.4 Recalculation rule
- Switching method must not silently mutate old balances without traceability.
- Recommended behavior:
  - create a valuation recalculation job
  - recompute inventory layers / moving average from the chosen effective date forward
  - update dependent stock valuation and COGS records
  - log the change and recalculation scope in audit logs

### 4.5 Guardrails
- Block switching while a recalculation job is already running.
- Warn if there are backdated inventory transactions after the effective date.
- If the organization already has posted periods, require the effective date to start in an open period unless the user has elevated finance/admin permission.

### 4.6 Suggested user-facing states
- `Active`
- `Pending recalculation`
- `Recalculation failed`
- `Recalculated successfully`

## 5. Partial Fulfillment Flow

### 5.1 New concepts
- `Delivery Note`
  - records each shipment / handover event
- `Delivered quantity`
  - cumulative quantity already fulfilled per sales-order line
- `Invoiced quantity`
  - cumulative quantity already billed per sales-order line
- `Remaining quantity`
  - ordered minus delivered
- `Billable quantity`
  - delivered minus invoiced

### 5.2 Sales Order statuses
- Replace the current simplified progression with fulfillment-aware statuses:
  - `DRAFT`
  - `CONFIRMED`
  - `PARTIALLY_DELIVERED`
  - `DELIVERED`
  - `PARTIALLY_INVOICED`
  - `INVOICED`
  - `CLOSED`
  - `CANCELLED`

### 5.3 Header-level behavior
- Sales Order detail page should show summary chips:
  - ordered lines
  - delivered lines
  - invoiced lines
  - remaining qty
- Add actions:
  - `Create Delivery Note`
  - `Convert Delivered Qty to Invoice`
  - `View Fulfillment History`

### 5.4 Line-level behavior
- Each sales-order line should store or expose:
  - `orderedQty`
  - `deliveredQty`
  - `invoicedQty`
  - `remainingQty`
  - `billableQty`
- In the detail tab, display a fulfillment strip like:
  - `Ordered 100 | Delivered 40 | Invoiced 20 | Remaining 60`

### 5.5 Delivery Note flow
- User opens `Create Delivery Note` from a confirmed sales order.
- Default each line’s deliverable quantity to:
  - ordered minus already delivered
- User can enter a lower quantity for partial shipment.
- On save:
  - create delivery-note header and lines
  - increment `deliveredQty` on the source SO lines
  - update SO status:
    - any delivered but not all -> `PARTIALLY_DELIVERED`
    - all delivered -> `DELIVERED`

### 5.6 Invoice conversion flow
- Replace the current all-lines conversion with a quantity-aware flow.
- When user clicks `Convert to Invoice`, show options:
  - `Delivered qty ready to bill`
  - `All remaining qty`
  - `Manual selection`
- Default option should be `Delivered qty ready to bill`.
- For each included line:
  - invoice quantity must not exceed `billableQty`
- On save:
  - create invoice lines only for selected billable quantities
  - increment `invoicedQty` on source SO lines
  - update SO status:
    - delivered exists, partially billed -> `PARTIALLY_INVOICED`
    - fully billed -> `INVOICED`
    - fully delivered and fully billed and no open qty -> `CLOSED`

### 5.7 Edge cases
- Over-delivery is not allowed unless explicitly enabled later.
- Cancelling a Delivery Note must reverse delivered quantities.
- Cancelling an invoice converted from SO must reverse invoiced quantities if the invoice never became final/posted.
- If a line is manually closed with undelivered remainder, keep an audit reason.

## 6. Data Model Changes

### 6.1 Organization
- Add to `Organization`:
  - `costingMethod`
  - `costingMethodSetAt`
  - `costingMethodSetById`
  - `costingMethodEffectiveDate`
  - `costingMethodStatus` or recalculation status if needed

### 6.2 Sales Order
- Extend `SoStatus`.
- Consider header aggregates for faster UI reads:
  - `deliveryStatus`
  - `invoiceStatus`
  - `totalOrderedQty`
  - `totalDeliveredQty`
  - `totalInvoicedQty`

### 6.3 SalesOrderItem
- Add:
  - `deliveredQty`
  - `invoicedQty`
  - `closedQty` if line-level closure is needed

### 6.4 New delivery models
- `DeliveryNote`
  - `id`
  - `organizationId`
  - `salesOrderId`
  - `number`
  - `deliveryDate`
  - `status`
  - `notes`
  - `createdById`
- `DeliveryNoteLine`
  - `id`
  - `deliveryNoteId`
  - `salesOrderItemId`
  - `quantity`
  - `itemId`
  - `description`
  - `unit`

### 6.5 Inventory valuation support
- Add an enum:
  - `InventoryCostingMethod = FIFO | WEIGHTED_AVERAGE`
- Add an audit table or job table if recalculation can run asynchronously.

## 7. API Changes

### Auth/session bootstrap
- Extend `GET /api/v1/auth/me` to include organization accounting setup flags:
  - `costingMethod`
  - `costingMethodEffectiveDate`
  - `needsInventoryValuationSetup`

### Organization settings
- Add organization settings endpoint if not already present:
  - `GET /api/v1/organization/settings`
  - `PUT /api/v1/organization/settings`
- This endpoint should own costing-method persistence, not local Zustand.

### Sales orders
- Update sales-order list/detail responses to include delivered/billed quantities.
- Change SO conversion endpoint to accept explicit quantities by line instead of blindly converting all lines.

### Delivery notes
- Add CRUD endpoints for delivery-note creation and viewing.

## 8. Frontend Changes

### Login/bootstrap
- After `checkSession()`, branch on `needsInventoryValuationSetup`.
- If true:
  - redirect authorized user to Company Setup onboarding state
  - otherwise show a blocked-access notice

### Settings and company pages
- Add an `Inventory Valuation` card to:
  - `src/pages/company/CompanySetup.jsx`
  - or `src/pages/settings/Settings.jsx`
- This card should read from API-backed org settings, not `useSettingsStore` persistence.

### Sales order workspace
- Update `src/pages/ar/SalesOrderWorkbench.jsx` and detail tabs to show fulfillment progress.
- Add delivery-note creation entry point.
- Replace the one-click conversion with a quantity-selection modal.

## 9. Recommended Delivery Order

1. Persist organization costing method in Prisma and expose it in auth/bootstrap.
2. Add first-run blocking setup for authorized users.
3. Add read-only display of active costing method in settings.
4. Add controlled switching flow with audit log and recalculation job placeholder.
5. Extend sales-order schema for delivered/invoiced quantities.
6. Build Delivery Note create/view flow.
7. Make invoice conversion quantity-aware.
8. Add fulfillment summaries and reports.

## 10. Definition of Done

### Costing method
- New org cannot proceed into inventory/accounting without an active costing method.
- Current method is visible in Settings and Company Setup.
- Method changes create an audit trail and a recalculation record.

### Partial fulfillment
- A sales order can be delivered in multiple batches.
- Delivered and invoiced quantities are visible per line.
- Invoice conversion can bill only delivered quantities.
- Sales-order statuses reflect partial and full fulfillment correctly.
