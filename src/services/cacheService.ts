interface CacheEntry<T> {
  data: T;
  createdAt: number;
  accessCount: number;
  lastAccessed: number;
}

interface CacheOptions {
  ttl?: number; // ms, default 5min
}

const DEFAULT_TTL = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

class IntelligentCache {
  private cache = new Map<string, CacheEntry<any>>();
  private inflight = new Map<string, Promise<any>>();

  async get<T>(key: string, fetcher: () => Promise<T>, options?: CacheOptions): Promise<T> {
    const cached = this.cache.get(key);
    const ttl = options?.ttl ?? DEFAULT_TTL;

    if (cached && (Date.now() - cached.createdAt) < ttl) {
      cached.accessCount++;
      cached.lastAccessed = Date.now();
      return cached.data as T;
    }

    // Deduplicate inflight requests
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fetcher().then(data => {
      this.set(key, data);
      this.inflight.delete(key);
      return data;
    }).catch(err => {
      this.inflight.delete(key);
      throw err;
    });

    this.inflight.set(key, promise);
    return promise;
  }

  private set<T>(key: string, data: T): void {
    if (this.cache.size >= MAX_ENTRIES) {
      this.evictLRU();
    }
    this.cache.set(key, {
      data,
      createdAt: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
    });
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  preload(keys: string[], fetchers: Record<string, () => Promise<any>>): void {
    keys.forEach(key => {
      const fetcher = fetchers[key];
      if (fetcher) this.get(key, fetcher);
    });
  }

  getStats() {
    let totalHits = 0;
    this.cache.forEach(entry => { totalHits += entry.accessCount; });
    return {
      entries: this.cache.size,
      maxEntries: MAX_ENTRIES,
      totalHits,
      inflight: this.inflight.size,
    };
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache.entries()) {
      const score = entry.lastAccessed - (entry.accessCount * 1000);
      if (score < oldestTime) {
        oldestTime = score;
        oldestKey = key;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }
}

export const intelligentCache = new IntelligentCache();
