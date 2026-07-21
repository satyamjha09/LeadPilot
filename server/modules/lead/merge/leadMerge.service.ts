import { parseEmailBrand } from '../../../../src/lib/emailBrand';
import { SourceValidationError } from '../../source/sourceErrors';
import { getWorkspaceOrThrow } from '../../workspace/workspace.service';
import { mergeLeads } from './leadMerge.repository';
import type { LeadMergeInput } from './leadMerge.types';

export async function mergeWorkspaceLeads(workspaceKey: string, sourceLeadId: string, input: LeadMergeInput) {
  if (!input?.targetLeadId || typeof input.targetLeadId !== 'string') {
    throw new SourceValidationError('targetLeadId is required.');
  }

  const brand = parseEmailBrand(workspaceKey);
  const workspace = await getWorkspaceOrThrow(brand);
  return mergeLeads({
    workspaceId: workspace.id,
    sourceLeadId,
    targetLeadId: input.targetLeadId,
    note: input.note
  });
}
