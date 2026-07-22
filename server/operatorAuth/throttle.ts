import type { Request } from 'express';
import { prisma } from '../db';
import { clientIpHash } from './session';
import { normalizeOperatorEmail, sha256 } from './crypto';

const FAILURE_LIMIT = Number(process.env.OPERATOR_LOGIN_FAILURE_LIMIT || 5);
const WINDOW_MS = Number(process.env.OPERATOR_LOGIN_WINDOW_MINUTES || 15) * 60 * 1000;
const BLOCK_MS = Number(process.env.OPERATOR_LOGIN_BLOCK_MINUTES || 15) * 60 * 1000;

export async function assertLoginAllowed(req: Request, email: unknown, now = new Date()) {
  const normalizedEmailHash = sha256(normalizeOperatorEmail(email));
  const ipHash = clientIpHash(req);
  const record = await prisma.operatorLoginThrottle.findUnique({
    where: { normalizedEmailHash_ipHash: { normalizedEmailHash, ipHash } }
  });
  if (record?.blockedUntil && record.blockedUntil > now) {
    const error = new Error('Too many login attempts. Try again later.');
    (error as any).statusCode = 429;
    throw error;
  }
}

export async function recordLoginFailure(req: Request, email: unknown, now = new Date()) {
  const normalizedEmailHash = sha256(normalizeOperatorEmail(email));
  const ipHash = clientIpHash(req);
  const existing = await prisma.operatorLoginThrottle.findUnique({
    where: { normalizedEmailHash_ipHash: { normalizedEmailHash, ipHash } }
  });
  const windowStartedAt =
    existing && now.getTime() - existing.windowStartedAt.getTime() <= WINDOW_MS
      ? existing.windowStartedAt
      : now;
  const failureCount =
    existing && now.getTime() - existing.windowStartedAt.getTime() <= WINDOW_MS
      ? existing.failureCount + 1
      : 1;
  const blockedUntil = failureCount >= FAILURE_LIMIT ? new Date(now.getTime() + BLOCK_MS) : null;

  await prisma.operatorLoginThrottle.upsert({
    where: { normalizedEmailHash_ipHash: { normalizedEmailHash, ipHash } },
    update: { failureCount, windowStartedAt, blockedUntil },
    create: { normalizedEmailHash, ipHash, failureCount, windowStartedAt, blockedUntil }
  });
}

export async function resetLoginThrottle(req: Request, email: unknown) {
  const normalizedEmailHash = sha256(normalizeOperatorEmail(email));
  const ipHash = clientIpHash(req);
  await prisma.operatorLoginThrottle.deleteMany({
    where: { normalizedEmailHash, ipHash }
  });
}
