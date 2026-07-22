CREATE TYPE "OperatorRole" AS ENUM ('ADMIN');

CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "displayName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "OperatorRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatorSession" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "userAgentHash" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "OperatorSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatorLoginThrottle" (
    "id" TEXT NOT NULL,
    "normalizedEmailHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorLoginThrottle_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoogleOAuthState" ADD COLUMN "operatorId" TEXT;
ALTER TABLE "GoogleOAuthState" ADD COLUMN "operatorSessionId" TEXT;

CREATE UNIQUE INDEX "Operator_normalizedEmail_key" ON "Operator"("normalizedEmail");
CREATE INDEX "Operator_role_idx" ON "Operator"("role");
CREATE INDEX "Operator_isActive_idx" ON "Operator"("isActive");

CREATE UNIQUE INDEX "OperatorSession_tokenHash_key" ON "OperatorSession"("tokenHash");
CREATE INDEX "OperatorSession_operatorId_idx" ON "OperatorSession"("operatorId");
CREATE INDEX "OperatorSession_expiresAt_idx" ON "OperatorSession"("expiresAt");
CREATE INDEX "OperatorSession_idleExpiresAt_idx" ON "OperatorSession"("idleExpiresAt");
CREATE INDEX "OperatorSession_revokedAt_idx" ON "OperatorSession"("revokedAt");

CREATE UNIQUE INDEX "OperatorLoginThrottle_normalizedEmailHash_ipHash_key" ON "OperatorLoginThrottle"("normalizedEmailHash", "ipHash");
CREATE INDEX "OperatorLoginThrottle_blockedUntil_idx" ON "OperatorLoginThrottle"("blockedUntil");

CREATE INDEX "GoogleOAuthState_operatorId_idx" ON "GoogleOAuthState"("operatorId");
CREATE INDEX "GoogleOAuthState_operatorSessionId_idx" ON "GoogleOAuthState"("operatorSessionId");

ALTER TABLE "OperatorSession" ADD CONSTRAINT "OperatorSession_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
