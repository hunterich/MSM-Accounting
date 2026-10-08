CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" TEXT NOT NULL, "kind" TEXT NOT NULL, "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL, "bodyText" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3), "firstAttemptAt" TIMESTAMP(3), "lastError" TEXT, "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "NotificationDelivery_organizationId_key_key" ON "NotificationDelivery"("organizationId", "key");
CREATE INDEX "NotificationDelivery_status_availableAt_idx" ON "NotificationDelivery"("status", "availableAt");
CREATE TABLE "AutomationCheckpoint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "job" TEXT NOT NULL, "lastRunAt" TIMESTAMP(3) NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AutomationCheckpoint_organizationId_job_key" ON "AutomationCheckpoint"("organizationId", "job");
