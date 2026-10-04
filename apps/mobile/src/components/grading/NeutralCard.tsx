import { StyleSheet, View } from 'react-native';

interface NeutralCardProps {
  variant: 'front' | 'back';
  border?: 'light' | 'dark';
  width?: number;
}

export function NeutralCard({ variant, border = 'light', width = 118 }: NeutralCardProps) {
  const height = Math.round(width * (88 / 63));
  const isLightBorder = border === 'light';
  const body = variant === 'front' ? '#2b3444' : '#1a2230';
  const rim = isLightBorder ? '#e8eef6' : '#0b1220';

  return (
    <View
      accessibilityLabel={
        variant === 'front' ? 'Neutral front card placeholder' : 'Neutral back card placeholder'
      }
      style={[
        styles.card,
        {
          width,
          height,
          borderColor: rim,
          backgroundColor: body,
        },
      ]}
    >
      {variant === 'front' ? (
        <View style={styles.frontInner}>
          <View style={styles.artWindow}>
            <View style={styles.horizon} />
            <View style={styles.portrait} />
          </View>
          <View style={styles.meta}>
            <View style={styles.lineWide} />
            <View style={styles.lineNarrow} />
            <View style={styles.lineTiny} />
          </View>
        </View>
      ) : (
        <View style={styles.backInner}>
          <View style={styles.ringOuter}>
            <View style={styles.ringInner}>
              <View style={styles.diamond} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    borderWidth: 4,
    overflow: 'hidden',
  },
  frontInner: {
    flex: 1,
    padding: 8,
    gap: 8,
  },
  artWindow: {
    flex: 1,
    borderRadius: 5,
    backgroundColor: '#5b6b7c',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  horizon: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '38%',
    backgroundColor: '#3f4b59',
  },
  portrait: {
    width: '36%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    marginBottom: '18%',
  },
  meta: {
    gap: 5,
  },
  lineWide: {
    width: '92%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8b9aab',
  },
  lineNarrow: {
    width: '70%',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#6b7a8b',
  },
  lineTiny: {
    width: '48%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#556272',
  },
  backInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#141b26',
  },
  ringOuter: {
    width: '58%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#93a3b8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: '72%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#64748b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diamond: {
    width: '34%',
    aspectRatio: 1,
    backgroundColor: '#94a3b8',
    transform: [{ rotate: '45deg' }],
    borderRadius: 2,
  },
});
