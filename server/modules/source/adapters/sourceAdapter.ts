import type { DataSourceType } from '@prisma/client';

export type InspectedSourceTab = {
  externalTabId: string;
  name: string;
  position: number;
  headers: string[];
  headerHash: string;
};

export type InspectedSource = {
  type: DataSourceType;
  externalFileId: string;
  displayName: string;
  originalFileName?: string;
  storageKey?: string;
  mimeType?: string;
  checksum?: string;
  fileSize?: number;
  preferredTabId?: string;
  tabs: InspectedSourceTab[];
};

export type SourceAdapterContext = {
  workspaceId: string;
  workspaceKey: string;
  googleAccountKey?: string | null;
};

export interface SourceAdapter<TInput> {
  inspect(input: TInput, context: SourceAdapterContext): Promise<InspectedSource>;
}
