import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '../../theme';

export function Atmosphere() {
  return (
    <View pointerEvents="none" style={styles.atmosphere}>
      <View style={[styles.orb, styles.orbTeal]} />
      <View style={[styles.orb, styles.orbViolet]} />
      <View style={[styles.orb, styles.orbLime]} />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function AccentLabel({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <View style={styles.accentRow}>
      <View style={[styles.accentDot, { backgroundColor: color }]} />
      <Text style={[styles.accentLabel, { color }]}>{label}</Text>
    </View>
  );
}

export function CheckRow({ text }: { text: string }) {
  return (
    <View style={styles.checkRow}>
      <Text style={styles.checkMark}>✓</Text>
      <Text style={styles.checkText}>{text}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  leading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  leading?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.primaryDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {leading ? <Text style={styles.primaryLeading}>{leading}</Text> : null}
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

export function ErrorBanner({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <View style={styles.errorBanner} accessibilityRole="alert">
      {reasons.map((reason) => (
        <Text key={reason} style={styles.errorText}>
          {reason}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  atmosphere: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    opacity: 0.18,
  },
  orbTeal: {
    backgroundColor: '#134e4a',
    top: -80,
    right: -60,
  },
  orbViolet: {
    backgroundColor: '#312e81',
    bottom: 80,
    left: -100,
  },
  orbLime: {
    backgroundColor: '#365314',
    top: 220,
    left: 40,
    width: 180,
    height: 180,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  accentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  accentLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  checkMark: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 1,
  },
  checkText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 22,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    minHeight: 56,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  primaryDisabled: {
    opacity: 0.45,
  },
  primaryLeading: {
    color: colors.primaryText,
    fontSize: 18,
    fontWeight: '700',
  },
  primaryLabel: {
    color: colors.primaryText,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    minHeight: 52,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
  errorBanner: {
    backgroundColor: '#7f1d1d',
    borderRadius: radii.md,
    padding: 12,
    gap: 4,
  },
  errorText: {
    color: '#fecaca',
    fontSize: 14,
    lineHeight: 20,
  },
});
