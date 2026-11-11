import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

// Real, explicit request (Copyright/trademark safety audit, Part 4) -- "Add About>'Licences &
// attributions' screen." Lists every real bundled third-party asset/dataset this app actually
// uses that isn't just an ordinary npm code dependency (those are covered in bulk by `npx
// license-checker`, not practical to enumerate one-by-one in-app -- see COPYRIGHT_AUDIT.md at
// the repo root for that full pass) -- real sources, real licenses, verified against each one's
// own real license page, not assumed.
interface LicenseEntry {
  name: string;
  license: string;
  description: string;
  url?: string;
}

const ENTRIES: LicenseEntry[] = [
  {
    name: "OpenStreetMap",
    license: "Open Database License (ODbL) -- © OpenStreetMap contributors",
    description: "Traffic-light and speed-camera locations, and nearby fuel/restaurant/hotel/parking place data, queried live from OpenStreetMap's community-mapped data via the Overpass API.",
    url: "https://www.openstreetmap.org/copyright",
  },
  {
    name: "Transport for NSW Open Data",
    license: "Creative Commons Attribution 4.0 (CC BY 4.0)",
    description: "Live traffic camera images and live public-transit vehicle positions (NSW only).",
    url: "https://opendata.transport.nsw.gov.au/datalicence",
  },
  {
    name: "Mapbox",
    license: "Mapbox Terms of Service",
    description: "Road-network map matching, used server-side to snap a visible driver's (delayed) location samples to the road they were on before showing them to other drivers (see Settings > Privacy).",
    url: "https://www.mapbox.com/legal/tos",
  },
  {
    name: "Google Maps, Places, Directions & Street View",
    license: "Google Maps Platform Terms of Service",
    description: "The map itself, search, routing, and Street View imagery.",
    url: "https://cloud.google.com/maps-platform/terms",
  },
  {
    name: "COCO-SSD (TensorFlow.js Models)",
    license: "Apache License 2.0",
    description: "Google's pretrained general-purpose object detector, bundled on-device, used to find vehicles in the camera frame before this app's own classifier identifies the type.",
    url: "https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd",
  },
  {
    name: "YAMNet (TensorFlow Hub)",
    license: "Apache License 2.0",
    description: "Google's pretrained audio classifier, bundled on-device, used for siren detection (EV Radar).",
    url: "https://tfhub.dev/google/lite-model/yamnet/tflite/1",
  },
  {
    name: "AudioSet label map (TensorFlow Models)",
    license: "Apache License 2.0",
    description: "The real class list YAMNet's output is matched against.",
    url: "https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv",
  },
  {
    name: "\"Emergency vehicles\" dataset (Roboflow)",
    license: "Creative Commons Attribution 4.0 (CC BY 4.0)",
    description: "This app's own small police-car/ambulance/firetruck classifier was fine-tuned on this labeled dataset (see training/README.md) -- the trained model ships on-device; the original images don't.",
    url: "https://universe.roboflow.com/traffic-rbwic/emergency-vehicles-snzgj",
  },
  {
    name: "Ionicons / Material Icons / Material Community Icons",
    license: "MIT / Apache License 2.0 (via @expo/vector-icons)",
    description: "Every icon glyph in this app's UI.",
  },
  {
    name: "Open-source software packages",
    license: "Various (MIT, Apache-2.0, BSD, ISC -- no copyleft)",
    description: "Every other library this app is built on (React Native, Expo, Firebase, and the rest). Run `npx license-checker --summary` from the repo root for the full, real list -- see COPYRIGHT_AUDIT.md.",
  },
];

export function LicensesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Licences &amp; attributions</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <Text style={styles.intro}>
          TrackLine&apos;s own original artwork (the Tracky characters, the app icon, and every alert
          icon) is hand-made for this app, not traced or downloaded. Everything below is
          third-party data, models, or services this app genuinely uses, with their real source
          and licence.
        </Text>
        {ENTRIES.map((entry) => (
          <Pressable
            key={entry.name}
            style={({ pressed }) => [styles.entry, entry.url && pressed && { opacity: pressedOpacity }]}
            onPress={entry.url ? () => Linking.openURL(entry.url!) : undefined}
            disabled={!entry.url}
          >
            <Text style={styles.entryName}>{entry.name}</Text>
            <Text style={styles.entryLicense}>{entry.license}</Text>
            <Text style={styles.entryDescription}>{entry.description}</Text>
            {entry.url && <Text style={styles.entryLink}>{entry.url}</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: "800", color: colors.text, flex: 1, marginRight: spacing.sm },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  intro: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.lg },
  entry: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  entryName: { fontSize: 14, fontWeight: "700", color: colors.text },
  entryLicense: { fontSize: 12, fontWeight: "700", color: colors.accent, marginTop: 2 },
  entryDescription: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },
  entryLink: { fontSize: 11, color: colors.textFaint, marginTop: 4 },
});
