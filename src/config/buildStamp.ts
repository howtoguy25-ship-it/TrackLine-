// The build stamp shown in Settings > About: app version, the git commit the running JavaScript
// came from, and when it was built -- so it's obvious on the phone which code is running.
//
// The commit and date are written into the app config when the bundle is made (app.config.js
// BUILD_STAMP): at EAS build time for a release/preview build, or by the computer serving the
// JavaScript for a development build (so a dev build shows the commit of that computer's
// checkout, which is exactly what it's running).

export interface BuildStampInput {
  version: string | null | undefined;
  buildNumber: string | null | undefined;
  commit: string | null | undefined;
  builtAt: string | null | undefined;
  /** Where the JavaScript came from: the app itself, a dev server, or an over-the-air update. */
  source: "embedded" | "dev-server" | "update";
}

export function formatBuildStamp(input: BuildStampInput): string {
  const parts = [`v${input.version || "?"}${input.buildNumber ? ` (${input.buildNumber})` : ""}`];
  parts.push(input.commit || "unknown commit");
  if (input.builtAt) {
    const d = new Date(input.builtAt);
    if (!Number.isNaN(d.getTime())) parts.push(d.toISOString().slice(0, 16).replace("T", " ") + " UTC");
  }
  const sourceLabel = { embedded: "", "dev-server": "JS from dev server", update: "OTA update" }[input.source];
  if (sourceLabel) parts.push(sourceLabel);
  return parts.join(" · ");
}
