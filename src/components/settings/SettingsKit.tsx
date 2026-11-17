import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View, type ViewStyle } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import { Text, TextInput } from "@/components/AppText";
import { Icon, type IconName } from "@/components/ui/Icon";
import { SETTINGS_ICON, BLUE, WHITE, type SettingsIconMeaning } from "@/theme/colors";
import { RUBIK } from "@/theme/typography";
import { useSettingsColours, useSettingsScheme, type SettingsColours } from "@/components/settings/settingsScheme";

// The one look for every settings page (Waze-style): grouped white cards on a grey page (dark:
// #1C1D20 on #0E0F11), rows with a coloured icon tile, a title and a grey line saying what the
// setting does, and the control on the right of the same line.

export const ROW_MIN_HEIGHT = 56;
export const ICON_TILE = 32;
const PAD = 16;
const ICON_GAP = 12;
/** Separators start after the icon tile. */
export const SEPARATOR_INSET_WITH_ICON = PAD + ICON_TILE + ICON_GAP;

// ---- Search highlight ---------------------------------------------------------------------------

interface PageContext {
  /** The setting a search jumped to: its row flashes and is scrolled into view. */
  highlight: string | null;
  scrollToRow: (rowRef: React.RefObject<View | null>) => void;
}
const SettingsPageContext = createContext<PageContext>({ highlight: null, scrollToRow: () => {} });

// ---- Page ---------------------------------------------------------------------------------------

/**
 * A settings page: its header (back button with the previous screen's name; this page's title
 * large under it), the status bar in the right colours, and the scrolling grey page.
 */
export function SettingsPage({
  title,
  children,
  highlight = null,
  testID,
  scroll = true,
}: {
  title: string;
  children: React.ReactNode;
  highlight?: string | null;
  testID?: string;
  scroll?: boolean;
}) {
  const c = useSettingsColours();
  const scheme = useSettingsScheme();
  useSettingsHeader(title);
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const ctx: PageContext = {
    highlight,
    scrollToRow: (rowRef) => {
      const row = rowRef.current;
      const content = contentRef.current;
      if (!row || !content) return;
      row.measureLayout(content, (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 96), animated: true }), () => {});
    },
  };
  const body = (
    <View ref={contentRef} collapsable={false}>
      <Text style={[styles.largeTitle, { color: c.text }]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
  return (
    <SettingsPageContext.Provider value={ctx}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, backgroundColor: c.page }}
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          testID={testID}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, backgroundColor: c.page }, styles.pageContent]} testID={testID}>
          {body}
        </View>
      )}
    </SettingsPageContext.Provider>
  );
}

/** Header for a settings page: back chevron + the previous screen's name; the title is drawn
 * large in the page itself, so the bar stays plain. `title` is kept on the screen's options
 * because the NEXT screen's back button shows it. */
export function useSettingsHeader(title: string) {
  const navigation = useNavigation();
  const c = useSettingsColours();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title,
      headerTitle: "",
      headerStyle: { backgroundColor: c.page },
      headerShadowVisible: false,
      headerTintColor: c.tick,
      headerBackTitleStyle: { fontFamily: RUBIK.regular },
      contentStyle: { backgroundColor: c.page },
    } as object);
  }, [navigation, title, c]);
}

// ---- Section ------------------------------------------------------------------------------------

/** A section: grey header above, a rounded card of rows, an optional grey note below. */
export function SettingsSection({
  title,
  footer,
  children,
  testID,
}: {
  title?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}) {
  const c = useSettingsColours();
  const items = React.Children.toArray(children).filter((x) => React.isValidElement(x)) as React.ReactElement<{ icon?: unknown; leading?: unknown }>[];
  if (!items.length) return null;
  return (
    <View style={styles.section} testID={testID}>
      {title ? <Text style={[styles.sectionTitle, { color: c.subtext }]}>{title}</Text> : null}
      <View style={[styles.card, { backgroundColor: c.card }]}>
        {items.map((child, i) => (
          <View key={child.key ?? i}>
            {child}
            {i < items.length - 1 ? (
              <View
                style={[
                  styles.separator,
                  { backgroundColor: c.separator, marginLeft: child.props.icon || child.props.leading ? SEPARATOR_INSET_WITH_ICON : PAD },
                ]}
              />
            ) : null}
          </View>
        ))}
      </View>
      {footer ? (
        typeof footer === "string" ? <Text style={[styles.footer, { color: c.subtext }]}>{footer}</Text> : footer
      ) : null}
    </View>
  );
}

// ---- Rows ---------------------------------------------------------------------------------------

export interface SettingsRowProps {
  title: string;
  subtitle?: string | null;
  icon?: IconName;
  meaning?: SettingsIconMeaning;
  /** Current value shown on the right, before a chevron. */
  value?: string | null;
  onPress?: () => void;
  /** A switch on the right; tapping anywhere on the row flips it. */
  toggle?: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; testID?: string };
  /** A single-choice option: a ✓ on the right when selected. */
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Settings search matches against this (defaults to the title). */
  searchKey?: string;
  testID?: string;
  /** Extra content under the row's text (a slider, inputs). */
  children?: React.ReactNode;
  right?: React.ReactNode;
  /** A custom icon in place of the coloured tile (same 32pt slot). */
  leading?: React.ReactNode;
}

