import type { Settings } from './settings';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${s.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': s.apiKey,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

// ---------- 타입 ----------
export type Market = 'US' | 'KR';

export type Signal = { type: string; direction: 'bullish' | 'bearish'; label: string; days_ago: number };

export type Candidate = {
  symbol: string;
  name: string | null;
  rank: number;
  score: number;
  price: number;
  change_pct: number;
  rsi_14: number | null;
  sma5_gap_pct: number | null;
  sma20_gap_pct: number | null;
  sma60_gap_pct: number | null;
  sma120_gap_pct: number | null;
  vol_ratio: number | null;
  value_today: number | null;
  value_ratio: number | null;
  chg_1m?: number | null;
  chg_5m?: number | null;
  chg_10m?: number | null;
  signals: Signal[];
};

export type SortKey = 'score' | 'change' | 'vol_ratio' | 'rank';

export type ChartData = {
  symbol: string;
  name: string | null;
  currency: 'USD' | 'KRW';
  timeframe: string;
  timestamps: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  sma_5: (number | null)[];
  sma_20: (number | null)[];
  sma_60: (number | null)[];
  rsi_14: (number | null)[];
  bb_upper: (number | null)[];
  bb_lower: (number | null)[];
  signals: Signal[];
};

export type PendingOrder = {
  id: string;
  symbol: string;
  name: string | null;
  side: 'buy' | 'sell';
  qty: number;
  order_type: string;
  limit_price: number | null;
  est_price: number | null;
  est_value: number | null;
  rationale: string;
  broker: 'alpaca' | 'kis_vts';
  currency: 'USD' | 'KRW';
  status: string;
  expires_in: number;
};

export type Position = {
  symbol: string;
  name?: string | null;
  qty: number;
  avg_entry_price: number;
  current_price: number | null;
  market_value: number | null;
  unrealized_pl: number | null;
  unrealized_plpc: number | null;
};

export type AccountInfo = {
  broker: string;
  label: string;
  currency: 'USD' | 'KRW';
  equity: number | null;
  cash: number | null;
  buying_power: number | null;
  positions: Position[];
  error: string | null;
};

export type Portfolio = {
  total_krw: number;
  total_usd: number;
  fx_rate: number;
  fx_source: string;
  accounts: AccountInfo[];
};

export type BrokerOrder = {
  id: string;
  symbol: string;
  side: string;
  qty: number | null;
  status: string;
  filled_avg_price: number | null;
  submitted_at: string | null;
};

export type ScreenParams = {
  market: Market;
  rsi_min?: number;
  rsi_max?: number;
  signals?: string[];
  min_score?: number;
  value_ratio_min?: number;
  sort?: SortKey;
  top?: number;
};

// ---------- REST ----------
export const getHealth = (s: Settings) => apiFetch<{ status: string; paper_trading: boolean }>(s, '/health');

export const getRecommend = (s: Settings, market: Market, top = 10, analyze = false) =>
  apiFetch<{ market: Market; candidates: Candidate[]; ai_summary: string | null }>(
    s,
    `/api/recommend?market=${market}&top=${top}&analyze=${analyze}`,
  );

export const getScreen = (s: Settings, p: ScreenParams) => {
  const q = new URLSearchParams({ market: p.market, top: String(p.top ?? 20) });
  if (p.rsi_min != null) q.set('rsi_min', String(p.rsi_min));
  if (p.rsi_max != null) q.set('rsi_max', String(p.rsi_max));
  if (p.min_score != null) q.set('min_score', String(p.min_score));
  if (p.value_ratio_min != null) q.set('value_ratio_min', String(p.value_ratio_min));
  if (p.sort) q.set('sort', p.sort);
  if (p.signals?.length) q.set('signals', p.signals.join(','));
  return apiFetch<{ market: Market; count: number; results: Candidate[] }>(s, `/api/screen?${q.toString()}`);
};

export type SectorPerf = {
  sector: string;
  avg_change_pct: number;
  up_count: number;
  down_count: number;
  count: number;
  members: Candidate[];
};

export const getSectors = (s: Settings, market: Market, memberSort: 'rank' | 'change' | 'vol_ratio' = 'change') =>
  apiFetch<{ market: Market; note: string; sectors: SectorPerf[] }>(
    s,
    `/api/sectors?market=${market}&member_sort=${memberSort}`,
  );

export const getMovers = (
  s: Settings,
  market: Market,
  opts?: { valueRatioMin?: number; excludeSmall?: boolean; top?: number },
) => {
  const q = new URLSearchParams({ market, top: String(opts?.top ?? 20) });
  if (opts?.valueRatioMin != null) q.set('value_ratio_min', String(opts.valueRatioMin));
  q.set('exclude_small', String(opts?.excludeSmall ?? true));
  return apiFetch<{ market: Market; count: number; results: Candidate[] }>(s, `/api/movers?${q.toString()}`);
};

/** 거래대금 축약 표기: KRW → 342억/1.2조, USD → $24M/$1.2B */
export const fmtValueCompact = (v: number | null | undefined, currency: 'USD' | 'KRW') => {
  if (v == null) return '-';
  if (currency === 'KRW') {
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
    if (v >= 1e8) return `${Math.round(v / 1e8)}억`;
    return `${Math.round(v / 1e4)}만`;
  }
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v / 1e3)}K`;
};

export const getChart = (s: Settings, symbol: string, timeframe = '1D') =>
  apiFetch<ChartData>(s, `/api/market/chart/${encodeURIComponent(symbol)}?timeframe=${timeframe}`);
export const searchKr = (s: Settings, q: string) =>
  apiFetch<{ symbol: string; name: string }[]>(s, `/api/market/search?q=${encodeURIComponent(q)}`);
export const getPortfolio = (s: Settings) => apiFetch<Portfolio>(s, '/api/portfolio');
export const getOrders = (s: Settings) =>
  apiFetch<{ broker: BrokerOrder[]; pending: PendingOrder[] }>(s, '/api/orders');
export type OrderBrokerOption = {
  broker: string;
  label: string;
  live: boolean;
  enabled: boolean;
  note: string;
  cash_label?: string | null;
};

export const getAvailableBrokers = (s: Settings, symbol: string) =>
  apiFetch<{ symbol: string; brokers: OrderBrokerOption[] }>(
    s,
    `/api/orders/available-brokers?symbol=${encodeURIComponent(symbol)}`,
  );

export const createOrder = (
  s: Settings,
  body: {
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    order_type: 'market' | 'limit';
    limit_price?: number | null;
    broker?: string;
    rationale?: string;
  },
) => apiFetch<PendingOrder>(s, '/api/orders', { method: 'POST', body: JSON.stringify(body) });

export const setTossAllowOrders = (s: Settings, allow: boolean) =>
  apiFetch<{ allow: boolean }>(s, '/api/brokers/toss/allow-orders', {
    method: 'POST',
    body: JSON.stringify({ allow }),
  });

export const confirmOrder = (s: Settings, id: string) =>
  apiFetch(s, `/api/orders/${id}/confirm`, { method: 'POST' });
export const rejectOrder = (s: Settings, id: string) =>
  apiFetch(s, `/api/orders/${id}/reject`, { method: 'POST' });
export const resetChatSession = (s: Settings, sessionId: string) =>
  apiFetch(s, `/api/chat/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });

