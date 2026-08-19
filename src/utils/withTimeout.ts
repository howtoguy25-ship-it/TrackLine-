// Real, confirmed bug this fixes: several real network calls (Google Places nearby search,
// the getFuelPrices Firebase callable) had no timeout at all -- on a genuinely weak/flaky
// connection (screenshot evidence: 1 signal bar), a hung request left the UI showing "Finding
// X nearby..." indefinitely, with no error, no retry, and no way out short of force-closing the
// app. This doesn't cancel the underlying request (a plain fetch()/httpsCallable() has no clean
// way to do that from here without threading an AbortController through every call site) -- it
// just races a timer against it so the CALLER always gets a real, bounded answer (a rejection
// after `ms`) even if the original request keeps running unseen in the background.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
