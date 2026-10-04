import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const photo = side === 'front' ? session.front : session.back;
  const localReasons = photo ? validatePhoto(photo) : ['Add a photo first.'];
  const apiReasons = session.photoRetake?.side === side ? session.photoRetake.reasons : [];
  const reasons = apiReasons.length > 0 ? apiReasons : localReasons;
  const canConfirm = Boolean(photo) && reasons.length === 0;

  function handleRetake() {
    session.setPhoto(side, null);
    navigation.navigate('GradingPhoto', { side });
  }

  function handleConfirm() {
    if (!canConfirm || !photo) return;
    session.setPhotoRetake(null);
    const other = side === 'front' ? session.back : session.front;
    if (other) {
      navigation.navigate('MarkDefects');
      return;
    }
    if (side === 'front') {
      navigation.navigate('GradingPhoto', { side: 'back' });
      return;
    }
    navigation.navigate('MarkDefects');
  }

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

      <PrimaryButton label={PHOTO_COPY.confirm} onPress={handleConfirm} disabled={!canConfirm} />
      <SecondaryButton label={PHOTO_COPY.retake} onPress={handleRetake} />
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
    maxHeight: 420,
    alignSelf: 'center',
    borderRadius: radii.md,
    backgroundColor: '#020617',
  },
  missing: {
    width: '100%',
    aspectRatio: 63 / 88,
    maxHeight: 420,
    borderRadius: radii.md,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingText: {
    color: colors.faint,
  },
});
