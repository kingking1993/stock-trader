import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { verifyKey } from '../lib/api';
import { useSettings } from '../lib/settings';
import { C } from '../lib/theme';

/**
 * 앱 잠금 게이트. 저장된 비밀번호(apiKey)로 서버 검증:
 * - 통과: children 렌더 (기기에 저장돼 다음부턴 바로 통과)
 * - 실패/미입력: 비밀번호 입력 화면
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const { settings, loaded, unlocked, save, setUnlocked } = useSettings();
  const [checking, setChecking] = useState(true);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 저장된 키로 자동 검증 (기기에 한 번만 입력)
  useEffect(() => {
    if (!loaded) return;
    if (unlocked) {
      setChecking(false);
      return;
    }
    if (!settings.apiKey) {
      setChecking(false);
      return;
    }
    verifyKey(settings)
      .then(() => setUnlocked(true))
      .catch(() => {
        /* 키가 틀림(비번 변경 등) → 입력 화면 */
      })
      .finally(() => setChecking(false));
  }, [loaded, settings.apiKey]);

  if (!loaded || checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  if (unlocked) return <>{children}</>;

  const submit = async () => {
    const value = pw.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      // 무료 서버가 잠들어 있으면 첫 요청이 느림 → 최대 3회 재시도
      let lastErr: any = null;
      for (let i = 0; i < 3; i++) {
        try {
          await verifyKey({ ...settings, apiKey: value });
          await save({ ...settings, apiKey: value }); // 기기에 저장
          setUnlocked(true);
          return;
        } catch (e: any) {
          lastErr = e;
          // 401 = 진짜 비번 오류 → 즉시 중단
          if (e?.status === 401) break;
          setError('서버를 깨우는 중입니다… 잠시만요');
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      if (lastErr?.status === 401) setError('비밀번호가 올바르지 않습니다');
      else setError(`서버 연결 실패: ${String(lastErr?.message ?? lastErr)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.center}>
      <Text style={styles.title}>🔒 Stock Trader</Text>
      <Text style={styles.sub}>비밀번호를 입력하세요</Text>
      <TextInput
        style={styles.input}
        value={pw}
        onChangeText={setPw}
        placeholder="비밀번호"
        placeholderTextColor={C.muted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.btn, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>잠금 해제</Text>}
      </Pressable>
      <Text style={styles.hint}>처음 한 번만 입력하면 이 기기에서는 기억됩니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.page, padding: 28 },
  title: { color: C.text, fontSize: 26, fontWeight: '800' },
  sub: { color: C.textSecondary, fontSize: 14, marginTop: 8, marginBottom: 20 },
  input: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    color: C.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    textAlign: 'center',
  },
  error: { color: C.critical, fontSize: 13, marginTop: 10 },
  btn: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hint: { color: C.muted, fontSize: 12, marginTop: 16, textAlign: 'center' },
});
