import React from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { View } from "@/components/ui/Surface";
import { Text } from "@/components/AppText";
import { Icon } from "@/components/ui/Icon";
import { REPORT_STATUS } from "@/theme/colors";
import { colors, radius, spacing } from "@/theme/tokens";
import { OdometerChart } from "@/components/vehicleCheck/OdometerChart";
import { sectionLines } from "@/vehicleCheck/sectionLines";
import { SECTION_LABELS, SECTION_ORDER, footerText, reportTitle, type Section, type SectionKey, type VehicleReport } from "@/vehicleCheck/model";

// One full-check report: every section as a card -- green / amber / red with what the provider
// said, its source and "data as at" date -- or a spinner while it loads, or "Couldn't load --
// tap to retry" (a free retry) when its provider failed. The sample report wears a banner.

interface Props {
  report: VehicleReport;
  /** Retry one failed section (free). Absent for the sample. */
  onRetry?: (section: SectionKey) => void;
  retrying?: SectionKey | null;
}

export function VehicleReportView({ report, onRetry, retrying }: Props) {
  const { width } = useWindowDimensions();
  const keys = SECTION_ORDER.filter((k) => k !== "recalls" || report.sections.recalls);
  return (
    <View testID={report.sample ? "vehicle-report-sample" : "vehicle-report"}>
      {report.sample && (
        <View style={styles.sampleBanner} testID="sample-banner">
          <Text style={styles.sampleText}>Sample report: example data, not a real vehicle</Text>
        </View>
      )}
      <Text style={styles.title}>{reportTitle(report)}</Text>
      {keys.map((k) => (
        <SectionCard
          key={k}
          sectionKey={k}
          section={report.sections[k] as Section | undefined}
          chartWidth={width - 2 * spacing.lg - 2 * spacing.md}
          onRetry={onRetry && report.status !== "running" ? () => onRetry(k) : undefined}
          retrying={retrying === k}
        />
      ))}
      <Text style={styles.footer} testID="vehicle-report-footer">
        {footerText(report.providers)}
      </Text>
    </View>
  );
}

function SectionCard({
  sectionKey,
  section,
  chartWidth,
  onRetry,
  retrying,
}: {
  sectionKey: SectionKey;
  section: Section | undefined;
  chartWidth: number;
  onRetry?: () => void;
  retrying: boolean;
}) {
  const label = SECTION_LABELS[sectionKey];
  if (!section || section.status === "loading") {
    return (
      <View style={styles.card} testID={`section-${sectionKey}-loading`}>
        <View style={styles.row}>
          <ActivityIndicator size="small" />
          <Text style={styles.cardTitle}>{label}</Text>
        </View>
        <Text style={styles.muted}>Checking…</Text>
      </View>
    );
  }
  if (section.status === "failed" || section.status === "blocked") {
    const notFound = section.status === "failed" && section.notFound;
    const canRetry = section.status === "failed" && !notFound && !!onRetry;
    return (
      <Pressable
        style={styles.card}
        onPress={canRetry && !retrying ? onRetry : undefined}
        disabled={!canRetry || retrying}
        accessibilityRole={canRetry ? "button" : undefined}
        accessibilityLabel={canRetry ? `${label}: couldn't load. Tap to retry, free.` : undefined}
        testID={`section-${sectionKey}-${section.status}`}
      >
        <Text style={styles.cardTitle}>{label}</Text>
        <View style={styles.row}>
          {retrying ? <ActivityIndicator size="small" /> : <Icon name={notFound ? "search" : section.status === "blocked" ? "lock-closed" : "refresh"} size={16} color={colors.textMuted} />}
          <Text style={styles.muted}>
            {notFound ? "Vehicle not found" : section.status === "blocked" ? `BLOCKED: ${section.reason}` : canRetry ? "Couldn't load — tap to retry" : "Couldn't load"}
          </Text>
        </View>
      </Pressable>
    );
  }
  const st = REPORT_STATUS[section.grade];
  const lines = sectionLines(sectionKey, section);
  const certificateUrl = sectionKey === "ppsr" ? (section.data as { certificateUrl: string | null }).certificateUrl : null;
  return (
    <View style={styles.card} testID={`section-${sectionKey}`}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: st.dot }]} />
        <Text style={styles.cardTitle}>{label}</Text>
      </View>
      <View style={[styles.badge, { backgroundColor: st.fill }]} testID={`section-${sectionKey}-grade-${section.grade}`}>
        <Text style={[styles.badgeText, { color: st.on }]}>{`${st.label}: ${section.summary}`}</Text>
      </View>
      {sectionKey === "odometer" && (
        <OdometerChart readings={(section.data as { readings: { date: string; km: number }[] }).readings} width={chartWidth} />
      )}
      {sectionKey !== "odometer" &&
        lines.map(([k, v]) => (
          <View key={`${k}-${v}`} style={styles.line}>
            <Text style={styles.lineLabel}>{k}</Text>
            <Text style={styles.lineValue} selectable>
              {v}
            </Text>
          </View>
        ))}
      {certificateUrl && (
        <Pressable onPress={() => Linking.openURL(certificateUrl)} accessibilityRole="link" style={styles.row} testID="ppsr-certificate">
          <Icon name="file-certificate" size={16} color={colors.primary} />
          <Text style={styles.link}>Official PPSR certificate (PDF)</Text>
        </Pressable>
      )}
      <Text style={styles.muted}>{`Source: ${section.source} · data as at ${section.asAt}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sampleBanner: { backgroundColor: REPORT_STATUS.amber.fill, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm },
  sampleText: { color: REPORT_STATUS.amber.on, fontWeight: "700", textAlign: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  badge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 14, fontWeight: "600" },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineLabel: { color: colors.textMuted, fontSize: 14 },
  lineValue: { color: colors.text, fontSize: 14, flexShrink: 1, textAlign: "right" },
  link: { color: colors.primary, fontWeight: "600" },
  muted: { color: colors.textMuted, fontSize: 12 },
  footer: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm, marginBottom: spacing.xl },
});
