import type { CardFlowNormalizedRecognitionResult } from '@cardflows/shared';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ResultScreenProps {
  result: CardFlowNormalizedRecognitionResult;
  onScanAnother: () => void;
}

export function ResultScreen({ result, onScanAnother }: ResultScreenProps) {
  const detection = result.detections[0];

  function getConfidenceColor(confidence: string | null): string {
    const lower = confidence?.toLowerCase() || '';
    switch (lower) {
      case 'high':
        return '#22c55e';
      case 'medium':
        return '#f59e0b';
      case 'low':
        return '#ef4444';
      default:
        return '#64748b';
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Recognition Result</Text>
          <Text style={styles.headerSubtitle}>Mock provider response</Text>
        </View>

        {detection && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Detection</Text>
              {detection.confidence && (
                <View
                  style={[
                    styles.confidenceBadge,
                    { backgroundColor: getConfidenceColor(detection.confidence) },
                  ]}
                >
                  <Text style={styles.confidenceBadgeText}>
                    {detection.confidence.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            {detection.name && (
              <View style={styles.row}>
                <Text style={styles.label}>Card Name</Text>
                <Text style={styles.value}>{detection.name}</Text>
              </View>
            )}

            {detection.setName && (
              <View style={styles.row}>
                <Text style={styles.label}>Set</Text>
                <Text style={styles.value}>{detection.setName}</Text>
              </View>
            )}

            {detection.number && (
              <View style={styles.row}>
                <Text style={styles.label}>Number</Text>
                <Text style={styles.value}>{detection.number}</Text>
              </View>
            )}

            {detection.language && (
              <View style={styles.row}>
                <Text style={styles.label}>Language</Text>
                <Text style={styles.value}>{detection.language}</Text>
              </View>
            )}

            {detection.matchLevel && (
              <View style={styles.row}>
                <Text style={styles.label}>Match Level</Text>
                <Text style={styles.value}>{detection.matchLevel}</Text>
              </View>
            )}
          </View>
        )}

        {detection?.vendorCardId && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Vendor ID</Text>
            <Text style={styles.mono}>{detection.vendorCardId}</Text>
            <Text style={styles.muted}>Recognition reference only (do not use for catalog)</Text>
          </View>
        )}

        {detection?.candidates && detection.candidates.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Candidates ({detection.candidates.length})</Text>
            {detection.candidates.map((candidate, idx) => (
              <View key={idx} style={styles.candidateRow}>
                <Text style={styles.value}>
                  {candidate.name || 'Unknown'} - {candidate.setName || 'Unknown Set'}
                </Text>
                {candidate.number && <Text style={styles.muted}>#{candidate.number}</Text>}
              </View>
            ))}
          </View>
        )}

        {result.error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Error</Text>
            <Text style={styles.errorText}>{result.error.message}</Text>
            {result.error.code && (
              <Text style={styles.errorCode}>Code: {result.error.code}</Text>
            )}
          </View>
        )}

        <Pressable style={styles.button} onPress={onScanAnother}>
          <Text style={styles.buttonText}>Scan Another Card</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  header: {
    gap: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f8fafc',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  label: {
    fontSize: 14,
    color: '#94a3b8',
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
    color: '#cbd5e1',
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  confidenceBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  mono: {
    fontSize: 13,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  muted: {
    fontSize: 12,
    color: '#64748b',
  },
  errorCard: {
    backgroundColor: '#7f1d1d',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fca5a5',
  },
  errorText: {
    fontSize: 14,
    color: '#fecaca',
  },
  errorCode: {
    fontSize: 12,
    color: '#fca5a5',
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#38bdf8',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  candidateRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
});
