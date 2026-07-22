import { describe, expect, it } from 'vitest';
import { dashboardScopeMatches, type DashboardRequestScope } from './dashboardScope';

describe('dashboard request scope', () => {
  const scope: DashboardRequestScope = {
    workspaceKey: 'tallykonnect',
    emailBrand: 'tallykonnect',
    generation: 4
  };

  it('accepts a response only for the same workspace, email brand, and generation', () => {
    expect(dashboardScopeMatches(scope, {
      workspaceKey: 'tallykonnect',
      emailBrand: 'tallykonnect',
      generation: 4
    })).toBe(true);
  });

  it('rejects a late response after the business email brand changes', () => {
    expect(dashboardScopeMatches(scope, {
      workspaceKey: 'tallykonnect',
      emailBrand: 'anywheretally',
      generation: 4
    })).toBe(false);
  });

  it('rejects a late response after the source workspace changes', () => {
    expect(dashboardScopeMatches(scope, {
      workspaceKey: 'anywheretally',
      emailBrand: 'tallykonnect',
      generation: 4
    })).toBe(false);
  });

  it('rejects stale generations but does not let sender-account changes invalidate business history', () => {
    expect(dashboardScopeMatches(scope, {
      workspaceKey: 'tallykonnect',
      emailBrand: 'tallykonnect',
      generation: 5,
      senderAccountKey: 'tallykonnect-google'
    })).toBe(false);

    expect(dashboardScopeMatches(scope, {
      workspaceKey: 'tallykonnect',
      emailBrand: 'tallykonnect',
      generation: 4,
      senderAccountKey: 'anywheretally-google'
    })).toBe(true);
  });
});
