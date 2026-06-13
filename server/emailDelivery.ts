import { randomUUID } from 'node:crypto';
import { prisma } from './db';
import type { EmailType } from './emailIdentity';
import type { ExcelRow } from '../src/types';
import { getAutomationId, type EmailIdentityContext } from './emailIdentity';

export const EMAIL_DELIVERY_STATUS = {
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
  emailType: EmailType;
  recipient: string;
  payloadHash: string;
  subject?: string;
  text?: string;
  html?: string;
};

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

export async function findEmailDeliveryByEventKey(eventKey: string) {
  return prisma.emailDelivery.findUnique({ where: { eventKey } });
}

export async function listEmailDeliveriesForRow(row: ExcelRow, context: EmailIdentityContext) {
  try {
    const automationId = getAutomationId(row, context);
    return prisma.emailDelivery.findMany({
      where: { automationId },
      orderBy: { createdAt: 'desc' }
    });
  } catch {
    return [];
  }
}

export async function claimEmailDelivery(input: EmailClaimInput): Promise<EmailClaimResult> {
  const existingBeforeCreate = await prisma.emailDelivery.findUnique({
    where: { eventKey: input.eventKey }
  });
  if (existingBeforeCreate) {
    return resolveExistingDeliveryClaim(existingBeforeCreate);
  }

  const deliveryId = randomUUID();
  const now = new Date();
  const inserted = await prisma.$executeRaw`
    INSERT INTO "EmailDelivery" (
      "id",
      "eventKey",
      "automationId",
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
    ON CONFLICT ("eventKey") DO NOTHING
  `;

  if (inserted === 1) {
    return { claimed: true, deliveryId, attemptCount: 1 };
  }

  const existing = await prisma.emailDelivery.findUnique({ where: { eventKey: input.eventKey } });
  if (!existing) throw new Error('Email delivery unique conflict occurred but record was not found.');

  return resolveExistingDeliveryClaim(existing);
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

export async function markEmailSheetSynced(deliveryId: string) {
  return prisma.emailDelivery.update({
    where: { id: deliveryId },
    data: { sheetSyncedAt: new Date() }
  });
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

const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

function nextRetryDelayMs(nextRetryCount: number) {
  return RETRY_DELAYS_MS[Math.min(Math.max(nextRetryCount, 1), RETRY_DELAYS_MS.length) - 1];
}

export async function markEmailDeliveryFailed(input: { deliveryId: string; error: unknown }) {
  const classification = classifyEmailFailure(input.error);
  const message = input.error instanceof Error ? input.error.message : String(input.error);

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
    WHERE "status" = ${EMAIL_DELIVERY_STATUS.RETRY_PENDING}
      AND "nextRetryAt" IS NOT NULL
      AND "nextRetryAt" <= NOW()
    ORDER BY "nextRetryAt" ASC
    LIMIT ${limit}
  `;
}

export async function claimEmailRetryById(deliveryId: string) {
  const claimed = await prisma.emailDelivery.updateMany({
    where: { id: deliveryId, status: EMAIL_DELIVERY_STATUS.RETRY_PENDING },
    data: {
      status: EMAIL_DELIVERY_STATUS.PROCESSING,
      attemptCount: { increment: 1 },
      lockedAt: new Date(),
      lockedBy: INSTANCE_ID,
      lastError: null
    }
  });

  return claimed.count === 1;
}
