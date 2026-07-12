import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { CandleChart } from '../../components/CandleChart';
import { SignalBadge } from '../../components/SignalBadge';
import { fmtMoney, getChart } from '../../lib/api';
import { useSettings } from '../../lib/settings';
import { C } from '../../lib/theme';

export default function ChartScreen() {
  const { settings, loaded } = useSettings();
  const router = useRouter();
  const params = useLocalSearchParams<{ symbol?: string }>();
  const { width } = useWindowDimensions();
  const [input, setInput] = useState('AAPL');
  const [symbol, setSymbol] = useState('AAPL');
  const [timeframe, setTimeframe] = useState<'1M' | '1D' | '1W' | '1MO'>('1D');

  const TF_LABELS: { key: '1M' | '1D' | '1W' | '1MO'; label: string }[] = [
    { key: '1M', label: '분' },
    { key: '1D', label: '일' },
    { key: '1W', label: '주' },
    { key: '1MO', label: '월' },
  ];

  // 추천 탭에서 넘어온 심볼 반영
  useEffect(() => {
    if (params.symbol) {
      setInput(String(params.symbol));
      setSymbol(String(params.symbol));
    }
  }, [params.symbol]);

  const query = useQuery({
    queryKey: ['chart', settings.baseUrl, symbol, timeframe],
    queryFn: () => getChart(settings, symbol, timeframe),
    enabled: loaded && !!symbol,
  });

  return (
    <ScrollView style={{ backgroundColor: C.page }} contentContainerStyle={{ padding: 12 }}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={(t) => setInput(t.toUpperCase())}
          placeholder="심볼 (예: AAPL, 005930)"
          placeholderTextColor={C.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          onSubmitEditing={() => setSymbol(input.trim())}
        />
        <Pressable style={styles.searchBtn} onPress={() => setSymbol(input.trim())}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>조회</Text>
        </Pressable>
      </View>

      {/* 봉 주기 선택 */}
      <View style={styles.tfRow}>
        {TF_LABELS.map((tf) => (
          <Pressable
            key={tf.key}
            style={[styles.tfBtn, timeframe === tf.key && styles.tfBtnActive]}
            onPress={() => setTimeframe(tf.key)}>
            <Text style={[styles.tfText, timeframe === tf.key && { color: '#fff', fontWeight: '700' }]}>
              {tf.label}
            </Text>
          </Pressable>
        ))}
        {timeframe === '1M' && <Text style={styles.tfNote}>당일 분봉 · 장중에만 (국내는 최근 30분)</Text>}
      </View>

      {query.isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} size="large" />
        </View>
      )}
      {query.isError && (
        <Text style={styles.err}>조회 실패: {String((query.error as Error).message)}</Text>
      )}
      {query.data && (
        <View>
          <Text style={styles.symbolTitle}>
            {query.data.name ? `${query.data.name} (${query.data.symbol})` : query.data.symbol} ·{' '}
            {timeframe === '1M' ? '분봉' : timeframe === '1D' ? '일봉' : timeframe === '1W' ? '주봉' : '월봉'}
          </Text>
          {query.data.close.length > 0 && (
            <Text style={styles.priceLine}>
              {fmtMoney(query.data.close[query.data.close.length - 1], query.data.currency)}
              <Text style={styles.priceNote}>  종가 (마지막 봉)</Text>
            </Text>
          )}
          <CandleChart data={query.data} width={width - 24} height={300} />
          {/* 매수/매도 버튼 */}
          <View style={styles.orderRow}>
            <Pressable
              style={[styles.orderBtn, { backgroundColor: C.up }]}
              onPress={() => router.push({ pathname: '/order', params: { symbol: query.data!.symbol, side: 'buy' } })}>
              <Text style={styles.orderBtnText}>매수</Text>
            </Pressable>
            <Pressable
              style={[styles.orderBtn, { backgroundColor: C.down }]}
              onPress={() => router.push({ pathname: '/order', params: { symbol: query.data!.symbol, side: 'sell' } })}>
              <Text style={styles.orderBtnText}>매도</Text>
            </Pressable>
          </View>

          {query.data.signals.length > 0 && (
            <View style={styles.signalBox}>
              <Text style={styles.signalTitle}>최근 시그널</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {query.data.signals.map((sg, i) => (
                  <SignalBadge key={i} signal={sg} />
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  searchBtn: {
    backgroundColor: C.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  tfRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  tfBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: C.surface,
  },
  tfBtnActive: { backgroundColor: C.sma60, borderColor: C.sma60 },
  tfText: { color: C.textSecondary, fontSize: 12 },
  tfNote: { color: C.muted, fontSize: 11, marginLeft: 4 },
  center: { paddingVertical: 60, alignItems: 'center' },
  err: { color: C.critical, fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  symbolTitle: { color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 2 },
  priceLine: { color: C.text, fontSize: 22, fontWeight: '800', marginBottom: 8, fontVariant: ['tabular-nums'] },
  priceNote: { color: C.muted, fontSize: 11, fontWeight: '400' },
  signalBox: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    padding: 12,
    marginTop: 14,
  },
  signalTitle: { color: C.textSecondary, fontSize: 12, marginBottom: 4 },
  orderRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  orderBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  orderBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
