import { calculateMaxBuy, DEFAULT_MAX_BUY_PREFERENCES } from '@cardflows/shared';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_BASE_URL } from './src/config';

export default function App() {
  const [localMaxBuy, setLocalMaxBuy] = useState<string | null>(null);

  useEffect(() => {
    const result = calculateMaxBuy({
      referencePriceAmount: '8.00',
      condition: 'NM',
      preferences: DEFAULT_MAX_BUY_PREFERENCES,
    });
    setLocalMaxBuy(result.maxBuyAmount);
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>CardFlow</Text>
      <Text style={styles.subtitle}>Private beta — scan → confirm → Max Buy</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Build slice #1</Text>
        <Text style={styles.body}>Expo app + API/BFF + shared package with mock providers.</Text>
        <Text style={styles.body}>API: {API_BASE_URL}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Max Buy (local)</Text>
        {localMaxBuy ? (
          <Text style={styles.highlight}>$8.00 reference → Max Buy ${localMaxBuy}</Text>
        ) : (
          <ActivityIndicator />
        )}
        <Text style={styles.muted}>Formula: reference × 0.80 × 0.87 × condition_factor</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>IDs (never collapse)</Text>
        <Text style={styles.mono}>cardflow_card_id — mint on Confirm</Text>
        <Text style={styles.mono}>tcgdex_id — catalog ref</Text>
        <Text style={styles.mono}>cardsight_card_id — recognition ref</Text>
      </View>

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0f172a',
    padding: 24,
    paddingTop: 64,
    gap: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  body: {
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 20,
  },
  highlight: {
    fontSize: 16,
    fontWeight: '600',
    color: '#38bdf8',
  },
  muted: {
    fontSize: 12,
    color: '#64748b',
  },
  mono: {
    fontSize: 13,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
});
