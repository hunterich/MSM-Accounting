-- Posted-GL summaries, date-filtered sales summaries, and marketplace duplicate
-- lookups need equality filters before date ranges / external order numbers.
CREATE INDEX "JournalEntry_organizationId_status_date_idx"
ON "JournalEntry" ("organizationId", "status", "date");

CREATE INDEX "SalesInvoice_organizationId_status_issueDate_idx"
ON "SalesInvoice" ("organizationId", "status", "issueDate");

CREATE INDEX "SalesInvoice_organizationId_poNumber_idx"
ON "SalesInvoice" ("organizationId", "poNumber");
