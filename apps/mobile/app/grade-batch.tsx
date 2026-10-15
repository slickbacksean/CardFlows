import {
  BATCH_QUEUE_NOTE,
  BATCH_QUEUE_TITLE,
  batchCandidates,
  batchSummary,
  runBatchQueue,
  type BatchItem,
} from "@cardflow/shared";
import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/ui/primary-button";
import { listInventory, requestGradeEstimate, type InventoryItem } from "@/lib/api";
import { colors, radii, space } from "@/lib/theme";

/** Batch scan session start, kept for the app session only. */
let sessionStartedAt: string | null = null;

const STATUS_COPY: Record<BatchItem["status"], string> = {
  queued: "Queued",
  running: "Estimating…",
  done: "Pre-grade estimate",
  no_estimate: "Needs a retake",
  unavailable: "Estimate unavailable",
  skipped: "Skipped",
};

export default function GradeBatchScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [session, setSession] = useState<string | null>(sessionStartedAt);
  const [results, setResults] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setItems((await listInventory()).items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the collection");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const queue = batchCandidates(items, session);
  const nameOf = (id: string) => {
    const item = items.find((entry) => entry.inventoryItemId === id);
    return item?.card?.name?.trim() || item?.draft?.title?.trim() || "Card";
  };

  function toggleSession() {
    sessionStartedAt = session ? null : new Date().toISOString();
    setSession(sessionStartedAt);
    setResults([]);
  }

  async function runAll() {
    if (running || queue.length === 0) return;
    cancelRef.current = false;
    setRunning(true);
    try {
      await runBatchQueue(
        queue.map((item) => item.inventoryItemId),
        (id) => requestGradeEstimate(id),
        setResults,
        () => cancelRef.current,
      );
    } finally {
      setRunning(false);
    }
  }

  const shown: BatchItem[] =
    results.length > 0
      ? results
      : queue.map((item) => ({ inventoryItemId: item.inventoryItemId, status: "queued", display: null }));

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
      <Stack.Screen options={{ title: BATCH_QUEUE_TITLE }} />
      <Text style={styles.muted}>{BATCH_QUEUE_NOTE}</Text>
      <View style={styles.card}>
        <Text style={styles.label}>{session ? "Batch scan session on" : "Batch scan session off"}</Text>
        <Text style={styles.muted}>
          {session
            ? "Cards you scan and save from now on join this queue. Scan them, then come back and run the batch."
            : "Start a session to queue only the cards you scan next. Off: every purchased card with a front photo."}
        </Text>
        <View style={styles.actions}>
          <Pressable accessibilityLabel={session ? "End session" : "Start session"} accessibilityRole="button" disabled={running} onPress={toggleSession}>
            <Text style={styles.link}>{session ? "End session" : "Start session"}</Text>
          </Pressable>
          {session ? (
            <Pressable accessibilityLabel="Scan cards" accessibilityRole="button" onPress={() => router.push("/(tabs)/scan-tab")}>
              <Text style={styles.link}>Scan cards</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <PrimaryButton
        disabled={running || queue.length === 0}
        label={running ? "Running…" : `Pre-grade ${queue.length} cards`}
        onPress={() => void runAll()}
      />
      {running ? (
        <Pressable accessibilityLabel="Stop after this card" accessibilityRole="button" onPress={() => (cancelRef.current = true)}>
          <Text style={styles.link}>Stop after this card</Text>
        </Pressable>
      ) : null}
      {results.length > 0 && !running ? <Text style={styles.label}>{batchSummary(results)}</Text> : null}
      {shown.map((entry) => (
        <View key={entry.inventoryItemId} style={styles.row}>
          <Text style={styles.name}>{nameOf(entry.inventoryItemId)}</Text>
          <View style={styles.status}>
            {entry.status === "running" ? <ActivityIndicator color={colors.accent} /> : null}
            <Text style={styles.muted}>
              {STATUS_COPY[entry.status]}
              {entry.status === "done" && entry.display ? ` ${entry.display}` : ""}
            </Text>
          </View>
        </View>
      ))}
      {queue.length === 0 ? (
        <Text style={styles.muted}>No cards with a stored front photo yet.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 48, gap: space.md },
  card: { backgroundColor: colors.card, borderRadius: radii.lg, padding: space.md, gap: 6 },
  label: { color: colors.text, fontSize: 15, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  link: { color: colors.accent, fontWeight: "700" },
  actions: { flexDirection: "row", gap: space.md },
  row: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: space.md, gap: 4 },
  name: { color: colors.text, fontSize: 15, fontWeight: "700" },
  status: { flexDirection: "row", alignItems: "center", gap: space.sm },
  error: { color: colors.danger, fontSize: 14 },
});
