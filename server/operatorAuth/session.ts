import type { Request, Response } from 'express';
import { prisma } from '../db';
import { newSecretToken, normalizeOperatorEmail, sha256, timingSafeHashCompare } from './crypto';

export type SafeOperator = {
  id: string;
  email: string;
  displayName: string | null;
  role: 'ADMIN';
};

export type OperatorRequestContext = {
  operator: SafeOperator;
  sessionId: string;
  csrfHash: string;
};

declare global {
  namespace Express {
    interface Request {
      operator?: SafeOperator;
      operatorSession?: {
        id: string;
        csrfHash: string;
      };
    }
  }
}

const DEFAULT_COOKIE_NAME = 'leadpilot_session';

export function getSessionCookieName() {
  return String(process.env.OPERATOR_COOKIE_NAME || DEFAULT_COOKIE_NAME).trim() || DEFAULT_COOKIE_NAME;
}

export function getSessionTtlMs() {
  return Math.max(1, Number(process.env.OPERATOR_SESSION_TTL_HOURS || 12)) * 60 * 60 * 1000;
}

export function getIdleTtlMs() {
  return Math.max(5, Number(process.env.OPERATOR_IDLE_TTL_MINUTES || 120)) * 60 * 1000;
}

function cookieSecure() {
  return process.env.NODE_ENV === 'production' || process.env.OPERATOR_COOKIE_SECURE === 'true';
}

function serializeCookie(name: string, value: string, options: { maxAgeSeconds?: number; expires?: Date } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (cookieSecure()) parts.push('Secure');
  if (typeof options.maxAgeSeconds === 'number') parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join('; ');
}

export function setSessionCookie(res: Response, token: string) {
  res.setHeader('Set-Cookie', serializeCookie(getSessionCookieName(), token, {
    maxAgeSeconds: Math.floor(getSessionTtlMs() / 1000)
  }));
}

export function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', serializeCookie(getSessionCookieName(), '', {
    maxAgeSeconds: 0,
    expires: new Date(0)
  }));
}

export function readCookie(req: Request, name: string) {
  const raw = String(req.headers.cookie || '');
  return raw
    .split(';')
    .map((part) => part.trim())
    .map((part) => {
      const separatorIndex = part.indexOf('=');
      return separatorIndex === -1
        ? [part, '']
        : [part.slice(0, separatorIndex), decodeURIComponent(part.slice(separatorIndex + 1))];
    })
    .find(([key]) => key === name)?.[1] || '';
}

export function clientIpHash(req: Request) {
  return sha256(String(req.ip || req.socket.remoteAddress || 'unknown'));
}

export function userAgentHash(req: Request) {
  return sha256(String(req.get('user-agent') || 'unknown'));
}

export function safeOperator(operator: any): SafeOperator {
  return {
    id: operator.id,
    email: operator.email,
    displayName: operator.displayName || null,
    role: operator.role
  };
}

export async function createOperatorSession(operatorId: string, req: Request, res: Response) {
  const sessionToken = newSecretToken(32);
  const csrfToken = newSecretToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getSessionTtlMs());
  const idleExpiresAt = new Date(now.getTime() + getIdleTtlMs());
  const session = await prisma.operatorSession.create({
    data: {
      operatorId,
      tokenHash: sha256(sessionToken),
      csrfHash: sha256(csrfToken),
      expiresAt,
      idleExpiresAt,
      ipHash: clientIpHash(req),
      userAgentHash: userAgentHash(req)
    },
    include: { operator: true }
  });
  setSessionCookie(res, sessionToken);
  return { session, csrfToken };
}

export async function rotateSessionCsrf(sessionId: string) {
  const csrfToken = newSecretToken(32);
  await prisma.operatorSession.update({
    where: { id: sessionId },
    data: { csrfHash: sha256(csrfToken) }
  });
  return csrfToken;
}

export async function resolveOperatorSession(req: Request): Promise<OperatorRequestContext | null> {
  const token = readCookie(req, getSessionCookieName());
  if (!token) return null;

  const now = new Date();
  const session = await prisma.operatorSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { operator: true }
  });
  if (!session || session.revokedAt || session.expiresAt <= now || (session.idleExpiresAt && session.idleExpiresAt <= now)) {
    return null;
  }
  if (!session.operator?.isActive) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.operatorSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + getIdleTtlMs())
      }
    }).catch(() => undefined);
  }

  return {
    operator: safeOperator(session.operator),
    sessionId: session.id,
    csrfHash: session.csrfHash
  };
}

export function attachOperatorContext(req: Request, context: OperatorRequestContext) {
  req.operator = context.operator;
  req.operatorSession = {
    id: context.sessionId,
    csrfHash: context.csrfHash
  };
}

export function csrfMatches(req: Request) {
  const supplied = String(req.get('x-csrf-token') || '');
  const expectedHash = req.operatorSession?.csrfHash || '';
  return !!supplied && !!expectedHash && timingSafeHashCompare(supplied, expectedHash);
}

export async function revokeCurrentSession(req: Request) {
  const token = readCookie(req, getSessionCookieName());
  if (!token) return;
  await prisma.operatorSession.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export async function cleanupOperatorAuth(now = new Date()) {
  const revokedBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  await prisma.operatorSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { idleExpiresAt: { lt: now } },
        { revokedAt: { lt: revokedBefore } }
      ]
    }
  });
  await prisma.operatorLoginThrottle.deleteMany({
    where: {
      updatedAt: { lt: revokedBefore },
      OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }]
    }
  });
}

export function normalizeLoginEmail(email: unknown) {
  return normalizeOperatorEmail(email);
}
