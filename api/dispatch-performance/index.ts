import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma, authenticate, authenticateAdmin, setCors, validateOrigin } from "../_lib.js";

// Uploads are chunked by the client; every invoice / IBT reference arrives whole
// in exactly one chunk, so "delete by key then insert" replaces it cleanly and a
// re-upload of an overlapping export never double-counts.
const MAX_ROWS_PER_REQUEST = 5000;
const UPLOAD_KINDS = ["invoice-lines", "invoice-register", "ibt"] as const;
type UploadKind = (typeof UPLOAD_KINDS)[number];
// Outstanding sales orders are a point-in-time snapshot, not history: each upload
// replaces the previous one wholesale once all its chunks have arrived.
const OUTSTANDING_KIND = "outstanding-orders";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (value: unknown, max: number) => {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const key = (value: unknown) => String(value ?? "").trim().toUpperCase().slice(0, 100);
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const date = (value: unknown) => {
  const s = String(value ?? "").trim();
  return DATE_RE.test(s) ? s : null;
};

const toInvoiceLines = (rows: Record<string, unknown>[], uploadId: string | null) => rows.map((row) => {
  const invoiceNo = key(row.invoiceNo);
  const documentDate = date(row.documentDate);
  if (!invoiceNo || !documentDate) throw new Error("Each invoice line needs an invoice number and document date");
  return {
    invoiceNo,
    lineNo: Math.max(0, Math.trunc(Number(row.lineNo) || 0)),
    documentDate,
    customer: str(row.customer, 500),
    inventoryName: str(row.inventoryName, 500),
    warehouse: str(row.warehouse, 255),
    qty: num(row.qty) ?? 0,
    unitPriceExcl: num(row.unitPriceExcl),
    totalExcl: num(row.totalExcl),
    totalIncl: num(row.totalIncl),
    uploadId,
  };
});

const toRegisterRows = (rows: Record<string, unknown>[], uploadId: string | null) => rows.map((row) => {
  const invoiceNo = key(row.invoiceNo);
  if (!invoiceNo) throw new Error("Each register row needs an invoice number");
  return {
    invoiceNo,
    salesOrder: str(row.salesOrder, 100),
    deliveryNote: str(row.deliveryNote, 100),
    dispatchDate: date(row.dispatchDate),
    dueDate: date(row.dueDate),
    customer: str(row.customer, 500),
    branch: str(row.branch, 255),
    uploadId,
  };
});

const toIbtLines = (rows: Record<string, unknown>[], uploadId: string | null) => rows.map((row) => {
  const reference = key(row.reference);
  const transactionDate = date(row.transactionDate);
  const warehouseCode = str(row.warehouseCode, 100);
  if (!reference || !transactionDate || !warehouseCode) throw new Error("Each IBT line needs a reference, date and warehouse");
  return {
    reference,
    sourceId: str(row.sourceId, 100) || "",
    transactionDate,
    inventoryCode: str(row.inventoryCode, 100),
    inventoryName: str(row.inventoryName, 500),
    warehouseCode,
    qtyIn: num(row.qtyIn) ?? 0,
    qtyOut: num(row.qtyOut) ?? 0,
    uploadId,
  };
});

const toOutstandingLines = (rows: Record<string, unknown>[], uploadId: string) => rows.map((row) => {
  const documentNo = key(row.documentNo);
  if (!documentNo) throw new Error("Each outstanding order line needs a document number");
  return {
    uploadId,
    company: str(row.company, 255),
    documentNo,
    customerCode: str(row.customerCode, 100),
    customerName: str(row.customerName, 500),
    status: str(row.status, 100),
    deliveryDate: date(row.deliveryDate),
    inventoryCode: str(row.inventoryCode, 100),
    inventoryDescription: str(row.inventoryDescription, 500),
    warehouse: str(row.warehouse, 255),
    outstandingQty: num(row.outstandingQty) ?? 0,
    unitPrice: num(row.unitPrice),
    totalExcl: num(row.totalExcl),
    dateCreated: date(row.dateCreated),
    createdBy: str(row.createdBy, 255),
  };
});

/**
 * The live snapshot is the oldest upload that still has lines: finishing an upload
 * deletes every other upload's lines, so while a newer upload is still arriving
 * (or one failed half way) the previous complete snapshot keeps showing.
 */
async function getOutstandingOrders() {
  const [upload] = await prisma.$queryRaw<{ id: string; filename: string; rows: number; uploadedBy: string | null; uploadedAt: Date }[]>`
    SELECT u."id", u."filename", u."rows", u."uploadedBy", u."uploadedAt"
    FROM "dispatch_uploads" u
    WHERE u."kind" = ${OUTSTANDING_KIND}
      AND EXISTS (SELECT 1 FROM "outstanding_order_lines" l WHERE l."uploadId" = u."id")
    ORDER BY u."uploadedAt" ASC
    LIMIT 1
  `;
  if (!upload) return { upload: null, lines: [] };
  const lines = await prisma.outstandingOrderLine.findMany({
    where: { uploadId: upload.id },
    orderBy: [{ deliveryDate: "asc" }, { documentNo: "asc" }],
    select: {
      company: true, documentNo: true, customerCode: true, customerName: true, status: true, deliveryDate: true,
      inventoryCode: true, inventoryDescription: true, warehouse: true, outstandingQty: true, unitPrice: true,
      totalExcl: true, dateCreated: true, createdBy: true,
    },
  });
  return {
    upload: {
      filename: upload.filename,
      rows: upload.rows,
      uploadedBy: upload.uploadedBy || "",
      uploadedAt: upload.uploadedAt.toISOString(),
    },
    lines,
  };
}

type InvoiceSummaryRow = {
  invoiceNo: string;
  documentDate: string | null;
  lineCustomer: string | null;
  qty: number | null;
  totalExcl: number | null;
  totalIncl: number | null;
  lineCount: number | null;
  warehouses: string | null;
  salesOrder: string | null;
  deliveryNote: string | null;
  dispatchDate: string | null;
  dueDate: string | null;
  registerCustomer: string | null;
  branch: string | null;
};

type IbtSummaryRow = {
  reference: string;
  transactionDate: string;
  qty: number;
  productCount: number;
  fromWarehouses: string | null;
  toWarehouses: string | null;
};

async function getSummary(from: string, to: string) {
  const [invoices, ibts, bounds, uploads] = await Promise.all([
    prisma.$queryRaw<InvoiceSummaryRow[]>`
      WITH l AS (
        SELECT "invoiceNo",
               MIN("documentDate") AS "documentDate",
               MAX("customer") AS "lineCustomer",
               SUM("qty")::float8 AS "qty",
               SUM("totalExcl")::float8 AS "totalExcl",
               SUM("totalIncl")::float8 AS "totalIncl",
               COUNT(*)::int AS "lineCount",
               string_agg(DISTINCT "warehouse", ', ') AS "warehouses"
        FROM "dispatch_invoice_lines"
        GROUP BY "invoiceNo"
      )
      SELECT COALESCE(l."invoiceNo", r."invoiceNo") AS "invoiceNo",
             l."documentDate", l."lineCustomer", l."qty", l."totalExcl", l."totalIncl", l."lineCount", l."warehouses",
             r."salesOrder", r."deliveryNote", r."dispatchDate", r."dueDate", r."customer" AS "registerCustomer", r."branch"
      FROM l
      FULL OUTER JOIN "dispatch_invoices" r ON r."invoiceNo" = l."invoiceNo"
      WHERE COALESCE(l."documentDate", r."dispatchDate") BETWEEN ${from} AND ${to}
    `,
    prisma.$queryRaw<IbtSummaryRow[]>`
      SELECT "reference",
             MIN("transactionDate") AS "transactionDate",
             GREATEST(SUM("qtyOut"), SUM("qtyIn"))::float8 AS "qty",
             COUNT(DISTINCT COALESCE("inventoryCode", "inventoryName"))::int AS "productCount",
             string_agg(DISTINCT CASE WHEN "qtyOut" > 0 THEN "warehouseCode" END, ', ') AS "fromWarehouses",
             string_agg(DISTINCT CASE WHEN "qtyIn" > 0 THEN "warehouseCode" END, ', ') AS "toWarehouses"
      FROM "dispatch_ibt_lines"
      GROUP BY "reference"
      HAVING MIN("transactionDate") BETWEEN ${from} AND ${to}
    `,
    prisma.$queryRaw<{ minDate: string | null; maxDate: string | null }[]>`
      SELECT MIN(d) AS "minDate", MAX(d) AS "maxDate" FROM (
        SELECT "documentDate" AS d FROM "dispatch_invoice_lines"
        UNION ALL SELECT "dispatchDate" FROM "dispatch_invoices"
        UNION ALL SELECT "transactionDate" FROM "dispatch_ibt_lines"
      ) dates
    `,
    Promise.all(UPLOAD_KINDS.map((kind) => prisma.dispatchUpload.findFirst({ where: { kind }, orderBy: { uploadedAt: "desc" } }))),
  ]);

  return {
    invoices: invoices.map((row) => ({
      invoiceNo: row.invoiceNo,
      salesOrder: row.salesOrder || "",
      deliveryNote: row.deliveryNote || "",
      branch: row.branch || "",
      lineCustomer: row.lineCustomer || "",
      registerCustomer: row.registerCustomer || "",
      documentDate: row.documentDate || "",
      dispatchDate: row.dispatchDate || "",
      dueDate: row.dueDate || "",
      qty: row.qty ?? 0,
      totalExcl: row.totalExcl ?? 0,
      totalIncl: row.totalIncl ?? 0,
      lineCount: row.lineCount ?? 0,
      warehouses: row.warehouses || "",
      hasLines: row.lineCount !== null,
      hasRegister: row.salesOrder !== null || row.dispatchDate !== null || row.dueDate !== null || row.registerCustomer !== null,
    })),
    ibts: ibts.map((row) => ({
      reference: row.reference,
      transactionDate: row.transactionDate,
      qty: row.qty ?? 0,
      productCount: row.productCount ?? 0,
      fromWarehouses: row.fromWarehouses || "",
      toWarehouses: row.toWarehouses || "",
    })),
    bounds: { minDate: bounds[0]?.minDate || "", maxDate: bounds[0]?.maxDate || "" },
    uploads: Object.fromEntries(UPLOAD_KINDS.map((kind, i) => {
      const upload = uploads[i];
      return [kind, upload ? {
        filename: upload.filename,
        rows: upload.rows,
        uploadedBy: upload.uploadedBy || "",
        uploadedAt: upload.uploadedAt.toISOString(),
      } : null];
    })),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!validateOrigin(req)) return res.status(403).json({ success: false, error: "Forbidden" });

  const user = await authenticate(req.headers.authorization);
  if (!user) return res.status(401).json({ success: false, error: "Unauthorized" });

  const action = req.query.action as string | undefined;

  try {
    if (req.method === "GET") {
      if (action === "invoice-lines") {
        const invoiceNo = key(req.query.invoiceNo);
        const lines = await prisma.dispatchInvoiceLine.findMany({ where: { invoiceNo }, orderBy: { lineNo: "asc" } });
        return res.status(200).json({ success: true, data: lines });
      }
      if (action === OUTSTANDING_KIND) {
        return res.status(200).json({ success: true, data: await getOutstandingOrders() });
      }
      if (action === "ibt-lines") {
        const reference = key(req.query.reference);
        const lines = await prisma.dispatchIbtLine.findMany({ where: { reference }, orderBy: [{ sourceId: "asc" }, { qtyOut: "desc" }] });
        return res.status(200).json({ success: true, data: lines });
      }
      const from = date(req.query.from) || "0000-01-01";
      const to = date(req.query.to) || "9999-12-31";
      return res.status(200).json({ success: true, data: await getSummary(from, to) });
    }

    if (req.method === "POST") {
      if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot upload data" });
      const body = (req.body || {}) as { kind?: string; filename?: string; rows?: unknown; uploadId?: string };

      if (action === "start-upload") {
        const kind = body.kind as UploadKind | typeof OUTSTANDING_KIND;
        if (!UPLOAD_KINDS.includes(kind as UploadKind) && kind !== OUTSTANDING_KIND) return res.status(400).json({ success: false, error: "Unknown upload kind" });
        const upload = await prisma.dispatchUpload.create({
          data: {
            kind,
            filename: str(body.filename, 1000) || "upload",
            rows: Math.max(0, Math.trunc(Number(body.rows) || 0)),
            uploadedBy: user.username,
          },
        });
        return res.status(201).json({ success: true, data: { id: upload.id } });
      }

      if (action === "finish-upload") {
        const uploadId = str(body.uploadId, 255);
        const upload = uploadId ? await prisma.dispatchUpload.findUnique({ where: { id: uploadId } }) : null;
        if (!upload || upload.kind !== OUTSTANDING_KIND) return res.status(400).json({ success: false, error: "Unknown upload" });
        const deleted = await prisma.outstandingOrderLine.deleteMany({ where: { uploadId: { not: upload.id } } });
        return res.status(200).json({ success: true, data: { replaced: deleted.count } });
      }

      const rows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : null;
      if (!rows) return res.status(400).json({ success: false, error: "rows must be an array" });
      if (rows.length > MAX_ROWS_PER_REQUEST) {
        return res.status(400).json({ success: false, error: `At most ${MAX_ROWS_PER_REQUEST} rows per request` });
      }
      const uploadId = str(body.uploadId, 255);

      if (action === "invoice-lines") {
        const data = toInvoiceLines(rows, uploadId);
        const invoiceNos = Array.from(new Set(data.map((row) => row.invoiceNo)));
        await prisma.$transaction([
          prisma.dispatchInvoiceLine.deleteMany({ where: { invoiceNo: { in: invoiceNos } } }),
          prisma.dispatchInvoiceLine.createMany({ data, skipDuplicates: true }),
        ]);
        return res.status(200).json({ success: true, data: { invoices: invoiceNos.length, rows: data.length } });
      }

      if (action === "invoice-register") {
        // Last occurrence of an invoice in the file wins.
        const byInvoice = new Map(toRegisterRows(rows, uploadId).map((row) => [row.invoiceNo, row]));
        const data = Array.from(byInvoice.values());
        await prisma.$transaction([
          prisma.dispatchInvoice.deleteMany({ where: { invoiceNo: { in: Array.from(byInvoice.keys()) } } }),
          prisma.dispatchInvoice.createMany({ data }),
        ]);
        return res.status(200).json({ success: true, data: { invoices: data.length, rows: data.length } });
      }

      if (action === OUTSTANDING_KIND) {
        const upload = uploadId ? await prisma.dispatchUpload.findUnique({ where: { id: uploadId } }) : null;
        if (!upload || upload.kind !== OUTSTANDING_KIND) return res.status(400).json({ success: false, error: "Unknown upload" });
        const result = await prisma.outstandingOrderLine.createMany({ data: toOutstandingLines(rows, upload.id) });
        return res.status(200).json({ success: true, data: { rows: result.count } });
      }

      if (action === "ibt") {
        const data = toIbtLines(rows, uploadId);
        const references = Array.from(new Set(data.map((row) => row.reference)));
        await prisma.$transaction([
          prisma.dispatchIbtLine.deleteMany({ where: { reference: { in: references } } }),
          prisma.dispatchIbtLine.createMany({ data, skipDuplicates: true }),
        ]);
        return res.status(200).json({ success: true, data: { references: references.length, rows: data.length } });
      }

      return res.status(400).json({ success: false, error: "Unknown action" });
    }

    if (req.method === "DELETE" && action === "clear") {
      if (!(await authenticateAdmin(req.headers.authorization))) return res.status(403).json({ success: false, error: "Admins only" });
      if (req.query.kind === OUTSTANDING_KIND) {
        const deleted = await prisma.outstandingOrderLine.deleteMany();
        await prisma.dispatchUpload.deleteMany({ where: { kind: OUTSTANDING_KIND } });
        return res.status(200).json({ success: true, data: { deleted: deleted.count } });
      }
      const kind = req.query.kind as UploadKind;
      if (!UPLOAD_KINDS.includes(kind)) return res.status(400).json({ success: false, error: "Unknown upload kind" });
      const deleted = kind === "invoice-lines"
        ? await prisma.dispatchInvoiceLine.deleteMany()
        : kind === "invoice-register"
          ? await prisma.dispatchInvoice.deleteMany()
          : await prisma.dispatchIbtLine.deleteMany();
      await prisma.dispatchUpload.deleteMany({ where: { kind } });
      return res.status(200).json({ success: true, data: { deleted: deleted.count } });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (error) {
    // Row validation errors from the to*() mappers are the caller's fault.
    if (error instanceof Error && /^Each .* needs/.test(error.message)) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error("dispatch-performance error", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}
