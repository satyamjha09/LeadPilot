import type { ExcelRow, SheetSource } from '@/src/types';
import type { WorkspaceKey } from '@/src/lib/senderAccount';

const LEGACY_ROWS_STORAGE_KEY = 'excel-meet-scheduler.rows';
const LEGACY_SELECTED_STORAGE_KEY = 'excel-meet-scheduler.selectedRowIds';
const LEGACY_SOURCE_STORAGE_KEY = 'excel-meet-scheduler.source';
const WORKSPACE_STORAGE_PREFIX = 'excel-meet-scheduler';

export const workspaceStorageKey = (workspaceKey: WorkspaceKey, key: 'rows' | 'selectedRowIds' | 'source') =>
  `${WORKSPACE_STORAGE_PREFIX}.${workspaceKey}.${key}`;

function browserStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function getScopedStorageItem(workspaceKey: WorkspaceKey, key: 'rows' | 'selectedRowIds' | 'source', legacyKey: string) {
  const storage = browserStorage();
  if (!storage) return null;
  const scoped = storage.getItem(workspaceStorageKey(workspaceKey, key));
  if (scoped !== null) return scoped;
  return workspaceKey === 'tallykonnect' ? storage.getItem(legacyKey) : null;
}

export const loadStoredRows = (workspaceKey: WorkspaceKey): ExcelRow[] => {
  try {
    const stored = getScopedStorageItem(workspaceKey, 'rows', LEGACY_ROWS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

export const loadStoredSelectedIds = (workspaceKey: WorkspaceKey) => {
  try {
    const stored = getScopedStorageItem(workspaceKey, 'selectedRowIds', LEGACY_SELECTED_STORAGE_KEY);
    const ids = stored ? JSON.parse(stored) : [];
    return new Set<string>(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set<string>();
  }
};

export const normalizeStoredSource = (source: any): SheetSource => {
  if (source?.type === 'google_sheet') {
    return { ...source, type: 'google-sheet', headers: source.headers || [] };
  }
  if (source?.type === 'google-sheet') {
    return { ...source, headers: source.headers || [] };
  }
  return { type: 'excel' };
};

export const loadStoredSource = (workspaceKey: WorkspaceKey): SheetSource => {
  try {
    const stored = getScopedStorageItem(workspaceKey, 'source', LEGACY_SOURCE_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : { type: 'excel' };
    return normalizeStoredSource(parsed);
  } catch {
    return { type: 'excel' };
  }
};

export const removeStoredWorkspace = (workspaceKey: WorkspaceKey) => {
  const storage = browserStorage();
  if (!storage) return;
  storage.removeItem(workspaceStorageKey(workspaceKey, 'rows'));
  storage.removeItem(workspaceStorageKey(workspaceKey, 'selectedRowIds'));
  storage.removeItem(workspaceStorageKey(workspaceKey, 'source'));
  if (workspaceKey === 'tallykonnect') {
    storage.removeItem(LEGACY_ROWS_STORAGE_KEY);
    storage.removeItem(LEGACY_SELECTED_STORAGE_KEY);
    storage.removeItem(LEGACY_SOURCE_STORAGE_KEY);
  }
};
