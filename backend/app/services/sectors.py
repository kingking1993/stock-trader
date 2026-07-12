"""산업군(섹터)별 등락 집계 — 유니버스 종목을 대표 섹터로 분류.

섹터 종합 상승률은 소속 종목 등락률의 '단순평균'이다 (시가총액 가중 아님).
봉 데이터는 screener의 10분 캐시를 재사용하므로 추가 API 호출이 없다.
"""
from __future__ import annotations

import asyncio

from app.services import screener
from app.services.kr_universe import KR_UNIVERSE

# ---------- 한국 20개 섹터 ----------
KR_SECTORS: dict[str, list[str]] = {
    "반도체/전자부품": ["005930", "000660", "042700", "009150", "011070", "034220", "066570"],
    "2차전지/소재": ["373220", "006400", "051910", "003670", "247540", "086520", "011790"],
    "바이오/제약": ["207940", "068270", "000100", "128940", "196170", "028300", "068760", "141080", "000250", "145020"],
    "방산/항공우주": ["012450", "047810", "064350", "272210", "103140"],
    "자동차/부품": ["005380", "000270", "012330", "161390"],
    "조선/해양": ["042660", "329180", "009540", "010620", "010140"],
    "은행/금융지주": ["105560", "055550", "086790", "316140", "024110", "138040", "323410"],
    "증권/보험": ["005940", "071050", "006800", "016360", "032830", "000810", "005830", "001450", "088350"],
    "인터넷/플랫폼": ["035420", "035720"],
    "게임": ["259960", "036570", "251270", "263750", "293490"],
    "엔터/콘텐츠": ["352820"],
    "화학/정유": ["096770", "010950", "009830", "011170"],
    "철강/비철금속": ["005490", "010130", "047050"],
    "전력/에너지설비": ["015760", "036460", "051600", "267260", "298040", "034020"],
    "통신": ["017670", "030200", "032640"],
    "음식료/유통": ["097950", "271560", "004370", "139480", "023530", "004170", "033780", "090430", "021240"],
    "건설/기계/로봇": ["000720", "042670", "277810", "000150"],
    "여행/레저": ["035250", "008770"],
    "해운/물류": ["011200", "086280"],
    "지주/IT서비스": ["034730", "003550", "028260", "018260", "402340", "267250"],
}

# ---------- 미국 20개 섹터 ----------
US_SECTORS: dict[str, list[str]] = {
    "반도체": ["NVDA", "AVGO", "AMD", "QCOM", "TXN", "MU", "INTC", "ADI", "KLAC", "AMAT"],
    "빅테크/플랫폼": ["AAPL", "GOOGL", "AMZN", "META", "NFLX", "UBER"],
    "소프트웨어/클라우드": ["MSFT", "ORCL", "CRM", "ADBE", "NOW", "INTU", "IBM", "CDNS", "SNPS"],
    "AI/네트워크/보안": ["PLTR", "PANW", "CRWD", "ANET", "CSCO"],
    "전기차/자동차": ["TSLA"],
    "바이오/제약": ["LLY", "JNJ", "ABBV", "MRK", "PFE", "AMGN", "GILD", "BMY", "VRTX"],
    "헬스케어 기기/서비스": ["UNH", "ABT", "ISRG", "BSX", "SYK", "MDT", "DHR"],
    "은행": ["JPM", "BAC", "WFC", "C", "GS", "MS"],
    "결제/핀테크": ["V", "MA", "AXP", "FI", "ADP"],
    "자산운용/거래소": ["BRK.B", "BLK", "SCHW", "SPGI", "CME"],
    "보험": ["PGR", "CB"],
    "에너지": ["XOM", "CVX", "COP"],
    "방산/항공": ["RTX", "BA", "LMT", "GE"],
    "산업재/기계": ["CAT", "DE", "ETN", "HON", "UNP", "WM", "APH", "LIN"],
    "소비재/유통": ["WMT", "COST", "HD", "LOW", "TJX"],
    "음식료/생활": ["PG", "KO", "PEP", "PM", "MCD", "SBUX"],
    "통신/미디어": ["TMUS", "T", "VZ", "DIS"],
    "유틸리티": ["NEE", "SO"],
    "리츠/데이터센터": ["PLD", "EQIX"],
    "여행/레저": ["BKNG"],
}


def sector_map(market: str) -> dict[str, list[str]]:
    return KR_SECTORS if market.upper() == "KR" else US_SECTORS


def sector_performance(market: str = "KR", member_sort: str = "change") -> list[dict]:
    """섹터별 평균 등락률 + 소속 종목 행. member_sort: rank(시총순)|change(상승률순)|vol_ratio(거래량순)"""
    market = market.upper()
    bars = screener._fetch_bars(market)
    universe = list(KR_UNIVERSE) if market == "KR" else screener.US_UNIVERSE
    names = KR_UNIVERSE if market == "KR" else {}
    rank_of = {sym: i for i, sym in enumerate(universe, start=1)}

    # 종목 행 계산 (스크리너와 동일 형식)
    rows: dict[str, dict] = {}
    for sym, df in bars.items():
        row = screener._row(sym, names.get(sym), rank_of.get(sym, 999), df)
        if row is not None:
            rows[sym] = row

    key, reverse = screener._SORT_KEYS.get(member_sort, screener._SORT_KEYS["change"])

    out = []
    for sector, symbols in sector_map(market).items():
        members = [rows[s] for s in symbols if s in rows]
        if not members:
            continue
        changes = [m["change_pct"] for m in members]
        members_sorted = sorted(members, key=key, reverse=reverse)
        out.append(
            {
                "sector": sector,
                "avg_change_pct": round(sum(changes) / len(changes), 2),
                "up_count": sum(1 for c in changes if c > 0),
                "down_count": sum(1 for c in changes if c < 0),
                "count": len(members),
                "members": members_sorted,
            }
        )
    out.sort(key=lambda s: s["avg_change_pct"], reverse=True)
    return out


async def sector_performance_async(market: str = "KR", member_sort: str = "change") -> list[dict]:
    return await asyncio.to_thread(sector_performance, market, member_sort)
