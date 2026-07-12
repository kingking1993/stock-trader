"""USD/KRW 환율 — frankfurter.app(ECB 기반, 무료·키 불필요), 1시간 캐시."""
from __future__ import annotations

import time

import httpx

_cache: dict = {"rate": None, "at": 0.0}
_FALLBACK = 1400.0  # 조회 실패 시 근사값 (합산 표시용)
_TTL = 3600


def get_usd_krw() -> tuple[float, str]:
    """(환율, 출처) 반환. 출처: 'live' | 'cached' | 'fallback'"""
    now = time.time()
    if _cache["rate"] and now - _cache["at"] < _TTL:
        return _cache["rate"], "cached"
    sources = [
        ("https://open.er-api.com/v6/latest/USD", lambda j: j["rates"]["KRW"]),
        ("https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW", lambda j: j["rates"]["KRW"]),
    ]
    for url, parse in sources:
        try:
            r = httpx.get(url, timeout=5)
            r.raise_for_status()
            rate = float(parse(r.json()))
            _cache["rate"], _cache["at"] = rate, now
            return rate, "live"
        except Exception:
            continue
    if _cache["rate"]:
        return _cache["rate"], "cached"
    return _FALLBACK, "fallback"
