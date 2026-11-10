import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Keyboard, InputAccessoryView } from "react-native";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

// Real, explicit request (Waze-style redesign, Phase 2 "Where to?" sheet) -- a quick-access row
// of digits (plus "/", for intersections like "5th/Main") pinned directly above the software
// keyboard while typing an address, so a house number or intersection doesn't require switching
// the OS keyboard layout mid-type. Two real, different platform mechanisms, since RN itself only
// gives iOS a built-in "pinned above keyboard" primitive:
// - iOS: react-native core's own InputAccessoryView, linked to the TextInput via a shared
//   inputAccessoryViewID -- the OS handles the actual pinning/show/hide, no manual keyboard-
//   height tracking needed, and it can never render behind/in front of the keyboard incorrectly.
// - Android: InputAccessoryView is an iOS-only no-op there (confirmed against RN's own source --
//   it renders nothing on Android), so this instead tracks Keyboard's own keyboardDidShow/
//   keyboardDidHide events for the keyboard's real, reported height and renders an absolutely-
//   positioned row at exactly that offset -- the same real technique production RN apps use for
//   a custom Android accessory bar in the absence of a core-provided one.
export const ADDRESS_KEYPAD_ACCESSORY_ID = "address-keypad-accessory";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "/"];

interface Props {
  visible: boolean;
  onKeyPress: (char: string) => void;
}

function KeypadRow({ onKeyPress }: { onKeyPress: (char: string) => void }) {
  return (
    <View style={styles.row}>
      {KEYS.map((key) => (
        <Pressable
          key={key}
          onPress={() => onKeyPress(key)}
          style={({ pressed }) => [styles.key, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel={`Insert ${key}`}
        >
          <Text style={styles.keyText}>{key}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function AddressKeypadAccessory({ visible, onKeyPress }: Props) {
  if (Platform.OS === "ios") {
    // Always mounted -- iOS only actually shows it while the linked TextInput (via
    // inputAccessoryViewID) is focused and the keyboard is up, same as any native accessory view.
    return (
      <InputAccessoryView nativeID={ADDRESS_KEYPAD_ACCESSORY_ID}>
        <View style={styles.iosBar}>
          <KeypadRow onKeyPress={onKeyPress} />
        </View>
      </InputAccessoryView>
    );
  }
  return <AndroidKeypadAccessory visible={visible} onKeyPress={onKeyPress} />;
}

function AndroidKeypadAccessory({ visible, onKeyPress }: Props) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (!visible || keyboardHeight === 0) return null;
  return (
    <View style={[styles.androidBar, { bottom: keyboardHeight }]} pointerEvents="box-none">
      <KeypadRow onKeyPress={onKeyPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  iosBar: {
    backgroundColor: colors.surfaceMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  androidBar: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    zIndex: 1000,
    elevation: 20,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  key: {
    width: 30,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
});