/** The words VoiceOver / TalkBack read for a row: title, current value, state. */
export function rowAccessibilityLabel(p: Pick<SettingsRowProps, "title" | "value" | "toggle" | "selected" | "subtitle">): string {
  const parts = [p.title];
  if (p.value) parts.push(p.value);
  if (p.toggle) parts.push(p.toggle.value ? "on" : "off");
  if (p.selected !== undefined && p.selected) parts.push("selected");
  if (p.subtitle) parts.push(p.subtitle);
  return parts.join(", ");
}

export function SettingsRow(props: SettingsRowProps) {
  const { title, subtitle, icon, meaning = "map", value, onPress, toggle, selected, destructive, disabled, testID, children, right, leading } = props;
  const c = useSettingsColours();
  const page = useContext(SettingsPageContext);
  const rowRef = useRef<View>(null);
  const key = props.searchKey ?? title;
  const [flash, setFlash] = useState(false);
  const isHit = page.highlight != null && page.highlight === key;
  useEffect(() => {
    if (!isHit) return;
    // Wait a frame so the page has laid out, then scroll there and flash the row.
    const t1 = setTimeout(() => {
      page.scrollToRow(rowRef);
      setFlash(true);
    }, 350);
    const t2 = setTimeout(() => setFlash(false), 2000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isHit, page]);

  const press = toggle ? () => !toggle.disabled && toggle.onValueChange(!toggle.value) : onPress;
  const tile = icon ? SETTINGS_ICON[meaning] : null;
  const role = toggle ? "switch" : selected !== undefined ? "radio" : press ? "button" : undefined;
  const content = (
    <>
      <View style={styles.rowLine}>
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        {!leading && tile && icon ? (
          <View style={[styles.iconTile, { backgroundColor: tile.fill }]}>
            <Icon name={icon} size={19} color={tile.glyph} />
          </View>
        ) : null}
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: destructive ? c.danger : c.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.rowSubtitle, { color: c.subtext }]}>{subtitle}</Text> : null}
        </View>
        {right}
        {value ? (
          <Text style={[styles.rowValue, { color: c.subtext }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {toggle ? (
          <Switch
            value={toggle.value}
            onValueChange={toggle.onValueChange}
            disabled={toggle.disabled}
            trackColor={{ true: BLUE, false: c.switchOff }}
            thumbColor={WHITE}
            ios_backgroundColor={c.switchOff}
            testID={toggle.testID}
          />
        ) : null}
        {selected !== undefined ? (
          <View style={styles.tickSlot}>{selected ? <Icon name="checkmark" size={22} color={c.tick} /> : null}</View>
        ) : null}
        {onPress && !toggle && selected === undefined ? <Icon name="chevron-forward" size={18} color={c.subtext} /> : null}
      </View>
      {children ? <View style={[styles.rowExtra, tile || leading ? { marginLeft: ICON_TILE + ICON_GAP } : null]}>{children}</View> : null}
    </>
  );
  const rowStyle = [styles.row, flash ? { backgroundColor: c.highlight } : null, disabled ? { opacity: 0.45 } : null];
  const a11y = {
    accessibilityRole: role,
    accessibilityLabel: rowAccessibilityLabel(props),
    accessibilityState: toggle ? { checked: toggle.value, disabled: !!(toggle.disabled || disabled) } : selected !== undefined ? { selected, disabled: !!disabled } : { disabled: !!disabled },
  } as const;
  if (!press || disabled) {
    return (
      <View ref={rowRef} style={rowStyle} testID={testID} {...a11y}>
        {content}
      </View>
    );
  }
  return (
    <Pressable ref={rowRef} onPress={press} style={({ pressed }) => [...rowStyle, pressed ? { backgroundColor: c.highlight } : null]} testID={testID} {...a11y}>
      {content}
    </Pressable>
  );
}

/** A centred action row ("Sign out", "Delete account"). */
export function SettingsActionRow({
  title,
  onPress,
  destructive,
  disabled,
  testID,
  loading,
}: {
  title: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
  loading?: boolean;
}) {
  const c = useSettingsColours();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.row, styles.actionRow, pressed ? { backgroundColor: c.highlight } : null, disabled || loading ? { opacity: 0.45 } : null]}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
    >
      <Text style={[styles.actionText, { color: destructive ? c.danger : c.tick }]}>{loading ? `${title}…` : title}</Text>
    </Pressable>
  );
}

/** A note inside a card (status text, a warning) laid out like a row. */
export function SettingsNoteRow({ text, icon, meaning, onPress, testID }: { text: string; icon?: IconName; meaning?: SettingsIconMeaning; onPress?: () => void; testID?: string }) {
  return <SettingsRow title={text} icon={icon} meaning={meaning} onPress={onPress} testID={testID} />;
}

// ---- Choice list --------------------------------------------------------------------------------

