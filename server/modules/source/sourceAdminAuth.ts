import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SourceConfigurationError, SourceForbiddenError, SourceUnauthorizedError, toSourceHttpError } from './sourceErrors';

function safeCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export function requireMultiSourceAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.operator?.role === 'ADMIN') {
      return next();
    }

    if (process.env.ALLOW_LEGACY_ADMIN_TOKENS !== 'true') {
      throw new SourceUnauthorizedError();
    }

    const configuredToken = process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;
    if (!configuredToken) {
      throw new SourceConfigurationError('Multi-source admin token is not configured.');
    }

    const suppliedToken = req.header('x-multi-source-admin-token');
    if (!suppliedToken) {
      throw new SourceUnauthorizedError();
    }

    if (!safeCompare(suppliedToken, configuredToken)) {
      throw new SourceForbiddenError();
    }

    return next();
  } catch (error) {
    const httpError = toSourceHttpError(error);
    return res.status(httpError.statusCode).json({ error: httpError.message, code: httpError.code });
  }
}
