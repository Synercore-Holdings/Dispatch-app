import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma, requireAuth, setCors, validateOrigin, MAX_BATCH_SIZE } from "../_lib.js";

const MAX_TEXT = 5000;
const MAX_STRING = 1000;

const normalize = (value: unknown) => String(value ?? "").trim();

const getLineRowKey = (line: Record<string, unknown>) => {
  const invoiceNumber = normalize(line.invoiceNumber).toLowerCase();
  return [
    invoiceNumber || "no-invoice",
    normalize(line.aso).toLowerCase(),
    normalize(line.invoiceDate).toLowerCase(),
    normalize(line.deliveryDueDate).toLowerCase(),
    normalize(line.customer).toLowerCase(),
    normalize(line.invoiceQty).toLowerCase(),
    normalize(line.product).toLowerCase(),
    normalize(line.createdBy).toLowerCase(),
  ].join("|");
};

const formatLine = (line: Record<string, unknown>) => ({
  aso: line.aso || "",
  invoiceNumber: line.invoiceNumber || "",
  invoiceDate: line.invoiceDate || "",
  deliveryDueDate: line.deliveryDueDate || "",
  customer: line.customer || "",
  invoiceQty: line.invoiceQty || 0,
  hasInvoiceQty: Boolean(line.hasInvoiceQty),
  invoiceValue: line.invoiceValue || 0,
  product: line.product || "",
  createdBy: line.createdBy || "",
  deliveryStatus: line.deliveryStatus || "",
  status: line.status || "",
  postedDate: line.postedDate || "",
});

const toLineData = (line: Record<string, unknown>, createdById?: string) => {
  const aso = normalize(line.aso);
  if (!aso) throw new Error("ASO is required");
  const customer = normalize(line.customer);
  const product = normalize(line.product);
  if (customer.length > MAX_STRING) throw new Error("Customer name too long");
  if (product.length > MAX_TEXT) throw new Error("Product detail too long");

  return {
    rowKey: getLineRowKey(line),
    aso,
    invoiceNumber: normalize(line.invoiceNumber) || null,
    invoiceDate: normalize(line.invoiceDate) || null,
    deliveryDueDate: normalize(line.deliveryDueDate) || null,
    customer: customer || null,
    invoiceQty: Number.isFinite(Number(line.invoiceQty)) ? Number(line.invoiceQty) : 0,
    hasInvoiceQty: Boolean(line.hasInvoiceQty),
    invoiceValue: Number.isFinite(Number(line.invoiceValue)) ? Number(line.invoiceValue) : null,
    product: product || null,
    createdBy: normalize(line.createdBy) || null,
    deliveryStatus: normalize(line.deliveryStatus) || null,
    status: normalize(line.status) || null,
    postedDate: normalize(line.postedDate) || null,
    ...(createdById ? { createdById } : {}),
  };
};

const formatReviewMap = (reviews: { aso: string; status: string }[]) => (
  reviews.reduce<Record<string, string>>((acc, review) => {
    acc[review.aso] = review.status;
    return acc;
  }, {})
);

const formatNoteMap = (notes: { invoiceKey: string; note: string }[]) => (
  notes.reduce<Record<string, string>>((acc, note) => {
    acc[note.invoiceKey] = note.note;
    return acc;
  }, {})
);

const formatCommentMap = (notes: { invoiceKey: string; comment?: string | null }[]) => (
  notes.reduce<Record<string, string>>((acc, note) => {
    if (note.comment) acc[note.invoiceKey] = note.comment;
    return acc;
  }, {})
);

const formatNoteMetaMap = (notes: { invoiceKey: string; updatedById?: string | null; updatedAt?: Date | string | null }[], usersById = new Map<string, string>()) => (
  notes.reduce<Record<string, { updatedById: string; updatedByName: string; updatedAt: string }>>((acc, note) => {
    const updatedById = note.updatedById || "";
    acc[note.invoiceKey] = {
      updatedById,
      updatedByName: updatedById ? usersById.get(updatedById) || "" : "",
      updatedAt: note.updatedAt instanceof Date ? note.updatedAt.toISOString() : note.updatedAt || "",
    };
    return acc;
  }, {})
);

