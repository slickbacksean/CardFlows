import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { getSkipGuidelines } from '../../grading/storage';
import type { GradingStackParamList } from '../../navigation/types';
import { colors } from '../../theme';

type Props = NativeStackScreenProps<GradingStackParamList, 'GradingEntry'>;

export function GradingEntryScreen({ navigation }: Props) {
  useEffect(() => {
    let cancelled = false;
    getSkipGuidelines().then((skip) => {
      if (cancelled) return;
      if (skip) navigation.replace('GradingPhoto', { side: 'front' });
      else navigation.replace('Guidelines');
    });
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
