import { randomUUID } from 'node:crypto';
import { prisma } from './db';
import type { EmailType } from './emailIdentity';
import type { ExcelRow } from '../src/types';
import { getAutomationId, type EmailIdentityContext } from './emailIdentity';
import type { EmailBrandKey } from '../src/lib/emailBrand';
import { type SenderAccountKey } from '../src/lib/senderAccount';

export const EMAIL_DELIVERY_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  RETRY_PENDING: 'RETRY_PENDING',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN'
} as const;

const INSTANCE_ID = process.env.INSTANCE_ID || `${process.pid}_${randomUUID().slice(0, 8)}`;

export type EmailClaimInput = {
  eventKey: string;
  automationId: string;
  demoSessionId?: string | null;
  emailType: EmailType;
  recipient: string;
  payloadHash: string;
  emailBrand: EmailBrandKey;
  senderAccountKey: SenderAccountKey;
  subject?: string;
  text?: string;
  html?: string;
};

export type PendingEmailIntentInput = EmailClaimInput;

export type EmailClaimResult =
  | { claimed: true; deliveryId: string; attemptCount: number }
  | {
      claimed: false;
      reason:
        | 'ALREADY_SENT'
        | 'ALREADY_PROCESSING'
        | 'UNKNOWN_RESULT'
        | 'PERMANENT_FAILURE'
        | 'RETRY_NOT_DUE'
        | 'CLAIMED_BY_ANOTHER_PROCESS';
      deliveryId: string;
      providerMessageId?: string | null;
    };

export async function findEmailDeliveryByEventKey(emailBrand: EmailBrandKey, eventKey: string) {
  return prisma.emailDelivery.findUnique({
    where: {
      emailBrand_eventKey: {
        emailBrand,
        eventKey
      }
    }
  });
}

export async function listEmailDeliveriesForRow(row: ExcelRow, context: EmailIdentityContext & { emailBrand: EmailBrandKey }) {
  try {
    const automationId = getAutomationId(row, context);
    return prisma.emailDelivery.findMany({
      where: {
        emailBrand: context.emailBrand,
        automationId
      },
      orderBy: { createdAt: 'desc' }
    });
  } catch {
    return [];
  }
}

