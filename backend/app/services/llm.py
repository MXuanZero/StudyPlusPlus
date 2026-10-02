"""OpenAI-compatible LLM client with streaming, presets and mock mode.

The service deliberately knows nothing about FastAPI. Routers translate its
events into SSE frames, which keeps the client easy to test with
``httpx.MockTransport`` and interchangeable across providers.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx

from ..config import settings
from ..db import get_connection, utc_now
from ..schemas.settings import LLMSettings, LLMSettingsUpdate

SETTINGS_KEY = "llm"

PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "model": "qwen2.5:7b",
    },
    "custom": {
        "base_url": "",
        "model": "",
    },
}
DEFAULT_PROVIDER = "deepseek"

MOCK_REPLY = (
    "[当前为 Mock 模式] 尚未配置可用的大模型。请到“设置”页填写 DeepSeek "
    "或其他 OpenAI 兼容服务的 API Key。\n"
    "我是学习平台内置助教，配置后即可与你对话。"
)
MOCK_TEST_MESSAGE = "当前为 Mock 模式：尚未配置 API Key，Mock 回复可用。"

# Keys are masked with this many hidden characters, keeping only the tail.
MASK_PREFIX = "****"

_SECRET_PATTERN = re.compile(r"sk-[A-Za-z0-9_\-]{6,}")


class LLMError(Exception):
    """Classified LLM failure that is safe to show to the frontend."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class StreamEvent:
    """One logical chunk emitted while streaming a chat completion."""

    type: str  # "delta" | "done" | "error"
    content: str = ""
    usage: dict[str, Any] = field(default_factory=dict)
    code: str | None = None
    message: str | None = None
    finish_reason: str | None = None


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------


def default_config() -> dict[str, Any]:
    """Return a fresh copy of the default DeepSeek configuration."""

    preset = PROVIDER_PRESETS[DEFAULT_PROVIDER]
    return {
        "provider": DEFAULT_PROVIDER,
        "base_url": preset["base_url"],
        "model": preset["model"],
        "api_key": "",
        "temperature": 0.7,
        "max_tokens": 2048,
    }


def mask_api_key(api_key: str | None) -> str:
    """Return a display-safe key representation.

    Only the final four characters survive; shorter keys are fully hidden.
    """

    if not api_key:
        return ""
    key = api_key.strip()
    if not key:
        return ""
    if len(key) <= 4:
        return "*" * len(key)
    return f"{MASK_PREFIX}{key[-4:]}"


def sanitize_error_message(message: str | None, api_key: str | None = None) -> str:
    """Strip API keys and ``sk-`` secrets from an error message."""

    text = message or ""
    if api_key:
        text = text.replace(api_key, "***")
    text = _SECRET_PATTERN.sub("sk-***", text)
    return text


def normalize_base_url(base_url: str | None) -> str:
    """Normalize a user supplied OpenAI-compatible base URL.

    Rules from docs/02 4.3:
    - ``https://api.deepseek.com`` -> ``https://api.deepseek.com/v1``
    - URLs already ending in ``/v1`` are kept untouched.
    - URLs pointing directly at ``/chat/completions`` are idempotent and are
      reduced back to their base first.
    """

    if not base_url:
        return ""
    url = base_url.strip().rstrip("/")
    if not url:
        return ""
    suffix = "/chat/completions"
    if url.endswith(suffix):
        url = url[: -len(suffix)].rstrip("/")
    if url.endswith("/v1"):
        return url
    return f"{url}/v1"


def chat_completions_url(base_url: str | None) -> str:
    """Build the final ``/chat/completions`` URL for a base URL."""

    normalized = normalize_base_url(base_url)
    if not normalized:
        raise LLMError(
            "LLM_CONFIG_ERROR",
            "Base URL 不能为空，请在设置页填写 OpenAI 兼容服务地址。",
        )
    return f"{normalized}/chat/completions"


