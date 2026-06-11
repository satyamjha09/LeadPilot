import assert from 'node:assert/strict';
import { prisma } from '../server/db';
import {
  claimEmailDelivery,
  classifyEmailFailure,
  markEmailDeliveryFailed,
  markEmailDeliverySent
} from '../server/emailDelivery';
import {
  createEmailEventKey,
  createEmailPayloadHash,
  EMAIL_TYPES
} from '../server/emailIdentity';
import fs from 'node:fs';
import path from 'node:path';

const automationId = `smoke_${Date.now()}`;
const recipient = 'smoke@example.com';
const payloadHash = createEmailPayloadHash({
  recipient,
  subject: 'Smoke',
  text: 'Smoke text',
  html: '<p>Smoke</p>'
});

function eventKey(emailType: typeof EMAIL_TYPES[keyof typeof EMAIL_TYPES], date = '2026-06-21', time = '10:45') {
  return createEmailEventKey({
    automationId,
    recipient,
    emailType,
    date,
    time,
    reminderWindow: emailType === EMAIL_TYPES.REMINDER ? '30_MINUTES' : undefined
  });
}

async function main() {
  try {
    const scheduledKey = eventKey(EMAIL_TYPES.DEMO_SCHEDULED);
    const changedTimeKey = eventKey(EMAIL_TYPES.DEMO_SCHEDULED, '2026-06-21', '11:45');
    const doneKey = createEmailEventKey({ automationId, recipient, emailType: EMAIL_TYPES.DEMO_DONE });
    const reminderKey = eventKey(EMAIL_TYPES.REMINDER);

    assert.notEqual(scheduledKey, changedTimeKey, 'changed scheduled time creates a new key');
    assert.notEqual(scheduledKey, doneKey, 'scheduled and thank-you keys differ');
    assert.notEqual(scheduledKey, reminderKey, 'scheduled and reminder keys differ');

    const [firstClaim, secondClaim] = await Promise.all([
      claimEmailDelivery({
        eventKey: scheduledKey,
        automationId,
        emailType: EMAIL_TYPES.DEMO_SCHEDULED,
        recipient,
        payloadHash
      }),
      claimEmailDelivery({
        eventKey: scheduledKey,
        automationId,
        emailType: EMAIL_TYPES.DEMO_SCHEDULED,
        recipient,
        payloadHash
      })
    ]);

    const claimedCount = [firstClaim, secondClaim].filter((claim) => claim.claimed).length;
    assert.equal(claimedCount, 1, 'only one concurrent claim succeeds');

    const claimed = firstClaim.claimed ? firstClaim : secondClaim;
    assert.equal(claimed.claimed, true);
    await markEmailDeliverySent({
      deliveryId: claimed.deliveryId,
      providerMessageId: 'gmail-smoke-message'
    });

    const sentClaim = await claimEmailDelivery({
      eventKey: scheduledKey,
      automationId,
      emailType: EMAIL_TYPES.DEMO_SCHEDULED,
      recipient,
      payloadHash
    });
    assert.equal(sentClaim.claimed, false);
    assert.equal(sentClaim.reason, 'ALREADY_SENT');

    assert.equal(classifyEmailFailure({ code: 403 }), 'FAILED');
    assert.equal(classifyEmailFailure({ code: 429 }), 'RETRY_PENDING');
    assert.equal(classifyEmailFailure(new Error('socket ended')), 'UNKNOWN');

    const retryKey = changedTimeKey;
    const retryClaim = await claimEmailDelivery({
      eventKey: retryKey,
      automationId,
      emailType: EMAIL_TYPES.DEMO_SCHEDULED,
      recipient,
      payloadHash
    });
    assert.equal(retryClaim.claimed, true);
    await markEmailDeliveryFailed({
      deliveryId: retryClaim.deliveryId,
      error: { code: 429, message: 'rate limited' }
    });
    const retryRecord = await prisma.emailDelivery.findUniqueOrThrow({ where: { eventKey: retryKey } });
    assert.equal(retryRecord.status, 'RETRY_PENDING');

    const authSource = fs.readFileSync(path.join(process.cwd(), 'server', 'googleAuth.ts'), 'utf-8');
    assert.equal(authSource.includes('getProfile'), false, 'Gmail senders do not call users.getProfile');

    console.log('Idempotency smoke tests passed.');
  } finally {
    await prisma.emailDelivery.deleteMany({ where: { automationId } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
