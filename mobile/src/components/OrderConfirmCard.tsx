import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtMoney, type PendingOrder } from '../lib/api';
import { C } from '../lib/theme';

type Props = {
  order: PendingOrder;
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
};

/** 에이전트/수동 주문 제안 확인 카드 — 승인해야만 실제 주문이 나간다. */
export function OrderConfirmCard({ order, onConfirm, onReject }: Props) {
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [resolved, setResolved] = useState<string | null>(
    order.status !== 'pending' ? order.status : null,
  );
  const [error, setError] = useState<string | null>(null);
  const buy = order.side === 'buy';
  const isKis = order.broker === 'kis_vts';

  const act = async (kind: 'confirm' | 'reject') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'confirm') await onConfirm(order.id);
      else await onReject(order.id);
      setResolved(kind === 'confirm' ? 'confirmed' : 'rejected');
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.card, { borderColor: buy ? C.up : C.down }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>
          {buy ? '매수' : '매도'} 주문 확인 — {order.name ?? order.symbol}
        </Text>
        <View style={[styles.brokerChip, { borderColor: isKis ? C.sma20 : C.accent }]}>
          <Text style={{ color: isKis ? C.sma20 : C.accent, fontSize: 10, fontWeight: '700' }}>
            {isKis ? '한투 모의' : 'Alpaca'}
          </Text>
        </View>
      </View>
      <Text style={styles.line}>
        수량 {order.qty} ·{' '}
        {order.order_type === 'limit' ? `지정가 ${fmtMoney(order.limit_price, order.currency)}` : '시장가'}
        {order.est_value != null ? ` · 예상금액 ${fmtMoney(order.est_value, order.currency)}` : ''}
      </Text>
      {!!order.rationale && <Text style={styles.rationale}>근거: {order.rationale}</Text>}
      {error && <Text style={styles.error}>⚠ {error}</Text>}
      {resolved ? (
        <Text style={[styles.resolved, { color: resolved === 'confirmed' ? C.good : C.muted }]}>
          {resolved === 'confirmed' ? '✓ 주문 실행됨' : resolved === 'rejected' ? '거절됨' : `상태: ${resolved}`}
        </Text>
      ) : (
        <View style={styles.buttons}>
          <Pressable
            style={[styles.btn, { backgroundColor: buy ? C.up : C.down }]}
            disabled={busy != null}
            onPress={() => act('confirm')}>
            {busy === 'confirm' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>승인하고 주문</Text>
            )}
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} disabled={busy != null} onPress={() => act('reject')}>
            {busy === 'reject' ? (
              <ActivityIndicator color={C.textSecondary} size="small" />
            ) : (
              <Text style={[styles.btnText, { color: C.textSecondary }]}>거절</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginVertical: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: C.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  brokerChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  line: { color: C.textSecondary, fontSize: 13, marginTop: 6 },
  rationale: { color: C.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
  error: { color: C.critical, fontSize: 12, marginTop: 8 },
  resolved: { marginTop: 10, fontSize: 13, fontWeight: '600' },
  buttons: { flexDirection: 'row', marginTop: 12, gap: 8 },
  btn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { backgroundColor: C.page, borderWidth: 1, borderColor: C.border },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
