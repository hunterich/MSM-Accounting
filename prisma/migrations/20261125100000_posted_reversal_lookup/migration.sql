-- Sales reports reconstruct dated invoice and credit-note voids by journal memo.
-- Restrict the index to posted reversals so ordinary journal writes do not add
-- entries to it. Index a fixed-length memo hash so long memos remain valid;
-- queries also compare the full memo to guard against hash collisions.
CREATE INDEX "JournalEntry_posted_reversal_lookup_idx"
ON "JournalEntry" ("organizationId", md5(memo), date)
WHERE status = 'POSTED' AND source = 'REVERSAL';
