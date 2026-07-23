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
    expect(source).toContain('candidateAutomationIds: candidates');
    expect(source).toContain('await lockCanonicalLeadIdentity(tx, input.workspaceId, input.leadId)');
    expect(source).toContain('const automationId = chooseUnambiguous([');
  });

  it('never reassigns an existing automation identity to another lead', () => {
    const source = readRepoFile('server', 'modules', 'lead', 'identity', 'permanentAutomationId.service.ts');

    expect(source).toContain('existingIdentityForValue && existingIdentityForValue.leadId !== input.leadId');
    expect(source).toContain('automation_id is already assigned to another lead');
    expect(source).not.toContain('leadId: input.leadId,\n        source: \'AUTO\'');
  });

  it('enforces one permanent automation id per canonical lead', () => {
    const migration = readRepoFile('prisma', 'migrations', '20260723173500_harden_demo_lifecycle_concurrency', 'migration.sql');
    const source = readRepoFile('server', 'modules', 'lead', 'identity', 'permanentAutomationId.service.ts');

    expect(migration).toContain('LeadIdentity_one_automation_id_per_lead_key');
    expect(migration).toContain('WHERE "type" = \'AUTOMATION_ID\'');
    expect(migration).toContain('AND "scopeKey" = \'workspace\'');
    expect(source).toContain('isolationLevel: Prisma.TransactionIsolationLevel.Serializable');
  });

  it('commits demo outcome and pending email intent inside one transaction', () => {
    const source = readRepoFile('server', 'scheduleDb.ts');
    const start = source.indexOf('export async function commitDemoOutcomeAndEmailIntent');
    const end = source.indexOf('export function getSheetRowKey', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    expect(body).toContain('return prisma.$transaction(async (tx) => {');
    expect(body).toContain('await lockWorkflowSubject(tx, emailBrand, userId)');
    expect(body).toContain('assertHistoryMeetingStarted(history, state)');
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
    expect(source).toContain('h."sessionId" = c."activeDemoSessionId"');
    expect(source).toContain('legacyScheduleSessionIdsBackfilled');
  });

  it('migrates legacy email-keyed active states conservatively', () => {
    const migration = readRepoFile('prisma', 'migrations', '20260723173500_harden_demo_lifecycle_concurrency', 'migration.sql');
    const script = readRepoFile('scripts', 'backfill-demo-lifecycle-integrity.ts');
    const source = readRepoFile('server', 'scheduleDb.ts');

    expect(migration).toContain('unambiguous_email_automation');
    expect(migration).toContain('UPDATE "CustomerDemoState" c');
    expect(migration).toContain('LOWER(c."userId") = LOWER(c."email")');
    expect(script).toContain('legacyEmailStatesAdopted');
    expect(source).toContain('adoptLegacyCustomerDemoStateForRow(row, emailBrand)');
  });

  it('reserves demo scheduling before external Calendar creation', () => {
    const workflow = readRepoFile('server', 'leadWorkflow.ts');
    const scheduleDb = readRepoFile('server', 'scheduleDb.ts');
    const start = workflow.indexOf('const reservation = await reserveDemoScheduling(row');
    const calendarCall = workflow.indexOf('const scheduleResult = await scheduleMeeting(', start);
    const finalize = workflow.indexOf('await ensureScheduledDemoHistory(', calendarCall);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(calendarCall).toBeGreaterThan(start);
    expect(finalize).toBeGreaterThan(calendarCall);
    expect(workflow).toContain('await cancelCalendarMeeting(createdCalendarEventId, senderAccountKeyForContext(sheetContext))');
    expect(workflow).toContain('await clearDemoSchedulingReservation(');
    expect(scheduleDb).toContain('SCHEDULING_RESERVED_STATUS');
    expect(scheduleDb).toContain('Demo scheduling is already in progress for this customer.');
  });

  it('keeps terminal rows final after post-commit side-effect failures', () => {
    const workflow = readRepoFile('server', 'leadWorkflow.ts');

    expect(workflow).toContain('TERMINAL_OUTCOME_EMAIL_POST_COMMIT_FAILED');
    expect(workflow).toContain('terminalPostCommitErrorMessage(LEAD_STATUS.DEMO_DONE, error)');
    expect(workflow).toContain('terminalPostCommitErrorMessage(LEAD_STATUS.NO_RESPONSE, error)');
    expect(workflow).toContain('TERMINAL_OUTCOME_SHEET_SYNC_POST_COMMIT_FAILED');
    expect(workflow).toContain("'Meeting Details': ''");
  });
});
