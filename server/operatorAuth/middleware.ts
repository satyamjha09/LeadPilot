import type { NextFunction, Request, Response } from 'express';
import { attachOperatorContext, csrfMatches, resolveOperatorSession } from './session';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isPublicApi(req: Request) {
  const path = req.path;
  if (req.method === 'GET' && path === '/health') return true;
  if (req.method === 'POST' && path === '/operator/login') return true;
  if (req.method === 'GET' && (path === '/auth/callback/google' || path === '/auth/callback/google/')) return true;
  return false;
}

export async function requireOperatorSession(req: Request, res: Response, next: NextFunction) {
  try {
    const context = await resolveOperatorSession(req);
    if (!context) {
      return res.status(401).json({ error: 'Operator login required.', code: 'OPERATOR_AUTH_REQUIRED' });
    }
    attachOperatorContext(req, context);
    return next();
  } catch (error) {
    console.error('Operator session check failed:', error);
    return res.status(401).json({ error: 'Operator login required.', code: 'OPERATOR_AUTH_REQUIRED' });
  }
}

export function requireOperatorRole(role: 'ADMIN') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.operator) {
      return res.status(401).json({ error: 'Operator login required.', code: 'OPERATOR_AUTH_REQUIRED' });
    }
    if (req.operator.role !== role) {
      return res.status(403).json({ error: 'Operator is not authorized.', code: 'OPERATOR_FORBIDDEN' });
    }
    return next();
  };
}

export function requireOperatorCsrf(req: Request, res: Response, next: NextFunction) {
  if (!MUTATION_METHODS.has(req.method)) return next();
  if (!csrfMatches(req)) {
    return res.status(403).json({ error: 'Valid CSRF token required.', code: 'CSRF_REQUIRED' });
  }
  return next();
}

export async function operatorApiBoundary(req: Request, res: Response, next: NextFunction) {
  if (isPublicApi(req)) return next();
  return requireOperatorSession(req, res, (sessionError?: unknown) => {
    if (sessionError) return next(sessionError);
    return requireOperatorCsrf(req, res, next);
  });
}
