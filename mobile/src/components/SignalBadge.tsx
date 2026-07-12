import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Signal } from '../lib/api';
import { C } from '../lib/theme';

export function SignalBadge({ signal }: { signal: Signal }) {
  const bullish = signal.direction === 'bullish';
  const color = bullish ? C.up : C.down;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.arrow, { color }]}>{bullish ? '▲' : '▼'}</Text>
      <Text style={styles.label}>{signal.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    marginTop: 6,
  },
  arrow: { fontSize: 10, marginRight: 4 },
  label: { color: C.textSecondary, fontSize: 11 },
});
