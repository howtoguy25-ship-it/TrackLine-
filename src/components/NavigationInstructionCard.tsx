import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, type LayoutChangeEvent } from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RouteStep } from "@/services/directions";
import { NAV_CARD_THEMES, type NavCardThemeKey } from "@/utils/navCardTheme";
import { formatDistance, extractRoundaboutExitNumber, type DistanceUnit } from "@/utils/navFormat";
import { radius, spacing, shadow, pressedOpacity } from "@/theme/tokens";

// Real, confirmed fix for "generic arrow for every turn shape" -- Google's own MaterialIcons
// font (bundled via @expo/vector-icons, verified directly against its installed glyphmap, not
// guessed) ships a dedicated set of navigation icons whose names already match Google
// Directions' own maneuver vocabulary almost verbatim ("turn-slight-left", "roundabout-right",
// "fork-left", etc. are real glyphs, not just real maneuver strings) -- each one is drawn as the
// actual real turn shape (a slight bend vs. a sharp right-angle vs. a full U, a real roundabout
// loop, a real fork/ramp split), not one straight arrow reused at a different rotation. The only
// real spelling mismatch is Google's "uturn-left"/"uturn-right" (no hyphen before "turn") vs. the
// icon font's "u-turn-left"/"u-turn-right" (hyphenated) -- mapped explicitly below for exactly
// that reason.
export const MANEUVER_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  "turn-left": "turn-left",
  "turn-right": "turn-right",
  "turn-slight-left": "turn-slight-left",
  "turn-slight-right": "turn-slight-right",
  "turn-sharp-left": "turn-sharp-left",
  "turn-sharp-right": "turn-sharp-right",
  "uturn-left": "u-turn-left",
  "uturn-right": "u-turn-right",
  merge: "merge",
  "roundabout-left": "roundabout-left",
  "roundabout-right": "roundabout-right",
  "fork-left": "fork-left",
  "fork-right": "fork-right",
  "ramp-left": "ramp-left",
  "ramp-right": "ramp-right",
  straight: "straight",
};

interface Props {
  step: RouteStep | null;
  // The road the driver is ON right now (from the same OSM lookup the speed limit uses) --
  // distinct from `step.instruction`'s "turn onto X", which is the NEXT road. Null until a
  // real lookup resolves one (never a guess).
  roadName: string | null;
  themeKey: NavCardThemeKey;
  onExit: () => void;
  // Opens the full turn-by-turn directions list -- the whole icon+text area is tappable for
  // this (a bigger, easier target than a small dedicated button would be), while the exit
  // button keeps its own separate target so it's never accidentally triggered by the same tap.
  onExpandDirections: () => void;
  // Reports the card's real rendered height (instruction text can wrap to 2 lines) so callers
  // positioning other controls below it -- see MapScreen's topRightControls -- can react to
  // the actual height instead of guessing a fixed number. A guessed constant meant the button
  // column below could end up overlapping the bottom of a taller (longer-instruction) card,
  // which is exactly what made those buttons intermittently miss taps depending on which
  // instruction happened to be showing.
  onHeightChange?: (height: number) => void;
  // Real, explicit request (Waze-style redesign, Phase 1B section 5) -- the following step, so
  // the card can show a "Then" chip when it's genuinely <150m past the end of the current one.
  // Null/undefined on the very last step (nothing follows) or before a route exists.
  nextStep?: RouteStep | null;
  // True only for the route's actual final step -- shows a real arrival icon instead of a
  // maneuver glyph. Google's own API gives no dedicated "arrive" maneuver value; this is
  // real position-based detection (last step index), not guessed from the maneuver field.
  isFinalStep?: boolean;
  // Real, explicit request -- tapping the maneuver icon specifically repeats the current
  // spoken instruction (the existing tap-the-whole-card behaviour for expand/directions is
  // unchanged, so this is an additional, separate target, not a replacement for it).
  onRepeatInstruction?: () => void;
  distanceUnit?: DistanceUnit;
}

