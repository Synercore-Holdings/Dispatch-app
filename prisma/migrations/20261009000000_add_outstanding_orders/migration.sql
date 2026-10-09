CREATE TABLE IF NOT EXISTS "outstanding_order_lines" (
  "id" TEXT NOT NULL,
  "uploadId" VARCHAR(255) NOT NULL,
  "company" VARCHAR(255),
  "documentNo" VARCHAR(100) NOT NULL,
  "customerCode" VARCHAR(100),
  "customerName" VARCHAR(500),
  "status" VARCHAR(100),
  "deliveryDate" VARCHAR(10),
  "inventoryCode" VARCHAR(100),
  "inventoryDescription" VARCHAR(500),
  "warehouse" VARCHAR(255),
  "outstandingQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unitPrice" DOUBLE PRECISION,
  "totalExcl" DOUBLE PRECISION,
  "dateCreated" VARCHAR(10),
  "createdBy" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "outstanding_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outstanding_order_lines_uploadId_idx" ON "outstanding_order_lines"("uploadId");
