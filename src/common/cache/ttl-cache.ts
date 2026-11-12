/**
 * A tiny in-memory cache for public, rarely-changing lists (directory categories, a store's facets).
 * Entries live for `ttlMs`; concurrent requests for the same key share one load. Per server instance,
 * which is fine for data that is allowed to be a minute old.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();
  private readonly loading = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const pending = this.loading.get(key);
    if (pending) return pending;
    const p = load()
      .then((value) => {
        if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
        this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  clear() {
    this.entries.clear();
  }
}
