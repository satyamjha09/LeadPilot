import type { Response } from 'express';

type RouteError = Error & {
  code?: string;
  statusCode?: number;
};

export function sendRouteError(res: Response, error: unknown, fallbackMessage = 'Request failed') {
  const routeError = error as RouteError;
  const statusCode = routeError?.statusCode || 500;
  const message = routeError?.message || fallbackMessage;

  return res.status(statusCode).json({
    ...(routeError?.code ? { code: routeError.code } : {}),
    error: message
  });
}
