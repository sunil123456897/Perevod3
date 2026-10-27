/**
 * Asynchronous Storage Engine with IndexedDB, PC Disk (/api/projects), and localStorage fallback.
 * Implements ProjectRepository with Hydration Guard to prevent initial mount race conditions,
 * and unified bundle serialization/deserialization supporting v2.5 and v4.1 formats.
 */

import type { NovelProject } from './seed-data.ts';
import type { LlmProviderConfig } from './qa-linter.ts';

const DB_NAME = 'xianxia_canon_studio_db';
const DB_VERSION = 1;
const STORE_NAME = 'novel_projects';
const KEY_ALL_NOVELS = 'all_novels_v4';
const FALLBACK_LS_KEY = 'xianxia_pipeline_studio_v4';

export type StorageEngineType =
  | 'Disk+IndexedDB'
  | 'IndexedDB'
  | 'localStorage'
  | 'seed'
  | 'in_memory';

export type SaveStorageResult =
  | 'Disk+IndexedDB'
  | 'IndexedDB'
  | 'localStorage'
  | 'in_memory'
  | 'skipped_unhydrated';

export interface LoadNovelsResult {
  novels: NovelProject[];
  engine: StorageEngineType;
}

/**
 * Seam: ProjectRepository interface decoupling storage from specific browser APIs.
 */
export interface ProjectRepository {
  loadNovels(fallbackSeed: NovelProject[]): Promise<LoadNovelsResult>;
  saveNovels(novels: NovelProject[]): Promise<SaveStorageResult>;
  clearStorage(): Promise<void>;
  isHydrated(): boolean;
  setHydrated(hydrated: boolean): void;
}

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

// Global hydration flag for default singleton browser adapter
let globalHydrationState = false;

export function isStorageHydrated(): boolean {
  return globalHydrationState;
}

export function setStorageHydrated(hydrated: boolean): void {
  globalHydrationState = hydrated;
}

/**
 * Production Browser Adapter using PC Disk (`/api/projects`), IndexedDB, and localStorage
 * with a strict Hydration Guard.
 */
export class BrowserDiskAndIdbAdapter implements ProjectRepository {
  public hydrated: boolean;

  constructor(initialHydrated = false) {
    this.hydrated = initialHydrated;
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  setHydrated(hydrated: boolean): void {
    this.hydrated = hydrated;
    setStorageHydrated(hydrated);
  }

  async loadNovels(fallbackSeed: NovelProject[]): Promise<LoadNovelsResult> {
    if (typeof window === 'undefined') {
      this.setHydrated(true);
      return { novels: fallbackSeed, engine: 'seed' };
    }

    // 1. Try local PC disk storage (`data/novels_db.json` via `/api/projects`) first
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.novels) && data.novels.length > 0) {
          this.setHydrated(true);
          return { novels: data.novels, engine: 'Disk+IndexedDB' };
        }
      }
    } catch {
      // Fall back to IndexedDB
    }

    // 2. Try browser IndexedDB
    try {
      const db = await openStudioDb();
      const loaded = await new Promise<NovelProject[] | null>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const getReq = store.get(KEY_ALL_NOVELS);
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => reject(getReq.error);
        }
      );
      db.close();

      if (Array.isArray(loaded) && loaded.length > 0) {
        // Mirror existing IndexedDB data to PC disk in the background
        fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ novels: loaded }),
        }).catch(() => {});
        this.setHydrated(true);
        return { novels: loaded, engine: 'IndexedDB' };
      }
    } catch {
      // Fall back to localStorage
    }

    // 3. Try localStorage
    try {
      const raw = window.localStorage.getItem(FALLBACK_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.setHydrated(true);
          return { novels: parsed, engine: 'localStorage' };
        }
      }
    } catch {
      // Ignore parse errors
    }

    this.setHydrated(true);
    return { novels: fallbackSeed, engine: 'seed' };
  }

  async saveNovels(novels: NovelProject[]): Promise<SaveStorageResult> {
    // Hydration guard: block overwriting disk/storage before initial read completes
    if (!this.isHydrated()) {
      return 'skipped_unhydrated';
    }

    if (typeof window === 'undefined') return 'localStorage';

    // Mirror to PC disk (`data/novels_db.json`) via `/api/projects`
    let savedToDisk = false;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novels }),
      });
      savedToDisk = res.ok;
    } catch {
      savedToDisk = false;
    }

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
      return savedToDisk ? 'Disk+IndexedDB' : 'IndexedDB';
    } catch {
      try {
        window.localStorage.setItem(FALLBACK_LS_KEY, JSON.stringify(novels));
      } catch {
        // Ignore quota errors
      }
      return 'localStorage';
    }
  }

  async clearStorage(): Promise<void> {
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
}

/**
 * Pure in-memory repository adapter for unit tests and headless execution.
 */
