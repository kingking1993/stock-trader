"""수동 자산 계좌 — API가 없는 증권사(NH·KB 등)의 보유 자산을 직접 등록.

보유 종목·수량·평단·현금만 입력하면 시세는 KIS/Alpaca로 자동 평가된다.
backend/manual_accounts.json 에 저장 (자격증명 아님 — 평문 JSON).
"""
from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path

from app.services import alpaca_service
from app.services.kr_universe import is_kr_symbol, kr_name

_FILE = Path(__file__).resolve().parent.parent.parent / "manual_accounts.json"
_lock = threading.Lock()


def _load() -> list[dict]:
    try:
        return json.loads(_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(accounts: list[dict]) -> None:
    _FILE.write_text(json.dumps(accounts, ensure_ascii=False, indent=2), encoding="utf-8")


def list_accounts() -> list[dict]:
    with _lock:
        return _load()


def upsert(account: dict) -> dict:
    """{id?, label, currency(KRW|USD), cash, positions:[{symbol, qty, avg_price}]}"""
    with _lock:
        accounts = _load()
        if not account.get("id"):
            account["id"] = uuid.uuid4().hex[:8]
            accounts.append(account)
        else:
            for i, a in enumerate(accounts):
                if a["id"] == account["id"]:
                    accounts[i] = account
                    break
            else:
                accounts.append(account)
        _save(accounts)
        return account


def delete(account_id: str) -> bool:
    with _lock:
        accounts = _load()
        remain = [a for a in accounts if a["id"] != account_id]
        _save(remain)
        return len(remain) < len(accounts)


def _quote_safe(symbol: str) -> float | None:
    try:
        if is_kr_symbol(symbol):
            from app.services import kis_service

            return kis_service.get_quote(symbol)["price"]
        return alpaca_service.get_quote(symbol)["price"]
    except Exception:
        return None


def valued_account(acc: dict) -> dict:
    """수동 계좌를 실시간 시세로 평가해 portfolio 계좌 형식으로 변환."""
    positions = []
    total_value = float(acc.get("cash", 0) or 0)
    for p in acc.get("positions", []):
        qty = float(p.get("qty", 0) or 0)
        avg = float(p.get("avg_price", 0) or 0)
        price = _quote_safe(str(p.get("symbol", "")).upper())
        mv = price * qty if price else None
        if mv:
            total_value += mv
        positions.append(
            {
                "symbol": p.get("symbol"),
                "name": kr_name(str(p.get("symbol", ""))) or p.get("name"),
                "qty": qty,
                "avg_entry_price": avg,
                "current_price": price,
                "market_value": mv,
                "unrealized_pl": (price - avg) * qty if price and avg else None,
                "unrealized_plpc": (price / avg - 1) if price and avg else None,
            }
        )
    return {
        "broker": f"manual:{acc['id']}",
        "label": f"{acc.get('label', '수동 계좌')} (수동·조회전용)",
        "currency": acc.get("currency", "KRW"),
        "equity": round(total_value, 2),
        "cash": float(acc.get("cash", 0) or 0),
        "buying_power": None,
        "positions": positions,
        "error": None,
    }
