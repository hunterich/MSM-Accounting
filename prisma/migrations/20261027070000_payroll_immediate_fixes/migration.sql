ALTER TABLE "EmployeeCompensationItem" ADD COLUMN "postingAccountId" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN "sickCertified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PayrollRun" ADD COLUMN "reviewIssues" JSONB;
ALTER TABLE "PayrollLine" ADD COLUMN "deductionPostings" JSONB, ADD COLUMN "paidDays" DECIMAL(5,2);
ALTER TABLE "PayrollLine" ALTER COLUMN "presentDays" TYPE DECIMAL(5,2);
ALTER TABLE "PayrollLine" ALTER COLUMN "absentDays" TYPE DECIMAL(5,2);
