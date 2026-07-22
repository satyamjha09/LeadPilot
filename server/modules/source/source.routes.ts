import type express from 'express';
import multer from 'multer';

import { requireMultiSourceAdmin } from './sourceAdminAuth';
import { toSourceHttpError } from './sourceErrors';
import {
  getWorkspaceCurrentSourceRow,
  getWorkspaceSourceSnapshot,
  ingestWorkspaceSourceTab,
  ingestWorkspaceSource,
  listWorkspaceCurrentSourceRows,
  listWorkspaceSourceSnapshots,
  prepareSelectedTabProcessing
} from './ingestion/sourceIngestion.service';
import {
  archiveWorkspaceSource,
  getWorkspaceSource,
  listWorkspaceSources,
  registerExcelSource,
  registerGoogleSheetsSource,
  renameWorkspaceSource,
  setSourceSyncEnabled,
  setSourceTabEnabled,
  validateWorkspaceSource
} from './source.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function sanitizeTab(tab: any) {
  return {
    id: tab.id,
    externalTabId: tab.externalTabId,
    name: tab.name,
    position: tab.position,
    isEnabled: tab.isEnabled,
    headers: tab.headersJson,
    headerHash: tab.headerHash,
    rowCount: tab.rowCount,
    lastSyncedAt: tab.lastSyncedAt,
    lastError: tab.lastError
  };
}

function sanitizeSource(source: any) {
  if (!source) return null;
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    type: source.type,
    displayName: source.displayName,
    externalFileId: source.externalFileId,
    originalFileName: source.originalFileName,
    mimeType: source.mimeType,
    checksum: source.checksum,
    fileSize: source.fileSize,
    googleAccountKey: source.googleAccountKey,
    connectionStatus: source.connectionStatus,
    syncEnabled: source.syncEnabled,
    lastValidatedAt: source.lastValidatedAt,
    lastSyncedAt: source.lastSyncedAt,
    lastSyncStatus: source.lastSyncStatus,
    lastError: source.lastError,
    archivedAt: source.archivedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    tabs: (source.tabs || []).map(sanitizeTab)
  };
}

function errorResponse(res: express.Response, error: unknown) {
  const httpError = toSourceHttpError(error);
  return res.status(httpError.statusCode).json({ error: httpError.message, code: httpError.code });
}

function uploadExcel(req: express.Request, res: express.Response, next: express.NextFunction) {
  upload.single('file')(req, res, (error) => {
    if (error) {
      return errorResponse(res, error);
    }
    return next();
  });
}

