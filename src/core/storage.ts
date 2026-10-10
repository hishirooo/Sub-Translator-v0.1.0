import { SubtitleProject, DictionaryTerm, AppSettings, LogItem, ModelConfig } from '../types';

const DB_NAME = 'SubTranslatorDB';
const DB_VERSION = 1;

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'gemini-3.8-flash',
    displayName: '3.8 Flash',
    role: 'translate',
    priority: 1,
    rpdLimit: 105,
    rpmLimit: 2,
    rpdUsed: 0,
    activeRpm: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
    isAvailable: true
  },
  {
    id: 'gemini-flash-latest',
    displayName: '3.7 Flash',
    role: 'translate',
    priority: 2,
    rpdLimit: 105,
    rpmLimit: 2,
    rpdUsed: 0,
    activeRpm: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
    isAvailable: true
  },
  {
    id: 'gemini-3.1-pro-preview',
    displayName: '3.1 Pro',
    role: 'pro-backup',
    priority: 3,
    rpdLimit: 15,
    rpmLimit: 2,
    rpdUsed: 0,
    activeRpm: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
    isAvailable: true
  },
  {
    id: 'gemini-3.1-flash-lite',
    displayName: '3.1 Flash Lite',
    role: 'lite-fix',
    priority: 1,
    rpdLimit: 500,
    rpmLimit: 2,
    rpdUsed: 0,
    activeRpm: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
    isAvailable: true
  },
  {
    id: 'gemini-3.1-flash-lite',
    displayName: '3.5 Flash Lite',
    role: 'lite-fix',
    priority: 2,
    rpdLimit: 105,
    rpmLimit: 2,
    rpdUsed: 0,
    activeRpm: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
    isAvailable: true
  }
];

export const DEFAULT_SETTINGS: AppSettings = {
  runMode: 'parallel',
  batchSizeLines: 80,
  batchSizeChars: 6000,
  contextLinesBefore: 5,
  contextLinesAfter: 3,
  proProtectionSec: 30,
  resetHourUtc: 7, // ~14:00 VN time (07:00 UTC)
  models: DEFAULT_MODELS,
  readingSpeedCpsLimit: 20,
  maxLineLength: 42
};

// Helper to upgrade any outdated model IDs saved in previous sessions
function upgradeModelId(modelId: string): string {
  if (modelId === 'gemini-2.5-flash' || modelId === 'gemini-2.0-flash' || modelId === 'gemini-1.5-flash') {
    return 'gemini-3.8-flash';
  }
  if (modelId === 'gemini-2.0-flash-lite' || modelId === 'gemini-2.5-flash-lite' || modelId === 'gemini-1.5-flash-lite') {
    return 'gemini-3.1-flash-lite';
  }
  if (modelId === 'gemini-2.5-pro' || modelId === 'gemini-2.0-pro' || modelId === 'gemini-1.5-pro') {
    return 'gemini-3.1-pro-preview';
  }
  return modelId;
}

export class AppStorage {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return resolve({} as any);
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('project')) {
          db.createObjectStore('project', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('terms')) {
          db.createObjectStore('terms', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('logs')) {
          db.createObjectStore('logs', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  public async saveProject(project: SubtitleProject): Promise<void> {
    const db = await this.dbPromise;
    if (!db.transaction) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('project', 'readwrite');
      const store = tx.objectStore('project');
      const req = store.put({ ...project, id: 'current_project' });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async loadProject(): Promise<SubtitleProject | null> {
    const db = await this.dbPromise;
    if (!db.transaction) return null;
    return new Promise((resolve) => {
      const tx = db.transaction('project', 'readonly');
      const store = tx.objectStore('project');
      const req = store.get('current_project');
      req.onsuccess = () => {
        const project = req.result as SubtitleProject | undefined;
        if (project && project.lines) {
          // Recovery: reset any lines in 'Processing' or 'Fixing' back to 'Waiting'
          for (const line of project.lines) {
            if (line.status === 'Processing' || line.status === 'Fixing') {
              line.status = 'Waiting';
            }
          }
          resolve(project);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  }

  public async saveTerms(terms: DictionaryTerm[]): Promise<void> {
    const db = await this.dbPromise;
    if (!db.transaction) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('terms', 'readwrite');
      const store = tx.objectStore('terms');
      store.clear();
      for (const t of terms) {
        store.put(t);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async loadTerms(): Promise<DictionaryTerm[]> {
    const db = await this.dbPromise;
    if (!db.transaction) return [];
    return new Promise((resolve) => {
      const tx = db.transaction('terms', 'readonly');
      const store = tx.objectStore('terms');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  public async saveSettings(settings: AppSettings): Promise<void> {
    const db = await this.dbPromise;
    if (!db.transaction) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ key: 'app_settings', data: settings });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async loadSettings(): Promise<AppSettings> {
    const db = await this.dbPromise;
    if (!db.transaction) return DEFAULT_SETTINGS;
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get('app_settings');
      req.onsuccess = () => {
        if (req.result && req.result.data) {
          const saved = req.result.data as AppSettings;
          const mergedModels = DEFAULT_MODELS.map(def => {
            const existing = saved.models?.find(m => m.displayName === def.displayName);
            if (existing) {
              return {
                ...def,
                ...existing,
                id: upgradeModelId(existing.id)
              };
            }
            return def;
          });
          resolve({ ...DEFAULT_SETTINGS, ...saved, models: mergedModels });
        } else {
          resolve(DEFAULT_SETTINGS);
        }
      };
      req.onerror = () => resolve(DEFAULT_SETTINGS);
    });
  }

  public async clearAllData(): Promise<void> {
    const db = await this.dbPromise;
    if (!db.transaction) return;
    return new Promise((resolve) => {
      const tx = db.transaction(['project', 'terms', 'settings', 'logs'], 'readwrite');
      tx.objectStore('project').clear();
      tx.objectStore('terms').clear();
      tx.objectStore('settings').clear();
      tx.objectStore('logs').clear();
      tx.oncomplete = () => resolve();
    });
  }
}

export const appStorage = new AppStorage();
