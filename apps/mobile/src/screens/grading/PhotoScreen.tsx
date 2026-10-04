import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Atmosphere, Card, PrimaryButton, SecondaryButton } from '../../components/grading/ui';
import { NeutralCard } from '../../components/grading/NeutralCard';
import { PHOTO_COPY, TARGET } from '../../grading/copy';
import { fileNameFor, mimeFromName, readPhotoSize, type GradingPhoto } from '../../grading/photos';
import { useGradingSession } from '../../grading/session';
import type { GradingStackParamList } from '../../navigation/types';
import { colors } from '../../theme';

type Props = NativeStackScreenProps<GradingStackParamList, 'GradingPhoto'>;

export function PhotoScreen({ navigation, route }: Props) {
  const { side } = route.params;
  const session = useGradingSession();

  async function requestPermission(kind: 'camera' | 'library') {
    const result =
      kind === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!result.granted) {
      Alert.alert('Permission required', 'Allow camera or photo library access to grade cards.');
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
            quality: 0.9,
            allowsEditing: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.9,
            allowsEditing: false,
          });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mimeType = mimeFromName(asset.fileName ?? asset.uri, asset.mimeType);
    if (!mimeType) {
      session.setPhoto(side, {
        uri: asset.uri,
        mimeType: 'image/jpeg',
        fileName: fileNameFor(side, 'image/jpeg'),
        fileSize: asset.fileSize,
        detected: false,
      });
      session.setPhotoRetake({
        side,
        reasons: ['Use a JPEG, PNG, or WebP photo.'],
      });
      navigation.navigate('CropConfirm', { side });
      return;
    }

    const fileSize = asset.fileSize ?? (await readPhotoSize(asset.uri));
    const photo: GradingPhoto = {
      uri: asset.uri,
      mimeType,
      fileName: asset.fileName ?? fileNameFor(side, mimeType),
      fileSize,
      detected: false,
    };
    session.setPhoto(side, photo);
    navigation.navigate('CropConfirm', { side });
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Atmosphere />
      <Text style={styles.title}>
        {side === 'front' ? PHOTO_COPY.frontTitle : PHOTO_COPY.backTitle}
      </Text>
      <Text style={styles.hint}>
        {side === 'front' ? PHOTO_COPY.frontHint : PHOTO_COPY.backHint}
      </Text>

      <Card>
        <Text style={styles.targetLabel}>{TARGET.title}</Text>
        <Text style={styles.body}>{TARGET.body}</Text>
        <View style={styles.preview}>
          <NeutralCard variant={side} width={148} />
        </View>
      </Card>

      <PrimaryButton label={PHOTO_COPY.takePhoto} onPress={() => handlePick('camera')} />
      <SecondaryButton label={PHOTO_COPY.chooseLibrary} onPress={() => handlePick('library')} />
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
  targetLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  preview: {
    alignItems: 'center',
    paddingVertical: 8,
  },
});
