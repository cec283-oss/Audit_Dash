from __future__ import annotations

from functools import lru_cache

from ..config import settings
from .base import Repository
from .csv_repo import CsvRepository, DataError


@lru_cache
def get_repository() -> Repository:
    if settings.data_source == "sql":
        from .sql_repo import SqlRepository

        if not settings.db_url:
            raise RuntimeError("DATA_SOURCE=sql 이면 DB_URL 을 설정해야 합니다.")
        return SqlRepository(settings.db_url)
    return CsvRepository(settings.data_dir)


__all__ = ["Repository", "CsvRepository", "DataError", "get_repository"]
