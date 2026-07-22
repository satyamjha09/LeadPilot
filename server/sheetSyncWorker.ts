import { findEmailDeliveryById, markEmailSheetSyncFailed, markEmailSheetSyncSucceeded } from './emailDelivery';
import { updateGoogleSheetRowsResilient } from './googleSheets';
import {
  claimSheetSyncJobForProcessing,
  listDueSheetSyncJobs,
  markSheetSyncJobFailed,
  markSheetSyncJobSucceeded
} from './sheetSyncQueue';
import { WORKFLOW_BUSY_RESET_MESSAGE, withWorkflowActivity } from './workflowActivity';
import { parseEmailBrand } from '../src/lib/emailBrand';
import { parseSenderAccountKey } from '../src/lib/senderAccount';

const SHEET_SYNC_SCAN_INTERVAL_MS = Number(process.env.SHEET_SYNC_SCAN_INTERVAL_MS || 60_000);
const SHEET_SYNC_BATCH_SIZE = Number(process.env.SHEET_SYNC_BATCH_SIZE || 10);

let sheetSyncRunning = false;
let sheetSyncTimer: NodeJS.Timeout | undefined;

export async function runSheetSyncScanner() {
  if (sheetSyncRunning) return;
  sheetSyncRunning = true;
  try {
    const jobs = await listDueSheetSyncJobs(SHEET_SYNC_BATCH_SIZE);
    for (const job of jobs) {
      let linkedDeliveryId: string | undefined;
      try {
        const workspaceKey = parseEmailBrand(job.workspaceKey);
        const emailBrand = parseEmailBrand(job.emailBrand);
        const googleAccountKey = parseSenderAccountKey(job.googleAccountKey);
        const claimed = await claimSheetSyncJobForProcessing(job.id);
        if (!claimed) continue;

        await withWorkflowActivity('sheet-sync', workspaceKey, async () => {
          if (job.emailDeliveryId) {
            const delivery = await findEmailDeliveryById(job.emailDeliveryId);
            if (!delivery) {
              throw new Error('Linked EmailDelivery was not found for this sheet sync job.');
            }
            if (parseEmailBrand(delivery.emailBrand) !== emailBrand) {
              throw new Error('Linked EmailDelivery brand does not match this sheet sync job.');
            }
            linkedDeliveryId = delivery.id;
          }

          const headers = JSON.parse(job.headersJson) as string[];
          const values = JSON.parse(job.valuesJson) as Record<string, any>;
          const [result] = await updateGoogleSheetRowsResilient(
            job.spreadsheetId,
            job.sheetName,
            headers,
            [{ rowNumber: job.rowNumber, values, emailDeliveryId: job.emailDeliveryId || undefined }],
            {},
            { workspaceKey, googleAccountKey }
          );

          if (!result?.success) {
            throw new Error(result?.error || 'Google Sheet row update failed');
          }

          await markSheetSyncJobSucceeded(job.id);
          if (linkedDeliveryId) {
            await markEmailSheetSyncSucceeded(linkedDeliveryId);
          }
        });
      } catch (error) {
        if (error instanceof Error && error.message === WORKFLOW_BUSY_RESET_MESSAGE) {
          continue;
        }
        await markSheetSyncJobFailed(job.id, error);
        if (linkedDeliveryId) {
          await markEmailSheetSyncFailed(linkedDeliveryId, error);
        }
      }
    }
  } catch (error) {
    console.error('SHEET_SYNC_RETRY_SCAN_FAILED', error);
  } finally {
    sheetSyncRunning = false;
  }
}

export function initSheetSyncRetryJob() {
  if (sheetSyncTimer) return;
  sheetSyncTimer = setInterval(runSheetSyncScanner, SHEET_SYNC_SCAN_INTERVAL_MS);
  sheetSyncTimer.unref?.();

  setTimeout(() => {
    runSheetSyncScanner().catch((error) => {
      console.error('SHEET_SYNC_INITIAL_SCAN_FAILED', error);
    });
  }, 7_500).unref?.();
}
