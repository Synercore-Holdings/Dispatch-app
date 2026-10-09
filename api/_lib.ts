import type { VercelResponse } from "@vercel/node";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Shared Prisma instance (singleton)
// ---------------------------------------------------------------------------
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma || new PrismaClient();

// Always share the instance: handlers that build their own client via
// `globalForPrisma.prisma || new PrismaClient()` then reuse this pool.
globalForPrisma.prisma = prisma;

// ---------------------------------------------------------------------------
// JWT payload type
// ---------------------------------------------------------------------------
export interface JwtPayload {
  id: string;
  username: string;
  email: string;
  role: string;
}

// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------
export function setCors(res: VercelResponse, req?: { headers: { origin?: string } }): void {
  const origin = process.env.FRONTEND_URL || req?.headers?.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Extract and verify the Bearer token from the Authorization header.
 * Returns the decoded payload or `null` when the token is missing / invalid.
 *
 * Throws if the JWT_SECRET environment variable is not configured.
 */
export function requireAuth(authHeader: string | undefined): JwtPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Same as `requireAuth` but additionally checks that the user has the
 * "admin" role.  Returns the payload when the caller is an admin, or
 * `null` otherwise.
 */
export function requireAdmin(
  authHeader: string | undefined,
): JwtPayload | null {
  const user = requireAuth(authHeader);
  if (!user || user.role !== "admin") {
    return null;
  }
  return user;
}

/**
 * Verify the token, then load the user from the database so that deleted,
 * erased or re-roled users take effect immediately rather than when their
 * 8-hour token expires. Returns the current user, or `null`.
 */
export async function authenticate(authHeader: string | undefined): Promise<JwtPayload | null> {
  const claims = requireAuth(authHeader);
  if (!claims?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.id },
    select: { id: true, username: true, email: true, role: true, password: true },
  });
  // Erased users keep their row with an empty password.
  if (!user || !user.password) return null;
  return { id: user.id, username: user.username, email: user.email, role: user.role };
}

export async function authenticateAdmin(authHeader: string | undefined): Promise<JwtPayload | null> {
  const user = await authenticate(authHeader);
  return user?.role === "admin" ? user : null;
}

// ---------------------------------------------------------------------------
// In-memory rate limiter
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  expiresAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Simple in-memory rate limiter suitable for serverless cold-start windows.
 *
 * @param key          Unique identifier (e.g. IP address or user id).
 * @param maxRequests  Maximum number of requests allowed in the window.
 * @param windowMs     Window duration in milliseconds.
 * @returns `true` if the request is allowed, `false` if rate-limited.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
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

// ---------------------------------------------------------------------------
// CSRF / Origin validation
// ---------------------------------------------------------------------------

/**
 * Validates the request origin for state-changing methods (POST, PUT, DELETE).
 * Returns `true` if the request is allowed, `false` if it should be rejected.
 * GET/HEAD/OPTIONS are always allowed (safe methods).
 */
export function validateOrigin(req: { method?: string; headers: { origin?: string; referer?: string; host?: string } }): boolean {
  const method = (req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const host = req.headers.host || "";

  // Allow same-site requests (origin matches the host)
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return true;
    } catch { /* invalid origin URL */ }
  }

  // Allow if origin matches configured frontend URL
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    if (origin && origin === frontendUrl) return true;
    if (!origin && referer && referer.startsWith(frontendUrl)) return true;
  }

  // In development, also allow localhost origins
  if (process.env.NODE_ENV !== "production") {
    if (origin.startsWith("http://localhost:")) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const MAX_BATCH_SIZE = 500;
