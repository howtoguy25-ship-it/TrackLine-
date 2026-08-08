import React from "react";
import { Text } from "react-native";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { ALERT_ICONS, type AlertType } from "@/types/alert";

// "Police" reads far better as a real pictograph than any vector glyph available -- there's no
// "police car" (a car with lights, not just a badge/shield) glyph in MaterialCommunityIcons,
// MaterialIcons, or FontAwesome 5/6. The web app already solved this with the real 🚓
// pictograph; mirrored here. "Crash" USED to be here too (a car+explosion emoji pairing), but
// that was based on an incomplete check -- MaterialIcons (a separate glyph set from
// MaterialCommunityIcons, confirmed against the actual installed glyphmap) has a real, dedicated
// "car-crash" icon that reads cleanly as a crash without needing an emoji at all. See the
// special case below.
const ALERT_EMOJI_OVERRIDE: Partial<Record<AlertType, string>> = {
  police: "🚓",
};

interface Props {
  type: AlertType;
  size: number;
  color: string;
}

export function AlertTypeGlyph({ type, size, color }: Props) {
  const emoji = ALERT_EMOJI_OVERRIDE[type];
  if (emoji) {
    return <Text style={{ fontSize: size, lineHeight: size * 1.15 }}>{emoji}</Text>;
  }
  // MaterialIcons' own "car-crash" -- a real, dedicated crash glyph, not repurposed from a
  // different meaning -- lives in a separate glyph set from every other alert type's
  // MaterialCommunityIcons name, so it needs its own component, not just a different `name`.
  if (type === "crash") {
    return <MaterialIcons name="car-crash" size={size} color={color} />;
  }
  return <MaterialCommunityIcons name={ALERT_ICONS[type] as any} size={size} color={color} />;
}
