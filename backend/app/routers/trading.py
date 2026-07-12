"""포트폴리오(전계좌 합산) · 주문 API — 모든 주문은 pending → confirm 2단계."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.routers.deps import require_api_key
from app.services import alpaca_service, order_store
from app.services.fx import get_usd_krw

router = APIRouter(prefix="/api", tags=["trading"], dependencies=[Depends(require_api_key)])


def _alpaca_account() -> dict:
    acc = alpaca_service.get_account()
    positions = alpaca_service.get_positions()
    return {
        "broker": "alpaca",
        "label": "Alpaca 미국주식 (모의)" if acc["paper"] else "Alpaca 미국주식 (실전)",
        "currency": "USD",
        "equity": acc["equity"],
        "cash": acc["cash"],
        "buying_power": acc["buying_power"],
        "positions": positions,
        "error": None,
    }


def _kis_account() -> dict:
    from app.services import kis_service

    bal = kis_service.get_balance()
    return {
        "broker": "kis",
        "label": "한국투자증권 (실계좌·조회전용)",
        "currency": "KRW",
        "equity": bal["equity"],
        "cash": bal["cash"],
        "buying_power": None,
        "positions": bal["positions"],
        "error": None,
    }


def _kis_vts_account() -> dict:
    from app.services import kis_service

    bal = kis_service.get_vts_balance_with_us()
    return {
        "broker": "kis_vts",
        "label": "한국투자증권 모의투자",
        "currency": "KRW",
        "equity": bal["equity"],
        "cash": bal["cash"],
        "buying_power": None,
        "positions": bal["positions"],
        "error": None,
    }


@router.get("/portfolio")
async def portfolio():
    """전계좌 합산 포트폴리오. 개별 계좌 실패는 error 필드로 표시하고 나머지는 반환."""
    from app.services import kis_service

    from app.services import manual_accounts
    from app.config import settings

    fetchers = [("alpaca", _alpaca_account)]
    if kis_service.kis_configured():
        fetchers.append(("kis", _kis_account))
    if kis_service.kis_vts_configured():
        fetchers.append(("kis_vts", _kis_vts_account))
    if settings.toss_client_id and settings.toss_client_secret:
        def _toss_account():
            from app.services import toss_service

            return toss_service.get_account_summary()

        fetchers.append(("toss", _toss_account))
    for acc in manual_accounts.list_accounts():
        fetchers.append((f"manual:{acc['id']}", (lambda a: lambda: manual_accounts.valued_account(a))(acc)))

    async def safe(name, fn):
        try:
            return await asyncio.to_thread(fn)
        except Exception as e:
            return {
                "broker": name,
                "label": name,
                "currency": "KRW" if name.startswith("kis") else "USD",
                "equity": None,
                "cash": None,
                "buying_power": None,
                "positions": [],
                "error": str(e),
            }

    accounts = list(await asyncio.gather(*(safe(n, f) for n, f in fetchers)))
    fx_rate, fx_source = await asyncio.to_thread(get_usd_krw)

    total_krw = 0.0
    total_usd = 0.0
    for acc in accounts:
        if acc["equity"] is None:
            continue
        if acc["currency"] == "USD":
            total_usd += acc["equity"]
            total_krw += acc["equity"] * fx_rate
        else:
            total_krw += acc["equity"]
            total_usd += acc["equity"] / fx_rate

    return {
        "total_krw": round(total_krw),
        "total_usd": round(total_usd, 2),
        "fx_rate": round(fx_rate, 2),
        "fx_source": fx_source,
        "accounts": accounts,
    }


class OrderIn(BaseModel):
    symbol: str
    side: str  # buy | sell
    qty: float
    order_type: str = "market"
    limit_price: float | None = None
    rationale: str = "사용자 수동 주문"
    broker: str | None = None  # kis_vts | alpaca | toss (미지정 시 자동)


@router.get("/orders/available-brokers")
async def order_brokers(symbol: str):
    """해당 종목에 주문 가능한 계좌 목록 + 예수금 (주문 화면용)."""
    brokers = order_store.available_brokers(symbol)

    # 계좌별 예수금 병기 (실패해도 목록은 반환)
    async def enrich(b: dict) -> dict:
        try:
            if b["broker"] == "alpaca":
                acc = await asyncio.to_thread(alpaca_service.get_account)
                b["cash_label"] = f"${acc['cash']:,.0f}"
            elif b["broker"] == "kis_vts":
                from app.services import kis_service

                bal = await asyncio.to_thread(kis_service.get_vts_balance)
                b["cash_label"] = f"₩{bal['cash']:,.0f}"
            elif b["broker"] == "toss":
                from app.config import settings

                if settings.toss_allow_orders:
                    from app.services import toss_service

                    summary = await asyncio.to_thread(toss_service.get_account_summary)
                    b["cash_label"] = f"₩{summary['cash']:,.0f}"
        except Exception:
            b["cash_label"] = None
        return b

    return {"symbol": symbol.upper(), "brokers": list(await asyncio.gather(*(enrich(b) for b in brokers)))}


@router.get("/orders")
async def orders():
    try:
        broker = await asyncio.to_thread(alpaca_service.list_orders, 20)
    except Exception:
        broker = []
    return {"broker": broker, "pending": order_store.list_pending()}


@router.post("/orders")
async def create_order(body: OrderIn):
    """수동 주문도 pending으로 생성 → confirm 해야 실행 (단일 안전 경로)."""
    try:
        order = await asyncio.to_thread(
            order_store.propose,
            body.symbol,
            body.side.lower(),
            body.qty,
            body.order_type.lower(),
            body.limit_price,
            body.rationale,
            body.broker,
        )
        return order.to_dict()
    except order_store.OrderError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orders/pending")
async def pending_orders():
    return order_store.list_pending()


@router.post("/orders/{order_id}/confirm")
async def confirm_order(order_id: str):
    """사용자 승인 — 이 시점에만 실제 브로커 주문이 나간다."""
    try:
        return await asyncio.to_thread(order_store.confirm, order_id)
    except order_store.OrderError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"주문 실행 실패: {e}")


@router.post("/orders/{order_id}/reject")
async def reject_order(order_id: str):
    try:
        return order_store.reject(order_id)
    except order_store.OrderError as e:
        raise HTTPException(status_code=400, detail=str(e))
