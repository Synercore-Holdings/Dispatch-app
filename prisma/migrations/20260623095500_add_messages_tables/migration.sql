CREATE TABLE IF NOT EXISTS "messages" (
  "id" TEXT NOT NULL,
  "senderId" VARCHAR(255) NOT NULL,
  "senderName" VARCHAR(255) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "body" TEXT NOT NULL,
  "jobRef" VARCHAR(255),
  "priority" VARCHAR(50) NOT NULL DEFAULT 'normal',
  "broadcast" BOOLEAN NOT NULL DEFAULT false,
  "threadId" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "message_recipients" (
  "id" TEXT NOT NULL,
  "messageId" VARCHAR(255) NOT NULL,
  "userId" VARCHAR(255) NOT NULL,
  "username" VARCHAR(255) NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "message_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "messages_senderId_idx" ON "messages"("senderId");
CREATE INDEX IF NOT EXISTS "messages_jobRef_idx" ON "messages"("jobRef");
CREATE INDEX IF NOT EXISTS "messages_threadId_idx" ON "messages"("threadId");
CREATE INDEX IF NOT EXISTS "messages_createdAt_idx" ON "messages"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "message_recipients_messageId_userId_key"
  ON "message_recipients"("messageId", "userId");
CREATE INDEX IF NOT EXISTS "message_recipients_userId_idx" ON "message_recipients"("userId");
CREATE INDEX IF NOT EXISTS "message_recipients_messageId_idx" ON "message_recipients"("messageId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_recipients_messageId_fkey'
  ) THEN
    ALTER TABLE "message_recipients"
      ADD CONSTRAINT "message_recipients_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
