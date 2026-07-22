import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadStoredRows,
  loadStoredSelectedIds,
  loadStoredSource,
  removeStoredWorkspace,
  workspaceStorageKey
} from './workspaceStorage';

function installLocalStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  };
  (globalThis as any).window = { localStorage };
  return localStorage;
}

describe('workspace browser storage isolation', () => {
  let storage: ReturnType<typeof installLocalStorage>;

  beforeEach(() => {
    storage = installLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('stores rows, selected IDs, and source metadata independently by workspaceKey', () => {
    storage.setItem(workspaceStorageKey('tallykonnect', 'rows'), JSON.stringify([{ id: 'tk-row' }]));
    storage.setItem(workspaceStorageKey('anywheretally', 'rows'), JSON.stringify([{ id: 'awt-row' }]));
    storage.setItem(workspaceStorageKey('tallykonnect', 'selectedRowIds'), JSON.stringify(['tk-row']));
    storage.setItem(workspaceStorageKey('anywheretally', 'selectedRowIds'), JSON.stringify(['awt-row']));
    storage.setItem(workspaceStorageKey('tallykonnect', 'source'), JSON.stringify({ type: 'excel' }));
    storage.setItem(
      workspaceStorageKey('anywheretally', 'source'),
      JSON.stringify({ type: 'google-sheet', spreadsheetId: 'sheet-1', sheetName: 'AWT', headers: ['email'] })
    );

    expect(loadStoredRows('tallykonnect').map((row) => row.id)).toEqual(['tk-row']);
    expect(loadStoredRows('anywheretally').map((row) => row.id)).toEqual(['awt-row']);
    expect([...loadStoredSelectedIds('tallykonnect')]).toEqual(['tk-row']);
    expect([...loadStoredSelectedIds('anywheretally')]).toEqual(['awt-row']);
    expect(loadStoredSource('tallykonnect')).toEqual({ type: 'excel' });
    expect(loadStoredSource('anywheretally')).toMatchObject({ type: 'google-sheet', sheetName: 'AWT' });
  });

  it('migrates legacy browser rows only into the default TallyKonnect workspace', () => {
    storage.setItem('excel-meet-scheduler.rows', JSON.stringify([{ id: 'legacy-row' }]));
    storage.setItem('excel-meet-scheduler.selectedRowIds', JSON.stringify(['legacy-row']));
    storage.setItem('excel-meet-scheduler.source', JSON.stringify({ type: 'google_sheet', sheetName: 'Legacy' }));

    expect(loadStoredRows('tallykonnect').map((row) => row.id)).toEqual(['legacy-row']);
    expect([...loadStoredSelectedIds('tallykonnect')]).toEqual(['legacy-row']);
    expect(loadStoredSource('tallykonnect')).toMatchObject({ type: 'google-sheet', sheetName: 'Legacy' });
    expect(loadStoredRows('anywheretally')).toEqual([]);
    expect([...loadStoredSelectedIds('anywheretally')]).toEqual([]);
    expect(loadStoredSource('anywheretally')).toEqual({ type: 'excel' });
  });

  it('clears one workspace without removing the other workspace', () => {
    storage.setItem(workspaceStorageKey('tallykonnect', 'rows'), JSON.stringify([{ id: 'tk-row' }]));
    storage.setItem(workspaceStorageKey('anywheretally', 'rows'), JSON.stringify([{ id: 'awt-row' }]));

    removeStoredWorkspace('tallykonnect');

    expect(loadStoredRows('tallykonnect')).toEqual([]);
    expect(loadStoredRows('anywheretally').map((row) => row.id)).toEqual(['awt-row']);
  });

  it('fails safely when localStorage contains malformed values', () => {
    storage.setItem(workspaceStorageKey('tallykonnect', 'rows'), '{bad-json');
    storage.setItem(workspaceStorageKey('tallykonnect', 'selectedRowIds'), '{bad-json');
    storage.setItem(workspaceStorageKey('tallykonnect', 'source'), '{bad-json');

    expect(loadStoredRows('tallykonnect')).toEqual([]);
    expect([...loadStoredSelectedIds('tallykonnect')]).toEqual([]);
    expect(loadStoredSource('tallykonnect')).toEqual({ type: 'excel' });
  });
});
