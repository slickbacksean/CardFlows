import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { submitPregradeFromPhotos } from '../../api/client';
import {
  Atmosphere,
  Card,
  ErrorBanner,
  PrimaryButton,
  SecondaryButton,
} from '../../components/grading/ui';
import { PHOTO_COPY, TARGET } from '../../grading/copy';
import { validatePhoto } from '../../grading/photos';
import { useGradingSession } from '../../grading/session';
import type { GradingStackParamList } from '../../navigation/types';
import { colors, radii } from '../../theme';

type Props = NativeStackScreenProps<GradingStackParamList, 'CropConfirm'>;

export function CropConfirmScreen({ navigation, route }: Props) {
  const { side } = route.params;
  const session = useGradingSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const photo = side === 'front' ? session.front : session.back;
  const bothReady = Boolean(session.front && session.back);
  const localReasons = photo ? validatePhoto(photo) : ['Add a photo first.'];
  const apiReasons = session.photoRetake?.side === side ? session.photoRetake.reasons : [];
  const reasons = [...(apiReasons.length > 0 ? apiReasons : localReasons), ...submitErrors];
  const canConfirm = Boolean(photo) && localReasons.length === 0 && apiReasons.length === 0;

  function handleRetake() {
    session.setPhoto(side, null);
    setSubmitErrors([]);
    navigation.navigate('GradingPhoto', { side });
  }

  function handleNextCrop() {
    if (!canConfirm || !photo) return;
    session.setPhotoRetake(null);
    setSubmitErrors([]);
    if (side === 'front' && !session.back) {
      navigation.navigate('GradingPhoto', { side: 'back' });
    }
  }

  function handleMarkDefects() {
    if (!bothReady) return;
    session.setPhotoRetake(null);
    navigation.navigate('MarkDefects');
  }

  async function handleGradePhotos() {
    if (!session.front || !session.back || isSubmitting || !canConfirm) return;
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

  const primaryLabel = bothReady ? PHOTO_COPY.gradePhotos : PHOTO_COPY.confirm;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Atmosphere />
      <Text style={styles.title}>{PHOTO_COPY.confirmTitle}</Text>
      <Text style={styles.hint}>{PHOTO_COPY.confirmHint}</Text>

      <Card>
        <Text style={styles.sideLabel}>{side === 'front' ? TARGET.frontLabel : TARGET.backLabel}</Text>
        {photo ? (
          <Image
            source={{ uri: photo.uri }}
            style={styles.photo}
            accessibilityIgnoresInvertColors
            accessibilityLabel={`${side} crop preview`}
          />
        ) : (
          <View style={styles.missing}>
            <Text style={styles.missingText}>No crop yet</Text>
          </View>
        )}
      </Card>

      <ErrorBanner reasons={reasons} />

      {isSubmitting ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>{PHOTO_COPY.grading}</Text>
        </View>
      ) : (
        <>
          <PrimaryButton
            label={primaryLabel}
            onPress={bothReady ? handleGradePhotos : handleNextCrop}
            disabled={!canConfirm}
          />
          {bothReady ? (
            <SecondaryButton label={PHOTO_COPY.markDefects} onPress={handleMarkDefects} />
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
  photo: {
    width: '100%',
    aspectRatio: 63 / 88,
    maxHeight: 280,
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
