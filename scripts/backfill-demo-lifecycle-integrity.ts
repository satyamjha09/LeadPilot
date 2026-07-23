import { prisma } from '../server/db';
import { LEAD_STATUS } from '../server/leadStatus';

const apply = process.argv.includes('--apply');
const audit = process.argv.includes('--audit') || !apply;

type Finding = {
  code: string;
  count: number;
  sample?: unknown;
};

async function countAndSample<T>(code: string, query: () => Promise<T[]>) {
  const rows = await query();
  return {
    code,
    count: rows.length,
    sample: rows[0] || undefined
  } satisfies Finding;
}

async function main() {
  const findings: Finding[] = [];

  findings.push(
    await countAndSample('LEAD_SCHEDULE_NULL_AUTOMATION_ID', () =>
      prisma.leadSchedule.findMany({
        where: { OR: [{ automationId: null }, { automationId: '' }] },
        take: 10
      })
    )
  );

  findings.push(
    await countAndSample('CUSTOMER_DEMO_STATE_EMAIL_USER_ID', () =>
      prisma.customerDemoState.findMany({
        where: { userId: { contains: '@' } },
        take: 10
      })
    )
  );

  findings.push(
    await countAndSample('DEMO_HISTORY_EMAIL_USER_ID', () =>
      prisma.demoHistory.findMany({
        where: { userId: { contains: '@' } },
        take: 10
      })
    )
  );

  findings.push(
    await countAndSample('ACTIVE_STATE_WITHOUT_HISTORY', () =>
      prisma.customerDemoState.findMany({
        where: {
          activeDemoSessionId: { not: null },
          demoHistory: { none: { status: LEAD_STATUS.DEMO_SCHEDULED } }
        },
        take: 10
      })
    )
  );

  findings.push(
    await countAndSample('TERMINAL_SCHEDULE_RETAINING_MEETING_LINK', () =>
      prisma.leadSchedule.findMany({
        where: {
          status: { in: [LEAD_STATUS.DEMO_DONE, LEAD_STATUS.NO_RESPONSE] },
          meetingLink: { not: null }
        },
        take: 10
      })
    )
  );

  findings.push(
    await countAndSample('ACTIVE_STATE_WITH_TERMINAL_HISTORY', () =>
      prisma.customerDemoState.findMany({
        where: {
          activeDemoSessionId: { not: null },
          demoHistory: { some: { status: { in: [LEAD_STATUS.DEMO_DONE, LEAD_STATUS.NO_RESPONSE] } } }
        },
        take: 10
      })
    )
  );

  const duplicateAutomationByEmail = await prisma.$queryRaw<Array<{
    emailBrand: string;
    email: string;
    automationCount: bigint;
    automationIds: string[];
  }>>`
    SELECT "emailBrand", LOWER("email") AS email,
           COUNT(DISTINCT "automationId") AS "automationCount",
           ARRAY_AGG(DISTINCT "automationId") AS "automationIds"
    FROM "LeadSchedule"
    WHERE "automationId" IS NOT NULL AND "automationId" <> ''
      AND "email" IS NOT NULL AND "email" <> ''
    GROUP BY "emailBrand", LOWER("email")
    HAVING COUNT(DISTINCT "automationId") > 1
    LIMIT 10
  `;
  findings.push({
    code: 'MULTIPLE_AUTOMATION_IDS_FOR_BRAND_EMAIL',
    count: duplicateAutomationByEmail.length,
    sample: duplicateAutomationByEmail[0]
  });

  const historyWithoutSchedule = await prisma.$queryRaw<Array<{ sessionId: string; emailBrand: string }>>`
    SELECT h."sessionId", h."emailBrand"
    FROM "DemoHistory" h
    LEFT JOIN "LeadSchedule" s
      ON s."emailBrand" = h."emailBrand"
     AND s."demoSessionId" = h."sessionId"
    WHERE s."id" IS NULL
    LIMIT 10
  `;
  findings.push({
    code: 'DEMO_HISTORY_WITHOUT_SESSION_SCHEDULE',
    count: historyWithoutSchedule.length,
    sample: historyWithoutSchedule[0]
  });

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'audit', findings }, null, 2));

  if (apply) {
    const terminalCleanup = await prisma.leadSchedule.updateMany({
      where: {
        status: { in: [LEAD_STATUS.DEMO_DONE, LEAD_STATUS.NO_RESPONSE] },
        meetingLink: { not: null }
      },
      data: {
        meetingLink: null,
        calendarEventId: null
      }
    });
    console.log(JSON.stringify({ applied: { terminalScheduleMeetingLinksCleared: terminalCleanup.count } }, null, 2));
  } else if (audit) {
    console.log('Audit only. Re-run with --apply to perform unambiguous cleanup.');
  }
}

main()
  .catch((error) => {
    console.error('BACKFILL_DEMO_LIFECYCLE_INTEGRITY_FAILED', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
