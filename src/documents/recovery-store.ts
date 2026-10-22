export interface RecoverySnapshot {
  text: string;
  path: string | null;
  updated: number;
}

export interface DocumentVersion extends RecoverySnapshot {
  id: string;
}

const DATABASE_NAME = "typenova-data";
const DATABASE_VERSION = 2;
const RECOVERY_STORE = "recovery";
const VERSIONS_STORE = "versions";
const MAX_VERSIONS = 20;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECOVERY_STORE)) database.createObjectStore(RECOVERY_STORE);
      if (!database.objectStoreNames.contains(VERSIONS_STORE)) database.createObjectStore(VERSIONS_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the recovery database"));
    request.onblocked = () => reject(new Error("The recovery database upgrade is blocked by another open connection"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("The recovery database transaction was aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("The recovery database transaction failed"));
  });
}

export async function readRecoverySnapshot(): Promise<RecoverySnapshot | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readonly");
    const result = await new Promise<unknown>((resolve, reject) => {
      const request = transaction.objectStore(RECOVERY_STORE).get("last");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not read the recovery snapshot"));
    });
    if (!result || typeof result !== "object") return undefined;
    const candidate = result as Partial<RecoverySnapshot>;
    if (typeof candidate.text !== "string" || !(typeof candidate.path === "string" || candidate.path === null)
      || typeof candidate.updated !== "number" || !Number.isFinite(candidate.updated)) return undefined;
    return { text: candidate.text, path: candidate.path, updated: candidate.updated };
  } finally {
    database.close();
  }
}

export async function writeRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(RECOVERY_STORE).put(snapshot, "last");
    await done;
  } finally {
    database.close();
  }
}

export async function saveDocumentVersion(text: string, path: string | null): Promise<void> {
  if (!text) return;
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    const transaction = database.transaction(VERSIONS_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(VERSIONS_STORE);
    const now = Date.now();
    store.add({ id: `${now}-${Math.random().toString(36).slice(2)}`, text, path, updated: now } satisfies DocumentVersion);
    const request = store.getAll();
    request.onsuccess = () => {
      const versions = (request.result as DocumentVersion[]).sort((left, right) => right.updated - left.updated);
      for (const oldVersion of versions.slice(MAX_VERSIONS)) store.delete(oldVersion.id);
    };
    request.onerror = () => transaction.abort();
    await done;
  } catch {
    // Recovery history is best-effort and must never block editing or saving.
  } finally {
    database?.close();
  }
}

export async function listDocumentVersions(): Promise<DocumentVersion[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VERSIONS_STORE, "readonly");
    const request = transaction.objectStore(VERSIONS_STORE).getAll();
    const result = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not read version history"));
    });
    if (!Array.isArray(result)) return [];
    return result.filter((value): value is DocumentVersion => {
      if (!value || typeof value !== "object") return false;
      const item = value as Partial<DocumentVersion>;
      return typeof item.id === "string" && typeof item.text === "string"
        && (typeof item.path === "string" || item.path === null)
        && typeof item.updated === "number" && Number.isFinite(item.updated);
    }).sort((left, right) => right.updated - left.updated);
  } finally {
    database.close();
  }
}
