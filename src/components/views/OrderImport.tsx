// src/components/views/OrderImport.tsx
import React, { useState, useCallback, useRef, useMemo } from "react";
import { Upload, Check, AlertCircle, Download, Search, X, Trash2 } from "lucide-react";
import * as XLSX from "../../lib/spreadsheet";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { useDispatch } from "../../context/DispatchContext";
import { useNotification } from "../../context/NotificationContext";
import { useAuth } from "../../context/AuthContext";
import { JobPriority, JobStatus } from "../../types";

/**
 * OrderImport component (Sales Orders mapping + ETA date normalization)
 * - Robust parsing (CSV/Excel via xlsx) with cellDates + raw:false
 * - Maps your sheet columns:
 *      "Document No"           -> ref
 *      "Customer Name"         -> customer
 *      "Warehouse"             -> pickup
 *      "Delivery Date"         -> eta  (normalized to YYYY-MM-DD)
 *      "Inventory Description" -> notes
 *      "Status"                -> priority
 * - Generates required Job fields: id, createdAt, updatedAt
 */

interface ImportedOrder {
  ref: string;
  customer: string;
  pickup: string;
  dropoff: string;
  warehouse?: string;  // warehouse field for filtering
  priority?: string;
  pallets?: number;
  outstandingQty?: number;  // Outstanding quantity from Excel
  sourceCreatedDate?: string;
  sourceCreatedBy?: string;
  totalExclVat?: number;     // Total excl. VAT from sales order import
  eta?: string;  // normalized string (e.g., "2025-10-10")
  notes?: string;
}

// === Tunables ===
const DEFAULT_STATUS = "pending" as JobStatus;
const DEFAULT_PICKUP = "K58 Warehouse";
const DEFAULT_DROPOFF = "TBD";

// ---------- Helpers ----------
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Excel serial (1900 system) -> JS Date */
const excelSerialToDate = (serial: number): Date => {
  // Excel's epoch (with the 1900-leap-year bug accounted for) is 1899-12-30
  // Multiply days by ms/day
  const ms = Math.round(serial * 86400000);
  const base = new Date(Date.UTC(1899, 11, 30));
  return new Date(base.getTime() + ms);
};

/** Normalize any ETA-like cell into YYYY-MM-DD */
const normalizeEta = (val: any): string | undefined => {
  if (val === undefined || val === null || val === "") return undefined;

  // If Date object (when cellDates:true + raw:false cooperates)
  if (val instanceof Date && !isNaN(val.getTime())) {
    return toISODate(val);
  }

  // If Excel serial number (pure number)
  if (typeof val === "number" && isFinite(val)) {
    const d = excelSerialToDate(val);
    if (!isNaN(d.getTime())) return toISODate(d);
  }

  // If string: try parse
  if (typeof val === "string") {
    const trimmed = val.trim();

    // If already in YYYY-MM-DD format, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // Excel serial number formatted as string with appended date parts
    // e.g. "46337-01-01" or "46097-01-01" — the first part is the serial
    const serialMatch = trimmed.match(/^(\d{5})-\d{2}-\d{2}$/);
    if (serialMatch) {
      const serial = parseInt(serialMatch[1], 10);
      if (serial > 30000 && serial < 100000) {
        const d = excelSerialToDate(serial);
        if (!isNaN(d.getTime())) return toISODate(d);
      }
    }

    // Pure numeric string (Excel serial as text)
    if (/^\d{5}$/.test(trimmed)) {
      const serial = parseInt(trimmed, 10);
      const d = excelSerialToDate(serial);
      if (!isNaN(d.getTime())) return toISODate(d);
    }

    // In DD/MM/YYYY format (common in Excel exports)
    const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyyMatch) {
      const [, day, month, year] = ddmmyyyyMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return toISODate(date);
      }
    }

    // In MM/DD/YYYY format
    const mmddyyyyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mmddyyyyMatch) {
      const [, month, day, year] = mmddyyyyMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return toISODate(date);
      }
    }

    // In DD-MM-YYYY or DD.MM.YYYY format
    const dottedMatch = trimmed.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/);
    if (dottedMatch) {
      const [, day, month, year] = dottedMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return toISODate(date);
      }
    }

    // Try parsing as standard date string
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1970 && parsed.getFullYear() < 2100) {
      return toISODate(parsed);
    }

    // If it's a time-only "14:30", return undefined
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) return undefined;
  }

  return undefined;
};

