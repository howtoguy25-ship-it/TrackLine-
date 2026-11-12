import React from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "@/components/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useMapScheme, useUiScheme } from "@/components/ui/uiScheme";
import { ACTIONS, SELECTED_TINT, SURFACES, type ActionGroup, type Scheme } from "@/theme/colors";
import { radius, shadow } from "@/theme/tokens";

// The app's one family of buttons. Nothing outside components/ui builds its own button: screens
// pick a variant, and the variant picks its colours from its meaning group in theme/colors.ts.
// There is deliberately no colour prop.
//
//   Primary            blue pill, white label             go / confirm
//   Secondary          light-grey pill, blue label        the other choice / cancel
//   Ghost              no fill, blue label (or icon)      a quiet extra action, a close X
//   Destructive        pale red, red label                a dangerous action, first step
//   DestructiveConfirm solid red, white label             the final "yes, delete"
//   FloatingButton     56pt round over the map            map controls / re-centre / report
//   Chip               18-radius filter or shortcut       chips
//
// Every one is at least 44x44 to touch, presses the same way (PressableScale), and has one
// shadow if it floats. Labels are Rubik 600 at 17-18pt, written in sentence case by the caller.

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "destructiveConfirm";

export const VARIANT_GROUP: Record<ButtonVariant, ActionGroup> = {
  primary: "go",
  secondary: "alternative",
  ghost: "alternative",
  destructive: "danger",
  destructiveConfirm: "dangerConfirm",
};

/** Minimum touch size, both ways. */
export const MIN_TAP = 44;

/**
 * Label size. White on go blue (3.03:1) and on danger red (3.91:1) pass WCAG AA only as LARGE
 * text, so those labels are always 18pt semibold; the others (all 4.5:1 or better) are 17pt on
 * medium buttons.
 */
export function labelSize(variant: ButtonVariant, size: "large" | "medium"): number {
  if (variant === "primary" || variant === "destructiveConfirm") return 18;
  return size === "large" ? 18 : 17;
}
export const LABEL_WEIGHT = "600";

export interface ButtonColours {
  background: string;
  foreground: string;
  border?: string;
}

/** The colours a variant draws in. Exported so tests check them against the meaning groups. */
export function buttonColours(variant: ButtonVariant, scheme: Scheme): ButtonColours {
  const g = ACTIONS[scheme][VARIANT_GROUP[variant]];
  if (variant === "ghost") return { background: "transparent", foreground: g.on };
  return { background: g.fill, foreground: g.on };
}

export type FloatingTone = "map" | "recenter" | "report";
export const TONE_GROUP: Record<FloatingTone, ActionGroup> = {
  map: "mapControl",
  recenter: "recenter",
  report: "report",
};

export function floatingColours(tone: FloatingTone, scheme: Scheme): ButtonColours {
  const g = ACTIONS[scheme][TONE_GROUP[tone]];
  return { background: g.fill, foreground: g.on, border: g.outline };
}

/**
 * A chip in a sheet is light grey; a chip floating on the map is a map control (white, hairline).
 * Selected chips take the pale blue tint with blue text either way.
 */
export function chipColours(selected: boolean, scheme: Scheme, onMap = false): ButtonColours {
  const alt = ACTIONS[scheme].alternative;
  if (selected) return { background: SELECTED_TINT[scheme], foreground: alt.on };
  if (onMap) {
    const map = ACTIONS[scheme].mapControl;
    return { background: map.fill, foreground: map.on, border: map.outline };
  }
  return { background: alt.fill, foreground: SURFACES[scheme].text };
}

interface CommonProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  /** Layout only (margins, flex, alignSelf). Colours and shape come from the variant. */
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
}

export interface ButtonProps extends CommonProps {
  variant?: ButtonVariant;
  /** Sentence case: "Go now", not "Go Now". Leave out for an icon-only button. */
  label?: string;
  icon?: IconName;
  /** large: 52pt tall, 18pt label (the main action). medium: 44pt, 17pt. */
  size?: "large" | "medium";
  fullWidth?: boolean;
  loading?: boolean;
  /** For icon-only ghost buttons sitting on a coloured surface (a dark card). */
  iconColor?: string;
  /** Drawn behind the label, clipped to the button (the Go now countdown fill). */
  underlay?: React.ReactNode;
  /** Icon above the label, in a rounded tile (a place's Save / Share / More). */
  stacked?: boolean;
  /** No side padding, for a text-only ghost button lined up with text around it. */
  inline?: boolean;
  /** Draw the icon filled (an "on" state, like a saved bookmark). */
  filledIcon?: boolean;
  accessibilityState?: { selected?: boolean; checked?: boolean };
}

