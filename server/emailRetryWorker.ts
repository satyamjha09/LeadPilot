import {
  claimEmailRetryById,
  findEmailDeliveryById,
  listDueEmailRetries,
  markEmailDeliveryFailed,
  markEmailDeliverySent
} from './emailDelivery';
import { sendGmailTemplate } from './googleAuth';
import { parseEmailBrand } from '../src/lib/emailBrand';
import { parseSenderAccountKey } from '../src/lib/senderAccount';
import { WORKFLOW_BUSY_RESET_MESSAGE, withWorkflowActivity } from './workflowActivity';

const RETRY_SCAN_INTERVAL_MS = Number(process.env.EMAIL_RETRY_SCAN_INTERVAL_MS || 60_000);
const RETRY_BATCH_SIZE = Number(process.env.EMAIL_RETRY_BATCH_SIZE || 10);

let retryScannerRunning = false;
let retryTimer: NodeJS.Timeout | undefined;

export async function runEmailRetryScanner() {
  if (retryScannerRunning) {
    console.log('EMAIL_RETRY_SCAN_SKIPPED', {
      reason: 'Previous scan is still running'
    });
    return;
  }

  retryScannerRunning = true;
  try {
    const dueDeliveries = await listDueEmailRetries(RETRY_BATCH_SIZE);
    for (const delivery of dueDeliveries) {
      try {
        const emailBrand = parseEmailBrand(delivery.emailBrand);
        await withWorkflowActivity('email-retry', emailBrand, async () => {
          if (!delivery.subject || !delivery.textBody || !delivery.htmlBody) {
            await markEmailDeliveryFailed({
              deliveryId: delivery.id,
              error: new Error('Retry payload is missing; cannot resend email.')
            });
            return;
          }

          const claimed = await claimEmailRetryById(delivery.id);
          if (!claimed) return;

          const senderAccountKey = parseSenderAccountKey(delivery.senderAccountKey);
          console.log('EMAIL_RETRY_STARTED', {
            deliveryId: delivery.id,
            eventKey: delivery.eventKey,
            emailType: delivery.emailType,
            retryCount: delivery.retryCount,
            attemptCount: delivery.attemptCount + 1
          });

          const result = await sendGmailTemplate(delivery.recipient, {
            subject: delivery.subject,
            text: delivery.textBody,
            html: delivery.htmlBody
          }, senderAccountKey);

          const stillClaimed = await findEmailDeliveryById(delivery.id);
          if (!stillClaimed) return;

          await markEmailDeliverySent({
            deliveryId: delivery.id,
            providerMessageId: result.messageId
          });

          console.log('EMAIL_RETRY_SUCCESS', {
            deliveryId: delivery.id,
            eventKey: delivery.eventKey,
            messageId: result.messageId
          });
        });
      } catch (error) {
        if (error instanceof Error && error.message === WORKFLOW_BUSY_RESET_MESSAGE) {
          continue;
        }
        const classification = await markEmailDeliveryFailed({
          deliveryId: delivery.id,
          error
        });

        console.error('EMAIL_RETRY_FAILED', {
          deliveryId: delivery.id,
          eventKey: delivery.eventKey,
          classification,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } catch (error) {
    console.error('EMAIL_RETRY_SCAN_FAILED', error);
  } finally {
    retryScannerRunning = false;
  }
}

export function initEmailRetryJob() {
  if (retryTimer) return;
  retryTimer = setInterval(runEmailRetryScanner, RETRY_SCAN_INTERVAL_MS);
  retryTimer.unref?.();

  setTimeout(() => {
    runEmailRetryScanner().catch((error) => {
      console.error('EMAIL_RETRY_INITIAL_SCAN_FAILED', error);
    });
  }, 5_000).unref?.();
}
