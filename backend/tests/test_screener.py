from app.services.screener import ScreenFilters, screen_rows


def row(symbol="AAA", score=10, price=100.0, rsi=50.0, signals=(), change=0.0, vol_ratio=1.0, rank=1):
    return {
        "symbol": symbol,
        "name": None,
        "rank": rank,
        "score": score,
        "price": price,
        "change_pct": change,
        "rsi_14": rsi,
        "sma5_gap_pct": None,
        "sma20_gap_pct": None,
        "sma60_gap_pct": None,
        "vol_ratio": vol_ratio,
        "signals": [{"type": t, "direction": "bullish", "label": t, "days_ago": 0} for t in signals],
    }


def test_no_filters_sorts_by_score():
    rows = [row("A", score=5), row("B", score=50), row("C", score=20)]
    out = screen_rows(rows, ScreenFilters())
    assert [r["symbol"] for r in out] == ["B", "C", "A"]


def test_rsi_range_inclusive_bounds():
    rows = [row("A", rsi=29.9), row("B", rsi=30.0), row("C", rsi=70.1)]
    out = screen_rows(rows, ScreenFilters(rsi_min=30.0, rsi_max=70.0))
    assert [r["symbol"] for r in out] == ["B"]


def test_rsi_filter_excludes_none_rsi():
    rows = [row("A", rsi=None), row("B", rsi=25.0)]
    out = screen_rows(rows, ScreenFilters(rsi_max=30.0))
    assert [r["symbol"] for r in out] == ["B"]


def test_require_signals_is_and_condition():
    rows = [
        row("A", signals=("golden_cross",)),
        row("B", signals=("golden_cross", "uptrend")),
        row("C", signals=("uptrend",)),
    ]
    out = screen_rows(rows, ScreenFilters(require_signals=["golden_cross", "uptrend"]))
    assert [r["symbol"] for r in out] == ["B"]


def test_price_range_and_min_score():
    rows = [
        row("A", price=50.0, score=40),
        row("B", price=500.0, score=40),
        row("C", price=100.0, score=5),
    ]
    out = screen_rows(rows, ScreenFilters(price_min=60.0, price_max=1000.0, min_score=10))
    assert [r["symbol"] for r in out] == ["B"]


def test_top_n_limits_results():
    rows = [row(f"S{i}", score=i) for i in range(30)]
    out = screen_rows(rows, ScreenFilters(top_n=7))
    assert len(out) == 7
    assert out[0]["symbol"] == "S29"


def test_vol_ratio_min_filter():
    rows = [row("A", vol_ratio=1.9), row("B", vol_ratio=2.0), row("C", vol_ratio=None)]
    out = screen_rows(rows, ScreenFilters(vol_ratio_min=2.0))
    assert [r["symbol"] for r in out] == ["B"]


def test_sort_change_is_top_gainers():
    rows = [row("A", change=1.0), row("B", change=9.5), row("C", change=-3.0)]
    out = screen_rows(rows, ScreenFilters(sort="change"))
    assert [r["symbol"] for r in out] == ["B", "A", "C"]


def test_sort_vol_ratio_desc_none_last():
    rows = [row("A", vol_ratio=1.2), row("B", vol_ratio=3.4), row("C", vol_ratio=None)]
    out = screen_rows(rows, ScreenFilters(sort="vol_ratio"))
    assert [r["symbol"] for r in out] == ["B", "A", "C"]


def test_sort_rank_is_market_cap_order():
    rows = [row("A", rank=3), row("B", rank=1), row("C", rank=2)]
    out = screen_rows(rows, ScreenFilters(sort="rank"))
    assert [r["symbol"] for r in out] == ["B", "C", "A"]


def test_gainers_with_volume_surge_combo():
    rows = [
        row("A", change=8.0, vol_ratio=3.0),
        row("B", change=12.0, vol_ratio=1.1),  # 급등했지만 거래량 안 터짐 → 제외
        row("C", change=5.0, vol_ratio=2.5),
    ]
    out = screen_rows(rows, ScreenFilters(vol_ratio_min=2.0, sort="change"))
    assert [r["symbol"] for r in out] == ["A", "C"]
