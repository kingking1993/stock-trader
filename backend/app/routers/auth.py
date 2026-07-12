"""앱 잠금 비밀번호 = APP_API_KEY. 검증·변경 엔드포인트."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.routers.deps import require_api_key
from app.services import broker_admin

router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/verify", dependencies=[Depends(require_api_key)])
async def verify():
    """올바른 비밀번호(X-API-Key)면 200, 아니면 401 (require_api_key가 처리)."""
    return {"ok": True}


class ChangePassword(BaseModel):
    current: str
    new: str


@router.post("/change-password")
async def change_password(body: ChangePassword):
    if body.current != settings.app_api_key:
        raise HTTPException(status_code=401, detail="현재 비밀번호가 일치하지 않습니다")
    new = body.new.strip()
    if len(new) < 4:
        raise HTTPException(status_code=400, detail="새 비밀번호는 4자 이상이어야 합니다")
    broker_admin.set_env_flag("APP_API_KEY", new)
    settings.app_api_key = new
    return {"ok": True, "note": "비밀번호가 변경되었습니다. (Render 무료 서버는 재배포 시 환경변수가 우선하니, 영구 변경은 Render 대시보드에서도 반영하세요.)"}
