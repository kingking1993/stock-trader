import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
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
  deleteBroker,
  deleteManualAccount,
  getBrokers,
  setBroker,
  setTossAllowOrders,
  testBroker,
  upsertManualAccount,
  type BrokerStatus,
  type ManualAccount,
} from '../lib/api';
import { useSettings } from '../lib/settings';
import { C } from '../lib/theme';

const notify = (title: string, msg: string) => {
  if (Platform.OS === 'web') window.alert(`${title}\n${msg}`);
  else Alert.alert(title, msg);
};

const GUIDE: Record<string, string> = {
  alpaca: 'alpaca.markets 가입 → Paper Trading 대시보드 → API Keys 발급',
  kis: 'apiportal.koreainvestment.com → API 신청 (실전 계좌 선택)',
  kis_vts: '같은 포털에서 모의투자 신청 후 모의계좌로 API 신청',
  toss: '토스증권 앱 → 더보기 → Open API → 신청 (⚠ 실계좌입니다)',
};

export default function BrokersScreen() {
  const { settings } = useSettings();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['brokers', settings.baseUrl], queryFn: () => getBrokers(settings) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['brokers'] });
    qc.invalidateQueries({ queryKey: ['portfolio'] });
  };

  return (
    <ScrollView style={{ backgroundColor: C.page }} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
      <Text style={styles.note}>
        키는 이 앱을 실행 중인 내 PC의 백엔드에만 저장됩니다. 저장 시 자동으로 연결 테스트를 합니다.
      </Text>

      {query.isLoading && <ActivityIndicator color={C.accent} style={{ marginTop: 30 }} />}
      {query.isError && <Text style={styles.err}>불러오기 실패: {String((query.error as Error).message)}</Text>}

      {query.data?.brokers.map((b) => (
        <BrokerCard key={b.broker} broker={b} onChanged={refresh} />
      ))}

      <Text style={styles.sectionTitle}>수동 자산 계좌 (NH·KB 등 API 없는 증권사)</Text>
      <Text style={styles.note}>
        보유 종목·수량·평단·현금만 입력하면 시세는 자동 조회되어 합산 자산과 원그래프에 포함됩니다. (조회 전용 — 주문 불가)
      </Text>
      {query.data?.manual.map((m) => (
        <ManualCard key={m.id} account={m} onChanged={refresh} />
      ))}
      <ManualCard account={null} onChanged={refresh} />
    </ScrollView>
  );
}

