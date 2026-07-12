"""기술 지표 계산 — 순수 pandas 구현 (TA-Lib 등 네이티브 의존성 없음).

모든 함수는 종가 Series 또는 OHLCV DataFrame(close 컬럼 필수)을 받아
같은 인덱스의 Series/DataFrame을 반환한다.
"""
from __future__ import annotations

import pandas as pd


def sma(close: pd.Series, period: int) -> pd.Series:
    return close.rolling(window=period, min_periods=period).mean()


def ema(close: pd.Series, period: int) -> pd.Series:
    return close.ewm(span=period, adjust=False, min_periods=period).mean()


def _wilder_smooth(values: pd.Series, period: int) -> pd.Series:
    """Wilder smoothing: 첫 period개 단순평균을 시드로, 이후 (prev*(n-1)+cur)/n."""
    import numpy as np

    arr = values.to_numpy(dtype=float)
    out = np.full(len(arr), np.nan)
    if len(arr) <= period:
        return pd.Series(out, index=values.index)
    out[period] = np.nanmean(arr[1 : period + 1])
    for i in range(period + 1, len(arr)):
        out[i] = (out[i - 1] * (period - 1) + arr[i]) / period
    return pd.Series(out, index=values.index)


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Wilder 방식 RSI (첫 값은 period 단순평균 시드)."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = _wilder_smooth(gain, period)
    avg_loss = _wilder_smooth(loss, period)
    rs = avg_gain / avg_loss
    out = 100 - 100 / (1 + rs)
    # 손실이 0이면 RS가 inf → RSI 100
    out = out.where(avg_loss != 0, 100.0)
    out[avg_gain.isna() | avg_loss.isna()] = float("nan")
    return out


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return pd.DataFrame(
        {"macd": macd_line, "macd_signal": signal_line, "macd_hist": macd_line - signal_line}
    )


def bollinger(close: pd.Series, period: int = 20, num_std: float = 2.0) -> pd.DataFrame:
    mid = sma(close, period)
    std = close.rolling(window=period, min_periods=period).std(ddof=0)
    return pd.DataFrame(
        {"bb_mid": mid, "bb_upper": mid + num_std * std, "bb_lower": mid - num_std * std}
    )


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """OHLCV DataFrame에 주요 지표 컬럼을 추가해 반환."""
    out = df.copy()
    close = out["close"]
    for p in (5, 20, 60, 120):
        out[f"sma_{p}"] = sma(close, p)
    out["ema_12"] = ema(close, 12)
    out["ema_26"] = ema(close, 26)
    out["rsi_14"] = rsi(close, 14)
    out = out.join(macd(close))
    out = out.join(bollinger(close))
    return out


def _crossed_above(a: pd.Series, b: pd.Series, i: int) -> bool:
    """인덱스 i에서 a가 b를 상향 돌파했는가."""
    if i < 1:
        return False
    prev_a, prev_b = a.iloc[i - 1], b.iloc[i - 1]
    cur_a, cur_b = a.iloc[i], b.iloc[i]
    if pd.isna(prev_a) or pd.isna(prev_b) or pd.isna(cur_a) or pd.isna(cur_b):
        return False
    return prev_a <= prev_b and cur_a > cur_b


def detect_signals(df: pd.DataFrame, lookback: int = 3) -> list[dict]:
    """지표가 계산된 DataFrame에서 최근 lookback개 봉 안에 발생한 시그널 목록을 반환.

    각 시그널: {"type": str, "direction": "bullish"|"bearish", "label": str, "days_ago": int}
    """
    signals: list[dict] = []
    n = len(df)
    if n < 2:
        return signals

    def add(type_: str, direction: str, label: str, days_ago: int):
        signals.append({"type": type_, "direction": direction, "label": label, "days_ago": days_ago})

    for offset in range(lookback):
        i = n - 1 - offset
        if i < 1:
            break
        if _crossed_above(df["sma_5"], df["sma_20"], i):
            add("golden_cross", "bullish", "골든크로스 (SMA5 > SMA20)", offset)
        if _crossed_above(df["sma_20"], df["sma_5"], i):
            add("dead_cross", "bearish", "데드크로스 (SMA5 < SMA20)", offset)
        if _crossed_above(df["macd"], df["macd_signal"], i):
            add("macd_bull_cross", "bullish", "MACD 상향 교차", offset)
        if _crossed_above(df["macd_signal"], df["macd"], i):
            add("macd_bear_cross", "bearish", "MACD 하향 교차", offset)

    last = df.iloc[-1]
    if not pd.isna(last.get("rsi_14")):
        if last["rsi_14"] < 30:
            add("rsi_oversold", "bullish", f"RSI 과매도 ({last['rsi_14']:.1f})", 0)
        elif last["rsi_14"] > 70:
            add("rsi_overbought", "bearish", f"RSI 과매수 ({last['rsi_14']:.1f})", 0)

    if not pd.isna(last.get("bb_lower")) and last["close"] < last["bb_lower"]:
        add("bb_lower_break", "bullish", "볼린저밴드 하단 이탈", 0)
    if not pd.isna(last.get("bb_upper")) and last["close"] > last["bb_upper"]:
        add("bb_upper_break", "bearish", "볼린저밴드 상단 이탈", 0)

    # 정배열 추세 (종가 > SMA20 > SMA60)
    if (
        not pd.isna(last.get("sma_20"))
        and not pd.isna(last.get("sma_60"))
        and last["close"] > last["sma_20"] > last["sma_60"]
    ):
        add("uptrend", "bullish", "정배열 상승추세 (종가 > SMA20 > SMA60)", 0)

    return signals
