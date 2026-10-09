import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
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

async function requireAdmin(authHeader: string | undefined, res: VercelResponse): Promise<JwtPayload | null> {
  const user = await requireAuth(authHeader, res);
  if (!user || user.role !== "admin") return null;
  return user;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!validateOrigin(req)) return res.status(403).json({ success: false, message: "Forbidden" });

  const id = req.query.id as string | undefined;

  // --- Single user operations (when ?id=xxx is provided, admin only) ---
  if (id) {
    const caller = await requireAdmin(req.headers.authorization, res);
    if (!caller) return res.headersSent ? undefined : res.status(403).json({ success: false, message: "Admin access required" });

    if (req.method === "GET") {
      try {
        const user = await prisma.user.findUnique({
          where: { id },
          select: { id: true, username: true, email: true, role: true, lastSeenAt: true },
        });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        return res.json(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch user" });
      }
    }

    if (req.method === "PUT") {
      try {
        const { username, email, password, role } = req.body;
        if (!username || !email || !role) return res.status(400).json({ success: false, message: "Username, email, and role are required" });
        const validRoles = ["viewer", "user", "dispatcher", "manager", "admin"];
        if (!validRoles.includes(role)) return res.status(400).json({ success: false, message: "Invalid role" });

        const updateData: Record<string, unknown> = { username, email, role };
        if (password) {
          if (password.length < 12) return res.status(400).json({ success: false, message: "Password must be at least 12 characters" });
          updateData.password = await bcrypt.hash(password, 12);
        }

        const updatedUser = await prisma.user.update({
          where: { id }, data: updateData,
          select: { id: true, username: true, email: true, role: true, lastSeenAt: true },
        });
        return res.json({ success: true, user: updatedUser, message: "User updated successfully" });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2025") return res.status(404).json({ success: false, message: "User not found" });
        if (prismaError.code === "P2002") return res.status(400).json({ success: false, message: "Username or email already exists" });
        console.error("Error updating user:", error);
        return res.status(500).json({ success: false, message: "Failed to update user" });
      }
    }

    if (req.method === "DELETE") {
      try {
        if (id === caller.id) return res.status(400).json({ success: false, message: "Cannot delete your own account" });
        await prisma.user.delete({ where: { id } });
        return res.json({ success: true, message: "User deleted successfully" });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2025") return res.status(404).json({ success: false, message: "User not found" });
        console.error("Error deleting user:", error);
        return res.status(500).json({ success: false, message: "Failed to delete user" });
      }
    }

    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  // --- Collection operations ---
  // GET — any authenticated user can list users (for recipient picker)
  if (req.method === "GET") {
    const user = await requireAuth(req.headers.authorization, res);
    if (!user) return res.headersSent ? undefined : res.status(401).json({ success: false, message: "Unauthorized" });
    try {
      // Only admins need email addresses; everyone else just picks recipients by name.
      const isAdmin = user.role === "admin";
      const users = await prisma.user.findMany({
        select: { id: true, username: true, email: isAdmin, role: true, createdAt: true, lastSeenAt: true },
      });
      return res.json({ success: true, data: users });
    } catch (error) {
      console.error("Error fetching users:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch users" });
    }
  }

  // POST — admin only
  const caller = await requireAdmin(req.headers.authorization, res);
  if (!caller) return res.headersSent ? undefined : res.status(403).json({ success: false, message: "Admin access required" });

  if (req.method === "POST") {
    try {
      const { username, email, password, role } = req.body;
      if (!username || !email || !password || !role) {
        return res.status(400).json({ success: false, message: "All fields are required" });
      }
      const validRoles = ["viewer", "user", "dispatcher", "manager", "admin"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ success: false, message: "Invalid role" });
      }
      if (password.length < 12) {
        return res.status(400).json({ success: false, message: "Password must be at least 12 characters" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const newUser = await prisma.user.create({
        data: { username, email, password: hashedPassword, role },
        select: { id: true, username: true, email: true, role: true, lastSeenAt: true },
      });
      return res.status(201).json({ success: true, user: newUser, message: "User created successfully" });
    } catch (error: unknown) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2002") return res.status(400).json({ success: false, message: "Username or email already exists" });
      console.error("Error creating user:", error);
      return res.status(500).json({ success: false, message: "Failed to create user" });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}
