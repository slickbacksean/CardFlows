import {
  ACCOUNT_DELETION_COPY,
  AGE_GATE_COPY,
  CRASH_REPORTS_COPY,
  MARKETPLACE_AUTOMATION_NO_ENABLE_COPY,
  PRACTICE_COPY,
  SETTINGS_KICKER,
  SETTINGS_RESEARCH_FLAGS,
  SETTINGS_RESEARCH_SECTION_LABEL,
  SETTINGS_STACK_SECTION_LABEL,
  SETTINGS_STACK_STATUS_ROWS,
  featureFlagStateLabel,
  settingsJobLabel,
  settingsKickerForIdentity,
  settingsStackStatusValue,
  type CardFlowHealth,
  type InvitedIdentity,
  type SettingsStackLoad,
  classifyLoadError,
  SCREEN_LOADING_LABELS,
  SCREEN_STATE_COPY,
  SETTINGS_STATUS_COPY,
} from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { InfoRow } from "@/components/ui/screen-state";
import { getHealth } from "@/lib/api";
import {
  isGuestSession,
  loadIdentitySession,
} from "@/lib/identity";
import { colors, space } from "@/lib/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const [kicker, setKicker] = useState(SETTINGS_KICKER);
  const [identity, setIdentity] = useState<InvitedIdentity | null>(null);
  const [stack, setStack] = useState<CardFlowHealth | null>(null);
  const [stackLoad, setStackLoad] = useState<SettingsStackLoad>("checking");
  const [stackError, setStackError] = useState<string | null>(null);

  const checkHealth = useCallback((isCancelled: () => boolean = () => false) => {
    setStackLoad("checking");
    setStackError(null);
    void getHealth()
      .then((health) => {
        if (isCancelled()) return;
        setStack(health);
        setStackLoad("ready");
      })
      .catch((caught: unknown) => {
        if (isCancelled()) return;
        setStack(null);
        setStackLoad("unavailable");
        // UX review P1-6: information, not a user error. Offline says so.
        setStackError(
          classifyLoadError(caught) === "offline"
            ? `${SCREEN_STATE_COPY.offlineTitle}. ${SCREEN_STATE_COPY.offlineBody}`
            : SETTINGS_STATUS_COPY.checkFailed,
        );
      });
  }, []);

  const applySession = useCallback(
    (session: { identity: InvitedIdentity | null }) => {
      setIdentity(session.identity);
      setKicker(settingsKickerForIdentity(session.identity));
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadIdentitySession()
        .then((session) => {
          if (cancelled) return;
          applySession(session);
        })
        .catch(() => {
          if (cancelled) return;
          applySession({ identity: null });
          setKicker(SETTINGS_KICKER);
        });
      checkHealth(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [applySession, checkHealth]),
  );

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="close" title="Settings" />
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        <Text style={styles.kicker}>{kicker}</Text>

        <Text style={styles.sectionFirst}>Account</Text>
        <Text style={styles.body}>{identity?.label ?? "Not signed in"}</Text>
        <JobRow label="Sign in or sign up" onPress={() => router.push("/sign-up")} />
        <JobRow
          label="Use a tester invite code"
          onPress={() => router.push("/switch-tester")}
        />

        <JobRow
          label={PRACTICE_COPY.entryLabel}
          onPress={() => router.push("/practice")}
        />

        <JobRow
          label={settingsJobLabel("max_buy_rules")}
          onPress={() => router.push("/max-buy-rules")}
        />

        <JobRow label="Usage analytics" onPress={() => router.push("/analytics")} />

        {/* Policy Reviewer (P4): on by default, gates Sentry; independent of Usage analytics. */}
        <JobRow label={CRASH_REPORTS_COPY.label} onPress={() => router.push("/crash-reports")} />

        {/* P4: in-app account deletion (Apple 5.1.1(v)). Guests can delete their guest data too. */}
        <JobRow label={ACCOUNT_DELETION_COPY.settingsRow} onPress={() => router.push("/delete-account")} />

        {/* Policy Reviewer (Oct 17): guests get no provider toggle, only a sign-up row. */}
        {isGuestSession() ? (
          <JobRow label={AGE_GATE_COPY.guestSettings} onPress={() => router.push("/sign-up")} />
        ) : (
          <JobRow label="Card recognition" onPress={() => router.push("/card-recognition")} />
        )}

        <Text style={styles.section}>{SETTINGS_STACK_SECTION_LABEL}</Text>
        {SETTINGS_STACK_STATUS_ROWS.map((row) => {
          const value = settingsStackStatusValue(stack, row.id, stackLoad);
          return (
            <View
              accessibilityLabel={`${row.label} ${value}`}
              accessibilityRole="text"
              key={row.id}
              pointerEvents="none"
              style={styles.flagRow}
            >
              <Text style={styles.flagLabel}>{row.label}</Text>
              <Text style={styles.flagValue}>{value}</Text>
            </View>
          );
        })}

        {stackLoad === "checking" ? (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {SCREEN_LOADING_LABELS.settings}
          </Text>
        ) : null}
        {stackLoad === "unavailable" ? (
          <>
            <InfoRow message={stackError} />
            <PrimaryButton
              accessibilityLabel={SETTINGS_STATUS_COPY.retryLabel}
              label={SCREEN_STATE_COPY.retry}
              onPress={() => checkHealth()}
              tone="muted"
            />
          </>
        ) : null}

        <Text style={styles.section}>{SETTINGS_RESEARCH_SECTION_LABEL}</Text>
        {SETTINGS_RESEARCH_FLAGS.map((flag) => {
          const stateLabel = featureFlagStateLabel(flag.enabled);
          return (
            <View
              accessibilityLabel={`${flag.label} ${stateLabel}`}
              accessibilityRole="text"
              key={flag.id}
              pointerEvents="none"
              style={styles.flagRow}
            >
              <Text style={styles.flagLabel}>{flag.label}</Text>
              <Text style={styles.flagValue}>{stateLabel}</Text>
            </View>
          );
        })}
        <Text style={styles.body}>{MARKETPLACE_AUTOMATION_NO_ENABLE_COPY}</Text>

        <JobRow
          label={settingsJobLabel("about")}
          onPress={() => router.push("/about")}
        />
      </ScrollView>
    </View>
  );
}

interface JobRowProps {
  label: string;
  onPress: () => void;
}

function JobRow({ label, onPress }: JobRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons color={colors.muted} name="chevron-forward" size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: space.lg,
    paddingBottom: 48,
    gap: space.sm,
  },
  kicker: { color: colors.accent, fontWeight: "700", letterSpacing: 0.6 },
  sectionFirst: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: space.xs,
  },
  section: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: space.md,
  },
  row: {
    marginTop: space.sm,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  notThisTester: { marginTop: space.xs, paddingVertical: space.sm },
  notThisTesterLabel: { color: colors.muted, fontSize: 15, fontWeight: "600" },
  flagRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: 8,
  },
  flagLabel: { color: colors.text, fontSize: 15, flex: 1 },
  flagValue: { color: colors.muted, fontSize: 13, fontWeight: "800", letterSpacing: 0.6 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
