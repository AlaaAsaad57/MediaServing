"""Credential loading shared by the workflow helper scripts.

Kept in one place so the three Trello/ClickUp helpers cannot drift apart on where
a token comes from. Precedence is: real environment variable first, then the
gitignored `.env.development` file. Nothing here ever writes a file or logs a
secret value.

`.env.development` is matched by `.gitignore` and must stay untracked — these
tokens are never committed.
"""
import os
import re
from pathlib import Path

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env.development"
_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$")

_cache: dict[str, str] | None = None


def _load_file() -> dict[str, str]:
    """Parse `.env.development` once. A missing file is not an error."""
    global _cache
    if _cache is not None:
        return _cache

    values: dict[str, str] = {}
    if _ENV_FILE.is_file():
        for raw in _ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
            if not raw.strip() or raw.lstrip().startswith("#"):
                continue
            match = _LINE.match(raw)
            if not match:
                continue
            key, value = match.group(1), match.group(2)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key] = value

    _cache = values
    return _cache


def require(name: str, error_code: str) -> str:
    """Return the credential, or exit with a coded error naming only the key."""
    value = os.environ.get(name) or _load_file().get(name)
    if not value:
        raise SystemExit(
            f"{error_code} ERROR: {name} is not set "
            f"(checked the environment and {_ENV_FILE.name})"
        )
    return value
