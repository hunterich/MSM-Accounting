-- Journal numbers are never reused. Until now the next number was MAX(entryNo)+1,
-- so deleting the newest entry (reopening a fiscal year deletes its closing
-- entry) handed its number to the next journal. This table keeps the highest
-- number ever issued per organization.
CREATE TABLE "JournalEntrySequence" (
    "organizationId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntrySequence_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "JournalEntrySequence"
  ADD CONSTRAINT "JournalEntrySequence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Start every organization at the highest JE-number it has on the books.
INSERT INTO "JournalEntrySequence" ("organizationId", "lastSeq", "updatedAt")
SELECT "organizationId",
       MAX(CAST(SUBSTRING("entryNo" FROM '^JE-([0-9]+)$') AS INTEGER)),
       CURRENT_TIMESTAMP
FROM "JournalEntry"
WHERE "entryNo" ~ '^JE-[0-9]+$'
GROUP BY "organizationId";
