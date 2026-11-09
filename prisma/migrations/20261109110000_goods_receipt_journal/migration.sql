-- Existing receipts stay NULL; their original journal cannot be guessed.
ALTER TABLE "Bill" ADD COLUMN "receiptPostingJournalId" TEXT;
