export type OperatorSessionOperator = {
  id: string;
  email: string;
  displayName?: string | null;
  role: 'ADMIN';
};

export type OperatorSessionResponse = {
  authenticated: boolean;
  operator?: OperatorSessionOperator;
  csrfToken?: string;
  error?: string;
};

let csrfToken = '';
let unauthorizedHandler: (() => void) | null = null;

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function setCsrfToken(token?: string) {
  csrfToken = token || '';
}

export function clearCsrfToken() {
  csrfToken = '';
}

export function getCsrfTokenForTests() {
  return csrfToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || undefined);
  if (MUTATION_METHODS.has(method) && csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers
  });
  if (response.status === 401) {
    clearCsrfToken();
    unauthorizedHandler?.();
  }
  return response;
}

export async function readJsonOrThrow<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || data?.message || fallback);
  }
  return data as T;
}