function BrokerCard({ broker, onChanged }: { broker: BrokerStatus; onChanged: () => void }) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await setBroker(settings, broker.broker, values);
      notify(r.test.ok ? '연결 성공' : '저장됨 (연결 실패)', r.test.detail);
      setValues({});
      setOpen(false);
      onChanged();
    } catch (e: any) {
      notify('저장 실패', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await testBroker(settings, broker.broker);
      notify(r.ok ? '연결 성공' : '연결 실패', r.detail);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteBroker(settings, broker.broker);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.cardTitle}>{broker.label}</Text>
          <Text style={[styles.status, { color: broker.configured ? C.good : C.muted }]}>
            {broker.configured ? '● 연동됨' : '○ 미연동'}
          </Text>
        </View>
        <Pressable style={styles.smallBtn} onPress={() => setOpen((v) => !v)}>
          <Text style={styles.smallBtnText}>{open ? '닫기' : broker.configured ? '수정' : '연동하기'}</Text>
        </Pressable>
      </View>

      {broker.configured && !open && (
        <View style={{ marginTop: 6 }}>
          {broker.fields.map((f) => (
            <Text key={f.env} style={styles.masked}>
              {f.label}: {f.masked || '-'}
            </Text>
          ))}
          {broker.broker === 'toss' && (
            <Pressable
              style={[styles.allowRow, broker.allow_orders && { borderColor: C.critical }]}
              onPress={async () => {
                const next = !broker.allow_orders;
                if (next) {
                  const ok =
                    Platform.OS === 'web'
                      ? window.confirm('⚠ 실전 주문을 허용하면 주문 화면에서 실제 돈으로 매매됩니다. 켤까요?')
                      : true;
                  if (!ok) return;
                }
                await setTossAllowOrders(settings, next);
                onChanged();
              }}>
              <Text style={{ color: broker.allow_orders ? C.critical : C.muted, fontSize: 12, fontWeight: '700' }}>
                실전 주문 허용: {broker.allow_orders ? 'ON ⚠ (실제 돈 사용)' : 'OFF (조회만)'} — 탭하여 전환
              </Text>
            </Pressable>
          )}
          <View style={styles.btnRow}>
            <Pressable style={styles.smallBtn} onPress={test} disabled={busy}>
              <Text style={styles.smallBtnText}>연결 테스트</Text>
            </Pressable>
            <Pressable style={[styles.smallBtn, { borderColor: C.critical }]} onPress={remove} disabled={busy}>
              <Text style={[styles.smallBtnText, { color: C.critical }]}>연동 해제</Text>
            </Pressable>
          </View>
        </View>
      )}

      {open && (
        <View style={{ marginTop: 8 }}>
          <Text style={styles.guide}>발급: {GUIDE[broker.broker]}</Text>
          {broker.fields.map((f) => (
            <TextInput
              key={f.env}
              style={styles.input}
              placeholder={f.label + (f.set ? ` (현재: ${f.masked})` : '')}
              placeholderTextColor={C.muted}
              secureTextEntry={f.secret}
              autoCapitalize="none"
              autoCorrect={false}
              value={values[f.env] ?? ''}
              onChangeText={(t) => setValues((v) => ({ ...v, [f.env]: t }))}
            />
          ))}
          <Pressable style={styles.saveBtn} onPress={save} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>저장하고 연결 테스트</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ManualCard({ account, onChanged }: { account: ManualAccount | null; onChanged: () => void }) {
  const { settings } = useSettings();
  const isNew = account == null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(account?.label ?? '');
  const [cash, setCash] = useState(String(account?.cash ?? ''));
  const [positions, setPositions] = useState(
    (account?.positions ?? []).map((p) => ({ symbol: p.symbol, qty: String(p.qty), avg: String(p.avg_price) })),
  );

  const save = async () => {
    setBusy(true);
    try {
      await upsertManualAccount(settings, {
        id: account?.id,
        label: label || 'NH/KB 계좌',
        currency: 'KRW',
        cash: parseFloat(cash) || 0,
        positions: positions
          .filter((p) => p.symbol.trim())
          .map((p) => ({ symbol: p.symbol.trim().toUpperCase(), qty: parseFloat(p.qty) || 0, avg_price: parseFloat(p.avg) || 0 })),
      });
      setOpen(false);
      onChanged();
      if (isNew) {
        setLabel('');
        setCash('');
        setPositions([]);
      }
    } catch (e: any) {
      notify('저장 실패', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!account?.id) return;
    setBusy(true);
    try {
      await deleteManualAccount(settings, account.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{isNew ? '+ 수동 계좌 추가' : account!.label}</Text>
        <Pressable style={styles.smallBtn} onPress={() => setOpen((v) => !v)}>
          <Text style={styles.smallBtnText}>{open ? '닫기' : isNew ? '추가' : '수정'}</Text>
        </Pressable>
      </View>
      {open && (
        <View style={{ marginTop: 8 }}>
          <TextInput
            style={styles.input}
            placeholder="계좌 이름 (예: NH투자증권)"
            placeholderTextColor={C.muted}
            value={label}
            onChangeText={setLabel}
          />
          <TextInput
            style={styles.input}
            placeholder="현금(예수금, 원)"
            placeholderTextColor={C.muted}
            keyboardType="numeric"
            value={cash}
            onChangeText={setCash}
          />
          <Text style={styles.guide}>보유 종목 (심볼 = 6자리 코드 또는 미국 티커)</Text>
          {positions.map((p, i) => (
            <View key={i} style={styles.posRow}>
              <TextInput
                style={[styles.input, { flex: 1.2, marginBottom: 0 }]}
                placeholder="심볼"
                placeholderTextColor={C.muted}
                autoCapitalize="characters"
                value={p.symbol}
                onChangeText={(t) => setPositions((arr) => arr.map((x, k) => (k === i ? { ...x, symbol: t } : x)))}
              />
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="수량"
                placeholderTextColor={C.muted}
                keyboardType="numeric"
                value={p.qty}
                onChangeText={(t) => setPositions((arr) => arr.map((x, k) => (k === i ? { ...x, qty: t } : x)))}
              />
              <TextInput
                style={[styles.input, { flex: 1.2, marginBottom: 0 }]}
                placeholder="평단가"
                placeholderTextColor={C.muted}
                keyboardType="numeric"
                value={p.avg}
                onChangeText={(t) => setPositions((arr) => arr.map((x, k) => (k === i ? { ...x, avg: t } : x)))}
              />
              <Pressable onPress={() => setPositions((arr) => arr.filter((_, k) => k !== i))}>
                <Text style={{ color: C.critical, fontSize: 16, paddingHorizontal: 4 }}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            style={[styles.smallBtn, { alignSelf: 'flex-start', marginTop: 6 }]}
            onPress={() => setPositions((arr) => [...arr, { symbol: '', qty: '', avg: '' }])}>
            <Text style={styles.smallBtnText}>+ 종목 추가</Text>
          </Pressable>
          <View style={styles.btnRow}>
            <Pressable style={[styles.saveBtn, { flex: 1 }]} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>저장</Text>}
            </Pressable>
            {!isNew && (
              <Pressable style={[styles.smallBtn, { borderColor: C.critical }]} onPress={remove} disabled={busy}>
                <Text style={[styles.smallBtnText, { color: C.critical }]}>삭제</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  err: { color: C.critical, fontSize: 13, marginVertical: 10 },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 6 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    padding: 14,
    marginTop: 10,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  status: { fontSize: 12, marginTop: 3 },
  masked: { color: C.muted, fontSize: 12, marginTop: 3, fontVariant: ['tabular-nums'] },
  guide: { color: C.muted, fontSize: 12, marginBottom: 8, lineHeight: 17 },
  input: {
    backgroundColor: C.page,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  posRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  smallBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: C.page,
  },
  smallBtnText: { color: C.textSecondary, fontSize: 12, fontWeight: '600' },
  saveBtn: {
    backgroundColor: C.accent,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  allowRow: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    backgroundColor: C.page,
  },
});
