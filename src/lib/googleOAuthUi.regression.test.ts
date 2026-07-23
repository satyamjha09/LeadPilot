import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const appSource = readFileSync(path.join(root, 'src', 'App.tsx'), 'utf-8');
const headerSource = readFileSync(path.join(root, 'src', 'components', 'layout', 'Header.tsx'), 'utf-8');

describe('Phase 14 Google OAuth UI hardening', () => {
  it('starts Google OAuth with CSRF-protected POST and a pre-OAuth expected-email confirmation', () => {
    expect(appSource).toContain('Connecting:\\n\\n${label} Google account');
    expect(appSource).toContain('Please select:\\n${expectedEmail}');
    expect(appSource).toContain('/connect');
    expect(appSource).toContain("method: 'POST'");
    expect(appSource).toContain('JSON.stringify({ mode })');
    expect(appSource).not.toContain("window.open(\n              `/api/google-senders/");
  });

  it('handles only controlled popup messages from the application origin', () => {
    expect(appSource).toContain("event.origin !== window.location.origin");
    expect(appSource).toContain("event.data?.type !== 'leadpilot-google-oauth'");
    expect(appSource).toContain('parseSenderAccountKey(event.data?.senderAccountKey)');
    expect(appSource).toContain('fetchAuthStatus(senderAccountKey)');
  });

  it('keeps account switching separate from OAuth and workflow side effects', () => {
    expect(headerSource).toContain('onSelectActiveAccount(account.key)');
    expect(headerSource).toContain('onConnectGoogle(account.senderAccountKey)');
    expect(headerSource).toContain('onVerifyGoogle(account.senderAccountKey)');
    expect(headerSource).toContain('onDisconnectGoogle(account.senderAccountKey)');
  });

  it('does not store OAuth tokens in browser storage or the DOM', () => {
    expect(appSource).not.toMatch(/localStorage\.setItem\([^)]*token/i);
    expect(appSource).not.toMatch(/sessionStorage\.setItem\([^)]*token/i);
    expect(headerSource).not.toMatch(/refresh[_-]?token|access[_-]?token|clientSecret/i);
  });
});
