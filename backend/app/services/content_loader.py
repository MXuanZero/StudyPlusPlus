"""Load the curriculum tree and chapter Markdown content.

The loader is deliberately stateless: the curriculum JSON is small, and reading
it on each request keeps the API correct when content files are edited while the
server is running.  Markdown frontmatter is parsed with PyYAML and the body is
returned unchanged (apart from trimming surrounding blank lines) so the frontend
can render KaTeX, ``:::details`` blocks and ``[[widget:...]]`` placeholders.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from ..config import settings

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


class ContentError(RuntimeError):
    """Raised when a content file exists but cannot be parsed."""


def _curriculum_path() -> Path:
    return settings.content_dir / "curriculum.json"


def get_curriculum() -> dict[str, Any]:
    """Return the complete curriculum tree.

    The returned object is freshly decoded JSON, so callers may safely mutate it
    without affecting later reads.
    """
    path = _curriculum_path()
    if not path.exists():
        raise ContentError(f"curriculum file not found: {path}")
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise ContentError(f"invalid curriculum json: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("books"), list):
        raise ContentError("curriculum.json must contain a 'books' list")
    return data


def _iter_chapters(curriculum: dict[str, Any]):
    for book in curriculum.get("books", []):
        for chapter in book.get("chapters", []):
            yield book, chapter


def _iter_topics(curriculum: dict[str, Any]):
    for book, chapter in _iter_chapters(curriculum):
        for topic in chapter.get("topics", []):
            yield book, chapter, topic


def get_topic_entry(topic_id: str) -> dict[str, Any] | None:
    """Return the raw curriculum entry for ``topic_id`` (planned or available).

    ``None`` means the topic id does not exist in the curriculum at all.
    """
    for _book, _chapter, topic in _iter_topics(get_curriculum()):
        if topic.get("id") == topic_id:
            return topic
    return None


def get_topic_ids_for_chapter(chapter_id: str) -> list[str]:
    """Return every topic id that belongs to ``chapter_id``.

    Planned chapters are included as well; the progress router only asks for
    chapters that actually have learnable topics.
    """
    for _book, chapter in _iter_chapters(get_curriculum()):
        if chapter.get("id") == chapter_id:
            return [str(topic.get("id")) for topic in chapter.get("topics", []) if topic.get("id")]
    return []


def _find_topic(topic_id: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    for book, chapter, topic in _iter_topics(get_curriculum()):
        if topic.get("id") == topic_id:
            return book, chapter, topic
    return None


def _parse_markdown(path: Path) -> tuple[dict[str, Any], str]:
    """Split a Markdown file into ``(frontmatter, body)``."""
    text = path.read_text(encoding="utf-8")
    match = _FRONTMATTER_RE.match(text)
    if match is None:
        # Files without frontmatter are still readable, just metadata-free.
        return {}, text.strip()

    try:
        frontmatter = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        raise ContentError(f"invalid YAML frontmatter in {path}: {exc}") from exc
    if not isinstance(frontmatter, dict):
        raise ContentError(f"frontmatter must be a mapping in {path}")
    return frontmatter, match.group(2).strip()


def _available_topics(curriculum: dict[str, Any]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for _book, _chapter, topic in _iter_topics(curriculum):
        if topic.get("status") == "available":
            items.append({"id": str(topic["id"]), "title": str(topic.get("title", ""))})
    return items


def get_topic(topic_id: str) -> dict[str, Any] | None:
    """Return a fully assembled topic payload, or ``None`` if unavailable.

    The returned keys match the contract in ``docs/02_技术方案与架构.md``:
    ``id``, ``chapter_id``, ``title``, ``order``, ``summary``,
    ``learning_objectives``, ``prerequisites``, ``body_markdown``, ``widgets``,
    ``prev_topic`` and ``next_topic``.
    """
    found = _find_topic(topic_id)
    if found is None:
        return None
    _book, chapter, topic = found
    if topic.get("status") != "available":
        return None

    file_name = topic.get("file")
    if not file_name:
        return None
    path = settings.content_dir / str(file_name)
    if not path.exists():
        return None

    frontmatter, body = _parse_markdown(path)

    widgets = frontmatter.get("widgets") or topic.get("widgets") or []
    prerequisites = frontmatter.get("prerequisites") or []
    learning_objectives = frontmatter.get("learning_objectives") or []

    curriculum = get_curriculum()
    available = _available_topics(curriculum)
    ids = [item["id"] for item in available]
    index = ids.index(topic_id) if topic_id in ids else -1

    prev_topic = available[index - 1] if index > 0 else None
    next_topic = available[index + 1] if 0 <= index < len(available) - 1 else None

    return {
        "id": frontmatter.get("id", topic.get("id")),
        "chapter_id": frontmatter.get("chapter_id", chapter.get("id")),
        "title": frontmatter.get("title", topic.get("title", "")),
        "order": frontmatter.get("order", 0),
        "summary": frontmatter.get("summary", ""),
        "learning_objectives": list(learning_objectives),
        "prerequisites": list(prerequisites),
        "body_markdown": body,
        "widgets": list(widgets),
        "prev_topic": prev_topic,
        "next_topic": next_topic,
    }
