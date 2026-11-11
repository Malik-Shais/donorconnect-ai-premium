import "server-only";

/** Optional server-side timing (off unless PERF_LOG=1): one JSON line per call, visible in the platform's runtime logs. Never logs arguments or data. */
export async function timed<T>(label: string, fn: () => Promise<T> | PromiseLike<T>): Promise<T> {
  if (process.env.PERF_LOG !== "1") return fn();
  const t0 = performance.now();
  try { return await fn(); } finally { console.log(JSON.stringify({ perf: label, ms: Math.round(performance.now() - t0) })); }
}
