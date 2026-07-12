from fastapi import Header, HTTPException

from app.config import settings


def require_api_key(x_api_key: str = Header(default="")) -> None:
    if x_api_key != settings.app_api_key:
        raise HTTPException(status_code=401, detail="유효하지 않은 API 키입니다")
