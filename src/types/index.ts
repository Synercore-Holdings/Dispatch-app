// src/types.ts

// ------------------------------
// Status & Priority
// ------------------------------
export type JobStatus =
  | "pending"
  | "assigned"
  | "en-route"
  | "delivered"
  | "returned"
  | "exception"
  | "cancelled";

export type JobPriority = "urgent" | "high" | "normal" | "low";

export type DriverStatus = "available" | "busy" | "offline" | "break";

export type JobType = "order" | "ibt" | "africa-export";

export type ServiceType = "delivery" | "collection";
export type TransportService = "local" | "express" | "economy" | "outline" | "airfreight" | "seafreight";
export type TruckSize = "1ton" | "4ton" | "8ton" | "6m" | "12m" | "superlink" | "airline" | "vessel";

export const TRUCK_SIZES: { value: TruckSize; label: string }[] = [
  { value: "1ton", label: "1 Ton Bakkie" },
  { value: "4ton", label: "4 Tonner" },
  { value: "8ton", label: "8 Tonner" },
  { value: "6m", label: "6m" },
  { value: "12m", label: "12m" },
  { value: "superlink", label: "SuperLink" },
  { value: "airline", label: "Airline" },
  { value: "vessel", label: "Vessel" },
];

export const SERVICE_TYPES: ServiceType[] = ["delivery", "collection"];
export const TRANSPORT_SERVICES: { value: TransportService; label: string; hours: number; businessDays: number }[] = [
  { value: "local", label: "Local Sameday", hours: 0, businessDays: 0 },
  { value: "express", label: "Express Road", hours: 24, businessDays: 1 },
  { value: "economy", label: "Economy Road", hours: 48, businessDays: 2 },
  { value: "outline", label: "Outline", hours: 96, businessDays: 4 },
  { value: "airfreight", label: "Export Airfreight", hours: 168, businessDays: 7 },
  { value: "seafreight", label: "Export Seafreight", hours: 504, businessDays: 21 },
];

// Handy constants (useful for dropdowns and validation)
export const JOB_STATUSES: JobStatus[] = [
  "pending",
  "assigned",
  "en-route",
  "delivered",
  "returned",
  "exception",
  "cancelled",
];

export const JOB_PRIORITIES: JobPriority[] = ["urgent", "high", "normal", "low"];

export const DRIVER_STATUSES: DriverStatus[] = [
  "available",
  "busy",
  "offline",
  "break",
];

// ------------------------------
// Core Entities
// ------------------------------
export interface Job {
  id: string;

  ref: string;
  customer: string;
  pickup: string;
  dropoff: string;
  warehouse?: string;      // which warehouse this job belongs to

  priority: JobPriority;
  status: JobStatus;
  jobType?: JobType;       // Distinguishes customer orders, IBT jobs, and orders moved to Africa exports
  serviceType?: ServiceType; // "delivery" (we arrange transport) or "collection" (customer collects / ex works)
  transportService?: TransportService; // "express" (24h), "economy" (48h), "outline" (96h)
  truckSize?: TruckSize; // "1ton", "4ton", "8ton", "6m", "12m", "superlink"
  etd?: string; // Estimated Time of Departure - calculated from ETA minus lead time

  pallets?: number;
  outstandingQty?: number;  // Outstanding quantity from Excel import
  sourceCreatedDate?: string; // Source-system DateCreated from sales order import
  sourceCreatedBy?: string;   // Source-system CreatedByUserid from sales order import

  // Workflow tracking
  transporterBooked?: boolean;  // Transporter has been booked
  orderPicked?: boolean;        // Order has been picked from warehouse
  coaAvailable?: boolean;       // Certificate of Analysis available
  readyForDispatch?: boolean;   // Computed: transporterBooked && orderPicked && coaAvailable (not persisted to DB)
  hasFlowbin?: boolean;         // Whether this job includes flowbins to be returned
  flowbinBatches?: FlowbinBatch[]; // Flowbin batch details (when loaded)

