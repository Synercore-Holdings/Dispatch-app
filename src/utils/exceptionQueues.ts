import type { Job } from "../types";
import { calculateRevisedETD } from "./deliveryDates";

export type ExceptionQueueKey = "exceptions" | "overdue" | "dispatchDue" | "priority";

export interface ExceptionQueueItem {
  id: string;
  queue: ExceptionQueueKey;
  severity: "critical" | "warning";
  title: string;
  description: string;
  job: Job;
  date?: string;
  days?: number;
}

const CLOSED_STATUSES = new Set(["delivered", "returned", "cancelled"]);
const QUEUE_EXIT_STATUSES = new Set(["en-route"]);

function toDayStart(dateString?: string): Date | undefined {
  if (!dateString) return undefined;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setHours(0, 0, 0, 0);
  return date;
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => !!value && !Number.isNaN(new Date(value).getTime()))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

// Single source of truth for "when is this order due" — prefers the latest
// (revised) ETD across its open lines, falling back to the latest ETA.
// Used consistently for overdue/dispatch-due checks across the app.
export function getGroupDueDateString(openLines: Job[]): string | undefined {
  const latestEtd = latestDate(openLines.map((job) => calculateRevisedETD(job) || job.etd));
  const latestEta = latestDate(openLines.map((job) => job.eta));
  return latestEtd || latestEta;
}

export function buildExceptionQueues(jobs: Job[]): Record<ExceptionQueueKey, ExceptionQueueItem[]> {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const queues: Record<ExceptionQueueKey, ExceptionQueueItem[]> = {
    exceptions: [],
    overdue: [],
    dispatchDue: [],
    priority: [],
  };

  const orderGroups = new Map<string, Job[]>();
  jobs
    .filter((job) => job.jobType === "order" || job.jobType === undefined)
    .forEach((job) => {
      const group = orderGroups.get(job.ref) || [];
      group.push(job);
      orderGroups.set(job.ref, group);
    });

  orderGroups.forEach((group) => {
    if (group.some((job) => QUEUE_EXIT_STATUSES.has(job.status))) return;

    const primary = group.find((job) => job.status === "exception") || group[0];
    const openLines = group.filter((job) => !CLOSED_STATUSES.has(job.status));
    const latestEtd = latestDate(openLines.map((job) => calculateRevisedETD(job) || job.etd));
    const latestEta = latestDate(openLines.map((job) => job.eta));
    const dueDateString = latestEtd || latestEta;
    const dueDate = toDayStart(dueDateString);

    const exceptionLine = group.find((job) => job.status === "exception");
    if (exceptionLine) {
      queues.exceptions.push({
        id: `exception-${exceptionLine.ref}`,
        queue: "exceptions",
        severity: "critical",
        title: `Exception: ${exceptionLine.ref}`,
        description: exceptionLine.exceptionReason || "No exception reason captured",
        job: exceptionLine,
        date: exceptionLine.updatedAt,
      });
      return;
    }

    if (openLines.length > 0 && dueDate) {
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / 86400000);
      if (daysOverdue > 0) {
        queues.overdue.push({
          id: `overdue-${primary.ref}`,
          queue: "overdue",
          severity: daysOverdue > 3 ? "critical" : "warning",
          title: `Overdue: ${primary.ref}`,
          description: primary.overdueReason || `Past ${latestEtd ? "ETD" : "ETA"} with no recorded reason`,
          job: primary,
          date: dueDateString,
          days: daysOverdue,
        });
      }
    }

    if (latestEtd && openLines.some((job) => job.status !== "en-route")) {
      const etd = toDayStart(latestEtd);
      const daysUntilEtd = etd ? Math.floor((etd.getTime() - now.getTime()) / 86400000) : undefined;
      if (daysUntilEtd === 0 || daysUntilEtd === 1) {
        queues.dispatchDue.push({
          id: `dispatch-due-${primary.ref}`,
          queue: "dispatchDue",
          severity: daysUntilEtd === 0 ? "critical" : "warning",
          title: daysUntilEtd === 0 ? `Dispatch Today: ${primary.ref}` : `Dispatch Tomorrow: ${primary.ref}`,
          description: `Latest ETD is ${latestEtd}`,
          job: primary,
          date: latestEtd,
          days: daysUntilEtd,
        });
      }
    }

    if ((primary.priority === "urgent" || primary.priority === "high") && primary.status === "pending") {
      queues.priority.push({
        id: `priority-${primary.ref}`,
        queue: "priority",
        severity: primary.priority === "urgent" ? "critical" : "warning",
        title: `Unassigned ${primary.priority}: ${primary.ref}`,
        description: `${primary.customer} is still pending`,
        job: primary,
        date: primary.createdAt,
      });
    }
  });

  Object.values(queues).forEach((items) => {
    items.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
      return new Date(a.date || a.job.updatedAt).getTime() - new Date(b.date || b.job.updatedAt).getTime();
    });
  });

  return queues;
}

export function countExceptionQueueItems(jobs: Job[]): number {
  const queues = buildExceptionQueues(jobs);
  return Object.values(queues).reduce((sum, items) => sum + items.length, 0);
}