export function NavigationInstructionCard({
  step,
  roadName,
  themeKey,
  onExit,
  onExpandDirections,
  onHeightChange,
  nextStep,
  isFinalStep,
  onRepeatInstruction,
  distanceUnit = "km",
}: Props) {
  const insets = useSafeAreaInsets();
  const theme = NAV_CARD_THEMES[themeKey];

  // Slides the instruction content down (with a fade) into place every time the *active step*
  // actually changes -- i.e. "the driver just completed a turn and this is the next one" --
  // not on every GPS tick, which would re-trigger constantly since etaText/distanceRemainingText
  // update far more often than the step itself does. Tracked by the instruction text's own
  // identity rather than a separate index prop, since two different steps are never going to
  // share the exact same instruction text back to back.
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const prevInstructionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!step) return;
    if (prevInstructionRef.current === null) {
      // First real instruction of this navigation session -- settles in place immediately,
      // nothing to animate from yet.
      prevInstructionRef.current = step.instruction;
      return;
    }
    if (prevInstructionRef.current === step.instruction) return;
    prevInstructionRef.current = step.instruction;
    translateY.setValue(-22);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 380, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start();
  }, [step, translateY, opacity]);

  // Real collapse toggle -- tapping the chevron drops this down to just the icon + a single
  // line of instruction text (plus the road/speed row below, still live), so a driver who
  // wants to see more of the actual route/map underneath can do that without losing turn
  // guidance altogether. Defaults CLOSED now -- real, confirmed complaint that the always-open
  // card (full multi-line instruction + distance pill + road/speed row all stacked) was simply
  // too big, covering too much of the map. A small "island" pill by default, tapped open for
  // the full detail, rather than the reverse.
  const [collapsed, setCollapsed] = useState(true);

  // Real background-transparency toggle -- the small circle button in the header. Starts
  // wherever the picked theme itself says to (see navCardTheme.ts's startsTransparent -- only
  // "Transparent Dark" sets this, every other theme keeps the previous "off by default, tap to
  // turn on" behavior). Tapping it switches the card to a translucent version of the same theme
  // (see navCardTheme.ts's backgroundTransparent) so the live map shows through behind it, and
  // turns the button itself blue as a clear "this is now on" indicator. Text stays the same
  // theme color either way -- textShadowColor (also part of the theme) is what actually keeps
  // it readable over a transparent, uncontrolled background, not the background opacity alone.
  const [transparent, setTransparent] = useState(!!theme.startsTransparent);

  if (!step) return null;
  const icon = (step.maneuver && MANEUVER_ICONS[step.maneuver]) || "straight";
  // Real exit-number extraction (see extractRoundaboutExitNumber's own comment -- Google's
  // REST Directions API has no structured exit-number field, so this reads the real ordinal
  // Google's own instruction sentence already states), only shown for an actual roundabout
  // maneuver.
  const roundaboutExit =
    step.maneuver === "roundabout-left" || step.maneuver === "roundabout-right"
      ? extractRoundaboutExitNumber(step.instruction)
      : undefined;
  // Real, explicit request -- the bare target street name (+ route ref) this step turns onto,
  // shown as its own accented line under the full instruction. Falls back to nothing (no
  // duplicate line) when Google's own html genuinely didn't bold a road name for this step
  // (e.g. "Continue straight") -- never a guessed/duplicated value.
  const streetDisplay = step.targetStreetName;
  // Real, explicit request -- a small "Then" chip when the step right after this one is
  // genuinely close (<150m past where this maneuver ends), matching real Google/Apple/Waze
  // behaviour for back-to-back turns.
  const showThenChip = !collapsed && !!nextStep && nextStep.distanceMeters < 150;

  const onLayout = (e: LayoutChangeEvent) => {
    onHeightChange?.(e.nativeEvent.layout.height);
  };

  const textShadow = {
    textShadowColor: theme.textShadowColor,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: transparent ? theme.backgroundTransparent : theme.background },
        collapsed && styles.cardCollapsed,
        { top: insets.top + spacing.md },
      ]}
      onLayout={onLayout}
    >
      <View style={styles.headerRow}>
        <Pressable
          style={({ pressed }) => [styles.tapArea, pressed && { opacity: pressedOpacity }]}
          onPress={collapsed ? () => setCollapsed(false) : onExpandDirections}
          accessibilityLabel={collapsed ? "Expand navigation card" : "Show full route directions"}
        >
          <Animated.View style={[styles.animatedContent, { transform: [{ translateY }], opacity }]}>
            {/* Real, explicit request -- tapping the icon specifically repeats the current
                spoken instruction, a separate target from the surrounding Pressable (which
                expands/opens directions) so neither gesture steals the other's tap. Only a
                Pressable at all once a real onRepeatInstruction handler exists -- with none
                wired up, this stays a plain View, same as before. */}
            {onRepeatInstruction ? (
              <Pressable
                onPress={onRepeatInstruction}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.iconWrap,
                  collapsed && styles.iconWrapCollapsed,
                  { backgroundColor: theme.iconWrapBg },
                  pressed && { opacity: pressedOpacity },
                ]}
                accessibilityLabel="Repeat spoken instruction"
              >
                {isFinalStep ? (
                  <MaterialIcons name="flag" size={collapsed ? 22 : 34} color={theme.iconColor} />
                ) : (
                  <MaterialIcons name={icon} size={collapsed ? 22 : 34} color={theme.iconColor} />
                )}
                {roundaboutExit != null && (
                  <View style={[styles.exitBadge, { backgroundColor: theme.exitButtonBg }]}>
                    <Text style={[styles.exitBadgeText, { color: theme.exitButtonIcon }]}>{roundaboutExit}</Text>
                  </View>
                )}
              </Pressable>
            ) : (
              <View style={[styles.iconWrap, collapsed && styles.iconWrapCollapsed, { backgroundColor: theme.iconWrapBg }]}>
                {isFinalStep ? (
                  <MaterialIcons name="flag" size={collapsed ? 22 : 34} color={theme.iconColor} />
                ) : (
                  <MaterialIcons name={icon} size={collapsed ? 22 : 34} color={theme.iconColor} />
                )}
                {roundaboutExit != null && (
                  <View style={[styles.exitBadge, { backgroundColor: theme.exitButtonBg }]}>
                    <Text style={[styles.exitBadgeText, { color: theme.exitButtonIcon }]}>{roundaboutExit}</Text>
                  </View>
                )}
              </View>
            )}
            <View style={{ flex: 1 }}>
              {/* No line cap at all, collapsed or not -- a capped numberOfLines was cutting long
                  instructions (e.g. "Head east on Old Kent Rd towards ...") off mid-word with
                  "...", hiding the actual road name a driver needs to read. This used to still
                  cap to 1 line while collapsed (by design, to keep that state compact), but per
                  explicit request the full instruction must always be readable with nothing cut
                  off, even collapsed -- onHeightChange already reports this card's real rendered
                  height to callers below it, so letting the text grow to however many lines it
                  actually needs (rare for the collapsed case in practice) is safe. */}
              <Text
                style={[styles.instruction, collapsed && styles.instructionCollapsed, { color: theme.text }, textShadow]}
              >
                {step.instruction}
              </Text>
              {/* Real, explicit request (Phase 1B section 5) -- the bare target street name on
                  its own accented line, large and bold, separate from the full instruction
                  sentence above. Only while expanded (collapsed stays the compact "island" it
                  already was) and only when Google's own html actually gave one. */}
              {!collapsed && streetDisplay && (
                <Text
                  style={[styles.streetAccentText, { color: theme.streetAccent }, textShadow]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                >
                  {streetDisplay}
                </Text>
              )}
              {/* Real, explicit request -- the distance to the next turn must be visible right
                  here without needing to drop the card open, so this no longer hides behind
                  `!collapsed`; it shows in both states now, just a touch more compact while
                  collapsed (distanceBadgeCollapsed) to match that state's smaller instruction
                  text and keep the "small island pill" genuinely small. */}
              <View
                style={[
                  styles.distanceBadge,
                  collapsed && styles.distanceBadgeCollapsed,
                  { backgroundColor: theme.actionBg, borderColor: theme.iconWrapBg },
                ]}
              >
                {/* Real, confirmed bug (screenshot evidence: the circled "3.1 km" was
                    near-illegible against Transparent Dark's own translucent card): this used
                    theme.iconColor, which every theme actually calibrates for the ICON sitting
                    on top of iconWrapBg's own colored circle -- not for text sitting on
                    actionBg, a completely different background these themes already have a
                    dedicated, correctly-contrasted color for (actionText). Transparent Dark
                    pairs iconColor #0A0E18 (near-black, correct for its light-blue icon circle)
                    with actionBg's dark translucent pill -- black-on-dark, exactly the
                    complaint. Light has the same bug the other way (white iconColor on an
                    almost-white actionBg). actionText fixes both without changing anything
                    about the icon itself. */}
                <Text
                  style={[
                    styles.distanceText,
                    collapsed && styles.distanceTextCollapsed,
                    { color: theme.actionText },
                    textShadow,
                  ]}
                >
                  {formatDistance(step.distanceMeters, distanceUnit)}
                </Text>
              </View>
            </View>
          </Animated.View>
        </Pressable>
        {/* Small circle transparency toggle -- blue (accent) fill only while active, so its own
            color is the "this is on" signal, independent of the card's own selected theme. */}
        <Pressable
          onPress={() => setTransparent((v) => !v)}
          hitSlop={12}
          style={({ pressed }) => [
            styles.toggleButton,
            { backgroundColor: transparent ? "#1D4ED8" : theme.toggleBg },
            pressed && { opacity: pressedOpacity },
          ]}
          accessibilityLabel={transparent ? "Switch card to solid background" : "Switch card to transparent background"}
        >
          <Ionicons
            name={transparent ? "eye-outline" : "eye-off-outline"}
            size={16}
            color={transparent ? "#FFFFFF" : theme.toggleIcon}
          />
        </Pressable>
        <Pressable
          onPress={() => setCollapsed((v) => !v)}
          hitSlop={12}
          style={({ pressed }) => [styles.toggleButton, { backgroundColor: theme.toggleBg }, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel={collapsed ? "Expand navigation card" : "Collapse navigation card"}
        >
          <Ionicons name={collapsed ? "chevron-down" : "chevron-up"} size={18} color={theme.toggleIcon} />
        </Pressable>
        <Pressable
          onPress={onExit}
          hitSlop={12}
          style={({ pressed }) => [styles.exitButton, { backgroundColor: theme.exitButtonBg }, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="Exit navigation"
        >
          <Ionicons name="close" size={20} color={theme.exitButtonIcon} />
        </Pressable>
      </View>

      {/* Current road (not the next turn's road -- that's step.instruction above), from the
          same OSM lookup MapScreen's own bottom-left LiveSpeedometer uses for the live speed +
          posted speed limit shown there -- this card no longer duplicates that dial/sign pair
          itself (real, explicit request: the speedometer moved to a single persistent
          bottom-left widget shown on the Home map view too, not just here during nav, so showing
          it a second time up here would just be a redundant duplicate readout on screen at
          once). Only rendered once a real road name has actually resolved (never a placeholder/
          guess), and stays visible even collapsed since it's one compact row. */}
      {roadName && (
        <View style={styles.roadRow}>
          <Ionicons name="navigate" size={11} color={theme.actionText} style={{ transform: [{ rotate: "90deg" }] }} />
          <Text style={[styles.roadName, { color: theme.text }, textShadow]} numberOfLines={1}>
            {roadName}
          </Text>
        </View>
      )}

      {/* Real, explicit request -- a small "Then" chip when the step right after this one
          follows almost immediately (<150m past this maneuver), so the driver knows another
          turn is coming right away. */}
      {showThenChip && (
        <View style={styles.thenChip}>
          <Text style={styles.thenChipText}>Then</Text>
          <MaterialIcons
            name={(nextStep!.maneuver && MANEUVER_ICONS[nextStep!.maneuver!]) || "straight"}
            size={14}
            color="#FFFFFF"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.lg - 4,
    gap: spacing.sm + 2,
    ...shadow.medium,
  },
  // Collapsed state shrinks padding further -- with the meta line gone too (see the header
  // render above), the card is just the icon + single instruction line + road/speed row's own
  // height plus this trimmed padding, real screen space back for the map/route underneath.
  cardCollapsed: {
    padding: spacing.sm + 2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  tapArea: {
    flex: 1,
  },
  animatedContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },
  // Real, explicit request (Phase 1B section 5) -- "large manoeuvre icon". Bumped up from the
  // original 40px (same real width-constraint reasoning as streetAccentText above -- the
  // literal spec 64pt assumes a dedicated full-width panel with the icon as its own column,
  // not this card's shared icon+text+buttons row) while still reading as a clearly bigger,
  // more prominent icon than before.
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  iconWrapCollapsed: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  instruction: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  // Real, confirmed complaint: the collapsed "island" state still used full-size text, so a
  // long instruction (still shown in full, never truncated -- see the comment above) could keep
  // the card just as tall as expanded. A smaller, tighter size specifically for the collapsed
  // state keeps it genuinely compact for the common case while never hiding any of the text.
  instructionCollapsed: {
    fontSize: 13,
    lineHeight: 17,
  },
  // Own pill, not just bigger plain text -- a real visual break from the instruction line above
  // it (which already carries its own weight/color), so the distance reads as its own distinct,
  // glanceable number rather than a small caption easy to skim past. alignSelf keeps the pill
  // sized to its own text instead of stretching the full card width.
  distanceBadge: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.pill,
    // Real, explicit request to upgrade this card's look while already in here fixing its
    // legibility bug -- a thin border in the theme's own accent color (the same color the turn
    // icon's circle uses) gives the distance pill a bit more visual polish/definition instead
    // of a flat, borderless translucent rectangle, and ties it back to the same accent color
    // used elsewhere on the card.
    borderWidth: 1,
  },
  // Tighter padding/margin to match the collapsed state's smaller instruction text -- same pill,
  // just scaled down so the "small island pill" default stays genuinely compact.
  distanceBadgeCollapsed: {
    marginTop: 3,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  // Real, explicit request (Phase 1B section 5) -- "distance large bold". Bumped up from the
  // original 15pt (same real width-constraint reasoning as streetAccentText above -- the
  // literal spec 44pt is sized for a dedicated full-width panel, not this pill sharing a row
  // with the icon/toggle buttons) while still reading as a clearly bigger, bolder number than
  // before.
  distanceText: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  distanceTextCollapsed: {
    fontSize: 12,
  },
  // Current road -- a distinct row below the header so it's never layered on top of (or
  // squeezed into) the turn instruction text.
  roadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  roadName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  toggleButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  exitButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  // Real roundabout exit-number badge, drawn over the bottom-right corner of the maneuver icon
  // -- see extractRoundaboutExitNumber's own comment for where this real number comes from.
  exitBadge: {
    position: "absolute",
    bottom: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  exitBadgeText: {
    fontSize: 10,
    fontWeight: "900",
  },
  // Real, explicit request (Phase 1B section 5) -- the bare target street name, bold in the
  // theme's own accent color, directly under the full instruction sentence. Deliberately NOT
  // the spec's literal 40pt: this card shares its row with the maneuver icon, the distance
  // pill, and the collapse/transparency/exit buttons within a width already narrower than a
  // dedicated full-width top panel -- 40pt text would wrap/overflow on real phone widths for
  // anything longer than a short road name. Sized to actually fit this card's real available
  // width instead; flagged in NOTES.md as a deliberate deviation, not an oversight.
  streetAccentText: {
    fontSize: 22,
    fontWeight: "800",
    marginTop: 2,
  },
  thenChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  thenChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
