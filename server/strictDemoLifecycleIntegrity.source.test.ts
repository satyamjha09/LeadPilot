import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readRepoFile(...segments: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf-8');
}

describe('strict demo lifecycle integrity source guards', () => {
  it('collects all automation identity candidates before selecting one', () => {
    const source = readRepoFile('server', 'modules', 'lead', 'identity', 'permanentAutomationId.service.ts');

    expect(source).toContain('const candidates = [');
    expect(source).toContain('existing,');
    expect(source).toContain('sourceAutomationId,');
    expect(source).toContain('...(await automationIdFromCanonicalLead(lead.id))');
    expect(source).toContain('...(await automationIdFromSiblingRows(lead.id))');
    expect(source).toContain('...(await legacyAutomationIdByBrandEmail(input.emailBrand, email))');
    expect(source).toContain('const resolved = chooseUnambiguous(candidates) || createNewAutomationId();');
  });

  it('never reassigns an existing automation identity to another lead', () => {
    const source = readRepoFile('server', 'modules', 'lead', 'identity', 'permanentAutomationId.service.ts');

    expect(source).toContain('existingIdentity && existingIdentity.leadId !== input.leadId');
    expect(source).toContain('automation_id is already assigned to another lead');
    expect(source).not.toContain('leadId: input.leadId,\n        source: \'AUTO\'');
  });

  it('commits demo outcome and pending email intent inside one transaction', () => {
    const source = readRepoFile('server', 'scheduleDb.ts');
    const start = source.indexOf('export async function commitDemoOutcomeAndEmailIntent');
    const end = source.indexOf('export function getSheetRowKey', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    expect(body).toContain('return prisma.$transaction(async (tx) => {');
    expect(body).toContain('await tx.demoHistory.update({');
    expect(body).toContain('await tx.customerDemoState.update({');
    expect(body).toContain('await writeSessionLeadSchedule(tx, {');
    expect(body).toContain('await tx.emailDelivery.findUnique({');
    expect(body).toContain('await tx.emailDelivery.create({');
  });

  it('backfills legacy schedule demoSessionId mappings before dropping old uniqueness', () => {
    const migration = readRepoFile('prisma', 'migrations', '20260723141000_strict_demo_lifecycle_integrity', 'migration.sql');

    expect(migration.indexOf('Backfill existing schedules to session identity')).toBeLessThan(
      migration.indexOf('DROP INDEX IF EXISTS "LeadSchedule_emailBrand_automationId_dateOfDemo_timeOfDemo_key"')
    );
    expect(migration).toContain('sc."sessionCount" = 1');
    expect(migration).toContain('hc."scheduleCount" = 1');
    expect(migration).toContain('SET "demoSessionId" = u."sessionId"');
  });

  it('audit script reports actual counts separately from samples', () => {
    const source = readRepoFile('scripts', 'backfill-demo-lifecycle-integrity.ts');

    expect(source).toContain('count: total');
    expect(source).toContain('samples');
    expect(source).toContain('DEMO_HISTORY_WITHOUT_SESSION_SCHEDULE');
    expect(source).toContain('ACTIVE_STATE_WITHOUT_SESSION_SCHEDULE');
    expect(source).toContain('legacyScheduleSessionIdsBackfilled');
  });
});
