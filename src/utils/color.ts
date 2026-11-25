// Real hex-color math (no external color library needed for two small ops) -- used to derive a
// lighter/darker shade of a marker/badge's own base color for a genuine two-tone gradient fill
// instead of a single flat color, the same "glossy badge" treatment real map pin icons (Google
// Maps' own colored pins, for one) use for a more polished, professional look.
function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`;
}

/** amount in [-1, 1] -- positive lightens toward white, negative darkens toward black. Returns
 *  the input hex unchanged (never throws) if it isn't a real #rrggbb string. */
export function shadeColor(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const shaded: [number, number, number] = [
    rgb[0] + (target - rgb[0]) * t,
    rgb[1] + (target - rgb[1]) * t,
    rgb[2] + (target - rgb[2]) * t,
  ];
  return toHex(shaded);
}
