import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { getChart } from '../lib/api';
import { useSettings } from '../lib/settings';
import { C } from '../lib/theme';
import { CandleChart } from './CandleChart';

/** 종목 행 아래로 펼쳐지는 미니 차트 */
export function InlineChart({ symbol, width: widthOverride }: { symbol: string; width?: number }) {
  const { settings } = useSettings();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const width = widthOverride ?? windowWidth;

  const query = useQuery({
    queryKey: ['chart', settings.baseUrl, symbol, '1D'],
    queryFn: () => getChart(settings, symbol, '1D'),
  });

  return (
    <View style={styles.box}>
      {query.isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
        </View>
      )}
      {query.isError && <Text style={styles.err}>차트 로딩 실패: {String((query.error as Error).message)}</Text>}
      {query.data && (
        <CandleChart data={query.data} width={Math.min(width, 640) - 40} height={200} initialBars={60} compact />
      )}
      <View style={styles.btnRow}>
        <Pressable
          style={[styles.orderBtn, { backgroundColor: C.up }]}
          onPress={() => router.push({ pathname: '/order', params: { symbol, side: 'buy' } })}>
          <Text style={styles.orderBtnText}>매수</Text>
        </Pressable>
        <Pressable
          style={[styles.orderBtn, { backgroundColor: C.down }]}
          onPress={() => router.push({ pathname: '/order', params: { symbol, side: 'sell' } })}>
          <Text style={styles.orderBtnText}>매도</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          style={styles.bigBtn}
          onPress={() => router.push({ pathname: '/chart', params: { symbol } })}>
          <Text style={styles.bigBtnText}>크게 보기 →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.grid,
    padding: 10,
  },
  center: { paddingVertical: 40, alignItems: 'center' },
  err: { color: C.critical, fontSize: 12, padding: 12 },
  bigBtn: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  bigBtnText: { color: C.accent, fontSize: 12, fontWeight: '600' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  orderBtn: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 18 },
  orderBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