export interface ChoiceOption<K extends string = string> {
  key: K;
  label: string;
  hint?: string;
}

/** A single-choice list: one row per option, a ✓ on the selected one. */
export function SettingsChoiceSection<K extends string>({
  title,
  footer,
  options,
  selected,
  onSelect,
  testIDPrefix,
}: {
  title?: string;
  footer?: string;
  options: ChoiceOption<K>[];
  selected: K | null;
  onSelect: (key: K) => void;
  testIDPrefix?: string;
}) {
  return (
    <SettingsSection title={title} footer={footer}>
      {options.map((o) => (
        <SettingsRow
          key={o.key}
          title={o.label}
          subtitle={o.hint}
          selected={selected === o.key}
          onPress={() => onSelect(o.key)}
          testID={testIDPrefix ? `${testIDPrefix}-${o.key}` : undefined}
        />
      ))}
    </SettingsSection>
  );
}

// ---- Visual picker ------------------------------------------------------------------------------

export interface PickerItem<K extends string = string> {
  key: K;
  label: string;
  preview: React.ReactNode;
}

/** Visual choices (map theme, card colours, marker): previews 2 or 3 per row, name underneath,
 * the selected one with a blue border and a ✓ badge. */
export function SettingsPicker<K extends string>({
  title,
  footer,
  items,
  selected,
  onSelect,
  columns = 2,
  testIDPrefix,
  previewHeight = 92,
}: {
  title?: string;
  footer?: string;
  items: PickerItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  columns?: 2 | 3;
  testIDPrefix?: string;
  previewHeight?: number;
}) {
  const c = useSettingsColours();
  const tileWidth: ViewStyle["width"] = columns === 3 ? "31%" : "48%";
  return (
    <View style={styles.section}>
      {title ? <Text style={[styles.sectionTitle, { color: c.subtext }]}>{title}</Text> : null}
      <View style={[styles.card, styles.pickerCard, { backgroundColor: c.card }]}>
        {items.map((item) => {
          const isSel = item.key === selected;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [styles.pickerTile, { width: tileWidth }, pressed ? { opacity: 0.7 } : null]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSel }}
              accessibilityLabel={`${item.label}${isSel ? ", selected" : ""}`}
              testID={testIDPrefix ? `${testIDPrefix}-${item.key}` : undefined}
            >
              <View style={[styles.pickerPreview, { height: previewHeight, borderColor: isSel ? c.tick : c.separator, borderWidth: isSel ? 2 : 1 }]}>
                {item.preview}
                {isSel ? (
                  <View style={[styles.pickerBadge, { backgroundColor: c.tick }]}>
                    <Icon name="checkmark" size={13} color={WHITE} />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.pickerLabel, { color: isSel ? c.tick : c.text }]} numberOfLines={2}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {footer ? <Text style={[styles.footer, { color: c.subtext }]}>{footer}</Text> : null}
    </View>
  );
}

// ---- Inputs -------------------------------------------------------------------------------------

export function SettingsInput(props: React.ComponentProps<typeof TextInput>) {
  const c = useSettingsColours();
  return (
    <TextInput
      placeholderTextColor={c.subtext}
      {...props}
      style={[styles.input, { backgroundColor: c.input, color: c.text }, props.style]}
    />
  );
}

export function useColours(): SettingsColours {
  return useSettingsColours();
}

const styles = StyleSheet.create({
  pageContent: { paddingHorizontal: PAD, paddingBottom: 48 },
  largeTitle: { fontSize: 28, fontWeight: "700", marginTop: 4, marginBottom: 4 },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 13, fontWeight: "600", marginBottom: 8, marginLeft: PAD },
  card: { borderRadius: 16, overflow: "hidden" },
  footer: { fontSize: 13, lineHeight: 18, marginTop: 8, marginHorizontal: PAD },
  separator: { height: StyleSheet.hairlineWidth > 0.5 ? 1 : 1 },
  row: { minHeight: ROW_MIN_HEIGHT, paddingHorizontal: PAD, paddingVertical: 10, justifyContent: "center" },
  rowLine: { flexDirection: "row", alignItems: "center", gap: ICON_GAP },
  leading: { width: ICON_TILE, height: ICON_TILE, alignItems: "center", justifyContent: "center" },
  iconTile: { width: ICON_TILE, height: ICON_TILE, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 17, fontWeight: "600" },
  rowSubtitle: { fontSize: 14, fontWeight: "400", lineHeight: 19 },
  rowValue: { fontSize: 15, maxWidth: 150 },
  rowExtra: { marginTop: 8 },
  tickSlot: { width: 24, alignItems: "flex-end" },
  actionRow: { alignItems: "center" },
  actionText: { fontSize: 17, fontWeight: "600" },
  pickerCard: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", padding: 12, rowGap: 14 },
  pickerTile: { minHeight: 44 },
  pickerPreview: { borderRadius: 14, overflow: "hidden" },
  pickerBadge: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  pickerLabel: { fontSize: 15, fontWeight: "600", marginTop: 6 },
  input: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, marginTop: 8 },
});
