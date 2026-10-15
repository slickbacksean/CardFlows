import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radii, space } from "@/lib/theme";

export type PrimaryButtonTone = "cta" | "accent" | "muted" | "danger";

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: PrimaryButtonTone;
}

const TONE_STYLES: Record<PrimaryButtonTone, { backgroundColor: string; color: string }> = {
  cta: { backgroundColor: colors.cta, color: colors.ctaText },
  accent: { backgroundColor: colors.accent, color: colors.accentText },
  muted: { backgroundColor: colors.chip, color: colors.text },
  danger: { backgroundColor: colors.danger, color: colors.text },
};

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = "cta",
}: PrimaryButtonProps) {
  const { backgroundColor, color } = TONE_STYLES[tone];

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.pill,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    alignItems: "center",
    justifyContent: "center",
    // 48 dp covers iOS 44 pt and Android 48 dp; grows with Dynamic Type.
    minHeight: 48,
  },
  label: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
});