export async function findEmailDeliveryById(deliveryId: string) {
  const [delivery] = await prisma.$queryRaw<
    Array<{
      id: string;
      eventKey: string;
      automationId: string;
      demoSessionId: string | null;
      emailBrand: EmailBrandKey;
      senderAccountKey: SenderAccountKey;
      emailType: string;
      recipient: string;
      payloadHash: string;
      status: string;
      attemptCount: number;
      retryCount: number;
      maxRetries: number;
      nextRetryAt: Date | null;
      providerMessageId: string | null;
      subject: string | null;
      textBody: string | null;
      htmlBody: string | null;
      sentAt: Date | null;
      lockedAt: Date | null;
      lockedBy: string | null;
      lastError: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    SELECT
      "id",
      "eventKey",
      "automationId",
      "demoSessionId",
      "emailBrand",
      "senderAccountKey",
      "emailType",
      "recipient",
      "payloadHash",
      "status",
      "attemptCount",
      "retryCount",
      "maxRetries",
      "nextRetryAt",
      "providerMessageId",
      "subject",
      "textBody",
      "htmlBody",
      "sentAt",
      "lockedAt",
      "lockedBy",
      "lastError",
      "createdAt",
      "updatedAt"
    FROM "EmailDelivery"
    WHERE "id" = ${deliveryId}
    LIMIT 1
  `;
  return delivery || null;
}

export async function claimEmailDelivery(input: EmailClaimInput): Promise<EmailClaimResult> {
  if (!input.senderAccountKey) {
    throw new Error('senderAccountKey is required to claim an email delivery.');
  }

  const existingBeforeCreate = await prisma.emailDelivery.findUnique({
    where: {
      emailBrand_eventKey: {
        emailBrand: input.emailBrand,
        eventKey: input.eventKey
      }
    }
  });
  if (existingBeforeCreate) {
    return resolveExistingDeliveryClaim(existingBeforeCreate);
  }

  const deliveryId = randomUUID();
  const now = new Date();
  const emailBrand = input.emailBrand;
  const senderAccountKey = input.senderAccountKey;
  const inserted = await prisma.$executeRaw`
    INSERT INTO "EmailDelivery" (
      "id",
      "eventKey",
      "automationId",
      "emailBrand",
      "senderAccountKey",
      "demoSessionId",
      "emailType",
      "recipient",
      "payloadHash",
      "status",
      "attemptCount",
      "retryCount",
      "maxRetries",
      "subject",
      "textBody",
      "htmlBody",
      "lockedAt",
      "lockedBy",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${deliveryId},
      ${input.eventKey},
      ${input.automationId},
      ${emailBrand},
      ${senderAccountKey},
      ${input.demoSessionId || null},
      ${input.emailType},
      ${input.recipient.toLowerCase().trim()},
      ${input.payloadHash},
      ${EMAIL_DELIVERY_STATUS.PROCESSING},
      ${1},
      ${0},
      ${3},
      ${input.subject || null},
      ${input.text || null},
      ${input.html || null},
      ${now},
      ${INSTANCE_ID},
      ${now},
      ${now}
    )
    ON CONFLICT ("emailBrand", "eventKey") DO NOTHING
  `;

  if (inserted === 1) {
    return { claimed: true, deliveryId, attemptCount: 1 };
  }

  const existing = await prisma.emailDelivery.findUnique({
    where: {
      emailBrand_eventKey: {
        emailBrand: input.emailBrand,
        eventKey: input.eventKey
      }
    }
  });
  if (!existing) throw new Error('Email delivery unique conflict occurred but record was not found.');

  return resolveExistingDeliveryClaim(existing);
}

export async function createPendingEmailDeliveryIntent(input: PendingEmailIntentInput) {
  if (!input.senderAccountKey) {
    throw new Error('senderAccountKey is required to create an email delivery intent.');
  }

  const existing = await prisma.emailDelivery.findUnique({
    where: {
      emailBrand_eventKey: {
        emailBrand: input.emailBrand,
        eventKey: input.eventKey
      }
    }
  });
  if (existing) {
    return {
      created: false as const,
      deliveryId: existing.id,
      status: existing.status,
      providerMessageId: existing.providerMessageId
    };
  }

  const deliveryId = randomUUID();
  const now = new Date();
  const inserted = await prisma.$executeRaw`
    INSERT INTO "EmailDelivery" (
      "id",
      "eventKey",
      "automationId",
      "emailBrand",
      "senderAccountKey",
      "demoSessionId",
      "emailType",
      "recipient",
      "payloadHash",
      "status",
      "attemptCount",
      "retryCount",
      "maxRetries",
      "subject",
      "textBody",
      "htmlBody",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${deliveryId},
      ${input.eventKey},
      ${input.automationId},
      ${input.emailBrand},
      ${input.senderAccountKey},
      ${input.demoSessionId || null},
      ${input.emailType},
      ${input.recipient.toLowerCase().trim()},
      ${input.payloadHash},
      ${EMAIL_DELIVERY_STATUS.PENDING},
      ${0},
      ${0},
      ${3},
      ${input.subject || null},
      ${input.text || null},
      ${input.html || null},
      ${now},
      ${now}
    )
    ON CONFLICT ("emailBrand", "eventKey") DO NOTHING
  `;

  if (inserted === 1) {
    return { created: true as const, deliveryId, status: EMAIL_DELIVERY_STATUS.PENDING, providerMessageId: null };
  }

  const raced = await prisma.emailDelivery.findUniqueOrThrow({
    where: {
      emailBrand_eventKey: {
        emailBrand: input.emailBrand,
        eventKey: input.eventKey
      }
    }
  });
  return {
    created: false as const,
    deliveryId: raced.id,
    status: raced.status,
    providerMessageId: raced.providerMessageId
  };
}

async function resolveExistingDeliveryClaim(existing: Awaited<ReturnType<typeof findEmailDeliveryByEventKey>>): Promise<EmailClaimResult> {
  if (!existing) throw new Error('Email delivery record was not found.');

  if (existing.status === EMAIL_DELIVERY_STATUS.SENT) {
    return {
      claimed: false,
      reason: 'ALREADY_SENT',
      deliveryId: existing.id,
      providerMessageId: existing.providerMessageId
    };
  }

  if (existing.status === EMAIL_DELIVERY_STATUS.PROCESSING) {
    const staleBefore = Date.now() - 15 * 60 * 1000;
    const lockedAt = existing.lockedAt?.getTime() || 0;
    if (lockedAt > staleBefore) {
      return { claimed: false, reason: 'ALREADY_PROCESSING', deliveryId: existing.id };
    }

    await prisma.emailDelivery.updateMany({
      where: { id: existing.id, status: EMAIL_DELIVERY_STATUS.PROCESSING },
      data: {
        status: EMAIL_DELIVERY_STATUS.UNKNOWN,
        lastError: 'Previous process stopped while email result was unknown.'
      }
    });

    return { claimed: false, reason: 'UNKNOWN_RESULT', deliveryId: existing.id };
  }

  if (existing.status === EMAIL_DELIVERY_STATUS.PENDING) {
    return { claimed: false, reason: 'ALREADY_PROCESSING', deliveryId: existing.id };
  }

  if (existing.status === EMAIL_DELIVERY_STATUS.UNKNOWN) {
    return { claimed: false, reason: 'UNKNOWN_RESULT', deliveryId: existing.id };
  }

  if (existing.status === EMAIL_DELIVERY_STATUS.FAILED) {
    return { claimed: false, reason: 'PERMANENT_FAILURE', deliveryId: existing.id };
  }

  if (existing.status === EMAIL_DELIVERY_STATUS.RETRY_PENDING) {
    const [retryMeta] = await prisma.$queryRaw<Array<{ nextRetryAt: Date | null }>>`
      SELECT "nextRetryAt" FROM "EmailDelivery" WHERE "id" = ${existing.id}
    `;
    if (retryMeta?.nextRetryAt && retryMeta.nextRetryAt.getTime() > Date.now()) {
      return { claimed: false, reason: 'RETRY_NOT_DUE', deliveryId: existing.id };
    }
  } else {
    return { claimed: false, reason: 'CLAIMED_BY_ANOTHER_PROCESS', deliveryId: existing.id };
  }

  const claimed = await prisma.emailDelivery.updateMany({
    where: { id: existing.id, status: EMAIL_DELIVERY_STATUS.RETRY_PENDING },
    data: {
      status: EMAIL_DELIVERY_STATUS.PROCESSING,
      attemptCount: { increment: 1 },
      lockedAt: new Date(),
      lockedBy: INSTANCE_ID,
      lastError: null
    }
  });

  if (claimed.count !== 1) {
    return { claimed: false, reason: 'CLAIMED_BY_ANOTHER_PROCESS', deliveryId: existing.id };
  }

  const refreshed = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: existing.id } });
  return { claimed: true, deliveryId: refreshed.id, attemptCount: refreshed.attemptCount };
}

export async function markEmailDeliverySent(input: { deliveryId: string; providerMessageId: string }) {
  const sent = await prisma.emailDelivery.update({
    where: { id: input.deliveryId },
    data: {
      status: EMAIL_DELIVERY_STATUS.SENT,
      providerMessageId: input.providerMessageId,
      sentAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null
    }
  });
  await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET "nextRetryAt" = NULL
    WHERE "id" = ${input.deliveryId}
  `;
  return sent;
}

export async function markUnknownEmailDeliveryManuallySent(input: {
  deliveryId: string;
  providerMessageId?: string;
}) {
  const now = new Date();
  const messageId = input.providerMessageId?.trim() || null;
  await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET
      "status" = ${EMAIL_DELIVERY_STATUS.SENT},
      "providerMessageId" = COALESCE(${messageId}, "providerMessageId"),
      "sentAt" = COALESCE("sentAt", ${now}),
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "lastError" = NULL,
      "nextRetryAt" = NULL,
      "updatedAt" = ${now}
    WHERE "id" = ${input.deliveryId}
      AND "status" = ${EMAIL_DELIVERY_STATUS.UNKNOWN}
  `;
  return findEmailDeliveryById(input.deliveryId);
}

export async function markUnknownEmailDeliveryManuallyFailed(input: {
  deliveryId: string;
  reason?: string;
}) {
  const now = new Date();
  const reason = (input.reason || 'Manually reviewed and marked failed.').slice(0, 2000);
  await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET
      "status" = ${EMAIL_DELIVERY_STATUS.FAILED},
      "lastError" = ${reason},
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "nextRetryAt" = NULL,
      "updatedAt" = ${now}
    WHERE "id" = ${input.deliveryId}
      AND "status" = ${EMAIL_DELIVERY_STATUS.UNKNOWN}
  `;
  return findEmailDeliveryById(input.deliveryId);
}

export async function markEmailSheetSynced(deliveryId: string) {
  return prisma.emailDelivery.update({
    where: { id: deliveryId },
    data: {
      sheetSyncedAt: new Date()
    }
  });
}

export async function markEmailSheetSyncSucceeded(deliveryId: string) {
  const synced = await prisma.emailDelivery.update({
    where: { id: deliveryId },
    data: {
      sheetSyncedAt: new Date()
    }
  });
  await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET
      "sheetSyncStatus" = 'SYNCED',
      "sheetSyncLastError" = NULL,
      "sheetSyncRetryAt" = NULL
    WHERE "id" = ${deliveryId}
  `;
  return synced;
}

export async function markEmailSheetSyncFailed(deliveryId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Google Sheet sync failed');
  await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET
      "sheetSyncStatus" = 'FAILED',
      "sheetSyncLastError" = ${message.slice(0, 2000)},
      "sheetSyncRetryAt" = ${new Date(Date.now() + 5 * 60 * 1000)}
    WHERE "id" = ${deliveryId}
  `;
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const value = record.response?.status ?? record.status ?? record.code;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function classifyEmailFailure(error: unknown): 'RETRY_PENDING' | 'FAILED' | 'UNKNOWN' {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error || '');

  if (status === 429 || (status && status >= 500)) return 'RETRY_PENDING';
  if (status === 400 || status === 401 || status === 403 || status === 404) return 'FAILED';
  if (/timeout|timed out|network|econnreset|econnrefused|etimedout|socket hang up/i.test(message)) {
    return 'RETRY_PENDING';
  }
  return 'UNKNOWN';
}

export async function reconcileOutcomeEmailMetadata(input: {
  deliveryId: string;
  demoSessionId?: string | null;
  emailType: string;
  error: unknown;
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error || 'Outcome email metadata reconciliation failed.');
  await prisma.emailDelivery.updateMany({
    where: {
      id: input.deliveryId,
      status: EMAIL_DELIVERY_STATUS.SENT
    },
    data: {
      lastError: `Metadata reconciliation failed after provider send: ${message.slice(0, 1900)}`
    }
  });
}

const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

function nextRetryDelayMs(nextRetryCount: number) {
  return RETRY_DELAYS_MS[Math.min(Math.max(nextRetryCount, 1), RETRY_DELAYS_MS.length) - 1];
}

export async function markEmailDeliveryFailed(input: { deliveryId: string; error: unknown }) {
  const classification = classifyEmailFailure(input.error);
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const current = await findEmailDeliveryById(input.deliveryId);
  if (current?.status === EMAIL_DELIVERY_STATUS.SENT) {
    await reconcileOutcomeEmailMetadata({
      deliveryId: input.deliveryId,
      demoSessionId: current.demoSessionId,
      emailType: current.emailType,
      error: input.error
    });
    return classification;
  }

  if (classification === 'RETRY_PENDING') {
    const [delivery] = await prisma.$queryRaw<Array<{ retryCount: number; maxRetries: number }>>`
      SELECT "retryCount", "maxRetries" FROM "EmailDelivery" WHERE "id" = ${input.deliveryId}
    `;
    const nextRetryCount = (delivery?.retryCount ?? 0) + 1;
    const maxRetries = delivery?.maxRetries ?? 3;

    if (nextRetryCount <= maxRetries) {
      const nextRetryAt = new Date(Date.now() + nextRetryDelayMs(nextRetryCount));
      await prisma.$executeRaw`
        UPDATE "EmailDelivery"
        SET
          "status" = ${EMAIL_DELIVERY_STATUS.RETRY_PENDING},
          "retryCount" = ${nextRetryCount},
          "nextRetryAt" = ${nextRetryAt},
          "lastError" = ${message.slice(0, 2000)},
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          "updatedAt" = ${new Date()}
        WHERE "id" = ${input.deliveryId}
      `;
      return classification;
    }
  }

  const status =
    classification === 'FAILED' || classification === 'RETRY_PENDING'
        ? EMAIL_DELIVERY_STATUS.FAILED
        : EMAIL_DELIVERY_STATUS.UNKNOWN;

  await prisma.emailDelivery.update({
    where: { id: input.deliveryId },
    data: {
      status,
      lastError: message.slice(0, 2000),
      lockedAt: null,
      lockedBy: null
    }
  });
  await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET "nextRetryAt" = NULL
    WHERE "id" = ${input.deliveryId}
  `;

  return classification;
}

export async function listDueEmailRetries(limit = 10) {
  return prisma.$queryRaw<
    Array<{
      id: string;
      eventKey: string;
      automationId: string;
      demoSessionId: string | null;
      emailBrand: EmailBrandKey;
      senderAccountKey: SenderAccountKey;
      emailType: string;
      recipient: string;
      payloadHash: string;
      subject: string | null;
      textBody: string | null;
      htmlBody: string | null;
      attemptCount: number;
      retryCount: number;
      maxRetries: number;
      nextRetryAt: Date | null;
    }>
  >`
    SELECT
      "id",
      "eventKey",
      "automationId",
      "demoSessionId",
      "emailBrand",
      "senderAccountKey",
      "emailType",
      "recipient",
      "payloadHash",
      "subject",
      "textBody",
      "htmlBody",
      "attemptCount",
      "retryCount",
      "maxRetries",
      "nextRetryAt"
    FROM "EmailDelivery"
    WHERE "status" = ${EMAIL_DELIVERY_STATUS.PENDING}
       OR (
        "status" = ${EMAIL_DELIVERY_STATUS.RETRY_PENDING}
        AND "nextRetryAt" IS NOT NULL
        AND "nextRetryAt" <= NOW()
      )
    ORDER BY COALESCE("nextRetryAt", "createdAt") ASC
    LIMIT ${limit}
  `;
}

export async function claimEmailRetryById(deliveryId: string) {
  const claimed = await prisma.emailDelivery.updateMany({
    where: { id: deliveryId, status: { in: [EMAIL_DELIVERY_STATUS.PENDING, EMAIL_DELIVERY_STATUS.RETRY_PENDING] } },
    data: {
      status: EMAIL_DELIVERY_STATUS.PROCESSING,
      attemptCount: { increment: 1 },
      lockedAt: new Date(),
      lockedBy: INSTANCE_ID,
      lastError: null,
      nextRetryAt: null
    }
  });

  return claimed.count === 1;
}

export async function claimUnknownEmailDeliveryForManualRetry(deliveryId: string) {
  const now = new Date();
  const claimed = await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET
      "status" = ${EMAIL_DELIVERY_STATUS.PROCESSING},
      "attemptCount" = "attemptCount" + 1,
      "lockedAt" = ${now},
      "lockedBy" = ${INSTANCE_ID},
      "lastError" = NULL,
      "nextRetryAt" = NULL,
      "updatedAt" = ${now}
    WHERE "id" = ${deliveryId}
      AND "status" = ${EMAIL_DELIVERY_STATUS.UNKNOWN}
  `;

  return claimed === 1;
}
