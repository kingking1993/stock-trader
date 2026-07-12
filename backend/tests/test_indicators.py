import numpy as np
import pandas as pd
import pytest

from app.indicators import bollinger, compute_indicators, detect_signals, ema, macd, rsi, sma


def make_df(closes):
    closes = pd.Series(closes, dtype=float)
    return pd.DataFrame(
        {
            "open": closes,
            "high": closes * 1.01,
            "low": closes * 0.99,
            "close": closes,
            "volume": 1_000_000,
        }
    )


def test_sma_known_values():
    s = pd.Series([1, 2, 3, 4, 5], dtype=float)
    result = sma(s, 3)
    assert pd.isna(result.iloc[0]) and pd.isna(result.iloc[1])
    assert result.iloc[2] == pytest.approx(2.0)
    assert result.iloc[4] == pytest.approx(4.0)


def test_ema_converges_to_constant():
    s = pd.Series([10.0] * 50)
    result = ema(s, 12)
    assert result.iloc[-1] == pytest.approx(10.0)


def test_rsi_all_gains_is_100():
    s = pd.Series(np.arange(1, 40, dtype=float))
    result = rsi(s, 14)
    assert result.iloc[-1] == pytest.approx(100.0)


def test_rsi_all_losses_is_0():
    s = pd.Series(np.arange(40, 1, -1, dtype=float))
    result = rsi(s, 14)
    assert result.iloc[-1] == pytest.approx(0.0, abs=1e-6)


def test_rsi_known_wilder_value():
    # 고전적인 Wilder RSI 검증 데이터 (StockCharts 예제)
    closes = [
        44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
        45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00,
        46.03, 46.41, 46.22, 45.64,
    ]
    result = rsi(pd.Series(closes), 14)
    # 15번째 값(첫 RSI) ≈ 70.46, 이후 Wilder smoothing
    assert result.iloc[14] == pytest.approx(70.46, abs=0.7)


def test_rsi_range_bounds():
    rng = np.random.default_rng(42)
    s = pd.Series(100 + rng.normal(0, 2, 200).cumsum())
    result = rsi(s, 14).dropna()
    assert ((result >= 0) & (result <= 100)).all()


def test_macd_columns_and_hist():
    s = pd.Series(np.linspace(100, 150, 100))
    result = macd(s)
    assert set(result.columns) == {"macd", "macd_signal", "macd_hist"}
    pd.testing.assert_series_equal(
        result["macd_hist"], result["macd"] - result["macd_signal"], check_names=False
    )
    # 꾸준한 상승 구간에서는 MACD 양수
    assert result["macd"].iloc[-1] > 0


def test_bollinger_symmetry():
    rng = np.random.default_rng(1)
    s = pd.Series(100 + rng.normal(0, 1, 60))
    bb = bollinger(s, 20, 2)
    valid = bb.dropna()
    upper_dist = valid["bb_upper"] - valid["bb_mid"]
    lower_dist = valid["bb_mid"] - valid["bb_lower"]
    pd.testing.assert_series_equal(upper_dist, lower_dist, check_names=False)


def test_compute_indicators_adds_columns():
    df = make_df(100 + np.random.default_rng(0).normal(0, 1, 150).cumsum())
    out = compute_indicators(df)
    for col in ["sma_5", "sma_20", "sma_60", "sma_120", "rsi_14", "macd", "bb_upper"]:
        assert col in out.columns
        assert not pd.isna(out[col].iloc[-1])


def test_golden_cross_detected():
    # 하락 후 급반등 → SMA5가 SMA20을 상향 돌파
    closes = list(np.linspace(120, 100, 40)) + list(np.linspace(100, 125, 10))
    df = compute_indicators(make_df(closes))
    signals = detect_signals(df, lookback=10)
    types = {s["type"] for s in signals}
    assert "golden_cross" in types


def test_rsi_oversold_detected():
    closes = list(np.linspace(150, 90, 60))
    df = compute_indicators(make_df(closes))
    signals = detect_signals(df)
    types = {s["type"] for s in signals}
    assert "rsi_oversold" in types
