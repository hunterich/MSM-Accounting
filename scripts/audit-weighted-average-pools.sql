-- Read-only pre-release diagnostic. Original receipt prices are not carrying
-- values under Weighted Average; this checks booked pools against quantities.
-- Every warehouse is separate; NULL is the unassigned-stock pool.
-- A negative pool is expected only while tracked sale shortage estimates await
-- a receipt (approved 2026-10-15); it must equal minus their uncovered part.
-- Untracked (legacy) negative stock is listed for review, never reconstructed.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
WITH movements AS (
  SELECT e."organizationId", e."itemId", e."warehouseId" AS warehouse,
         sum(e."qtyIn" - e."qtyOut") AS quantity, sum(e."valueChange") AS value
  FROM "InventoryLedgerEntry" e JOIN "Organization" o ON o.id = e."organizationId"
  WHERE o."costingMethod" = 'WEIGHTED_AVERAGE'
  GROUP BY e."organizationId", e."itemId", e."warehouseId"
), physical AS (
  SELECT l."organizationId", l."itemId", l."warehouseId" AS warehouse, sum(l."qtyBalance") AS quantity
  FROM "InventoryLot" l JOIN "Organization" o ON o.id = l."organizationId"
  WHERE o."costingMethod" = 'WEIGHTED_AVERAGE' AND l."qtyBalance" > 0
  GROUP BY l."organizationId", l."itemId", l."warehouseId"
), settled AS (
  SELECT s."saleDrawId", sum(s."quantity") AS quantity, sum(s."estimatedValue") AS value
  FROM "InventoryShortfallSettlement" s WHERE s."reversedAt" IS NULL GROUP BY s."saleDrawId"
), shortfalls AS (
  SELECT e."organizationId", e."itemId", e."warehouseId" AS warehouse,
         sum(d."quantity" - coalesce(t.quantity, 0)) AS quantity,
         sum(coalesce(d."costValue", 0) - coalesce(t.value, 0)) AS value
  FROM "InventoryLotDraw" d
  JOIN "InventoryLedgerEntry" e ON e.id = d."ledgerEntryId"
  JOIN "Organization" o ON o.id = e."organizationId"
  LEFT JOIN settled t ON t."saleDrawId" = d.id
  WHERE o."costingMethod" = 'WEIGHTED_AVERAGE' AND d."shortfall"
    AND e."documentType" = 'SALES' AND e."reversedAt" IS NULL
  GROUP BY e."organizationId", e."itemId", e."warehouseId"
), pools AS (
  SELECT coalesce(m."organizationId", p."organizationId") AS organization_id,
         coalesce(m."itemId", p."itemId") AS item_id,
         coalesce(m.warehouse, p.warehouse) AS warehouse_id,
         coalesce(m.quantity, 0) AS ledger_quantity, coalesce(p.quantity, 0) AS physical_quantity,
         coalesce(m.value, 0) AS book_value,
         coalesce(s.quantity, 0) AS uncovered_shortfall_quantity, coalesce(s.value, 0) AS uncovered_shortfall_estimate
  FROM movements m FULL JOIN physical p
    ON m."organizationId" = p."organizationId" AND m."itemId" = p."itemId"
    AND m.warehouse IS NOT DISTINCT FROM p.warehouse
  LEFT JOIN shortfalls s
    ON s."organizationId" = coalesce(m."organizationId", p."organizationId") AND s."itemId" = coalesce(m."itemId", p."itemId")
    AND s.warehouse IS NOT DISTINCT FROM coalesce(m.warehouse, p.warehouse)
)
SELECT *, CASE
  WHEN ledger_quantity < 0 AND physical_quantity = 0 AND uncovered_shortfall_quantity = -ledger_quantity
    AND uncovered_shortfall_estimate = -book_value THEN 'tracked shortage estimate awaiting receipt (informational)'
  WHEN ledger_quantity < 0 THEN 'negative-stock pool without complete estimate tracking: separate review required'
  WHEN uncovered_shortfall_quantity > 0 THEN 'uncovered shortage estimate beside non-negative stock'
  WHEN ledger_quantity = 0 AND book_value <> 0 THEN 'value without quantity'
  WHEN ledger_quantity <> physical_quantity THEN 'quantity/scope mismatch'
  WHEN book_value < 0 THEN 'negative value with positive quantity'
END AS finding
FROM pools
WHERE ledger_quantity < 0 OR uncovered_shortfall_quantity > 0 OR (ledger_quantity = 0 AND book_value <> 0)
   OR ledger_quantity <> physical_quantity OR book_value < 0
ORDER BY organization_id, item_id, warehouse_id NULLS FIRST;
ROLLBACK;
