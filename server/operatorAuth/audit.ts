export function auditSecurityEvent(event: string, details: Record<string, unknown> = {}) {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (/password|token|secret|cookie|csrf|code|state/i.test(key)) continue;
    redacted[key] = value;
  }
  console.info('SECURITY_AUDIT', { event, ...redacted, at: new Date().toISOString() });
}
