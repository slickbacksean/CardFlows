import type { CardFlowCanonicalCard } from '@cardflows/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { confirmScan, rejectScan } from '../api/client';
import { CardCandidateRow } from '../components/CardCandidateRow';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Confirm'>;

function isHighMatch(scan: Props['route']['params']['scan']): boolean {
  return (
    scan.mappingResult.status === 'matched' &&
    scan.mappingResult.confidence === 'High' &&
    scan.mappingResult.canonicalCard !== null
  );
}

function isAmbiguous(scan: Props['route']['params']['scan']): boolean {
  return (
    scan.mappingResult.status === 'ambiguous' ||
    scan.mappingResult.candidates.length > 1
  );
}

function isFallback(scan: Props['route']['params']['scan']): boolean {
  if (!scan.recognitionResult.ok) return true;
  const code = scan.recognitionResult.error?.code;
  if (code === 'RATE_LIMITED' || code === 'PROVIDER_TIMEOUT' || code === 'PROVIDER_UNAVAILABLE') {
    return true;
  }
  return scan.mappingResult.status === 'no_match';
}

export function ConfirmScreen({ navigation, route }: Props) {
  const { scan, imageUri } = route.params;
  const [selected, setSelected] = useState<CardFlowCanonicalCard | null>(
    scan.mappingResult.canonicalCard ?? scan.mappingResult.candidates[0] ?? null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mode = useMemo(() => {
    if (isHighMatch(scan)) return 'high';
    if (isAmbiguous(scan)) return 'ambiguous';
    if (isFallback(scan)) return 'fallback';
    return 'ambiguous';
  }, [scan]);

  const headline = useMemo(() => {
    switch (mode) {
      case 'high':
        return 'Confirm this card?';
      case 'ambiguous':
        return 'Which card is this?';
      case 'fallback':
        return 'No confident match';
      default:
        return 'Confirm card';
    }
  }, [mode]);

  const helper = useMemo(() => {
    switch (mode) {
      case 'high':
        return 'High-confidence proposal. Tap Confirm to mint cardflow_card_id.';
      case 'ambiguous':
        return 'Multiple candidates — pick one or search manually.';
      case 'fallback':
        return 'Use manual search with set name + card number. Name-only is not allowed.';
      default:
        return '';
    }
  }, [mode]);

  async function handleConfirm() {
    if (!selected) {
      Alert.alert('Select a card', 'Pick a candidate or use manual search.');
      return;
    }

    setIsSubmitting(true);
    try {
      const matchMethod = mode === 'high' ? 'identify' : 'manual';
      const setName = selected.set?.name ?? selected.tcgdexSetId;
      const response = await confirmScan(scan.scanId, {
        tcgdexId: selected.tcgdexId,
        language: 'en',
        matchMethod,
        cardsightCardId: selected.cardsightCardId ?? scan.recognition.cardsightCardId,
        setName,
        localId: selected.localId,
      });

      if (!response.ok) {
        Alert.alert('Confirm failed', 'Could not confirm this card.');
        return;
      }

      navigation.replace('Confirmed', {
        scanId: scan.scanId,
        cardflowCardId: response.confirmation.cardflowCardId,
        tcgdexId: response.confirmation.tcgdexId,
        cardsightCardId: response.confirmation.cardsightCardId,
        cardName: response.confirmation.canonicalCard.name,
        setName: response.confirmation.canonicalCard.set?.name ?? response.confirmation.canonicalCard.tcgdexSetId,
        localId: response.confirmation.canonicalCard.localId,
      });
    } catch {
      Alert.alert('Network error', 'Could not reach the CardFlow API.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReject() {
    setIsSubmitting(true);
    try {
      await rejectScan(scan.scanId);
      navigation.popToTop();
    } catch {
      Alert.alert('Network error', 'Could not reject scan.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const candidates =
    mode === 'high' && scan.mappingResult.canonicalCard
      ? [scan.mappingResult.canonicalCard]
      : scan.mappingResult.candidates;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Image source={{ uri: imageUri }} style={styles.preview} accessibilityIgnoresInvertColors />

      <View style={styles.header}>
        <Text style={styles.title}>{headline}</Text>
        <Text style={styles.subtitle}>{helper}</Text>
        <Text style={styles.badge}>
          {scan.mappingResult.confidence} · {scan.mappingResult.status}
        </Text>
      </View>

      {mode === 'fallback' && candidates.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No catalog candidates. Search by set + number.</Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('ManualSearch', { scan, imageUri })}
          >
            <Text style={styles.secondaryButtonText}>Search manually</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {candidates.map((card) => (
            <CardCandidateRow
              key={card.tcgdexId}
              card={card}
              selected={selected?.tcgdexId === card.tcgdexId}
              onPress={() => setSelected(card)}
            />
          ))}
        </View>
      )}

      {mode !== 'fallback' || candidates.length > 0 ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
            onPress={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.primaryButtonText}>Confirm</Text>
            )}
          </Pressable>

          {mode !== 'high' ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={() => navigation.navigate('ManualSearch', { scan, imageUri })}
            >
              <Text style={styles.secondaryButtonText}>Search manually</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.ghostButton} onPress={handleReject} disabled={isSubmitting}>
            <Text style={styles.ghostButtonText}>Reject / retry scan</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.ghostButton} onPress={handleReject} disabled={isSubmitting}>
          <Text style={styles.ghostButtonText}>Reject / retry scan</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0f172a',
    padding: 20,
    gap: 16,
  },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    backgroundColor: '#1e293b',
  },
  header: {
    gap: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    fontSize: 12,
    color: '#38bdf8',
    fontFamily: 'monospace',
  },
  list: {
    gap: 10,
  },
  empty: {
    gap: 12,
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#1e293b',
  },
  emptyText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  ghostButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  ghostButtonText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});
