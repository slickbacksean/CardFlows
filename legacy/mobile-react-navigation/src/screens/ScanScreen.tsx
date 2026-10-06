import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
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
import { createScan } from '../api/client';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

function mimeFromUri(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (uri.endsWith('.png')) return 'image/png';
  if (uri.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export function ScanScreen({ navigation }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  async function requestPermission(kind: 'camera' | 'library') {
    const result =
      kind === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!result.granted) {
      Alert.alert('Permission required', 'Allow camera or photo library access to scan cards.');
      return false;
    }
    return true;
  }

  async function handlePick(kind: 'camera' | 'library') {
    const allowed = await requestPermission(kind);
    if (!allowed) return;

    const result =
      kind === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.85,
            allowsEditing: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.85,
            allowsEditing: false,
          });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setPreviewUri(asset.uri);
    setIsLoading(true);

    try {
      const mimeType = asset.mimeType?.includes('png')
        ? 'image/png'
        : asset.mimeType?.includes('webp')
          ? 'image/webp'
          : mimeFromUri(asset.uri);

      const response = await createScan({
        uri: asset.uri,
        mimeType,
        captureMethod: kind === 'camera' ? 'camera_photo' : 'photo_library',
      });

      if (!response.ok || !response.scan) {
        Alert.alert('Scan failed', 'Could not process the image. Try again.');
        return;
      }

      navigation.navigate('Confirm', {
        scan: response.scan,
        imageUri: asset.uri,
      });
    } catch {
      Alert.alert('Network error', 'Could not reach the CardFlow API. Is the BFF running?');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Scan a card</Text>
      <Text style={styles.subtitle}>
        English raw singles · still image only · mock identify + catalog map
      </Text>

      {previewUri ? (
        <Image source={{ uri: previewUri }} style={styles.preview} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.previewPlaceholder}>
          <Text style={styles.placeholderText}>No image selected</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#38bdf8" />
          <Text style={styles.loadingText}>Identifying…</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={() => handlePick('camera')}>
            <Text style={styles.primaryButtonText}>Take photo</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => handlePick('library')}>
            <Text style={styles.secondaryButtonText}>Choose from library</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.note}>
        <Text style={styles.noteTitle}>IDs (never collapse)</Text>
        <Text style={styles.noteLine}>cardflow_card_id — mint on Confirm only</Text>
        <Text style={styles.noteLine}>tcgdex_id — catalog ref</Text>
        <Text style={styles.noteLine}>cardsight_card_id — recognition ref</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0f172a',
    padding: 24,
    paddingTop: 16,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  preview: {
    width: '100%',
    height: 280,
    borderRadius: 12,
    backgroundColor: '#1e293b',
  },
  previewPlaceholder: {
    width: '100%',
    height: 280,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#64748b',
    fontSize: 14,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  actions: {
    gap: 12,
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
    fontSize: 16,
    fontWeight: '600',
  },
  note: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    gap: 4,
  },
  noteTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#cbd5e1',
    marginBottom: 4,
  },
  noteLine: {
    fontSize: 12,
    color: '#64748b',
    fontFamily: 'monospace',
  },
});
