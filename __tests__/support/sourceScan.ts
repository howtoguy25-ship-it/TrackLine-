// Small source-reading helpers for the static design tests: find JSX elements and the StyleSheet
// keys they use, without a full parser. Good enough for this codebase's consistent formatting.
import fs from "fs";
import path from "path";

export const ROOT = path.join(__dirname, "..", "..");

export function sourceFiles(dir = "src", ext = /\.tsx?$/): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of fs.readdirSync(path.join(ROOT, d))) {
      const rel = path.join(d, name);
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
      else if (ext.test(name)) out.push(rel);
    }
  };
  walk(dir);
  return out;
}

export function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Index of the ">" that closes the JSX opening tag starting at `from` (braces respected). */
export function openingEnd(s: string, from: number): number {
  let depth = 0;
  for (let j = from; j < s.length; j++) {
    const ch = s[j];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return j;
  }
  return s.length - 1;
}

export interface JsxOpening {
  tag: string;
  text: string;
  line: number;
}

/** Every opening tag of the given component names in a file. */
export function openings(src: string, tags: string[]): JsxOpening[] {
  const re = new RegExp(`<(${tags.join("|")})\\b`, "g");
  const out: JsxOpening[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = openingEnd(src, m.index + m[0].length);
    out.push({ tag: m[1], text: src.slice(m.index, end + 1), line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** StyleSheet.create keys in a file, with the text of each style object. */
export function styleKeys(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^ {2}(\w+): \{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) break;
    }
    out.set(m[1], src.slice(m.index, j + 1));
  }
  return out;
}

/** A style key named like a button, chip or pill. */
export const BUTTONISH = /(button|btn|cta|chip|pill|fab)/i;

/**
 * Pressables outside components/ui that dress themselves as buttons: their style names a
 * button-ish StyleSheet key that paints a background. Those should be a Button / Chip /
 * FloatingButton instead. List rows, cards and tiles are allowed to stay plain Pressables.
 */
export function adHocButtons(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles("src", /\.tsx$/)) {
    if (file.includes(`components${path.sep}ui${path.sep}`)) continue;
    const src = read(file);
    const keys = styleKeys(src);
    for (const o of openings(src, ["Pressable", "PressableScale"])) {
      const style = /style=\{([\s\S]*)\}/.exec(o.text)?.[1] ?? "";
      for (const [, key] of style.matchAll(/styles\.(\w+)/g)) {
        if (BUTTONISH.test(key) && /backgroundColor/.test(keys.get(key) ?? "")) {
          found.push(`${file}:${o.line} styles.${key}`);
          break;
        }
      }
    }
  }
  return found;
}