export function Button({
  variant = "primary",
  label,
  icon,
  size = "medium",
  fullWidth,
  loading,
  disabled,
  iconColor,
  underlay,
  stacked,
  inline,
  filledIcon,
  style,
  hitSlop,
  ...rest
}: ButtonProps) {
  const scheme = useUiScheme();
  const c = buttonColours(variant, scheme);
  const iconOnly = !label;
  const height = size === "large" ? 52 : MIN_TAP;
  const fg = iconColor && variant === "ghost" ? iconColor : c.foreground;
  return (
    <PressableScale
      {...rest}
      disabled={disabled || loading}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || loading), ...rest.accessibilityState }}
      style={[
        stacked
          ? styles.tile
          : iconOnly
            ? { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2 }
            : { minHeight: height, paddingHorizontal: inline ? 0 : size === "large" ? 24 : 18, borderRadius: radius.pill },
        { backgroundColor: c.background },
        stacked ? styles.column : styles.row,
        fullWidth && styles.fullWidth,
        underlay != null && styles.clip,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {underlay}
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={iconOnly || stacked ? 24 : 20} color={fg} filled={filledIcon} />}
          {label && (
            <Text style={[styles.label, { color: fg, fontSize: labelSize(variant, size) }]} numberOfLines={1}>
              {label}
            </Text>
          )}
        </>
      )}
    </PressableScale>
  );
}

export interface FloatingButtonProps extends CommonProps {
  tone?: FloatingTone;
  icon?: IconName;
  /** A custom glyph (the compass needle, the report mark) instead of an Icon. */
  children?: React.ReactNode;
  /** round: a circle. menu: a rounded square (radius 16), for the Menu button. */
  shape?: "round" | "menu";
  size?: number;
  /** Dots and counters drawn over the corner. */
  badge?: React.ReactNode;
}

export function FloatingButton({
  tone = "map",
  icon,
  children,
  shape = "round",
  size = 56,
  badge,
  style,
  disabled,
  ...rest
}: FloatingButtonProps) {
  // Floating buttons sit on the map, so they follow the map's theme (or a dark surface
  // they're drawn on).
  const mapScheme = useMapScheme();
  const surfaceScheme = useUiScheme();
  const scheme = surfaceScheme === "dark" ? "dark" : mapScheme;
  const c = floatingColours(tone, scheme);
  return (
    <PressableScale
      {...rest}
      disabled={disabled}
      accessibilityRole="button"
      style={[
        {
          width: Math.max(size, MIN_TAP),
          height: Math.max(size, MIN_TAP),
          borderRadius: shape === "menu" ? radius.menu : size / 2,
          backgroundColor: c.background,
        },
        c.border && { borderWidth: tone === "report" ? 1.5 : StyleSheet.hairlineWidth * 2, borderColor: c.border },
        shadow.floating,
        disabled && styles.disabled,
        style,
      ]}
    >
      {children ?? (icon ? <Icon name={icon} size={24} color={c.foreground} /> : null)}
      {badge}
    </PressableScale>
  );
}

export interface ChipProps extends CommonProps {
  label: string;
  icon?: IconName;
  selected?: boolean;
  /** Something drawn before the label instead of an Icon (a coloured dot). */
  leading?: React.ReactNode;
  /** A small icon after the label (a dropdown chevron). */
  trailingIcon?: IconName;
  /** Floating on the map: a white map control with the one shadow. */
  onMap?: boolean;
}

/** Chips are 36pt tall; the hit area reaches 44pt with 4pt of slop above and below. */
export const CHIP_HEIGHT = 36;

export function Chip({ label, icon, selected = false, leading, trailingIcon, onMap = false, style, disabled, hitSlop, ...rest }: ChipProps) {
  const scheme = useUiScheme();
  const c = chipColours(selected, scheme, onMap);
  return (
    <PressableScale
      {...rest}
      haptic={false}
      disabled={disabled}
      hitSlop={hitSlop ?? { top: 4, bottom: 4, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={rest.accessibilityLabel ?? label}
      style={[
        styles.chip,
        { backgroundColor: c.background },
        c.border && { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.border },
        onMap && shadow.floating,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {leading}
        {icon && <Icon name={icon} size={18} color={c.foreground} />}
        <Text style={[styles.chipLabel, { color: c.foreground }]} numberOfLines={1}>
          {label}
        </Text>
        {trailingIcon && <Icon name={trailingIcon} size={16} color={c.foreground} />}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  column: { alignItems: "center", justifyContent: "center", gap: 4 },
  tile: { minHeight: 84, minWidth: MIN_TAP, paddingHorizontal: 8, borderRadius: radius.menu },
  fullWidth: { alignSelf: "stretch" },
  clip: { overflow: "hidden" },
  disabled: { opacity: 0.45 },
  label: { fontWeight: LABEL_WEIGHT },
  chip: { height: CHIP_HEIGHT, minWidth: MIN_TAP, paddingHorizontal: 14, borderRadius: radius.chip },
  chipLabel: { fontSize: 15, fontWeight: "500" },
});
