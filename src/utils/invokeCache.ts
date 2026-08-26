import { invoke } from '@tauri-apps/api/core';

/**
 * Read-only IPC coalescing.
 *
 * Startup fans out the same read across a dozen independent effects: boot
 * traces showed `get_general_config` issued six times and
 * `get_provider_current_account_id` eight times, all within a few milliseconds
 * of each other, plus repeated Antigravity install scans that take seconds
 * apiece. Every duplicate occupies a slot in Tauri's blocking pool, so the
 * cheap reads queued behind them finish far later than they should.
 *
 * Sharing the in-flight promise is transparent: concurrent identical reads
 * cannot observe a difference, because there is no interleaved write they could
 * have raced against. A TTL is opt-in and only appropriate for values that the
 * backend does not change underneath us.
 */

interface CacheEntry {
  startedAt: number;
  settledAt: number | null;
  promise: Promise<unknown>;
}

const entries = new Map<string, CacheEntry>();

function keyFor(command: string, args?: Record<string, unknown>): string {
  if (!args) return command;
  // Stable key: sort so `{a,b}` and `{b,a}` share an entry.
  const sorted = Object.keys(args)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = args[k];
      return acc;
    }, {});
  return `${command}|${JSON.stringify(sorted)}`;
}

export interface CoalesceOptions {
  /** Reuse an already-settled result for this many ms. Defaults to 0 (in-flight only). */
  ttlMs?: number;
  /**
   * Gate for TTL reuse: return false to drop the settled value immediately
   * (in-flight sharing still applies). Lets callers cache positive answers
   * without freezing a miss for the whole TTL.
   */
  cacheValue?: (value: unknown) => boolean;
}

export function coalescedInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  options: CoalesceOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? 0;
  const key = keyFor(command, args);
  const existing = entries.get(key);

  if (existing) {
    const stillRunning = existing.settledAt === null;
    const withinTtl =
      existing.settledAt !== null && Date.now() - existing.settledAt <= ttlMs;
    if (stillRunning || withinTtl) {
      return existing.promise as Promise<T>;
    }
  }

  const entry: CacheEntry = { startedAt: Date.now(), settledAt: null, promise: null as never };
  // A rejected read must never be cached, otherwise one transient failure is
  // replayed to every later caller.
  entry.promise = invoke<T>(command, args).then(
    (value) => {
      entry.settledAt = Date.now();
      const keep = ttlMs > 0 && (options.cacheValue?.(value) ?? true);
      if (!keep) entries.delete(key);
      return value;
    },
    (error) => {
      entries.delete(key);
      throw error;
    },
  );
  entries.set(key, entry);
  return entry.promise as Promise<T>;
}

/** Drop cached results so the next read hits the backend again. */
export function invalidateInvokeCache(command?: string): void {
  if (!command) {
    entries.clear();
    return;
  }
  for (const key of [...entries.keys()]) {
    if (key === command || key.startsWith(`${command}|`)) entries.delete(key);
  }
}
