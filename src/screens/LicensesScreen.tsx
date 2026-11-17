import React from "react";
import { Linking } from "react-native";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";

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
    name: "Rubik (the app's typeface)",
    license: "SIL Open Font License 1.1 — © The Rubik Project Authors",
    description:
      "The font used throughout the app, in Regular, Medium, SemiBold and Bold. Bundled unmodified via the @expo-google-fonts/rubik package.",
    url: "https://openfontlicense.org",
  },
  {
    name: "OpenStreetMap",
    license: "Open Database License (ODbL) — © OpenStreetMap contributors",
    description:
      "The roads, places and names on the map (through Mapbox's map data, which is built on OpenStreetMap), plus traffic-light and speed-camera locations and nearby fuel/restaurant/hotel/parking place data, queried live via the Overpass API.",
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
    license: "Mapbox Terms of Service — © Mapbox, © OpenStreetMap",
    description:
      "The map itself: map tiles, satellite imagery, live traffic and map rendering (@rnmapbox/maps). Also road-network map matching, used server-side to snap a visible driver's (delayed) location samples to the road they were on before showing them to other drivers (see Settings > Privacy).",
    url: "https://www.mapbox.com/legal/tos",
  },
  {
    name: "Google Places, Routes & Street View",
    license: "Google Maps Platform Terms of Service",
    description: "Place search and details, routing and live traffic times, and Street View imagery.",
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
    description: "This app's own small police-car/ambulance/firetruck classifier was fine-tuned on this labelled dataset (see training/README.md). The trained model ships on the phone; the original images don't.",
    url: "https://universe.roboflow.com/traffic-rbwic/emergency-vehicles-snzgj",
  },
  {
    name: "Ionicons / Material Icons / Material Community Icons",
    license: "MIT / Apache License 2.0 (via @expo/vector-icons)",
    description: "Every icon glyph in this app's UI.",
  },
  {
    name: "Open-source software packages",
    license: "Various (MIT, Apache-2.0, BSD, ISC; no copyleft)",
    description: "Every other library this app is built on (React Native, Expo, Firebase, and the rest). Run `npx license-checker --summary` from the repo root for the full list (see COPYRIGHT_AUDIT.md).",
  },
];

export function LicensesScreen() {
  return (
    <SettingsPage title="Licences and attributions" testID="licences-screen">
      <SettingsSection footer="TrackLine's own artwork (the Tracky characters, the app icon and every alert icon) is made for this app. Everything here is third-party data, models or services the app uses, with its source and licence.">
        {ENTRIES.map((entry) => (
          <SettingsRow
            key={entry.name}
            title={entry.name}
            subtitle={`${entry.license}. ${entry.description}`}
            onPress={entry.url ? () => void Promise.resolve(Linking.openURL(entry.url!)).catch(() => {}) : undefined}
          />
        ))}
      </SettingsSection>
    </SettingsPage>
  );
}
