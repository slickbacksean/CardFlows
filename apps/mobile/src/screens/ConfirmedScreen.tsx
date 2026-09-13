import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Confirmed'>;

export function ConfirmedScreen({ navigation, route }: Props) {
  const { cardflowCardId, tcgdexId, cardsightCardId, cardName, setName, localId, scanId } =
    route.params;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Identity confirmed</Text>
      <Text style={styles.subtitle}>
        Scan + confirmation saved locally. No Purchased or Watchlist item was created.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardName}>{cardName}</Text>
        <Text style={styles.cardDetail}>{setName} #{localId}</Text>
      </View>

      <View style={styles.ids}>
        <Text style={styles.idRow}>
          <Text style={styles.idLabel}>cardflow_card_id </Text>
          {cardflowCardId}
        </Text>
        <Text style={styles.idRow}>
          <Text style={styles.idLabel}>tcgdex_id </Text>
          {tcgdexId}
        </Text>
        <Text style={styles.idRow}>
          <Text style={styles.idLabel}>cardsight_card_id </Text>
          {cardsightCardId ?? 'null'}
        </Text>
        <Text style={styles.idRow}>
          <Text style={styles.idLabel}>scan_id </Text>
          {scanId}
        </Text>
      </View>

      <Pressable style={styles.primaryButton} onPress={() => navigation.popToTop()}>
        <Text style={styles.primaryButtonText}>Scan another card</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0f172a',
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  cardName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  cardDetail: {
    fontSize: 15,
    color: '#94a3b8',
  },
  ids: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  idRow: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  idLabel: {
    color: '#64748b',
  },
  primaryButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
});
