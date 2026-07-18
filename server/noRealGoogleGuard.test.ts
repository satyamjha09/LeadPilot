import { describe, expect, it } from 'vitest';
import { google } from 'googleapis';

describe('no-real-Google test guard', () => {
  it('blocks unmocked Gmail, Calendar, Sheets, and OAuth userinfo calls', async () => {
    await expect(
      google.gmail({ version: 'v1', auth: {} as any }).users.messages.send({
        userId: 'me',
        requestBody: { raw: 'test' }
      })
    ).rejects.toThrow('Blocked unmocked Google Gmail send call during tests.');

    await expect(
      google.calendar({ version: 'v3', auth: {} as any }).events.insert({
        calendarId: 'primary',
        requestBody: {}
      })
    ).rejects.toThrow('Blocked unmocked Google Calendar insert call during tests.');

    await expect(
      google.sheets({ version: 'v4', auth: {} as any }).spreadsheets.values.batchUpdate({
        spreadsheetId: 'sheet-1',
        requestBody: { data: [] }
      })
    ).rejects.toThrow('Blocked unmocked Google Sheets values batchUpdate call during tests.');

    await expect(
      google.oauth2({ version: 'v2', auth: {} as any }).userinfo.get()
    ).rejects.toThrow('Blocked unmocked Google OAuth userinfo call during tests.');
  });
});
