"""Application configuration for StudyPlusPlus."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("STUDY_DATA_DIR", BASE_DIR / "data")).resolve()
FRONTEND_DIST = Path(os.getenv("STUDY_FRONTEND_DIST", BASE_DIR / "frontend" / "dist")).resolve()
CONTENT_DIR = BASE_DIR / "backend" / "app" / "content"
PROMPTS_DIR = BASE_DIR / "backend" / "app" / "prompts"


class Settings:
    """Runtime settings loaded from environment variables."""

    app_name: str = "StudyPlusPlus"
    version: str = "0.1.0"
    data_dir: Path = DATA_DIR
    frontend_dist: Path = FRONTEND_DIST
    content_dir: Path = CONTENT_DIR
    prompts_dir: Path = PROMPTS_DIR
    db_path: Path = DATA_DIR / "studyplusplus.db"
    llm_timeout_seconds: int = int(os.getenv("LLM_TIMEOUT_SECONDS", "60"))
    cors_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
