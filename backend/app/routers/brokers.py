"""계좌 연동 관리 API — 자격증명 입력/삭제/테스트 + 수동 자산 계좌."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.routers.deps import require_api_key
from app.services import broker_admin, manual_accounts

router = APIRouter(prefix="/api/brokers", tags=["brokers"], dependencies=[Depends(require_api_key)])


@router.get("")
async def list_brokers():
    return {"brokers": broker_admin.status(), "manual": manual_accounts.list_accounts()}


class CredsIn(BaseModel):
    values: dict[str, str]


@router.post("/{broker}")
async def set_broker(broker: str, body: CredsIn):
    try:
        broker_admin.set_credentials(broker, body.values)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    result = await asyncio.to_thread(broker_admin.test_connection, broker)
    return {"saved": True, "test": result}


class AllowOrdersIn(BaseModel):
    allow: bool


@router.post("/toss/allow-orders")
async def toss_allow_orders(body: AllowOrdersIn):
    """토스증권 실전 주문 허용 토글 — 실제 돈이 나가는 스위치."""
    broker_admin.set_env_flag("TOSS_ALLOW_ORDERS", "true" if body.allow else "false")
    return {"allow": body.allow}


@router.post("/kis/allow-orders")
async def kis_allow_orders(body: AllowOrdersIn):
    """한투 실계좌 주문 허용 토글 — 실제 돈이 나가는 스위치."""
    broker_admin.set_env_flag("KIS_ALLOW_REAL_ORDERS", "true" if body.allow else "false")
    return {"allow": body.allow}


@router.post("/{broker}/test")
async def test_broker(broker: str):
    return await asyncio.to_thread(broker_admin.test_connection, broker)


@router.delete("/{broker}")
async def delete_broker(broker: str):
    try:
        broker_admin.clear_credentials(broker)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"deleted": True}


class ManualPosition(BaseModel):
    symbol: str
    qty: float
    avg_price: float = 0
    name: str | None = None


class ManualAccountIn(BaseModel):
    id: str | None = None
    label: str
    currency: str = "KRW"
    cash: float = 0
    positions: list[ManualPosition] = []


@router.post("/manual/accounts")
async def upsert_manual(body: ManualAccountIn):
    acc = manual_accounts.upsert(body.model_dump())
    return acc


@router.delete("/manual/accounts/{account_id}")
async def delete_manual(account_id: str):
    if not manual_accounts.delete(account_id):
        raise HTTPException(status_code=404, detail="계좌를 찾을 수 없습니다")
    return {"deleted": True}
