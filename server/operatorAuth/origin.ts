import type { NextFunction, Request, Response } from 'express';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function configuredOrigin() {
  return String(process.env.APP_ORIGIN || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function enforceMutationOrigin(req: Request, res: Response, next: NextFunction) {
  if (!MUTATION_METHODS.has(req.method)) return next();
  const expected = configuredOrigin();
  const origin = req.get('origin');
  if (origin && origin.replace(/\/+$/, '') !== expected) {
    return res.status(403).json({ error: 'Cross-origin request rejected.', code: 'ORIGIN_REJECTED' });
  }
  return next();
}
