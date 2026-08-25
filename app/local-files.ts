import { settleWithin } from "./async-deadline";

const DATABASE_NAME = "manabi-memo-local-files";
const DATABASE_VERSION = 2;
const PDF_STORE = "pdfs";
const STATE_STORE = "app-state";
const METRIC_STORE = "local-metrics";
const CURRENT_STATE_KEY = "current";
const MAX_LOCAL_METRICS = 1000;

export type StoredAppState<T> = {
  schemaVersion: number;
  revision: number;
  savedAt: string;
  writerId?: string;
  data: T;
};

export type LocalMetric = {
  id?: number;
  name: string;
  at: string;
  properties: Record<string, string | number | boolean>;
};

export type StorageHealth = {
  persisted: boolean;
  usage: number;
  quota: number;
};

type PdfEntry = { id: string; blob: Blob };
type CommitOptions = {
  schemaVersion?: number;
  expectedRevision?: number;
  writerId?: string;
};

export async function savePdfToDevice(id: string, file: Blob) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PDF_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(PDF_STORE).put(file, id);
    await done;
  } finally {
    database.close();
  }
}

export async function loadPdfFromDevice(id: string): Promise<Blob | null> {
  const database = await openDatabase();
  try {
    const result = await requestAsPromise<Blob | undefined>(
      database.transaction(PDF_STORE, "readonly").objectStore(PDF_STORE).get(id),
    );
    return result ?? null;
  } finally {
    database.close();
  }
}

export async function loadAllPdfs(): Promise<PdfEntry[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PDF_STORE, "readonly");
    const store = transaction.objectStore(PDF_STORE);
    const [keys, blobs] = await Promise.all([
      requestAsPromise<IDBValidKey[]>(store.getAllKeys()),
      requestAsPromise<Blob[]>(store.getAll()),
    ]);
    return blobs.map((blob, index) => ({ id: String(keys[index]), blob }));
  } finally {
    database.close();
  }
}

export async function deletePdfFromDevice(id: string) {
  await deletePdfsFromDevice([id]);
}

export async function deletePdfsFromDevice(ids: string[]) {
  if (ids.length === 0) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PDF_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(PDF_STORE);
    for (const id of new Set(ids)) store.delete(id);
    await done;
  } finally {
    database.close();
  }
}

export async function replacePdfs(entries: PdfEntry[], replace: boolean) {
  validatePdfEntries(entries);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PDF_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(PDF_STORE);
    if (replace) store.clear();
    for (const entry of entries) store.put(entry.blob, entry.id);
    await done;
  } finally {
    database.close();
  }
}

export async function saveAppState<T>(
  data: T,
  schemaVersion = 8,
  expectedRevision?: number,
  writerId?: string,
): Promise<StoredAppState<T>> {
  return commitAppState(data, {}, { schemaVersion, expectedRevision, writerId });
}

export async function saveAppStateAndPdf<T>(
  data: T,
  pdf: PdfEntry,
  schemaVersion = 8,
  expectedRevision?: number,
  writerId?: string,
): Promise<StoredAppState<T>> {
  return commitAppState(data, { putPdfs: [pdf] }, { schemaVersion, expectedRevision, writerId });
}

export async function saveAppStateAndDeletePdfs<T>(
  data: T,
  pdfIds: string[],
  schemaVersion = 8,
  expectedRevision?: number,
  writerId?: string,
): Promise<StoredAppState<T>> {
  return commitAppState(data, { deletePdfIds: pdfIds }, { schemaVersion, expectedRevision, writerId });
}

export async function loadAppState<T>(): Promise<StoredAppState<T> | null> {
  const database = await settleWithin(
    openDatabase(),
    8_000,
    "端末の保存領域から8秒以内に応答がありませんでした。データは変更していません。",
  );
  try {
    const result = await requestAsPromise<StoredAppState<T> | undefined>(
      database.transaction(STATE_STORE, "readonly").objectStore(STATE_STORE).get(CURRENT_STATE_KEY),
    );
    return result ?? null;
  } finally {
    database.close();
  }
}

export async function restoreAppStateAndPdfs<T>(
  data: T,
  entries: PdfEntry[],
  replace: boolean,
  schemaVersion = 8,
  expectedRevision?: number,
  writerId?: string,
): Promise<StoredAppState<T>> {
  return commitAppState(
    data,
    { putPdfs: entries, clearPdfs: replace },
    { schemaVersion, expectedRevision, writerId },
  );
}

