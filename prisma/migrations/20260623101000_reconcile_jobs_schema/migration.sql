ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "createdById" VARCHAR(255);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "overdueReason" TEXT;

CREATE INDEX IF NOT EXISTS "jobs_createdAt_idx" ON "jobs"("createdAt");
CREATE INDEX IF NOT EXISTS "jobs_eta_idx" ON "jobs"("eta");
CREATE INDEX IF NOT EXISTS "jobs_ref_idx" ON "jobs"("ref");
CREATE INDEX IF NOT EXISTS "jobs_createdById_idx" ON "jobs"("createdById");
