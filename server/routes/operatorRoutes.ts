import type { Express } from 'express';
import { prisma } from '../db';
import { hashOperatorPassword, normalizeOperatorEmail, verifyOperatorPassword } from '../operatorAuth/crypto';
import {
  cleanupOperatorAuth,
  clearSessionCookie,
  createOperatorSession,
  resolveOperatorSession,
  revokeCurrentSession,
  rotateSessionCsrf,
  safeOperator
} from '../operatorAuth/session';
import { requireOperatorCsrf, requireOperatorSession } from '../operatorAuth/middleware';
import { assertLoginAllowed, recordLoginFailure, resetLoginThrottle } from '../operatorAuth/throttle';
import { auditSecurityEvent } from '../operatorAuth/audit';

function invalidLogin(res: any) {
  return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_LOGIN' });
}

function isJsonLogin(req: any) {
  return String(req.get('content-type') || '').toLowerCase().includes('application/json');
}

export function registerOperatorRoutes(app: Express) {
  app.post('/api/operator/login', async (req, res) => {
    const email = normalizeOperatorEmail(req.body?.email);
    const password = String(req.body?.password || '');
    try {
      if (!isJsonLogin(req)) {
        return res.status(415).json({ error: 'Login requires JSON.', code: 'JSON_REQUIRED' });
      }
      await cleanupOperatorAuth().catch(() => undefined);
      await assertLoginAllowed(req, email);
      const operator = await prisma.operator.findUnique({ where: { normalizedEmail: email } });
      if (!operator || !operator.isActive || !verifyOperatorPassword(password, operator.passwordHash)) {
        await recordLoginFailure(req, email);
        auditSecurityEvent('operator.login.failed', { email });
        return invalidLogin(res);
      }

      await resetLoginThrottle(req, email);
      const { session, csrfToken } = await createOperatorSession(operator.id, req, res);
      await prisma.operator.update({
        where: { id: operator.id },
        data: { lastLoginAt: new Date() }
      });
      auditSecurityEvent('operator.login.success', { operatorId: operator.id, email: operator.email, sessionId: session.id });
      return res.json({
        authenticated: true,
        operator: safeOperator(operator),
        csrfToken
      });
    } catch (error: any) {
      if (error?.statusCode === 429) {
        return res.status(429).json({ error: 'Too many login attempts. Try again later.', code: 'LOGIN_RATE_LIMITED' });
      }
      console.error('Operator login failed:', error);
      return invalidLogin(res);
    }
  });

  app.get('/api/operator/session', async (req, res) => {
    const context = await resolveOperatorSession(req);
    if (!context) {
      return res.status(401).json({ authenticated: false, error: 'Operator login required.' });
    }
    const csrfToken = await rotateSessionCsrf(context.sessionId);
    return res.json({
      authenticated: true,
      operator: context.operator,
      csrfToken
    });
  });

  app.post('/api/operator/logout', requireOperatorSession, requireOperatorCsrf, async (req, res) => {
    await revokeCurrentSession(req);
    clearSessionCookie(res);
    auditSecurityEvent('operator.logout', { operatorId: req.operator?.id, sessionId: req.operatorSession?.id });
    return res.json({ success: true });
  });

  app.post('/api/operator/logout-all', requireOperatorSession, requireOperatorCsrf, async (req, res) => {
    await prisma.operatorSession.updateMany({
      where: { operatorId: req.operator!.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    clearSessionCookie(res);
    auditSecurityEvent('operator.logout_all', { operatorId: req.operator?.id });
    return res.json({ success: true });
  });
}

export async function createBootstrapOperatorFromEnv() {
  const email = normalizeOperatorEmail(process.env.OPERATOR_BOOTSTRAP_EMAIL);
  const password = String(process.env.OPERATOR_BOOTSTRAP_PASSWORD || '');
  const displayName = String(process.env.OPERATOR_BOOTSTRAP_DISPLAY_NAME || '').trim() || undefined;
  if (!email || !password) {
    throw new Error('OPERATOR_BOOTSTRAP_EMAIL and OPERATOR_BOOTSTRAP_PASSWORD are required.');
  }
  const existing = await prisma.operator.findUnique({ where: { normalizedEmail: email } });
  if (existing) {
    throw new Error('Operator already exists.');
  }
  const operator = await prisma.operator.create({
    data: {
      email,
      normalizedEmail: email,
      displayName,
      passwordHash: hashOperatorPassword(password),
      role: 'ADMIN'
    }
  });
  auditSecurityEvent('operator.bootstrap.created', { operatorId: operator.id, email: operator.email });
  return operator;
}
