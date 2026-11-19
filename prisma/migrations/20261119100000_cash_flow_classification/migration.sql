-- Existing charts need finance review; do not infer classifications from names.
ALTER TABLE "Account" ADD COLUMN "cashFlowClass" TEXT;
ALTER TABLE "Account" ADD CONSTRAINT "Account_cashFlowClass_check" CHECK ("cashFlowClass" IS NULL OR "cashFlowClass" IN ('CASH', 'OPERATING', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'LONG_TERM_LIABILITY', 'DEPRECIATION_EXPENSE'));
