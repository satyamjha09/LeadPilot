import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, clearCsrfToken, getCsrfTokenForTests, setCsrfToken, setUnauthorizedHandler } from './authClient';

describe('authClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCsrfToken();
    setUnauthorizedHandler(null);
  });

  it('keeps CSRF in memory and attaches it only to mutations', async () => {
    setCsrfToken('csrf-123');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/example');
    await apiFetch('/api/example', { method: 'POST', headers: { 'Content-Type': 'application/json' } });

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(firstHeaders.get('x-csrf-token')).toBeNull();
    expect(secondHeaders.get('x-csrf-token')).toBe('csrf-123');
    expect(getCsrfTokenForTests()).toBe('csrf-123');
  });

  it('clears auth state through the unauthorized handler on 401', async () => {
    setCsrfToken('csrf-123');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 401 })));

    await apiFetch('/api/protected');

    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(getCsrfTokenForTests()).toBe('');
  });
});
