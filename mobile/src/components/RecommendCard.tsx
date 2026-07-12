import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtMoney, type Candidate } from '../lib/api';
import { C } from '../lib/theme';
import { SignalBadge } from './SignalBadge';

function GapText({ label, gap }: { label: string; gap: number | null }) {
  if (gap == null) return null;
  const up = gap >= 0;
  return (
    <Text style={styles.metaText}>
      {label}{' '}
      <Text style={{ color: up ? C.up : C.down }}>
        {up ? '+' : ''}
        {gap.toFixed(1)}%
      </Text>
      {'  '}
    </Text>
  );
}

export function RecommendCard({
  item,
  onPress,
  showRank,
}: {
  item: Candidate;
  onPress: () => void;
  showRank?: boolean;
}) {
  const upDay = item.change_pct >= 0;
  const currency = /^\d{6}$/.test(item.symbol) ? 'KRW' : 'USD';
  const volHot = (item.vol_ratio ?? 0) >= 2;
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={styles.row}>
        {showRank && <Text style={styles.rank}>{item.rank}</Text>}
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.symbol} numberOfLines={1}>
            {item.name ?? item.symbol}
          </Text>
          {item.name && <Text style={styles.code}>{item.symbol}</Text>}
        </View>
        <View style={styles.scoreChip}>
          <Text style={styles.scoreText}>점수 {item.score}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.price}>{fmtMoney(item.price, currency)}</Text>
          <Text style={{ color: upDay ? C.up : C.down, fontSize: 12 }}>
            {upDay ? '+' : ''}
            {item.change_pct.toFixed(2)}%
          </Text>
        </View>
      </View>

      {/* RSI · 이평선 괴리율 · 거래량 배수 */}
      <View style={styles.meta}>
        {item.rsi_14 != null && <Text style={styles.metaText}>RSI {item.rsi_14}{'   '}</Text>}
        <GapText label="5일선" gap={item.sma5_gap_pct} />
        <GapText label="20일선" gap={item.sma20_gap_pct} />
        <GapText label="60일선" gap={item.sma60_gap_pct} />
      </View>
      {item.vol_ratio != null && (
        <View style={styles.meta}>
          <Text style={[styles.volBadge, volHot && styles.volHot]}>
            거래량 {item.vol_ratio.toFixed(1)}x{volHot ? ' 🔥' : ''}
          </Text>
        </View>
      )}

      <View style={styles.badges}>
        {item.signals.map((sg, i) => (
          <SignalBadge key={`${sg.type}-${i}`} signal={sg} />
        ))}
        {item.signals.length === 0 && <Text style={styles.metaText}>최근 시그널 없음</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    padding: 14,
    marginHorizontal: 12,
    marginTop: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  rank: { color: C.muted, fontSize: 14, fontWeight: '700', width: 30, fontVariant: ['tabular-nums'] },
  volBadge: { color: C.muted, fontSize: 12, marginTop: 4 },
  volHot: { color: C.warning, fontWeight: '700' },
  symbol: { color: C.text, fontSize: 17, fontWeight: '700' },
  code: { color: C.muted, fontSize: 11, marginTop: 1 },
  scoreChip: {
    backgroundColor: C.page,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  scoreText: { color: C.textSecondary, fontSize: 12 },
  price: { color: C.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  metaText: { color: C.muted, fontSize: 12, marginTop: 6 },
  badges: { flexDirection: 'row', flexWrap: 'wrap' },
});
