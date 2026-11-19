import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { TextInput } from "@/components/AppText";
import { Icon } from "@/components/ui/Icon";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import {
  CATEGORY_ORDER,
  SETTINGS_CATEGORY_ICONS,
  SETTINGS_CATEGORY_LABELS,
  SETTINGS_CATEGORY_MEANING,
  type SettingsCategory,
} from "@/screens/settingsCategories";
import { categorySummary, searchSettings } from "@/settings/settingsIndex";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";
import { useSettingsColours } from "@/components/settings/settingsScheme";

// Settings home (Waze-style): a search bar that finds any setting and jumps to it, then the
// groups, each with its coloured icon and one line saying how it's set now. Every group opens
// the same SettingsScreen filtered to that group's sections.
const ORDER: SettingsCategory[] = [...CATEGORY_ORDER, ...(__DEV__ ? (["developer"] as SettingsCategory[]) : [])];

/** Where each group sits on the home: three cards, like the phone's own Settings. */
const HOME_CARDS: SettingsCategory[][] = [
  ["account", "privacy"],
  ["mapDisplay", "mapInfo", "navigationVoice", "alertsCommunity", "notifications", "plannedDrives", "vehicleAI"],
  ["about", "developer"],
];

export function SettingsCategoriesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { settings } = useSettings();
  const { user } = useAuth();
  const c = useSettingsColours();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchSettings(query), [query]);
  const version = `Version ${Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "1.0.0"}${Application.nativeBuildVersion ? ` (build ${Application.nativeBuildVersion})` : ""}`;
  const ctx = { isGuest: !user || user.isAnonymous, signedInEmail: user?.email ?? null, version };

  return (
    <SettingsPage title="Settings" testID="settings-home">
      <View style={[styles.search, { backgroundColor: c.card }]}>
        <Icon name="search" size={18} color={c.subtext} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search settings"
          placeholderTextColor={c.subtext}
          style={[styles.searchInput, { color: c.text }]}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search settings"
          testID="settings-search"
        />
      </View>

      {query.trim() ? (
        results.length ? (
          <SettingsSection title="Results">
            {results.slice(0, 20).map((r) => (
              <SettingsRow
                key={`${r.category}-${r.title}`}
                icon={SETTINGS_CATEGORY_ICONS[r.category]}
                meaning={SETTINGS_CATEGORY_MEANING[r.category]}
                title={r.title}
                subtitle={SETTINGS_CATEGORY_LABELS[r.category]}
                onPress={() => navigation.navigate("Settings", { category: r.category, highlight: r.title })}
                testID={`search-result-${r.title}`}
              />
            ))}
          </SettingsSection>
        ) : (
          <SettingsSection title="Results">
            <SettingsRow title="No settings match" subtitle="Try another word, like voice, units or ghost" />
          </SettingsSection>
        )
      ) : (
        HOME_CARDS.map((card, i) => (
          <SettingsSection key={i}>
            {card
              .filter((cat) => ORDER.includes(cat))
              .map((cat) => (
                <SettingsRow
                  key={cat}
                  icon={SETTINGS_CATEGORY_ICONS[cat]}
                  meaning={SETTINGS_CATEGORY_MEANING[cat]}
                  title={SETTINGS_CATEGORY_LABELS[cat]}
                  subtitle={categorySummary(cat, settings, ctx)}
                  onPress={() => navigation.navigate("Settings", { category: cat })}
                  testID={`settings-group-${cat}`}
                />
              ))}
          </SettingsSection>
        ))
      )}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, marginTop: 12 },
  searchInput: { flex: 1, fontSize: 17, paddingVertical: 10 },
});
