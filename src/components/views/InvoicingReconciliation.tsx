import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, FileText, PackageCheck, Search, ShieldCheck, Upload, XCircle } from "lucide-react";
import * as XLSX from "../../lib/spreadsheet";
import { useAuth } from "../../context/AuthContext";
import { useDispatch } from "../../context/DispatchContext";
import { useNotification } from "../../context/NotificationContext";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Button } from "../ui/Button";
import { formatNumber, formatPercent } from "../../utils/format";
import { makeNewJob, type Job, type ServiceType } from "../../types";
import { invoiceReconciliationAPI, type InvoiceReconciliationTimingNoteMeta } from "../../services/api";

type InvoiceStatus = "matched" | "not-invoiced" | "not-loaded" | "loaded-not-delivered" | "qty-mismatch";
type ReviewStatus = "open" | "needs-order-load" | "needs-dispatch-review" | "needs-finance-review" | "historical-invoice" | "not-dispatch-related" | "resolved" | "ignored";
type LedgerViewMode = "all" | "month" | "week";
type AuditViewMode = "week" | "month" | "all";
type LateInvoiceFilter = "all" | "reviewed" | "not-reviewed";

interface InvoiceLine {
  aso: string;
  invoiceNumber: string;
  invoiceDate: string;
  deliveryDueDate?: string;
  customer: string;
  invoiceQty: number;
  hasInvoiceQty: boolean;
  invoiceValue?: number;
  product?: string;
  createdBy?: string;
  deliveryStatus?: string;
  status?: string;
  postedDate?: string;
}

interface InvoiceSummary {
  aso: string;
  invoiceNumbers: string[];
  invoiceDates: string[];
  deliveryDueDates: string[];
  customer: string;
  invoiceQty: number;
  hasInvoiceQty: boolean;
  invoiceValue: number;
  products: string[];
  createdBy: string[];
  deliveryStatuses: string[];
  statuses: string[];
  postedDates: string[];
}

interface DeliveredSummary {
  aso: string;
  customer: string;
  deliveredQty: number;
  pallets: number;
  deliveredAt: string;
  lineCount: number;
  lines: Job[];
}

interface LoadedSummary {
  aso: string;
  customer: string;
  loadedQty: number;
  pallets: number;
  statuses: string[];
  latestUpdatedAt: string;
  lineCount: number;
  lines: Job[];
}

interface ReconciliationRow {
  aso: string;
  customer: string;
  deliveredQty: number;
  invoicedQty: number;
  varianceQty: number;
  pallets: number;
  deliveredAt: string;
  orderStatusDetail: string;
  invoiceNumbers: string;
  invoiceDates: string;
  deliveryDueDates: string;
  hasInvoiceQty: boolean;
  status: InvoiceStatus;
  lineCount: number;
  products: string;
  createdBy: string;
}

interface CreatorWorkload {
  createdBy: string;
  orderRows: number;
  orderQty: number;
  invoiceRows: number;
  asos: number;
  invoices: number;
  matchedAsos: number;
  workloadPercent: number;
  invoiceWorkloadPercent: number;
  activeMonths: number;
  averagePerMonth: number;
}

interface ConfirmDeliveryDraft {
  deliveredAt: string;
  serviceType: ServiceType;
  pallets: string;
  qty: string;
  notes: string;
}

interface NotLoadedDeliveryRow {
  invoiceNumber: string;
  systemDocumentNumber: string;
  aso: string;
  customer: string;
  product: string;
  warehouse: string;
  qty: number;
  pallets: number;
  serviceType: ServiceType;
  confirmedDate: string;
  documentDate: string;
  notes: string;
}

interface LateInvoiceReview {
  invoiceKey: string;
  invoiceNumber: string;
  aso: string;
  customer: string;
  createdBy: string;
  invoiceDate: string;
  deliveryDueDate: string;
  daysLate: number;
}

const STORAGE_KEY = "dispatch_invoice_reconciliation_lines_v1";
const REVIEW_STORAGE_KEY = "dispatch_invoice_reconciliation_review_v1";
const TIMING_NOTES_STORAGE_KEY = "dispatch_invoice_reconciliation_timing_notes_v1";
const TIMING_COMMENTS_STORAGE_KEY = "dispatch_invoice_reconciliation_timing_comments_v1";
const UPLOAD_META_STORAGE_KEY = "dispatch_invoice_reconciliation_upload_meta_v1";
const LATE_INVOICE_TARGET_PERCENT = 5;
const LATE_AGEING_BUCKETS = ["1-2 days", "3-5 days", "6-10 days", "10+ days"];

const lateInvoiceReasonOptions = [
  "System error",
  "Product loading error",
  "Account hold",
  "Pricing query",
  "Customer PO issue",
  "Stock availability issue",
  "Credit note / re-invoice",
  "Waiting for POD",
  "Logistics delay",
  "Supplier Doc delay",
  "QC hold",
  "Concession required",
  "Other",
];

const lateInvoiceReasonOwners: Record<string, string> = {
  "System error": "Systems",
  "Product loading error": "Operations",
  "Account hold": "Finance",
  "Pricing query": "Finance",
  "Customer PO issue": "Customer Service",
  "Stock availability issue": "Planning",
  "Credit note / re-invoice": "Finance",
  "Waiting for POD": "Logistics",
  "Logistics delay": "Logistics",
  "Supplier Doc delay": "Supplier / Admin",
  "QC hold": "Quality",
  "Concession required": "Commercial",
  Other: "Review",
};

interface InvoiceUploadMeta {
  filename: string;
  uploadedAt: string;
  rowsAdded: number;
  rowsSkipped: number;
  updatedById?: string;
}

interface ReconciliationAudit {
  id: string;
  entityType: string;
  entityKey: string;
  action: string;
  fromValue?: string;
  toValue?: string;
  userId?: string;
  createdAt: string;
}

interface PendingInvoiceUpload {
  filename: string;
  lines: InvoiceLine[];
  added: number;
  skipped: number;
}

const normalizeAso = (value: unknown) => String(value ?? "").trim();

const parseNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value).replace(/\s/g, "").replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDate = (value: unknown) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
};

const getInvoiceLedgerDate = (line: InvoiceLine) => line.invoiceDate || line.postedDate || line.deliveryDueDate || "";

const getInvoiceKey = (line: InvoiceLine) => {
  const invoiceNumber = line.invoiceNumber.trim().toLowerCase();
  if (invoiceNumber) return `invoice:${invoiceNumber}`;
  return [
    "row",
    line.aso,
    line.invoiceDate,
    line.deliveryDueDate,
    line.customer,
    line.invoiceQty,
    line.product,
    line.createdBy,
  ].map((value) => String(value ?? "").trim().toLowerCase()).join("|");
};

const getInvoiceDisplayKey = (line: InvoiceLine) => line.invoiceNumber.trim() || getInvoiceKey(line);

const getAuditDisplayKey = (audit: ReconciliationAudit) => audit.entityKey.replace(/^invoice:/i, "").trim();

const getLateAgeingBucket = (daysLate: number) => {
  if (daysLate <= 2) return "1-2 days";
  if (daysLate <= 5) return "3-5 days";
  if (daysLate <= 10) return "6-10 days";
  return "10+ days";
};

const makeExportPeriodSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all";

const mergeInvoiceLedger = (existingLines: InvoiceLine[], importedLines: InvoiceLine[]) => {
  const existingInvoiceNumbers = new Set(
    existingLines
      .map((line) => line.invoiceNumber.trim().toLowerCase())
      .filter(Boolean),
  );
  const existingRowKeys = new Set(existingLines.map(getInvoiceKey));
  const importedRowKeys = new Set<string>();
  const added: InvoiceLine[] = [];
  let skipped = 0;

  importedLines.forEach((line) => {
    const invoiceNumber = line.invoiceNumber.trim().toLowerCase();
    if (invoiceNumber) {
      if (existingInvoiceNumbers.has(invoiceNumber)) {
        skipped += 1;
        return;
      }
      added.push(line);
      return;
    }

    const rowKey = getInvoiceKey(line);
    if (existingRowKeys.has(rowKey) || importedRowKeys.has(rowKey)) {
      skipped += 1;
      return;
    }
    importedRowKeys.add(rowKey);
    added.push(line);
  });

  return {
    lines: [...existingLines, ...added],
    added: added.length,
    skipped,
  };
};

const getMonthKey = (dateValue: string) => (/^\d{4}-\d{2}/.test(dateValue) ? dateValue.slice(0, 7) : "");

const formatLocalDateKey = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0"),
].join("-");

const getWeekKey = (dateValue: string) => {
  const time = dateOnlyTime(dateValue);
  if (time === undefined) return "";
  const date = new Date(time);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return formatLocalDateKey(date);
};

const getOrderSourceDate = (job: Job) => normalizeDate(job.sourceCreatedDate || job.createdAt || job.updatedAt);
const isHiddenCreatorWorkloadName = (createdBy: string) => {
  const normalized = createdBy.trim().toLowerCase();
  return normalized === "unassigned" || normalized.includes("paradigm");
};

const dateOnlyTime = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
};

const isOnTimeInvoice = (invoiceDate: string | undefined, dueDate: string | undefined) => {
  const invoiceTime = dateOnlyTime(invoiceDate);
  const dueTime = dateOnlyTime(dueDate);
  if (invoiceTime === undefined || dueTime === undefined) return undefined;
  return invoiceTime <= dueTime;
};

const buildOnTimeInvoiceStats = (lines: InvoiceLine[]) => {
  const byInvoice = new Map<string, { invoiceDates: string[]; dueDates: string[] }>();

  lines.forEach((line) => {
    const invoiceKey = line.invoiceNumber.trim().toLowerCase() || getInvoiceKey(line);
    const existing = byInvoice.get(invoiceKey) || { invoiceDates: [], dueDates: [] };
    if (line.invoiceDate && !existing.invoiceDates.includes(line.invoiceDate)) existing.invoiceDates.push(line.invoiceDate);
    if (line.deliveryDueDate && !existing.dueDates.includes(line.deliveryDueDate)) existing.dueDates.push(line.deliveryDueDate);
    byInvoice.set(invoiceKey, existing);
  });

  let total = 0;
  let onTime = 0;
  byInvoice.forEach((invoice) => {
    const invoiceTimes = invoice.invoiceDates
      .map(dateOnlyTime)
      .filter((value): value is number => value !== undefined);
    const dueTimes = invoice.dueDates
      .map(dateOnlyTime)
      .filter((value): value is number => value !== undefined);
    if (invoiceTimes.length === 0 || dueTimes.length === 0) return;

    total += 1;
    if (Math.min(...invoiceTimes) <= Math.min(...dueTimes)) onTime += 1;
  });

  return {
    onTime,
    total,
    percent: total ? (onTime / total) * 100 : 0,
  };
};

const buildLateInvoiceReviews = (lines: InvoiceLine[]): LateInvoiceReview[] => {
  const byInvoice = new Map<string, { invoiceNumbers: string[]; asos: string[]; customers: string[]; creators: string[]; invoiceDates: string[]; dueDates: string[] }>();

  lines.forEach((line) => {
    const invoiceKey = line.invoiceNumber.trim().toLowerCase() ? `invoice:${line.invoiceNumber.trim().toLowerCase()}` : getInvoiceKey(line);
    const existing = byInvoice.get(invoiceKey) || { invoiceNumbers: [], asos: [], customers: [], creators: [], invoiceDates: [], dueDates: [] };
    const displayInvoice = getInvoiceDisplayKey(line);
    if (displayInvoice && !existing.invoiceNumbers.includes(displayInvoice)) existing.invoiceNumbers.push(displayInvoice);
    if (line.aso && !existing.asos.includes(line.aso)) existing.asos.push(line.aso);
    if (line.customer && !existing.customers.includes(line.customer)) existing.customers.push(line.customer);
    if (line.createdBy && !existing.creators.includes(line.createdBy)) existing.creators.push(line.createdBy);
    if (line.invoiceDate && !existing.invoiceDates.includes(line.invoiceDate)) existing.invoiceDates.push(line.invoiceDate);
    if (line.deliveryDueDate && !existing.dueDates.includes(line.deliveryDueDate)) existing.dueDates.push(line.deliveryDueDate);
    byInvoice.set(invoiceKey, existing);
  });

  return Array.from(byInvoice.entries()).flatMap(([invoiceKey, invoice]) => {
    const invoiceTimes = invoice.invoiceDates.map(dateOnlyTime).filter((value): value is number => value !== undefined);
    const dueTimes = invoice.dueDates.map(dateOnlyTime).filter((value): value is number => value !== undefined);
    if (invoiceTimes.length === 0 || dueTimes.length === 0) return [];
    const invoiceTime = Math.min(...invoiceTimes);
    const dueTime = Math.min(...dueTimes);
    if (invoiceTime <= dueTime) return [];
    return [{
      invoiceKey,
      invoiceNumber: invoice.invoiceNumbers.join(", ") || invoiceKey,
      aso: invoice.asos.join(", "),
      customer: invoice.customers[0] || "",
      createdBy: invoice.creators.join(", "),
      invoiceDate: formatLocalDateKey(new Date(invoiceTime)),
      deliveryDueDate: formatLocalDateKey(new Date(dueTime)),
      daysLate: Math.max(1, Math.round((invoiceTime - dueTime) / 86400000)),
    }];
  }).sort((a, b) => b.daysLate - a.daysLate || a.invoiceNumber.localeCompare(b.invoiceNumber));
};

const getOnTimeInvoiceLabel = (invoiceDates: string, deliveryDueDates: string) => {
  const dates = invoiceDates.split(", ").filter(Boolean);
  const dueDates = deliveryDueDates.split(", ").filter(Boolean);
  const comparisons = dates
    .flatMap((date) => dueDates.map((dueDate) => isOnTimeInvoice(date, dueDate)))
    .filter((value): value is boolean => value !== undefined);
  if (comparisons.length === 0) return "";
  const onTimeCount = comparisons.filter(Boolean).length;
  if (comparisons.length === 1) return onTimeCount === 1 ? "Yes" : "No";
  return formatPercent((onTimeCount / comparisons.length) * 100, 1);
};

const firstListValue = (value: string) => value.split(", ").map((item) => item.trim()).find(Boolean) || "";

const findValue = (row: Record<string, unknown>, aliases: string[]) => {
  const entries = Object.entries(row);
  const match = entries.find(([key]) => aliases.includes(key.trim().toLowerCase()));
  return match ? match[1] : undefined;
};

