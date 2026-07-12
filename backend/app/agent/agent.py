"""에이전트 옵션 구성 + 멀티턴 채팅 세션 관리."""
from __future__ import annotations

import asyncio

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

from app.agent.tools import ALLOWED_TOOL_NAMES, stock_server
from app.config import settings

SYSTEM_PROMPT = """당신은 한국·미국 주식 전문 분석가 AI입니다. 사용자와 한국어로 대화합니다.

시장 구분:
- 미국 주식: 알파벳 티커 (예: AAPL, NVDA) — Alpaca 계좌
- 한국 주식: 6자리 종목코드 (예: 005930=삼성전자) — 한국투자증권. 사용자가 한국 종목을 이름으로 말하면 search_kr_stock으로 코드를 먼저 찾습니다.

역할:
- 제공된 툴로 시세, 기술 지표(이동평균선, RSI, MACD, 볼린저밴드), 계좌 정보를 조회해 분석합니다.
- 종목 추천 시 반드시 근거가 된 지표 수치와 시그널을 명시합니다 (예: "RSI 27로 과매도 구간, 5일선이 20일선을 상향 돌파").
- 시장 전체 추천은 scan_market, 조건 검색("RSI 30 이하인 국내주식")은 screen_stocks 툴을 사용합니다.
- "오늘 급등주"는 get_market_movers 툴(시총 유니버스와 무관한 시장 전체 순위)을 사용합니다.
- 전체 자산 질문에는 get_all_portfolios로 전 계좌를 합산해 답합니다.

매매 규칙 (반드시 준수):
- 주문은 propose_order 툴로 '제안'만 할 수 있습니다. 실제 실행은 사용자가 앱에서 승인해야 합니다.
- 한국 주식 주문은 '모의투자 계좌'로만 실행됨을 제안 시 언급합니다. 한투 실계좌는 조회 전용입니다.
- 매수/매도 제안 전에 반드시 현재가와 지표를 먼저 확인합니다.
- 사용자가 명시적으로 요청하지 않았다면 먼저 주문을 제안하지 않습니다.
- rationale 필드에 제안 근거 지표를 구체적으로 적습니다.

주의사항:
- 모든 분석 끝에는 투자 판단의 책임은 투자자 본인에게 있음을 짧게 안내합니다.
- 지표는 참고 자료일 뿐 수익을 보장하지 않음을 인지하고, 과도한 확신 표현을 피합니다."""

# 파일/셸/웹 등 내장 툴은 이 서비스에서 불필요 — 명시적으로 차단
DISALLOWED_BUILTIN_TOOLS = [
    "Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep",
    "WebSearch", "WebFetch", "NotebookEdit", "Task",
]


def build_options() -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        model=settings.agent_model,
        system_prompt=SYSTEM_PROMPT,
        mcp_servers={"stock": stock_server},
        allowed_tools=ALLOWED_TOOL_NAMES,
        disallowed_tools=DISALLOWED_BUILTIN_TOOLS,
        max_turns=20,
    )


class SessionManager:
    """세션 ID별 ClaudeSDKClient 유지 (멀티턴 대화). 단일 프로세스 인메모리."""

    def __init__(self) -> None:
        self._sessions: dict[str, ClaudeSDKClient] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

    async def get(self, session_id: str) -> tuple[ClaudeSDKClient, asyncio.Lock]:
        async with self._global_lock:
            if session_id not in self._sessions:
                client = ClaudeSDKClient(options=build_options())
                await client.connect()
                self._sessions[session_id] = client
                self._locks[session_id] = asyncio.Lock()
            return self._sessions[session_id], self._locks[session_id]

    async def close(self, session_id: str) -> None:
        async with self._global_lock:
            client = self._sessions.pop(session_id, None)
            self._locks.pop(session_id, None)
        if client is not None:
            try:
                await client.disconnect()
            except Exception:
                pass

    async def close_all(self) -> None:
        async with self._global_lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
            self._locks.clear()
        for client in sessions:
            try:
                await client.disconnect()
            except Exception:
                pass


session_manager = SessionManager()
