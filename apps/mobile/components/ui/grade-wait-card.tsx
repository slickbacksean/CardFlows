import Ionicons from "@expo/vector-icons/Ionicons";
import {
  EMPTY_GRADE_WAIT_CLOCK,
  GRADE_JOB_OFFLINE_AFTER_FAILURES,
  GRADE_WAIT_COPY,
  PREGRADE_DISCLAIMER_TEXT,
  gradeJobWaitAnnouncement,
  gradeJobWaitCopy,
  waitClockOnJob,
  waitClockOnPollError,
  waitSecondsLeft,
  type GradeJobView,
  type GradeWaitClock,
} from "@cardflow/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, space } from "@/lib/theme";
import { PrimaryButton } from "./primary-button";

/** Wait state for one estimate run: feed `onJobUpdate` / `onPollError` to `requestGradeEstimate`. */
export function useGradeWaitClock() {
  const [clock, setClock] = useState<GradeWaitClock>(EMPTY_GRADE_WAIT_CLOCK);
  const onJobUpdate = useCallback((job: GradeJobView) => setClock((c) => waitClockOnJob(c, job, Date.now())), []);
  const onPollError = useCallback((n: number) => setClock((c) => waitClockOnPollError(c, n, Date.now())), []);
  const reset = useCallback(() => setClock(EMPTY_GRADE_WAIT_CLOCK), []);
  return { clock, onJobUpdate, onPollError, reset };
}

/** 1 s local clock, paused while the app is in the background. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setNow(Date.now());
        timer ??= setInterval(() => setNow(Date.now()), 1000);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, []);
  return now;
}

/**
 * P1-07 wait state (UX spec grade-wait-and-large-text-review.md, Part 1). N counts down on a
 * local clock, only moves down within one wait, never shows "0 s", and the accessible label only
 * changes on events (busy appears, ≥10 s jumps, minute change, running, offline on/off).
 */
export function GradeWaitCard({ clock, onCancel }: { clock: GradeWaitClock; onCancel: () => void }) {
  const now = useNow();
  const lastAnnounced = useRef("");
  const busy = clock.job?.status === "waiting";
  const offline = clock.failures >= GRADE_JOB_OFFLINE_AFTER_FAILURES;
  const hasHint = busy && clock.deadline !== null;
  const secondsLeft = !hasHint ? null : (clock.frozenSeconds ?? waitSecondsLeft(clock.deadline as number, now));
  const stillBusy = hasHint && secondsLeft === 0 && now - (clock.deadline as number) > 15_000;

  const mainLine = !busy ? GRADE_WAIT_COPY.estimating : gradeJobWaitCopy(secondsLeft);
  const subLine = !busy ? GRADE_WAIT_COPY.estimatingSub : stillBusy ? GRADE_WAIT_COPY.stillBusy : null;

  // Announcement buckets: minutes over 60 s, else 10 s steps.
  const bucket =
    secondsLeft === null ? null : secondsLeft > 60 ? Math.ceil(secondsLeft / 60) * 60 : secondsLeft === 0 ? 0 : Math.ceil(secondsLeft / 10) * 10;
  const spoken = `${!busy ? GRADE_WAIT_COPY.estimating : gradeJobWaitAnnouncement(bucket)}${offline ? ` ${GRADE_WAIT_COPY.offline}` : ""}`;
  useEffect(() => {
    if (lastAnnounced.current === spoken) return;
    lastAnnounced.current = spoken;
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  const total = busy ? (clock.job?.retryAfterSeconds ?? 0) : 0;
  const progress = total > 0 && secondsLeft !== null ? Math.min(1, Math.max(0, 1 - secondsLeft / total)) : 0;

  return (
    <View style={styles.card}>
      <View accessibilityLabel={spoken} accessibilityLiveRegion="polite" accessible style={styles.status}>
        {busy ? (
          <Ionicons color={colors.muted} name="hourglass-outline" size={20} style={styles.icon} />
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
        <View style={styles.texts}>
          <Text accessibilityLiveRegion="none" style={styles.main}>
            {mainLine}
          </Text>
          {subLine ? <Text style={styles.sub}>{subLine}</Text> : null}
        </View>
      </View>
      {total > 0 ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}
      {offline ? (
        <View style={styles.offline}>
          <Ionicons color={colors.muted} name="cloud-offline-outline" size={20} style={styles.icon} />
          <Text style={styles.sub}>{GRADE_WAIT_COPY.offline}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityLabel={GRADE_WAIT_COPY.cancelA11y}
        accessibilityRole="button"
        onPress={onCancel}
        style={styles.cancel}
      >
        <Text style={styles.cancelText}>{GRADE_WAIT_COPY.cancel}</Text>
      </Pressable>
      <Text style={styles.disclaimer}>{PREGRADE_DISCLAIMER_TEXT}</Text>
    </View>
  );
}

/** Retryable job failure. With a rate-limit hint, Try again shows its own countdown. */
export function GradeJobErrorCard({ retryAfterSeconds, onRetry }: { retryAfterSeconds: number | null; onRetry: () => void }) {
  const [shownAt] = useState(() => Date.now());
  const now = useNow();
  const left = retryAfterSeconds ? Math.max(0, Math.ceil(retryAfterSeconds - (now - shownAt) / 1000)) : 0;
  useEffect(() => {
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(`${GRADE_WAIT_COPY.errorTitle}. ${GRADE_WAIT_COPY.errorBody}`);
    }
  }, []);
  return (
    <View accessibilityLiveRegion="polite" style={styles.card}>
      <View accessible style={styles.status}>
        <Ionicons color={colors.danger} name="alert-circle" size={20} style={styles.icon} />
        <View style={styles.texts}>
          <Text style={styles.main}>{GRADE_WAIT_COPY.errorTitle}</Text>
          <Text style={styles.sub}>{GRADE_WAIT_COPY.errorBody}</Text>
        </View>
      </View>
      <PrimaryButton
        disabled={left > 0}
        label={left > 0 ? `Try again in ${left} ${left === 1 ? "second" : "seconds"}` : "Try again"}
        onPress={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, paddingVertical: space.sm },
  status: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, flexWrap: "wrap" },
  icon: { marginTop: 2 },
  texts: { flex: 1, minWidth: 120, gap: space.xs },
  main: { color: colors.text, fontSize: 17 },
  sub: { color: colors.muted, fontSize: 15, flexShrink: 1 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.cardBorder, overflow: "hidden" },
  fill: { height: 4, backgroundColor: colors.accent },
  offline: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  cancel: {
    minHeight: 48,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: space.sm,
  },
  cancelText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  disclaimer: { color: colors.muted, fontSize: 13 },
});
