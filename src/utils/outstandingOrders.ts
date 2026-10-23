// Derived fields for the outstanding sales orders snapshot. Shared by the
// Outstanding Sales Orders view and the Dashboard so "overdue" means the same in both.
import type { OutstandingOrderLine } from "../services/api";
import { daysBetween } from "./dispatchPerformance";

export const DUE_SOON_DAYS = 7;

export type DueBucket = "overdue" | "due-soon" | "later" | "no-date";

export interface OutstandingLine {
  documentNo: string;
  customer: string;
  customerCode: string;
  status: string;
  deliveryDate: string;
  inventoryCode: string;
  inventoryDescription: string;
  warehouse: string;
  qty: number;
  unitPrice: number | null;
  value: number;
  dateCreated: string;
  createdBy: string;
  /** Days past the delivery date (positive = overdue). Null without a delivery date. */
  daysOverdue: number | null;
  due: DueBucket;
}

export const dueBucket = (daysOverdue: number | null): DueBucket => {
  if (daysOverdue === null) return "no-date";
  if (daysOverdue > 0) return "overdue";
  return daysOverdue >= -DUE_SOON_DAYS ? "due-soon" : "later";
};

export const toOutstandingLine = (l: OutstandingOrderLine, today: string): OutstandingLine => {
  const daysOverdue = l.deliveryDate ? daysBetween(l.deliveryDate, today) : null;
  return {
    documentNo: l.documentNo,
    customer: l.customerName || l.customerCode || "-",
    customerCode: l.customerCode || "",
    status: l.status || "",
    deliveryDate: l.deliveryDate || "",
    inventoryCode: l.inventoryCode || "",
    inventoryDescription: l.inventoryDescription || "",
    warehouse: l.warehouse || "",
    qty: l.outstandingQty,
    unitPrice: l.unitPrice,
    value: l.totalExcl ?? l.outstandingQty * (l.unitPrice ?? 0),
    dateCreated: l.dateCreated || "",
    createdBy: l.createdBy || "",
    daysOverdue,
    due: dueBucket(daysOverdue),
  };
};

export const countOrders = (lines: OutstandingLine[]) => new Set(lines.map((l) => l.documentNo)).size;
export const sumValue = (lines: OutstandingLine[]) => lines.reduce((sum, l) => sum + l.value, 0);
