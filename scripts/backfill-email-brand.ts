import 'dotenv/config';
import { prisma } from '../server/db';

const AWT_EVIDENCE_RE = /AnyWhereTally|Tally Mobile App|anywheretally\.com|info@anywheretally\.com/i;
const TALLYKONNECT_EVIDENCE_RE = /TallyKonnect|Smart TDS|tallykonnect\.com|info@tallykonnect\.com/i;
const APPLY = process.argv.includes('--apply');

type DeliveryEvidence = {
  id: string;
  automationId: string;
  recipient: string;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
};

type AuditSummary = {
  emailDelivery: number;
  leadSchedule: number;
  customerDemoState: number;
  demoHistory: number;
  emailLog: number;
  sheetSyncJob: number;
};

function normalizeId(value: unknown) {
  return String(value || '').trim();
}

function normalizeRecipient(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function deliveryContent(delivery: DeliveryEvidence) {
  return [
    delivery.subject || '',
    delivery.textBody || '',
    delivery.htmlBody || ''
  ].join('\n');
}

function countByAutomationId(deliveries: DeliveryEvidence[]) {
  const grouped = new Map<string, DeliveryEvidence[]>();
  for (const delivery of deliveries) {
    const automationId = normalizeId(delivery.automationId);
    if (!automationId) continue;
    grouped.set(automationId, [...(grouped.get(automationId) || []), delivery]);
  }
  return grouped;
}

async function countTargets(automationIds: string[], emailDeliveryIds: string[]): Promise<AuditSummary> {
  if (automationIds.length === 0 && emailDeliveryIds.length === 0) {
    return {
      emailDelivery: 0,
      leadSchedule: 0,
      customerDemoState: 0,
      demoHistory: 0,
      emailLog: 0,
      sheetSyncJob: 0
    };
  }

  const [
    emailDelivery,
    leadSchedule,
    customerDemoState,
    demoHistory,
    emailLog,
    sheetSyncJob
  ] = await Promise.all([
    prisma.emailDelivery.count({
      where: { automationId: { in: automationIds }, emailBrand: { not: 'anywheretally' } }
    }),
    prisma.leadSchedule.count({
      where: { automationId: { in: automationIds }, emailBrand: { not: 'anywheretally' } }
    }),
    prisma.customerDemoState.count({
      where: { userId: { in: automationIds }, emailBrand: { not: 'anywheretally' } }
    }),
    prisma.demoHistory.count({
      where: { userId: { in: automationIds }, emailBrand: { not: 'anywheretally' } }
    }),
    prisma.emailLog.count({
      where: { rowKey: { in: automationIds }, emailBrand: { not: 'anywheretally' } }
    }),
    prisma.sheetSyncJob.count({
      where: { emailDeliveryId: { in: emailDeliveryIds }, emailBrand: { not: 'anywheretally' } }
    })
  ]);

  return {
    emailDelivery,
    leadSchedule,
    customerDemoState,
    demoHistory,
    emailLog,
    sheetSyncJob
  };
}

async function applyBackfill(automationIds: string[], emailDeliveryIds: string[]) {
  return prisma.$transaction(async (tx) => {
    const emailDelivery = await tx.emailDelivery.updateMany({
      where: { automationId: { in: automationIds }, emailBrand: { not: 'anywheretally' } },
      data: { emailBrand: 'anywheretally' }
    });
    const leadSchedule = await tx.leadSchedule.updateMany({
      where: { automationId: { in: automationIds }, emailBrand: { not: 'anywheretally' } },
      data: { emailBrand: 'anywheretally' }
    });
    const customerDemoState = await tx.customerDemoState.updateMany({
      where: { userId: { in: automationIds }, emailBrand: { not: 'anywheretally' } },
      data: { emailBrand: 'anywheretally' }
    });
    const demoHistory = await tx.demoHistory.updateMany({
      where: { userId: { in: automationIds }, emailBrand: { not: 'anywheretally' } },
      data: { emailBrand: 'anywheretally' }
    });
    const emailLog = await tx.emailLog.updateMany({
      where: { rowKey: { in: automationIds }, emailBrand: { not: 'anywheretally' } },
      data: { emailBrand: 'anywheretally' }
    });
    const sheetSyncJob = await tx.sheetSyncJob.updateMany({
      where: { emailDeliveryId: { in: emailDeliveryIds }, emailBrand: { not: 'anywheretally' } },
      data: { emailBrand: 'anywheretally' }
    });

    return {
      emailDelivery: emailDelivery.count,
      leadSchedule: leadSchedule.count,
      customerDemoState: customerDemoState.count,
      demoHistory: demoHistory.count,
      emailLog: emailLog.count,
      sheetSyncJob: sheetSyncJob.count
    } satisfies AuditSummary;
  });
}

async function main() {
  const deliveries = await prisma.emailDelivery.findMany({
    select: {
      id: true,
      automationId: true,
      recipient: true,
      subject: true,
      textBody: true,
      htmlBody: true
    }
  });

  const grouped = countByAutomationId(deliveries);
  const candidateIds: string[] = [];
  const candidateDeliveryIds: string[] = [];
  const ambiguousIds: Array<{ automationId: string; reason: string }> = [];

  for (const [automationId, group] of grouped) {
    const hasAnyWhereTallyEvidence = group.some((delivery) => AWT_EVIDENCE_RE.test(deliveryContent(delivery)));
    if (!hasAnyWhereTallyEvidence) continue;

    const hasTallyKonnectConflict = group.some((delivery) => TALLYKONNECT_EVIDENCE_RE.test(deliveryContent(delivery)));
    if (hasTallyKonnectConflict) {
      ambiguousIds.push({ automationId, reason: 'Contains both AnyWhereTally and TallyKonnect evidence.' });
      continue;
    }

    const recipients = new Set(group.map((delivery) => normalizeRecipient(delivery.recipient)).filter(Boolean));
    if (recipients.size !== 1) {
      ambiguousIds.push({ automationId, reason: `Expected one recipient, found ${recipients.size}.` });
      continue;
    }

    candidateIds.push(automationId);
    candidateDeliveryIds.push(...group.map((delivery) => delivery.id));
  }

  const uniqueAutomationIds = Array.from(new Set(candidateIds)).sort();
  const uniqueDeliveryIds = Array.from(new Set(candidateDeliveryIds)).sort();
  const summary = APPLY
    ? await applyBackfill(uniqueAutomationIds, uniqueDeliveryIds)
    : await countTargets(uniqueAutomationIds, uniqueDeliveryIds);

  console.log(`Email brand backfill mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Strong AnyWhereTally automation IDs: ${uniqueAutomationIds.length}`);
  console.table(summary);

  if (ambiguousIds.length > 0) {
    console.log('Ambiguous automation IDs skipped:');
    for (const item of ambiguousIds.slice(0, 50)) {
      console.log(`- ${item.automationId}: ${item.reason}`);
    }
    if (ambiguousIds.length > 50) {
      console.log(`...and ${ambiguousIds.length - 50} more.`);
    }
  }

  if (!APPLY) {
    console.log('Dry run only. Run npm run db:backfill-email-brand to apply these updates.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
