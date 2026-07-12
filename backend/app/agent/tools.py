"""Claude Agent SDK 커스텀 툴 — 인프로세스 MCP 서버로 에이전트에 노출.

멀티마켓: 6자리 숫자 심볼 = 국내 주식(KIS), 그 외 = 미국 주식(Alpaca).
주문은 propose_order로 '제안'만 가능 — 사용자가 앱에서 승인해야 실행되며,
국내 주문은 KIS 모의투자로만 나간다.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from app.indicators import compute_indicators, detect_signals
from app.services import alpaca_service, order_store, screener
from app.services.kr_universe import is_kr_symbol, kr_name, search_kr_by_name
from app.services.screener import ScreenFilters, VALID_SIGNAL_TYPES


def _ok(data: Any) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False, default=str)}]}


def _err(msg: str) -> dict:
    return {"content": [{"type": "text", "text": msg}], "is_error": True}


def _quote_any(symbol: str) -> dict:
    if is_kr_symbol(symbol):
        from app.services import kis_service

        q = kis_service.get_quote(symbol)
        q["name"] = kr_name(symbol)
        q["currency"] = "KRW"
        return q
    q = alpaca_service.get_quote(symbol)
    q["currency"] = "USD"
    return q


def _bars_any(symbol: str):
    if is_kr_symbol(symbol):
        from app.services import kis_service

        return kis_service.get_daily_bars(symbol)
    return alpaca_service.get_bars(symbol, "1D").get(symbol)


@tool(
    "get_quote",
    "주식 현재가 조회. 미국 티커(예: AAPL) 또는 한국 6자리 종목코드(예: 005930=삼성전자) 지원",
    {"symbol": str},
)
async def get_quote(args: dict[str, Any]) -> dict:
    try:
        return _ok(await asyncio.to_thread(_quote_any, args["symbol"].upper()))
    except Exception as e:
        return _err(f"시세 조회 실패: {e}")


@tool(
    "get_indicators",
    "일봉 기반 기술 지표(SMA 5/20/60/120, EMA, RSI14, MACD, 볼린저밴드)와 최근 시그널 조회. 미국 티커/한국 6자리 코드 지원",
    {"symbol": str},
)
async def get_indicators(args: dict[str, Any]) -> dict:
    symbol = args["symbol"].upper()

    def work():
        bars = _bars_any(symbol)
        if bars is None or len(bars) < 30:
            raise ValueError(f"{symbol}의 봉 데이터가 부족합니다")
        ind = compute_indicators(bars)
        signals = detect_signals(ind, lookback=5)
        cols = [
            "close", "volume", "sma_5", "sma_20", "sma_60", "sma_120",
            "rsi_14", "macd", "macd_signal", "bb_upper", "bb_lower",
        ]
        recent = ind[cols].tail(10).round(2)
        return {
            "symbol": symbol,
            "name": kr_name(symbol) if is_kr_symbol(symbol) else None,
            "currency": "KRW" if is_kr_symbol(symbol) else "USD",
            "as_of": str(ind.index[-1].date()),
            "latest": recent.iloc[-1].to_dict(),
            "recent_10_days": [
                {"date": str(idx.date()), **row.to_dict()} for idx, row in recent.iterrows()
            ],
            "signals": signals,
        }

    try:
        return _ok(await asyncio.to_thread(work))
    except Exception as e:
        return _err(f"지표 계산 실패: {e}")


@tool(
    "search_kr_stock",
    "한국 종목명으로 6자리 종목코드 검색 (예: '삼성전자' → 005930)",
    {"query": str},
)
async def search_kr_stock(args: dict[str, Any]) -> dict:
    results = search_kr_by_name(str(args.get("query", "")))
    if not results:
        return _err("유니버스에서 해당 이름의 종목을 찾지 못했습니다")
    return _ok([{"symbol": c, "name": n} for c, n in results])


@tool(
    "scan_market",
    "시장 유니버스를 스캔해 기술 지표 시그널 점수 상위 종목 반환. market: US(미국 대형주 35) 또는 KR(한국 대형주 50)",
    {"market": str, "top_n": int},
)
async def scan_market(args: dict[str, Any]) -> dict:
    try:
        market = str(args.get("market", "US") or "US").upper()
        top_n = min(int(args.get("top_n", 10) or 10), 20)
        return _ok(await screener.scan_async(market, ScreenFilters(top_n=top_n)))
    except Exception as e:
        return _err(f"스캔 실패: {e}")


@tool(
    "screen_stocks",
    "사용자 정의 필터로 종목 스크리닝 (시총 상위 100 유니버스). market: US|KR. rsi_min/rsi_max: RSI 범위. "
    f"require_signals: 쉼표구분 시그널(모두 충족, 가능값: {','.join(sorted(VALID_SIGNAL_TYPES))}). "
    "min_score: 최소 점수. vol_ratio_min: 거래량÷20일평균 하한(거래량 급증=2.0). "
    "sort: score|change(급등순)|vol_ratio(거래량순)|rank(시총순). "
    "사용 예: '거래량 터진 국내 급등주' → market=KR, vol_ratio_min=2, sort=change",
    {
        "market": str,
        "rsi_min": float,
        "rsi_max": float,
        "require_signals": str,
        "min_score": float,
        "vol_ratio_min": float,
        "sort": str,
        "top_n": int,
    },
)
async def screen_stocks(args: dict[str, Any]) -> dict:
    try:
        market = str(args.get("market", "US") or "US").upper()
        req = str(args.get("require_signals", "") or "")
        require_signals = [s.strip() for s in req.split(",") if s.strip()]
        unknown = set(require_signals) - VALID_SIGNAL_TYPES
        if unknown:
            return _err(f"알 수 없는 시그널: {unknown}")
        sort = str(args.get("sort", "score") or "score")
        filters = ScreenFilters(
            rsi_min=float(args["rsi_min"]) if args.get("rsi_min") is not None else None,
            rsi_max=float(args["rsi_max"]) if args.get("rsi_max") is not None else None,
            require_signals=require_signals,
            min_score=float(args["min_score"]) if args.get("min_score") is not None else None,
            vol_ratio_min=float(args["vol_ratio_min"]) if args.get("vol_ratio_min") is not None else None,
            sort=sort if sort in {"score", "change", "vol_ratio", "rank"} else "score",
            top_n=min(int(args.get("top_n", 10) or 10), 30),
        )
        results = await screener.scan_async(market, filters)
        return _ok({"market": market, "count": len(results), "results": results})
    except Exception as e:
        return _err(f"스크리닝 실패: {e}")


@tool(
    "get_market_movers",
    "시장 '전체'에서 오늘의 급등주 순위를 조회한다 (시총 유니버스 무관). market: US|KR. "
    "vol_ratio_min: 거래량÷20일평균 하한(거래량 급증 필터, 예: 2.0). 정규장 외에는 직전 거래일 순위.",
    {"market": str, "top_n": int, "vol_ratio_min": float},
)
async def get_market_movers(args: dict[str, Any]) -> dict:
    from app.services import movers as movers_service

    try:
        market = str(args.get("market", "US") or "US").upper()
        top_n = min(int(args.get("top_n", 10) or 10), 30)
        filters = None
        if args.get("vol_ratio_min") is not None:
            filters = ScreenFilters(vol_ratio_min=float(args["vol_ratio_min"]))
        results = await asyncio.to_thread(movers_service.movers_with_indicators, market, top_n, filters)
        return _ok({"market": market, "count": len(results), "results": results})
    except Exception as e:
        return _err(f"급등주 조회 실패: {e}")


@tool(
    "get_sector_performance",
    "산업군(섹터)별 등락률 순위를 조회한다 (섹터 평균 등락 + 소속 종목별 등락). market: US|KR. "
    "'오늘 어느 섹터가 강한가' 같은 질문에 사용. 섹터 평균은 소속 종목 단순평균.",
    {"market": str},
)
async def get_sector_performance(args: dict[str, Any]) -> dict:
    from app.services import sectors as sectors_service

    try:
        market = str(args.get("market", "KR") or "KR").upper()
        results = await sectors_service.sector_performance_async(market, "change")
        # 토큰 절약: 섹터 요약 + 각 섹터 상위 3종목만
        compact = [
            {
                "sector": s["sector"],
                "avg_change_pct": s["avg_change_pct"],
                "up/down": f"{s['up_count']}/{s['down_count']}",
                "top3": [
                    {"symbol": m["symbol"], "name": m["name"], "change_pct": m["change_pct"]}
                    for m in s["members"][:3]
                ],
            }
            for s in results
        ]
        return _ok({"market": market, "sectors": compact})
    except Exception as e:
        return _err(f"섹터 조회 실패: {e}")


@tool("get_all_portfolios", "전 계좌(Alpaca 미국 + 한국투자 실계좌/모의) 자산과 보유 종목을 합산 조회한다", {})
async def get_all_portfolios(args: dict[str, Any]) -> dict:
    from app.services import kis_service
    from app.services.fx import get_usd_krw

    def work():
        out = {"accounts": []}
        try:
            acc = alpaca_service.get_account()
            out["accounts"].append(
                {"broker": "alpaca", "currency": "USD", "equity": acc["equity"], "cash": acc["cash"],
                 "positions": alpaca_service.get_positions()}
            )
        except Exception as e:
            out["accounts"].append({"broker": "alpaca", "error": str(e)})
        from app.config import settings

        if kis_service.kis_configured() and settings.kis_account:
            try:
                bal = kis_service.get_balance()
                out["accounts"].append({"broker": "kis(실계좌·조회전용)", **bal})
            except Exception as e:
                out["accounts"].append({"broker": "kis", "error": str(e)})
        if kis_service.kis_vts_configured():
            try:
                bal = kis_service.get_vts_balance()
                out["accounts"].append({"broker": "kis_모의투자", **bal})
            except Exception as e:
                out["accounts"].append({"broker": "kis_vts", "error": str(e)})
        rate, src = get_usd_krw()
        total_krw = 0.0
        for a in out["accounts"]:
            eq = a.get("equity")
            if eq is None:
                continue
            total_krw += eq * rate if a.get("currency") == "USD" else eq
        out["fx_usd_krw"] = rate
        out["total_krw"] = round(total_krw)
        return out

    try:
        return _ok(await asyncio.to_thread(work))
    except Exception as e:
        return _err(f"포트폴리오 조회 실패: {e}")


@tool("get_account", "미국(Alpaca) 계좌 요약 조회", {})
async def get_account(args: dict[str, Any]) -> dict:
    try:
        return _ok(await asyncio.to_thread(alpaca_service.get_account))
    except Exception as e:
        return _err(f"계좌 조회 실패: {e}")


@tool("get_positions", "미국(Alpaca) 보유 포지션 목록 조회", {})
async def get_positions(args: dict[str, Any]) -> dict:
    try:
        return _ok(await asyncio.to_thread(alpaca_service.get_positions))
    except Exception as e:
        return _err(f"포지션 조회 실패: {e}")


@tool(
    "propose_order",
    "매수/매도 주문을 '제안'한다. 즉시 실행되지 않으며 사용자가 앱에서 승인해야 실행된다. "
    "미국 티커는 Alpaca, 한국 6자리 코드는 KIS 모의투자로 라우팅된다. "
    "rationale에는 제안 근거가 된 지표를 반드시 적는다.",
    {
        "symbol": str,
        "side": str,  # buy | sell
        "qty": float,
        "order_type": str,  # market | limit
        "limit_price": float,
        "rationale": str,
        "broker": str,  # kis_vts | alpaca | toss (선택)
    },
)
async def propose_order(args: dict[str, Any]) -> dict:
    try:
        order = await asyncio.to_thread(
            order_store.propose,
            args["symbol"],
            str(args["side"]).lower(),
            float(args["qty"]),
            str(args.get("order_type", "market") or "market").lower(),
            float(args["limit_price"]) if args.get("limit_price") else None,
            str(args.get("rationale", "")),
            str(args["broker"]).lower() if args.get("broker") else None,
        )
        return _ok(
            {
                "message": "주문이 제안되었습니다. 사용자가 앱에서 승인해야 실제 주문이 실행됩니다.",
                "pending_order": order.to_dict(),
            }
        )
    except order_store.OrderError as e:
        return _err(f"주문 제안 거부: {e}")
    except Exception as e:
        return _err(f"주문 제안 실패: {e}")


TOOLS = [
    get_quote, get_indicators, search_kr_stock, scan_market, screen_stocks,
    get_market_movers, get_sector_performance, get_all_portfolios, get_account,
    get_positions, propose_order,
]

stock_server = create_sdk_mcp_server(name="stock", version="2.0.0", tools=TOOLS)

ALLOWED_TOOL_NAMES = [
    "mcp__stock__get_quote",
    "mcp__stock__get_indicators",
    "mcp__stock__search_kr_stock",
    "mcp__stock__scan_market",
    "mcp__stock__screen_stocks",
    "mcp__stock__get_market_movers",
    "mcp__stock__get_sector_performance",
    "mcp__stock__get_all_portfolios",
    "mcp__stock__get_account",
    "mcp__stock__get_positions",
    "mcp__stock__propose_order",
]