export function registerSourceRoutes(app: express.Express) {
  const router = app.route.bind(app);

  router('/api/v2/workspaces/:workspaceKey/sources').get(requireMultiSourceAdmin, async (req, res) => {
    try {
      const sources = await listWorkspaceSources(req.params.workspaceKey);
      res.json({ sources: sources.map(sanitizeSource) });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId').get(requireMultiSourceAdmin, async (req, res) => {
    try {
      const source = await getWorkspaceSource(req.params.workspaceKey, req.params.sourceId);
      res.json({ source: sanitizeSource(source) });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/ingest').post(requireMultiSourceAdmin, async (req, res) => {
    try {
      const snapshot = await ingestWorkspaceSource(req.params.workspaceKey, req.params.sourceId);
      res.status(200).json({ snapshot });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/tabs/:tabId/ingest').post(
    requireMultiSourceAdmin,
    async (req, res) => {
      try {
        const snapshot = await ingestWorkspaceSourceTab(req.params.workspaceKey, req.params.sourceId, req.params.tabId);
        res.status(200).json({ snapshot });
      } catch (error) {
        errorResponse(res, error);
      }
    }
  );

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/tabs/:tabId/prepare-processing').post(
    requireMultiSourceAdmin,
    async (req, res) => {
      try {
        const result = await prepareSelectedTabProcessing(req.params.workspaceKey, req.params.sourceId, req.params.tabId);
        res.status(200).json(result);
      } catch (error) {
        errorResponse(res, error);
      }
    }
  );

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/snapshots').get(requireMultiSourceAdmin, async (req, res) => {
    try {
      const result = await listWorkspaceSourceSnapshots(
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

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/snapshots/:snapshotId').get(
    requireMultiSourceAdmin,
    async (req, res) => {
      try {
        const snapshot = await getWorkspaceSourceSnapshot(
          req.params.workspaceKey,
          req.params.sourceId,
          req.params.snapshotId
        );
        res.json({ snapshot });
      } catch (error) {
        errorResponse(res, error);
      }
    }
  );

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/rows').get(requireMultiSourceAdmin, async (req, res) => {
    try {
      const result = await listWorkspaceCurrentSourceRows(req.params.workspaceKey, req.params.sourceId, {
        tabId: typeof req.query.tabId === 'string' ? req.query.tabId : undefined,
        active: typeof req.query.active === 'string' ? req.query.active : undefined,
        validationStatus:
          req.query.validationStatus === 'VALID' ||
          req.query.validationStatus === 'WARNING' ||
          req.query.validationStatus === 'INVALID'
            ? req.query.validationStatus
            : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        limit: req.query.limit
      });
      res.json(result);
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/rows/:rowId').get(requireMultiSourceAdmin, async (req, res) => {
    try {
      const row = await getWorkspaceCurrentSourceRow(req.params.workspaceKey, req.params.sourceId, req.params.rowId);
      res.json({ row });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router('/api/v2/workspaces/:workspaceKey/sources/google-sheets').post(requireMultiSourceAdmin, async (req, res) => {
    try {
      const result = await registerGoogleSheetsSource(req.params.workspaceKey, {
        sheetUrl: req.body?.sheetUrl,
        displayName: req.body?.displayName
      });
      res.status(result.created ? 201 : 200).json({
        created: result.created,
        source: sanitizeSource(result.source)
      });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router('/api/v2/workspaces/:workspaceKey/sources/excel').post(
    requireMultiSourceAdmin,
    uploadExcel,
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'Excel file is required.' });
        }

        const result = await registerExcelSource(req.params.workspaceKey, {
          buffer: req.file.buffer,
          originalFileName: req.file.originalname,
          mimeType: req.file.mimetype,
          displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : undefined
        });

        return res.status(result.created ? 201 : 200).json({
          created: result.created,
          source: sanitizeSource(result.source)
        });
      } catch (error) {
        return errorResponse(res, error);
      }
    }
  );

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/validate').post(requireMultiSourceAdmin, async (req, res) => {
    try {
      const source = await validateWorkspaceSource(req.params.workspaceKey, req.params.sourceId);
      res.json({ source: sanitizeSource(source) });
    } catch (error) {
      errorResponse(res, error);
    }
  });

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId').patch(requireMultiSourceAdmin, async (req, res) => {
    try {
      let source = null;
      if (typeof req.body?.displayName === 'string') {
        source = await renameWorkspaceSource(req.params.workspaceKey, req.params.sourceId, req.body.displayName);
      }
      if (typeof req.body?.syncEnabled === 'boolean') {
        source = await setSourceSyncEnabled(req.params.workspaceKey, req.params.sourceId, req.body.syncEnabled);
      }
      if (!source) {
        return res.status(400).json({ error: 'displayName or syncEnabled is required.' });
      }
      return res.json({ source: sanitizeSource(source) });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId/tabs/:tabId').patch(
    requireMultiSourceAdmin,
    async (req, res) => {
      try {
        if (typeof req.body?.isEnabled !== 'boolean') {
          return res.status(400).json({ error: 'isEnabled must be a boolean.' });
        }
        const source = await setSourceTabEnabled(
          req.params.workspaceKey,
          req.params.sourceId,
          req.params.tabId,
          req.body.isEnabled
        );
        return res.json({ source: sanitizeSource(source) });
      } catch (error) {
        return errorResponse(res, error);
      }
    }
  );

  router('/api/v2/workspaces/:workspaceKey/sources/:sourceId').delete(requireMultiSourceAdmin, async (req, res) => {
    try {
      const source = await archiveWorkspaceSource(req.params.workspaceKey, req.params.sourceId);
      res.json({ source: sanitizeSource(source) });
    } catch (error) {
      errorResponse(res, error);
    }
  });
}
