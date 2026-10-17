/**
 * Asynchronous IndexedDB Storage Engine with automatic fallback to localStorage.
 * Supports storing hundreds of megabytes of web-novel chapters, glossaries, and revision history
 * without hitting the 5MB localStorage quota limit.
 */

import type { NovelProject } from './seed-data';

const DB_NAME = 'xianxia_canon_studio_db';
const DB_VERSION = 1;
const STORE_NAME = 'novel_projects';
const KEY_ALL_NOVELS = 'all_novels_v4';
const FALLBACK_LS_KEY = 'xianxia_pipeline_studio_v4';

function openStudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
  });
}

export async function loadNovelsFromStorage(
  fallbackSeed: NovelProject[]
): Promise<{ novels: NovelProject[]; engine: 'IndexedDB' | 'localStorage' | 'seed' }> {
  if (typeof window === 'undefined') {
    return { novels: fallbackSeed, engine: 'seed' };
  }

  try {
    const db = await openStudioDb();
    const loaded = await new Promise<NovelProject[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(KEY_ALL_NOVELS);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => reject(getReq.error);
    });
    db.close();

    if (Array.isArray(loaded) && loaded.length > 0) {
      return { novels: loaded, engine: 'IndexedDB' };
    }
  } catch {
    // Fall back to localStorage
  }

  try {
    const raw = window.localStorage.getItem(FALLBACK_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { novels: parsed, engine: 'localStorage' };
      }
    }
  } catch {
    // Ignore parse errors
  }

  return { novels: fallbackSeed, engine: 'seed' };
}

export async function saveNovelsToStorage(
  novels: NovelProject[]
): Promise<'IndexedDB' | 'localStorage'> {
  if (typeof window === 'undefined') return 'localStorage';

  try {
    const db = await openStudioDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const putReq = store.put(novels, KEY_ALL_NOVELS);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });
    db.close();
    return 'IndexedDB';
  } catch {
    try {
      window.localStorage.setItem(FALLBACK_LS_KEY, JSON.stringify(novels));
    } catch {
      // Ignore quota errors
    }
    return 'localStorage';
  }
}

export async function clearNovelsStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openStudioDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const delReq = store.delete(KEY_ALL_NOVELS);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => reject(delReq.error);
    });
    db.close();
  } catch {
    // Ignore
  }
  try {
    window.localStorage.removeItem(FALLBACK_LS_KEY);
  } catch {
    // Ignore
  }
}
