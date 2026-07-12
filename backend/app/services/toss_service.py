"""토스증권 Open API 어댑터 (공식 OpenAPI 명세 v1.2.2 기준).

⚠ 토스증권은 모의투자가 없어 '실계좌 실전'이다.
- 잔고·보유종목 조회: 키만 있으면 동작
- 주문: settings.toss_allow_orders 가 True일 때만 허용 (기본 꺼짐)
- IP 허용 목록 필수: 토스증권 앱 → 설정 → Open API → 허용 IP 관리에 이 PC의 공인 IP 등록
- 토큰은 클라이언트당 1개만 유효 (재발급 시 기존 토큰 무효) → 파일 캐시 재사용
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import httpx

from app.config import settings

BASE = "https://openapi.tossinvest.com"
_TOKEN_FILE = Path(__file__).resolve().parent.parent.parent / ".toss_token.json"
_lock = threading.Lock()
_token_cache: dict = {"token": None, "expiry": 0.0}


class TossError(Exception):
    pass


def _load_token_file() -> None:
    try:
        data = json.loads(_TOKEN_FILE.read_text(encoding="utf-8"))
        if data.get("expiry", 0) > time.time() + 300:
            _token_cache.update(data)
    except Exception:
        pass


_load_token_file()


def _get_token() -> str:
    with _lock:
        if _token_cache["token"] and _token_cache["expiry"] > time.time() + 300:
            return _token_cache["token"]
        if not (settings.toss_client_id and settings.toss_client_secret):
            raise TossError("토스증권 키가 설정되지 않았습니다")
        resp = httpx.post(
            f"{BASE}/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": settings.toss_client_id,
                "client_secret": settings.toss_client_secret,
            },
            timeout=10,
        )
        body = resp.json()
        if "access_token" not in body:
            raise TossError(f"토큰 발급 실패: {body.get('error', body)}")
        _token_cache["token"] = body["access_token"]
        _token_cache["expiry"] = time.time() + int(body.get("expires_in", 86400))
        try:
            _TOKEN_FILE.write_text(json.dumps(_token_cache), encoding="utf-8")
        except Exception:
            pass
        return _token_cache["token"]


def _request(method: str, path: str, account_seq: int | None = None, params: dict | None = None, body: dict | None = None) -> dict:
    headers = {"Authorization": f"Bearer {_get_token()}"}
    if account_seq is not None:
        headers["X-Tossinvest-Account"] = str(account_seq)
    resp = httpx.request(method, f"{BASE}{path}", headers=headers, params=params, json=body, timeout=15)
    if resp.status_code == 403:
        raise TossError("403 접근 거부 — 토스증권 앱의 'Open API > 허용 IP 관리'에 이 PC의 공인 IP를 등록했는지 확인하세요")
    if resp.status_code == 429:
        raise TossError("호출 한도 초과 — 잠시 후 재시도")
    data = resp.json()
    if resp.status_code >= 400:
        raise TossError(f"토스 API 오류 [{resp.status_code}]: {data}")
    return data.get("result", data)


def _dec(v) -> float:
    """토스 금액 필드는 decimal 문자열."""
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _brokerage_account_seq() -> int:
    accounts = _request("GET", "/api/v1/accounts")
    for a in accounts if isinstance(accounts, list) else accounts.get("accounts", []):
        if a.get("accountType") == "BROKERAGE":
            return int(a["accountSeq"])
    raise TossError("위탁계좌(BROKERAGE)를 찾을 수 없습니다")


def test_connection() -> dict:
    seq = _brokerage_account_seq()
    return {"ok": True, "detail": f"토스증권 위탁계좌 연결 확인 (accountSeq={seq}) ⚠ 실계좌입니다"}


def get_account_summary() -> dict:
    """전계좌 합산 포트폴리오용 계좌 요약 — 원화 환산(달러 보유분은 환율 적용)."""
    from app.services.fx import get_usd_krw

    seq = _brokerage_account_seq()
    holdings = _request("GET", "/api/v1/holdings", account_seq=seq)
    fx, _src = get_usd_krw()

    def price_krw(p: dict | None) -> float:
        if not p:
            return 0.0
        return _dec(p.get("krw")) + _dec(p.get("usd")) * fx

    positions = []
    for item in holdings.get("items", []) or []:
        is_usd = item.get("currency") == "USD"
        rate = fx if is_usd else 1.0
        qty = _dec(item.get("quantity"))
        avg = _dec(item.get("averagePurchasePrice")) * rate
        cur = _dec(item.get("lastPrice")) * rate
        positions.append(
            {
                "symbol": item.get("symbol"),
                "name": (item.get("name") or item.get("symbol")) + (" 🇺🇸" if is_usd else ""),
                "qty": qty,
                "avg_entry_price": round(avg, 2),
                "current_price": round(cur, 2),
                "market_value": round(_dec(item.get("marketValue")) * rate, 2),
                "unrealized_pl": round(_dec(item.get("profitLoss")) * rate, 2),
                "unrealized_plpc": (cur / avg - 1) if avg else None,
            }
        )

    cash_krw = 0.0
    try:
        bp = _request("GET", "/api/v1/buying-power", account_seq=seq, params={"currency": "KRW"})
        cash_krw += _dec(bp.get("cashBuyingPower"))
        bp_usd = _request("GET", "/api/v1/buying-power", account_seq=seq, params={"currency": "USD"})
        cash_krw += _dec(bp_usd.get("cashBuyingPower")) * fx
    except Exception:
        pass

    market_value = price_krw(holdings.get("marketValue"))
    return {
        "broker": "toss",
        "label": "토스증권 (실계좌)",
        "currency": "KRW",
        "equity": round(market_value + cash_krw, 2),
        "cash": round(cash_krw, 2),
        "buying_power": round(cash_krw, 2),
        "positions": positions,
        "error": None,
    }


def submit_order(symbol: str, side: str, qty: float, order_type: str = "market", limit_price: float | None = None) -> dict:
    """⚠ 실전 주문. settings.toss_allow_orders 가 켜져 있어야만 실행."""
    if not settings.toss_allow_orders:
        raise TossError(
            "토스증권 실전 주문이 비활성화되어 있습니다 (.env에 TOSS_ALLOW_ORDERS=true 설정 시에만 가능)"
        )
    seq = _brokerage_account_seq()
    body: dict = {
        "symbol": symbol,
        "side": "BUY" if side.lower() == "buy" else "SELL",
        "orderType": "LIMIT" if order_type == "limit" else "MARKET",
        "quantity": str(int(qty)),
    }
    if order_type == "limit":
        if not limit_price:
            raise TossError("지정가 주문에는 가격이 필요합니다")
        body["price"] = str(int(limit_price)) if len(symbol) == 6 and symbol.isdigit() else f"{limit_price:.2f}"
    result = _request("POST", "/api/v1/orders", account_seq=seq, body=body)
    return {
        "id": result.get("orderId", ""),
        "symbol": symbol,
        "side": side,
        "qty": qty,
        "type": order_type,
        "status": "accepted",
        "broker": "toss",
        "submitted_at": None,
    }
