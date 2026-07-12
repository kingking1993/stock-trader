# Stock Trader — AI 주식 추천·매매 앱

기술 지표(이동평균선, RSI, MACD, 볼린저밴드)로 미국 주식을 추천하고,
Claude 에이전트와 대화하며 매매까지 할 수 있는 모바일 앱입니다.

- **백엔드**: Python / FastAPI / [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) / [Alpaca Markets](https://alpaca.markets)
- **프론트엔드**: React Native + Expo (TypeScript)

## 구조

```
backend/   FastAPI 서버 (시세·지표·추천·AI채팅·주문)
mobile/    Expo 앱 (추천 / 차트 / AI채팅 / 포트폴리오 탭)
```

## 1. 사전 준비 (API 키)

| 키 | 발급처 | 용도 |
|---|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com | AI 에이전트 (Claude) |
| `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | https://alpaca.markets (가입 후 대시보드) | 시세 조회 + 매매 |

> **페이퍼(모의) vs 실전**: Alpaca 대시보드에서 Paper Trading 키는 즉시 무료 발급됩니다.
> `.env`의 `ALPACA_PAPER=true`면 모의투자, 실전 매매는 라이브 키 발급(실계좌 개설·입금) 후
> `ALPACA_PAPER=false`로 바꾸면 됩니다. **코드는 동일합니다.**

## 2. 백엔드 실행

```powershell
cd backend
copy .env.example .env   # 키 입력
python -m venv .venv     # 최초 1회 (이미 생성되어 있음)
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- 확인: http://localhost:8000/health , API 문서: http://localhost:8000/docs
- 모든 API는 `X-API-Key` 헤더 필요 (`.env`의 `APP_API_KEY` 값)

### 주요 엔드포인트

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/recommend?top=5&analyze=true` | 지표 스크리너 상위 종목 + AI 코멘트 |
| `GET /api/market/chart/AAPL?timeframe=1D` | 봉 + SMA/RSI/MACD/볼린저 (차트용) |
| `POST /api/chat` (SSE) | AI 에이전트 대화 `{session_id, message}` |
| `GET /api/portfolio` | 계좌 요약 + 보유 포지션 |
| `POST /api/orders` → `POST /api/orders/{id}/confirm` | 주문 생성 → **승인 시에만 실행** |

### 주문 안전장치

에이전트는 주문을 직접 실행할 수 없습니다. `propose_order` 툴로 **제안**만 하며,
앱에서 사용자가 승인(`/confirm`)해야 실제 브로커 주문이 나갑니다.
추가로 1회 주문 금액 상한(`MAX_ORDER_VALUE`)과 5분 만료가 적용됩니다.

## 3. 모바일 앱 실행

```powershell
cd mobile
npm install
npx expo start
```

- 폰에 **Expo Go** 앱 설치 → 같은 Wi-Fi에서 QR 스캔
- 앱 첫 화면의 **설정(⚙)** 에서 서버 주소(`http://<PC의 LAN IP>:8000`)와 API 키 입력
  - PC의 LAN IP 확인: `ipconfig` → IPv4 주소
  - Windows 방화벽에서 8000 포트 인바운드 허용 필요할 수 있음

## 4. 테스트

```powershell
cd backend
.venv\Scripts\python -m pytest tests -q
```

## 면책

이 소프트웨어는 교육·참고용입니다. 기술 지표는 수익을 보장하지 않으며,
모든 투자 판단과 손익의 책임은 투자자 본인에게 있습니다.
