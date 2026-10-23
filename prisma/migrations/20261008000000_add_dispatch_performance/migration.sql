CREATE TABLE IF NOT EXISTS "dispatch_invoice_lines" (
  "id" TEXT NOT NULL,
  "invoiceNo" VARCHAR(100) NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "documentDate" VARCHAR(10) NOT NULL,
  "customer" VARCHAR(500),
  "inventoryName" VARCHAR(500),
  "warehouse" VARCHAR(255),
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unitPriceExcl" DOUBLE PRECISION,
  "totalExcl" DOUBLE PRECISION,
  "totalIncl" DOUBLE PRECISION,
  "uploadId" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dispatch_invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_invoice_lines_invoiceNo_lineNo_key" ON "dispatch_invoice_lines"("invoiceNo", "lineNo");
CREATE INDEX IF NOT EXISTS "dispatch_invoice_lines_documentDate_idx" ON "dispatch_invoice_lines"("documentDate");
CREATE INDEX IF NOT EXISTS "dispatch_invoice_lines_customer_idx" ON "dispatch_invoice_lines"("customer");

CREATE TABLE IF NOT EXISTS "dispatch_invoices" (
  "id" TEXT NOT NULL,
  "invoiceNo" VARCHAR(100) NOT NULL,
  "salesOrder" VARCHAR(100),
  "deliveryNote" VARCHAR(100),
  "dispatchDate" VARCHAR(10),
  "dueDate" VARCHAR(10),
  "customer" VARCHAR(500),
  "branch" VARCHAR(255),
  "uploadId" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dispatch_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_invoices_invoiceNo_key" ON "dispatch_invoices"("invoiceNo");
CREATE INDEX IF NOT EXISTS "dispatch_invoices_dispatchDate_idx" ON "dispatch_invoices"("dispatchDate");
CREATE INDEX IF NOT EXISTS "dispatch_invoices_dueDate_idx" ON "dispatch_invoices"("dueDate");
CREATE INDEX IF NOT EXISTS "dispatch_invoices_salesOrder_idx" ON "dispatch_invoices"("salesOrder");

CREATE TABLE IF NOT EXISTS "dispatch_ibt_lines" (
  "id" TEXT NOT NULL,
  "reference" VARCHAR(100) NOT NULL,
  "sourceId" VARCHAR(100) NOT NULL,
  "transactionDate" VARCHAR(10) NOT NULL,
  "inventoryCode" VARCHAR(100),
  "inventoryName" VARCHAR(500),
  "warehouseCode" VARCHAR(100) NOT NULL,
  "qtyIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qtyOut" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "uploadId" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dispatch_ibt_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_ibt_lines_reference_sourceId_warehouseCode_key" ON "dispatch_ibt_lines"("reference", "sourceId", "warehouseCode");
CREATE INDEX IF NOT EXISTS "dispatch_ibt_lines_transactionDate_idx" ON "dispatch_ibt_lines"("transactionDate");
CREATE INDEX IF NOT EXISTS "dispatch_ibt_lines_reference_idx" ON "dispatch_ibt_lines"("reference");

CREATE TABLE IF NOT EXISTS "dispatch_uploads" (
  "id" TEXT NOT NULL,
  "kind" VARCHAR(50) NOT NULL,
  "filename" VARCHAR(1000) NOT NULL,
  "rows" INTEGER NOT NULL DEFAULT 0,
  "uploadedBy" VARCHAR(255),
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dispatch_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dispatch_uploads_kind_uploadedAt_idx" ON "dispatch_uploads"("kind", "uploadedAt");
