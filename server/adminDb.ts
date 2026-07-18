import { prisma } from './db';
import type { EmailBrandKey } from '../src/lib/emailBrand';

export async function resetDemoTestData(emailBrand: EmailBrandKey) {
  return prisma.$transaction(async (tx) => {
    const sheetSyncJob = await tx.sheetSyncJob.deleteMany({ where: { emailBrand } });
    const emailDelivery = await tx.emailDelivery.deleteMany({ where: { emailBrand } });
    const emailLog = await tx.emailLog.deleteMany({ where: { emailBrand } });
    const sheetLeadState = await tx.sheetLeadState.deleteMany({ where: { emailBrand } });
    const demoHistory = await tx.demoHistory.deleteMany({ where: { emailBrand } });
    const customerDemoState = await tx.customerDemoState.deleteMany({ where: { emailBrand } });
    const leadSchedule = await tx.leadSchedule.deleteMany({ where: { emailBrand } });
    const processLeadJob = await tx.processLeadJob.deleteMany({ where: { emailBrand } });

    return {
      SheetSyncJob: sheetSyncJob.count,
      EmailDelivery: emailDelivery.count,
      EmailLog: emailLog.count,
      SheetLeadState: sheetLeadState.count,
      DemoHistory: demoHistory.count,
      CustomerDemoState: customerDemoState.count,
      LeadSchedule: leadSchedule.count,
      ProcessLeadJob: processLeadJob.count
    };
  });
}
