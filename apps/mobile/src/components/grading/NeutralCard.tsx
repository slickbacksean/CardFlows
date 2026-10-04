import { StyleSheet, View } from 'react-native';

interface NeutralCardProps {
  variant: 'front' | 'back';
  border?: 'light' | 'dark';
  width?: number;
}

export function NeutralCard({ variant, border = 'light', width = 118 }: NeutralCardProps) {
  const height = Math.round(width * (88 / 63));
  const isLightBorder = border === 'light';

  return (
    <View
      accessibilityLabel={variant === 'front' ? 'Neutral front card placeholder' : 'Neutral back card placeholder'}
      style={[
        styles.card,
        {
          width,
          height,
          borderColor: isLightBorder ? '#e2e8f0' : '#0f172a',
          backgroundColor: variant === 'front' ? '#1f2937' : '#111827',
        },
      ]}
    >
      {variant === 'front' ? (
        <>
          <View style={styles.art} />
          <View style={styles.lineWide} />
          <View style={styles.lineNarrow} />
        </>
      ) : (
        <View style={styles.emblem}>
          <View style={styles.emblemInner} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 3,
    padding: 10,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  art: {
    width: '100%',
    flex: 1,
    borderRadius: 6,
    backgroundColor: '#334155',
    marginBottom: 8,
  },
  lineWide: {
    width: '88%',
    height: 7,
    borderRadius: 3,
    backgroundColor: '#475569',
    marginBottom: 5,
  },
  lineNarrow: {
    width: '62%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#334155',
  },
  emblem: {
    flex: 1,
    width: '62%',
    aspectRatio: 1,
    maxHeight: '55%',
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#64748b',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: '22%',
  },
  emblemInner: {
    width: '42%',
    height: '42%',
    transform: [{ rotate: '45deg' }],
    backgroundColor: '#475569',
    borderRadius: 3,
  },
});
