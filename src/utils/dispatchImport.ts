// Parsers for the three ERP exports that feed the Dispatch Performance view:
//   1. Invoice lines     (Document Date, Document No, Customer Name, Inventory Name, Warehouse, Qty, Totals)
//   2. Invoice register  (Invoice No, Source Sales Order, Invoice Delivery, Dispatch Date, Delivery / Due Date, Customer)
//                         with "Branch: <name> (Count=n)" group rows between invoices
//   3. IBT transactions  (id, Reference, TransactionDate, DocumentType, InventoryCode, InventoryName, WarehouseCode, QtyIn, QtyOut)
// plus the outstanding sales orders snapshot that feeds the Outstanding Sales Orders view:
//   4. Outstanding orders (Document No, Customer, Status, Delivery Date, Inventory, Warehouse, Outstanding Qty, Totals)
//
// Every parser finds its header row by name (exports sometimes carry title rows),
// normalises dates to YYYY-MM-DD and returns rows ready for /api/dispatch-performance.

export interface InvoiceLineUpload {
  invoiceNo: string;
  lineNo: number;
  documentDate: string;
  customer: string;
  inventoryName: string;
  warehouse: string;
  qty: number;
  unitPriceExcl: number | null;
  totalExcl: number | null;
  totalIncl: number | null;
}

export interface InvoiceRegisterUpload {
  invoiceNo: string;
  salesOrder: string;
  deliveryNote: string;
  dispatchDate: string;
  dueDate: string;
  customer: string;
  branch: string;
}

export interface IbtLineUpload {
  reference: string;
  sourceId: string;
  transactionDate: string;
  inventoryCode: string;
  inventoryName: string;
  warehouseCode: string;
  qtyIn: number;
  qtyOut: number;
}

export interface ParseResult<T> {
  rows: T[];
  skipped: number;
  warnings: string[];
  minDate: string;
  maxDate: string;
}

type DateOrder = "dmy" | "mdy";

const normalizeHeader = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cellText = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value ?? "")).trim();

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  return `${y}-${pad(m)}-${pad(d)}`;
};

const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\D|$)/;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)/;

/** Parse an Excel/CSV date cell to YYYY-MM-DD. Slash dates default to day-first (South African exports). */
export const parseDate = (value: unknown, order: DateOrder = "dmy"): string => {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    // ExcelJS returns date-only cells as UTC midnight.
    return isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") {
    // Excel serial date (days since 1899-12-30).
    if (value < 20000 || value > 80000) return "";
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = String(value).trim();
  const iso = text.match(ISO_DATE);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = text.match(SLASH_DATE);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    return order === "dmy" ? isoDate(y, b, a) : isoDate(y, a, b);
  }
  if (/^\d+(\.\d+)?$/.test(text)) return parseDate(Number(text), order);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return isoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
};

/** Day-first unless some value in the column can only be month-first (e.g. 07/25/2026). */
export const detectDateOrder = (values: unknown[]): DateOrder => {
  let dayFirstImpossible = false;
  for (const value of values) {
    if (typeof value !== "string") continue;
    const match = value.trim().match(SLASH_DATE);
    if (!match) continue;
    if (Number(match[1]) > 12) return "dmy";
    if (Number(match[2]) > 12) dayFirstImpossible = true;
  }
  return dayFirstImpossible ? "mdy" : "dmy";
};

/** "R78,312.00", "1 250.00", "(3.00)" -> number. Blank -> null. */
export const parseAmount = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value ?? "").trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  text = text.replace(/[^0-9.,]/g, "");
  // Treat a trailing ",dd" as a decimal comma only when there is no dot.
  if (!text.includes(".") && /,\d{1,2}$/.test(text)) text = text.replace(/,(\d{1,2})$/, ".$1");
  text = text.replace(/,/g, "");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
};

type ColumnSpec<K extends string> = Record<K, string[]>;

/**
 * Locate the header row (within the first 30 rows) that contains every required column,
 * then map each field to a column index. Exact header matches win; a header that extends
 * an alias ("Invoice Delivery No") or is a truncated alias ("Delivery / Due D") is a fallback.
 */
