import React, { useRef, useState } from "react";
import { ArrowRightLeft, Download, FileSpreadsheet, Loader2, Receipt, Trash2, Upload } from "lucide-react";
import * as XLSX from "../../lib/spreadsheet";
import { dispatchPerformanceAPI, type DispatchUploadInfo, type DispatchUploadKind } from "../../services/api";
import { useNotification } from "../../context/NotificationContext";
import { useAuth } from "../../context/AuthContext";
import { formatDateTime, formatNumber } from "../../utils/format";
import { formatIsoDate } from "../../utils/dispatchPerformance";
import {
  chunkByKey,
  parseIbtTransactions,
  parseInvoiceLines,
  parseInvoiceRegister,
  type ParseResult,
} from "../../utils/dispatchImport";

interface UploadDefinition {
  kind: DispatchUploadKind;
  title: string;
  description: string;
  icon: React.FC<{ className?: string }>;
  unit: string;
  parse: (rows: unknown[][]) => ParseResult<Record<string, unknown>>;
  keyOf: (row: Record<string, unknown>) => string;
  /** Header row plus example rows, downloadable so users can see the expected layout. */
  template: unknown[][];
}

const UPLOADS: UploadDefinition[] = [
  {
    kind: "invoice-lines",
    title: "Invoice lines",
    description: "Document Date, Document No, Customer, Inventory, Qty, Totals",
    icon: Receipt,
    unit: "invoice",
    parse: parseInvoiceLines as unknown as UploadDefinition["parse"],
    keyOf: (row) => String(row.invoiceNo),
    template: [
      ["Document Date", "Document No", "Customer Name", "Inventory Name", "Warehouse", "Qty", "Unit Price Exclusive", "Total Exclusive", "Total Inclusive"],
      ["2026-10-01", "INV0001234", "Example Customer (Pty) Ltd", "Product A 25kg", "K58", 40, 520, 20800, 23920],
      ["2026-10-01", "INV0001234", "Example Customer (Pty) Ltd", "Product B 10kg", "K58", 12, 310, 3720, 4278],
    ],
  },
  {
    kind: "invoice-register",
    title: "Invoice register",
    description: "Invoice No, Sales Order, Dispatch Date, Delivery / Due Date",
    icon: FileSpreadsheet,
    unit: "invoice",
    parse: parseInvoiceRegister as unknown as UploadDefinition["parse"],
    keyOf: (row) => String(row.invoiceNo),
    template: [
      ["Invoice No", "Source Sales Order", "Invoice Delivery", "Dispatch Date", "Delivery / Due Date", "Customer", "Branch"],
      ["INV0001234", "SO0005678", "DN0009012", "2026-10-01", "2026-10-02", "Example Customer (Pty) Ltd", "Johannesburg"],
      ["INV0001235", "SO0005679", "DN0009013", "2026-10-01", "2026-10-03", "Another Customer CC", "Johannesburg"],
    ],
  },
  {
    kind: "ibt",
    title: "IBT transactions",
    description: "Reference, TransactionDate, WarehouseCode, QtyIn, QtyOut",
    icon: ArrowRightLeft,
    unit: "IBT",
    parse: parseIbtTransactions as unknown as UploadDefinition["parse"],
    keyOf: (row) => String(row.reference),
    template: [
      ["id", "Reference", "TransactionDate", "DocumentType", "InventoryCode", "InventoryName", "WarehouseCode", "QtyIn", "QtyOut"],
      [1001, "IBT000321", "2026-10-01", "Inter Branch Transfer", "PRD-A25", "Product A 25kg", "K58", 0, 40],
      [1002, "IBT000321", "2026-10-02", "Inter Branch Transfer", "PRD-A25", "Product A 25kg", "CPT01", 40, 0],
    ],
  },
];

const downloadTemplate = async (def: UploadDefinition) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(def.template), def.title);
  await XLSX.writeFile(workbook, `${def.kind}-template.xlsx`);
};

export const readSheetRows = async (file: File): Promise<unknown[][]> => {
  const isCsv = /\.(csv|txt|tsv)$/i.test(file.name);
  const workbook = isCsv
    ? await XLSX.read(await file.text(), { type: "string" })
    : await XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheet?.rawRows ?? [];
};

interface DispatchUploadsProps {
  uploads: Partial<Record<DispatchUploadKind, DispatchUploadInfo | null>>;
  onUploaded: (range: { minDate: string; maxDate: string }) => void;
}

