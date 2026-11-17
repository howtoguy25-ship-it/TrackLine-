import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useSettings } from "@/context/SettingsContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { CHOICE_LISTS } from "@/settings/choiceLists";
import { SettingsActionRow, SettingsInput, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";

// One long single-choice list on its own page (opened from a row showing the current value,
// e.g. "Speeding alert · +5 km/h"). The title here is the row's name, and the next page's back
// button would say it too.
export function SettingsChoiceScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "SettingsChoice">>();
  const list = CHOICE_LISTS[route.params.list];
  const { settings, updateSettings } = useSettings();
  const selected = list.selected(settings);
  const [customOpen, setCustomOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  const applyCustom = () => {
    const h = Math.max(0, parseInt(hours, 10) || 0);
    const m = Math.max(0, Math.min(59, parseInt(minutes, 10) || 0));
    const ms = (h * 60 + m) * 60 * 1000;
    if (ms <= 0) return;
    updateSettings({ alertExpiryMs: ms });
    setCustomOpen(false);
  };

  return (
    <SettingsPage title={list.title} testID={`choice-${list.id}`}>
      <SettingsSection footer={list.footer}>
        {list.options(settings).map((o) => (
          <SettingsRow
            key={o.key}
            title={o.label}
            subtitle={o.hint}
            selected={selected === o.key}
            onPress={() => {
              if (list.id === "alertLifetime" && o.key === "custom") {
                setCustomOpen(true);
                return;
              }
              updateSettings(list.patch(o.key, settings));
            }}
            testID={`choice-${list.id}-${o.key}`}
          />
        ))}
      </SettingsSection>
      {list.id === "alertLifetime" && customOpen ? (
        <SettingsSection title="Custom lifetime">
          <View style={styles.inputs}>
            <SettingsInput value={hours} onChangeText={setHours} placeholder="Hours" keyboardType="number-pad" style={styles.input} accessibilityLabel="Hours" />
            <SettingsInput value={minutes} onChangeText={setMinutes} placeholder="Minutes" keyboardType="number-pad" style={styles.input} accessibilityLabel="Minutes" />
          </View>
          <SettingsActionRow title="Apply" onPress={applyCustom} testID="custom-lifetime-apply" />
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  inputs: { flexDirection: "row", gap: 12, padding: 16, paddingTop: 8 },
  input: { flex: 1 },
});
