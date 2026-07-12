"""한국투자증권 KIS Developers API 래퍼.

키 2종 분리 운용:
- 실전 앱키(KIS_APP_KEY): 시세·일봉·실계좌 잔고 '조회 전용' — 이 모듈은 실전 키로 절대 주문하지 않는다.
- 모의 앱키(KIS_VTS_APP_KEY): 국내 주식 주문 실행 전용 (모의투자 서버).

제약: 토큰 발급 1분 1회(파일 캐시로 해결), 호출 실전 20건/초·모의 2건/초(스로틀).
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import pandas as pd

from app.config import settings

REAL_BASE = "https://openapi.koreainvestment.com:9443"
VTS_BASE = "https://openapivts.koreainvestment.com:29443"

_TOKEN_DIR = Path(__file__).resolve().parent.parent.parent  # backend/


class KISError(Exception):
    pass


class _KISClient:
    def __init__(self, app_key: str, app_secret: str, base_url: str, min_interval: float, tag: str):
        if not app_key or not app_secret:
            raise KISError("KIS API 키가 설정되지 않았습니다 (.env 확인)")
        self.app_key = app_key
        self.app_secret = app_secret
        self.base_url = base_url
        self.min_interval = min_interval
        self.token_file = _TOKEN_DIR / f".kis_token_{tag}.json"
        self._lock = threading.Lock()
        self._last_call = 0.0
        self._token: str | None = None
        self._token_expiry = 0.0
        self._load_token_cache()

    # ---------- 토큰 (발급 1분 1회 제한 → 파일 캐시) ----------
    def _load_token_cache(self) -> None:
        try:
            data = json.loads(self.token_file.read_text(encoding="utf-8"))
            if data.get("expiry", 0) > time.time() + 300:
                self._token = data["token"]
                self._token_expiry = data["expiry"]
        except Exception:
            pass

    def _get_token(self) -> str:
        if self._token and self._token_expiry > time.time() + 300:
            return self._token
        resp = httpx.post(
            f"{self.base_url}/oauth2/tokenP",
            json={"grant_type": "client_credentials", "appkey": self.app_key, "appsecret": self.app_secret},
            timeout=10,
        )
        body = resp.json()
        if "access_token" not in body:
            raise KISError(f"토큰 발급 실패: {body.get('error_description', body)}")
        self._token = body["access_token"]
        self._token_expiry = time.time() + int(body.get("expires_in", 86400))
        try:
            self.token_file.write_text(
                json.dumps({"token": self._token, "expiry": self._token_expiry}), encoding="utf-8"
            )
        except Exception:
            pass
        return self._token

    # ---------- 공통 요청 (스로틀 + 인증 헤더 + 한도초과 재시도) ----------
    def request(self, method: str, path: str, tr_id: str, params: dict | None = None, body: dict | None = None) -> dict:
        last_err: KISError | None = None
        for attempt in range(4):
            with self._lock:
                wait = self.min_interval - (time.time() - self._last_call)
                if wait > 0:
                    time.sleep(wait)
                self._last_call = time.time()

            headers = {
                "content-type": "application/json; charset=utf-8",
                "authorization": f"Bearer {self._get_token()}",
                "appkey": self.app_key,
                "appsecret": self.app_secret,
                "tr_id": tr_id,
                "custtype": "P",
            }
            url = f"{self.base_url}{path}"
            resp = httpx.request(method, url, headers=headers, params=params, json=body, timeout=15)
            data = resp.json()
            if data.get("rt_cd") == "0":
                return data
            # 초당 호출 한도 초과 → 잠시 쉬고 재시도
            if data.get("msg_cd") == "EGW00201":
                last_err = KISError(f"KIS 오류 [{data.get('msg_cd')}]: {data.get('msg1', '').strip()}")
                time.sleep(0.5 * (attempt + 1))
                continue
            raise KISError(f"KIS 오류 [{data.get('msg_cd')}]: {data.get('msg1', '').strip()}")
        raise last_err or KISError("KIS 호출 한도 초과 (재시도 실패)")


_clients: dict[str, _KISClient] = {}
_client_lock = threading.Lock()


def real_client() -> _KISClient:
    """실전 키 — 조회 전용."""
    with _client_lock:
        if "real" not in _clients:
            _clients["real"] = _KISClient(
                settings.kis_app_key, settings.kis_app_secret, REAL_BASE, min_interval=0.11, tag="real"
            )
        return _clients["real"]


def vts_client() -> _KISClient:
    """모의투자 키 — 주문 전용."""
    with _client_lock:
        if "vts" not in _clients:
            _clients["vts"] = _KISClient(
                settings.kis_vts_app_key, settings.kis_vts_app_secret, VTS_BASE, min_interval=0.55, tag="vts"
            )
        return _clients["vts"]


def kis_configured() -> bool:
    return bool(settings.kis_app_key and settings.kis_app_secret)


def kis_vts_configured() -> bool:
    return bool(settings.kis_vts_app_key and settings.kis_vts_app_secret and settings.kis_vts_account)


def _split_account(account: str) -> tuple[str, str]:
    """'12345678-01' 또는 '1234567801' → (CANO 8자리, 상품코드 2자리)"""
    acc = account.replace("-", "").strip()
    if len(acc) < 10:
        raise KISError(f"계좌번호 형식 오류: {account} (8자리-2자리 형식이어야 합니다)")
    return acc[:8], acc[8:10]


# ---------- 시세 (실전 키, 조회) ----------

def get_quote(code: str) -> dict:
    data = real_client().request(
        "GET",
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        tr_id="FHKST01010100",
        params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
    )
    out = data["output"]
    return {
        "symbol": code,
        "price": float(out["stck_prpr"]),
        "change_pct": float(out.get("prdy_ctrt", 0)),
        "volume": float(out.get("acml_vol", 0)),
        "timestamp": datetime.now().isoformat(),
    }


def _fetch_daily_range(code: str, start: datetime, end: datetime, period: str = "D") -> pd.DataFrame:
    """period: D(일) | W(주) | M(월) — 호출당 최대 100봉."""
    data = real_client().request(
        "GET",
        "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        tr_id="FHKST03010100",
        params={
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": code,
            "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
            "FID_INPUT_DATE_2": end.strftime("%Y%m%d"),
            "FID_PERIOD_DIV_CODE": period,
            "FID_ORG_ADJ_PRC": "0",  # 수정주가
        },
    )
    rows = [r for r in data.get("output2", []) if r.get("stck_bsop_date")]
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(
        {
            "date": [r["stck_bsop_date"] for r in rows],
            "open": [float(r["stck_oprc"]) for r in rows],
            "high": [float(r["stck_hgpr"]) for r in rows],
            "low": [float(r["stck_lwpr"]) for r in rows],
            "close": [float(r["stck_clpr"]) for r in rows],
            "volume": [float(r["acml_vol"]) for r in rows],
        }
    )
    df.index = pd.to_datetime(df["date"], format="%Y%m%d")
    return df.drop(columns=["date"]).sort_index()


def get_daily_bars(code: str, extended: bool = True) -> pd.DataFrame:
    """일봉 조회. extended=True: 약 190봉(2호출, SMA120 가능),
    False: 최근 ~95봉(1호출 — 대량 스캔용, SMA60까지 계산 가능)."""
    today = datetime.now()
    recent = _fetch_daily_range(code, today - timedelta(days=140), today)
    if not extended:
        return recent
    older = _fetch_daily_range(code, today - timedelta(days=281), today - timedelta(days=141))
    df = pd.concat([older, recent])
    return df[~df.index.duplicated(keep="last")].sort_index()


def get_period_bars(code: str, period: str = "W") -> pd.DataFrame:
    """주봉/월봉 (최대 100봉). period: W | M"""
    today = datetime.now()
    span_days = 760 if period == "W" else 3100  # 약 100주 / 100개월
    return _fetch_daily_range(code, today - timedelta(days=span_days), today, period=period)


def get_minute_bars(code: str) -> pd.DataFrame:
    """당일 1분봉 최근 30개 (KIS 제약: 호출당 30건, 당일만). 장외엔 빈 DF 가능."""
    now_hhmmss = datetime.now().strftime("%H%M%S")
    data = real_client().request(
        "GET",
        "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
        tr_id="FHKST03010200",
        params={
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": code,
            "FID_INPUT_HOUR_1": now_hhmmss,
            "FID_PW_DATA_INCU_YN": "Y",
            "FID_ETC_CLS_CODE": "",
        },
    )
    rows = [r for r in data.get("output2", []) if r.get("stck_cntg_hour")]
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(
        {
            "time": [r["stck_cntg_hour"] for r in rows],
            "close": [float(r.get("stck_prpr", 0) or 0) for r in rows],
            "open": [float(r.get("stck_oprc", 0) or 0) for r in rows],
            "high": [float(r.get("stck_hgpr", 0) or 0) for r in rows],
            "low": [float(r.get("stck_lwpr", 0) or 0) for r in rows],
            "volume": [float(r.get("cntg_vol", 0) or 0) for r in rows],
        }
    )
    return df.sort_values("time").reset_index(drop=True)


# ---------- 잔고 (실전 키, 읽기 전용) ----------

def get_balance() -> dict:
    if not settings.kis_account:
        raise KISError("KIS_ACCOUNT(실계좌번호)가 설정되지 않았습니다")
    cano, prdt = _split_account(settings.kis_account)
    data = real_client().request(
        "GET",
        "/uapi/domestic-stock/v1/trading/inquire-balance",
        tr_id="TTTC8434R",
        params={
            "CANO": cano,
            "ACNT_PRDT_CD": prdt,
            "AFHR_FLPR_YN": "N",
            "OFL_YN": "",
            "INQR_DVSN": "02",
            "UNPR_DVSN": "01",
            "FUND_STTL_ICLD_YN": "N",
            "FNCG_AMT_AUTO_RDPT_YN": "N",
            "PRCS_DVSN": "00",
            "CTX_AREA_FK100": "",
            "CTX_AREA_NK100": "",
        },
    )
    positions = []
    for row in data.get("output1", []):
        qty = float(row.get("hldg_qty", 0) or 0)
        if qty <= 0:
            continue
        positions.append(
            {
                "symbol": row["pdno"],
                "name": row.get("prdt_name", ""),
                "qty": qty,
                "avg_entry_price": float(row.get("pchs_avg_pric", 0) or 0),
                "current_price": float(row.get("prpr", 0) or 0),
                "market_value": float(row.get("evlu_amt", 0) or 0),
                "unrealized_pl": float(row.get("evlu_pfls_amt", 0) or 0),
                "unrealized_plpc": float(row.get("evlu_pfls_rt", 0) or 0) / 100,
            }
        )
    summary_rows = data.get("output2") or [{}]
    summary = summary_rows[0] if isinstance(summary_rows, list) else summary_rows
    return {
        "currency": "KRW",
        "equity": float(summary.get("tot_evlu_amt", 0) or 0),
        "cash": float(summary.get("dnca_tot_amt", 0) or 0),
        "positions": positions,
    }


def get_vts_balance_with_us() -> dict:
    """모의계좌 국내 + 미국 보유분 합산 (미국은 원화 환산)."""
    bal = get_vts_balance()
    try:
        from app.services.fx import get_usd_krw

        us = get_vts_us_positions()
        if us:
            fx, _ = get_usd_krw()
            for p in us:
                for f in ("avg_entry_price", "current_price", "market_value", "unrealized_pl"):
                    if p.get(f) is not None:
                        p[f] = round(p[f] * fx, 2)
                p.pop("currency", None)
                bal["positions"].append(p)
                if p.get("market_value"):
                    bal["equity"] += p["market_value"]
    except Exception:
        pass
    return bal


# ---------- 해외주식 (모의투자 키 전용) ----------

_us_exchange_cache: dict[str, str] = {}


def submit_us_order(symbol: str, side: str, qty: float, limit_price: float | None = None) -> dict:
    """미국 주식 모의 주문 — KIS 모의투자는 지정가만 지원.
    limit_price가 없으면(시장가 요청) 현재가로 지정가 자동 변환."""
    if not kis_vts_configured():
        raise KISError("모의투자 키(KIS_VTS_*)가 설정되지 않았습니다")
    if limit_price is None:
        from app.services import alpaca_service

        limit_price = alpaca_service.get_quote(symbol)["price"]
    cano, prdt = _split_account(settings.kis_vts_account)
    is_buy = side.lower() == "buy"

    exchanges = [_us_exchange_cache[symbol]] if symbol in _us_exchange_cache else ["NASD", "NYSE", "AMEX"]
    last_err: Exception | None = None
    for exch in exchanges:
        body = {
            "CANO": cano,
            "ACNT_PRDT_CD": prdt,
            "OVRS_EXCG_CD": exch,
            "PDNO": symbol,
            "ORD_QTY": str(int(qty)),
            "OVRS_ORD_UNPR": f"{limit_price:.2f}",
            "ORD_SVR_DVSN_CD": "0",
            "ORD_DVSN": "00",  # 모의투자는 지정가만
        }
        try:
            data = vts_client().request(
                "POST",
                "/uapi/overseas-stock/v1/trading/order",
                tr_id="VTTT1002U" if is_buy else "VTTT1001U",
                body=body,
            )
            _us_exchange_cache[symbol] = exch
            out = data.get("output", {})
            return {
                "id": out.get("ODNO", ""),
                "symbol": symbol,
                "side": side,
                "qty": qty,
                "type": "limit",
                "limit_price": limit_price,
                "status": "accepted",
                "broker": "kis_vts",
                "message": f"{data.get('msg1', '').strip()} (지정가 ${limit_price:.2f}, 거래소 {exch})",
                "submitted_at": datetime.now().isoformat(),
            }
        except KISError as e:
            last_err = e
            continue
    raise last_err or KISError("해외 주문 실패")


def get_vts_us_positions() -> list[dict]:
    """모의계좌 미국 보유분 (원화 환산은 호출측에서)."""
    if not kis_vts_configured():
        return []
    cano, prdt = _split_account(settings.kis_vts_account)
    data = vts_client().request(
        "GET",
        "/uapi/overseas-stock/v1/trading/inquire-balance",
        tr_id="VTTS3012R",
        params={
            "CANO": cano,
            "ACNT_PRDT_CD": prdt,
            "OVRS_EXCG_CD": "NASD",
            "TR_CRCY_CD": "USD",
            "CTX_AREA_FK200": "",
            "CTX_AREA_NK200": "",
        },
    )
    positions = []
    for row in data.get("output1", []):
        qty = float(row.get("ovrs_cblc_qty", 0) or 0)
        if qty <= 0:
            continue
        positions.append(
            {
                "symbol": row.get("ovrs_pdno", ""),
                "name": (row.get("ovrs_item_name") or row.get("ovrs_pdno", "")) + " 🇺🇸",
                "qty": qty,
                "avg_entry_price": float(row.get("pchs_avg_pric", 0) or 0),
                "current_price": float(row.get("now_pric2", 0) or 0),
                "market_value": float(row.get("ovrs_stck_evlu_amt", 0) or 0),
                "unrealized_pl": float(row.get("frcr_evlu_pfls_amt", 0) or 0),
                "unrealized_plpc": float(row.get("evlu_pfls_rt", 0) or 0) / 100,
                "currency": "USD",
            }
        )
    return positions


# ---------- 주문 (모의투자 키 전용) ----------

def submit_order(code: str, side: str, qty: float, order_type: str = "market", limit_price: float | None = None) -> dict:
    if not kis_vts_configured():
        raise KISError("모의투자 키(KIS_VTS_*)가 설정되지 않아 국내 주문을 실행할 수 없습니다")
    cano, prdt = _split_account(settings.kis_vts_account)
    is_buy = side.lower() == "buy"
    body = {
        "CANO": cano,
        "ACNT_PRDT_CD": prdt,
        "PDNO": code,
        "ORD_DVSN": "01" if order_type == "market" else "00",  # 01 시장가, 00 지정가
        "ORD_QTY": str(int(qty)),
        "ORD_UNPR": str(int(limit_price)) if (order_type == "limit" and limit_price) else "0",
        "EXCG_ID_DVSN_CD": "KRX",
    }
    data = vts_client().request(
        "POST",
        "/uapi/domestic-stock/v1/trading/order-cash",
        tr_id="VTTC0012U" if is_buy else "VTTC0011U",
        body=body,
    )
    out = data.get("output", {})
    return {
        "id": out.get("ODNO", ""),
        "symbol": code,
        "side": side,
        "qty": qty,
        "type": order_type,
        "status": "accepted",
        "broker": "kis_vts",
        "message": data.get("msg1", "").strip(),
        "submitted_at": datetime.now().isoformat(),
    }


def get_vts_balance() -> dict:
    """모의투자 계좌 잔고 (주문 연습 계좌 현황)."""
    if not kis_vts_configured():
        raise KISError("모의투자 키가 설정되지 않았습니다")
    cano, prdt = _split_account(settings.kis_vts_account)
    data = vts_client().request(
        "GET",
        "/uapi/domestic-stock/v1/trading/inquire-balance",
        tr_id="VTTC8434R",
        params={
            "CANO": cano,
            "ACNT_PRDT_CD": prdt,
            "AFHR_FLPR_YN": "N",
            "OFL_YN": "",
            "INQR_DVSN": "02",
            "UNPR_DVSN": "01",
            "FUND_STTL_ICLD_YN": "N",
            "FNCG_AMT_AUTO_RDPT_YN": "N",
            "PRCS_DVSN": "00",
            "CTX_AREA_FK100": "",
            "CTX_AREA_NK100": "",
        },
    )
    positions = []
    for row in data.get("output1", []):
        qty = float(row.get("hldg_qty", 0) or 0)
        if qty <= 0:
            continue
        positions.append(
            {
                "symbol": row["pdno"],
                "name": row.get("prdt_name", ""),
                "qty": qty,
                "avg_entry_price": float(row.get("pchs_avg_pric", 0) or 0),
                "current_price": float(row.get("prpr", 0) or 0),
                "market_value": float(row.get("evlu_amt", 0) or 0),
                "unrealized_pl": float(row.get("evlu_pfls_amt", 0) or 0),
                "unrealized_plpc": float(row.get("evlu_pfls_rt", 0) or 0) / 100,
            }
        )
    summary_rows = data.get("output2") or [{}]
    summary = summary_rows[0] if isinstance(summary_rows, list) else summary_rows
    return {
        "currency": "KRW",
        "equity": float(summary.get("tot_evlu_amt", 0) or 0),
        "cash": float(summary.get("dnca_tot_amt", 0) or 0),
        "positions": positions,
    }
