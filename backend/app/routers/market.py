"""시세/차트 조회 API — 심볼 라우팅: 6자리 숫자 = 국내(KIS), 그 외 = 미국(Alpaca)."""
from __future__ import annotations

import asyncio

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from app.indicators import compute_indicators, detect_signals
from app.routers.deps import require_api_key
from app.services import alpaca_service
from app.services.kr_universe import is_kr_symbol, kr_name, search_kr_by_name

router = APIRouter(prefix="/api/market", tags=["market"], dependencies=[Depends(require_api_key)])


@router.get("/quote/{symbol}")
async def quote(symbol: str):
    symbol = symbol.upper()
    try:
        if is_kr_symbol(symbol):
            from app.services import kis_service

            return await asyncio.to_thread(kis_service.get_quote, symbol)
        return await asyncio.to_thread(alpaca_service.get_quote, symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"시세 조회 실패: {e}")


@router.get("/search")
async def search(q: str):
    """국내 종목명 검색 (유니버스 내)."""
    return [{"symbol": c, "name": n} for c, n in search_kr_by_name(q)]


@router.get("/chart/{symbol}")
async def chart(symbol: str, timeframe: str = "1D", limit: int = 120):
    """차트용 봉 + 지표. 국내 종목은 일봉만 지원."""
    symbol = symbol.upper()

    def work():
        if is_kr_symbol(symbol):
            from app.services import kis_service

            if timeframe == "1M":
                bars = kis_service.get_minute_bars(symbol)
                if not bars.empty:
                    bars = bars.set_index(pd.to_datetime(bars["time"], format="%H%M%S", errors="coerce")).drop(columns=["time"])
            elif timeframe in ("1W", "1MO"):
                bars = kis_service.get_period_bars(symbol, "W" if timeframe == "1W" else "M")
            else:
                bars = kis_service.get_daily_bars(symbol)
            name = kr_name(symbol)
            currency = "KRW"
        else:
            bars = alpaca_service.get_bars(symbol, timeframe).get(symbol)
            name = None
            currency = "USD"
        if bars is None or bars.empty:
            raise ValueError("봉 데이터가 없습니다 (분봉은 장중에만 제공됩니다)")
        ind = compute_indicators(bars)
        signals = detect_signals(ind, lookback=5)
        tail = ind.tail(limit)

        def col(col_name):
            if col_name not in tail.columns:
                return []
            return [None if pd.isna(v) else round(float(v), 4) for v in tail[col_name]]

        return {
            "symbol": symbol,
            "name": name,
            "currency": currency,
            "timeframe": timeframe,
            "timestamps": [ts.isoformat() for ts in tail.index],
            "open": col("open"),
            "high": col("high"),
            "low": col("low"),
            "close": col("close"),
            "volume": col("volume"),
            "sma_5": col("sma_5"),
            "sma_20": col("sma_20"),
            "sma_60": col("sma_60"),
            "rsi_14": col("rsi_14"),
            "macd": col("macd"),
            "macd_signal": col("macd_signal"),
            "bb_upper": col("bb_upper"),
            "bb_lower": col("bb_lower"),
            "signals": signals,
        }

    try:
        return await asyncio.to_thread(work)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"차트 조회 실패: {e}")
