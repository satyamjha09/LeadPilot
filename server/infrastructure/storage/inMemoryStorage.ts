import type { ObjectStorage, PutObjectInput } from './objectStorage';

export class InMemoryStorage implements ObjectStorage {
  private objects = new Map<string, Buffer>();

  async putObject(input: PutObjectInput) {
    this.objects.set(input.key, Buffer.from(input.body));
  }

  async getObject(key: string) {
    const object = this.objects.get(key);
    if (!object) {
      throw new Error(`Object not found: ${key}`);
    }
    return Buffer.from(object);
  }

  async deleteObject(key: string) {
    this.objects.delete(key);
  }

  async objectExists(key: string) {
    return this.objects.has(key);
  }
}
