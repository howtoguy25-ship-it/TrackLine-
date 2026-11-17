// Calls a Cloud Function. @firebase/functions is loaded on use (see services/alerts.ts).
export class CallError extends Error {
  code: string;
  details: Record<string, unknown> | null;
  constructor(code: string, message: string, details: Record<string, unknown> | null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export async function callFn<T>(name: string, data: unknown): Promise<T> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { httpsCallable } = require("@firebase/functions") as typeof import("@firebase/functions");
  const { functions } = require("@/services/firebase") as typeof import("@/services/firebase");
  /* eslint-enable @typescript-eslint/no-require-imports */
  try {
    return (await httpsCallable(functions, name)(data)).data as T;
  } catch (err) {
    const e = err as { code?: string; message?: string; details?: Record<string, unknown> };
    throw new CallError(String(e.code || "unknown").replace(/^functions\//, ""), e.message || "Something went wrong.", e.details ?? null);
  }
}