const normalizePriority = (p?: string): JobPriority => {
  const v = (p || "normal").toString().trim().toLowerCase();
  if (["urgent", "rush", "critical", "hot"].includes(v)) return "high";
  if (v === "high") return "high";
  if (v === "low") return "low";
  return "normal";
};

const parsePallets = (v?: string | number): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return Math.round(v);
  const trimmed = v.trim();
  const commaParts = trimmed.replace(/\s/g, "").split(",");
  const usesDecimalComma =
    commaParts.length === 2 &&
    !trimmed.includes(".") &&
    (/\s/.test(trimmed) || commaParts[0].length >= 2);
  const cleaned = usesDecimalComma
    ? trimmed.replace(/\s/g, "").replace(",", ".")
    : trimmed.replace(/\s/g, "").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n) : undefined;
};

const parseCurrency = (v?: string | number): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return v;
  // Strip currency symbols, spaces, then handle decimal comma
  const stripped = String(v).replace(/[R$£€\s]/g, "");
  const commaParts = stripped.split(",");
  const cleaned =
    commaParts.length === 2 && commaParts[1].length <= 2
      ? stripped.replace(",", ".")
      : stripped.replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

type HeaderIndex = Record<string, number>;
const indexHeaders = (headers: string[]): HeaderIndex => {
  const map: HeaderIndex = {};
  headers.forEach((h, i) => (map[h.trim().toLowerCase()] = i));
  return map;
};
const findFirst = (idx: HeaderIndex, cands: string[]) => {
  for (const c of cands) {
    if (idx[c]) return idx[c];
    if (idx[c] === 0) return 0;
  }
  return undefined;
};
const coalesce = (row: any[], idx?: number) => {
  if (idx === undefined) return undefined;
  const v = row[idx];
  if (v === undefined || v === null) return undefined;
  // xlsx with cellDates:true can return Date objects — convert to ISO string
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : toISODate(v);
  // If it's any other object (rich text, error, etc.), stringify it
  if (typeof v === "object") return String(v);
  return v;
};
const safeStr = (v: any) => {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : toISODate(v);
  return String(v).trim();
};

const ALIASES: Record<keyof Omit<ImportedOrder, never>, string[]> = {
  ref: ["ref", "reference", "document no", "document", "order no", "so", "so number", "order number", "document number"],
  customer: ["customer", "customer name", "client", "account", "account name", "customername"],
  pickup: ["pickup", "collect from", "source", "from", "origin"],
  dropoff: ["dropoff", "deliver to", "to", "destination", "ship-to", "ship to", "delivery address"],
  warehouse: ["warehouse", "wh", "warehouse name"],
  priority: ["priority", "urgency", "rush", "status", "order status"],
  pallets: ["pallets", "pallet qty", "pallet quantity"],
  outstandingQty: ["outstanding qty", "outstanding", "outstanding quantity", "qty outstanding", "balance qty", "balance"],
  sourceCreatedDate: ["datecreated (day-month-year)", "datecreated", "date created", "created date", "created on"],
  sourceCreatedBy: ["createdbyuserid", "created by user id", "created by userid", "created by", "creator", "user"],
  totalExclVat: ["total excl vat", "total excl. vat", "total excl vat (r)", "net value", "net amount", "excl vat", "excl. vat", "amount excl", "amount excl vat", "value excl vat"],
  eta: ["eta", "delivery date", "required date", "promise date", "due date"],
  notes: ["notes", "remarks", "comment", "inventory description", "description"],
};

