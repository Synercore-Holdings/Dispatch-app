import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { validateOrigin } from "../_lib.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function setCors(res: VercelResponse, req: VercelRequest) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || req.headers?.origin || "");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

interface JwtPayload { id: string; username: string; email: string; role: string }

function requireAuth(authHeader: string | undefined, res: VercelResponse): JwtPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) { res.status(500).json({ success: false, error: "Server configuration error" }); return null; }
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try { return jwt.verify(authHeader.slice(7), secret) as JwtPayload; } catch { return null; }
}

const formatJob = (job: Record<string, unknown>) => ({
  ...job,
  createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : job.createdAt,
  updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : job.updatedAt,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!validateOrigin(req)) return res.status(403).json({ success: false, error: "Forbidden" });

  const user = requireAuth(req.headers.authorization, res);
  if (!user) return res.headersSent ? undefined : res.status(401).json({ success: false, error: "Unauthorized" });

  const id = req.query.id as string | undefined;
  const action = req.query.action as string | undefined;

  // --- Single job operations (when ?id=xxx is provided) ---
  if (id) {
    if (req.method === "GET") {
      try {
        const job = await prisma.job.findUnique({ where: { id } });
        if (!job) return res.status(404).json({ success: false, error: "Job not found" });
        return res.json({ success: true, data: formatJob(job) });
      } catch (error) {
        console.error("Error fetching job:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch job" });
      }
    }

    if (req.method === "PUT") {
      if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot modify data" });
      try {
        const MAX_STRING = 1000;
        const MAX_TEXT = 5000;
        if (req.body.notes && String(req.body.notes).length > MAX_TEXT) return res.status(400).json({ success: false, error: "Notes too long" });
        if (req.body.customer && String(req.body.customer).length > MAX_STRING) return res.status(400).json({ success: false, error: "Customer name too long" });

        const allowedFields = [
          "ref", "customer", "pickup", "dropoff", "warehouse", "priority", "status",
          "pallets", "outstandingQty", "eta", "scheduledAt", "dispatchedAt", "actualDeliveryAt",
          "sourceCreatedDate", "sourceCreatedBy", "totalExclVat",
          "returnedAt", "returnReason", "returnedPallets", "returnNotes",
          "exceptionReason", "overdueReason", "driverId", "notes", "internalNotes", "transporterBooked", "orderPicked",
          "coaAvailable", "hasFlowbin", "serviceType", "jobType", "transportService", "truckSize", "etd",
        ];
        const requiredStringFields = new Set(["ref", "customer", "pickup", "dropoff", "priority", "status"]);
        const data: Record<string, unknown> = {};
        for (const field of allowedFields) {
          if (field in req.body) {
            const value = req.body[field];
            if (requiredStringFields.has(field) && (value === null || value === undefined)) continue;
            data[field] = value;
          }
        }
        const updatedJob = await prisma.job.update({ where: { id }, data });
        return res.json({ success: true, data: formatJob(updatedJob) });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2025") return res.status(404).json({ success: false, error: "Job not found" });
        console.error("Error updating job:", error);
        return res.status(500).json({ success: false, error: "Failed to update job" });
      }
    }

    if (req.method === "DELETE") {
      if (!["admin", "dispatcher", "manager"].includes(user.role)) return res.status(403).json({ success: false, error: "Insufficient permissions to delete jobs" });
      try {
        const deleted = await prisma.job.delete({ where: { id } });
        return res.json({ success: true, data: formatJob(deleted) });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2025") return res.status(404).json({ success: false, error: "Job not found" });
        console.error("Error deleting job:", error);
        return res.status(500).json({ success: false, error: "Failed to delete job" });
      }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // --- Collection operations ---
  if (req.method === "GET") {
    try {
      const jobs = await prisma.job.findMany({ orderBy: { createdAt: "desc" } });
      return res.json({ success: true, data: jobs.map(formatJob) });
    } catch (error) {
      console.error("Error fetching jobs:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch jobs" });
    }
  }

  if (req.method === "POST") {
    if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot modify data" });

    // Bulk delete by ids: POST /api/jobs?action=bulk-delete  body: { ids: string[] }
    if (action === "bulk-delete") {
      if (user.role !== "admin") {
        return res.status(403).json({ success: false, error: "Admin role required for bulk delete" });
      }
      try {
        const MAX_BATCH_SIZE = 1000;
        const ids = req.body?.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ success: false, error: "Request body must include a non-empty 'ids' array" });
        }
        if (ids.length > MAX_BATCH_SIZE) {
          return res.status(400).json({ success: false, error: `Batch size cannot exceed ${MAX_BATCH_SIZE}` });
        }
        if (!ids.every((id) => typeof id === "string")) {
          return res.status(400).json({ success: false, error: "All ids must be strings" });
        }

        const result = await prisma.job.deleteMany({ where: { id: { in: ids } } });
        return res.json({ success: true, data: { deleted: result.count } });
      } catch (error) {
        console.error("Error bulk deleting jobs:", error);
        return res.status(500).json({ success: false, error: "Failed to bulk delete jobs" });
      }
    }

    // Bulk update: POST /api/jobs?action=bulk-update  body: { ids: string[], patch: Partial<Job> }
    // Applies the same patch to all listed ids in a single round trip.
    if (action === "bulk-update") {
      try {
        const MAX_BATCH_SIZE = 500;
        const MAX_STRING = 1000;
        const MAX_TEXT = 5000;
        const ids = req.body?.ids;
        const patch = req.body?.patch;

        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ success: false, error: "Request body must include a non-empty 'ids' array" });
        }
        if (ids.length > MAX_BATCH_SIZE) {
          return res.status(400).json({ success: false, error: `Batch size cannot exceed ${MAX_BATCH_SIZE}` });
        }
        if (!ids.every((i) => typeof i === "string")) {
          return res.status(400).json({ success: false, error: "All ids must be strings" });
        }
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
          return res.status(400).json({ success: false, error: "Request body must include a 'patch' object" });
        }
        if (patch.notes && String(patch.notes).length > MAX_TEXT) {
          return res.status(400).json({ success: false, error: "Notes too long" });
        }
        if (patch.customer && String(patch.customer).length > MAX_STRING) {
          return res.status(400).json({ success: false, error: "Customer name too long" });
        }

        const allowedFields = [
          "ref", "customer", "pickup", "dropoff", "warehouse", "priority", "status",
          "pallets", "outstandingQty", "eta", "scheduledAt", "dispatchedAt", "actualDeliveryAt",
          "sourceCreatedDate", "sourceCreatedBy", "totalExclVat",
          "returnedAt", "returnReason", "returnedPallets", "returnNotes",
          "exceptionReason", "overdueReason", "driverId", "notes", "internalNotes", "transporterBooked", "orderPicked",
          "coaAvailable", "hasFlowbin", "serviceType", "jobType", "transportService", "truckSize", "etd",
        ];
        const requiredStringFields = new Set(["ref", "customer", "pickup", "dropoff", "priority", "status"]);
        const data: Record<string, unknown> = {};
        for (const field of allowedFields) {
          if (field in patch) {
            const value = patch[field];
            if (requiredStringFields.has(field) && (value === null || value === undefined)) continue;
            data[field] = value;
          }
        }

        if (Object.keys(data).length === 0) {
          return res.status(400).json({ success: false, error: "Patch contains no updatable fields" });
        }

        const result = await prisma.$transaction(async (tx) => {
          await tx.job.updateMany({ where: { id: { in: ids } }, data });
          return tx.job.findMany({ where: { id: { in: ids } } });
        });

        return res.json({ success: true, data: result.map(formatJob) });
      } catch (error) {
        console.error("Error bulk updating jobs:", error);
        return res.status(500).json({ success: false, error: "Failed to bulk update jobs" });
      }
    }

    // Bulk replace: POST /api/jobs?action=bulk-replace
    if (action === "bulk-replace") {
      try {
        const MAX_BATCH_SIZE = 500;
        if (!Array.isArray(req.body.jobs)) return res.status(400).json({ success: false, error: "Request body must include a 'jobs' array" });
        if (req.body.jobs.length > MAX_BATCH_SIZE) return res.status(400).json({ success: false, error: `Batch size cannot exceed ${MAX_BATCH_SIZE}` });

        // Clearing (empty array wipes all jobs of this type) is admin-only
        if (req.body.jobs.length === 0 && user.role !== "admin") {
          return res.status(403).json({ success: false, error: "Admin role required to clear all jobs" });
        }

        const jobType = req.body.jobType || "order";
        const validJobTypes = ["order", "ibt"];
        if (!validJobTypes.includes(jobType)) return res.status(400).json({ success: false, error: "Invalid jobType" });

        const jobsData = req.body.jobs.map((job: Record<string, unknown>) => ({
          ref: job.ref as string, customer: job.customer as string,
          pickup: job.pickup as string, dropoff: job.dropoff as string,
          warehouse: job.warehouse as string | undefined,
          priority: (job.priority as string) || "normal", status: (job.status as string) || "pending", jobType,
          pallets: job.pallets as number | undefined, outstandingQty: job.outstandingQty as number | undefined,
          sourceCreatedDate: job.sourceCreatedDate as string | undefined, sourceCreatedBy: job.sourceCreatedBy as string | undefined,
          totalExclVat: job.totalExclVat as number | undefined,
          eta: job.eta as string | undefined, scheduledAt: job.scheduledAt as string | undefined,
          dispatchedAt: job.dispatchedAt as string | undefined,
          actualDeliveryAt: job.actualDeliveryAt as string | undefined, exceptionReason: job.exceptionReason as string | undefined,
          returnedAt: job.returnedAt as string | undefined, returnReason: job.returnReason as string | undefined,
          returnedPallets: job.returnedPallets as number | undefined, returnNotes: job.returnNotes as string | undefined,
          overdueReason: job.overdueReason as string | undefined, driverId: job.driverId as string | undefined,
          notes: job.notes as string | undefined, transporterBooked: job.transporterBooked as boolean | undefined,
          orderPicked: job.orderPicked as boolean | undefined, coaAvailable: job.coaAvailable as boolean | undefined,
          serviceType: job.serviceType as string | undefined, transportService: job.transportService as string | undefined,
          truckSize: job.truckSize as string | undefined, etd: job.etd as string | undefined,
          createdById: user.id,
        }));

        const result = await prisma.$transaction(async (tx) => {
          await tx.job.deleteMany({ where: { jobType } });
          await tx.job.createMany({ data: jobsData });
          return tx.job.findMany({ where: { jobType }, orderBy: { createdAt: "desc" } });
        });

        return res.status(201).json({ success: true, data: result.map(formatJob) });
      } catch (error) {
        console.error("Error bulk replacing jobs:", error);
        return res.status(500).json({ success: false, error: "Failed to bulk replace jobs" });
      }
    }

    // Bulk create: POST /api/jobs?action=bulk
    if (action === "bulk") {
      try {
        const MAX_BATCH_SIZE = 500;
        if (!Array.isArray(req.body.jobs)) return res.status(400).json({ success: false, error: "Request body must include a 'jobs' array" });
        if (req.body.jobs.length === 0) return res.status(400).json({ success: false, error: "Jobs array cannot be empty" });
        if (req.body.jobs.length > MAX_BATCH_SIZE) return res.status(400).json({ success: false, error: `Batch size cannot exceed ${MAX_BATCH_SIZE}` });

        const jobsData = req.body.jobs.map((job: Record<string, unknown>) => ({
          ref: job.ref as string, customer: job.customer as string,
          pickup: job.pickup as string, dropoff: job.dropoff as string,
          warehouse: job.warehouse as string | undefined,
          priority: (job.priority as string) || "normal", status: (job.status as string) || "pending",
          jobType: (job.jobType as string) || "order",
          pallets: job.pallets as number | undefined, outstandingQty: job.outstandingQty as number | undefined,
          sourceCreatedDate: job.sourceCreatedDate as string | undefined, sourceCreatedBy: job.sourceCreatedBy as string | undefined,
          totalExclVat: job.totalExclVat as number | undefined,
          eta: job.eta as string | undefined, scheduledAt: job.scheduledAt as string | undefined,
          dispatchedAt: job.dispatchedAt as string | undefined,
          actualDeliveryAt: job.actualDeliveryAt as string | undefined, exceptionReason: job.exceptionReason as string | undefined,
          returnedAt: job.returnedAt as string | undefined, returnReason: job.returnReason as string | undefined,
          returnedPallets: job.returnedPallets as number | undefined, returnNotes: job.returnNotes as string | undefined,
          overdueReason: job.overdueReason as string | undefined, driverId: job.driverId as string | undefined,
          notes: job.notes as string | undefined, transporterBooked: job.transporterBooked as boolean | undefined,
          orderPicked: job.orderPicked as boolean | undefined, coaAvailable: job.coaAvailable as boolean | undefined,
          serviceType: job.serviceType as string | undefined, transportService: job.transportService as string | undefined,
          truckSize: job.truckSize as string | undefined, etd: job.etd as string | undefined,
          hasFlowbin: job.hasFlowbin as boolean | undefined, internalNotes: job.internalNotes as string | undefined,
          createdById: user.id,
        }));

        const result = await prisma.job.createMany({ data: jobsData });
        const createdJobs = await prisma.job.findMany({ orderBy: { createdAt: "desc" }, take: result.count });
        return res.status(201).json({ success: true, data: createdJobs.map(formatJob) });
      } catch (error) {
        console.error("Error bulk creating jobs:", error);
        return res.status(500).json({ success: false, error: "Failed to bulk create jobs" });
      }
    }

    // Single create
    try {
      if (!req.body.ref || !req.body.customer) {
        return res.status(400).json({ success: false, error: "Reference and customer are required" });
      }
      const validStatuses = ["pending", "assigned", "en-route", "delivered", "returned", "exception", "cancelled"];
      const validPriorities = ["urgent", "high", "normal", "low"];
      if (req.body.status && !validStatuses.includes(req.body.status)) {
        return res.status(400).json({ success: false, error: "Invalid status" });
      }
      if (req.body.priority && !validPriorities.includes(req.body.priority)) {
        return res.status(400).json({ success: false, error: "Invalid priority" });
      }

      const MAX_STRING = 1000;
      const MAX_TEXT = 5000;
      if (req.body.notes && String(req.body.notes).length > MAX_TEXT) return res.status(400).json({ success: false, error: "Notes too long" });
      if (req.body.customer && String(req.body.customer).length > MAX_STRING) return res.status(400).json({ success: false, error: "Customer name too long" });

      const newJob = await prisma.job.create({
        data: {
          ref: req.body.ref, customer: req.body.customer,
          pickup: req.body.pickup, dropoff: req.body.dropoff, warehouse: req.body.warehouse,
          priority: req.body.priority || "normal", status: req.body.status || "pending",
          jobType: req.body.jobType || "order",
          pallets: req.body.pallets, outstandingQty: req.body.outstandingQty,
          sourceCreatedDate: req.body.sourceCreatedDate, sourceCreatedBy: req.body.sourceCreatedBy, totalExclVat: req.body.totalExclVat,
          eta: req.body.eta, scheduledAt: req.body.scheduledAt, dispatchedAt: req.body.dispatchedAt, actualDeliveryAt: req.body.actualDeliveryAt,
          returnedAt: req.body.returnedAt, returnReason: req.body.returnReason,
          returnedPallets: req.body.returnedPallets, returnNotes: req.body.returnNotes,
          exceptionReason: req.body.exceptionReason, overdueReason: req.body.overdueReason,
          driverId: req.body.driverId, notes: req.body.notes,
          transporterBooked: req.body.transporterBooked, orderPicked: req.body.orderPicked,
          coaAvailable: req.body.coaAvailable, serviceType: req.body.serviceType,
          transportService: req.body.transportService, truckSize: req.body.truckSize, etd: req.body.etd,
          createdById: user.id,
        },
      });
      return res.status(201).json({ success: true, data: formatJob(newJob) });
    } catch (error) {
      console.error("Error creating job:", error);
      return res.status(500).json({ success: false, error: "Failed to create job" });
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
