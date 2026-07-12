import { useQuery } from '@tanstack/react-query';
import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { OrderConfirmCard } from '../../components/OrderConfirmCard';
import {
  confirmOrder,
  getChatStatus,
  rejectOrder,
  resetChatSession,
  streamChat,
  type PendingOrder,
} from '../../lib/api';
import { useSettings } from '../../lib/settings';
import { C } from '../../lib/theme';

type Msg =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'order'; order: PendingOrder }
  | { kind: 'error'; text: string };

const TOOL_LABELS: Record<string, string> = {
  mcp__stock__get_quote: '현재가 조회',
  mcp__stock__get_indicators: '기술 지표 계산',
  mcp__stock__scan_market: '시장 스캔',
  mcp__stock__get_account: '계좌 조회',
  mcp__stock__get_positions: '포지션 조회',
  mcp__stock__propose_order: '주문 제안 작성',
};

const SESSION_ID = 'mobile';

export default function ChatScreen() {
  const { settings } = useSettings();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const listRef = useRef<FlatList>(null);
  const seenOrderIds = useRef<Set<string>>(new Set());

  // 서버가 AI 채팅을 지원하는지 (클라우드 배포 시 키 없으면 비활성)
  const statusQ = useQuery({
    queryKey: ['chatStatus', settings.baseUrl],
    queryFn: () => getChatStatus(settings),
    retry: 0,
  });
  const aiDisabled = statusQ.data?.enabled === false;

  const push = useCallback((m: Msg) => {
    setMessages((prev) => [...prev, m]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || streaming || aiDisabled) return;
    setInput('');
    push({ kind: 'user', text });
    setStreaming(true);

    streamChat(
      settings,
      SESSION_ID,
      text,
      (e) => {
        if (e.type === 'text') push({ kind: 'assistant', text: e.text });
        else if (e.type === 'tool_use') push({ kind: 'tool', name: TOOL_LABELS[e.name] ?? e.name });
        else if (e.type === 'error') push({ kind: 'error', text: e.error });
        else if (e.type === 'done') {
          for (const order of e.pending_orders) {
            if (!seenOrderIds.current.has(order.id)) {
              seenOrderIds.current.add(order.id);
              push({ kind: 'order', order });
            }
          }
        }
      },
      () => setStreaming(false),
    );
  };

  const reset = async () => {
    try {
      await resetChatSession(settings, SESSION_ID);
    } catch {}
    seenOrderIds.current.clear();
    setMessages([]);
  };

  const renderItem = ({ item }: { item: Msg }) => {
    switch (item.kind) {
      case 'user':
        return (
          <View style={[styles.bubble, styles.userBubble]}>
            <Text style={styles.userText}>{item.text}</Text>
          </View>
        );
      case 'assistant':
        return (
          <View style={[styles.bubble, styles.aiBubble]}>
            <Text style={styles.aiText}>{item.text}</Text>
          </View>
        );
      case 'tool':
        return <Text style={styles.tool}>⚙ {item.name} 중…</Text>;
      case 'error':
        return <Text style={styles.error}>⚠ {item.text}</Text>;
      case 'order':
        return (
          <OrderConfirmCard
            order={item.order}
            onConfirm={async (id) => {
              await confirmOrder(settings, id);
            }}
            onReject={async (id) => {
              await rejectOrder(settings, id);
            }}
          />
        );
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.page }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
        ListHeaderComponent={
          aiDisabled ? (
            <View style={styles.disabledBanner}>
              <Text style={styles.disabledTitle}>ℹ️ 이 서버는 AI 채팅이 꺼져 있습니다</Text>
              <Text style={styles.disabledText}>
                클라우드 서버에는 Anthropic API 키가 없어 AI 분석 기능만 비활성화되어 있습니다. 시세·추천·스크리닝·차트·매매·포트폴리오는 모두 정상입니다.
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          aiDisabled ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>AI 주식 분석가</Text>
              <Text style={styles.emptyText}>
                예시:{'\n'}“오늘 매수할 만한 종목 추천해줘”{'\n'}“AAPL RSI랑 이평선 분석해줘”{'\n'}
                “NVDA 1주 매수 제안해줘”
              </Text>
            </View>
          )
        }
      />
      <View style={styles.inputRow}>
        <Pressable style={styles.resetBtn} onPress={reset}>
          <Text style={{ color: C.muted, fontSize: 12 }}>초기화</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={aiDisabled ? 'AI 채팅 비활성화됨' : streaming ? '응답 생성 중…' : '메시지 입력'}
          placeholderTextColor={C.muted}
          editable={!streaming && !aiDisabled}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable
          style={[styles.sendBtn, (streaming || aiDisabled) && { opacity: 0.4 }]}
          onPress={send}
          disabled={streaming || aiDisabled}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>전송</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: { borderRadius: 14, padding: 12, marginVertical: 4, maxWidth: '88%' },
  userBubble: { backgroundColor: C.accent, alignSelf: 'flex-end' },
  aiBubble: {
    backgroundColor: C.surface,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  userText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  aiText: { color: C.text, fontSize: 14, lineHeight: 21 },
  tool: { color: C.muted, fontSize: 12, marginVertical: 4, marginLeft: 4 },
  error: { color: C.critical, fontSize: 13, marginVertical: 6 },
  disabledBanner: {
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    padding: 12,
    marginBottom: 8,
  },
  disabledTitle: { color: C.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  disabledText: { color: C.textSecondary, fontSize: 12, lineHeight: 18 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  emptyText: { color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 22 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.grid,
    backgroundColor: C.page,
  },
  resetBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  input: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: C.accent,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
