"""추천/스크리닝 API — 점수순 추천 + 사용자 정의 필터 스크리닝."""
from __future__ import annotations

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, TextBlock, query
from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.routers.deps import require_api_key
from app.services import screener
from app.services.screener import ScreenFilters, VALID_SIGNAL_TYPES, VALID_SORTS

router = APIRouter(prefix="/api", tags=["recommend"], dependencies=[Depends(require_api_key)])


@router.get("/recommend")
async def recommend(market: str = "US", top: int = 5, analyze: bool = False):
    """점수순 상위 종목. analyze=true면 AI 종합 코멘트 포함 (느림)."""
    market = market.upper()
    try:
        candidates = await screener.scan_async(market, ScreenFilters(top_n=min(top, 20)))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"스크리너 실패: {e}")

    import os

    ai_summary = None
    ai_available = bool(settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY"))
    if analyze and candidates and ai_available:
        try:
            ai_summary = await _ai_commentary(candidates)
        except Exception as e:
            ai_summary = f"(AI 분석 실패: {e})"
    elif analyze and not ai_available:
        ai_summary = "(이 서버는 AI 분석이 비활성화되어 있습니다)"

    return {"market": market, "candidates": candidates, "ai_summary": ai_summary}


@router.get("/screen")
async def screen(
    market: str = "US",
    rsi_min: float | None = None,
    rsi_max: float | None = None,
    price_min: float | None = None,
    price_max: float | None = None,
    signals: str | None = Query(default=None, description="쉼표구분, 모두 충족(AND). 예: golden_cross,uptrend"),
    min_score: float | None = None,
    vol_ratio_min: float | None = Query(default=None, description="거래량(주식수)÷20일평균 하한"),
    value_ratio_min: float | None = Query(default=None, description="거래대금(금액)÷20일평균 하한. 급증 필터는 2.0"),
    sort: str = Query(default="score", description="score|change(급등순)|vol_ratio(거래량순)|rank(시총순)"),
    top: int = 20,
):
    """사용자 정의 필터 스크리닝."""
    market = market.upper()
    if sort not in VALID_SORTS:
        raise HTTPException(status_code=400, detail=f"sort는 {sorted(VALID_SORTS)} 중 하나여야 합니다")
    require_signals = []
    if signals:
        require_signals = [s.strip() for s in signals.split(",") if s.strip()]
        unknown = set(require_signals) - VALID_SIGNAL_TYPES
        if unknown:
            raise HTTPException(status_code=400, detail=f"알 수 없는 시그널: {unknown}. 가능: {sorted(VALID_SIGNAL_TYPES)}")

    filters = ScreenFilters(
        rsi_min=rsi_min,
        rsi_max=rsi_max,
        price_min=price_min,
        price_max=price_max,
        require_signals=require_signals,
        min_score=min_score,
        vol_ratio_min=vol_ratio_min,
        value_ratio_min=value_ratio_min,
        sort=sort,
        top_n=min(top, 100),
    )
    try:
        results = await screener.scan_async(market, filters)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"스크리닝 실패: {e}")
    return {"market": market, "count": len(results), "results": results}


@router.get("/movers")
async def market_movers(
    market: str = "US",
    value_ratio_min: float | None = None,
    exclude_small: bool = True,
    top: int = 20,
):
    """시장 '전체' 급등주(단타) 순위. exclude_small=true면 최소 거래대금(KR 100억/US $10M) 미만 제외.
    1/5/10분 등락은 장중에만 값이 있음 (장외 null)."""
    import asyncio

    from app.services import movers as movers_service

    market = market.upper()
    filters = ScreenFilters(value_ratio_min=value_ratio_min) if value_ratio_min is not None else None
    min_value = movers_service.DEFAULT_MIN_VALUE.get(market) if exclude_small else None
    try:
        results = await asyncio.to_thread(
            movers_service.movers_with_indicators, market, min(top, 50), filters, min_value
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"급등주 조회 실패: {e}")
    return {"market": market, "count": len(results), "results": results}


@router.get("/sectors")
async def sectors(market: str = "KR", member_sort: str = "change"):
    """산업군별 등락 — 섹터 평균(단순평균) + 소속 종목. member_sort: rank|change|vol_ratio"""
    from app.services import sectors as sectors_service

    market = market.upper()
    if member_sort not in ("rank", "change", "vol_ratio"):
        raise HTTPException(status_code=400, detail="member_sort는 rank|change|vol_ratio 중 하나여야 합니다")
    try:
        results = await sectors_service.sector_performance_async(market, member_sort)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"섹터 집계 실패: {e}")
    return {"market": market, "note": "섹터 등락률은 소속 종목 단순평균 (시총 가중 아님)", "sectors": results}


async def _ai_commentary(candidates: list[dict]) -> str:
    """스크리너 결과를 한 번의 쿼리로 요약 (툴 사용 없음)."""
    import json

    prompt = (
        "다음은 기술 지표 스크리너가 뽑은 주식 상위 후보들이다 (score는 시그널 가중 합계, 6자리 숫자 심볼은 한국 주식).\n"
        f"{json.dumps(candidates, ensure_ascii=False, default=str)}\n\n"
        "각 종목의 시그널을 근거로 한국어로 간결한 종합 코멘트를 작성하라. "
        "종목별 1-2문장, 마지막에 투자 유의 문구 한 줄. 서두 없이 본문만."
    )
    options = ClaudeAgentOptions(
        model=settings.agent_model,
        max_turns=1,
        allowed_tools=[],
        system_prompt="당신은 주식 기술적 분석 전문가입니다. 한국어로 답합니다.",
    )
    parts: list[str] = []
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    parts.append(block.text)
    return "\n".join(parts).strip()
