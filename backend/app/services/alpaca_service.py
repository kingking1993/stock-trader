"""alpaca-py 래퍼 — 시세 조회(무료 IEX 피드) + 계좌/주문 (paper/live 스위치)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache

import pandas as pd
from alpaca.data.enums import DataFeed
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest, StockLatestTradeRequest
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, QueryOrderStatus, TimeInForce
from alpaca.trading.requests import GetOrdersRequest, LimitOrderRequest, MarketOrderRequest

from app.config import settings

TIMEFRAMES: dict[str, tuple[TimeFrame, timedelta]] = {
    "1M": (TimeFrame.Minute, timedelta(hours=8)),  # 당일 분봉
    "1D": (TimeFrame.Day, timedelta(days=400)),
    "1W": (TimeFrame.Week, timedelta(days=760)),
    "1MO": (TimeFrame.Month, timedelta(days=3100)),
    "1H": (TimeFrame.Hour, timedelta(days=30)),
    "15Min": (TimeFrame(15, TimeFrameUnit.Minute), timedelta(days=7)),
}


@lru_cache(maxsize=1)
def data_client() -> StockHistoricalDataClient:
    return StockHistoricalDataClient(settings.alpaca_api_key, settings.alpaca_secret_key)


@lru_cache(maxsize=1)
def trading_client() -> TradingClient:
    return TradingClient(
        settings.alpaca_api_key, settings.alpaca_secret_key, paper=settings.alpaca_paper
    )


def get_quote(symbol: str) -> dict:
    """최근 체결가 기준 현재가."""
    req = StockLatestTradeRequest(symbol_or_symbols=symbol, feed=DataFeed.IEX)
    trade = data_client().get_stock_latest_trade(req)[symbol]
    return {
        "symbol": symbol,
        "price": float(trade.price),
        "timestamp": trade.timestamp.isoformat(),
    }


def get_bars(symbols: str | list[str], timeframe: str = "1D") -> dict[str, pd.DataFrame]:
    """심볼별 OHLCV DataFrame. 여러 심볼을 한 번의 요청으로 조회한다."""
    if isinstance(symbols, str):
        symbols = [symbols]
    tf, span = TIMEFRAMES.get(timeframe, TIMEFRAMES["1D"])
    req = StockBarsRequest(
        symbol_or_symbols=symbols,
        timeframe=tf,
        start=datetime.now(timezone.utc) - span,
        feed=DataFeed.IEX,
    )
    barset = data_client().get_stock_bars(req)
    df = barset.df  # MultiIndex (symbol, timestamp)
    out: dict[str, pd.DataFrame] = {}
    if df.empty:
        return out
    for sym in symbols:
        if sym in df.index.get_level_values(0):
            sub = df.xs(sym, level=0)[["open", "high", "low", "close", "volume"]].copy()
            sub.index = sub.index.tz_convert("UTC")
            out[sym] = sub
    return out


def get_minute_bars(symbols: str | list[str], minutes: int = 40) -> dict[str, pd.DataFrame]:
    """최근 N분의 1분봉 (여러 심볼 일괄, IEX). 장외엔 빈 결과 가능."""
    if isinstance(symbols, str):
        symbols = [symbols]
    req = StockBarsRequest(
        symbol_or_symbols=symbols,
        timeframe=TimeFrame.Minute,
        start=datetime.now(timezone.utc) - timedelta(minutes=minutes),
        feed=DataFeed.IEX,
    )
    barset = data_client().get_stock_bars(req)
    df = barset.df
    out: dict[str, pd.DataFrame] = {}
    if df.empty:
        return out
    for sym in symbols:
        if sym in df.index.get_level_values(0):
            sub = df.xs(sym, level=0)[["open", "high", "low", "close", "volume"]].copy()
            out[sym] = sub.sort_index()
    return out


def get_account() -> dict:
    acc = trading_client().get_account()
    return {
        "account_number": acc.account_number,
        "equity": float(acc.equity),
        "cash": float(acc.cash),
        "buying_power": float(acc.buying_power),
        "portfolio_value": float(acc.portfolio_value),
        "currency": acc.currency,
        "paper": settings.alpaca_paper,
    }


def get_positions() -> list[dict]:
    positions = trading_client().get_all_positions()
    return [
        {
            "symbol": p.symbol,
            "qty": float(p.qty),
            "avg_entry_price": float(p.avg_entry_price),
            "current_price": float(p.current_price) if p.current_price is not None else None,
            "market_value": float(p.market_value) if p.market_value is not None else None,
            "unrealized_pl": float(p.unrealized_pl) if p.unrealized_pl is not None else None,
            "unrealized_plpc": float(p.unrealized_plpc) if p.unrealized_plpc is not None else None,
        }
        for p in positions
    ]


def submit_order(
    symbol: str,
    side: str,
    qty: float,
    order_type: str = "market",
    limit_price: float | None = None,
) -> dict:
    """주문 실행. 반드시 order_store의 confirm 흐름을 거쳐 호출할 것."""
    order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL
    if order_type == "limit":
        if limit_price is None:
            raise ValueError("limit 주문에는 limit_price가 필요합니다")
        req = LimitOrderRequest(
            symbol=symbol,
            qty=qty,
            side=order_side,
            time_in_force=TimeInForce.DAY,
            limit_price=limit_price,
        )
    else:
        req = MarketOrderRequest(
            symbol=symbol, qty=qty, side=order_side, time_in_force=TimeInForce.DAY
        )
    order = trading_client().submit_order(req)
    return _order_to_dict(order)


def list_orders(limit: int = 20) -> list[dict]:
    req = GetOrdersRequest(status=QueryOrderStatus.ALL, limit=limit)
    return [_order_to_dict(o) for o in trading_client().get_orders(req)]


def _order_to_dict(o) -> dict:
    return {
        "id": str(o.id),
        "symbol": o.symbol,
        "side": o.side.value if o.side else None,
        "qty": float(o.qty) if o.qty else None,
        "type": o.order_type.value if o.order_type else None,
        "limit_price": float(o.limit_price) if o.limit_price else None,
        "status": o.status.value if o.status else None,
        "filled_qty": float(o.filled_qty) if o.filled_qty else None,
        "filled_avg_price": float(o.filled_avg_price) if o.filled_avg_price else None,
        "submitted_at": o.submitted_at.isoformat() if o.submitted_at else None,
    }
