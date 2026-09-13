import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { identifyCard } from '../api/client';
import type { CardFlowNormalizedRecognitionResult } from '@cardflows/shared';

interface CaptureScreenProps {
  onCaptureComplete?: (result: CardFlowNormalizedRecognitionResult) => void;
}

export function CaptureScreen({ onCaptureComplete }: CaptureScreenProps) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  if (!cameraPermission) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#38bdf8" />
      </SafeAreaView>
    );
  }

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Camera access is required to scan cards</Text>
          <Pressable style={styles.permissionButton} onPress={requestCameraPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  async function handleTakePhoto() {
    if (!cameraReady || processing) return;

    try {
      setProcessing(true);
      setError(null);

      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.8,
        base64: false,
        exif: true,
        skipProcessing: false,
      });

      if (!photo?.uri) {
        throw new Error('Failed to capture photo');
      }

      const result = await identifyCard(photo.uri, 'user_capture');
      onCaptureComplete?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to capture photo');
    } finally {
      setProcessing(false);
    }
  }

  async function handlePickFromLibrary() {
    if (processing) return;

    try {
      setProcessing(true);
      setError(null);

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 1,
        exif: true,
      });

      if (pickerResult.canceled) {
        setProcessing(false);
        return;
      }

      const asset = pickerResult.assets[0];
      if (!asset?.uri) {
        throw new Error('Failed to pick image');
      }

      const result = await identifyCard(asset.uri, 'user_capture');
      onCaptureComplete?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pick image');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan Card</Text>
        <Text style={styles.headerSubtitle}>Take a photo or pick from library</Text>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          onCameraReady={() => setCameraReady(true)}
        />
        <View style={styles.overlay}>
          <View style={styles.guidebox} />
        </View>
      </View>

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.controls}>
        <Pressable
          style={[styles.controlButton, styles.libraryButton]}
          onPress={handlePickFromLibrary}
          disabled={processing}
        >
          {processing ? (
            <ActivityIndicator size="small" color="#0f172a" />
          ) : (
            <Text style={styles.controlButtonText}>📷 Library</Text>
          )}
        </Pressable>

        <Pressable
          style={[
            styles.captureButton,
            (!cameraReady || processing) && styles.captureButtonDisabled,
          ]}
          onPress={handleTakePhoto}
          disabled={!cameraReady || processing}
        >
          {processing ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <View style={styles.captureButtonInner} />
          )}
        </Pressable>

        <View style={styles.placeholder} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionText: {
    fontSize: 16,
    color: '#cbd5e1',
    textAlign: 'center',
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: '#38bdf8',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  header: {
    padding: 16,
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
  cameraContainer: {
    flex: 1,
    margin: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1e293b',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  guidebox: {
    width: '100%',
    aspectRatio: 0.714,
    borderWidth: 2,
    borderColor: '#38bdf8',
    borderRadius: 8,
    borderStyle: 'dashed',
  },
  errorContainer: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#dc2626',
    borderRadius: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    gap: 16,
  },
  controlButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  libraryButton: {
    backgroundColor: '#38bdf8',
  },
  controlButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#0f172a',
  },
  captureButtonDisabled: {
    opacity: 0.5,
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },
  placeholder: {
    width: 80,
  },
});
