import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { C } from '../lib/theme';

export type Slice = { label: string; value: number; color: string };

/** 검증된 다크 카테고리 팔레트 (인접 CVD 안전 순서) */
export const PIE_COLORS = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number) {
  const p1 = polar(cx, cy, rOut, a0);
  const p2 = polar(cx, cy, rOut, a1);
  const p3 = polar(cx, cy, rIn, a1);
  const p4 = polar(cx, cy, rIn, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ');
}

export function DonutChart({
  slices,
  size = 170,
  thickness = 26,
  centerTitle,
  centerValue,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  centerTitle?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const cx = size / 2;
  const rOut = size / 2 - 2;
  const rIn = rOut - thickness;
  let angle = 0;

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          {total <= 0 ? (
            <Circle cx={cx} cy={cx} r={rOut - thickness / 2} stroke={C.grid} strokeWidth={thickness} fill="none" />
          ) : (
            slices.map((s, i) => {
              const frac = Math.max(0, s.value) / total;
              if (frac <= 0) return null;
              // 단일 100% 슬라이스는 원으로 (arc 퇴화 방지)
              if (frac >= 0.999) {
                return (
                  <Circle key={i} cx={cx} cy={cx} r={rOut - thickness / 2} stroke={s.color} strokeWidth={thickness} fill="none" />
                );
              }
              const a0 = angle;
              const a1 = angle + frac * 360;
              angle = a1;
              // 2도 간격의 슬라이스 갭
              return <Path key={i} d={arcPath(cx, cx, rOut, rIn, a0 + 1, Math.max(a0 + 1.5, a1 - 1))} fill={s.color} />;
            })
          )}
        </Svg>
        <View style={styles.center} pointerEvents="none">
          {centerTitle && <Text style={styles.centerTitle}>{centerTitle}</Text>}
          {centerValue && <Text style={styles.centerValue}>{centerValue}</Text>}
        </View>
      </View>

      {/* 범례 + 직접 라벨 (색만으로 구분하지 않음) */}
      <View style={styles.legend}>
        {slices.map((s, i) => {
          const pct = total > 0 ? (Math.max(0, s.value) / total) * 100 : 0;
          return (
            <View key={i} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: s.color }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>
                {s.label}
              </Text>
              <Text style={styles.legendPct}>{pct.toFixed(1)}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  center: { position: 'absolute', alignItems: 'center' },
  centerTitle: { color: C.muted, fontSize: 11 },
  centerValue: { color: C.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  legend: { flex: 1, minWidth: 150, gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  legendLabel: { color: C.textSecondary, fontSize: 12, flex: 1 },
  legendPct: { color: C.text, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
