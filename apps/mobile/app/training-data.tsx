import { TRAINING_DATA_RETENTION_COPY } from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { InfoRow } from "@/components/ui/screen-state";
import { getTrainingDataStatus, optInToTrainingData, optOutOfTrainingData } from "@/lib/api";
import { colors, space } from "@/lib/theme";

export default function TrainingDataScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [optedOut, setOptedOut] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    setLoading(true);
    setError(null);
    void getTrainingDataStatus()
      .then((result) => {
        setOptedOut(result.optedOut);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Failed to load settings");
        setLoading(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStatus();
    }, [loadStatus]),
  );

  const handleToggle = useCallback(
    (value: boolean) => {
      setToggling(true);
      setError(null);
      const action = value ? optInToTrainingData() : optOutOfTrainingData();
      void action
        .then(() => {
          setOptedOut(!value);
          setToggling(false);
        })
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : "Failed to update setting");
          setToggling(false);
        });
    },
    [],
  );

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="Scanner Improvement" />
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        <Text style={styles.title}>{TRAINING_DATA_RETENTION_COPY.settingsLabel}</Text>

        {loading ? (
          <ActivityIndicator color={colors.accent} size="small" style={styles.loading} />
        ) : (
          <View style={styles.toggleRow}>
            <Switch
              disabled={toggling}
              onValueChange={handleToggle}
              trackColor={{ false: colors.mutedBg, true: colors.accent }}
              value={!optedOut}
            />
          </View>
        )}

        <Text style={styles.help}>{TRAINING_DATA_RETENTION_COPY.settingsHelp}</Text>

        {error && <InfoRow message={error} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: space.lg,
    paddingBottom: 48,
    gap: space.md,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: space.xs,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.sm,
  },
  help: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  loading: {
    paddingVertical: space.md,
  },
});
