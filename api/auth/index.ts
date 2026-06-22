import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function setCors(res: VercelResponse, _req: VercelRequest) {
  const allowedOrigin = (process.env.FRONTEND_URL || "").trim();

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

interface RateLimitEntry {
  count: number;
  expiresAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();

  // Clean up expired entries
  for (const [k, entry] of rateLimitStore) {
    if (entry.expiresAt <= now) {
      rateLimitStore.delete(k);
    }
  }

  const existing = rateLimitStore.get(key);

  if (!existing || existing.expiresAt <= now) {
    rateLimitStore.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (existing.count < maxRequests) {
    existing.count += 1;
    return true;
  }

  return false;
}

function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return secret;
}

// POST /api/auth?action=login
async function handleLogin(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });

  // Rate limit: 10 login attempts per minute per IP
  const ip = (req.headers["x-forwarded-for"] as string) || "unknown";
  if (!checkRateLimit(`login:${ip}`, 10, 60_000)) {
    return res.status(429).json({ success: false, message: "Too many login attempts. Please try again later." });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required" });
  }

  interface AuthUser { id: string; username: string; email: string; role: string; password: string; [key: string]: unknown }
  let user: AuthUser | null = null;

  try {
    const dbUser = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });

    if (dbUser) {
      const isMatch = dbUser.password.startsWith("$2")
        ? await bcrypt.compare(password, dbUser.password)
        : false;
      if (isMatch) user = dbUser;
    }
  } catch (dbError) {
    console.error("Database connection error during login:", dbError);
    return res.status(503).json({ success: false, message: "Service temporarily unavailable" });
  }

  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    getJWTSecret(),
    { expiresIn: "8h" }
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });
  const { password: _, ...userWithoutPassword } = user;
  return res.json({ success: true, token, user: userWithoutPassword });
}

// GET/POST /api/auth?action=verify
async function handleVerify(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }
  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, getJWTSecret()) as { id: string; username: string; email: string; role: string };
    await prisma.user.update({
      where: { id: decoded.id },
      data: { lastSeenAt: new Date() },
    });
    return res.json({
      success: true,
      user: { id: decoded.id, username: decoded.username, email: decoded.email, role: decoded.role },
    });
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

// POST /api/auth?action=logout
async function handleLogout(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(authHeader.substring(7), getJWTSecret()) as { id: string };
      await prisma.user.update({
        where: { id: decoded.id },
        data: { lastSeenAt: null },
      });
    } catch {
      // Logout should still clear the client session even if the token is stale.
    }
  }
  return res.json({ success: true, message: "Logged out successfully" });
}

// POST /api/auth?action=presence
async function handlePresence(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(authHeader.substring(7), getJWTSecret()) as { id: string };
    const lastSeenAt = new Date();
    await prisma.user.update({
      where: { id: decoded.id },
      data: { lastSeenAt },
    });
    return res.json({ success: true, data: { lastSeenAt: lastSeenAt.toISOString() } });
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

// POST /api/auth?action=change-password (authenticated)
async function handleChangePassword(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });

  // Verify JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  let decoded: { id: string };
  try {
    decoded = jwt.verify(authHeader.substring(7), getJWTSecret()) as { id: string };
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: "Current and new password are required" });
  }
  if (newPassword.length < 12) {
    return res.status(400).json({ success: false, message: "New password must be at least 12 characters" });
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.id } });
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  // Verify current password
  if (!user.password.startsWith("$2")) {
    return res.status(400).json({ success: false, message: "Please contact your administrator to reset your password" });
  }
  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: "Current password is incorrect" });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  return res.json({ success: true, message: "Password changed successfully" });
}

// GET /api/auth?action=data-export (authenticated — user downloads own data, POPIA §23)
async function handleDataExport(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  let decoded: { id: string; username: string };
  try {
    decoded = jwt.verify(authHeader.substring(7), getJWTSecret()) as { id: string; username: string };
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, username: true, email: true, role: true, createdAt: true, updatedAt: true },
  });
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  // Gather all data associated with this user
  const [sentMessages, receivedMessages, createdJobs] = await Promise.all([
    prisma.message.findMany({
      where: { senderId: decoded.id },
      select: { id: true, subject: true, body: true, jobRef: true, priority: true, broadcast: true, createdAt: true },
    }),
    prisma.messageRecipient.findMany({
      where: { userId: decoded.id },
      include: { message: { select: { id: true, subject: true, senderName: true, createdAt: true } } },
    }),
    prisma.job.findMany({
      where: { createdById: decoded.id },
      select: { id: true, ref: true, customer: true, status: true, createdAt: true },
    }),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    user,
    sentMessages: sentMessages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    receivedMessages: receivedMessages.map((r) => ({
      messageId: r.message.id,
      subject: r.message.subject,
      from: r.message.senderName,
      receivedAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() || null,
    })),
    createdJobs: createdJobs.map((j) => ({ ...j, createdAt: j.createdAt.toISOString() })),
  };

  res.setHeader("Content-Disposition", `attachment; filename="data-export-${user.username}-${new Date().toISOString().split("T")[0]}.json"`);
  res.setHeader("Content-Type", "application/json");
  return res.json({ success: true, data: exportData });
}

// POST /api/auth?action=erase-user (admin only — POPIA §25 data erasure)
async function handleEraseUser(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  let caller: { id: string; role: string };
  try {
    caller = jwt.verify(authHeader.substring(7), getJWTSecret()) as { id: string; role: string };
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
  if (caller.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  const { userId } = req.body;
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ success: false, message: "userId is required" });
  }
  if (userId === caller.id) {
    return res.status(400).json({ success: false, message: "Cannot erase your own account" });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  // Tombstone PII but keep audit trail
  const tombstone = `[erased-${Date.now()}]`;
  await prisma.$transaction([
    // Anonymize user record
    prisma.user.update({
      where: { id: userId },
      data: {
        username: tombstone,
        email: `${tombstone}@erased.local`,
        password: "",
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    }),
    // Anonymize sender name on messages (keep message content for audit)
    prisma.message.updateMany({
      where: { senderId: userId },
      data: { senderName: "[Erased User]" },
    }),
    // Remove message recipient entries
    prisma.messageRecipient.deleteMany({
      where: { userId },
    }),
  ]);

  return res.json({
    success: true,
    message: `User PII erased. Audit records preserved with tombstone: ${tombstone}`,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = req.query.action as string;

  try {
    switch (action) {
      case "login": return await handleLogin(req, res);
      case "verify": return await handleVerify(req, res);
      case "logout": return await handleLogout(req, res);
      case "presence": return await handlePresence(req, res);
      case "change-password": return await handleChangePassword(req, res);
      case "data-export": return await handleDataExport(req, res);
      case "erase-user": return await handleEraseUser(req, res);
      default:
        return res.status(400).json({ success: false, message: "Unknown or invalid action" });
    }
  } catch (error) {
    console.error(`Auth error (${action}):`, error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
