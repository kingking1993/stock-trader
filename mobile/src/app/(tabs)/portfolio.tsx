import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DonutChart, PIE_COLORS, type Slice } from '../../components/DonutChart';
import { OrderConfirmCard } from '../../components/OrderConfirmCard';
import {
  confirmOrder,
  fmtMoney,
  getOrders,
  getPortfolio,
  rejectOrder,
  type AccountInfo,
} from '../../lib/api';
import { useSettings } from '../../lib/settings';
import { C } from '../../lib/theme';

export default function PortfolioScreen() {
  const { settings, loaded } = useSettings();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null); // 상세 원그래프를 펼친 계좌

  const portfolio = useQuery({
    queryKey: ['portfolio', settings.baseUrl],
    queryFn: () => getPortfolio(settings),
    enabled: loaded,
    refetchInterval: 30_000,
  });
  const orders = useQuery({
    queryKey: ['orders', settings.baseUrl],
    queryFn: () => getOrders(settings),
    enabled: loaded,
    refetchInterval: 15_000,
  });

  const refreshing = portfolio.isRefetching || orders.isRefetching;
  const refetchAll = () => {
    portfolio.refetch();
    orders.refetch();
  };

  if (!portfolio.data && portfolio.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  const data = portfolio.data;

  return (
    <ScrollView
      style={{ backgroundColor: C.page }}
      contentContainerStyle={{ padding: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={C.muted} />}>
      {portfolio.isError && (
        <Text style={styles.err}>계좌 조회 실패: {String((portfolio.error as Error).message)}</Text>
      )}

      {/* 전계좌 합산 + 계좌 비중 원그래프 */}
      {data && (
        <View style={[styles.card, styles.totalCard]}>
          <Text style={styles.cardTitle}>전계좌 합산 자산</Text>
          <Text style={styles.equity}>₩{data.total_krw.toLocaleString()}</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.dim}>≈ ${data.total_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            <Text style={styles.dim}>환율 $1 = ₩{data.fx_rate.toLocaleString()}</Text>
          </View>
          <View style={{ marginTop: 12 }}>
            <DonutChart
              slices={data.accounts
                .filter((a) => (a.equity ?? 0) > 0)
                .map((a, i): Slice => ({
                  label: a.label,
                  value: a.currency === 'USD' ? (a.equity ?? 0) * data.fx_rate : (a.equity ?? 0),
                  color: PIE_COLORS[i % PIE_COLORS.length],
                }))}
              centerTitle="계좌 비중"
              centerValue={`${data.accounts.filter((a) => a.equity != null).length}개 계좌`}
            />
          </View>
          <Text style={[styles.dim, { marginTop: 8 }]}>계좌를 탭하면 해당 계좌의 구성(종목+현금)이 표시됩니다</Text>
        </View>
      )}

      {/* 승인 대기 주문 */}
      {(orders.data?.pending?.length ?? 0) > 0 && (
        <View>
          <Text style={styles.section}>승인 대기 주문</Text>
          {orders.data!.pending.map((o) => (
            <OrderConfirmCard
              key={o.id}
              order={o}
              onConfirm={async (id) => {
                await confirmOrder(settings, id);
                qc.invalidateQueries({ queryKey: ['orders'] });
                qc.invalidateQueries({ queryKey: ['portfolio'] });
              }}
              onReject={async (id) => {
                await rejectOrder(settings, id);
                qc.invalidateQueries({ queryKey: ['orders'] });
              }}
            />
          ))}
        </View>
      )}

      {/* 계좌별 섹션 (탭하면 구성 원그래프) */}
      {data?.accounts.map((acc) => (
        <AccountSection
          key={acc.broker}
          acc={acc}
          selected={selected === acc.broker}
          onSelect={() => setSelected((cur) => (cur === acc.broker ? null : acc.broker))}
        />
      ))}

      {/* 최근 주문 내역 (미국) */}
      <Text style={styles.section}>최근 주문 내역 (미국)</Text>
      {(orders.data?.broker ?? []).length === 0 && <Text style={styles.dim}>주문 내역이 없습니다</Text>}
      {(orders.data?.broker ?? []).map((o) => (
        <View key={o.id} style={styles.orderRow}>
          <Text style={{ color: o.side === 'buy' ? C.up : C.down, fontWeight: '700', width: 44 }}>
            {o.side === 'buy' ? '매수' : '매도'}
          </Text>
          <Text style={styles.orderText}>
            {o.symbol} {o.qty ?? '-'}주
            {o.filled_avg_price ? ` @ $${o.filled_avg_price.toFixed(2)}` : ''}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.dim}>{o.status}</Text>
        </View>
      ))}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function AccountSection({
  acc,
  selected,
  onSelect,
}: {
  acc: AccountInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  // 계좌 구성 원그래프: 종목별 평가액 상위 7 + 기타 + 현금(예수금)
  const compositionSlices = (): Slice[] => {
    const rows = acc.positions
      .filter((p) => (p.market_value ?? 0) > 0)
      .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0));
    const top = rows.slice(0, 7);
    const restValue = rows.slice(7).reduce((s, p) => s + (p.market_value ?? 0), 0);
    const slices: Slice[] = top.map((p, i) => ({
      label: p.name || p.symbol,
      value: p.market_value ?? 0,
      color: PIE_COLORS[i % PIE_COLORS.length],
    }));
    if (restValue > 0) slices.push({ label: '기타 종목', value: restValue, color: C.baseline });
    if ((acc.cash ?? 0) > 0) slices.push({ label: '현금(예수금)', value: acc.cash ?? 0, color: C.muted });
    return slices;
  };

  return (
    <View>
      <Pressable onPress={onSelect}>
        <Text style={styles.section}>
          {selected ? '▾ ' : '▸ '}
          {acc.label}
        </Text>
      </Pressable>
      {acc.error ? (
        <View style={styles.card}>
          <Text style={styles.dim}>조회 실패: {acc.error}</Text>
          <Text style={styles.dim}>백엔드 .env에 해당 증권사 키가 설정되어 있는지 확인하세요</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.accEquity}>{fmtMoney(acc.equity, acc.currency)}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.dim}>예수금 {fmtMoney(acc.cash, acc.currency)}</Text>
              {acc.buying_power != null && (
                <Text style={styles.dim}>매수가능 {fmtMoney(acc.buying_power, acc.currency)}</Text>
              )}
            </View>
          </View>
          {selected && (
            <View style={{ marginTop: 12 }}>
              <DonutChart slices={compositionSlices()} centerTitle="구성" centerValue={fmtMoney(acc.equity, acc.currency)} size={150} thickness={22} />
            </View>
          )}
          {acc.positions.length === 0 ? (
            <Text style={[styles.dim, { marginTop: 8 }]}>보유 종목 없음</Text>
          ) : (
            acc.positions.map((p) => {
              const plUp = (p.unrealized_pl ?? 0) >= 0;
              return (
                <View key={p.symbol} style={styles.posRow}>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={styles.posSymbol} numberOfLines={1}>
                      {p.name || p.symbol}
                    </Text>
                    <Text style={styles.dim}>
                      {p.qty}주 · 평단 {fmtMoney(p.avg_entry_price, acc.currency)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.posValue}>{fmtMoney(p.market_value, acc.currency)}</Text>
                    <Text style={{ color: plUp ? C.up : C.down, fontSize: 12, fontWeight: '600' }}>
                      {plUp ? '+' : ''}
                      {fmtMoney(p.unrealized_pl, acc.currency)} ({plUp ? '+' : ''}
                      {((p.unrealized_plpc ?? 0) * 100).toFixed(2)}%)
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.page },
  err: { color: C.critical, fontSize: 13, marginBottom: 10, lineHeight: 18 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
  },
  totalCard: { borderColor: C.accent, borderWidth: 1 },
  cardTitle: { color: C.textSecondary, fontSize: 13 },
  equity: { color: C.text, fontSize: 30, fontWeight: '800', marginVertical: 6, fontVariant: ['tabular-nums'] },
  accEquity: { color: C.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dim: { color: C.muted, fontSize: 12 },
  section: { color: C.text, fontSize: 14, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  posRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.grid,
  },
  posSymbol: { color: C.text, fontSize: 15, fontWeight: '700' },
  posValue: { color: C.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.grid,
  },
  orderText: { color: C.textSecondary, fontSize: 13 },
});
