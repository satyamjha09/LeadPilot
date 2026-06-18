-- Persist Google OAuth tokens outside the ephemeral local filesystem.
CREATE TABLE "GoogleAuth" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAuth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAuth_email_key" ON "GoogleAuth"("email");
