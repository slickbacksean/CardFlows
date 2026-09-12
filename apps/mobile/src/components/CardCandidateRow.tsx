import type { CardFlowCanonicalCard } from '@cardflows/shared';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

interface CardCandidateRowProps {
  card: CardFlowCanonicalCard;
  selected?: boolean;
  onPress?: () => void;
}

export function CardCandidateRow({ card, selected, onPress }: CardCandidateRowProps) {
  const setName = card.set?.name ?? card.tcgdexSetId;
  const imageUri = card.image.constructedUrl ?? card.image.baseUrl;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.thumbPlaceholder} />
      )}
      <View style={styles.meta}>
        <Text style={styles.name}>{card.name}</Text>
        <Text style={styles.detail}>{setName} #{card.localId}</Text>
        <Text style={styles.id}>tcgdex: {card.tcgdexId}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowSelected: {
    borderColor: '#38bdf8',
  },
  thumb: {
    width: 56,
    height: 78,
    borderRadius: 6,
    backgroundColor: '#334155',
  },
  thumbPlaceholder: {
    width: 56,
    height: 78,
    borderRadius: 6,
    backgroundColor: '#334155',
  },
  meta: {
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f1f5f9',
  },
  detail: {
    fontSize: 14,
    color: '#94a3b8',
  },
  id: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
});
