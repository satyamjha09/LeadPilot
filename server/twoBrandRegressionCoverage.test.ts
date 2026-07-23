import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readRepoFile(...segments: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf-8');
}

describe('two-brand workflow regression coverage', () => {
  it('keeps primary workflow Google calls tied to selected or persisted sender account', () => {
    const leadWorkflow = readRepoFile('server', 'leadWorkflow.ts');

    expect(leadWorkflow).toContain('scheduleMeeting(');
    expect(leadWorkflow).toContain('senderAccountKeyForContext(sheetContext)');
    expect(leadWorkflow).toContain('emailBrandKeyForContext(sheetContext)');
    expect(leadWorkflow).toContain('updateCalendarMeeting(');
    expect(leadWorkflow).toContain('contextForOwnerBrand(');
    expect(leadWorkflow).toContain('active.senderAccountKey');
    expect(leadWorkflow).toContain('assertDemoLifecycleOwnership(row, context.emailBrand, senderAccountKeyForContext(context))');
    expect(leadWorkflow).toContain('sendGmailRescheduleInvite(updatedRow, meetLink');
    expect(leadWorkflow).toContain('senderAccountKeyForContext(ownerContext)');
    expect(leadWorkflow).toContain('sendThankYouEmail({');
    expect(leadWorkflow).toContain('sendNoResponseEmail({');
    expect(leadWorkflow).toContain('updateGoogleSheetRowsResilient(');
    expect(leadWorkflow).toContain('googleSheetAccessForContext(context)');
    expect(leadWorkflow).toContain('enqueueSheetSyncJob({');
    expect(leadWorkflow).toContain('workspaceKey: context.workspaceKey');
    expect(leadWorkflow).toContain('emailBrand: context.emailBrand');
    expect(leadWorkflow).toContain('googleAccountKey: context.googleAccountKey');
  });

  it('keeps reminders and retry workers tied to persisted sender owners', () => {
    const reminders = readRepoFile('server', 'reminders.ts');
    const emailRetryWorker = readRepoFile('server', 'emailRetryWorker.ts');
    const sheetSyncWorker = readRepoFile('server', 'sheetSyncWorker.ts');

    expect(reminders).toContain('const emailBrand = coerceStoredEmailBrand(history.emailBrand)');
    expect(reminders).toContain('history.senderAccountKey');
    expect(reminders).toContain('sendGmailReminder(');
    expect(reminders).toContain('history.emailBrand');
    expect(emailRetryWorker).toContain('delivery.senderAccountKey');
    expect(emailRetryWorker).toContain('sendGmailTemplate(');
    expect(sheetSyncWorker).toContain('job.googleAccountKey');
    expect(sheetSyncWorker).toContain('claimSheetSyncJobForProcessing(job.id)');
    expect(sheetSyncWorker).toContain('updateGoogleSheetRowsResilient(');
  });

  it('keeps idempotency, sheet retry, and reset database constraints brand-scoped', () => {
    const schema = readRepoFile('prisma', 'schema.prisma');
    const emailDelivery = readRepoFile('server', 'emailDelivery.ts');
    const sheetSyncQueue = readRepoFile('server', 'sheetSyncQueue.ts');
    const adminDb = readRepoFile('server', 'adminDb.ts');
    const workflowControl = readRepoFile('server', 'workflowControl.ts');
    const processLeadQueue = readRepoFile('server', 'processLeadQueue.ts');

    expect(schema).toContain('@@unique([emailBrand, automationId, dateOfDemo, timeOfDemo])');
    expect(schema).toContain('@@unique([emailBrand, userId])');
    expect(schema).toContain('@@unique([emailBrand, eventKey])');
    expect(schema).toContain('@@unique([workspaceKey, emailBrand, jobKey])');
    expect(schema).toContain('@@unique([emailBrand, sheetRowKey])');
    expect(emailDelivery).toContain('emailBrand_eventKey');
    expect(emailDelivery).toContain('ON CONFLICT ("emailBrand", "eventKey") DO NOTHING');
    expect(sheetSyncQueue).toContain('ON CONFLICT ("workspaceKey", "emailBrand", "jobKey") DO UPDATE SET');
    expect(adminDb).toContain('resetDemoTestData(emailBrand');
    expect(adminDb).toContain('where: { emailBrand }');
    expect(workflowControl).toContain('getWorkflowControl(emailBrand');
    expect(processLeadQueue).toContain('{ jobId, generation, emailBrand }');
  });

  it('keeps OAuth account verification and invalid token cleanup brand-specific', () => {
    const googleAuth = readRepoFile('server', 'googleAuth.ts');
    const authRoutes = readRepoFile('server', 'routes', 'authRoutes.ts');
    const app = readRepoFile('src', 'App.tsx');
    const schema = readRepoFile('prisma', 'schema.prisma');

    expect(schema).toMatch(/senderAccountKey\s+String\s+@unique/);
    expect(googleAuth).toContain('https://www.googleapis.com/auth/userinfo.email');
    expect(googleAuth).toContain('getAuthenticatedGoogleEmail(oauth2Client)');
    expect(googleAuth).toContain('new GoogleAccountMismatchError(normalizedSender, expectedEmail, connectedEmail)');
    expect(googleAuth).toContain('where: { senderAccountKey: normalizedSender }');
    expect(googleAuth).toContain('clearSenderCredentials(normalizedSender)');
    expect(googleAuth).toContain('createGoogleOAuthState(senderAccountKey)');
    expect(authRoutes).toContain("'/api/google-senders/:senderAccountKey/status'");
    expect(authRoutes).toContain('exchangeCodeAndSaveFromState');
    expect(authRoutes).toContain('process.env.APP_ORIGIN');
    expect(authRoutes).toContain('GOOGLE_OAUTH_MESSAGE_TYPE');
    expect(app).toContain('event.origin !== window.location.origin');
    expect(app).toContain('parseSenderAccountKey(event.data?.senderAccountKey)');
  });
});