export const DispatchUploads: React.FC<DispatchUploadsProps> = ({ uploads, onUploaded }) => {
  const { user } = useAuth();
  const { showSuccess, showError, confirm } = useNotification();
  const inputRefs = useRef<Partial<Record<DispatchUploadKind, HTMLInputElement | null>>>({});
  const [progress, setProgress] = useState<Partial<Record<DispatchUploadKind, string>>>({});
  const canUpload = user?.role !== "viewer";
  const isAdmin = user?.role === "admin";

  const setKindProgress = (kind: DispatchUploadKind, text: string | undefined) => (
    setProgress((prev) => ({ ...prev, [kind]: text }))
  );

  const handleFile = async (def: UploadDefinition, file: File) => {
    setKindProgress(def.kind, "Reading file…");
    try {
      const parsed = def.parse(await readSheetRows(file));
      if (parsed.rows.length === 0) throw new Error("No usable rows were found in this file.");
      const keys = new Set(parsed.rows.map(def.keyOf));

      const details = [
        `${formatNumber(parsed.rows.length)} rows covering ${formatNumber(keys.size)} ${def.unit}${keys.size === 1 ? "" : "s"}, dated ${formatIsoDate(parsed.minDate)} to ${formatIsoDate(parsed.maxDate)}.`,
        parsed.skipped ? `${formatNumber(parsed.skipped)} blank or incomplete rows will be skipped.` : "",
        ...parsed.warnings,
        `Any ${def.unit}s already uploaded with the same number will be replaced, not double-counted.`,
      ].filter(Boolean).join("\n\n");
      const ok = await confirm({ title: `Upload ${def.title.toLowerCase()}?`, message: details, confirmText: "Upload", type: "info" });
      if (!ok) return;

      const { id } = await dispatchPerformanceAPI.startUpload(def.kind, file.name, parsed.rows.length);
      const chunks = chunkByKey(parsed.rows, def.keyOf, 2000);
      let sent = 0;
      for (const chunk of chunks) {
        setKindProgress(def.kind, `Uploading ${formatNumber(sent)} / ${formatNumber(parsed.rows.length)}…`);
        await dispatchPerformanceAPI.uploadRows(def.kind, id, chunk);
        sent += chunk.length;
      }
      showSuccess(`${def.title}: ${formatNumber(keys.size)} ${def.unit}s uploaded.`);
      onUploaded({ minDate: parsed.minDate, maxDate: parsed.maxDate });
    } catch (error) {
      showError(`${def.title}: ${error instanceof Error ? error.message : "Upload failed"}`);
    } finally {
      setKindProgress(def.kind, undefined);
      const input = inputRefs.current[def.kind];
      if (input) input.value = "";
    }
  };

  const handleClear = async (def: UploadDefinition) => {
    const ok = await confirm({
      title: `Delete all ${def.title.toLowerCase()}?`,
      message: `This removes every uploaded ${def.title.toLowerCase()} row for everyone. You'll need to upload the file again.`,
      confirmText: "Delete",
      type: "danger",
    });
    if (!ok) return;
    try {
      const result = await dispatchPerformanceAPI.clear(def.kind);
      showSuccess(`Deleted ${formatNumber(result.deleted)} rows.`);
      onUploaded({ minDate: "", maxDate: "" });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Delete failed");
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {UPLOADS.map((def) => {
        const Icon = def.icon;
        const info = uploads[def.kind];
        const busy = progress[def.kind];
        return (
          <div key={def.kind} className="flex items-start gap-3 rounded-card border border-gray-200 bg-white p-4 shadow-card">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-50 text-emerald-600">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{def.title}</p>
                {isAdmin && info && !busy && (
                  <button type="button" onClick={() => handleClear(def)} className="text-gray-400 hover:text-red-500" title={`Delete all ${def.title.toLowerCase()}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{def.description}</p>
              <p className="mt-2 truncate text-xs text-gray-500" title={info?.filename}>
                {info ? `Last: ${info.filename} · ${formatDateTime(info.uploadedAt)}${info.uploadedBy ? ` · ${info.uploadedBy}` : ""}` : "Nothing uploaded yet"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {canUpload && (
                  <>
                    <input
                      ref={(el) => { inputRefs.current[def.kind] = el; }}
                      type="file"
                      accept=".xlsx,.csv"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleFile(def, file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => inputRefs.current[def.kind]?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-resilinc-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-resilinc-primary-dark disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {busy || "Upload .xlsx / .csv"}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void downloadTemplate(def)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  title="Download an example file showing the expected columns"
                >
                  <Download className="h-3.5 w-3.5" />
                  Template
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
