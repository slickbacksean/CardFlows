import type { CardFlowNormalizedRecognitionResult } from '@cardflows/shared';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { ResultScreen } from './src/screens/ResultScreen';

type Screen = 'capture' | 'result';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('capture');
  const [result, setResult] = useState<CardFlowNormalizedRecognitionResult | null>(null);

  function handleCaptureComplete(captureResult: CardFlowNormalizedRecognitionResult) {
    setResult(captureResult);
    setCurrentScreen('result');
  }

  function handleScanAnother() {
    setResult(null);
    setCurrentScreen('capture');
  }

  return (
    <SafeAreaProvider>
      {currentScreen === 'capture' ? (
        <CaptureScreen onCaptureComplete={handleCaptureComplete} />
      ) : (
        result && <ResultScreen result={result} onScanAnother={handleScanAnother} />
      )}
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
