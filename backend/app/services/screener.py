"""필터 스크리너 — 미국(Alpaca)/국내(KIS) 시총 상위 100 유니버스를 지표로 스캔.

- 유니버스 순서 = 시가총액 순위 (rank 필드로 노출)
- KIS 호출 제한 때문에 시장별 봉 데이터를 10분 캐시, KR은 스레드 병렬 페치
"""
from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import pandas as pd

from app.indicators import compute_indicators, detect_signals
from app.services import alpaca_service
from app.services.kr_universe import KR_UNIVERSE

# 미국 시가총액 상위 100 (2026-07 스냅샷, 순서 = 시총 순위)
US_UNIVERSE = [
    "NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "BRK.B", "LLY",
    "WMT", "JPM", "V", "ORCL", "MA", "XOM", "COST", "UNH", "NFLX", "PG",
    "JNJ", "HD", "ABBV", "BAC", "KO", "CRM", "PLTR", "CVX", "TMUS", "WFC",
    "CSCO", "PM", "AMD", "IBM", "MS", "ABT", "GE", "LIN", "MCD", "AXP",
    "GS", "DIS", "INTU", "MRK", "NOW", "T", "RTX", "PEP", "CAT", "ISRG",
    "UBER", "TXN", "VZ", "BKNG", "QCOM", "BA", "C", "SPGI", "ADBE", "BSX",
    "AMGN", "SCHW", "LOW", "NEE", "UNP", "PGR", "ETN", "AMAT", "SYK", "BLK",
    "HON", "DHR", "TJX", "PFE", "COP", "GILD", "PANW", "MU", "FI", "ADP",
    "CB", "ANET", "DE", "VRTX", "LMT", "MDT", "KLAC", "SBUX", "BMY", "PLD",
    "APH", "CME", "EQIX", "CDNS", "SNPS", "INTC", "WM", "SO", "CRWD", "ADI",
]

# 시그널 타입별 가중치 (양수 = 매수 관점 가점)
SIGNAL_WEIGHTS = {
    "golden_cross": 30,
    "macd_bull_cross": 20,
    "rsi_oversold": 25,
    "bb_lower_break": 15,
    "uptrend": 15,
    "dead_cross": -30,
    "macd_bear_cross": -20,
    "rsi_overbought": -25,
    "bb_upper_break": -15,
}

VALID_SIGNAL_TYPES = set(SIGNAL_WEIGHTS)
VALID_SORTS = {"score", "change", "vol_ratio", "rank"}

_BARS_TTL = 600  # 10분
_bars_cache: dict[str, tuple[float, dict[str, pd.DataFrame]]] = {}
_cache_lock = threading.Lock()


@dataclass
class ScreenFilters:
    """사용자 정의 스크리닝 조건. None이면 해당 조건 미적용."""
    rsi_min: float | None = None
    rsi_max: float | None = None
    price_min: float | None = None
    price_max: float | None = None
    require_signals: list[str] = field(default_factory=list)  # 모두 발생해야 함 (AND)
    min_score: float | None = None
    vol_ratio_min: float | None = None  # 거래량(주식 수) 배수 하한
    value_ratio_min: float | None = None  # 거래대금(금액) 배수 하한 — 종목 간 비교엔 이쪽 권장
    sort: str = "score"  # score | change(급등순) | vol_ratio(거래량순) | rank(시총순)
    top_n: int = 10


def _fetch_bars(market: str) -> dict[str, pd.DataFrame]:
    """시장 전체 봉 데이터 (10분 캐시). KR은 스레드 병렬 (KIS 스로틀 락이 초당 상한 보장)."""
    with _cache_lock:
        cached = _bars_cache.get(market)
        if cached and time.time() - cached[0] < _BARS_TTL:
            return cached[1]

    if market == "KR":
        from app.services import kis_service

        bars: dict[str, pd.DataFrame] = {}

        def fetch(code: str):
            try:
                # 스캔은 1호출(최근 ~95봉)로 충분 — SMA60·RSI·거래량 모두 계산 가능
                return code, kis_service.get_daily_bars(code, extended=False)
            except Exception:
                return code, None

        with ThreadPoolExecutor(max_workers=8) as pool:
            for code, df in pool.map(fetch, KR_UNIVERSE):
                if df is not None and not df.empty:
                    bars[code] = df

        # 일시적 한도초과 등으로 빠진 종목은 순차로 한 번 더 시도
        for code in KR_UNIVERSE:
            if code in bars:
                continue
            _, df = fetch(code)
            if df is not None and not df.empty:
                bars[code] = df
    else:
        bars = alpaca_service.get_bars(US_UNIVERSE, timeframe="1D")

    with _cache_lock:
        _bars_cache[market] = (time.time(), bars)
    return bars


