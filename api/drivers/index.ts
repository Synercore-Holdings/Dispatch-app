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

  // --- Single driver operations (when ?id=xxx is provided) ---
  if (id) {
    if (req.method === "GET") {
      try {
        const driver = await prisma.driver.findUnique({
          where: { id },
          include: { jobs: { where: { status: { notIn: ["delivered", "cancelled"] } } } },
        });
        if (!driver) return res.status(404).json({ success: false, error: "Driver not found" });
        return res.json({ success: true, data: driver });
      } catch (error) {
        console.error("Error fetching driver:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch driver" });
      }
    }

    if (req.method === "PUT") {
      if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot modify data" });
      try {
        const allowedFields = ["name", "callsign", "location", "capacity", "assignedJobs", "status", "phone", "email"];
        const data: Record<string, unknown> = {};
        for (const field of allowedFields) {
          if (field in req.body) data[field] = req.body[field];
        }
        const updatedDriver = await prisma.driver.update({ where: { id }, data });
        return res.json({ success: true, data: updatedDriver });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2025") return res.status(404).json({ success: false, error: "Driver not found" });
        if (prismaError.code === "P2002") return res.status(409).json({ success: false, error: "Callsign already exists" });
        console.error("Error updating driver:", error);
        return res.status(500).json({ success: false, error: "Failed to update driver" });
      }
    }

    if (req.method === "DELETE") {
      if (!["admin", "dispatcher", "manager"].includes(user.role)) return res.status(403).json({ success: false, error: "Insufficient permissions to delete drivers" });
      try {
        const deleted = await prisma.driver.delete({ where: { id } });
        return res.json({ success: true, data: deleted });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2025") return res.status(404).json({ success: false, error: "Driver not found" });
        console.error("Error deleting driver:", error);
        return res.status(500).json({ success: false, error: "Failed to delete driver" });
      }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // --- Collection operations (no id) ---
  if (req.method === "GET") {
    try {
      const drivers = await prisma.driver.findMany({ orderBy: { name: "asc" } });
      return res.json({ success: true, data: drivers });
    } catch (error) {
      console.error("Error fetching drivers:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch drivers" });
    }
  }

  if (req.method === "POST") {
    if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot modify data" });
    try {
      if (!req.body.name || !req.body.callsign || !req.body.location) {
        return res.status(400).json({ success: false, error: "Name, callsign, and location are required" });
      }
      if (req.body.capacity !== undefined && (req.body.capacity < 0 || req.body.capacity > 999999)) {
        return res.status(400).json({ success: false, error: "Capacity must be between 0 and 999999" });
      }
      const newDriver = await prisma.driver.create({
        data: {
          name: req.body.name, callsign: req.body.callsign, location: req.body.location,
          capacity: req.body.capacity, assignedJobs: req.body.assignedJobs || 0,
          status: req.body.status || "offline", phone: req.body.phone, email: req.body.email,
        },
      });
      return res.status(201).json({ success: true, data: newDriver });
    } catch (error: unknown) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2002") return res.status(409).json({ success: false, error: "Callsign already exists" });
      console.error("Error creating driver:", error);
      return res.status(500).json({ success: false, error: "Failed to create driver" });
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
