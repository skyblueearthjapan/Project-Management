from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """環境変数から設定をロード。秘匿情報は SecretStr で保持し、ログには出さない。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- DB ----
    database_url: str = Field(
        default="postgresql+asyncpg://pm:pm@db:5432/pm",
        description="SQLAlchemy async DSN",
    )

    # ---- Meilisearch ----
    # Phase A で未使用、Phase C/F で完全削除予定。
    # デフォルトを空文字にして、誤って呼ばれても DNS 解決失敗で即時クラッシュさせる (loud failure)。
    meili_url: str = Field(default="")
    meili_master_key: SecretStr = Field(default=SecretStr(""))

    # ---- File server / uploads ----
    fileserver_root: Path = Field(default=Path("/mnt/fileserver"))
    upload_dir: Path = Field(default=Path("/mnt/uploads"))

    # ---- 工番マスタ Excel ----
    master_excel_path_shin_ichiran: Path = Field(
        default=Path("/mnt/fileserver/総務部/社内/日程表/新一覧.xlsm"),
    )
    master_excel_path_nittei_hyo_a: Path = Field(
        default=Path("/mnt/fileserver/総務部/社内/日程表/日程表A.xlsx"),
    )
    master_sync_interval_sec: int = Field(default=60, ge=10, le=3600)

    # ---- セキュリティ ----
    cors_origins: str = Field(default="http://localhost:5173,http://localhost:8080")
    lan_allow_cidr: str = Field(default="192.168.0.0/16")

    # ---- バックグラウンド ----
    enable_scheduler: bool = Field(default=True)
    link_check_interval_sec: int = Field(default=3600, ge=60)
    # Phase A で未使用、Phase C/F で完全削除予定 (Meilisearch サービス廃止のため)
    meili_sync_interval_sec: int = Field(default=300, ge=30)

    # ---- ロギング ----
    log_level: str = Field(default="info")
    dev_mode: bool = Field(default=False)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
