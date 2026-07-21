import type { DataSource, DataSourceTab } from '@prisma/client';
import type { ReadSourceTabResult } from './sourceIngestion.types';

export interface SourceReader {
  readEnabledTabs(input: {
    source: DataSource;
    tabs: DataSourceTab[];
    workspaceKey: string;
  }): Promise<ReadSourceTabResult[]>;
}
