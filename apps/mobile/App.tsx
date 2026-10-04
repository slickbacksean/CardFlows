import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GradingSessionProvider } from './src/grading/session';
import type { GradingStackParamList, RootStackParamList, RootTabParamList } from './src/navigation/types';
import { ConfirmScreen } from './src/screens/ConfirmScreen';
import { ConfirmedScreen } from './src/screens/ConfirmedScreen';
import { CropConfirmScreen } from './src/screens/grading/CropConfirmScreen';
import { GradingEntryScreen } from './src/screens/grading/GradingEntryScreen';
import { GradingResultScreen } from './src/screens/grading/GradingResultScreen';
import { GuidelinesScreen } from './src/screens/grading/GuidelinesScreen';
import { MarkDefectsScreen } from './src/screens/grading/MarkDefectsScreen';
import { PhotoScreen } from './src/screens/grading/PhotoScreen';
import { ManualSearchScreen } from './src/screens/ManualSearchScreen';
import { PurchasedScreen } from './src/screens/PurchasedScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { colors } from './src/theme';

const ScanStack = createNativeStackNavigator<RootStackParamList>();
const GradingStack = createNativeStackNavigator<GradingStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '600' as const },
  contentStyle: { backgroundColor: colors.bg },
};

function ScanStackNavigator() {
  return (
    <ScanStack.Navigator screenOptions={stackScreenOptions}>
      <ScanStack.Screen name="Scan" component={ScanScreen} options={{ title: 'CardFlow' }} />
      <ScanStack.Screen name="Confirm" component={ConfirmScreen} options={{ title: 'Confirm' }} />
      <ScanStack.Screen
        name="ManualSearch"
        component={ManualSearchScreen}
        options={{ title: 'Manual search' }}
      />
      <ScanStack.Screen
        name="Confirmed"
        component={ConfirmedScreen}
        options={{ title: 'Confirmed', headerBackVisible: false }}
      />
      <ScanStack.Screen name="Purchased" component={PurchasedScreen} options={{ title: 'Purchased' }} />
    </ScanStack.Navigator>
  );
}

function GradingStackNavigator() {
  return (
    <GradingSessionProvider>
      <GradingStack.Navigator screenOptions={stackScreenOptions}>
        <GradingStack.Screen
          name="GradingEntry"
          component={GradingEntryScreen}
          options={{ headerShown: false }}
        />
        <GradingStack.Screen
          name="Guidelines"
          component={GuidelinesScreen}
          options={{ headerShown: false }}
        />
        <GradingStack.Screen
          name="GradingPhoto"
          component={PhotoScreen}
          options={({ route }) => ({
            title: route.params.side === 'front' ? 'Front photo' : 'Back photo',
          })}
        />
        <GradingStack.Screen
          name="CropConfirm"
          component={CropConfirmScreen}
          options={{ title: 'Confirm crop' }}
        />
        <GradingStack.Screen
          name="MarkDefects"
          component={MarkDefectsScreen}
          options={{ title: 'Mark defects' }}
        />
        <GradingStack.Screen
          name="GradingResult"
          component={GradingResultScreen}
          options={{ title: 'Estimate', headerBackVisible: false }}
        />
      </GradingStack.Navigator>
    </GradingSessionProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: colors.bg,
              borderTopColor: colors.border,
            },
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.faint,
          }}
        >
          <Tab.Screen
            name="ScanTab"
            component={ScanStackNavigator}
            options={{
              title: 'Scan',
              tabBarIcon: ({ color }) => (
                <Text style={{ color, fontSize: 16, fontWeight: '700' }}>▣</Text>
              ),
            }}
          />
          <Tab.Screen
            name="GradeTab"
            component={GradingStackNavigator}
            options={{
              title: 'Grade',
              tabBarIcon: ({ color }) => (
                <Text style={{ color, fontSize: 16, fontWeight: '700' }}>◆</Text>
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