def _gap_pct(price: float, ma) -> float | None:
    if ma is None or ma != ma or ma == 0:
        return None
    return round((price / float(ma) - 1) * 100, 2)


def _row(symbol: str, name: str | None, rank: int, df: pd.DataFrame) -> dict | None:
    if df is None or len(df) < 60:
        return None
    ind = compute_indicators(df)
    signals = detect_signals(ind, lookback=3)
    score = sum(SIGNAL_WEIGHTS.get(s["type"], 0) for s in signals)
    last = ind.iloc[-1]
    prev_close = ind["close"].iloc[-2]
    price = float(last["close"])

    # 거래량 배수: 최근 봉 ÷ 직전 20일 평균 (주식 수 기준)
    vol_ratio = None
    if len(ind) >= 21:
        avg_vol = float(ind["volume"].iloc[-21:-1].mean())
        if avg_vol > 0:
            vol_ratio = round(float(last["volume"]) / avg_vol, 2)

    # 거래대금(금액): 오늘 누적 + 20일 평균 대비 배수 — 종목 간 비교는 금액 기준이 정확
    value_today = None
    value_ratio = None
    values = ind["close"] * ind["volume"]
    value_today = round(float(values.iloc[-1]), 0)
    if len(ind) >= 21:
        avg_value = float(values.iloc[-21:-1].mean())
        if avg_value > 0:
            value_ratio = round(float(values.iloc[-1]) / avg_value, 2)

    return {
        "symbol": symbol,
        "name": name,
        "rank": rank,
        "score": score,
        "price": round(price, 2),
        "change_pct": round(float(price / float(prev_close) - 1) * 100, 2),
        "rsi_14": round(float(last["rsi_14"]), 1) if last["rsi_14"] == last["rsi_14"] else None,
        "sma5_gap_pct": _gap_pct(price, last.get("sma_5")),
        "sma20_gap_pct": _gap_pct(price, last.get("sma_20")),
        "sma60_gap_pct": _gap_pct(price, last.get("sma_60")),
        "sma120_gap_pct": _gap_pct(price, last.get("sma_120")),
        "vol_ratio": vol_ratio,
        "value_today": value_today,
        "value_ratio": value_ratio,
        "signals": signals,
    }


def _passes(row: dict, f: ScreenFilters) -> bool:
    if f.rsi_min is not None and (row["rsi_14"] is None or row["rsi_14"] < f.rsi_min):
        return False
    if f.rsi_max is not None and (row["rsi_14"] is None or row["rsi_14"] > f.rsi_max):
        return False
    if f.price_min is not None and row["price"] < f.price_min:
        return False
    if f.price_max is not None and row["price"] > f.price_max:
        return False
    if f.require_signals:
        present = {s["type"] for s in row["signals"]}
        if not set(f.require_signals).issubset(present):
            return False
    if f.min_score is not None and row["score"] < f.min_score:
        return False
    if f.vol_ratio_min is not None and (row["vol_ratio"] is None or row["vol_ratio"] < f.vol_ratio_min):
        return False
    if f.value_ratio_min is not None and (
        row.get("value_ratio") is None or row["value_ratio"] < f.value_ratio_min
    ):
        return False
    return True


_SORT_KEYS = {
    "score": (lambda r: r["score"], True),
    "change": (lambda r: r["change_pct"], True),
    "vol_ratio": (lambda r: r["vol_ratio"] if r["vol_ratio"] is not None else -1, True),
    "rank": (lambda r: r["rank"], False),  # 시총 1위부터 오름차순
}


def screen_rows(rows: list[dict], filters: ScreenFilters) -> list[dict]:
    """계산된 row 목록에 필터·정렬 적용 (순수 함수 — 테스트 용이)."""
    out = [r for r in rows if _passes(r, filters)]
    key, reverse = _SORT_KEYS.get(filters.sort, _SORT_KEYS["score"])
    out.sort(key=key, reverse=reverse)
    return out[: filters.top_n]


def scan(market: str = "US", filters: ScreenFilters | None = None) -> list[dict]:
    """유니버스 스캔 + 필터 적용 (동기, 블로킹)."""
    filters = filters or ScreenFilters()
    bars = _fetch_bars(market)
    universe = list(KR_UNIVERSE) if market == "KR" else US_UNIVERSE
    names = KR_UNIVERSE if market == "KR" else {}
    rows = []
    for rank, symbol in enumerate(universe, start=1):
        df = bars.get(symbol)
        if df is None:
            continue
        row = _row(symbol, names.get(symbol), rank, df)
        if row is not None:
            rows.append(row)
    return screen_rows(rows, filters)


async def scan_async(market: str = "US", filters: ScreenFilters | None = None) -> list[dict]:
    return await asyncio.to_thread(scan, market, filters)
