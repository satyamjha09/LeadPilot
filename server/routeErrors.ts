import type { Response } from 'express';

type RouteError = Error & {
  code?: string;
  statusCode?: number;
  requiredBrand?: string;
  selectedBrand?: string;
  brands?: string[];
  expectedEmail?: string;
  connectedEmail?: string;
};

export function sendRouteError(res: Response, error: unknown, fallbackMessage = 'Request failed') {
  const routeError = error as RouteError;
  const statusCode = routeError?.statusCode || 500;
  const message = routeError?.message || fallbackMessage;

  return res.status(statusCode).json({
    ...(routeError?.code ? { code: routeError.code } : {}),
    ...(routeError?.requiredBrand ? { requiredBrand: routeError.requiredBrand } : {}),
    ...(routeError?.selectedBrand ? { selectedBrand: routeError.selectedBrand } : {}),
    ...(routeError?.brands ? { brands: routeError.brands } : {}),
    ...(routeError?.expectedEmail ? { expectedEmail: routeError.expectedEmail } : {}),
    ...(routeError?.connectedEmail ? { connectedEmail: routeError.connectedEmail } : {}),
    error: message
  });
}
