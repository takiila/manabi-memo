import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  BlobNotFoundError,
  del as deleteBlob,
  get as getBlob,
  head as headBlob,
  issueSignedToken,
  list as listBlobs,
  presignUrl,
  put as putBlob,
} from "@vercel/blob";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredObject = { body: ReadableStream<Uint8Array> };
type ListedObject = { key: string };
type ListResult = { objects: ListedObject[]; truncated: boolean; cursor?: string };
export type DirectObjectTransfer = { url: string; expiresAt: number };

export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, value: ArrayBuffer, contentType?: string, metadata?: Record<string, string>): Promise<void>;
  delete(key: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<ListResult>;
  hasPrefix(prefix: string): Promise<boolean>;
  deletePrefix(prefix: string): Promise<void>;
  stat?(key: string): Promise<{ size: number } | null>;
  createDirectUpload?(key: string, options: { contentType: string; maximumSizeInBytes: number }): Promise<DirectObjectTransfer>;
  createDirectDownload?(key: string): Promise<DirectObjectTransfer>;
}

let sharedStore: ObjectStore | null = null;

export function getObjectStore() {
  sharedStore ??= hasVercelBlobConfiguration()
    ? new VercelBlobObjectStore()
    : process.env.S3_BUCKET?.trim()
      ? new S3ObjectStore()
      : new LocalObjectStore();
  return sharedStore;
}

export const objectStore = getObjectStore;

export async function inspectStoredObject(key: string, maximumSize = Number.MAX_SAFE_INTEGER) {
  const object = await objectStore().get(key);
  if (!object) return null;
  const reader = object.body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maximumSize) {
      await reader.cancel();
      return { size, sha256: "", tooLarge: true as const };
    }
    hash.update(result.value);
  }
  return { size, sha256: hash.digest("hex"), tooLarge: false as const };
}

export async function storedObjectSize(key: string) {
  const store = objectStore();
  if (store.stat) return (await store.stat(key))?.size ?? null;
  const inspected = await inspectStoredObject(key);
  return inspected?.size ?? null;
}

function hasVercelBlobConfiguration() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim()
    || (process.env.VERCEL_OIDC_TOKEN?.trim() && process.env.BLOB_STORE_ID?.trim()),
  );
}

class VercelBlobObjectStore implements ObjectStore {
  async stat(key: string) {
    try {
      const result = await headBlob(key);
      return { size: result.size };
    } catch (cause) {
      if (cause instanceof BlobNotFoundError) return null;
      throw cause;
    }
  }

  async get(key: string) {
    const result = await getBlob(key, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { body: result.stream };
  }

  async put(key: string, value: ArrayBuffer, contentType = "application/octet-stream") {
    await putBlob(key, Buffer.from(value), {
      access: "private",
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType,
    });
  }

  async delete(keys: string | string[]) {
    const values = Array.isArray(keys) ? keys : [keys];
    if (values.length === 0) return;
    await deleteBlob(values);
  }

  async list({ prefix, cursor, limit }: { prefix: string; cursor?: string; limit?: number }) {
    const result = await listBlobs({ prefix, cursor, limit, mode: "expanded" });
    return {
      objects: result.blobs.map((item) => ({ key: item.pathname })),
      truncated: result.hasMore,
      cursor: result.cursor,
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

  async createDirectUpload(key: string, options: { contentType: string; maximumSizeInBytes: number }) {
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const allowedContentTypes = [options.contentType];
    const token = await issueSignedToken({
      pathname: key,
      operations: ["put"],
      validUntil: expiresAt,
      allowedContentTypes,
      maximumSizeInBytes: options.maximumSizeInBytes,
    });
    const result = await presignUrl(token, {
      access: "private",
      operation: "put",
      pathname: key,
      validUntil: expiresAt,
      allowedContentTypes,
      maximumSizeInBytes: options.maximumSizeInBytes,
      allowOverwrite: false,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
    return { url: result.presignedUrl, expiresAt };
  }

  async createDirectDownload(key: string) {
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const token = await issueSignedToken({ pathname: key, operations: ["get"], validUntil: expiresAt });
    const result = await presignUrl(token, {
      access: "private",
      operation: "get",
      pathname: key,
      validUntil: expiresAt,
      useCache: true,
    });
    return { url: result.presignedUrl, expiresAt };
  }
}

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
    if (values.length === 0) return;
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
