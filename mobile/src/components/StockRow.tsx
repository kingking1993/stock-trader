import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtMoney, fmtValueCompact, type Candidate } from '../lib/api';
import { C } from '../lib/theme';

export type RowMode = 'default' | 'daytrade';

/** 숫자 컬럼 고정폭 — RowHeader와 반드시 일치시킬 것 */
export const COLS = { price: 74, change: 56, rsi: 38, gap: 52, vol: 44, min: 46, value: 54, name: 112, rank: 28 } as const;

/** default 모드 테이블 전체 폭 (가로 스크롤 컨테이너용) */
export const defaultTableWidth = (showRank?: boolean) =>
  2 + (showRank ? COLS.rank : 0) + COLS.name + COLS.price + COLS.change + COLS.rsi + COLS.gap * 4 + COLS.value + COLS.vol + 20;

/** daytrade(단타) 모드 테이블 전체 폭 */
export const daytradeTableWidth = (showRank?: boolean) =>
  2 + (showRank ? COLS.rank : 0) + COLS.name + COLS.price + COLS.change + COLS.min * 3 + COLS.value + COLS.vol + 20;

const curOf = (symbol: string): 'USD' | 'KRW' => (/^\d{6}$/.test(symbol) ? 'KRW' : 'USD');

function num(v: number | null | undefined, suffix = '', signed = false): string {
  if (v == null) return '-';
  const s = signed && v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}${suffix}`;
}

function PctCell({ v, width }: { v: number | null | undefined; width: number }) {
  return (
    <Text style={[styles.num, { width, color: v == null ? C.muted : v >= 0 ? C.up : C.down }]}>
      {num(v, '%', true)}
    </Text>
  );
}

/** 컴팩트 1줄 종목 행. 왼쪽 색 막대 = 시그널 점수 방향 (빨강 매수신호 / 파랑 매도신호 / 회색 중립) */
export function StockRow({
  item,
  onPress,
  showRank,
  mode = 'default',
}: {
  item: Candidate;
  onPress: () => void;
  showRank?: boolean;
  mode?: RowMode;
}) {
  const scoreColor = item.score > 0 ? C.up : item.score < 0 ? C.down : C.baseline;
  const chg = item.change_pct;
  const currency = /^\d{6}$/.test(item.symbol) ? 'KRW' : 'USD';
  const valueHot = (item.value_ratio ?? 0) >= 2;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.surface }]}
      onPress={onPress}>
      <View style={[styles.scoreBar, { backgroundColor: scoreColor }]} />
      {showRank && <Text style={styles.rank}>{item.rank}</Text>}
      <View style={{ width: COLS.name, paddingRight: 4 }}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name ?? item.symbol}
        </Text>
      </View>
      <Text style={[styles.num, { width: COLS.price, color: C.text }]} numberOfLines={1}>
        {fmtMoney(item.price, currency)}
      </Text>
      <Text style={[styles.num, { width: COLS.change, color: chg >= 0 ? C.up : C.down }]}>
        {num(chg, '%', true)}
      </Text>
      {mode === 'daytrade' ? (
        <>
          <PctCell v={item.chg_1m} width={COLS.min} />
          <PctCell v={item.chg_5m} width={COLS.min} />
          <PctCell v={item.chg_10m} width={COLS.min} />
          <Text style={[styles.num, { width: COLS.value, color: C.textSecondary }]}>
            {fmtValueCompact(item.value_today, currency)}
          </Text>
          <Text
            style={[styles.num, { width: COLS.vol, color: valueHot ? C.warning : C.muted }, valueHot && { fontWeight: '700' }]}>
            {item.value_ratio != null ? `${item.value_ratio.toFixed(1)}x` : '-'}
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.num, { width: COLS.rsi, color: C.textSecondary }]}>
            {item.rsi_14 != null ? item.rsi_14.toFixed(0) : '-'}
          </Text>
          <PctCell v={item.sma5_gap_pct} width={COLS.gap} />
          <PctCell v={item.sma20_gap_pct} width={COLS.gap} />
          <PctCell v={item.sma60_gap_pct} width={COLS.gap} />
          <PctCell v={item.sma120_gap_pct} width={COLS.gap} />
          <Text style={[styles.num, { width: COLS.value, color: C.textSecondary }]}>
            {fmtValueCompact(item.value_today, currency)}
          </Text>
          <Text
            style={[styles.num, { width: COLS.vol, color: valueHot ? C.warning : C.muted }, valueHot && { fontWeight: '700' }]}>
            {item.value_ratio != null ? `${item.value_ratio.toFixed(1)}x` : '-'}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** 컬럼 제목 줄 — StockRow와 동일한 고정폭 사용 */
export function RowHeader({ showRank, mode = 'default' }: { showRank?: boolean; mode?: RowMode }) {
  return (
    <View style={styles.header}>
      <View style={{ width: 2 }} />
      {showRank && <Text style={[styles.headText, { width: COLS.rank }]}>#</Text>}
      <Text style={[styles.headText, { width: COLS.name }]}>종목</Text>
      <Text style={[styles.headText, { width: COLS.price, textAlign: 'right' }]}>현재가</Text>
      <Text style={[styles.headText, { width: COLS.change, textAlign: 'right' }]}>등락</Text>
      {mode === 'daytrade' ? (
        <>
          <Text style={[styles.headText, { width: COLS.min, textAlign: 'right' }]}>1분</Text>
          <Text style={[styles.headText, { width: COLS.min, textAlign: 'right' }]}>5분</Text>
          <Text style={[styles.headText, { width: COLS.min, textAlign: 'right' }]}>10분</Text>
          <Text style={[styles.headText, { width: COLS.value, textAlign: 'right' }]}>대금</Text>
          <Text style={[styles.headText, { width: COLS.vol, textAlign: 'right' }]}>배수</Text>
        </>
      ) : (
        <>
          <Text style={[styles.headText, { width: COLS.rsi, textAlign: 'right' }]}>RSI</Text>
          <Text style={[styles.headText, { width: COLS.gap, textAlign: 'right' }]}>5일</Text>
          <Text style={[styles.headText, { width: COLS.gap, textAlign: 'right' }]}>20일</Text>
          <Text style={[styles.headText, { width: COLS.gap, textAlign: 'right' }]}>60일</Text>
          <Text style={[styles.headText, { width: COLS.gap, textAlign: 'right' }]}>120일</Text>
          <Text style={[styles.headText, { width: COLS.value, textAlign: 'right' }]}>대금</Text>
          <Text style={[styles.headText, { width: COLS.vol, textAlign: 'right' }]}>배수</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.grid,
  },
  scoreBar: { width: 2, alignSelf: 'stretch', borderRadius: 1, marginRight: 6 },
  rank: { color: C.muted, fontSize: 11, width: COLS.rank, fontVariant: ['tabular-nums'] },
  nameFlex: { flex: 1, minWidth: 0, paddingRight: 4 },
  name: { color: C.text, fontSize: 13, fontWeight: '600' },
  num: { fontSize: 12, textAlign: 'right', fontVariant: ['tabular-nums'] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.baseline,
  },
  headText: { color: C.muted, fontSize: 11 },
});
