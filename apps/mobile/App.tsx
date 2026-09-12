import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { RootStackParamList } from './src/navigation/types';
import { ConfirmScreen } from './src/screens/ConfirmScreen';
import { ConfirmedScreen } from './src/screens/ConfirmedScreen';
import { ManualSearchScreen } from './src/screens/ManualSearchScreen';
import { ScanScreen } from './src/screens/ScanScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#0f172a',
    card: '#0f172a',
    text: '#f8fafc',
    border: '#334155',
    primary: '#38bdf8',
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#0f172a' },
            headerTintColor: '#f8fafc',
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: '#0f172a' },
          }}
        >
          <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'CardFlow' }} />
          <Stack.Screen name="Confirm" component={ConfirmScreen} options={{ title: 'Confirm' }} />
          <Stack.Screen
            name="ManualSearch"
            component={ManualSearchScreen}
            options={{ title: 'Manual search' }}
          />
          <Stack.Screen
            name="Confirmed"
            component={ConfirmedScreen}
            options={{ title: 'Confirmed', headerBackVisible: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
