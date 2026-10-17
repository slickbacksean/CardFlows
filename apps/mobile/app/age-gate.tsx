import { AGE_GATE_COPY, AGE_GATE_MONTHS, ageGateYears } from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AgeLockout } from "@/components/ui/age-lockout";
import { authStyles } from "@/components/ui/auth-styles";
import { PrimaryButton } from "@/components/ui/primary-button";
import { cancelAgeGate, submitAgeGate } from "@/lib/age-gate";
import { isGuestSession, peekActiveUserId } from "@/lib/identity";
import { colors, radii, space } from "@/lib/theme";

type Option = { label: string; value: number };

/**
 * Sean: 18+ only. Policy Reviewer: birth month and year pickers start empty, nothing is
 * pre-selected, and the date is checked here and thrown away (only "18+" reaches the server).
 */
export default function AgeGateScreen() {
  const router = useRouter();
  const [month, setMonth] = useState<number | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [open, setOpen] = useState<"month" | "year" | null>(null);
  const [saving, setSaving] = useState(false);
  const [underAge, setUnderAge] = useState(false);
  const answered = useRef(false);

  // Leaving without an answer means no upload.
  useEffect(() => () => {
    if (!answered.current) cancelAgeGate();
  }, []);

  async function submit() {
    setSaving(true);
    const result = await submitAgeGate({ userKey: peekActiveUserId(), isGuest: isGuestSession() }, month, year);
    // The birth month and year are not kept anywhere once checked.
    setMonth(null);
    setYear(null);
    setSaving(false);
    if (result === "under_18") {
      answered.current = true;
      setUnderAge(true);
      return;
    }
    if (result === "adult") {
      answered.current = true;
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/collection");
    }
  }

  if (underAge) return <AgeLockout />;

  const months: Option[] = AGE_GATE_MONTHS.map((label, i) => ({ label, value: i + 1 }));
  const years: Option[] = ageGateYears().map((y) => ({ label: String(y), value: y }));
  return (
    <SafeAreaView style={authStyles.flex}>
      <View style={authStyles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          {AGE_GATE_COPY.title}
        </Text>
        <Text style={authStyles.body}>{AGE_GATE_COPY.body}</Text>
        <PickerField
          label={AGE_GATE_COPY.monthLabel}
          onPress={() => setOpen("month")}
          placeholder={AGE_GATE_COPY.monthPlaceholder}
          value={month ? AGE_GATE_MONTHS[month - 1] : null}
        />
        <PickerField
          label={AGE_GATE_COPY.yearLabel}
          onPress={() => setOpen("year")}
          placeholder={AGE_GATE_COPY.yearPlaceholder}
          value={year ? String(year) : null}
        />
        <PrimaryButton disabled={saving || month === null || year === null} label={AGE_GATE_COPY.button} onPress={() => void submit()} />
      </View>
      <OptionSheet
        onClose={() => setOpen(null)}
        onPick={(value) => {
          if (open === "month") setMonth(value);
          else setYear(value);
          setOpen(null);
        }}
        options={open === "month" ? months : years}
        title={open === "month" ? AGE_GATE_COPY.monthLabel : AGE_GATE_COPY.yearLabel}
        visible={open !== null}
      />
    </SafeAreaView>
  );
}

function PickerField({ label, value, placeholder, onPress }: { label: string; value: string | null; placeholder: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityValue={{ text: value ?? "" }} onPress={onPress} style={authStyles.input}>
      <Text style={value ? styles.value : styles.placeholder}>{value ?? placeholder}</Text>
    </Pressable>
  );
}

function OptionSheet(props: { visible: boolean; title: string; options: Option[]; onPick: (value: number) => void; onClose: () => void }) {
  return (
    <Modal animationType="slide" onRequestClose={props.onClose} transparent visible={props.visible}>
      <Pressable accessibilityLabel="Close" onPress={props.onClose} style={styles.backdrop} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>{props.title}</Text>
        <FlatList
          data={props.options}
          keyExtractor={(item) => String(item.value)}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => props.onPick(item.value)} style={styles.option}>
              <Text style={styles.value}>{item.label}</Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  value: { color: colors.text, fontSize: 16 },
  placeholder: { color: colors.muted, fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { maxHeight: "60%", backgroundColor: colors.card, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: space.md },
  sheetTitle: { color: colors.muted, fontSize: 14, fontWeight: "600", marginBottom: space.sm },
  option: { paddingVertical: 14, borderBottomColor: colors.cardBorder, borderBottomWidth: StyleSheet.hairlineWidth },
});
