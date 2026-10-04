import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { submitDetectCrop, submitPregradeFromPhotos } from '../../api/client';
import {
  Atmosphere,
  Card,
  ErrorBanner,
  PrimaryButton,
  SecondaryButton,
  WarningBanner,
} from '../../components/grading/ui';
import { PHOTO_COPY, TARGET } from '../../grading/copy';
import { canConfirmDetectedCrop, shouldRequestPhotoGradeAfterConfirm } from '../../grading/detect-crop';
import { validatePhoto } from '../../grading/photos';
import { useGradingSession } from '../../grading/session';
import type { GradingStackParamList } from '../../navigation/types';
import { colors, radii } from '../../theme';

type Props = NativeStackScreenProps<GradingStackParamList, 'CropConfirm'>;

export function CropConfirmScreen({ navigation, route }: Props) {
  const { side } = route.params;
  const session = useGradingSession();
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const photo = side === 'front' ? session.front : session.back;
  const bothReady = Boolean(session.front?.detected && session.back?.detected);
  const localReasons = photo ? validatePhoto(photo) : ['Add a photo first.'];
  const apiReasons = session.photoRetake?.side === side ? session.photoRetake.reasons : [];
  const detectReasons = session.detectUnavailable ? [session.detectUnavailable] : [];
  const reasons = [
    ...(apiReasons.length > 0 ? apiReasons : localReasons),
    ...detectReasons,
    ...submitErrors,
  ];
  const canConfirm = canConfirmDetectedCrop(photo?.detected, localReasons, apiReasons);
  const previewUri = photo?.cropUri;
  const { setPhoto, setPhotoRetake, setDetectUnavailable } = session;
  const inFlightRef = useRef<string | null>(null);

  const runDetect = useCallback(async () => {
    if (!photo || photo.detected || isSubmitting) return;
    if (localReasons.length > 0) return;
    const key = `${side}:${photo.uri}`;
    if (inFlightRef.current === key) return;
    inFlightRef.current = key;

    setIsDetecting(true);
    setSubmitErrors([]);
    setDetectUnavailable(null);
    try {
      const response = await submitDetectCrop({ photo, side });
      if (response.ok) {
        setPhoto(side, {
          ...photo,
          cropUri: response.cropUri,
          detected: true,
          warnings: response.warnings,
        });
        setPhotoRetake(null);
        return;
      }

      if (response.code === 'PHOTO_RETAKE') {
        setPhoto(side, {
          ...photo,
          cropUri: response.cropUri,
          detected: false,
          warnings: [],
        });
        setPhotoRetake({ side: response.side, reasons: response.reasons });
        return;
      }

      setPhoto(side, { ...photo, detected: false });
      setDetectUnavailable(response.message);
    } catch {
      setDetectUnavailable(PHOTO_COPY.unavailable);
    } finally {
      if (inFlightRef.current === key) inFlightRef.current = null;
      setIsDetecting(false);
    }
  }, [
    isSubmitting,
    localReasons.length,
    photo,
    setDetectUnavailable,
    setPhoto,
    setPhotoRetake,
    side,
  ]);

  useEffect(() => {
    if (!photo || photo.detected || isSubmitting) return;
    if (localReasons.length > 0) return;
    if (session.photoRetake?.side === side) return;
    if (session.detectUnavailable) return;
    void runDetect();
  }, [
    isSubmitting,
    localReasons.length,
    photo,
    runDetect,
    session.detectUnavailable,
    session.photoRetake?.side,
    side,
  ]);

  function handleRetake() {
    session.setPhoto(side, null);
    setSubmitErrors([]);
    navigation.navigate('GradingPhoto', { side });
  }

  async function handleGradePhotos() {
    if (!session.front || !session.back || isSubmitting || !canConfirm) return;
    if (!session.front.detected || !session.back.detected) return;
    setIsSubmitting(true);
    setSubmitErrors([]);
    try {
      const response = await submitPregradeFromPhotos({
        front: session.front,
        back: session.back,
      });

      if (response.ok) {
        session.setPhotoGrade(response);
        session.setPhotoRetake(null);
        navigation.navigate('GradingResult');
        return;
      }

      if (response.code === 'PHOTO_RETAKE') {
        session.setPhotoGrade(null);
        session.setPhotoRetake({ side: response.side, reasons: response.reasons });
        if (response.side !== side) {
          navigation.navigate('CropConfirm', { side: response.side });
        }
        return;
      }

      session.setPhotoGrade(null);
      setSubmitErrors([response.message]);
    } catch {
      session.setPhotoGrade(null);
      setSubmitErrors(['Could not reach the CardFlow API. Is the BFF running?']);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmCrop() {
    if (!canConfirm || !photo || isSubmitting) return;
    session.setPhotoRetake(null);
    setSubmitErrors([]);
    if (!shouldRequestPhotoGradeAfterConfirm(side, Boolean(session.front?.detected), Boolean(session.back?.detected))) {
      navigation.navigate('GradingPhoto', { side: 'back' });
      return;
    }
    await handleGradePhotos();
  }

  const primaryLabel = session.detectUnavailable
    ? PHOTO_COPY.tryDetectAgain
    : PHOTO_COPY.confirm;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Atmosphere />
      <Text style={styles.title}>{PHOTO_COPY.confirmTitle}</Text>
      <Text style={styles.hint}>{PHOTO_COPY.confirmHint}</Text>

      <Card>
        <Text style={styles.sideLabel}>{side === 'front' ? TARGET.frontLabel : TARGET.backLabel}</Text>
        {previewUri ? (
          <>
            <Text style={styles.cropLabel}>{PHOTO_COPY.detectedCrop}</Text>
            <Image
              source={{ uri: previewUri }}
              style={styles.photo}
              accessibilityIgnoresInvertColors
              accessibilityLabel={`${side} detected crop`}
            />
          </>
        ) : photo && !previewUri ? (
          <>
            <Text style={styles.cropLabel}>
              {isDetecting ? PHOTO_COPY.detecting : PHOTO_COPY.noCardFound}
            </Text>
            <View style={styles.missing}>
              <Image
                source={{ uri: photo.uri }}
                style={styles.originalThumb}
                accessibilityIgnoresInvertColors
                accessibilityLabel={`${side} photo taken`}
              />
              <Text style={styles.missingText}>{PHOTO_COPY.originalPhoto}</Text>
            </View>
          </>
        ) : (
          <View style={styles.missing}>
            <Text style={styles.missingText}>No crop yet</Text>
          </View>
        )}
      </Card>

      <WarningBanner warnings={photo?.warnings ?? []} />
      <ErrorBanner reasons={reasons} />

      {isDetecting || isSubmitting ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>
            {isSubmitting ? PHOTO_COPY.grading : PHOTO_COPY.detecting}
          </Text>
        </View>
      ) : (
        <>
          <PrimaryButton
            label={primaryLabel}
            onPress={session.detectUnavailable ? () => void runDetect() : () => void handleConfirmCrop()}
            disabled={session.detectUnavailable ? false : !canConfirm}
          />
          {bothReady ? (
            <SecondaryButton label={PHOTO_COPY.markDefects} onPress={() => navigation.navigate('MarkDefects')} />
          ) : null}
          <SecondaryButton label={PHOTO_COPY.retake} onPress={handleRetake} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    padding: 20,
    gap: 16,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  hint: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  sideLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  cropLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  photo: {
    width: 168,
    aspectRatio: 63 / 88,
    alignSelf: 'center',
    borderRadius: radii.md,
    backgroundColor: '#020617',
  },
  missing: {
    width: '100%',
    aspectRatio: 63 / 88,
    maxHeight: 280,
    borderRadius: radii.md,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  originalThumb: {
    width: '56%',
    aspectRatio: 1,
    borderRadius: radii.md,
    opacity: 0.45,
  },
  missingText: {
    color: colors.faint,
  },
  loading: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 15,
  },
});
