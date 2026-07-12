import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
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
import { RecommendCard } from '../../components/RecommendCard';
import { defaultTableWidth, RowHeader, StockRow } from '../../components/StockRow';
import { getMovers, getRecommend, getScreen, type Candidate, type Market, type SortKey } from '../../lib/api';
import { useSettings } from '../../lib/settings';
import { C } from '../../lib/theme';

// 사용자 필터 칩 (복수 선택 = AND 조건)
const FILTER_CHIPS = [
  { key: 'oversold', label: 'RSI 과매도', rsi_max: 30 },
  { key: 'golden', label: '골든크로스', signal: 'golden_cross' },
  { key: 'macd', label: 'MACD 상향', signal: 'macd_bull_cross' },
  { key: 'uptrend', label: '정배열 추세', signal: 'uptrend' },
  { key: 'calm', label: '과매수 아님', rsi_max: 70 },
  { key: 'vol2', label: '거래대금 2배↑', value_ratio_min: 2.0 },
] as const;

type ChipKey = (typeof FILTER_CHIPS)[number]['key'];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score', label: '시그널순' },
  { key: 'change', label: '단타' },
  { key: 'vol_ratio', label: '거래량순' },
  { key: 'rank', label: '시총순' },
];

export default function RecommendScreen() {
  const { settings, loaded } = useSettings();
  const router = useRouter();
  const [market, setMarket] = useState<Market>('US');
  const [analyze, setAnalyze] = useState(false);
  const [sort, setSort] = useState<SortKey>('score');
  const [chips, setChips] = useState<Set<ChipKey>>(new Set());
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [excludeSmall, setExcludeSmall] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null); // 인라인 차트 펼친 종목
  const rowMode = sort === 'change' ? ('daytrade' as const) : ('default' as const);

  const screenParams = useMemo(() => {
    // 칩이 없고 시그널순이면 기존 추천(점수순 + AI 코멘트 옵션) 사용
    if (chips.size === 0 && sort === 'score') return null;
    let rsi_max: number | undefined;
    let value_ratio_min: number | undefined;
    const signals: string[] = [];
    for (const chip of FILTER_CHIPS) {
      if (!chips.has(chip.key)) continue;
      if ('rsi_max' in chip && chip.rsi_max != null)
        rsi_max = rsi_max == null ? chip.rsi_max : Math.min(rsi_max, chip.rsi_max);
      if ('signal' in chip && chip.signal) signals.push(chip.signal);
      if ('value_ratio_min' in chip && chip.value_ratio_min != null) value_ratio_min = chip.value_ratio_min;
    }
    // 시총순은 상위 100 전체 나열, 그 외 정렬은 상위 30
    return { market, rsi_max, value_ratio_min, signals, sort, top: sort === 'rank' ? 100 : 30 };
  }, [chips, market, sort]);

  const query = useQuery({
    queryKey: ['recommend', settings.baseUrl, market, analyze, sort, screenParams, excludeSmall],
    refetchInterval: sort === 'change' ? 60_000 : false,
    queryFn: async () => {
      // 단타 = 시총 유니버스가 아닌 '시장 전체' 급등 순위 (분봉·거래대금 포함)
      if (sort === 'change') {
        const r = await getMovers(settings, market, {
          valueRatioMin: chips.has('vol2') ? 2.0 : undefined,
          excludeSmall,
          top: 20,
        });
        return { candidates: r.results, ai_summary: null as string | null };
      }
      if (screenParams) {
        const r = await getScreen(settings, screenParams);
        return { candidates: r.results, ai_summary: null as string | null };
      }
      const r = await getRecommend(settings, market, 10, analyze);
      return { candidates: r.candidates, ai_summary: r.ai_summary };
    },
    enabled: loaded,
  });

  const toggleChip = (key: ChipKey) => {
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const header = (
    <View>
      {/* 시장 토글 */}
      <View style={styles.marketRow}>
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
        <Pressable
          style={styles.aiBtn}
          onPress={() => setViewMode((v) => (v === 'list' ? 'card' : 'list'))}>
          <Text style={styles.aiBtnText}>{viewMode === 'list' ? '카드 보기' : '목록 보기'}</Text>
        </Pressable>
        {chips.size === 0 && sort === 'score' && (
          <Pressable
            style={[styles.aiBtn, analyze && { backgroundColor: C.accent, borderColor: C.accent }]}
            onPress={() => setAnalyze((v) => !v)}>
            <Text style={[styles.aiBtnText, analyze && { color: '#fff' }]}>AI 분석 {analyze ? 'ON' : 'OFF'}</Text>
          </Pressable>
        )}
      </View>

      {/* 정렬 세그먼트 */}
      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable
            key={s.key}
            style={[styles.sortBtn, sort === s.key && styles.sortBtnActive]}
            onPress={() => setSort(s.key)}>
            <Text style={[styles.sortText, sort === s.key && { color: '#fff', fontWeight: '700' }]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 필터 칩 (단타는 시장 전체 순위라 거래대금 관련 필터만 적용 가능) */}
      <View style={styles.chipRow}>
        {sort === 'change' && (
          <Pressable
            style={[styles.chip, excludeSmall && styles.chipOn]}
            onPress={() => setExcludeSmall((v) => !v)}>
            <Text style={[styles.chipText, excludeSmall && { color: '#fff' }]}>
              {excludeSmall ? '✓ ' : ''}소형주 제외
            </Text>
          </Pressable>
        )}
        {FILTER_CHIPS.filter((chip) => sort !== 'change' || chip.key === 'vol2').map((chip) => {
          const on = chips.has(chip.key);
          return (
            <Pressable
              key={chip.key}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => toggleChip(chip.key)}>
              <Text style={[styles.chipText, on && { color: '#fff' }]}>
                {on ? '✓ ' : ''}
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
        {chips.size > 0 && (
          <Pressable style={styles.chipClear} onPress={() => setChips(new Set())}>
            <Text style={{ color: C.muted, fontSize: 12 }}>초기화</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.headerText}>
        {sort === 'rank'
          ? '시가총액 상위 100 (10분 단위 갱신)'
          : sort === 'change'
            ? '단타 — 시장 전체 급등주 (60초 갱신 · 1/5/10분 등락은 장중에만)'
            : sort === 'vol_ratio'
              ? '거래량 급증 순위 (20일 평균 대비)'
              : chips.size > 0
                ? '필터 조건 충족 종목'
                : '기술 지표 시그널 상위 종목'}
      </Text>

      {query.data?.ai_summary && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>AI 종합 코멘트</Text>
          <Text style={styles.summaryText}>{query.data.ai_summary}</Text>
        </View>
      )}
    </View>
  );

  if (query.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>불러오기 실패: {String((query.error as Error).message)}</Text>
        <Text style={styles.dim}>우측 상단 ⚙에서 서버 주소/키를 확인하세요</Text>
        <Pressable style={styles.retry} onPress={() => query.refetch()}>
          <Text style={{ color: C.text }}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} size="large" />
        <Text style={styles.dim}>
          {analyze ? 'AI가 시장을 분석 중입니다…' : market === 'KR' ? '국내 종목 스캔 중… (첫 스캔은 30초 정도)' : '지표 스캔 중…'}
        </Text>
      </View>
    );
  }

  const candidates = data.candidates as Candidate[];
  const showRank = sort === 'rank' || sort === 'change';
  const goChart = (symbol: string) => router.push({ pathname: '/chart', params: { symbol } });
  // 행 탭 = 인라인 차트 펼침/접힘
  const toggleExpand = (symbol: string) => setExpanded((cur) => (cur === symbol ? null : symbol));

  const inlineWidth = rowMode === 'default' ? defaultTableWidth(showRank) : undefined;
  const rows = candidates.map((item) => (
    <React.Fragment key={item.symbol}>
      <StockRow item={item} mode={rowMode} showRank={showRank} onPress={() => toggleExpand(item.symbol)} />
      {expanded === item.symbol && <InlineChart symbol={item.symbol} width={inlineWidth} />}
    </React.Fragment>
  ));

  return (
    <ScrollView
      style={{ backgroundColor: C.page }}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={C.muted} />
      }>
      {header}

      {candidates.length === 0 && (
        <Text style={[styles.dim, { textAlign: 'center', marginTop: 40 }]}>
          조건에 맞는 종목이 없습니다. 필터를 완화해 보세요.
        </Text>
      )}

      {viewMode === 'card' ? (
        candidates.map((item) => (
          <RecommendCard key={item.symbol} item={item} showRank={showRank} onPress={() => goChart(item.symbol)} />
        ))
      ) : rowMode === 'daytrade' ? (
        <View style={{ paddingHorizontal: 12, marginTop: 8 }}>
          <RowHeader showRank={showRank} mode="daytrade" />
          {rows}
        </View>
      ) : (
        // 일반 테이블: 컬럼이 많아 가로 스크롤 (세로 스크롤은 바깥에서)
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginTop: 8 }} contentContainerStyle={{ paddingHorizontal: 12 }}>
          <View style={{ width: defaultTableWidth(showRank) }}>
            <RowHeader showRank={showRank} mode="default" />
            {rows}
          </View>
        </ScrollView>
      )}

      <Text style={styles.disclaimer}>
        지표는 참고 자료이며 수익을 보장하지 않습니다. 투자 판단의 책임은 본인에게 있습니다.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.page, padding: 24 },
  dim: { color: C.muted, marginTop: 10, fontSize: 13, textAlign: 'center' },
  retry: {
    marginTop: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  marketRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, gap: 8 },
  marketBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: C.surface,
  },
  marketBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  marketText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  sortRow: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, gap: 6 },
  sortBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: C.surface,
  },
  sortBtnActive: { backgroundColor: C.sma60, borderColor: C.sma60 },
  sortText: { color: C.textSecondary, fontSize: 12 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: C.surface,
  },
  chipOn: { backgroundColor: C.sma20, borderColor: C.sma20 },
  chipText: { color: C.textSecondary, fontSize: 12 },
  chipClear: { paddingHorizontal: 8, paddingVertical: 5 },
  aiBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  aiBtnText: { color: C.textSecondary, fontSize: 12 },
  headerText: { color: C.textSecondary, fontSize: 13, paddingHorizontal: 12, paddingTop: 12 },
  summaryCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    marginHorizontal: 12,
    marginTop: 10,
    padding: 14,
  },
  summaryTitle: { color: C.text, fontWeight: '700', fontSize: 13, marginBottom: 6 },
  summaryText: { color: C.textSecondary, fontSize: 13, lineHeight: 19 },
  disclaimer: { color: C.muted, fontSize: 11, textAlign: 'center', padding: 16, lineHeight: 16 },
});