export class InMemoryProjectStorageAdapter implements ProjectRepository {
  public novels: NovelProject[];
  public hydrated: boolean;

  constructor(initialNovels: NovelProject[] = [], hydrated = false) {
    this.novels = [...initialNovels];
    this.hydrated = hydrated;
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  setHydrated(hydrated: boolean): void {
    this.hydrated = hydrated;
  }

  async loadNovels(fallbackSeed: NovelProject[]): Promise<LoadNovelsResult> {
    this.setHydrated(true);
    if (this.novels.length > 0) {
      return { novels: [...this.novels], engine: 'in_memory' };
    }
    this.novels = [...fallbackSeed];
    return { novels: [...fallbackSeed], engine: 'seed' };
  }

  async saveNovels(novels: NovelProject[]): Promise<SaveStorageResult> {
    if (!this.isHydrated()) {
      return 'skipped_unhydrated';
    }
    this.novels = [...novels];
    return 'in_memory';
  }

  async clearStorage(): Promise<void> {
    this.novels = [];
    this.setHydrated(false);
  }
}

// Global default repository instance
export const defaultProjectRepository = new BrowserDiskAndIdbAdapter();

export async function loadNovelsFromStorage(
  fallbackSeed: NovelProject[]
): Promise<LoadNovelsResult> {
  return defaultProjectRepository.loadNovels(fallbackSeed);
}

export async function saveNovelsToStorage(
  novels: NovelProject[]
): Promise<SaveStorageResult> {
  return defaultProjectRepository.saveNovels(novels);
}

export async function clearNovelsStorage(): Promise<void> {
  return defaultProjectRepository.clearStorage();
}

export interface SerializedProjectBundleV4 {
  version: '4.1-colab-drive-bundle';
  exportedAt: string;
  llmConfig?: LlmProviderConfig;
  project: NovelProject;
}

export interface SerializedProjectBundleV2 {
  studio_version: '2.5-idb';
  exported_at: string;
  novels: NovelProject[];
}

export interface DeserializedBundleResult {
  version: string;
  novels: NovelProject[];
  activeProject?: NovelProject;
  llmConfig?: LlmProviderConfig;
}

/**
 * Unifies project bundle serialization for Google Drive, Colab, and local JSON backups.
 */
export function serializeProjectBundle(options: {
  novel?: NovelProject;
  novels?: NovelProject[];
  llmConfig?: LlmProviderConfig;
  format?: 'v4.1' | 'v2.5';
}): string {
  const { novel, novels = [], llmConfig, format = 'v4.1' } = options;

  if (format === 'v2.5') {
    const payload: SerializedProjectBundleV2 = {
      studio_version: '2.5-idb',
      exported_at: new Date().toISOString(),
      novels: novels.length > 0 ? novels : novel ? [novel] : [],
    };
    return JSON.stringify(payload, null, 2);
  }

  const targetProject = novel || novels[0];
  if (!targetProject) {
    throw new Error('Cannot serialize v4.1 bundle without at least one novel');
  }

  const payload: SerializedProjectBundleV4 = {
    version: '4.1-colab-drive-bundle',
    exportedAt: new Date().toISOString(),
    llmConfig,
    project: targetProject,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Unifies project bundle deserialization, accepting v4.1, v2.5, array of novels, or raw single novel.
 */
export function deserializeProjectBundle(
  rawInput: unknown
): DeserializedBundleResult {
  const parsed: any =
    typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid bundle payload: root must be an object or array');
  }

  // Format 1: v4.1 Colab Drive Bundle
  if (parsed.version === '4.1-colab-drive-bundle' && parsed.project?.id) {
    const proj = parsed.project as NovelProject;
    return {
      version: '4.1-colab-drive-bundle',
      novels: [proj],
      activeProject: proj,
      llmConfig: parsed.llmConfig as LlmProviderConfig | undefined,
    };
  }

  // Format 2: v2.5 IDB Backup
  if (
    (parsed.studio_version === '2.5-idb' || Array.isArray(parsed.novels)) &&
    Array.isArray(parsed.novels)
  ) {
    const novelsList = parsed.novels as NovelProject[];
    return {
      version: parsed.studio_version || '2.5-idb',
      novels: novelsList,
      activeProject: novelsList[0],
    };
  }

  // Format 3: Raw array of NovelProjects
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.id) {
    const novelsList = parsed as NovelProject[];
    return {
      version: 'raw-array',
      novels: novelsList,
      activeProject: novelsList[0],
    };
  }

  // Format 4: Raw single NovelProject
  if (parsed.id && Array.isArray(parsed.chapters)) {
    const proj = parsed as NovelProject;
    return {
      version: 'single-novel',
      novels: [proj],
      activeProject: proj,
    };
  }

  throw new Error('Unrecognized project bundle format');
}
