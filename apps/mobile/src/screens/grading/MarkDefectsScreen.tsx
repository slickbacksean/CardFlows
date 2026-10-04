import type { CardSide, PregradeDefectCode } from '@cardflows/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { submitPregrade } from '../../api/client';
import { Atmosphere, Card, ErrorBanner, PrimaryButton } from '../../components/grading/ui';
import { QuantityStepper } from '../../components/grading/QuantityStepper';
import { DEFECTS_COPY } from '../../grading/copy';
import {
  CORNER_CONTROLS,
  CORNER_LABELS,
  CORNERS,
  DEFECT_LABELS,
  EDGE_CONTROLS,
  EDGE_LABELS,
  EDGES,
  SURFACE_CONTROLS,
  draftQuantity,
  markedCount,
  quantityBounds,
  toDefectsPayload,
} from '../../grading/defects';
import { useGradingSession } from '../../grading/session';
import type { GradingStackParamList } from '../../navigation/types';
import { colors, radii } from '../../theme';

type Props = NativeStackScreenProps<GradingStackParamList, 'MarkDefects'>;

export function MarkDefectsScreen({ navigation }: Props) {
  const session = useGradingSession();
  const [side, setSide] = useState<CardSide>('front');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorReasons, setErrorReasons] = useState<string[]>([]);
  const count = markedCount(session.drafts);

  function setQuantity(
    code: PregradeDefectCode,
    quantity: number,
    extra?: { edge?: (typeof EDGES)[number]; corner?: (typeof CORNERS)[number] }
  ) {
    session.setDraft({ code, side, quantity, ...extra });
  }

  async function handleEstimate() {
    if (!session.front || !session.back || isSubmitting) return;
    setIsSubmitting(true);
    setErrorReasons([]);
    try {
      const defects = toDefectsPayload(session.drafts);
      const response = await submitPregrade({
        front: session.front,
        back: session.back,
        defects,
      });

      if (response.ok) {
        session.setEstimate(response);
        session.setPhotoRetake(null);
        navigation.navigate('GradingResult');
        return;
      }

      if (response.code === 'PHOTO_RETAKE') {
        session.setEstimate(null);
        session.setPhotoRetake({ side: response.side, reasons: response.reasons });
        navigation.navigate('CropConfirm', { side: response.side });
        return;
      }

      session.setEstimate(null);
      setErrorReasons([response.message]);
    } catch {
      session.setEstimate(null);
      setErrorReasons(['Could not reach the CardFlow API. Is the BFF running?']);
    } finally {
      setIsSubmitting(false);
    }
  }

  const clouding =
    draftQuantity(session.drafts, { code: 'clouding_full', side }) > 0
      ? 'full'
      : draftQuantity(session.drafts, { code: 'clouding_half', side }) > 0
        ? 'half'
        : 'none';

  const estimateLabel = `${DEFECTS_COPY.getEstimate} · ${
    count === 0 ? DEFECTS_COPY.cleanCard : DEFECTS_COPY.marks(count)
  }`;

  return (
    <View style={styles.root}>
      <Atmosphere />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{DEFECTS_COPY.title}</Text>
        <Text style={styles.hint}>{DEFECTS_COPY.subtitle}</Text>

        <View style={styles.switcher}>
          {(['front', 'back'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: side === value }}
              onPress={() => setSide(value)}
              style={[styles.switchBtn, side === value && styles.switchOn]}
            >
              <Text style={[styles.switchLabel, side === value && styles.switchLabelOn]}>
                {value === 'front' ? DEFECTS_COPY.front : DEFECTS_COPY.back}
              </Text>
            </Pressable>
          ))}
        </View>

        <ErrorBanner reasons={errorReasons} />

        <Card>
          <Text style={styles.section}>Centering</Text>
          <Text style={styles.meta}>Whole-number deviation percent. OC and MC are applied by the estimate.</Text>
          <ControlRow
            label={DEFECT_LABELS.centering_deviation}
            hint="Deviation %"
            value={draftQuantity(session.drafts, { code: 'centering_deviation', side })}
            code="centering_deviation"
            onChange={(quantity) => setQuantity('centering_deviation', quantity)}
          />
        </Card>

        <Card>
          <Text style={styles.section}>Surface</Text>
          {SURFACE_CONTROLS.map((control) => (
            <ControlRow
              key={control.code}
              label={DEFECT_LABELS[control.code]}
              hint={control.hint}
              value={draftQuantity(session.drafts, { code: control.code, side })}
              code={control.code}
              onChange={(quantity) => setQuantity(control.code, quantity)}
            />
          ))}
          <Text style={styles.groupTitle}>Clouding / Silvering</Text>
          <View style={styles.switcher}>
            {(
              [
                ['none', DEFECTS_COPY.cloudingNone],
                ['half', DEFECTS_COPY.cloudingHalf],
                ['full', DEFECTS_COPY.cloudingFull],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: clouding === value }}
                onPress={() => {
                  if (value === 'none') {
                    setQuantity('clouding_half', 0);
                    setQuantity('clouding_full', 0);
                    return;
                  }
                  setQuantity(value === 'half' ? 'clouding_half' : 'clouding_full', 1);
                }}
                style={[styles.switchBtn, clouding === value && styles.switchOn]}
              >
                <Text style={[styles.switchLabel, clouding === value && styles.switchLabelOn]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={styles.section}>Edges</Text>
          {EDGE_CONTROLS.map((control) => (
            <View key={control.code} style={styles.positionBlock}>
              <Text style={styles.groupTitle}>{DEFECT_LABELS[control.code]}</Text>
              <Text style={styles.meta}>{control.hint}</Text>
              {EDGES.map((edge) => (
                <ControlRow
                  key={edge}
                  label={EDGE_LABELS[edge]}
                  hint={control.hint}
                  value={draftQuantity(session.drafts, { code: control.code, side, edge })}
                  code={control.code}
                  onChange={(quantity) => setQuantity(control.code, quantity, { edge })}
                />
              ))}
            </View>
          ))}
        </Card>

        <Card>
          <Text style={styles.section}>Corners</Text>
          {CORNER_CONTROLS.map((control) => (
            <View key={control.code} style={styles.positionBlock}>
              <Text style={styles.groupTitle}>{DEFECT_LABELS[control.code]}</Text>
              <Text style={styles.meta}>{control.hint}</Text>
              {CORNERS.map((corner) => (
                <ControlRow
                  key={corner}
                  label={CORNER_LABELS[corner]}
                  hint={control.hint}
                  value={draftQuantity(session.drafts, { code: control.code, side, corner })}
                  code={control.code}
                  onChange={(quantity) => setQuantity(control.code, quantity, { corner })}
                />
              ))}
            </View>
          ))}
        </Card>
      </ScrollView>

      <View style={styles.sticky}>
        {isSubmitting ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Scoring…</Text>
          </View>
        ) : (
          <PrimaryButton
            label={estimateLabel}
            onPress={handleEstimate}
            disabled={!session.front || !session.back}
          />
        )}
      </View>
    </View>
  );
}

function ControlRow({
  label,
  hint,
  value,
  code,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  code: PregradeDefectCode;
  onChange: (value: number) => void;
}) {
  const bounds = quantityBounds(code);
  return (
    <View style={styles.controlRow}>
      <View style={styles.controlCopy}>
        <Text style={styles.controlLabel}>{label}</Text>
        <Text style={styles.meta}>{hint}</Text>
      </View>
      <QuantityStepper
        value={value}
        min={bounds.min}
        max={bounds.max}
        onChange={onChange}
        label={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
    gap: 14,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  hint: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  switcher: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  switchBtn: {
    flex: 1,
    borderRadius: radii.pill,
    paddingVertical: 10,
    alignItems: 'center',
  },
  switchOn: {
    backgroundColor: colors.primary,
  },
  switchLabel: {
    color: colors.muted,
    fontWeight: '700',
  },
  switchLabelOn: {
    color: colors.primaryText,
  },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  groupTitle: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
  },
  meta: {
    color: colors.faint,
    fontSize: 12,
  },
  positionBlock: {
    gap: 6,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  controlCopy: {
    flex: 1,
    gap: 2,
  },
  controlLabel: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
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
  loading: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 15,
  },
});
