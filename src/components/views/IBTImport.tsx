// src/components/views/OrderImport.tsx
import React, { useState, useCallback, useRef, useMemo } from "react";
import { Upload, Check, AlertCircle, Download, Search, Filter, ArrowUpDown, Plus, X, Save, Trash2 } from "lucide-react";
import * as XLSX from "../../lib/spreadsheet";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Select } from "../ui/Select";
import { useDispatch } from "../../context/DispatchContext";
import { useNotification } from "../../context/NotificationContext";
import { useAuth } from "../../context/AuthContext";
import { JobPriority, JobStatus } from "../../types";

/**
 * IBTImport component (Internal Branch Transfer mapping)
 * - Robust parsing (CSV/Excel via xlsx) with cellDates + raw:false
 * - Maps IBT columns:
 *      "Document No" or "IBT No"       -> ref
 *      "From Branch" or "Source"       -> pickup (warehouse)
 *      "To Branch" or "Destination"    -> dropoff
 *      "Transfer Date" or "Date"       -> eta (normalized to YYYY-MM-DD)
 *      "Description" or "Notes"        -> notes
 *      "Priority" or "Status"          -> priority
 * - Automatically tags as IBT transfers
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
  eta?: string;  // normalized string (e.g., "2025-10-10")
  notes?: string;
}

// === Tunables ===
const DEFAULT_STATUS = "pending" as JobStatus;
const DEFAULT_CUSTOMER = "IBT - Internal Transfer";
const DEFAULT_PICKUP = "Source Branch";
const DEFAULT_DROPOFF = "Destination Branch";

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

  // If Excel serial number
  if (typeof val === "number" && isFinite(val)) {
    const d = excelSerialToDate(val);
    if (!isNaN(d.getTime())) return toISODate(d);
  }

  // If string: try parse
  if (typeof val === "string") {
    // If already in YYYY-MM-DD format, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return val;
    }

    // If in DD/MM/YYYY format (common in Excel exports)
    const ddmmyyyyMatch = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyyMatch) {
      const [, day, month, year] = ddmmyyyyMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return toISODate(date);
      }
    }

    // Try parsing as standard date string
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) return toISODate(parsed);

    // If it's a time-only "14:30", return undefined
    if (/^\d{1,2}:\d{2}$/.test(val)) return undefined;

    // Otherwise keep original string (might be useful for debugging)
    return val;
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
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n) : undefined;
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
const coalesce = (row: any[], idx?: number) => (idx === undefined ? undefined : row[idx]);
const safeStr = (v: any) => (v === undefined || v === null ? undefined : String(v).trim());

const ALIASES: Record<keyof Omit<ImportedOrder, never>, string[]> = {
  ref: ["ref", "reference", "document no", "document", "ibt no", "ibt number", "transfer no", "transfer number"],
  customer: ["customer", "customer name", "transfer type", "type"],
  pickup: ["pickup", "from branch", "source", "from", "origin", "source branch", "collect from"],
  dropoff: ["dropoff", "to branch", "destination", "to", "destination branch", "deliver to"],
  warehouse: ["warehouse", "from warehouse", "source warehouse"],
  priority: ["priority", "urgency", "rush", "status"],
  pallets: ["pallets", "pallet qty", "pallet quantity", "qty"],
  outstandingQty: ["outstanding qty", "outstanding", "outstanding quantity", "qty outstanding", "balance qty", "balance"],
  eta: ["eta", "transfer date", "date", "delivery date", "required date", "due date"],
  notes: ["notes", "remarks", "comment", "description", "items"],
};

// ----- Row mapping with ETA normalization -----
const rowToOrder = (headers: string[], row: any[], i: number): ImportedOrder | null => {
  const idx = indexHeaders(headers);

  const refIdx = findFirst(idx, ALIASES.ref);
  const pickupIdx = findFirst(idx, ALIASES.pickup);
  const dropoffIdx = findFirst(idx, ALIASES.dropoff);
  const warehouseIdx = findFirst(idx, ALIASES.warehouse);
  const priorityIdx = findFirst(idx, ALIASES.priority);
  const palletsIdx = findFirst(idx, ALIASES.pallets);
  const outstandingQtyIdx = findFirst(idx, ALIASES.outstandingQty);
  const etaIdx = findFirst(idx, ALIASES.eta);
  const notesIdx = findFirst(idx, ALIASES.notes);

  const ref =
    safeStr(coalesce(row, idx["ibt no"])) ??
    safeStr(coalesce(row, idx["transfer no"])) ??
    safeStr(coalesce(row, refIdx)) ??
    `IBT-${Date.now()}-${i}`;

  const customer = DEFAULT_CUSTOMER; // Always "IBT - Internal Transfer"

  // Warehouse field for filtering
  const warehouse =
    safeStr(coalesce(row, idx["warehouse"])) ??
    safeStr(coalesce(row, warehouseIdx));

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

  if (!ref || !customer) return null;

  return { ref, customer, pickup, dropoff, warehouse, priority, pallets, outstandingQty, eta, notes };
};

// ---------- Parsing (enable cellDates + raw:false) ----------
const SHEET_TO_JSON_OPTS = { header: 1, raw: false } as const;

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
export const IBTImport: React.FC = () => {
  const { refreshData } = useDispatch();
  const { showSuccess, showError, confirm } = useNotification();
  const { isAdmin } = useAuth();
  const [importedOrders, setImportedOrders] = useState<ImportedOrder[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const [isImporting, setIsImporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


  // Manual IBT creation
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualOrder, setManualOrder] = useState<ImportedOrder>({
    ref: "",
    customer: DEFAULT_CUSTOMER,
    pickup: DEFAULT_PICKUP,
    dropoff: DEFAULT_DROPOFF,
    warehouse: "",
    priority: "normal",
    pallets: undefined,
    outstandingQty: undefined,
    eta: "",
    notes: "",
  });

  // Advanced filtering and search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("all");
  const [selectedPriority, setSelectedPriority] = useState<string>("all");
  const [sortField, setSortField] = useState<keyof ImportedOrder | "">("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Get unique warehouses from imported orders
  const warehouses = useMemo(() => {
    const uniqueWarehouses = new Set<string>();
    importedOrders.forEach((order) => {
      if (order.warehouse) uniqueWarehouses.add(order.warehouse);
    });
    return Array.from(uniqueWarehouses).sort();
  }, [importedOrders]);

  // Filter and sort orders
  const filteredAndSortedOrders = useMemo(() => {
    let filtered = importedOrders.filter((order) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchableText = [
          order.ref,
          order.customer,
          order.warehouse || "",
          order.dropoff,
          order.notes || "",
        ].join(" ").toLowerCase();
        if (!searchableText.includes(query)) return false;
      }

      // Warehouse filter
      if (selectedWarehouse !== "all" && order.warehouse !== selectedWarehouse) {
        return false;
      }

      // Priority filter
      if (selectedPriority !== "all" && order.priority !== selectedPriority) {
        return false;
      }

      return true;
    });

    // Sorting
    if (sortField) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];

        if (aVal === undefined && bVal === undefined) return 0;
        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;

        let comparison = 0;
        if (typeof aVal === "string" && typeof bVal === "string") {
          comparison = aVal.localeCompare(bVal);
        } else if (typeof aVal === "number" && typeof bVal === "number") {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }

        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return filtered;
  }, [importedOrders, searchQuery, selectedWarehouse, selectedPriority, sortField, sortDirection]);

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

  const handleAddManualOrder = () => {
    if (!manualOrder.ref) {
      setImportStatus("error");
      return;
    }

    setImportedOrders([...importedOrders, manualOrder]);
    setShowManualModal(false);
    setManualOrder({
      ref: "",
      customer: DEFAULT_CUSTOMER,
      pickup: DEFAULT_PICKUP,
      dropoff: DEFAULT_DROPOFF,
      warehouse: "",
      priority: "normal",
      pallets: undefined,
      outstandingQty: undefined,
      eta: "",
      notes: "",
    });
    setImportStatus("success");
  };

  const clearAllIbts = async () => {
    if (isClearing) return;
    const ok = await confirm({
      title: "Delete All IBT Jobs?",
      message: "This will permanently remove every IBT job from the database. Customer orders are not affected. This cannot be undone.",
      type: "danger",
      confirmText: "Delete all IBTs",
    });
    if (!ok) return;

    setIsClearing(true);
    try {
      const { jobsAPI } = await import("../../services/api");
      await jobsAPI.bulkReplace([], "ibt");
      await refreshData();
      showSuccess("All IBT jobs have been cleared. Upload your new file to continue.");
    } catch (error) {
      console.error("Error clearing IBT jobs:", error);
      showError("Failed to clear IBT jobs. Please try again.");
    } finally {
      setIsClearing(false);
    }
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
        jobType: "ibt" as const,
        priority: normalizePriority(order.priority),
        status: DEFAULT_STATUS,
        pallets: order.pallets,
        outstandingQty: order.outstandingQty,
        eta: order.eta,
        notes: order.notes,
      }));

      // Split into new and existing orders
      const newOrders = allOrders.filter((order) => !existingByRef.has(order.ref));
      const existingOrders = allOrders.filter((order) => existingByRef.has(order.ref));

      // Create new orders
      if (newOrders.length > 0) {
        await jobsAPI.bulkCreate(newOrders);
      }

      // Update existing orders: match by ref + notes (product name) for line-item accuracy
      let updatedCount = 0;
      let failedCount = 0;
      for (const order of existingOrders) {
        const existingLines = existingByRef.get(order.ref) || [];
        const match = existingLines.find((j) => j.notes === order.notes)
          || existingLines.find((j) => !j.notes && order.notes) // match empty notes to fill in product name
          || (existingLines.length === 1 ? existingLines[0] : null);

        if (match) {
          const updates: Record<string, any> = {};
          if (order.customer) updates.customer = order.customer;
          if (order.pickup) updates.pickup = order.pickup;
          if (order.dropoff) updates.dropoff = order.dropoff;
          if (order.warehouse !== undefined) updates.warehouse = order.warehouse;
          if (order.pallets !== undefined) updates.pallets = order.pallets;
          if (order.outstandingQty !== undefined) updates.outstandingQty = order.outstandingQty;
          if (order.eta !== undefined) updates.eta = order.eta;
          if (order.notes !== undefined) updates.notes = order.notes;

          if (Object.keys(updates).length > 0) {
            try {
              await jobsAPI.update(match.id, updates as any);
              updatedCount++;
            } catch (err) {
              console.error(`Failed to update IBT ${order.ref}:`, err);
              failedCount++;
            }
          }
          // Remove matched item so it's not matched again
          const list = existingByRef.get(order.ref)!;
          const matchIdx = list.indexOf(match);
          if (matchIdx !== -1) list.splice(matchIdx, 1);
        }
      }

      const skippedCount = existingOrders.length - updatedCount - failedCount;

      await refreshData();

      const parts = [];
      if (newOrders.length > 0) parts.push(`${newOrders.length} new IBT orders imported`);
      if (updatedCount > 0) parts.push(`${updatedCount} existing orders updated`);
      if (skippedCount > 0) parts.push(`${skippedCount} duplicate orders skipped (no changes)`);
      if (failedCount > 0) parts.push(`${failedCount} orders failed to update`);
      if (parts.length === 0) parts.push("No changes needed");
      showSuccess(parts.join(". "));

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
      "IBT No",
      "From Branch",
      "To Branch",
      "Due Date",
      "Priority",
      "Outstanding Qty",
      "Description",
    ];

    if (format === "csv") {
      const example = [
        "IBT-0001",
        "K58 Warehouse",
        "K63 Warehouse",
        "2025-10-10",
        "Normal",
        "120",
        "Mixed items for K63",
      ];
      const csv = [headers.join(","), example.join(",")].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ibt_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = [
        headers,
        ["IBT-0001", "K58 Warehouse", "K63 Warehouse", "2025-10-10", "Normal", "120", "Mixed items for K63"],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "IBTTemplate");
      await XLSX.writeFile(workbook, "ibt_template.xlsx");
    }
  };

  const getBadgeVariant = (p?: string): string => {
    const v = (p || "normal").toLowerCase();
    if (v === "urgent" || v === "high") return "warning";
    if (v === "low") return "secondary";
    return "default";
    // Align with your design system as needed
  };


  const [showFormatTips, setShowFormatTips] = useState(false);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import IBT</h1>
          <p className="text-sm text-gray-500">Drop your IBT export — auto-maps IBT No, From/To Branch, Due Date</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowManualModal(true)} className="bg-green-600 hover:bg-green-700 text-sm">
            <Plus className="mr-1.5 h-4 w-4" /> Add IBT
          </Button>
          <Button variant="outline" onClick={() => downloadTemplate("csv")} className="text-sm">
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
          </Button>
          <Button variant="outline" onClick={() => downloadTemplate("excel")} className="text-sm">
            <Download className="mr-1.5 h-3.5 w-3.5" /> Excel
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              onClick={clearAllIbts}
              disabled={isClearing}
              className="text-sm text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
            >
              {isClearing ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                  Clearing...
                </span>
              ) : (
                <>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear All IBTs
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

        {/* Format Tips — accordion */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button onClick={() => setShowFormatTips(!showFormatTips)} className="w-full flex items-center justify-between text-xs text-gray-500 hover:text-gray-700 font-medium py-1">
            <span>Column mapping reference</span>
            <span className="text-[10px]">{showFormatTips ? "▲" : "▼"}</span>
          </button>
        </div>
        {showFormatTips && (
          <div className="mt-2 rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-1">
              <span><strong>IBT No</strong> → Reference</span>
              <span><strong>From Branch</strong> → Pickup</span>
              <span><strong>To Branch</strong> → Dropoff</span>
              <span><strong>Due Date</strong> → ETA</span>
              <span><strong>Description</strong> → Line Item</span>
              <span><strong>Priority</strong> → Priority</span>
            </div>
          </div>
        )}
      </Card>

      {/* Preview placeholder */}
      {importedOrders.length === 0 && importStatus === "idle" && (
        <Card className="py-6 px-4">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-500">No transfers imported yet</p>
            <p className="text-xs text-gray-400 mt-0.5">Upload a CSV or Excel file to preview IBTs before import</p>
          </div>
        </Card>
      )}

      {/* Preview Table */}
      {importedOrders.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Preview Orders ({importedOrders.length})</CardTitle>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setImportedOrders([]);
                    setImportStatus("idle");
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <X className="mr-2 h-4 w-4" /> Cancel
                </Button>
                <Button onClick={importToDispatch} disabled={isImporting}>
                  {isImporting ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Importing... Please wait
                    </span>
                  ) : (
                    "Import to Dispatch System"
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Advanced Search & Filter Bar */}
            <div className="mb-6 space-y-4">
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <Search className="h-5 w-5 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search by reference, customer, warehouse..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">Filters:</span>
                </div>

                <Select
                  value={selectedWarehouse}
                  onChange={(e) => setSelectedWarehouse(e.target.value)}
                  className="w-auto min-w-[200px]"
                >
                  <option value="all">All Warehouses</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse} value={warehouse}>
                      {warehouse}
                    </option>
                  ))}
                </Select>

                <Select
                  value={selectedPriority}
                  onChange={(e) => setSelectedPriority(e.target.value)}
                  className="w-auto"
                >
                  <option value="all">All Priorities</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </Select>

                <Select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as keyof ImportedOrder)}
                  className="w-auto"
                >
                  <option value="">Sort by...</option>
                  <option value="ref">Reference</option>
                  <option value="customer">Customer</option>
                  <option value="warehouse">Warehouse</option>
                  <option value="eta">ETA</option>
                  <option value="pallets">Pallets</option>
                </Select>

                {sortField && (
                  <button
                    onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                    className="flex items-center gap-1 px-3 py-1 bg-white border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                  >
                    <ArrowUpDown className="h-4 w-4" />
                    {sortDirection === "asc" ? "Ascending" : "Descending"}
                  </button>
                )}

                <span className="text-sm text-gray-600 ml-auto">
                  Showing {filteredAndSortedOrders.length} of {importedOrders.length} orders
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Reference</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Customer</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Warehouse</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Dropoff</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Priority</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">ETA</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Pallets</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Outstanding Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedOrders.map((order, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{order.ref}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{order.customer}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{order.warehouse ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{order.dropoff}</td>
                      <td className="px-4 py-3">
                        <Badge variant={getBadgeVariant(order.priority) as any}>
                          {order.priority || "normal"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{order.eta ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{order.pallets ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{order.outstandingQty ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}


      {/* Manual IBT Creation Modal */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Add IBT Manually</h2>
                <button
                  onClick={() => setShowManualModal(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Reference */}
                <div>
                  <label htmlFor="manual-ref" className="block text-sm font-medium text-gray-700 mb-2">
                    IBT / Transfer No <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="manual-ref"
                    type="text"
                    value={manualOrder.ref}
                    onChange={(e) => setManualOrder({ ...manualOrder, ref: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="IBT-0001"
                    required
                  />
                </div>

                {/* From Branch (Pickup/Warehouse) */}
                <div>
                  <label htmlFor="manual-from" className="block text-sm font-medium text-gray-700 mb-2">
                    From Branch / Source
                  </label>
                  <input
                    id="manual-from"
                    type="text"
                    value={manualOrder.warehouse || ""}
                    onChange={(e) => setManualOrder({ ...manualOrder, warehouse: e.target.value, pickup: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="K58 Warehouse"
                  />
                </div>

                {/* To Branch (Dropoff) */}
                <div>
                  <label htmlFor="manual-to" className="block text-sm font-medium text-gray-700 mb-2">
                    To Branch / Destination
                  </label>
                  <input
                    id="manual-to"
                    type="text"
                    value={manualOrder.dropoff}
                    onChange={(e) => setManualOrder({ ...manualOrder, dropoff: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="K63 Warehouse"
                  />
                </div>

                {/* Priority */}
                <div>
                  <label htmlFor="manual-priority" className="block text-sm font-medium text-gray-700 mb-2">
                    Priority
                  </label>
                  <select
                    id="manual-priority"
                    value={manualOrder.priority}
                    onChange={(e) => setManualOrder({ ...manualOrder, priority: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>

                {/* Due Date */}
                <div>
                  <label htmlFor="manual-eta" className="block text-sm font-medium text-gray-700 mb-2">
                    Due Date
                  </label>
                  <input
                    id="manual-eta"
                    type="date"
                    value={manualOrder.eta || ""}
                    onChange={(e) => setManualOrder({ ...manualOrder, eta: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                  />
                </div>

                {/* Pallets */}
                <div>
                  <label htmlFor="manual-pallets" className="block text-sm font-medium text-gray-700 mb-2">
                    Pallets
                  </label>
                  <input
                    id="manual-pallets"
                    type="number"
                    value={manualOrder.pallets || ""}
                    onChange={(e) => setManualOrder({ ...manualOrder, pallets: e.target.value ? parseInt(e.target.value) : undefined })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="0"
                    min="0"
                  />
                </div>

                {/* Outstanding Qty */}
                <div>
                  <label htmlFor="manual-qty" className="block text-sm font-medium text-gray-700 mb-2">
                    Outstanding Qty
                  </label>
                  <input
                    id="manual-qty"
                    type="number"
                    value={manualOrder.outstandingQty || ""}
                    onChange={(e) => setManualOrder({ ...manualOrder, outstandingQty: e.target.value ? parseInt(e.target.value) : undefined })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="0"
                    min="0"
                  />
                </div>

                {/* Notes - Full Width */}
                <div className="col-span-2">
                  <label htmlFor="manual-notes" className="block text-sm font-medium text-gray-700 mb-2">
                    Description / Items
                  </label>
                  <textarea
                    id="manual-notes"
                    value={manualOrder.notes || ""}
                    onChange={(e) => setManualOrder({ ...manualOrder, notes: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="Items being transferred"
                    rows={3}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 mt-6">
                <Button onClick={handleAddManualOrder} className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700">
                  <Save className="w-4 h-4" />
                  Add IBT
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="flex-1 bg-gray-200 text-gray-800 hover:bg-gray-300"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
