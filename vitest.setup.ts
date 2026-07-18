import { vi } from 'vitest';

function blockedGoogleCall(api: string) {
  return vi.fn(async () => {
    throw new Error(
      `Blocked unmocked Google ${api} call during tests. Mock googleapis explicitly in this test.`
    );
  });
}

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2BlockedMock(this: any) {
        this.setCredentials = vi.fn();
        this.on = vi.fn();
        this.generateAuthUrl = vi.fn(() => 'https://accounts.google.com/test-blocked');
        this.getAccessToken = blockedGoogleCall('OAuth getAccessToken');
        this.getToken = blockedGoogleCall('OAuth getToken');
        this.revokeCredentials = blockedGoogleCall('OAuth revokeCredentials');
        this.revokeToken = blockedGoogleCall('OAuth revokeToken');
      })
    },
    oauth2: vi.fn(() => ({
      userinfo: {
        get: blockedGoogleCall('OAuth userinfo')
      }
    })),
    gmail: vi.fn(() => ({
      users: {
        messages: {
          send: blockedGoogleCall('Gmail send')
        }
      }
    })),
    calendar: vi.fn(() => ({
      events: {
        insert: blockedGoogleCall('Calendar insert'),
        patch: blockedGoogleCall('Calendar patch')
      }
    })),
    sheets: vi.fn(() => ({
      spreadsheets: {
        get: blockedGoogleCall('Sheets metadata'),
        values: {
          get: blockedGoogleCall('Sheets values get'),
          update: blockedGoogleCall('Sheets values update'),
          batchUpdate: blockedGoogleCall('Sheets values batchUpdate')
        }
      }
    }))
  }
}));
