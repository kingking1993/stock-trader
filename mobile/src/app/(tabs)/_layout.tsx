import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Pressable } from 'react-native';
import { C } from '../../lib/theme';

export default function TabLayout() {
  const router = useRouter();
  const gear = (
    <>
      <Pressable onPress={() => router.push('/guide')} style={{ marginRight: 16 }}>
        <Ionicons name="help-circle-outline" size={23} color={C.textSecondary} />
      </Pressable>
      <Pressable onPress={() => router.push('/settings')} style={{ marginRight: 14 }}>
        <Ionicons name="settings-outline" size={22} color={C.textSecondary} />
      </Pressable>
    </>
  );

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.page },
        headerTintColor: C.text,
        headerRight: () => gear,
        tabBarStyle: { backgroundColor: C.page, borderTopColor: C.grid },
        tabBarActiveTintColor: C.text,
        tabBarInactiveTintColor: C.muted,
        sceneStyle: { backgroundColor: C.page },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '추천',
          tabBarIcon: ({ color, size }) => <Ionicons name="trending-up" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="sectors"
        options={{
          title: '섹터',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chart"
        options={{
          title: '차트',
          tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'AI 채팅',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-ellipses-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: '포트폴리오',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