export async function recordLocalMetric(
  name: string,
  properties: Record<string, string | number | boolean> = {},
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(METRIC_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(METRIC_STORE);
    store.add({ name, at: new Date().toISOString(), properties } satisfies LocalMetric);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let deleteCount = Math.max(0, countRequest.result - MAX_LOCAL_METRICS);
      if (deleteCount === 0) return;
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || deleteCount === 0) return;
        cursor.delete();
        deleteCount -= 1;
        cursor.continue();
      };
    };
    await done;
  } finally {
    database.close();
  }
}

export async function loadLocalMetricSummary() {
  const database = await openDatabase();
  try {
    const metrics = await requestAsPromise<LocalMetric[]>(
      database.transaction(METRIC_STORE, "readonly").objectStore(METRIC_STORE).getAll(),
    );
    const counts: Record<string, number> = {};
    for (const metric of metrics) counts[metric.name] = (counts[metric.name] ?? 0) + 1;
    return {
      counts,
      total: metrics.length,
      firstAt: metrics[0]?.at ?? null,
      lastAt: metrics.at(-1)?.at ?? null,
    };
  } finally {
    database.close();
  }
}

export async function clearLocalMetrics() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(METRIC_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(METRIC_STORE).clear();
    await done;
  } finally {
    database.close();
  }
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const estimate = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();
  return {
    persisted: Boolean(persisted),
    usage: estimate?.usage ?? 0,
    quota: estimate?.quota ?? 0,
  };
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

async function commitAppState<T>(
  data: T,
  changes: { putPdfs?: PdfEntry[]; deletePdfIds?: string[]; clearPdfs?: boolean },
  options: CommitOptions,
): Promise<StoredAppState<T>> {
  validatePdfEntries(changes.putPdfs ?? []);
  const database = await openDatabase();
  try {
    const usesPdfs = Boolean(changes.clearPdfs || changes.putPdfs?.length || changes.deletePdfIds?.length);
    const transaction = database.transaction(usesPdfs ? [STATE_STORE, PDF_STORE] : STATE_STORE, "readwrite");
    const done = transactionDone(transaction);
    const stateStore = transaction.objectStore(STATE_STORE);
    const previous = await requestAsPromise<StoredAppState<T> | undefined>(stateStore.get(CURRENT_STATE_KEY));
    if (
      typeof options.expectedRevision === "number"
      && (previous?.revision ?? 0) !== options.expectedRevision
    ) {
      transaction.abort();
      await ignoreRejection(done);
      throw storageConflictError();
    }

    const record: StoredAppState<T> = {
      schemaVersion: options.schemaVersion ?? 8,
      revision: (previous?.revision ?? 0) + 1,
      savedAt: new Date().toISOString(),
      writerId: options.writerId,
      data,
    };
    if (usesPdfs) {
      const pdfStore = transaction.objectStore(PDF_STORE);
      if (changes.clearPdfs) pdfStore.clear();
      for (const id of new Set(changes.deletePdfIds ?? [])) pdfStore.delete(id);
      for (const entry of changes.putPdfs ?? []) pdfStore.put(entry.blob, entry.id);
    }
    stateStore.put(record, CURRENT_STATE_KEY);
    await done;
    return record;
  } finally {
    database.close();
  }
}

function validatePdfEntries(entries: PdfEntry[]) {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id) || !(entry.blob instanceof Blob)) {
      throw new TypeError("PDFデータが不正です");
    }
    ids.add(entry.id);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PDF_STORE)) database.createObjectStore(PDF_STORE);
      if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE);
      if (!database.objectStoreNames.contains(METRIC_STORE)) {
        database.createObjectStore(METRIC_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("端末内の保存領域を開けませんでした"));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("別のタブが保存領域を使用しています"));
    };
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("端末内への保存に失敗しました"));
    transaction.onabort = () => reject(transaction.error ?? new Error("端末内への保存が中断されました"));
  });
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("端末内への保存に失敗しました"));
  });
}

function storageConflictError() {
  const error = new Error("STORAGE_CONFLICT");
  error.name = "StorageConflictError";
  return error;
}

async function ignoreRejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch {
    // The caller receives the more useful STORAGE_CONFLICT error.
  }
}