def _coerce_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Merge raw JSON from ``app_settings`` over the defaults."""

    data = default_config()
    raw = raw or {}
    for field_name in ("provider", "base_url", "model"):
        value = raw.get(field_name)
        if isinstance(value, str):
            data[field_name] = value.strip()
    if isinstance(raw.get("api_key"), str):
        data["api_key"] = raw["api_key"].strip()
    temperature = raw.get("temperature")
    if isinstance(temperature, (int, float)) and not isinstance(temperature, bool):
        data["temperature"] = float(temperature)
    max_tokens = raw.get("max_tokens")
    if isinstance(max_tokens, int) and not isinstance(max_tokens, bool):
        data["max_tokens"] = max_tokens
    if not data["provider"]:
        data["provider"] = DEFAULT_PROVIDER
    return data


def _load_stored_raw() -> dict[str, Any]:
    """Read the ``llm`` settings row without falling back to env vars."""

    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT value_json FROM app_settings WHERE key = ?",
                (SETTINGS_KEY,),
            ).fetchone()
    except sqlite3.OperationalError:
        # Database not initialized yet (e.g. lightweight unit test).
        return {}
    if row is None:
        return {}
    try:
        data = json.loads(row["value_json"])
    except (TypeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_stored_raw(raw: dict[str, Any]) -> None:
    now = utc_now()
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO app_settings (key, value_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              updated_at = excluded.updated_at
            """,
            (SETTINGS_KEY, json.dumps(raw, ensure_ascii=False), now),
        )


def get_stored_llm_settings() -> LLMSettings:
    """Return only the configuration persisted in the database.

    Environment variables are intentionally ignored here so saving unrelated
    fields never accidentally persists an env-provided key.
    """

    return LLMSettings(**_coerce_config(_load_stored_raw()))


def resolve_llm_settings() -> tuple[LLMSettings, str]:
    """Resolve effective settings plus the source of the active API key.

    Priority: database ``app_settings`` > ``LLM_API_KEY`` env var > Mock.
    """

    stored = get_stored_llm_settings()
    if stored.api_key:
        return stored, "database"

    env_key = (os.getenv("LLM_API_KEY") or "").strip()
    if env_key:
        data = stored.model_dump()
        data["api_key"] = env_key
        return LLMSettings(**data), "environment"

    return stored, "none"


def get_llm_settings() -> LLMSettings:
    """Convenience wrapper returning effective settings only."""

    return resolve_llm_settings()[0]


def is_mock_mode() -> bool:
    """Return ``True`` when no API key is configured."""

    return not get_llm_settings().api_key


def save_llm_settings(update: LLMSettingsUpdate) -> LLMSettings:
    """Apply a partial settings update and persist it.

    An empty/missing ``api_key`` keeps the stored key. Changing the provider
    without an explicit base URL/model fills in that provider's preset.
    """

    data = get_stored_llm_settings().model_dump()
    provided = update.model_dump(exclude_unset=True)

    new_provider = provided.get("provider")
    if new_provider:
        previous_provider = data["provider"]
        data["provider"] = new_provider
        preset = PROVIDER_PRESETS.get(new_provider)
        if preset and new_provider != previous_provider:
            if not provided.get("base_url"):
                data["base_url"] = preset["base_url"]
            if not provided.get("model"):
                data["model"] = preset["model"]

    for field_name in ("base_url", "model", "temperature", "max_tokens"):
        value = provided.get(field_name)
        if value is not None:
            data[field_name] = value

    # Empty string means "keep the existing key"; only reset can clear it.
    api_key = provided.get("api_key")
    if api_key:
        data["api_key"] = api_key.strip()

    saved = LLMSettings(**data)
    _write_stored_raw(saved.model_dump())
    return resolve_llm_settings()[0]


def reset_llm_settings() -> LLMSettings:
    """Delete stored LLM settings, restoring defaults (env key still applies)."""

    with get_connection() as conn:
        conn.execute("DELETE FROM app_settings WHERE key = ?", (SETTINGS_KEY,))
    return resolve_llm_settings()[0]


def build_settings_response(
    config: LLMSettings | None = None,
    key_source: str | None = None,
) -> dict[str, Any]:
    """Build the sanitized settings response payload."""

    if config is None or key_source is None:
        config, key_source = resolve_llm_settings()
    return {
        "provider": config.provider,
        "base_url": config.base_url,
        "model": config.model,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "has_api_key": bool(config.api_key),
        "api_key_masked": mask_api_key(config.api_key),
        "key_source": key_source,
        "mode": "live" if config.api_key else "mock",
        "effective_base_url": normalize_base_url(config.base_url),
    }