const formatUpload = (upload: Record<string, unknown> | null) => upload ? ({
  filename: upload.filename || "",
  uploadedAt: upload.uploadedAt instanceof Date ? upload.uploadedAt.toISOString() : upload.uploadedAt || "",
  rowsAdded: upload.rowsAdded || 0,
  rowsSkipped: upload.rowsSkipped || 0,
  updatedById: upload.updatedById || "",
}) : null;

const formatAudit = (audit: Record<string, unknown>) => ({
  id: audit.id,
  entityType: audit.entityType,
  entityKey: audit.entityKey,
  action: audit.action,
  fromValue: audit.fromValue || "",
  toValue: audit.toValue || "",
  userId: audit.userId || "",
  createdAt: audit.createdAt instanceof Date ? audit.createdAt.toISOString() : audit.createdAt || "",
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!validateOrigin(req)) return res.status(403).json({ success: false, error: "Forbidden" });

  const user = requireAuth(req.headers.authorization);
  if (!user) return res.status(401).json({ success: false, error: "Unauthorized" });

  const action = req.query.action as string | undefined;

  if (req.method === "GET") {
    try {
      const [lines, reviews, notes, latestUpload, uploads, audits] = await Promise.all([
        prisma.invoiceReconciliationLine.findMany({ orderBy: { createdAt: "asc" } }),
        prisma.invoiceReconciliationReview.findMany(),
        prisma.invoiceReconciliationTimingNote.findMany(),
        prisma.invoiceReconciliationUpload.findFirst({ orderBy: { uploadedAt: "desc" } }),
        prisma.invoiceReconciliationUpload.findMany({ orderBy: { uploadedAt: "desc" }, take: 25 }),
        prisma.invoiceReconciliationAudit.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      ]);
      const noteUserIds = Array.from(new Set(notes.map((note) => note.updatedById).filter(Boolean))) as string[];
      const noteUsers = noteUserIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: noteUserIds } }, select: { id: true, username: true } })
        : [];
      const noteUsersById = new Map(noteUsers.map((noteUser) => [noteUser.id, noteUser.username]));

      return res.json({
        success: true,
        data: {
          lines: lines.map(formatLine),
          reviews: formatReviewMap(reviews),
          timingNotes: formatNoteMap(notes),
          timingComments: formatCommentMap(notes),
          timingNoteMeta: formatNoteMetaMap(notes, noteUsersById),
          uploadMeta: formatUpload(latestUpload),
          uploads: uploads.map(formatUpload),
          audits: audits.map(formatAudit),
        },
      });
    } catch (error) {
      console.error("Error fetching invoice reconciliation data:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch invoice reconciliation data" });
    }
  }

  if (req.method === "POST") {
    if (user.role === "viewer") return res.status(403).json({ success: false, error: "Viewers cannot modify data" });

    if (action === "bulk-upsert-lines") {
      try {
        const lines = req.body?.lines;
        if (!Array.isArray(lines)) return res.status(400).json({ success: false, error: "Request body must include a lines array" });
        if (lines.length > MAX_BATCH_SIZE) return res.status(400).json({ success: false, error: `Batch size cannot exceed ${MAX_BATCH_SIZE}` });

        const result = await prisma.$transaction(
          lines.map((line: Record<string, unknown>) => {
            const data = toLineData(line, user.id);
            return prisma.invoiceReconciliationLine.upsert({
              where: { rowKey: data.rowKey },
              create: data,
              update: data,
            });
          }),
        );
        return res.status(201).json({ success: true, data: result.map(formatLine) });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to save invoice reconciliation rows";
        if (message.includes("required") || message.includes("too long")) {
          return res.status(400).json({ success: false, error: message });
        }
        console.error("Error bulk upserting invoice reconciliation rows:", error);
        return res.status(500).json({ success: false, error: "Failed to save invoice reconciliation rows" });
      }
    }

    if (action === "bulk-upsert-reviews") {
      try {
        const reviews = req.body?.reviews;
        if (!reviews || typeof reviews !== "object" || Array.isArray(reviews)) {
          return res.status(400).json({ success: false, error: "Request body must include a reviews object" });
        }
        const entries = Object.entries(reviews as Record<string, unknown>).filter(([aso]) => normalize(aso));
        if (entries.length > MAX_BATCH_SIZE) return res.status(400).json({ success: false, error: `Batch size cannot exceed ${MAX_BATCH_SIZE}` });

        const result = await prisma.$transaction(
          entries.map(([aso, status]) => prisma.invoiceReconciliationReview.upsert({
            where: { aso: normalize(aso) },
            create: { aso: normalize(aso), status: normalize(status), updatedById: user.id },
            update: { status: normalize(status), updatedById: user.id },
          })),
        );
        return res.status(201).json({ success: true, data: formatReviewMap(result) });
      } catch (error) {
        console.error("Error saving invoice reconciliation reviews:", error);
        return res.status(500).json({ success: false, error: "Failed to save invoice reconciliation reviews" });
      }
    }

    if (action === "bulk-upsert-timing-notes") {
      try {
        const notes = req.body?.notes;
        if (!notes || typeof notes !== "object" || Array.isArray(notes)) {
          return res.status(400).json({ success: false, error: "Request body must include a notes object" });
        }
        const comments = req.body?.comments && typeof req.body.comments === "object" && !Array.isArray(req.body.comments)
          ? req.body.comments as Record<string, unknown>
          : {};
        const entries = Object.entries(notes as Record<string, unknown>).filter(([invoiceKey]) => normalize(invoiceKey));
        if (entries.length > MAX_BATCH_SIZE) return res.status(400).json({ success: false, error: `Batch size cannot exceed ${MAX_BATCH_SIZE}` });

        const existingNotes = await prisma.invoiceReconciliationTimingNote.findMany({
          where: { invoiceKey: { in: entries.map(([invoiceKey]) => normalize(invoiceKey)) } },
        });
        const existingByKey = new Map(existingNotes.map((note) => [note.invoiceKey, note.note]));
        const result = await prisma.$transaction([
          ...entries.map(([invoiceKey, note]) => prisma.invoiceReconciliationTimingNote.upsert({
            where: { invoiceKey: normalize(invoiceKey) },
            create: {
              invoiceKey: normalize(invoiceKey),
              invoiceNumber: normalize(invoiceKey).startsWith("invoice:") ? normalize(invoiceKey).slice(8) : null,
              note: normalize(note),
              comment: normalize(comments[normalize(invoiceKey)]) || null,
              updatedById: user.id,
            },
            update: {
              note: normalize(note),
              comment: normalize(comments[normalize(invoiceKey)]) || null,
              updatedById: user.id,
            },
          })),
          ...entries
            .filter(([invoiceKey, note]) => existingByKey.get(normalize(invoiceKey)) !== normalize(note))
            .map(([invoiceKey, note]) => prisma.invoiceReconciliationAudit.create({
              data: {
                entityType: "late-invoice-reason",
                entityKey: normalize(invoiceKey),
                action: "Late invoice reason updated",
                fromValue: existingByKey.get(normalize(invoiceKey)) || null,
                toValue: normalize(note) || null,
                userId: user.id,
              },
            })),
        ]);
        const noteResult = result.filter((item) => "invoiceKey" in item) as { invoiceKey: string; note: string; comment?: string | null }[];
        return res.status(201).json({
          success: true,
          data: {
            notes: formatNoteMap(noteResult),
            timingComments: formatCommentMap(noteResult),
            timingNoteMeta: formatNoteMetaMap(noteResult, new Map([[user.id, user.username]])),
          },
        });
      } catch (error) {
        console.error("Error saving invoice timing notes:", error);
        return res.status(500).json({ success: false, error: "Failed to save invoice timing notes" });
      }
    }

    if (action === "record-upload") {
      try {
        const filename = normalize(req.body?.filename);
        if (!filename) return res.status(400).json({ success: false, error: "Filename is required" });
        const upload = await prisma.invoiceReconciliationUpload.create({
          data: {
            filename,
            uploadedAt: req.body?.uploadedAt ? new Date(String(req.body.uploadedAt)) : new Date(),
            rowsAdded: Number.isFinite(Number(req.body?.rowsAdded)) ? Number(req.body.rowsAdded) : 0,
            rowsSkipped: Number.isFinite(Number(req.body?.rowsSkipped)) ? Number(req.body.rowsSkipped) : 0,
            updatedById: user.id,
          },
        });
        return res.status(201).json({ success: true, data: formatUpload(upload) });
      } catch (error) {
        console.error("Error recording invoice reconciliation upload:", error);
        return res.status(500).json({ success: false, error: "Failed to record invoice upload" });
      }
    }

    if (action === "undo-last-upload") {
      try {
        const latestUpload = await prisma.invoiceReconciliationUpload.findFirst({
          orderBy: { uploadedAt: "desc" },
        });
        if (!latestUpload) {
          return res.status(404).json({ success: false, error: "No upload history found" });
        }

        const rowsToDelete = latestUpload.rowsAdded as number;

        // Find the N most recently created invoice lines
        const linesToDelete = await prisma.invoiceReconciliationLine.findMany({
          orderBy: { createdAt: "desc" },
          take: rowsToDelete,
          select: { id: true, aso: true },
        });
        const lineIds = linesToDelete.map((l) => l.id);
        const deletedAsos = new Set(linesToDelete.map((l) => l.aso));

        // After deletion, which ASOs will have zero remaining lines?
        const remainingLines = await prisma.invoiceReconciliationLine.findMany({
          where: { aso: { in: Array.from(deletedAsos) }, id: { notIn: lineIds } },
          select: { aso: true },
        });
        const remainingAsos = new Set(remainingLines.map((l) => l.aso));
        const asosToClear = Array.from(deletedAsos).filter((aso) => !remainingAsos.has(aso));

        // Revert auto-delivered jobs for cleared ASOs back to pending
        let revertedCount = 0;
        if (asosToClear.length > 0) {
          const reverted = await prisma.job.updateMany({
            where: { ref: { in: asosToClear }, status: "delivered", actualDeliveryAt: { not: null } },
            data: { status: "pending", actualDeliveryAt: null },
          });
          revertedCount = reverted.count;
        }

        await prisma.$transaction([
          prisma.invoiceReconciliationLine.deleteMany({ where: { id: { in: lineIds } } }),
          prisma.invoiceReconciliationUpload.delete({ where: { id: latestUpload.id } }),
          prisma.invoiceReconciliationAudit.create({
            data: {
              entityType: "invoice-upload",
              entityKey: String(latestUpload.id),
              action: "Upload undone",
              fromValue: latestUpload.filename as string,
              toValue: `${lineIds.length} lines removed, ${revertedCount} orders reverted`,
              userId: user.id,
            },
          }),
        ]);

        return res.json({ success: true, data: { linesRemoved: lineIds.length, ordersReverted: revertedCount } });
      } catch (error) {
        console.error("Error undoing last invoice upload:", error);
        return res.status(500).json({ success: false, error: "Failed to undo last upload" });
      }
    }

    return res.status(400).json({ success: false, error: "Unsupported action" });
  }

  if (req.method === "DELETE") {
    if (user.role !== "admin") return res.status(403).json({ success: false, error: "Admin role required to reset invoice ledger" });
    if (action !== "lines") return res.status(400).json({ success: false, error: "Unsupported action" });

    try {
      const reason = normalize(req.body?.reason);
      const [deleted] = await prisma.$transaction([
        prisma.invoiceReconciliationLine.deleteMany(),
        prisma.invoiceReconciliationUpload.deleteMany(),
        prisma.invoiceReconciliationAudit.create({
          data: {
            entityType: "invoice-ledger",
            entityKey: "all",
            action: "Invoice ledger reset",
            toValue: reason || null,
            userId: user.id,
          },
        }),
      ]);
      return res.json({ success: true, data: { deleted: deleted.count } });
    } catch (error) {
      console.error("Error resetting invoice ledger:", error);
      return res.status(500).json({ success: false, error: "Failed to reset invoice ledger" });
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
