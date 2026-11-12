import React from "react";
import { Button } from "@/components/ui/Button";
import { View, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sentry } from "@/services/sentry";
import { spacing } from "@/theme/tokens";

interface Props {
  onClose: () => void;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

// Final safety net for the vehicle detection screen: it drives a native camera session plus
// on-device tfjs inference every capture, either of which throwing synchronously during render
// would otherwise crash the whole app the same way an uncaught ads render error would (see
// AdsErrorBoundary). Unlike ads, this screen isn't optional decoration -- a blank crashed modal
// with no way out would be worse than the crash itself, so the fallback keeps a real, working
// Close button instead of rendering null.
export class VehicleDetectionErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[vehicle-detection] render error caught by boundary", error);
    Sentry.captureException(error);
  }

  render() {
    if (this.state.hasError) {
      return <Fallback onClose={this.props.onClose} />;
    }
    return this.props.children;
  }
}

function Fallback({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Vehicle detection ran into a problem and had to stop.</Text>
      <Button
        variant="secondary"
        label="Close"
        onPress={onClose}
        accessibilityLabel="Close vehicle detection"
        style={{ marginBottom: insets.bottom }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.lg,
  },
  text: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
  },
});
