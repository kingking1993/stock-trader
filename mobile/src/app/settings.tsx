import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { changePassword, getHealth } from '../lib/api';
import { useSettings } from '../lib/settings';
import { C } from '../lib/theme';

const notify = (t: string, m: string) => (Platform.OS === 'web' ? window.alert(`${t}\n${m}`) : Alert.alert(t, m));

export default function SettingsScreen() {
  const { settings, save } = useSettings();
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [testing, setTesting] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const doChangePassword = async () => {
    if (!curPw || !newPw) return;
    setPwBusy(true);
    try {
      await changePassword(settings, curPw.trim(), newPw.trim());
      await save({ ...settings, apiKey: newPw.trim() });
      setCurPw('');
      setNewPw('');
      notify('완료', '비밀번호가 변경되었습니다. 다른 기기는 새 비밀번호로 다시 로그인해야 합니다.');
    } catch (e: any) {
      notify('실패', String(e?.message ?? e));
    } finally {
      setPwBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const h = await getHealth({ baseUrl: baseUrl.trim().replace(/\/$/, ''), apiKey });
      Alert.alert(
        '연결 성공',
        h.paper_trading ? '모드: 페이퍼(모의) 트레이딩' : '⚠ 모드: 실전 매매 (실제 돈이 사용됩니다)',
      );
    } catch (e: any) {
      Alert.alert('연결 실패', String(e?.message ?? e));
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    await save({ baseUrl: baseUrl.trim().replace(/\/$/, ''), apiKey: apiKey.trim() });
    router.back();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>백엔드 서버 주소</Text>
      <TextInput
        style={styles.input}
        value={baseUrl}
        onChangeText={setBaseUrl}
        placeholder="http://192.168.0.10:8000"
        placeholderTextColor={C.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.hint}>PC에서 ipconfig로 확인한 LAN IP를 사용하세요 (같은 Wi-Fi 필요)</Text>

      <Pressable style={[styles.btn, styles.btnGhost]} onPress={test} disabled={testing}>
        <Text style={[styles.btnText, { color: C.textSecondary }]}>
          {testing ? '확인 중…' : '연결 테스트'}
        </Text>
      </Pressable>
      <Pressable style={[styles.btn, { backgroundColor: C.accent }]} onPress={onSave}>
        <Text style={styles.btnText}>저장</Text>
      </Pressable>

      <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => router.push('/brokers')}>
        <Text style={[styles.btnText, { color: C.textSecondary }]}>계좌 연동 관리 (증권사 API·수동 계좌) →</Text>
      </Pressable>

      {/* 비밀번호 변경 (두 사람 공용 잠금) */}
      <Text style={[styles.label, { marginTop: 28 }]}>비밀번호 변경</Text>
      <Text style={styles.hint}>변경 시 다른 기기는 새 비밀번호로 다시 로그인해야 합니다.</Text>
      <TextInput
        style={styles.input}
        value={curPw}
        onChangeText={setCurPw}
        placeholder="현재 비밀번호"
        placeholderTextColor={C.muted}
        secureTextEntry
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        value={newPw}
        onChangeText={setNewPw}
        placeholder="새 비밀번호 (4자 이상)"
        placeholderTextColor={C.muted}
        secureTextEntry
        autoCapitalize="none"
      />
      <Pressable style={[styles.btn, styles.btnGhost]} onPress={doChangePassword} disabled={pwBusy}>
        <Text style={[styles.btnText, { color: C.textSecondary }]}>{pwBusy ? '변경 중…' : '비밀번호 변경'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.page, padding: 16 },
  label: { color: C.textSecondary, fontSize: 13, marginTop: 16, marginBottom: 6 },
  hint: { color: C.muted, fontSize: 11, marginTop: 6 },
  input: {
    backgroundColor: C.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  btn: { borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  btnGhost: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
