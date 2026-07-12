"""시장 전체 급등주(단타) — 미국: Alpaca movers(전체 시장), 한국: KIS 등락률 순위(전체 시장).

단타용 확장:
- 1/5/10분 등락률 (분봉, 60초 캐시 — 장외엔 null)
- 거래대금(오늘 누적)·거래대금 배수(20일 평균 대비) — 주식 수가 아닌 금액 기준
- 최소 거래대금 필터 (저유동성 동전주 제외)
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.config import settings
from app.services import alpaca_service, screener
from app.services.kr_universe import kr_name
from app.services.screener import ScreenFilters
from app.services.us_names_ko import us_name_ko

_BASE_TTL = 300  # 순위+일봉 지표 5분
_MIN_TTL = 60  # 분봉 등락 60초
_base_cache: dict[str, tuple[float, list[dict]]] = {}
_minute_cache: dict[str, tuple[float, dict[str, dict]]] = {}
_lock = threading.Lock()

# 최소 거래대금 기본값 (소형주 제외)
# 주의: US는 무료 IEX 피드 기준이라 실제 거래대금의 일부만 집계됨 → 기준값을 낮게 잡음
DEFAULT_MIN_VALUE = {"KR": 10_000_000_000.0, "US": 1_000_000.0}  # 100억원 / IEX $1M(실제 수천만$ 수준)


def us_movers(top: int = 20) -> list[dict]:
    from alpaca.data.enums import MarketType
    from alpaca.data.historical.screener import ScreenerClient
    from alpaca.data.requests import MarketMoversRequest

    client = ScreenerClient(settings.alpaca_api_key, settings.alpaca_secret_key)
    movers = client.get_market_movers(MarketMoversRequest(top=min(top, 50), market_type=MarketType.STOCKS))

    def is_warrant_like(sym: str) -> bool:
        # 워런트/유닛/권리 등 파생 증권 제외 (.WS, .U, .RT, 5자 이상 W로 끝나는 티커)
        if any(sym.endswith(sfx) for sfx in (".WS", ".U", ".RT", ".WT")):
            return True
        return len(sym) >= 5 and sym.endswith("W")

    return [
        {
            "symbol": m.symbol,
            "name": us_name_ko(m.symbol),
            "price": float(m.price),
            "change_pct": round(float(m.percent_change), 2),
        }
        for m in movers.gainers
        if not is_warrant_like(m.symbol)
    ]


def kr_movers(top: int = 20) -> list[dict]:
    from app.services import kis_service

    data = kis_service.real_client().request(
        "GET",
        "/uapi/domestic-stock/v1/ranking/fluctuation",
        tr_id="FHPST01700000",
        params={
            "fid_cond_mrkt_div_code": "J",
            "fid_cond_scr_div_code": "20170",
            "fid_input_iscd": "0000",  # 전체 시장
            "fid_rank_sort_cls_code": "0",  # 0: 상승률 순
            "fid_input_cnt_1": "0",
            "fid_prc_cls_code": "0",
            "fid_input_price_1": "",
            "fid_input_price_2": "",
            "fid_vol_cnt": "",
            "fid_trgt_cls_code": "0",
            "fid_trgt_exls_cls_code": "0",
            "fid_div_cls_code": "0",
            "fid_rsfl_rate1": "",
            "fid_rsfl_rate2": "",
        },
    )
    # ETN/ETF/스팩 등 파생·특수 상품 제외 (일반 주식만)
    _EXCLUDE_NAME = ("ETN", "ETF", "레버리지", "인버스", "선물", "스팩", "KODEX", "TIGER", "PLUS", "SOL ")

    out = []
    for r in data.get("output", []):
        if len(out) >= top:
            break
        code = r.get("stck_shrn_iscd") or r.get("mksc_shrn_iscd") or ""
        name_raw = r.get("hts_kor_isnm") or ""
        if not (len(code) == 6 and code.isdigit()):
            continue
        if any(k in name_raw.upper() for k in _EXCLUDE_NAME):
            continue
        try:
            out.append(
                {
                    "symbol": code,
                    "name": name_raw or kr_name(code),
                    "price": float(r.get("stck_prpr", 0) or 0),
                    "change_pct": round(float(r.get("prdy_ctrt", 0) or 0), 2),
                }
            )
        except (TypeError, ValueError):
            continue
    return out


def _fallback_row(m: dict, rank: int) -> dict:
    return {
        "symbol": m["symbol"],
        "name": m.get("name"),
        "rank": rank,
        "score": 0,
        "price": m["price"],
        "change_pct": m["change_pct"],
        "rsi_14": None,
        "sma5_gap_pct": None,
        "sma20_gap_pct": None,
        "sma60_gap_pct": None,
        "sma120_gap_pct": None,
        "vol_ratio": None,
        "value_today": None,
        "value_ratio": None,
        "signals": [],
    }


def _minute_changes(closes: list[float]) -> dict:
    """1분봉 종가 배열(과거→현재)에서 1/5/10분 등락률."""
    out = {"chg_1m": None, "chg_5m": None, "chg_10m": None}
    if not closes:
        return out
    last = closes[-1]
    for key, n in (("chg_1m", 1), ("chg_5m", 5), ("chg_10m", 10)):
        if len(closes) > n and closes[-1 - n]:
            out[key] = round((last / closes[-1 - n] - 1) * 100, 2)
    return out


def _fetch_minute_overlay(market: str, symbols: list[str]) -> dict[str, dict]:
    """심볼별 1/5/10분 등락률. 장외 시간엔 빈 값."""
    overlay: dict[str, dict] = {}
    try:
        if market == "KR":
            from app.services import kis_service

            def fetch(sym):
                try:
                    df = kis_service.get_minute_bars(sym)
                    if df.empty:
                        return sym, {}
                    return sym, _minute_changes(list(df["close"]))
                except Exception:
                    return sym, {}

            with ThreadPoolExecutor(max_workers=6) as pool:
                for sym, chg in pool.map(fetch, symbols):
                    overlay[sym] = chg or {}
        else:
            bars = alpaca_service.get_minute_bars(symbols, minutes=40)
            for sym in symbols:
                df = bars.get(sym)
                overlay[sym] = _minute_changes(list(df["close"])) if df is not None and not df.empty else {}
    except Exception:
        pass
    return overlay


def _base_rows(market: str) -> list[dict]:
    with _lock:
        cached = _base_cache.get(market)
        if cached and time.time() - cached[0] < _BASE_TTL:
            return cached[1]

    raw = kr_movers(top=50) if market == "KR" else us_movers(top=50)
    symbols = [m["symbol"] for m in raw]

    bars = {}
    if market == "KR":
        from app.services import kis_service

        def fetch(sym):
            try:
                return sym, kis_service.get_daily_bars(sym, extended=False)
            except Exception:
                return sym, None

        with ThreadPoolExecutor(max_workers=6) as pool:
            for sym, df in pool.map(fetch, symbols):
                if df is not None and not df.empty:
                    bars[sym] = df
    else:
        try:
            bars = alpaca_service.get_bars(symbols, timeframe="1D")
        except Exception:
            bars = {}

    rows = []
    for i, m in enumerate(raw, start=1):
        row = screener._row(m["symbol"], m.get("name"), i, bars.get(m["symbol"]))
        if row is None:
            row = _fallback_row(m, i)
        else:
            row["price"] = m["price"]
            row["change_pct"] = m["change_pct"]
            if not row.get("name"):
                row["name"] = m.get("name")
        rows.append(row)

    with _lock:
        _base_cache[market] = (time.time(), rows)
    return rows


def movers_with_indicators(
    market: str = "US",
    top: int = 20,
    filters: ScreenFilters | None = None,
    min_value: float | None = None,
) -> list[dict]:
    market = market.upper()
    rows = _base_rows(market)

    # 분봉 오버레이 (60초 캐시)
    with _lock:
        cached = _minute_cache.get(market)
        overlay = cached[1] if cached and time.time() - cached[0] < _MIN_TTL else None
    if overlay is None:
        overlay = _fetch_minute_overlay(market, [r["symbol"] for r in rows])
        with _lock:
            _minute_cache[market] = (time.time(), overlay)

    out = []
    for r in rows:
        merged = {**r, "chg_1m": None, "chg_5m": None, "chg_10m": None, **overlay.get(r["symbol"], {})}
        # 최소 거래대금 필터 (거래대금 미상인 종목은 보수적으로 제외)
        if min_value is not None:
            if merged.get("value_today") is None or merged["value_today"] < min_value:
                continue
        if filters is not None and not screener._passes(merged, filters):
            continue
        out.append(merged)
    return out[:top]
