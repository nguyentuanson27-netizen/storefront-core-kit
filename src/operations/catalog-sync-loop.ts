/**
 * The scheduled Pancake catalog sync.
 *
 * Capacity holds hand their accounting to the mirror only during a catalog sync whose stock read
 * started after the order was accepted (spec: core-kit-production-hardening-v1 §5.4). Without a
 * recurring sync, every sale would stay locally held and sellable capacity could only fall, and a
 * restock in Pancake would never reach the storefront. This loop is that recurrence.
 *
 * Deliberately a plain loop inside one long-running container rather than a host timer: it ships
 * with the release, is stopped with the app before migrations, and needs nothing on the VPS beyond
 * what `deploy.sh` already manages.
 */

export const DEFAULT_CATALOG_SYNC_INTERVAL_SECONDS = 300;
const MIN_CATALOG_SYNC_INTERVAL_SECONDS = 60;
const MAX_CATALOG_SYNC_INTERVAL_SECONDS = 24 * 60 * 60;

/** Reads the interval, refusing values that would hammer Pancake or silently stop syncing. */
export function parseCatalogSyncIntervalSeconds(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_CATALOG_SYNC_INTERVAL_SECONDS;
  if (!/^[1-9][0-9]*$/.test(raw.trim())) {
    throw new RangeError("CATALOG_SYNC_INTERVAL_SECONDS must be a positive whole number of seconds");
  }
  const seconds = Number(raw.trim());
  if (seconds < MIN_CATALOG_SYNC_INTERVAL_SECONDS || seconds > MAX_CATALOG_SYNC_INTERVAL_SECONDS) {
    throw new RangeError(
      `CATALOG_SYNC_INTERVAL_SECONDS must be between ${MIN_CATALOG_SYNC_INTERVAL_SECONDS} and ${MAX_CATALOG_SYNC_INTERVAL_SECONDS}`,
    );
  }
  return seconds;
}

export type CatalogSyncLoopOptions = Readonly<{
  sync: () => Promise<Readonly<{ products: number; variations: number }>>;
  intervalMs: number;
  /** Resolves after `ms`, or early when `signal` aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  log: (line: string) => void;
  now?: () => Date;
}>;

/**
 * Runs `sync` immediately, then once per interval until `signal` aborts.
 *
 * A failed run is logged and retried on the next tick rather than ending the loop: one Pancake
 * outage must not stop every later sync. Only a fixed message is logged, never the error itself,
 * because a Pancake failure can carry payload or credential context.
 */
export async function runCatalogSyncLoop(options: CatalogSyncLoopOptions): Promise<{ runs: number; failures: number }> {
  const now = options.now ?? (() => new Date());
  let runs = 0;
  let failures = 0;
  while (!options.signal.aborted) {
    runs += 1;
    try {
      const result = await options.sync();
      options.log(
        `${now().toISOString()} catalog sync ok: ${result.products} products, ${result.variations} variations`,
      );
    } catch {
      failures += 1;
      options.log(`${now().toISOString()} catalog sync failed; retrying next interval`);
    }
    if (options.signal.aborted) break;
    await options.sleep(options.intervalMs, options.signal);
  }
  return { runs, failures };
}
