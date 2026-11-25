export const fmtTime = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("en-AU", { timeZone: "Australia/Sydney" }) : "—");
export const fmtAud = (n: number | null | undefined) => (typeof n === "number" ? `A$${n.toFixed(2)}` : "—");
export const fmtNum = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-AU") : "—");

export function downloadText(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
