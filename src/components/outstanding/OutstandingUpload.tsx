import React, { useRef, useState } from "react";
import { ClipboardList, Download, Loader2, Trash2, Upload } from "lucide-react";
import * as XLSX from "../../lib/spreadsheet";
import { outstandingOrdersAPI, type DispatchUploadInfo } from "../../services/api";
import { useNotification } from "../../context/NotificationContext";
import { useAuth } from "../../context/AuthContext";
import { formatDateTime, formatNumber } from "../../utils/format";
import { formatIsoDate } from "../../utils/dispatchPerformance";
import { chunkByKey, parseOutstandingOrders } from "../../utils/dispatchImport";
import { readSheetRows } from "../dispatch/DispatchUploads";

const TEMPLATE: unknown[][] = [
  ["Company", "Document No", "Customer Code", "Customer Name", "Status", "Delivery Date", "Inventory Code", "Inventory Description", "Warehouse", "Outstanding Qty", "Unit Price", "Total Excl Tax Outstanding", "DateCreated", "CreatedByUserid"],
  ["Example Company", "ASO0001234", "CUS001", "Example Customer (Pty) Ltd", "In Progress", "2026-10-15", "5110890", "Product A", "Finished Goods", 300, 239.66, 71898, "2026-09-20", "Jane Doe"],
  ["Example Company", "ASO0001234", "CUS001", "Example Customer (Pty) Ltd", "In Progress", "2026-10-15", "5111233", "Product B", "Finished Goods", 280, 271.86, 76120.8, "2026-09-20", "Jane Doe"],
];

const downloadTemplate = async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(TEMPLATE), "Outstanding orders");
  await XLSX.writeFile(workbook, "outstanding-orders-template.xlsx");
};

interface OutstandingUploadProps {
  upload: DispatchUploadInfo | null;
  onUploaded: () => void;
}

export const OutstandingUpload: React.FC<OutstandingUploadProps> = ({ upload, onUploaded }) => {
  const { user } = useAuth();
  const { showSuccess, showError, confirm } = useNotification();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string>();
  const canUpload = user?.role !== "viewer";
  const isAdmin = user?.role === "admin";

  const handleFile = async (file: File) => {
    setBusy("Reading file…");
    try {
      const parsed = parseOutstandingOrders(await readSheetRows(file));
      if (parsed.rows.length === 0) throw new Error("No usable rows were found in this file.");
      const orders = new Set(parsed.rows.map((row) => row.documentNo)).size;
      const details = [
        `${formatNumber(parsed.rows.length)} lines across ${formatNumber(orders)} sales order${orders === 1 ? "" : "s"}, delivery dates ${formatIsoDate(parsed.minDate)} to ${formatIsoDate(parsed.maxDate)}.`,
        parsed.skipped ? `${formatNumber(parsed.skipped)} blank or total rows will be skipped.` : "",
        ...parsed.warnings,
        "This replaces the current outstanding orders list for everyone.",
      ].filter(Boolean).join("\n\n");
      const ok = await confirm({ title: "Upload outstanding sales orders?", message: details, confirmText: "Upload", type: "info" });
      if (!ok) return;

      const { id } = await outstandingOrdersAPI.startUpload(file.name, parsed.rows.length);
      let sent = 0;
      for (const chunk of chunkByKey(parsed.rows, (row) => row.documentNo, 2000)) {
        setBusy(`Uploading ${formatNumber(sent)} / ${formatNumber(parsed.rows.length)}…`);
        await outstandingOrdersAPI.uploadRows(id, chunk);
        sent += chunk.length;
      }
      await outstandingOrdersAPI.finishUpload(id);
      showSuccess(`Outstanding orders: ${formatNumber(orders)} sales orders uploaded.`);
      onUploaded();
    } catch (error) {
      showError(`Outstanding orders: ${error instanceof Error ? error.message : "Upload failed"}`);
    } finally {
      setBusy(undefined);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: "Delete outstanding sales orders?",
      message: "This removes the uploaded outstanding orders list for everyone. You'll need to upload the file again.",
      confirmText: "Delete",
      type: "danger",
    });
    if (!ok) return;
    try {
      const result = await outstandingOrdersAPI.clear();
      showSuccess(`Deleted ${formatNumber(result.deleted)} lines.`);
      onUploaded();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Delete failed");
    }
  };

  return (
    <div className="flex items-start gap-3 rounded-card border border-gray-200 bg-white p-4 shadow-card">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-50 text-emerald-600">
        <ClipboardList className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Outstanding sales orders export</p>
          {isAdmin && upload && !busy && (
            <button type="button" onClick={handleClear} className="text-gray-400 hover:text-red-500" title="Delete outstanding orders">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">Document No, Customer, Status, Delivery Date, Inventory, Warehouse, Outstanding Qty, Total Excl Tax. Each upload replaces the previous list.</p>
        <p className="mt-2 truncate text-xs text-gray-500" title={upload?.filename}>
          {upload ? `Last: ${upload.filename} · ${formatDateTime(upload.uploadedAt)}${upload.uploadedBy ? ` · ${upload.uploadedBy}` : ""}` : "Nothing uploaded yet"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canUpload && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-resilinc-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-resilinc-primary-dark disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {busy || "Upload .xlsx / .csv"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void downloadTemplate()}
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
};