  // Dates as ISO strings — easy to serialize, compare, and store
  eta?: string;                 // planned ETA (e.g. "2025-10-10" or ISO datetime)
  scheduledAt?: string;         // planned pickup/delivery (ISO datetime)
  dispatchedAt?: string;        // set when moved to en-route (ISO datetime)
  actualDeliveryAt?: string;    // set when delivered (ISO datetime)
  returnedAt?: string;          // set when returned by customer/client (ISO datetime)
  returnReason?: string;        // required when status === "returned"
  returnedPallets?: number;     // optional returned pallet count
  returnNotes?: string;         // free-text return notes
  exceptionReason?: string;     // set when status === "exception"
  overdueReason?: string;       // set when order is past ETA

  driverId?: string;
  notes?: string;               // line item / product name from import
  internalNotes?: string;       // free-text notes added by dispatchers

  createdAt: string;            // ISO datetime
  updatedAt: string;            // ISO datetime
}

export interface Driver {
  id: string;
  name: string;
  callsign: string;
  location: string;
  capacity: number;
  assignedJobs: number;
  status: DriverStatus;
  phone?: string;
  email?: string;
}

export interface FlowbinBatch {
  id: string;
  jobId: string;
  batchNumber: string;
  quantity: number;
  quantityReturned?: number | null;
  returnedAt?: string | null;
  returnNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FlowbinStatus = "on-time" | "warning" | "overdue" | "returned";

export interface MessageRecipient {
  id: string;
  messageId: string;
  userId: string;
  username: string;
  readAt?: string | null;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  subject: string;
  body: string;
  jobRef?: string | null;
  priority: "normal" | "urgent";
  broadcast: boolean;
  threadId?: string | null;
  recipients: MessageRecipient[];
  createdAt: string;
}

// ------------------------------
// Sorting / Filtering
// ------------------------------
export type SortField =
  | "ref"
  | "customer"
  | "priority"
  | "status"
  | "eta"
  | "createdAt";

export type SortDirection = "asc" | "desc";

export interface FilterOptions {
  status?: JobStatus[];
  priority?: JobPriority[];
  driverId?: string;
  warehouse?: string;
  searchQuery?: string;
  etaWeek?: string; // Format: "YYYY-Wnn" e.g. "2025-W45"
  etaRange?: "5weeks" | "3months" | "6months" | "all"; // Default window for order list (default: "5weeks")
  workflowStatus?: "ready" | "in-progress" | "not-started"; // Workflow filter
  transporterBooked?: boolean; // Filter by transporter booked status
  orderPicked?: boolean; // Filter by order picked status
  coaAvailable?: boolean; // Filter by COA available status
}

export interface SortOptions {
  field: SortField;
  direction: SortDirection;
}

// ------------------------------
// Type Guards & Helpers (optional)
// ------------------------------
export const isJobStatus = (v: string): v is JobStatus =>
  (JOB_STATUSES as string[]).includes(v);

export const isJobPriority = (v: string): v is JobPriority =>
  (JOB_PRIORITIES as string[]).includes(v);

export const nowIso = () => new Date().toISOString();

/**
 * Create a new Job skeleton with sensible defaults.
 * Fill in ref/customer/pickup/dropoff before use.
 */
export const makeNewJob = (partial: Partial<Job> = {}): Job => {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as any).randomUUID()
      : `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ts = nowIso();

  return {
    id,
    ref: partial.ref ?? "",
    customer: partial.customer ?? "",
    pickup: partial.pickup ?? "",
    dropoff: partial.dropoff ?? "",
    priority: partial.priority ?? "normal",
    status: partial.status ?? "pending",
    pallets: partial.pallets,
    sourceCreatedDate: partial.sourceCreatedDate,
    sourceCreatedBy: partial.sourceCreatedBy,
    eta: partial.eta,
    scheduledAt: partial.scheduledAt,
    dispatchedAt: partial.dispatchedAt,
    actualDeliveryAt: partial.actualDeliveryAt,
    returnedAt: partial.returnedAt,
    returnReason: partial.returnReason,
    returnedPallets: partial.returnedPallets,
    returnNotes: partial.returnNotes,
    exceptionReason: partial.exceptionReason,
    driverId: partial.driverId,
    notes: partial.notes,
    createdAt: partial.createdAt ?? ts,
    updatedAt: partial.updatedAt ?? ts,
  };
};
