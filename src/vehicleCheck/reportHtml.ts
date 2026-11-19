// The report as a printable HTML page, for "Share / export PDF" (expo-print turns it into a PDF).
// Every provider value is escaped; nothing here comes from anywhere but the report itself.
import { REPORT_STATUS } from "@/theme/colors";
import { SECTION_LABELS, SECTION_ORDER, footerText, reportTitle, type Section, type SectionKey, type VehicleReport } from "@/vehicleCheck/model";
import { sectionLines } from "@/vehicleCheck/sectionLines";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function sectionHtml(key: SectionKey, s: Section | undefined): string {
  if (!s) return "";
  const head = `<h2>${esc(SECTION_LABELS[key])}</h2>`;
  if (s.status !== "ok") {
    const why = s.status === "failed" ? (s.notFound ? "Not found" : "Couldn't load") : s.status === "blocked" ? `BLOCKED: ${s.reason}` : "Loading";
    return `<section class="s">${head}<p class="muted">${esc(why)}</p></section>`;
  }
  const st = REPORT_STATUS[s.grade];
  const lines = sectionLines(key, s)
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join("");
  return (
    `<section class="s">${head}` +
    `<p class="badge" style="background:${st.fill};color:${st.on}">${esc(st.label)}: ${esc(s.summary)}</p>` +
    (lines ? `<table>${lines}</table>` : "") +
    `<p class="muted">Source: ${esc(s.source)} · data as at ${esc(s.asAt)}</p></section>`
  );
}

export function reportHtml(r: VehicleReport): string {
  const sections = SECTION_ORDER.map((k) => sectionHtml(k, r.sections[k] as Section | undefined)).join("");
  const when = new Date(r.createdAt).toISOString().slice(0, 10);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(reportTitle(r))}</title>
<style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1F2125;margin:32px;font-size:13px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:0 0 6px}
.s{border:1px solid #E3E6EB;border-radius:10px;padding:12px 14px;margin:12px 0;page-break-inside:avoid}
.badge{display:inline-block;border-radius:6px;padding:3px 8px;font-weight:600;margin:0 0 8px}
table{border-collapse:collapse;width:100%} th{text-align:left;color:#5F6368;font-weight:500;width:38%;padding:2px 0} td{padding:2px 0}
.muted{color:#5F6368;font-size:11px;margin:6px 0 0} .sample{background:#FFF3DF;color:#8A4B00;padding:6px 10px;border-radius:6px;font-weight:700}
</style></head><body>
${r.sample ? '<p class="sample">SAMPLE REPORT: example data, not a real vehicle</p>' : ""}
<h1>${esc(reportTitle(r))}</h1><p class="muted">TrackLine vehicle full check · ${esc(when)}</p>
${sections}
<p class="muted">${esc(footerText(r.providers))}</p>
</body></html>`;
}