// Warehouses whose rows are ignored on import (internal storage, not dispatchable).
// Compared case-insensitively with collapsed whitespace and normalized dashes.
const normalizeWarehouseForCompare = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[–—]/g, "-") // en/em dash -> hyphen
    .replace(/\s+/g, " ")
    .trim();

const IGNORED_WAREHOUSES = new Set(
  [
    "Finished Goods AFi - Pretoria",
    "Raw - AFi Pretoria",
    "Dispatch Allmark - Pretoria",
    "Raws - Allmark Pretoria",
  ].map(normalizeWarehouseForCompare)
);

// ----- Row mapping with ETA normalization -----
const rowToOrder = (headers: string[], row: any[], i: number): ImportedOrder | null => {
  const idx = indexHeaders(headers);

  const refIdx = findFirst(idx, ALIASES.ref);
  const customerIdx = findFirst(idx, ALIASES.customer);
  const pickupIdx = findFirst(idx, ALIASES.pickup);
  const dropoffIdx = findFirst(idx, ALIASES.dropoff);
  const warehouseIdx = findFirst(idx, ALIASES.warehouse);
  const priorityIdx = findFirst(idx, ALIASES.priority);
  const palletsIdx = findFirst(idx, ALIASES.pallets);
  const outstandingQtyIdx = findFirst(idx, ALIASES.outstandingQty);
  const sourceCreatedDateIdx = findFirst(idx, ALIASES.sourceCreatedDate);
  const sourceCreatedByIdx = findFirst(idx, ALIASES.sourceCreatedBy);
  const totalExclVatIdx = findFirst(idx, ALIASES.totalExclVat);
  const etaIdx = findFirst(idx, ALIASES.eta);
  const notesIdx = findFirst(idx, ALIASES.notes);

  const ref =
    safeStr(coalesce(row, idx["document no"])) ??
    safeStr(coalesce(row, refIdx)) ??
    `ORD-${Date.now()}-${i}`;

  const customer =
    safeStr(coalesce(row, idx["customer name"])) ??
    safeStr(coalesce(row, customerIdx));

  // Warehouse field for filtering
  let warehouse =
    safeStr(coalesce(row, idx["warehouse"])) ??
    safeStr(coalesce(row, warehouseIdx));

  // Skip rows tied to internal/non-dispatch warehouses
  if (warehouse && IGNORED_WAREHOUSES.has(normalizeWarehouseForCompare(warehouse))) {
    return null;
  }

  // Don't use "K58 Warehouse" as a warehouse value — it's the default pickup, not a warehouse
  if (warehouse === "K58 Warehouse") warehouse = undefined;

  // Pickup can be same as warehouse or a different field
  const pickup = warehouse ?? safeStr(coalesce(row, pickupIdx)) ?? DEFAULT_PICKUP;

  const dropoff = safeStr(coalesce(row, dropoffIdx)) ?? DEFAULT_DROPOFF;

  const priorityRaw =
    coalesce(row, idx["status"]) ?? coalesce(row, priorityIdx);
  const priority = normalizePriority(safeStr(priorityRaw));

  // ETA: prefer "Delivery Date", then alias; then normalize
  const etaRaw =
    coalesce(row, idx["delivery date"]) ??
    coalesce(row, etaIdx);
  const eta = normalizeEta(etaRaw);

  const notes =
    safeStr(coalesce(row, idx["inventory description"])) ??
    safeStr(coalesce(row, notesIdx));

  const pallets = parsePallets(safeStr(coalesce(row, palletsIdx)));
  const outstandingQty = parsePallets(safeStr(coalesce(row, outstandingQtyIdx)));
  const sourceCreatedDate = normalizeEta(coalesce(row, sourceCreatedDateIdx));
  const sourceCreatedBy = safeStr(coalesce(row, sourceCreatedByIdx));
  const totalExclVat = parseCurrency(coalesce(row, totalExclVatIdx));

  if (!ref || !customer) return null;

  // Ensure all string fields are primitives (xlsx can return Date objects with cellDates:true)
  const safe = (v: any): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (v instanceof Date) return toISODate(v);
    return String(v);
  };

  return {
    ref: safe(ref)!,
    customer: safe(customer)!,
    pickup: safe(pickup)!,
    dropoff: safe(dropoff)!,
    warehouse: safe(warehouse),
    priority: safe(priority) as any,
    pallets,
    outstandingQty,
    sourceCreatedDate: safe(sourceCreatedDate),
    sourceCreatedBy: safe(sourceCreatedBy),
    totalExclVat,
    eta: safe(eta),
    notes: safe(notes),
  };
};

