import type { CardFlowCanonicalCard } from '@cardflows/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { confirmScan, searchCatalog } from '../api/client';
import { CardCandidateRow } from '../components/CardCandidateRow';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ManualSearch'>;

export function ManualSearchScreen({ navigation, route }: Props) {
  const { scan, imageUri } = route.params;
  const [setName, setSetName] = useState(scan.recognition.setName ?? '');
  const [localId, setLocalId] = useState(scan.recognition.number ?? '');
  const [candidates, setCandidates] = useState<CardFlowCanonicalCard[]>([]);
  const [selected, setSelected] = useState<CardFlowCanonicalCard | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSearch() {
    if (!setName.trim() || !localId.trim()) {
      Alert.alert('Set + number required', 'Enter both set name and card number to search.');
      return;
    }

    setIsSearching(true);
    try {
      const response = await searchCatalog({
        setName: setName.trim(),
        localId: localId.trim(),
      });

      if (!response.ok) {
        Alert.alert('Search failed', 'Set name and card number are required.');
        return;
      }

      setCandidates(response.candidates);
      setSelected(response.candidates[0] ?? null);

      if (response.candidates.length === 0) {
        Alert.alert('No results', 'No catalog match for that set and number.');
      }
    } catch {
      Alert.alert('Network error', 'Could not search the catalog.');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleConfirm() {
    if (!selected) {
      Alert.alert('Select a card', 'Search and pick a catalog row to confirm.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await confirmScan(scan.scanId, {
        tcgdexId: selected.tcgdexId,
        language: 'en',
        matchMethod: 'manual',
        setName: setName.trim(),
        localId: localId.trim(),
        cardsightCardId: scan.recognition.cardsightCardId,
      });

      if (!response.ok) {
        Alert.alert('Confirm failed', 'Manual confirm requires set name and card number.');
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
      Alert.alert('Network error', 'Could not confirm card.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Image source={{ uri: imageUri }} style={styles.preview} accessibilityIgnoresInvertColors />

      <Text style={styles.title}>Manual search</Text>
      <Text style={styles.subtitle}>
        English catalog lookup by set name + card number. Name-only search is not allowed.
      </Text>

      <View style={styles.form}>
        <Text style={styles.label}>Set name</Text>
        <TextInput
          style={styles.input}
          value={setName}
          onChangeText={setSetName}
          placeholder="e.g. Base Set"
          placeholderTextColor="#64748b"
          autoCapitalize="words"
        />
        <Text style={styles.label}>Card number</Text>
        <TextInput
          style={styles.input}
          value={localId}
          onChangeText={setLocalId}
          placeholder="e.g. 58"
          placeholderTextColor="#64748b"
          keyboardType="default"
        />
        <Pressable style={styles.secondaryButton} onPress={handleSearch} disabled={isSearching}>
          {isSearching ? (
            <ActivityIndicator color="#e2e8f0" />
          ) : (
            <Text style={styles.secondaryButtonText}>Search catalog</Text>
          )}
        </Pressable>
      </View>

      {candidates.length > 0 ? (
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
      ) : null}

      <Pressable
        style={[styles.primaryButton, (!selected || isSubmitting) && styles.buttonDisabled]}
        onPress={handleConfirm}
        disabled={!selected || isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.primaryButtonText}>Confirm selection</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0f172a',
    padding: 20,
    gap: 14,
  },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    backgroundColor: '#1e293b',
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
  form: {
    gap: 8,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#1e293b',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f1f5f9',
    fontSize: 15,
  },
  list: {
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#334155',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
