import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryStorage } from '../../infrastructure/storage/inMemoryStorage';

vi.mock('../workspace/workspace.service', () => ({
  getWorkspaceOrThrow: vi.fn()
}));

vi.mock('./source.repository', () => ({
  archiveSource: vi.fn(),
  createSourceWithTabs: vi.fn(),
  findDataSourceByExternalFile: vi.fn(),
  findExcelSourceByChecksum: vi.fn(),
  findSourceWithTabs: vi.fn(),
  listSourcesWithTabs: vi.fn(),
  refreshSourceWithTabs: vi.fn(),
  updateSourceDetails: vi.fn(),
  updateSourceTab: vi.fn()
}));

import { getWorkspaceOrThrow } from '../workspace/workspace.service';
import {
  archiveSource,
  createSourceWithTabs,
  findDataSourceByExternalFile,
  findExcelSourceByChecksum,
  findSourceWithTabs,
  refreshSourceWithTabs,
  updateSourceDetails,
  updateSourceTab
} from './source.repository';
import {
  archiveWorkspaceSource,
  getWorkspaceSource,
  registerExcelSource,
  registerGoogleSheetsSource,
  setSourceTabEnabled
} from './source.service';

const workspace = { id: 'workspace-1', key: 'anywheretally', name: 'AnyWhereTally' };

function inspectedGoogleSource(tabs = [{ externalTabId: '0', name: 'Leads', position: 0, headers: ['email'], headerHash: 'h' }]) {
  return {
    type: 'GOOGLE_SHEETS' as const,
    externalFileId: 'sheet-1',
    displayName: 'AWT Leads',
    preferredTabId: '0',
    tabs
  };
}

describe('source service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspaceOrThrow).mockResolvedValue(workspace as any);
  });

  it('creates a new Google source with preferred tab metadata', async () => {
    vi.mocked(findDataSourceByExternalFile).mockResolvedValue(null);
    vi.mocked(createSourceWithTabs).mockResolvedValue({ id: 'source-1', tabs: [] } as any);
    const googleAdapter = {
      inspect: vi.fn(async () => inspectedGoogleSource())
    };

    const result = await registerGoogleSheetsSource(
      'anywheretally',
      { sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0' },
      { googleAdapter: googleAdapter as any }
    );

    expect(result.created).toBe(true);
    expect(createSourceWithTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        type: 'GOOGLE_SHEETS',
        externalFileId: 'sheet-1',
        googleAccountKey: 'anywheretally-google',
        preferredTabId: '0',
        tabs: [expect.objectContaining({ externalTabId: '0', headersJson: ['email'] })]
      })
    );
    expect(googleAdapter.inspect).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ googleAccountKey: 'anywheretally-google' })
    );
  });

  it('refreshes duplicate Google source instead of creating another one', async () => {
    vi.mocked(findDataSourceByExternalFile).mockResolvedValue({ id: 'existing-source' } as any);
    vi.mocked(refreshSourceWithTabs).mockResolvedValue({ id: 'existing-source', tabs: [] } as any);
    const googleAdapter = { inspect: vi.fn(async () => inspectedGoogleSource()) };

    const result = await registerGoogleSheetsSource(
      'anywheretally',
      { sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit' },
      { googleAdapter: googleAdapter as any }
    );

    expect(result.created).toBe(false);
    expect(createSourceWithTabs).not.toHaveBeenCalled();
    expect(refreshSourceWithTabs).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'existing-source' })
    );
  });

  it('does not upload duplicate Excel files with the same checksum', async () => {
    const storage = new InMemoryStorage();
    const putSpy = vi.spyOn(storage, 'putObject');
    vi.mocked(findExcelSourceByChecksum).mockResolvedValue({ id: 'excel-existing', tabs: [] } as any);

    const result = await registerExcelSource(
      'anywheretally',
      {
        buffer: Buffer.from('same content'),
        originalFileName: 'leads.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      { storage }
    );

    expect(result.created).toBe(false);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('cleans uploaded Excel object if database creation fails', async () => {
    const storage = new InMemoryStorage();
    const deleteSpy = vi.spyOn(storage, 'deleteObject');
    vi.mocked(findExcelSourceByChecksum).mockResolvedValue(null);
    vi.mocked(createSourceWithTabs).mockRejectedValue(new Error('db failed'));
    const excelAdapter = {
      inspect: vi.fn(async () => ({
        type: 'EXCEL',
        externalFileId: 'excel-1',
        displayName: 'Excel',
        storageKey: 'workspaces/anywheretally/sources/excel-1/original/leads.xlsx',
        originalFileName: 'leads.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'checksum',
        fileSize: 10,
        preferredTabId: 'worksheet-0',
        tabs: [{ externalTabId: 'worksheet-0', name: 'Leads', position: 0, headers: ['email'], headerHash: 'h' }]
      }))
    };

    await expect(
      registerExcelSource(
        'anywheretally',
        {
          buffer: Buffer.from('content'),
          originalFileName: 'leads.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        },
        { storage, excelAdapter: excelAdapter as any }
      )
    ).rejects.toThrow('db failed');
    expect(deleteSpy).toHaveBeenCalledWith('workspaces/anywheretally/sources/excel-1/original/leads.xlsx');
  });

  it('blocks access to a source outside the workspace', async () => {
    vi.mocked(findSourceWithTabs).mockResolvedValue(null);

    await expect(getWorkspaceSource('anywheretally', 'source-from-other-workspace')).rejects.toThrow('Source not found');
  });

  it('updates tab enabled state through workspace ownership scope', async () => {
    vi.mocked(updateSourceTab).mockResolvedValue({ id: 'source-1', tabs: [{ id: 'tab-1', isEnabled: true }] } as any);

    await setSourceTabEnabled('anywheretally', 'source-1', 'tab-1', true);

    expect(updateSourceTab).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      sourceId: 'source-1',
      tabId: 'tab-1',
      isEnabled: true
    });
  });

  it('archives sources with a soft delete repository operation', async () => {
    vi.mocked(archiveSource).mockResolvedValue({ id: 'source-1', connectionStatus: 'ARCHIVED' } as any);

    await archiveWorkspaceSource('anywheretally', 'source-1');

    expect(archiveSource).toHaveBeenCalledWith(workspace.id, 'source-1');
  });
});
