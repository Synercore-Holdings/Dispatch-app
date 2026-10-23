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

const formatDate = (d: unknown) => d instanceof Date ? d.toISOString() : d;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!validateOrigin(req)) return res.status(403).json({ success: false, error: "Forbidden" });

  const user = await requireAuth(req.headers.authorization, res);
  if (!user) return res.headersSent ? undefined : res.status(401).json({ success: false, error: "Unauthorized" });

  // GET — messages for current user (inbox)
  if (req.method === "GET") {
    try {
      const { folder, unreadOnly } = req.query;

      if (folder === "sent") {
        // Sent messages
        const messages = await prisma.message.findMany({
          where: { senderId: user.id },
          include: { recipients: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        return res.json({
          success: true,
          data: messages.map((m) => ({
            ...m,
            createdAt: formatDate(m.createdAt),
            recipients: m.recipients.map((r) => ({ ...r, readAt: formatDate(r.readAt), createdAt: formatDate(r.createdAt) })),
          })),
        });
      }

      // Thread view — all messages in a conversation
      if (folder === "thread") {
        const tid = req.query.threadId as string;
        if (!tid) return res.status(400).json({ success: false, error: "threadId required" });
        const threadMessages = await prisma.message.findMany({
          where: {
            AND: [
              {
                OR: [
                  { id: tid },
                  { threadId: tid },
                ],
              },
              {
                OR: [
                  { senderId: user.id },
                  { recipients: { some: { userId: user.id } } },
                ],
              },
            ],
          },
          include: { recipients: true },
          orderBy: { createdAt: "asc" },
        });
        return res.json({
          success: true,
          data: threadMessages.map((m) => ({
            ...m,
            createdAt: formatDate(m.createdAt),
            recipients: m.recipients.map((r) => ({ ...r, readAt: formatDate(r.readAt), createdAt: formatDate(r.createdAt) })),
          })),
        });
      }

      if (folder === "unread-count") {
        const count = await prisma.messageRecipient.count({
          where: { userId: user.id, readAt: null },
        });
        return res.json({ success: true, data: { count } });
      }

      // Inbox — messages where user is a recipient
      const where: Record<string, unknown> = { userId: user.id };
      if (unreadOnly === "true") where.readAt = null;


      const recipientEntries = await prisma.messageRecipient.findMany({
        where,
        include: {
          message: {
            include: { recipients: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      const messages = recipientEntries.map((r) => ({
        ...r.message,
        createdAt: formatDate(r.message.createdAt),
        recipients: r.message.recipients.map((rec) => ({
          ...rec,
          readAt: formatDate(rec.readAt),
          createdAt: formatDate(rec.createdAt),
        })),
        _readAt: formatDate(r.readAt),
      }));

      return res.json({ success: true, data: messages });
    } catch (error) {
      console.error("Error fetching messages:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch messages" });
    }
  }

  // POST — send a new message
  if (req.method === "POST") {
    try {
      const { subject, body, recipientIds, jobRef, priority, broadcast, threadId } = req.body;
      if (!subject?.trim() || !body?.trim()) {
        return res.status(400).json({ success: false, error: "Subject and body are required" });
      }

      let targetUserIds: string[] = recipientIds || [];

      // If broadcast, only admin/dispatcher/manager can send
      if (broadcast) {
        if (!["admin", "dispatcher", "manager"].includes(user.role)) {
          return res.status(403).json({ success: false, error: "Only admin, dispatcher, or manager can send broadcast messages" });
        }
        const allUsers = await prisma.user.findMany({ select: { id: true, username: true } });
        targetUserIds = allUsers.filter((u) => u.id !== user.id).map((u) => u.id);
      }

      if (targetUserIds.length === 0) {
        return res.status(400).json({ success: false, error: "At least one recipient is required" });
      }

      if (threadId) {
        const parentMessage = await prisma.message.findFirst({
          where: {
            id: String(threadId),
            OR: [
              { senderId: user.id },
              { recipients: { some: { userId: user.id } } },
            ],
          },
          select: { id: true },
        });
        if (!parentMessage) return res.status(403).json({ success: false, error: "Not authorized for this thread" });
      }

      // Get usernames for recipients
      const users = await prisma.user.findMany({
        where: { id: { in: targetUserIds } },
        select: { id: true, username: true },
      });

      const message = await prisma.message.create({
        data: {
          senderId: user.id,
          senderName: user.username,
          subject: subject.trim(),
          body: body.trim(),
          jobRef: jobRef || null,
          priority: priority || "normal",
          broadcast: !!broadcast,
          threadId: threadId || null,
          recipients: {
            create: users.map((u) => ({
              userId: u.id,
              username: u.username,
            })),
          },
        },
        include: { recipients: true },
      });

      return res.status(201).json({
        success: true,
        data: {
          ...message,
          createdAt: formatDate(message.createdAt),
          recipients: message.recipients.map((r) => ({ ...r, readAt: formatDate(r.readAt), createdAt: formatDate(r.createdAt) })),
        },
      });
    } catch (error) {
      console.error("Error creating message:", error);
      return res.status(500).json({ success: false, error: "Failed to send message" });
    }
  }

  // PUT — mark message as read (pass ?id=xxx)
  if (req.method === "PUT") {
    const { id } = req.query;
    if (!id || typeof id !== "string") return res.status(400).json({ success: false, error: "Message ID required (?id=xxx)" });
    try {
      const recipient = await prisma.messageRecipient.findFirst({
        where: { messageId: id, userId: user.id },
      });
      if (!recipient) return res.status(404).json({ success: false, error: "Message not found" });
      await prisma.messageRecipient.update({
        where: { id: recipient.id },
        data: { readAt: new Date() },
      });
      return res.json({ success: true });
    } catch (error) {
      console.error("Error marking message read:", error);
      return res.status(500).json({ success: false, error: "Failed to update message" });
    }
  }

  // DELETE — delete message (sender deletes entirely, recipient removes from their inbox)
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id || typeof id !== "string") return res.status(400).json({ success: false, error: "Message ID required (?id=xxx)" });
    try {
      const message = await prisma.message.findUnique({ where: { id }, include: { recipients: true } });
      if (!message) return res.status(404).json({ success: false, error: "Message not found" });

      if (message.senderId === user.id) {
        // Sender deletes the entire message
        await prisma.message.delete({ where: { id } });
      } else {
        // Recipient removes it from their inbox
        const recipient = message.recipients.find((r) => r.userId === user.id);
        if (!recipient) return res.status(403).json({ success: false, error: "Not authorized" });
        await prisma.messageRecipient.delete({ where: { id: recipient.id } });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting message:", error);
      return res.status(500).json({ success: false, error: "Failed to delete message" });
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
