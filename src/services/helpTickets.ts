import { Platform } from "react-native";
import * as Application from "expo-application";
import { callFn } from "@/services/callable";

// In-app Help requests -> the dashboard's support inbox (helpTicket callable). Guests too.
export interface TicketSummary {
  id: string;
  subject: string;
  status: "new" | "waiting" | "solved";
  updatedAtMs: number;
}

export function createHelpTicket(subject: string, text: string): Promise<{ ok: true; id: string }> {
  return callFn("helpTicket", { op: "create", subject, text, platform: Platform.OS, appVersion: Application.nativeApplicationVersion ?? null });
}

export async function myHelpTickets(): Promise<TicketSummary[]> {
  return (await callFn<{ tickets: TicketSummary[] }>("helpTicket", { op: "list" })).tickets;
}

export function helpTicketThread(id: string): Promise<{ ticket: TicketSummary; messages: { from: "user" | "staff"; text: string; atMs: number }[] }> {
  return callFn("helpTicket", { op: "get", id });
}

export function replyToHelpTicket(id: string, text: string): ReturnType<typeof helpTicketThread> {
  return callFn("helpTicket", { op: "reply", id, text });
}

/** Status in plain words. */
export function statusLabel(s: TicketSummary["status"]): string {
  return s === "new" ? "Sent" : s === "waiting" ? "We replied" : "Solved";
}