// ---------- Parsing (enable cellDates + raw:false) ----------
const SHEET_TO_JSON_OPTS = { header: 1, raw: false, rawNumbers: false } as const;

const parseCSV = async (text: string): Promise<ImportedOrder[]> => {
  const wb = await XLSX.read(text, { type: "string" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, SHEET_TO_JSON_OPTS) as any[][];
  if (!rows.length) return [];
  const headers = rows[0].map((h: any) => String(h).trim());
  const orders: ImportedOrder[] = [];
  for (let i = 1; i < rows.length; i++) {
    const order = rowToOrder(headers, rows[i], i);
    if (order) orders.push(order);
  }
  return orders;
};

const parseExcel = async (arrayBuffer: ArrayBuffer): Promise<ImportedOrder[]> => {
  try {
    const wb = await XLSX.read(arrayBuffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, SHEET_TO_JSON_OPTS) as any[][];
    if (!rows.length) return [];
    const headers = rows[0].map((h: any) => String(h).trim());
    const orders: ImportedOrder[] = [];
    for (let i = 1; i < rows.length; i++) {
      const order = rowToOrder(headers, rows[i], i);
      if (order) orders.push(order);
    }
    return orders;
  } catch (err) {
    console.error("Error parsing Excel file:", err);
    return [];
  }
};

// ---------- Component ----------
export const OrderImport: React.FC = () => {
  const { jobs, refreshData } = useDispatch();
  const { showSuccess, showError, confirm } = useNotification();
  const { isViewer, isAdmin } = useAuth();
  const [importedOrders, setImportedOrders] = useState<ImportedOrder[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const [isImporting, setIsImporting] = useState(false);
  const [isPurgingIgnored, setIsPurgingIgnored] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Existing orders that match the ignored-warehouse list (legacy rows imported before the filter)
  const ignoredWarehouseJobIds = useMemo(() => {
    return jobs
      .filter((j) => j.jobType !== "ibt")
      .filter((j) => j.warehouse && IGNORED_WAREHOUSES.has(normalizeWarehouseForCompare(j.warehouse)))
      .map((j) => j.id);
  }, [jobs]);

  const purgeIgnoredWarehouseOrders = async () => {
    if (isPurgingIgnored) return;
    if (ignoredWarehouseJobIds.length === 0) {
      showSuccess("No orders matching the ignored warehouses were found.");
      return;
    }

    const ok = await confirm({
      title: "Remove Ignored-Warehouse Orders?",
      message: `This will permanently delete ${ignoredWarehouseJobIds.length} order${ignoredWarehouseJobIds.length === 1 ? "" : "s"} whose Warehouse is one of the internal storage locations (Finished Goods AFi - Pretoria, Raw - AFi Pretoria, Dispatch Allmark - Pretoria, Raws - Allmark Pretoria). This cannot be undone.`,
      type: "danger",
      confirmText: "Delete orders",
    });
    if (!ok) return;

    setIsPurgingIgnored(true);
    try {
      const { jobsAPI } = await import("../../services/api");
      // Batch into chunks of 500 to stay under the server-side cap and any URL/body limits
      const CHUNK = 500;
      let deleted = 0;
      for (let i = 0; i < ignoredWarehouseJobIds.length; i += CHUNK) {
        const slice = ignoredWarehouseJobIds.slice(i, i + CHUNK);
        const { deleted: n } = await jobsAPI.bulkDelete(slice);
        deleted += n;
      }
      await refreshData();
      showSuccess(`Deleted ${deleted} order${deleted === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("Error purging ignored-warehouse orders:", error);
      showError("Failed to remove orders. Please try again.");
    } finally {
      setIsPurgingIgnored(false);
    }
  };


  const [searchQuery, setSearchQuery] = useState("");

  // Get unique warehouses from imported orders
  const filteredOrders = useMemo(() => {
    if (!searchQuery) return importedOrders;
    const q = searchQuery.toLowerCase();
    return importedOrders.filter((o) =>
      String(o.ref).toLowerCase().includes(q) ||
      String(o.customer).toLowerCase().includes(q) ||
      String(o.warehouse ?? "").toLowerCase().includes(q)
    );
  }, [importedOrders, searchQuery]);

  // Filter and sort orders

  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);

    reader.onload = async (e) => {
      try {
        let orders: ImportedOrder[] = [];
        if (isExcel) {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          orders = await parseExcel(arrayBuffer);
        } else {
          const text = e.target?.result as string;
          orders = await parseCSV(text);
        }

        if (orders.length > 0) {
          setImportedOrders(orders);
          setImportStatus("success");
        } else {
          setImportStatus("error");
        }
      } catch (error) {
        console.error("Error parsing file:", error);
        setImportStatus("error");
      }
    };

    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      const validTypes = [
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];
      const validExtensions = [".csv", ".xlsx", ".xls"];

      if (
        file &&
        (validTypes.includes(file.type) ||
          validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext)))
      ) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };


  const importToDispatch = async () => {
    if (isImporting) return;
    setIsImporting(true);
    try {
      const { jobsAPI } = await import("../../services/api");

      // Get existing jobs from database to detect duplicates
      const existingJobs = await jobsAPI.getAll();
      const existingByRef = new Map<string, typeof existingJobs>();
      existingJobs.forEach((j) => {
        const list = existingByRef.get(j.ref) || [];
        list.push(j);
        existingByRef.set(j.ref, list);
      });

      // Convert imported orders
      const allOrders = importedOrders.map((order) => ({
        ref: order.ref,
        customer: order.customer,
        pickup: order.pickup || DEFAULT_PICKUP,
        dropoff: order.dropoff || DEFAULT_DROPOFF,
        warehouse: order.warehouse,
        priority: normalizePriority(order.priority),
        status: DEFAULT_STATUS,
        pallets: order.pallets,
        outstandingQty: order.outstandingQty,
        sourceCreatedDate: order.sourceCreatedDate,
        sourceCreatedBy: order.sourceCreatedBy,
        totalExclVat: order.totalExclVat,
        eta: order.eta,
        notes: order.notes,
      }));

      // Split into new orders and orders that need updating
      const newOrders = allOrders.filter((order) => !existingByRef.has(order.ref));
      const existingRefs = new Set(allOrders.filter((order) => existingByRef.has(order.ref)).map((o) => o.ref));

      // For existing refs: delete old line items, then recreate from the fresh import
      // This prevents duplicate accumulation and ensures line items match the source exactly
      let updatedCount = 0;
      let failedCount = 0;
      const ordersToRecreate: typeof allOrders = [];

      for (const ref of existingRefs) {
        const existingLines = existingByRef.get(ref) || [];
        const importLines = allOrders.filter((o) => o.ref === ref);

        // Preserve status, driverId, and workflow fields from the first existing line
        const existing = existingLines[0];
        const preserved = {
          status: existing.status,
          driverId: existing.driverId,
          transporterBooked: existing.transporterBooked,
          orderPicked: existing.orderPicked,
          coaAvailable: existing.coaAvailable,
          transportService: existing.transportService,
          truckSize: existing.truckSize,
          etd: existing.etd,
          hasFlowbin: existing.hasFlowbin,
          internalNotes: existing.internalNotes,
          serviceType: existing.serviceType,
        };

        // Delete all old line items for this ref
        for (const line of existingLines) {
          try {
            await jobsAPI.delete(line.id);
          } catch (err) {
            console.error(`Failed to delete old line item ${line.id}:`, err);
          }
        }

        // Recreate from import data, preserving workflow state
        for (const importLine of importLines) {
          ordersToRecreate.push({ ...importLine, ...preserved } as any);
        }
        updatedCount += importLines.length;
      }

      // Create all new + recreated orders
      const allToCreate = [...newOrders, ...ordersToRecreate];
      if (allToCreate.length > 0) {
        try {
          await jobsAPI.bulkCreate(allToCreate);
        } catch (err) {
          console.error("Failed to create orders:", err);
          failedCount += allToCreate.length;
        }
      }

      await refreshData();

      showSuccess(`Import complete: ${newOrders.length} new, ${existingRefs.size} updated (${updatedCount} lines)${failedCount > 0 ? `, ${failedCount} failed` : ""}`);
      setImportedOrders([]);
      setImportStatus("idle");
    } catch (error) {
      console.error("Error importing jobs to database:", error);
      setImportStatus("error");
      showError("Import failed. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  const downloadTemplate = async (format: "csv" | "excel" = "csv") => {
    const headers = [
      "Document No",
      "Customer Name",
      "Status",
      "Delivery Date",
      "Inventory Code",
      "Inventory Description",
      "Warehouse",
      "Outstanding Qty",
      "DateCreated (Day-Month-Year)",
      "CreatedByUserid",
      "Total Excl VAT",
    ];

    if (format === "csv") {
      const examples = [
        ["SO-0001", "Sample Customer", "Normal", "2025-10-10", "ITEM-001", "Sample Line — fragile", "Finished Goods AFi K58", "120", "2025-10-01", "USER001", "50000"],
        ["SO-0002", "Sample Customer 2", "Normal", "2025-10-11", "ITEM-002", "Sample Line — raw material", "Raw - AFi Klapmuts K58", "60", "2025-10-01", "USER001", "25000"],
      ];
      const csv = [headers.join(","), ...examples.map((r) => r.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sales_orders_based_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = [
        headers,
        ["SO-0001", "Sample Customer", "Normal", "2025-10-10", "ITEM-001", "Sample Line — fragile", "Finished Goods AFi K58", "120", "2025-10-01", "USER001", "50000"],
        ["SO-0002", "Sample Customer 2", "Normal", "2025-10-11", "ITEM-002", "Sample Line — raw material", "Raw - AFi Klapmuts K58", "60", "2025-10-01", "USER001", "25000"],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "SalesOrdersTemplate");
      await XLSX.writeFile(workbook, "sales_orders_based_template.xlsx");
    }
  };



  const [showFormatTips, setShowFormatTips] = useState(false);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import Customer Orders</h1>
          <p className="text-sm text-gray-500">Drop your Sales Orders export — auto-maps Document No, Customer, Warehouse, Delivery Date</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => downloadTemplate("csv")} className="text-sm">
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
          </Button>
          <Button variant="outline" onClick={() => downloadTemplate("excel")} className="text-sm">
            <Download className="mr-1.5 h-3.5 w-3.5" /> Excel
          </Button>
          {isAdmin && ignoredWarehouseJobIds.length > 0 && (
            <Button
              variant="outline"
              onClick={purgeIgnoredWarehouseOrders}
              disabled={isPurgingIgnored}
              className="text-sm text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
              title="Remove orders whose Warehouse matches the internal storage locations now ignored on import"
            >
              {isPurgingIgnored ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                  Removing...
                </span>
              ) : (
                <>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove Ignored Warehouses ({ignoredWarehouseJobIds.length})
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Upload Card */}
      <Card className="p-5">
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl transition-colors flex flex-col items-center justify-center ${
            isDragging ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
          }`}
          style={{ minHeight: "130px" }}
        >
          <Upload className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-700">
            Drag & drop your file here, or{" "}
            <button onClick={() => fileInputRef.current?.click()} className="text-resilinc-primary hover:text-resilinc-primary-dark underline">browse</button>
          </p>
          <p className="text-xs text-gray-400 mt-1">CSV, XLSX, XLS</p>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} className="hidden" id="file-upload" />
        </div>

        {/* Status Messages */}
        {importStatus === "success" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-green-700 text-sm">
            <Check className="h-4 w-4" />
            <span className="font-medium">Successfully parsed {importedOrders.length} orders</span>
          </div>
        )}
        {importStatus === "error" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-700 text-sm">
            <AlertCircle className="h-4 w-4" />
            <span className="font-medium">No valid rows found. Check your column headers.</span>
          </div>
        )}

        {/* Format Tips — accordion inside the card */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button onClick={() => setShowFormatTips(!showFormatTips)} className="w-full flex items-center justify-between text-xs text-gray-500 hover:text-gray-700 font-medium py-1">
            <span>Column mapping reference</span>
            <span className="text-[10px]">{showFormatTips ? "▲" : "▼"}</span>
          </button>
        </div>
        {showFormatTips && (
          <div className="mt-2 rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 space-y-2">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-1">
              <span><strong>Document No</strong> → Reference</span>
              <span><strong>Customer Name</strong> → Customer</span>
              <span><strong>Warehouse</strong> → Pickup (K58 only)</span>
              <span><strong>Delivery Date</strong> → ETA</span>
              <span><strong>Inventory Description</strong> → Line Item</span>
              <span><strong>Status</strong> → Priority</span>
            </div>
            <p className="text-blue-700">Valid K58 warehouses: <strong>Finished Goods AFi K58</strong>, <strong>Raw - AFi Klapmuts K58</strong>. Rows from Pretoria warehouses are automatically skipped.</p>
          </div>
        )}
      </Card>

      {/* Preview Table */}
      {importedOrders.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Preview Orders ({String(importedOrders.length)})</CardTitle>
              <div className="flex gap-2">
                <Button
                  onClick={() => { setImportedOrders([]); setImportStatus("idle"); setSearchQuery(""); }}
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <X className="mr-2 h-4 w-4" /> Cancel
                </Button>
                <Button onClick={importToDispatch} disabled={isImporting || isViewer}>
                  {isImporting ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Importing...
                    </span>
                  ) : (
                    "Import to Dispatch System"
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 mb-4">
              <Search className="h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search by reference, customer, warehouse..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
              )}
              <span className="text-xs text-gray-400">
                {String(filteredOrders.length)} of {String(importedOrders.length)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Reference</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Customer</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Warehouse</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Priority</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">ETA</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Qty</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Date Created</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Created By</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Total Excl VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.slice(0, 100).map((order, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{String(order.ref ?? "")}</td>
                      <td className="px-3 py-2 text-gray-700">{String(order.customer ?? "")}</td>
                      <td className="px-3 py-2 text-gray-500">{String(order.warehouse ?? "—")}</td>
                      <td className="px-3 py-2">
                        <Badge variant="default" className="text-[10px]">{String(order.priority ?? "normal")}</Badge>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{String(order.eta ?? "—")}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{order.outstandingQty != null ? String(order.outstandingQty) : "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{String(order.sourceCreatedDate ?? "—")}</td>
                      <td className="px-3 py-2 text-gray-500">{String(order.sourceCreatedBy ?? "—")}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{order.totalExclVat != null ? `R ${order.totalExclVat.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredOrders.length > 100 && (
                <p className="text-xs text-gray-400 text-center py-2">Showing first 100 of {String(filteredOrders.length)}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview placeholder */}
      {importedOrders.length === 0 && importStatus === "idle" && (
        <Card className="py-6 px-4">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-500">No orders imported yet</p>
            <p className="text-xs text-gray-400 mt-0.5">Upload a CSV or Excel file to preview orders before import</p>
          </div>
        </Card>
      )}

    </div>
  );
};
