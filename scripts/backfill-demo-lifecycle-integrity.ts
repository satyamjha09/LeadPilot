import { prisma } from '../server/db';
import { LEAD_STATUS } from '../server/leadStatus';

const apply = process.argv.includes('--apply');
const audit = process.argv.includes('--audit') || !apply;

type Finding = {
  code: string;
  count: number;
  samples?: unknown[];
};

async function countAndSample<T>(code: string, count: () => Promise<number>, sample: () => Promise<T[]>) {
  const [total, samples] = await Promise.all([count(), sample()]);
  return {
    code,
    count: total,
    samples
  } satisfies Finding;
}

async function main() {
  const findings: Finding[] = [];

  findings.push(
    await countAndSample('LEAD_SCHEDULE_NULL_AUTOMATION_ID',
      () => prisma.leadSchedule.count({
        where: { OR: [{ automationId: null }, { automationId: '' }] }
      }),
      () =>
      prisma.leadSchedule.findMany({
        where: { OR: [{ automationId: null }, { automationId: '' }] },
        take: 10
      })
    )
  );

  findings.push(
    await countAndSample('CUSTOMER_DEMO_STATE_EMAIL_USER_ID',
      () => prisma.customerDemoState.count({ where: { userId: { contains: '@' } } }),
      () =>
      prisma.customerDemoState.findMany({
        where: { userId: { contains: '@' } },
        take: 10
      })
    )
  );

  findings.push(
    await countAndSample('DEMO_HISTORY_EMAIL_USER_ID',
      () => prisma.demoHistory.count({ where: { userId: { contains: '@' } } }),
      () =>
      prisma.demoHistory.findMany({
        where: { userId: { contains: '@' } },
        take: 10
      })
    )
  );

  const activeStateWithoutHistoryCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM "CustomerDemoState" c
    LEFT JOIN "DemoHistory" h
      ON h."emailBrand" = c."emailBrand"
     AND h."sessionId" = c."activeDemoSessionId"
    WHERE c."activeDemoSessionId" IS NOT NULL
      AND h."id" IS NULL
  `;
  const activeStateWithoutHistory = await prisma.$queryRaw<Array<{ activeDemoSessionId: string; emailBrand: string; userId: string }>>`
    SELECT c."activeDemoSessionId", c."emailBrand", c."userId"
    FROM "CustomerDemoState" c
    LEFT JOIN "DemoHistory" h
      ON h."emailBrand" = c."emailBrand"
     AND h."sessionId" = c."activeDemoSessionId"
    WHERE c."activeDemoSessionId" IS NOT NULL
      AND h."id" IS NULL
    LIMIT 10
  `;
  findings.push({
    code: 'ACTIVE_STATE_WITHOUT_HISTORY',
    count: Number(activeStateWithoutHistoryCount[0]?.count || 0),
    samples: activeStateWithoutHistory
  });

  findings.push(
    await countAndSample('TERMINAL_SCHEDULE_RETAINING_MEETING_LINK',
      () => prisma.leadSchedule.count({
        where: {
          status: { in: [LEAD_STATUS.DEMO_DONE, LEAD_STATUS.NO_RESPONSE] },
          meetingLink: { not: null }
        }
      }),
      () =>
      prisma.leadSchedule.findMany({
        where: {
          status: { in: [LEAD_STATUS.DEMO_DONE, LEAD_STATUS.NO_RESPONSE] },
          meetingLink: { not: null }
        },
        take: 10
      })
    )
  );

  const activeStateWithTerminalHistoryCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM "CustomerDemoState" c
    JOIN "DemoHistory" h
      ON h."emailBrand" = c."emailBrand"
     AND h."sessionId" = c."activeDemoSessionId"
    WHERE c."activeDemoSessionId" IS NOT NULL
      AND h."status" IN (${LEAD_STATUS.DEMO_DONE}, ${LEAD_STATUS.NO_RESPONSE})
  `;
  const activeStateWithTerminalHistory = await prisma.$queryRaw<Array<{ activeDemoSessionId: string; emailBrand: string; userId: string; status: string }>>`
    SELECT c."activeDemoSessionId", c."emailBrand", c."userId", h."status"
    FROM "CustomerDemoState" c
    JOIN "DemoHistory" h
      ON h."emailBrand" = c."emailBrand"
     AND h."sessionId" = c."activeDemoSessionId"
    WHERE c."activeDemoSessionId" IS NOT NULL
      AND h."status" IN (${LEAD_STATUS.DEMO_DONE}, ${LEAD_STATUS.NO_RESPONSE})
    LIMIT 10
  `;
  findings.push({
    code: 'ACTIVE_STATE_WITH_TERMINAL_HISTORY',
    count: Number(activeStateWithTerminalHistoryCount[0]?.count || 0),
    samples: activeStateWithTerminalHistory
  });

  const duplicateAutomationByEmailCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM (
      SELECT "emailBrand", LOWER("email") AS email
      FROM "LeadSchedule"
      WHERE "automationId" IS NOT NULL AND "automationId" <> ''
        AND "email" IS NOT NULL AND "email" <> ''
      GROUP BY "emailBrand", LOWER("email")
      HAVING COUNT(DISTINCT "automationId") > 1
    ) duplicate_groups
  `;
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
    count: Number(duplicateAutomationByEmailCount[0]?.count || 0),
    samples: duplicateAutomationByEmail
  });

  const historyWithoutScheduleCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM "DemoHistory" h
    LEFT JOIN "LeadSchedule" s
      ON s."emailBrand" = h."emailBrand"
     AND s."demoSessionId" = h."sessionId"
    WHERE s."id" IS NULL
  `;
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
    count: Number(historyWithoutScheduleCount[0]?.count || 0),
    samples: historyWithoutSchedule
  });

  const activeStateWithoutSessionScheduleCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM "CustomerDemoState" c
    LEFT JOIN "LeadSchedule" s
      ON s."emailBrand" = c."emailBrand"
     AND s."demoSessionId" = c."activeDemoSessionId"
    WHERE c."activeDemoSessionId" IS NOT NULL
      AND s."id" IS NULL
  `;
  const activeStateWithoutSessionSchedule = await prisma.$queryRaw<Array<{ activeDemoSessionId: string; emailBrand: string; userId: string }>>`
    SELECT c."activeDemoSessionId", c."emailBrand", c."userId"
    FROM "CustomerDemoState" c
    LEFT JOIN "LeadSchedule" s
      ON s."emailBrand" = c."emailBrand"
     AND s."demoSessionId" = c."activeDemoSessionId"
    WHERE c."activeDemoSessionId" IS NOT NULL
      AND s."id" IS NULL
    LIMIT 10
  `;
  findings.push({
    code: 'ACTIVE_STATE_WITHOUT_SESSION_SCHEDULE',
    count: Number(activeStateWithoutSessionScheduleCount[0]?.count || 0),
    samples: activeStateWithoutSessionSchedule
  });

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'audit', findings }, null, 2));

  if (apply) {
    const legacyStateAdoptions = await prisma.$executeRaw`
      WITH unambiguous_email_automation AS (
        SELECT
          "emailBrand",
          LOWER("email") AS "email",
          MIN("automationId") AS "automationId"
        FROM "LeadSchedule"
        WHERE "automationId" IS NOT NULL
          AND "automationId" <> ''
          AND "email" IS NOT NULL
          AND "email" <> ''
        GROUP BY "emailBrand", LOWER("email")
        HAVING COUNT(DISTINCT "automationId") = 1
      ),
      adoptable_state AS (
        SELECT
          c."id",
          c."emailBrand",
          c."userId" AS "legacyUserId",
          u."automationId"
        FROM "CustomerDemoState" c
        JOIN unambiguous_email_automation u
          ON u."emailBrand" = c."emailBrand"
         AND u."email" = LOWER(c."email")
        WHERE c."userId" LIKE '%@%'
          AND LOWER(c."userId") = LOWER(c."email")
          AND NOT EXISTS (
            SELECT 1
            FROM "CustomerDemoState" existing
            WHERE existing."emailBrand" = c."emailBrand"
              AND existing."userId" = u."automationId"
          )
      )
      UPDATE "CustomerDemoState" c
      SET "userId" = a."automationId"
      FROM adoptable_state a
      WHERE c."id" = a."id"
    `;
    const legacyScheduleAutomationBackfill = await prisma.$executeRaw`
      WITH unambiguous_email_automation AS (
        SELECT
          "emailBrand",
          LOWER("email") AS "email",
          MIN("automationId") AS "automationId"
        FROM "LeadSchedule"
        WHERE "automationId" IS NOT NULL
          AND "automationId" <> ''
          AND "email" IS NOT NULL
          AND "email" <> ''
        GROUP BY "emailBrand", LOWER("email")
        HAVING COUNT(DISTINCT "automationId") = 1
      )
      UPDATE "LeadSchedule" s
      SET "automationId" = u."automationId"
      FROM unambiguous_email_automation u
      WHERE s."emailBrand" = u."emailBrand"
        AND LOWER(s."email") = u."email"
        AND (s."automationId" IS NULL OR s."automationId" = '' OR s."automationId" LIKE '%@%')
    `;
    const backfilled = await prisma.$executeRaw`
      WITH candidate_matches AS (
        SELECT
          s."id" AS "scheduleId",
          h."sessionId"
        FROM "LeadSchedule" s
        JOIN "DemoHistory" h
          ON h."emailBrand" = s."emailBrand"
         AND (
            (s."calendarEventId" IS NOT NULL AND s."calendarEventId" <> '' AND s."calendarEventId" = h."calendarEventId")
            OR (
              s."automationId" IS NOT NULL AND s."automationId" <> ''
              AND s."automationId" = h."userId"
              AND s."dateOfDemo" = h."displayDate"
              AND s."timeOfDemo" = h."displayTime"
            )
            OR (
              s."email" IS NOT NULL AND s."email" <> ''
              AND LOWER(s."email") = LOWER(h."email")
              AND s."dateOfDemo" = h."displayDate"
              AND s."timeOfDemo" = h."displayTime"
            )
          )
        WHERE s."demoSessionId" IS NULL
      ),
      schedule_counts AS (
        SELECT "scheduleId", COUNT(DISTINCT "sessionId") AS "sessionCount"
        FROM candidate_matches
        GROUP BY "scheduleId"
      ),
      session_counts AS (
        SELECT "sessionId", COUNT(DISTINCT "scheduleId") AS "scheduleCount"
        FROM candidate_matches
        GROUP BY "sessionId"
      ),
      unambiguous AS (
        SELECT cm."scheduleId", cm."sessionId"
        FROM candidate_matches cm
        JOIN schedule_counts sc ON sc."scheduleId" = cm."scheduleId"
        JOIN session_counts hc ON hc."sessionId" = cm."sessionId"
        WHERE sc."sessionCount" = 1
          AND hc."scheduleCount" = 1
          AND NOT EXISTS (
            SELECT 1
            FROM "LeadSchedule" existing
            WHERE existing."emailBrand" = (
              SELECT s."emailBrand" FROM "LeadSchedule" s WHERE s."id" = cm."scheduleId"
            )
              AND existing."demoSessionId" = cm."sessionId"
          )
      )
      UPDATE "LeadSchedule" s
      SET "demoSessionId" = u."sessionId"
      FROM unambiguous u
      WHERE s."id" = u."scheduleId"
    `;
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
    console.log(JSON.stringify({
      applied: {
        legacyEmailStatesAdopted: Number(legacyStateAdoptions),
        legacyScheduleAutomationIdsBackfilled: Number(legacyScheduleAutomationBackfill),
        legacyScheduleSessionIdsBackfilled: Number(backfilled),
        terminalScheduleMeetingLinksCleared: terminalCleanup.count
      }
    }, null, 2));
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
