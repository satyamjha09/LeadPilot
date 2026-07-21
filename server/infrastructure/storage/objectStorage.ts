export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
}

export function safeFilename(value: string) {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 150);

  return sanitized || 'source-file';
}

export function buildSourceObjectKey(input: {
  workspaceKey: string;
  externalFileId: string;
  originalFileName: string;
}) {
  return [
    'workspaces',
    input.workspaceKey,
    'sources',
    input.externalFileId,
    'original',
    safeFilename(input.originalFileName)
  ].join('/');
}
