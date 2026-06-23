ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "truckSize" VARCHAR(50);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "hasFlowbin" BOOLEAN DEFAULT false;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;

CREATE TABLE IF NOT EXISTS "flowbin_batches" (
  "id" TEXT NOT NULL,
  "jobId" VARCHAR(255) NOT NULL,
  "batchNumber" VARCHAR(255) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "quantityReturned" INTEGER,
  "returnedAt" TIMESTAMP(3),
  "returnNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "flowbin_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "flowbin_batches_jobId_idx" ON "flowbin_batches"("jobId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'flowbin_batches_jobId_fkey'
  ) THEN
    ALTER TABLE "flowbin_batches"
      ADD CONSTRAINT "flowbin_batches_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