const findColumns = <S extends ColumnSpec<string>>(rows: unknown[][], spec: S, required: (keyof S & string)[]) => {
  type K = keyof S & string;
  const fields = Object.keys(spec) as K[];
  const aliases = Object.fromEntries(fields.map((field) => [field, spec[field].map(normalizeHeader)])) as Record<K, string[]>;

  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const headers = rows[r].map(normalizeHeader);
    const columns: Partial<Record<K, number>> = {};
    const claimed = new Set<number>();
    for (const field of fields) {
      const idx = headers.findIndex((h, i) => !claimed.has(i) && h && aliases[field].includes(h));
      if (idx >= 0) { columns[field] = idx; claimed.add(idx); }
    }
    for (const field of fields) {
      if (columns[field] !== undefined) continue;
      const idx = headers.findIndex((h, i) => !claimed.has(i) && h && aliases[field].some((alias) => (
        h.startsWith(alias) || (h.length >= 10 && alias.startsWith(h))
      )));
      if (idx >= 0) { columns[field] = idx; claimed.add(idx); }
    }
    if (required.every((field) => columns[field] !== undefined)) return { headerRow: r, columns };
  }
  const missing = required.map((field) => spec[field][0]).join(", ");
  throw new Error(`Couldn't find the header row. Expected columns: ${missing}.`);
};

const getter = <K extends string>(columns: Partial<Record<K, number>>) => (row: unknown[], field: K): unknown => {
  const idx = columns[field];
  return idx === undefined ? "" : row[idx] ?? "";
};

const dateRange = (dates: string[]) => {
  const sorted = dates.filter(Boolean).sort();
  return { minDate: sorted[0] || "", maxDate: sorted[sorted.length - 1] || "" };
};

// ---------------------------------------------------------------------------
// 1. Invoice lines
// ---------------------------------------------------------------------------

const INVOICE_LINE_COLUMNS = {
  invoiceNo: ["Document No", "Document Number", "Invoice No", "Invoice Number"],
  documentDate: ["Document Date", "Invoice Date"],
  customer: ["Customer Name", "Customer"],
  inventoryName: ["Inventory Name", "Item Name", "Description", "Product"],
  warehouse: ["Warehouse", "Warehouse Name"],
  qty: ["Qty", "Quantity"],
  unitPriceExcl: ["Unit Price Exclusive", "Unit Price Excl", "Unit Price"],
  totalExcl: ["Total Exclusive", "Total Excl", "Line Total Exclusive"],
  totalIncl: ["Total Inclusive", "Total Incusive", "Total Incl", "Line Total Inclusive"],
};

export const parseInvoiceLines = (rows: unknown[][]): ParseResult<InvoiceLineUpload> => {
  const { headerRow, columns } = findColumns(rows, INVOICE_LINE_COLUMNS, ["invoiceNo", "documentDate", "qty"]);
  const get = getter(columns);
  const body = rows.slice(headerRow + 1);
  const order = detectDateOrder(body.map((row) => get(row, "documentDate")));
  const lineCounts = new Map<string, number>();
  const result: InvoiceLineUpload[] = [];
  let skipped = 0;

  for (const row of body) {
    const invoiceNo = cellText(get(row, "invoiceNo")).toUpperCase();
    const documentDate = parseDate(get(row, "documentDate"), order);
    if (!invoiceNo || !documentDate) { skipped += 1; continue; }
    const lineNo = lineCounts.get(invoiceNo) ?? 0;
    lineCounts.set(invoiceNo, lineNo + 1);
    result.push({
      invoiceNo,
      lineNo,
      documentDate,
      customer: cellText(get(row, "customer")),
      inventoryName: cellText(get(row, "inventoryName")),
      warehouse: cellText(get(row, "warehouse")),
      qty: parseAmount(get(row, "qty")) ?? 0,
      unitPriceExcl: parseAmount(get(row, "unitPriceExcl")),
      totalExcl: parseAmount(get(row, "totalExcl")),
      totalIncl: parseAmount(get(row, "totalIncl")),
    });
  }

  const warnings: string[] = [];
  if (order === "mdy") warnings.push("Dates were read as month/day/year because some days were above 12.");
  return { rows: result, skipped, warnings, ...dateRange(result.map((row) => row.documentDate)) };
};

// ---------------------------------------------------------------------------
// 2. Invoice register
// ---------------------------------------------------------------------------

const REGISTER_COLUMNS = {
  invoiceNo: ["Invoice No", "Invoice Number", "Invoice"],
  salesOrder: ["Source Sales Order", "Sales Order", "Sales Order No", "SO No"],
  deliveryNote: ["Invoice Delivery", "Invoice Delivery No", "Delivery Note", "Delivery No"],
  dispatchDate: ["Dispatch Date", "Invoice Date", "Document Date"],
  dueDate: ["Delivery / Due Date", "Delivery Due Date", "Due Date", "Delivery Date"],
  customer: ["Customer", "Customer Name"],
  branch: ["Branch"],
};

const BRANCH_ROW = /^branch\s*:\s*(.+?)\s*(?:\(\s*count\s*=\s*\d+\s*\))?\s*$/i;

