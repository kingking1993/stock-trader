import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { LockGate } from '../components/LockGate';
import { SettingsProvider } from '../lib/settings';
import { C } from '../lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  return (
    <SettingsProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <LockGate>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: C.page },
              headerTintColor: C.text,
              contentStyle: { backgroundColor: C.page },
            }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ title: '설정', presentation: 'modal' }} />
            <Stack.Screen name="guide" options={{ title: '지표 가이드', presentation: 'modal' }} />
            <Stack.Screen name="brokers" options={{ title: '계좌 연동 관리', presentation: 'modal' }} />
            <Stack.Screen name="order" options={{ title: '주문', presentation: 'modal' }} />
          </Stack>
        </LockGate>
      </QueryClientProvider>
    </SettingsProvider>
  );
}
