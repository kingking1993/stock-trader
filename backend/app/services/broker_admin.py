"""증권사 연동 관리 — 앱에서 입력한 자격증명을 .env에 반영하고 클라이언트 캐시를 갱신.

이 서버는 개인 PC에서 도는 1인용 백엔드라 자격증명 저장소는 .env를 그대로 사용한다.
응답에는 항상 마스킹된 키만 내려간다 (전체 값 노출 금지).
"""
from __future__ import annotations

import re
import threading
from pathlib import Path

from app.config import settings

ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"
_lock = threading.Lock()

# 브로커별 .env 필드 정의 (순서 = 입력 폼 순서)
BROKER_FIELDS: dict[str, list[dict]] = {
    "alpaca": [
        {"env": "ALPACA_API_KEY", "label": "API Key", "secret": False},
        {"env": "ALPACA_SECRET_KEY", "label": "Secret Key", "secret": True},
    ],
    "kis": [
        {"env": "KIS_APP_KEY", "label": "App Key (실전)", "secret": False},
        {"env": "KIS_APP_SECRET", "label": "App Secret (실전)", "secret": True},
        {"env": "KIS_ACCOUNT", "label": "계좌번호 (예: 12345678-01)", "secret": False},
    ],
    "kis_vts": [
        {"env": "KIS_VTS_APP_KEY", "label": "App Key (모의)", "secret": False},
        {"env": "KIS_VTS_APP_SECRET", "label": "App Secret (모의)", "secret": True},
        {"env": "KIS_VTS_ACCOUNT", "label": "모의계좌번호", "secret": False},
    ],
    "toss": [
        {"env": "TOSS_CLIENT_ID", "label": "Client ID", "secret": False},
        {"env": "TOSS_CLIENT_SECRET", "label": "Client Secret", "secret": True},
    ],
}

BROKER_LABELS = {
    "alpaca": "Alpaca (미국주식)",
    "kis": "한국투자증권 실전 (조회 전용)",
    "kis_vts": "한국투자증권 모의투자 (국내 주문)",
    "toss": "토스증권 (실계좌 · 주문은 별도 허용 필요)",
}


def _mask(v: str) -> str:
    if not v:
        return ""
    if len(v) <= 8:
        return v[:2] + "•" * (len(v) - 2)
    return v[:4] + "•" * 6 + v[-4:]


def _reset_caches() -> None:
    """자격증명 변경 후 기존 클라이언트 무효화."""
    try:
        from app.services import alpaca_service

        alpaca_service.data_client.cache_clear()
        alpaca_service.trading_client.cache_clear()
    except Exception:
        pass
    try:
        from app.services import kis_service

        with kis_service._client_lock:
            kis_service._clients.clear()
    except Exception:
        pass


def set_credentials(broker: str, values: dict[str, str]) -> None:
    """values: {ENV_KEY: value}. .env 파일과 런타임 settings를 함께 갱신."""
    fields = BROKER_FIELDS.get(broker)
    if fields is None:
        raise ValueError(f"알 수 없는 브로커: {broker}")
    allowed = {f["env"] for f in fields}
    updates = {k: str(v).strip() for k, v in values.items() if k in allowed and str(v).strip()}
    if not updates:
        raise ValueError("입력된 값이 없습니다")

    with _lock:
        text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
        lines = text.splitlines()
        for key, value in updates.items():
            pattern = re.compile(rf"^{re.escape(key)}=")
            for i, line in enumerate(lines):
                if pattern.match(line):
                    lines[i] = f"{key}={value}"
                    break
            else:
                lines.append(f"{key}={value}")
            setattr(settings, key.lower(), value)
        ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    _reset_caches()


def set_env_flag(key: str, value: str) -> None:
    """단일 env 플래그 갱신 (예: TOSS_ALLOW_ORDERS)."""
    with _lock:
        text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
        lines = text.splitlines()
        pattern = re.compile(rf"^{re.escape(key)}=")
        for i, line in enumerate(lines):
            if pattern.match(line):
                lines[i] = f"{key}={value}"
                break
        else:
            lines.append(f"{key}={value}")
        ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # settings의 bool 필드 갱신
    attr = key.lower()
    if hasattr(settings, attr):
        setattr(settings, attr, value.lower() in ("true", "1", "yes"))


def clear_credentials(broker: str) -> None:
    fields = BROKER_FIELDS.get(broker)
    if fields is None:
        raise ValueError(f"알 수 없는 브로커: {broker}")
    with _lock:
        text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
        lines = text.splitlines()
        for f in fields:
            key = f["env"]
            pattern = re.compile(rf"^{re.escape(key)}=")
            lines = [f"{key}=" if pattern.match(l) else l for l in lines]
            setattr(settings, key.lower(), "")
        ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    _reset_caches()


def status() -> list[dict]:
    out = []
    for broker, fields in BROKER_FIELDS.items():
        vals = {f["env"]: getattr(settings, f["env"].lower(), "") for f in fields}
        configured = all(vals[f["env"]] for f in fields)
        out.append(
            {
                "broker": broker,
                "label": BROKER_LABELS[broker],
                "configured": configured,
                "allow_orders": (
                    settings.toss_allow_orders if broker == "toss"
                    else settings.kis_allow_real_orders if broker == "kis"
                    else None
                ),
                "fields": [
                    {
                        "env": f["env"],
                        "label": f["label"],
                        "secret": f["secret"],
                        "masked": _mask(vals[f["env"]]),
                        "set": bool(vals[f["env"]]),
                    }
                    for f in fields
                ],
            }
        )
    return out


def test_connection(broker: str) -> dict:
    """브로커별 저비용 호출로 연결 확인."""
    try:
        if broker == "alpaca":
            from app.services import alpaca_service

            acc = alpaca_service.get_account()
            return {"ok": True, "detail": f"계좌 확인 (평가액 ${acc['equity']:,.0f}, {'모의' if acc['paper'] else '실전'})"}
        if broker == "kis":
            from app.services import kis_service

            q = kis_service.get_quote("005930")
            detail = f"시세 확인 (삼성전자 ₩{q['price']:,.0f})"
            if settings.kis_account:
                bal = kis_service.get_balance()
                detail += f" · 실계좌 평가 ₩{bal['equity']:,.0f}"
            return {"ok": True, "detail": detail}
        if broker == "kis_vts":
            from app.services import kis_service

            bal = kis_service.get_vts_balance()
            return {"ok": True, "detail": f"모의계좌 확인 (평가 ₩{bal['equity']:,.0f})"}
        if broker == "toss":
            from app.services import toss_service

            return toss_service.test_connection()
        return {"ok": False, "detail": f"알 수 없는 브로커: {broker}"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}
