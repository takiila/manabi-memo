import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type StoredObject = { body: ReadableStream<Uint8Array> };
type ListedObject = { key: string };
type ListResult = { objects: ListedObject[]; truncated: boolean; cursor?: string };

export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, value: ArrayBuffer, contentType?: string, metadata?: Record<string, string>): Promise<void>;
  delete(key: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<ListResult>;
  hasPrefix(prefix: string): Promise<boolean>;
  deletePrefix(prefix: string): Promise<void>;
}

let sharedStore: ObjectStore | null = null;

export function getObjectStore() {
  sharedStore ??= process.env.S3_BUCKET?.trim() ? new S3ObjectStore() : new LocalObjectStore();
  return sharedStore;
}

export const objectStore = getObjectStore;

class LocalObjectStore implements ObjectStore {
  private readonly root = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.LOCAL_FILE_STORE ?? ".data/objects",
  );

  async get(key: string) {
    try {
      const bytes = await readFile(this.safePath(key));
      return { body: new Blob([bytes]).stream() };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  async put(key: string, value: ArrayBuffer) {
    const target = this.safePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(value));
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      try { await unlink(this.safePath(key)); } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
  }

  async list({ prefix, limit = 1000 }: { prefix: string; cursor?: string; limit?: number }) {
    const prefixPath = this.safePath(prefix);
    const objects: ListedObject[] = [];
    try { await walk(prefixPath, prefix, objects, limit); } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    return { objects, truncated: false };
  }

  async hasPrefix(prefix: string) {
    return (await this.list({ prefix, limit: 1 })).objects.length > 0;
  }

  async deletePrefix(prefix: string) {
    const objects = await this.list({ prefix });
    await this.delete(objects.objects.map((item) => item.key));
  }

  private safePath(key: string) {
    const target = path.resolve(this.root, key);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) throw new Error("Invalid object key.");
    return target;
  }
}

class S3ObjectStore implements ObjectStore {
  private readonly bucket = process.env.S3_BUCKET!.trim();
  private readonly client = new S3Client({
    region: process.env.S3_REGION?.trim() || "auto",
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined,
  });

  async get(key: string) {
    let result;
    try {
      result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (cause) {
      const error = cause as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null;
      throw cause;
    }
    if (!result.Body) return null;
    return { body: result.Body.transformToWebStream() };
  }

  async put(key: string, value: ArrayBuffer, contentType = "application/octet-stream", metadata?: Record<string, string>) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: new Uint8Array(value), ContentType: contentType, Metadata: metadata }));
  }

  async delete(keys: string | string[]) {
    const values = Array.isArray(keys) ? keys : [keys];
    if (values.length === 1) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: values[0] }));
      return;
    }
    await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: values.map((Key) => ({ Key })) } }));
  }

  async list({ prefix, cursor, limit }: { prefix: string; cursor?: string; limit?: number }) {
    const result = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      ContinuationToken: cursor,
      MaxKeys: limit,
    }));
    return {
      objects: (result.Contents ?? []).flatMap((item) => item.Key ? [{ key: item.Key }] : []),
      truncated: Boolean(result.IsTruncated),
      cursor: result.NextContinuationToken,
    };
  }

  async hasPrefix(prefix: string) {
    return (await this.list({ prefix, limit: 1 })).objects.length > 0;
  }

  async deletePrefix(prefix: string) {
    let cursor: string | undefined;
    do {
      const page = await this.list({ prefix, cursor });
      await this.delete(page.objects.map((item) => item.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}

async function walk(directory: string, prefix: string, output: ListedObject[], limit: number) {
  for (const entry of await readdir(directory)) {
    if (output.length >= limit) return;
    const fullPath = path.join(directory, entry);
    if ((await stat(fullPath)).isDirectory()) await walk(fullPath, `${prefix}${entry}/`, output, limit);
    else output.push({ key: `${prefix}${entry}` });
  }
}
