import React, { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { colors, spacing } from "@/theme/tokens";
import { db } from "@/services/firebase";
import { useAuth } from "@/context/AuthContext";

// Privacy & legal: the owner publishes versioned Privacy Policy / Terms text from the dashboard
// (legalDocs/{kind}). A "major" version is shown once to every user to accept.
type Kind = "privacy" | "terms";
interface LegalDoc {
  version: number;
  lastMajorVersion: number | null;
  text: string;
}

/** Which document (if any) this user still has to accept. Pure. */
export function pendingAcceptance(docs: Partial<Record<Kind, LegalDoc>>, accepted: Partial<Record<Kind, number>>): Kind | null {
  for (const k of ["terms", "privacy"] as Kind[]) {
    const d = docs[k];
    if (d && d.lastMajorVersion && (accepted[k] ?? 0) < d.lastMajorVersion) return k;
  }
  return null;
}

export function LegalGate() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<Partial<Record<Kind, LegalDoc>>>({});
  const [accepted, setAccepted] = useState<Partial<Record<Kind, number>> | null>(null);

  useEffect(() => {
    const offs = (["privacy", "terms"] as Kind[]).map((k) =>
      onSnapshot(
        doc(db, "legalDocs", k),
        (snap) => setDocs((d) => ({ ...d, [k]: snap.exists() ? (snap.data() as LegalDoc) : undefined })),
        () => undefined
      )
    );
    return () => offs.forEach((o) => o());
  }, []);
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid))
      .then((s) => setAccepted((s.exists() && (s.data().acceptedLegal as Partial<Record<Kind, number>>)) || {}))
      .catch(() => setAccepted(null));
  }, [user]);

  const kind = accepted ? pendingAcceptance(docs, accepted) : null;
  const d = kind ? docs[kind] : null;
  if (!kind || !d || !user) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={() => undefined}>
      <View style={styles.root} testID="legal-gate">
        <Text style={styles.title}>{kind === "privacy" ? "We've updated our Privacy Policy" : "We've updated our Terms"}</Text>
        <ScrollView style={styles.scroll}>
          <Text style={styles.body}>{d.text}</Text>
        </ScrollView>
        <Button
          variant="primary"
          label="Accept"
          fullWidth
          onPress={() => {
            const next = { ...(accepted ?? {}), [kind]: d.version };
            setAccepted(next);
            setDoc(doc(db, "users", user.uid), { acceptedLegal: next }, { merge: true }).catch(() => {});
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, paddingTop: 64, gap: spacing.md, backgroundColor: colors.surface },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  scroll: { flex: 1 },
  body: { fontSize: 15, color: colors.text, lineHeight: 22 },
});
