import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

function safeCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export function requireMultiSourceAdmin(req: Request, res: Response, next: NextFunction) {
  const configuredToken = process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;
  if (!configuredToken) {
    return res.status(503).json({ error: 'Multi-source admin token is not configured.' });
  }

  const suppliedToken = req.header('x-multi-source-admin-token');
  if (!suppliedToken) {
    return res.status(401).json({ error: 'Multi-source admin token is required.' });
  }

  if (!safeCompare(suppliedToken, configuredToken)) {
    return res.status(403).json({ error: 'Multi-source admin token is incorrect.' });
  }

  return next();
}
