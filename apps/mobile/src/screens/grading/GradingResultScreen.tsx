import type { PregradeCriterion } from '@cardflows/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Atmosphere, Card, PrimaryButton } from '../../components/grading/ui';
import { RESULT_COPY } from '../../grading/copy';
import { formatDeductionMeta, formatPoints } from '../../grading/defects';
import { formatEstimate, formatServerPoints, shouldShowFinalPoints } from '../../grading/result-display';
import { useGradingSession } from '../../grading/session';
import type { GradingStackParamList } from '../../navigation/types';
import { colors, radii } from '../../theme';

type Props = NativeStackScreenProps<GradingStackParamList, 'GradingResult'>;

const CRITERIA: { key: PregradeCriterion; label: string }[] = [
  { key: 'surface', label: 'Surface' },
  { key: 'edges', label: 'Edges' },
  { key: 'corners', label: 'Corners' },
  { key: 'centering', label: 'Centering' },
];

export function GradingResultScreen({ navigation }: Props) {
  const session = useGradingSession();
  const estimate = session.estimate;

  function handleAgain() {
    session.reset();
    navigation.reset({
      index: 0,
      routes: [{ name: 'GradingEntry' }],
    });
  }

  if (!estimate) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No estimate yet.</Text>
        <PrimaryButton label={RESULT_COPY.gradeAnother} onPress={handleAgain} />
      </View>
    );
  }

  const showFinalPoints = shouldShowFinalPoints(estimate.estimate, estimate.finalPoints);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Atmosphere />
      <Text style={styles.label}>{estimate.label}</Text>
      <Text style={styles.estimate}>{formatEstimate(estimate.estimate)}</Text>
      <Text style={styles.disclaimer}>{estimate.disclaimer}</Text>

      {estimate.qualifiers.length > 0 ? (
        <View style={styles.chips}>
          {estimate.qualifiers.map((qualifier) => (
            <View key={qualifier} style={styles.chip}>
              <Text style={styles.chipLabel}>{qualifier}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {showFinalPoints ? (
        <Text style={styles.finalPoints}>
          {RESULT_COPY.finalPoints} {formatServerPoints(estimate.finalPoints)}
        </Text>
      ) : null}

      <Card>
        <Text style={styles.section}>Subgrades</Text>
        {CRITERIA.map((criterion) => {
          const sub = estimate.subgrades[criterion.key];
          return (
            <View key={criterion.key} style={styles.subRow}>
              <View style={styles.subCopy}>
                <Text style={styles.subTitle}>{criterion.label}</Text>
                <Text style={styles.subMeta}>
                  {RESULT_COPY.front} {formatServerPoints(sub.front)} · {RESULT_COPY.back}{' '}
                  {formatServerPoints(sub.back)}
                </Text>
              </View>
              <Text style={styles.subPoints}>
                {formatServerPoints(sub.points)} {RESULT_COPY.points}
              </Text>
            </View>
          );
        })}
      </Card>

      <Card>
        <Text style={styles.section}>Deductions</Text>
        {estimate.deductions.length === 0 ? (
          <Text style={styles.subMeta}>No deductions — clean card.</Text>
        ) : (
          estimate.deductions.map((row, index) => (
            <View
              key={`${row.code}-${row.side}-${row.edge ?? ''}-${row.corner ?? ''}-${index}`}
              style={styles.deductionRow}
            >
              <Text style={styles.deductionLabel}>{formatDeductionMeta(row)}</Text>
              <Text style={styles.deductionPoints}>{formatPoints(row.points)}</Text>
            </View>
          ))
        )}
      </Card>

      <View style={styles.photos}>
        {session.front ? (
          <View style={styles.photoCol}>
            <Image source={{ uri: session.front.uri }} style={styles.photo} accessibilityIgnoresInvertColors />
            <Text style={styles.photoCaption}>{RESULT_COPY.front}</Text>
          </View>
        ) : null}
        {session.back ? (
          <View style={styles.photoCol}>
            <Image source={{ uri: session.back.uri }} style={styles.photo} accessibilityIgnoresInvertColors />
            <Text style={styles.photoCaption}>{RESULT_COPY.back}</Text>
          </View>
        ) : null}
      </View>

      <PrimaryButton label={RESULT_COPY.gradeAnother} onPress={handleAgain} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    padding: 20,
    gap: 14,
  },
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
    justifyContent: 'center',
    gap: 16,
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
  },
  label: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  estimate: {
    textAlign: 'center',
    color: colors.text,
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -2,
  },
  disclaimer: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  chips: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    backgroundColor: colors.warning,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chipLabel: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 13,
  },
  finalPoints: {
    textAlign: 'center',
    color: colors.faint,
    fontSize: 13,
  },
  photos: {
    flexDirection: 'row',
    gap: 12,
  },
  photoCol: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  photo: {
    width: '100%',
    aspectRatio: 63 / 88,
    maxHeight: 180,
    borderRadius: radii.md,
    backgroundColor: colors.card,
  },
  photoCaption: {
    color: colors.muted,
    fontSize: 13,
  },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  subRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  subCopy: {
    gap: 2,
  },
  subTitle: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  subMeta: {
    color: colors.faint,
    fontSize: 13,
  },
  subPoints: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  deductionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  deductionLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  deductionPoints: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
});
