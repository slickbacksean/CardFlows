import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Atmosphere, Card } from '../../components/grading/ui';
import { HOW_IT_WORKS } from '../../grading/copy';
import { colors, radii } from '../../theme';

interface HowGradingWorksSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface DeductionRow {
  label: string;
  points: string;
  tone?: 'factory' | 'muted';
}

function pointColor(tone?: 'factory' | 'muted') {
  if (tone === 'factory') return colors.factory;
  if (tone === 'muted') return colors.muted;
  return colors.danger;
}

function CriterionSection({
  title,
  share,
  body,
  groups,
}: {
  title: string;
  share: string;
  body: string;
  groups: readonly {
    title: string;
    note?: string;
    rows: readonly DeductionRow[];
  }[];
}) {
  return (
    <Card>
      <View style={styles.criterionHeader}>
        <Text style={styles.criterionTitle}>{title}</Text>
        <Text style={styles.share}>{share}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      {groups.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          {group.note ? <Text style={styles.note}>{group.note}</Text> : null}
          {group.rows.map((row) => (
            <View key={row.label} style={styles.deductionRow}>
              <Text style={styles.deductionLabel}>{row.label}</Text>
              <Text style={[styles.deductionPoints, { color: pointColor(row.tone) }]}>
                {row.points}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}

export function HowGradingWorksSheet({ visible, onClose }: HowGradingWorksSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Atmosphere />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{HOW_IT_WORKS.title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={HOW_IT_WORKS.done}
            onPress={onClose}
            style={styles.done}
          >
            <Text style={styles.doneLabel}>{HOW_IT_WORKS.done}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Card>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.icon}>◎</Text>
              <Text style={styles.sectionTitle}>{HOW_IT_WORKS.understanding.title}</Text>
            </View>
            {HOW_IT_WORKS.understanding.items.map((item) => (
              <View key={item} style={styles.bulletRow}>
                <Text style={styles.bullet}>✓</Text>
                <Text style={styles.bulletText}>{item}</Text>
              </View>
            ))}
          </Card>

          <Card>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.icon}>▣</Text>
              <Text style={styles.sectionTitle}>{HOW_IT_WORKS.calculation.title}</Text>
            </View>
            <Text style={styles.body}>{HOW_IT_WORKS.calculation.body}</Text>
            <View style={styles.chips}>
              {HOW_IT_WORKS.calculation.chips.map((chip) => (
                <View key={chip.label} style={styles.chip}>
                  <Text style={styles.chipPct}>{chip.pct}</Text>
                  <Text style={styles.chipLabel}>{chip.label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.body}>{HOW_IT_WORKS.calculation.mix}</Text>
          </Card>

          <CriterionSection {...HOW_IT_WORKS.surface} />
          <CriterionSection {...HOW_IT_WORKS.centering} />
          <CriterionSection {...HOW_IT_WORKS.edges} />
          <CriterionSection {...HOW_IT_WORKS.corners} />

          <Card>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.icon}>◻</Text>
              <Text style={styles.sectionTitle}>{HOW_IT_WORKS.photoTips.title}</Text>
            </View>
            {HOW_IT_WORKS.photoTips.items.map((item) => (
              <View key={item} style={styles.bulletRow}>
                <Text style={styles.tipMark}>•</Text>
                <Text style={styles.bulletText}>{item}</Text>
              </View>
            ))}
          </Card>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  done: {
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  doneLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    color: colors.primary,
    fontSize: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bullet: {
    color: colors.caution,
    fontSize: 13,
    marginTop: 2,
  },
  bulletText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  tipMark: {
    color: colors.faint,
    fontSize: 16,
    width: 12,
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: radii.md,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  chipPct: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  chipLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  criterionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  criterionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  share: {
    color: colors.muted,
    fontSize: 12,
  },
  group: {
    gap: 6,
    marginTop: 4,
  },
  groupTitle: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  deductionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 3,
  },
  deductionLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  deductionPoints: {
    fontSize: 14,
    fontWeight: '700',
  },
});
