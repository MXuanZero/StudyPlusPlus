"""FastAPI application entry point for StudyPlusPlus."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import init_db
from .routers import chat, compute, content, curriculum, health, notes, progress, settings as settings_router

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.ensure_dirs()
    init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="StudyPlusPlus control-theory visual learning API.",
    lifespan=lifespan,
)

@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    _request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Return one stable error envelope for all Pydantic validation errors.

    docs/02 section 5 requires every error to be
    ``{"detail": {"code": "...", "message": "..."}}``.  FastAPI's default
    handler returns ``detail`` as a list, which the frontend cannot parse
    consistently.
    """
    errors = exc.errors()
    first = errors[0] if errors else {}
    location = ".".join(
        str(part) for part in first.get("loc", []) if part not in ("body",)
    ) or "request"
    message = f"{location}: {first.get('msg', '请求参数校验失败')}"
    safe_errors = [
        {
            "loc": [str(part) for part in item.get("loc", [])],
            "msg": item.get("msg", ""),
            "type": item.get("type", ""),
        }
        for item in errors
    ]
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "code": "VALIDATION_ERROR",
                "message": message,
                "errors": safe_errors,
            }
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix=API_PREFIX)
app.include_router(curriculum.router, prefix=API_PREFIX)
app.include_router(content.router, prefix=API_PREFIX)
app.include_router(compute.router, prefix=API_PREFIX)
app.include_router(chat.router, prefix=API_PREFIX)
app.include_router(settings_router.router, prefix=API_PREFIX)
app.include_router(progress.router, prefix=API_PREFIX)
app.include_router(notes.router, prefix=API_PREFIX)


@app.get("/", include_in_schema=False)
def root():
    if settings.frontend_dist.exists():
        return FileResponse(settings.frontend_dist / "index.html")
    return {"name": settings.app_name, "docs": "/docs", "health": f"{API_PREFIX}/health"}


def _mount_frontend() -> None:
    """Serve the production frontend build when it exists.

    During development the Vite dev server handles the frontend, so the dist
    folder may be absent; in that case only the API is available.
    """
    if not settings.frontend_dist.exists():
        return

    assets_dir = settings.frontend_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "接口不存在"})
        return FileResponse(settings.frontend_dist / "index.html")


_mount_frontend()
