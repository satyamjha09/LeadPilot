import type express from 'express';
import multer from 'multer';

import { requireMultiSourceAdmin } from './sourceAdminAuth';
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
  const message = error instanceof Error ? error.message : 'Request failed.';
  const status = /not found/i.test(message) ? 404 : /invalid|unsupported|required|must/i.test(message) ? 400 : 500;
  return res.status(status).json({ error: message });
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
    upload.single('file'),
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
