import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PrismaClient } from "@prisma/client";
import { authenticate, validateOrigin } from "../_lib.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function setCors(res: VercelResponse, req: VercelRequest) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || req.headers?.origin || "");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

interface JwtPayload { id: string; username: string; email: string; role: string }

async function requireAuth(authHeader: string | undefined, res: VercelResponse): Promise<JwtPayload | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) { res.status(500).json({ success: false, error: "Server configuration error" }); return null; }
  return authenticate(authHeader);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!validateOrigin(req)) return res.status(403).json({ success: false, error: "Forbidden" });

  const user = await requireAuth(req.headers.authorization, res);
  if (!user) return res.headersSent ? undefined : res.status(401).json({ success: false, error: "Unauthorized" });

  const id = req.query.id as string | undefined;

  // --- Single batch operations (when ?id=xxx is provided) ---
  if (id) {
    if (req.method === "PUT") {
      if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot modify data" });
      try {
        const data: Record<string, unknown> = {};
        if (req.body.batchNumber !== undefined) data.batchNumber = req.body.batchNumber;
        if (req.body.quantity !== undefined) data.quantity = Number(req.body.quantity);
        if (req.body.returnedAt !== undefined) data.returnedAt = req.body.returnedAt ? new Date(req.body.returnedAt) : null;
        if (req.body.quantityReturned !== undefined) data.quantityReturned = req.body.quantityReturned !== null ? Number(req.body.quantityReturned) : null;
        if (req.body.returnNotes !== undefined) data.returnNotes = req.body.returnNotes || null;

        const batch = await prisma.flowbinBatch.update({ where: { id }, data });
        return res.json({ success: true, data: batch });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2025") return res.status(404).json({ success: false, error: "Batch not found" });
        console.error("Error updating batch:", error);
        return res.status(500).json({ success: false, error: "Failed to update batch" });
      }
    }

    if (req.method === "DELETE") {
      if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot modify data" });
      try {
        await prisma.flowbinBatch.delete({ where: { id } });
        return res.json({ success: true });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2025") return res.status(404).json({ success: false, error: "Batch not found" });
        console.error("Error deleting batch:", error);
        return res.status(500).json({ success: false, error: "Failed to delete batch" });
      }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // --- Collection operations ---
  if (req.method === "GET") {
    try {
      const jobs = await prisma.job.findMany({
        where: { hasFlowbin: true },
        include: { flowbinBatches: true },
        orderBy: { eta: "asc" },
      });
      return res.json({ success: true, data: jobs.map((j) => ({
        ...j,
        createdAt: j.createdAt instanceof Date ? j.createdAt.toISOString() : j.createdAt,
        updatedAt: j.updatedAt instanceof Date ? j.updatedAt.toISOString() : j.updatedAt,
      })) });
    } catch (error) {
      console.error("Error fetching flowbins:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch flowbins" });
    }
  }

  if (req.method === "POST") {
    if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot modify data" });
    try {
      const { jobId, batchNumber, quantity } = req.body;
      if (!jobId || !batchNumber || !quantity) {
        return res.status(400).json({ success: false, error: "jobId, batchNumber, and quantity are required" });
      }
      const batch = await prisma.flowbinBatch.create({
        data: { jobId, batchNumber, quantity: Number(quantity) },
      });
      return res.status(201).json({ success: true, data: batch });
    } catch (error) {
      console.error("Error creating flowbin batch:", error);
      return res.status(500).json({ success: false, error: "Failed to create batch" });
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