const loadInvoiceLines = (): InvoiceLine[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as InvoiceLine[] : [];
  } catch {
    return [];
  }
};

const saveInvoiceLines = (lines: InvoiceLine[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
};

const saveInvoiceLinesRemote = async (lines: InvoiceLine[]) => {
  const chunkSize = 500;
  for (let i = 0; i < lines.length; i += chunkSize) {
    await invoiceReconciliationAPI.bulkUpsertLines(lines.slice(i, i + chunkSize));
  }
};

const statusLabel: Record<InvoiceStatus, string> = {
  matched: "Delivered & Invoiced",
  "not-invoiced": "Delivered Not Invoiced",
  "not-loaded": "Invoiced Not Loaded",
  "loaded-not-delivered": "Loaded Not Delivered",
  "qty-mismatch": "Qty Mismatch",
};

const statusTone: Record<InvoiceStatus, string> = {
  matched: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "not-invoiced": "border-red-200 bg-red-50 text-red-700",
  "not-loaded": "border-amber-200 bg-amber-50 text-amber-700",
  "loaded-not-delivered": "border-yellow-200 bg-yellow-50 text-yellow-800",
  "qty-mismatch": "border-orange-200 bg-orange-50 text-orange-700",
};

const reviewLabel: Record<ReviewStatus, string> = {
  open: "Open",
  "needs-order-load": "Needs Order Load",
  "needs-dispatch-review": "Needs Dispatch Review",
  "needs-finance-review": "Needs Finance Review",
  "historical-invoice": "Invoiced Before System Start",
  "not-dispatch-related": "Not Dispatch Related",
  resolved: "Resolved",
  ignored: "Ignored",
};

const reviewTone: Record<ReviewStatus, string> = {
  open: "border-gray-200 bg-gray-50 text-gray-700",
  "needs-order-load": "border-amber-200 bg-amber-50 text-amber-800",
  "needs-dispatch-review": "border-yellow-200 bg-yellow-50 text-yellow-800",
  "needs-finance-review": "border-red-200 bg-red-50 text-red-700",
  "historical-invoice": "border-blue-200 bg-blue-50 text-blue-700",
  "not-dispatch-related": "border-slate-200 bg-slate-50 text-slate-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ignored: "border-gray-200 bg-gray-100 text-gray-600",
};

const reviewOptions: ReviewStatus[] = [
  "open",
  "needs-order-load",
  "needs-dispatch-review",
  "needs-finance-review",
  "historical-invoice",
  "not-dispatch-related",
  "resolved",
  "ignored",
];

const getExceptionOwner = (status: InvoiceStatus) => {
  if (status === "not-loaded") return "Dispatch/Admin";
  if (status === "loaded-not-delivered") return "Dispatch";
  if (status === "not-invoiced") return "Finance";
  if (status === "qty-mismatch") return "Dispatch/Finance";
  return "-";
};

const getDefaultReviewStatus = (status: InvoiceStatus): ReviewStatus => {
  if (status === "not-loaded") return "needs-order-load";
  if (status === "loaded-not-delivered") return "needs-dispatch-review";
  if (status === "not-invoiced") return "needs-finance-review";
  if (status === "matched") return "resolved";
  return "open";
};

const loadReviewState = (): Record<string, ReviewStatus> => {
  try {
    const raw = localStorage.getItem(REVIEW_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, ReviewStatus> : {};
  } catch {
    return {};
  }
};

const saveReviewState = (state: Record<string, ReviewStatus>) => {
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state));
};

const loadTimingNotes = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(TIMING_NOTES_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
};

const saveTimingNotes = (state: Record<string, string>) => {
  localStorage.setItem(TIMING_NOTES_STORAGE_KEY, JSON.stringify(state));
};

const loadTimingComments = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(TIMING_COMMENTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
};

const saveTimingComments = (state: Record<string, string>) => {
  localStorage.setItem(TIMING_COMMENTS_STORAGE_KEY, JSON.stringify(state));
};

const loadUploadMeta = (): InvoiceUploadMeta | null => {
  try {
    const raw = localStorage.getItem(UPLOAD_META_STORAGE_KEY);
    return raw ? JSON.parse(raw) as InvoiceUploadMeta : null;
  } catch {
    return null;
  }
};

const saveUploadMeta = (state: InvoiceUploadMeta | null) => {
  if (!state) localStorage.removeItem(UPLOAD_META_STORAGE_KEY);
  else localStorage.setItem(UPLOAD_META_STORAGE_KEY, JSON.stringify(state));
};

const saveReviewStateRemote = async (state: Record<string, ReviewStatus>) => {
  await invoiceReconciliationAPI.bulkUpsertReviews(state);
};

const saveTimingNotesRemote = async (state: Record<string, string>, comments: Record<string, string> = {}) => {
  return invoiceReconciliationAPI.bulkUpsertTimingNotes(state, comments);
};

const buildLoadedSummaries = (jobs: Job[]) => {
  const byRef = new Map<string, LoadedSummary>();
  jobs
    .filter((job) => job.jobType === "order" || job.jobType === undefined)
    .forEach((job) => {
      const aso = normalizeAso(job.ref);
      if (!aso) return;
      const existing = byRef.get(aso) || {
        aso,
        customer: job.customer || "",
        loadedQty: 0,
        pallets: 0,
        statuses: [],
        latestUpdatedAt: "",
        lineCount: 0,
        lines: [],
      };
      existing.customer = existing.customer || job.customer || "";
      existing.loadedQty += job.outstandingQty || 0;
      existing.pallets += job.pallets || 0;
      existing.lineCount += 1;
      existing.lines.push(job);
      if (job.status && !existing.statuses.includes(job.status)) existing.statuses.push(job.status);
      if (job.updatedAt && (!existing.latestUpdatedAt || new Date(job.updatedAt) > new Date(existing.latestUpdatedAt))) {
        existing.latestUpdatedAt = job.updatedAt;
      }
      byRef.set(aso, existing);
    });
  return byRef;
};

const buildDeliveredSummaries = (jobs: Job[]) => {
  const byRef = new Map<string, DeliveredSummary>();
  jobs
    .filter((job) => (job.jobType === "order" || job.jobType === undefined) && job.status === "delivered")
    .forEach((job) => {
      const aso = normalizeAso(job.ref);
      if (!aso) return;
      const existing = byRef.get(aso) || {
        aso,
        customer: job.customer || "",
        deliveredQty: 0,
        pallets: 0,
        deliveredAt: "",
        lineCount: 0,
        lines: [],
      };
      existing.customer = existing.customer || job.customer || "";
      existing.deliveredQty += job.outstandingQty || 0;
      existing.pallets += job.pallets || 0;
      existing.lineCount += 1;
      existing.lines.push(job);
      if (job.actualDeliveryAt && (!existing.deliveredAt || new Date(job.actualDeliveryAt) > new Date(existing.deliveredAt))) {
        existing.deliveredAt = job.actualDeliveryAt;
      }
      byRef.set(aso, existing);
    });
  return byRef;
};

const buildInvoiceSummaries = (lines: InvoiceLine[]) => {
  const byAso = new Map<string, InvoiceSummary>();
  lines.forEach((line) => {
    const aso = normalizeAso(line.aso);
    if (!aso) return;
    const existing = byAso.get(aso) || {
      aso,
      invoiceNumbers: [],
      invoiceDates: [],
      deliveryDueDates: [],
      customer: line.customer || "",
      invoiceQty: 0,
      hasInvoiceQty: false,
      invoiceValue: 0,
      products: [],
      createdBy: [],
      deliveryStatuses: [],
      statuses: [],
      postedDates: [],
    };
    if (line.invoiceNumber && !existing.invoiceNumbers.includes(line.invoiceNumber)) existing.invoiceNumbers.push(line.invoiceNumber);
    if (line.invoiceDate && !existing.invoiceDates.includes(line.invoiceDate)) existing.invoiceDates.push(line.invoiceDate);
    if (line.deliveryDueDate && !existing.deliveryDueDates.includes(line.deliveryDueDate)) existing.deliveryDueDates.push(line.deliveryDueDate);
    if (line.product && !existing.products.includes(line.product)) existing.products.push(line.product);
    if (line.createdBy && !existing.createdBy.includes(line.createdBy)) existing.createdBy.push(line.createdBy);
    if (line.deliveryStatus && !existing.deliveryStatuses.includes(line.deliveryStatus)) existing.deliveryStatuses.push(line.deliveryStatus);
    if (line.status && !existing.statuses.includes(line.status)) existing.statuses.push(line.status);
    if (line.postedDate && !existing.postedDates.includes(line.postedDate)) existing.postedDates.push(line.postedDate);
    existing.customer = existing.customer || line.customer || "";
    if (line.hasInvoiceQty) {
      existing.invoiceQty += line.invoiceQty || 0;
      existing.hasInvoiceQty = true;
    }
    existing.invoiceValue += line.invoiceValue || 0;
    byAso.set(aso, existing);
  });
  return byAso;
};

