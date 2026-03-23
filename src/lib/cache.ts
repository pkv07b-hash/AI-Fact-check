import { AccuracyReport } from "./verifier";

/**
 * A simple in-memory LRU cache for fact-check results.
 * Limits to the 5 most recent unique queries.
 */
class FactCheckCache {
  private cache = new Map<string, AccuracyReport>();
  private order: string[] = [];
  private readonly MAX_SIZE = 5;

  get(key: string): AccuracyReport | undefined {
    const normalizedKey = key.trim().toLowerCase();
    if (this.cache.has(normalizedKey)) {
      // Move to end of order (most recently used)
      this.order = this.order.filter(k => k !== normalizedKey);
      this.order.push(normalizedKey);
      return this.cache.get(normalizedKey);
    }
    return undefined;
  }

  set(key: string, value: AccuracyReport): void {
    const normalizedKey = key.trim().toLowerCase();
    
    // If exists, remove from order first
    if (this.cache.has(normalizedKey)) {
      this.order = this.order.filter(k => k !== normalizedKey);
    } else if (this.order.length >= this.MAX_SIZE) {
      // Remove oldest
      const oldest = this.order.shift();
      if (oldest) this.cache.delete(oldest);
    }

    this.cache.set(normalizedKey, value);
    this.order.push(normalizedKey);
  }

  getAll(): { query: string, report: AccuracyReport }[] {
    // Return most recent first
    return [...this.order].reverse().map(key => ({
      query: key,
      report: this.cache.get(key)!
    }));
  }

  clear(): void {
    this.cache.clear();
    this.order = [];
  }
}

// Ensure the cache is a true singleton, even in Next.js development (HMR) environments.
const globalForCache = globalThis as unknown as {
  factCheckCache: FactCheckCache | undefined;
};

export const globalCache = globalForCache.factCheckCache ?? new FactCheckCache();

if (process.env.NODE_ENV !== "production") {
  globalForCache.factCheckCache = globalCache;
}