# ---------------------------------------------------------------------------
# HTTP client construction
# ---------------------------------------------------------------------------


def _build_async_client(timeout: float) -> httpx.AsyncClient:
    """Create the async HTTP client.

    Tests monkeypatch this factory to inject ``httpx.MockTransport``.
    """

    return httpx.AsyncClient(timeout=timeout, follow_redirects=True)


def _timeout_seconds() -> float:
    try:
        return float(settings.llm_timeout_seconds)
    except (TypeError, ValueError):
        return 60.0


def _headers(config: LLMSettings) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    return headers


def _payload(config: LLMSettings, messages: list[dict[str, Any]], stream: bool) -> dict[str, Any]:
    return {
        "model": config.model,
        "messages": messages,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "stream": stream,
    }


def _classify_http_status(status_code: int) -> str:
    if status_code in (401, 403):
        return "LLM_AUTH_ERROR"
    if status_code == 404:
        return "LLM_MODEL_NOT_FOUND"
    if status_code == 429:
        return "LLM_RATE_LIMITED"
    if status_code >= 500:
        return "LLM_UPSTREAM_ERROR"
    return "LLM_HTTP_ERROR"


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


async def stream_chat(
    messages: list[dict[str, Any]],
    config: LLMSettings | None = None,
    client: httpx.AsyncClient | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream a chat completion as :class:`StreamEvent` objects.

    On success yields zero or more ``delta`` events followed by ``done``.
    Failures yield a single ``error`` event with a classified code. This
    function never raises for upstream/network failures.
    """

    config = config or resolve_llm_settings()[0]

    if not config.api_key:
        yield StreamEvent(type="delta", content=MOCK_REPLY)
        yield StreamEvent(type="done", usage={})
        return

    owns_client = client is None
    if client is None:
        client = _build_async_client(_timeout_seconds())

    try:
        url = chat_completions_url(config.base_url)
        payload = _payload(config, messages, stream=True)
        usage: dict[str, Any] = {}
        finish_reason: str | None = None

        async with client.stream(
            "POST",
            url,
            json=payload,
            headers=_headers(config),
        ) as response:
            if response.status_code >= 400:
                body = await response.aread()
                detail = sanitize_error_message(
                    body.decode("utf-8", errors="replace")[:500], config.api_key
                )
                code = _classify_http_status(response.status_code)
                message = f"上游服务返回 HTTP {response.status_code}"
                if detail:
                    message = f"{message}: {detail}"
                yield StreamEvent(type="error", code=code, message=message)
                return

            async for line in response.aiter_lines():
                data_str = _extract_sse_data(line)
                if data_str is None:
                    continue
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    yield StreamEvent(
                        type="error",
                        code="LLM_BAD_RESPONSE",
                        message="上游返回了无法解析的流式数据。",
                    )
                    return

                if isinstance(chunk.get("usage"), dict):
                    usage = chunk["usage"]

                for choice in chunk.get("choices") or []:
                    if not isinstance(choice, dict):
                        continue
                    if choice.get("finish_reason"):
                        finish_reason = str(choice["finish_reason"])
                    delta = choice.get("delta") or {}
                    content = delta.get("content")
                    if content:
                        yield StreamEvent(type="delta", content=str(content))

        yield StreamEvent(type="done", usage=usage, finish_reason=finish_reason)

    except LLMError as exc:
        yield StreamEvent(type="error", code=exc.code, message=exc.message)
    except httpx.TimeoutException:
        yield StreamEvent(
            type="error",
            code="LLM_TIMEOUT",
            message="调用大模型超时，请稍后重试或检查网络。",
        )
    except (httpx.ConnectError, httpx.NetworkError, httpx.RemoteProtocolError):
        yield StreamEvent(
            type="error",
            code="LLM_CONNECTION_ERROR",
            message="无法连接到大模型服务，请检查 Base URL 和网络。",
        )
    except (httpx.InvalidURL, httpx.UnsupportedProtocol):
        yield StreamEvent(
            type="error",
            code="LLM_CONFIG_ERROR",
            message="Base URL 格式无效，请检查设置。",
        )
    except Exception as exc:  # noqa: BLE001 - converted into an SSE error event
        yield StreamEvent(
            type="error",
            code="LLM_ERROR",
            message=f"调用大模型时发生未知错误：{sanitize_error_message(str(exc), config.api_key)}",
        )
    finally:
        if owns_client:
            await client.aclose()


def _extract_sse_data(line: str) -> str | None:
    """Extract the payload from an SSE ``data:`` line.

    Some OpenAI-compatible servers send bare JSON lines; support both forms.
    """

    if line is None:
        return None
    stripped = line.strip()
    if not stripped:
        return None
    if stripped.startswith(":"):
        return None
    if stripped.startswith("event:"):
        return None
    if stripped.startswith("data:"):
        return stripped[len("data:") :].strip()
    return stripped


# ---------------------------------------------------------------------------
# Connection test
# ---------------------------------------------------------------------------


async def test_connection(
    config: LLMSettings | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Send a minimal request to validate a configuration.

    Returns a plain dict matching :class:`schemas.settings.LLMTestResponse`.
    """

    config = config or resolve_llm_settings()[0]

    if not config.api_key:
        return {
            "ok": True,
            "mode": "mock",
            "message": MOCK_TEST_MESSAGE,
            "provider": config.provider,
            "model": config.model,
            "latency_ms": 0,
            "code": None,
        }

    owns_client = client is None
    if client is None:
        client = _build_async_client(_timeout_seconds())

    started = time.perf_counter()
    try:
        url = chat_completions_url(config.base_url)
        response = await client.post(
            url,
            json={
                "model": config.model,
                "messages": [{"role": "user", "content": "ping"}],
                "temperature": 0,
                "max_tokens": 16,
                "stream": False,
            },
            headers=_headers(config),
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        if response.status_code >= 400:
            detail = sanitize_error_message(
                response.text[:500], config.api_key
            )
            return {
                "ok": False,
                "mode": "live",
                "message": f"HTTP {response.status_code}: {detail}" if detail else f"HTTP {response.status_code}",
                "provider": config.provider,
                "model": config.model,
                "latency_ms": latency_ms,
                "code": _classify_http_status(response.status_code),
            }

        try:
            data = response.json()
        except (json.JSONDecodeError, ValueError):
            return {
                "ok": False,
                "mode": "live",
                "message": "连接成功，但响应不是合法 JSON。",
                "provider": config.provider,
                "model": config.model,
                "latency_ms": latency_ms,
                "code": "LLM_BAD_RESPONSE",
            }

        content = ""
        try:
            content = str(data["choices"][0]["message"]["content"])[:80]
        except (KeyError, IndexError, TypeError):
            content = ""
        message = "连接成功。"
        if content:
            message = f"连接成功，模型返回：{sanitize_error_message(content, config.api_key)}"
        return {
            "ok": True,
            "mode": "live",
            "message": message,
            "provider": config.provider,
            "model": config.model,
            "latency_ms": latency_ms,
            "code": None,
        }
    except LLMError as exc:
        return {
            "ok": False,
            "mode": "live",
            "message": exc.message,
            "provider": config.provider,
            "model": config.model,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "code": exc.code,
        }
    except httpx.TimeoutException:
        return {
            "ok": False,
            "mode": "live",
            "message": "调用大模型超时，请稍后重试或检查网络。",
            "provider": config.provider,
            "model": config.model,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "code": "LLM_TIMEOUT",
        }
    except (httpx.ConnectError, httpx.NetworkError, httpx.RemoteProtocolError):
        return {
            "ok": False,
            "mode": "live",
            "message": "无法连接到大模型服务，请检查 Base URL 和网络。",
            "provider": config.provider,
            "model": config.model,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "code": "LLM_CONNECTION_ERROR",
        }
    except (httpx.InvalidURL, httpx.UnsupportedProtocol):
        return {
            "ok": False,
            "mode": "live",
            "message": "Base URL 格式无效，请检查设置。",
            "provider": config.provider,
            "model": config.model,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "code": "LLM_CONFIG_ERROR",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "mode": "live",
            "message": f"连接测试失败：{sanitize_error_message(str(exc), config.api_key)}",
            "provider": config.provider,
            "model": config.model,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "code": "LLM_ERROR",
        }
    finally:
        if owns_client:
            await client.aclose()
