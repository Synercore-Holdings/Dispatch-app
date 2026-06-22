ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "passwordResetToken" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "passwordResetExpires" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "users_passwordResetToken_idx"
  ON "users"("passwordResetToken");
