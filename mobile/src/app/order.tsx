import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  confirmOrder,
  createOrder,
  fmtMoney,
  getAvailableBrokers,
  getChart,
  type OrderBrokerOption,
} from '../lib/api';
import { useSettings } from '../lib/settings';
import { C } from '../lib/theme';

/** 증권사 앱 스타일 주문 화면 — 직접 단가·수량 입력 후 매수/매도 */
export default function OrderScreen() {
  const { settings } = useSettings();
  const router = useRouter();
  const params = useLocalSearchParams<{ symbol?: string; side?: string }>();
  const symbol = String(params.symbol ?? '').toUpperCase();
  const isKr = /^\d{6}$/.test(symbol);
  const currency = isKr ? ('KRW' as const) : ('USD' as const);

  const [side, setSide] = useState<'buy' | 'sell'>(params.side === 'sell' ? 'sell' : 'buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('limit');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [broker, setBroker] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // 현재가 (차트 API 재사용 — 15초 갱신)
  const chart = useQuery({
    queryKey: ['orderQuote', settings.baseUrl, symbol],
    queryFn: () => getChart(settings, symbol, '1D'),
    enabled: !!symbol,
    refetchInterval: 15_000,
  });
  const lastPrice = chart.data ? chart.data.close[chart.data.close.length - 1] : null;

  // 지정가 기본값 = 현재가
  useEffect(() => {
    if (lastPrice != null && price === '') setPrice(String(lastPrice));
  }, [lastPrice, price]);

  const brokersQ = useQuery({
    queryKey: ['orderBrokers', settings.baseUrl, symbol],
    queryFn: () => getAvailableBrokers(settings, symbol),
    enabled: !!symbol,
  });
  useEffect(() => {
    const list = brokersQ.data?.brokers?.filter((b) => b.enabled);
    if (list?.length && broker == null) setBroker(list[0].broker);
  }, [brokersQ.data, broker]);

  const qtyNum = parseFloat(qty) || 0;
  const priceNum = orderType === 'limit' ? parseFloat(price) || 0 : lastPrice ?? 0;
  const estValue = qtyNum * priceNum;
  const selectedBroker: OrderBrokerOption | undefined = brokersQ.data?.brokers.find((b) => b.broker === broker);
  const isLive = selectedBroker?.live && selectedBroker.enabled;

  const bumpQty = (d: number) => setQty(String(Math.max(1, (parseFloat(qty) || 0) + d)));

  const submit = () => {
    if (!broker || qtyNum <= 0) return;
    const doIt = async () => {
      setBusy(true);
      setResult(null);
      try {
        const pending = await createOrder(settings, {
          symbol,
          side,
          qty: qtyNum,
          order_type: orderType,
          limit_price: orderType === 'limit' ? priceNum : undefined,
          broker,
          rationale: '주문 화면에서 직접 주문',
        });
        const r: any = await confirmOrder(settings, pending.id);
        const msg = r?.broker_order?.message || r?.broker_order?.status || '접수됨';
        setResult(`✓ 주문 접수 완료 — ${msg}`);
      } catch (e: any) {
        setResult(`⚠ ${String(e?.message ?? e)}`);
      } finally {
        setBusy(false);
      }
    };

    const title = `${symbol} ${side === 'buy' ? '매수' : '매도'} ${qtyNum}주`;
    const detail =
      `${orderType === 'limit' ? `지정가 ${fmtMoney(priceNum, currency)}` : '시장가'} · 예상 ${fmtMoney(estValue, currency)}\n계좌: ${selectedBroker?.label}` +
      (isLive ? '\n\n⚠️ 실전 계좌 — 실제 돈이 사용됩니다!' : '');
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n${detail}`)) doIt();
    } else {
      Alert.alert(title, detail, [
        { text: '취소', style: 'cancel' },
        { text: '주문', style: isLive ? 'destructive' : 'default', onPress: doIt },
      ]);
    }
  };

  const sideColor = side === 'buy' ? C.up : C.down;

  return (
    <ScrollView style={{ backgroundColor: C.page }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* 종목/현재가 */}
      <Text style={styles.symbol}>
        {chart.data?.name ? `${chart.data.name} (${symbol})` : symbol}
      </Text>
      <Text style={styles.price}>
        {lastPrice != null ? fmtMoney(lastPrice, currency) : '시세 조회 중…'}
        <Text style={styles.priceNote}>  현재가 (15초 갱신)</Text>
      </Text>

      {/* 매수/매도 */}
      <View style={styles.segRow}>
        {(['buy', 'sell'] as const).map((s) => (
          <Pressable
            key={s}
            style={[styles.segBtn, side === s && { backgroundColor: s === 'buy' ? C.up : C.down, borderColor: 'transparent' }]}
            onPress={() => setSide(s)}>
            <Text style={[styles.segText, side === s && { color: '#fff', fontWeight: '800' }]}>
              {s === 'buy' ? '매수' : '매도'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 시장가/지정가 */}
      <View style={styles.segRow}>
        {(['limit', 'market'] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.segBtn, orderType === t && styles.segOn]}
            onPress={() => setOrderType(t)}>
            <Text style={[styles.segText, orderType === t && { color: '#fff', fontWeight: '700' }]}>
              {t === 'limit' ? '지정가' : '시장가'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 가격 */}
      {orderType === 'limit' && (
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>주문 가격</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            placeholderTextColor={C.muted}
          />
        </View>
      )}

      {/* 수량 */}
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>수량</Text>
        <Pressable style={styles.qtyBtn} onPress={() => bumpQty(-1)}>
          <Text style={styles.qtyBtnText}>−</Text>
        </Pressable>
        <TextInput
          style={[styles.input, { textAlign: 'center' }]}
          value={qty}
          onChangeText={setQty}
          keyboardType="numeric"
        />
        <Pressable style={styles.qtyBtn} onPress={() => bumpQty(1)}>
          <Text style={styles.qtyBtnText}>+</Text>
        </Pressable>
      </View>

      {/* 예상 금액 */}
      <View style={styles.estBox}>
        <Text style={styles.estLabel}>예상 주문금액</Text>
        <Text style={[styles.estValue, { color: sideColor }]}>{fmtMoney(estValue, currency)}</Text>
      </View>

      {/* 계좌 선택 */}
      <Text style={styles.sectionTitle}>주문 계좌</Text>
      {brokersQ.isLoading && <ActivityIndicator color={C.accent} />}
      {brokersQ.data?.brokers.map((b) => {
        const on = broker === b.broker;
        return (
          <Pressable
            key={b.broker}
            style={[styles.brokerBtn, on && { borderColor: b.live ? C.critical : C.accent, borderWidth: 2 }]}
            disabled={!b.enabled}
            onPress={() => setBroker(b.broker)}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.brokerLabel, !b.enabled && { color: C.muted }]}>
                {b.label} {b.live && <Text style={{ color: C.critical, fontSize: 11 }}>● 실전</Text>}
              </Text>
              <Text style={styles.brokerNote}>
                {b.note}
                {b.cash_label ? ` · 예수금 ${b.cash_label}` : ''}
              </Text>
            </View>
            {on && <Text style={{ color: b.live ? C.critical : C.accent, fontWeight: '800' }}>✓</Text>}
          </Pressable>
        );
      })}
      {isKr && (
        <Text style={styles.hint}>국내 주문은 평일 09:00~15:30 장중에만 접수됩니다</Text>
      )}
      {!isKr && broker === 'kis_vts' && (
        <Text style={styles.hint}>한투 모의 미국주식은 지정가만 지원됩니다 (시장가 선택 시 현재가 지정가로 자동 변환)</Text>
      )}

      {/* 주문 버튼 */}
      <Pressable
        style={[styles.submitBtn, { backgroundColor: sideColor }, (busy || !broker || qtyNum <= 0) && { opacity: 0.5 }]}
        disabled={busy || !broker || qtyNum <= 0}
        onPress={submit}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>
            {side === 'buy' ? '매수하기' : '매도하기'}
            {isLive ? ' (실전!)' : ''}
          </Text>
        )}
      </Pressable>

      {result && <Text style={[styles.result, { color: result.startsWith('✓') ? C.good : C.critical }]}>{result}</Text>}
      {result?.startsWith('✓') && (
        <Pressable style={styles.linkBtn} onPress={() => router.push('/portfolio')}>
          <Text style={{ color: C.accent, fontSize: 13 }}>포트폴리오에서 확인 →</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  symbol: { color: C.text, fontSize: 18, fontWeight: '800' },
  price: { color: C.text, fontSize: 24, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  priceNote: { color: C.muted, fontSize: 11, fontWeight: '400' },
  segRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  segBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: C.surface,
  },
  segOn: { backgroundColor: C.sma60, borderColor: C.sma60 },
  segText: { color: C.textSecondary, fontSize: 14 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  fieldLabel: { color: C.textSecondary, fontSize: 13, width: 70 },
  input: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    color: C.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  qtyBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { color: C.text, fontSize: 20, fontWeight: '700' },
  estBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 14,
    marginTop: 14,
  },
  estLabel: { color: C.textSecondary, fontSize: 13 },
  estValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  brokerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  brokerLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  brokerNote: { color: C.muted, fontSize: 11, marginTop: 2 },
  hint: { color: C.muted, fontSize: 11, marginTop: 4, lineHeight: 16 },
  submitBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  result: { marginTop: 14, fontSize: 13, lineHeight: 19 },
  linkBtn: { marginTop: 8, alignSelf: 'flex-start' },
});
