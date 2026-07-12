"""AI 에이전트 채팅 — SSE 스트리밍."""
from __future__ import annotations

import json

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agent.agent import session_manager
from app.routers.deps import require_api_key
from app.services import order_store

router = APIRouter(prefix="/api/chat", tags=["chat"], dependencies=[Depends(require_api_key)])


class ChatIn(BaseModel):
    session_id: str = "default"
    message: str


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _serialize(message) -> list[dict]:
    events: list[dict] = []
    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock):
                events.append({"type": "text", "text": block.text})
            elif isinstance(block, ToolUseBlock):
                events.append({"type": "tool_use", "name": block.name, "input": block.input})
    elif isinstance(message, UserMessage):
        content = message.content
        if isinstance(content, list):
            for block in content:
                if isinstance(block, ToolResultBlock):
                    events.append({"type": "tool_result", "is_error": bool(block.is_error)})
    elif isinstance(message, ResultMessage):
        events.append(
            {
                "type": "result",
                "duration_ms": getattr(message, "duration_ms", None),
                "total_cost_usd": getattr(message, "total_cost_usd", None),
            }
        )
    return events


@router.post("")
async def chat(body: ChatIn):
    client, lock = await session_manager.get(body.session_id)

    async def gen():
        async with lock:  # 같은 세션에 동시 요청 방지
            try:
                await client.query(body.message)
                async for message in client.receive_response():
                    for event in _serialize(message):
                        yield _sse(event)
            except Exception as e:
                yield _sse({"type": "error", "error": str(e)})
        # 스트림 종료 시점의 대기 주문을 알려 앱이 확인 카드를 띄울 수 있게 함
        yield _sse({"type": "done", "pending_orders": order_store.list_pending()})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/{session_id}")
async def reset_session(session_id: str):
    await session_manager.close(session_id)
    return {"ok": True}
