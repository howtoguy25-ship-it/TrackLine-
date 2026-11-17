"use client";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// Every dashboard read and action is one call to a section function (firebase/functions/admin).
export type Section = "adminUsers" | "adminMessages" | "adminConfig" | "adminModeration" | "adminSupport" | "adminInsights" | "adminGovernance";

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(section: Section, op: string, data: Record<string, unknown> = {}): Promise<T> {
  try {
    const r = await httpsCallable(functions, section)({ op, ...data });
    return r.data as T;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    throw new ApiError(String(e.code || "unknown").replace(/^functions\//, ""), e.message || "Something went wrong.");
  }
}
