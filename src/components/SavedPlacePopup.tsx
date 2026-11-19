import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text, TextInput } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, radius, shadow, spacing } from "@/theme/tokens";

// Tap Home, Work, a saved place or your parking spot on the map: Send / Routes, and ••• for
// Preview location, Mark your parking spot, Find my car, Edit and Remove.

export type SavedPinKind = "home" | "work" | "custom" | "parking";

export interface SavedPinPlace {
  kind: SavedPinKind;
  placeId: string;
  title: string;
  address: string;
  location: { latitude: number; longitude: number };
}

export interface SavedPlaceActions {
  onSend: () => void;
  onRoutes: () => void;
  onPreview: () => void;
  onMarkParking: () => void;
  onFindCar: (() => void) | null;
  /** Home/Work: pick a new address. A saved place: rename (gets the new name). */
  onEdit: (newLabel?: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

const ICONS: Record<SavedPinKind, IconName> = { home: "home", work: "briefcase", custom: "star", parking: "parking" };

export function SavedPlacePopup({ place, bottom, ...a }: { place: SavedPinPlace; bottom: number } & SavedPlaceActions) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(place.title);
  const isParking = place.kind === "parking";
  return (
    <View style={[styles.card, { bottom }]} testID="saved-place-popup">
      <View style={styles.header}>
        <View style={styles.icon}>
          <Icon name={ICONS[place.kind]} size={20} color="#FFFFFF" />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>{place.title}</Text>
          {!!place.address && <Text style={styles.address} numberOfLines={2}>{place.address}</Text>}
        </View>
        <Button variant="ghost" icon="close" onPress={a.onClose} accessibilityLabel="Close" />
      </View>

      {renaming ? (
        <View style={styles.actions}>
          <TextInput value={label} onChangeText={setLabel} style={styles.input} accessibilityLabel="Name" autoFocus maxLength={40} />
          <Button variant="primary" label="Save" onPress={() => { setRenaming(false); a.onEdit(label.trim() || place.title); }} accessibilityLabel="Save name" testID="saved-rename-save" />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button variant="secondary" label="Send" icon="share" onPress={a.onSend} accessibilityLabel={`Send ${place.title}`} testID="saved-send" />
          <Button variant="primary" label={isParking ? "Find my car" : "Routes"} icon="navigate" onPress={a.onRoutes} accessibilityLabel={isParking ? "Find my car" : `Routes to ${place.title}`} testID="saved-routes" />
          <Button variant="ghost" icon="ellipsis-horizontal" onPress={() => setMenuOpen((o) => !o)} accessibilityLabel="More options" testID="saved-more" />
        </View>
      )}

      {menuOpen && !renaming && (
        <View style={styles.menu} testID="saved-menu">
          <MenuRow icon="eye" label="Preview location" onPress={() => { setMenuOpen(false); a.onPreview(); }} />
          {!isParking && <MenuRow icon="parking" label="Mark your parking spot" onPress={() => { setMenuOpen(false); a.onMarkParking(); }} />}
          {!isParking && a.onFindCar && <MenuRow icon="car" label="Find my car" onPress={() => { setMenuOpen(false); a.onFindCar?.(); }} />}
          {!isParking && (
            <MenuRow
              icon="pencil"
              label={place.kind === "custom" ? "Edit name" : "Edit address"}
              onPress={() => {
                setMenuOpen(false);
                if (place.kind === "custom") setRenaming(true);
                else a.onEdit();
              }}
            />
          )}
          <MenuRow icon="trash" label={isParking ? "Remove parking spot" : "Remove"} danger onPress={() => { setMenuOpen(false); a.onRemove(); }} />
        </View>
      )}
    </View>
  );
}

function MenuRow({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Button variant="ghost" icon={icon} iconColor={danger ? colors.danger : colors.text} label={label} onPress={onPress} accessibilityLabel={label} testID={`saved-menu-${label}`} style={styles.menuRow} />
  );
}

const styles = StyleSheet.create({
  card: { position: "absolute", left: spacing.md, right: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, ...shadow.medium },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  address: { fontSize: 13, color: colors.textMuted },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, minHeight: 44, color: colors.text },
  menu: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs },
  menuRow: { justifyContent: "flex-start" },
});
