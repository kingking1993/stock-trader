import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import type { ChartData } from '../lib/api';
import { C } from '../lib/theme';

const PAD_RIGHT = 52;
const PAD_TOP = 8;
const PAD_BOTTOM = 4;
const H_VOL = 56;
const H_RSI = 80;

type Props = {
  data: ChartData;
  width: number;
  height?: number;
  initialBars?: number;
  showControls?: boolean;
  compact?: boolean; // 인라인 미니 차트 (RSI 패널 생략)
};

function linePath(xs: number[], ys: (number | null)[]): string {
  let d = '';
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y == null || Number.isNaN(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)},${y.toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}

/** sma5가 sma20을 교차하는 지점 인덱스 (골든=1 / 데드=-1) */
function findCrosses(sma5: (number | null)[], sma20: (number | null)[]): { i: number; dir: 1 | -1 }[] {
  const out: { i: number; dir: 1 | -1 }[] = [];
  for (let i = 1; i < sma5.length; i++) {
    const a0 = sma5[i - 1], b0 = sma20[i - 1], a1 = sma5[i], b1 = sma20[i];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (a0 <= b0 && a1 > b1) out.push({ i, dir: 1 });
    else if (a0 >= b0 && a1 < b1) out.push({ i, dir: -1 });
  }
  return out;
}

