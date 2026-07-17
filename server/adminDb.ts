import { prisma } from './db';

export async function resetDemoTestData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      public."LeadSchedule",
      public."EmailLog",
      public."SheetLeadState",
      public."CustomerDemoState",
      public."DemoHistory",
      public."EmailDelivery",
      public."SheetSyncJob",
      public."ProcessLeadJob"
    RESTART IDENTITY CASCADE
  `);
}