const parseInvoiceWorkbook = async (file: File): Promise<InvoiceLine[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = await XLSX.read(buffer, { type: "array", cellDates: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as Record<string, unknown>[];
  const parsedLines: InvoiceLine[] = [];

  rows.forEach((row) => {
    const aso = normalizeAso(findValue(row, ["aso", "ref", "reference", "order no", "order number", "document no", "sales order", "source sales order"]));
    if (!aso) return null;
    const invoiceQtyValue = findValue(row, ["invoice qty", "invoiced qty", "qty", "quantity", "invoice quantity"]);
    parsedLines.push({
      aso,
      invoiceNumber: String(findValue(row, ["invoice number", "invoice no", "invoice", "tax invoice"]) ?? "").trim(),
      invoiceDate: normalizeDate(findValue(row, ["invoice date", "document date", "date", "tax invoice date"])),
      deliveryDueDate: normalizeDate(findValue(row, ["delivery / due date", "delivery due date", "due date", "delivery date"])),
      customer: String(findValue(row, ["customer", "customer name", "client", "account name"]) ?? "").trim(),
      invoiceQty: parseNumber(invoiceQtyValue),
      hasInvoiceQty: invoiceQtyValue !== undefined && invoiceQtyValue !== null && String(invoiceQtyValue).trim() !== "",
      invoiceValue: parseNumber(findValue(row, ["invoice value", "value", "amount", "total", "net amount"])),
      product: String(findValue(row, ["product", "description", "inventory description", "item", "product description"]) ?? "").trim(),
      createdBy: String(findValue(row, ["created by", "creator", "createdby", "created user", "user"]) ?? "").trim(),
      deliveryStatus: String(findValue(row, ["delivery status"]) ?? "").trim(),
      status: String(findValue(row, ["status", "invoice status"]) ?? "").trim(),
      postedDate: normalizeDate(findValue(row, ["posted date", "posting date"])),
    });
  });

  return parsedLines;
};

const parseNotLoadedDeliveryWorkbook = async (file: File): Promise<NotLoadedDeliveryRow[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = await XLSX.read(buffer, { type: "array", cellDates: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as Record<string, unknown>[];

  return rows.map((row) => {
    const deliveryType = String(findValue(row, ["delivery type", "type", "delivered / collected", "delivery / collection"]) ?? "").trim().toLowerCase();
    const serviceType: ServiceType = deliveryType.startsWith("col") ? "collection" : "delivery";
    const systemDocumentNumber = String(findValue(row, ["system document no", "app document no", "document no", "invoice number", "invoice no", "invoice", "tax invoice"]) ?? "").trim();
    const pastedDocumentNumber = String(findValue(row, ["your document no", "matched document no", "uploaded document no", "document no from sheet"]) ?? "").trim();
    return {
      invoiceNumber: pastedDocumentNumber || systemDocumentNumber,
      systemDocumentNumber,
      aso: normalizeAso(findValue(row, ["aso", "source sales order", "sales order", "order no", "order number"])),
      customer: String(findValue(row, ["customer name", "customer", "client", "account name"]) ?? "").trim(),
      product: String(findValue(row, ["inventory name", "product", "description", "inventory description", "item", "product description"]) ?? "").trim(),
      warehouse: String(findValue(row, ["warehouse"]) ?? "").trim(),
      qty: parseNumber(findValue(row, ["qty", "quantity", "invoice qty", "invoiced qty"])),
      pallets: parseNumber(findValue(row, ["pallets", "pallet"])),
      serviceType,
      confirmedDate: normalizeDate(findValue(row, ["confirmed delivery date", "delivery / collection date", "delivery date", "confirmed date", "delivered date"])),
      documentDate: normalizeDate(findValue(row, ["document date", "invoice date", "date", "tax invoice date"])),
      notes: String(findValue(row, ["confirm notes", "notes", "details kept on shipment card", "comments"]) ?? "").trim(),
    };
  }).filter((row) => row.invoiceNumber);
};

interface InvoicingReconciliationProps {
  onNavigate?: (page: string, tab?: string, ref?: string) => void;
}

export const InvoicingReconciliation: React.FC<InvoicingReconciliationProps> = ({ onNavigate }) => {
  const { jobs, addJob } = useDispatch();
  const { showSuccess, showError, showWarning, confirm } = useNotification();
  const { isAdmin, user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const notLoadedFileInputRef = useRef<HTMLInputElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>(() => loadInvoiceLines());
  const [reviewState, setReviewState] = useState<Record<string, ReviewStatus>>(() => loadReviewState());
  const [timingNotes, setTimingNotes] = useState<Record<string, string>>(() => loadTimingNotes());
  const [timingComments, setTimingComments] = useState<Record<string, string>>(() => loadTimingComments());
  const [timingNoteMeta, setTimingNoteMeta] = useState<Record<string, InvoiceReconciliationTimingNoteMeta>>({});
  const [uploadMeta, setUploadMeta] = useState<InvoiceUploadMeta | null>(() => loadUploadMeta());
  const [uploadHistory, setUploadHistory] = useState<InvoiceUploadMeta[]>([]);
  const [auditHistory, setAuditHistory] = useState<ReconciliationAudit[]>([]);
  const [pendingInvoiceUpload, setPendingInvoiceUpload] = useState<PendingInvoiceUpload | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeStatus, setActiveStatus] = useState<InvoiceStatus | "all">("all");
  const [lateInvoiceFilter, setLateInvoiceFilter] = useState<LateInvoiceFilter>("not-reviewed");
  const [isImporting, setIsImporting] = useState(false);
  const [isConfirmingNotLoaded, setIsConfirmingNotLoaded] = useState(false);
  const [isLoadingLedger, setIsLoadingLedger] = useState(true);
  const [remoteSyncError, setRemoteSyncError] = useState("");
  const [viewMode, setViewMode] = useState<LedgerViewMode>("all");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [auditViewMode, setAuditViewMode] = useState<AuditViewMode>("week");
  const [selectedAuditMonth, setSelectedAuditMonth] = useState("");
  const [selectedAuditWeek, setSelectedAuditWeek] = useState("");
  const [selectedLateReason, setSelectedLateReason] = useState("");
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  const [showAsoReconciliation, setShowAsoReconciliation] = useState(false);
  const [showLateInvoiceDetails, setShowLateInvoiceDetails] = useState(false);
  const [selectedLateInvoiceKeys, setSelectedLateInvoiceKeys] = useState<Set<string>>(() => new Set());
  const [bulkLateReason, setBulkLateReason] = useState("");
  const [bulkLateComment, setBulkLateComment] = useState("");
  const [dirtyReviewCount, setDirtyReviewCount] = useState(0);
  const [confirmDeliveryRow, setConfirmDeliveryRow] = useState<ReconciliationRow | null>(null);
  const [confirmDeliveryDraft, setConfirmDeliveryDraft] = useState<ConfirmDeliveryDraft>({
    deliveredAt: "",
    serviceType: "delivery",
    pallets: "0",
    qty: "0",
    notes: "",
  });

  useEffect(() => {
    let cancelled = false;

    const loadRemoteLedger = async () => {
      setIsLoadingLedger(true);
      try {
        const remote = await invoiceReconciliationAPI.getAll();
        if (cancelled) return;

        if (remote.lines.length > 0) {
          setInvoiceLines(remote.lines);
          saveInvoiceLines(remote.lines);
        } else if (invoiceLines.length > 0) {
          await saveInvoiceLinesRemote(invoiceLines);
        }

        const remoteReviews = remote.reviews as Record<string, ReviewStatus>;
        if (Object.keys(remoteReviews).length > 0) {
          setReviewState(remoteReviews);
          saveReviewState(remoteReviews);
        } else if (Object.keys(reviewState).length > 0) {
          await saveReviewStateRemote(reviewState);
        }

        const remoteTimingNotes = remote.timingNotes || {};
        const remoteTimingComments = remote.timingComments || {};
        if (Object.keys(remoteTimingNotes).length > 0) {
          setTimingNotes(remoteTimingNotes);
          saveTimingNotes(remoteTimingNotes);
          setTimingComments(remoteTimingComments);
          saveTimingComments(remoteTimingComments);
          setTimingNoteMeta(remote.timingNoteMeta || {});
        } else if (Object.keys(timingNotes).length > 0) {
          const saved = await saveTimingNotesRemote(timingNotes, timingComments);
          setTimingNoteMeta(saved.timingNoteMeta || {});
          setTimingComments(saved.timingComments || timingComments);
        }

        if (remote.uploadMeta) {
          setUploadMeta(remote.uploadMeta);
          saveUploadMeta(remote.uploadMeta);
        }
        setUploadHistory((remote.uploads || []).filter(Boolean) as InvoiceUploadMeta[]);
        setAuditHistory(remote.audits || []);

        setRemoteSyncError("");
      } catch (error) {
        console.warn("Invoice reconciliation database sync unavailable, using local cache", error);
        if (!cancelled) setRemoteSyncError("Database sync unavailable. Using this browser's saved invoice reconciliation data.");
      } finally {
        if (!cancelled) setIsLoadingLedger(false);
      }
    };

    void loadRemoteLedger();

    return () => {
      cancelled = true;
    };
    // Run once on mount to hydrate from database or seed old local cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ledgerPeriods = useMemo(() => {
    const months = new Set<string>();
    const weeks = new Set<string>();
    invoiceLines.forEach((line) => {
      const ledgerDate = getInvoiceLedgerDate(line);
      const month = getMonthKey(ledgerDate);
      const week = getWeekKey(ledgerDate);
      if (month) months.add(month);
      if (week) weeks.add(week);
    });
    jobs.forEach((job) => {
      if (!((job.jobType === "order" || job.jobType === undefined) && job.status === "delivered")) return;
      const deliveredDate = normalizeDate(job.actualDeliveryAt);
      const month = getMonthKey(deliveredDate);
      const week = getWeekKey(deliveredDate);
      if (month) months.add(month);
      if (week) weeks.add(week);
    });
    return {
      months: Array.from(months).sort((a, b) => b.localeCompare(a)),
      weeks: Array.from(weeks).sort((a, b) => b.localeCompare(a)),
    };
  }, [invoiceLines, jobs]);

  const activeMonth = selectedMonth || ledgerPeriods.months[0] || "";
  const activeWeek = selectedWeek || ledgerPeriods.weeks[0] || "";

  const dedupedAuditHistory = useMemo(() => {
    const unique = new Map<string, ReconciliationAudit>();
    auditHistory
      .slice()
      .sort((a, b) => (dateOnlyTime(b.createdAt) ?? 0) - (dateOnlyTime(a.createdAt) ?? 0))
      .forEach((audit) => {
        const displayKey = getAuditDisplayKey(audit).toLowerCase();
        const key = audit.entityType === "late-invoice-reason"
          ? [audit.entityType, displayKey, audit.action.trim().toLowerCase()].join("|")
          : [
            audit.entityType,
            displayKey,
            audit.action.trim().toLowerCase(),
            String(audit.toValue || "").trim().toLowerCase(),
            normalizeDate(audit.createdAt),
          ].join("|");
        if (!unique.has(key) || unique.get(key)?.id.startsWith("local-")) {
          unique.set(key, audit);
        }
      });
    return Array.from(unique.values()).sort((a, b) => (dateOnlyTime(b.createdAt) ?? 0) - (dateOnlyTime(a.createdAt) ?? 0));
  }, [auditHistory]);

  const auditPeriods = useMemo(() => {
    const months = new Set<string>();
    const weeks = new Set<string>();
    dedupedAuditHistory.forEach((audit) => {
      const auditDate = normalizeDate(audit.createdAt);
      const month = getMonthKey(auditDate);
      const week = getWeekKey(auditDate);
      if (month) months.add(month);
      if (week) weeks.add(week);
    });
    return {
      months: Array.from(months).sort((a, b) => b.localeCompare(a)),
      weeks: Array.from(weeks).sort((a, b) => b.localeCompare(a)),
    };
  }, [dedupedAuditHistory]);

  const activeAuditMonth = selectedAuditMonth || auditPeriods.months[0] || "";
  const activeAuditWeek = selectedAuditWeek || auditPeriods.weeks[0] || "";
  const filteredAuditHistory = useMemo(() => {
    if (auditViewMode === "month" && activeAuditMonth) {
      return dedupedAuditHistory.filter((audit) => getMonthKey(normalizeDate(audit.createdAt)) === activeAuditMonth);
    }
    if (auditViewMode === "week" && activeAuditWeek) {
      return dedupedAuditHistory.filter((audit) => getWeekKey(normalizeDate(audit.createdAt)) === activeAuditWeek);
    }
    return dedupedAuditHistory;
  }, [activeAuditMonth, activeAuditWeek, auditViewMode, dedupedAuditHistory]);

  const invoiceLinesInView = useMemo(() => {
    if (viewMode === "month" && activeMonth) {
      return invoiceLines.filter((line) => getMonthKey(getInvoiceLedgerDate(line)) === activeMonth);
    }
    if (viewMode === "week" && activeWeek) {
      return invoiceLines.filter((line) => getWeekKey(getInvoiceLedgerDate(line)) === activeWeek);
    }
    return invoiceLines;
  }, [activeMonth, activeWeek, invoiceLines, viewMode]);

  const jobsInView = useMemo(() => {
    if (viewMode === "all") return jobs;
    return jobs.filter((job) => {
      if (!((job.jobType === "order" || job.jobType === undefined) && job.status === "delivered")) return true;
      const deliveredDate = normalizeDate(job.actualDeliveryAt);
      if (viewMode === "month" && activeMonth) return getMonthKey(deliveredDate) === activeMonth;
      if (viewMode === "week" && activeWeek) return getWeekKey(deliveredDate) === activeWeek;
      return true;
    });
  }, [activeMonth, activeWeek, jobs, viewMode]);

  const loadedByAso = useMemo(() => buildLoadedSummaries(jobs), [jobs]);
  const deliveredByAso = useMemo(() => buildDeliveredSummaries(jobsInView), [jobsInView]);
  const invoiceLinesForReconciliation = useMemo(() => {
    if (viewMode === "all") return invoiceLines;
    const deliveredAsosInView = new Set(deliveredByAso.keys());
    const invoiceRowsInView = new Set(invoiceLinesInView);
    return invoiceLines.filter((line) => invoiceRowsInView.has(line) || deliveredAsosInView.has(normalizeAso(line.aso)));
  }, [deliveredByAso, invoiceLines, invoiceLinesInView, viewMode]);
  const invoicedByAso = useMemo(() => buildInvoiceSummaries(invoiceLinesForReconciliation), [invoiceLinesForReconciliation]);

  const reconciliationRows = useMemo<ReconciliationRow[]>(() => {
    const allAsos = new Set([...deliveredByAso.keys(), ...invoicedByAso.keys()]);
    return Array.from(allAsos).map((aso) => {
      const loaded = loadedByAso.get(aso);
      const delivered = deliveredByAso.get(aso);
      const invoiced = invoicedByAso.get(aso);
      const deliveredQty = delivered?.deliveredQty || 0;
      const invoicedQty = invoiced?.invoiceQty || 0;
      const hasInvoiceQty = Boolean(invoiced?.hasInvoiceQty);
      let status: InvoiceStatus = "matched";
      if (delivered && !invoiced) status = "not-invoiced";
      else if (!loaded && invoiced) status = "not-loaded";
      else if (loaded && !delivered && invoiced) status = "loaded-not-delivered";
      else if (hasInvoiceQty && deliveredQty !== invoicedQty) status = "qty-mismatch";

      return {
        aso,
        customer: delivered?.customer || loaded?.customer || invoiced?.customer || "",
        deliveredQty,
        invoicedQty,
        varianceQty: deliveredQty - invoicedQty,
        pallets: delivered?.pallets || loaded?.pallets || 0,
        deliveredAt: delivered?.deliveredAt ? delivered.deliveredAt.slice(0, 10) : "",
        orderStatusDetail: loaded?.statuses.join(", ") || "",
        invoiceNumbers: invoiced?.invoiceNumbers.join(", ") || "",
        invoiceDates: invoiced?.invoiceDates.join(", ") || "",
        deliveryDueDates: invoiced?.deliveryDueDates.join(", ") || "",
        hasInvoiceQty,
        status,
        lineCount: delivered?.lineCount || loaded?.lineCount || 0,
        products: invoiced?.products.slice(0, 4).join("; ") || delivered?.lines.map((line) => line.notes).filter(Boolean).slice(0, 4).join("; ") || loaded?.lines.map((line) => line.notes).filter(Boolean).slice(0, 4).join("; ") || "",
        createdBy: invoiced?.createdBy.join(", ") || "",
      };
    }).sort((a, b) => {
      const severityOrder: Record<InvoiceStatus, number> = { "not-invoiced": 0, "not-loaded": 1, "loaded-not-delivered": 2, "qty-mismatch": 3, matched: 4 };
      return severityOrder[a.status] - severityOrder[b.status] || a.aso.localeCompare(b.aso);
    });
  }, [deliveredByAso, invoicedByAso, loadedByAso]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return reconciliationRows.filter((row) => {
      if (activeStatus !== "all" && row.status !== activeStatus) return false;
      if (!query) return true;
      const reviewStatus = reviewState[row.aso] || getDefaultReviewStatus(row.status);
      return [
        row.aso,
        row.customer,
        row.invoiceNumbers,
        row.invoiceDates,
        row.deliveryDueDates,
        row.createdBy,
        row.orderStatusDetail,
        row.products,
        statusLabel[row.status],
        getExceptionOwner(row.status),
        reviewLabel[reviewStatus],
      ].join(" ").toLowerCase().includes(query);
    });
  }, [activeStatus, reconciliationRows, reviewState, searchQuery]);

  const dataHealth = useMemo(() => {
    const invoiceNumbers = new Set<string>();
    let duplicateInvoices = 0;
    let missingAso = 0;
    let missingDocumentDate = 0;
    let missingDeliveryDueDate = 0;

    invoiceLinesInView.forEach((line) => {
      const invoiceNumber = normalizeAso(line.invoiceNumber).toLowerCase();
      if (!normalizeAso(line.aso)) missingAso += 1;
      if (!normalizeDate(line.invoiceDate)) missingDocumentDate += 1;
      if (!normalizeDate(line.deliveryDueDate)) missingDeliveryDueDate += 1;
      if (!invoiceNumber) return;
      if (invoiceNumbers.has(invoiceNumber)) duplicateInvoices += 1;
      invoiceNumbers.add(invoiceNumber);
    });

    return [
      { label: "Duplicate invoices", value: duplicateInvoices, tone: duplicateInvoices ? "text-amber-700" : "text-emerald-700" },
      { label: "Missing ASO", value: missingAso, tone: missingAso ? "text-red-700" : "text-emerald-700" },
      { label: "Missing document date", value: missingDocumentDate, tone: missingDocumentDate ? "text-amber-700" : "text-emerald-700" },
      { label: "Missing delivery / due date", value: missingDeliveryDueDate, tone: missingDeliveryDueDate ? "text-amber-700" : "text-emerald-700" },
    ];
  }, [invoiceLinesInView]);

  const stats = useMemo(() => {
    const bucket = (status: InvoiceStatus) => reconciliationRows.filter((row) => row.status === status);
    const historicalInvoices = reconciliationRows.filter((row) => reviewState[row.aso] === "historical-invoice");
    const notInvoiced = bucket("not-invoiced").filter((row) => reviewState[row.aso] !== "historical-invoice");
    const mismatch = bucket("qty-mismatch");
    const invoiceTiming = buildOnTimeInvoiceStats(invoiceLinesInView);
    return {
      delivered: deliveredByAso.size,
      invoiceLines: invoiceLinesInView.length,
      onTimeInvoices: invoiceTiming.onTime,
      invoiceTimingRows: invoiceTiming.total,
      onTimeInvoicePercent: invoiceTiming.percent,
      lateInvoices: Math.max(0, invoiceTiming.total - invoiceTiming.onTime),
      matched: bucket("matched").length,
      notInvoiced: notInvoiced.length,
      notLoaded: bucket("not-loaded").length,
      loadedNotDelivered: bucket("loaded-not-delivered").length,
      mismatch: mismatch.length,
      historicalInvoices: historicalInvoices.length,
      notInvoicedQty: notInvoiced.reduce((sum, row) => sum + row.deliveredQty, 0),
      varianceQty: mismatch.reduce((sum, row) => sum + Math.abs(row.varianceQty), 0),
      openExceptions: reconciliationRows.filter((row) => {
        if (row.status === "matched") return false;
        const reviewStatus = reviewState[row.aso] || getDefaultReviewStatus(row.status);
        return reviewStatus !== "resolved" && reviewStatus !== "ignored" && reviewStatus !== "not-dispatch-related" && reviewStatus !== "historical-invoice";
      }).length,
    };
  }, [deliveredByAso.size, invoiceLinesInView, reconciliationRows, reviewState]);
  const asoSummaryCards = useMemo(() => [
    { label: "Open Exceptions", value: stats.openExceptions, tone: "border-l-slate-500", helper: "Rows still needing action", status: "all" as const },
    { label: "Delivered Not Invoiced", value: stats.notInvoiced, tone: "border-l-red-500", helper: `${formatNumber(stats.notInvoicedQty)} qty`, status: "not-invoiced" as const },
    { label: "Invoiced Not Loaded", value: stats.notLoaded, tone: "border-l-amber-500", helper: "Needs order confirmation", status: "not-loaded" as const },
    { label: "Loaded Not Delivered", value: stats.loadedNotDelivered, tone: "border-l-yellow-500", helper: "Loaded, no delivery close", status: "loaded-not-delivered" as const },
    { label: "Matched", value: stats.matched, tone: "border-l-emerald-500", helper: "No action required", status: "matched" as const },
  ], [stats]);

  const orderJobsForCreatorWorkload = useMemo(() => {
    const orderJobs = jobs.filter((job) => job.jobType === "order" || job.jobType === undefined);
    if (viewMode === "month" && activeMonth) {
      return orderJobs.filter((job) => getMonthKey(getOrderSourceDate(job)) === activeMonth);
    }
    if (viewMode === "week" && activeWeek) {
      return orderJobs.filter((job) => getWeekKey(getOrderSourceDate(job)) === activeWeek);
    }
    return orderJobs;
  }, [activeMonth, activeWeek, jobs, viewMode]);

  // Monthly order value totals — grouped by sourceCreatedDate month (not invoice date)
  const monthlyOrderValues = useMemo(() => {
    const orderJobs = jobs.filter((job) => job.jobType === "order" || job.jobType === undefined);
    const byMonth = new Map<string, { total: number; orderCount: number }>();
    orderJobs.forEach((job) => {
      if (!job.totalExclVat) return;
      const monthKey = getMonthKey(getOrderSourceDate(job));
      if (!monthKey) return;
      const existing = byMonth.get(monthKey) || { total: 0, orderCount: 0 };
      existing.total += job.totalExclVat;
      existing.orderCount += 1;
      byMonth.set(monthKey, existing);
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, data]) => ({ monthKey, ...data }));
  }, [jobs]);

  const creatorWorkload = useMemo<CreatorWorkload[]>(() => {
    const statusByAso = new Map(reconciliationRows.map((row) => [row.aso, row.status]));
    const byCreator = new Map<string, { orderRows: number; orderQty: number; invoiceRows: number; asos: Set<string>; invoices: Set<string>; matchedAsos: Set<string>; months: Set<string> }>();
    orderJobsForCreatorWorkload.forEach((job) => {
      const createdBy = job.sourceCreatedBy || "Unassigned";
      if (isHiddenCreatorWorkloadName(createdBy)) return;
      const aso = normalizeAso(job.ref);
      const existing = byCreator.get(createdBy) || {
        orderRows: 0,
        orderQty: 0,
        invoiceRows: 0,
        asos: new Set<string>(),
        invoices: new Set<string>(),
        matchedAsos: new Set<string>(),
        months: new Set<string>(),
      };
      existing.orderRows += 1;
      existing.orderQty += job.outstandingQty || 0;
      if (aso) {
        existing.asos.add(aso);
        const status = statusByAso.get(aso);
        if (status === "matched" || status === "qty-mismatch") existing.matchedAsos.add(aso);
      }
      const month = getOrderSourceDate(job).slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) existing.months.add(month);
      byCreator.set(createdBy, existing);
    });

    invoiceLinesInView.forEach((line) => {
      const createdBy = line.createdBy || "Unassigned";
      if (isHiddenCreatorWorkloadName(createdBy)) return;
      const aso = normalizeAso(line.aso);
      const existing = byCreator.get(createdBy) || {
        orderRows: 0,
        orderQty: 0,
        invoiceRows: 0,
        asos: new Set<string>(),
        invoices: new Set<string>(),
        matchedAsos: new Set<string>(),
        months: new Set<string>(),
      };
      existing.invoiceRows += 1;
      if (aso) {
        existing.asos.add(aso);
        const status = statusByAso.get(aso);
        if (status === "matched" || status === "qty-mismatch") existing.matchedAsos.add(aso);
      }
      if (line.invoiceNumber) existing.invoices.add(line.invoiceNumber);
      const month = (line.invoiceDate || line.deliveryDueDate || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) existing.months.add(month);
      byCreator.set(createdBy, existing);
    });

    const totalOrderRows = orderJobsForCreatorWorkload.filter((job) => !isHiddenCreatorWorkloadName(job.sourceCreatedBy || "Unassigned")).length || 0;
    const totalInvoiceRows = invoiceLinesInView.filter((line) => !isHiddenCreatorWorkloadName(line.createdBy || "Unassigned")).length || 0;
    return Array.from(byCreator.entries())
      .map(([createdBy, workload]) => ({
        createdBy,
        orderRows: workload.orderRows,
        orderQty: workload.orderQty,
        invoiceRows: workload.invoiceRows,
        asos: workload.asos.size,
        invoices: workload.invoices.size,
        matchedAsos: workload.matchedAsos.size,
        workloadPercent: totalOrderRows ? (workload.orderRows / totalOrderRows) * 100 : 0,
        invoiceWorkloadPercent: totalInvoiceRows ? (workload.invoiceRows / totalInvoiceRows) * 100 : 0,
        activeMonths: workload.months.size,
        averagePerMonth: workload.months.size ? workload.orderRows / workload.months.size : workload.orderRows,
      }))
      .sort((a, b) => b.orderRows - a.orderRows || b.invoiceRows - a.invoiceRows || a.createdBy.localeCompare(b.createdBy));
  }, [invoiceLinesInView, orderJobsForCreatorWorkload, reconciliationRows]);

  const lateInvoiceReviews = useMemo(() => buildLateInvoiceReviews(invoiceLinesInView), [invoiceLinesInView]);
  const lateInvoicesWithoutReason = useMemo(() => lateInvoiceReviews.filter((invoice) => !timingNotes[invoice.invoiceKey]), [lateInvoiceReviews, timingNotes]);
  const lateInvoicesWithReason = useMemo(() => lateInvoiceReviews.filter((invoice) => Boolean(timingNotes[invoice.invoiceKey])), [lateInvoiceReviews, timingNotes]);
  const filteredLateInvoiceReviews = useMemo(() => lateInvoiceReviews.filter((invoice) => {
    const hasReason = Boolean(timingNotes[invoice.invoiceKey]);
    if (selectedLateReason && timingNotes[invoice.invoiceKey] !== selectedLateReason) return false;
    if (lateInvoiceFilter === "reviewed") return hasReason;
    if (lateInvoiceFilter === "not-reviewed") return !hasReason;
    return true;
  }), [lateInvoiceFilter, lateInvoiceReviews, selectedLateReason, timingNotes]);
  const lateInvoiceReasonTrend = useMemo(() => {
    const total = lateInvoicesWithReason.length || 0;
    const counts = new Map<string, { count: number; ageing: Map<string, number> }>();
    lateInvoicesWithReason.forEach((invoice) => {
      const reason = timingNotes[invoice.invoiceKey];
      const existing = counts.get(reason) || {
        count: 0,
        ageing: new Map(LATE_AGEING_BUCKETS.map((bucket) => [bucket, 0])),
      };
      const ageingBucket = getLateAgeingBucket(invoice.daysLate);
      existing.count += 1;
      existing.ageing.set(ageingBucket, (existing.ageing.get(ageingBucket) || 0) + 1);
      counts.set(reason, existing);
    });

    return Array.from(counts.entries())
      .map(([reason, item]) => ({
        reason,
        count: item.count,
        percent: total ? (item.count / total) * 100 : 0,
        ageing: LATE_AGEING_BUCKETS.map((bucket) => {
          const count = item.ageing.get(bucket) || 0;
          return {
            bucket,
            count,
            percent: item.count ? (count / item.count) * 100 : 0,
          };
        }),
      }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  }, [lateInvoicesWithReason, timingNotes]);
  const lateInvoiceOwnerTrend = useMemo(() => {
    const total = lateInvoicesWithReason.length || 0;
    const counts = new Map<string, number>();
    lateInvoicesWithReason.forEach((invoice) => {
      const owner = lateInvoiceReasonOwners[timingNotes[invoice.invoiceKey]] || "Review";
      counts.set(owner, (counts.get(owner) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([owner, count]) => ({
        owner,
        count,
        percent: total ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
  }, [lateInvoicesWithReason, timingNotes]);
  const lateInvoiceAgeing = useMemo(() => {
    const total = lateInvoiceReviews.length;
    const counts = new Map<string, number>(LATE_AGEING_BUCKETS.map((bucket) => [bucket, 0]));
    lateInvoiceReviews.forEach((invoice) => {
      const bucket = getLateAgeingBucket(invoice.daysLate);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([bucket, count]) => ({
      bucket,
      count,
      percent: total ? (count / total) * 100 : 0,
    }));
  }, [lateInvoiceReviews]);
  const lateInvoiceRate = stats.invoiceTimingRows ? (stats.lateInvoices / stats.invoiceTimingRows) * 100 : 0;
  const managerSummary = useMemo(() => {
    const topReason = lateInvoiceReasonTrend[0];
    const topOwner = lateInvoiceOwnerTrend[0];
    const worstAgeing = lateInvoiceAgeing.slice().sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket))[0];
    return {
      topReason,
      topOwner,
      worstAgeing,
      isTargetMet: lateInvoiceRate <= LATE_INVOICE_TARGET_PERCENT,
    };
  }, [lateInvoiceAgeing, lateInvoiceOwnerTrend, lateInvoiceRate, lateInvoiceReasonTrend]);

  const selectLateReason = (reason: string) => {
    setSelectedLateReason(reason);
    setLateInvoiceFilter("reviewed");
    setShowLateInvoiceDetails(true);
  };

  const clearLateReasonFilter = () => {
    setSelectedLateReason("");
  };

  const visibleLateInvoiceKeys = useMemo(() => filteredLateInvoiceReviews.map((invoice) => invoice.invoiceKey), [filteredLateInvoiceReviews]);
  const selectedVisibleLateInvoiceCount = useMemo(() => visibleLateInvoiceKeys.filter((invoiceKey) => selectedLateInvoiceKeys.has(invoiceKey)).length, [selectedLateInvoiceKeys, visibleLateInvoiceKeys]);

  const toggleLateInvoiceSelection = (invoiceKey: string) => {
    setSelectedLateInvoiceKeys((current) => {
      const next = new Set(current);
      if (next.has(invoiceKey)) next.delete(invoiceKey);
      else next.add(invoiceKey);
      return next;
    });
  };

  const toggleAllVisibleLateInvoices = () => {
    setSelectedLateInvoiceKeys((current) => {
      const next = new Set(current);
      const allSelected = visibleLateInvoiceKeys.length > 0 && visibleLateInvoiceKeys.every((invoiceKey) => next.has(invoiceKey));
      visibleLateInvoiceKeys.forEach((invoiceKey) => {
        if (allSelected) next.delete(invoiceKey);
        else next.add(invoiceKey);
      });
      return next;
    });
  };

  const updateTimingNote = (invoiceKey: string, note: string) => {
    const previous = timingNotes[invoiceKey] || "";
    const next = { ...timingNotes, [invoiceKey]: note };
    setTimingNotes(next);
    saveTimingNotes(next);
    setTimingNoteMeta((meta) => ({
      ...meta,
      [invoiceKey]: {
        updatedById: user?.id || "",
        updatedByName: user?.username || "",
        updatedAt: new Date().toISOString(),
      },
    }));
    setAuditHistory((history) => [
      {
        id: `local-${invoiceKey}-${Date.now()}`,
        entityType: "late-invoice-reason",
        entityKey: invoiceKey,
        action: "Late invoice reason updated",
        fromValue: previous,
        toValue: note,
        createdAt: new Date().toISOString(),
      },
      ...history,
    ]);
    void saveTimingNotesRemote({ [invoiceKey]: note }, { [invoiceKey]: timingComments[invoiceKey] || "" })
      .then((saved) => {
        setTimingNoteMeta((meta) => ({ ...meta, ...(saved.timingNoteMeta || {}) }));
        setTimingComments((comments) => ({ ...comments, ...(saved.timingComments || {}) }));
        setRemoteSyncError("");
      })
      .catch((error) => {
        console.warn("Failed to sync invoice timing note", error);
        setRemoteSyncError("Database sync failed. Late invoice notes are saved in this browser and will retry when edited again.");
      });
  };

  const updateTimingComment = (invoiceKey: string, comment: string) => {
    const next = { ...timingComments, [invoiceKey]: comment };
    setTimingComments(next);
    saveTimingComments(next);
  };

  const applyBulkLateReason = () => {
    if (!bulkLateReason) {
      showWarning("Select a late invoice reason before applying to selected rows.");
      return;
    }
    if (selectedLateInvoiceKeys.size === 0) {
      showWarning("Select at least one late invoice row first.");
      return;
    }
    const selectedKeys = Array.from(selectedLateInvoiceKeys);
    const nextNotes = { ...timingNotes };
    const nextComments = { ...timingComments };
    selectedKeys.forEach((invoiceKey) => {
      nextNotes[invoiceKey] = bulkLateReason;
      if (bulkLateComment.trim()) nextComments[invoiceKey] = bulkLateComment.trim();
    });
    setTimingNotes(nextNotes);
    setTimingComments(nextComments);
    saveTimingNotes(nextNotes);
    saveTimingComments(nextComments);
    setTimingNoteMeta((meta) => {
      const nextMeta = { ...meta };
      selectedKeys.forEach((invoiceKey) => {
        nextMeta[invoiceKey] = {
          updatedById: user?.id || "",
          updatedByName: user?.username || "",
          updatedAt: new Date().toISOString(),
        };
      });
      return nextMeta;
    });
    setSelectedLateInvoiceKeys(new Set());
    setLateInvoiceFilter("reviewed");
    showSuccess(`Applied ${bulkLateReason} to ${formatNumber(selectedKeys.length)} late invoice${selectedKeys.length === 1 ? "" : "s"}.`);
    void saveTimingNotesRemote(
      selectedKeys.reduce<Record<string, string>>((acc, invoiceKey) => {
        acc[invoiceKey] = bulkLateReason;
        return acc;
      }, {}),
      selectedKeys.reduce<Record<string, string>>((acc, invoiceKey) => {
        acc[invoiceKey] = nextComments[invoiceKey] || "";
        return acc;
      }, {}),
    )
      .then((saved) => {
        setTimingNoteMeta((meta) => ({ ...meta, ...(saved.timingNoteMeta || {}) }));
        setTimingComments((comments) => ({ ...comments, ...(saved.timingComments || {}) }));
        setRemoteSyncError("");
      })
      .catch((error) => {
        console.warn("Failed to sync bulk late invoice reasons", error);
        setRemoteSyncError("Database sync failed. Bulk late invoice reasons are saved in this browser and can be retried with Save Reasons.");
      });
  };

  const saveLateInvoiceReasons = async () => {
    try {
      const saved = await saveTimingNotesRemote(timingNotes, timingComments);
      setTimingNoteMeta((meta) => ({ ...meta, ...(saved.timingNoteMeta || {}) }));
      setTimingComments((comments) => ({ ...comments, ...(saved.timingComments || {}) }));
      setRemoteSyncError("");
      setLateInvoiceFilter("not-reviewed");
      setSelectedLateReason("");
      showSuccess("Late invoice reasons saved. Reviewed invoices moved out of the active queue.");
    } catch (error) {
      console.warn("Failed to save late invoice reasons", error);
      setRemoteSyncError("Database sync failed. Late invoice reasons are saved in this browser and can be retried.");
      showWarning("Late invoice reasons saved in this browser, but database sync failed.");
    }
  };

  const exportLateInvoiceReasons = async () => {
    if (lateInvoiceReviews.length === 0) {
      showWarning("No late invoices found in the current view.");
      return;
    }
    const detailRows = lateInvoiceReviews.map((invoice) => ({
      Invoice: invoice.invoiceNumber,
      ASO: invoice.aso,
      Customer: invoice.customer,
      "Created By": invoice.createdBy,
      "Document Date": invoice.invoiceDate,
      "Delivery / Due Date": invoice.deliveryDueDate,
      "Days Late": invoice.daysLate,
      "Ageing Bucket": getLateAgeingBucket(invoice.daysLate),
      Reason: timingNotes[invoice.invoiceKey] || "No reason selected",
      Owner: lateInvoiceReasonOwners[timingNotes[invoice.invoiceKey]] || "Review",
      Comment: timingComments[invoice.invoiceKey] || "",
      "Reviewed By": timingNoteMeta[invoice.invoiceKey]?.updatedByName || timingNoteMeta[invoice.invoiceKey]?.updatedById || "",
      "Reviewed Date": normalizeDate(timingNoteMeta[invoice.invoiceKey]?.updatedAt || ""),
    }));
    const trendRows = lateInvoiceReasonTrend.map((item) => ({
      Reason: item.reason,
      Count: item.count,
      "Share %": formatPercent(item.percent, 1),
      ...Object.fromEntries(item.ageing.map((bucket) => [`${bucket.bucket} Count`, bucket.count])),
      ...Object.fromEntries(item.ageing.map((bucket) => [`${bucket.bucket} Share`, formatPercent(bucket.percent, 1)])),
    }));
    const ageingRows = lateInvoiceAgeing.map((item) => ({
      Bucket: item.bucket,
      Count: item.count,
      "Share %": formatPercent(item.percent, 1),
    }));
    const ownerRows = lateInvoiceOwnerTrend.map((item) => ({
      Owner: item.owner,
      Count: item.count,
      "Share %": formatPercent(item.percent, 1),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(trendRows), "ReasonTrend");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ownerRows), "OwnerTrend");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ageingRows), "Ageing");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), "LateInvoices");
    await XLSX.writeFile(workbook, `late_invoice_reason_report_${makeExportPeriodSlug(activeViewLabel)}.xlsx`);
  };

  const importInvoices = async (file: File | undefined) => {
    if (!file) return;
    setIsImporting(true);
    try {
      const lines = await parseInvoiceWorkbook(file);
      if (lines.length === 0) {
        showWarning("No invoice rows found. Make sure the file has an ASO column.");
        return;
      }
      const merged = mergeInvoiceLedger(invoiceLines, lines);
      setPendingInvoiceUpload({
        filename: file.name,
        lines,
        added: merged.added,
        skipped: merged.skipped,
      });
    } catch (error) {
      console.error("Failed to import invoice spreadsheet", error);
      showError("Could not import the invoice spreadsheet.");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const commitInvoiceUpload = async () => {
    if (!pendingInvoiceUpload) return;
    setIsImporting(true);
    try {
      const merged = mergeInvoiceLedger(invoiceLines, pendingInvoiceUpload.lines);
      setInvoiceLines(merged.lines);
      saveInvoiceLines(merged.lines);
      const nextUploadMeta = {
        filename: pendingInvoiceUpload.filename,
        uploadedAt: new Date().toISOString(),
        rowsAdded: merged.added,
        rowsSkipped: merged.skipped,
      };
      setUploadMeta(nextUploadMeta);
      saveUploadMeta(nextUploadMeta);
      if (merged.added > 0) {
        try {
          await saveInvoiceLinesRemote(merged.lines);
          const savedUpload = await invoiceReconciliationAPI.recordUpload(nextUploadMeta);
          if (savedUpload) {
            setUploadMeta(savedUpload);
            saveUploadMeta(savedUpload);
            setUploadHistory((history) => [savedUpload, ...history].slice(0, 25));
          }
          setRemoteSyncError("");
          showSuccess(`Added ${merged.added} new invoice row${merged.added === 1 ? "" : "s"} to the database. ${merged.skipped} already existed.`);
        } catch (syncError) {
          console.warn("Failed to sync invoice ledger", syncError);
          setRemoteSyncError("Database sync failed. Changes are saved in this browser and will retry on the next upload.");
          showWarning(`Added ${merged.added} locally. Database sync failed and will need retry.`);
        }
      } else {
        void invoiceReconciliationAPI.recordUpload(nextUploadMeta).then((savedUpload) => {
          if (savedUpload) {
            setUploadMeta(savedUpload);
            saveUploadMeta(savedUpload);
            setUploadHistory((history) => [savedUpload, ...history].slice(0, 25));
          }
        }).catch((syncError) => {
          console.warn("Failed to record invoice upload", syncError);
          setRemoteSyncError("Database sync failed. Upload history is saved in this browser and will retry on the next upload.");
        });
        showSuccess(`No new invoice rows added. ${merged.skipped} already existed.`);
      }
      setPendingInvoiceUpload(null);
    } catch (error) {
      console.error("Failed to commit invoice upload", error);
      showError("Could not save the invoice upload.");
    } finally {
      setIsImporting(false);
    }
  };

  const resetInvoiceLedger = async () => {
    const proceed = await confirm({
      title: "Reset Invoice Ledger",
      message: "This will permanently clear all uploaded invoice reconciliation rows from this browser so you can upload a fresh invoice sheet. Review statuses will be kept.",
      type: "danger",
      confirmText: "Reset Ledger",
    });
    if (!proceed) return;
    const resetReason = window.prompt("Reason for resetting the invoice ledger?");
    if (!resetReason?.trim()) {
      showWarning("Reset cancelled. A reset reason is required.");
      return;
    }
    try {
      await invoiceReconciliationAPI.resetLines(resetReason.trim());
      setRemoteSyncError("");
    } catch (error) {
      console.warn("Failed to reset invoice ledger in database", error);
      setRemoteSyncError("Database reset failed. Invoice ledger was not cleared.");
      showWarning("Invoice ledger could not be reset in the database.");
      return;
    }
    setInvoiceLines([]);
    saveInvoiceLines([]);
    setUploadMeta(null);
    saveUploadMeta(null);
    setUploadHistory([]);
    setSearchQuery("");
    setActiveStatus("all");
    setViewMode("all");
    setSelectedMonth("");
    setSelectedWeek("");
    setAuditHistory((history) => [{
      id: `local-reset-${Date.now()}`,
      entityType: "invoice-ledger",
      entityKey: "all",
      action: "Invoice ledger reset",
      toValue: resetReason.trim(),
      createdAt: new Date().toISOString(),
    }, ...history]);
    showSuccess("Invoice ledger cleared. You can upload a new invoice sheet from scratch.");
  };

  const updateReviewStatus = (aso: string, status: ReviewStatus) => {
    const next = { ...reviewState, [aso]: status };
    setReviewState(next);
    saveReviewState(next);
    setDirtyReviewCount((count) => count + 1);
    void saveReviewStateRemote({ [aso]: status }).catch((error) => {
      console.warn("Failed to sync invoice review status", error);
      setRemoteSyncError("Database sync failed. Review changes are saved in this browser and can be retried with Save All Reviews.");
    });
  };

  const saveAllReviews = async () => {
    saveReviewState(reviewState);
    try {
      await saveReviewStateRemote(reviewState);
      setDirtyReviewCount(0);
      setRemoteSyncError("");
      showSuccess("Review statuses saved.");
    } catch (error) {
      console.warn("Failed to sync invoice review statuses", error);
      setRemoteSyncError("Database sync failed. Review statuses are saved in this browser and can be retried.");
      showWarning("Review statuses saved in this browser, but database sync failed.");
    }
  };

  const copyAso = async (aso: string) => {
    try {
      await navigator.clipboard.writeText(aso);
      showSuccess(`Copied ${aso}.`);
    } catch {
      showError("Could not copy ASO.");
    }
  };

  const openExistingOrder = (row: ReconciliationRow) => {
    const targetTab =
      row.status === "not-invoiced" ? "delivered" :
      row.status === "loaded-not-delivered" ? "in-transit" :
      "open";
    onNavigate?.("clipboard", targetTab, row.aso);
  };

  const openConfirmDelivery = (row: ReconciliationRow) => {
    setConfirmDeliveryRow(row);
    setConfirmDeliveryDraft({
      deliveredAt: row.deliveryDueDates.split(", ")[0] || row.invoiceDates.split(", ")[0] || new Date().toISOString().slice(0, 10),
      serviceType: "delivery",
      pallets: String(row.pallets || 0),
      qty: String(row.invoicedQty || 0),
      notes: row.products || `Confirmed from invoice ${row.invoiceNumbers || ""}`.trim(),
    });
  };

  const confirmInvoiceDelivery = async () => {
    if (!confirmDeliveryRow) return;
    if (jobs.some((job) => normalizeAso(job.ref) === confirmDeliveryRow.aso && (job.jobType === "order" || job.jobType === undefined))) {
      showWarning(`${confirmDeliveryRow.aso} is already loaded in Order Management.`);
      setConfirmDeliveryRow(null);
      return;
    }

    try {
      const deliveredAt = confirmDeliveryDraft.deliveredAt || new Date().toISOString().slice(0, 10);
      await addJob(makeNewJob({
        ref: confirmDeliveryRow.aso,
        customer: confirmDeliveryRow.customer || "Customer to confirm",
        pickup: "Confirmed from invoice reconciliation",
        dropoff: confirmDeliveryRow.customer || "Delivered / collected",
        priority: "normal",
        status: "delivered",
        jobType: "order",
        serviceType: confirmDeliveryDraft.serviceType,
        pallets: parseNumber(confirmDeliveryDraft.pallets),
        outstandingQty: parseNumber(confirmDeliveryDraft.qty),
        eta: deliveredAt,
        actualDeliveryAt: deliveredAt,
        notes: confirmDeliveryDraft.notes,
        internalNotes: `Confirmed delivery from Invoicing Reconciliation. Invoice: ${confirmDeliveryRow.invoiceNumbers || "not captured"}. Document date: ${confirmDeliveryRow.invoiceDates || "not captured"}.`,
      }));
      updateReviewStatus(confirmDeliveryRow.aso, "resolved");
      setConfirmDeliveryRow(null);
      showSuccess(`${confirmDeliveryRow.aso} confirmed as ${confirmDeliveryDraft.serviceType === "collection" ? "collected" : "delivered"} and reconciled.`);
    } catch (error) {
      console.error("Failed to confirm invoice delivery", error);
      showError("Could not confirm the delivered order.");
    }
  };

  const importNotLoadedDeliveries = async (file: File | undefined) => {
    if (!file) return;
    setIsConfirmingNotLoaded(true);
    try {
      const uploadRows = await parseNotLoadedDeliveryWorkbook(file);
      if (uploadRows.length === 0) {
        showWarning("No completed not loaded delivery rows found. Make sure the file has a Document No column.");
        return;
      }

      const invoiceByNumber = new Map(
        invoiceLines
          .filter((line) => line.invoiceNumber)
          .map((line) => [line.invoiceNumber.trim().toLowerCase(), line]),
      );
      const rowByAso = new Map(reconciliationRows.map((row) => [row.aso, row]));
      const existingOrderAsos = new Set(
        jobs
          .filter((job) => job.jobType === "order" || job.jobType === undefined)
          .map((job) => normalizeAso(job.ref))
          .filter(Boolean),
      );
      const nextReviewState = { ...reviewState };
      let confirmed = 0;
      let skipped = 0;
      const reasons: string[] = [];

      for (const uploadRow of uploadRows) {
        const invoiceLine = invoiceByNumber.get(uploadRow.invoiceNumber.trim().toLowerCase());
        const aso = uploadRow.aso || invoiceLine?.aso || "";
        const reconciliationRow = aso ? rowByAso.get(aso) : undefined;

        if (!invoiceLine) {
          skipped += 1;
          reasons.push(`${uploadRow.invoiceNumber}: invoice not found`);
          continue;
        }
        if (!aso || !reconciliationRow) {
          skipped += 1;
          reasons.push(`${uploadRow.invoiceNumber}: ASO not found`);
          continue;
        }
        if (reconciliationRow.status !== "not-loaded") {
          skipped += 1;
          reasons.push(`${uploadRow.invoiceNumber}: ASO is not Invoiced Not Loaded`);
          continue;
        }
        if (existingOrderAsos.has(aso)) {
          skipped += 1;
          reasons.push(`${uploadRow.invoiceNumber}: ASO already loaded`);
          continue;
        }

        const deliveredAt = uploadRow.confirmedDate || uploadRow.documentDate || firstListValue(reconciliationRow.deliveryDueDates) || firstListValue(reconciliationRow.invoiceDates) || new Date().toISOString().slice(0, 10);
        const notes = uploadRow.notes || uploadRow.product || reconciliationRow.products || `Confirmed from invoice ${uploadRow.invoiceNumber}`;
        await addJob(makeNewJob({
          ref: aso,
          customer: uploadRow.customer || reconciliationRow.customer || invoiceLine.customer || "Customer to confirm",
          pickup: uploadRow.warehouse || "Confirmed from invoice reconciliation",
          dropoff: uploadRow.customer || reconciliationRow.customer || invoiceLine.customer || "Delivered / collected",
          priority: "normal",
          status: "delivered",
          jobType: "order",
          serviceType: uploadRow.serviceType,
          pallets: uploadRow.pallets || reconciliationRow.pallets || 0,
          outstandingQty: uploadRow.qty || reconciliationRow.invoicedQty || invoiceLine.invoiceQty || 0,
          eta: deliveredAt,
          actualDeliveryAt: deliveredAt,
          notes,
          internalNotes: `Bulk confirmed from Invoiced Not Loaded template. Invoice: ${uploadRow.invoiceNumber}. Document date: ${uploadRow.documentDate || invoiceLine.invoiceDate || "not captured"}.`,
        }));
        existingOrderAsos.add(aso);
        nextReviewState[aso] = "resolved";
        confirmed += 1;
      }

      if (confirmed > 0) {
        setReviewState(nextReviewState);
        saveReviewState(nextReviewState);
        try {
          await saveReviewStateRemote(nextReviewState);
          setDirtyReviewCount(0);
          setRemoteSyncError("");
        } catch (syncError) {
          console.warn("Failed to sync invoice review statuses", syncError);
          setRemoteSyncError("Database sync failed. Review changes are saved in this browser and can be retried with Save All Reviews.");
        }
      }

      if (confirmed > 0 && skipped === 0) {
        showSuccess(`Confirmed ${confirmed} invoiced not loaded shipment${confirmed === 1 ? "" : "s"}.`);
      } else if (confirmed > 0) {
        showWarning(`Confirmed ${confirmed}. Skipped ${skipped}. ${reasons.slice(0, 3).join("; ")}`);
      } else {
        showWarning(`No shipments confirmed. ${reasons.slice(0, 3).join("; ") || "Rows did not match open Invoiced Not Loaded invoices."}`);
      }
    } catch (error) {
      console.error("Failed to import not loaded delivery confirmations", error);
      showError("Could not import the completed not loaded template.");
    } finally {
      setIsConfirmingNotLoaded(false);
      if (notLoadedFileInputRef.current) notLoadedFileInputRef.current.value = "";
    }
  };

  const scrollTable = (direction: "left" | "right") => {
    tableScrollRef.current?.scrollBy({
      left: direction === "left" ? -560 : 560,
      behavior: "smooth",
    });
  };

  const setAsoStatusFilter = (status: InvoiceStatus | "all") => {
    setActiveStatus(status);
    setShowAsoReconciliation(true);
  };

  const downloadTemplate = async () => {
    const data = [
      ["Invoice No", "Source Sales Order", "Document Date", "Delivery / Due Date", "Customer", "Created By", "Delivery Status", "Status", "Posted Date", "Invoice Qty"],
      ["INV-0001", "SO-0001", "2026-06-03", "2026-06-05", "Customer Name", "Creator Name", "Delivered", "Posted", "2026-06-03", "100"],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), "InvoiceUpload");
    await XLSX.writeFile(workbook, "invoice_reconciliation_template.xlsx");
  };

  const downloadInvoicedNotLoadedTemplate = async () => {
    const notLoadedRows = reconciliationRows.filter((row) => row.status === "not-loaded");
    if (notLoadedRows.length === 0) {
      showWarning("No Invoiced Not Loaded rows found in the current ledger view.");
      return;
    }

    const rows = notLoadedRows.map((row) => {
      const documentDate = firstListValue(row.invoiceDates);
      const deliveryDueDate = firstListValue(row.deliveryDueDates);
      return {
        "Document Date": documentDate,
        "Your Document No": "",
        "System Document No": firstListValue(row.invoiceNumbers),
        "ASO": row.aso,
        "Customer Name": row.customer,
        "Inventory Name": row.products,
        "Warehouse": "",
        "Qty": row.invoicedQty || "",
        "pallets": row.pallets || "",
        "Delivery Type": "Delivered",
        "Confirmed Delivery Date": deliveryDueDate || documentDate,
        "Confirm Notes": row.products || `Confirmed from invoice ${firstListValue(row.invoiceNumbers)}`.trim(),
      };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "InvoicedNotLoaded");
    await XLSX.writeFile(workbook, "invoiced_not_loaded_delivery_template.xlsx");
  };

  const exportReport = async () => {
    const rows = reconciliationRows.map((row) => ({
      ASO: row.aso,
      Customer: row.customer,
      Status: statusLabel[row.status],
      "Exception Owner": getExceptionOwner(row.status),
      "Review Status": reviewLabel[reviewState[row.aso] || getDefaultReviewStatus(row.status)],
      "Delivered Qty": row.deliveredQty,
      Pallets: row.pallets,
      "Delivered Date": row.deliveredAt,
      "Invoice Numbers": row.invoiceNumbers,
      "Document Date": row.invoiceDates,
      "Delivery / Due Date": row.deliveryDueDates,
      "On Time Invoice": getOnTimeInvoiceLabel(row.invoiceDates, row.deliveryDueDates),
      "Created By": row.createdBy,
      "Delivered Lines": row.lineCount,
      Products: row.products,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Reconciliation");
    await XLSX.writeFile(workbook, "invoicing_reconciliation_report.xlsx");
  };

  const exportExceptions = async () => {
    const exceptionRows = reconciliationRows.filter((row) => row.status !== "matched");
    const lateWithoutReason = lateInvoiceReviews.filter((invoice) => !timingNotes[invoice.invoiceKey]);
    if (exceptionRows.length === 0 && lateWithoutReason.length === 0) {
      showWarning("No open reconciliation exceptions found in the current view.");
      return;
    }

    const workbook = XLSX.utils.book_new();
    const appendRows = (sheetName: string, rows: Record<string, unknown>[]) => {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
    };
    const rowToExport = (row: ReconciliationRow) => ({
      ASO: row.aso,
      Customer: row.customer,
      Status: statusLabel[row.status],
      Owner: getExceptionOwner(row.status),
      "Review Status": reviewLabel[reviewState[row.aso] || getDefaultReviewStatus(row.status)],
      "Delivered Qty": row.deliveredQty,
      Pallets: row.pallets,
      "Delivered Date": row.deliveredAt,
      "Invoice Numbers": row.invoiceNumbers,
      "Document Date": row.invoiceDates,
      "Delivery / Due Date": row.deliveryDueDates,
      Products: row.products,
    });

    appendRows("DeliveredNotInvoiced", exceptionRows.filter((row) => row.status === "not-invoiced").map(rowToExport));
    appendRows("InvoicedNotLoaded", exceptionRows.filter((row) => row.status === "not-loaded").map(rowToExport));
    appendRows("LoadedNotDelivered", exceptionRows.filter((row) => row.status === "loaded-not-delivered").map(rowToExport));
    appendRows("QtyMismatch", exceptionRows.filter((row) => row.status === "qty-mismatch").map(rowToExport));
    appendRows("LateNeedsReason", lateWithoutReason.map((invoice) => ({
      Invoice: invoice.invoiceNumber,
      ASO: invoice.aso,
      Customer: invoice.customer,
      "Created By": invoice.createdBy,
      "Document Date": invoice.invoiceDate,
      "Delivery / Due Date": invoice.deliveryDueDate,
      "Days Late": invoice.daysLate,
    })));
    await XLSX.writeFile(workbook, "invoicing_reconciliation_exceptions.xlsx");
  };

  const activeViewLabel =
    viewMode === "month" && activeMonth ? `Month ${activeMonth}` :
    viewMode === "week" && activeWeek ? `Week from ${activeWeek}` :
    "All invoice history";

  const statCards = [
    { label: "Delivered ASOs", value: stats.delivered, tone: "border-l-emerald-500", status: "all" as const },
    { label: "Invoice Documents", value: stats.invoiceLines, tone: "border-l-blue-500", status: "all" as const },
    { label: "On-Time Invoice", value: formatPercent(stats.onTimeInvoicePercent, 1), sub: `${formatNumber(stats.onTimeInvoices)} of ${formatNumber(stats.invoiceTimingRows)} invoices`, tone: "border-l-cyan-500", status: "all" as const },
    { label: "Late Invoices", value: stats.lateInvoices, sub: `${formatNumber(lateInvoicesWithoutReason.length)} needs reason`, tone: "border-l-red-500", status: "all" as const },
    { label: "Open Exceptions", value: stats.openExceptions, tone: "border-l-slate-500", status: "all" as const },
    { label: "Delivered Not Invoiced", value: stats.notInvoiced, sub: `${formatNumber(stats.notInvoicedQty)} qty`, tone: "border-l-red-500", status: "not-invoiced" as const },
    { label: "Historical Invoices", value: stats.historicalInvoices, tone: "border-l-blue-500", status: "not-invoiced" as const },
    { label: "Invoiced Not Loaded", value: stats.notLoaded, tone: "border-l-amber-500", status: "not-loaded" as const },
    { label: "Loaded Not Delivered", value: stats.loadedNotDelivered, tone: "border-l-yellow-500", status: "loaded-not-delivered" as const },
    { label: "Qty Mismatch", value: stats.mismatch, sub: `${formatNumber(stats.varianceQty)} variance`, tone: "border-l-orange-500", status: "qty-mismatch" as const },
    { label: "Matched", value: stats.matched, tone: "border-l-green-500", status: "matched" as const },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoicing Reconciliation</h1>
          <p className="text-sm text-gray-500">Invoice uploads are saved as a ledger, then viewed by all history, month, or week.</p>
          {remoteSyncError && <p className="mt-1 text-xs font-semibold text-amber-700">{remoteSyncError}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(event) => void importInvoices(event.target.files?.[0])}
          />
          <input
            ref={notLoadedFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(event) => void importNotLoadedDeliveries(event.target.files?.[0])}
          />
          <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
            <Upload className="h-4 w-4" />
            {isImporting ? "Importing..." : "Upload Invoice Sheet"}
          </Button>
          <Button variant="outline" className="gap-2" onClick={downloadTemplate}>
            <Download className="h-4 w-4" />
            Invoice Template
          </Button>
          <Button variant="outline" className="gap-2" onClick={downloadInvoicedNotLoadedTemplate} disabled={stats.notLoaded === 0}>
            <Download className="h-4 w-4" />
            Not Loaded Match Template
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => notLoadedFileInputRef.current?.click()}
            disabled={isConfirmingNotLoaded || stats.notLoaded === 0}
          >
            <Upload className="h-4 w-4" />
            {isConfirmingNotLoaded ? "Confirming..." : "Upload Not Loaded"}
          </Button>
          <Button variant="outline" className="gap-2" onClick={exportReport} disabled={reconciliationRows.length === 0}>
            <FileText className="h-4 w-4" />
            Export Report
          </Button>
          <Button variant="outline" className="gap-2" onClick={exportExceptions} disabled={reconciliationRows.length === 0 && lateInvoiceReviews.length === 0}>
            <Download className="h-4 w-4" />
            Export Exceptions
          </Button>
          {isAdmin && (
            <Button variant="outline" className="gap-2 border-red-200 text-red-700 hover:bg-red-50" onClick={() => void resetInvoiceLedger()} disabled={invoiceLines.length === 0}>
              <XCircle className="h-4 w-4" />
              Reset Ledger
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ledger View</p>
              <p className="text-sm font-semibold text-gray-900">{activeViewLabel}</p>
              <p className="text-xs text-gray-500">
                {formatNumber(invoiceLinesInView.length)} rows in view from {formatNumber(invoiceLines.length)} saved rows.
                {isLoadingLedger ? " Loading database ledger..." : ""}
              </p>
              {uploadMeta && (
                <p className="mt-1 text-xs text-gray-500">
                  Last upload: <span className="font-semibold text-gray-700">{uploadMeta.filename}</span> on {normalizeDate(uploadMeta.uploadedAt)} ({formatNumber(uploadMeta.rowsAdded)} added, {formatNumber(uploadMeta.rowsSkipped)} skipped)
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-card border border-gray-200 bg-gray-50 p-1">
                {[
                  { id: "all" as LedgerViewMode, label: "All" },
                  { id: "month" as LedgerViewMode, label: "Month" },
                  { id: "week" as LedgerViewMode, label: "Week" },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setViewMode(option.id)}
                    className={`h-8 rounded px-3 text-xs font-bold transition ${
                      viewMode === option.id ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {viewMode === "month" && (
                <select
                  value={activeMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                  className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {ledgerPeriods.months.length === 0 ? (
                    <option value="">No months</option>
                  ) : ledgerPeriods.months.map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              )}
              {viewMode === "week" && (
                <select
                  value={activeWeek}
                  onChange={(event) => setSelectedWeek(event.target.value)}
                  className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {ledgerPeriods.weeks.length === 0 ? (
                    <option value="">No weeks</option>
                  ) : ledgerPeriods.weeks.map((week) => (
                    <option key={week} value={week}>Week from {week}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {uploadHistory.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100 p-5">
            <CardTitle className="text-lg">Upload History</CardTitle>
            <p className="text-sm text-gray-500">Recent invoice uploads saved to the reconciliation database.</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">File</th>
                    <th className="px-4 py-3 text-left">Uploaded</th>
                    <th className="px-4 py-3 text-right">Added</th>
                    <th className="px-4 py-3 text-right">Skipped</th>
                    <th className="px-4 py-3 text-left">User</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadHistory.map((upload, index) => (
                    <tr key={`${upload.filename}-${upload.uploadedAt}-${index}`} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="max-w-[320px] truncate px-4 py-3 font-semibold text-gray-800" title={upload.filename}>{upload.filename}</td>
                      <td className="px-4 py-3 text-gray-600">{normalizeDate(upload.uploadedAt)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatNumber(upload.rowsAdded)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-700">{formatNumber(upload.rowsSkipped)}</td>
                      <td className="px-4 py-3 text-gray-500">{upload.updatedById || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-10">
        {statCards.map((card) => {
          const isFilterCard = card.status !== "all";
          const className = `min-h-[96px] rounded-lg border border-gray-200 border-l-[3px] ${card.tone} bg-white p-3 text-left transition ${
            isFilterCard ? "cursor-pointer hover:border-gray-300 hover:shadow-sm" : "cursor-default"
          } ${isFilterCard && activeStatus === card.status ? "bg-emerald-50/40 ring-1 ring-emerald-300" : ""}`;
          const content = (
            <>
              <p className="min-h-[28px] text-[11px] font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{typeof card.value === "number" ? formatNumber(card.value) : card.value}</p>
              {card.sub && <p className="mt-1 text-xs font-semibold text-gray-500">{card.sub}</p>}
            </>
          );
          return isFilterCard ? (
            <button key={card.label} type="button" onClick={() => setAsoStatusFilter(card.status)} className={className}>
              {content}
            </button>
          ) : (
            <div key={card.label} className={className}>
              {content}
            </div>
          );
        })}
      </div>

      {monthlyOrderValues.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-gray-700">Order Value by Month — Excl. VAT</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {monthlyOrderValues.map(({ monthKey, total, orderCount }) => (
              <div key={monthKey} className="rounded-lg border border-gray-200 border-l-[3px] border-l-violet-500 bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{monthKey}</p>
                <p className="mt-1 text-lg font-bold text-gray-900">R {total.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="mt-1 text-xs text-gray-400">{orderCount} line{orderCount !== 1 ? "s" : ""}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-bold text-gray-900">Data Health</p>
              <p className="text-xs text-gray-500">Quick checks on the invoice documents in the selected ledger view.</p>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-4">
              {dataHealth.map((item) => (
                <div key={item.label} className="rounded-card border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{item.label}</p>
                  <p className={`mt-1 text-xl font-bold ${item.tone}`}>{formatNumber(item.value)}</p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {creatorWorkload.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100 p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle className="text-lg">Creator Workload</CardTitle>
                <p className="text-sm text-gray-500">Loaded order lines and invoice documents grouped by creator.</p>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{formatNumber(orderJobsForCreatorWorkload.length)} loaded order lines in view</p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Created By</th>
                    <th className="px-4 py-3 text-right">Loaded Orders</th>
                    <th className="px-4 py-3 text-right">Loaded Qty</th>
                    <th className="px-4 py-3 text-right">Invoice Documents</th>
                    <th className="px-4 py-3 text-right">Order Workload %</th>
                    <th className="px-4 py-3 text-right">Invoice Workload %</th>
                    <th className="px-4 py-3 text-right">Avg / Month</th>
                    <th className="px-4 py-3 text-right">ASOs</th>
                    <th className="px-4 py-3 text-right">Invoices</th>
                    <th className="px-4 py-3 text-right">Matched ASOs</th>
                  </tr>
                </thead>
                <tbody>
                  {creatorWorkload.map((workload) => (
                    <tr key={workload.createdBy} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-800">{workload.createdBy}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatNumber(workload.orderRows)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatNumber(workload.orderQty)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatNumber(workload.invoiceRows)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatPercent(workload.workloadPercent, 1)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatPercent(workload.invoiceWorkloadPercent, 1)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(Math.round(workload.averagePerMonth))}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(workload.asos)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(workload.invoices)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(workload.matchedAsos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {lateInvoiceReviews.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <CardTitle className="text-lg">Late Invoice Review</CardTitle>
                <p className="text-sm text-gray-500">Add a reason for invoices where the document date is after the delivery / due date. Saved reasons remain in the trend.</p>
                <p className="mt-2 inline-flex rounded-card border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Showing: {activeViewLabel}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedLateReason && (
                  <Button variant="outline" size="sm" className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50" onClick={clearLateReasonFilter}>
                    Reason: {selectedLateReason}
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500">{formatNumber(lateInvoicesWithoutReason.length)} needs reason</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowLateInvoiceDetails((value) => !value)}>
                  {showLateInvoiceDetails ? "Hide Late Invoice Details" : "Show Late Invoice Details"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-b border-gray-100 bg-gray-50 p-5">
              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-card border border-gray-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top Late Reason</p>
                  <p className="mt-1 text-base font-bold text-gray-900">{managerSummary.topReason?.reason || "No reviewed reasons"}</p>
                  <p className="text-xs text-gray-500">{managerSummary.topReason ? `${formatNumber(managerSummary.topReason.count)} invoices | ${formatPercent(managerSummary.topReason.percent, 1)}` : "Add reasons to build the trend."}</p>
                </div>
                <div className="rounded-card border border-gray-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Likely Owner</p>
                  <p className="mt-1 text-base font-bold text-gray-900">{managerSummary.topOwner?.owner || "No owner trend"}</p>
                  <p className="text-xs text-gray-500">{managerSummary.topOwner ? `${formatNumber(managerSummary.topOwner.count)} invoices | ${formatPercent(managerSummary.topOwner.percent, 1)}` : "Owner mapping follows selected reasons."}</p>
                </div>
                <div className="rounded-card border border-gray-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Worst Ageing Bucket</p>
                  <p className="mt-1 text-base font-bold text-gray-900">{managerSummary.worstAgeing?.bucket || "-"}</p>
                  <p className="text-xs text-gray-500">{managerSummary.worstAgeing ? `${formatNumber(managerSummary.worstAgeing.count)} invoices | ${formatPercent(managerSummary.worstAgeing.percent, 1)}` : "No late invoices in view."}</p>
                </div>
                <div className={`rounded-card border bg-white p-3 ${managerSummary.isTargetMet ? "border-emerald-200" : "border-red-200"}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Late Invoice Target</p>
                  <p className={`mt-1 text-base font-bold ${managerSummary.isTargetMet ? "text-emerald-700" : "text-red-700"}`}>
                    {formatPercent(lateInvoiceRate, 1)} / {formatPercent(LATE_INVOICE_TARGET_PERCENT, 0)}
                  </p>
                  <p className="text-xs text-gray-500">{managerSummary.isTargetMet ? "On target for selected period." : "Above target for selected period."}</p>
                </div>
              </div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-gray-900">Reason Trend</p>
                  <p className="text-xs text-gray-500">Grouped by saved late invoice reasons with ageing severity for {activeViewLabel.toLowerCase()}.</p>
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{formatNumber(lateInvoicesWithReason.length)} reviewed</p>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {lateInvoiceReasonTrend.length === 0 ? (
                  <div className="rounded-card border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
                    No late invoice reasons saved yet.
                  </div>
                ) : lateInvoiceReasonTrend.map((item) => (
                  <button
                    key={item.reason}
                    type="button"
                    onClick={() => selectLateReason(item.reason)}
                    className={`rounded-card border bg-white p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50 ${
                      selectedLateReason === item.reason ? "border-emerald-500 ring-2 ring-emerald-100" : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-800">{item.reason}</p>
                      <p className="text-sm font-bold text-gray-900">{formatNumber(item.count)} | {formatPercent(item.percent, 1)}</p>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, item.percent)}%` }} />
                    </div>
                    <div className="mt-3 border-t border-gray-100 pt-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Ageing mix</p>
                        <p className="text-[11px] font-semibold text-gray-500">within reason</p>
                      </div>
                      <div className="space-y-1.5">
                        {item.ageing.map((bucket) => (
                          <div key={`${item.reason}-${bucket.bucket}`} className="grid grid-cols-[64px_minmax(0,1fr)_54px] items-center gap-2">
                            <p className="text-xs font-medium text-gray-600">{bucket.bucket}</p>
                            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                              <div className="h-full rounded-full bg-red-500" style={{ width: `${bucket.count ? Math.max(4, bucket.percent) : 0}%` }} />
                            </div>
                            <p className="text-right text-xs font-semibold text-gray-700">{formatNumber(bucket.count)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-gray-500">Click to filter review rows</p>
                  </button>
                ))}
              </div>
              {lateInvoiceOwnerTrend.length > 0 && (
                <div className="mt-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-gray-900">Owner Trend</p>
                      <p className="text-xs text-gray-500">Mapped from saved late invoice reasons.</p>
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{formatNumber(lateInvoiceOwnerTrend.length)} owners</p>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {lateInvoiceOwnerTrend.map((item) => (
                      <div key={item.owner} className="rounded-card border border-gray-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold text-gray-800">{item.owner}</p>
                          <p className="text-sm font-bold text-gray-900">{formatNumber(item.count)} | {formatPercent(item.percent, 1)}</p>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(4, item.percent)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Late Invoice Ageing</p>
                    <p className="text-xs text-gray-500">Severity buckets for late invoices in {activeViewLabel.toLowerCase()}.</p>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{formatNumber(lateInvoiceReviews.length)} late invoices</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {lateInvoiceAgeing.map((item) => (
                    <div key={item.bucket} className="rounded-card border border-gray-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-gray-800">{item.bucket}</p>
                        <p className="text-sm font-bold text-gray-900">{formatNumber(item.count)} | {formatPercent(item.percent, 1)}</p>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${item.count ? Math.max(4, item.percent) : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {showLateInvoiceDetails && (
              <div className="mt-5 rounded-card border border-gray-200 bg-white p-3">
                <div className="mb-3 border-b border-gray-100 pb-3">
                  <p className="text-sm font-bold text-gray-900">Late Invoice Detail Workspace</p>
                  <p className="text-xs text-gray-500">Use this workspace to filter late invoices, apply bulk reasons, save reason updates, and export the current period.</p>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <select
                    value={lateInvoiceFilter}
                    onChange={(event) => {
                      const nextFilter = event.target.value as LateInvoiceFilter;
                      setLateInvoiceFilter(nextFilter);
                      if (nextFilter === "not-reviewed") setSelectedLateReason("");
                    }}
                    className="h-9 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="all">All Late</option>
                    <option value="not-reviewed">Needs Reason</option>
                    <option value="reviewed">Reviewed</option>
                  </select>
                  <Button variant="outline" size="sm" className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => void saveLateInvoiceReasons()} disabled={lateInvoicesWithReason.length === 0}>
                    <CheckCircle2 className="h-4 w-4" />
                    Save Reasons
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => void exportLateInvoiceReasons()}>
                    <Download className="h-4 w-4" />
                    Export Reasons
                  </Button>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{formatNumber(filteredLateInvoiceReviews.length)} rows in detail</p>
                </div>
                <div className="grid gap-3 xl:grid-cols-[220px_1fr_1fr_auto] xl:items-end">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bulk Reason Apply</p>
                    <p className="text-sm font-bold text-gray-900">{formatNumber(selectedLateInvoiceKeys.size)} selected</p>
                  </div>
                  <select
                    value={bulkLateReason}
                    onChange={(event) => setBulkLateReason(event.target.value)}
                    className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Select reason</option>
                    {lateInvoiceReasonOptions.map((reason) => (
                      <option key={reason} value={reason}>{reason}</option>
                    ))}
                  </select>
                  <input
                    value={bulkLateComment}
                    onChange={(event) => setBulkLateComment(event.target.value)}
                    placeholder="Optional comment for selected rows"
                    className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <Button variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={applyBulkLateReason} disabled={selectedLateInvoiceKeys.size === 0}>
                    Apply to Selected
                  </Button>
                </div>
              </div>
              )}
            </div>
            {showLateInvoiceDetails && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1520px] text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="w-[56px] px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={visibleLateInvoiceKeys.length > 0 && selectedVisibleLateInvoiceCount === visibleLateInvoiceKeys.length}
                        onChange={toggleAllVisibleLateInvoices}
                        aria-label="Select all visible late invoices"
                      />
                    </th>
                    <th className="px-4 py-3 text-left">Invoice</th>
                    <th className="px-4 py-3 text-left">ASO</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Created By</th>
                    <th className="px-4 py-3 text-left">Document Date</th>
                    <th className="px-4 py-3 text-left">Due Date</th>
                    <th className="px-4 py-3 text-right">Days Late</th>
                    <th className="px-4 py-3 text-left">Ageing</th>
                    <th className="px-4 py-3 text-left">Late Reason / Note</th>
                    <th className="px-4 py-3 text-left">Owner</th>
                    <th className="px-4 py-3 text-left">Comment</th>
                    <th className="px-4 py-3 text-left">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLateInvoiceReviews.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-4 py-8 text-center text-sm text-gray-500">
                        {lateInvoiceFilter === "not-reviewed" ? "All late invoices in this view have saved reasons." : "No late invoices match this filter."}
                      </td>
                    </tr>
                  ) : filteredLateInvoiceReviews.map((invoice) => (
                    <tr key={invoice.invoiceKey} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedLateInvoiceKeys.has(invoice.invoiceKey)}
                          onChange={() => toggleLateInvoiceSelection(invoice.invoiceKey)}
                          aria-label={`Select ${invoice.invoiceNumber}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{invoice.invoiceNumber}</td>
                      <td className="px-4 py-3 text-gray-700">{invoice.aso || "-"}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-gray-700" title={invoice.customer}>{invoice.customer || "-"}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-gray-600" title={invoice.createdBy}>{invoice.createdBy || "-"}</td>
                      <td className="px-4 py-3 text-gray-600">{invoice.invoiceDate}</td>
                      <td className="px-4 py-3 text-gray-600">{invoice.deliveryDueDate}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-600">{formatNumber(invoice.daysLate)}</td>
                      <td className="px-4 py-3 text-gray-700">{getLateAgeingBucket(invoice.daysLate)}</td>
                      <td className="px-4 py-3">
                        <select
                          value={timingNotes[invoice.invoiceKey] || ""}
                          onChange={(event) => updateTimingNote(invoice.invoiceKey, event.target.value)}
                          className="w-full min-w-[240px] rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        >
                          <option value="">Select reason</option>
                          {lateInvoiceReasonOptions.map((reason) => (
                            <option key={reason} value={reason}>{reason}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{lateInvoiceReasonOwners[timingNotes[invoice.invoiceKey]] || "-"}</td>
                      <td className="px-4 py-3">
                        <input
                          value={timingComments[invoice.invoiceKey] || ""}
                          onChange={(event) => updateTimingComment(invoice.invoiceKey, event.target.value)}
                          onBlur={() => {
                            if (timingNotes[invoice.invoiceKey]) {
                              void saveTimingNotesRemote({ [invoice.invoiceKey]: timingNotes[invoice.invoiceKey] }, { [invoice.invoiceKey]: timingComments[invoice.invoiceKey] || "" });
                            }
                          }}
                          placeholder="Optional comment"
                          className="w-full min-w-[220px] rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {timingNoteMeta[invoice.invoiceKey]?.updatedAt ? (
                          <>
                            <p className="font-semibold text-gray-700">{timingNoteMeta[invoice.invoiceKey]?.updatedByName || timingNoteMeta[invoice.invoiceKey]?.updatedById || "Saved"}</p>
                            <p>{normalizeDate(timingNoteMeta[invoice.invoiceKey]?.updatedAt)}</p>
                          </>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      )}

      {dedupedAuditHistory.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  Reconciliation Audit History
                </CardTitle>
                <p className="text-sm text-gray-500">Database-tracked changes to late invoice reasons and ledger actions, grouped by period.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {formatNumber(filteredAuditHistory.length)} changes
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowAuditHistory((value) => !value)}>
                  {showAuditHistory ? "Hide Audit History" : "Show Audit History"}
                </Button>
              </div>
            </div>
          </CardHeader>
          {showAuditHistory && (
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3">
              <div className="flex rounded-card border border-gray-200 bg-white p-1">
                {[
                  { id: "week" as AuditViewMode, label: "Week" },
                  { id: "month" as AuditViewMode, label: "Month" },
                  { id: "all" as AuditViewMode, label: "All" },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setAuditViewMode(option.id)}
                    className={`h-8 rounded px-3 text-xs font-bold transition ${
                      auditViewMode === option.id ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {auditViewMode === "month" && (
                <select
                  value={activeAuditMonth}
                  onChange={(event) => setSelectedAuditMonth(event.target.value)}
                  className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {auditPeriods.months.length === 0 ? (
                    <option value="">No months</option>
                  ) : auditPeriods.months.map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              )}
              {auditViewMode === "week" && (
                <select
                  value={activeAuditWeek}
                  onChange={(event) => setSelectedAuditWeek(event.target.value)}
                  className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {auditPeriods.weeks.length === 0 ? (
                    <option value="">No weeks</option>
                  ) : auditPeriods.weeks.map((week) => (
                    <option key={week} value={week}>Week from {week}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="divide-y divide-gray-100">
              {filteredAuditHistory.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-500">
                  No audit history for this selected period.
                </div>
              ) : filteredAuditHistory.slice(0, 8).map((audit) => (
                <div key={audit.id} className="grid gap-2 px-5 py-3 text-sm md:grid-cols-[180px_1fr_180px]">
                  <p className="font-semibold text-gray-800">{audit.action}</p>
                  <p className="text-gray-600">
                    {getAuditDisplayKey(audit)}
                    {audit.toValue ? ` - ${audit.toValue}` : ""}
                  </p>
                  <p className="text-xs font-semibold text-gray-400 md:text-right">{normalizeDate(audit.createdAt)}</p>
                </div>
              ))}
            </div>
          </CardContent>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-gray-100 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="text-lg">ASO Reconciliation</CardTitle>
              <p className="mt-1 text-sm text-gray-600">Delivered data comes from Order Management. Invoiced data comes from the saved invoice ledger.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {formatNumber(stats.openExceptions)} open exceptions
              </p>
              <Button type="button" variant="outline" onClick={() => setShowAsoReconciliation((value) => !value)}>
                {showAsoReconciliation ? "Hide ASO Details" : "Show ASO Details"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid gap-3 border-b border-gray-100 bg-gray-50 p-5 md:grid-cols-2 xl:grid-cols-5">
            {asoSummaryCards.map((card) => (
              <button
                key={card.label}
                type="button"
                onClick={() => setAsoStatusFilter(card.status)}
                className={`rounded-card border border-gray-200 border-l-[3px] ${card.tone} bg-white p-3 text-left transition hover:border-gray-300 hover:shadow-sm`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{formatNumber(card.value)}</p>
                <p className="text-xs text-gray-500">{card.helper}</p>
              </button>
            ))}
          </div>
          {showAsoReconciliation && (
            <>
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white p-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-80 rounded-card border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Search ASO, customer, invoice..."
              />
            </div>
            <select
              value={activeStatus}
              onChange={(event) => setActiveStatus(event.target.value as InvoiceStatus | "all")}
              className="rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All statuses</option>
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Button variant="outline" className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => void saveAllReviews()}>
              <CheckCircle2 className="h-4 w-4" />
              Save All Reviews
              {dirtyReviewCount > 0 && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                  {dirtyReviewCount}
                </span>
              )}
            </Button>
            <div className="flex gap-1 rounded-card border border-gray-200 bg-gray-50 p-1">
              <button type="button" className="flex h-8 items-center gap-1 rounded bg-white px-2 text-xs font-semibold text-gray-600 shadow-sm hover:text-emerald-700" onClick={() => scrollTable("left")}>
                <ChevronLeft className="h-4 w-4" />
                Left
              </button>
              <button type="button" className="flex h-8 items-center gap-1 rounded bg-white px-2 text-xs font-semibold text-gray-600 shadow-sm hover:text-emerald-700" onClick={() => scrollTable("right")}>
                Right
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          {invoiceLines.length === 0 && (
            <div className="m-5 flex items-start gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>Upload an invoice spreadsheet to compare against delivered ASOs. Your current file can use Source Sales Order as the ASO, with Invoice No, Document Date, Customer, Created By, Delivery Status, Status, and Posted Date. Invoice Qty is optional.</p>
            </div>
          )}
          {invoiceLines.length > 0 && invoiceLinesInView.length === 0 && (
            <div className="m-5 flex items-start gap-3 rounded-card border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>No invoice rows exist for this selected {viewMode}. Switch to All or choose another period to view saved invoice history.</p>
            </div>
          )}

          <div ref={tableScrollRef} className="max-h-[620px] max-w-full overflow-auto">
            <table className="w-full min-w-[1440px] text-sm">
              <thead className="sticky top-0 z-20 border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 shadow-sm">
                <tr>
                  <th className="sticky left-0 z-30 w-[128px] bg-gray-50 px-4 py-3 text-left shadow-[8px_0_12px_-12px_rgba(15,23,42,0.35)]">ASO</th>
                  <th className="w-[190px] px-4 py-3 text-left">Customer</th>
                  <th className="w-[170px] px-4 py-3 text-left">Status</th>
                  <th className="w-[120px] px-4 py-3 text-left">Owner</th>
                  <th className="w-[210px] px-4 py-3 text-left">Review</th>
                  <th className="w-[110px] px-4 py-3 text-right">Delivered Qty</th>
                  <th className="w-[88px] px-4 py-3 text-right">Pallets</th>
                  <th className="w-[115px] px-4 py-3 text-left">Delivered</th>
                  <th className="w-[120px] px-4 py-3 text-left">Invoices</th>
                  <th className="w-[170px] px-4 py-3 text-left">Created By</th>
                  <th className="w-[130px] px-4 py-3 text-left">Document Date</th>
                  <th className="w-[150px] px-4 py-3 text-left">Delivery / Due Date</th>
                  <th className="w-[260px] px-4 py-3 text-left">Products</th>
                  <th className="w-[92px] px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="p-8 text-center text-gray-500">No reconciliation rows found.</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const reviewStatus = reviewState[row.aso] || getDefaultReviewStatus(row.status);
                    const owner = getExceptionOwner(row.status);
                    return (
                      <tr key={row.aso} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="sticky left-0 z-10 bg-white px-4 py-3 font-semibold text-resilinc-primary shadow-[8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                          {(row.status === "not-invoiced" || row.status === "loaded-not-delivered") && onNavigate ? (
                            <button
                              type="button"
                              onClick={() => openExistingOrder(row)}
                              className="font-semibold text-resilinc-primary underline-offset-2 hover:underline"
                              title={`Open ${row.aso} in Order Management`}
                            >
                              {row.aso}
                            </button>
                          ) : (
                            row.aso
                          )}
                        </td>
                        <td className="max-w-[190px] truncate px-4 py-3 text-gray-700" title={row.customer}>{row.customer || "-"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded border px-2 py-1 text-xs font-bold ${statusTone[row.status]}`}>
                            {row.status === "matched" && <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                            {statusLabel[row.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-gray-600">{owner}</td>
                        <td className="px-4 py-3">
                          <select
                            value={reviewStatus}
                            onChange={(event) => updateReviewStatus(row.aso, event.target.value as ReviewStatus)}
                            className={`w-44 rounded border px-2 py-1 text-xs font-bold focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${reviewTone[reviewStatus]}`}
                          >
                            {reviewOptions.map((option) => (
                              <option key={option} value={option}>{reviewLabel[option]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{formatNumber(row.deliveredQty)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.pallets)}</td>
                        <td className="px-4 py-3 text-gray-600">{row.deliveredAt || "-"}</td>
                        <td className="px-4 py-3 text-gray-600">{row.invoiceNumbers || "-"}</td>
                        <td className="max-w-[170px] truncate px-4 py-3 text-gray-600" title={row.createdBy}>{row.createdBy || "-"}</td>
                        <td className="max-w-[130px] truncate px-4 py-3 text-gray-600" title={row.invoiceDates}>{row.invoiceDates || "-"}</td>
                        <td className="max-w-[150px] truncate px-4 py-3 text-gray-600" title={row.deliveryDueDates}>{row.deliveryDueDates || "-"}</td>
                        <td className="max-w-[260px] truncate px-4 py-3 text-gray-500" title={row.products}>{row.products || "-"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {row.status === "not-loaded" && (
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openConfirmDelivery(row)}
                                title="Confirm delivery"
                                aria-label={`Confirm delivery for ${row.aso}`}
                              >
                                <PackageCheck className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => void copyAso(row.aso)}
                              title="Copy ASO"
                              aria-label={`Copy ASO ${row.aso}`}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
            </>
          )}
        </CardContent>
      </Card>

      {pendingInvoiceUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPendingInvoiceUpload(null)}>
          <Card className="w-full max-w-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <CardHeader className="border-b border-gray-100 p-5">
              <CardTitle>Confirm Invoice Upload</CardTitle>
              <p className="mt-1 text-sm text-gray-600">Review what will be added to the invoice reconciliation ledger before saving.</p>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div className="rounded-card border border-gray-200 bg-gray-50 p-4">
                <p className="truncate text-sm font-bold text-gray-900">{pendingInvoiceUpload.filename}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-white p-3">
                    <p className="text-xs font-semibold uppercase text-gray-500">Rows</p>
                    <p className="text-xl font-bold text-gray-900">{formatNumber(pendingInvoiceUpload.lines.length)}</p>
                  </div>
                  <div className="rounded bg-white p-3">
                    <p className="text-xs font-semibold uppercase text-gray-500">New</p>
                    <p className="text-xl font-bold text-emerald-700">{formatNumber(pendingInvoiceUpload.added)}</p>
                  </div>
                  <div className="rounded bg-white p-3">
                    <p className="text-xs font-semibold uppercase text-gray-500">Existing</p>
                    <p className="text-xl font-bold text-amber-700">{formatNumber(pendingInvoiceUpload.skipped)}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                <Button variant="outline" onClick={() => setPendingInvoiceUpload(null)}>Cancel</Button>
                <Button onClick={() => void commitInvoiceUpload()} disabled={isImporting}>
                  {isImporting ? "Saving..." : "Save to Ledger"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {confirmDeliveryRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmDeliveryRow(null)}>
          <Card className="w-full max-w-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <CardHeader className="border-b border-gray-100 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Confirm Delivery</CardTitle>
                  <p className="mt-1 text-sm text-gray-600">
                    Create a delivered Order Management record from invoice reconciliation.
                  </p>
                </div>
                <button className="rounded-card p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setConfirmDeliveryRow(null)}>
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 rounded-card border border-gray-200 bg-gray-50 p-4 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">ASO</p>
                  <p className="mt-1 font-bold text-gray-900">{confirmDeliveryRow.aso}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Customer</p>
                  <p className="mt-1 font-bold text-gray-900">{confirmDeliveryRow.customer || "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Invoice</p>
                  <p className="mt-1 text-gray-700">{confirmDeliveryRow.invoiceNumbers || "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Document Date</p>
                  <p className="mt-1 text-gray-700">{confirmDeliveryRow.invoiceDates || "-"}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-gray-700">Delivery / Collection Date</span>
                  <input
                    type="date"
                    value={confirmDeliveryDraft.deliveredAt}
                    onChange={(event) => setConfirmDeliveryDraft((draft) => ({ ...draft, deliveredAt: event.target.value }))}
                    className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-gray-700">Type</span>
                  <select
                    value={confirmDeliveryDraft.serviceType}
                    onChange={(event) => setConfirmDeliveryDraft((draft) => ({ ...draft, serviceType: event.target.value as ServiceType }))}
                    className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="delivery">Delivered</option>
                    <option value="collection">Collected</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-gray-700">Quantity</span>
                  <input
                    type="number"
                    value={confirmDeliveryDraft.qty}
                    onChange={(event) => setConfirmDeliveryDraft((draft) => ({ ...draft, qty: event.target.value }))}
                    className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-gray-700">Pallets</span>
                  <input
                    type="number"
                    value={confirmDeliveryDraft.pallets}
                    onChange={(event) => setConfirmDeliveryDraft((draft) => ({ ...draft, pallets: event.target.value }))}
                    className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-gray-700">Details kept on shipment card</span>
                  <textarea
                    value={confirmDeliveryDraft.notes}
                    onChange={(event) => setConfirmDeliveryDraft((draft) => ({ ...draft, notes: event.target.value }))}
                    className="min-h-[90px] w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </label>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                <Button variant="outline" onClick={() => setConfirmDeliveryRow(null)}>
                  Cancel
                </Button>
                <Button className="gap-2" onClick={() => void confirmInvoiceDelivery()}>
                  <PackageCheck className="h-4 w-4" />
                  Confirm Delivery
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
