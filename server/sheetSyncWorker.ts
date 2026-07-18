import { markEmailSheetSyncFailed, markEmailSheetSyncSucceeded } from './emailDelivery';
import { updateGoogleSheetRowsResilient } from './googleSheets';
import {
  listDueSheetSyncJobs,
  markSheetSyncJobFailed,
  markSheetSyncJobSucceeded
} from './sheetSyncQueue';
import { withWorkflowActivity } from './workflowActivity';

const SHEET_SYNC_SCAN_INTERVAL_MS = Number(process.env.SHEET_SYNC_SCAN_INTERVAL_MS || 60_000);
const SHEET_SYNC_BATCH_SIZE = Number(process.env.SHEET_SYNC_BATCH_SIZE || 10);

let sheetSyncRunning = false;
let sheetSyncTimer: NodeJS.Timeout | undefined;

async function runSheetSyncScanner() {
  if (sheetSyncRunning) return;
  sheetSyncRunning = true;
  try {
    await withWorkflowActivity('sheet-sync', async () => {
      const jobs = await listDueSheetSyncJobs(SHEET_SYNC_BATCH_SIZE);
      for (const job of jobs) {
        try {
          const headers = JSON.parse(job.headersJson) as string[];
          const values = JSON.parse(job.valuesJson) as Record<string, any>;
          const [result] = await updateGoogleSheetRowsResilient(
            job.spreadsheetId,
            job.sheetName,
            headers,
            [{ rowNumber: job.rowNumber, values, emailDeliveryId: job.emailDeliveryId || undefined }],
            {},
            job.emailBrand
          );

          if (!result?.success) {
            throw new Error(result?.error || 'Google Sheet row update failed');
          }

          await markSheetSyncJobSucceeded(job.id);
          if (job.emailDeliveryId) {
            await markEmailSheetSyncSucceeded(job.emailDeliveryId);
          }
        } catch (error) {
          await markSheetSyncJobFailed(job.id, error);
          if (job.emailDeliveryId) {
            await markEmailSheetSyncFailed(job.emailDeliveryId, error);
          }
        }
      }
    });
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
