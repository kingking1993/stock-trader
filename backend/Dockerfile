# 주식 트레이더 백엔드 — Python + Node (claude-agent-sdk가 claude CLI 서브프로세스를 요구)
FROM python:3.12-slim

# Node.js 20 (claude-agent-sdk 런타임) + 빌드 도구
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 파이썬 의존성 (레이어 캐시)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 앱 소스
COPY app ./app

EXPOSE 8000

# 프로덕션 실행 (단일 워커 — 인메모리 세션·pending 주문 상태 공유 위해)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
