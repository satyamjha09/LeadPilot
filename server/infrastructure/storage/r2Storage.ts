import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

import type { ObjectStorage, PutObjectInput } from './objectStorage';

export type R2StorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region?: string;
};

async function streamToBuffer(body: unknown) {
  if (!body || typeof (body as any).transformToByteArray !== 'function') {
    throw new Error('R2 returned an unreadable object body.');
  }
  const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}

export class R2Storage implements ObjectStorage {
  private client: S3Client;
  private bucketName: string;

  constructor(config: R2StorageConfig) {
    this.bucketName = config.bucketName;
    this.client = new S3Client({
      region: config.region || 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  async putObject(input: PutObjectInput) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType
      })
    );
  }

  async getObject(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key
      })
    );
    return streamToBuffer(response.Body);
  }

  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      })
    );
  }

  async objectExists(key: string) {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key
        })
      );
      return true;
    } catch (error) {
      if (error instanceof NoSuchKey || error instanceof NotFound || (error as any)?.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}
