-- Snapshot line tax treatment on generated documents. Existing lines inherit
-- their document's setting and no historical amount is recalculated.
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "taxable" BOOLEAN;
ALTER TABLE "BillLine" ADD COLUMN "taxable" BOOLEAN;
