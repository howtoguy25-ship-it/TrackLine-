import React from "react";
import { Pressable, ScrollView, StyleSheet, Switch } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View } from "@/components/ui/Surface";
import { Text } from "@/components/AppText";
import { Icon } from "@/components/ui/Icon";
import { ReportItemIcon } from "@/components/settings/ReportItemIcon";
import { useSettings } from "@/context/SettingsContext";
import { colors, spacing } from "@/theme/tokens";
import {
  DATA_SOURCE_LABELS,
  REPORT_ITEM_BY_ID,
  SECTION_ORDER,
  SECTION_TITLES,
  alertsWhileDriving,
  isShown,
  itemsIn,
  prefPatch,
  sourcesLine,
  type ReportItemId,
} from "@/settings/reportCatalog";
import type { RootStackParamList } from "@/navigation/RootNavigator";

// Settings > Map information & overlays > Reports: every camera, road feature and report type,
// grouped, each with its own icon, a one-line description and a chevron to its detail screen.

function stateText(settings: ReturnType<typeof useSettings>["settings"], id: ReportItemId): string {
  const item = REPORT_ITEM_BY_ID[id];
  const parts: string[] = [];
  if (item.show) parts.push(isShown(settings, id) ? "On map" : "");
  if (item.alert) parts.push(alertsWhileDriving(settings, id) ? "Alerts" : "");
  const on = parts.filter(Boolean);
  return on.length ? on.join(" · ") : "Off";
}

export function ReportsSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { settings } = useSettings();
  return (
    <ScrollView contentContainerStyle={styles.content} testID="reports-settings">
      {SECTION_ORDER.map((section) => (
        <View key={section} style={styles.section}>
          <Text style={styles.sectionTitle}>{SECTION_TITLES[section]}</Text>
          {itemsIn(section).map((item) => (
            <Pressable
              key={item.id}
              onPress={() => navigation.navigate("ReportItemSettings", { id: item.id })}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.description}. ${stateText(settings, item.id)}`}
              testID={`report-row-${item.id}`}
            >
              <ReportItemIcon id={item.id} size={36} />
              <View style={styles.rowText}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.description} numberOfLines={1}>
                  {item.description}
                </Text>
              </View>
              <Text style={styles.state}>{stateText(settings, item.id)}</Text>
              <Icon name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

export function ReportItemSettingsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "ReportItemSettings">>();
  const { settings, updateSettings } = useSettings();
  const id = route.params.id;
  const item = REPORT_ITEM_BY_ID[id];
  const toggle = (which: "show" | "alert", value: boolean) => updateSettings(prefPatch(settings, id, which, value));
  return (
    <ScrollView contentContainerStyle={styles.content} testID={`report-detail-${id}`}>
      <View style={styles.hero}>
        <ReportItemIcon id={id} size={72} />
        <Text style={styles.heroTitle}>{item.title}</Text>
        <Text style={styles.explanation}>{item.explanation}</Text>
        <Text style={styles.sourcesLine} testID="sources-line">{sourcesLine(id)}</Text>
        <Text style={styles.source} testID="data-source">{item.sources.map((s) => DATA_SOURCE_LABELS[s]).join(" · ")}</Text>
      </View>
      {item.show && (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Show on map</Text>
          <Switch value={isShown(settings, id)} onValueChange={(v) => toggle("show", v)} testID="toggle-show" />
        </View>
      )}
      {item.alert && (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Alert while driving</Text>
          <Switch value={alertsWhileDriving(settings, id)} onValueChange={(v) => toggle("alert", v)} testID="toggle-alert" />
        </View>
      )}
      {item.alert && (
        <Text style={styles.footnote}>Alerts are a short message on the map and a spoken line, once as you approach, following your voice settings.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginBottom: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, minHeight: 56 },
  pressed: { opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  description: { fontSize: 13, color: colors.textMuted },
  state: { fontSize: 12, color: colors.textMuted },
  hero: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  heroTitle: { fontSize: 22, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
  explanation: { fontSize: 15, color: colors.text, textAlign: "center" },
  source: { fontSize: 13, color: colors.textMuted, textAlign: "center" },
  sourcesLine: { fontSize: 14, color: colors.text, textAlign: "center", fontWeight: "600" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 56 },
  toggleLabel: { fontSize: 16, color: colors.text },
  footnote: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
});
