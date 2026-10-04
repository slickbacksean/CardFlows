import AsyncStorage from '@react-native-async-storage/async-storage';

const SKIP_GUIDELINES_KEY = 'cardflow.grading.skipGuidelines';

export async function getSkipGuidelines(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(SKIP_GUIDELINES_KEY);
    return value === '1';
  } catch {
    return false;
  }
}

export async function setSkipGuidelines(skip: boolean): Promise<void> {
  try {
    if (skip) await AsyncStorage.setItem(SKIP_GUIDELINES_KEY, '1');
    else await AsyncStorage.removeItem(SKIP_GUIDELINES_KEY);
  } catch {
    // Device-only preference; ignore storage failures.
  }
}
