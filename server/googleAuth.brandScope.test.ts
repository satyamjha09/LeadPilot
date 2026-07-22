import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn());
const userinfoGetMock = vi.hoisted(() => vi.fn());
const oauth2Mock = vi.hoisted(() =>
  vi.fn(function OAuth2Mock(this: any) {
    this.setCredentials = vi.fn();
    this.on = vi.fn();
    this.generateAuthUrl = vi.fn(() => 'https://accounts.google.com/mock');
    this.getAccessToken = vi.fn().mockResolvedValue({ token: 'verified-access' });
  })
);

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: oauth2Mock
    },
    gmail: vi.fn(() => ({
      users: {
        messages: {
          send: sendMock
        }
      }
    })),
    oauth2: vi.fn(() => ({
      userinfo: {
        get: userinfoGetMock
      }
    }))
  }
}));

const prismaMock = vi.hoisted(() => ({
  googleAuth: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const { sendGmailTemplate } = await import('./googleAuth');

function decodeRawEmail(raw: string) {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

describe('brand-scoped generic Gmail sender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_AUTH_EMAIL = 'demo.tallykonnect@gmail.com';
    process.env.GOOGLE_CLIENT_ID = 'tally-client';
    process.env.GOOGLE_CLIENT_SECRET = 'tally-secret';
    process.env.GMAIL_FROM_EMAIL = 'demo.tallykonnect@gmail.com';
    process.env.GOOGLE_ANYWHERETALLY_AUTH_EMAIL = 'info.anywheretally@gmail.com';
    process.env.GOOGLE_ANYWHERETALLY_CLIENT_ID = 'awt-client';
    process.env.GOOGLE_ANYWHERETALLY_CLIENT_SECRET = 'awt-secret';
    process.env.GMAIL_ANYWHERETALLY_FROM_EMAIL = 'info.anywheretally@gmail.com';
    prismaMock.googleAuth.findUnique.mockResolvedValue(null);
    prismaMock.googleAuth.update.mockResolvedValue({});
    prismaMock.googleAuth.upsert.mockResolvedValue({});
    userinfoGetMock.mockImplementation(async () => ({
      data: {
        email: (oauth2Mock.mock.calls as unknown as any[][]).at(-1)?.[0] === 'awt-client'
          ? 'info.anywheretally@gmail.com'
          : 'demo.tallykonnect@gmail.com'
      }
    }));
    sendMock.mockResolvedValue({
      data: {
        id: 'gmail-message-1',
        threadId: 'thread-1'
      }
    });
  });

  it('does not infer sender identity from template content', async () => {
    await sendGmailTemplate(
      'lead@example.com',
      {
        subject: 'AnyWhereTally retry content',
        text: 'Visit anywheretally.com and contact info@anywheretally.com',
        html: '<p>AnyWhereTally</p>'
      },
      'tallykonnect'
    );

    const raw = sendMock.mock.calls[0][0].requestBody.raw;
    const decoded = decodeRawEmail(raw);

    expect(decoded).toContain('From: TallyKonnect <demo.tallykonnect@gmail.com>');
    expect(decoded).not.toContain('From: AnyWhereTally <info.anywheretally@gmail.com>');
  });

  it('uses the explicit AnyWhereTally sender when brand is anywheretally', async () => {
    await sendGmailTemplate(
      'lead@example.com',
      {
        subject: 'TallyKonnect-looking retry content',
        text: 'This text mentions TallyKonnect but should not choose that sender.',
        html: '<p>TallyKonnect</p>'
      },
      'anywheretally'
    );

    const raw = sendMock.mock.calls[0][0].requestBody.raw;
    const decoded = decodeRawEmail(raw);

    expect(decoded).toContain('From: AnyWhereTally <info.anywheretally@gmail.com>');
    expect(decoded).not.toContain('From: TallyKonnect <demo.tallykonnect@gmail.com>');
  });
});
