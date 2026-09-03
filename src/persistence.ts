import type { PlannedExpense, Settings, Transaction } from "./FinanceApp";

const DB_NAME = "zhiyu-finance";
const DB_VERSION = 1;
const STATE_STORE = "state";
const SNAPSHOT_STORE = "snapshots";
const STATE_KEY = "current";

export type PersistedAppState = {
  schemaVersion: 1;
  savedAt: string;
  lastBackupAt?: string;
  appliedSetupId: string;
  transactions: Transaction[];
  settings: Settings;
  plannedExpenses: PlannedExpense[];
};

export type StorageHealth = {
  available: boolean;
  persistent: boolean;
  usage?: number;
  quota?: number;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本机数据库操作失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("本机数据库写入失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本机数据库写入已取消"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("当前浏览器不支持本机数据库"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE);
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) database.createObjectStore(SNAPSHOT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本机数据库"));
  });
}

export async function loadPersistentState(): Promise<PersistedAppState | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STATE_STORE, "readonly");
    const result = await requestResult(transaction.objectStore(STATE_STORE).get(STATE_KEY));
    return (result as PersistedAppState | undefined) ?? null;
  } finally {
    database.close();
  }
}

export async function savePersistentState(state: PersistedAppState): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([STATE_STORE, SNAPSHOT_STORE], "readwrite");
    transaction.objectStore(STATE_STORE).put(state, STATE_KEY);

    // Keep one local recovery point per day. It is not a replacement for iCloud,
    // but protects against an accidental edit while Safari storage is intact.
    const dayKey = state.savedAt.slice(0, 10);
    transaction.objectStore(SNAPSHOT_STORE).put(state, dayKey);
    await transactionDone(transaction);
    await pruneSnapshots(database, 30);
  } finally {
    database.close();
  }
}

async function pruneSnapshots(database: IDBDatabase, keep: number): Promise<void> {
  const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
  const store = transaction.objectStore(SNAPSHOT_STORE);
  const keys = await requestResult(store.getAllKeys());
  keys.map(String).sort().slice(0, Math.max(0, keys.length - keep)).forEach((key) => store.delete(key));
  await transactionDone(transaction);
}

export async function verifyPersistentState(expected: PersistedAppState): Promise<{ ok: boolean; message: string }> {
  await savePersistentState(expected);
  const actual = await loadPersistentState();
  if (!actual) return { ok: false, message: "没有读到本机数据库，请立即导出备份" };
  const matches = actual.transactions.length === expected.transactions.length
    && actual.plannedExpenses.length === expected.plannedExpenses.length
    && actual.settings.monthlyBudget === expected.settings.monthlyBudget;
  return matches
    ? { ok: true, message: `检查通过：${actual.transactions.length}笔流水、${actual.plannedExpenses.length}项计划均已保存` }
    : { ok: false, message: "本机数据数量不一致，请立即导出备份并重新打开知余" };
}

export async function requestDurableStorage(): Promise<StorageHealth> {
  if (!("storage" in navigator)) return { available: false, persistent: false };
  let persistent = false;
  try {
    persistent = await navigator.storage.persisted();
    if (!persistent) persistent = await navigator.storage.persist();
  } catch {
    persistent = false;
  }
  try {
    const estimate = await navigator.storage.estimate();
    return { available: true, persistent, usage: estimate.usage, quota: estimate.quota };
  } catch {
    return { available: true, persistent };
  }
}
