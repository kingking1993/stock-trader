from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

# Agent SDK 서브프로세스가 읽을 수 있도록 환경변수로 전파
if settings.anthropic_api_key and not os.environ.get("ANTHROPIC_API_KEY"):
    os.environ["ANTHROPIC_API_KEY"] = settings.anthropic_api_key

from app.agent.agent import session_manager  # noqa: E402
from app.routers import brokers, chat, market, recommend, trading  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await session_manager.close_all()


app = FastAPI(title="Stock Trader API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(brokers.router)
app.include_router(market.router)
app.include_router(recommend.router)
app.include_router(chat.router)
app.include_router(trading.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "paper_trading": settings.alpaca_paper,
        "model": settings.agent_model,
        "alpaca_configured": bool(settings.alpaca_api_key),
        "anthropic_configured": bool(settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")),
    }
