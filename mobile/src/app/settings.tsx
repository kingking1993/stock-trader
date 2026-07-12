import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { getHealth } from '../lib/api';
import { useSettings } from '../lib/settings';
import { C } from '../lib/theme';

export default function SettingsScreen() {
  const { settings, save } = useSettings();
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [testing, setTesting] = useState(false);

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

      <Text style={styles.label}>API 키 (백엔드 .env의 APP_API_KEY)</Text>
      <TextInput
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
        placeholder="dev-key"
        placeholderTextColor={C.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />

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