export function CandleChart({ data, width, height = 260, initialBars = 60, showControls = true, compact = false }: Props) {
  const total = data.close.length;
  const [visible, setVisible] = useState(Math.min(initialBars, total));
  const [offset, setOffset] = useState(0); // 끝에서 몇 봉 앞으로 이동했는지
  const [sel, setSel] = useState<number | null>(null);

  const isMinute = data.timeframe === '1M';

  const view = useMemo(() => {
    const vis = Math.max(10, Math.min(visible, total));
    const off = Math.max(0, Math.min(offset, total - vis));
    const end = total - off;
    const start = Math.max(0, end - vis);
    const slice = <T,>(a: T[]) => a.slice(start, end);
    return {
      n: end - start,
      start,
      ts: slice(data.timestamps),
      open: slice(data.open),
      high: slice(data.high),
      low: slice(data.low),
      close: slice(data.close),
      volume: slice(data.volume),
      sma5: slice(data.sma_5),
      sma20: slice(data.sma_20),
      sma60: slice(data.sma_60),
      rsi: slice(data.rsi_14),
      crosses: findCrosses(data.sma_5, data.sma_20)
        .filter((c) => c.i >= start && c.i < end)
        .map((c) => ({ i: c.i - start, dir: c.dir })),
    };
  }, [data, visible, offset, total]);

  const plotW = width - PAD_RIGHT;
  const xStep = plotW / view.n;
  const candleW = Math.max(1.5, xStep * 0.65);
  const xs = useMemo(() => Array.from({ length: view.n }, (_, i) => i * xStep + xStep / 2), [view.n, xStep]);

  const { yOf, ticks } = useMemo(() => {
    const vals: number[] = [...view.low, ...view.high];
    for (const arr of [view.sma5, view.sma20, view.sma60]) for (const v of arr) if (v != null) vals.push(v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const lo = min - span * 0.05;
    const hi = max + span * 0.07;
    const plotH = height - PAD_TOP - PAD_BOTTOM;
    const yOf = (v: number) => PAD_TOP + ((hi - v) / (hi - lo)) * plotH;
    const ticks = Array.from({ length: 4 }, (_, i) => lo + ((i + 0.5) / 4) * (hi - lo));
    return { yOf, ticks };
  }, [view, height]);

  const maxVol = useMemo(() => Math.max(1, ...view.volume), [view]);
  const rsiY = (v: number) => 8 + ((100 - v) / 100) * (H_RSI - 16);
  const hasRsi = !compact && view.rsi.some((v) => v != null);

  const onTouch = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    if (x < 0 || x > plotW) return;
    setSel(Math.min(view.n - 1, Math.max(0, Math.floor(x / xStep))));
  };

  const i = sel;
  const tsLabel = (t: string) => (isMinute ? t.slice(11, 16) : t.slice(0, 10));
  const info =
    i != null
      ? `${tsLabel(view.ts[i])}  시 ${view.open[i]}  고 ${view.high[i]}  저 ${view.low[i]}  종 ${view.close[i]}`
      : null;
  const lastClose = view.close[view.n - 1];
  const lastUp = view.n > 1 ? lastClose >= view.close[view.n - 2] : true;

  const zoom = (dir: 1 | -1) => setVisible((v) => Math.max(15, Math.min(total, Math.round(v * (dir === 1 ? 0.6 : 1.6)))));
  const pan = (dir: 1 | -1) => setOffset((o) => Math.max(0, Math.min(total - 10, o + dir * Math.round(visible / 3))));

  return (
    <View>
      {/* 범례 + 컨트롤 */}
      <View style={styles.legend}>
        <LegendDot color={C.sma5} label="SMA5" />
        <LegendDot color={C.sma20} label="SMA20" />
        <LegendDot color={C.sma60} label="SMA60" />
        <Text style={styles.legendText}>▲골든 ▼데드</Text>
        <View style={{ flex: 1 }} />
        {showControls && (
          <View style={styles.controls}>
            <Ctl label="−" onPress={() => zoom(-1)} />
            <Ctl label="+" onPress={() => zoom(1)} />
            <Ctl label="‹" onPress={() => pan(1)} />
            <Ctl label="›" onPress={() => pan(-1)} disabled={offset === 0} />
          </View>
        )}
      </View>
      <Text style={styles.info}>{info ?? `${view.n}봉 표시 중 · 터치하면 상세 값`}</Text>

      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onTouch}
        onResponderMove={onTouch}
        onResponderRelease={() => setSel(null)}>
        <Svg width={width} height={height}>
          {ticks.map((t, k) => (
            <React.Fragment key={k}>
              <Line x1={0} x2={plotW} y1={yOf(t)} y2={yOf(t)} stroke={C.grid} strokeWidth={1} />
              <SvgText x={plotW + 6} y={yOf(t) + 4} fill={C.muted} fontSize={10}>
                {t >= 1000 ? Math.round(t).toLocaleString() : t >= 100 ? t.toFixed(0) : t.toFixed(1)}
              </SvgText>
            </React.Fragment>
          ))}
          {xs.map((x, k) => {
            const up = view.close[k] >= view.open[k];
            const color = up ? C.up : C.down;
            const top = yOf(Math.max(view.open[k], view.close[k]));
            const bottom = yOf(Math.min(view.open[k], view.close[k]));
            return (
              <React.Fragment key={k}>
                <Line x1={x} x2={x} y1={yOf(view.high[k])} y2={yOf(view.low[k])} stroke={color} strokeWidth={1} />
                <Rect x={x - candleW / 2} y={top} width={candleW} height={Math.max(1, bottom - top)} fill={color} />
              </React.Fragment>
            );
          })}
          {([[view.sma5, C.sma5], [view.sma20, C.sma20], [view.sma60, C.sma60]] as const).map(([series, color], k) => (
            <Path key={k} d={linePath(xs, series.map((v) => (v == null ? null : yOf(v))))} stroke={color} strokeWidth={1.5} fill="none" />
          ))}
          {/* 골든/데드크로스 마커 */}
          {view.crosses.map((c, k) => {
            const x = xs[c.i];
            const golden = c.dir === 1;
            const yBase = golden ? yOf(view.low[c.i]) + 12 : yOf(view.high[c.i]) - 12;
            const pts = golden
              ? `${x - 5},${yBase + 5} ${x + 5},${yBase + 5} ${x},${yBase - 4}`
              : `${x - 5},${yBase - 5} ${x + 5},${yBase - 5} ${x},${yBase + 4}`;
            return <Polygon key={k} points={pts} fill={golden ? C.up : C.down} />;
          })}
          <SvgText x={plotW + 6} y={yOf(lastClose) + 4} fill={lastUp ? C.up : C.down} fontSize={10} fontWeight="bold">
            {lastClose >= 1000 ? Math.round(lastClose).toLocaleString() : lastClose.toFixed(2)}
          </SvgText>
          {i != null && (
            <Line x1={xs[i]} x2={xs[i]} y1={PAD_TOP} y2={height - PAD_BOTTOM} stroke={C.textSecondary} strokeWidth={1} strokeDasharray="3,3" />
          )}
        </Svg>

        {/* 거래량 패널 */}
        <Svg width={width} height={H_VOL}>
          {xs.map((x, k) => {
            const up = view.close[k] >= view.open[k];
            const h = (view.volume[k] / maxVol) * (H_VOL - 8);
            return (
              <Rect key={k} x={x - candleW / 2} y={H_VOL - h} width={candleW} height={Math.max(1, h)} fill={up ? C.up : C.down} opacity={0.55} />
            );
          })}
          <SvgText x={plotW + 6} y={12} fill={C.muted} fontSize={9}>
            거래량
          </SvgText>
          {i != null && <Line x1={xs[i]} x2={xs[i]} y1={0} y2={H_VOL} stroke={C.textSecondary} strokeWidth={1} strokeDasharray="3,3" />}
        </Svg>

        {/* RSI 패널 */}
        {hasRsi && (
          <>
            <Text style={styles.panelTitle}>RSI (14)</Text>
            <Svg width={width} height={H_RSI}>
              {[70, 30].map((g) => (
                <React.Fragment key={g}>
                  <Line x1={0} x2={plotW} y1={rsiY(g)} y2={rsiY(g)} stroke={C.grid} strokeWidth={1} strokeDasharray="4,4" />
                  <SvgText x={plotW + 6} y={rsiY(g) + 4} fill={C.muted} fontSize={10}>
                    {g}
                  </SvgText>
                </React.Fragment>
              ))}
              <Path d={linePath(xs, view.rsi.map((v) => (v == null ? null : rsiY(v))))} stroke={C.accent} strokeWidth={1.5} fill="none" />
              {i != null && <Line x1={xs[i]} x2={xs[i]} y1={4} y2={H_RSI - 4} stroke={C.textSecondary} strokeWidth={1} strokeDasharray="3,3" />}
            </Svg>
          </>
        )}
      </View>
    </View>
  );
}

function Ctl({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.ctl, disabled && { opacity: 0.3 }]} onPress={onPress} disabled={disabled}>
      <Text style={styles.ctlText}>{label}</Text>
    </Pressable>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, marginBottom: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  legendText: { color: C.textSecondary, fontSize: 11, marginRight: 8 },
  controls: { flexDirection: 'row', gap: 4 },
  ctl: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    width: 30,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
  },
  ctlText: { color: C.text, fontSize: 14, fontWeight: '700', lineHeight: 16 },
  info: { color: C.muted, fontSize: 11, marginBottom: 6, fontVariant: ['tabular-nums'] },
  panelTitle: { color: C.textSecondary, fontSize: 11, marginTop: 8, marginBottom: 2 },
});
