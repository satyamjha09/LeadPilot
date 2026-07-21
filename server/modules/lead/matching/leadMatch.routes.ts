import type express from 'express';

import { requireMultiSourceAdmin } from '../../source/sourceAdminAuth';
import { toSourceHttpError } from '../../source/sourceErrors';
import { mergeWorkspaceLeads } from '../merge/leadMerge.service';
import {
  getWorkspaceCanonicalLead,
  getWorkspaceLeadMatchRun,
  listWorkspaceCanonicalLeads,
  listWorkspaceLeadConflicts,
  listWorkspaceLeadMatchRuns,
  previewLeadMatching,
  runLeadMatching,
  updateWorkspaceLeadConflict
} from './leadMatch.service';

function errorResponse(res: express.Response, error: unknown) {
  const httpError = toSourceHttpError(error);
  return res.status(httpError.statusCode).json({ error: httpError.message, code: httpError.code });
}

export function registerLeadMatchRoutes(app: express.Express) {
  app.post('/api/v2/workspaces/:workspaceKey/sources/:sourceId/lead-matching/preview', requireMultiSourceAdmin, async (req, res) => {
    try {
      const summary = await previewLeadMatching(req.params.workspaceKey, req.params.sourceId, req.body?.snapshotId);
      res.json({ summary });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.post('/api/v2/workspaces/:workspaceKey/sources/:sourceId/lead-matching/run', requireMultiSourceAdmin, async (req, res) => {
    try {
      const run = await runLeadMatching(req.params.workspaceKey, req.params.sourceId, req.body?.snapshotId);
      res.json({ run });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get('/api/v2/workspaces/:workspaceKey/sources/:sourceId/lead-matching/runs', requireMultiSourceAdmin, async (req, res) => {
    try {
      const result = await listWorkspaceLeadMatchRuns(
        req.params.workspaceKey,
        req.params.sourceId,
        typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        req.query.limit
      );
      res.json(result);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get('/api/v2/workspaces/:workspaceKey/sources/:sourceId/lead-matching/runs/:runId', requireMultiSourceAdmin, async (req, res) => {
    try {
      const run = await getWorkspaceLeadMatchRun(req.params.workspaceKey, req.params.sourceId, req.params.runId);
      res.json({ run });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get('/api/v2/workspaces/:workspaceKey/lead-conflicts', requireMultiSourceAdmin, async (req, res) => {
    try {
      const result = await listWorkspaceLeadConflicts(req.params.workspaceKey, {
        status:
          req.query.status === 'OPEN' || req.query.status === 'RESOLVED' || req.query.status === 'IGNORED'
            ? req.query.status
            : undefined,
        sourceId: typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined,
        type: typeof req.query.type === 'string' ? req.query.type : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        limit: req.query.limit
      });
      res.json(result);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.patch('/api/v2/workspaces/:workspaceKey/lead-conflicts/:conflictId', requireMultiSourceAdmin, async (req, res) => {
    try {
      const conflict = await updateWorkspaceLeadConflict(req.params.workspaceKey, req.params.conflictId, {
        action: req.body?.action,
        leadId: req.body?.leadId,
        note: req.body?.note
      });
      res.json({ conflict });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get('/api/v2/workspaces/:workspaceKey/leads', requireMultiSourceAdmin, async (req, res) => {
    try {
      const result = await listWorkspaceCanonicalLeads(req.params.workspaceKey, {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        sourceId: typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined,
        tabId: typeof req.query.tabId === 'string' ? req.query.tabId : undefined,
        hasConflict: typeof req.query.hasConflict === 'string' ? req.query.hasConflict : undefined,
        includeMerged: typeof req.query.includeMerged === 'string' ? req.query.includeMerged : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        limit: req.query.limit
      });
      res.json(result);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.get('/api/v2/workspaces/:workspaceKey/leads/:leadId', requireMultiSourceAdmin, async (req, res) => {
    try {
      const lead = await getWorkspaceCanonicalLead(req.params.workspaceKey, req.params.leadId);
      res.json({ lead });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.post('/api/v2/workspaces/:workspaceKey/leads/:sourceLeadId/merge', requireMultiSourceAdmin, async (req, res) => {
    try {
      const merge = await mergeWorkspaceLeads(req.params.workspaceKey, req.params.sourceLeadId, {
        targetLeadId: req.body?.targetLeadId,
        note: req.body?.note
      });
      res.json({ merge });
    } catch (error) {
      errorResponse(res, error);
    }
  });
}
