import type { Prisma } from '@prisma/client';

import type { SourceTabUpsertInput } from './source.types';

export const MISSING_TAB_ERROR = 'Tab was not found during source validation.';

export type ExistingSourceTab = {
  id: string;
  externalTabId: string;
  isEnabled: boolean;
};

export type TabRefreshPlan = {
  updates: Array<{
    id: string;
    data: Prisma.DataSourceTabUpdateInput;
  }>;
  creates: Array<Prisma.DataSourceTabCreateManyInput>;
};

export function buildInitialTabRows(input: {
  dataSourceId: string;
  tabs: SourceTabUpsertInput[];
  preferredTabId?: string | null;
}) {
  const preferredTabId = input.preferredTabId || input.tabs[0]?.externalTabId;

  return input.tabs.map((tab) => ({
    dataSourceId: input.dataSourceId,
    externalTabId: tab.externalTabId,
    name: tab.name,
    position: tab.position,
    headersJson: tab.headersJson,
    headerHash: tab.headerHash,
    rowCount: 0,
    isEnabled: tab.externalTabId === preferredTabId
  }));
}

export function buildTabRefreshPlan(input: {
  dataSourceId: string;
  existingTabs: ExistingSourceTab[];
  inspectedTabs: SourceTabUpsertInput[];
}) {
  const inspectedByExternalId = new Map(input.inspectedTabs.map((tab) => [tab.externalTabId, tab]));
  const existingByExternalId = new Map(input.existingTabs.map((tab) => [tab.externalTabId, tab]));
  const updates: TabRefreshPlan['updates'] = [];
  const creates: TabRefreshPlan['creates'] = [];

  for (const existingTab of input.existingTabs) {
    const inspectedTab = inspectedByExternalId.get(existingTab.externalTabId);
    if (!inspectedTab) {
      updates.push({
        id: existingTab.id,
        data: {
          isEnabled: false,
          lastError: MISSING_TAB_ERROR
        }
      });
      continue;
    }

    updates.push({
      id: existingTab.id,
      data: {
        name: inspectedTab.name,
        position: inspectedTab.position,
        headersJson: inspectedTab.headersJson,
        headerHash: inspectedTab.headerHash,
        lastError: null
      }
    });
  }

  for (const inspectedTab of input.inspectedTabs) {
    if (existingByExternalId.has(inspectedTab.externalTabId)) continue;

    creates.push({
      dataSourceId: input.dataSourceId,
      externalTabId: inspectedTab.externalTabId,
      name: inspectedTab.name,
      position: inspectedTab.position,
      headersJson: inspectedTab.headersJson,
      headerHash: inspectedTab.headerHash,
      rowCount: 0,
      isEnabled: false
    });
  }

  return { updates, creates };
}
