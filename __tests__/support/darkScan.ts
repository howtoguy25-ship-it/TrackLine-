// Collects the background and text colours a rendered tree paints, to check that a surface
// wrapped in a dark SurfaceScheme has no light-theme colours left in it.
import { StyleSheet } from "react-native";

type Json = { type: string; props: Record<string, unknown>; children: Json[] | null } | string;

export const LIGHT_SURFACES = ["#FFFFFF", "#F1F3F7", "#F4F5F8", "#E6E8EB", "#E1F1FD"];
export const LIGHT_ONLY_TEXT = ["#1F2125", "#6B7078", "#6F747C", "#0062B8", "#B8262B"];

export function paints(tree: Json | Json[] | null) {
  const backgrounds = new Set<string>();
  const texts = new Set<string>();
  const walk = (n: Json | Json[] | null) => {
    if (!n || typeof n === "string") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const st = (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>;
    if (typeof st.backgroundColor === "string") backgrounds.add(st.backgroundColor.toUpperCase());
    if (n.type === "Text" && typeof st.color === "string") texts.add(st.color.toUpperCase());
    walk(n.children);
  };
  walk(tree);
  return {
    backgrounds,
    texts,
    lightSurfacesLeft: [...backgrounds].filter((c) => LIGHT_SURFACES.includes(c)),
    lightTextLeft: [...texts].filter((c) => LIGHT_ONLY_TEXT.includes(c)),
  };
}
