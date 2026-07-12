import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
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
import { InlineChart } from '../../components/InlineChart';
import { defaultTableWidth, RowHeader, StockRow } from '../../components/StockRow';
import { getSectors, type Market, type SectorPerf } from '../../lib/api';
import { useSettings } from '../../lib/settings';
import { C } from '../../lib/theme';

type MemberSort = 'rank' | 'change' | 'vol_ratio';

const MEMBER_SORTS: { key: MemberSort; label: string }[] = [
  { key: 'change', label: '상승률순' },
  { key: 'rank', label: '시총순' },
  { key: 'vol_ratio', label: '거래량순' },
];

export default function SectorsScreen() {
  const { settings, loaded } = useSettings();
  const router = useRouter();
  const [market, setMarket] = useState<Market>('KR');
  const [memberSort, setMemberSort] = useState<MemberSort>('change');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null); // 인라인 차트

  const query = useQuery({
    queryKey: ['sectors', settings.baseUrl, market, memberSort],
    queryFn: () => getSectors(settings, market, memberSort),
    enabled: loaded,
  });

  const toggle = (sector: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  };

  return (
    <ScrollView
      style={{ backgroundColor: C.page }}
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={C.muted} />
      }>
      {/* 시장 토글 + 종목 정렬 */}
      <View style={styles.controls}>
        {(['KR', 'US'] as Market[]).map((m) => (
          <Pressable
            key={m}
            style={[styles.marketBtn, market === m && styles.marketBtnActive]}
            onPress={() => setMarket(m)}>
            <Text style={[styles.marketText, market === m && { color: '#fff' }]}>
              {m === 'KR' ? '🇰🇷 국내' : '🇺🇸 미국'}
            </Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        {MEMBER_SORTS.map((s) => (
          <Pressable
            key={s.key}
            style={[styles.sortBtn, memberSort === s.key && styles.sortBtnActive]}
            onPress={() => setMemberSort(s.key)}>
            <Text style={[styles.sortText, memberSort === s.key && { color: '#fff', fontWeight: '700' }]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {query.isError && (
        <Text style={styles.err}>불러오기 실패: {String((query.error as Error).message)}</Text>
      )}
      {!query.data && !query.isError && (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} size="large" />
          <Text style={styles.dim}>
            {market === 'KR' ? '국내 100종목 섹터 집계 중… (첫 스캔은 30초 정도)' : '섹터 집계 중…'}
          </Text>
        </View>
      )}

      {query.data?.sectors.map((s: SectorPerf) => {
        const opened = open.has(s.sector);
        const up = s.avg_change_pct >= 0;
        return (
          <View key={s.sector}>
            <Pressable style={styles.sectorRow} onPress={() => toggle(s.sector)}>
              <Text style={styles.chevron}>{opened ? '▾' : '▸'}</Text>
              <Text style={styles.sectorName} numberOfLines={1}>
                {s.sector}
              </Text>
              <Text style={styles.updown}>
                <Text style={{ color: C.up }}>▲{s.up_count}</Text>{' '}
                <Text style={{ color: C.down }}>▼{s.down_count}</Text>
              </Text>
              <Text style={[styles.avg, { color: up ? C.up : C.down }]}>
                {up ? '+' : ''}
                {s.avg_change_pct.toFixed(2)}%
              </Text>
            </Pressable>
            {opened && (
              <ScrollView horizontal showsHorizontalScrollIndicator style={styles.members}>
                <View style={{ width: defaultTableWidth(false) }}>
                  <RowHeader />
                  {s.members.map((m) => (
                    <React.Fragment key={m.symbol}>
                      <StockRow
                        item={m}
                        onPress={() => setExpanded((cur) => (cur === m.symbol ? null : m.symbol))}
                      />
                      {expanded === m.symbol && (
                        <InlineChart symbol={m.symbol} width={defaultTableWidth(false)} />
                      )}
                    </React.Fragment>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        );
      })}

      {query.data && (
        <Text style={styles.note}>
          섹터 등락률은 소속 종목 단순평균입니다 (시가총액 가중 아님) · 10분 단위 갱신
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 6,
    flexWrap: 'wrap',
  },
  marketBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: C.surface,
  },
  marketBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  marketText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  sortBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: C.surface,
  },
  sortBtnActive: { backgroundColor: C.sma60, borderColor: C.sma60 },
  sortText: { color: C.textSecondary, fontSize: 11 },
  center: { alignItems: 'center', paddingVertical: 60 },
  dim: { color: C.muted, marginTop: 10, fontSize: 13, textAlign: 'center' },
  err: { color: C.critical, fontSize: 13, padding: 16, textAlign: 'center' },
  sectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.grid,
    backgroundColor: C.page,
  },
  chevron: { color: C.muted, fontSize: 12, width: 18 },
  sectorName: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  updown: { fontSize: 11, marginLeft: 8, flex: 1 },
  avg: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  members: { paddingLeft: 12, backgroundColor: 'rgba(255,255,255,0.02)' },
  note: { color: C.muted, fontSize: 11, textAlign: 'center', padding: 14, lineHeight: 16 },
});
