import React from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Text } from "@/components/AppText";
import { ReportItemIcon } from "@/components/settings/ReportItemIcon";
import { useSettings } from "@/context/SettingsContext";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";
import { useSettingsColours } from "@/components/settings/settingsScheme";
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
    <SettingsPage title="Reports" testID="reports-settings">
      {SECTION_ORDER.map((section) => (
        <SettingsSection key={section} title={SECTION_TITLES[section]}>
          {itemsIn(section).map((item) => (
            <SettingsRow
              key={item.id}
              leading={<ReportItemIcon id={item.id} size={32} />}
              title={item.title}
              subtitle={item.description}
              value={stateText(settings, item.id)}
              onPress={() => navigation.navigate("ReportItemSettings", { id: item.id })}
              testID={`report-row-${item.id}`}
            />
          ))}
        </SettingsSection>
      ))}
    </SettingsPage>
  );
}

export function ReportItemSettingsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "ReportItemSettings">>();
  const { settings, updateSettings } = useSettings();
  const c = useSettingsColours();
  const id = route.params.id;
  const item = REPORT_ITEM_BY_ID[id];
  const toggle = (which: "show" | "alert", value: boolean) => updateSettings(prefPatch(settings, id, which, value));
  return (
    <SettingsPage title={item.title} testID={`report-detail-${id}`}>
      <View style={styles.hero}>
        <ReportItemIcon id={id} size={64} />
        <Text style={[styles.explanation, { color: c.text }]}>{item.explanation}</Text>
        <Text style={[styles.sourcesLine, { color: c.text }]} testID="sources-line">{sourcesLine(id)}</Text>
        <Text style={[styles.source, { color: c.subtext }]} testID="data-source">{item.sources.map((s) => DATA_SOURCE_LABELS[s]).join(" · ")}</Text>
      </View>
      <SettingsSection
        footer={item.alert ? "An alert is a short message on the map and one spoken line as you approach, following your voice settings." : undefined}
      >
        {item.show ? (
          <SettingsRow
            icon="map"
            meaning="map"
            title="Show on map"
            toggle={{ value: isShown(settings, id), onValueChange: (v) => toggle("show", v), testID: "toggle-show" }}
          />
        ) : null}
        {item.alert ? (
          <SettingsRow
            icon="volume-high"
            meaning="sound"
            title="Alert while driving"
            toggle={{ value: alertsWhileDriving(settings, id), onValueChange: (v) => toggle("alert", v), testID: "toggle-alert" }}
          />
        ) : null}
      </SettingsSection>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 8, marginTop: 16, paddingHorizontal: 8 },
  explanation: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  source: { fontSize: 13, textAlign: "center" },
  sourcesLine: { fontSize: 14, textAlign: "center", fontWeight: "600" },
});