export const parseInvoiceRegister = (rows: unknown[][]): ParseResult<InvoiceRegisterUpload> => {
  const { headerRow, columns } = findColumns(rows, REGISTER_COLUMNS, ["invoiceNo", "dueDate"]);
  const get = getter(columns);
  const body = rows.slice(headerRow + 1);
  const dateValues = body.flatMap((row) => [get(row, "dispatchDate"), get(row, "dueDate")]);
  const order = detectDateOrder(dateValues);
  const result: InvoiceRegisterUpload[] = [];
  let currentBranch = "";
  let skipped = 0;
  let missingDueDate = 0;

  for (const row of body) {
    const firstCell = cellText(row.find((cell) => cellText(cell) !== ""));
    const branchMatch = firstCell.match(BRANCH_ROW);
    if (branchMatch) { currentBranch = branchMatch[1]; continue; }

    const invoiceNo = cellText(get(row, "invoiceNo")).toUpperCase();
    if (!invoiceNo || /count\s*=|^total/i.test(invoiceNo)) { skipped += 1; continue; }

    const dueDate = parseDate(get(row, "dueDate"), order);
    if (!dueDate) missingDueDate += 1;
    result.push({
      invoiceNo,
      salesOrder: cellText(get(row, "salesOrder")).toUpperCase(),
      deliveryNote: cellText(get(row, "deliveryNote")).toUpperCase(),
      dispatchDate: parseDate(get(row, "dispatchDate"), order),
      dueDate,
      customer: cellText(get(row, "customer")),
      branch: cellText(get(row, "branch")) || currentBranch,
    });
  }

  const warnings: string[] = [];
  if (order === "mdy") warnings.push("Dates were read as month/day/year because some days were above 12.");
  if (missingDueDate) warnings.push(`${missingDueDate} invoice(s) have no Delivery / Due Date, so on-time can't be measured for them.`);
  return { rows: result, skipped, warnings, ...dateRange(result.map((row) => row.dispatchDate || row.dueDate)) };
};

// ---------------------------------------------------------------------------
// 3. IBT transactions
// ---------------------------------------------------------------------------

const IBT_COLUMNS = {
  sourceId: ["id", "Transaction Id", "Line Id"],
  reference: ["Reference", "Ref", "IBT No", "IBT Number"],
  transactionDate: ["Transaction Date", "Date", "Document Date"],
  documentType: ["Document Type", "Transaction Type"],
  inventoryCode: ["Inventory Code", "Item Code", "Product Code"],
  inventoryName: ["Inventory Name", "Item Name", "Description"],
  warehouseCode: ["Warehouse Code", "Warehouse"],
  qtyIn: ["Qty In", "Quantity In"],
  qtyOut: ["Qty Out", "Quantity Out"],
};

const isIbtDocumentType = (value: string) => /inter\s*branch|\bibt\b/i.test(value);

export const parseIbtTransactions = (rows: unknown[][]): ParseResult<IbtLineUpload> => {
  const { headerRow, columns } = findColumns(rows, IBT_COLUMNS, ["reference", "transactionDate", "warehouseCode", "qtyIn", "qtyOut"]);
  const get = getter(columns);
  const body = rows.slice(headerRow + 1);
  const order = detectDateOrder(body.map((row) => get(row, "transactionDate")));
  const hasDocumentType = columns.documentType !== undefined;
  const fallbackIds = new Map<string, number>();
  const result: IbtLineUpload[] = [];
  let skipped = 0;
  let otherTypes = 0;

  for (const row of body) {
    const reference = cellText(get(row, "reference")).toUpperCase();
    const transactionDate = parseDate(get(row, "transactionDate"), order);
    const warehouseCode = cellText(get(row, "warehouseCode"));
    if (!reference || !transactionDate || !warehouseCode) { skipped += 1; continue; }
    if (hasDocumentType && !isIbtDocumentType(cellText(get(row, "documentType")))) { otherTypes += 1; continue; }

    const qtyIn = parseAmount(get(row, "qtyIn")) ?? 0;
    const qtyOut = parseAmount(get(row, "qtyOut")) ?? 0;
    if (!qtyIn && !qtyOut) { skipped += 1; continue; }

    let sourceId = cellText(get(row, "sourceId"));
    if (!sourceId) {
      const next = (fallbackIds.get(reference) ?? 0) + 1;
      fallbackIds.set(reference, next);
      sourceId = `row-${next}`;
    }

    result.push({
      reference,
      sourceId,
      transactionDate,
      inventoryCode: cellText(get(row, "inventoryCode")),
      inventoryName: cellText(get(row, "inventoryName")),
      warehouseCode,
      qtyIn,
      qtyOut,
    });
  }

  const warnings: string[] = [];
  if (order === "mdy") warnings.push("Dates were read as month/day/year because some days were above 12.");
  if (otherTypes) warnings.push(`${otherTypes} row(s) were not Inter Branch Transfers and were ignored.`);
  return { rows: result, skipped, warnings, ...dateRange(result.map((row) => row.transactionDate)) };
};

