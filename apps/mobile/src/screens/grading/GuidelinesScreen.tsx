import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccentLabel, Atmosphere, Card, CheckRow, PrimaryButton } from '../../components/grading/ui';
import { NeutralCard } from '../../components/grading/NeutralCard';
import {
  DONT_SHOW_AGAIN,
  GUIDELINES_EYEBROW,
  GUIDELINES_TITLE,
  HOW_GRADING_WORKS_TITLE,
  IMPORTANT_NOTES,
  MOST_IMPORTANT,
  PHOTO_TIPS,
  START_GRADING,
  TARGET,
} from '../../grading/copy';
import { setSkipGuidelines } from '../../grading/storage';
import type { GradingStackParamList } from '../../navigation/types';
import { colors, radii } from '../../theme';
import { HowGradingWorksSheet } from './HowGradingWorksSheet';

type Props = NativeStackScreenProps<GradingStackParamList, 'Guidelines'>;

export function GuidelinesScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [skip, setSkip] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  async function handleToggleSkip() {
    const next = !skip;
    setSkip(next);
    await setSkipGuidelines(next);
  }

  function handleStart() {
    navigation.navigate('GradingPhoto', { side: 'front' });
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Atmosphere />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 108 + insets.bottom }]}>
        <Text style={styles.eyebrow}>{GUIDELINES_EYEBROW}</Text>
        <Text style={styles.title}>{GUIDELINES_TITLE}</Text>
        <View style={styles.titleRule} />

        <Card>
          <AccentLabel label={MOST_IMPORTANT.eyebrow} color={colors.warning} />
          <Text style={styles.cardTitle}>{MOST_IMPORTANT.title}</Text>
          <Text style={styles.body}>{MOST_IMPORTANT.body}</Text>
          <View style={styles.exampleRow}>
            <View style={styles.example}>
              <View style={[styles.surface, styles.darkSurface]}>
                <NeutralCard variant="front" border="light" width={92} />
              </View>
              <Text style={styles.caption}>{MOST_IMPORTANT.lightCaption}</Text>
            </View>
            <View style={styles.example}>
              <View style={[styles.surface, styles.lightSurface]}>
                <NeutralCard variant="back" border="dark" width={92} />
              </View>
              <Text style={styles.caption}>{MOST_IMPORTANT.darkCaption}</Text>
            </View>
          </View>
          <Text style={styles.warning}>✕  {MOST_IMPORTANT.warning}</Text>
        </Card>

        <Card>
          <AccentLabel label={TARGET.eyebrow} color={colors.success} />
          <Text style={styles.cardTitle}>{TARGET.title}</Text>
          <Text style={styles.body}>{TARGET.body}</Text>
          <View style={styles.exampleRow}>
            <View style={styles.example}>
              <NeutralCard variant="front" width={112} />
              <Text style={styles.caption}>{TARGET.frontLabel}</Text>
            </View>
            <View style={styles.example}>
              <NeutralCard variant="back" width={112} />
              <Text style={styles.caption}>{TARGET.backLabel}</Text>
            </View>
          </View>
        </Card>

        <Card>
          <AccentLabel label={PHOTO_TIPS.eyebrow} color={colors.primary} />
          {PHOTO_TIPS.items.map((item) => (
            <CheckRow key={item} text={item} />
          ))}
        </Card>

        <Card>
          <AccentLabel label={IMPORTANT_NOTES.eyebrow} color={colors.caution} />
          <Text style={styles.body}>{IMPORTANT_NOTES.body}</Text>
        </Card>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={HOW_GRADING_WORKS_TITLE}
          onPress={() => setSheetOpen(true)}
          style={styles.linkRow}
        >
          <Text style={styles.linkText}>{HOW_GRADING_WORKS_TITLE}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: skip }}
          accessibilityLabel={DONT_SHOW_AGAIN}
          onPress={handleToggleSkip}
          style={styles.checkboxRow}
        >
          <View style={[styles.checkbox, skip && styles.checkboxOn]}>
            {skip ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.checkboxLabel}>{DONT_SHOW_AGAIN}</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.sticky}>
        <PrimaryButton label={START_GRADING} leading="→" onPress={handleStart} />
      </View>

      <HowGradingWorksSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 14,
  },
  eyebrow: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  title: {
    textAlign: 'center',
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
  },
  titleRule: {
    alignSelf: 'center',
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginBottom: 6,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  exampleRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 12,
    marginTop: 6,
  },
  example: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  surface: {
    width: '100%',
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 10,
  },
  darkSurface: {
    backgroundColor: '#020617',
  },
  lightSurface: {
    backgroundColor: '#f8fafc',
  },
  caption: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  warning: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  linkRow: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  chevron: {
    color: colors.muted,
    fontSize: 22,
  },
  checkboxRow: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: {
    color: colors.primaryText,
    fontSize: 14,
    fontWeight: '800',
  },
  checkboxLabel: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  sticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: colors.bg,
  },
});
