"""주문 안전장치 — 제안(pending) → 사용자 승인(confirm) 시에만 실제 주문 실행.

브로커 라우팅: 6자리 숫자 심볼 = 국내(KIS 모의투자), 그 외 = 미국(Alpaca).
실전 KIS 키로는 절대 주문하지 않는다.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

from app.config import settings
from app.services import alpaca_service
from app.services.kr_universe import is_kr_symbol, kr_name


@dataclass
class PendingOrder:
    symbol: str
    side: str  # buy | sell
    qty: float
    order_type: str = "market"  # market | limit
    limit_price: float | None = None
    est_price: float | None = None
    rationale: str = ""
    broker: str = "alpaca"  # alpaca | kis_vts
    name: str | None = None  # 국내 종목명
    currency: str = "USD"
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: float = field(default_factory=time.time)
    status: str = "pending"  # pending | confirmed | rejected | expired

    @property
    def est_value(self) -> float | None:
        price = self.limit_price or self.est_price
        return round(price * self.qty, 2) if price else None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "name": self.name,
            "side": self.side,
            "qty": self.qty,
            "order_type": self.order_type,
            "limit_price": self.limit_price,
            "est_price": self.est_price,
            "est_value": self.est_value,
            "rationale": self.rationale,
            "broker": self.broker,
            "currency": self.currency,
            "status": self.status,
            "created_at": self.created_at,
            "expires_in": max(0, int(settings.pending_order_ttl - (time.time() - self.created_at))),
        }


_orders: dict[str, PendingOrder] = {}


class OrderError(Exception):
    pass


def _expire_stale() -> None:
    now = time.time()
    for o in _orders.values():
        if o.status == "pending" and now - o.created_at > settings.pending_order_ttl:
            o.status = "expired"


def available_brokers(symbol: str) -> list[dict]:
    """해당 종목에 주문 가능한 계좌 목록 (주문 화면용)."""
    from app.config import settings
    from app.services import kis_service

    symbol = symbol.upper()
    kr = is_kr_symbol(symbol)
    out = []
    if kr:
        if kis_service.kis_vts_configured():
            out.append({"broker": "kis_vts", "label": "한국투자 모의", "live": False, "note": "모의투자 (가상자금)"})
        if kis_service.kis_configured() and settings.kis_account:
            out.append(
                {
                    "broker": "kis_real",
                    "label": "한투 실전 (실제 돈)",
                    "live": True,
                    "note": "⚠ 실제 돈이 사용됩니다" if settings.kis_allow_real_orders else "실전 주문 꺼짐 (연동 관리에서 켜기)",
                    "enabled": settings.kis_allow_real_orders,
                }
            )
    else:
        out.append({"broker": "alpaca", "label": "Alpaca 모의", "live": not settings.alpaca_paper, "note": "페이퍼 (가상자금)"})
        if kis_service.kis_vts_configured():
            out.append({"broker": "kis_vts", "label": "한투 모의 (미국)", "live": False, "note": "모의투자 · 지정가만 가능"})
    if settings.toss_client_id and settings.toss_client_secret:
        out.append(
            {
                "broker": "toss",
                "label": "토스증권 실전",
                "live": True,
                "note": "⚠ 실제 돈이 사용됩니다" if settings.toss_allow_orders else "주문 허용 꺼짐 (연동 관리에서 켜기)",
                "enabled": settings.toss_allow_orders,
            }
        )
    for b in out:
        b.setdefault("enabled", True)
    return out


def propose(
    symbol: str,
    side: str,
    qty: float,
    order_type: str = "market",
    limit_price: float | None = None,
    rationale: str = "",
    broker: str | None = None,
) -> PendingOrder:
    from app.config import settings

    if side not in ("buy", "sell"):
        raise OrderError("side는 buy 또는 sell이어야 합니다")
    if qty <= 0:
        raise OrderError("수량은 0보다 커야 합니다")
    if order_type not in ("market", "limit"):
        raise OrderError("order_type은 market 또는 limit이어야 합니다")
    if order_type == "limit" and not limit_price:
        raise OrderError("limit 주문에는 limit_price가 필요합니다")

    symbol = symbol.upper()
    kr = is_kr_symbol(symbol)

    # 브로커 결정 (미지정 시 자동 라우팅)
    valid = {b["broker"] for b in available_brokers(symbol)}
    if broker is None:
        broker = "kis_vts" if kr else "alpaca"
    if broker not in valid:
        raise OrderError(f"{symbol}에 사용할 수 없는 계좌입니다: {broker} (가능: {sorted(valid)})")
    if broker == "toss" and not settings.toss_allow_orders:
        raise OrderError("토스증권 실전 주문이 꺼져 있습니다 — 연동 관리에서 '실전 주문 허용'을 켜세요")
    if broker == "kis_real" and not settings.kis_allow_real_orders:
        raise OrderError("한투 실계좌 주문이 꺼져 있습니다 — 연동 관리에서 '실전 주문 허용'을 켜세요")
    if broker == "kis_vts" and kr:
        from app.services import kis_service

        if not kis_service.kis_vts_configured():
            raise OrderError("국내 주문은 KIS 모의투자 키(KIS_VTS_*) 설정 후 가능합니다")

    try:
        if kr:
            from app.services import kis_service

            est_price = kis_service.get_quote(symbol)["price"]
        else:
            est_price = alpaca_service.get_quote(symbol)["price"]
    except Exception:
        est_price = None

    order = PendingOrder(
        symbol=symbol,
        side=side,
        qty=qty,
        order_type=order_type,
        limit_price=limit_price,
        est_price=est_price,
        rationale=rationale,
        broker=broker,
        name=kr_name(symbol) if kr else None,
        currency="KRW" if kr else "USD",
    )

    cap = settings.max_order_value_krw if kr else settings.max_order_value
    if order.est_value and order.est_value > cap:
        unit = "₩" if kr else "$"
        raise OrderError(
            f"주문 예상금액 {unit}{order.est_value:,.0f}이 1회 상한 {unit}{cap:,.0f}을 초과합니다"
        )
    _orders[order.id] = order
    return order


def list_pending() -> list[dict]:
    _expire_stale()
    return [o.to_dict() for o in _orders.values() if o.status == "pending"]


def get(order_id: str) -> PendingOrder:
    _expire_stale()
    order = _orders.get(order_id)
    if order is None:
        raise OrderError("주문을 찾을 수 없습니다")
    return order


def confirm(order_id: str) -> dict:
    """사용자 승인 → 이 시점에만 실제 브로커 주문 실행."""
    order = get(order_id)
    if order.status != "pending":
        raise OrderError(f"이미 처리된 주문입니다 (status={order.status})")

    kr = is_kr_symbol(order.symbol)
    if order.broker == "toss":
        from app.services import toss_service

        result = toss_service.submit_order(
            symbol=order.symbol,
            side=order.side,
            qty=order.qty,
            order_type=order.order_type,
            limit_price=order.limit_price,
        )
    elif order.broker == "kis_real":
        from app.config import settings
        from app.services import kis_service

        if not settings.kis_allow_real_orders:
            raise OrderError("한투 실계좌 주문이 꺼져 있습니다")
        result = kis_service.submit_real_order(
            code=order.symbol,
            side=order.side,
            qty=order.qty,
            order_type=order.order_type,
            limit_price=order.limit_price,
        )
    elif order.broker == "kis_vts" and not kr:
        from app.services import kis_service

        # KIS 모의 해외는 지정가만 — 시장가 요청은 현재가 지정가로 자동 변환됨
        result = kis_service.submit_us_order(
            symbol=order.symbol,
            side=order.side,
            qty=order.qty,
            limit_price=order.limit_price,
        )
    elif order.broker == "kis_vts":
        from app.services import kis_service

        result = kis_service.submit_order(
            code=order.symbol,
            side=order.side,
            qty=order.qty,
            order_type=order.order_type,
            limit_price=order.limit_price,
        )
    else:
        result = alpaca_service.submit_order(
            symbol=order.symbol,
            side=order.side,
            qty=order.qty,
            order_type=order.order_type,
            limit_price=order.limit_price,
        )
    order.status = "confirmed"
    return {"pending_order": order.to_dict(), "broker_order": result}


def reject(order_id: str) -> dict:
    order = get(order_id)
    if order.status != "pending":
        raise OrderError(f"이미 처리된 주문입니다 (status={order.status})")
    order.status = "rejected"
    return order.to_dict()