// ---------------------------------------------------------------------------
// 4. Outstanding sales orders
// ---------------------------------------------------------------------------

export interface OutstandingOrderUpload {
  company: string;
  documentNo: string;
  customerCode: string;
  customerName: string;
  status: string;
  deliveryDate: string;
  inventoryCode: string;
  inventoryDescription: string;
  warehouse: string;
  outstandingQty: number;
  unitPrice: number | null;
  totalExcl: number | null;
  dateCreated: string;
  createdBy: string;
}

const OUTSTANDING_COLUMNS = {
  company: ["Company"],
  documentNo: ["Document No", "Document Number", "Sales Order", "Sales Order No"],
  customerCode: ["Customer Code", "Customer Account", "Account Code"],
  customerName: ["Customer Name", "Customer"],
  status: ["Status", "Order Status"],
  deliveryDate: ["Delivery Date", "Due Date", "Delivery / Due Date"],
  inventoryCode: ["Inventory Code", "Item Code", "Product Code"],
  inventoryDescription: ["Inventory Description", "Inventory Name", "Item Description", "Description"],
  warehouse: ["Warehouse", "Warehouse Name"],
  outstandingQty: ["Outstanding Qty", "Outstanding Quantity", "Qty Outstanding", "Balance Qty"],
  unitPrice: ["Unit Price", "Unit Price Excl", "Unit Price Exclusive"],
  totalExcl: ["Total Excl Tax Outstanding", "Total Excl Tax", "Total Exclusive", "Total Excl"],
  dateCreated: ["DateCreated", "Date Created", "Created Date"],
  createdBy: ["CreatedByUserid", "Created By User", "Created By", "CreatedBy"],
};

export const parseOutstandingOrders = (rows: unknown[][]): ParseResult<OutstandingOrderUpload> => {
  const { headerRow, columns } = findColumns(rows, OUTSTANDING_COLUMNS, ["documentNo", "deliveryDate", "outstandingQty"]);
  const get = getter(columns);
  const body = rows.slice(headerRow + 1);
  const order = detectDateOrder(body.flatMap((row) => [get(row, "deliveryDate"), get(row, "dateCreated")]));
  const result: OutstandingOrderUpload[] = [];
  let skipped = 0;
  let missingDeliveryDate = 0;

  for (const row of body) {
    const documentNo = cellText(get(row, "documentNo")).toUpperCase();
    if (!documentNo || /^total/i.test(documentNo)) { skipped += 1; continue; }
    const deliveryDate = parseDate(get(row, "deliveryDate"), order);
    if (!deliveryDate) missingDeliveryDate += 1;
    result.push({
      company: cellText(get(row, "company")),
      documentNo,
      customerCode: cellText(get(row, "customerCode")).toUpperCase(),
      customerName: cellText(get(row, "customerName")),
      status: cellText(get(row, "status")),
      deliveryDate,
      inventoryCode: cellText(get(row, "inventoryCode")),
      inventoryDescription: cellText(get(row, "inventoryDescription")),
      warehouse: cellText(get(row, "warehouse")),
      outstandingQty: parseAmount(get(row, "outstandingQty")) ?? 0,
      unitPrice: parseAmount(get(row, "unitPrice")),
      totalExcl: parseAmount(get(row, "totalExcl")),
      dateCreated: parseDate(get(row, "dateCreated"), order),
      createdBy: cellText(get(row, "createdBy")),
    });
  }

  const warnings: string[] = [];
  if (order === "mdy") warnings.push("Dates were read as month/day/year because some days were above 12.");
  if (missingDeliveryDate) warnings.push(`${missingDeliveryDate} line(s) have no Delivery Date, so they can't be flagged as overdue.`);
  return { rows: result, skipped, warnings, ...dateRange(result.map((row) => row.deliveryDate)) };
};

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

/**
 * Split rows into chunks of roughly `maxRows`, never splitting a key across chunks.
 * The API replaces everything under a key (invoice / IBT reference) per request.
 */
export const chunkByKey = <T>(rows: T[], keyOf: (row: T) => string, maxRows = 2000): T[][] => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = keyOf(row);
    const group = groups.get(k);
    if (group) group.push(row); else groups.set(k, [row]);
  }
  const chunks: T[][] = [];
  let current: T[] = [];
  for (const group of groups.values()) {
    if (current.length > 0 && current.length + group.length > maxRows) {
      chunks.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
};
