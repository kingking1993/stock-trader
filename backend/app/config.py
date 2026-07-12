from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    anthropic_api_key: str = ""
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    alpaca_paper: bool = True

    # 한국투자증권 — 실전 키 (시세·일봉·실계좌 잔고 '조회 전용', 주문에 사용하지 않음)
    kis_app_key: str = ""
    kis_app_secret: str = ""
    kis_account: str = ""  # 실계좌번호 예: 12345678-01
    # 한국투자증권 — 모의투자 키 (국내 주문 실행 전용)
    kis_vts_app_key: str = ""
    kis_vts_app_secret: str = ""
    kis_vts_account: str = ""  # 모의계좌번호

    # 토스증권 (실계좌 — 주문은 toss_allow_orders를 명시적으로 켜야 가능)
    toss_client_id: str = ""
    toss_client_secret: str = ""
    toss_allow_orders: bool = False

    agent_model: str = "claude-sonnet-5"
    app_api_key: str = "dev-key"
    max_order_value: float = 5000.0  # 미국 주문 1회 상한 (USD)
    max_order_value_krw: float = 5_000_000.0  # 국내 주문 1회 상한 (KRW)

    # pending 주문 만료 시간 (초)
    pending_order_ttl: int = 300


settings = Settings()
