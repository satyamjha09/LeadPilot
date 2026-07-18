import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ExcelRow } from '../src/types';
import { EMAIL_LOG_TYPES } from './emailLog';

const prismaMock = vi.hoisted(() => ({
  emailLog: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  findEmailLog,
  listEmailLogsForRow,
  logEmailSent
} = await import('./emailLog');

const baseRow: ExcelRow = {
  id: 'row-1',
  full_name: 'Moh Agarwal',
  email: 'moh@example.com',
  automation_id: 'lead_123',
  'Date of Demo': '15-06-2026',
  'Time of Demo': '15:30'
};

describe('brand-scoped email logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.emailLog.findUnique.mockResolvedValue(null);
    prismaMock.emailLog.findMany.mockResolvedValue([]);
    prismaMock.emailLog.upsert.mockResolvedValue({});
  });

  it('looks up an email log by brand, recipient, row key, and type', async () => {
    await findEmailLog(baseRow, EMAIL_LOG_TYPES.DEMO_SCHEDULED, 'anywheretally');

    expect(prismaMock.emailLog.findUnique).toHaveBeenCalledWith({
      where: {
        emailBrand_email_rowKey_type: {
          emailBrand: 'anywheretally',
          email: 'moh@example.com',
          rowKey: 'lead_123',
          type: EMAIL_LOG_TYPES.DEMO_SCHEDULED
        }
      }
    });
  });

  it('filters row logs by persisted brand', async () => {
    await listEmailLogsForRow(baseRow, 'tallykonnect');

    expect(prismaMock.emailLog.findMany).toHaveBeenCalledWith({
      where: {
        emailBrand: 'tallykonnect',
        email: 'moh@example.com',
        rowKey: 'lead_123'
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  });

  it('upserts sent logs with brand in the unique selector', async () => {
    await logEmailSent(baseRow, EMAIL_LOG_TYPES.DEMO_DONE_THANK_YOU, {
      emailBrand: 'anywheretally',
      messageId: 'gmail-awt'
    });

    expect(prismaMock.emailLog.upsert).toHaveBeenCalledWith({
      where: {
        emailBrand_email_rowKey_type: {
          emailBrand: 'anywheretally',
          email: 'moh@example.com',
          rowKey: 'lead_123',
          type: EMAIL_LOG_TYPES.DEMO_DONE_THANK_YOU
        }
      },
      create: expect.objectContaining({
        emailBrand: 'anywheretally',
        email: 'moh@example.com',
        rowKey: 'lead_123',
        status: 'sent',
        messageId: 'gmail-awt'
      }),
      update: expect.objectContaining({
        status: 'sent',
        messageId: 'gmail-awt'
      })
    });
  });

  it('keeps email logs unique per brand in Prisma schema', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf-8');

    expect(schema).toContain('@@unique([emailBrand, email, rowKey, type])');
    expect(schema).not.toContain('@@unique([email, rowKey, type])');
  });

  it('loads email history with stored row brand and displays persisted log brand', () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), 'server', 'routes', 'leadRoutes.ts'), 'utf-8');
    const emailLogsViewSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'components', 'dashboard', 'EmailLogsView.tsx'),
      'utf-8'
    );

    expect(routeSource).toContain('coerceStoredEmailBrand(row.__emailBrand)');
    expect(emailLogsViewSource).toContain('emailBrandLabel(log.emailBrand)');
  });
});
