import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');

function modelBlock(modelName: string) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Model not found: ${modelName}`);
  return match[0];
}

describe('multi-source Phase 1 Prisma foundation', () => {
  it('keeps existing production workflow models present', () => {
    [
      'LeadSchedule',
      'CustomerDemoState',
      'DemoHistory',
      'EmailLog',
      'SheetLeadState',
      'EmailDelivery',
      'SheetSyncJob',
      'GoogleAuth',
      'WorkflowControl',
      'ProcessLeadJob'
    ].forEach((model) => {
      expect(schema).toContain(`model ${model} {`);
    });
  });

  it('defines the requested multi-source enums', () => {
    [
      'WorkspaceStatus',
      'DataSourceType',
      'DataSourceConnectionStatus',
      'SourceSnapshotStatus',
      'SourceRowValidationStatus',
      'LeadIdentityType'
    ].forEach((enumName) => {
      expect(schema).toContain(`enum ${enumName} {`);
    });
  });

  it('scopes DataSource uniqueness to one workspace', () => {
    const block = modelBlock('DataSource');
    expect(block).toContain('@@unique([workspaceId, type, externalFileId])');
    expect(block).toContain('@@unique([workspaceId, type, checksum])');
    expect(block).toContain('@@index([workspaceId, type])');
    expect(block).toContain('@@index([workspaceId, connectionStatus])');
  });

  it('scopes tab external IDs to one DataSource', () => {
    const block = modelBlock('DataSourceTab');
    expect(block).toContain('@@unique([dataSourceId, externalTabId])');
    expect(block).toContain('@@index([dataSourceId, isEnabled])');
  });

  it('scopes source row external IDs to one tab', () => {
    const block = modelBlock('SourceRow');
    expect(block).toContain('@@unique([sourceTabId, externalRowId])');
    expect(block).toContain('@@index([sourceTabId, rowNumber])');
    expect(block).toContain('@@index([validationStatus])');
  });

  it('scopes canonical lead email uniqueness to one workspace', () => {
    const block = modelBlock('Lead');
    expect(block).toContain('@@unique([workspaceId, normalizedEmail])');
    expect(block).toContain('@@index([normalizedEmail])');
  });

  it('scopes lead identities to one workspace and identity type', () => {
    const block = modelBlock('LeadIdentity');
    expect(block).toContain('@@unique([workspaceId, type, scopeKey, value])');
    expect(block).toContain('@@index([leadId])');
    expect(block).toContain('@@index([leadId, type])');
    expect(block).toContain('@@index([workspaceId, type])');
  });
});