// ---------- 계좌 연동 관리 ----------
export type BrokerField = { env: string; label: string; secret: boolean; masked: string; set: boolean };
export type BrokerStatus = {
  broker: string;
  label: string;
  configured: boolean;
  allow_orders: boolean | null;
  fields: BrokerField[];
};
export type ManualPosition = { symbol: string; qty: number; avg_price: number; name?: string | null };
export type ManualAccount = {
  id?: string;
  label: string;
  currency: 'KRW' | 'USD';
  cash: number;
  positions: ManualPosition[];
};

export const getBrokers = (s: Settings) =>
  apiFetch<{ brokers: BrokerStatus[]; manual: ManualAccount[] }>(s, '/api/brokers');
export const setBroker = (s: Settings, broker: string, values: Record<string, string>) =>
  apiFetch<{ saved: boolean; test: { ok: boolean; detail: string } }>(s, `/api/brokers/${broker}`, {
    method: 'POST',
    body: JSON.stringify({ values }),
  });
export const testBroker = (s: Settings, broker: string) =>
  apiFetch<{ ok: boolean; detail: string }>(s, `/api/brokers/${broker}/test`, { method: 'POST' });
export const deleteBroker = (s: Settings, broker: string) =>
  apiFetch(s, `/api/brokers/${broker}`, { method: 'DELETE' });
export const upsertManualAccount = (s: Settings, acc: ManualAccount) =>
  apiFetch<ManualAccount>(s, '/api/brokers/manual/accounts', { method: 'POST', body: JSON.stringify(acc) });
export const deleteManualAccount = (s: Settings, id: string) =>
  apiFetch(s, `/api/brokers/manual/accounts/${id}`, { method: 'DELETE' });

export const fmtMoney = (v: number | null | undefined, currency: 'USD' | 'KRW') => {
  if (v == null) return '-';
  return currency === 'KRW'
    ? `₩${Math.round(v).toLocaleString()}`
    : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

// ---------- 채팅 SSE ----------
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: any }
  | { type: 'tool_result'; is_error: boolean }
  | { type: 'result'; duration_ms?: number; total_cost_usd?: number }
  | { type: 'error'; error: string }
  | { type: 'done'; pending_orders: PendingOrder[] };

/**
 * POST /api/chat SSE 스트림. React Native의 XHR은 onprogress로
 * 누적 responseText를 제공하므로 이를 잘라 이벤트 단위로 파싱한다.
 * 반환값: 스트림 중단 함수.
 */
export function streamChat(
  s: Settings,
  sessionId: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
  onClose: () => void,
): () => void {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let buffer = '';

  const pump = () => {
    const chunk = xhr.responseText.slice(seen);
    seen = xhr.responseText.length;
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as ChatEvent);
      } catch {}
    }
  };

  xhr.open('POST', `${s.baseUrl}/api/chat`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('X-API-Key', s.apiKey);
  xhr.onprogress = pump;
  xhr.onload = () => {
    pump();
    onClose();
  };
  xhr.onerror = () => {
    onEvent({ type: 'error', error: '서버에 연결할 수 없습니다' });
    onClose();
  };
  xhr.send(JSON.stringify({ session_id: sessionId, message }));
  return () => xhr.abort();
}
