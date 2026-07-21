import { InMemoryStorage } from './inMemoryStorage';
import type { ObjectStorage } from './objectStorage';
import { R2Storage } from './r2Storage';

let storage: ObjectStorage | null = null;

function hasR2Config() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}

export function createObjectStorage() {
  if (hasR2Config()) {
    return new R2Storage({
      accountId: process.env.R2_ACCOUNT_ID || '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      bucketName: process.env.R2_BUCKET_NAME || '',
      region: process.env.R2_REGION || 'auto'
    });
  }

  return new InMemoryStorage();
}

export function getObjectStorage() {
  if (!storage) {
    storage = createObjectStorage();
  }
  return storage;
}

export function setObjectStorageForTests(testStorage: ObjectStorage | null) {
  storage = testStorage;
}
