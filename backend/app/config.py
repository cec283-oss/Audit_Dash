"""설정. 환경 변수 또는 backend/.env 로 바꿉니다.

DATA_SOURCE   csv(기본) | sql
DATA_DIR      CSV 폴더 (기본: backend/data/sample)
DB_URL        DATA_SOURCE=sql 일 때 SQLAlchemy URL
WINDOW_DAYS   집계 기간 기본값 (기본 90일)
RECENT_DAYS   '최근' 판정 기간 (기본 30일)
CORS_ORIGINS  쉼표 구분 (기본: Vite 개발 서버)
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _load_dotenv() -> None:
    env = BACKEND_DIR / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    data_source: str = os.getenv("DATA_SOURCE", "csv").lower()
    data_dir: Path = Path(os.getenv("DATA_DIR", str(BACKEND_DIR / "data" / "sample")))
    db_url: str | None = os.getenv("DB_URL") or None
    window_days: int = int(os.getenv("WINDOW_DAYS", "90"))
    recent_days: int = int(os.getenv("RECENT_DAYS", "30"))
    event_cap: int = int(os.getenv("EVENT_CAP", "3000"))  # 화면 요약용으로 보내는 이벤트 최대 건수 (전체는 /records)
    warmup: bool = os.getenv("WARMUP", "1") not in ("0", "false", "no")
    cors_origins: list[str] = field(default_factory=lambda: [o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()])
    frontend_dist: Path = Path(os.getenv("FRONTEND_DIST", str(BACKEND_DIR.parent / "frontend" / "dist")))


settings = Settings()
